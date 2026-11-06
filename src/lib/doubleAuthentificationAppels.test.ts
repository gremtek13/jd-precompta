import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inscrireUnAppareil, lireLaSecurite, retirerUnAppareil, verifierLeCode } from './doubleAuthentificationAppels'

// LES APPELS DU SECOND FACTEUR (ligne 51.5, étape C7) : chacun rend une issue et ne lève jamais ; un refus se dit par
// `messageDuService`, jamais nu ; la vérification passe un défi puis le code sans ses espaces ; un retrait renouvelle la
// session ; et la clé d'un appareil n'atteint aucun journal, refus ou réussite.

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const faux = vi.hoisted(() => ({
  appels: [] as string[],
  reponses: {} as Record<string, unknown>,
  levees: {} as Record<string, unknown>,
}))

vi.mock('./supabase', () => {
  const appel = (nom: string) => async (...args: unknown[]) => {
    faux.appels.push(`${nom} ${JSON.stringify(args[0] ?? null)}`)
    if (nom in faux.levees) throw faux.levees[nom]
    return faux.reponses[nom]
  }
  return {
    supabase: {
      auth: {
        refreshSession: appel('refreshSession'),
        mfa: {
          listFactors: appel('listFactors'), getAuthenticatorAssuranceLevel: appel('getAuthenticatorAssuranceLevel'),
          enroll: appel('enroll'), challenge: appel('challenge'), verify: appel('verify'), unenroll: appel('unenroll'),
        },
      },
    },
  }
})

const journaux = () => [console.log, console.info, console.warn, console.error, console.debug]
  .flatMap((f) => (f as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat())
  .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))

beforeEach(() => {
  faux.appels = []
  faux.levees = {}
  faux.reponses = {
    listFactors: { data: { all: [{ id: 'f1', friendly_name: 'Téléphone', factor_type: 'totp', status: 'verified', created_at: '2026-11-01T09:00:00Z' }] }, error: null },
    getAuthenticatorAssuranceLevel: { data: { currentLevel: 'aal2', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null },
    enroll: { data: { id: 'f9', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET, uri: `otpauth://totp/x?secret=${SECRET}` } }, error: null },
    challenge: { data: { id: 'c1', type: 'totp', expires_at: 0 }, error: null },
    verify: { data: {}, error: null },
    unenroll: { data: { id: 'f1' }, error: null },
    refreshSession: { data: { session: null, user: null }, error: null },
  }
  for (const nom of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, nom).mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })

describe('les appels du second facteur', () => {
  it('lit les appareils au service et les niveaux de la session', async () => {
    expect(await lireLaSecurite('vous')).toEqual({
      ok: true,
      valeur: {
        facteurs: [{ id: 'f1', nom: 'Téléphone', type: 'totp', verifie: true, creeLe: '2026-11-01T09:00:00Z' }],
        niveaux: { actuel: 'aal2', suivant: 'aal2' },
      },
    })
    // Une réponse sans sa liste n'est pas une liste vide : c'est une lecture ratée, dite.
    faux.reponses.listFactors = { data: { totp: [] }, error: null }
    expect(await lireLaSecurite('tu')).toEqual({ ok: false, message: 'La sécurité du compte n’a pas pu être lue : raison inconnue' })
    faux.levees.getAuthenticatorAssuranceLevel = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }
    faux.reponses.listFactors = { data: { all: [] }, error: null }
    expect(await lireLaSecurite('tu')).toMatchObject({ ok: false, message: expect.stringMatching(/^Le service de connexion n’a pas répondu/) })
  })

  it('inscrit une application d’authentification et rend sa clé, sans la journaliser', async () => {
    expect(await inscrireUnAppareil('  Téléphone  ', 'vous')).toEqual({
      ok: true, valeur: { id: 'f9', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: SECRET },
    })
    expect(faux.appels).toEqual(['enroll {"factorType":"totp","friendlyName":"Téléphone"}'])
    faux.reponses.enroll = { data: null, error: { code: 'mfa_factor_name_conflict', status: 422, message: `conflit ${SECRET}` } }
    expect(await inscrireUnAppareil('Téléphone', 'tu')).toEqual({ ok: false, message: 'Un appareil porte déjà ce nom : choisis-en un autre.' })
    expect(journaux().filter((t) => t.includes(SECRET))).toEqual([])
  })

  it('vérifie un code par un défi puis le code sans ses espaces ; un refus est dit, une exception aussi', async () => {
    expect(await verifierLeCode('f1', '123 456', 'vous')).toEqual({ ok: true, valeur: null })
    expect(faux.appels).toEqual(['challenge {"factorId":"f1"}', 'verify {"factorId":"f1","challengeId":"c1","code":"123456"}'])
    faux.reponses.verify = { data: null, error: { code: 'mfa_verification_failed', status: 422, message: 'Invalid TOTP code entered' } }
    expect(await verifierLeCode('f1', '000000', 'tu')).toMatchObject({ ok: false, message: expect.stringMatching(/^Ce code n’est pas le bon.*saisis celui/) })
    faux.reponses.challenge = { data: null, error: { code: 'mfa_factor_not_found', status: 404, message: 'Factor not found' } }
    faux.appels = []
    expect(await verifierLeCode('f1', '000000', 'vous')).toEqual({ ok: false, message: 'Cet appareil n’est plus inscrit.' })
    expect(faux.appels).toEqual(['challenge {"factorId":"f1"}'])
    faux.levees.challenge = 'hors service'
    expect(await verifierLeCode('f1', '000000', 'vous')).toEqual({ ok: false, message: 'Le code n’a pas pu être vérifié : hors service' })
  })

  it('retire un appareil puis renouvelle la session ; un renouvellement raté laisse le retrait fait, et le dit', async () => {
    expect(await retirerUnAppareil('f1', 'vous')).toEqual({ ok: true, valeur: { sessionActualisee: true } })
    expect(faux.appels).toEqual(['unenroll {"factorId":"f1"}', 'refreshSession null'])
    faux.reponses.refreshSession = { data: { session: null, user: null }, error: { message: 'Refresh Token Not Found', status: 400 } }
    expect(await retirerUnAppareil('f1', 'vous')).toEqual({ ok: true, valeur: { sessionActualisee: false } })
    faux.appels = []
    faux.reponses.unenroll = { data: null, error: { code: 'insufficient_aal', status: 401, message: 'AAL2 required to unenroll verified factor' } }
    expect(await retirerUnAppareil('f1', 'tu')).toMatchObject({ ok: false, message: expect.stringMatching(/^Le service demande d’abord le code/) })
    expect(faux.appels).toEqual(['unenroll {"factorId":"f1"}'])
  })
})
