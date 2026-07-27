/**
 * Settings and state management for arXiv Chart Visualizer.
 * Supports persistent storage via GM_getValue/GM_setValue with fallback to localStorage.
 * Notifies subscribers immediately on change without page reloads.
 */

import {
  interpolateBlues,
  interpolateBrBG,
  interpolateCividis,
  interpolateCool,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePRGn,
  interpolatePuOr,
  interpolatePurples,
  interpolateRdBu,
  interpolateRdGy,
  interpolateRdYlBu,
  interpolateRdYlGn,
  interpolateReds,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
  schemeAccent,
  schemeCategory10,
  schemeDark2,
  schemeObservable10,
  schemePaired,
  schemePastel1,
  schemePastel2,
  schemeSet1,
  schemeSet2,
  schemeSet3,
  schemeTableau10,
} from 'd3-scale-chromatic'

export interface Settings {
  autoVisualize: boolean
  barColorScheme: string
  heatmapColorScheme: string
  renderMode: 'bars' | 'heatmap'
}

export const DEFAULT_SETTINGS: Settings = {
  autoVisualize: false,
  barColorScheme: 'Pastel1',
  heatmapColorScheme: 'Cividis',
  renderMode: 'bars',
}

/** Continuous D3 color scale interpolators (Sequential & Diverging) */
export const PRESET_COLORMAPS: Record<string, (t: number) => string> = {
  // Perceptual
  Viridis: interpolateViridis,
  Plasma: interpolatePlasma,
  Inferno: interpolateInferno,
  Magma: interpolateMagma,
  Cividis: interpolateCividis,
  Turbo: interpolateTurbo,
  Warm: interpolateWarm,
  Cool: interpolateCool,

  // Single-hue Sequential
  Blues: interpolateBlues,
  Greens: interpolateGreens,
  Greys: interpolateGreys,
  Oranges: interpolateOranges,
  Purples: interpolatePurples,
  Reds: interpolateReds,

  // Diverging
  Spectral: interpolateSpectral,
  RdYlBu: interpolateRdYlBu,
  RdYlGn: interpolateRdYlGn,
  RdBu: interpolateRdBu,
  RdGy: interpolateRdGy,
  PiYG: interpolatePiYG,
  PRGn: interpolatePRGn,
  PuOr: interpolatePuOr,
  BrBG: interpolateBrBG,
}

/** Categorical D3 color schemes */
export const PRESET_PALETTES: Record<string, readonly string[]> = {
  Pastel1: schemePastel1,
  Pastel2: schemePastel2,
  Set1: schemeSet1,
  Set2: schemeSet2,
  Set3: schemeSet3,
  tab10: schemeCategory10,
  Tableau10: schemeTableau10,
  Observable10: schemeObservable10,
  Paired: schemePaired,
  Dark2: schemeDark2,
  Accent: schemeAccent,
}
type SettingsChangeListener = (settings: Settings) => void
const listeners: SettingsChangeListener[] = []

const memoryStore = new Map<string, any>()

/**
 * Safely retrieve a setting value using GM_getValue or localStorage / memoryStore fallback.
 */
function getValue<T>(key: string, defaultValue: T): T {
  try {
    if (typeof GM_getValue !== 'undefined') {
      return GM_getValue(key, defaultValue)
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      const stored = localStorage.getItem(`arxiv_chart_${key}`)
      if (stored !== null) {
        return JSON.parse(stored)
      }
    }
  } catch (e) {
    // Fall through to memoryStore
  }
  return memoryStore.has(key) ? memoryStore.get(key) : defaultValue
}

/**
 * Safely store a setting value using GM_setValue or localStorage / memoryStore fallback.
 */
function setValue<T>(key: string, value: T): void {
  try {
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(key, value)
      return
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(`arxiv_chart_${key}`, JSON.stringify(value))
      return
    }
  } catch (e) {
    // Fall through to memoryStore
  }
  memoryStore.set(key, value)
}

/**
 * Clear in-memory storage (for testing).
 */
export function _resetStorageForTesting(): void {
  memoryStore.clear()
}

/**
 * Retrieve current user settings.
 */
export function getSettings(): Settings {
  return {
    autoVisualize: getValue('autoVisualize', DEFAULT_SETTINGS.autoVisualize),
    barColorScheme: getValue(
      'barColorScheme',
      getValue('colorPalette', DEFAULT_SETTINGS.barColorScheme),
    ),
    heatmapColorScheme: getValue(
      'heatmapColorScheme',
      getValue('colorMap', DEFAULT_SETTINGS.heatmapColorScheme),
    ),
    renderMode: getValue('renderMode', DEFAULT_SETTINGS.renderMode),
  }
}

