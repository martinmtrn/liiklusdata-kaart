import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const WORKER = 'maplibre-gl-worker.mjs';
const workerPath = createRequire(import.meta.url).resolve(`maplibre-gl/dist/${WORKER}`, { paths: [process.cwd()] });

/** MapLibre 6 worker peab jõudma brauserisse muutmata kujul (Vite ei tohi sellesse oma koodi lisada) */
function maplibreWorker(): Plugin {
  return {
    name: 'maplibre-worker',
    configureServer(server) {
      server.middlewares.use(`/${WORKER}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(workerPath));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: WORKER, source: readFileSync(workerPath) });
    },
  };
}

/** Turvapäised failist vercel.json, et `npm run preview` käituks nagu avalik sait */
const vercelHeaders = Object.fromEntries(
  (JSON.parse(readFileSync(resolve(__dirname, 'vercel.json'), 'utf-8')).headers[0].headers as { key: string; value: string }[]).map((h) => [h.key, h.value]),
);

export default defineConfig({
  base: './',
  plugins: [maplibreWorker()],
  preview: { headers: vercelHeaders },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: { kaart: resolve(__dirname, 'index.html'), statistika: resolve(__dirname, 'statistika.html') },
    },
  },
});
