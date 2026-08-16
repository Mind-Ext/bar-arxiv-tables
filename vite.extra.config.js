import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/extra/popup-arxiv-citation.ts',
      userscript: {
        name: 'arXiv HTML Citation Popup',
        namespace: 'npm/vite-plugin-monkey',
        version: '0.1.0',
        description:
          'Shows bibliography entry in a popup when clicking citation links on arXiv HTML papers.',
        match: [
          '*://arxiv.org/html/*',
          '*://ar5iv.labs.arxiv.org/html/*',
          'file:///*.html',
        ],
        grant: 'none',
        updateURL:
          'https://github.com/Mind-Ext/bar-arxiv-tables/raw/main/dist/popup-arxiv-citation.user.js',
        downloadURL:
          'https://github.com/Mind-Ext/bar-arxiv-tables/raw/main/dist/popup-arxiv-citation.user.js',
      },
      build: {
        fileName: 'popup-arxiv-citation.user.js',
      },
    }),
  ],
  build: {
    emptyOutDir: false,
  },
})
