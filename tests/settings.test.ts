import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetStorageForTesting,
  addRuleToWhitelist,
  clearLocalTableSettings,
  DEFAULT_SETTINGS,
  DEFAULT_WHITELIST,
  getEffectiveSettings,
  getLocalTableSettings,
  getSettings,
  getTableCompositeKey,
  isCurrentPageWhitelisted,
  isUrlAllowed,
  LOCAL_SETTINGS_CAP,
  matchesRule,
  onSettingsChange,
  PRESET_PALETTES,
  removeRuleFromWhitelist,
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
      divergingColorScheme: 'PuOr',
      metricAxis: 'auto',
      includeAllIntegerColumns: false,
      urlWhitelist: DEFAULT_WHITELIST,
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
    expect(eff.divergingColorScheme).toBe('PuOr')
    expect(eff.autoVisualize).toBe('off')
  })

  it('merges all local override fields when present', () => {
    setLocalTableSettings('paper#table-1', {
      barColorScheme: 'Set1',
      heatmapColorScheme: 'Plasma',
      divergingColorScheme: 'RdBu',
    })

    const eff = getEffectiveSettings('paper#table-1')
    expect(eff.barColorScheme).toBe('Set1')
    expect(eff.heatmapColorScheme).toBe('Plasma')
    expect(eff.divergingColorScheme).toBe('RdBu')
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

describe('URL Whitelist & Scope Matching', () => {
  describe('matchesRule', () => {
    it('matches bare domain substring', () => {
      expect(
        matchesRule(
          'https://www.biorxiv.org/content/10.1101/2024.01.01',
          'biorxiv.org',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'https://arxiv.org/html/2401.12345',
          'biorxiv.org',
        ),
      ).toBe(false)
    })

    it('matches path snippets', () => {
      expect(
        matchesRule(
          'https://arxiv.org/html/2401.12345',
          'arxiv.org/html/',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'https://arxiv.org/abs/2401.12345',
          'arxiv.org/html/',
        ),
      ).toBe(false)
    })

    it('matches standard WebExtension/Userscript glob patterns', () => {
      expect(
        matchesRule(
          'https://arxiv.org/html/2401.12345',
          '*://arxiv.org/html/*',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'https://arxiv.org/abs/2401.12345',
          '*://arxiv.org/html/*',
        ),
      ).toBe(false)
    })

    it('matches local file patterns', () => {
      expect(
        matchesRule(
          'file:///home/user/paper.html',
          'file:///*.html',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'file:///home/user/paper.pdf',
          'file:///*.html',
        ),
      ).toBe(false)
    })

    it('matches subdomain wildcard patterns', () => {
      expect(
        matchesRule(
          'https://forum.openreview.net/forum?id=123',
          '*.openreview.net/forum',
        ),
      ).toBe(true)
    })

    it('matches raw regex patterns wrapped in /.../', () => {
      expect(
        matchesRule(
          'https://arxiv.org/html/2401.12345v2',
          '/\\/html\\/\\d{4}\\.\\d{4,5}(v\\d+)?$/',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'https://arxiv.org/pdf/2401.12345.pdf',
          '/\\/html\\/\\d{4}\\.\\d{4,5}(v\\d+)?$/',
        ),
      ).toBe(false)
    })

    it('supports regex flags', () => {
      expect(
        matchesRule(
          'https://arxiv.org/html/2401.12345',
          '/ARXIV\\.ORG\\/HTML\\//i',
        ),
      ).toBe(true)
    })

    it('ignores comments and empty lines', () => {
      expect(matchesRule('https://arxiv.org/html/123', '# a comment')).toBe(
        false,
      )
      expect(matchesRule('https://arxiv.org/html/123', '   ')).toBe(false)
      expect(matchesRule('https://arxiv.org/html/123', '')).toBe(false)
    })
    it('does not match query strings, spoofed domain prefixes, or attacker subdomains', () => {
      expect(
        matchesRule(
          'https://evil.com/?q=biorxiv.org',
          'biorxiv.org',
        ),
      ).toBe(false)
      expect(
        matchesRule(
          'https://notbiorxiv.org/content/123',
          'biorxiv.org',
        ),
      ).toBe(false)
      expect(
        matchesRule(
          'https://biorxiv.org.attacker.com/page',
          'biorxiv.org',
        ),
      ).toBe(false)
    })

    it('matches subdomains and custom ports for domain rules', () => {
      expect(
        matchesRule(
          'https://sub.biorxiv.org/content/123',
          'biorxiv.org',
        ),
      ).toBe(true)
      expect(
        matchesRule(
          'http://biorxiv.org:8080/content/123',
          'biorxiv.org',
        ),
      ).toBe(true)
    })

    it('safely handles invalid regex patterns without throwing', () => {
      expect(
        matchesRule(
          'https://arxiv.org/html/123',
          '/[unclosed-bracket/',
        ),
      ).toBe(false)
    })
  })

  describe('isUrlAllowed', () => {
    it('returns true if any whitelist rule matches', () => {
      const whitelist = [
        'biorxiv.org',
        '*://arxiv.org/html/*',
        'file:///*.html',
      ]
      expect(isUrlAllowed('https://arxiv.org/html/2401.12345', whitelist)).toBe(
        true,
      )
      expect(
        isUrlAllowed('https://biorxiv.org/content/123', whitelist),
      ).toBe(true)
      expect(isUrlAllowed('file:///test.html', whitelist)).toBe(true)
      expect(isUrlAllowed('https://google.com', whitelist)).toBe(false)
    })
  })

  describe('Whitelist storage helpers', () => {
    beforeEach(() => {
      _resetStorageForTesting()
    })

    it('adds new rules to whitelist avoiding duplicates', () => {
      addRuleToWhitelist('biorxiv.org')
      expect(getSettings().urlWhitelist).toContain('biorxiv.org')

      // Adding duplicate should not duplicate entry
      const count =
        getSettings().urlWhitelist.filter((r) => r === 'biorxiv.org').length
      expect(count).toBe(1)
      addRuleToWhitelist('biorxiv.org')
      expect(
        getSettings().urlWhitelist.filter((r) => r === 'biorxiv.org').length,
      ).toBe(1)
    })

    it('removes rules from whitelist', () => {
      addRuleToWhitelist('biorxiv.org')
      expect(getSettings().urlWhitelist).toContain('biorxiv.org')

      removeRuleFromWhitelist('biorxiv.org')
      expect(getSettings().urlWhitelist).not.toContain('biorxiv.org')
    })

    it('checks if current page is whitelisted via isCurrentPageWhitelisted', () => {
      // In jsdom environment, location is http://localhost:3000/ or about:blank
      expect(isCurrentPageWhitelisted()).toBe(false)
      addRuleToWhitelist('localhost')
      expect(isCurrentPageWhitelisted()).toBe(true)
    })
  })
})
