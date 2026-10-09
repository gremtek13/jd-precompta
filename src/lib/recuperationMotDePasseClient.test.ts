// @vitest-environment jsdom
import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lireRetourDuLien } from './recuperationMotDePasse'

// LE CONTRAT QUE « MOT DE PASSE OUBLIÉ » PASSE AVEC LA BIBLIOTHÈQUE, joué sur le VRAI client (@supabase/supabase-js
// installé, réglages par défaut comme lib/supabase.ts), devant un faux service. Ce que l'application suppose, et qu'une mise
// à jour de la bibliothèque pourrait défaire sans qu'aucun autre test ne le voie — tous doublent le client :
//   1. construit, le client n'a pas encore vidé le fragment : main.tsx, qui le lit juste après, voit le lien ;
//   2. le fragment n'est vidé qu'APRÈS l'aller-retour qui vérifie le jeton ;
//   3. la session ouverte porte le jeton même du lien (AuthProvider la reconnaît à lui) ;
//   4. `PASSWORD_RECOVERY` est émis à qui écoute ;
//   5. un lien refusé n'ouvre rien, n'appelle rien, et laisse le fragment (le portier d'App.tsx le retire) ;
//   6. le flux par défaut est implicite (en PKCE, cette adresse serait refusée).

const DANS_UNE_HEURE = () => Math.floor(Date.now() / 1000) + 3600

// Un jeton à la forme d'un JWT : le client ne le décode pas, il le présente au service.
function jetonFictif(compte: string): string {
  const morceau = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${morceau({ alg: 'HS256', typ: 'JWT' })}.${morceau({ sub: compte, exp: DANS_UNE_HEURE() })}.signature-fictive`
}

const appels: string[] = []
let relacher: (() => void) | null = null

// Le faux service : seul `GET /auth/v1/user` est attendu, et sa réponse se retient jusqu'à ce que le test la relâche.
async function fauxFetch(entree: string | URL | Request, init?: RequestInit): Promise<Response> {
  const adresse = new URL(String(entree))
  appels.push(`${init?.method ?? 'GET'} ${adresse.pathname}`)
  if (adresse.pathname !== '/auth/v1/user') return new Response('{}', { status: 404 })
  await new Promise<void>((r) => { relacher = r })
  const utilisateur = { id: 'u-client', aud: 'authenticated', role: 'authenticated', email: 'client@exemple-fictif.fr', app_metadata: {}, user_metadata: {}, created_at: '2026-10-09T08:00:00Z' }
  return new Response(JSON.stringify(utilisateur), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

async function jusqua(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5))
  expect(condition()).toBe(true)
}

// Le renouvellement automatique des jetons de chaque client, arrêté après chaque test.
const arrets: (() => Promise<void>)[] = []
// Un projet par test : deux clients sur la même clé de stockage se gêneraient (la bibliothèque le signale).
function client(projet: string) {
  const c = createClient(`https://${projet}.supabase.co`, 'sb_publishable_fictif', { global: { fetch: fauxFetch } })
  arrets.push(() => c.auth.stopAutoRefresh())
  return c
}

beforeEach(() => {
  appels.length = 0
  relacher = null
  // Le canal entre onglets de la bibliothèque garderait le processus ouvert ; il n'a rien à éprouver ici.
  vi.stubGlobal('BroadcastChannel', undefined)
  localStorage.clear()
})
afterEach(async () => {
  for (const arreter of arrets.splice(0)) await arreter()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

describe('le client Supabase installé, devant un lien « Mot de passe oublié »', () => {
  it('laisse le fragment intact jusqu’à l’aller-retour, ouvre la session du jeton même, puis vide le fragment et le dit', async () => {
    const jeton = jetonFictif('u-client')
    window.history.replaceState(null, '', `/#access_token=${jeton}&expires_at=${DANS_UNE_HEURE()}&expires_in=3600&refresh_token=rt-fictif&sb=&token_type=bearer&type=recovery`)
    const supabase = client('projet-fictif-un')
    // Ce que main.tsx lit, juste après la construction du client.
    expect(lireRetourDuLien(window.location.href)).toEqual({ nature: 'recuperation', jeton })
    const evenements: string[] = []
    supabase.auth.onAuthStateChange((evenement) => { evenements.push(evenement) })

    await jusqua(() => relacher !== null)
    expect(appels).toEqual(['GET /auth/v1/user'])
    expect(window.location.hash).toContain('type=recovery')

    relacher!()
    const { data } = await supabase.auth.getSession()
    expect(data.session?.access_token).toBe(jeton)
    expect(data.session?.user.id).toBe('u-client')
    expect(window.location.hash).toBe('')
    await jusqua(() => evenements.includes('PASSWORD_RECOVERY'))
  })

  it('un lien refusé n’ouvre aucune session, n’appelle pas le service, et laisse le fragment', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=')
    const supabase = client('projet-fictif-deux')
    const { data } = await supabase.auth.getSession()
    expect(data.session).toBeNull()
    expect(appels).toEqual([])
    expect(window.location.hash).toContain('error_code=otp_expired')
  })
})
