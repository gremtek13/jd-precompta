import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// LES CLÉS D'API DE SUPABASE : les nouvelles partout, les historiques nulle part.
//
// Pourquoi ce test existe. Les clés historiques du projet — `anon` pour le navigateur, `service_role`
// pour les Edge Functions — étaient des jetons signés, et Supabase les coupe à la fin de 2026 (guide
// « Migrating to publishable and secret API keys »). Ce jour-là, tout ce qui les lit encore s'arrête,
// sans qu'aucun écran ne dise pourquoi : c'est la panne totale, datée d'avance. Le passage a eu lieu
// le 30/09/2026 (ligne 25.5 de la feuille de route), et ce test empêche d'en revenir.
//
// Quatre questions, et aucune ne suffit seule :
//   1. Aucune fonction ne lit plus `SUPABASE_ANON_KEY` ni `SUPABASE_SERVICE_ROLE_KEY`. La plateforme
//      les pose toujours, donc une lecture ajoutée demain MARCHERAIT — jusqu'à la coupure.
//   2. Les nouvelles clés arrivent dans deux objets JSON « nom → clé » : chaque fonction les lit par le
//      MÊME bloc, copié à l'identique (elles sont auto-portées), et chaque lecture passe par lui.
//   3. Ce bloc dit vrai : on l'EXÉCUTE, extrait de la vraie source et transpilé par le compilateur du
//      projet — l'idiome d'`extractPiecePagination`.
//   4. Aucune clé historique ni aucune clé secrète n'est écrite dans un fichier du dépôt. Le dépôt est
//      PUBLIC : une clé secrète qui y entrerait ouvrirait la base entière, RLS contournée.
//
// Ce qu'il ne peut PAS garder, annoncé comme partout où ce dépôt touche à la production : que le
// projet porte bien ces variables, et que la plateforme accepte ces clés. C'est la question « cles »
// d'`evaluer-extraction` qui le mesure, sans rien facturer.

const racine = (chemin: string) => new URL(`../../${chemin}`, import.meta.url)

const DEBUT = '// ── DÉBUT CLÉS SUPABASE'
const FIN = '// ── FIN CLÉS SUPABASE'

/** Retire les lignes ENTIÈREMENT en commentaire, jamais un commentaire de fin de ligne. */
function sansLignesDeCommentaire(source: string): string {
  return source
    .split('\n')
    .filter((ligne) => !/^\s*(\/\/|\/\*|\*)/.test(ligne))
    .join('\n')
}

