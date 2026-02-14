import path from 'node:path'
import { crx, defineManifest } from '@crxjs/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import packageJson from './package.json'

interface PackageJson {
  name?: string
  displayName?: string
  version?: string
  description?: string
}

const pkg: PackageJson = packageJson

const manifest = defineManifest((env) => {
  const isDev = env.mode === 'development'

  return {
    name: `${pkg.displayName ?? pkg.name ?? ''}${isDev ? ' Dev' : ''}`,
    description: pkg.description ?? '',
    version: pkg.version ?? '0.0.0',
    manifest_version: 3,
    icons: {
      16: 'img/logo-16.png',
      32: 'img/logo-32.png',
      48: 'img/logo-48.png',
      128: 'img/logo-128.png',
    },
    action: {
      default_icon: 'img/logo-48.png',
    },
    options_page: 'options.html',
    background: {
      service_worker: 'src/background/index.ts',
      type: 'module',
    },
    web_accessible_resources: [
      {
        resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
        matches: [],
      },
    ],
    permissions: ['tabs', 'tabGroups', 'storage'],
  }
})

// https://vitejs.dev/config/
export default defineConfig(() => {
  return {
    build: {
      emptyOutDir: true,
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      cors: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    plugins: [crx({ manifest }), react(), tailwindcss()],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})
