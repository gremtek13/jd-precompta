import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  choixFrr, DECLARATION_ACHATS, DECLARATION_PAIEMENTS_CONTRE_PASSATION, DECLARATION_VENTES, donneesFrr, EXEMPLES_FRR, PLATEFORME_FRR,
  TROIS_DECEMBRE,
} from '../test/fluxEreporting'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'
import * as frr from './fluxEreporting'
import type { DonneesFrr, FuseauFrr } from './fluxEreporting'

// LE FICHIER DE L'E-REPORTING SERA RECOPIÉ DANS plateforme-agreee (étape e9), qui le déposera : elle est auto-portée, et
// ce qu'elle déposera doit être le fichier que fluxEreporting.test.ts a fait juger par le schéma XSD du flux 10. Aucune
// copie n'existe encore ; ce garde vérifie, AVANT elle, que la copie est possible telle quelle — e9 l'étendra à la copie
// elle-même, comme copiesFacturation.test.ts pour le générateur de la facture électronique. Trois questions, et aucune ne
// suffit seule :
//
//   1. Le bloc se suffit-il, derrière ceux que la fonction porte déjà ? On compile SEULS, dans l'ordre de la fonction,
//      montantsFacture, statutTva, factureCii et fluxEreporting : un nom emprunté hors d'eux, un nom en double, se voit
//      au compilateur.
//   2. Exécuté seul, rend-il ce que rend le module de src/lib — une référence extérieure au bloc ? Une épreuve par export,
//      sur les exemples et sur un cas par famille de refus.
//   3. Le bloc entre-t-il dans la fonction sans heurter un de ses noms ?
//
// Et le garde mord : des défauts plantés le font tomber.

type Nom = 'montantsFacture' | 'statutTva' | 'factureCii' | 'fluxEreporting'

const lib = (fichier: string) => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const SOURCES: Record<Nom, string> = {
  montantsFacture: lib('./montantsFacture.ts'),
  statutTva: lib('./statutTva.ts'),
  factureCii: lib('./factureCii.ts'),
  fluxEreporting: lib('./fluxEreporting.ts'),
}
// L'ordre de la fonction : chaque bloc après ceux qu'il lit.
const ORDRE: Nom[] = ['montantsFacture', 'statutTva', 'factureCii', 'fluxEreporting']

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
// Les trois types que nomment les blocs de la facture électronique, déclarés comme types.ts les déclare (la fonction
// les déclare ainsi, copiesFacturation.test.ts le garde).
const DECLARATIONS = ['StatutTva', 'ArticleExoneration', 'NatureOperation'].map((t) => `type ${t} = ${membreDroit(TYPES, t)}`).join('\n')

function diagnostics<Cle extends string>(codes: Record<Cle, string>): Record<Cle, string[]> {
  return diagnosticsSepares(codes, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true,
    lib: ['lib.es2022.d.ts'], types: [],
  })
}

/** Les blocs SEULS, transpilés et exécutés : tout nom qu'ils emprunteraient au reste d'un fichier lèverait. */
const executer = (blocs: string[]): typeof frr => executerModule<typeof frr>(blocs.join('\n'))

// Un cas par famille de refus, en plus des exemples : la déclaration, le contenu, chaque choix, l'en-tête, la période,
// un achat, des ventes, des paiements, un texte libre.
const changee = (f: (c: Record<string, unknown>) => void, dec = DECLARATION_ACHATS) => {
  const c = JSON.parse(JSON.stringify(dec.contenu)) as Record<string, unknown>
  f(c)
  return { ...dec, contenu: c }
}
const DONNEES: DonneesFrr[] = [
  ...EXEMPLES_FRR.map((e) => e.donnees),
  donneesFrr({ declaration: { ...DECLARATION_ACHATS, objet: 'tva' } }),
  donneesFrr({ declaration: { ...DECLARATION_ACHATS, etat: 'remplacee', type_transmission: 'RE', id: 'é' } }),
  donneesFrr({ declaration: { ...DECLARATION_ACHATS, contenu: null } }),
  donneesFrr({ declaration: changee((c) => { c.version = 2 }) }),
  donneesFrr({ declaration: changee((c) => { delete c.siren }) }),
  donneesFrr({ declaration: changee((c) => { c.role = 'SE'; c.paiements = [{}] }) }),
  donneesFrr({ choix: choixFrr({ emetteur: { ...PLATEFORME_FRR, identifiant: '1', role: 'SE', nom: '' } }) }),
  donneesFrr({ choix: choixFrr({ fuseau: 'x' as never, codeOptionDebits: '4' as never, paiementsNegatifs: 'oui' as never }) }),
  donneesFrr({ maintenant: new Date('2027-10-31T21:00:00Z'), nomDuDeclarant: '' }),
  donneesFrr({ declaration: changee((c) => { c.numeroTva = null; c.siren = '123456789' }) }),
  donneesFrr({ declaration: changee((c) => {
    const a = (c.achats as Record<string, unknown>[])[0]
    Object.assign(a, { numero: 'é', dateFacture: '1999-01-01', typeDocument: '384', devise: 'eu', cadre: 'X', schema: '0227', htCentimes: 1 })
  }) }),
  donneesFrr({ declaration: changee((c) => {
    const t = (c.transactions as Record<string, unknown>[])[0]
    Object.assign(t, { date: '2027-11-01', devise: 'USD', categorie: 'X', optionDebits: true, htCentimes: 1 })
  }, DECLARATION_VENTES) }),
  donneesFrr({ declaration: DECLARATION_PAIEMENTS_CONTRE_PASSATION, maintenant: TROIS_DECEMBRE, choix: choixFrr({ paiementsNegatifs: 'refuses' }) }),
  donneesFrr({ nomDuDeclarant: 'Démo\u0001', declaration: changee((c) => { c.achats = [] }) }),
]
const INSTANTS = ['2027-01-15T12:00:00Z', '2027-03-28T00:59:59Z', '2027-03-28T01:00:00Z', '2027-10-31T00:59:59Z',
  '2027-10-31T01:00:00Z', '2027-12-31T23:30:00Z', 'invalide']
