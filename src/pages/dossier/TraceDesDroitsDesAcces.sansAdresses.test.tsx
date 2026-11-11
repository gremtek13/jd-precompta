import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// L'ÉTAT D'AVANT LA TABLE DES ADRESSES (`ADRESSES_DES_ACCES_RETIRES_PREVUES` baissé) : la trace lue seule, sans la table
// `adresses_des_acces_retires` — la lire avant sa migration ferait dire « lue en partie » d'une table absente. Le drapeau est
// levé depuis le 11/11/2026 : TraceDesDroitsDesAcces.adresses.test.tsx joue l'état réel, ce fichier garde l'état d'avant
// éprouvé tant que son code existe.
const lectures = vi.hoisted(() => ({ adresses: 0 }))
vi.mock('../../lib/traceDesDroits', () => ({ TRACE_DES_DROITS_PREVUE: true }))
vi.mock('../../lib/adressesDesAccesRetires', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: false,
}))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({
    dossierId, motif: null,
    lignes: [{ id: 't1', accesId: 'm-parti', clientId: 'u-parti', droit: 'banque', coche: false, geste: 'retrait', auteurId: null, instant: '2026-11-10T08:30:00Z' }],
  }),
  lireLesAdressesDesAccesRetires: async (dossierId: string) => {
    lectures.adresses += 1
    return { dossierId, motif: null, parAcces: new Map() }
  },
}))

describe('« Droits changés », la table des adresses pas encore en base', () => {
  it('lit la trace seule, ne lit aucune adresse, et nomme l’accès parti comme hier', async () => {
    render(
      <TraceDesDroitsDesAcces dossierId="d1" acces={[{ id: 'm1', email: 'client@exemple.fr' }]} listeLue
        accesDuDossier={{ etat: 'lus', comptes: ['u-m1'] }} lectureNo={1} />,
    )
    expect(await screen.findByText(/Accès retiré depuis \(tracé dès le 10\/11\/2026 à 09:30\)/)).toBeTruthy()
    expect(screen.queryByText(/se nomme par l’adresse qu’il portait à son départ/)).toBeNull()
    expect(lectures.adresses).toBe(0)
  })
})
