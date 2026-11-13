// Lance l'épreuve du fichier (fecFictif.mts) sans `tsx`, qui n'est pas une dépendance : Vite, déjà installé, résout et transpile
// les modules de src/ comme Vitest le fait (la façon de outils/charge/lancer.mjs). Les arguments passent à l'outil. Mode
// d'emploi : l'en-tête de fecFictif.mts.
import { runnerImport } from 'vite'

await runnerImport(new URL('./fecFictif.mts', import.meta.url).pathname, { configFile: false, logLevel: 'error' })
