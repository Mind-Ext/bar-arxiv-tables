/**
 * bar-arxiv-tables — Main Entry
 *
 * Orchestrates settings, table discovery, UI injection, and visualization.
 */

import {
  getSettings,
  getTableCompositeKey,
  isUrlAllowed,
  matchesRule,
  onSettingsChange,
  updateSettings,
} from './settings'
import {
  CandidateTable,
  discoverTables,
  injectButtons,
  observeForNewTables,
} from './parser'
import {
  applyInlineBars,
  toggleInlineBars,
  updateAllVisualizations,
} from './chart'
import { toggleSettingsPopover } from './ui/settingsPopover'

console.log('[bar-arxiv-tables] Initializing bar-arxiv-tables...')
const settings = getSettings()
const currentUrl = typeof window !== 'undefined' ? window.location.href : ''
let isWhitelisted = isUrlAllowed(currentUrl, settings.urlWhitelist)
console.log(
  `[bar-arxiv-tables] Whitelist status: ${
    isWhitelisted ? 'WHITELISTED' : 'DISABLED'
  } (${currentUrl})`,
)

function openGlobalSettings(
  initialTab: 'global' | 'whitelist' = 'whitelist',
): void {
  let anchor = document.getElementById('b-a-t-global-settings-anchor')
  if (!anchor) {
    anchor = document.createElement('div')
    anchor.id = 'b-a-t-global-settings-anchor'
    anchor.style.cssText =
      'position: fixed; top: 60px; right: 20px; z-index: 10001;'
    document.body.appendChild(anchor)
  }
  toggleSettingsPopover(
    anchor,
    '',
    () => {
      updateAllVisualizations()
    },
    initialTab,
  )
}

// ---------------------------------------------------------------------------
// Browser / Userscript Menu Commands
// ---------------------------------------------------------------------------

let whitelistMenuCommandId: number | undefined

function registerWhitelistMenuCommands(): void {
  if (
    typeof GM_registerMenuCommand === 'undefined' ||
    typeof window === 'undefined'
  ) return

  const currentHost = window.location.hostname || 'this site'

  // Unregister previous toggle command if it exists
  if (
    whitelistMenuCommandId !== undefined &&
    typeof GM_unregisterMenuCommand !== 'undefined'
  ) {
    GM_unregisterMenuCommand(whitelistMenuCommandId)
  }

  if (isWhitelisted) {
    whitelistMenuCommandId = GM_registerMenuCommand(
      `🟢 Whitelisted on ${currentHost} (Click to Disable)`,
      () => {
        const current = getSettings()
        const updated = current.urlWhitelist.map((rule) =>
          matchesRule(currentUrl, rule) ? `# ${rule}` : rule
        )
        updateSettings({ urlWhitelist: updated })
      },
    )
  } else {
    whitelistMenuCommandId = GM_registerMenuCommand(
      `⚪ Enable on ${currentHost} (Click to Whitelist)`,
      () => {
        const current = getSettings()
        const newRule = currentHost.includes('.')
          ? `*://${currentHost}/*`
          : currentHost
        updateSettings({ urlWhitelist: [...current.urlWhitelist, newRule] })
      },
    )
  }
}

registerWhitelistMenuCommands()

if (typeof GM_registerMenuCommand !== 'undefined') {
  GM_registerMenuCommand('⚙️ Open Settings', () => {
    openGlobalSettings(isWhitelisted ? 'global' : 'whitelist')
  })
}

// ---------------------------------------------------------------------------
// Core: discover tables and inject buttons
// ---------------------------------------------------------------------------

function updateButtonGroupState(
  container: HTMLElement | null,
  activeMode: 'bars' | 'heatmap' | null,
): void {
  if (!container) return
  const barsBtn = container.querySelector('.b-a-t-bars-btn') as
    | HTMLButtonElement
    | null
  const heatmapBtn = container.querySelector('.b-a-t-heatmap-btn') as
    | HTMLButtonElement
    | null

  if (barsBtn) {
    if (activeMode === 'bars') {
      barsBtn.classList.add('active')
      barsBtn.classList.remove('inactive')
      barsBtn.style.filter = 'none'
    } else {
      barsBtn.classList.remove('active')
      barsBtn.classList.add('inactive')
      barsBtn.style.filter = 'grayscale(100%)'
    }
  }

  if (heatmapBtn) {
    if (activeMode === 'heatmap') {
      heatmapBtn.classList.add('active')
      heatmapBtn.classList.remove('inactive')
      heatmapBtn.style.filter = 'none'
    } else {
      heatmapBtn.classList.remove('active')
      heatmapBtn.classList.add('inactive')
      heatmapBtn.style.filter = 'grayscale(100%)'
    }
  }
}

