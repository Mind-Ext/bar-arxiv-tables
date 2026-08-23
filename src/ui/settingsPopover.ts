/**
 * Settings Popover UI Component for arXiv Chart Visualizer.
 *
 * Provides a two-tab popover (Local / Global) for configuring per-table
 * and global default visualization settings with live preview.
 */

import {
  AutoVisualizeMode,
  clearLocalTableSettings,
  DEFAULT_SETTINGS,
  DEFAULT_WHITELIST,
  getEffectiveSettings,
  getLocalTableSettings,
  getSettings,
  isUrlAllowed,
  matchesRule,
  PRESET_COLORMAPS,
  PRESET_PALETTES,
  setLocalTableSettings,
  Settings,
  updateSettings,
} from '../settings'

/** Currently open popover element, or null. */
let currentPopover: HTMLElement | null = null
let currentAnchor: HTMLElement | null = null
let closeHandler: ((e: MouseEvent) => void) | null = null
let keyHandler: ((e: KeyboardEvent) => void) | null = null
let cleanupOnClose: (() => void) | null = null

/**
 * Inject the settings popover CSS into the document head (once).
 */
function cssOnce(): void {
  if (document.getElementById('b-a-t-settings-styles')) {
    return
  }
  const style = document.createElement('style')
  style.id = 'b-a-t-settings-styles'
  style.textContent = `
    .b-a-t-settings-popover {
      z-index: 10000;
      width: 360px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      color: #333;
      margin-top: 8px;
    }
    .b-a-t-settings-header {
      background: #f8f9fa;
      padding: 10px 15px;
      border-bottom: 1px solid #e9ecef;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 6px 6px 0 0;
      font-weight: bold;
      cursor: grab;
      user-select: none;
    }
    .b-a-t-settings-tabs {
      display: flex;
      border-bottom: 1px solid #e9ecef;
    }
    .b-a-t-settings-tab {
      padding: 8px 12px;
      cursor: pointer;
      flex: 1;
      text-align: center;
      background: #f8f9fa;
      border-bottom: 2px solid transparent;
      color: #666;
      font-size: 12px;
    }
    .b-a-t-settings-tab.active {
      background: white;
      border-bottom-color: #495057;
      color: #212529;
      font-weight: 500;
    }
    .b-a-t-settings-panel {
      display: none;
      padding: 15px;
    }
    .b-a-t-settings-panel.active {
      display: block;
    }
    .b-a-t-settings-group {
      margin-bottom: 15px;
    }
    .b-a-t-settings-group-title {
      font-weight: 600;
      margin-bottom: 10px;
      color: #444;
      border-bottom: 1px solid #eee;
      padding-bottom: 4px;
    }
    .b-a-t-settings-field {
      margin-bottom: 10px;
      display: flex;
      flex-direction: column;
    }
    .b-a-t-settings-field label {
      margin-bottom: 4px;
      font-weight: 500;
    }
    .b-a-t-settings-field select,
    .b-a-t-settings-field input[type="text"],
    .b-a-t-settings-field input[type="number"] {
      width: 100%;
      padding: 6px;
      border: 1px solid #d1d5da;
      border-radius: 4px;
      box-sizing: border-box;
      font-size: 13px;
    }
    .b-a-t-settings-textarea {
      width: 100%;
      height: 120px;
      padding: 6px 8px;
      border: 1px solid #d1d5da;
      border-radius: 4px;
      box-sizing: border-box;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
      font-size: 12px;
      resize: vertical;
      line-height: 1.4;
      white-space: pre;
    }
    .b-a-t-help-text {
      font-size: 11px;
      color: #6c757d;
      margin-top: 5px;
      line-height: 1.35;
    }
    .b-a-t-settings-field-checkbox {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .b-a-t-settings-field-checkbox input {
      margin-right: 8px;
    }
    .b-a-t-settings-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #eaecef;
    }
    .b-a-t-btn {
      padding: 6px 12px;
      cursor: pointer;
      border: 1px solid #d1d5da;
      background: #fafbfc;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
    }
    .b-a-t-btn:hover {
      background: #f3f4f6;
    }
    .b-a-t-btn-primary {
      background: #495057;
      color: white;
      border-color: #495057;
    }
    .b-a-t-btn-primary:hover {
      background: #343a40;
    }
    .b-a-t-settings-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .b-a-t-badge-global {
      background: #f1f3f5;
      color: #495057;
    }
    .b-a-t-badge-custom {
      background: #e9ecef;
      color: #343a40;
    }
    .b-a-t-settings-custom-input {
      margin-top: 6px;
      display: none;
    }
    .b-a-t-settings-custom-input.active {
      display: block;
    }
    .b-a-t-close-btn {
      cursor: pointer;
      background: none;
      border: none;
      font-size: 18px;
      line-height: 1;
      color: #6a737d;
      padding: 0;
    }
    .b-a-t-close-btn:hover {
      color: #24292e;
    }
  `
  document.head.appendChild(style)
}

