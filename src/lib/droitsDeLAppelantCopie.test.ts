import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'
import { QUI_PEUT_QUOI_ATTENDU } from '../test/quiPeutQuoi'

// LE BLOC droitsDeLAppelant DANS LES QUATRE FONCTIONS DE LA VENTE (espace client, étape P3, 10/10/2026).
// plateforme-agreee, superpdp-emit, superpdp-credentials et send-email sont auto-portées : chacune lit les droits de son
// appelant par une COPIE du même bloc, puis juge l'action demandée contre sa table « qui peut quoi ». Une copie qui
// dériverait ouvrirait une vente à qui ne la porte pas, ou prendrait une base muette pour un accord. Le bloc n'a pas
// d'original dans src/lib : la référence extérieure aux copies est la GRILLE de ce fichier, écrite d'après ce que la
// migration P1 promet (`droits_sur_le_dossier` rend {cabinet, membre, ventes, banque}, quatre booléens), jamais d'après
// le texte d'une copie (CLAUDE.md, « Une Edge Function auto-portée duplique du code »). Quatre questions :
//   1. Les quatre copies sont-elles le même texte, bornes comprises (la session les recopie au déploiement) ?
//   2. Le bloc se suffit-il, compilé seul et strict ?
//   3. EXÉCUTÉE seule, chaque copie rend-elle ce que la grille attend — l'appel fait avec le seul jeton reçu, une
//      réponse lue comme accord seulement quand elle a sa forme exacte, une action permise seulement par la table ?
//   4. Chaque fonction s'en SERT-elle, avant toute lecture et tout appel extérieur, et ne garde-t-elle rien de l'ancien
//      contrôle ? Et sa table est-elle celle que la conception arrête (§3.5, hypothèse EC-Q4) ?

const FONCTIONS = ['plateforme-agreee', 'superpdp-emit', 'superpdp-credentials', 'send-email'] as const
type Fonction = (typeof FONCTIONS)[number]
const SOURCES = Object.fromEntries(FONCTIONS.map((f) => [
  f, readFileSync(new URL(`../../supabase/functions/${f}/index.ts`, import.meta.url), 'utf8'),
])) as Record<Fonction, string>
const DEBUT = '// ── DÉBUT COPIE droitsDeLAppelant '
const FIN = '// ── FIN COPIE droitsDeLAppelant '

function blocDe(source: string, ou: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  expect(d, `bornes du bloc droitsDeLAppelant introuvables dans ${ou}`).toBeGreaterThan(-1)
  expect(source.indexOf(DEBUT, d + 1), `le bloc droitsDeLAppelant est présent deux fois dans ${ou}`).toBe(-1)
  expect(f, `le bloc droitsDeLAppelant n'est pas refermé dans ${ou}`).toBeGreaterThan(d)
  return source.slice(d, source.indexOf('\n', f) + 1)
}

const BLOCS = Object.fromEntries(FONCTIONS.map((f) => [f, blocDe(SOURCES[f], f)])) as Record<Fonction, string>

interface Droits { cabinet: boolean; membre: boolean; ventes: boolean; banque: boolean }
type ReponseRpc = { data: unknown; error: unknown }
interface Appelant { rpc: (nom: string, args: { p_dossier_id: string }) => PromiseLike<ReponseRpc> }
interface Copie {
  droitsDeLAppelant: (appelant: Appelant, dossierId: string) => Promise<{ droits: Droits } | { illisible: string }>
  actionPermise: (table: Readonly<Record<string, string>>, action: string, droits: Droits) => boolean
}

/** Le bloc SEUL, rendu module : tout nom qu'il emprunterait au reste d'une fonction lèverait. */
const enModule = (bloc: string) => `${bloc}\nexport { droitsDeLAppelant, actionPermise }\n`
const executer = (bloc: string): Copie => executerModule<Copie>(enModule(bloc))

// ── La grille : ce que la base peut rendre ──────────────────────────────────────────────────────────────────────────

const CLES = ['cabinet', 'membre', 'ventes', 'banque'] as const

/** Les seize jeux de quatre cases. */
const JEUX: Droits[] = Array.from({ length: 16 }, (_, n) => ({
  cabinet: (n & 1) !== 0, membre: (n & 2) !== 0, ventes: (n & 4) !== 0, banque: (n & 8) !== 0,
}))

