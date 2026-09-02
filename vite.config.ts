import { defineConfig } from 'vitest/config';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Bar arXiv tables',
        namespace: 'npm/vite-plugin-monkey',
        version: '0.1.0',
        description: 'Visualize numerical tables on arXiv HTML papers with bar charts and other styles.',
        match: [
          '*://*/*',
          'file:///*',
        ],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
          'GM_unregisterMenuCommand',
        ],
        updateURL: 'https://github.com/Mind-Ext/bar-arxiv-tables/releases/latest/download/bar-arxiv-tables.user.js',
        downloadURL: 'https://github.com/Mind-Ext/bar-arxiv-tables/releases/latest/download/bar-arxiv-tables.user.js',
      },
      build: {
        fileName: 'bar-arxiv-tables.user.js',
      },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});

