import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from '../components/Layout'
import DossierDetail from './DossierDetail'

// La vraie page d'un dossier, montée dans la vraie coque. Deux choses que rien d'autre ne voit :
//
// — le CÂBLAGE de l'assistant : le bouton de l'en-tête existe, et il ouvre l'assistant de CE dossier
//   dans le panneau de droite (le comportement de l'assistant lui-même est gardé par
//   AssistantDossier.test.tsx) ;
// — l'IDENTITÉ du dossier. Cette page ne se remonte pas quand la barre latérale mène d'un dossier à
//   l'autre, et plusieurs onglets RECOPIENT l'identité au montage (le formulaire d'Informations) :
//   montés avec celle de l'ancien dossier, ou avec une identité vide, ils la garderaient, et le
//   premier « Enregistrer » l'écrirait sur le dossier affiché.

interface LigneDossier {
  id: string; nom: string; siret: string | null; assujetti_tva: boolean
  tva_periodicite: 'mensuelle' | 'trimestrielle'; tva_sur_debits: boolean
  mode_comptable: 'tresorerie' | 'engagement'; compte_notes_de_frais: '455000' | '108000' | '467000'
}

const faux = vi.hoisted(() => ({
  dossiers: {} as Record<string, LigneDossier>,
  // Lecture retenue jusqu'à ce que le test la relâche : c'est ce qui décide quelle réponse arrive
  // la première.
  retenuesIdentite: {} as Record<string, Promise<void>>,
  erreurIdentite: null as { message: string; code?: string } | null,
  // Les dates des pièces de chaque dossier, d'où la page tire ses exercices ; leur lecture peut elle
  // aussi être retenue.
  datesPieces: {} as Record<string, string[]>,
  retenuesAnnees: {} as Record<string, Promise<void>>,
  erreurAnnees: null as string | null,
  // La mise à jour d'un dossier (la bascule TVA de l'en-tête), retenue puis refusée à la demande.
  retenueMaj: null as Promise<void> | null,
  erreurMaj: null as { message: string } | null,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let unique = false
      let maj = false
      let id = ''
      let dossierId = ''
      const chaine: Record<string, unknown> = {}
      Object.assign(chaine, {
        select: () => chaine,
        update: () => { maj = true; return chaine },
        eq: (colonne: string, valeur: string) => {
          if (colonne === 'id') id = valeur
          if (colonne === 'dossier_id') dossierId = valeur
          return chaine
        },
        not: () => chaine,
        order: () => chaine,
        range: () => chaine,
        single: () => { unique = true; return chaine },
        then: (suite: (r: unknown) => unknown) => {
          if (table === 'dossiers' && maj) {
            return (faux.retenueMaj ?? Promise.resolve()).then(() => ({ data: null, error: faux.erreurMaj })).then(suite)
          }
          if (table === 'dossiers' && unique) {
            const identifiant = id
            return (faux.retenuesIdentite[identifiant] ?? Promise.resolve()).then(() => (
              faux.erreurIdentite
                ? { data: null, error: faux.erreurIdentite }
                : { data: faux.dossiers[identifiant] ?? null, error: null }
            )).then(suite)
          }
          if (table === 'dossiers') {
            const liste = Object.values(faux.dossiers).map((d) => ({ id: d.id, nom: d.nom }))
            return Promise.resolve({ data: liste, error: null, count: liste.length }).then(suite)
          }
          // Les trois lectures d'années : les dates des pièces du dossier, rien côté relevés et
          // écritures.
          if (table === 'pieces') {
            const pieces = (faux.datesPieces[dossierId] ?? []).map((date, i) => ({ id: `p${i}`, date_piece: date }))
            return (faux.retenuesAnnees[dossierId] ?? Promise.resolve())
              .then(() => (faux.erreurAnnees
                ? { data: null, error: { message: faux.erreurAnnees }, count: null }
                : { data: pieces, error: null, count: pieces.length }))
              .then(suite)
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
        },
      })
      return chaine
    },
  },
}))

