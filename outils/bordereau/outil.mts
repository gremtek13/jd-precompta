// L'OUTIL LOCAL QUI LIT UN BORDEREAU DE TÉLÉTRANSMISSION (conception 59, BOR1-Q4 (B)). Lancé par outils/bordereau/lire.mjs,
// dont l'en-tête est le mode d'emploi. Il lit le PDF sur le disque de l'ordinateur où il tourne, par le MÊME code que
// l'application (src/lib/bordereauDeTeletransmissionLecture.ts, et pdf.js hors navigateur comme dans les tests), et
// n'affiche que ce que outils/bordereau/sortie.mts compose : l'en-tête du lot et ses totaux, ou la raison du refus.
//
// RIEN D'AUTRE NE S'AFFICHE ET RIEN NE PART : aucun réseau (pdf.js reçoit des octets, aucune adresse de police ni de table),
// aucun fichier écrit, ni le chemin ni le nom du fichier répétés (ils peuvent porter un nom). La console est rendue muette
// pendant la lecture : un avertissement de pdf.js ne s'affiche pas, et seul le résultat s'écrit, à la fin.

import { readFile } from 'node:fs/promises'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { lireLeBordereauDeTeletransmission, type OuvrirLeBordereau, type TacheDeTextePdfJs } from '../../src/lib/bordereauDeTeletransmissionLecture'
import { texteDuResultat } from './sortie.mts'

const ecrire = (texte: string) => { process.stdout.write(`${texte}\n`) }

const chemin = process.argv[2]
if (chemin === undefined || chemin.trim() === '' || process.argv.length > 3) {
  ecrire('Usage : node outils/bordereau/lire.mjs "chemin du bordereau.pdf"  (un seul fichier, le chemin entre guillemets)')
  process.exit(2)
}

const ouvrir: OuvrirLeBordereau = (octets) => pdfjs.getDocument({ data: octets }) as unknown as TacheDeTextePdfJs

const muette = () => {}
const console_ = console as unknown as Record<string, unknown>
for (const methode of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) console_[methode] = muette

let texte: string
try {
  const octets = await readFile(chemin)
  const lecture = await lireLeBordereauDeTeletransmission(new Blob([new Uint8Array(octets)]), ouvrir)
  texte = texteDuResultat(lecture)
  process.exitCode = lecture.etat === 'lu' ? 0 : 1
} catch {
  // Une raison fixe : le message du système citerait le chemin.
  texte = 'Le fichier ne se lit pas : vérifie le chemin (entre guillemets) et que le fichier existe.'
  process.exitCode = 1
}
ecrire(texte)
