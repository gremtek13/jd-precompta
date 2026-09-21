import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FactureAvoirModal from './FactureAvoirModal'
import type { FactureEmise } from '../../lib/types'

// Le verrou d'exécution de la création d'un avoir (CLAUDE.md, « un verrou d'exécution est un
// `useRef`, jamais un état React »). Le doublon ne crée pas seulement une ligne en trop : il
// CONSOMME deux fois un numéro de la série "A" (upsert +1 côté RPC `attribuer_numero_facture`),
// qui n'admet ni trou ni doublon dans une suite légale. Aucun calcul pur ne peut voir ce défaut —
// `attribuerNumeroFacture` est parfaitement correcte, c'est le nombre d'appels qui serait faux.
const faux = vi.hoisted(() => ({
  appelsRpc: [] as unknown[],
  // La promesse du premier appel RPC reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle
  // un clic surnuméraire arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudreRpc: null as null | ((v: unknown) => void),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'facture_lignes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                then: (resolve: (v: unknown) => void) =>
                  Promise.resolve({
                    data: [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
                  }).then(resolve),
              }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
        }
      }
      if (table === 'factures_emises') {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: 'avoir-1' }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    rpc: (nom: string, params: unknown) => {
      faux.appelsRpc.push({ nom, params })
      return new Promise((resolve) => { faux.resoudreRpc = resolve })
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  },
}))

const factureOrigine: FactureEmise = {
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
  faux.appelsRpc = []
  faux.resoudreRpc = null
  render(
    <FactureAvoirModal dossierId="d1" factureOrigine={factureOrigine} onClose={() => {}} onCreated={() => {}} />,
  )
  // Les lignes se chargent de façon asynchrone (useEffect) avant que le bouton ne devienne utile —
  // affichées dans des `<input>`, donc `findByDisplayValue` et non `findByText`.
  await screen.findByDisplayValue('Consultation')
  return screen.getByRole('button', { name: "Valider l'avoir" })
}

describe('FactureAvoirModal — le verrou de création d’un avoir', () => {
  it("n'attribue qu'un seul numéro quand on clique deux fois de suite", async () => {
    const bouton = await monter()

    // LES DEUX CLICS DANS LE MÊME `act` : deux `fireEvent.click`/`.click()` successifs ouvrent
    // chacun leur `act`, qui rend le composant en sortant — le second tomberait sur un bouton déjà
    // re-rendu avec `saving` à jour, et le test resterait vert avec le défaut réinstallé (CLAUDE.md).
    await act(async () => { bouton.click(); bouton.click() })

    expect(faux.appelsRpc).toHaveLength(1)
  })

  // IL FAUT TROIS CLICS pour distinguer un verrou posé avant le `try` d'un verrou posé dedans : si
  // la vérification/pose du verrou vivait DANS le `try`, le `return` du deuxième clic sortirait par
  // le `finally`, qui relâcherait le verrou du PREMIER — encore en cours — et le troisième clic
  // repartirait pour un second numéro (CLAUDE.md, motif déjà vu sur PieceFormModal.save et consorts).
  it("un troisième clic ne consomme pas de second numéro", async () => {
    const bouton = await monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)

    // Le RPC répond une erreur : `attribuerNumeroFacture` lève, `creerAvoir` l'attrape et son
    // `finally` doit relâcher le verrou — sinon la modale resterait bloquée jusqu'à sa réouverture.
    await act(async () => { faux.resoudreRpc?.({ data: null, error: { message: 'Échec RPC' } }) })
    expect(screen.getByText(/Échec RPC/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: "Valider l'avoir" }).click() })
    expect(faux.appelsRpc).toHaveLength(2)
  })
})
