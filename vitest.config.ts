import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        test: {
          name: 'core',
          globals: true,
          environment: 'node',
          setupFiles: ['./src/core/test-home.ts'],
          include: ['src/{core,cli,main,shared}/**/*.test.ts']
        }
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, 'src/renderer/src')
          }
        },
        test: {
          name: 'renderer',
          globals: true,
          environment: 'jsdom',
          // Node 25+ ships a global localStorage (undefined without --localstorage-file) that hides jsdom's in renderer tests
          execArgv: ['--no-experimental-webstorage'],
          setupFiles: ['./src/renderer/src/test/setup.ts'],
          include: ['src/renderer/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
})