function handleVisualize(
  candidate: CandidateTable,
  mode: 'bars' | 'heatmap',
  btn: HTMLButtonElement,
): void {
  const compositeKey = getTableCompositeKey(candidate.id)
  const activeMode = toggleInlineBars(
    candidate.parsed,
    candidate.table,
    mode,
    compositeKey,
  )
  const container = btn.closest('.b-a-t-actions') as
    | HTMLElement
    | null
  updateButtonGroupState(container, activeMode)
}

function handleSettings(
  candidate: CandidateTable,
  btn: HTMLButtonElement,
): void {
  const compositeKey = getTableCompositeKey(candidate.id)
  toggleSettingsPopover(
    btn,
    compositeKey,
    () => {
      updateAllVisualizations()
    },
    undefined,
    candidate.parsed.metricAxis,
  )
}

function processPage(): void {
  const currentSettings = getSettings()
  const candidates = discoverTables(
    document,
    currentSettings.includeAllIntegerColumns,
  )
  console.log(
    `[bar-arxiv-tables] Found ${candidates.length} candidate table(s).`,
  )

  injectButtons(candidates, handleVisualize, handleSettings)

  // Auto-visualize if enabled ('bars' or 'heatmap')
  const autoVis = currentSettings.autoVisualize
  if (autoVis !== 'off') {
    for (const candidate of candidates) {
      const compositeKey = getTableCompositeKey(candidate.id)
      applyInlineBars(candidate.parsed, candidate.table, autoVis, compositeKey)
      const container = candidate.table.parentElement?.querySelector(
        '.b-a-t-actions',
      ) as HTMLElement | null
      updateButtonGroupState(container, autoVis)
    }
  }
}

let tableObserver: MutationObserver | null = null
let isActivated = false

/** Activate table processing on the current page (idempotent). */
function activatePage(): void {
  if (isActivated) return
  isActivated = true

  // Run on page load
  processPage()

  // Watch for dynamically injected tables
  tableObserver = observeForNewTables((newCandidates) => {
    console.log(
      `[bar-arxiv-tables] Detected ${newCandidates.length} new table(s).`,
    )
    injectButtons(
      newCandidates,
      handleVisualize,
      handleSettings,
    )

    const autoVis = getSettings().autoVisualize
    if (autoVis !== 'off') {
      for (const candidate of newCandidates) {
        const compositeKey = getTableCompositeKey(candidate.id)
        applyInlineBars(
          candidate.parsed,
          candidate.table,
          autoVis,
          compositeKey,
        )
      }
    }
  }, getSettings().includeAllIntegerColumns)
}

if (isWhitelisted) {
  activatePage()
} else {
  console.log(
    '[bar-arxiv-tables] Page URL not in whitelist. Skipping table detection.',
  )
}

// ---------------------------------------------------------------------------
// Settings change handler: update active visualizations in-place
// ---------------------------------------------------------------------------

onSettingsChange((updatedSettings) => {
  console.log('[bar-arxiv-tables] Settings updated in-place:', updatedSettings)

  // Re-evaluate whitelist status reactively
  const wasWhitelisted = isWhitelisted
  isWhitelisted = isUrlAllowed(currentUrl, updatedSettings.urlWhitelist)

  if (isWhitelisted && !wasWhitelisted) {
    console.log('[bar-arxiv-tables] Page is now whitelisted — activating.')
    activatePage()
  } else if (isWhitelisted) {
    processPage()
  }

  // Update menu command label to reflect current whitelist state
  if (isWhitelisted !== wasWhitelisted) {
    registerWhitelistMenuCommands()
  }

  updateAllVisualizations()
})
