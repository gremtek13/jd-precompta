import { createClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it } from 'vitest'
import { adresseDejaInscrite, messageErreurDuMotDePasse, refusDuMotDePasse } from './recuperationMotDePasse'

// LE CONTRAT QUE LE BLOC refusDuService PASSE AVEC LA BIBLIOTHÈQUE (défaut 23.5, 10/10/2026), joué sur le VRAI client
// installé (@supabase/supabase-js et auth-js 2.112.4) devant un faux service qui répond comme le vrai — les corps et les
// en-têtes qu'écrit supabase/auth (`internal/api/errors.go`, dépôt public, lu le 10/10/2026). Ce que le bloc lit — `code`,
// `reasons` — est ce que le SDK porte ; les autres tests le doublent, et une mise à jour de la bibliothèque qui changerait
// l'un de ces points ne se verrait qu'ici :
//   1. le SDK demande la version 2024-01-01 de l'API (`X-Supabase-Api-Version`) : c'est elle qui fait rendre au service
//      un `code` dans le corps ;
//   2. une adresse déjà inscrite et un mot de passe refusé arrivent TOUS DEUX en 422 : seul le code les distingue ;
//   3. le refus d'un mot de passe devient une `AuthWeakPasswordError` qui porte ses raisons, sous la forme d'aujourd'hui
//      comme sous la forme ancienne (`error_code`, ou les seules raisons) ;
//   4. une panne du service (500) n'a pas de code : ni « déjà inscrit », ni « mot de passe refusé » ;
//   5. `updateUser` (l'écran du nouveau mot de passe) rend le même refus, que l'écran dit en français.

const DEJA_INSCRITE = 'A user with this email address has already been registered'
const CARACTERES = 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789, !@#$%^&*()_+-=[]{};\'\\:"|<>?,./`~.'

/** Une réponse du service : la forme 2024-01-01 renvoie l'en-tête de version et `{ code, message }`, l'ancienne `{ code: <statut>, error_code, msg }`. */
function reponse(statut: number, corps: Record<string, unknown>, version: '2024-01-01' | null): Response {
  const entetes: Record<string, string> = { 'Content-Type': 'application/json' }
  if (version) entetes['X-Supabase-Api-Version'] = version
  return new Response(JSON.stringify(corps), { status: statut, headers: entetes })
}

const REPONSES = {
  dejaInscrite: () => reponse(422, { code: 'email_exists', message: DEJA_INSCRITE }, '2024-01-01'),
  dejaInscriteAncienne: () => reponse(422, { code: 422, error_code: 'email_exists', msg: DEJA_INSCRITE }, null),
  caracteres: () => reponse(422, { code: 'weak_password', message: CARACTERES, weak_password: { reasons: ['characters'] } }, '2024-01-01'),
  longueurAncienne: () => reponse(422, { code: 422, error_code: 'weak_password', msg: 'Password should be at least 12 characters.', weak_password: { reasons: ['length'] } }, null),
  // Plus ancienne encore : aucun code, les seules raisons (le « legacy support » d'auth-js, `lib/fetch.js`).
  raisonsSeules: () => reponse(422, { code: 422, msg: 'Password should be at least 6 characters', weak_password: { reasons: ['length'] } }, null),
  tropLong: () => reponse(400, { code: 'validation_failed', message: 'Password cannot be longer than 72 characters' }, '2024-01-01'),
  panne: () => reponse(500, { code: 'unexpected_failure', message: 'Database error creating new user' }, '2024-01-01'),
}

const requetes: { methode: string; chemin: string; version: string | null }[] = []
let prochaine: () => Response = REPONSES.dejaInscrite

