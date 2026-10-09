// Banc de capture — sert la VRAIE application, avec src/lib/supabase.ts remplacé par un faux client
// chargé de données FICTIVES (fauxSupabase.ts). Mode d'emploi : voir vitrine.mjs.
//
// Le remplacement se fait par alias sur le chemin d'import, pas par une variable d'environnement : le
// vrai client lève au chargement sans VITE_SUPABASE_URL, et aucun écran ne doit toucher la base de
// production pour une capture.
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import path from 'node:path'

const ici = path.dirname(fileURLToPath(import.meta.url))
const racine = path.resolve(ici, '../..')

// LES POLICES D'UN BANC JOUÉ DANS UNE COPIE ISOLÉE (le worktree d'un agent). Son `node_modules` est un dossier réel dont
// chaque paquet est un LIEN vers le `node_modules` du dépôt principal : Vite résout un lien vers sa cible, hors de la
// racine qu'il sert, et refuse alors les fichiers des polices (« outside of Vite serving allow list », une ligne par fichier
// à son journal). L'application s'affiche dans la police de repli du navigateur, et le banc mesure d'autres largeurs de
// texte que celles du site, SANS échouer. On autorise donc le `node_modules` RÉEL : celui où `realpathSync` trouve Vite
// lui-même — `realpathSync` du dossier ne dirait rien, il est réel, ce sont ses entrées qui sont des liens. Dans un dépôt
// ordinaire ce dossier est déjà sous la racine : rien n'est ajouté, la liste reste celle que Vite choisit.
function nodeModulesReel(): string | null {
  try {
    const reel = path.dirname(realpathSync(path.join(racine, 'node_modules', 'vite')))
    const depuisLaRacine = path.relative(realpathSync(racine), reel)
    return depuisLaRacine.startsWith('..') || path.isAbsolute(depuisLaRacine) ? reel : null
  } catch {
    return null
  }
}

const reel = nodeModulesReel()

// LES COPIES DE TRAVAIL DES AGENTS VIVENT DANS LE DÉPÔT (`.claude/worktrees/…`), donc sous la racine que Vite surveille.
// Qu'une copie se prépare pendant un passage du banc — un `index.html`, un `tsconfig.json` écrits — et le serveur voit le
// fichier changer, invalide tout et recharge la page en entier : le banc lève « Execution context was destroyed » au milieu
// d'une visite. On ne surveille donc pas `.claude`. Il est pris SOUS LA RACINE SERVIE, et non en motif `**/.claude/**` : une
// copie isolée est elle-même sous `.claude/worktrees/`, le motif ignorerait alors tous SES fichiers, et le serveur ne verrait
// plus une source modifiée (il servirait l'ancienne). `**/node_modules/**` est déjà dans la liste de Vite ; il reste écrit
// pour dire ce que la config veut.
const copiesDeTravail = path.join(racine, '.claude')
const sousLesCopiesDeTravail = (chemin: string) => chemin === copiesDeTravail || chemin.startsWith(copiesDeTravail + path.sep)

export default defineConfig({
  root: racine,
  plugins: [react()],
  resolve: {
    alias: [{ find: /^(?:\.\.\/)+lib\/supabase$|^\.\/supabase$/, replacement: path.join(ici, 'fauxSupabase.ts') }],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
    watch: { ignored: [sousLesCopiesDeTravail, '**/node_modules/**'] },
    // Une liste posée REMPLACE celle de Vite : la racine de l'espace de travail y revient, avec le dossier réel.
    ...(reel === null ? {} : { fs: { allow: [searchForWorkspaceRoot(racine), reel] } }),
  },
})
