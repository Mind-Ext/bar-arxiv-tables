import { CellValue, ParsedTable } from './parser'
import {
  getEffectiveSettings,
  isColormap,
  resolveColormapCycle,
  resolvePaletteCycle,
} from './settings'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnStats {
  min: number
  max: number
}

interface ActiveVisualization {
  parsed: ParsedTable
  originalStyles: Map<HTMLTableCellElement, string>
  active: boolean
  mode: 'bars' | 'heatmap'
  compositeKey?: string
}

// Store active visualizations keyed by table element
const activeVisualizations = new Map<HTMLTableElement, ActiveVisualization>()

interface BarColors {
  pos: string
  posAccent: string
  neg: string
  negAccent: string
}

/** Consistent bar overlay opacity (35%) optimized for text legibility in both light & dark modes */
export const BAR_OPACITY = 0.35

/**
 * Parse hex or rgb color string into { r, g, b } components.
 */
export function parseToRgb(
  colorStr: string,
): { r: number; g: number; b: number } {
  const hex = colorStr.trim()
  if (hex.startsWith('#')) {
    let clean = hex.slice(1)
    if (clean.length === 3) {
      clean = clean.split('').map((ch) => ch + ch).join('')
    }
    if (clean.length === 6) {
      const num = parseInt(clean, 16)
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      }
    }
  }
  const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    }
  }
  return { r: 76, g: 175, b: 80 }
}

// ---------------------------------------------------------------------------
// Core Rendering
// ---------------------------------------------------------------------------

/**
 * Compute per-column min/max statistics.
 */
function computeColumnStats(
  data: CellValue[][],
  numCols: number,
): ColumnStats[] {
  const stats: ColumnStats[] = []
  for (let c = 0; c < numCols; c++) {
    let min = Infinity
    let max = -Infinity
    for (let r = 0; r < data.length; r++) {
      const v = data[r][c]?.value
      if (v !== null && v !== undefined && isFinite(v)) {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    stats.push({ min, max })
  }
  return stats
}

/**
 * Build the CSS linear-gradient for a cell based on column polarity and palette color.
 */
function buildGradient(
  value: number,
  stats: ColumnStats,
  isHighlighted: boolean,
  colors: BarColors,
): string {
  const { min, max } = stats

  // Constant column — full bar
  if (min === max) {
    const color = isHighlighted ? colors.posAccent : colors.pos
    return `linear-gradient(to right, ${color} 100%, transparent 100%)`
  }

  // Positive column (min >= 0)
  if (min >= 0) {
    const ratio = ((value - min) / (max - min)) * 100
    const color = isHighlighted ? colors.posAccent : colors.pos
    return `linear-gradient(to right, ${color} ${ratio}%, transparent ${ratio}%)`
  }

  // Negative column (max <= 0)
  if (max <= 0) {
    const ratio = ((value - max) / (min - max)) * 100
    const color = isHighlighted ? colors.negAccent : colors.neg
    return `linear-gradient(to left, ${color} ${ratio}%, transparent ${ratio}%)`
  }

  // Bipolar column (min < 0 and max > 0)
  const absMax = Math.max(Math.abs(min), Math.abs(max))
  const zeroPct = 50

  if (value >= 0) {
    const valPct = 50 + (value / absMax) * 50
    const color = isHighlighted ? colors.posAccent : colors.pos
    return `linear-gradient(to right, transparent ${zeroPct}%, ${color} ${zeroPct}%, ${color} ${valPct}%, transparent ${valPct}%)`
  } else {
    const valPct = 50 - (Math.abs(value) / absMax) * 50
    const color = isHighlighted ? colors.negAccent : colors.neg
    return `linear-gradient(to right, transparent ${valPct}%, ${color} ${valPct}%, ${color} ${zeroPct}%, transparent ${zeroPct}%)`
  }
}

/**
 * Apply inline cell-bar or heatmap visualization to a parsed table.
 */
export function applyInlineBars(
  parsed: ParsedTable,
  table: HTMLTableElement,
  overrideMode?: 'bars' | 'heatmap',
  compositeKey?: string,
): void {
  const { data, domCells } = parsed
  if (data.length === 0) return

  const numCols = data[0].length
  const stats = computeColumnStats(data, numCols)

  const settings = getEffectiveSettings(compositeKey)
  const chartOpacity = settings.chartOpacity !== undefined
    ? settings.chartOpacity
    : 0.35
  const activeMode = overrideMode ||
    (settings.autoVisualize !== 'off' ? settings.autoVisualize : 'bars')
  const isBarColormap = isColormap(settings.barColorScheme)
  const barColormapCycle = isBarColormap
    ? resolveColormapCycle(settings.barColorScheme)
    : null
  const paletteCycle = resolvePaletteCycle(settings.barColorScheme)
  const colormapCycle = resolveColormapCycle(settings.heatmapColorScheme)

  // Precompute per-column colors cycled from the active palette cycle for bars mode
  const columnBarColors: BarColors[] = []
  for (let c = 0; c < numCols; c++) {
    const palette = paletteCycle[c % paletteCycle.length]
    const baseColor = palette[c % palette.length]
    const { r, g, b } = parseToRgb(baseColor)
    const colorStr = `rgba(${r}, ${g}, ${b}, ${chartOpacity})`
    columnBarColors.push({
      pos: colorStr,
      posAccent: colorStr,
      neg: colorStr,
      negAccent: colorStr,
    })
  }

  // Save original styles for toggle-off restoration
  const originalStyles = new Map<HTMLTableCellElement, string>()

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = domCells[r]?.[c]
      const cv = data[r][c]

      if (!cell || cv.value === null) continue

      // Stats might be degenerate (no finite values found)
      if (!isFinite(stats[c].min) || !isFinite(stats[c].max)) continue

      // Save original
      originalStyles.set(cell, cell.style.background || '')

      if (activeMode === 'heatmap') {
        const { min, max } = stats[c]
        const norm = min === max
          ? 0.5
          : Math.max(0, Math.min(1, (cv.value - min) / (max - min)))
        const interpolator = colormapCycle[c % colormapCycle.length]
        const rgbStr = interpolator(norm)
        const { r, g, b } = parseToRgb(rgbStr)
        const heatColor = `rgba(${r}, ${g}, ${b}, ${chartOpacity})`
        cell.style.background =
          `linear-gradient(to right, ${heatColor} 100%, transparent 100%)`
      } else {
        // Bar mode
        let barColors = columnBarColors[c]
        if (isBarColormap && barColormapCycle) {
          const { min, max } = stats[c]
          const norm = min === max
            ? 0.5
            : Math.max(0, Math.min(1, (cv.value - min) / (max - min)))
          const interpolator = barColormapCycle[c % barColormapCycle.length]
          const rgbStr = interpolator(norm)
          const { r, g, b } = parseToRgb(rgbStr)
          const colorStr = `rgba(${r}, ${g}, ${b}, ${chartOpacity})`
          barColors = {
            pos: colorStr,
            posAccent: colorStr,
            neg: colorStr,
            negAccent: colorStr,
          }
        }
        cell.style.background = buildGradient(
          cv.value,
          stats[c],
          cv.isHighlighted,
          barColors,
        )
      }
    }
  }

  activeVisualizations.set(table, {
    parsed,
    originalStyles,
    active: true,
    mode: activeMode,
    compositeKey,
  })
}

