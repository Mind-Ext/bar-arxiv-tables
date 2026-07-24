import { getSettings, initMenuCommands, onSettingsChange } from './settings';

console.log('[arXiv-Charts] Initializing arXiv Chart Visualizer...');
const settings = getSettings();
console.log('[arXiv-Charts] Current settings:', settings);

initMenuCommands();

onSettingsChange((updatedSettings) => {
  console.log('[arXiv-Charts] Settings updated in-place:', updatedSettings);
});

