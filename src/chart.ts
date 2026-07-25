/**
 * Visualization — Phase 5: Inline Cell Bars
 *
 * Overlays horizontal bar backgrounds on numeric <td> cells, turning each
 * column into an in-place bar chart. Uses ParsedTable.domCells for direct
 * DOM manipulation.
 */

import { ParsedTable, CellValue } from './parser';
import { resolvePaletteColors, getSettings } from './settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnStats {
  min: number;
  max: number;
}

interface ActiveVisualization {
  parsed: ParsedTable;
  originalStyles: Map<HTMLTableCellElement, string>;
  active: boolean;
}

// Store active visualizations keyed by table element
const activeVisualizations = new Map<HTMLTableElement, ActiveVisualization>();

interface BarColors {
  pos: string;
  posAccent: string;
  neg: string;
  negAccent: string;
}

/**
 * Parse hex or rgb color string into { r, g, b } components.
 */
export function parseToRgb(colorStr: string): { r: number; g: number; b: number } {
  const hex = colorStr.trim();
  if (hex.startsWith('#')) {
    let clean = hex.slice(1);
    if (clean.length === 3) {
      clean = clean.split('').map((ch) => ch + ch).join('');
    }
    if (clean.length === 6) {
      const num = parseInt(clean, 16);
      return {
        r: (num >> 16) & 255,
        g: (num >> 8) & 255,
        b: num & 255,
      };
    }
  }
  const rgbMatch = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
    };
  }
  return { r: 76, g: 175, b: 80 };
}

// ---------------------------------------------------------------------------
// Core Rendering
// ---------------------------------------------------------------------------

/**
 * Compute per-column min/max statistics.
 */
function computeColumnStats(data: CellValue[][], numCols: number): ColumnStats[] {
  const stats: ColumnStats[] = [];
  for (let c = 0; c < numCols; c++) {
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < data.length; r++) {
      const v = data[r][c]?.value;
      if (v !== null && v !== undefined && isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    stats.push({ min, max });
  }
  return stats;
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
  const { min, max } = stats;

  // Constant column — full bar
  if (min === max) {
    const color = isHighlighted ? colors.posAccent : colors.pos;
    return `linear-gradient(to right, ${color} 100%, transparent 100%)`;
  }

  // Positive column (min >= 0)
  if (min >= 0) {
    const ratio = ((value - min) / (max - min)) * 100;
    const color = isHighlighted ? colors.posAccent : colors.pos;
    return `linear-gradient(to right, ${color} ${ratio}%, transparent ${ratio}%)`;
  }

  // Negative column (max <= 0)
  if (max <= 0) {
    const ratio = ((value - max) / (min - max)) * 100;
    const color = isHighlighted ? colors.negAccent : colors.neg;
    return `linear-gradient(to left, ${color} ${ratio}%, transparent ${ratio}%)`;
  }

  // Bipolar column (min < 0 and max > 0)
  const range = max - min;
  const zeroPct = ((0 - min) / range) * 100;
  const valPct = ((value - min) / range) * 100;

  if (value >= 0) {
    const color = isHighlighted ? colors.posAccent : colors.pos;
    return `linear-gradient(to right, transparent ${zeroPct}%, ${color} ${zeroPct}%, ${color} ${valPct}%, transparent ${valPct}%)`;
  } else {
    const color = isHighlighted ? colors.negAccent : colors.neg;
    return `linear-gradient(to right, transparent ${valPct}%, ${color} ${valPct}%, ${color} ${zeroPct}%, transparent ${zeroPct}%)`;
  }
}

/** Consistent bar overlay opacity (35%) optimized for text legibility in both light & dark modes */
export const BAR_OPACITY = 0.35;

/**
 * Apply inline cell-bar visualization to a parsed table.
 */
export function applyInlineBars(
  parsed: ParsedTable,
  table: HTMLTableElement,
): void {
  const { data, domCells } = parsed;
  if (data.length === 0) return;

  const numCols = data[0].length;
  const stats = computeColumnStats(data, numCols);

  const settings = getSettings();
  const paletteColors = resolvePaletteColors(settings.colorPalette);

  // Precompute per-column colors cycled from the active palette with consistent opacity
  const columnBarColors: BarColors[] = [];
  for (let c = 0; c < numCols; c++) {
    const baseColor = paletteColors[c % paletteColors.length];
    const { r, g, b } = parseToRgb(baseColor);
    const colorStr = `rgba(${r}, ${g}, ${b}, ${BAR_OPACITY})`;
    const negStr = `rgba(244, 67, 54, ${BAR_OPACITY})`;
    columnBarColors.push({
      pos: colorStr,
      posAccent: colorStr,
      neg: negStr,
      negAccent: negStr,
    });
  }

  // Save original styles for toggle-off restoration
  const originalStyles = new Map<HTMLTableCellElement, string>();

  for (let r = 0; r < data.length; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = domCells[r]?.[c];
      const cv = data[r][c];

      if (!cell || cv.value === null) continue;

      // Stats might be degenerate (no finite values found)
      if (!isFinite(stats[c].min) || !isFinite(stats[c].max)) continue;

      // Save original
      originalStyles.set(cell, cell.style.background || '');

      // Apply gradient using cycled palette colors for column c
      cell.style.background = buildGradient(cv.value, stats[c], cv.isHighlighted, columnBarColors[c]);
    }
  }

  activeVisualizations.set(table, {
    parsed,
    originalStyles,
    active: true,
  });
}

/**
 * Remove inline cell-bar visualization from a table.
 */
export function removeInlineBars(table: HTMLTableElement): void {
  const viz = activeVisualizations.get(table);
  if (!viz) return;

  for (const [cell, original] of viz.originalStyles) {
    cell.style.background = original;
  }

  activeVisualizations.delete(table);
}

/**
 * Toggle inline bars on/off for a table.
 * Returns true if bars are now visible.
 */
export function toggleInlineBars(
  parsed: ParsedTable,
  table: HTMLTableElement,
): boolean {
  const viz = activeVisualizations.get(table);
  if (viz && viz.active) {
    removeInlineBars(table);
    return false;
  } else {
    applyInlineBars(parsed, table);
    return true;
  }
}

/**
 * Re-render all active visualizations (e.g., after palette change).
 */
export function updateAllVisualizations(): void {
  for (const [table, viz] of activeVisualizations) {
    if (viz.active) {
      removeInlineBars(table);
      applyInlineBars(viz.parsed, table);
    }
  }
}
