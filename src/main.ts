/**
 * arXiv Chart Visualizer — Main Entry
 *
 * Orchestrates settings, table discovery, UI injection, and visualization.
 */

import { getSettings, initMenuCommands, onSettingsChange } from './settings';
import { discoverTables, injectButtons, observeForNewTables, CandidateTable } from './parser';
import { toggleInlineBars, applyInlineBars, updateAllVisualizations } from './chart';

console.log('[arXiv-Charts] Initializing arXiv Chart Visualizer...');
const settings = getSettings();
console.log('[arXiv-Charts] Current settings:', settings);

initMenuCommands();

// ---------------------------------------------------------------------------
// Core: discover tables and inject buttons
// ---------------------------------------------------------------------------

function handleVisualize(candidate: CandidateTable, button: HTMLButtonElement): void {
  const isActive = toggleInlineBars(candidate.parsed, candidate.table);
  button.textContent = isActive ? '📊 Hide Bars' : '📊 Visualize';
}

function processPage(): void {
  const candidates = discoverTables();
  console.log(`[arXiv-Charts] Found ${candidates.length} candidate table(s).`);

  injectButtons(candidates, handleVisualize);

  // Auto-visualize if enabled
  if (getSettings().autoVisualize) {
    for (const candidate of candidates) {
      applyInlineBars(candidate.parsed, candidate.table);
      const btn = candidate.table.parentElement?.querySelector('.arxiv-chart-btn') as HTMLButtonElement | null;
      if (btn) btn.textContent = '📊 Hide Bars';
    }
  }
}

// Run on page load
processPage();

// Watch for dynamically injected tables
observeForNewTables((newCandidates) => {
  console.log(`[arXiv-Charts] Detected ${newCandidates.length} new table(s).`);
  injectButtons(newCandidates, handleVisualize);

  if (getSettings().autoVisualize) {
    for (const candidate of newCandidates) {
      applyInlineBars(candidate.parsed, candidate.table);
    }
  }
});

// ---------------------------------------------------------------------------
// Settings change handler: update active visualizations in-place
// ---------------------------------------------------------------------------

onSettingsChange((updatedSettings) => {
  console.log('[arXiv-Charts] Settings updated in-place:', updatedSettings);
  updateAllVisualizations();
});
