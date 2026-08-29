import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetStorageForTesting,
  DEFAULT_SETTINGS,
  DEFAULT_WHITELIST,
  getLocalTableSettings,
  getSettings,
  setLocalTableSettings,
  updateSettings,
} from '../src/settings'
import { toggleSettingsPopover } from '../src/ui/settingsPopover'

// ---------------------------------------------------------------------------
// Helpers — popover now lives on document.body, not inside the anchor
// ---------------------------------------------------------------------------

function createAnchor(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'b-a-t-actions'
  document.body.appendChild(el)
  return el
}

function getPopover(): HTMLElement | null {
  return document.querySelector('.b-a-t-settings-popover')
}

function clickAction(action: string): void {
  const popover = getPopover()!
  const btn = popover.querySelector(
    `[data-action="${action}"]`,
  ) as HTMLElement
  expect(btn, `button with data-action="${action}" not found`).not.toBeNull()
  btn.click()
}

function clickTab(tab: string): void {
  const popover = getPopover()!
  const el = popover.querySelector(`[data-tab="${tab}"]`) as HTMLElement
  expect(el, `tab "${tab}" not found`).not.toBeNull()
  el.click()
}

function getSelect(name: string): HTMLSelectElement {
  const popover = getPopover()!
  return popover.querySelector(`select[name="${name}"]`) as HTMLSelectElement
}

