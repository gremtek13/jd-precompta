import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FactureAvoirModal from './FactureAvoirModal'
import { MENTIONS_VIDES } from '../../test/factures'
import type { FactureEmise } from '../../lib/types'

// L'AVOIR S'ENREGISTRE D'UN SEUL TENANT PAR LA BASE (ligne 28.5, étape c ; migration mentions_de_la_facture).
//
// L'écran le faisait en trois allers-retours — un numéro de la série « A » consommé par
// `attribuer_numero_facture`, l'avoir inséré validé, puis ses lignes —, si bien qu'un échec au milieu
// laissait un numéro perdu ou un avoir sans lignes. Il passe désormais par `enregistrer_facture`, qui
// fait les trois dans une transaction et reprend de la facture d'origine ses parties : ce test vérifie
// qu'il n'écrit plus RIEN directement (le faux client refuse toute table autre que la lecture des
// lignes), et ce qu'il envoie.
//
// Le verrou d'exécution reste (CLAUDE.md, « un verrou d'exécution est un `useRef`, jamais un état
// React ») : un doublon serait un second avoir sur la même facture, et la base ne le refuse que s'il
// dépasse ce qui reste à créditer.
const faux = vi.hoisted(() => ({
  appelsRpc: [] as { nom: string; params: Record<string, unknown> }[],
  // La promesse du premier appel reste EN ATTENTE : c'est la fenêtre réelle pendant laquelle un clic
  // surnuméraire arrive. La résoudre tout de suite supprimerait la fenêtre que le verrou ferme.
  resoudreRpc: null as null | ((v: unknown) => void),
  // Mise à true, la lecture des lignes de la facture d'origine ÉCHOUE — ce qui n'est pas la même
  // chose que « cette facture n'a pas de lignes », et c'est tout l'objet du dernier bloc de tests.
  lectureLignesRefusee: false,
  lignes: [] as { designation: string; quantite: number; prix_unitaire_ht: number; taux_tva: number }[],
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
                    : { data: faux.lignes, error: null },
                  ).then(resolve),
              }),
            }),
          }),
        }
      }
      // Volontairement bruyant : l'avoir ne s'écrit plus que par la fonction de la base.
      throw new Error(`Table non attendue dans ce test : ${table}`)
    },
    rpc: (nom: string, params: Record<string, unknown>) => {
      faux.appelsRpc.push({ nom, params })
      return new Promise((resolve) => { faux.resoudreRpc = resolve })
    },
  },
}))

const factureOrigine: FactureEmise = {
  id: 'f1',
  dossier_id: 'd1',
  numero: 'F2026-0001',
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
  mentions_legales: 'Mentions de la facture',
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
  ...MENTIONS_VIDES,
}

