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

function updateButtonGroupState(
  container: HTMLElement | null,
  activeMode: 'bars' | 'heatmap' | null,
): void {
  if (!container) return;
  const barsBtn = container.querySelector('.bars-btn') as HTMLButtonElement | null;
  const heatmapBtn = container.querySelector('.heatmap-btn') as HTMLButtonElement | null;

  if (barsBtn) {
    if (activeMode === 'bars') {
      barsBtn.classList.add('active');
      barsBtn.classList.remove('inactive');
      barsBtn.style.filter = 'none';
    } else {
      barsBtn.classList.remove('active');
      barsBtn.classList.add('inactive');
      barsBtn.style.filter = 'grayscale(100%)';
    }
  }

  if (heatmapBtn) {
    if (activeMode === 'heatmap') {
      heatmapBtn.classList.add('active');
      heatmapBtn.classList.remove('inactive');
      heatmapBtn.style.filter = 'none';
    } else {
      heatmapBtn.classList.remove('active');
      heatmapBtn.classList.add('inactive');
      heatmapBtn.style.filter = 'grayscale(100%)';
    }
  }
}

function handleVisualize(
  candidate: CandidateTable,
  mode: 'bars' | 'heatmap',
  btn: HTMLButtonElement,
): void {
  const activeMode = toggleInlineBars(candidate.parsed, candidate.table, mode);
  const container = btn.closest('.arxiv-chart-actions') as HTMLElement | null;
  updateButtonGroupState(container, activeMode);
}

function processPage(): void {
  const candidates = discoverTables();
  console.log(`[arXiv-Charts] Found ${candidates.length} candidate table(s).`);

  injectButtons(candidates, handleVisualize);

  // Auto-visualize if enabled
  if (getSettings().autoVisualize) {
    const defaultMode = getSettings().renderMode;
    for (const candidate of candidates) {
      applyInlineBars(candidate.parsed, candidate.table, defaultMode);
      const container = candidate.table.parentElement?.querySelector('.arxiv-chart-actions') as HTMLElement | null;
      updateButtonGroupState(container, defaultMode);
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
