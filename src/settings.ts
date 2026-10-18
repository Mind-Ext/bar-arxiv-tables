/**
 * Settings and state management for bar-arxiv-tables.
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

export type AutoVisualizeMode = 'off' | 'heatmap' | 'bars'
export type MetricAxisMode = 'auto' | 'column' | 'row'

export interface Settings {
  // Render Settings
  autoVisualize: AutoVisualizeMode
  buttonOpacity: number
  chartOpacity: number
  barColorScheme: string
  heatmapColorScheme: string
  divergingColorScheme: string
  metricAxis: MetricAxisMode

  // Parser Settings
  includeAllIntegerColumns: boolean

  // Site Scope & Whitelist
  urlWhitelist: string[]
}

export const DEFAULT_WHITELIST: string[] = [
  '*://arxiv.org/html/*',
  '*://ar5iv.labs.arxiv.org/html/*',
  'file:///*.html',
]

export const DEFAULT_SETTINGS: Settings = {
  autoVisualize: 'off',
  buttonOpacity: 0.5,
  chartOpacity: 0.35,
  barColorScheme: 'Pastel1',
  heatmapColorScheme: 'Cividis',
  divergingColorScheme: 'PuOr',
  metricAxis: 'auto',
  includeAllIntegerColumns: false,
  urlWhitelist: DEFAULT_WHITELIST,
}

/** Per-table local settings override entry. */
export interface LocalTableSetting {
  lastUsed: number // Timestamp (Date.now())
  settings: Partial<{
    barColorScheme: string
    heatmapColorScheme: string
    divergingColorScheme: string
    metricAxis: MetricAxisMode
  }>
}

/** Map of composite keys to local table settings. */
export type LocalSettingsMap = Record<string, LocalTableSetting>

/** Maximum number of per-table local overrides stored. */
export const LOCAL_SETTINGS_CAP = 1000

/** Perceptual & Single-hue Sequential D3 color scale interpolators */
export const PRESET_SEQUENTIAL_COLORMAPS: Record<
  string,
  (t: number) => string
> = {
  // Perceptual
  Cividis: interpolateCividis,
  Viridis: interpolateViridis,
  Plasma: interpolatePlasma,
  Inferno: interpolateInferno,
  Magma: interpolateMagma,
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
}

/** Diverging D3 color scale interpolators */
export const PRESET_DIVERGING_COLORMAPS: Record<
  string,
  (t: number) => string
> = {
  PuOr: interpolatePuOr,
  RdBu: interpolateRdBu,
  RdYlBu: interpolateRdYlBu,
  RdYlGn: interpolateRdYlGn,
  Spectral: interpolateSpectral,
  PiYG: interpolatePiYG,
  PRGn: interpolatePRGn,
  BrBG: interpolateBrBG,
  RdGy: interpolateRdGy,
}

/** Continuous D3 color scale interpolators (Sequential & Diverging) */
export const PRESET_COLORMAPS: Record<string, (t: number) => string> = {
  ...PRESET_SEQUENTIAL_COLORMAPS,
  ...PRESET_DIVERGING_COLORMAPS,
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
      const stored = localStorage.getItem(`bar_arxiv_tables_${key}`) ??
        localStorage.getItem(`arxiv_chart_${key}`)
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
      localStorage.setItem(`bar_arxiv_tables_${key}`, JSON.stringify(value))
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
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.clear()
    }
  } catch {
    // ignore
  }
}

/**
 * Retrieve current user settings.
 */
