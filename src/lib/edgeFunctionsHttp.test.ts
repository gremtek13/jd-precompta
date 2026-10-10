import { readdirSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONTRATS, DEFAUTS_CONNUS, jugerScenario, type ContratFonction, type Contexte } from '../test/contratsFonctions'
import { CLE_PUBLIABLE, URL_PROJET, muter, prechauffer, slugsDesFonctions, sourceDe } from '../test/fonctionsEdge'

// LES EDGE FUNCTIONS APPELÉES EN HTTP, DANS LA SUITE (ligne 23 de la feuille de route).
//
// Chaque fonction de `supabase/functions/` est chargée depuis sa vraie source par le harnais (`src/test/fonctionsEdge.ts`)
// et jouée contre ses contrats (`src/test/contratsFonctions.ts`) : le préflight du navigateur, les refus sans session ou
// d'un appelant qui n'a pas le droit — et AUCUNE dépense avant eux —, les corps mal formés, les plafonds, la fenêtre
// datée, la signature d'un webhook, ce qui ne doit jamais revenir (un secret, une valeur de pièce dans un journal).
// Sans réseau, sans secret, sans appel facturé : ce que la CI ne pouvait pas faire contre les fonctions DÉPLOYÉES, elle
// le fait ici contre leur source.
//
// Trois couches, comme partout dans ce dépôt :
//   - le garde part de TOUT : chaque dossier de `supabase/functions/` a son contrat, les fonctions que la page appelle
//     se LISENT dans `src/` (et non dans une liste), une exception porte sa raison et son nombre, un plancher dit
//     qu'on n'est pas devenu aveugle ;
//   - chaque scénario se joue, et rend la liste de ses fautes — vide sur la vraie source ;
//   - des défauts PLANTÉS dans la vraie source, en mémoire, prouvent que les juges voient ce qu'ils gardent. La campagne
//     de mutations complète (le rapport de la ligne 23) en joue bien davantage, sur des copies, jamais sur le fichier
//     servi pendant la suite.

/** Les fonctions que la page n'appelle pas, et pourquoi elles n'ont pas de préflight à tenir. */
const HORS_DU_NAVIGATEUR: Record<string, string> = {
  'receive-email': 'webhook de Resend, appelé de serveur à serveur, signé par Svix',
  'evaluer-extraction': 'harnais de mesure, appelé à la main (curl), derrière la seule clé publishable',
}

// ── CE QUE LE SDK DU NAVIGATEUR ENVOIE ───────────────────────────────────────────────────────────────────────────────
// Mesuré, pas recopié : le vrai `@supabase/supabase-js` de l'application appelle une fonction devant un `fetch` qui
// relève ses en-têtes. Un en-tête que le SDK ajouterait demain entre dans le préflight de chaque fonction, et une
// fonction qui ne l'admet pas tombe ici avant de tomber chez le cabinet. Le jeton d'accès est celui d'une page connectée.
// Les en-têtes que le navigateur n'a pas à demander (« CORS-safelisted » : Accept, Accept-Language, Content-Language)
// sont écartés ; Content-Type n'en est pas un ici, il vaut application/json.
const EN_TETES_SURS = new Set(['accept', 'accept-language', 'content-language'])

async function entetesDuSdk(): Promise<string[]> {
  const relevees: Headers[] = []
  const client = createClient(URL_PROJET, CLE_PUBLIABLE, {
    accessToken: async () => 'jeton-de-session-de-la-page',
    global: {
      fetch: async (_entree: RequestInfo | URL, init?: RequestInit) => {
        relevees.push(new Headers(init?.headers))
        return Response.json({ ok: true })
      },
    },
  })
  const { error } = await client.functions.invoke('fonction-du-harnais', { body: { essai: true } })
  expect(error).toBeNull()
  expect(relevees).toHaveLength(1)
  return [...relevees[0].keys()].map((n) => n.toLowerCase()).filter((n) => !EN_TETES_SURS.has(n)).sort()
}

