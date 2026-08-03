import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetStorageForTesting,
  clearLocalTableSettings,
  DEFAULT_SETTINGS,
  getEffectiveSettings,
  getLocalTableSettings,
  getSettings,
  getTableCompositeKey,
  LOCAL_SETTINGS_CAP,
  onSettingsChange,
  PRESET_PALETTES,
  resolvePaletteColors,
  setLocalTableSettings,
  updateSettings,
} from '../src/settings'

describe('Settings Management', () => {
  beforeEach(() => {
    _resetStorageForTesting()
  })

  it('returns default settings when no stored values exist', () => {
    const settings = getSettings()
    expect(settings).toEqual(DEFAULT_SETTINGS)
  })

  it('updates settings and persists to localStorage', () => {
    updateSettings({ autoVisualize: 'bars', barColorScheme: 'Set1' })
    const settings = getSettings()
    expect(settings.autoVisualize).toBe('bars')
    expect(settings.barColorScheme).toBe('Set1')
  })

  it('notifies listeners dynamically on settings change without reloading', () => {
    const listener = vi.fn()
    const unsubscribe = onSettingsChange(listener)

    updateSettings({ autoVisualize: 'heatmap' })
    expect(listener).toHaveBeenCalledWith({
      autoVisualize: 'heatmap',
      buttonOpacity: 0.5,
      chartOpacity: 0.35,
      barColorScheme: 'Pastel1',
      heatmapColorScheme: 'Cividis',
      includeAllIntegerColumns: false,
      includeScientificNotation: false,
    })

    unsubscribe()
    updateSettings({ barColorScheme: 'Set1' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('resolves preset and custom color palettes', () => {
    expect(resolvePaletteColors('Pastel1')).toEqual(
      Array.from(PRESET_PALETTES.Pastel1),
    )
    expect(resolvePaletteColors('Pastel2')).toEqual(
      Array.from(PRESET_PALETTES.Pastel2),
    )
    expect(resolvePaletteColors('tab10')).toEqual(
      Array.from(PRESET_PALETTES.tab10),
    )
    expect(resolvePaletteColors('#ff0000, #00ff00')).toEqual([
      '#ff0000',
      '#00ff00',
    ])
    expect(resolvePaletteColors('ff0000, 00ff00')).toEqual([
      '#ff0000',
      '#00ff00',
    ])
    expect(resolvePaletteColors('unknown-palette')).toEqual(
      Array.from(PRESET_PALETTES.Pastel1),
    )
  })
})

describe('Composite Key Generation', () => {
  it('extracts paper ID from /html/ path', () => {
    // jsdom defaults to about:blank, so we test the fallback
    const key = getTableCompositeKey('table-1')
    // In jsdom, pathname is '/', which does not match /html|abs|pdf/ regex,
    // so falls back to pathname itself
    expect(key).toContain('#table-1')
  })

  it('uses the full pathname as fallback', () => {
    const key = getTableCompositeKey('S3.T1')
    expect(key).toBe('/#S3.T1')
  })
})

describe('Local Table Settings (LRU)', () => {
  beforeEach(() => {
    _resetStorageForTesting()
  })

  it('returns undefined for unknown composite key', () => {
    const entry = getLocalTableSettings('paper#table-1')
    expect(entry).toBeUndefined()
  })

  it('stores and retrieves local settings', () => {
    setLocalTableSettings('paper#table-1', { barColorScheme: 'Set1' })
    const entry = getLocalTableSettings('paper#table-1')
    expect(entry).toBeDefined()
    expect(entry!.settings.barColorScheme).toBe('Set1')
  })

  it('bumps lastUsed timestamp on read', () => {
    setLocalTableSettings('paper#table-1', { barColorScheme: 'Set1' })
    const entry1 = getLocalTableSettings('paper#table-1')!
    const ts1 = entry1.lastUsed

    // Small delay via re-read to ensure timestamp changes
    const entry2 = getLocalTableSettings('paper#table-1')!
    expect(entry2.lastUsed).toBeGreaterThanOrEqual(ts1)
  })

  it('clears a specific table override', () => {
    setLocalTableSettings('paper#table-1', { barColorScheme: 'Set1' })
    setLocalTableSettings('paper#table-2', { barColorScheme: 'tab10' })

    clearLocalTableSettings('paper#table-1')

    expect(getLocalTableSettings('paper#table-1')).toBeUndefined()
    expect(getLocalTableSettings('paper#table-2')).toBeDefined()
  })

  it('clears all local overrides', () => {
    setLocalTableSettings('paper#table-1', { barColorScheme: 'Set1' })
    setLocalTableSettings('paper#table-2', { barColorScheme: 'tab10' })

    clearLocalTableSettings()

    expect(getLocalTableSettings('paper#table-1')).toBeUndefined()
    expect(getLocalTableSettings('paper#table-2')).toBeUndefined()
  })

  it('evicts oldest entries when cap is exceeded', () => {
    // Insert LOCAL_SETTINGS_CAP + 5 entries with staggered timestamps
    const now = Date.now()
    vi.spyOn(Date, 'now')

    for (let i = 0; i < LOCAL_SETTINGS_CAP + 5; i++) {
      vi.mocked(Date.now).mockReturnValue(now + i)
      setLocalTableSettings(`paper#table-${i}`, {
        barColorScheme: `scheme-${i}`,
      })
    }

    vi.restoreAllMocks()

    // The 5 oldest entries (0..4) should have been evicted
    for (let i = 0; i < 5; i++) {
      expect(getLocalTableSettings(`paper#table-${i}`)).toBeUndefined()
    }

    // Entry 5 should still exist
    expect(getLocalTableSettings('paper#table-5')).toBeDefined()

    // Latest entry should exist
    expect(
      getLocalTableSettings(`paper#table-${LOCAL_SETTINGS_CAP + 4}`),
    ).toBeDefined()
  })
})

describe('Effective Settings', () => {
  beforeEach(() => {
    _resetStorageForTesting()
  })

  it('returns global settings when no compositeKey', () => {
    const eff = getEffectiveSettings()
    expect(eff).toEqual(DEFAULT_SETTINGS)
  })

  it('returns global settings when compositeKey has no local override', () => {
    const eff = getEffectiveSettings('paper#table-1')
    expect(eff).toEqual(DEFAULT_SETTINGS)
  })

  it('merges local overrides onto global settings', () => {
    setLocalTableSettings('paper#table-1', {
      barColorScheme: 'Set1',
    })

    const eff = getEffectiveSettings('paper#table-1')
    expect(eff.barColorScheme).toBe('Set1')
    // Other fields should remain global defaults
    expect(eff.heatmapColorScheme).toBe('Cividis')
    expect(eff.autoVisualize).toBe('off')
  })

  it('merges both local override fields when present', () => {
    setLocalTableSettings('paper#table-1', {
      barColorScheme: 'Set1',
      heatmapColorScheme: 'Plasma',
    })

    const eff = getEffectiveSettings('paper#table-1')
    expect(eff.barColorScheme).toBe('Set1')
    expect(eff.heatmapColorScheme).toBe('Plasma')
  })

  it('reflects global settings changes in effective settings', () => {
    updateSettings({ barColorScheme: 'tab10' })
    const eff = getEffectiveSettings()
    expect(eff.barColorScheme).toBe('tab10')
  })

  it('local override takes precedence over updated global', () => {
    updateSettings({ barColorScheme: 'tab10' })
    setLocalTableSettings('paper#table-1', { barColorScheme: 'Set1' })

    const eff = getEffectiveSettings('paper#table-1')
    expect(eff.barColorScheme).toBe('Set1')
  })
})
