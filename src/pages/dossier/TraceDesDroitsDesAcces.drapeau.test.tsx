import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TraceDesDroitsDesAcces from './TraceDesDroitsDesAcces'

// L'ÉTAT D'AVANT LA TABLE (`TRACE_DES_DROITS_PREVUE` baissé) : sans la migration dans l'export, la table n'est pas lue et rien
// ne s'affiche — lire une table absente ferait échouer la lecture, et l'onglet dirait « lue en partie » d'une trace qui n'existe
// pas. Le drapeau est levé depuis le 07/11/2026 : AccesTab.trace.test.tsx joue l'état réel, ce fichier garde l'état d'avant
// éprouvé tant que son code existe.
const lectures = vi.hoisted(() => ({ nombre: 0 }))
vi.mock('../../lib/traceDesDroits', () => ({ TRACE_DES_DROITS_PREVUE: false }))
vi.mock('../../lib/traceDesDroitsLecture', () => ({
  lireLaTraceDuDossier: async (dossierId: string) => { lectures.nombre += 1; return { dossierId, lignes: [], motif: null } },
}))

describe('« Droits changés », la table pas encore en base', () => {
  it('ne lit rien et ne montre rien', async () => {
    const { container } = render(
      <TraceDesDroitsDesAcces dossierId="d1" acces={[{ id: 'm1', email: 'client@exemple.fr' }]} listeLue
        accesDuDossier={{ etat: 'lus', comptes: ['u-m1'] }} lectureNo={1} />,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.innerHTML).toBe('')
    expect(lectures.nombre).toBe(0)
  })
})
