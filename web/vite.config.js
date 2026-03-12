import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync } from 'fs'

// Plugin to copy data/ JSON files into public/data/ at build time
function copyDataPlugin() {
  return {
    name: 'copy-data',
    buildStart() {
      const dataDir = resolve(__dirname, '../data')
      const destDir = resolve(__dirname, 'public/data')
      mkdirSync(destDir, { recursive: true })
      try {
        const files = readdirSync(dataDir).filter(f => f.endsWith('.json'))
        for (const file of files) {
          copyFileSync(resolve(dataDir, file), resolve(destDir, file))
        }
      } catch (e) {
        console.warn('Warning: could not copy data files:', e.message)
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), copyDataPlugin()],
  // GitHub Pages serves from a subdirectory — set base to '/' for custom domain
  // or '/repo-name/' if hosting at username.github.io/repo-name
  base: './',
})