// Les onglets sont doublés : ils ont leurs propres tests, et les monter ici ferait dépendre ce test-ci
// de toutes leurs lectures. Le double d'Informations fait ce que fait le vrai : il RECOPIE le SIRET
// reçu au montage, et ne le relit plus ensuite.
// La vue d'ensemble reçoit elle aussi le statut TVA : elle compte les recettes affectées d'un dossier
// assujetti (lib/affectationBanque.ts) et les pièces au montant retenu (lib/montantRetenu.ts).
vi.mock('./dossier/ChecklistTab', () => ({
  default: ({ assujettiTva }: { assujettiTva: boolean }) => (
    <>
      <p>Vue d’ensemble du dossier</p>
      <p>Vue d’ensemble — TVA {assujettiTva ? 'assujetti' : 'exonéré'}</p>
    </>
  ),
}))
vi.mock('./dossier/PiecesTab', () => ({ default: () => <p>Liste des justificatifs</p> }))
vi.mock('./dossier/InformationsTab', async () => {
  const { useState } = await import('react')
  return {
    default: function InformationsDouble({ dossierSiret }: { dossierSiret: string | null }) {
      const [siret] = useState(dossierSiret ?? '')
      return <p>Formulaire d’identité — SIRET {siret || '(vide)'}</p>
    },
  }
})
// Les quatre onglets dont un montant dépend du statut TVA du dossier (voir lib/montantRetenu.ts) :
// doublés pour lire le statut qu'ils RECOIVENT, c'est-à-dire le câblage de la page.
// Trois d'entre eux reçoivent aussi le modèle comptable (lib/engagement.ts) : le double le montre.
const doubleTva = vi.hoisted(() => (onglet: string) => ({
  default: ({ assujettiTva, modeComptable }: { assujettiTva: boolean; modeComptable?: string }) => (
    <>
      <p>{onglet} — TVA {assujettiTva ? 'assujetti' : 'exonéré'}</p>
      {modeComptable && <p>{onglet} — modèle {modeComptable}</p>}
    </>
  ),
}))
// L'onglet Écritures règle le modèle comptable du dossier : doublé pour montrer celui qu'il REÇOIT et
// rendre un changement à la page, qui doit le faire voir dans son badge.
vi.mock('./dossier/EcrituresTab', () => ({
  default: ({ modele, onModeleUpdated }: {
    modele: { mode: string; compteNotesDeFrais: string }
    onModeleUpdated: (m: { mode_comptable?: 'tresorerie' | 'engagement' }) => void
  }) => (
    <>
      <p>Écritures — {modele.mode} — {modele.compteNotesDeFrais}</p>
      <button onClick={() => onModeleUpdated({ mode_comptable: 'engagement' })}>Passer en engagement</button>
    </>
  ),
}))
vi.mock('./dossier/ClotureTab', () => doubleTva('Clôture'))
vi.mock('./dossier/EstimationTab', () => doubleTva('Estimation'))
vi.mock('./dossier/FinancementTab', () => doubleTva('Financement'))
vi.mock('./dossier/ImmobilisationsTab', () => doubleTva('Immobilisations'))
// Cotisations écrit une échéance payée dans le modèle du dossier (lib/cotisationRapprochee.ts) : sa
// CSG-CRDS au 108000 en trésorerie, au 646000 avec le reste en engagement. Doublé pour montrer le modèle
// qu'il REÇOIT — il ne lit pas le statut TVA, que le double affiche sans conséquence.
vi.mock('./dossier/CotisationsTab', () => doubleTva('Cotisations'))
// Banque refuse, avant le clic, d'affecter une recette sans facture à un dossier assujetti (sa TVA ne
// se lit pas sur un relevé) : un statut qui ne lui parviendrait pas laisserait passer l'affectation, que
// seule la base refuserait alors.
vi.mock('./dossier/BanqueTab', () => doubleTva('Banque'))
// L'onglet TVA lit le régime du dossier (périodicité, option pour les débits) et peut le changer :
// doublé pour montrer ce qu'il REÇOIT et rendre un changement à la page, qui doit le faire voir.
vi.mock('./dossier/TvaTab', () => ({
  default: ({ assujettiTva, periodicite, surDebits, onRegimeUpdated }: {
    assujettiTva: boolean
    periodicite: string
    surDebits: boolean
    onRegimeUpdated: (m: { tva_periodicite?: 'mensuelle' | 'trimestrielle' }) => void
  }) => (
    <>
      <p>TVA — {assujettiTva ? 'assujetti' : 'exonéré'} — {periodicite} — {surDebits ? 'débits' : 'encaissements'}</p>
      <button onClick={() => onRegimeUpdated({ tva_periodicite: 'trimestrielle' })}>Passer au trimestre</button>
    </>
  ),
}))
vi.mock('./dossier/AssistantTab', () => ({
  default: ({ dossierId, dossierNom }: { dossierId: string; dossierNom: string | null }) => (
    <p>Assistant de {dossierNom} ({dossierId})</p>
  ),
}))
// pdf.js touche au navigateur DÈS L'IMPORT (DOMMatrix), et la page importe tous les onglets : les deux
// modules qui le chargent sont doublés, comme dans les tests de Banque et de Clôture.
vi.mock('../lib/pdfText', () => ({
  extractPdfLignes: () => { throw new Error('la lecture d’un relevé ne doit pas être atteinte par ce test') },
}))
vi.mock('../lib/remplir2035', () => ({
  remplir2035: () => { throw new Error('la génération ne doit pas être atteinte par ce test') },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { email: 'chef@cabinet-de-test.fr' } },
    role: 'cabinet', isSuperAdmin: false, estChef: true, mesSocietes: [], dossierActifId: null,
    setDossierActifId: () => {}, signOut: async () => {},
  }),
}))
vi.mock('../lib/branding', () => ({ useCabinetBranding: () => null }))
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: () => {} }) }))