export function getSettings(): Settings {
  const rawAutoVis = getValue<unknown>(
    'autoVisualize',
    DEFAULT_SETTINGS.autoVisualize,
  )
  let autoVisualize: AutoVisualizeMode = 'off'
  if (rawAutoVis === true) {
    const legacyMode = getValue<'bars' | 'heatmap'>('renderMode', 'bars')
    autoVisualize = legacyMode === 'heatmap' ? 'heatmap' : 'bars'
  } else if (
    rawAutoVis === 'bars' ||
    rawAutoVis === 'heatmap' ||
    rawAutoVis === 'off'
  ) {
    autoVisualize = rawAutoVis
  } else {
    autoVisualize = 'off'
  }

  return {
    autoVisualize,
    buttonOpacity: getValue<number>(
      'buttonOpacity',
      DEFAULT_SETTINGS.buttonOpacity,
    ),
    chartOpacity: getValue<number>(
      'chartOpacity',
      DEFAULT_SETTINGS.chartOpacity,
    ),
    barColorScheme: getValue(
      'barColorScheme',
      getValue('colorPalette', DEFAULT_SETTINGS.barColorScheme),
    ),
    heatmapColorScheme: getValue(
      'heatmapColorScheme',
      getValue('colorMap', DEFAULT_SETTINGS.heatmapColorScheme),
    ),
    divergingColorScheme: getValue<string>(
      'divergingColorScheme',
      DEFAULT_SETTINGS.divergingColorScheme,
    ),
    metricAxis: getValue<MetricAxisMode>(
      'metricAxis',
      DEFAULT_SETTINGS.metricAxis,
    ),
    includeAllIntegerColumns: getValue<boolean>(
      'includeAllIntegerColumns',
      DEFAULT_SETTINGS.includeAllIntegerColumns,
    ),
    urlWhitelist: getValue<string[]>(
      'urlWhitelist',
      DEFAULT_SETTINGS.urlWhitelist,
    ),
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
  if (partial.buttonOpacity !== undefined) {
    setValue('buttonOpacity', updated.buttonOpacity)
  }
  if (partial.chartOpacity !== undefined) {
    setValue('chartOpacity', updated.chartOpacity)
  }
  if (partial.barColorScheme !== undefined) {
    setValue('barColorScheme', updated.barColorScheme)
  }
  if (partial.heatmapColorScheme !== undefined) {
    setValue('heatmapColorScheme', updated.heatmapColorScheme)
  }
  if (partial.divergingColorScheme !== undefined) {
    setValue('divergingColorScheme', updated.divergingColorScheme)
  }
  if (partial.metricAxis !== undefined) {
    setValue('metricAxis', updated.metricAxis)
  }
  if (partial.includeAllIntegerColumns !== undefined) {
    setValue('includeAllIntegerColumns', updated.includeAllIntegerColumns)
  }
  if (partial.urlWhitelist !== undefined) {
    setValue('urlWhitelist', updated.urlWhitelist)
  }

  notifyListeners(updated)
  return updated
}

// ---------------------------------------------------------------------------
// URL Whitelist & Scope Matching
// ---------------------------------------------------------------------------

/**
 * Compile a glob string into a RegExp.
 */
function globToRegExp(glob: string, anchored = true): RegExp | null {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  try {
    return new RegExp(anchored ? `^${escaped}$` : escaped, 'i')
  } catch {
    return null
  }
}

/**
 * Test if a URL matches a whitelist rule.
 *
 * Supported formats:
 * 1. Raw Regex: `/pattern/flags` (e.g. `/\/html\/\d{4}\.\d{4,5}/i`)
 * 2. Explicit Scheme Glob: contains `://` (e.g. `*://arxiv.org/html/*`, `file:///*.html`)
 * 3. Domain or Domain/Path: (e.g. `biorxiv.org`, `openreview.net/forum`, `*.nature.com`)
 *    - Validated via native URL parser against hostname and pathname boundaries.
 */
export function matchesRule(url: string, rule: string): boolean {
  const trimmed = rule.trim()
  if (!trimmed || trimmed.startsWith('#')) return false // ignore comments & blank lines

  // 1. Raw Regex: /pattern/flags
  const regexMatch = trimmed.match(/^\/(.+)\/([a-z]*)$/i)
  if (regexMatch) {
    try {
      return new RegExp(regexMatch[1], regexMatch[2] || 'i').test(url)
    } catch {
      return false
    }
  }

  // 2. Explicit Scheme Glob: contains :// (e.g. *://arxiv.org/*, file:///*.html)
  if (trimmed.includes('://')) {
    return globToRegExp(trimmed, true)?.test(url) ?? false
  }

  // 3. Domain or Domain/Path mode via native URL parser
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()

    const firstSlash = trimmed.indexOf('/')
    const ruleDomain = (
      firstSlash !== -1 ? trimmed.slice(0, firstSlash) : trimmed
    ).toLowerCase()
    const rulePath = firstSlash !== -1 ? trimmed.slice(firstSlash) : ''

    const hostMatches = ruleDomain.includes('*') || ruleDomain.includes('?')
      ? (globToRegExp(ruleDomain)?.test(host) ?? false)
      : (host === ruleDomain || host.endsWith(`.${ruleDomain}`))

    if (!hostMatches) return false

    if (rulePath) {
      if (rulePath.includes('*') || rulePath.includes('?')) {
        const re = globToRegExp(
          rulePath.endsWith('*') ? rulePath : `${rulePath}*`,
          true,
        )
        return re?.test(parsed.pathname) ?? false
      }
      return parsed.pathname.toLowerCase().startsWith(rulePath.toLowerCase())
    }

    return true
  } catch {
    return globToRegExp(trimmed, false)?.test(url) ?? false
  }
}

