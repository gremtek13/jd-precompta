// Fait passer les messages du statut « Encaissée » d'exemple (outils/facturation/cdar/exemples/*.xml) — et, depuis
// l'étape d7, les messages de cycle de vie REÇUS d'exemple (outils/facturation/cdar/recus/*.xml : un refus, un rejet,
// un 601, un litige…) — au schéma XSD du message CrossDomainAcknowledgementAndResponse (CDAR) de l'UN/CEFACT, version
// D22B, et écrit, dossier par dossier, la liste des fichiers validés avec leur empreinte (valides.json).
// cdarEncaissee.test.ts et cdarRecu.test.ts refusent un exemple dont l'empreinte n'y figure pas : un exemple qui change
// repasse ici avant de partir.
//
//   curl -sSLo <cache>/ph-cii-d22b-4.1.3.jar \
//     https://repo1.maven.org/maven2/com/helger/cii/ph-cii-d22b/4.1.3/ph-cii-d22b-4.1.3.jar
//   node outils/facturation/cdar/valider.mjs <cache>/ph-cii-d22b-4.1.3.jar
//
// Il faut xmllint (libxml2). LE SCHÉMA est celui que la CEE-ONU publie dans « XML Schemas version 22B »
// (XMLSchemas-D22B_0.zip, ECE/TRADE, publié le 27/06/2024, mis à jour le 09/01/2025) : le message et ses trois
// bibliothèques de types (RABIE, QDT, UDT), quatre fichiers. Le site de la CEE-ONU refuse les téléchargements
// automatisés ; l'outil prend donc ces fichiers dans une redistribution publique et versionnée — le jar ph-cii-d22b
// 4.1.3 (Apache 2.0, Maven Central) — et vérifie DEUX FOIS ce qu'il prend : l'empreinte SHA-1 du jar, celle que Maven
// Central publie à côté de lui, puis l'empreinte SHA-256 de chacun des quatre fichiers, la même que celle des fichiers
// que redistribue, indépendamment, le dépôt public akretion/pyfrctc (LGPL). Une autre version du schéma validerait
// d'autres choses, en silence. Qui a l'archive de la CEE-ONU sous la main peut confronter ses quatre fichiers à ces
// empreintes : c'est la seule confrontation qui reste à faire.
//
// SA LICENCE : la politique de propriété intellectuelle de l'UN/CEFACT (ECE/TRADE/C/CEFACT/2010/20/Rev.2, § 1) veut des
// spécifications qu'on met en œuvre « without fees or restrictions ». RIEN N'EN EST COPIÉ DANS LE DÉPÔT : le schéma
// s'exécute comme un instrument ; les exemples sont des messages fictifs que cdarEncaissee.ts produit. Aucun
// Schematron : la DGFiP n'en publie pas pour le cycle de vie, et celui que porte pyfrctc ne se lit pas (norme AFNOR
// exclue, décision du cabinet du 07/10/2026) ; les règles de la DGFiP sont éprouvées une à une par cdarEncaissee.test.ts.
//
// L'OUTIL S'ÉPROUVE AVANT DE JUGER : il fait d'abord valider trois documents qu'il sait faux — un élément que le schéma
// ne connaît pas ; un montant à virgule (G7.07 veut le point, xsd:decimal aussi) ; le « False » que l'annexe 2 écrit
// pour MDT-74, que le schéma refuse (udt:Indicator est un xsd:boolean) — et s'arrête s'il en laisse passer un. Un
// validateur qui ne voit rien répondrait « valide » à tout : c'est la panne qui ressemble exactement au succès.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const JAR = { artefact: 'com.helger.cii:ph-cii-d22b', version: '4.1.3', sha1: '5cada07dfabd43691403fac563e41929d4e1c6d8' }
const DOSSIER_DU_JAR = 'external/schemas/d22b/cdar/'
const RACINE = 'CrossDomainAcknowledgementAndResponse_100pD22B.xsd'
const XSD = {
  [RACINE]: 'cacdfe3cfe0e105f9f53d8392ccc36d0a322dd2eed270a569b725f23b16b85a1',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_QualifiedDataType_100.xsd':
    '35fb52e4ce999bebe065291a000456bd1e916994639e8ddddfda20790e3ba3c1',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_ReusableAggregateBusinessInformationEntity_100.xsd':
    '055355fac00e61a9475a154c8f1361bee517049aaff6adecdcc966d0baaf33f4',
  'CrossDomainAcknowledgementAndResponse_100pD22B_urn_un_unece_uncefact_data_standard_UnqualifiedDataType_100.xsd':
    '1953681991569751c95fbc34a39c8aea5a5a0e9c82234185ad30df902958b4c9',
}
const EXEMPLES = fileURLToPath(new URL('./exemples/', import.meta.url))
const RECUS = fileURLToPath(new URL('./recus/', import.meta.url))

