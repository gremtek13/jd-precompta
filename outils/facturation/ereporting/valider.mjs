// Fait passer les fichiers d'e-reporting d'exemple (outils/facturation/ereporting/exemples/*.xml, que
// src/lib/fluxEreporting.ts produit depuis des déclarations FICTIVES) au schéma XSD du flux 10 que la DGFiP publie, et
// écrit la liste des fichiers validés avec leur empreinte (exemples/valides.json). fluxEreporting.test.ts refuse un
// exemple dont l'empreinte n'y figure pas : un exemple qui change repasse ici avant de partir.
//
//   mkdir <un dossier neuf et vide>
//   curl -sSLo <ce dossier>/specifications-externes-v3.2.zip \
//     https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/specifications-externes-v3.2.zip
//   node outils/facturation/ereporting/valider.mjs <ce dossier>/specifications-externes-v3.2.zip
//
// Il faut xmllint (libxml2). LE SCHÉMA est celui de l'archive OFFICIELLE des spécifications externes de la facturation
// électronique, v3.2 du 30/04/2026 (impots.gouv.fr) : son dossier « 3- XSD_v3.2/1 - E-reporting », cinq fichiers
// (ereporting.xsd, la racine, et report.xsd, transaction.xsd, payment.xsd, parametre.xsd qu'elle importe). L'outil
// vérifie DEUX FOIS ce qu'il prend : l'empreinte SHA-256 de l'archive, relevée le 11/10/2026 (la même que celle d'une
// copie téléchargée le 08/10/2026), puis celle de chacun des cinq fichiers. Une autre version du schéma validerait
// d'autres choses, en silence. Aucune redistribution tierce : la DGFiP publie elle-même ses XSD. Les normes AFNOR
// XP Z12-012 et XP Z12-013 ne s'utilisent pas (décision du cabinet du 07/10/2026).
//
// RIEN N'EN EST COPIÉ DANS LE DÉPÔT : l'archive se télécharge à côté, le schéma s'exécute comme un instrument, dans un
// dossier de travail effacé à la fin ; les exemples sont des fichiers fictifs que fluxEreporting.ts produit. Aucun
// Schematron : ceux de la plateforme de l'administration ne sont pas publiés (dossier général v3.2, note 128) ; les
// règles de gestion de l'annexe 7 sont éprouvées une à une par fluxEreporting.test.ts.
//
// L'OUTIL S'ÉPROUVE AVANT DE JUGER : il fait d'abord valider deux documents qu'il sait faux — un élément que le schéma
// ne connaît pas ; un montant à virgule (le schéma veut un xs:decimal, G1.14 le point) — et s'arrête s'il en laisse
// passer un. Un validateur qui ne voit rien répondrait « valide » à tout : c'est la panne qui ressemble exactement au
// succès. Il montre aussi ce que le schéma NE VOIT PAS : un fichier qui porte des transactions et des paiements, que
// G6.29 fait rejeter, et que seul le module refuse — dit, sans arrêter.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const ARCHIVE = {
  publication: 'DGFiP, Dossier de spécifications externes de la facturation électronique, v3.2 du 30/04/2026',
  url: 'https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/specifications-externes-v3.2.zip',
  octets: 6766301,
  sha256: 'cd8f6e817e37f329e6f62a35aa131b78a51379bec953445b774fa8adbaaa3862',
}
const DOSSIER_DE_L_ARCHIVE = '3- XSD_v3.2/1 - E-reporting/'
const RACINE = 'ereporting.xsd'
const XSD = {
  [RACINE]: 'b6e355094f08e9d90dd6bfaed42319ef490f4dc1a11b1b6b7473b9c35b27d546',
  'report.xsd': '059cea2615bca67b07df167d3e5b65d8658477f8a12a8723d3fc227f35cb8403',
  'transaction.xsd': 'ab5139608ec5754227c37b471cdec3b7434dcb21340d9b8c8d98bfc60e6ec841',
  'payment.xsd': 'bf41d73aad46efdf8a26699f6dc7777f54051d8795f85faf1272cd2095b9a048',
  'parametre.xsd': '5971f3f2080e7057a4034121703ebdf403dda0d8f0e41e33987dc432c8671bad',
}
const EXEMPLES = fileURLToPath(new URL('./exemples/', import.meta.url))
const MANIFESTE = join(EXEMPLES, 'valides.json')

