// Fait passer les factures électroniques d'exemple (outils/facturation/exemples/*.xml) au validateur officiel de la
// norme EN 16931 — le schéma CII D16B (sous-ensemble) puis les règles de la norme, que les artefacts de validation du
// CEN/TC 434 publient sous forme de Schematron compilé en XSLT —, et écrit la liste des fichiers validés avec leur
// empreinte (exemples/valides.json). factureCii.test.ts refuse un exemple dont l'empreinte n'y figure pas : un exemple
// qui change repasse ici avant de partir.
//
//   git clone --depth 1 --branch validation-1.3.16 https://github.com/ConnectingEurope/eInvoicing-EN16931 <artefacts>
//   curl -sSLo <cache>/Saxon-HE-9.9.1-8.jar \
//     https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/9.9.1-8/Saxon-HE-9.9.1-8.jar
//   node outils/facturation/valider.mjs <artefacts> <cache>/Saxon-HE-9.9.1-8.jar
//
// Il faut Java et xmllint. Les artefacts et Saxon ne vivent pas dans le dépôt : ce sont des instruments de mesure, et
// leur version est vérifiée ici (le commit des artefacts, l'empreinte SHA-1 de Saxon) plutôt que supposée — une autre
// version des règles validerait d'autres choses, en silence.
//
// RIEN N'EN EST COPIÉ DANS LE DÉPÔT : les artefacts (licence EUPL) se lisent comme une documentation et s'exécutent
// comme un instrument ; les exemples sont des factures fictives que factureCii.ts produit.
//
// L'OUTIL S'ÉPROUVE AVANT DE JUGER : il fait d'abord valider deux documents qu'il sait faux — un total TTC qui ne fait
// pas la somme, un élément que le schéma ne connaît pas — et s'arrête s'il les laisse passer. Un validateur qui ne voit
// rien répondrait « valide » à tout : c'est la panne qui ressemble exactement au succès.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ARTEFACTS = { etiquette: 'validation-1.3.16', commit: 'b6c9e06a59812fb1a83585da40923b3678a649ad' }
const SAXON = { version: '9.9.1-8', sha1: '4010d851340a3b79e004a6055ffec2efe2d75413' }
const XSD = 'cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd'
const XSLT = 'cii/xslt/EN16931-CII-validation.xslt'
const EXEMPLES = fileURLToPath(new URL('./exemples/', import.meta.url))
const MANIFESTE = join(EXEMPLES, 'valides.json')

