import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetStorageForTesting,
  DEFAULT_SETTINGS,
  getSettings,
  onSettingsChange,
  PRESET_PALETTES,
  resolvePaletteColors,
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
    updateSettings({ autoVisualize: true, barColorScheme: 'Set1' })
    const settings = getSettings()
    expect(settings.autoVisualize).toBe(true)
    expect(settings.barColorScheme).toBe('Set1')
  })

  it('notifies listeners dynamically on settings change without reloading', () => {
    const listener = vi.fn()
    const unsubscribe = onSettingsChange(listener)

    updateSettings({ autoVisualize: true })
    expect(listener).toHaveBeenCalledWith({
      autoVisualize: true,
      barColorScheme: 'Pastel1',
      heatmapColorScheme: 'Cividis',
      renderMode: 'bars',
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