async function afficher(chemin: string) {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          {/* Les deux routes de l'application (voir App.tsx) : la barre latérale mène à /dossiers/:id,
              que la page complète aussitôt par son onglet — sans quitter la page. */}
          <Route element={<Layout />}>
            <Route path="/dossiers/:id" element={<DossierDetail />} />
            <Route path="/dossiers/:id/:tab" element={<DossierDetail />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  })
}

function retenue(): { promesse: Promise<void>; relacher: () => void } {
  let relacher: () => void = () => {}
  const promesse = new Promise<void>((resolve) => { relacher = resolve })
  return { promesse, relacher }
}

// Passer à un autre dossier comme l'opérateur le fait : par la barre latérale, sans quitter la page.
async function allerAuDossier(nom: string) {
  await act(async () => {
    fireEvent.click(within(screen.getByRole('region', { name: 'Dossiers' })).getByRole('link', { name: nom }))
  })
}

const titre = () => screen.queryByRole('heading', { level: 1 })?.textContent ?? null

beforeEach(() => {
  // La barre latérale retient ses groupes dépliés et sa réduction dans ce navigateur : chaque test
  // repart de ses réglages par défaut.
  localStorage.clear()
  faux.dossiers = {
    d1: {
      id: 'd1', nom: 'Cabinet Hélène', siret: '11111111111111', assujetti_tva: false, tva_periodicite: 'trimestrielle',
      tva_sur_debits: false, mode_comptable: 'tresorerie', compte_notes_de_frais: '455000',
    },
    d2: {
      id: 'd2', nom: 'Bravo Santé', siret: '22222222222222', assujetti_tva: true, tva_periodicite: 'mensuelle',
      tva_sur_debits: true, mode_comptable: 'engagement', compte_notes_de_frais: '108000',
    },
  }
  faux.retenuesIdentite = {}
  faux.erreurIdentite = null
  // Deux exercices chacun — le sélecteur d'exercice ne s'affiche qu'à partir de deux —, et pas les
  // mêmes : c'est ce qui permet de voir d'où vient l'exercice proposé.
  faux.datesPieces = { d1: ['2025-03-01', '2026-02-01'], d2: ['2023-05-01', '2024-06-01'] }
  faux.retenuesAnnees = {}
  faux.erreurAnnees = null
  faux.retenueMaj = null
  faux.erreurMaj = null
})

describe('Page d’un dossier — l’assistant dans le panneau de droite', () => {
  it('le bouton « Assistant » de l’en-tête ouvre l’assistant de CE dossier dans le volet de la coque', async () => {
    await afficher('/dossiers/d1/checklist')
    const volet = screen.getByRole('complementary', { name: 'Panneau contextuel' })
    expect(volet.childElementCount).toBe(0)

    // L'en-tête du dossier, retrouvé par son titre : le volet porte lui aussi un <header>.
    const entete = screen.getByRole('heading', { level: 1, name: 'Cabinet Hélène' }).closest('header')!
    await act(async () => { fireEvent.click(within(entete).getByRole('button', { name: 'Assistant' })) })
    expect(within(volet).getByText('Assistant de Cabinet Hélène (d1)')).toBeTruthy()
  })
})