function getCustomInput(name: string): HTMLInputElement {
  const popover = getPopover()!
  return popover.querySelector(
    `[data-custom-input="${name}"]`,
  ) as HTMLInputElement
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Settings Popover UI', () => {
  let anchor: HTMLElement
  let onUpdate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    _resetStorageForTesting()
    document.body.innerHTML = ''
    anchor = createAnchor()
    onUpdate = vi.fn()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  // -----------------------------------------------------------------------
  // Open / Close
  // -----------------------------------------------------------------------

  describe('open and close', () => {
    it('opens a popover on first toggle', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      expect(getPopover()).not.toBeNull()
    })

    it('closes the popover on second toggle of the same anchor', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      expect(getPopover()).not.toBeNull()

      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      expect(getPopover()).toBeNull()
    })

    it('enforces single instance — opening a new anchor closes the old one', () => {
      const anchor2 = createAnchor()

      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      expect(getPopover()).not.toBeNull()

      toggleSettingsPopover(anchor2, 'paper#t2', onUpdate)
      // Only one popover should exist
      const popovers = document.querySelectorAll('.b-a-t-settings-popover')
      expect(popovers.length).toBe(1)
    })

    it('closes on [X] close button click', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickAction('close')
      expect(getPopover()).toBeNull()
    })

    it('closes on Escape key', () => {
      vi.useFakeTimers()
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      expect(getPopover()).not.toBeNull()

      // Escape handler is deferred via setTimeout(…, 0),
      // so flush timers first
      vi.runAllTimers()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(getPopover()).toBeNull()
      vi.useRealTimers()
    })
  })

  // -----------------------------------------------------------------------
  // Tab Switching
  // -----------------------------------------------------------------------

  describe('tab switching', () => {
    it('starts on the Local tab', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const popover = getPopover()!
      const localTab = popover.querySelector('[data-tab="local"]')!
      const globalTab = popover.querySelector('[data-tab="global"]')!
      const localPanel = popover.querySelector(
        '[data-panel="local"]',
      ) as HTMLElement
      const globalPanel = popover.querySelector(
        '[data-panel="global"]',
      ) as HTMLElement

      expect(localTab.classList.contains('active')).toBe(true)
      expect(globalTab.classList.contains('active')).toBe(false)
      expect(localPanel.classList.contains('active')).toBe(true)
      expect(globalPanel.classList.contains('active')).toBe(false)
    })

    it('switches to Global tab on click', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      const popover = getPopover()!
      const localTab = popover.querySelector('[data-tab="local"]')!
      const globalTab = popover.querySelector('[data-tab="global"]')!
      const localPanel = popover.querySelector(
        '[data-panel="local"]',
      ) as HTMLElement
      const globalPanel = popover.querySelector(
        '[data-panel="global"]',
      ) as HTMLElement

      expect(localTab.classList.contains('active')).toBe(false)
      expect(globalTab.classList.contains('active')).toBe(true)
      expect(localPanel.classList.contains('active')).toBe(false)
      expect(globalPanel.classList.contains('active')).toBe(true)
    })

    it('switches back to Local tab', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')
      clickTab('local')

      const popover = getPopover()!
      const localTab = popover.querySelector('[data-tab="local"]')!
      expect(localTab.classList.contains('active')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Status Badge
  // -----------------------------------------------------------------------

  describe('status badge', () => {
    it('shows "Using Global Defaults" when no local override', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const badge = getPopover()!.querySelector('#local-status-badge')!
      expect(badge.textContent).toBe('Using Global Defaults')
      expect(badge.classList.contains('b-a-t-badge-global')).toBe(true)
    })

    it('shows "Custom Override Active" when local override exists', () => {
      setLocalTableSettings('paper#t1', { barColorScheme: 'Set1' })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const badge = getPopover()!.querySelector('#local-status-badge')!
      expect(badge.textContent).toBe('Custom Override Active')
      expect(badge.classList.contains('b-a-t-badge-custom')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Form Field Population
  // -----------------------------------------------------------------------

  describe('form population', () => {
    it('populates local tab with global defaults when no local override', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const barSel = getSelect('local-barColorScheme')
      const heatSel = getSelect('local-heatmapColorScheme')
      const divSel = getSelect('local-divergingColorScheme')

      expect(barSel.value).toBe(DEFAULT_SETTINGS.barColorScheme)
      expect(heatSel.value).toBe(DEFAULT_SETTINGS.heatmapColorScheme)
      expect(divSel.value).toBe(DEFAULT_SETTINGS.divergingColorScheme)
    })

    it('populates local tab with local overrides when present', () => {
      setLocalTableSettings('paper#t1', {
        barColorScheme: 'Set1',
        divergingColorScheme: 'RdBu',
      })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const barSel = getSelect('local-barColorScheme')
      const divSel = getSelect('local-divergingColorScheme')

      expect(barSel.value).toBe('Set1')
      expect(divSel.value).toBe('RdBu')
    })

    it('populates global tab with current global settings', () => {
      updateSettings({
        autoVisualize: 'bars',
        barColorScheme: 'tab10',
        divergingColorScheme: 'Spectral',
      })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      const autoVis = getSelect('autoVisualize')
      const barSel = getSelect('barColorScheme')
      const divSel = getSelect('divergingColorScheme')

      expect(autoVis.value).toBe('bars')
      expect(barSel.value).toBe('tab10')
      expect(divSel.value).toBe('Spectral')
    })

    it('filters dropdown presets by sequential vs diverging category', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const heatSel = getSelect('local-heatmapColorScheme')
      const divSel = getSelect('local-divergingColorScheme')

      const heatOptions = Array.from(heatSel.options).map((o) => o.value)
      const divOptions = Array.from(divSel.options).map((o) => o.value)

      // Sequential dropdown has Cividis and Viridis, not PuOr or RdBu
      expect(heatOptions).toContain('Cividis')
      expect(heatOptions).toContain('Viridis')
      expect(heatOptions).not.toContain('PuOr')
      expect(heatOptions).not.toContain('RdBu')

      // Diverging dropdown has PuOr and RdBu, not Cividis or Viridis
      expect(divOptions).toContain('PuOr')
      expect(divOptions).toContain('RdBu')
      expect(divOptions).not.toContain('Cividis')
      expect(divOptions).not.toContain('Viridis')
    })

    it('shows custom input when value is not a known preset', () => {
      setLocalTableSettings('paper#t1', {
        barColorScheme: '#aabbcc, #112233',
      })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)

      const barSel = getSelect('local-barColorScheme')
      const customInput = getCustomInput('local-barColorScheme')

      expect(barSel.value).toBe('custom')
      expect(customInput.value).toBe('#aabbcc, #112233')
      expect(customInput.classList.contains('active')).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Custom Input Toggle
  // -----------------------------------------------------------------------

  describe('custom input toggle', () => {
    it('shows custom input when "custom" is selected', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const barSel = getSelect('local-barColorScheme')
      const customInput = getCustomInput('local-barColorScheme')

      // Initially hidden
      expect(customInput.classList.contains('active')).toBe(false)

      // Select "custom"
      barSel.value = 'custom'
      barSel.dispatchEvent(new Event('change'))
      expect(customInput.classList.contains('active')).toBe(true)
    })

    it('hides custom input when a preset is selected', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const barSel = getSelect('local-barColorScheme')
      const customInput = getCustomInput('local-barColorScheme')

      // Select custom first
      barSel.value = 'custom'
      barSel.dispatchEvent(new Event('change'))
      expect(customInput.classList.contains('active')).toBe(true)

      // Switch back to preset
      barSel.value = 'Set1'
      barSel.dispatchEvent(new Event('change'))
      expect(customInput.classList.contains('active')).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Local Tab Actions
  // -----------------------------------------------------------------------

  describe('local tab actions', () => {
    it('Save for Table — button has text "Save for Table" and persists local settings', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const saveBtn = getPopover()!.querySelector(
        '[data-action="apply"]',
      ) as HTMLElement
      expect(saveBtn.textContent).toBe('Save for Table')

      const barSel = getSelect('local-barColorScheme')
      barSel.value = 'Set1'
      barSel.dispatchEvent(new Event('change'))

      clickAction('apply')

      const local = getLocalTableSettings('paper#t1')
      expect(local).toBeDefined()
      expect(local!.settings.barColorScheme).toBe('Set1')
      expect(getPopover()).toBeNull()
    })

    it('Save for Table — persists custom hex values', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)

      const barSel = getSelect('local-barColorScheme')
      const customInput = getCustomInput('local-barColorScheme')

      barSel.value = 'custom'
      barSel.dispatchEvent(new Event('change'))
      customInput.value = '#ff0000, #00ff00'
      customInput.dispatchEvent(new Event('input'))

      clickAction('apply')

      const local = getLocalTableSettings('paper#t1')
      expect(local!.settings.barColorScheme).toBe('#ff0000, #00ff00')
    })

    it('Live preview updates table visualization on form change and reverts on cancel', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      onUpdate.mockClear()

      const barSel = getSelect('local-barColorScheme')
      barSel.value = 'Set1'
      barSel.dispatchEvent(new Event('change'))

      // Live preview should trigger update and update badge
      expect(onUpdate).toHaveBeenCalled()
      const badge = getPopover()!.querySelector('#local-status-badge')!
      expect(badge.textContent).toBe('Custom Override Active')

      // Close without clicking Save for Table -> should revert
      clickAction('close')
      expect(getLocalTableSettings('paper#t1')).toBeUndefined()
    })

    it('Reset to Global — clears local override and calls onUpdate', () => {
      setLocalTableSettings('paper#t1', { barColorScheme: 'Set1' })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)

      clickAction('reset-local')

      // Local override should be cleared
      expect(getLocalTableSettings('paper#t1')).toBeUndefined()
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // Badge should update to global
      const badge = getPopover()!.querySelector('#local-status-badge')!
      expect(badge.textContent).toBe('Using Global Defaults')

      // Popover should remain open (reset doesn't close)
      expect(getPopover()).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Global Tab Actions
  // -----------------------------------------------------------------------

  describe('global tab actions', () => {
    it('Save Global — updates global settings and calls onUpdate', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      // Change auto-visualize to bars
      const autoVis = getSelect('autoVisualize')
      autoVis.value = 'bars'

      // Change bar color scheme
      const barSel = getSelect('barColorScheme')
      barSel.value = 'tab10'

      clickAction('save-global')

      const settings = getSettings()
      expect(settings.autoVisualize).toBe('bars')
      expect(settings.barColorScheme).toBe('tab10')
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // Popover should close after save
      expect(getPopover()).toBeNull()
    })

    it('Save Global — saves checkbox parser settings', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      const popover = getPopover()!
      const intCheckbox = popover.querySelector(
        '[name="includeAllIntegerColumns"]',
      ) as HTMLInputElement
      const sciCheckbox = popover.querySelector(
        '[name="includeScientificNotation"]',
      ) as HTMLInputElement

      intCheckbox.checked = true
      sciCheckbox.checked = true

      clickAction('save-global')

      const settings = getSettings()
      expect(settings.includeAllIntegerColumns).toBe(true)
      expect(settings.includeScientificNotation).toBe(true)
    })

    it('Reset to Defaults — restores factory settings and calls onUpdate', () => {
      updateSettings({ autoVisualize: 'bars', barColorScheme: 'Set1' })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      clickAction('reset-global')

      const settings = getSettings()
      expect(settings.autoVisualize).toBe(DEFAULT_SETTINGS.autoVisualize)
      expect(settings.barColorScheme).toBe(DEFAULT_SETTINGS.barColorScheme)
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // Form should be refreshed with defaults
      const autoVis = getSelect('autoVisualize')
      expect(autoVis.value).toBe('off')

      // Popover should remain open
      expect(getPopover()).not.toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Opacity Slider
  // -----------------------------------------------------------------------

  describe('opacity inputs', () => {
    it('populates chartOpacity and buttonOpacity number inputs with current values', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      const popover = getPopover()!
      const chartInput = popover.querySelector(
        '[name="chartOpacity"]',
      ) as HTMLInputElement
      const btnInput = popover.querySelector(
        '[name="buttonOpacity"]',
      ) as HTMLInputElement

      expect(chartInput.value).toBe('0.35')
      expect(btnInput.value).toBe('0.5')
    })

    it('persists chartOpacity and buttonOpacity on save', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('global')

      const popover = getPopover()!
      const chartInput = popover.querySelector(
        '[name="chartOpacity"]',
      ) as HTMLInputElement
      const btnInput = popover.querySelector(
        '[name="buttonOpacity"]',
      ) as HTMLInputElement

      chartInput.value = '0.6'
      chartInput.dispatchEvent(new Event('input'))

      btnInput.value = '0.8'
      btnInput.dispatchEvent(new Event('input'))

      clickAction('save-global')

      expect(getSettings().chartOpacity).toBe(0.6)
      expect(getSettings().buttonOpacity).toBe(0.8)
    })
  })

  // -----------------------------------------------------------------------
  // CSS Injection
  // -----------------------------------------------------------------------

  describe('CSS injection', () => {
    it('injects style tag on first open', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const style = document.getElementById(
        'b-a-t-settings-styles',
      )
      expect(style).not.toBeNull()
      expect(style!.tagName.toLowerCase()).toBe('style')
    })

    it('does not inject duplicate style tags', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate) // close
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate) // reopen

      const styles = document.querySelectorAll(
        '#b-a-t-settings-styles',
      )
      expect(styles.length).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Fixed Positioning
  // -----------------------------------------------------------------------

  describe('positioning', () => {
    it('appends popover to document.body with fixed positioning', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const popover = getPopover()!
      expect(popover.parentElement).toBe(document.body)
      expect(popover.style.position).toBe('fixed')
    })

    it('anchors lower-left corner beside the button when space permits', () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        left: 500,
        top: 400,
        right: 550,
        bottom: 430,
        width: 50,
        height: 30,
        x: 500,
        y: 400,
        toJSON: () => {},
      })

      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const popover = getPopover()!
      expect(popover.style.left).toBe('558px')
      expect(popover.style.position).toBe('fixed')
    })

    it('dodges when anchor is too close to the right edge of viewport', () => {
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
        left: 750,
        top: 300,
        right: 790,
        bottom: 330,
        width: 40,
        height: 30,
        x: 750,
        y: 300,
        toJSON: () => {},
      })

      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const popover = getPopover()!
      // left + 0 > 792 -> left = min(792, 790) = 790px, top = 330 + 4 = 334px
      expect(popover.style.top).toBe('334px')
    })

    it('repositions popover when dragged via header', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      const popover = getPopover()!
      const header = popover.querySelector(
        '.b-a-t-settings-header',
      ) as HTMLElement

      header.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 50,
        }),
      )

      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 150,
          clientY: 120,
        }),
      )

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(popover.style.left).toBe('50px')
      expect(popover.style.top).toBe('70px')
    })
  })

  // -----------------------------------------------------------------------
  // Site Whitelist Tab & Panel
  // -----------------------------------------------------------------------

  describe('site whitelist tab and actions', () => {
    it('shows Whitelist tab and panel when clicking tab', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('whitelist')

      const popover = getPopover()!
      const tab = popover.querySelector('[data-tab="whitelist"]')!
      const panel = popover.querySelector(
        '[data-panel="whitelist"]',
      ) as HTMLElement

      expect(tab.classList.contains('active')).toBe(true)
      expect(panel.classList.contains('active')).toBe(true)
    })

    it('hides Local tab when opened with empty compositeKey', () => {
      toggleSettingsPopover(anchor, '', onUpdate)
      const popover = getPopover()!
      const localTab = popover.querySelector('[data-tab="local"]')
      const globalTab = popover.querySelector('[data-tab="global"]')
      const whitelistTab = popover.querySelector('[data-tab="whitelist"]')

      expect(localTab).toBeNull()
      expect(globalTab).not.toBeNull()
      expect(whitelistTab).not.toBeNull()
    })

    it('populates whitelist textarea with current whitelist rules', () => {
      updateSettings({ urlWhitelist: ['*://arxiv.org/*', 'biorxiv.org'] })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('whitelist')

      const popover = getPopover()!
      const textarea = popover.querySelector(
        'textarea[name="urlWhitelist"]',
      ) as HTMLTextAreaElement

      expect(textarea.value).toBe('*://arxiv.org/*\nbiorxiv.org')
    })

    it('toggles current domain in textarea when clicking toggle button', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('whitelist')

      const popover = getPopover()!
      const textarea = popover.querySelector(
        'textarea[name="urlWhitelist"]',
      ) as HTMLTextAreaElement
      const toggleBtn = popover.querySelector(
        '[data-action="toggle-current-domain"]',
      ) as HTMLButtonElement

      expect(toggleBtn).not.toBeNull()
      // In jsdom, window.location.hostname is empty string / localhost / ''
      toggleBtn.click()
      // Should have modified textarea
      expect(textarea.value.length).toBeGreaterThan(0)
    })

    it('resets whitelist to defaults on reset-whitelist click', () => {
      updateSettings({ urlWhitelist: ['custom.domain.org'] })
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('whitelist')

      const popover = getPopover()!
      const textarea = popover.querySelector(
        'textarea[name="urlWhitelist"]',
      ) as HTMLTextAreaElement

      expect(textarea.value).toBe('custom.domain.org')

      clickAction('reset-whitelist')

      expect(textarea.value).toBe(DEFAULT_WHITELIST.join('\n'))
    })

    it('saves whitelist to storage on save-whitelist click', () => {
      toggleSettingsPopover(anchor, 'paper#t1', onUpdate)
      clickTab('whitelist')

      const popover = getPopover()!
      const textarea = popover.querySelector(
        'textarea[name="urlWhitelist"]',
      ) as HTMLTextAreaElement

      textarea.value = '*://arxiv.org/html/*\nopenreview.net/forum'

      clickAction('save-whitelist')

      const settings = getSettings()
      expect(settings.urlWhitelist).toEqual([
        '*://arxiv.org/html/*',
        'openreview.net/forum',
      ])
      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(getPopover()).toBeNull()
    })
  })
})
