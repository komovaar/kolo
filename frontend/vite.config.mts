import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ command }) => ({
  define: { 'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development') },
  root: path('.'),
  publicDir: path('../internal/hub/ui'),
  plugins: [react(), {
    name: 'kolo-development-page',
    generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'chunk') asset.code = asset.code.replace(/[\t ]+$/gm, '');
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/') return next();
        try {
          const source = await readFile(path('../internal/hub/ui/index.html'), 'utf8');
          const page = source.replace('/assets/react/workspace.js', '/src/main.tsx');
          response.setHeader('Content-Type', 'text/html');
          response.end(await server.transformIndexHtml(request.url!, page));
        } catch (error) { next(error as Error); }
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(['/v1', '/login', '/logout', '/join'].map((route) =>
      [route, { target: process.env.KOLO_DEV_HUB || 'http://127.0.0.1:7300', ws: true }])),
  },
  build: {
    outDir: path('../internal/hub/ui/assets/react'),
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    minify: true,
    rolldownOptions: { output: { minify: true } },
    lib: { entry: path('./src/main.tsx'), formats: ['es'], fileName: () => 'workspace.js' },
  },
}));