describe('Page d’un dossier — l’identité est toujours celle du dossier de l’URL', () => {
  it('pendant la lecture du nouveau dossier, ni l’en-tête ni les onglets ne portent l’ancien', async () => {
    await afficher('/dossiers/d1/checklist')
    expect(titre()).toBe('Cabinet Hélène')

    const b = retenue()
    faux.retenuesIdentite.d2 = b.promesse
    await allerAuDossier('Bravo Santé')
    expect(titre()).toBeNull()
    expect(screen.queryByText('Vue d’ensemble du dossier')).toBeNull()

    await act(async () => { b.relacher() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Bravo Santé' })).toBeTruthy()
    expect(screen.getByText('Vue d’ensemble du dossier')).toBeTruthy()
  })

  it('une lecture de l’ancien dossier arrivée APRÈS celle du nouveau ne le remplace pas', async () => {
    const a = retenue()
    faux.retenuesIdentite.d1 = a.promesse
    await afficher('/dossiers/d1/checklist')
    await allerAuDossier('Bravo Santé')
    expect(await screen.findByRole('heading', { level: 1, name: 'Bravo Santé' })).toBeTruthy()

    await act(async () => { a.relacher() })
    // La réponse de l'ancien dossier a eu le temps d'arriver : le titre n'a pas bougé.
    await act(async () => { await a.promesse })
    expect(titre()).toBe('Bravo Santé')
  })

  it('les années arrivées avant l’identité ne font pas monter un formulaire au SIRET vide', async () => {
    const identite = retenue()
    faux.retenuesIdentite.d1 = identite.promesse
    await afficher('/dossiers/d1/informations')
    expect(screen.queryByText(/Formulaire d’identité/)).toBeNull()

    await act(async () => { identite.relacher() })
    expect(screen.getByText('Formulaire d’identité — SIRET 11111111111111')).toBeTruthy()
  })

  it('sur un onglet à exercice, l’identité qui tarde ne fait pas tomber la page', async () => {
    // Les années arrivent AVANT l'identité : l'en-tête se rend alors pendant l'attente, hors du
    // fournisseur d'exercice — s'il y portait déjà le sélecteur, celui-ci lèverait et la page entière
    // disparaîtrait.
    const identite = retenue()
    faux.retenuesIdentite.d1 = identite.promesse
    await afficher('/dossiers/d1/pieces')
    expect(screen.getByLabelText('Chargement')).toBeTruthy()
    expect(screen.queryByRole('tablist', { name: 'Exercice' })).toBeNull()

    await act(async () => { identite.relacher() })
    expect(screen.getByRole('heading', { level: 1, name: 'Cabinet Hélène' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Exercice' })).toBeTruthy()
    expect(screen.getByText('Liste des justificatifs')).toBeTruthy()
  })

  it('l’exercice proposé sur le dossier suivant vient de SES années, pas de celles du précédent', async () => {
    await afficher('/dossiers/d1/pieces')
    expect(screen.getByRole('heading', { level: 1, name: 'Cabinet Hélène' })).toBeTruthy()

    // L'identité du suivant arrive tout de suite, ses années plus tard : monté à ce moment-là, son
    // fournisseur d'exercice partirait des années du PRÉCÉDENT, et il ne relit jamais son défaut.
    const annees = retenue()
    faux.retenuesAnnees.d2 = annees.promesse
    await allerAuDossier('Bravo Santé')
    await act(async () => { annees.relacher() })
    // La barre latérale ouvre un dossier sur sa vue d'ensemble : on retourne à ses justificatifs,
    // sans quitter le dossier — donc sans remonter son fournisseur d'exercice.
    expect(await screen.findByRole('heading', { level: 1, name: 'Bravo Santé' })).toBeTruthy()
    const arbre = screen.getByRole('region', { name: 'Dossier ouvert' })
    await act(async () => { fireEvent.click(within(arbre).getByRole('link', { name: 'Justificatifs' })) })

    const exercice = await screen.findByRole('tablist', { name: 'Exercice' })
    expect(within(exercice).getByRole('tab', { selected: true }).textContent).toBe('2024')
  })

  it('l’erreur de lecture d’un dossier ne s’affiche pas sous le suivant', async () => {
    faux.erreurIdentite = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }
    await afficher('/dossiers/d1/checklist')
    expect(screen.getByText(/Ce dossier n’a pas pu être lu/)).toBeTruthy()

    const b = retenue()
    faux.retenuesIdentite.d2 = b.promesse
    await allerAuDossier('Bravo Santé')
    expect(screen.queryByText(/Ce dossier n’a pas pu être lu/)).toBeNull()

    faux.erreurIdentite = null
    await act(async () => { b.relacher() })
    expect(await screen.findByRole('heading', { level: 1, name: 'Bravo Santé' })).toBeTruthy()
  })

  it('un dossier illisible le dit aussi sur un onglet à exercice', async () => {
    faux.erreurIdentite = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }
    await afficher('/dossiers/d1/pieces')
    expect(screen.getByText(/Ce dossier n’a pas pu être lu/)).toBeTruthy()
    expect(screen.queryByText('Liste des justificatifs')).toBeNull()
  })

  it('la bascule TVA d’un dossier, refusée APRÈS qu’on l’a quitté, ne s’annule pas sur le suivant', async () => {
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    try {
      await afficher('/dossiers/d1/checklist')
      const maj = retenue()
      faux.retenueMaj = maj.promesse
      faux.erreurMaj = { message: 'refus simulé' }
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'TVA : exonéré' })) })
      expect(screen.getByRole('button', { name: 'TVA : assujetti' })).toBeTruthy()

      await allerAuDossier('Bravo Santé')
      expect(await screen.findByRole('heading', { level: 1, name: 'Bravo Santé' })).toBeTruthy()
      await act(async () => { maj.relacher() })
      // Le refus est bien arrivé : sans lui, le test ne prouverait rien.
      expect(alerte).toHaveBeenCalledWith('refus simulé')
      // Bravo Santé est assujetti : l'annulation visait Cabinet Hélène, pas lui.
      expect(screen.getByRole('button', { name: 'TVA : assujetti' })).toBeTruthy()
    } finally {
      alerte.mockRestore()
    }
  })

  it('un dossier illisible le dit et n’affiche pas ses écrans ; « Réessayer » relit', async () => {
    faux.erreurIdentite = { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }
    await afficher('/dossiers/d1/informations')
    expect(screen.getByText(/Ce dossier n’a pas pu être lu \(ce dossier est introuvable, ou ce compte n’y a pas accès\)/)).toBeTruthy()
    expect(screen.queryByText(/Formulaire d’identité/)).toBeNull()

    faux.erreurIdentite = null
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Réessayer' })) })
    expect(screen.getByText('Formulaire d’identité — SIRET 11111111111111')).toBeTruthy()
  })
})

