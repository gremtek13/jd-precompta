// Lance le banc de charge (annee.mts) sans `tsx`, qui n'est pas une dépendance : Vite, déjà installé, résout et transpile
// les modules de src/ comme Vitest le fait. Les arguments passent au banc (les facteurs de volume). Mode d'emploi : l'en-tête
// d'annee.mts.
import { runnerImport } from 'vite'

await runnerImport(new URL('./annee.mts', import.meta.url).pathname, { configFile: false, logLevel: 'error' })
