/**
 * arXiv Chart Visualizer — Main Entry
 *
 * Orchestrates settings, table discovery, UI injection, and visualization.
 */

import {
  getSettings,
  getTableCompositeKey,
  initMenuCommands,
  onSettingsChange,
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

console.log('[arXiv-Charts] Initializing arXiv Chart Visualizer...')
const settings = getSettings()
console.log('[arXiv-Charts] Current settings:', settings)

initMenuCommands()

// Register ⚙️ Open Global Settings menu command if GM API available
if (typeof GM_registerMenuCommand !== 'undefined') {
  GM_registerMenuCommand('⚙️ Open Global Settings', () => {
    // Create or reuse a floating anchor for the global settings popover
    let anchor = document.getElementById(
      'b-a-t-global-settings-anchor',
    )
    if (!anchor) {
      anchor = document.createElement('div')
      anchor.id = 'b-a-t-global-settings-anchor'
      anchor.style.cssText =
        'position: fixed; top: 60px; right: 20px; z-index: 10001;'
      document.body.appendChild(anchor)
    }
    toggleSettingsPopover(anchor, '', () => {
      updateAllVisualizations()
    })
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
  toggleSettingsPopover(btn, compositeKey, () => {
    updateAllVisualizations()
  })
}

function processPage(): void {
  const candidates = discoverTables()
  console.log(`[arXiv-Charts] Found ${candidates.length} candidate table(s).`)

  injectButtons(candidates, handleVisualize, handleSettings)

  // Auto-visualize if enabled ('bars' or 'heatmap')
  const autoVis = getSettings().autoVisualize
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

// Run on page load
processPage()

// Watch for dynamically injected tables
observeForNewTables((newCandidates) => {
  console.log(`[arXiv-Charts] Detected ${newCandidates.length} new table(s).`)
  injectButtons(newCandidates, handleVisualize, handleSettings)

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
})

// ---------------------------------------------------------------------------
// Settings change handler: update active visualizations in-place
// ---------------------------------------------------------------------------

onSettingsChange((updatedSettings) => {
  console.log('[arXiv-Charts] Settings updated in-place:', updatedSettings)
  updateAllVisualizations()
})
