import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { diagnosticsSepares, executerModule } from '../test/compilationSeparee'
import { slugsDesFonctions, sourceDe } from '../test/fonctionsEdge'
import {
  FONCTIONS_EDGE, MODULES_OPTIONNELS, MODULE_DE_LA_FONCTION, MOTS_DU_REFUS, USAGES_DE_SEND_EMAIL, modulesLus,
  type FonctionEdge, type Module,
} from './modulesDuCabinet'

// LE BLOC « OPTION DU CABINET » DANS LES EDGE FUNCTIONS DES MODULES (conception 56, § 3.2, étage 2 ; OPT5, 20/11/2026).
// Une fonction rangée sous un module optionnel (`MODULE_DE_LA_FONCTION`) refuse en 403, avant toute dépense, quand le cabinet
// du dossier ne l'a pas ouvert ; une lecture illisible rend 503. Chaque fonction est auto-portée : elle porte une COPIE du
// même bloc, confrontée ici à src/lib/modulesDuCabinet.ts — la liste fermée, les mots du refus, la lecture côté fermé
// (`modulesLus`) —, jamais une copie à l'autre. Cinq questions :
//   1. Le bloc part-il de TOUTES les fonctions : présent dans celles d'un module, absent du socle et du hors-module ?
//   2. Les copies sont-elles le même texte, et le bloc se suffit-il, compilé seul et strict ?
//   3. Exécuté seul, rend-il ce que src/lib dit — les modules, les mots, la lecture, aucune lecture pour le socle ?
//   4. Chaque fonction l'appelle-t-elle sous SON module, après le contrôle de son appelant ?
//   5. `send-email` juge-t-il le module de chaque modèle comme `MODULE_DE_LA_FONCTION` le dit ?
// Le jeu en HTTP (ouvert, fermé, illisible) : edgeFunctionsOptionDuCabinet.test.ts.

const DEBUT = '// ── DÉBUT OPTION DU CABINET'
const FIN = '// ── FIN OPTION DU CABINET'

function blocDe(source: string): string {
  const d = source.indexOf(DEBUT)
  const f = source.indexOf(FIN)
  if (d < 0 || f < d) return ''
  if (source.indexOf(DEBUT, d + 1) >= 0) return 'DEUX FOIS'
  return source.slice(d, source.indexOf('\n', f) + 1)
}

/** Les modules qu'une fonction peut exiger, le socle écarté : vide pour une fonction du socle ou hors des modules. */
function modulesExiges(slug: FonctionEdge): Module[] {
  const e = MODULE_DE_LA_FONCTION[slug]
  const tous: Module[] = 'module' in e ? [e.module] : 'parUsage' in e ? Object.values(e.parUsage) : []
  return tous.filter((m) => m !== 'socle')
}

const FONCTIONS_DES_MODULES: readonly FonctionEdge[] = FONCTIONS_EDGE.filter((s) => modulesExiges(s).length > 0)

type ReponseRpc = { data: unknown; error: unknown }
interface Appelant { rpc: (nom: string, args: { p_dossier_id: string }) => PromiseLike<ReponseRpc> }
interface Copie {
  MODULES_DU_CABINET: readonly string[]
  REFUS_DU_MODULE_FERME: string
  REFUS_DES_OPTIONS_ILLISIBLES: string
  modulesOuvertsLus: (valeur: unknown) => string[] | null
  refusDuModule: (appelant: Appelant, dossierId: string, module: string) => Promise<{ statut: number; error: string } | null>
}
const enModule = (bloc: string) =>
  `${bloc}\nexport { MODULES_DU_CABINET, REFUS_DU_MODULE_FERME, REFUS_DES_OPTIONS_ILLISIBLES, modulesOuvertsLus, refusDuModule }\n`
const REFERENCE = blocDe(sourceDe('agent-comptable'))
const copie = () => executerModule<Copie>(enModule(REFERENCE))

describe('le bloc OPTION DU CABINET part de toutes les fonctions', () => {
  it('les fonctions du dépôt sont celles que modulesDuCabinet.ts range, et sept au moins exigent un module', () => {
    expect([...slugsDesFonctions()].sort()).toEqual([...FONCTIONS_EDGE].sort())
    expect(FONCTIONS_DES_MODULES.length).toBeGreaterThanOrEqual(8)
  })

  it('présent une fois dans chaque fonction d’un module, absent du socle et du hors-module — qui ne lisent pas les options', () => {
    for (const slug of FONCTIONS_EDGE) {
      const source = sourceDe(slug)
      if (FONCTIONS_DES_MODULES.includes(slug)) {
        expect(blocDe(source), slug).not.toBe('')
        expect(blocDe(source), slug).not.toBe('DEUX FOIS')
      } else {
        expect(source.includes(DEBUT), slug).toBe(false)
        expect(source.includes('modules_ouverts_du_dossier'), slug).toBe(false)
      }
    }
  })
})

