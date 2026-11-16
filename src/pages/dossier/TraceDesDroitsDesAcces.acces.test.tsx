import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// L'ACCÈS LUI-MÊME DANS LA TRACE (P1T-Q2), les deux constantes levées en mémoire (l'état d'après le collage) : l'arrivée et le
// départ d'un accès, même sans case, se lisent dans la carte « Droits changés » à la ligne de l'accès, et la carte dit
// qu'elle les trace. La lecture levée seule (l'état servi depuis le 15/11/2026, avant le collage) : les lignes se liraient,
// mais la carte ne dit pas qu'elle trace les accès. Les mots se jugent dans traceDesDroitsVue.test.ts.
const etat = vi.hoisted(() => ({ dit: true }))
vi.mock('../../lib/traceDesDroits', () => ({
  TRACE_DES_DROITS_PREVUE: true, ACCES_DANS_LA_TRACE_PREVU: true, get ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE() { return etat.dit },
}))
vi.mock('../../lib/adressesDesAccesRetires', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/adressesDesAccesRetires')>()), ADRESSES_DES_ACCES_RETIRES_PREVUES: false,
}))
// Qui a ouvert un accès (P1TQ2-Q1) : son drapeau, levé depuis le 16/11/2026, baissé ici — ce fichier éprouve un autre état,
// et l'état d'avant l'attestation reste éprouvé tant que son code existe (TraceDesDroitsDesAcces.ouvertures.test.tsx, le levé).
vi.mock('../../lib/ouverturesAttestees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ouverturesAttestees')>()), OUVERTURES_ATTESTEES_PREVUES: false,
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
  // Le compte du cabinet derrière les gestes (P1TQ2Q1-Q1), tel que la session du chef le lit dans l'équipe.
  lireLesComptesDuCabinet: async (dossierId: string, comptes: readonly string[]) => ({
    dossierId, comptes: comptes.join(','), motif: null, equipe: new Map([['u-cabinet', 'chef@cabinet.example']]),
  }),
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
    // P1TQ2Q1-Q1 : qui a retiré l'accès se nomme par l'adresse de son compte, lue sous la session de qui regarde.
    const retrait = screen.getByText('retiré').closest('tr') as HTMLElement
    expect(retrait.querySelector('[data-libelle="Par"]')?.textContent).toBe('Le cabinet — chef@cabinet.example')
  })

  it('la lecture levée seule, avant le collage : la carte ne dit pas qu’elle trace les accès', async () => {
    etat.dit = false
    try {
      render(
        <TraceDesDroitsDesAcces dossierId="d1" acces={[{ id: 'm1', email: 'client@exemple.fr' }]} listeLue
          accesDuDossier={{ etat: 'lus', comptes: ['u-m1'] }} lectureNo={1} />,
      )
      expect(await screen.findAllByText('L’accès à l’espace client')).toHaveLength(2)
      expect(screen.queryByText(/^Chaque accès ouvert ou retiré, même sans case cochée/)).toBeNull()
      expect(screen.getByText(/^Chaque case cochée ou décochée sur un accès du dossier/)).toBeTruthy()
    } finally {
      etat.dit = true
    }
  })
})
