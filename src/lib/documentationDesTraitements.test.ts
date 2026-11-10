import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

// LA DOCUMENTATION DES TRAITEMENTS NE NOMME QUE CE QUI EXISTE (ligne 44, lot INAL4). DOCUMENTATION_DES_TRAITEMENTS.md décrit,
// pour un expert-comptable ou un vérificateur, comment l'application produit chaque écriture (PCG, art. 1011-2 et 1011-4) ;
// chacune de ses affirmations nomme, entre accents graves, la fonction SQL, le module ou le symbole qui la porte. Un nom
// qui disparaît du code sans que le document suive fait d'elle une description d'un logiciel qui n'existe plus : ce garde
// la fait tomber.
//
// IL PART DE TOUT. Chaque passage entre accents graves du document est rangé dans une forme, et une forme non reconnue est
// une FAUTE (jamais ignorée en silence) :
//   - `nom()`                 une fonction SQL : `create … function nom(` dans l'export du schéma (supabase/schema/, son
//                             socle) ou dans une migration préparée (supabase/preparees/, sans ses retours) ;
//   - un chemin (`lib/x.ts`)  un fichier ou un dossier, à la racine du dépôt ou sous src/ ;
//   - `camelCase`, `MAJUSCULES_SOULIGNEES`, ou un nom à chiffres (`instantane2035`) : un symbole DÉCLARÉ sous src/ (hors
//                             tests) — fonction, constante, type, interface ;
//   - `minuscules_soulignees` un mot du schéma (table, colonne, policy, rôle du plan), comme mot entier dans l'export ;
//   - deux majuscules         un code de journal, écrit entre apostrophes dans lib/fec.ts ou lib/types.ts ;
//   - six chiffres            le compte par défaut d'un rôle du plan (`compteDefaut` de lib/planComptable.ts).
// Un plancher par forme distingue « aucune faute » de « aveugle » : un document dont on aurait retiré les accents graves, ou
// une lecture qui ne trouverait plus le texte, ne passerait pas pour juste.

const RACINE = fileURLToPath(new URL('../../', import.meta.url))

type Forme = 'fonction_sql' | 'fichier' | 'symbole' | 'mot_du_schema' | 'journal' | 'compte'

interface Sources {
  /** Le texte où une fonction SQL se déclare : l'export, son socle, les migrations préparées. */
  fonctionsSql: string
  /** Le texte où un mot du schéma se cherche : l'export et son socle. */
  schema: string
  /** Les noms déclarés sous src/, hors tests. */
  symboles: ReadonlySet<string>
  fichierExiste: (chemin: string) => boolean
  /** lib/fec.ts et lib/types.ts, où les codes de journal s'écrivent. */
  journaux: string
  /** lib/planComptable.ts, où chaque rôle a son `compteDefaut`. */
  plan: string
}

interface Defaut { nom: string; forme: Forme | 'inconnue'; motif: string }

function echapper(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formeDe(nom: string): Forme | 'inconnue' {
  if (/^[a-z_][a-z0-9_]*\(\)$/.test(nom)) return 'fonction_sql'
  if (nom.includes('/') && /^[A-Za-z0-9_./-]+$/.test(nom) && (/\.(ts|tsx|sql|md)$/.test(nom) || nom.endsWith('/'))) return 'fichier'
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(nom)) return 'symbole'
  if (/^[a-z][A-Za-z0-9]*$/.test(nom) && /[A-Z0-9]/.test(nom)) return 'symbole'
  if (/^[a-z][a-z0-9_]*$/.test(nom)) return 'mot_du_schema'
  if (/^[A-Z]{2}$/.test(nom)) return 'journal'
  if (/^[0-9]{6}$/.test(nom)) return 'compte'
  return 'inconnue'
}