/**
 * Build <option> HTML for a color scheme dropdown.
 * @param includePalettes - Whether to include categorical palette presets.
 */
function getOptionsHTML(includePalettes: boolean): string {
  const options: string[] = []
  if (includePalettes) {
    options.push('<optgroup label="Palettes">')
    for (const key of Object.keys(PRESET_PALETTES)) {
      options.push(`<option value="${key}">${key}</option>`)
    }
    options.push('</optgroup>')
  }
  options.push('<optgroup label="Colormaps">')
  for (const key of Object.keys(PRESET_COLORMAPS)) {
    options.push(`<option value="${key}">${key}</option>`)
  }
  options.push('</optgroup>')
  options.push('<option value="custom">Custom...</option>')
  return options.join('')
}

/** Close the currently open popover and remove listeners. */
function closePopover(): void {
  if (cleanupOnClose) {
    cleanupOnClose()
    cleanupOnClose = null
  }
  if (currentPopover) {
    currentPopover.remove()
    currentPopover = null
  }
  currentAnchor = null
  if (closeHandler) {
    document.removeEventListener('click', closeHandler)
    closeHandler = null
  }
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }
}

/**
 * Toggle the settings popover for a specific table.
 *
 * @param anchorEl - The element to anchor the popover to (gear button's parent container).
 * @param compositeKey - The composite key identifying this table.
 * @param onUpdate - Callback invoked after settings are applied/saved/reset.
 */
