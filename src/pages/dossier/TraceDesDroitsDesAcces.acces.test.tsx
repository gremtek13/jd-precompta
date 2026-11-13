import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// L'ACCÈS LUI-MÊME DANS LA TRACE (P1T-Q2), le drapeau levé en mémoire : l'arrivée et le départ d'un accès, même sans case, se
// lisent dans la carte « Droits changés » à la ligne de l'accès, et la carte dit qu'elle les trace. Baissé — l'état servi —,
// AccesTab.trace.test.tsx et les trois autres fichiers de cette carte jouent l'écran d'hier ; les mots se jugent dans
// traceDesDroitsVue.test.ts.
vi.mock('../../lib/traceDesDroits', () => ({ TRACE_DES_DROITS_PREVUE: true, ACCES_DANS_LA_TRACE_PREVU: true }))
vi.mock('../../lib/adressesDesAccesRetires', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: false,
}))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => ({
    dossierId, motif: null,
    lignes: [
      { id: 't2', accesId: 'm1', clientId: 'u-m1', droit: 'acces', coche: false, geste: 'retrait', auteurId: 'u-cabinet', instant: '2026-11-12T10:00:00Z' },
      { id: 't1', accesId: 'm1', clientId: 'u-m1', droit: 'acces', coche: true, geste: 'creation', auteurId: 'u-cabinet', instant: '2026-11-10T08:30:00Z' },
    ],
  }),
  lireLesAdressesDesAccesRetires: async () => { throw new Error('non lue sous son drapeau baissé') },
}))

describe('« Droits changés », l’accès lui-même tracé', () => {
  it('l’accès ouvert puis retiré, sans case, se lit à sa ligne, et la carte dit qu’elle trace les accès', async () => {
    render(
      <TraceDesDroitsDesAcces dossierId="d1" acces={[{ id: 'm1', email: 'client@exemple.fr' }]} listeLue
        accesDuDossier={{ etat: 'lus', comptes: ['u-m1'] }} lectureNo={1} />,
    )
    expect(await screen.findAllByText('L’accès à l’espace client')).toHaveLength(2)
    expect(screen.getByText('ouvert')).toBeTruthy()
    expect(screen.getByText('retiré')).toBeTruthy()
    expect(screen.getByText(/^Chaque accès ouvert ou retiré, même sans case cochée/)).toBeTruthy()
  })
})
