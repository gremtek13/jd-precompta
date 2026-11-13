// L'ÉPREUVE DU FICHIER (lot FEC22f, première partie ; lignes 26.5 et 26.6, MVP-D5) — un FEC FICTIF d'une année entière, à
// passer dans Test Compta Demat (l'outil de la DGFiP, sous Windows, catégorie « BNC trésorerie ») puis à importer dans le
// logiciel de l'expert-comptable, avant que le FEC du dossier réel parte. Jamais le fichier du dossier réel.
//
// Mode d'emploi, depuis la racine du dépôt (`tsx` n'est pas une dépendance : le lanceur passe par Vite, déjà installé) :
//
//     node outils/fec/lancer.mjs <dossier de sortie> vides
//     node outils/fec/lancer.mjs <dossier de sortie> date_de_l_ecriture
//
// Le second argument est le choix de FEC22-Q1 — DateRglt et ModeRglt d'une écriture qui n'est pas un règlement (dotation,
// forfait, à-nouveaux) : « vides », ou la date de l'écriture et « Sans règlement ». Il n'a pas de valeur par défaut : c'est
// précisément ce que l'import chez l'expert-comptable doit trancher (FEC22-E2), et les deux variantes se produisent l'une
// après l'autre. Le dossier de sortie, HORS du dépôt, reçoit :
//
//     18-champs/<SIREN>FEC<AAAAMMJJ>.txt             le FEC d'aujourd'hui (drapeau CHAMPS_BNC_EXPORTES baissé)
//     22-champs-<choix>/<SIREN>FEC<AAAAMMJJ>.txt     le FEC d'un BNC en trésorerie (VIII, 7° de l'art. A47 A-1)
//
// Le nom suit l'article A47 A-1 (SIREN, « FEC », date de clôture) : deux fichiers du même nom vivent dans deux dossiers.
// UTF-8 sans BOM, tabulation, CRLF : le texte même que l'onglet Écritures télécharge (`telechargerTexte`).
//
// Le dossier : l'année 2025 fictive de la répétition générale, composée par les vrais moteurs (src/test/fecFictif.ts, qui dit
// ce qu'il appelle). La forme que l'article et l'outil de la DGFiP exigent est gardée par src/lib/fecFictif.test.ts, qui joue
// la même composition en mémoire ; cet outil ne fait qu'écrire les fichiers. Il est type-vérifié par `npx tsc -b`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SANS_REGLEMENT } from '../../src/lib/champsBncExportes'
import { composerLeFecFictif } from '../../src/test/fecFictif'

const [sortie, choix] = process.argv.slice(2)
const choixLu = SANS_REGLEMENT.find((x) => x === choix)
if (!sortie || choixLu === undefined) {
  console.error(`Usage : node outils/fec/lancer.mjs <dossier de sortie> <${SANS_REGLEMENT.join(' | ')}>`)
  process.exit(2)
}
// Un FEC, même fictif, ne se commite pas : le dossier de sortie est hors du dépôt.
const depot = resolve(new URL('../..', import.meta.url).pathname)
if (`${resolve(sortie)}/`.startsWith(`${depot}/`)) {
  console.error('Le dossier de sortie est dans le dépôt : choisis un dossier hors du dépôt.')
  process.exit(2)
}

const fec = composerLeFecFictif({ sansReglement: choixLu })
const ecrire = (dossier: string, texte: string) => {
  const chemin = join(resolve(sortie), dossier)
  mkdirSync(chemin, { recursive: true })
  writeFileSync(join(chemin, fec.nomFichier), texte, 'utf8')
  const lignes = texte.split('\r\n')
  const ecritures = new Set(lignes.slice(1).map((l) => l.split('\t')[2])).size
  console.log(`${join(chemin, fec.nomFichier)} : ${lignes.length} lignes (en-tête compris), ${ecritures} écritures, ${lignes[0].split('\t').length} champs`)
}
ecrire('18-champs', fec.dixHuit)
ecrire(`22-champs-${choixLu.replaceAll('_', '-')}`, fec.vingtDeux)