const contexte: Contexte = { entetesDuNavigateur: [] }
beforeAll(async () => {
  contexte.entetesDuNavigateur = await entetesDuSdk()
})

// ── LES FONCTIONS QUE LA PAGE APPELLE, LUES DANS `src/` ──────────────────────────────────────────────────────────────

function sourcesDeLaPage(): { chemin: string; texte: string }[] {
  const racine = new URL('../', import.meta.url)
  const trouves: { chemin: string; texte: string }[] = []
  const parcourir = (dossier: URL, prefixe: string) => {
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name === 'test') continue
      const suivant = new URL(`${entree.name}${entree.isDirectory() ? '/' : ''}`, dossier)
      if (entree.isDirectory()) { parcourir(suivant, `${prefixe}${entree.name}/`); continue }
      if (!/\.tsx?$/.test(entree.name) || /\.test\.tsx?$/.test(entree.name)) continue
      trouves.push({ chemin: `${prefixe}${entree.name}`, texte: readFileSync(suivant, 'utf8') })
    }
  }
  parcourir(racine, 'src/')
  return trouves
}

/** Retire les lignes entièrement en commentaire : ce dépôt cite ses appels dans ses explications. */
const sansCommentaires = (texte: string) =>
  texte.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')

/**
 * Le nom de chaque fonction qu'un `functions.invoke` appelle — un type générique entre chevrons, des retours à la ligne,
 * rien ne l'arrête. Une forme qu'il ne sait pas lire (un nom dans une variable) est une FAUTE, pas un saut.
 */
