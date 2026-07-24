import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'arXiv Chart Visualizer',
        namespace: 'npm/vite-plugin-monkey',
        version: '0.1.0',
        match: [
          '*://arxiv.org/html/*',
          'file:///*',
        ],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
        ],
      },
    }),
  ],
});