describe('le bloc, le même partout et seul', () => {
  let compiles: Record<'bloc' | 'emprunte', string[]>
  beforeAll(() => {
    compiles = diagnosticsSepares({
      bloc: enModule(REFERENCE),
      emprunte: enModule(REFERENCE.replace('ouverts = error ? null : modulesOuvertsLus(data)', 'ouverts = error ? null : lire(data)')),
    }, {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, strict: true, noEmit: true, noUnusedLocals: true,
      noUnusedParameters: true, lib: ['lib.es2022.d.ts'], types: [],
    })
  }, 60_000)

  it('chaque copie est le texte de la référence, bornes comprises, sans import', () => {
    for (const slug of FONCTIONS_DES_MODULES) expect(blocDe(sourceDe(slug)), slug).toBe(REFERENCE)
    expect(REFERENCE).not.toMatch(/^import /m)
  })

  it('compilé seul et strict, il se suffit — et un nom emprunté au reste d’une fonction le ferait tomber', () => {
    expect(compiles.bloc).toEqual([])
    expect(compiles.emprunte.join('\n')).toMatch(/lire/)
  })
})

describe('le bloc, exécuté seul, rend ce que modulesDuCabinet.ts dit', () => {
  it('la liste fermée et les mots du refus', () => {
    const c = copie()
    expect([...c.MODULES_DU_CABINET]).toEqual([...MODULES_OPTIONNELS])
    expect(c.REFUS_DU_MODULE_FERME).toBe(MOTS_DU_REFUS.fonctionFermee)
    expect(c.REFUS_DES_OPTIONS_ILLISIBLES).toBe(MOTS_DU_REFUS.fonctionSansOptions)
  })

  it('la lecture tombe du côté fermé exactement comme `modulesLus` : nulle ensemble, les mêmes modules sinon', () => {
    const c = copie()
    const cas: unknown[] = [
      null, undefined, true, 1, 'tenue', '["tenue"]', {}, { modules: ['tenue'] }, [], ['tenue'], [...MODULES_OPTIONNELS],
      [...MODULES_OPTIONNELS].reverse(), ['tenue', 'tenue'], ['socle'], ['Tenue'], ['tenue', null], [1], [['tenue']],
      ['assistant', 'inconnu'], ['facture_electronique', 'connexion_bancaire'], ...MODULES_OPTIONNELS.map((m) => [m]),
    ]
    for (const valeur of cas) {
      const attendu = modulesLus(valeur)
      const lu = c.modulesOuvertsLus(valeur)
      expect(lu === null, JSON.stringify(valeur)).toBe(attendu === null)
      if (lu && attendu) expect([...lu].sort(), JSON.stringify(valeur)).toEqual([...attendu].sort())
    }
  })

  it('le socle ne lit rien ; un module ouvert passe, fermé 403, illisible 503 — la lecture au seul dossier reçu', async () => {
    const c = copie()
    const appels: unknown[][] = []
    const appelant = (r: () => PromiseLike<ReponseRpc>): Appelant => ({ rpc: (nom, args) => { appels.push([nom, args]); return r() } })
    const rend = (data: unknown, error: unknown = null) => appelant(() => Promise.resolve({ data, error }))

    expect(await c.refusDuModule(rend(['tenue']), 'd', 'socle')).toBeNull()
    expect(appels).toEqual([])
    for (const module of MODULES_OPTIONNELS) {
      expect(await c.refusDuModule(rend([...MODULES_OPTIONNELS]), 'd', module), module).toBeNull()
      expect(await c.refusDuModule(rend(MODULES_OPTIONNELS.filter((m) => m !== module)), 'd', module), module)
        .toEqual({ statut: 403, error: MOTS_DU_REFUS.fonctionFermee })
      expect(await c.refusDuModule(rend([]), 'd', module), module).toEqual({ statut: 403, error: MOTS_DU_REFUS.fonctionFermee })
    }
    expect(appels.every(([nom, args]) => nom === 'modules_ouverts_du_dossier' && JSON.stringify(args) === '{"p_dossier_id":"d"}'))
      .toBe(true)
    const illisible = { statut: 503, error: MOTS_DU_REFUS.fonctionSansOptions }
    for (const a of [
      rend([...MODULES_OPTIONNELS], { message: 'délai dépassé' }), rend(null), rend({ assistant: true }), rend(['assistant', 'inconnu']),
      rend(['assistant', 'assistant']), appelant(() => { throw new TypeError('fetch failed') }),
      appelant(() => Promise.reject(new Error('réseau'))),
    ]) {
      expect(await c.refusDuModule(a, 'd', 'assistant')).toEqual(illisible)
    }
  })
})

/** Les appels du bloc dans une fonction, hors du bloc : l'appelant passé, le dossier, et le module. */
function appelsDe(slug: FonctionEdge): { appelant: string; dossier: string; module: string; index: number }[] {
  const source = sourceDe(slug).replace(blocDe(sourceDe(slug)), '')
  return [...source.matchAll(/await refusDuModule\(([\w.]+), ([\w.]+), ([^)]+)\)/g)]
    .map((m) => ({ appelant: m[1], dossier: m[2], module: m[3], index: m.index }))
}