const FUSEAUX: FuseauFrr[] = ['Europe/Paris', 'UTC', 'America/Cayenne' as FuseauFrr]

// Une épreuve par export du bloc : le garde vérifie qu'il n'en manque aucune.
const EPREUVES: Record<string, (m: typeof frr) => unknown> = {
  PROFIL_EREPORTING: (m) => m.PROFIL_EREPORTING,
  VERSION_DU_CONTENU_FRR: (m) => m.VERSION_DU_CONTENU_FRR,
  OBJETS_FRR: (m) => m.OBJETS_FRR,
  ROLE_DU_DECLARANT_FRR: (m) => m.ROLE_DU_DECLARANT_FRR,
  TYPES_DE_FACTURE_FRR: (m) => m.TYPES_DE_FACTURE_FRR,
  CADRES_FRR: (m) => m.CADRES_FRR,
  CODES_TVA_FRR: (m) => m.CODES_TVA_FRR,
  CATEGORIES_FRR: (m) => m.CATEGORIES_FRR,
  ETATS_MEMBRES_FRR: (m) => m.ETATS_MEMBRES_FRR,
  MOTIF_VATEX_FRR: (m) => m.MOTIF_VATEX_FRR.source,
  MOTIF_AVOIR_NET_DE_TAXE_FRR: (m) => m.MOTIF_AVOIR_NET_DE_TAXE_FRR,
  SCHEMAS_EMETTEUR_FRR: (m) => m.SCHEMAS_EMETTEUR_FRR,
  ROLES_EMETTEUR_FRR: (m) => m.ROLES_EMETTEUR_FRR,
  FUSEAUX_FRR: (m) => m.FUSEAUX_FRR,
  CODES_OPTION_DEBITS_FRR: (m) => m.CODES_OPTION_DEBITS_FRR,
  PAIEMENTS_NEGATIFS_FRR: (m) => m.PAIEMENTS_NEGATIFS_FRR,
  REFUS_FRR: (m) => m.REFUS_FRR,
  horodatageFrr: (m) => INSTANTS.flatMap((i) => FUSEAUX.map((f) => m.horodatageFrr(new Date(i), f))),
  refusFichierFrr: (m) => DONNEES.map((d) => m.refusFichierFrr(d)),
  fichierFrr: (m) => DONNEES.map((d) => m.fichierFrr(d)),
}

const exportsDe = (bloc: string) => [...bloc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1])

