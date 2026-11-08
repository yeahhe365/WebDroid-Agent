/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: string }

/**
 * Vendor groups, kept deliberately coarse.
 *
 * The entry chunk used to carry React, the icon set and the app code together,
 * which left it a few hundred bytes under Vite's 500 kB warning and made every
 * new screen a threat to the build. Splitting the framework out gives the app
 * code room to grow without turning the budget into a tripwire.
 *
 * The markdown stack is deliberately *not* listed. Pulling it into a manual
 * chunk makes Vite preload it from `index.html`, which would undo the lazy
 * `MarkdownContent` import; left alone it stays inside that dynamic chunk.
 */
const vendorChunks: ReadonlyArray<readonly [RegExp, string]> = [
  [/node_modules\/(react|react-dom|scheduler)\//, 'react'],
  [/node_modules\/@yume-chan\//, 'adb'],
]

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? '0.0.0'),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          for (const [pattern, name] of vendorChunks) {
            if (pattern.test(id)) {
              return name
            }
          }
          return undefined
        },
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-server/**'],
  },
})