/**
 * Remove inline cell-bar or heatmap visualization from a table.
 */
export function removeInlineBars(table: HTMLTableElement): void {
  const viz = activeVisualizations.get(table)
  if (!viz) return

  for (const [cell, original] of viz.originalStyles) {
    cell.style.background = original
  }

  activeVisualizations.delete(table)
}

/**
 * Toggle inline visualization mode on/off for a table.
 * Returns the currently active mode ('bars' | 'heatmap') or null if toggled off.
 */
export function toggleInlineBars(
  parsed: ParsedTable,
  table: HTMLTableElement,
  targetMode: 'bars' | 'heatmap' = 'bars',
  compositeKey?: string,
): 'bars' | 'heatmap' | null {
  const viz = activeVisualizations.get(table)
  if (viz && viz.active) {
    if (viz.mode === targetMode) {
      removeInlineBars(table)
      return null
    } else {
      removeInlineBars(table)
      applyInlineBars(parsed, table, targetMode, compositeKey)
      return targetMode
    }
  } else {
    applyInlineBars(parsed, table, targetMode, compositeKey)
    return targetMode
  }
}

/**
 * Get active visualization mode for a table if active.
 */
export function getActiveVisualizationMode(
  table: HTMLTableElement,
): 'bars' | 'heatmap' | null {
  const viz = activeVisualizations.get(table)
  return viz && viz.active ? viz.mode : null
}

/**
 * Re-render all active visualizations (e.g., after palette or mode change).
 */
export function updateAllVisualizations(): void {
  const entries = Array.from(activeVisualizations.entries())
  for (const [table, viz] of entries) {
    if (viz.active) {
      const mode = viz.mode
      const key = viz.compositeKey
      removeInlineBars(table)
      applyInlineBars(viz.parsed, table, mode, key)
    }
  }
}
