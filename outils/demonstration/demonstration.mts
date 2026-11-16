// LE DOSSIER DE DÉMONSTRATION — écrit le fichier de sauvegarde d'un dossier FICTIF complet, que le super-administrateur
// restaure d'un clic (« Restaurer une sauvegarde », en bas de la page Super-admin). Mode d'emploi : README.md, à côté.
//
//     node outils/demonstration/lancer.mjs <dossier de sortie, hors du dépôt> <identifiant du cabinet>
//
// L'identifiant du cabinet est celui du cabinet qui recevra le dossier (`cabinets.id`) : la sauvegarde ne porte pas la ligne
// du cabinet, la restauration exige qu'elle existe dans la base d'arrivée. Il n'a pas de valeur par défaut, et n'entre jamais
// au dépôt. La composition (src/test/dossierDeDemonstration.ts) est déterministe : le même cabinet rend le même fichier, à
// l'octet. Le fichier est relu par le lecteur même de l'écran (`lireSauvegarde`) avant d'être écrit.

import { mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { lireSauvegarde, nomFichierSauvegarde, serialiserSauvegarde } from '../../src/lib/sauvegardeFichier'
import { sauvegardeDeDemonstration } from '../../src/test/dossierDeDemonstration'

const [sortie, cabinetId] = process.argv.slice(2)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
if (!sortie || !cabinetId || !UUID.test(cabinetId)) {
  console.error('Usage : node outils/demonstration/lancer.mjs <dossier de sortie> <identifiant du cabinet (uuid)>')
  process.exit(2)
}
// Un fichier de sauvegarde, même fictif, ne se commite pas : le dossier de sortie est hors du dépôt.
const depot = resolve(new URL('../..', import.meta.url).pathname)
if (`${resolve(sortie)}/`.startsWith(`${depot}/`)) {
  console.error('Le dossier de sortie est dans le dépôt : choisis un dossier hors du dépôt.')
  process.exit(2)
}

const sauvegarde = sauvegardeDeDemonstration(cabinetId)
const texte = await serialiserSauvegarde(sauvegarde)
// Le juge de l'écran, avant d'écrire : un fichier qu'il refuserait ne sort pas d'ici.
await lireSauvegarde(texte)
mkdirSync(resolve(sortie), { recursive: true })
const chemin = join(resolve(sortie), nomFichierSauvegarde(sauvegarde.manifeste))
writeFileSync(chemin, texte, 'utf8')
const lignes = Object.values(sauvegarde.manifeste.lignesParTable).reduce((s, n) => s + n, 0)
console.log(`${chemin}`)
console.log(`${Buffer.byteLength(texte)} octets, ${lignes} lignes sur ${Object.keys(sauvegarde.contenu).length} tables`)
console.log(`SHA-256 du fichier : ${createHash('sha256').update(texte).digest('hex')}`)
