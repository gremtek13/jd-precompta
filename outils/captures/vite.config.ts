// Banc de capture — sert la VRAIE application, avec src/lib/supabase.ts remplacé par un faux client
// chargé de données FICTIVES (fauxSupabase.ts). Mode d'emploi : voir vitrine.mjs.
//
// Le remplacement se fait par alias sur le chemin d'import, pas par une variable d'environnement : le
// vrai client lève au chargement sans VITE_SUPABASE_URL, et aucun écran ne doit toucher la base de
// production pour une capture.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ici = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.resolve(ici, '../..'),
  plugins: [react()],
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+lib\/supabase$|^\.\/supabase$/, replacement: path.join(ici, 'fauxSupabase.ts') }],
  },
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
})