describe('chaque fonction appelle le bloc sous SON module, après le contrôle de son appelant', () => {
  it('au jeton de l’appelant, sous le module que `MODULE_DE_LA_FONCTION` lui donne', () => {
    for (const slug of FONCTIONS_DES_MODULES) {
      const appels = appelsDe(slug)
      // plateforme-agreee : la réception par l'accès « Achats » juge sa case dans son bloc, puis le module.
      expect(appels.length, slug).toBe(slug === 'plateforme-agreee' ? 2 : 1)
      for (const a of appels) {
        expect(['supabaseAsCaller', 'c.appelant'], slug).toContain(a.appelant)
        const e = MODULE_DE_LA_FONCTION[slug]
        if ('module' in e) expect(a.module, slug).toBe(JSON.stringify(e.module))
        else expect(a.module, slug).toBe('moduleDuModele')
      }
    }
    // L'accès « Achats » de plateforme-agreee passe son appelant, celui de la session, au bloc de la réception.
    expect(sourceDe('plateforme-agreee')).toMatch(/receptionParLeClient\(\{[^}]*appelant: supabaseAsCaller/)
  })

  it('après la lecture du compte, la double authentification et le contrôle du dossier', () => {
    for (const slug of FONCTIONS_DES_MODULES) {
      const source = sourceDe(slug).replace(blocDe(sourceDe(slug)), '')
      // L'appel de la porte principale : le dernier (celui de la réception par « Achats » vit dans son bloc, plus haut).
      const appels = appelsDe(slug)
      const principal = appels[appels.length - 1].index
      expect(principal, slug).toBeGreaterThan(source.indexOf('.auth.getUser('))
      expect(principal, slug).toBeGreaterThan(source.indexOf('await refusDesDeuxFacteurs('))
      const controle = Math.max(source.indexOf('.rpc("admin_du_dossier"'), source.indexOf('if (!actionPermise(QUI_PEUT_QUOI'))
      expect(controle, slug).toBeGreaterThan(0)
      expect(principal, slug).toBeGreaterThan(controle)
    }
    // La réception par « Achats » : la case jugée d'abord, au jeton de la session (`c.appelant`).
    const source = sourceDe('plateforme-agreee').replace(blocDe(sourceDe('plateforme-agreee')), '')
    const reception = appelsDe('plateforme-agreee')[0]
    expect(reception.appelant).toBe('c.appelant')
    expect(reception.index).toBeGreaterThan(source.indexOf('if (!achats.achats) return json({ error: "Dossier introuvable." }, 404)'))
    expect(reception.index).toBeGreaterThan(source.indexOf('async function receptionParLeClient('))
  })
})

describe('send-email juge le module de chaque modèle', () => {
  const source = sourceDe('send-email')
  const table = (() => {
    const m = source.match(/const MODULE_DU_MODELE: [^=]+= \{([^}]*)\}/)
    if (!m) return null
    return Object.fromEntries([...m[1].matchAll(/(\w+): "(\w+)"/g)].map((x) => [x[1], x[2]]))
  })()

  it('la table nomme chaque modèle de `QUI_PEUT_QUOI`, sous le module que `MODULE_DE_LA_FONCTION` lui donne', () => {
    const e = MODULE_DE_LA_FONCTION['send-email']
    if (!('parUsage' in e)) throw new Error('send-email juge l’usage')
    expect(table).toEqual(Object.fromEntries(USAGES_DE_SEND_EMAIL.map((u) => [u, e.parUsage[u]])))
    const qui = source.match(/const QUI_PEUT_QUOI: [^=]+= \{([^}]*)\}/)?.[1] ?? ''
    expect([...qui.matchAll(/^\s+(\w+): "/gm)].map((x) => x[1]).sort()).toEqual(Object.keys(table ?? {}).sort())
  })

  it('le module passé au bloc est celui du modèle, un modèle sans module refusé comme un type inconnu', () => {
    expect(source).toContain('const moduleDuModele = MODULE_DU_MODELE[type]')
    expect(source).toMatch(/if \(moduleDuModele === undefined\) return json\(\{ error: `dossierId, type \(\$\{TYPES_EN_MOTS\}\) et destinataire sont requis\.` \}, 400\)/)
  })
})

// La migration le dit aussi : `modules_ouverts_du_dossier` n'est qu'au cabinet du dossier et à ses accès client.
it('le bloc lit la fonction que la migration exportée pose, exécutable par authenticated', () => {
  const texte = readFileSync(new URL('../../supabase/schema/20261119140325_options_des_cabinets.sql', import.meta.url), 'utf8')
  expect(texte).toMatch(/create\s+function\s+public\.modules_ouverts_du_dossier\(p_dossier_id uuid\)/i)
  expect(texte).toMatch(/grant\s+execute\s+on\s+function\s+public\.modules_ouverts_du_dossier\(uuid\)\s+to\s+authenticated;/i)
})