const UNE_LIGNE = [{ designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]

async function monter(
  { credite = 0, lignes = UNE_LIGNE, origine = factureOrigine }:
    { credite?: number | null; lignes?: typeof UNE_LIGNE; origine?: FactureEmise } = {},
) {
  faux.appelsRpc = []
  faux.resoudreRpc = null
  faux.lectureLignesRefusee = false
  faux.lignes = lignes
  render(
    <FactureAvoirModal dossierId="d1" factureOrigine={origine} credite={credite} onClose={() => {}} onCreated={() => {}} />,
  )
  // Les lignes se chargent de façon asynchrone (useEffect) avant que le bouton ne devienne utile —
  // affichées dans des `<input>`, donc `findByDisplayValue` et non `findByText`.
  await screen.findByDisplayValue(lignes[0].designation)
  return screen.getByRole('button', { name: "Valider l'avoir" }) as HTMLButtonElement
}

describe('FactureAvoirModal — l’avoir passe par la base, d’un seul tenant', () => {
  it('envoie l’avoir validé, ses montants et ses lignes négatifs, et rien d’autre', async () => {
    const bouton = await monter()
    fireEvent.change(document.querySelector('#avoir-date')!, { target: { value: '2026-10-07' } })
    fireEvent.change(document.querySelector('#avoir-motif')!, { target: { value: '  Remise accordée ' } })
    await act(async () => { bouton.click() })

    expect(faux.appelsRpc).toHaveLength(1)
    expect(faux.appelsRpc[0]).toEqual({
      nom: 'enregistrer_facture',
      params: {
        p_dossier_id: 'd1',
        p_facture_id: null,
        p_facture: {
          type: 'avoir', facture_origine_id: 'f1', date_emission: '2026-10-07',
          notes: 'Remise accordée', mentions_legales: 'Mentions de la facture',
          montant_ht: -100, montant_tva: -20, montant_ttc: -120,
        },
        p_lignes: [{ designation: 'Consultation', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20 }],
        p_valider: true,
      },
    })
  })

  // L'EN-TÊTE EST LE TOTAL DES LIGNES QUI PARTENT. Il comptait toutes les lignes affichées, dont celle
  // dont on a effacé la désignation : l'avoir aurait crédité 220 € en en-tête pour 120 € de lignes. Une
  // ligne écartée en mettant sa quantité à zéro ne le montrerait pas — elle ne pèse rien dans un total.
  it('ne compte pas dans ses totaux une ligne qu’il ne crédite pas, et le dit', async () => {
    const bouton = await monter({
      lignes: [
        { designation: 'Consultation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
        { designation: 'Déplacement', quantite: 1, prix_unitaire_ht: 100, taux_tva: 0 },
      ],
      origine: { ...factureOrigine, montant_ht: 200, montant_tva: 20, montant_ttc: 220 },
    })
    expect(screen.queryByText(/n’est pas créditée/)).toBeNull()
    fireEvent.change(document.querySelectorAll('tbody tr')[1].querySelector('input')!, { target: { value: '' } })
    expect(screen.getByText(/Une ligne n’est pas créditée/)).toBeTruthy()
    // Le total AFFICHÉ aussi : l'opérateur valide ce qu'il lit.
    const totalAffiche = screen.getByText('Total TTC crédité').parentElement!.querySelector('strong')!.textContent
    expect(totalAffiche).toMatch(/^120,00\s€$/)

    await act(async () => { bouton.click() })
    const params = faux.appelsRpc[0].params as { p_facture: Record<string, unknown>; p_lignes: unknown[] }
    expect(params.p_facture).toMatchObject({ montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    expect(params.p_lignes).toEqual([{ designation: 'Consultation', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20 }])
  })
})

describe('FactureAvoirModal — ce que la base refuserait se dit avant le clic', () => {
  it('une facture déjà créditée en entier refuse l’avoir, sans rien envoyer', async () => {
    const bouton = await monter({ credite: 120 })
    expect(screen.getByText(/D'autres avoirs ont déjà crédité 120,00/)).toBeTruthy()
    expect(screen.getByText(/Cet avoir créditerait 120,00\s€ : la facture F2026-0001 n'a plus que 0,00\s€ à créditer\./)).toBeTruthy()
    expect(bouton.disabled).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.appelsRpc).toHaveLength(0)
  })

  it('une facture créditée en partie laisse créditer ce qui reste, et pas plus', async () => {
    const bouton = await monter({ credite: 40 })
    expect(screen.getByText(/il en reste\s+80,00/)).toBeTruthy()
    expect(bouton.disabled).toBe(true)

    // 100 € HT à 20 % font 120 € ; 66,67 € HT en font 80 € — exactement ce qui reste.
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '66.67' } })
    expect(screen.queryByText(/Cet avoir créditerait/)).toBeNull()
    expect(bouton.disabled).toBe(false)
    await act(async () => { bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)
  })

  it('un avoir daté avant sa facture est refusé', async () => {
    const bouton = await monter()
    fireEvent.change(document.querySelector('#avoir-date')!, { target: { value: '2026-08-31' } })
    expect(screen.getByText("Un avoir ne précède pas la facture qu'il corrige (émise le 01/09/2026).")).toBeTruthy()
    expect(bouton.disabled).toBe(true)
  })

  it('sans ligne créditée, l’avoir est refusé', async () => {
    const bouton = await monter()
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '0' } })
    expect(screen.getByText('Au moins une ligne avec une quantité doit rester à créditer.')).toBeTruthy()
    expect(bouton.disabled).toBe(true)
  })

  // LISTE LUE EN PARTIE : on ne sait pas ce que les autres avoirs ont crédité. L'écran le dit et laisse
  // la base juger — un plafond calculé sur une liste incomplète refuserait ou laisserait passer à tort.
  it('quand ce qui a été crédité n’est pas connu, il le dit et laisse la base juger', async () => {
    const bouton = await monter({ credite: null })
    expect(screen.getByText(/n'a pas été lue en entier/)).toBeTruthy()
    expect(bouton.disabled).toBe(false)
    await act(async () => { bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)
  })

  // LE GARDE SYMÉTRIQUE : sans lui, « l'écran refuse » serait satisfait par un écran qui refuse toujours.
  it('une facture que rien n’a créditée se crédite sans mise en garde', async () => {
    const bouton = await monter()
    expect(screen.queryByText(/D'autres avoirs/)).toBeNull()
    expect(screen.queryByText(/lue en entier/)).toBeNull()
    expect(bouton.disabled).toBe(false)
  })
})

describe('FactureAvoirModal — le verrou de création d’un avoir', () => {
  it("n'envoie qu'un seul avoir quand on clique deux fois de suite", async () => {
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
  // repartirait pour un second avoir (CLAUDE.md, motif déjà vu sur FichePiece.save et consorts).
  it('un troisième clic n’envoie pas de second avoir', async () => {
    const bouton = await monter()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)
  })

  it('relâche le verrou sur un échec, pour laisser réessayer', async () => {
    const bouton = await monter()
    await act(async () => { bouton.click() })
    expect(faux.appelsRpc).toHaveLength(1)

    // La base refuse : `enregistrerFacture` lève, `valider` l'attrape et son `finally` doit relâcher
    // le verrou — sinon la modale resterait bloquée jusqu'à sa réouverture.
    await act(async () => { faux.resoudreRpc?.({ data: null, error: { message: 'Facture d’origine introuvable dans ce dossier.' } }) })
    expect(screen.getByText(/Facture d’origine introuvable/)).toBeTruthy()

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
// Aucun test de `src/lib` ne peut le voir : il n'y a pas de calcul ici, seulement un écran qui
// affirme ou n'affirme pas.
describe('FactureAvoirModal — une lecture refusée ne passe pas pour « rien à créditer »', () => {
  it('dit qu’on n’a pas lu, et ne propose pas de valider', async () => {
    faux.appelsRpc = []
    faux.lectureLignesRefusee = true
    render(
      <FactureAvoirModal dossierId="d1" factureOrigine={factureOrigine} credite={0} onClose={() => {}} onCreated={() => {}} />,
    )
    expect(await screen.findByText(/JWT expired/)).toBeTruthy()
    expect(screen.getByText(/on ne l'a pas lue/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Valider l'avoir" })).toBeNull()
    expect(faux.appelsRpc).toHaveLength(0)
  })

  // LE GARDE SYMÉTRIQUE, sans lequel « l'écran refuse de valider » serait satisfait par un écran qui
  // ne valide JAMAIS — et les trois tests du verrou ci-dessus passeraient encore, puisqu'ils
  // comptent des appels et non des boutons.
  it('mais laisse valider quand la lecture a réussi', async () => {
    const bouton = await monter()
    expect(bouton).toBeTruthy()
    expect(screen.queryByText(/on ne l'a pas lue/)).toBeNull()
  })
})
