import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** A build id baked into the app and emitted as /version.json, so a deploy can be proven live (deploy-verify hook). */
function buildId(): string {
  let sha = 'nogit';
  try {
    sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    /* not a git checkout */
  }
  return `${sha}-${Date.now().toString(36)}`;
}

function versionFile(build: string): Plugin {
  return {
    name: 'rassi-version',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) });
    },
  };
}

const BUILD = buildId();
/** Where the game is served from: '/' locally; '/pralaya/' on GitHub Pages (BASE env, set by the Pages workflow). */
const BASE = process.env.BASE ?? '/';

export default defineConfig({
  base: BASE,
  plugins: [
    versionFile(BUILD),
    // The game must work with no internet: precache the whole app (fonts and art are local), installable to the home screen.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'PRALAYA',
        short_name: 'PRALAYA',
        description:
          'The world ends. One walks out. A hot-seat adventure for 2 to 6 friends on one laptop: walk a broken world of floating islands, tame creatures in three-lane duels, outlast the world that eats the ground.',
        theme_color: '#07050c',
        background_color: '#07050c',
        display: 'fullscreen',
        orientation: 'any',
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,json,webp}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD) },
  build: { outDir: 'dist/client', sourcemap: true },
  server: { host: true },
  preview: { host: true },
});