/** Une Edge Function est un dossier : toutes ses sources comptent, pas seulement `index.ts`. */
function sourcesDesFonctions(): Map<string, string> {
  const dossiers = readdirSync(racine('supabase/functions/'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  const sources = new Map<string, string>()
  for (const fonction of dossiers) {
    const fichiers = (readdirSync(racine(`supabase/functions/${fonction}/`), { recursive: true }) as string[])
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
      .sort()
    sources.set(fonction, fichiers.map((f) => readFileSync(racine(`supabase/functions/${fonction}/${f}`), 'utf8')).join('\n'))
  }
  return sources
}

/** Les copies du bloc dans une source, bornes comprises — une par occurrence. */
function blocsDe(source: string): string[] {
  const blocs: string[] = []
  let depart = source.indexOf(DEBUT)
  while (depart !== -1) {
    const fin = source.indexOf(FIN, depart)
    if (fin === -1) throw new Error('bloc des clés ouvert sans être refermé')
    blocs.push(source.slice(depart, source.indexOf('\n', fin) + 1))
    depart = source.indexOf(DEBUT, fin)
  }
  return blocs
}

interface Lectures {
  /** Lectures de `SUPABASE_PUBLISHABLE_KEYS` ou `SUPABASE_SECRET_KEYS`, sous quelque forme que ce soit. */
  brutes: number
  /** Celles qui passent par `cleSupabase("NOM", Deno.env.get("NOM"))`, avec deux fois le même nom. */
  parLeBloc: number
  /** Les variables historiques, encore nommées dans le code. */
  historiques: string[]
}

/** Ce qu'une source lit des clés de Supabase, commentaires retirés. */
function lecturesDesCles(source: string): Lectures {
  const code = sansLignesDeCommentaire(source)
  const brutes = code.match(/\bDeno\.env\.get\(\s*["'`]SUPABASE_(?:PUBLISHABLE|SECRET)_KEYS["'`]\s*\)/g)?.length ?? 0
  const parLeBloc = [...code.matchAll(
    /\bcleSupabase\(\s*"(SUPABASE_(?:PUBLISHABLE|SECRET)_KEYS)",\s*Deno\.env\.get\("(SUPABASE_(?:PUBLISHABLE|SECRET)_KEYS)"\)\s*\)/g,
  )].filter((m) => m[1] === m[2]).length
  const historiques = [...new Set(code.match(/\bSUPABASE_(?:ANON_KEY|SERVICE_ROLE_KEY)\b/g) ?? [])].sort()
  return { brutes, parLeBloc, historiques }
}

const fonctions = sourcesDesFonctions()

describe('les Edge Functions et les clés de Supabase', () => {
  it('voit bien les fonctions qui lisent les clés — sinon « rien à signaler » voudrait dire « aveugle »', () => {
    // Le plancher : quinze fonctions parlent à la base le 30/09/2026.
    const lectrices = [...fonctions].filter(([, source]) => lecturesDesCles(source).brutes > 0)
    expect(lectrices.length).toBeGreaterThanOrEqual(15)
  })

  it('ne lit plus aucune clé historique — la plateforme les pose encore, elles marcheraient jusqu’à la coupure', () => {
    const fautes = [...fonctions]
      .map(([fonction, source]) => ({ fonction, historiques: lecturesDesCles(source).historiques }))
      .filter((f) => f.historiques.length > 0)
    expect(fautes).toEqual([])
  })

  it('lit chaque clé par le bloc, et jamais autrement', () => {
    // Un `JSON.parse(Deno.env.get(...))` écrit à côté du bloc se passerait de ses refus : une variable
    // absente y deviendrait une clé vide, et chaque requête serait refusée pour une raison muette.
    const fautes = [...fonctions]
      .map(([fonction, source]) => ({ fonction, ...lecturesDesCles(source) }))
      .filter((f) => f.brutes !== f.parLeBloc)
      .map((f) => `${f.fonction} : ${f.brutes} lecture(s), ${f.parLeBloc} par le bloc`)
    expect(fautes).toEqual([])
  })

  it('porte le bloc une fois, et le même partout', () => {
    const copies = [...fonctions]
      .filter(([, source]) => lecturesDesCles(source).brutes > 0)
      .map(([fonction, source]) => ({ fonction, blocs: blocsDe(source) }))
    expect(copies.filter((c) => c.blocs.length !== 1).map((c) => `${c.fonction} : ${c.blocs.length} bloc(s)`)).toEqual([])
    const reference = copies[0].blocs[0]
    expect(copies.filter((c) => c.blocs[0] !== reference).map((c) => c.fonction)).toEqual([])
  })

  it('ne porte le bloc que là où il sert', () => {
    // Un bloc sans lecture serait du code mort, et laisserait croire qu'une fonction parle à la base.
    const inutiles = [...fonctions]
      .filter(([, source]) => blocsDe(source).length > 0 && lecturesDesCles(source).brutes === 0)
      .map(([fonction]) => fonction)
    expect(inutiles).toEqual([])
  })
})

type CleSupabase = (variable: string, brut: string | undefined) => string

/** Le bloc SEUL, transpilé et exécuté : tout nom qu'il emprunterait au reste du fichier lèverait. */
function executer(bloc: string): CleSupabase {
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn cleSupabase`)()
}

const blocDeReference = blocsDe(fonctions.get('extract-piece') ?? '')[0] ?? ''
const cleSupabase = executer(blocDeReference)

const PUBLIQUE = 'sb_publishable_essai'
const SECRETE = 'sb_secret_essai'

describe('le bloc de lecture, exécuté', () => {
  it('rend la clé « default »', () => {
    expect(cleSupabase('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: PUBLIQUE }))).toBe(PUBLIQUE)
    // Plusieurs clés nommées vivent dans le même objet ; les fonctions se servent de « default ».
    expect(cleSupabase('SUPABASE_SECRET_KEYS', JSON.stringify({ facturation: 'sb_secret_autre', default: SECRETE }))).toBe(SECRETE)
  })

  it('lève sur une variable absente ou vide, en la nommant', () => {
    expect(() => cleSupabase('SUPABASE_SECRET_KEYS', undefined)).toThrow(/SUPABASE_SECRET_KEYS est absente/)
    expect(() => cleSupabase('SUPABASE_PUBLISHABLE_KEYS', '')).toThrow(/SUPABASE_PUBLISHABLE_KEYS est absente/)
  })

  it('lève sur un contenu qui n’est pas un objet JSON portant « default »', () => {
    for (const brut of ['{', SECRETE, 'null', '[]', '42', '{}', JSON.stringify({ autre: SECRETE }), JSON.stringify({ default: 42 })]) {
      expect(() => cleSupabase('SUPABASE_SECRET_KEYS', brut), `accepté : ${brut}`).toThrow(/SUPABASE_SECRET_KEYS/)
    }
  })

  it('refuse une clé qui n’a pas la forme attendue — une historique, ou l’une prise pour l’autre', () => {
    // Une clé secrète là où l'on attend la publishable ouvrirait tout à qui la reçoit ; une publishable
    // là où l'on attend la secrète ferait lire la base « en visiteur », donc à travers la RLS : des
    // listes vides, sans une erreur.
    const historique = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature'
    expect(() => cleSupabase('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: SECRETE }))).toThrow(/sb_publishable_/)
    expect(() => cleSupabase('SUPABASE_SECRET_KEYS', JSON.stringify({ default: PUBLIQUE }))).toThrow(/sb_secret_/)
    expect(() => cleSupabase('SUPABASE_SECRET_KEYS', JSON.stringify({ default: historique }))).toThrow(/sb_secret_/)
    // Le préfixe seul n'est pas une clé.
    expect(() => cleSupabase('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_secret_' }))).toThrow(/sb_secret_/)
  })

  it('ne cite jamais la clé dans son message', () => {
    // Le message part dans les journaux de la fonction, et parfois jusqu'à l'écran.
    const refus = [
      () => cleSupabase('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: 'sb_secret_ne-pas-citer' })),
      () => cleSupabase('SUPABASE_SECRET_KEYS', JSON.stringify({ default: 'sb_publishable_ne-pas-citer' })),
      () => cleSupabase('SUPABASE_SECRET_KEYS', '{"default": "sb_secret_ne-pas-citer"'),
    ]
    for (const lever of refus) {
      expect(lever).toThrow()
      try {
        lever()
      } catch (err) {
        expect((err as Error).message).not.toContain('ne-pas-citer')
      }
    }
  })
})

/** Les fichiers suivis par Git, sauf ceux qui ne sont pas du texte. */
function fichiersSuivis(): string[] {
  const liste = execFileSync('git', ['ls-files', '-z'], { cwd: racine('').pathname, encoding: 'utf8' })
  return liste
    .split('\0')
    .filter((f) => f !== '' && !/\.(png|jpe?g|gif|pdf|ico|woff2?|ttf|zip|xlsx)$/i.test(f))
}

/** Les jetons de la forme d'une clé historique de Supabase : trois segments, un en-tête et un corps JSON. */
function clesHistoriques(texte: string): string[] {
  const trouvees: string[] = []
  for (const m of texte.matchAll(/eyJ[A-Za-z0-9_-]{5,}\.(eyJ[A-Za-z0-9_-]{5,})\.[A-Za-z0-9_-]+/g)) {
    try {
      const corps = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) as { iss?: unknown; role?: unknown }
      if (corps.iss === 'supabase' && (corps.role === 'anon' || corps.role === 'service_role')) trouvees.push(`rôle ${corps.role}`)
    } catch {
      // Pas un jeton lisible : rien à dire.
    }
  }
  return trouvees
}

/** Les clés secrètes de la forme qu'émet Supabase — pas les valeurs d'essai, courtes, des tests. */
const CLE_SECRETE_REELLE = /sb_secret_[A-Za-z0-9_-]{20,}/

describe('aucune clé dans le dépôt, qui est public', () => {
  const fichiers = fichiersSuivis()

  it('voit bien les fichiers du dépôt', () => {
    expect(fichiers.length).toBeGreaterThan(400)
    expect(fichiers).toContain('.env.production')
  })

  it('ne porte aucune clé historique — elles cessent de fonctionner, et la secrète ouvrait tout', () => {
    const fautes = fichiers
      .filter((f) => statSync(racine(f)).size < 5_000_000)
      .flatMap((f) => clesHistoriques(readFileSync(racine(f), 'utf8')).map((c) => `${f} : ${c}`))
    expect(fautes).toEqual([])
  })

  it('ne porte aucune clé secrète', () => {
    const fautes = fichiers
      .filter((f) => statSync(racine(f)).size < 5_000_000)
      .filter((f) => CLE_SECRETE_REELLE.test(readFileSync(racine(f), 'utf8')))
    expect(fautes).toEqual([])
  })

  it('reconnaît une clé historique et une clé secrète — sinon les deux contrôles ne prouveraient rien', () => {
    const corps = Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'essai', role: 'service_role' })).toString('base64url')
    const entete = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    expect(clesHistoriques(`CLE=${entete}.${corps}.signature-de-l-essai`)).toEqual(['rôle service_role'])
    // Un autre jeton — celui d'une banque, d'un prestataire — n'est pas une clé de Supabase.
    const autre = Buffer.from(JSON.stringify({ iss: 'enablebanking.com', aud: 'api' })).toString('base64url')
    expect(clesHistoriques(`${entete}.${autre}.signature`)).toEqual([])
    expect(CLE_SECRETE_REELLE.test(`sb_secret_${'A1b2C3d4E5f6G7h8I9j0'}`)).toBe(true)
    expect(CLE_SECRETE_REELLE.test(SECRETE)).toBe(false)
  })
})

// ── evaluer-extraction : la porte, et la sonde des clés ─────────────────────────────────────────
// Le harnais de mesure est passé à `verify_jwt = false` avec le reste (la passerelle ne sait vérifier
// que les clés historiques). Il demande donc lui-même la clé publishable — la porte d'avant, ni plus
// large ni plus étroite —, et sa question « cles » dit si la plateforme accepte les nouvelles clés :
// c'est la seule mesure de production de ce chantier qui ne demande pas de session.

const SOURCE_MESURE = fonctions.get('evaluer-extraction') ?? ''

type Reponse = { error: { status?: number; message: string } | null; data?: unknown }
interface Scenario {
  publique?: Reponse
  base?: Reponse
  comptes?: Reponse
  /** Ce que rend `extract-piece` à l'appel de serveur à serveur : un statut et un corps brut. */
  lecture?: { status: number; corps: string }
  env?: Record<string, string | undefined>
}

/** `sonderCles` extraite de la vraie source, exécutée avec un faux client qui consigne ses appels. */
function sonder(scenario: Scenario): { resultat: Promise<unknown>; appels: string[] } {
  const debut = SOURCE_MESURE.indexOf('async function sonderCles(')
  const fin = SOURCE_MESURE.indexOf(DEBUT, debut)
  expect(debut, 'sonderCles introuvable — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const js = ts.transpileModule(`${SOURCE_MESURE.slice(debut, fin)}\n${blocDeReference}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const appels: string[] = []
  const env: Record<string, string | undefined> = scenario.env ?? {
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLIQUE }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRETE }),
  }
  const createClient = (url: string, cle: string) => ({
    from: (table: string) => ({
      select: async (colonnes: string, options: unknown) => {
        appels.push(`${cle} lit ${table} ${colonnes} ${JSON.stringify(options)}`)
        return table === 'categories' ? (scenario.publique ?? { error: null }) : (scenario.base ?? { error: null })
      },
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => {
          appels.push(`${cle} demande le compte ${id}`)
          return scenario.comptes ?? { data: { user: null }, error: { status: 404, message: 'User not found' } }
        },
      },
    },
    url,
  })
  // Le faux `fetch` consigne ce que la sonde ENVOIE — l'adresse, la méthode, les en-têtes par leur nom
  // et la clé qui porte `apikey`, la présence d'un corps — parce que c'est là que tient la garantie :
  // un corps enverrait un document à lire, donc à facturer.
  const fetch = async (adresse: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
    const entetes = init.headers ?? {}
    appels.push(
      `${entetes.apikey} appelle ${adresse} en ${init.method} ${init.body === undefined ? 'sans corps' : 'AVEC un corps'} ` +
        `(en-têtes : ${Object.keys(entetes).sort().join(', ')})`,
    )
    const { status, corps } = scenario.lecture ?? { status: 400, corps: JSON.stringify({ error: 'Fichier vide.' }) }
    return new Response(corps, { status })
  }
  const Deno = { env: { get: (nom: string) => env[nom] } }
  const sonderCles = new Function('createClient', 'Deno', 'fetch', `${js}\nreturn sonderCles`)(createClient, Deno, fetch)
  return { resultat: sonderCles('https://projet.supabase.co'), appels }
}

describe('evaluer-extraction — la question « cles »', () => {
  it('dit « acceptée » pour les quatre questions quand la plateforme répond comme attendu', async () => {
    const { resultat, appels } = sonder({})
    expect(await resultat).toEqual({
      publishable: 'acceptée',
      secrete_base: 'acceptée',
      secrete_comptes: 'acceptée',
      secrete_lecture: 'acceptée',
    })
    // Chaque clé pose SA question : la publishable sans session, la secrète à la base, à
    // l'administration des comptes sur un compte qui n'existe pas, puis à `extract-piece` par le
    // chemin de `receive-email` — l'en-tête `apikey` et lui seul, sans corps, donc sans rien à lire.
    expect(appels).toEqual([
      `${PUBLIQUE} lit categories id {"count":"exact","head":true}`,
      `${SECRETE} lit super_admins user_id {"count":"exact","head":true}`,
      `${SECRETE} demande le compte 00000000-0000-0000-0000-000000000000`,
      `${SECRETE} appelle https://projet.supabase.co/functions/v1/extract-piece en POST sans corps (en-têtes : apikey)`,
    ])
  })

  it('dit le refus de chaque clé, avec la raison que rend la plateforme', async () => {
    expect(await sonder({ publique: { error: { message: 'Invalid API key' } } }).resultat)
      .toMatchObject({ publishable: 'refusée : Invalid API key' })
    expect(await sonder({ base: { error: { message: 'Invalid API key' } } }).resultat)
      .toMatchObject({ secrete_base: 'refusée : Invalid API key' })
    expect(await sonder({ comptes: { error: { status: 401, message: 'Invalid API key' } } }).resultat)
      .toMatchObject({ secrete_comptes: 'inattendu : 401 Invalid API key' })
    const refus = { status: 401, corps: JSON.stringify({ error: "La lecture d'un document demande d'être connecté à l'application." }) }
    expect(await sonder({ lecture: refus }).resultat)
      .toMatchObject({ secrete_lecture: "inattendu : 401 La lecture d'un document demande d'être connecté à l'application." })
    expect(await sonder({ lecture: { status: 502, corps: 'Bad Gateway' } }).resultat)
      .toMatchObject({ secrete_lecture: 'inattendu : 502 réponse illisible' })
  })

  it('ne prend pas un compte rendu pour une clé admise — seul « introuvable » le prouve', async () => {
    // Le garde symétrique : sans lui, « acceptée » serait satisfait par une sonde qui le dit toujours.
    expect(await sonder({ comptes: { data: { user: { id: 'x' } }, error: null } }).resultat)
      .toMatchObject({ secrete_comptes: 'inattendu : un compte a été rendu' })
  })

  it('ne prend ni un autre 400 ni une lecture réussie pour une clé admise — seul « Fichier vide. » le prouve', async () => {
    // Même garde, pour la quatrième question : un 400 peut venir d'ailleurs que du contrôle du corps,
    // et une réponse 200 voudrait dire qu'un document a été lu, donc facturé.
    expect(await sonder({ lecture: { status: 400, corps: JSON.stringify({ error: 'Fichier trop volumineux' }) } }).resultat)
      .toMatchObject({ secrete_lecture: 'inattendu : 400 Fichier trop volumineux' })
    expect(await sonder({ lecture: { status: 200, corps: JSON.stringify({ tiers: null }) } }).resultat)
      .toMatchObject({ secrete_lecture: 'inattendu : 200 aucun motif' })
    expect(await sonder({ lecture: { status: 401, corps: JSON.stringify({ error: 'Fichier vide.' }) } }).resultat)
      .toMatchObject({ secrete_lecture: 'inattendu : 401 Fichier vide.' })
  })

  it('lève sur une variable absente, en la nommant — une clé vide ne se sonde pas', async () => {
    await expect(sonder({ env: { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLIQUE }) } }).resultat)
      .rejects.toThrow(/SUPABASE_SECRET_KEYS est absente/)
  })

  it('ne rend jamais une clé', async () => {
    const texte = JSON.stringify(await sonder({ publique: { error: { message: 'refus' } } }).resultat)
    expect(texte).not.toContain(PUBLIQUE)
    expect(texte).not.toContain(SECRETE)
  })
})

