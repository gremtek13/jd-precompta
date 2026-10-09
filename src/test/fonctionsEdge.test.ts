import { beforeAll, describe, expect, it } from 'vitest'
import {
  CLE_PUBLIABLE, CLE_SECRETE, ID, PERSONNES, SECRET_WEBHOOK, chargerFonction, decrire, depensesDe, fuitesDans, muter,
  mondeDeReference, nouveauMonde, preflightDe, prechauffer, requeteDe, signerWebhook, slugsDesFonctions, sourceDe, verifierWebhookSvix,
  verifyJwtDe, type Monde,
} from './fonctionsEdge'

// LE HARNAIS SE TESTE AUSSI : un faux qui accepte tout rendrait chaque contrat vert. Chaque faux est éprouvé ici par ce
// qu'il doit REFUSER — un hôte non déclaré, un filtre qu'il ne sait pas appliquer, une table inconnue, une clé étrangère
// rompue, une signature fausse, une clé qui n'est pas la bonne — et par ce qu'il doit rendre comme le vrai service.
//
// Les faux se jouent au travers d'une petite fonction de SOURCE, chargée comme les vraies : c'est le seul chemin par lequel
// une fonction les voit, et le harnais n'en offre pas d'autre.

/** Une fonction d'essai : elle exécute le corps qu'on lui donne, avec `client` (clé secrète) et `appelant` (publishable + porteur). */
function sonde(corps: string, monde: Monde = mondeDeReference()) {
  const source = `import { createClient } from "npm:@supabase/supabase-js@2"
Deno.serve(async (req) => {
  const client = createClient(Deno.env.get("SUPABASE_URL"), "${CLE_SECRETE}")
  const appelant = createClient(Deno.env.get("SUPABASE_URL"), "${CLE_PUBLIABLE}", { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } })
  const resultat = await (async () => { ${corps} })()
  return Response.json(resultat ?? null)
})`
  const fonction = chargerFonction('create-cabinet', monde, { source })
  return {
    monde,
    rendre: async (personne?: keyof typeof PERSONNES) => {
      const r = await fonction.appeler(requeteDe('create-cabinet', { personne: personne ?? null, corps: {} }))
      if (r.exception) throw r.exception
      return r.json as Record<string, unknown>
    },
  }
}

describe.each(slugsDesFonctions())('%s se charge', (slug) => {
  beforeAll(() => prechauffer(sourceDe(slug)))

  it('avec UN gestionnaire, sa vraie source et son verify_jwt, sans rien demander au monde', () => {
    const monde = mondeDeReference()
    const f = chargerFonction(slug, monde)
    expect(f.source).toBe(sourceDe(slug))
    expect(f.verifyJwt).toBe(verifyJwtDe(slug))
    expect(monde.journal).toEqual([])
  })
})

describe('le chargement d’une fonction', () => {
  it('le harnais voit les seize fonctions du dépôt — le plancher', () => {
    expect(slugsDesFonctions().length).toBeGreaterThanOrEqual(16)
  })

  it('refuse un import qu’il ne déclare pas, et un second Deno.serve', () => {
    expect(() => chargerFonction('create-cabinet', nouveauMonde(), { source: 'import x from "npm:inconnu@1"\nDeno.serve(() => x)' }))
      .toThrow(/Import non déclaré/)
    expect(() => chargerFonction('create-cabinet', nouveauMonde(), { source: 'Deno.serve(() => 1)\nDeno.serve(() => 2)' }))
      .toThrow(/deux fois/)
    expect(() => chargerFonction('create-cabinet', nouveauMonde(), { source: 'const a = 1' })).toThrow(/aucun Deno.serve/)
  })

  it('résout un import PAR DÉFAUT comme le compilateur l’enveloppe (`__importDefault`)', async () => {
    const monde = nouveauMonde()
    monde.modele = () => ({ content: [{ type: 'text', text: 'ok' }] })
    const source = `import AnthropicBedrock from "npm:@anthropic-ai/bedrock-sdk@0.33.4"
Deno.serve(async () => Response.json(await new AnthropicBedrock({ awsRegion: "eu-west-1" }).messages.create({ model: "m" })))`
    const r = await chargerFonction('create-cabinet', monde, { source }).appeler(requeteDe('create-cabinet'))
    expect(r.json).toEqual({ content: [{ type: 'text', text: 'ok' }] })
    expect(monde.journal.map(decrire)).toEqual(['client bedrock', 'modèle'])
  })

  it('l’horloge de la fonction se décale sans toucher à celle de la suite', async () => {
    const monde = nouveauMonde()
    monde.decalageHorloge = -365 * 86_400_000
    const source = 'Deno.serve(() => Response.json({ maintenant: Date.now(), objet: new Date().getTime(), fixe: new Date(0).getTime() }))'
    const r = (await chargerFonction('create-cabinet', monde, { source }).appeler(requeteDe('create-cabinet'))).json as Record<string, number>
    expect(Date.now() - r.maintenant).toBeGreaterThan(364 * 86_400_000)
    expect(Date.now() - r.objet).toBeGreaterThan(364 * 86_400_000)
    expect(r.fixe).toBe(0)
  })

  it('une exception laissée à Deno.serve rend ce que rend la plateforme : 500, en texte brut, et elle se compte', async () => {
    const monde = nouveauMonde()
    const r = await chargerFonction('create-cabinet', monde, { source: 'Deno.serve(() => { throw new TypeError("boum") })' })
      .appeler(requeteDe('create-cabinet'))
    expect([r.statut, r.texte, r.entetes.get('access-control-allow-origin')]).toEqual([500, 'Internal Server Error', null])
    expect(monde.exceptions).toHaveLength(1)
  })

  it('mute une source en mémoire, et refuse une ancre absente ou ambiguë', () => {
    expect(muter('a b a', [['b', 'c']])).toBe('a c a')
    expect(() => muter('a b a', [['a', 'c']])).toThrow(/2 fois/)
    expect(() => muter('a b a', [['z', 'c']])).toThrow(/0 fois/)
  })
})

