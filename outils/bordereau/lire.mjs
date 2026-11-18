// MODE D'EMPLOI (Windows, Mac ou Linux) — lire un bordereau de télétransmission sans qu'il quitte l'ordinateur :
//   1. Installe Node.js 22 (nodejs.org, « LTS »), télécharge le dépôt (GitHub › « Code » › « Download ZIP ») et décompresse-le.
//   2. Dans le dossier décompressé, ouvre un terminal (Windows : clic droit › « Ouvrir dans le Terminal ») et tape une fois : npm install
//   3. Puis : node outils/bordereau/lire.mjs "C:\chemin\du\bordereau.pdf" — s'affichent l'en-tête du lot et ses totaux, ou la raison du refus.
//
// Ce qui précède est tout ce qu'il faut savoir pour s'en servir. Pour qui relit le code : l'étape 2 est la seule qui utilise
// le réseau (l'installation des dépendances du dépôt) ; l'outil lui-même n'en utilise aucun, n'écrit aucun fichier et
// n'affiche jamais une ligne de facture (outils/bordereau/outil.mts, outils/bordereau/sortie.mts, gardés par
// src/lib/bordereauOutilLocal.test.ts). Un refus se rapporte au cabinet ou à la session par sa SEULE raison, qui dit le
// bordereau, la page et le rang d'une ligne, jamais une valeur (conception 59, BOR1-Q4 (B), réponse du cabinet du 18/11/2026).
//
// Le lanceur passe par Vite, déjà installé (`tsx` n'est pas une dépendance), qui transpile les modules de src/ comme Vitest
// le fait — la façon de outils/fec/lancer.mjs ; le chemin passe par `fileURLToPath`, qui tient aussi sous Windows.
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

await runnerImport(fileURLToPath(new URL('./outil.mts', import.meta.url)), { configFile: false, logLevel: 'silent' })