function appelsDeFonctions(texte: string): { noms: string[]; illisibles: number } {
  const code = sansCommentaires(texte)
  const noms: string[] = []
  let illisibles = 0
  for (const m of code.matchAll(/functions\s*\.\s*invoke\b/g)) {
    let i = m.index + m[0].length
    const blanc = () => { while (/\s/.test(code[i] ?? '')) i++ }
    blanc()
    if (code[i] === '<') {
      let profondeur = 0
      for (; i < code.length; i++) {
        if (code[i] === '=' && code[i + 1] === '>') { i++; continue }
        if (code[i] === '<') profondeur++
        if (code[i] === '>' && --profondeur === 0) { i++; break }
      }
      blanc()
    }
    const appel = /^\(\s*(['"`])([a-z0-9-]+)\1/.exec(code.slice(i))
    if (appel) noms.push(appel[2])
    else illisibles++
  }
  for (const m of code.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) noms.push(m[1])
  return { noms, illisibles }
}

describe('le harnais part de TOUTES les fonctions', () => {
  const slugs = slugsDesFonctions()

  it('chaque dossier de supabase/functions a son contrat, et aucun contrat ne vise une fonction disparue', () => {
    expect(CONTRATS.map((c) => c.slug).sort()).toEqual(slugs)
    // Le plancher : seize fonctions, plus de trois cents scénarios. « Zéro faute » n'a de sens que s'il en reste à voir.
    expect(slugs.length).toBeGreaterThanOrEqual(16)
    expect(CONTRATS.reduce((n, c) => n + c.scenarios.length, 0)).toBeGreaterThanOrEqual(300)
  })

  it('les fonctions que la page appelle se lisent dans src/, et ce sont celles qui tiennent un préflight', () => {
    const sources = sourcesDeLaPage()
    const lus = sources.map((f) => ({ chemin: f.chemin, ...appelsDeFonctions(f.texte) }))
    expect(lus.filter((l) => l.illisibles > 0).map((l) => l.chemin), 'un appel dont le nom ne se lit pas').toEqual([])
    const appelees = new Set(lus.flatMap((l) => l.noms))
    // Le plancher du balayage : il voit la page appeler des fonctions, sinon « aucune » ne voudrait rien dire.
    expect(appelees.size).toBeGreaterThanOrEqual(14)
    for (const nom of appelees) expect(slugs, `la page appelle « ${nom} », qui n'existe pas`).toContain(nom)
    expect(CONTRATS.filter((c) => c.navigateur).map((c) => c.slug).sort()).toEqual([...appelees].sort())
    // Les autres sont nommées, avec leur raison : deux, au nombre près.
    expect(CONTRATS.filter((c) => !c.navigateur).map((c) => c.slug).sort()).toEqual(Object.keys(HORS_DU_NAVIGATEUR).sort())
    expect(Object.keys(HORS_DU_NAVIGATEUR)).toHaveLength(2)
  })

  it('le balayage voit un appel caché dans un générique multi-ligne, et refuse un nom qu’il ne sait pas lire — défauts plantés', () => {
    expect(appelsDeFonctions("await supabase.functions.invoke<{\n  a?: () => void\n}>('agent-comptable', { body })").noms).toEqual(['agent-comptable'])
    expect(appelsDeFonctions("supabase.functions.invoke<T>(\n  'plateforme-agreee',\n  { body })").noms).toEqual(['plateforme-agreee'])
    expect(appelsDeFonctions('supabase.functions.invoke(nomDeLaFonction, { body })').illisibles).toBe(1)
    expect(appelsDeFonctions("// supabase.functions.invoke('citee-en-commentaire')").noms).toEqual([])
  })

  it('le SDK du navigateur envoie au moins ses quatre en-têtes, et chacun passe par le préflight', () => {
    expect(contexte.entetesDuNavigateur).toEqual(expect.arrayContaining(['apikey', 'authorization', 'content-type', 'x-client-info']))
  })

  it.each(CONTRATS.map((c) => [c.slug, c] as const))('%s : un contrat qui couvre les quatre portes', (_slug, contrat: ContratFonction) => {
    const noms = contrat.scenarios.map((s) => s.nom)
    expect(new Set(noms).size, 'deux scénarios du même nom').toBe(noms.length)
    // Le préflight, pour une fonction de la page.
    if (contrat.navigateur) expect(noms).toContain('le préflight du navigateur passe, sans rien demander à personne')
    // Un refus sans les droits, sans aucune dépense.
    expect(contrat.scenarios.some((s) => s.attendu.aucuneDepense && [401, 403, 404, 405].includes(s.attendu.statut) && !s.defautConnu)).toBe(true)
    // Le chemin admis, qui dépense : le garde symétrique — sans lui, une fonction qui refuse tout passerait.
    expect(contrat.scenarios.some((s) => s.attendu.statut === 200)).toBe(true)
    // La batterie des corps mal formés, pour une fonction qui lit du JSON.
    const json = !['extract-piece', 'receive-email'].includes(contrat.slug)
    expect(noms.filter((n) => n.startsWith('corps mal formé')).length).toBe(json ? 7 : 0)
    expect(contrat.porte.length).toBeGreaterThan(20)
  })

  it('les défauts connus sont comptés, au nombre près — un de plus est une rechute, un de moins une raison morte', () => {
    const comptes: Record<string, number> = {}
    for (const c of CONTRATS) for (const s of c.scenarios) if (s.defautConnu) comptes[s.defautConnu] = (comptes[s.defautConnu] ?? 0) + 1
    expect(comptes).toEqual(Object.fromEntries(Object.entries(DEFAUTS_CONNUS).map(([cle, d]) => [cle, d.nombre])))
  })
})

describe.each(CONTRATS.map((c) => [c.slug, c] as const))('%s — contrats HTTP', (slug, contrat: ContratFonction) => {
  // Le compilateur se paie ici, une fois par fonction, pas dans le premier scénario.
  beforeAll(() => { for (const s of [slug, ...(contrat.voisines ?? [])]) prechauffer(sourceDe(s)) })
  it.each(contrat.scenarios.map((s) => [s.nom, s] as const))('%s', async (_nom, scenario) => {
    expect(await jugerScenario(contrat, scenario, contexte)).toEqual([])
  })
})

// ── DES DÉFAUTS PLANTÉS DANS LA VRAIE SOURCE, EN MÉMOIRE ─────────────────────────────────────────────────────────────
// Un juge qui rend « aucune faute » sur la vraie source n'a rien prouvé tant qu'on ne l'a pas vu en rendre une : chaque
// défaut ci-dessous est la forme exacte d'une régression que ce dépôt craint, posée dans la source servie (une copie en
// mémoire), et le scénario nommé doit la voir. Une ancre introuvable fait échouer le test : la mutation est à
// réécrire, pas à oublier.

interface DefautPlante {
  slug: string
  quoi: string
  remplacements: [string, string][]
  scenario: string
}

const DEFAUTS_PLANTES: DefautPlante[] = [
  {
    slug: 'extract-piece', quoi: 'le contrôle de l’appelant court-circuité',
    remplacements: [['    const autorise = await appelantAutorise(', '    const autorise = true || await appelantAutorise(']],
    scenario: 'un compte inscrit seul (l’inscription publique) : 401, corps non lu, rien de dépensé',
  },
  {
    slug: 'extract-piece', quoi: 'le corps lu avant le contrôle',
    remplacements: [
      ['    const fileBytes = new Uint8Array(await req.arrayBuffer())\n', ''],
      ['    const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))\n',
        '    const fileBytes = new Uint8Array(await req.arrayBuffer())\n    const cleSecrete = cleSupabase("SUPABASE_SECRET_KEYS", Deno.env.get("SUPABASE_SECRET_KEYS"))\n'],
    ],
    scenario: 'sans en-tête ni clé : 401, corps non lu, le service d’authentification pas même interrogé',
  },
  {
    slug: 'extract-piece', quoi: 'le JSON illisible du modèle à nouveau cité au journal',
    remplacements: [[
      '    let citations: unknown = null\n    try {\n      citations = json ? JSON.parse(json) : null\n    } catch {\n      citations = null\n    }\n',
      '    const citations: unknown = json ? JSON.parse(json) : null\n',
    ]],
    scenario: 'le modèle rend un JSON illisible : rien du document ne part au journal',
  },
  {
    slug: 'create-cabinet', quoi: 'le refus rendu en 200',
    remplacements: [['return json({ error: "Réservé aux super-admins." }, 403)', 'return json({ error: "Réservé aux super-admins." }, 200)']],
    scenario: 'chef : refusé (403), et rien ne part',
  },
  {
    slug: 'agent-comptable', quoi: 'le plafond de blocage oublié',
    remplacements: [['  if (plafond.bloque) {', '  if (false) {']],
    scenario: 'le plafond de blocage atteint : 402, et pas un appel au modèle',
  },
  {
    slug: 'evaluer-extraction', quoi: 'la fenêtre datée oubliée',
    remplacements: [['    if (limite > 0 && Date.now() > Date.parse(ESSAI_OUVERT_JUSQU_A)) {', '    if (false) {']],
    scenario: 'fenêtre fermée : 403 sur « extraction », sans client ni lecture',
  },
  {
    slug: 'receive-email', quoi: 'une signature fausse acceptée',
    remplacements: [['    return new Response("Signature invalide", { status: 401 })', '    event = JSON.parse(rawBody)']],
    scenario: 'signé d’un autre secret : 401, rien de lu',
  },
  {
    slug: 'create-client-access', quoi: 'le contrôle d’accès demandé avec la clé de service (personne n’y passe plus)',
    remplacements: [['await supabaseAsCaller.rpc("admin_du_dossier"', 'await supabaseAdmin.rpc("admin_du_dossier"']],
    scenario: 'chef : l’accès client est créé sur le dossier',
  },
  // Le défaut d'avant le 10/10/2026 : le mot de passe saisi posé sur le compte repris, avant l'écriture de l'accès
  // (décision du cabinet : un compte existant garde son mot de passe). Puis une réponse qui en dirait plus, d'un compte
  // que le cabinet ne connaît pas, que ce que la fonction en disait.
  {
    slug: 'create-client-access', quoi: 'le mot de passe du compte repris à nouveau posé',
    remplacements: [['    compte = "existant"\n', '    await supabaseAdmin.auth.admin.updateUserById(clientUserId, { password })\n    compte = "existant"\n']],
    scenario: 'un compte existant déjà lié au cabinet (un membre de son équipe) : repris tel qu’il est, et la réponse le dit',
  },
  {
    slug: 'create-team-member', quoi: 'le mot de passe posé, puis l’ajout refusé',
    remplacements: [['    compte = "existant"\n', '    await admin.auth.admin.updateUserById(userId, { password })\n    compte = "existant"\n']],
    scenario: 'un membre déjà dans l’équipe : 409, rien n’a changé, son mot de passe non plus',
  },
  {
    slug: 'create-client-access', quoi: 'le refus d’un compte d’ailleurs qui rend son identifiant',
    remplacements: [[
      'Demande à cette personne d\'utiliser une autre adresse e-mail.",\n      }, 409)',
      'Demande à cette personne d\'utiliser une autre adresse e-mail.",\n        compteId: clientUserId,\n      }, 409)',
    ]],
    scenario: 'le chef d’un autre cabinet, que ce cabinet ne connaît pas : 409, le même refus, et le compte n’est pas touché',
  },
  // Le défaut 23.5 (10/10/2026) : « déjà inscrit » lu au STATUT. Le service rend 422 aussi pour un mot de passe que la
  // règle du projet refuse : la fonction cherchait alors un compte qui n'existe pas, puis disait « Un compte existe
  // déjà… ». Remis dans chacune des trois fonctions, il doit faire tomber le refus du mot de passe ; remis au MESSAGE, la
  // reconnaissance au code sous un message neutre ; et le refus du mot de passe oublié retombe sur le chemin d'avant.
  ...(['create-client-access', 'create-team-member'] as const).map((slug): DefautPlante => ({
    slug, quoi: '« déjà inscrit » de nouveau lu au statut 422',
    remplacements: [['} else if (adresseDejaInscrite(createError)) {', '} else if (createError?.status === 422) {']],
    scenario: 'le service refuse le mot de passe (une sorte de caractères manque) : 400, dit en français, aucun compte cherché, rien d’écrit',
  })),
  {
    slug: 'create-cabinet', quoi: '« déjà inscrit » de nouveau lu au statut 422',
    remplacements: [['    if (adresseDejaInscrite(createError)) {', '    if (createError?.status === 422) {']],
    scenario: 'le service refuse le mot de passe (une sorte de caractères manque) : 400, dit en français, aucun compte cherché, rien d’écrit',
  },
  {
    slug: 'create-client-access', quoi: '« déjà inscrit » de nouveau lu dans le message',
    remplacements: [['} else if (adresseDejaInscrite(createError)) {', '} else if (/already|exist|registered|duplicate/i.test(createError?.message ?? "")) {']],
    scenario: 'l’adresse déjà inscrite se reconnaît à son code (email_exists), sous un message que la fonction ne lit pas',
  },
  {
    slug: 'create-team-member', quoi: 'le refus du mot de passe oublié',
    remplacements: [['    if (refusMotDePasse !== null) return json({ error: refusMotDePasse }, 400)\n', '']],
    scenario: 'le service refuse le mot de passe (divulgué) : 400, dit en français, aucun compte cherché, rien d’écrit',
  },
  {
    slug: 'taux-change-bce', quoi: 'le préflight oublié',
    remplacements: [['  if (req.method === "OPTIONS") {\n    return new Response("ok", { headers: corsHeaders })\n  }\n', '']],
    scenario: 'le préflight du navigateur passe, sans rien demander à personne',
  },
  {
    slug: 'plateforme-agreee', quoi: 'le secret de la connexion rendu à l’écran',
    remplacements: [['    client_id: c.client_id,\n    organisation_id: c.organisation_id,', '    client_id: c.client_secret,\n    organisation_id: c.organisation_id,']],
    scenario: 'chef : le statut de la connexion, jamais son secret',
  },
  // LES FONCTIONS DE LA VENTE ACCEPTENT LE CLIENT (espace client, étape P3) : une régression de chaque sorte — le
  // contrôle retiré, une lecture avant lui, une action du cabinet ouverte au client, une base en panne prise pour un
  // accord, l'auteur d'une transmission oublié, le plafond d'e-mails relâché d'un cran ou compté sur le jour UTC.
  {
    slug: 'superpdp-credentials', quoi: 'le contrôle des droits retiré',
    remplacements: [['  if (!actionPermise(QUI_PEUT_QUOI, action, lus.droits)) {', '  if (false) {']],
    scenario: 'status — client du dossier sans droit : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'plateforme-agreee', quoi: 'la connexion (son secret) lue avant les droits',
    remplacements: [[
      '  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)\n',
      '  await admin.from("connexions_plateformes").select(COLONNES).eq("dossier_id", dossierId).maybeSingle()\n  const lus = await droitsDeLAppelant(supabaseAsCaller, dossierId)\n',
    ]],
    scenario: 'statut — compte rattaché à rien : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'plateforme-agreee', quoi: 'la réception des achats ouverte au client « Ventes »',
    remplacements: [['  lister: "cabinet",', '  lister: "ventes",']],
    scenario: 'lister — client « Ventes » : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'superpdp-credentials', quoi: 'une base en panne prise pour un accord',
    remplacements: [[
      '      return { illisible: typeof message === "string" && message !== "" ? message : "erreur de la base" }',
      '      return { droits: { cabinet: true, membre: true, ventes: true, banque: true } }',
    ]],
    scenario: 'le contrôle des droits en panne : 503 qui le dit, rien de lu',
  },
  {
    slug: 'superpdp-emit', quoi: 'l’auteur de la transmission oublié',
    remplacements: [['        cree_par: callerData.user.id,\n', '']],
    scenario: 'client « Ventes » : sa facture part, et la transmission réservée porte son compte (cree_par)',
  },
  {
    slug: 'send-email', quoi: 'la relance de pièces ouverte au client',
    remplacements: [['  relance_pieces: "cabinet",', '  relance_pieces: "ventes",']],
    scenario: 'relance_pieces — client « Ventes » : refusé (404) avant toute lecture, tout secret et toute dépense',
  },
  {
    slug: 'send-email', quoi: 'le plafond relâché à trente et un',
    remplacements: [['const PLAFOND_CLIENT_PAR_JOUR = 30', 'const PLAFOND_CLIENT_PAR_JOUR = 31']],
    scenario: 'client « Ventes » : le 31e e-mail du jour est refusé (429) avant Resend, rien d’envoyé ni d’écrit',
  },
  {
    slug: 'send-email', quoi: 'le jour du plafond compté en UTC',
    remplacements: [[
      '    const jour = jourDeParis(Date.now())\n',
      '    const utc = new Date(Date.now()).toISOString().split("T")[0]\n    const jour = { debut: `${utc}T00:00:00.000Z`, fin: `${utc}T23:59:59.999Z` }\n',
    ]],
    scenario: 'le jour de Paris : trente e-mails partis avant minuit à Paris ne comptent plus après, même le même jour UTC',
  },
]

describe.each(DEFAUTS_PLANTES.map((d) => [`${d.slug} : ${d.quoi}`, d] as const))('défaut planté — %s', (_nom, defaut) => {
  const contrat = CONTRATS.find((c) => c.slug === defaut.slug)!
  let mutee = ''
  beforeAll(() => {
    // L'ancre se pose une fois, ou la mutation est à réécrire : `muter` lève.
    mutee = muter(sourceDe(defaut.slug), defaut.remplacements)
    for (const s of [defaut.slug, ...(contrat.voisines ?? [])]) prechauffer(sourceDe(s))
    prechauffer(mutee)
  })

  it('les juges le voient — et ne voient rien sur la vraie source', async () => {
    const scenario = contrat.scenarios.find((s) => s.nom === defaut.scenario)
    expect(scenario, `scénario « ${defaut.scenario} » introuvable`).toBeDefined()
    expect(await jugerScenario(contrat, scenario!, contexte)).toEqual([])
    const fautes = await jugerScenario(contrat, scenario!, contexte, mutee)
    expect(fautes.length, 'le défaut planté est passé inaperçu').toBeGreaterThan(0)
  })
})