// LES EXERCICES DU SÉLECTEUR, LUS EN PARTIE, LE DISENT. Le commentaire au-dessus de ces trois
// lectures décrivait le dégât depuis le début — un exercice qui disparaît du sélecteur, et tout ce
// que le cabinet regarde ensuite filtré par lui — pendant que leur drapeau partait à la poubelle :
// écrites en `Promise.all([…]).then(…)`, elles échappaient au scanner qui garde cette règle.
describe('Page d’un dossier — les exercices du sélecteur', () => {
  it('lus en partie, ils le disent : un exercice peut manquer au sélecteur', async () => {
    faux.erreurAnnees = 'refus simulé'
    await afficher('/dossiers/d1/checklist')
    expect(screen.getByText(/Les dates des justificatifs, relevés et écritures n'ont pas pu être lues en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
  })

  it('lus en entier, ils se taisent', async () => {
    await afficher('/dossiers/d1/checklist')
    expect(screen.getByRole('heading', { level: 1, name: 'Cabinet Hélène' })).toBeTruthy()
    expect(screen.queryAllByText(/n'ont pas pu être lues en entier/)).toHaveLength(0)
  })
})

// UN MONTANT DÉPEND DU STATUT TVA DU DOSSIER : TVA comprise pour un dossier exonéré, hors taxes pour
// un assujetti (voir lib/montantRetenu.ts). La page le lit une fois, avec l'identité, et le passe aux
// onglets qui en ont besoin ; un statut resté codé en dur dans l'un d'eux déclarerait les dépenses
// d'une infirmière exonérée hors taxes, sur la 2035 qu'elle signe. Banque et la vue d'ensemble s'y
// ajoutent avec l'affectation d'un mouvement (ligne 26.6) : l'une refuse d'affecter une recette sans
// facture à un dossier assujetti, l'autre compte celles qui le sont quand même.
describe('Page d’un dossier — le statut TVA atteint les onglets dont un montant dépend', () => {
  it.each([
    ['cloture', 'Clôture'], ['estimation', 'Estimation'], ['financement', 'Financement'], ['immobilisations', 'Immobilisations'],
    ['banque', 'Banque'], ['checklist', 'Vue d’ensemble'],
  ])('l’onglet %s reçoit le statut du dossier affiché', async (onglet, libelle) => {
    await afficher(`/dossiers/d1/${onglet}`)
    expect(screen.getByText(`${libelle} — TVA exonéré`)).toBeTruthy()
    cleanup()

    await afficher(`/dossiers/d2/${onglet}`)
    expect(screen.getByText(`${libelle} — TVA assujetti`)).toBeTruthy()
  })

  it('la bascule du badge se voit aussitôt dans l’onglet ouvert', async () => {
    await afficher('/dossiers/d1/cloture')
    expect(screen.getByText('Clôture — TVA exonéré')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'TVA : exonéré' })) })
    expect(screen.getByText('Clôture — TVA assujetti')).toBeTruthy()
  })
})