function arret(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const [, , cheminDeLArchive] = process.argv
if (!cheminDeLArchive) {
  console.error('Usage : node outils/facturation/ereporting/valider.mjs <specifications-externes-v3.2.zip>')
  process.exit(2)
}

const octetsDeLArchive = readFileSync(cheminDeLArchive)
const sha256 = createHash('sha256').update(octetsDeLArchive).digest('hex')
if (sha256 !== ARCHIVE.sha256) arret(`Cette archive n'est pas celle des spécifications externes v3.2 attendue (SHA-256 ${sha256}).`)

// Les cinq fichiers du schéma, extraits de l'archive dans un dossier de travail, chacun vérifié à l'octet près.
const travail = mkdtempSync(join(tmpdir(), 'valider-ereporting-'))
const archive = await JSZip.loadAsync(octetsDeLArchive)
for (const [nom, attendu] of Object.entries(XSD)) {
  const fichier = archive.file(`${DOSSIER_DE_L_ARCHIVE}${nom}`)
  if (!fichier) arret(`L'archive ne porte pas ${DOSSIER_DE_L_ARCHIVE}${nom}.`)
  const octets = await fichier.async('nodebuffer')
  const empreinte = createHash('sha256').update(octets).digest('hex')
  if (empreinte !== attendu) arret(`${nom} n'est pas le fichier attendu (SHA-256 ${empreinte}).`)
  writeFileSync(join(travail, nom), octets)
}

// Le schéma : xmllint rend 0 quand le document le respecte. --nonet : rien ne part sur le réseau, les cinq fichiers
// s'importent l'un l'autre depuis le dossier de travail.
function schema(fichier) {
  const r = spawnSync('xmllint', ['--nonet', '--noout', '--schema', join(travail, RACINE), fichier], { encoding: 'utf8' })
  return { valide: r.status === 0, message: (r.stderr || r.stdout || '').trim() }
}

const fichiers = readdirSync(EXEMPLES).filter((f) => f.endsWith('.xml')).sort()
if (fichiers.length === 0) arret(`Aucun exemple dans ${EXEMPLES}.`)
const lire = (f) => readFileSync(join(EXEMPLES, f), 'utf8')

// L'outil s'éprouve sur deux documents faux, tirés du premier exemple.
const premier = lire(fichiers[0])
const faux = {
  'un élément que le schéma ne connaît pas': premier.replace('<TypeCode>', '<Inconnu>1</Inconnu><TypeCode>'),
  'un montant à virgule': premier.replace(/(<(TaxExclusiveAmount|TaxableAmount|Amount)>)([^<]*)(<\/\2>)/,
    (_, a, _nom, v, b) => `${a}${v.includes('.') ? v.replace('.', ',') : `${v},00`}${b}`),
}
for (const [quoi, document] of Object.entries(faux)) {
  if (document === premier) arret(`Autocontrôle : le document faux (${quoi}) n'a pas pu être fabriqué.`)
  const chemin = join(travail, 'faux.xml')
  writeFileSync(chemin, document)
  if (schema(chemin).valide) arret(`Autocontrôle : le schéma laisse passer ${quoi}. Le validateur ne voit rien.`)
}
console.log(`Autocontrôle : ${Object.keys(faux).join(', ')} sont bien refusés.`)

// Ce que le schéma ne voit pas : des transactions et des paiements dans un même fichier (G6.29), tirés de deux exemples.
const transactions = fichiers.map(lire).find((x) => x.includes('<TransactionsReport>'))
const paiements = fichiers.map(lire).find((x) => x.includes('<PaymentsReport>'))
if (transactions && paiements) {
  const bloc = /\n {2}<PaymentsReport>[\s\S]*<\/PaymentsReport>/.exec(paiements)?.[0] ?? ''
  const mele = transactions.replace('\n</Report>', `${bloc}\n</Report>`)
  const chemin = join(travail, 'mele.xml')
  writeFileSync(chemin, mele)
  const vu = bloc !== '' && !schema(chemin).valide
  console.log(vu
    ? 'Le schéma refuse désormais des transactions et des paiements dans un même fichier (G6.29).'
    : 'Le schéma laisse passer des transactions et des paiements dans un même fichier : G6.29 est gardé par fluxEreporting.test.ts.')
}

// Tous les exemples sont jugés avant qu'aucune liste ne s'écrive : un exemple refusé n'en laisse écrire aucune.
let echecs = 0
const manifeste = { schema: { archive: ARCHIVE, dossier: DOSSIER_DE_L_ARCHIVE, xsd: XSD }, fichiers: {} }
for (const f of fichiers) {
  const chemin = join(EXEMPLES, f)
  const s = schema(chemin)
  console.log(`${s.valide ? '✓' : '✗'} ${f} : ${s.valide ? 'schéma respecté' : 'schéma NON respecté'}`)
  if (!s.valide) {
    console.log(`    ${s.message.split('\n').join('\n    ')}`)
    echecs++
  }
  manifeste.fichiers[f] = { sha256: createHash('sha256').update(readFileSync(chemin)).digest('hex') }
}
rmSync(travail, { recursive: true, force: true })

if (echecs > 0) arret(`${echecs} exemple(s) refusé(s) : la liste des fichiers validés n’est pas écrite.`)
writeFileSync(MANIFESTE, `${JSON.stringify(manifeste, null, 2)}\n`)
console.log(`${fichiers.length} exemple(s) valide(s) : ${MANIFESTE} écrit.`)
