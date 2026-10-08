import { existsSync, readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { CAS_DE_REFUS, donnees, EXEMPLES } from '../test/facturesCii'
import * as cii from './factureCii'
import type { FactureCii, FactureEnBase, LigneCii } from './factureCii'
import * as montants from './montantsFacture'
import * as statut from './statutTva'
import type { ArticleExoneration, FactureEmise, FactureLigne, StatutTva } from './types'

// LES FONCTIONS QUI TRANSMETTENT UNE FACTURE (superpdp-emit, plateforme-agreee) RECOPIENT TROIS BLOCS DE
// src/lib : le calcul des montants d'une ligne, le statut de TVA et le générateur de la facture électronique.
// Elles sont auto-portées, et ce qu'elles transmettent doit être le fichier que factureCii.test.ts a fait juger
// par le validateur officiel de la norme. Ce garde pose quatre questions, et aucune ne suffit seule :
//
//   1. Chaque copie est-elle AU CARACTÈRE PRÈS le bloc de src/lib, et les trois types que les blocs nomment
//      (StatutTva, ArticleExoneration, NatureOperation) sont-ils déclarés comme types.ts les déclare ?
//   2. Les blocs se suffisent-ils à eux-mêmes ? On les compile seuls, puis on les EXÉCUTE seuls, dans l'ordre
//      de chaque fonction, contre les modules de src/lib — une référence extérieure aux copies.
//   3. La fonction s'en SERT-elle ? Un générateur parfait que le gestionnaire n'appelle plus garde du code mort.
//   4. Le garde mord-il ? Des défauts PLANTÉS dans une source synthétique doivent le faire tomber.

type Nom = 'montantsFacture' | 'statutTva' | 'factureCii'
interface Bloc {
  nom: Nom
  source: string
  // Ce qui trahit une copie, bornes ou pas : une copie écrite sans ses bornes tombe sur « bornes introuvables »
  // au lieu de passer inaperçue.
  pieces: RegExp
  // Les types que le bloc nomme sans les déclarer.
  types: string[]
}

const lib = (fichier: string) => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const BLOCS: Bloc[] = [
  { nom: 'montantsFacture', source: lib('./montantsFacture.ts'), pieces: /\bcalculerLigne\b/, types: [] },
  {
    nom: 'statutTva', source: lib('./statutTva.ts'),
    pieces: /\b(?:exonerationDe|motifExoneration|refusTauxPositif|EXONERATIONS|VATEX_FRANCHISE)\b/,
    types: ['StatutTva', 'ArticleExoneration'],
  },
  {
    nom: 'factureCii', source: lib('./factureCii.ts'), pieces: /\b(?:factureCii|refusEmission|montantsDuDocument)\b/,
    types: ['StatutTva', 'ArticleExoneration', 'NatureOperation'],
  },
]
const TYPES = lib('./types.ts')

const debut = (nom: Nom) => `// ── DÉBUT COPIE ${nom} ─`
const fin = (nom: Nom) => `// ── FIN COPIE ${nom} ─`

function blocDe(source: string, nom: Nom, ou: string): string {
  const d = source.indexOf(debut(nom))
  const f = source.indexOf(fin(nom))
  expect(d, `bornes du bloc ${nom} introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(debut(nom), d + 1), `le bloc ${nom} est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc ${nom} n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const ORIGINE: Record<Nom, string> = Object.fromEntries(BLOCS.map((b) => [b.nom, blocDe(b.source, b.nom, `${b.nom}.ts`)])) as Record<Nom, string>

function membreDroit(source: string, type: string): string | null {
  return new RegExp(`^(?:export )?type ${type} = (.+)$`, 'm').exec(source)?.[1].trim() ?? null
}

const porte = (source: string, b: Bloc) => source.includes(debut(b.nom)) || b.pieces.test(source)

/** Les blocs d'une source, dans l'ordre du fichier, après avoir vérifié l'identité, la dépendance et les types. */
function controler(source: string, ou: string): string[] {
  const portes = BLOCS.filter((b) => porte(source, b))
  if (portes.some((b) => b.nom === 'factureCii')) {
    for (const n of ['montantsFacture', 'statutTva']) expect(portes.map((b) => b.nom), `${ou} : le générateur sans le bloc ${n}`).toContain(n)
  }
  const blocs = portes
    .map((b) => {
      const copie = blocDe(source, b.nom, ou)
      expect(copie, `${ou} : le bloc ${b.nom} diffère de src/lib`).toBe(ORIGINE[b.nom])
      return { position: source.indexOf(copie), texte: copie }
    })
    .sort((x, y) => x.position - y.position)
  const horsBlocs = blocs.reduce((s, x) => s.replace(x.texte, ''), source)
  for (const t of new Set(portes.flatMap((b) => b.types))) {
    expect(membreDroit(horsBlocs, t), `${ou} : le type ${t}, déclaré hors des blocs comme types.ts le déclare`).toBe(membreDroit(TYPES, t))
  }
  return blocs.map((x) => x.texte)
}

/** Le code hors des blocs : c'est là que le gestionnaire se sert du générateur. */
function horsDesBlocs(source: string, blocs: string[]): string {
  return blocs.reduce((s, b) => s.replace(b, ''), source)
}

type Execute = typeof montants & typeof statut & typeof cii
const ORIGINAUX = { ...montants, ...statut, ...cii } as Execute

/** Les blocs SEULS, transpilés et exécutés : tout nom qu'ils emprunteraient au reste d'un fichier lèverait. */
function executer(blocs: string[]): Execute {
  const js = ts.transpileModule(blocs.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports: Record<string, unknown> = {}
  new Function('exports', js)(exports)
  return exports as unknown as Execute
}

/** Les diagnostics d'une compilation des blocs seuls : un nom emprunté hors d'eux s'y voit, même jamais exécuté. */
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

const DECLARATIONS = ['StatutTva', 'ArticleExoneration', 'NatureOperation'].map((t) => `type ${t} = ${membreDroit(TYPES, t)}`).join('\n')

// ── Les épreuves : une par export des blocs, sur des entrées qui couvrent ses branches ────────────────────────────
const LIGNES: [number, number, number][] = [
  [1, 100, 20], [1, 100, 10], [1, 100, 5.5], [1, 100, 2.1], [1, 100, 0], [3, 33.33, 20], [7, 14.29, 5.5],
  [1, 0.005, 20], [1, 0.015, 20], [2, 0.005, 20], [1.5, 19.99, 20], [0.25, 80, 10], [12, 8.33, 2.1], [1, 1234.56, 20],
  [-1, 100, 20], [-3, 33.33, 20], [-1, 0.005, 20], [-1.5, 19.99, 5.5], [0, 100, 20], [-1, 0.125, 0], [-1, 0.004, 20],
]
// L'arrondi du HT déplace la TVA d'un centime sur ces lignes seulement : sans elles, une copie qui calculerait la
// TVA sur le produit brut passerait (cas trouvés par recherche exhaustive, voir le test qui le vérifie).
const DEMI_CENTIME: [number, number, number][] = [[1, 0.175, 20], [3, 0.075, 20], [5, 0.045, 20], [9, 0.075, 20], [13, 1.325, 20]]
const STATUTS: (StatutTva | null)[] = [null, 'redevable', 'franchise', 'exonere']
const ARTICLES: (ArticleExoneration | null)[] = [null, ...statut.EXONERATIONS.map((e) => e.code)]
const TAUX = [0, 2.1, 5.5, 8.5, 10, 20, -1]
const IDENTIFIANTS = [null, undefined, '', '123456782', '123456789', '12345678200010', '12345678200011', '35600000000048',
  '35600000012345', ' 123 456 782 ', '123456782 00010', 'abcdefghi']
const ADRESSES = [null, '', '1 rue de la Paix\n75002 Paris', '1 rue X\nBât. B\nEscalier 3\n69001 Lyon', 'Une seule ligne 13001 Marseille',
  'Rue\n\n  \nVille', '12 avenue Foch\r\n75116   Paris\r\nFrance']
const essai = (f: () => unknown) => {
  try {
    return f()
  } catch (e) {
    return { leve: String(e) }
  }
}

const EPREUVES: Record<string, (m: Execute) => unknown> = {
  calculerLigne: (m) => [...LIGNES, ...DEMI_CENTIME].map(([q, p, t]) => m.calculerLigne(q, p, t)),
  EXONERATIONS: (m) => m.EXONERATIONS,
  exonerationDe: (m) => ARTICLES.map((a) => m.exonerationDe(a)),
  MENTION_FRANCHISE: (m) => m.MENTION_FRANCHISE,
  VATEX_FRANCHISE: (m) => m.VATEX_FRANCHISE,
  motifExoneration: (m) => STATUTS.flatMap((s) => ARTICLES.map((a) => m.motifExoneration(s, a))),
  refusTauxPositif: (m) => STATUTS.flatMap((s) => TAUX.map((t) => m.refusTauxPositif(s, t))),
  PROFIL_EN16931: (m) => m.PROFIL_EN16931,
  UNITE_GENERIQUE: (m) => m.UNITE_GENERIQUE,
  TAUX_ADMIS: (m) => m.TAUX_ADMIS,
  SCHEMA_ADRESSE_ELECTRONIQUE: (m) => m.SCHEMA_ADRESSE_ELECTRONIQUE,
  sirenValide: (m) => IDENTIFIANTS.map((s) => m.sirenValide(s)),
  siretValide: (m) => IDENTIFIANTS.map((s) => m.siretValide(s)),
  sirenDe: (m) => IDENTIFIANTS.map((s) => m.sirenDe(s)),
  numeroTvaFrancais: (m) => ['123456782', '100000207', '987654324', '000000000'].map((s) => m.numeroTvaFrancais(s)),
  adresseStructuree: (m) => ADRESSES.map((a) => m.adresseStructuree(a)),
  montantsDuDocument: (m) => EXEMPLES.flatMap((e) => [null, { code: statut.VATEX_FRANCHISE, texte: statut.MENTION_FRANCHISE }]
    .map((motif) => essai(() => m.montantsDuDocument(e.donnees.facture, e.donnees.lignes, motif)))),
  decimal: (m) => ([[1.005, 2], [12.5, 0], [0.000001, 6], [-3.14159, 4], [1e21, 2], [Number.NaN, 2], [Infinity, 2], [-0, 2]] as const)
    .map(([x, d]) => m.decimal(x, d)),
  numeroAdmis: (m) => ['F2026-0001', ' F1', 'F1 ', 'F 1', 'F  1', 'x'.repeat(35), 'x'.repeat(36), 'A2026-0001', ''].map((n) => m.numeroAdmis(n)),
  refusEmission: (m) => [...EXEMPLES.map((e) => m.refusEmission(e.donnees)), ...CAS_DE_REFUS.map(([, c]) => m.refusEmission(donnees(c)))],
  cadreDeFacturation: (m) => (['biens', 'services', 'mixte'] as const).map((n) => m.cadreDeFacturation(n)),
  donneesDeLaFacture: (m) => EXEMPLES.slice(0, 2).flatMap((e) => STATUTS.flatMap((s) => IDENTIFIANTS.map((siret) =>
    m.donneesDeLaFacture({ ...e.donnees.facture, emetteur_nom: 'Démo', emetteur_siret: siret ?? null, emetteur_adresse: null },
      e.donnees.lignes, { statut_tva: s, article_exoneration: s === 'exonere' ? 'cgi_261_4_1' : null }, e.donnees.origine, '2026-10-08')))),
  factureCii: (m) => [...EXEMPLES.map((e) => m.factureCii(e.donnees)), ...CAS_DE_REFUS.map(([, c]) => m.factureCii(donnees(c)))],
}

function exportsDe(bloc: string): string[] {
  return [...bloc.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1])
}

function comparer(executes: Execute, ou: string) {
  for (const [nom, epreuve] of Object.entries(EPREUVES)) expect(epreuve(executes), `${ou} : ${nom}`).toEqual(epreuve(ORIGINAUX))
}

// ── Les Edge Functions ────────────────────────────────────────────────────────────────────────────────────────────
const DOSSIER = new URL('../../supabase/functions/', import.meta.url)
const sourceDe = (fonction: string) => readFileSync(new URL(`${fonction}/index.ts`, DOSSIER), 'utf8')
const FONCTIONS = readdirSync(DOSSIER, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/index.ts`, DOSSIER)))
  .map((d) => d.name)
  .sort()
const PORTEUSES = FONCTIONS.filter((f) => BLOCS.some((b) => porte(sourceDe(f), b)))
const GENERATEUR = BLOCS.find((b) => b.nom === 'factureCii') as Bloc

/** Ce que chaque fonction qui porte le générateur fait : assembler la facture comme l'écran, la juger, puis la produire. */
function cablage(source: string, blocs: string[], ou: string) {
  const code = horsDesBlocs(source, blocs)
  expect(code, `${ou} : le gestionnaire n'assemble pas la facture par donneesDeLaFacture`).toMatch(/\bdonneesDeLaFacture\(/)
  expect(code, `${ou} : le gestionnaire n'appelle pas refusEmission`).toMatch(/\brefusEmission\(/)
  expect(code, `${ou} : le gestionnaire n'appelle pas factureCii`).toMatch(/\bfactureCii\(/)
}

// Les colonnes d'une facture en base que le générateur lit, et elles seules : le compilateur refuse ici une clé de trop
// ou de moins. Une colonne que la fonction ne lit pas arriverait `undefined` au générateur, qui la tiendrait pour vide
// sans rien dire — une option pour les débits, une adresse de livraison perdues en route.
const LUES_PAR_LE_GENERATEUR: Record<keyof FactureEnBase, true> = {
  numero: true, statut: true, type: true, date_emission: true, date_echeance: true, tiers_nom: true, tiers_adresse: true,
  tiers_siret: true, montant_ht: true, montant_tva: true, montant_ttc: true, mentions_legales: true, type_client: true,
  tiers_siren: true, tiers_adresse_electronique: true, code_service: true, numero_engagement: true, nature_operation: true,
  date_prestation: true, periode_debut: true, periode_fin: true, livraison_adresse: true, livraison_code_postal: true,
  livraison_ville: true, livraison_pays: true, option_debits: true, emetteur_nom: true, emetteur_siret: true,
  emetteur_adresse: true,
}

/** Les colonnes d'un `const NOM = "…" + "…"`, telles que la fonction les passe à `.select(`. */
function colonnesDe(source: string, nom: string, ou: string): string[] {
  const m = new RegExp(`^const ${nom} = ((?:"[^"]*"\\s*\\+\\s*)*"[^"]*")`, 'm').exec(source)
  expect(m, `${ou} : la liste ${nom} introuvable`).not.toBeNull()
  return [...(m as RegExpExecArray)[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('').split(',').map((c) => c.trim())
}

describe('les blocs de facturation recopiés dans les Edge Functions', () => {
  it.each(FONCTIONS.filter((f) => porte(sourceDe(f), GENERATEUR)))(
    '%s : lit en base chaque colonne que le générateur lit, et pas les notes internes',
    (fonction) => {
      const source = sourceDe(fonction)
      expect(source, fonction).toContain('.select(COLONNES_FACTURE)')
      const lues = colonnesDe(source, 'COLONNES_FACTURE', fonction)
      for (const c of Object.keys(LUES_PAR_LE_GENERATEUR)) expect(lues, `${fonction} : ${c}`).toContain(c)
      // Une note interne n'a rien à faire dans ce que la fonction transmet : elle ne la lit même pas.
      expect(lues).not.toContain('notes')
    },
  )

  it('plancher : les deux fonctions qui transmettent une facture portent le générateur', () => {
    expect(FONCTIONS.filter((f) => porte(sourceDe(f), GENERATEUR))).toEqual(expect.arrayContaining(['plateforme-agreee', 'superpdp-emit']))
  })

  it.each(PORTEUSES)('%s : les blocs au caractère près, exécutés seuls dans son ordre, et le générateur appelé', (fonction) => {
    const source = sourceDe(fonction)
    const blocs = controler(source, fonction)
    comparer(executer(blocs), fonction)
    if (porte(source, GENERATEUR)) cablage(source, blocs, fonction)
  })

  it('superpdp-emit ne garde rien de l’ancien chemin (JSON de Super PDP, conversion, copies d’avant)', () => {
    const source = sourceDe('superpdp-emit')
    for (const reste of ['construireEnInvoice', '/invoices/convert', 'calculerLigneMontants', '── DÉBUT STATUT TVA', 'motifDeLaFacture']) {
      expect(source, reste).not.toContain(reste)
    }
  })
})

describe('les blocs de src/lib', () => {
  it('se compilent seuls, avec les trois types déclarés comme types.ts les déclare', () => {
    expect(diagnostics([DECLARATIONS, ORIGINE.montantsFacture, ORIGINE.statutTva, ORIGINE.factureCii].join('\n'))).toEqual([])
  })

  it('exécutés seuls, rendent ce que rendent les modules', () => {
    comparer(executer([ORIGINE.montantsFacture, ORIGINE.statutTva, ORIGINE.factureCii]), 'src/lib')
  })

  it('chaque export d’un bloc a son épreuve, et chaque épreuve son export', () => {
    expect(Object.keys(EPREUVES).sort()).toEqual(BLOCS.flatMap((b) => exportsDe(ORIGINE[b.nom])).sort())
  })

  it('les lignes au demi-centime distinguent bien la TVA du HT arrondi de celle du produit brut', () => {
    for (const [q, p, t] of DEMI_CENTIME) expect(Math.round(q * p * (t / 100) * 100) / 100).not.toBe(montants.calculerLigne(q, p, t).montant_tva)
  })

  it('une facture et ses lignes de types.ts se lisent comme le générateur les lit (vérifié par le compilateur, sans `as`)', () => {
    const facture = (f: FactureEmise): FactureCii => f
    const ligne = (l: FactureLigne): LigneCii => l
    expect([facture, ligne]).toHaveLength(2)
  })
})

// ── Le garde mord : des défauts plantés dans une source qui, sans eux, passe ────────────────────────────────────
const GESTIONNAIRE = 'Deno.serve(() => { const d = donneesDeLaFacture(f, l, s, o, j); const refus = refusEmission(d); '
  + 'const r = factureCii(d); return refus ?? r })'
const SYNTHETIQUE = [DECLARATIONS, ORIGINE.montantsFacture, ORIGINE.statutTva, ORIGINE.factureCii, GESTIONNAIRE].join('\n')

function tout(source: string) {
  const blocs = controler(source, 'synthétique')
  comparer(executer(blocs), 'synthétique')
  cablage(source, blocs, 'synthétique')
}

/** Vrai si le garde tombe — sur un échec d'assertion, et sur rien d'autre : une erreur d'exécution n'est pas une prise. */
function echoue(f: () => void): boolean {
  try {
    f()
    return false
  } catch (e) {
    return (e as Error).name === 'AssertionError'
  }
}

describe('le garde mord sur un défaut planté', () => {
  it('la source synthétique, elle, passe', () => {
    expect(echoue(() => tout(SYNTHETIQUE))).toBe(false)
  })

  it('un bloc qui dérive d’un caractère (l’arrondi asymétrique d’avant)', () => {
    expect(SYNTHETIQUE).toContain('Math.abs(x) * 100')
    expect(echoue(() => tout(SYNTHETIQUE.replace('Math.abs(x) * 100', 'x * 100')))).toBe(true)
  })

  it('le générateur sans le bloc des montants', () => {
    expect(echoue(() => tout(SYNTHETIQUE.replace(ORIGINE.montantsFacture, '')))).toBe(true)
  })

  it('une copie sans ses bornes', () => {
    const sansBornes = ORIGINE.statutTva.split('\n').filter((l) => !l.startsWith('// ── ')).join('\n')
    expect(echoue(() => tout(SYNTHETIQUE.replace(ORIGINE.statutTva, sansBornes)))).toBe(true)
  })

  it('un bloc présent deux fois', () => {
    expect(echoue(() => tout(`${SYNTHETIQUE}\n${ORIGINE.montantsFacture}`))).toBe(true)
  })

  it('un type déclaré autrement que types.ts, ou pas déclaré', () => {
    expect(echoue(() => tout(SYNTHETIQUE.replace("type NatureOperation = 'biens' | 'services' | 'mixte'", "type NatureOperation = 'biens' | 'services'")))).toBe(true)
    expect(echoue(() => tout(SYNTHETIQUE.replace(/^type StatutTva = .+$/m, '')))).toBe(true)
  })

  it('un gestionnaire qui n’appelle plus le générateur', () => {
    expect(echoue(() => tout(SYNTHETIQUE.replace('const r = factureCii(d); ', '')))).toBe(true)
    expect(echoue(() => tout(SYNTHETIQUE.replace('const refus = refusEmission(d); ', '')))).toBe(true)
    expect(echoue(() => tout(SYNTHETIQUE.replace('const d = donneesDeLaFacture(f, l, s, o, j); ', '')))).toBe(true)
  })

  it('un bloc qui emprunte un nom hors de lui', () => {
    const emprunte = ORIGINE.factureCii.replace("PROFIL_EN16931 = 'urn:cen.eu:en16931:2017'", "PROFIL_EN16931 = formatDate('urn:cen.eu:en16931:2017')")
    expect(emprunte).not.toBe(ORIGINE.factureCii)
    expect(diagnostics([DECLARATIONS, ORIGINE.montantsFacture, ORIGINE.statutTva, emprunte].join('\n')).join(' ')).toContain('formatDate')
  })
})
