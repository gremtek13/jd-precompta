import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SuperPdpFactureModal from './SuperPdpFactureModal'
import type { FactureEmise } from '../../lib/types'

// Le verrou d'exécution de la transmission Super PDP (CLAUDE.md, « un verrou d'exécution est un
// `useRef`, jamais un état React »). Le doublon ne crée pas une ligne en trop : il TRANSMET deux
// fois la même facture à une plateforme de dématérialisation agréée DGFiP — irréversible par cette
// voie (voir l'avertissement affiché dans la modale). CLAUDE.md annonçait cette couverture livrée
// le 21/09/2026 ; aucun fichier de test n'existait — c'est ce que ce fichier corrige.
const faux = vi.hoisted(() => ({
  appelsInvoke: [] as unknown[],
  resoudreInvoke: null as null | ((v: unknown) => void),
  appelsCharger: 0,
  resoudreCharger: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => {
            faux.appelsCharger += 1
            // Le premier appel (montage, useEffect) se résout tout de suite pour que le bouton
            // apparaisse ; les suivants (après une transmission) restent EN ATTENTE — c'est la
            // fenêtre réelle où un second clic peut arriver avant que la relecture ne finisse.
            if (faux.appelsCharger === 1) return Promise.resolve({ data: [] })
            return new Promise((resolve) => { faux.resoudreCharger = resolve })
          },
        }),
      }),
    }),
    functions: {
      invoke: (nom: string, options: unknown) => {
        faux.appelsInvoke.push({ nom, options })
        return new Promise((resolve) => { faux.resoudreInvoke = resolve })
      },
    },
  },
}))

const facture: FactureEmise = {
  id: 'f1',
  dossier_id: 'd1',
  numero: 'F-2026-0001',
  statut: 'validee',
  type: 'facture',
  facture_origine_id: null,
  date_emission: '2026-09-01',
  date_echeance: null,
  tiers_nom: 'Client Test',
  tiers_adresse: null,
  tiers_siret: null,
  montant_ht: 100,
  montant_tva: 20,
  montant_ttc: 120,
  mentions_legales: null,
  notes: null,
  emetteur_nom: 'Cabinet Test',
  emetteur_siret: null,
  emetteur_adresse: null,
  superpdp_invoice_id: null,
  superpdp_dernier_statut: null,
  tiers_email: null,
  created_by: null,
  created_at: '2026-09-01T00:00:00Z',
  validated_at: '2026-09-01T00:00:00Z',
}

async function monter() {
  faux.appelsInvoke = []
  faux.resoudreInvoke = null
  faux.appelsCharger = 0
  faux.resoudreCharger = null
  render(
    <SuperPdpFactureModal dossierId="d1" facture={facture} onClose={() => {}} onUpdated={() => {}} />,
  )
  return screen.findByRole('button', { name: 'Envoyer via Super PDP' })
}

describe('SuperPdpFactureModal — le verrou de transmission Super PDP', () => {
  it("ne transmet qu'une fois quand on clique deux fois de suite", async () => {
    const bouton = await monter()

    // LES DEUX CLICS DANS LE MÊME `act` : deux `fireEvent.click`/`.click()` successifs ouvrent
    // chacun leur `act`, qui rend le composant en sortant — le second tomberait sur un bouton déjà
    // re-rendu avec l'état à jour, et le test resterait vert avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appelsInvoke).toHaveLength(1)
  })

  it("un troisième clic ne transmet pas une seconde fois", async () => {
    const bouton = await monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appelsInvoke).toHaveLength(1)
  })

  // Distingue un verrou relâché DÈS la réponse de `invoke` (l'ancien code : les deux lignes de
  // relâchement vivaient juste après ce premier `await`, avant même la relecture des événements) d'un
  // verrou relâché seulement après la relecture ET `onUpdated()` (le correctif, verrou tenu dans un
  // `finally` qui enveloppe tout). Sans cette distinction, un clic pendant la relecture qui suit un
  // envoi réussi transmettrait une seconde fois la même facture — avant même que la première
  // transmission n'ait fini de se refléter à l'écran.
  it("reste désactivé — donc bloque un second clic — pendant la relecture qui suit une transmission réussie", async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    expect(faux.appelsInvoke).toHaveLength(1)

    await act(async () => { faux.resoudreInvoke?.({ data: { ok: true }, error: null }) })
    expect(faux.appelsCharger).toBe(2)

    const boutonPendantRelecture = screen.getByRole('button', { name: /Envoi/ })
    await act(async () => { boutonPendantRelecture.click() })
    expect(faux.appelsInvoke).toHaveLength(1)

    await act(async () => { faux.resoudreCharger?.({ data: [] }) })
  })

  it("affiche le message d'erreur métier et relâche le verrou pour réessayer", async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    await act(async () => { faux.resoudreInvoke?.({ data: { error: 'SIRET manquant' }, error: null }) })
    expect(screen.getByText(/SIRET manquant/)).toBeTruthy()

    const boutonRouvert = await screen.findByRole('button', { name: 'Envoyer via Super PDP' })
    await act(async () => { boutonRouvert.click() })
    expect(faux.appelsInvoke).toHaveLength(2)
  })
})
