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
  // Mise à true, la lecture des lignes de la facture d'origine ÉCHOUE — ce qui n'est pas la même
  // chose que « cette facture n'a pas de lignes », et c'est tout l'objet du second bloc de tests.
  lectureLignesRefusee: false,
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
                  Promise.resolve(faux.lectureLignesRefusee
                    ? { data: null, error: { message: 'JWT expired' } }
                    : { data: [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }], error: null },
                  ).then(resolve),
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
  faux.lectureLignesRefusee = false
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

// UNE LECTURE REFUSÉE N'EST PAS « RIEN À CRÉDITER » (22/09/2026).
//
// L'erreur de cette lecture était jetée : `lignes` restait vide, et cet écran n'ayant aucun bouton
// « + Ligne », le tableau s'affichait vide SOUS un paragraphe qui annonce « les lignes ci-dessous
// sont pré-remplies pour un avoir total ». « Valider l'avoir » répondait alors « Au moins une ligne
// avec une quantité doit rester à créditer » — un reproche à l'opérateur pour une panne de lecture.
//
// Ce que ça coûtait est étroit et réel, et c'est la rectification d'une phrase que j'avais écrite
// AVANT de l'exécuter : la garde `lignesValides.length === 0` tient, donc aucun numéro de la série
// « A » n'est consommé et aucun avoir vide n'est créé. Ce qui est perdu est la seule façon légale de
// corriger une facture validée, sur un motif faux, sans que rien ne dise de réessayer.
//
// Aucun test de `src/lib` ne peut le voir : il n'y a pas de calcul ici, seulement un écran qui
// affirme ou n'affirme pas.
describe('FactureAvoirModal — une lecture refusée ne passe pas pour « rien à créditer »', () => {
  it('dit qu’on n’a pas lu, et ne propose pas de valider', async () => {
    faux.appelsRpc = []
    faux.lectureLignesRefusee = true
    render(
      <FactureAvoirModal dossierId="d1" factureOrigine={factureOrigine} onClose={() => {}} onCreated={() => {}} />,
    )
    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/on ne l'a pas lue/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Valider l'avoir" })).toBeNull()
    expect(faux.appelsRpc).toHaveLength(0)
  })

  // LE GARDE SYMÉTRIQUE, sans lequel « l'écran refuse de valider » serait satisfait par un écran qui
  // ne valide JAMAIS — et les trois tests du verrou ci-dessus passeraient encore, puisqu'ils
  // comptent des appels RPC et non des boutons.
  it('mais laisse valider quand la lecture a réussi', async () => {
    const bouton = await monter()
    expect(bouton).toBeTruthy()
    expect(screen.queryByText(/on ne l'a pas lue/)).toBeNull()
  })
})