/** Des réponses d'une autre forme : une case absente, d'un autre type, ou pas d'objet du tout. */
const DEFORMEES: unknown[] = [
  null, undefined, true, 1, 'ventes', '{"cabinet":true}', [], [true, true, true, true], [JEUX[15]], { droits_sur_le_dossier: JEUX[15] },
  ...CLES.map((c) => Object.fromEntries(CLES.filter((x) => x !== c).map((x) => [x, true]))),
  ...CLES.flatMap((c) => ['true', 1, 0, null, {}, [true]].map((v) => ({ ...JEUX[15], [c]: v }))),
]

/** Une case de PLUS ne ferme rien : un domaine neuf est une clé de plus, sans changer la signature (migration P1). */
const ELARGIES: unknown[] = JEUX.map((j) => ({ ...j, devis: true, autre: 'x' }))

const ERREURS: unknown[] = [{ message: 'délai dépassé', code: '57014' }, { message: '' }, {}, 'refus', 0, false, []]

type Cas = { nom: string; rpc: () => PromiseLike<ReponseRpc> }
const CAS: Cas[] = [
  ...[...JEUX, ...DEFORMEES, ...ELARGIES].map((data, i) => ({ nom: `données ${i}`, rpc: () => Promise.resolve({ data, error: null }) })),
  ...[...JEUX, ...DEFORMEES].flatMap((data, i) => ERREURS.map((error, k) => ({
    nom: `données ${i}, erreur ${k}`, rpc: () => Promise.resolve({ data, error }),
  }))),
  { nom: 'rpc qui lève', rpc: () => { throw new TypeError('fetch failed') } },
  { nom: 'rpc rejetée', rpc: () => Promise.reject(new Error('réseau')) },
  { nom: 'rpc qui ne rend rien', rpc: () => Promise.resolve(undefined as unknown as ReponseRpc) },
  { nom: 'rpc qui rend null', rpc: () => Promise.resolve(null as unknown as ReponseRpc) },
  { nom: 'une erreur sans données', rpc: () => Promise.resolve({ error: { message: 'refus' } } as unknown as ReponseRpc) },
]

/**
 * LA RÉFÉRENCE : ce que la migration P1 promet. Un accord n'existe que si l'appel a rendu, sans erreur (nulle ou
 * absente), un objet (ni tableau, ni nul) dont les quatre cases sont des booléens ; il vaut alors ces quatre cases.
 * Tout le reste est illisible.
 */
async function lectureAttendue(c: Cas): Promise<Droits | 'illisible'> {
  let reponse: ReponseRpc
  try {
    reponse = await c.rpc()
  } catch {
    return 'illisible'
  }
  if (reponse === null || reponse === undefined) return 'illisible'
  if (reponse.error !== null && reponse.error !== undefined) return 'illisible'
  const d = reponse.data
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return 'illisible'
  const cases = d as Record<string, unknown>
  for (const cle of CLES) if (cases[cle] !== true && cases[cle] !== false) return 'illisible'
  return { cabinet: cases.cabinet === true, membre: cases.membre === true, ventes: cases.ventes === true, banque: cases.banque === true }
}

async function lectureDe(copie: Copie, c: Cas): Promise<{ lu: Droits | 'illisible'; appels: unknown[] }> {
  const appels: unknown[] = []
  const appelant: Appelant = { rpc: (nom, args) => { appels.push([nom, args]); return c.rpc() } }
  const r = await copie.droitsDeLAppelant(appelant, 'd1000000-0000-4000-8000-000000000001')
  if ('illisible' in r) {
    // Le motif est dit à l'écran (503) : un texte, jamais vide.
    expect(typeof r.illisible === 'string' && r.illisible.length > 0, `${c.nom} : motif ${String(r.illisible)}`).toBe(true)
    return { lu: 'illisible', appels }
  }
  return { lu: r.droits, appels }
}