describe('extract-piece — ce qui rend la quatrième question gratuite', () => {
  // La sonde appelle `extract-piece` pour de vrai, avec la clé secrète : la seule chose qui l'empêche
  // de faire lire un document est que son corps est vide ET que la fonction le refuse avant tout
  // client AWS. Qu'un jour ce refus passe après Textract, et chaque sonde serait une lecture facturée.
  const lecture = fonctions.get('extract-piece') ?? ''
  const gestionnaire = lecture.slice(lecture.indexOf('Deno.serve('))

  it('refuse un corps vide par « Fichier vide. », avant de construire le moindre client AWS', () => {
    const vide = gestionnaire.indexOf('if (fileBytes.byteLength === 0) {\n      return json({ error: "Fichier vide." }, 400)')
    expect(vide, 'refus du corps vide introuvable — la sonde « cles » ferait lire un document').toBeGreaterThan(-1)
    for (const depense of ['new TextractClient(', 'detecterTextePdfAsync(', 'citerChamps(']) {
      const position = gestionnaire.indexOf(depense)
      expect(position, `${depense} introuvable dans le gestionnaire — garde-fou à remettre à jour`).toBeGreaterThan(-1)
      expect(vide, `${depense} précède le refus du corps vide`).toBeLessThan(position)
    }
  })

  it('la sonde n’envoie aucun corps, et reconnaît le refus exact d’`extract-piece`', () => {
    const appel = SOURCE_MESURE.slice(SOURCE_MESURE.indexOf('const reponseLecture = await fetch('))
    expect(appel).toMatch(/^const reponseLecture = await fetch\(`\$\{url\}\/functions\/v1\/extract-piece`, \{ method: "POST", headers: \{ apikey: secrete \} \}\)\n/)
    expect(SOURCE_MESURE).toContain('reponseLecture.status === 400 && motifLecture === "Fichier vide."')
  })
})

