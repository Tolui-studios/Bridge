import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // The Agent SDK must stay a real node_modules import: it locates and
        // spawns its bundled CLI relative to its own file path, which breaks
        // if it gets inlined into out/main.
        //
        // electron-updater is CJS and lazy-`require`s its provider modules by
        // name, which a bundler cannot follow — inlining it breaks at runtime.
        external: ['@anthropic-ai/claude-agent-sdk', 'electron-updater']
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