function arret(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const [, , jar] = process.argv
if (!jar) {
  console.error(`Usage : node outils/facturation/cdar/valider.mjs <ph-cii-d22b-${JAR.version}.jar>`)
  process.exit(2)
}

const octetsDuJar = readFileSync(jar)
const sha1 = createHash('sha1').update(octetsDuJar).digest('hex')
if (sha1 !== JAR.sha1) arret(`Ce jar n'est pas ${JAR.artefact} ${JAR.version} (SHA-1 ${sha1}).`)

// Les quatre fichiers du schéma, extraits du jar dans un dossier de travail, chacun vérifié à l'octet près.
const travail = mkdtempSync(join(tmpdir(), 'valider-cdar-'))
const archive = await JSZip.loadAsync(octetsDuJar)
for (const [nom, attendu] of Object.entries(XSD)) {
  const fichier = archive.file(`${DOSSIER_DU_JAR}${nom}`)
  if (!fichier) arret(`Le jar ne porte pas ${DOSSIER_DU_JAR}${nom}.`)
  const octets = await fichier.async('nodebuffer')
  const sha256 = createHash('sha256').update(octets).digest('hex')
  if (sha256 !== attendu) arret(`${nom} n'est pas le fichier attendu (SHA-256 ${sha256}).`)
  writeFileSync(join(travail, nom), octets)
}

// Le schéma : xmllint rend 0 quand le document le respecte.
function schema(fichier) {
  const r = spawnSync('xmllint', ['--noout', '--schema', join(travail, RACINE), fichier], { encoding: 'utf8' })
  return { valide: r.status === 0, message: (r.stderr || r.stdout || '').trim() }
}

const xmlDe = (dossier) => readdirSync(dossier).filter((f) => f.endsWith('.xml')).sort()
for (const dossier of [EXEMPLES, RECUS]) if (xmlDe(dossier).length === 0) arret(`Aucun exemple dans ${dossier}.`)

// L'outil s'éprouve sur trois documents faux, tirés du premier exemple.
const premier = readFileSync(join(EXEMPLES, xmlDe(EXEMPLES)[0]), 'utf8')
const faux = {
  'un élément que le schéma ne connaît pas': premier.replace('<ram:TypeCode>', '<ram:Inconnu>1</ram:Inconnu><ram:TypeCode>'),
  'un montant à virgule': premier.replace(/(<ram:ValueAmount currencyID="EUR">)([^<]*)(<\/ram:ValueAmount>)/,
    (_, a, v, b) => `${a}${v.includes('.') ? v.replace('.', ',') : `${v},00`}${b}`),
  'le « False » de l’annexe 2 pour MDT-74': premier.replace('<udt:Indicator>false</udt:Indicator>', '<udt:Indicator>False</udt:Indicator>'),
}
for (const [quoi, document] of Object.entries(faux)) {
  if (document === premier) arret(`Autocontrôle : le document faux (${quoi}) n'a pas pu être fabriqué.`)
  const chemin = join(travail, 'faux.xml')
  writeFileSync(chemin, document)
  if (schema(chemin).valide) arret(`Autocontrôle : le schéma laisse passer ${quoi}. Le validateur ne voit rien.`)
}
console.log(`Autocontrôle : ${Object.keys(faux).join(', ')} sont bien refusés.`)

// Chaque dossier est jugé en entier avant qu'aucune liste ne s'écrive : un exemple refusé n'en laisse écrire aucune.
let echecs = 0
const manifestes = []
for (const dossier of [EXEMPLES, RECUS]) {
  const manifeste = { schema: { publication: 'UN/CEFACT, XML Schemas version 22B', jar: JAR, xsd: XSD }, fichiers: {} }
  for (const f of xmlDe(dossier)) {
    const chemin = join(dossier, f)
    const s = schema(chemin)
    console.log(`${s.valide ? '✓' : '✗'} ${f} : ${s.valide ? 'schéma respecté' : 'schéma NON respecté'}`)
    if (!s.valide) {
      console.log(`    ${s.message.split('\n').join('\n    ')}`)
      echecs++
    }
    manifeste.fichiers[f] = { sha256: createHash('sha256').update(readFileSync(chemin)).digest('hex') }
  }
  manifestes.push({ chemin: join(dossier, 'valides.json'), manifeste })
}
rmSync(travail, { recursive: true, force: true })

if (echecs > 0) arret(`${echecs} exemple(s) refusé(s) : aucune liste de fichiers validés n’est écrite.`)
for (const { chemin, manifeste } of manifestes) {
  writeFileSync(chemin, `${JSON.stringify(manifeste, null, 2)}\n`)
  console.log(`${Object.keys(manifeste.fichiers).length} exemple(s) valide(s) : ${chemin} écrit.`)
}
