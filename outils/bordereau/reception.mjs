// MODE D'EMPLOI (Windows, Mac ou Linux) — savoir si la réception par e-mail reconnaîtrait un bordereau de télétransmission,
// sans que le fichier quitte l'ordinateur :
//   1. Installe Node.js 22 (nodejs.org, « LTS »), télécharge le dépôt (GitHub › « Code » › « Download ZIP ») et décompresse-le.
//   2. Dans le dossier décompressé, ouvre un terminal (Windows : clic droit › « Ouvrir dans le Terminal ») et tape une fois : npm install
//   3. Puis : node outils/bordereau/reception.mjs "C:\chemin\du\bordereau.pdf" — s'affiche une seule conclusion :
//      « reconnu comme un bordereau », « non reconnu » ou « illisible par ce lecteur », avec le nombre de pages lues, le poids
//      du fichier et la durée. Aucun mot, aucune ligne ni aucun nombre du bordereau ne s'affiche.
//
// Ce qui précède est tout ce qu'il faut savoir pour s'en servir. Pour qui relit le code : l'étape 2 est la seule qui utilise
// le réseau (l'installation des dépendances du dépôt) ; l'outil lui-même n'en utilise aucun et n'écrit aucun fichier
// (outils/bordereau/reception.mts, gardé par src/lib/bordereauReceptionOutilLocal.test.ts). Il lit le PDF par le MÊME lecteur
// que receive-email (src/lib/texteDUnPdf.ts, sans pdf.js) et le juge par la MÊME règle (porteLaFormeDUnBordereau,
// src/lib/bordereauDeTeletransmission.ts), sous les mêmes bornes (BOR6R-Q1, réponse du cabinet du 21/11/2026).
//
// Le lanceur passe par Vite, déjà installé, comme outils/bordereau/lire.mjs ; le chemin passe par `fileURLToPath`, qui tient
// aussi sous Windows.
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

await runnerImport(fileURLToPath(new URL('./reception.mts', import.meta.url)), { configFile: false, logLevel: 'silent' })
