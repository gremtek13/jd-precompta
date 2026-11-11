import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// L'ÉTAT QUI SUIVRA LA MIGRATION `adresse_des_acces_retires` (P1T-E2), le drapeau levé : la trace et les adresses lues
// ensemble, rien avant que les deux reviennent, un accès retiré nommé par l'adresse retenue à son départ, et une lecture
// partielle des adresses dite à part. Le drapeau est baissé tant que la migration n'est pas en base : AccesTab.trace.test.tsx
// joue l'état réel, ce fichier l'état d'après.
const lectures = vi.hoisted(() => ({
  adresses: null as null | ((d: string) => Promise<unknown>),
}))
vi.mock('../../lib/traceDesDroits', () => ({ TRACE_DES_DROITS_PREVUE: true }))
vi.mock('../../lib/adressesDesAccesRetires', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: true,
}))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({
    dossierId, motif: null,
    lignes: [{ id: 't1', accesId: 'm-parti', clientId: 'u-parti', droit: 'banque', coche: false, geste: 'retrait', auteurId: null, instant: '2026-11-10T08:30:00Z' }],
  }),
  lireLesAdressesDesAccesRetires: (dossierId: string) => lectures.adresses!(dossierId),
}))

const proprietes = {
  dossierId: 'd1', acces: [{ id: 'm1', email: 'client@exemple.fr' }], listeLue: true,
  accesDuDossier: { etat: 'lus' as const, comptes: ['u-m1'] }, lectureNo: 1,
}

describe('« Droits changés », l’adresse d’un accès retiré en base', () => {
  it('nomme l’accès retiré par l’adresse retenue à son départ, et dit pourquoi elle est gardée', async () => {
    lectures.adresses = async (dossierId) => ({
      dossierId, motif: null, parAcces: new Map([['m-parti', { adresse: 'ancien@exemple.fr', retireLe: '2026-11-10T08:30:00Z' }]]),
    })
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    expect(await screen.findByText(/ancien@exemple\.fr — accès retiré le 10\/11\/2026 à 09:30/)).toBeTruthy()
    expect(screen.getByText(/se nomme par l’adresse qu’il portait à son départ/)).toBeTruthy()
    expect(screen.queryByText(/Accès retiré depuis/)).toBeNull()
  })

  it('rien avant le retour des adresses : la trace revenue seule reste « Chargement… »', async () => {
    lectures.adresses = () => new Promise(() => {})
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('Chargement de la trace des droits…')).toBeTruthy()
    expect(screen.queryByText(/Accès retiré/)).toBeNull()
  })

  it('les adresses lues en partie : le bandeau le dit, et l’accès sans adresse lue garde l’intitulé d’hier', async () => {
    lectures.adresses = async (dossierId) => ({ dossierId, motif: 'la lecture a échoué', parAcces: new Map() })
    render(<TraceDesDroitsDesAcces {...proprietes} />)
    expect(await screen.findByText(/Accès retiré depuis \(tracé dès le 10\/11\/2026 à 09:30\)/)).toBeTruthy()
    expect(screen.getByText(/Les adresses des accès retirés/)).toBeTruthy()
  })
})
