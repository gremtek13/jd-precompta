import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  MOTS, codeSaisi, etatDeLaSession, etatDuCompte, facteurDe, messageDuService, niveauDuJeton, niveauxDeLaSession, nomPropose,
  porteDeLApplication, refusDuCode, refusDuNom, registreDe, secretEnGroupes, type Etape, type Facteur, type FacteurDuService,
  type SessionLue,
} from './doubleAuthentification'
import { motsDuCabinet } from './espaceVentes'

// LA DOUBLE AUTHENTIFICATION, PREMIER TEMPS (ligne 51.5, étape C7) : l'état d'un compte, la porte de l'application, les refus
// dits avant le clic, et les mots des deux espaces. La porte se calcule sur la session que l'application tient — le même
// calcul que `getAuthenticatorAssuranceLevel()` d'auth-js, confronté ici au vrai client, sans aucun appel réseau.

const b64url = (valeur: unknown) => Buffer.from(JSON.stringify(valeur)).toString('base64url')
const jeton = (charge: Record<string, unknown>) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(charge)}.c2lnbmF0dXJl`

const VERIFIE: FacteurDuService = { id: 'f1', friendly_name: 'Téléphone', factor_type: 'totp', status: 'verified', created_at: '2026-11-01T09:00:00Z' }
const INACHEVE: FacteurDuService = { id: 'f2', friendly_name: 'Tablette', factor_type: 'totp', status: 'unverified', created_at: '2026-11-02T09:00:00Z' }

function session(charge: Record<string, unknown>, factors?: FacteurDuService[]): SessionLue {
  return { access_token: jeton({ sub: 'u1', ...charge }), user: { factors } }
}

const CAS = {
  'aal1, sans facteur': session({ aal: 'aal1' }),
  'aal1, un facteur vérifié': session({ aal: 'aal1' }, [VERIFIE]),
  'aal2, un facteur vérifié': session({ aal: 'aal2' }, [VERIFIE]),
  'aal2, plus aucun facteur': session({ aal: 'aal2' }, []),
  'aal1, un facteur inachevé seul': session({ aal: 'aal1' }, [INACHEVE]),
  'sans revendication, un facteur vérifié': session({}, [VERIFIE]),
}

describe('le niveau d’une session', () => {
  it('se lit dans le jeton : aal1, aal2, nul sans revendication ou sur un jeton illisible', () => {
    expect(niveauDuJeton(jeton({ aal: 'aal1' }))).toBe('aal1')
    expect(niveauDuJeton(jeton({ aal: 'aal2', nom: 'Hélène ~~~ ???' }))).toBe('aal2')
    expect(niveauDuJeton(jeton({}))).toBeNull()
    expect(niveauDuJeton(jeton({ aal: 'aal3' }))).toBeNull()
    expect(niveauDuJeton('faux')).toBeNull()
    expect(niveauDuJeton('a.%%%.c')).toBeNull()
    expect(niveauDuJeton(`a.${Buffer.from('[1]').toString('base64url')}.c`)).toBeNull()
  })

  it('est celui que rend le vrai client auth-js, sans appel au service', async () => {
    for (const [nom, s] of Object.entries(CAS)) {
      const memoire = new Map<string, string>()
      memoire.set('cle-essai', JSON.stringify({
        access_token: s.access_token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', aud: 'authenticated', factors: s.user.factors },
      }))
      const client = createClient('https://fictif.supabase.co', 'sb_publishable_fictif', {
        auth: {
          storageKey: 'cle-essai', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
          storage: { getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => { memoire.set(k, v) }, removeItem: (k) => { memoire.delete(k) } },
        },
        global: { fetch: () => { throw new Error('aucun appel au service n’est attendu') } },
      })
      const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
      expect(error, nom).toBeNull()
      const attendu = niveauxDeLaSession(s)
      expect({ actuel: data?.currentLevel ?? null, suivant: data?.nextLevel ?? null }, nom).toEqual(attendu)
    }
  })
})

describe('l’état d’un compte et la porte de l’application', () => {
  it('sur la session : seul un facteur vérifié sans code donné ferme la porte', () => {
    const etats = Object.fromEntries(Object.entries(CAS).map(([nom, s]) => [nom, etatDeLaSession(s)]))
    expect(etats).toEqual({
      'aal1, sans facteur': 'sans-facteur',
      'aal1, un facteur vérifié': 'code-a-donner',
      'aal2, un facteur vérifié': 'verifie',
      'aal2, plus aucun facteur': 'jeton-a-rafraichir',
      'aal1, un facteur inachevé seul': 'sans-facteur',
      // Le côté fermé : un jeton qui ne dit pas aal2 devant un facteur vérifié demande le code.
      'sans revendication, un facteur vérifié': 'code-a-donner',
    })
    expect(Object.values(etats).map(porteDeLApplication)).toEqual(['ouverte', 'code', 'ouverte', 'ouverte', 'ouverte', 'code'])
    // Les sessions des bancs et des tests d'avant (un jeton qui n'en est pas un, aucun facteur) : la porte reste ouverte.
    expect(porteDeLApplication(etatDeLaSession({ access_token: 'faux', user: {} }))).toBe('ouverte')
  })

  it('sur la liste lue au service : le jeton ou la copie de l’utilisateur en retard se disent « à rafraîchir »', () => {
    const verifie: Facteur = facteurDe(VERIFIE)
    const inacheve: Facteur = facteurDe(INACHEVE)
    // Le facteur retiré : le service n'en a plus, la session garde aal2 ou la copie qui le comptait.
    expect(etatDuCompte({ actuel: 'aal2', suivant: 'aal2' }, [])).toBe('jeton-a-rafraichir')
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal2' }, [inacheve])).toBe('jeton-a-rafraichir')
    // Un facteur vérifié que la copie de la session ne connaît pas encore.
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal1' }, [verifie])).toBe('jeton-a-rafraichir')
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal1' }, [inacheve])).toBe('sans-facteur')
    expect(etatDuCompte({ actuel: 'aal2', suivant: 'aal2' }, [verifie, inacheve])).toBe('verifie')
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal2' }, [verifie])).toBe('code-a-donner')
    // Sans liste, les seuls niveaux.
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal2' }, null)).toBe('code-a-donner')
    expect(etatDuCompte({ actuel: null, suivant: 'aal2' }, null)).toBe('code-a-donner')
    expect(etatDuCompte({ actuel: 'aal2', suivant: 'aal2' }, null)).toBe('verifie')
    expect(etatDuCompte({ actuel: 'aal1', suivant: 'aal1' }, null)).toBe('sans-facteur')
  })
})

describe('les refus dits avant le clic', () => {
  it('un code a six chiffres, ses espaces retirés', () => {
    expect(refusDuCode('123456')).toBeNull()
    expect(refusDuCode(' 123 456 ')).toBeNull()
    expect(refusDuCode('123 456')).toBeNull()
    expect(codeSaisi('123 456')).toBe('123456')
    for (const mauvais of ['', '12345', '1234567', '12345a', '123-456', '١٢٣٤٥٦', '１２３４５６']) {
      expect(refusDuCode(mauvais), mauvais).toBe('Le code compte six chiffres, sans lettre ni signe.')
    }
  })

  it('un nom non vide, qu’aucun appareil ne porte ; le nom proposé n’est jamais pris', () => {
    const tel = facteurDe(VERIFIE)
    expect(refusDuNom('  ', [], 'vous')).toBe('Donnez un nom à cet appareil.')
    expect(refusDuNom('', [], 'tu')).toBe('Donne un nom à cet appareil.')
    expect(refusDuNom(' Téléphone ', [tel], 'vous')).toBe('Un appareil porte déjà ce nom : choisissez-en un autre.')
    expect(refusDuNom('Tablette', [tel], 'tu')).toBeNull()
    expect(nomPropose([])).toBe('Téléphone')
    expect(nomPropose([tel])).toBe('Appareil 2')
    expect(nomPropose([tel, { ...tel, id: 'x', nom: 'Appareil 2' }])).toBe('Appareil 3')
    expect(refusDuNom(nomPropose([tel]), [tel], 'vous')).toBeNull()
  })

  it('la clé se montre par groupes de quatre', () => {
    expect(secretEnGroupes('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(secretEnGroupes('ABCDEF')).toBe('ABCD EF')
  })
})

describe('les mots des deux espaces', () => {
  const ETAPES: Etape[] = ['lecture', 'inscription', 'verification', 'retrait', 'actualisation']
  const CODES = [
    'mfa_verification_failed', 'mfa_challenge_expired', 'insufficient_aal', 'mfa_factor_name_conflict', 'too_many_enrolled_mfa_factors',
    'mfa_factor_not_found', 'mfa_totp_enroll_not_enabled', 'mfa_ip_address_mismatch', 'over_request_rate_limit', 'session_not_found', 'inconnu',
  ]
  const textes = (registre: 'vous' | 'tu') => [
    ...Object.values(MOTS[registre]).map((m) => (typeof m === 'function' ? `${m('Téléphone', true)} ${m('Téléphone', false)}` : m)),
    ...ETAPES.flatMap((etape) => CODES.map((code) => messageDuService(etape, { code, message: 'refus du service' }, registre))),
    messageDuService('lecture', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, registre),
    refusDuNom('', [], registre) ?? '', refusDuNom('Téléphone', [facteurDe(VERIFIE)], registre) ?? '',
  ]

  it('le client est tutoyé, sans aucune forme du cabinet (MOTS_DU_CABINET)', () => {
    expect(textes('tu').flatMap(motsDuCabinet)).toEqual([])
    expect(registreDe('client')).toBe('tu')
  })

  it('le cabinet est vouvoyé, sans tutoiement', () => {
    expect(textes('vous').filter((t) => /\b(tu|ton|ta|tes|toi)\b/i.test(t))).toEqual([])
    expect(registreDe('cabinet')).toBe('vous')
  })

  it('un refus se lit à son code, et un refus inconnu se dit avec son message — jamais une erreur nue', () => {
    expect(messageDuService('verification', { code: 'mfa_verification_failed', status: 422 }, 'vous')).toMatch(/^Ce code n’est pas le bon/)
    expect(messageDuService('retrait', { code: 'insufficient_aal', status: 401 }, 'tu')).toMatch(/^Le service demande d’abord le code/)
    expect(messageDuService('inscription', { status: 429 }, 'vous')).toMatch(/^Trop de tentatives/)
    expect(messageDuService('inscription', { name: 'AuthSessionMissingError', status: 400 }, 'tu')).toBe('La session a pris fin : reconnecte-toi.')
    expect(messageDuService('retrait', { message: 'Boom' }, 'vous')).toBe('L’appareil n’a pas pu être retiré : Boom')
    expect(messageDuService('lecture', null, 'vous')).toBe('La sécurité du compte n’a pas pu être lue : raison inconnue')
    expect(messageDuService('lecture', 'texte levé', 'tu')).toBe('La sécurité du compte n’a pas pu être lue : texte levé')
  })
})
