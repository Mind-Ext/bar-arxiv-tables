/**
 * Settings Popover UI Component for arXiv Chart Visualizer.
 *
 * Provides a modular, per-tab popover (Current Table / Visualization / Site Whitelist)
 * for configuring per-table and global default visualization settings with live preview.
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
  PRESET_DIVERGING_COLORMAPS,
  PRESET_PALETTES,
  PRESET_SEQUENTIAL_COLORMAPS,
  setLocalTableSettings,
  Settings,
  updateSettings,
} from '../settings'

// ---------------------------------------------------------------------------
// Module State & Types
// ---------------------------------------------------------------------------

let currentPopover: HTMLElement | null = null
let currentAnchor: HTMLElement | null = null
let closeHandler: ((e: MouseEvent) => void) | null = null
let keyHandler: ((e: KeyboardEvent) => void) | null = null
let cleanupOnClose: (() => void) | null = null

export interface ColorSchemeGroupValues {
  barColorScheme: string
  heatmapColorScheme: string
  divergingColorScheme: string
}

export interface TabRenderContext {
  compositeKey: string
  options: {
    bar: string
    heatSeq: string
    heatDiv: string
  }
}

export interface SettingsTab {
  id: 'local' | 'global' | 'whitelist'
  label: string
  isAvailable: (ctx: TabRenderContext) => boolean
  renderPanel: (isActive: boolean, ctx: TabRenderContext) => string
}

// ---------------------------------------------------------------------------
// CSS Styles
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Option Generators & Shared Field Helpers
// ---------------------------------------------------------------------------

function getOptionsHTML(
  category: 'palette' | 'sequential' | 'diverging',
): string {
  const options: string[] = []
  if (category === 'palette') {
    options.push('<optgroup label="Palettes">')
    for (const key of Object.keys(PRESET_PALETTES)) {
      options.push(`<option value="${key}">${key}</option>`)
    }
    options.push('</optgroup>')
    options.push('<optgroup label="Colormaps">')
    for (const key of Object.keys(PRESET_COLORMAPS)) {
      options.push(`<option value="${key}">${key}</option>`)
    }
    options.push('</optgroup>')
  } else if (category === 'sequential') {
    options.push('<optgroup label="Sequential">')
    for (const key of Object.keys(PRESET_SEQUENTIAL_COLORMAPS)) {
      options.push(`<option value="${key}">${key}</option>`)
    }
    options.push('</optgroup>')
  } else if (category === 'diverging') {
    options.push('<optgroup label="Diverging">')
    for (const key of Object.keys(PRESET_DIVERGING_COLORMAPS)) {
      options.push(`<option value="${key}">${key}</option>`)
    }
    options.push('</optgroup>')
  }
  options.push('<option value="custom">Custom...</option>')
  return options.join('')
}

function renderColorSchemeGroup(
  prefix: string,
  options: { bar: string; heatSeq: string; heatDiv: string },
): string {
  const p = prefix ? `${prefix}-` : ''
  return `
    <div class="b-a-t-settings-field">
      <label>Bar Color Scheme</label>
      <select name="${p}barColorScheme">
        ${options.bar}
      </select>
      <input type="text" class="b-a-t-settings-custom-input" data-custom-input="${p}barColorScheme" placeholder="#ff5733, #33ff57">
    </div>

    <div class="b-a-t-settings-field">
      <label>Heatmap Color Scheme (Sequential)</label>
      <select name="${p}heatmapColorScheme">
        ${options.heatSeq}
      </select>
      <input type="text" class="b-a-t-settings-custom-input" data-custom-input="${p}heatmapColorScheme" placeholder="#ff5733, #33ff57">
    </div>

    <div class="b-a-t-settings-field">
      <label>Heatmap Color Scheme (Diverging)</label>
      <select name="${p}divergingColorScheme">
        ${options.heatDiv}
      </select>
      <input type="text" class="b-a-t-settings-custom-input" data-custom-input="${p}divergingColorScheme" placeholder="#ff5733, #33ff57">
    </div>
  `
}

// ---------------------------------------------------------------------------
// Per-Tab Definitions
// ---------------------------------------------------------------------------

const localTab: SettingsTab = {
  id: 'local',
  label: 'Current Table',
  isAvailable: (ctx) => Boolean(ctx.compositeKey),
  renderPanel: (isActive, ctx) => `
    <div class="b-a-t-settings-panel ${
    isActive ? 'active' : ''
  }" data-panel="local">
      <div id="local-status-badge" class="b-a-t-settings-badge b-a-t-badge-global">Using Global Defaults</div>

      ${renderColorSchemeGroup('local', ctx.options)}

      <div class="b-a-t-settings-footer">
        <button class="b-a-t-btn" data-action="reset-local">Reset to Global</button>
        <button class="b-a-t-btn b-a-t-btn-primary" data-action="apply">Save for Table</button>
      </div>
    </div>
  `,
}

const globalTab: SettingsTab = {
  id: 'global',
  label: 'Visualization',
  isAvailable: () => true,
  renderPanel: (isActive, ctx) => `
    <div class="b-a-t-settings-panel ${
    isActive ? 'active' : ''
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

        ${renderColorSchemeGroup('', ctx.options)}

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
  `,
}

const whitelistTab: SettingsTab = {
  id: 'whitelist',
  label: 'Site Whitelist',
  isAvailable: () => true,
  renderPanel: (isActive) => `
    <div class="b-a-t-settings-panel ${
    isActive ? 'active' : ''
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
  `,
}

const SETTINGS_TABS: SettingsTab[] = [localTab, globalTab, whitelistTab]

// ---------------------------------------------------------------------------
// Grouped State Readers & Writers
// ---------------------------------------------------------------------------

function getGroupSchemeValues(
  root: HTMLElement,
  prefix = '',
): ColorSchemeGroupValues {
  const p = prefix ? `${prefix}-` : ''
  const readField = (name: string): string => {
    const sel = root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)
    const input = root.querySelector<HTMLInputElement>(
      `input[data-custom-input="${name}"]`,
    )
    if (!sel) return ''
    return sel.value === 'custom' ? (input?.value ?? '') : sel.value
  }
  return {
    barColorScheme: readField(`${p}barColorScheme`),
    heatmapColorScheme: readField(`${p}heatmapColorScheme`),
    divergingColorScheme: readField(`${p}divergingColorScheme`),
  }
}

function setGroupSchemeValues(
  root: HTMLElement,
  values: ColorSchemeGroupValues,
  prefix = '',
): void {
  const p = prefix ? `${prefix}-` : ''
  const writeField = (name: string, val: string) => {
    const sel = root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)
    const input = root.querySelector<HTMLInputElement>(
      `input[data-custom-input="${name}"]`,
    )
    if (!sel || !input) return
    const isPreset = Array.from(sel.options).some((o) => o.value === val)
    if (isPreset) {
      sel.value = val
      input.classList.remove('active')
    } else {
      sel.value = 'custom'
      input.value = val
      input.classList.add('active')
    }
  }
  writeField(`${p}barColorScheme`, values.barColorScheme)
  writeField(`${p}heatmapColorScheme`, values.heatmapColorScheme)
  writeField(`${p}divergingColorScheme`, values.divergingColorScheme)
}

// ---------------------------------------------------------------------------
// Popover Lifecycle & Mounting
// ---------------------------------------------------------------------------

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
 * Toggle the settings popover for a specific table or globally.
 *
 * @param anchorEl - The element to anchor the popover to (gear button or global anchor container).
 * @param compositeKey - The composite key identifying this table (empty for global settings).
 * @param onUpdate - Callback invoked after settings are applied/saved/reset/previewed.
 * @param initialTab - Optional tab to activate on opening.
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

  const context: TabRenderContext = {
    compositeKey,
    options: {
      bar: getOptionsHTML('palette'),
      heatSeq: getOptionsHTML('sequential'),
      heatDiv: getOptionsHTML('diverging'),
    },
  }

  const availableTabs = SETTINGS_TABS.filter((tab) => tab.isAvailable(context))
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
    availableTabs
      .map(
        (t) => `
        <div class="b-a-t-settings-tab ${
          t.id === defaultTab ? 'active' : ''
        }" data-tab="${t.id}">
          ${t.label}
        </div>`,
      )
      .join('')
  }
    </div>
    ${
    availableTabs
      .map((t) => t.renderPanel(t.id === defaultTab, context))
      .join('')
  }
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
    popover.style.top = `${Math.max(0, rect.top - popoverRect.height - 4)}px`
  }
  if (popoverRect.left < 0) {
    popover.style.right = 'auto'
    popover.style.left = '4px'
  }

  // --- Drag support via header ---
  const header = popover.querySelector('.b-a-t-settings-header') as HTMLElement
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

  // --- Helpers for State Sync & Badges ---

  const localBadge = popover.querySelector<HTMLElement>('#local-status-badge')
  const whitelistBadge = popover.querySelector<HTMLElement>(
    '#whitelist-status-badge',
  )
  const toggleDomainBtn = popover.querySelector<HTMLButtonElement>(
    '[data-action="toggle-current-domain"]',
  )
  const whitelistTextarea = popover.querySelector<HTMLTextAreaElement>(
    'textarea[name="urlWhitelist"]',
  )

  const updateLocalBadge = (): void => {
    if (!localBadge || !compositeKey) return
    const globalSettings = getSettings()
    const currentLocal = getGroupSchemeValues(popover, 'local')

    const isCustom = Boolean(
      getLocalTableSettings(compositeKey) ||
        currentLocal.barColorScheme !== globalSettings.barColorScheme ||
        currentLocal.heatmapColorScheme !==
          globalSettings.heatmapColorScheme ||
        currentLocal.divergingColorScheme !==
          globalSettings.divergingColorScheme,
    )

    if (isCustom) {
      localBadge.textContent = 'Custom Override Active'
      localBadge.className = 'b-a-t-settings-badge b-a-t-badge-custom'
    } else {
      localBadge.textContent = 'Using Global Defaults'
      localBadge.className = 'b-a-t-settings-badge b-a-t-badge-global'
    }
  }

  const updateWhitelistBadge = (): void => {
    if (!whitelistBadge || !whitelistTextarea) return
    const currentUrl = typeof window !== 'undefined' ? window.location.href : ''
    const currentHost =
      (typeof window !== 'undefined' && window.location.hostname) || 'this page'
    const rules = whitelistTextarea.value.split('\n')
    const allowed = isUrlAllowed(currentUrl, rules)

    if (allowed) {
      whitelistBadge.textContent = '🟢 Whitelisted'
      whitelistBadge.className = 'b-a-t-settings-badge b-a-t-badge-custom'
      if (toggleDomainBtn) {
        toggleDomainBtn.textContent = `➖ Remove ${currentHost} from Whitelist`
      }
    } else {
      whitelistBadge.textContent = '⚪ Not Whitelisted'
      whitelistBadge.className = 'b-a-t-settings-badge b-a-t-badge-global'
      if (toggleDomainBtn) {
        toggleDomainBtn.textContent = `➕ Whitelist ${currentHost}`
      }
    }
  }

  const triggerLivePreviewLocal = (): void => {
    if (!compositeKey) return
    const values = getGroupSchemeValues(popover, 'local')
    setLocalTableSettings(compositeKey, values)
    updateLocalBadge()
    onUpdate()
  }

  const triggerLivePreviewGlobal = (): void => {
    const chartOpInput = popover.querySelector<HTMLInputElement>(
      'input[name="chartOpacity"]',
    )
    const btnOpInput = popover.querySelector<HTMLInputElement>(
      'input[name="buttonOpacity"]',
    )
    const autoVisSelect = popover.querySelector<HTMLSelectElement>(
      'select[name="autoVisualize"]',
    )
    const incIntCheckbox = popover.querySelector<HTMLInputElement>(
      'input[name="includeAllIntegerColumns"]',
    )
    const incSciCheckbox = popover.querySelector<HTMLInputElement>(
      'input[name="includeScientificNotation"]',
    )

    const chartOp = chartOpInput ? parseFloat(chartOpInput.value) : NaN
    const btnOp = btnOpInput ? parseFloat(btnOpInput.value) : NaN
    const schemes = getGroupSchemeValues(popover, '')

    const draftGlobal: Partial<Settings> = {
      autoVisualize: (autoVisSelect?.value as AutoVisualizeMode) ||
        DEFAULT_SETTINGS.autoVisualize,
      ...schemes,
      chartOpacity: isNaN(chartOp) ? DEFAULT_SETTINGS.chartOpacity : chartOp,
      buttonOpacity: isNaN(btnOp) ? DEFAULT_SETTINGS.buttonOpacity : btnOp,
      includeAllIntegerColumns: Boolean(incIntCheckbox?.checked),
      includeScientificNotation: Boolean(incSciCheckbox?.checked),
    }

    updateSettings(draftGlobal)
    updateLocalBadge()
    onUpdate()
  }

  const populateFields = (): void => {
    const globalSettings = getSettings()

    // Local tab fields
    if (compositeKey) {
      const effective = getEffectiveSettings(compositeKey)
      setGroupSchemeValues(popover, effective, 'local')
      updateLocalBadge()
    }

    // Global tab fields
    setGroupSchemeValues(popover, globalSettings, '')
    const autoVisSelect = popover.querySelector<HTMLSelectElement>(
      'select[name="autoVisualize"]',
    )
    if (autoVisSelect) autoVisSelect.value = globalSettings.autoVisualize

    const chartOpInput = popover.querySelector<HTMLInputElement>(
      'input[name="chartOpacity"]',
    )
    if (chartOpInput) {
      chartOpInput.value = globalSettings.chartOpacity.toString()
    }

    const btnOpInput = popover.querySelector<HTMLInputElement>(
      'input[name="buttonOpacity"]',
    )
    if (btnOpInput) {
      btnOpInput.value = globalSettings.buttonOpacity.toString()
    }

    const incIntCheckbox = popover.querySelector<HTMLInputElement>(
      'input[name="includeAllIntegerColumns"]',
    )
    if (incIntCheckbox) {
      incIntCheckbox.checked = globalSettings.includeAllIntegerColumns
    }

    const incSciCheckbox = popover.querySelector<HTMLInputElement>(
      'input[name="includeScientificNotation"]',
    )
    if (incSciCheckbox) {
      incSciCheckbox.checked = globalSettings.includeScientificNotation
    }

    // Whitelist tab fields
    if (whitelistTextarea) {
      whitelistTextarea.value = (
        globalSettings.urlWhitelist ?? DEFAULT_WHITELIST
      ).join('\n')
      updateWhitelistBadge()
    }
  }

  // --- Initial population ---
  populateFields()

  // --- Live Preview & Input Event Bindings ---

  popover.querySelectorAll<HTMLSelectElement>('select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const customInput = popover.querySelector<HTMLElement>(
        `input[data-custom-input="${sel.name}"]`,
      )
      if (customInput) {
        customInput.classList.toggle('active', sel.value === 'custom')
      }
      const panel = sel.closest('[data-panel]')?.getAttribute('data-panel')
      if (panel === 'local') {
        triggerLivePreviewLocal()
      } else if (panel === 'global') {
        triggerLivePreviewGlobal()
      }
    })
  })

  popover
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    .forEach((input) => {
      const handler = () => {
        const panel = input.closest('[data-panel]')?.getAttribute('data-panel')
        if (panel === 'local') {
          triggerLivePreviewLocal()
        } else if (panel === 'global') {
          triggerLivePreviewGlobal()
        } else if (panel === 'whitelist') {
          updateWhitelistBadge()
        }
      }
      input.addEventListener('input', handler)
      input.addEventListener('change', handler)
    })

  // Delegated click handler for tabs and actions
  popover.addEventListener('click', (e) => {
    const target = e.target as HTMLElement

    // Tab switching
    const tabEl = target.closest<HTMLElement>('[data-tab]')
    if (tabEl) {
      const tabName = tabEl.dataset.tab
      popover.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === tabName)
      })
      popover.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === tabName)
      })
      return
    }

    // Actions
    const action = target.closest('[data-action]')?.getAttribute('data-action')
    if (!action) return

    switch (action) {
      case 'close':
        closePopover()
        break

      case 'apply': {
        if (compositeKey) {
          const values = getGroupSchemeValues(popover, 'local')
          setLocalTableSettings(compositeKey, values)
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
        const chartOpInput = popover.querySelector<HTMLInputElement>(
          'input[name="chartOpacity"]',
        )
        const btnOpInput = popover.querySelector<HTMLInputElement>(
          'input[name="buttonOpacity"]',
        )
        const autoVisSelect = popover.querySelector<HTMLSelectElement>(
          'select[name="autoVisualize"]',
        )
        const incIntCheckbox = popover.querySelector<HTMLInputElement>(
          'input[name="includeAllIntegerColumns"]',
        )
        const incSciCheckbox = popover.querySelector<HTMLInputElement>(
          'input[name="includeScientificNotation"]',
        )

        const chartOp = chartOpInput ? parseFloat(chartOpInput.value) : NaN
        const btnOp = btnOpInput ? parseFloat(btnOpInput.value) : NaN
        const schemes = getGroupSchemeValues(popover, '')

        const newSettings: Partial<Settings> = {
          autoVisualize: (autoVisSelect?.value as AutoVisualizeMode) ||
            DEFAULT_SETTINGS.autoVisualize,
          ...schemes,
          chartOpacity: isNaN(chartOp)
            ? DEFAULT_SETTINGS.chartOpacity
            : chartOp,
          buttonOpacity: isNaN(btnOp) ? DEFAULT_SETTINGS.buttonOpacity : btnOp,
          includeAllIntegerColumns: Boolean(incIntCheckbox?.checked),
          includeScientificNotation: Boolean(incSciCheckbox?.checked),
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
        if (!whitelistTextarea) break
        const currentUrl = typeof window !== 'undefined'
          ? window.location.href
          : ''
        const currentHost =
          (typeof window !== 'undefined' && window.location.hostname) || ''
        const lines = whitelistTextarea.value.split('\n')
        const allowed = isUrlAllowed(currentUrl, lines)
        if (allowed) {
          // Comment out rules that match the current URL
          const commented = lines.map((l) =>
            matchesRule(currentUrl, l) ? `# ${l}` : l
          )
          whitelistTextarea.value = commented.join('\n')
        } else {
          // Add current domain rule
          const newRule = currentHost
            ? (currentHost.includes('.') ? `*://${currentHost}/*` : currentHost)
            : currentUrl
          const val = whitelistTextarea.value.trim()
          whitelistTextarea.value = val ? `${val}\n${newRule}` : newRule
        }
        updateWhitelistBadge()
        break
      }

      case 'reset-whitelist': {
        if (whitelistTextarea) {
          whitelistTextarea.value = DEFAULT_WHITELIST.join('\n')
          updateWhitelistBadge()
        }
        break
      }

      case 'save-whitelist': {
        if (whitelistTextarea) {
          const rules = whitelistTextarea.value
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

  // Close when clicking outside or pressing Escape
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