// Les tables : une de chaque droit, des valeurs qui ne sont pas un droit, et des noms d'action que tout objet hérite.
const TABLE: Record<string, string> = { a: 'cabinet', b: 'ventes', c: 'banque', d: 'membre', e: '', f: 'Ventes' }
const HERITEE: Record<string, string> = Object.create({ heritee: 'ventes', toString: 'ventes' }) as Record<string, string>
HERITEE.propre = 'cabinet'
const ACTIONS = ['a', 'b', 'c', 'd', 'e', 'f', 'z', '', 'heritee', 'propre', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']

/** LA RÉFÉRENCE de la table : seule une clé PROPRE, qui vaut exactement « cabinet » ou « ventes », demande un droit. */
function permisAttendu(table: Record<string, string>, action: string, droits: Droits): boolean {
  if (!Object.prototype.hasOwnProperty.call(table, action)) return false
  if (table[action] === 'cabinet') return droits.cabinet
  if (table[action] === 'ventes') return droits.ventes
  return false
}

const permis = (fn: (t: Record<string, string>, a: string, d: Droits) => boolean) =>
  [TABLE, HERITEE].flatMap((t) => ACTIONS.flatMap((a) => JEUX.map((j) => fn(t, a, j))))

describe('le bloc droitsDeLAppelant dans les quatre fonctions de la vente', () => {
  // La compilation se paye UNE fois par fichier (`compilationSeparee.ts`), et le bloc qui emprunte un nom doit tomber.
  let compiles: Record<'bloc' | 'emprunte', string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares({
      bloc: enModule(BLOCS['send-email']),
      emprunte: enModule(BLOCS['send-email'].replace('const cases = lu as Record<string, unknown>', 'const cases = lireCases(lu)')),
    }, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('les quatre copies sont le même texte, bornes comprises', () => {
    for (const f of FONCTIONS) expect(BLOCS[f], f).toBe(BLOCS['plateforme-agreee'])
    expect(BLOCS['send-email']).not.toMatch(/^import /m)
  })

  it('se compile seul et strict, sans rien emprunter — et le garde voit un emprunt', () => {
    expect(compiles.bloc).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/lireCases/)
  })

  it.each(FONCTIONS)('%s : exécutée seule, la copie lit les droits comme la grille le promet — un seul appel, avec le dossier reçu', async (f) => {
    const copie = executer(BLOCS[f])
    for (const c of CAS) {
      const { lu, appels } = await lectureDe(copie, c)
      expect(lu, c.nom).toEqual(await lectureAttendue(c))
      expect(appels, c.nom).toEqual([['droits_sur_le_dossier', { p_dossier_id: 'd1000000-0000-4000-8000-000000000001' }]])
    }
  })

  it.each(FONCTIONS)('%s : une action n’est permise que par une clé propre de la table, au droit qu’elle nomme', (f) => {
    expect(permis(executer(BLOCS[f]).actionPermise)).toEqual(permis(permisAttendu))
  })

  it('la grille n’est pas aveugle : des accords, des refus et des illisibles, et chaque case décide quelque part', async () => {
    const lus = await Promise.all(CAS.map(lectureAttendue))
    expect(lus.filter((l) => l !== 'illisible').length).toBe(32)
    expect(lus.filter((l) => l === 'illisible').length).toBeGreaterThan(200)
    const p = permis(permisAttendu)
    expect(p.filter(Boolean).length).toBeGreaterThan(0)
    expect(p.filter((x) => !x).length).toBeGreaterThan(p.filter(Boolean).length)
  })

  it('le garde mord : une erreur prise pour un accord, une case tolérée, une clé héritée ou un droit confondu se voient', async () => {
    const bloc = BLOCS['superpdp-credentials']
    const derives = [
      bloc.replace('if (reponse.error != null) {', 'if (reponse.error != null && reponse.data === undefined) {'),
      bloc.replace('typeof cases[c] === "boolean"', 'cases[c] !== undefined'),
      bloc.replace('Object.prototype.hasOwnProperty.call(table, action) ? table[action] : null', 'table[action] ?? null'),
      bloc.replace('exige === "ventes" ? droits.ventes', 'exige === "ventes" ? droits.membre'),
      bloc.replace('return { droits: { cabinet, membre, ventes, banque } }', 'return { droits: { cabinet, membre, ventes: ventes || banque, banque } }'),
    ]
    const attendus = await Promise.all(CAS.map(lectureAttendue))
    for (const [rang, derive] of derives.entries()) {
      expect(derive, `dérive ${rang} : ancre introuvable`).not.toBe(bloc)
      const copie = executer(derive)
      const lus = await Promise.all(CAS.map(async (c) => (await lectureDe(copie, c)).lu))
      const memeLecture = JSON.stringify(lus) === JSON.stringify(attendus)
      const memePermis = JSON.stringify(permis(copie.actionPermise)) === JSON.stringify(permis(permisAttendu))
      expect(memeLecture && memePermis, `dérive ${rang} passée inaperçue`).toBe(false)
    }
  })
})

// ── Chaque fonction s'en sert, avant tout le reste, avec la table que la conception arrête ────────────────────────────

/** Le gestionnaire, sans le bloc : ce que la fonction fait elle-même. */
const gestionnaire = (f: Fonction) => {
  const source = SOURCES[f].replace(BLOCS[f], '')
  return source.slice(source.indexOf('Deno.serve('))
}

/** La table `QUI_PEUT_QUOI` de la source, évaluée telle qu'elle est écrite. */
function tableDe(f: Fonction): Record<string, string> {
  const ouverture = 'const QUI_PEUT_QUOI: Readonly<Record<string, DroitExige>> = {'
  const source = SOURCES[f]
  const debut = source.indexOf(ouverture)
  expect(debut, `${f} : table QUI_PEUT_QUOI introuvable`).toBeGreaterThan(-1)
  expect(source.indexOf(ouverture, debut + 1), `${f} : deux tables`).toBe(-1)
  const fin = source.indexOf('\n}\n', debut)
  const litteral = source.slice(debut + ouverture.length - 1, fin + 2)
  const js = ts.transpileModule(`export default ${litteral}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const exports: { default?: Record<string, string> } = {}
  new Function('exports', js)(exports)
  return exports.default as Record<string, string>
}

// La table du §3.5 de la conception, et l'hypothèse EC-Q4 que deux fonctions doivent nommer à côté de la leur : celles
// où le client relie sa plateforme (`QUI_PEUT_QUOI_ATTENDU`, src/test/quiPeutQuoi.ts).
const AVEC_EC_Q4: readonly Fonction[] = ['plateforme-agreee', 'superpdp-credentials']

describe('chaque fonction de la vente lit les droits par le bloc, avant tout, et juge par SA table', () => {
  it.each(FONCTIONS)('%s : la table « qui peut quoi » est celle de la conception, hypothèse EC-Q4 nommée', (f) => {
    expect(tableDe(f)).toEqual(QUI_PEUT_QUOI_ATTENDU[f])
    // L'hypothèse se lit à côté de la table, là où un changement de décision se ferait.
    const table = SOURCES[f].indexOf('const QUI_PEUT_QUOI')
    expect(/HYPOTHÈSE EC-Q4/.test(SOURCES[f].slice(Math.max(0, table - 600), table))).toBe(AVEC_EC_Q4.includes(f))
  })

  it.each(FONCTIONS)('%s : les droits se lisent une fois, avec le jeton de l’appelant, et décident par la table', (f) => {
    const code = gestionnaire(f)
    expect(code.split('await droitsDeLAppelant(supabaseAsCaller, dossierId)').length - 1).toBe(1)
    expect(code.split('actionPermise(QUI_PEUT_QUOI, ').length - 1).toBe(1)
    // Plus rien de l'ancien contrôle, et aucune autre fonction SQL appelée.
    expect(code).not.toMatch(/admin_du_dossier/)
    expect(code).not.toMatch(/\.rpc\(/)
    // Sans le droit : les mots d'avant l'espace client ; illisible : 503, qui le dit.
    expect(code).toContain('return json({ error: "Dossier introuvable." }, 404)')
    expect(code).toContain('return json({ error: `L\'accès à ce dossier n\'a pas pu être vérifié (${lus.illisible}).` }, 503)')
  })

  it.each(FONCTIONS)('%s : rien n’est lu en base, ni demandé au dehors, avant les droits', (f) => {
    const code = gestionnaire(f)
    const droits = code.indexOf('await droitsDeLAppelant(')
    const premiers = ['.from(', 'fetch(', 'resend.emails', 'obtenirToken(', 'clientPlateforme(', 'ouvrirPlateforme(']
      .map((appel) => code.indexOf(appel)).filter((i) => i > -1)
    expect(premiers.length, `${f} : aucun appel repéré, le garde serait aveugle`).toBeGreaterThan(0)
    for (const i of premiers) expect(i, `${f} : un appel précède les droits`).toBeGreaterThan(droits)
    // La session, seule, est vérifiée avant : c'est elle qui porte le jeton.
    expect(code.indexOf('await supabaseAsCaller.auth.getUser()')).toBeLessThan(droits)
  })
})
