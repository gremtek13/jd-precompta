// L'OUTIL LOCAL QUI DIT SI LA RÉCEPTION PAR E-MAIL RECONNAÎTRAIT UN BORDEREAU (BOR6R-Q1). Lancé par
// outils/bordereau/reception.mjs, dont l'en-tête est le mode d'emploi. Il lit le PDF sur le disque de l'ordinateur où il tourne
// et n'affiche que ce que outils/bordereau/jugementReception.mts compose : une conclusion et des comptes.
//
// RIEN D'AUTRE NE S'AFFICHE ET RIEN NE PART : aucun réseau, aucun fichier écrit, ni le chemin ni le nom du fichier répétés (ils
// peuvent porter un nom). La console est rendue muette pendant la lecture ; seul le résultat s'écrit, à la fin.

import { readFile } from 'node:fs/promises'
import { jugerCommeLaReception, texteDuJugement } from './jugementReception.mts'

const ecrire = (texte: string) => { process.stdout.write(`${texte}\n`) }

const chemin = process.argv[2]
if (chemin === undefined || chemin.trim() === '' || process.argv.length > 3) {
  ecrire('Usage : node outils/bordereau/reception.mjs "chemin du bordereau.pdf"  (un seul fichier, le chemin entre guillemets)')
  process.exit(2)
}

const muette = () => {}
const console_ = console as unknown as Record<string, unknown>
for (const methode of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) console_[methode] = muette

let texte: string
try {
  const octets = new Uint8Array(await readFile(chemin))
  const jugement = await jugerCommeLaReception(octets, () => performance.now())
  texte = texteDuJugement(jugement)
  process.exitCode = 0
} catch {
  // Une raison fixe : le message du système citerait le chemin.
  texte = 'Le fichier ne se lit pas : vérifie le chemin (entre guillemets) et que le fichier existe.'
  process.exitCode = 1
}
ecrire(texte)