function nomsDuDocument(texte: string): string[] {
  // Les blocs de code n'y sont pas : le document n'en a pas, et un bloc ajouté se lirait passage par passage.
  return [...texte.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
}

function defautsDeLaDocumentation(texte: string, sources: Sources): Defaut[] {
  const defauts: Defaut[] = []
  for (const nom of new Set(nomsDuDocument(texte))) {
    const forme = formeDe(nom)
    const faute = (motif: string) => defauts.push({ nom, forme, motif })
    switch (forme) {
      case 'fonction_sql': {
        const fonction = nom.slice(0, -2)
        const declaree = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?"?${echapper(fonction)}"?\\s*\\(`, 'i')
        if (!declaree.test(sources.fonctionsSql)) faute('aucune fonction SQL de ce nom dans le schéma ni dans les migrations préparées')
        break
      }
      case 'fichier':
        if (!sources.fichierExiste(nom)) faute('aucun fichier de ce chemin, ni à la racine ni sous src/')
        break
      case 'symbole':
        if (!sources.symboles.has(nom)) faute('aucun symbole de ce nom déclaré sous src/')
        break
      case 'mot_du_schema':
        if (!new RegExp(`(^|[^a-z0-9_])${echapper(nom)}($|[^a-z0-9_])`).test(sources.schema)) faute('aucun mot de ce nom dans le schéma')
        break
      case 'journal':
        if (!sources.journaux.includes(`'${nom}'`)) faute('aucun journal de ce code')
        break
      case 'compte':
        if (!sources.plan.includes(`compteDefaut: '${nom}'`)) faute("aucun rôle du plan n'a ce compte par défaut")
        break
      default:
        faute('forme non reconnue : la nommer dans une forme du garde, ou la sortir des accents graves')
    }
  }
  return defauts
}

function fichiers(dossier: string, garder: (chemin: string) => boolean): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = join(dossier, e.name)
    if (e.isDirectory()) return fichiers(chemin, garder)
    return garder(chemin) ? [chemin] : []
  })
}

function lire(chemins: readonly string[]): string {
  return chemins.map((c) => readFileSync(c, 'utf8')).join('\n')
}

function sourcesDuDepot(): Sources {
  const schema = lire([
    ...fichiers(join(RACINE, 'supabase/schema'), (c) => c.endsWith('.sql') && !c.includes('/reprise/')),
  ])
  const preparees = lire(readdirSync(join(RACINE, 'supabase/preparees'))
    .filter((n) => n.endsWith('.sql')).map((n) => join(RACINE, 'supabase/preparees', n)))
  const src = lire(fichiers(join(RACINE, 'src'), (c) => /\.(ts|tsx)$/.test(c) && !/\.test\.tsx?$/.test(c)))
  const symboles = new Set([...src.matchAll(/\b(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  const existe = (p: string) => existsSync(p) && (statSync(p).isFile() || statSync(p).isDirectory())
  return {
    fonctionsSql: `${schema}\n${preparees}`,
    schema,
    symboles,
    fichierExiste: (c) => existe(join(RACINE, c)) || existe(join(RACINE, 'src', c)),
    journaux: readFileSync(join(RACINE, 'src/lib/fec.ts'), 'utf8') + readFileSync(join(RACINE, 'src/lib/types.ts'), 'utf8'),
    plan: readFileSync(join(RACINE, 'src/lib/planComptable.ts'), 'utf8'),
  }
}

// Les planchers : un peu sous ce que le document nomme le 10/11/2026. Un document qui en nommerait moins a perdu des
// renvois — ou ce garde ne les lit plus.
const PLANCHERS: Readonly<Record<Forme, number>> = {
  fonction_sql: 35, fichier: 50, symbole: 70, mot_du_schema: 42, journal: 5, compte: 20,
}

describe('DOCUMENTATION_DES_TRAITEMENTS.md', () => {
  let texte: string
  let sources: Sources
  beforeAll(() => {
    texte = readFileSync(join(RACINE, 'DOCUMENTATION_DES_TRAITEMENTS.md'), 'utf8')
    sources = sourcesDuDepot()
  })

  it('ne nomme que des fonctions, des modules, des symboles, des mots du schéma, des journaux et des comptes qui existent', () => {
    expect(defautsDeLaDocumentation(texte, sources)).toEqual([])
  })

  it('en nomme assez dans chaque forme pour que le garde ne soit pas aveugle', () => {
    const parForme = new Map<Forme | 'inconnue', number>()
    for (const nom of new Set(nomsDuDocument(texte))) parForme.set(formeDe(nom), (parForme.get(formeDe(nom)) ?? 0) + 1)
    for (const [forme, plancher] of Object.entries(PLANCHERS)) {
      expect(parForme.get(forme as Forme) ?? 0, forme).toBeGreaterThanOrEqual(plancher)
    }
  })

  it('reste sous quatre cents lignes', () => {
    expect(texte.split('\n').length).toBeLessThanOrEqual(400)
  })
})

describe('le garde voit un nom disparu, dans chaque forme (défauts plantés)', () => {
  let sources: Sources
  beforeAll(() => { sources = sourcesDuDepot() })

  it.each([
    ['`valider_exercice_disparue()`', 'fonction_sql'],
    ['`lib/moduleDisparu.ts`', 'fichier'],
    ['`lignesPourPieceDisparue`', 'symbole'],
    ['`CONSTANTE_DISPARUE`', 'symbole'],
    ['`table_disparue`', 'mot_du_schema'],
    ['`ZZ`', 'journal'],
    ['`512999`', 'compte'],
    ['`une phrase entre accents graves`', 'inconnue'],
  ] as const)('%s', (passage, forme) => {
    const defauts = defautsDeLaDocumentation(`Une ligne qui nomme ${passage}.`, sources)
    expect(defauts).toHaveLength(1)
    expect(defauts[0].forme).toBe(forme)
  })

  it('et ne prend pas pour disparu ce qui existe, dans chaque forme', () => {
    const texte = '`valider_exercice()` `regler_plan_du_dossier()` `lib/fec.ts` `supabase/schema/` `lignesPourPiece` '
      + '`CHAMPS_BNC_EXPORTES` `instantane2035` `exercices_valides` `exploitant` `BQ` `AN` `512000`'
    expect(defautsDeLaDocumentation(texte, sources)).toEqual([])
  })

  it('une fonction SQL se cherche déclarée, jamais seulement citée', () => {
    // `jd` paraît dans le schéma (le réglage `jd.validation_exercice`), jamais comme une fonction.
    expect(defautsDeLaDocumentation('`jd()`', sources)).toHaveLength(1)
  })
})