function comparer(executes: typeof frr, ou: string) {
  for (const [nom, epreuve] of Object.entries(EPREUVES)) expect(epreuve(executes), `${ou} : ${nom}`).toEqual(epreuve(frr))
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

const PLATEFORME_AGREEE = readFileSync(new URL('../../supabase/functions/plateforme-agreee/index.ts', import.meta.url), 'utf8')

/** Les noms du bloc que la fonction déclare déjà : un seul ferait refuser la fonction au déploiement. */
function collisions(bloc: string, source: string): string[] {
  const deja = nomsDePremierNiveau(source)
  return [...nomsDePremierNiveau(bloc)].filter((n) => deja.has(n)).sort()
}

const avecFrr = (frrModifie: string) => [DECLARATIONS, ...ORDRE.slice(0, -1).map((n) => ORIGINE[n]), frrModifie].join('\n')
// Un bloc qui emprunte un nom hors de lui (formatDate de format.ts).
const EMPRUNTE = ORIGINE.fluxEreporting.replace("const dateFrr = (iso: string) => iso.replace(/-/g, '')",
  'const dateFrr = (iso: string) => formatDate(iso)')
// Un nom privé qui reprendrait celui d'un bloc déjà porté (echapper, du bloc factureCii).
const DOUBLON = ORIGINE.fluxEreporting.replace(/\bechapperFrr\b/g, 'echapper')
const COMPILES = {
  ordre: [DECLARATIONS, ...ORDRE.map((n) => ORIGINE[n])].join('\n'),
  emprunte: avecFrr(EMPRUNTE),
  doublon: avecFrr(DOUBLON),
}

// La compilation se paye UNE fois par fichier, ici, sous un délai déclaré pour elle seule ; nulle tant qu'elle n'a rien
// rendu.
let compiles: Record<keyof typeof COMPILES, string[]> | null = null
beforeAll(() => {
  compiles = diagnostics(COMPILES)
}, 60_000)
const compile = () => compiles as Record<keyof typeof COMPILES, string[]>

describe('le bloc du fichier se recopie tel quel', () => {
  it('compilés seuls, dans l’ordre de la fonction, les quatre blocs ne rendent aucun diagnostic', () => {
    expect(compiles).not.toBeNull()
    expect(compile().ordre).toEqual([])
  })

  it('exécutés seuls, ils rendent ce que rend le module', () => {
    comparer(executer(ORDRE.map((n) => ORIGINE[n])), 'blocs seuls')
  })

  it('chaque export du bloc a son épreuve, et chaque épreuve son export', () => {
    expect(Object.keys(EPREUVES).sort()).toEqual(exportsDe(ORIGINE.fluxEreporting).sort())
  })

  it('les épreuves écrivent chaque exemple et refusent chaque cas ajouté', () => {
    const n = EXEMPLES_FRR.length
    for (const d of DONNEES.slice(0, n)) expect(frr.fichierFrr(d).xml).not.toBeNull()
    for (const d of DONNEES.slice(n)) expect(frr.fichierFrr(d).xml).toBeNull()
  })

  it('plateforme-agreee porte déjà les trois blocs de la facture électronique, et aucun nom du nouveau bloc', () => {
    for (const n of ['montantsFacture', 'statutTva', 'factureCii'] as const) expect(PLATEFORME_AGREEE, n).toContain(debut(n))
    expect(PLATEFORME_AGREEE).not.toContain(debut('fluxEreporting'))
    expect(collisions(ORIGINE.fluxEreporting, PLATEFORME_AGREEE)).toEqual([])
  })
})

// ── Le garde mord : des défauts plantés dans une copie qui, sans eux, passe ────────────────────────────────────────
describe('le garde mord sur un défaut planté', () => {
  it('un bloc qui emprunte un nom hors de lui (formatDate de format.ts)', () => {
    expect(EMPRUNTE).not.toBe(ORIGINE.fluxEreporting)
    expect(compile().emprunte.join(' ')).toContain('formatDate')
  })

  it('un nom privé qui reprendrait celui d’un bloc déjà porté (echapper)', () => {
    expect(compile().doublon.join(' ')).toMatch(/Duplicate function implementation|Duplicate identifier/)
  })

  it('un nom qui heurterait la fonction (dateDeParis de plateforme-agreee)', () => {
    const heurte = `${ORIGINE.fluxEreporting}\nfunction dateDeParis(): string { return '' }\n`
    expect(collisions(heurte, PLATEFORME_AGREEE)).toEqual(['dateDeParis'])
  })

  it('une copie qui dérive (le profil changé) ne rend plus ce que rend le module', () => {
    const derive = ORIGINE.fluxEreporting.replace("PROFIL_EREPORTING = 'urn.cpro.gouv.fr:1p0:ereporting'", "PROFIL_EREPORTING = 'urn:ereporting'")
    expect(derive).not.toBe(ORIGINE.fluxEreporting)
    const executes = executer([...ORDRE.slice(0, -1).map((n) => ORIGINE[n]), derive])
    expect(EPREUVES.fichierFrr(executes)).not.toEqual(EPREUVES.fichierFrr(frr))
  })

  it('un bloc sans ses bornes, ou présent deux fois', () => {
    const sansBornes = SOURCES.fluxEreporting.replace(debut('fluxEreporting'), '// ')
    expect(() => blocDe(sansBornes, 'fluxEreporting')).toThrow()
    expect(() => blocDe(`${SOURCES.fluxEreporting}\n${ORIGINE.fluxEreporting}`, 'fluxEreporting')).toThrow()
  })
})
