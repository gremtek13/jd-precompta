import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CAS_DE_REFUS_CDAR, donneesCdar, EXEMPLES_CDAR } from '../test/cdarEncaissee'
import * as cdar from './cdarEncaissee'
import type { FuseauCdar } from './cdarEncaissee'
import * as encaissements from './encaissementsFactures'

// LE MESSAGE DU STATUT « ENCAISSÉE » SERA RECOPIÉ DANS LES EDGE FUNCTIONS QUI LE DÉPOSERONT (plateforme-agreee en d6,
// Super PDP en d8) : elles sont auto-portées, et ce qu'elles déposeront doit être le message que cdarEncaissee.test.ts
// a fait juger par le schéma CDAR D22B. Aucune copie n'existe encore ; ce garde vérifie, AVANT elle, que la copie est
// possible telle quelle, et d6 l'étendra aux copies elles-mêmes (comme copiesFacturation.test.ts pour le générateur de
// la facture électronique). Trois questions, et aucune ne suffit seule :
//
//   1. Les blocs se suffisent-ils, derrière ceux que les fonctions portent déjà ? On compile SEULS, dans l'ordre d'une
//      fonction, montantsFacture, statutTva, factureCii, centimesExacts et cdarEncaissee : un nom emprunté hors d'eux,
//      un nom en double, se voit au compilateur.
//   2. Exécutés seuls, rendent-ils ce que rendent les modules de src/lib — une référence extérieure aux blocs ? Une
//      épreuve par export, sur les exemples et sur un cas par refus.
//   3. Le bloc entre-t-il dans les deux fonctions qui portent déjà les trois premiers sans heurter un de leurs noms ?
//
// Et le garde mord : des défauts plantés le font tomber.

type Nom = 'montantsFacture' | 'statutTva' | 'factureCii' | 'centimesExacts' | 'cdarEncaissee'

const lib = (fichier: string) => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const SOURCES: Record<Nom, string> = {
  montantsFacture: lib('./montantsFacture.ts'),
  statutTva: lib('./statutTva.ts'),
  factureCii: lib('./factureCii.ts'),
  centimesExacts: lib('./encaissementsFactures.ts'),
  cdarEncaissee: lib('./cdarEncaissee.ts'),
}
// L'ordre d'une fonction : chaque bloc après ceux qu'il lit.
const ORDRE: Nom[] = ['montantsFacture', 'statutTva', 'factureCii', 'centimesExacts', 'cdarEncaissee']

const debut = (nom: Nom) => `// ── DÉBUT COPIE ${nom} ─`
const fin = (nom: Nom) => `// ── FIN COPIE ${nom} ─`