describe('le réseau est fermé', () => {
  it('un hôte non déclaré lève, et la tentative se compte comme une dépense', async () => {
    const { rendre, monde } = sonde('try { await fetch("https://ailleurs.invalid/x") } catch (e) { return { leve: String(e) } }')
    expect((await rendre()).leve).toMatch(/Réseau fermé/)
    expect(monde.journal.filter((e) => e.genre === 'reseau')).toEqual([{ genre: 'reseau', hote: 'ailleurs.invalid', methode: 'GET', chemin: '/x', declare: false }])
    expect(depensesDe(monde.journal).map(decrire)).toEqual(['réseau GET ailleurs.invalid/x'])
  })

  it('un hôte déclaré reçoit une vraie Request, en-têtes et corps compris', async () => {
    const monde = mondeDeReference()
    monde.hotes['service.invalid'] = async (requete) => Response.json({ methode: requete.method, cle: requete.headers.get('x-cle'), corps: await requete.text() })
    const { rendre } = sonde('return await (await fetch("https://service.invalid/a?b=1", { method: "POST", headers: { "x-cle": "v" }, body: "contenu" })).json()', monde)
    expect(await rendre()).toEqual({ methode: 'POST', cle: 'v', corps: 'contenu' })
  })
})

describe('la base applique ce qu’on lui demande', () => {
  function base() {
    const monde = mondeDeReference()
    monde.base.pieces = [
      { id: 'b1000000-0000-4000-8000-000000000001', dossier_id: ID.dossier, tiers: 'Alpha', montant_ttc: 10, date_piece: '2026-01-02', statut: 'validee' },
      { id: 'b2000000-0000-4000-8000-000000000002', dossier_id: ID.dossier, tiers: 'beta', montant_ttc: 30, date_piece: null, statut: 'a_valider' },
      { id: 'b3000000-0000-4000-8000-000000000003', dossier_id: ID.dossierAutreCabinet, tiers: 'Gamma', montant_ttc: 20, date_piece: '2026-03-04', statut: 'validee' },
    ]
    return monde
  }

  it('les filtres, le tri (NULLS LAST en croissant), la tranche et le compte annoncé', async () => {
    const { rendre } = sonde(`
      const a = await client.from("pieces").select("tiers", { count: "exact" }).eq("dossier_id", "${ID.dossier}").order("date_piece").range(0, 0)
      const b = await client.from("pieces").select("id").in("tiers", ["Alpha", "Gamma"]).gte("montant_ttc", 15)
      const c = await client.from("pieces").select("tiers").ilike("tiers", "%ET%")
      const d = await client.from("pieces").select("tiers").not("date_piece", "is", null).lte("date_piece", "2026-02-01")
      const e = await client.from("pieces").select("id", { count: "exact", head: true }).neq("statut", "validee")
      return { a, b: b.data, c: c.data, d: d.data, e }`, base())
    const r = await rendre()
    expect(r.a).toMatchObject({ data: [{ tiers: 'Alpha' }], count: 2, error: null })
    expect(r.b).toEqual([{ id: 'b3000000-0000-4000-8000-000000000003' }])
    expect(r.c).toEqual([{ tiers: 'beta' }])
    expect(r.d).toEqual([{ tiers: 'Alpha' }])
    expect(r.e).toMatchObject({ data: null, count: 1 })
  })

  it('une ligne unique : PGRST116 sur zéro (single) ou plusieurs lignes, rien sur zéro (maybeSingle)', async () => {
    const { rendre } = sonde(`return {
      zero: await client.from("pieces").select("id").eq("tiers", "Personne").single(),
      peutEtre: await client.from("pieces").select("id").eq("tiers", "Personne").maybeSingle(),
      deux: await client.from("pieces").select("id").eq("dossier_id", "${ID.dossier}").maybeSingle(),
    }`, base())
    const r = await rendre()
    expect(r.zero).toMatchObject({ data: null, error: { code: 'PGRST116' } })
    expect(r.peutEtre).toMatchObject({ data: null, error: null })
    expect(r.deux).toMatchObject({ data: null, error: { code: 'PGRST116' } })
  })

  it('rend au plus « Max rows » lignes, sans le dire — le compte, lui, reste exact', async () => {
    const monde = base()
    monde.maxLignes = 2
    const { rendre } = sonde('return await client.from("pieces").select("id", { count: "exact" })', monde)
    expect(await rendre()).toMatchObject({ count: 3 })
    expect(((await rendre()).data as unknown[]).length).toBe(2)
  })

  it('une table que le schéma exporté ne connaît pas : PGRST205, comme PostgREST', async () => {
    const { rendre } = sonde('return await client.from("cabinet_admin").select("user_id")')
    expect(await rendre()).toMatchObject({ data: null, error: { code: 'PGRST205' } })
  })

  it('un filtre qu’il ne sait pas appliquer LÈVE plutôt que d’être ignoré', async () => {
    const { rendre } = sonde('return await client.from("pieces").select("id").or("montant_ttc.gt.5")')
    await expect(rendre()).rejects.toThrow(/n'est pas modélisé/)
  })

  it('la clé primaire et les contraintes d’unicité refusent un doublon (23505), tout ou rien', async () => {
    const { rendre, monde } = sonde(`return await client.from("memberships").insert([
      { user_id: "${PERSONNES.chef.id}", dossier_id: "${ID.dossier}", role: "client" },
      { user_id: "${PERSONNES.client.id}", dossier_id: "${ID.dossier}", role: "client" },
    ])`)
    expect(await rendre()).toMatchObject({ error: { code: '23505' } })
    expect(monde.base.memberships).toHaveLength(1)
  })

  it('les clés étrangères du schéma : une ligne absente refuse l’insertion, un parent désigné refuse la suppression', async () => {
    const { rendre, monde } = sonde(`return {
      orpheline: await client.from("memberships").insert({ user_id: "${PERSONNES.inscrit.id}", dossier_id: "d9000000-0000-4000-8000-000000000009", role: "client" }),
      parent: await client.from("cabinets").delete().eq("id", "${ID.cabinet}"),
      cascade: await client.from("dossiers").delete().eq("id", "${ID.dossierVoisin}"),
    }`)
    const r = await rendre()
    expect(r.orpheline).toMatchObject({ error: { code: '23503' } })
    expect(r.parent).toMatchObject({ error: { code: '23503' } })
    expect(monde.base.cabinets).toHaveLength(2)
    // Une assignation suit son dossier (ON DELETE CASCADE dans le schéma exporté).
    expect(r.cascade).toMatchObject({ error: null })
    expect(monde.base.dossier_assignations.map((a) => a.dossier_id)).toEqual([ID.dossier])
  })

  it('upsert sur sa clé, update et delete rendent les lignes touchées', async () => {
    const { rendre, monde } = sonde(`return {
      upsert: await client.from("superpdp_credentials").upsert({ dossier_id: "${ID.dossier}", client_id: "a", client_secret: "s" }).select("client_id"),
      encore: await client.from("superpdp_credentials").upsert({ dossier_id: "${ID.dossier}", client_id: "b", client_secret: "s" }).select("client_id"),
      maj: await client.from("dossiers").update({ nom: "Renommé" }).eq("id", "${ID.dossier}").select("nom").maybeSingle(),
    }`)
    const r = await rendre()
    expect(r.encore).toMatchObject({ data: [{ client_id: 'b' }] })
    expect(monde.base.superpdp_credentials).toHaveLength(1)
    expect(r.maj).toMatchObject({ data: { nom: 'Renommé' } })
  })

  it('la RLS d’un jeton d’utilisateur : le client voit les pièces de SON dossier, l’inscrit rien, l’anonyme rien des catégories', async () => {
    const monde = base()
    monde.base.categories = [{ id: 'c0000000-0000-4000-8000-000000000001', dossier_id: null, code: 'x' }]
    const lire = 'return { pieces: (await appelant.from("pieces").select("tiers")).data, categories: (await appelant.from("categories").select("code")).data }'
    expect(await sonde(lire, monde).rendre('client')).toEqual({ pieces: [{ tiers: 'Alpha' }, { tiers: 'beta' }], categories: [{ code: 'x' }] })
    expect(await sonde(lire, monde).rendre('inscrit')).toEqual({ pieces: [], categories: [{ code: 'x' }] })
    expect(await sonde(lire, monde).rendre('chefAutreCabinet')).toEqual({ pieces: [{ tiers: 'Gamma' }], categories: [{ code: 'x' }] })
    const anonyme = 'const c = createClient(Deno.env.get("SUPABASE_URL"), "' + CLE_PUBLIABLE + '"); return (await c.from("categories").select("code")).data'
    expect(await sonde(anonyme, monde).rendre()).toEqual([])
  })

  it('admin_du_dossier : le chef, l’assigné et le super-admin ; ni le voisin, ni l’autre chef, ni le client', async () => {
    const lire = `return (await appelant.rpc("admin_du_dossier", { p_dossier_id: "${ID.dossier}" })).data`
    const admis: Record<string, unknown> = {}
    for (const p of Object.keys(PERSONNES) as (keyof typeof PERSONNES)[]) admis[p] = await sonde(lire).rendre(p)
    expect(admis).toEqual({ chef: true, comptableAssigne: true, comptableNonAssigne: false, chefAutreCabinet: false, client: false, inscrit: false, superAdmin: true })
  })

  it('une clé qui n’est pas celle du projet : 401 « Invalid API key », et aucune donnée', async () => {
    const { rendre } = sonde('return await createClient(Deno.env.get("SUPABASE_URL"), "sb_publishable_autre").from("pieces").select("id")', base())
    expect(await rendre()).toMatchObject({ data: null, error: { message: 'Invalid API key' } })
  })

  it('une panne posée frappe la demande qui lui correspond, après en avoir laissé passer `sauter`', async () => {
    const monde = base()
    monde.pannes.push({ table: 'pieces', operation: 'select', sauter: 1, fois: 1, erreur: { message: 'délai dépassé' } })
    const { rendre } = sonde('const l = () => client.from("pieces").select("id"); return [(await l()).error, (await l()).error, (await l()).error]', monde)
    expect(await rendre()).toEqual([null, { message: 'délai dépassé' }, null])
  })
})

describe('le service d’authentification et l’administration des comptes', () => {
  it('lit le jeton porteur comme GoTrue : « Bearer » ou « bearer », une espace, rien après', async () => {
    const lire = 'return (await appelant.auth.getUser()).data.user?.id ?? null'
    expect(await sonde(lire).rendre('chef')).toBe(PERSONNES.chef.id)
    const monde = mondeDeReference()
    for (const entete of [`Basic ${PERSONNES.chef.jeton}`, `Bearer  ${PERSONNES.chef.jeton}`, `Bearer ${PERSONNES.chef.jeton} `, `Bearer ${CLE_PUBLIABLE}`]) {
      const source = `import { createClient } from "npm:@supabase/supabase-js@2"
Deno.serve(async () => Response.json((await createClient(Deno.env.get("SUPABASE_URL"), "${CLE_PUBLIABLE}", { global: { headers: { Authorization: ${JSON.stringify(entete)} } } }).auth.getUser()).data.user))`
      const r = await chargerFonction('create-cabinet', monde, { source }).appeler(requeteDe('create-cabinet'))
      expect(r.json, entete).toBeNull()
    }
  })

  it('sans en-tête ni jeton : « Auth session missing! », sans rien demander au service', async () => {
    const { rendre, monde } = sonde('return (await client.auth.getUser()).error')
    expect(await rendre()).toMatchObject({ message: 'Auth session missing!' })
    expect(monde.journal.filter((e) => e.genre === 'session')).toEqual([])
  })

  it('l’administration des comptes refuse une autre clé que la secrète', async () => {
    const { rendre } = sonde('return (await appelant.auth.admin.createUser({ email: "x@y.invalid", password: "p" })).error')
    expect(await rendre('chef')).toMatchObject({ status: 403 })
  })

  it('un compte qui existe déjà (sans égard à la casse) : 422, comme GoTrue', async () => {
    const { rendre } = sonde(`return (await client.auth.admin.createUser({ email: "${PERSONNES.chef.email.toUpperCase()}", password: "p" })).error`)
    expect(await rendre()).toMatchObject({ status: 422 })
  })
})

describe('la signature d’un webhook Svix', () => {
  const corps = '{"type":"email.received"}'
  const maintenant = () => Math.floor(Date.now() / 1000)
  const lire = (entetes: Record<string, string>) => ({ id: entetes['svix-id'], timestamp: entetes['svix-timestamp'], signature: entetes['svix-signature'] })

  it('accepte ce que le secret du projet a signé, et rend le corps lu', () => {
    expect(verifierWebhookSvix(corps, lire(signerWebhook(corps)), SECRET_WEBHOOK, maintenant())).toEqual({ type: 'email.received' })
  })

  it('refuse un autre secret, un autre corps, un autre identifiant, un horodatage hors des cinq minutes', () => {
    const entetes = signerWebhook(corps)
    expect(() => verifierWebhookSvix(corps, lire(signerWebhook(corps, { secret: `whsec_${btoa('autre')}` })), SECRET_WEBHOOK, maintenant())).toThrow(/No matching/)
    expect(() => verifierWebhookSvix(`${corps} `, lire(entetes), SECRET_WEBHOOK, maintenant())).toThrow(/No matching/)
    expect(() => verifierWebhookSvix(corps, { ...lire(entetes), id: 'autre' }, SECRET_WEBHOOK, maintenant())).toThrow(/No matching/)
    expect(() => verifierWebhookSvix(corps, lire(signerWebhook(corps, { horodatageS: maintenant() - 301 })), SECRET_WEBHOOK, maintenant())).toThrow(/too old/)
    expect(() => verifierWebhookSvix(corps, { ...lire(entetes), signature: undefined }, SECRET_WEBHOOK, maintenant())).toThrow(/Missing/)
  })

  it('accepte une signature parmi plusieurs (rotation du secret)', () => {
    const entetes = signerWebhook(corps)
    const double = { ...lire(entetes), signature: `v1,${btoa('fausse')} ${entetes['svix-signature']}` }
    expect(verifierWebhookSvix(corps, double, SECRET_WEBHOOK, maintenant())).toEqual({ type: 'email.received' })
  })
})

describe('la passerelle et les requêtes', () => {
  beforeAll(() => prechauffer(sourceDe('banque-connexion')))

  it('à verify_jwt = true, la passerelle refuse sans jeton, ou un jeton qu’elle ne sait pas lire, et laisse passer le préflight', async () => {
    const monde = mondeDeReference()
    const f = chargerFonction('banque-connexion', monde)
    expect(f.verifyJwt).toBe(true)
    expect(await f.appeler(requeteDe('banque-connexion', { corps: {} }))).toMatchObject({ statut: 401, parLaPasserelle: true })
    expect(await f.appeler(requeteDe('banque-connexion', { corps: {}, entetes: { Authorization: `Bearer ${CLE_PUBLIABLE}` } }))).toMatchObject({ statut: 401, parLaPasserelle: true })
    expect(await f.appeler(preflightDe('banque-connexion', ['apikey']))).toMatchObject({ statut: 200, parLaPasserelle: false })
    expect(monde.journal).toEqual([])
  })

  it('la requête du navigateur porte la clé publishable par défaut, la session quand il y en a une', () => {
    const r = requeteDe('agent-comptable', { personne: 'chef', corps: { a: 1 } })
    expect([r.headers.get('apikey'), r.headers.get('Authorization'), r.headers.get('Content-Type')])
      .toEqual([CLE_PUBLIABLE, `Bearer ${PERSONNES.chef.jeton}`, 'application/json'])
    expect(requeteDe('agent-comptable', { apikey: null }).headers.get('apikey')).toBeNull()
  })

  it('une fuite se voit entière pour un secret, par morceaux pour une valeur de pièce', () => {
    const monde = nouveauMonde()
    monde.sensibles.push('Quarzbuch Zelintor')
    expect(fuitesDans(`clé ${CLE_SECRETE}`, monde, false)).toEqual([CLE_SECRETE])
    expect(fuitesDans('Unexpected token, ..."{"tiers": Quarzbuc"...', monde, true)).toEqual(['Quarzbuch Zelintor'])
    expect(fuitesDans('Unexpected token, ..."{"tiers": Quarzbuc"...', monde, false)).toEqual([])
    expect(fuitesDans('sb_secret_… attendu', monde, true)).toEqual([])
  })
})
