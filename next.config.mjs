import { createRequire } from 'module';
import { copyMaplibreWorker } from './scripts/copy-maplibre-worker.mjs';

// Application version shown in the web UI and OpenAPI spec (issue #259).
// CI/release builds pass APP_VERSION (git tag, e.g. 1.2.3) as a Docker build
// arg; otherwise fall back to the version declared in package.json.
const require = createRequire(import.meta.url);
const { version: pkgVersion } = require('./package.json');
const APP_VERSION = String(process.env.APP_VERSION || pkgVersion || 'unknown').replace(/^v/, '');

// When building under Node.js (not Bun), redirect bun:sqlite to a better-sqlite3 shim
// so `next build` works locally without Bun installed.
const isBun = typeof globalThis.Bun !== 'undefined';

// maplibre-gl v6 loads its tile worker from a separate file that Turbopack cannot
// resolve correctly; stage it under public/ so it is served from a stable URL.
// See scripts/copy-maplibre-worker.mjs for the full explanation.
copyMaplibreWorker(import.meta.dirname);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Inlined into client and server bundles at build time; referenced via
  // src/lib/app-version.ts. Values in the `env` key do not need a
  // NEXT_PUBLIC_ prefix to be inlined, but the prefix keeps intent explicit.
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  serverExternalPackages: isBun ? ['bun:sqlite'] : ['better-sqlite3'],
  ...(!isBun && {
    turbopack: {
      resolveAlias: {
        'bun:sqlite': './tests/helpers/bun-sqlite-compat.ts',
        'drizzle-orm/bun-sqlite/migrator': 'drizzle-orm/better-sqlite3/migrator',
        'drizzle-orm/bun-sqlite': 'drizzle-orm/better-sqlite3',
      },
    },
  }),
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },
  output: 'standalone',
  poweredByHeader: false,
  // Security headers (CSP, etc.) are set per-request in proxy.ts middleware
  // with a unique nonce, so they are NOT defined here as static headers.
};

export default nextConfig;
