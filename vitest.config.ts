import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  test: {
    include: ['src/shared/**/*.test.ts', 'src/main/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000
  }
})
