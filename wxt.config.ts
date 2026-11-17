import { defineConfig } from 'wxt';

// Un seul code source, deux builds : `wxt build` (Chrome) et `wxt build -b firefox`.
export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  // L'archive de sources pour AMO ne doit jamais embarquer les docs privées, les tests
  // ni l'historique legacy : seuls le code et les fichiers de build y entrent.
  zip: {
    excludeSources: [
      'docs/**',
      'tests/**',
      'legacy/**',
      'scripts/**',
      '.github/**',
      '.freebuff/**',
      '.cloud-attachments/**',
      'AGENTS.md',
      'README.md',
      'llms.txt',
      'eslint.config.js',
      'vitest.config.ts',
      '.prettierrc.json',
      '.prettierignore',
    ],
  },
  manifest: ({ browser }) => ({
    name: 'Kyara Plus',
    description:
      'Outils pour kyara.games : prix, doublons, conseils, statistiques et automatisations optionnelles.',
    permissions: ['storage'],
    host_permissions: ['https://kyara.games/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    // Le panneau injecté charge le logo SVG depuis l'URL de l'extension.
    web_accessible_resources: [
      {
        resources: ['icon/kyara-plus.svg'],
        matches: ['https://kyara.games/*'],
      },
    ],
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'kyara-plus@maxray.net',
          strict_min_version: '142.0',
          data_collection_permissions: { required: ['none'] },
        },
      },
    }),
  }),
});