/**
 * Update user settings and notify subscribers immediately in-place.
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings()
  const updated: Settings = { ...current, ...partial }

  if (partial.autoVisualize !== undefined) {
    setValue('autoVisualize', updated.autoVisualize)
  }
  if (partial.barColorScheme !== undefined) {
    setValue('barColorScheme', updated.barColorScheme)
  }
  if (partial.heatmapColorScheme !== undefined) {
    setValue('heatmapColorScheme', updated.heatmapColorScheme)
  }
  if (partial.renderMode !== undefined) {
    setValue('renderMode', updated.renderMode)
  }

  notifyListeners(updated)
  return updated
}

/**
 * Subscribe to settings changes.
 */
export function onSettingsChange(listener: SettingsChangeListener): () => void {
  listeners.push(listener)
  return () => {
    const idx = listeners.indexOf(listener)
    if (idx !== -1) {
      listeners.splice(idx, 1)
    }
  }
}

function notifyListeners(settings: Settings): void {
  for (const listener of listeners) {
    try {
      listener(settings)
    } catch (e) {
      console.error('[arXiv-Charts] Error in settings change listener:', e)
    }
  }
}

/**
 * Parse palette name or custom hex string into array of CSS color strings.
 */
export function resolvePaletteColors(paletteSetting: string): string[] {
  if (PRESET_PALETTES[paletteSetting]) {
    return Array.from(PRESET_PALETTES[paletteSetting])
  }
  const customColors = paletteSetting
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^#?([0-9a-fA-F]{3,8})$|^rgba?\(|^hsla?\(/i.test(c))
    .map((c) => (/^[0-9a-fA-F]{3,8}$/i.test(c) ? `#${c}` : c))
  return customColors.length > 0
    ? customColors
    : Array.from(PRESET_PALETTES.Pastel1)
}

/**
 * Resolve comma-separated palettes for cycling across columns in bars mode.
 */
export function resolvePaletteCycle(setting: string): string[][] {
  const parts = setting.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return [resolvePaletteColors('Pastel1')]

  const isAllHex = parts.every((p) =>
    /^#?([0-9a-fA-F]{3,8})$|^rgba?\(|^hsla?\(/i.test(p)
  )
  if (isAllHex) {
    return [parts.map((c) => (/^[0-9a-fA-F]{3,8}$/i.test(c) ? `#${c}` : c))]
  }

  return parts.map((p) => resolvePaletteColors(p))
}

/**
 * Check if a setting string represents continuous colormap(s).
 */
export function isColormap(setting: string): boolean {
  const parts = setting.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 && parts.every((p) => Boolean(PRESET_COLORMAPS[p]))
}

/**
 * Resolve comma-separated colormap functions for cycling across columns in heatmap mode.
 */
export function resolveColormapCycle(
  setting: string,
): ((t: number) => string)[] {
  const parts = setting.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return [interpolateViridis]
  return parts.map((name) => PRESET_COLORMAPS[name] || interpolateViridis)
}

/**
 * Register Tampermonkey / Violentmonkey menu commands if available.
 * Changing settings updates state in-place without page reload.
 */
export function initMenuCommands(): void {
  if (typeof GM_registerMenuCommand === 'undefined') {
    return
  }

  const settings = getSettings()
  const autoVisLabel = `Toggle Auto-Visualize (${
    settings.autoVisualize ? 'ON' : 'OFF'
  })`
  const paletteLabel = `Bar Color Scheme (Current: ${settings.barColorScheme})`
  const mapLabel =
    `Heatmap Color Scheme (Current: ${settings.heatmapColorScheme})`
  const modeLabel = `Render Mode (Current: ${settings.renderMode})`

  GM_registerMenuCommand(autoVisLabel, () => {
    const current = getSettings()
    const nextAutoVis = !current.autoVisualize
    updateSettings({ autoVisualize: nextAutoVis })
    console.log(`[arXiv-Charts] Auto-visualize toggled to ${nextAutoVis}`)
  })

  GM_registerMenuCommand(paletteLabel, () => {
    const current = getSettings()
    const presets = Object.keys(PRESET_PALETTES)
    const currentIndex = presets.indexOf(current.barColorScheme)
    const nextPalette = presets[(currentIndex + 1) % presets.length]
    updateSettings({ barColorScheme: nextPalette })
    console.log(`[arXiv-Charts] Bar color scheme changed to ${nextPalette}`)
  })

  GM_registerMenuCommand(mapLabel, () => {
    const current = getSettings()
    const maps = Object.keys(PRESET_COLORMAPS)
    const currentIndex = maps.indexOf(current.heatmapColorScheme)
    const nextMap = maps[(currentIndex + 1) % maps.length]
    updateSettings({ heatmapColorScheme: nextMap })
    console.log(`[arXiv-Charts] Heatmap color scheme changed to ${nextMap}`)
  })

  GM_registerMenuCommand(modeLabel, () => {
    const current = getSettings()
    const nextMode = current.renderMode === 'bars' ? 'heatmap' : 'bars'
    updateSettings({ renderMode: nextMode })
    console.log(`[arXiv-Charts] Render mode changed to ${nextMode}`)
  })
}