describe('evaluer-extraction — la porte', () => {
  const gestionnaire = SOURCE_MESURE.slice(SOURCE_MESURE.indexOf('Deno.serve('))
  const porte = gestionnaire.indexOf('if (req.headers.get("apikey") !== cleSupabase("SUPABASE_PUBLISHABLE_KEYS", Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")))')

  it('demande la clé publishable et refuse en 401', () => {
    expect(porte, 'contrôle de la clé publishable introuvable').toBeGreaterThan(-1)
    expect(gestionnaire.slice(porte)).toMatch(/^if \([^\n]+\) \{\n\s*return Response\.json\(\{ error: "[^"]+" \}, \{ status: 401 \}\)/)
  })

  it('avant de lire la demande, avant la sonde, avant la fenêtre et avant le modèle', () => {
    for (const suite of ['await req.json()', 'question === "cles"', 'if (limite > 0 && Date.now()', 'new AnthropicBedrock(']) {
      const position = gestionnaire.indexOf(suite)
      expect(position, `${suite} introuvable dans le gestionnaire — garde-fou à remettre à jour`).toBeGreaterThan(-1)
      expect(porte, `${suite} précède le contrôle de la clé`).toBeLessThan(position)
    }
  })

  it('répond à « cles » sans dossier et sans modèle', () => {
    const cles = gestionnaire.indexOf('if (question === "cles") {')
    expect(cles).toBeGreaterThan(-1)
    expect(gestionnaire.slice(cles)).toMatch(/^if \(question === "cles"\) \{\n\s*return Response\.json\(\{ question: "cles", \.\.\.\(await sonderCles\(Deno\.env\.get\("SUPABASE_URL"\)\)\) \}\)/)
    expect(cles).toBeLessThan(gestionnaire.indexOf('if (!dossierId)'))
  })
})
