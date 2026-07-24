/**
 * Settings and state management for arXiv Chart Visualizer.
 * Supports persistent storage via GM_getValue/GM_setValue with fallback to localStorage.
 * Notifies subscribers immediately on change without page reloads.
 */

export interface Settings {
  autoVisualize: boolean;
  colorPalette: string;
}

export const DEFAULT_SETTINGS: Settings = {
  autoVisualize: false,
  colorPalette: 'Pastel1',
};

export const PRESET_PALETTES: Record<string, string[]> = {
  Pastel1: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2'],
  Pastel2: ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc'],
  Set1: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffff33', '#a65628', '#f781bf', '#999999'],
  Set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
  Set3: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
  tab10: ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'],
};


type SettingsChangeListener = (settings: Settings) => void;
const listeners: SettingsChangeListener[] = [];

const memoryStore = new Map<string, any>();

/**
 * Safely retrieve a setting value using GM_getValue or localStorage / memoryStore fallback.
 */
function getValue<T>(key: string, defaultValue: T): T {
  try {
    if (typeof GM_getValue !== 'undefined') {
      return GM_getValue(key, defaultValue);
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      const stored = localStorage.getItem(`arxiv_chart_${key}`);
      if (stored !== null) {
        return JSON.parse(stored);
      }
    }
  } catch (e) {
    // Fall through to memoryStore
  }
  return memoryStore.has(key) ? memoryStore.get(key) : defaultValue;
}

/**
 * Safely store a setting value using GM_setValue or localStorage / memoryStore fallback.
 */
function setValue<T>(key: string, value: T): void {
  try {
    if (typeof GM_setValue !== 'undefined') {
      GM_setValue(key, value);
      return;
    }
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(`arxiv_chart_${key}`, JSON.stringify(value));
      return;
    }
  } catch (e) {
    // Fall through to memoryStore
  }
  memoryStore.set(key, value);
}

/**
 * Clear in-memory storage (for testing).
 */
export function _resetStorageForTesting(): void {
  memoryStore.clear();
}


/**
 * Retrieve current user settings.
 */
export function getSettings(): Settings {
  return {
    autoVisualize: getValue('autoVisualize', DEFAULT_SETTINGS.autoVisualize),
    colorPalette: getValue('colorPalette', DEFAULT_SETTINGS.colorPalette),
  };
}

/**
 * Update user settings and notify subscribers immediately in-place.
 */
export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const updated: Settings = { ...current, ...partial };

  if (partial.autoVisualize !== undefined) {
    setValue('autoVisualize', updated.autoVisualize);
  }
  if (partial.colorPalette !== undefined) {
    setValue('colorPalette', updated.colorPalette);
  }

  notifyListeners(updated);
  return updated;
}

/**
 * Subscribe to settings changes.
 */
export function onSettingsChange(listener: SettingsChangeListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) {
      listeners.splice(idx, 1);
    }
  };
}

function notifyListeners(settings: Settings): void {
  for (const listener of listeners) {
    try {
      listener(settings);
    } catch (e) {
      console.error('[arXiv-Charts] Error in settings change listener:', e);
    }
  }
}

/**
 * Parse palette name or custom hex string into array of CSS color strings.
 */
export function resolvePaletteColors(paletteSetting: string): string[] {
  if (PRESET_PALETTES[paletteSetting]) {
    return PRESET_PALETTES[paletteSetting];
  }
  const customColors = paletteSetting
    .split(',')
    .map((c) => c.trim())
    .filter((c) => /^#?([0-9a-fA-F]{3,8})$|^rgba?\(|^hsla?\(/i.test(c))
    .map((c) => (/^[0-9a-fA-F]{3,8}$/i.test(c) ? `#${c}` : c));
  return customColors.length > 0 ? customColors : PRESET_PALETTES.Pastel1;
}



/**
 * Register Tampermonkey / Violentmonkey menu commands if available.
 * Changing settings updates state in-place without page reload.
 */
export function initMenuCommands(): void {
  if (typeof GM_registerMenuCommand === 'undefined') {
    return;
  }

  const settings = getSettings();
  const autoVisLabel = `Toggle Auto-Visualize (${settings.autoVisualize ? 'ON' : 'OFF'})`;
  const paletteLabel = `Color Palette (Current: ${settings.colorPalette})`;

  GM_registerMenuCommand(autoVisLabel, () => {
    const current = getSettings();
    const nextAutoVis = !current.autoVisualize;
    updateSettings({ autoVisualize: nextAutoVis });
    console.log(`[arXiv-Charts] Auto-visualize toggled to ${nextAutoVis}`);
  });

  GM_registerMenuCommand(paletteLabel, () => {
    const current = getSettings();
    const presets = Object.keys(PRESET_PALETTES);
    const currentIndex = presets.indexOf(current.colorPalette);
    const nextPalette = presets[(currentIndex + 1) % presets.length];
    updateSettings({ colorPalette: nextPalette });
    console.log(`[arXiv-Charts] Color palette changed to ${nextPalette}`);
  });
}