function blocDe(source: string, nom: Nom): string {
  const d = source.indexOf(debut(nom))
  const f = source.indexOf(fin(nom))
  expect(d, `bornes du bloc ${nom} introuvables`).toBeGreaterThan(-1)
  expect(source.indexOf(debut(nom), d + 1), `le bloc ${nom} est présent deux fois`).toBe(-1)
  expect(f, `le bloc ${nom} n'est pas refermé`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE = Object.fromEntries(ORDRE.map((n) => [n, blocDe(SOURCES[n], n)])) as Record<Nom, string>

const TYPES = lib('./types.ts')
const membreDroit = (source: string, type: string) => new RegExp(`^(?:export )?type ${type} = (.+)$`, 'm').exec(source)?.[1].trim() ?? null
// Les trois types que nomment les blocs de la facture électronique, déclarés comme types.ts les déclare (une fonction
// les déclare ainsi, copiesFacturation.test.ts le garde).
const DECLARATIONS = ['StatutTva', 'ArticleExoneration', 'NatureOperation'].map((t) => `type ${t} = ${membreDroit(TYPES, t)}`).join('\n')

/** Les diagnostics d'une compilation des blocs seuls : un nom emprunté hors d'eux ou déclaré deux fois s'y voit. */
function diagnostics(code: string): string[] {
  const fichier = '/copies/blocs.ts'
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true,
    lib: ['lib.es2022.d.ts'], types: [],
  }
  const hote = ts.createCompilerHost(options)
  const lire = hote.getSourceFile.bind(hote)
  hote.getSourceFile = (nom, version, ...reste) => (nom === fichier ? ts.createSourceFile(nom, code, version) : lire(nom, version, ...reste))
  const existe = hote.fileExists.bind(hote)
  hote.fileExists = (nom) => nom === fichier || existe(nom)
  return ts.getPreEmitDiagnostics(ts.createProgram([fichier], options, hote)).map((d) => `${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

type Execute = typeof cdar & { centimesExacts: typeof encaissements.centimesExacts }
const ORIGINAUX: Execute = { ...cdar, centimesExacts: encaissements.centimesExacts }

/** Les blocs SEULS, transpilés et exécutés : tout nom qu'ils emprunteraient au reste d'un fichier lèverait. */
function executer(blocs: string[]): Execute {
  const js = ts.transpileModule(blocs.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports: Record<string, unknown> = {}
  new Function('exports', js)(exports)
  return exports as unknown as Execute
}

const DONNEES = [...EXEMPLES_CDAR.map((e) => e.donnees), ...CAS_DE_REFUS_CDAR.map(([, o]) => donneesCdar(o))]
const INSTANTS = ['2027-01-15T12:00:00Z', '2027-03-28T00:59:59Z', '2027-03-28T01:00:00Z', '2027-10-31T00:59:59Z',
  '2027-10-31T01:00:00Z', '2027-12-31T23:30:00Z', 'invalide']
const FUSEAUX: FuseauCdar[] = ['Europe/Paris', 'UTC', 'America/Cayenne' as FuseauCdar]
const MONTANTS = [0, 0.01, 1.005, 4.35, -58.9, 1200, 1e21, 9_999_999_999_999.99, Number.NaN, -0]

// Une épreuve par export des deux blocs : le garde vérifie qu'il n'en manque aucune.
const EPREUVES: Record<string, (m: Execute) => unknown> = {
  CODE_STATUT_ENCAISSEE: (m) => m.CODE_STATUT_ENCAISSEE,
  LIBELLE_STATUT_ENCAISSEE: (m) => m.LIBELLE_STATUT_ENCAISSEE,
  CODE_MONTANT_ENCAISSE: (m) => m.CODE_MONTANT_ENCAISSE,
  TYPE_FACTURE_CDAR: (m) => m.TYPE_FACTURE_CDAR,
  REFERENCE_CDV_FACTURE: (m) => m.REFERENCE_CDV_FACTURE,
  LONGUEUR_MAX_MOTIF_CDAR: (m) => m.LONGUEUR_MAX_MOTIF_CDAR,
  PROFILS_CDAR: (m) => m.PROFILS_CDAR,
  SCHEMAS_PARTIE_CDAR: (m) => m.SCHEMAS_PARTIE_CDAR,
  ROLES_PARTIE_CDAR: (m) => m.ROLES_PARTIE_CDAR,
  PORTEURS_DATE_ENCAISSEMENT: (m) => m.PORTEURS_DATE_ENCAISSEMENT,
  FUSEAUX_CDAR: (m) => m.FUSEAUX_CDAR,
  horodatage204: (m) => INSTANTS.flatMap((i) => FUSEAUX.map((f) => m.horodatage204(new Date(i), f))),
  partieVendeur: (m) => [null, '12345678200010', ' 123 456 782 00010 ', '12A'].flatMap((siret) =>
    (['0002', '0009'] as const).map((schema) => m.partieVendeur({ emetteur_nom: 'Démo', emetteur_siret: siret }, schema))),
  refusMessageEncaissee: (m) => DONNEES.map((d) => m.refusMessageEncaissee(d)),
  messageEncaissee: (m) => DONNEES.map((d) => m.messageEncaissee(d)),
  centimesExacts: (m) => MONTANTS.map((x) => m.centimesExacts(x)),
}

function exportsDe(bloc: string): string[] {
  return [...bloc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1])
}

function comparer(executes: Execute, ou: string) {
  for (const [nom, epreuve] of Object.entries(EPREUVES)) expect(epreuve(executes), `${ou} : ${nom}`).toEqual(epreuve(ORIGINAUX))
}

/** Les noms qu'une source déclare à son premier niveau : fonctions, classes, types, variables, imports. */
function nomsDePremierNiveau(source: string): Set<string> {
  const fichier = ts.createSourceFile('source.ts', source, ts.ScriptTarget.ES2022, true)
  const noms = new Set<string>()
  for (const s of fichier.statements) {
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)
      || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) && s.name) {
      noms.add(s.name.text)
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) noms.add(d.name.text)
    } else if (ts.isImportDeclaration(s) && s.importClause) {
      if (s.importClause.name) noms.add(s.importClause.name.text)
      const liaisons = s.importClause.namedBindings
      if (liaisons && ts.isNamespaceImport(liaisons)) noms.add(liaisons.name.text)
      if (liaisons && ts.isNamedImports(liaisons)) for (const e of liaisons.elements) noms.add(e.name.text)
    }
  }
  return noms
}

const FONCTIONS = ['plateforme-agreee', 'superpdp-emit']
const sourceDe = (fonction: string) => readFileSync(new URL(`../../supabase/functions/${fonction}/index.ts`, import.meta.url), 'utf8')

/** Les noms du bloc que la fonction déclare déjà : un seul ferait refuser la fonction au déploiement. */
function collisions(bloc: string, source: string): string[] {
  const deja = nomsDePremierNiveau(source)
  return [...nomsDePremierNiveau(bloc)].filter((n) => deja.has(n)).sort()
}

describe('le bloc du message se recopie tel quel', () => {
  it('compilés seuls, dans l’ordre d’une fonction, les cinq blocs ne rendent aucun diagnostic', () => {
    expect(diagnostics([DECLARATIONS, ...ORDRE.map((n) => ORIGINE[n])].join('\n'))).toEqual([])
  })

  it('exécutés seuls, ils rendent ce que rendent les modules', () => {
    comparer(executer(ORDRE.map((n) => ORIGINE[n])), 'blocs seuls')
  })

  it('chaque export des deux blocs a son épreuve, et chaque épreuve son export', () => {
    expect(Object.keys(EPREUVES).sort()).toEqual([...exportsDe(ORIGINE.cdarEncaissee), ...exportsDe(ORIGINE.centimesExacts)].sort())
  })

  it('les épreuves couvrent chaque refus, et chaque exemple produit un message', () => {
    for (const [nom, o] of CAS_DE_REFUS_CDAR) expect(cdar.refusMessageEncaissee(donneesCdar(o)), nom).toHaveLength(1)
    for (const e of EXEMPLES_CDAR) expect(cdar.messageEncaissee(e.donnees).xml, e.nom).not.toBeNull()
  })

  it.each(FONCTIONS)('%s : porte déjà les trois blocs de la facture électronique, et aucun nom du nouveau bloc', (fonction) => {
    const source = sourceDe(fonction)
    for (const n of ['montantsFacture', 'statutTva', 'factureCii'] as const) expect(source, `${fonction} : ${n}`).toContain(debut(n))
    expect(collisions(ORIGINE.cdarEncaissee + ORIGINE.centimesExacts, source)).toEqual([])
  })
})

// ── Le garde mord : des défauts plantés dans une copie qui, sans eux, passe ────────────────────────────────────────
describe('le garde mord sur un défaut planté', () => {
  const blocs = (cdarModifie: string) => [DECLARATIONS, ...ORDRE.slice(0, -1).map((n) => ORIGINE[n]), cdarModifie].join('\n')

  it('la copie fidèle, elle, passe', () => {
    expect(diagnostics(blocs(ORIGINE.cdarEncaissee))).toEqual([])
  })

  it('un bloc qui emprunte un nom hors de lui (formatDate de format.ts)', () => {
    const emprunte = ORIGINE.cdarEncaissee.replace('const date102Cdar = (iso: string) => iso.replace(/-/g, \'\')',
      'const date102Cdar = (iso: string) => formatDate(iso)')
    expect(emprunte).not.toBe(ORIGINE.cdarEncaissee)
    expect(diagnostics(blocs(emprunte)).join(' ')).toContain('formatDate')
  })

  it('un nom privé qui reprendrait celui d’un bloc déjà porté (echapper)', () => {
    const doublon = ORIGINE.cdarEncaissee.replace(/\bechapperCdar\b/g, 'echapper')
    expect(diagnostics(blocs(doublon)).join(' ')).toMatch(/Duplicate function implementation|Duplicate identifier/)
  })

  it('un nom qui heurterait la fonction (dateDeParis de plateforme-agreee)', () => {
    const heurte = `${ORIGINE.cdarEncaissee}\nfunction dateDeParis(): string { return '' }\n`
    expect(collisions(heurte, sourceDe('plateforme-agreee'))).toEqual(['dateDeParis'])
  })

  it('une copie qui dérive d’un code (MEN devenu MPA) ne rend plus ce que rend le module', () => {
    const derive = ORIGINE.cdarEncaissee.replace("CODE_MONTANT_ENCAISSE = 'MEN'", "CODE_MONTANT_ENCAISSE = 'MPA'")
    expect(derive).not.toBe(ORIGINE.cdarEncaissee)
    const executes = executer([...ORDRE.slice(0, -1).map((n) => ORIGINE[n]), derive])
    expect(EPREUVES.messageEncaissee(executes)).not.toEqual(EPREUVES.messageEncaissee(ORIGINAUX))
  })

  it('un bloc sans ses bornes, ou présent deux fois', () => {
    const sansBornes = SOURCES.cdarEncaissee.replace(debut('cdarEncaissee'), '// ')
    expect(() => blocDe(sansBornes, 'cdarEncaissee')).toThrow()
    expect(() => blocDe(`${SOURCES.cdarEncaissee}\n${ORIGINE.cdarEncaissee}`, 'cdarEncaissee')).toThrow()
  })
})