function arret(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const [, , artefacts, jarSaxon] = process.argv
if (!artefacts || !jarSaxon) {
  console.error('Usage : node outils/facturation/valider.mjs <dossier des artefacts EN 16931> <Saxon-HE-9.9.1-8.jar>')
  process.exit(2)
}

const commit = execFileSync('git', ['-C', artefacts, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== ARTEFACTS.commit) arret(`Les artefacts sont au commit ${commit}, pas à ${ARTEFACTS.commit} (${ARTEFACTS.etiquette}).`)
const sha1 = createHash('sha1').update(readFileSync(jarSaxon)).digest('hex')
if (sha1 !== SAXON.sha1) arret(`Ce Saxon n'est pas la version ${SAXON.version} attendue (SHA-1 ${sha1}).`)

const travail = mkdtempSync(join(tmpdir(), 'valider-cii-'))

// Le schéma : xmllint rend 0 quand le document le respecte.
function schema(fichier) {
  const r = spawnSync('xmllint', ['--noout', '--schema', join(artefacts, XSD), fichier], { encoding: 'utf8' })
  return { valide: r.status === 0, message: (r.stderr || r.stdout || '').trim() }
}

// Les règles de la norme : le rapport SVRL de Saxon, dont chaque assertion manquée porte son identifiant (BR-…) et sa
// gravité — « fatal » pour une erreur, « warning » pour un avertissement.
function regles(fichier) {
  const sortie = join(travail, 'rapport.svrl')
  const r = spawnSync('java', ['-jar', jarSaxon, `-s:${fichier}`, `-xsl:${join(artefacts, XSLT)}`, `-o:${sortie}`], { encoding: 'utf8' })
  if (r.status !== 0) arret(`Saxon a échoué sur ${fichier} : ${(r.stderr || '').trim()}`)
  const svrl = readFileSync(sortie, 'utf8')
  const constats = []
  for (const m of svrl.matchAll(/<svrl:(failed-assert|successful-report)\b([^>]*)>([\s\S]*?)<\/svrl:\1>/g)) {
    const attribut = (nom) => new RegExp(`\\b${nom}="([^"]*)"`).exec(m[2])?.[1] ?? null
    const texte = /<svrl:text>([\s\S]*?)<\/svrl:text>/.exec(m[3])?.[1].replace(/\s+/g, ' ').trim() ?? ''
    constats.push({ id: attribut('id'), gravite: attribut('flag') ?? 'fatal', texte, endroit: attribut('location') })
  }
  return {
    erreurs: constats.filter((c) => c.gravite !== 'warning'),
    avertissements: constats.filter((c) => c.gravite === 'warning'),
  }
}

const fichiers = readdirSync(EXEMPLES).filter((f) => f.endsWith('.xml')).sort()
if (fichiers.length === 0) arret(`Aucun exemple dans ${EXEMPLES}.`)

// L'outil s'éprouve sur deux documents faux, tirés du premier exemple.
const premier = readFileSync(join(EXEMPLES, fichiers[0]), 'utf8')
const totalFaux = premier.replace(/(<ram:GrandTotalAmount>)([^<]*)(<\/ram:GrandTotalAmount>)/, (_, a, v, b) => `${a}${(Number(v) + 1).toFixed(2)}${b}`)
const horsSchema = premier.replace('<ram:TypeCode>', '<ram:Inconnu>1</ram:Inconnu><ram:TypeCode>')
if (totalFaux === premier || horsSchema === premier) arret('Les documents faux de l’autocontrôle n’ont pas pu être fabriqués.')
writeFileSync(join(travail, 'total-faux.xml'), totalFaux)
writeFileSync(join(travail, 'hors-schema.xml'), horsSchema)
const totalVu = regles(join(travail, 'total-faux.xml')).erreurs.some((c) => c.id === 'BR-CO-15')
const schemaVu = !schema(join(travail, 'hors-schema.xml')).valide
if (!totalVu) arret('Autocontrôle : les règles laissent passer un total TTC faux (BR-CO-15). Le validateur ne voit rien.')
if (!schemaVu) arret('Autocontrôle : le schéma laisse passer un élément inconnu. Le validateur ne voit rien.')
console.log('Autocontrôle : un total faux et un élément hors schéma sont bien refusés.')

let echecs = 0
const manifeste = { artefacts: ARTEFACTS, saxon: SAXON, fichiers: {} }
for (const f of fichiers) {
  const chemin = join(EXEMPLES, f)
  const s = schema(chemin)
  const r = regles(chemin)
  const ok = s.valide && r.erreurs.length === 0
  const bilan = `${s.valide ? 'schéma respecté' : 'schéma NON respecté'}, ${r.erreurs.length} erreur(s), ${r.avertissements.length} avertissement(s)`
  console.log(`${ok ? '✓' : '✗'} ${f} : ${bilan}`)
  if (!s.valide) console.log(`    ${s.message.split('\n').join('\n    ')}`)
  for (const c of [...r.erreurs, ...r.avertissements]) console.log(`    [${c.gravite}] ${c.id} ${c.texte} (${c.endroit})`)
  if (!ok) echecs++
  manifeste.fichiers[f] = {
    sha256: createHash('sha256').update(readFileSync(chemin)).digest('hex'),
    avertissements: r.avertissements.map((c) => c.id).sort(),
  }
}
rmSync(travail, { recursive: true, force: true })

if (echecs > 0) arret(`${echecs} exemple(s) refusé(s) : la liste des fichiers validés n’est pas écrite.`)
writeFileSync(MANIFESTE, `${JSON.stringify(manifeste, null, 2)}\n`)
console.log(`${fichiers.length} exemple(s) valide(s) : ${MANIFESTE} écrit.`)