/**
 * Check whether a URL matches any rule in the whitelist.
 */
export function isUrlAllowed(url: string, whitelist: string[]): boolean {
  return whitelist.some((rule) => matchesRule(url, rule))
}

/**
 * Helper to add a domain or rule to the whitelist if not already present.
 */
export function addRuleToWhitelist(rule: string): Settings {
  const current = getSettings()
  const trimmed = rule.trim()
  if (!trimmed || current.urlWhitelist.includes(trimmed)) {
    return current
  }
  return updateSettings({ urlWhitelist: [...current.urlWhitelist, trimmed] })
}

/**
 * Helper to remove a domain or rule from the whitelist.
 */
export function removeRuleFromWhitelist(rule: string): Settings {
  const current = getSettings()
  const trimmed = rule.trim()
  const updated = current.urlWhitelist.filter((r) => r.trim() !== trimmed)
  return updateSettings({ urlWhitelist: updated })
}

/**
 * Check if the current page (window.location.href) is whitelisted.
 */
export function isCurrentPageWhitelisted(): boolean {
  if (typeof window === 'undefined') return false
  return isUrlAllowed(window.location.href, getSettings().urlWhitelist)
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
      console.error('[bar-arxiv-tables] Error in settings change listener:', e)
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

// ---------------------------------------------------------------------------
// Composite Key & Local Table Settings (LRU-Capped)
// ---------------------------------------------------------------------------

/**
 * Build a composite key for per-table settings: `${paperId}#${tableId}`.
 * Extracts paper ID from `window.location.pathname`, retaining version suffix.
 */
export function getTableCompositeKey(tableId: string): string {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  const m = /\/(?:html|abs|pdf)\/([^/]+)/.exec(path)
  const paperId = m ? m[1] : path
  return `${paperId}#${tableId}`
}

/**
 * Read the local settings map from storage.
 */
export function getLocalTableSettings(
  compositeKey: string,
): LocalTableSetting | undefined {
  const map = getValue<LocalSettingsMap>('localTableSettings', {})
  const entry = map[compositeKey]
  if (!entry) return undefined
  // Bump lastUsed on read
  entry.lastUsed = Date.now()
  setValue('localTableSettings', map)
  return entry
}

/**
 * Write a local settings override, with LRU eviction when cap is exceeded.
 */
export function setLocalTableSettings(
  compositeKey: string,
  settings: LocalTableSetting['settings'],
): void {
  const map = getValue<LocalSettingsMap>('localTableSettings', {})
  map[compositeKey] = { lastUsed: Date.now(), settings }

  // LRU eviction
  const keys = Object.keys(map)
  if (keys.length > LOCAL_SETTINGS_CAP) {
    const sorted = keys.sort(
      (a, b) => (map[a].lastUsed ?? 0) - (map[b].lastUsed ?? 0),
    )
    const evictCount = keys.length - LOCAL_SETTINGS_CAP
    for (let i = 0; i < evictCount; i++) {
      delete map[sorted[i]]
    }
  }

  setValue('localTableSettings', map)
}

/**
 * Clear local override for a specific table, or all local overrides.
 */
export function clearLocalTableSettings(compositeKey?: string): void {
  if (compositeKey) {
    const map = getValue<LocalSettingsMap>('localTableSettings', {})
    delete map[compositeKey]
    setValue('localTableSettings', map)
  } else {
    setValue('localTableSettings', {})
  }
}

/**
 * Resolve effective settings for a table by merging local overrides onto
 * global defaults. If no compositeKey or no local override exists, returns
 * global settings unmodified.
 */
export function getEffectiveSettings(compositeKey?: string): Settings {
  const global = getSettings()
  if (!compositeKey) return global

  const map = getValue<LocalSettingsMap>('localTableSettings', {})
  const entry = map[compositeKey]
  if (!entry) return global

  const merged = { ...global }
  if (entry.settings.barColorScheme !== undefined) {
    merged.barColorScheme = entry.settings.barColorScheme
  }
  if (entry.settings.heatmapColorScheme !== undefined) {
    merged.heatmapColorScheme = entry.settings.heatmapColorScheme
  }
  if (entry.settings.divergingColorScheme !== undefined) {
    merged.divergingColorScheme = entry.settings.divergingColorScheme
  }
  if (entry.settings.metricAxis !== undefined) {
    merged.metricAxis = entry.settings.metricAxis
  }
  return merged
}