export function toggleSettingsPopover(
  anchorEl: HTMLElement,
  compositeKey: string,
  onUpdate: () => void,
  initialTab?: 'local' | 'global' | 'whitelist',
): void {
  // If clicking same anchor, close and return
  if (currentPopover && currentAnchor === anchorEl) {
    closePopover()
    return
  }

  // Close existing popover if any
  cleanupOnClose = null
  closePopover()
  cssOnce()

  // Snapshot initial persistent states for live preview rollback
  const initialGlobalSettings = { ...getSettings() }
  const initialLocalEntry = compositeKey
    ? getLocalTableSettings(compositeKey)
    : undefined
  let isSaved = false

  cleanupOnClose = () => {
    if (!isSaved) {
      // Revert live preview back to initial persistent states
      updateSettings(initialGlobalSettings)
      if (compositeKey) {
        if (initialLocalEntry) {
          setLocalTableSettings(compositeKey, initialLocalEntry.settings)
        } else {
          clearLocalTableSettings(compositeKey)
        }
      }
      onUpdate()
    }
  }

  const barOptions = getOptionsHTML(true)
  const heatOptions = getOptionsHTML(false)
  const defaultTab = initialTab || (compositeKey ? 'local' : 'global')

  const popover = document.createElement('div')
  popover.className = 'b-a-t-settings-popover'
  popover.innerHTML = `
    <div class="b-a-t-settings-header">
      <span>Settings</span>
      <button class="b-a-t-close-btn" data-action="close">&times;</button>
    </div>
    <div class="b-a-t-settings-tabs">
      ${
    compositeKey
      ? `<div class="b-a-t-settings-tab ${
        defaultTab === 'local' ? 'active' : ''
      }" data-tab="local">Current Table</div>`
      : ''
  }
      <div class="b-a-t-settings-tab ${
    defaultTab === 'global' ? 'active' : ''
  }" data-tab="global">Visualization</div>
      <div class="b-a-t-settings-tab ${
    defaultTab === 'whitelist' ? 'active' : ''
  }" data-tab="whitelist">Site Whitelist</div>
    </div>

    ${
    compositeKey
      ? `
    <div class="b-a-t-settings-panel ${
        defaultTab === 'local' ? 'active' : ''
      }" data-panel="local">
      <div id="local-status-badge" class="b-a-t-settings-badge b-a-t-badge-global">Using Global Defaults</div>

      <div class="b-a-t-settings-field">
        <label>Bar Color Scheme</label>
        <select name="local-barColorScheme">
          ${barOptions}
        </select>
        <input type="text" class="b-a-t-settings-custom-input" data-custom-input="local-barColorScheme" placeholder="#ff5733, #33ff57">
      </div>

      <div class="b-a-t-settings-field">
        <label>Heatmap Color Scheme</label>
        <select name="local-heatmapColorScheme">
          ${heatOptions}
        </select>
        <input type="text" class="b-a-t-settings-custom-input" data-custom-input="local-heatmapColorScheme" placeholder="#ff5733, #33ff57">
      </div>

      <div class="b-a-t-settings-footer">
        <button class="b-a-t-btn" data-action="reset-local">Reset to Global</button>
        <button class="b-a-t-btn b-a-t-btn-primary" data-action="apply">Save for Table</button>
      </div>
    </div>
    `
      : ''
  }

    <div class="b-a-t-settings-panel ${
    defaultTab === 'global' ? 'active' : ''
  }" data-panel="global">
      <div class="b-a-t-settings-group">
        <div class="b-a-t-settings-group-title">Render Settings</div>

        <div class="b-a-t-settings-field">
          <label>Auto-Visualize</label>
          <select name="autoVisualize">
            <option value="off">Off</option>
            <option value="bars">Bars</option>
            <option value="heatmap">Heatmap</option>
          </select>
        </div>

        <div class="b-a-t-settings-field">
          <label>Bar Color Scheme</label>
          <select name="barColorScheme">
            ${barOptions}
          </select>
          <input type="text" class="b-a-t-settings-custom-input" data-custom-input="barColorScheme" placeholder="#ff5733, #33ff57">
        </div>

        <div class="b-a-t-settings-field">
          <label>Heatmap Color Scheme</label>
          <select name="heatmapColorScheme">
            ${heatOptions}
          </select>
          <input type="text" class="b-a-t-settings-custom-input" data-custom-input="heatmapColorScheme" placeholder="#ff5733, #33ff57">
        </div>

        <div class="b-a-t-settings-field">
          <label>Chart Opacity</label>
          <input type="number" name="chartOpacity" min="0" max="1" step="0.05" placeholder="0.35">
        </div>

        <div class="b-a-t-settings-field">
          <label>Button Opacity</label>
          <input type="number" name="buttonOpacity" min="0" max="1" step="0.05" placeholder="0.5">
        </div>
      </div>

      <div class="b-a-t-settings-group">
        <div class="b-a-t-settings-group-title">Parser Settings</div>

        <div class="b-a-t-settings-field-checkbox">
          <input type="checkbox" name="includeAllIntegerColumns" id="cb-int">
          <label for="cb-int">Include All-Integer Columns</label>
        </div>

        <div class="b-a-t-settings-field-checkbox">
          <input type="checkbox" name="includeScientificNotation" id="cb-sci">
          <label for="cb-sci">Include Scientific Notation</label>
        </div>
      </div>

      <div class="b-a-t-settings-footer">
        <button class="b-a-t-btn" data-action="reset-global">Reset to Defaults</button>
        <button class="b-a-t-btn b-a-t-btn-primary" data-action="save-global">Save Global</button>
      </div>
    </div>

    <div class="b-a-t-settings-panel ${
    defaultTab === 'whitelist' ? 'active' : ''
  }" data-panel="whitelist">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 500; font-size: 12px;">Current Site Status:</span>
        <span id="whitelist-status-badge" class="b-a-t-settings-badge b-a-t-badge-global">Checking...</span>
      </div>

      <div style="margin-bottom: 10px;">
        <button type="button" class="b-a-t-btn" data-action="toggle-current-domain" style="width: 100%; text-align: center;">
          ➕ Whitelist Current Domain
        </button>
      </div>

      <div class="b-a-t-settings-field">
        <label>Allowed URL Rules (one per line):</label>
        <textarea name="urlWhitelist" class="b-a-t-settings-textarea" placeholder="*://arxiv.org/html/*&#10;*://ar5iv.labs.arxiv.org/html/*&#10;file:///*.html&#10;biorxiv.org&#10;/\/papers\/\d+/"></textarea>
        <div class="b-a-t-help-text">
          Supports domain names (<code>biorxiv.org</code>), wildcards (<code>*arxiv.org/html/*</code>, <code>file:///*.html</code>), or <code>/regex/</code>. Lines starting with <code>#</code> are comments.
        </div>
      </div>

      <div class="b-a-t-settings-footer">
        <button class="b-a-t-btn" data-action="reset-whitelist">Reset Whitelist</button>
        <button class="b-a-t-btn b-a-t-btn-primary" data-action="save-whitelist">Save Whitelist</button>
      </div>
    </div>
  `

  // Position relative to anchor using fixed positioning (avoids overflow clipping)
  const rect = anchorEl.getBoundingClientRect()
  popover.style.position = 'fixed'
  popover.style.top = `${rect.bottom + 4}px`
  popover.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`

  document.body.appendChild(popover)
  currentPopover = popover
  currentAnchor = anchorEl

  // Adjust if popover overflows viewport edges
  const popoverRect = popover.getBoundingClientRect()
  if (popoverRect.bottom > window.innerHeight) {
    // Flip above the anchor
    popover.style.top = `${Math.max(0, rect.top - popoverRect.height - 4)}px`
  }
  if (popoverRect.left < 0) {
    // Clamp so left edge stays on screen
    popover.style.right = 'auto'
    popover.style.left = '4px'
  }

  // --- Drag support via header ---
  const header = popover.querySelector(
    '.b-a-t-settings-header',
  ) as HTMLElement
  let isDragging = false
  let dragOffsetX = 0
  let dragOffsetY = 0

  header.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-action]')) {
      return
    }
    isDragging = true
    const pr = popover.getBoundingClientRect()
    dragOffsetX = e.clientX - pr.left
    dragOffsetY = e.clientY - pr.top
    popover.style.left = `${pr.left}px`
    popover.style.right = 'auto'
    header.style.cursor = 'grabbing'
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return
    popover.style.left = `${e.clientX - dragOffsetX}px`
    popover.style.top = `${e.clientY - dragOffsetY}px`
  })

  document.addEventListener('mouseup', () => {
    if (!isDragging) return
    isDragging = false
    header.style.cursor = 'grab'
  })

  // --- Element references ---
  // Note: Local controls are typed as T | null because the Local panel is
  // conditionally rendered only when a table composite key is present.
  // Global and Whitelist controls are always rendered into the DOM.

  const q = <T extends HTMLElement>(selector: string) =>
    popover.querySelector(selector) as T | null
  const qa = <T extends HTMLElement>(selector: string) =>
    popover.querySelectorAll(selector) as NodeListOf<T>

  const els = {
    tabs: qa('[data-tab]'),
    panels: qa('[data-panel]'),
    localStatus: q('#local-status-badge'),
    whitelistStatus: q('#whitelist-status-badge'),
    toggleDomainBtn: q<HTMLButtonElement>(
      '[data-action="toggle-current-domain"]',
    ),
    whitelistTextarea: q<HTMLTextAreaElement>('textarea[name="urlWhitelist"]'),

    localBarSel: q<HTMLSelectElement>('[name="local-barColorScheme"]'),
    localBarInput: q<HTMLInputElement>(
      '[data-custom-input="local-barColorScheme"]',
    ),
    localHeatSel: q<HTMLSelectElement>('[name="local-heatmapColorScheme"]'),
    localHeatInput: q<HTMLInputElement>(
      '[data-custom-input="local-heatmapColorScheme"]',
    ),

    globalAutoVis: q<HTMLSelectElement>('[name="autoVisualize"]')!,
    globalBarSel: q<HTMLSelectElement>('[name="barColorScheme"]')!,
    globalBarInput: q<HTMLInputElement>(
      '[data-custom-input="barColorScheme"]',
    )!,
    globalHeatSel: q<HTMLSelectElement>('[name="heatmapColorScheme"]')!,
    globalHeatInput: q<HTMLInputElement>(
      '[data-custom-input="heatmapColorScheme"]',
    )!,
    globalChartOpacity: q<HTMLInputElement>('[name="chartOpacity"]')!,
    globalButtonOpacity: q<HTMLInputElement>('[name="buttonOpacity"]')!,
    globalIncInt: q<HTMLInputElement>('[name="includeAllIntegerColumns"]')!,
    globalIncSci: q<HTMLInputElement>('[name="includeScientificNotation"]')!,
  }

  // --- Helpers ---

  /** Populate a select + custom-input pair from a setting value. */
  const setSchemeField = (
    sel: HTMLSelectElement | null,
    input: HTMLInputElement | null,
    val: string,
  ): void => {
    if (!sel || !input) return
    let found = false
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === val) {
        found = true
        break
      }
    }
    if (found) {
      sel.value = val
      input.classList.remove('active')
    } else {
      sel.value = 'custom'
      input.value = val
      input.classList.add('active')
    }
  }

  /** Read value from a select + custom-input pair. */
  const getSchemeField = (
    sel: HTMLSelectElement | null,
    input: HTMLInputElement | null,
  ): string => {
    if (!sel || !input) return ''
    return sel.value === 'custom' ? input.value : sel.value
  }

  /** Update local status badge live based on current form controls. */
  const updateLocalBadge = (): void => {
    if (!els.localStatus || !els.localBarSel || !els.localBarInput) return
    const globalSettings = getSettings()
    const bar = getSchemeField(els.localBarSel, els.localBarInput)
    const heat = getSchemeField(els.localHeatSel, els.localHeatInput)

    const isCustom = Boolean(
      (compositeKey && getLocalTableSettings(compositeKey)) ||
        bar !== globalSettings.barColorScheme ||
        heat !== globalSettings.heatmapColorScheme,
    )

    if (isCustom) {
      els.localStatus.textContent = 'Custom Override Active'
      els.localStatus.className = 'b-a-t-settings-badge b-a-t-badge-custom'
    } else {
      els.localStatus.textContent = 'Using Global Defaults'
      els.localStatus.className = 'b-a-t-settings-badge b-a-t-badge-global'
    }
  }

  /** Update whitelist status badge and toggle domain button. */
  const updateWhitelistBadge = (): void => {
    if (!els.whitelistStatus || !els.whitelistTextarea) return
    const currentUrl = typeof window !== 'undefined' ? window.location.href : ''
    const currentHost =
      (typeof window !== 'undefined' && window.location.hostname) || 'this page'
    const rules = els.whitelistTextarea.value.split('\n')
    const allowed = isUrlAllowed(currentUrl, rules)

    if (allowed) {
      els.whitelistStatus.textContent = '🟢 Whitelisted'
      els.whitelistStatus.className = 'b-a-t-settings-badge b-a-t-badge-custom'
      if (els.toggleDomainBtn) {
        els.toggleDomainBtn.textContent =
          `➖ Remove ${currentHost} from Whitelist`
      }
    } else {
      els.whitelistStatus.textContent = '⚪ Not Whitelisted'
      els.whitelistStatus.className = 'b-a-t-settings-badge b-a-t-badge-global'
      if (els.toggleDomainBtn) {
        els.toggleDomainBtn.textContent = `➕ Whitelist ${currentHost}`
      }
    }
  }

  /** Live preview updates for Local tab. */
  const triggerLivePreviewLocal = (): void => {
    if (!compositeKey || !els.localBarSel || !els.localBarInput) return
    const bar = getSchemeField(els.localBarSel, els.localBarInput)
    const heat = getSchemeField(els.localHeatSel, els.localHeatInput)
    setLocalTableSettings(compositeKey, {
      barColorScheme: bar,
      heatmapColorScheme: heat,
    })
    updateLocalBadge()
    onUpdate()
  }

  /** Live preview updates for Global tab. */
  const triggerLivePreviewGlobal = (): void => {
    const chartOp = parseFloat(els.globalChartOpacity.value)
    const btnOp = parseFloat(els.globalButtonOpacity.value)
    const draftGlobal: Partial<Settings> = {
      autoVisualize: els.globalAutoVis.value as AutoVisualizeMode,
      barColorScheme: getSchemeField(els.globalBarSel, els.globalBarInput),
      heatmapColorScheme: getSchemeField(
        els.globalHeatSel,
        els.globalHeatInput,
      ),
      chartOpacity: isNaN(chartOp) ? DEFAULT_SETTINGS.chartOpacity : chartOp,
      buttonOpacity: isNaN(btnOp) ? DEFAULT_SETTINGS.buttonOpacity : btnOp,
      includeAllIntegerColumns: els.globalIncInt.checked,
      includeScientificNotation: els.globalIncSci.checked,
    }
    updateSettings(draftGlobal)
    updateLocalBadge()
    onUpdate()
  }

  /** Populate all form fields from current settings state. */
  const populateFields = (): void => {
    const globalSettings = getSettings()
    const effective = getEffectiveSettings(compositeKey)

    // Local tab fields
    if (compositeKey) {
      setSchemeField(
        els.localBarSel,
        els.localBarInput,
        effective.barColorScheme,
      )
      setSchemeField(
        els.localHeatSel,
        els.localHeatInput,
        effective.heatmapColorScheme,
      )
      updateLocalBadge()
    }

    // Global tab fields
    els.globalAutoVis.value = globalSettings.autoVisualize
    setSchemeField(
      els.globalBarSel,
      els.globalBarInput,
      globalSettings.barColorScheme,
    )
    setSchemeField(
      els.globalHeatSel,
      els.globalHeatInput,
      globalSettings.heatmapColorScheme,
    )
    els.globalChartOpacity.value = globalSettings.chartOpacity.toString()
    els.globalButtonOpacity.value = globalSettings.buttonOpacity.toString()
    els.globalIncInt.checked = globalSettings.includeAllIntegerColumns
    els.globalIncSci.checked = globalSettings.includeScientificNotation

    // Whitelist tab fields
    if (els.whitelistTextarea) {
      els.whitelistTextarea.value = (
        globalSettings.urlWhitelist ?? DEFAULT_WHITELIST
      ).join('\n')
      updateWhitelistBadge()
    }
  }

  // --- Initialize ---
  populateFields()

  // --- Live preview event listeners ---

  // Local tab input changes
  if (els.localBarSel && els.localHeatSel) {
    const handleLocalChange = () => {
      triggerLivePreviewLocal()
    }
    els.localBarSel.addEventListener('change', handleLocalChange)
    els.localBarInput?.addEventListener('input', handleLocalChange)
    els.localHeatSel.addEventListener('change', handleLocalChange)
    els.localHeatInput?.addEventListener('input', handleLocalChange)
  }

  // Global tab input changes
  const handleGlobalChange = () => {
    triggerLivePreviewGlobal()
  }
  els.globalAutoVis.addEventListener('change', handleGlobalChange)
  els.globalBarSel.addEventListener('change', handleGlobalChange)
  els.globalBarInput.addEventListener('input', handleGlobalChange)
  els.globalHeatSel.addEventListener('change', handleGlobalChange)
  els.globalHeatInput.addEventListener('input', handleGlobalChange)
  els.globalChartOpacity.addEventListener('input', handleGlobalChange)
  els.globalChartOpacity.addEventListener('change', handleGlobalChange)
  els.globalButtonOpacity.addEventListener('input', handleGlobalChange)
  els.globalButtonOpacity.addEventListener('change', handleGlobalChange)
  els.globalIncInt.addEventListener('change', handleGlobalChange)
  els.globalIncSci.addEventListener('change', handleGlobalChange)

  // Whitelist textarea live change
  if (els.whitelistTextarea) {
    els.whitelistTextarea.addEventListener('input', () => {
      updateWhitelistBadge()
    })
  }

  // Show/hide custom text input on select change
  qa('select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement
      const customInput = popover.querySelector(
        `[data-custom-input="${target.name}"]`,
      ) as HTMLElement | null
      if (customInput) {
        if (target.value === 'custom') {
          customInput.classList.add('active')
        } else {
          customInput.classList.remove('active')
        }
      }
    })
  })

  // Delegated click handler for tabs and action buttons
  popover.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    // Tab switching
    if (target.dataset.tab) {
      const tabName = target.dataset.tab
      els.tabs.forEach((t) =>
        t.classList.toggle('active', t.dataset.tab === tabName)
      )
      els.panels.forEach((p) =>
        p.classList.toggle('active', p.dataset.panel === tabName)
      )
      return
    }

    // Footer & other actions
    const action = target.closest('[data-action]')?.getAttribute('data-action')
    if (!action) return

    switch (action) {
      case 'close':
        closePopover()
        break

      case 'apply': {
        const bar = getSchemeField(els.localBarSel, els.localBarInput)
        const heat = getSchemeField(els.localHeatSel, els.localHeatInput)
        if (compositeKey) {
          setLocalTableSettings(compositeKey, {
            barColorScheme: bar,
            heatmapColorScheme: heat,
          })
        }
        isSaved = true
        onUpdate()
        closePopover()
        break
      }

      case 'reset-local': {
        if (compositeKey) {
          clearLocalTableSettings(compositeKey)
        }
        populateFields()
        onUpdate()
        break
      }

      case 'save-global': {
        const chartOp = parseFloat(els.globalChartOpacity.value)
        const btnOp = parseFloat(els.globalButtonOpacity.value)
        const newSettings: Partial<Settings> = {
          autoVisualize: els.globalAutoVis.value as AutoVisualizeMode,
          barColorScheme: getSchemeField(els.globalBarSel, els.globalBarInput),
          heatmapColorScheme: getSchemeField(
            els.globalHeatSel,
            els.globalHeatInput,
          ),
          chartOpacity: isNaN(chartOp)
            ? DEFAULT_SETTINGS.chartOpacity
            : chartOp,
          buttonOpacity: isNaN(btnOp) ? DEFAULT_SETTINGS.buttonOpacity : btnOp,
          includeAllIntegerColumns: els.globalIncInt.checked,
          includeScientificNotation: els.globalIncSci.checked,
        }
        updateSettings(newSettings)
        isSaved = true
        onUpdate()
        closePopover()
        break
      }

      case 'reset-global': {
        updateSettings(DEFAULT_SETTINGS)
        populateFields()
        onUpdate()
        break
      }

      case 'toggle-current-domain': {
        if (!els.whitelistTextarea) break
        const currentUrl = typeof window !== 'undefined'
          ? window.location.href
          : ''
        const currentHost =
          (typeof window !== 'undefined' && window.location.hostname) || ''
        const lines = els.whitelistTextarea.value.split('\n')
        const allowed = isUrlAllowed(currentUrl, lines)
        if (allowed) {
          // Comment out rules that match the current URL
          const commented = lines.map((l) =>
            matchesRule(currentUrl, l) ? `# ${l}` : l
          )
          els.whitelistTextarea.value = commented.join('\n')
        } else {
          // Add current domain rule
          const newRule = currentHost
            ? (currentHost.includes('.') ? `*://${currentHost}/*` : currentHost)
            : currentUrl
          const val = els.whitelistTextarea.value.trim()
          els.whitelistTextarea.value = val ? `${val}\n${newRule}` : newRule
        }
        updateWhitelistBadge()
        break
      }

      case 'reset-whitelist': {
        if (els.whitelistTextarea) {
          els.whitelistTextarea.value = DEFAULT_WHITELIST.join('\n')
          updateWhitelistBadge()
        }
        break
      }

      case 'save-whitelist': {
        if (els.whitelistTextarea) {
          const rules = els.whitelistTextarea.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
          updateSettings({ urlWhitelist: rules })
          isSaved = true
          onUpdate()
          closePopover()
        }
        break
      }
    }
  })

  // Close when clicking outside
  setTimeout(() => {
    closeHandler = (e: MouseEvent) => {
      if (
        currentPopover &&
        !currentPopover.contains(e.target as Node) &&
        !anchorEl.contains(e.target as Node)
      ) {
        closePopover()
      }
    }
    document.addEventListener('click', closeHandler)

    keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePopover()
    }
    document.addEventListener('keydown', keyHandler)
  }, 0)
}
