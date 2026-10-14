import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ command }) => ({
  define: { 'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development') },
  root: path('.'),
  publicDir: path('../internal/hub/ui'),
  plugins: [react(), {
    name: 'kolo-development-page',
    async generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'chunk') asset.code = asset.code.replace(/[\t ]+$/gm, '');
      }
      const packages = new Map<string, string>();
      for (const module of this.getModuleIds()) {
        if (!module.includes('/node_modules/')) continue;
        let directory = dirname(module.split('?')[0]);
        while (directory.includes('/node_modules/')) {
          try {
            const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
            packages.set(`${metadata.name}@${metadata.version}`, directory);
            break;
          } catch { directory = dirname(directory); }
        }
      }
      let licenses = await readFile(path('./NOTICE.md'), 'utf8');
      for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        const license = (await readdir(directory)).sort().find((file) => /^(license|copying)(\.|$)/i.test(file));
        const licensePath = license ? join(directory, license)
          : path(`./licenses/${name.replace('@', '-').replace(/\//g, '_')}.txt`);
        licenses += `\n\n--- ${name} ---\n\n${await readFile(licensePath, 'utf8')}`;
      }
      this.emitFile({ type: 'asset', fileName: 'LICENSES.txt', source: licenses });
    },
    handleHotUpdate({ file, server }) {
      // The transitional controller has a single lifetime. Reload the page
      // rather than running global initialization twice during migration.
      if (file.startsWith(path('./src/'))) {
        server.ws.send({ type: 'full-reload' });
        return [];
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
