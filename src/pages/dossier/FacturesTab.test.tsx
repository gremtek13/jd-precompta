import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { MENTIONS_VIDES } from '../../test/factures'
import type { ArticleExoneration, FactureEmise, StatutTva } from '../../lib/types'

// LE DERNIER DES DIX-SEPT ONGLETS À RECEVOIR UN TEST DE RENDU, et celui qui porte le seul document
// légal que le cabinet émet lui-même. Ce que ce test garde et qu'aucun test de `src/lib` ne peut voir,
// parce que tout vit dans le CÂBLAGE :
//
//  1. une facture VALIDÉE n'offre jamais la suppression — elle est figée, et seul un avoir la corrige ;
//     un avoir, lui, n'offre pas d'« Avoir » (on ne corrige pas une correction par une autre) ;
//  2. la suppression d'un brouillon DIT son échec, au lieu de laisser la ligne réapparaître en silence
//     sur un geste que l'opérateur vient de confirmer ;
//  3. une lecture refusée n'affirme pas « Aucune facture » — sur la suite de numéros qu'un cabinet doit
//     pouvoir présenter sans trou, le vide serait une affirmation fausse.
const faux = vi.hoisted(() => ({
  factures: [] as FactureEmise[],
  // La lecture refusée par la base : `lireTout` la rend incomplète, sans aucune ligne.
  refusLecture: null as string | null,
  // La suppression refusée : supabase-js ne lève pas, l'échec se lit dans `{ error }`.
  refusSuppression: null as string | null,
  suppressions: [] as unknown[],
  // Le compte que la base annonce, quand il ne vaut pas le nombre de factures : une lecture qui s'arrête avant lui est
  // INCOMPLÈTE (lib/lectureComplete.ts).
  compteAnnonce: null as number | null,
  // Les lignes que la fenêtre de l'avoir lit sur la facture d'origine.
  lignes: [{ designation: 'Séance', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let suppression = false
      let idVise: unknown = null
      let plage: [number, number] | null = null
      Object.assign(chaine, {
        select: () => chaine,
        order: () => chaine,
        range: (debut: number, fin: number) => { plage = [debut, fin]; return chaine },
        delete: () => { suppression = true; return chaine },
        eq: (colonne: string, valeur: unknown) => { if (colonne === 'id') idVise = valeur; return chaine },
        then: (suite: (r: { data: unknown[] | null; error: unknown; count: number | null }) => unknown) => {
          if (suppression) {
            faux.suppressions.push(idVise)
            if (faux.refusSuppression) {
              return Promise.resolve({ data: null, error: { message: faux.refusSuppression }, count: null }).then(suite)
            }
            // La suppression MORD sur le faux : la relecture qui suit voit la ligne partie.
            faux.factures = faux.factures.filter((f) => f.id !== idVise)
            return Promise.resolve({ data: null, error: null, count: null }).then(suite)
          }
          if (table === 'facture_lignes') return Promise.resolve({ data: faux.lignes, error: null, count: null }).then(suite)
          if (faux.refusLecture) {
            return Promise.resolve({ data: null, error: { message: faux.refusLecture }, count: null }).then(suite)
          }
          const tranche = plage ? faux.factures.slice(plage[0], plage[1] + 1) : faux.factures
          return Promise.resolve({ data: tranche, error: null, count: faux.compteAnnonce ?? faux.factures.length }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// Typé sans `as` : le compilateur confronte chaque champ à la table.
function facture(o: Partial<FactureEmise> = {}): FactureEmise {
  return {
    id: 'f1', dossier_id: 'dossier-de-test', numero: 'F2026-0001', statut: 'validee', type: 'facture',
    facture_origine_id: null, date_emission: '2026-03-10', date_echeance: null,
    tiers_nom: 'CLINIQUE DU PARC', tiers_adresse: null, tiers_siret: null,
    montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, mentions_legales: null, notes: null,
    emetteur_nom: 'Cabinet de test', emetteur_siret: '12345678901234', emetteur_adresse: null,
    superpdp_invoice_id: null, superpdp_dernier_statut: null, tiers_email: null,
    created_by: null, created_at: '2026-03-10T09:00:00Z', validated_at: '2026-03-10T09:05:00Z', ...MENTIONS_VIDES, ...o,
  }
}

function poser(factures: FactureEmise[]) {
  faux.factures = factures
  faux.compteAnnonce = null
  faux.refusLecture = null
  faux.refusSuppression = null
  faux.suppressions = []
}

function monter(statutTva: StatutTva | null = 'redevable', articleExoneration: ArticleExoneration | null = null) {
  return render(
    <FacturesTab
      dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234"
      dossierAdresse={null} statutTva={statutTva} articleExoneration={articleExoneration} onAdresseUpdated={() => {}}
    />,
  )
}

// La ligne d'une facture, désignée par son client — le numéro d'origine d'un avoir porte aussi un
// numéro de facture, donc chercher le numéro seul trouverait deux lignes.
async function ligne(client: string) {
  return (await screen.findByText(client)).closest('tr') as HTMLElement
}

afterEach(() => { vi.restoreAllMocks() })

describe('FacturesTab — ce que chaque ligne permet', () => {
  it('une facture validée ne se supprime pas : elle se corrige par un avoir', async () => {
    poser([facture()])
    monter()

    const l = within(await ligne('CLINIQUE DU PARC'))
    l.getByText('Validée')
    expect(l.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    for (const action of ['Aperçu', 'Avoir', 'Super PDP', 'Envoyer par e-mail']) l.getByRole('button', { name: action })
  })

  it('un brouillon se supprime, mais ne se transmet ni ne se corrige par un avoir', async () => {
    // Le garde symétrique du précédent : sans lui, « la validée n'offre pas la suppression » serait
    // satisfait par un écran qui n'offre la suppression à PERSONNE.
    poser([facture({ id: 'b1', numero: null, statut: 'brouillon', tiers_nom: 'CABINET VOISIN', validated_at: null })])
    monter()

    const l = within(await ligne('CABINET VOISIN'))
    l.getByText('Brouillon')
    l.getByRole('button', { name: 'Supprimer' })
    for (const action of ['Aperçu', 'Avoir', 'Super PDP', 'Envoyer par e-mail']) {
      expect(l.queryByRole('button', { name: action })).toBeNull()
    }
  })

  it("un avoir désigne la facture qu'il corrige, et n'offre pas d'avoir à son tour", async () => {
    poser([
      facture(),
      facture({
        id: 'a1', numero: 'A2026-0001', type: 'avoir', facture_origine_id: 'f1', tiers_nom: 'CLINIQUE DU PARC — AVOIR',
        montant_ht: -1000, montant_tva: -200, montant_ttc: -1200,
      }),
    ])
    monter()

    const l = within(await ligne('CLINIQUE DU PARC — AVOIR'))
    l.getByText('Avoir')
    l.getByText('→ F2026-0001')
    expect(l.queryByRole('button', { name: 'Avoir' })).toBeNull()
    l.getByRole('button', { name: 'Aperçu' })
  })
})

// CE QUE LES AUTRES AVOIRS ONT DÉJÀ CRÉDITÉ (ligne 28.5, étape c). La fenêtre de l'avoir le dit avant le clic, et la
// base refuse un avoir qui créditerait plus que ce qui reste. La somme se fait sur la liste ENTIÈRE du dossier : un
// avoir daté de l'année suivante crédite la facture de cette année, et le filtre d'année ne doit pas le faire oublier.
describe('FacturesTab — l’avoir connaît ce que la facture a déjà reçu', () => {
  const avoir = facture({
    id: 'a1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1', date_emission: '2027-01-15',
    tiers_nom: 'CLINIQUE DU PARC — AVOIR', montant_ht: -333.33, montant_tva: -66.67, montant_ttc: -400,
  })

  it('compte les avoirs de toutes les années, même hors du filtre affiché', async () => {
    poser([facture(), avoir])
    monter()
    await ligne('CLINIQUE DU PARC — AVOIR')
    fireEvent.click(screen.getByRole('tab', { name: '2026' }))
    expect(screen.queryByText('CLINIQUE DU PARC — AVOIR')).toBeNull()

    fireEvent.click(within(await ligne('CLINIQUE DU PARC')).getByRole('button', { name: 'Avoir' }))
    expect(await screen.findByText(/D'autres avoirs ont déjà crédité 400,00\s€ de cette facture : il en reste\s+800,00/)).toBeTruthy()
  })

  // Lue en partie, la liste ne dit pas ce qui a été crédité : la fenêtre le dit, et laisse la base juger.
  it('ne prétend rien savoir quand la liste n’a pas été lue en entier', async () => {
    poser([facture(), avoir])
    faux.compteAnnonce = 3
    monter()
    fireEvent.click(within(await ligne('CLINIQUE DU PARC')).getByRole('button', { name: 'Avoir' }))
    expect(await screen.findByText(/n'a pas été lue en entier/)).toBeTruthy()
    expect(screen.queryByText(/D'autres avoirs ont déjà crédité/)).toBeNull()
  })
})

describe("FacturesTab — la suppression d'un brouillon", () => {
  const brouillon = () => facture({ id: 'b1', numero: null, statut: 'brouillon', tiers_nom: 'CABINET VOISIN', validated_at: null })

  it('retire le brouillon quand on confirme', async () => {
    poser([brouillon()])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual(['b1'])
    await screen.findByText('Aucune facture.')
  })

  it("dit un refus de la base, et la ligne reste — au lieu de réapparaître sans un mot", async () => {
    poser([brouillon()])
    faux.refusSuppression = 'permission denied for table factures_emises'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    await screen.findByText(/permission denied for table factures_emises/)
    expect(screen.getByText('CABINET VOISIN')).toBeTruthy()
  })

  it('ne supprime rien quand la confirmation est refusée', async () => {
    poser([brouillon()])
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    monter()

    const bouton = within(await ligne('CABINET VOISIN')).getByRole('button', { name: 'Supprimer' })
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual([])
  })
})

describe('FacturesTab — une lecture refusée', () => {
  it("le dit, au lieu d'affirmer qu'il n'y a aucune facture", async () => {
    poser([facture()])
    faux.refusLecture = 'JWT expired'
    monter()

    await screen.findByText('La liste des factures n’a pas pu être lue.')
    expect(screen.queryByText('Aucune facture.')).toBeNull()
    expect(screen.getByText(/JWT expired/)).toBeTruthy()
  })

  it("affirme en revanche « Aucune facture » sur un dossier qui n'en a vraiment aucune", async () => {
    // Le garde symétrique : sans lui, « on ne dit pas aucune facture sur une panne » serait satisfait
    // par un écran qui crie à la panne sur tout dossier neuf.
    poser([])
    monter()

    await screen.findByText('Aucune facture.')
    expect(screen.queryByText('La liste des factures n’a pas pu être lue.')).toBeNull()
  })
})

describe('FacturesTab — la recherche', () => {
  it("filtre les lignes, et compte sur l'exercice affiché plutôt que sur les lignes trouvées", async () => {
    poser([
      facture(),
      facture({ id: 'f2', numero: 'F2026-0002', tiers_nom: 'CENTRE DE SANTÉ' }),
      facture({ id: 'f3', numero: 'F2025-0009', tiers_nom: 'CLINIQUE ANCIENNE', date_emission: '2025-11-02' }),
    ])
    monter()
    await ligne('CLINIQUE DU PARC')

    // L'exercice 2026 retenu, puis une recherche qui n'en garde qu'une : « 1 sur 2 », et non « 1 sur 3 ».
    await act(async () => { screen.getByRole('tab', { name: '2026' }).click() })
    fireEvent.change(screen.getByRole('searchbox', { name: /Rechercher un numéro/ }), { target: { value: 'sante' } })

    expect(screen.getByText('CENTRE DE SANTÉ')).toBeTruthy()
    expect(screen.queryByText('CLINIQUE DU PARC')).toBeNull()
    screen.getByText('1 sur 2')
  })
})

// LA FACTURE NEUVE SUIT LE STATUT DE TVA DU DOSSIER (lib/statutTva.ts, ligne 28.5) : l'onglet le passe au formulaire,
// qui en tire la mention proposée et le taux d'une ligne neuve. Un statut qui ne lui parviendrait pas ferait proposer
// à un dossier de soins exonérés une facture sans sa mention d'exonération.
describe('FacturesTab — la facture neuve reçoit le statut de TVA du dossier', () => {
  it('un dossier de soins exonérés propose sa mention ; un redevable une ligne à 20 %', async () => {
    poser([])
    const { unmount } = monter('exonere', 'cgi_261_4_1')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
    expect((document.querySelector('#mentions') as HTMLTextAreaElement).value).toContain('Exonération de TVA, art. 261, 4, 1° du CGI.')
    unmount()

    poser([])
    monter('redevable')
    fireEvent.click(await screen.findByRole('button', { name: '+ Nouvelle facture' }))
    const taux = document.querySelectorAll('tbody tr')[0].querySelectorAll('input')[3] as HTMLInputElement
    expect(taux.value).toBe('20')
  })
})
