import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, readdir, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig(({ command }) => ({
  define: { 'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development') },
  root: path('./web'),
  publicDir: false,
  plugins: [react(), {
    name: 'kolo-development-page',
    async closeBundle() {
      if (command !== 'build') return;
      await cp(path('./web/static'), path('./internal/hub/ui/assets'), { recursive: true });
      for (const page of ['index.html', 'join.html']) await cp(path(`./web/${page}`), path(`./internal/hub/ui/${page}`));
    },
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
      let licenses = await readFile(path('./web/NOTICE.md'), 'utf8');
      for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
        const license = (await readdir(directory)).sort().find((file) => /^(license|copying)(\.|$)/i.test(file));
        const licensePath = license ? join(directory, license)
          : path(`./web/licenses/${name.replace('@', '-').replace(/\//g, '_')}.txt`);
        licenses += `\n\n--- ${name} ---\n\n${await readFile(licensePath, 'utf8')}`;
      }
      this.emitFile({ type: 'asset', fileName: 'assets/react/LICENSES.txt', source: licenses });
    },
    handleHotUpdate({ file, server }) {
      // Controllers own page-lifetime listeners and terminals. Reload after a
      // source edit so a hot update cannot install a second set of listeners.
      if (file.startsWith(path('./web/'))) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (pathname === '/assets/auth.js') {
          response.writeHead(302, { Location: '/src/features/auth/join.ts' });
          response.end();
          return;
        }
        if (pathname?.startsWith('/assets/')) {
          try {
            const asset = decodeURIComponent(pathname.slice('/assets/'.length));
            if (asset.startsWith('/') || asset.includes('\\') || asset.split('/').includes('..')) return next();
            const content = await readFile(join(path('./web/static'), asset));
            const mime: Record<string, string> = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' };
            response.setHeader('Content-Type', mime[asset.split('.').pop()!] || 'text/plain');
            response.end(content);
            return;
          } catch { return next(); }
        }
        if (pathname !== '/') return next();
        try {
          const source = await readFile(path('./web/index.html'), 'utf8');
          const page = source.replace('/assets/react/workspace.js', '/src/index.tsx');
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
    outDir: path('./internal/hub/ui'),
    emptyOutDir: true,
    copyPublicDir: false,
    sourcemap: false,
    minify: true,
    rolldownOptions: { output: { minify: true, chunkFileNames: 'assets/[name]-[hash].js' } },
    lib: { entry: { workspace: path('./web/src/index.tsx'), auth: path('./web/src/features/auth/join.ts') }, formats: ['es'], fileName: (_format, name) => name === 'workspace' ? 'assets/react/workspace.js' : 'assets/auth.js' },
  },
}));
