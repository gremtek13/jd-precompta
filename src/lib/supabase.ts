import { createClient } from '@supabase/supabase-js'
import { verifierClePublique } from './clePublique'

const url = import.meta.env.VITE_SUPABASE_URL

if (!url) {
  throw new Error('VITE_SUPABASE_URL doit être définie (voir .env.example)')
}

export const supabase = createClient(url, verifierClePublique(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY))