// L'ONGLET TVA PRÉPARE LA DÉCLARATION SELON LE RÉGIME DU DOSSIER : une périodicité ou une option
// venues d'un autre dossier — ou codées en dur — prépareraient la CA3 d'une autre période, avec une
// autre règle de date, sans que rien ne le dise.
describe('Page d’un dossier — l’onglet TVA reçoit le régime du dossier affiché', () => {
  it('passe le statut, la périodicité et l’option de CE dossier', async () => {
    await afficher('/dossiers/d1/tva')
    expect(screen.getByText('TVA — exonéré — trimestrielle — encaissements')).toBeTruthy()
    cleanup()

    await afficher('/dossiers/d2/tva')
    expect(screen.getByText('TVA — assujetti — mensuelle — débits')).toBeTruthy()
  })

  it('un régime changé dans l’onglet se voit aussitôt', async () => {
    await afficher('/dossiers/d2/tva')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Passer au trimestre' })) })
    expect(screen.getByText('TVA — assujetti — trimestrielle — débits')).toBeTruthy()
  })
})

// LE MODÈLE COMPTABLE DU DOSSIER (lib/engagement.ts) décide de toutes ses écritures : la page le lit
// avec l'identité, le montre dans l'en-tête, et le passe aux onglets qui en dépendent — un modèle
// venu d'un autre dossier, ou supposé, ferait lire en trésorerie le brouillon d'une société à l'IS.
describe('Page d’un dossier — le modèle comptable', () => {
  it('le badge de l’en-tête dit le modèle du dossier affiché, et mène à l’onglet Écritures', async () => {
    await afficher('/dossiers/d1/checklist')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Comptabilité : trésorerie' })) })
    expect(screen.getByText('Écritures — tresorerie — 455000')).toBeTruthy()
    cleanup()

    await afficher('/dossiers/d2/ecritures')
    expect(screen.getByRole('button', { name: 'Comptabilité : engagement' })).toBeTruthy()
    expect(screen.getByText('Écritures — engagement — 108000')).toBeTruthy()
  })

  it.each([['cloture', 'Clôture'], ['estimation', 'Estimation'], ['financement', 'Financement'], ['cotisations', 'Cotisations']])(
    'l’onglet %s reçoit le modèle du dossier affiché',
    async (onglet, libelle) => {
      await afficher(`/dossiers/d1/${onglet}`)
      expect(screen.getByText(`${libelle} — modèle tresorerie`)).toBeTruthy()
      cleanup()

      await afficher(`/dossiers/d2/${onglet}`)
      expect(screen.getByText(`${libelle} — modèle engagement`)).toBeTruthy()
    },
  )

  it('un modèle changé dans l’onglet Écritures se voit aussitôt dans l’en-tête', async () => {
    await afficher('/dossiers/d1/ecritures')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Passer en engagement' })) })
    expect(screen.getByRole('button', { name: 'Comptabilité : engagement' })).toBeTruthy()
    expect(screen.getByText('Écritures — engagement — 455000')).toBeTruthy()
  })
})