async function fauxService(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
  const adresse = new URL(String(entree))
  const version = new Headers(init?.headers).get('X-Supabase-Api-Version')
  requetes.push({ methode: init?.method ?? 'GET', chemin: adresse.pathname, version })
  if (adresse.pathname === '/auth/v1/user' && (init?.method ?? 'GET') === 'GET') {
    return reponse(200, { id: 'u-client', aud: 'authenticated', role: 'authenticated', email: 'client@exemple-fictif.fr', app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T08:00:00Z' }, '2024-01-01')
  }
  return prochaine()
}

// Les clients du test ne gardent rien ni ne renouvellent rien : ils n'existent que le temps d'un appel.
const options = { global: { fetch: fauxService }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const serveur = () => createClient('https://projet-fictif.supabase.co', 'sb_secret_fictif', options)

afterEach(() => {
  requetes.length = 0
  prochaine = REPONSES.dejaInscrite
})

async function creer(r: () => Response) {
  prochaine = r
  return serveur().auth.admin.createUser({ email: 'nouveau@exemple-fictif.fr', password: 'mot-de-passe-du-contrat', email_confirm: true })
}

describe('le client installé, devant un refus du service à la création d’un compte', () => {
  it('demande la version 2024-01-01 de l’API — celle où le service rend un code', async () => {
    await creer(REPONSES.dejaInscrite)
    expect(requetes).toEqual([{ methode: 'POST', chemin: '/auth/v1/admin/users', version: '2024-01-01' }])
  })

  it('une adresse déjà inscrite : 422, `email_exists` — « déjà inscrite », sous la forme d’aujourd’hui comme sous l’ancienne', async () => {
    for (const r of [REPONSES.dejaInscrite, REPONSES.dejaInscriteAncienne]) {
      const { data, error } = await creer(r)
      expect(data.user).toBeNull()
      expect(error).toMatchObject({ status: 422, code: 'email_exists' })
      expect(adresseDejaInscrite(error)).toBe(true)
      expect(refusDuMotDePasse(error)).toBeNull()
    }
  })

  it('un mot de passe refusé : 422 lui aussi — mais `weak_password`, et ses raisons ; jamais « déjà inscrite »', async () => {
    const { data, error } = await creer(REPONSES.caracteres)
    expect(data.user).toBeNull()
    expect(error).toMatchObject({ name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', reasons: ['characters'] })
    expect(adresseDejaInscrite(error)).toBe(false)
    expect(refusDuMotDePasse(error)).toBe(
      "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, réglée au "
      + "tableau de bord de Supabase — il lui manque une sorte de caractères qu'elle exige (minuscule, majuscule, chiffre ou "
      + 'symbole, selon le réglage).',
    )
  })

  it('sous les formes anciennes — `error_code`, ou les seules raisons — le même refus, avec ses raisons', async () => {
    for (const r of [REPONSES.longueurAncienne, REPONSES.raisonsSeules]) {
      const { error } = await creer(r)
      expect(error).toMatchObject({ name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', reasons: ['length'] })
      expect(adresseDejaInscrite(error)).toBe(false)
      expect(refusDuMotDePasse(error)).toMatch(/— il est trop court\.$/)
    }
  })

  it('un autre refus (400 `validation_failed`) et une panne (500, sans code) : ni l’un ni l’autre', async () => {
    const trop = await creer(REPONSES.tropLong)
    expect(trop.error).toMatchObject({ status: 400, code: 'validation_failed' })
    const panne = await creer(REPONSES.panne)
    expect(panne.error).toMatchObject({ name: 'AuthRetryableFetchError', status: 500, message: 'Database error creating new user' })
    expect(panne.error?.code).toBeUndefined()
    for (const error of [trop.error, panne.error]) {
      expect(adresseDejaInscrite(error)).toBe(false)
      expect(refusDuMotDePasse(error)).toBeNull()
    }
  })
})

// Un jeton à la forme d'un JWT, qui expire dans une heure : le client n'en vérifie que la forme (chaque morceau en
// base64url, d'une longueur qui en est une), puis le présente au service.
function jetonFictif(): string {
  const morceau = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${morceau({ alg: 'HS256', typ: 'JWT' })}.${morceau({ sub: 'u-client', exp: Math.floor(Date.now() / 1000) + 3600 })}.signaturefictive`
}

describe('le client installé, devant un refus du nouveau mot de passe (l’écran ouvert par un lien)', () => {
  it('`updateUser` rend le même refus, et l’écran le dit en français, raisons comprises', async () => {
    const client = createClient('https://projet-fictif.supabase.co', 'sb_publishable_fictif', options)
    const ouverte = await client.auth.setSession({ access_token: jetonFictif(), refresh_token: 'rt-fictif' })
    expect(ouverte.error).toBeNull()
    prochaine = () => reponse(422, {
      code: 'weak_password', message: CARACTERES, weak_password: { reasons: ['length', 'characters'] },
    }, '2024-01-01')
    const { error } = await client.auth.updateUser({ password: 'court' })
    expect(requetes.at(-1)).toEqual({ methode: 'PUT', chemin: '/auth/v1/user', version: '2024-01-01' })
    expect(error).toMatchObject({ name: 'AuthWeakPasswordError', code: 'weak_password', reasons: ['length', 'characters'] })
    expect(messageErreurDuMotDePasse(error)).toBe(
      "Le service d'authentification refuse ce mot de passe : il ne suit pas la règle des mots de passe du projet, réglée au "
      + "tableau de bord de Supabase — il est trop court ; il lui manque une sorte de caractères qu'elle exige (minuscule, "
      + 'majuscule, chiffre ou symbole, selon le réglage). Choisis-en un autre.',
    )
  })
})
