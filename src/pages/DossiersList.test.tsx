import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { anneeEtMoisEcoules } from '../lib/format'
import DossiersList from './DossiersList'

// « Une recherche filtre l'affichage, jamais un total » — la règle que cet écran violait, et dans le
// sens le plus dangereux du dépôt : elle ne fabriquait pas une alerte, elle en EFFAÇAIT une.
//
// `nbAvecAlerte` était calculé sur les dossiers retenus par la recherche, puis servi à trois chiffres
// qui décrivent le CABINET et sont rendus AU-DESSUS de la liste : la tuile « À régler », la tuile
// « À jour » (valant `dossiers.length - nbAvecAlerte`, donc un MÉLANGE des deux ensembles) et le
// sous-titre des priorités. Taper un nom faisait monter « À jour » jusqu'au total des dossiers.
//
// CE TEST GARDE CE QU'UN SCANNER DE SOURCE NE PEUT PAS VOIR. `recherchesEtTotaux.test.ts` interdit
// les formes fautives (`X.reduce`, `X.filter(…).length`, `total={X.length}`) ; il ne peut rien dire
// d'un `valeur={filtered.length - nbAvecAlerte}`, où `filtered.length` est par ailleurs parfaitement
// légitime. Seul le rendu le montre : on tape, et le tableau de bord ne bouge pas.
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]>, signaux: 0 }))

// La barre latérale tient sa propre liste des dossiers (voir lib/listeDossiers.ts) ; ce qui compte
// ici est que la création la PRÉVIENNE — on compte les signaux au lieu de monter la barre.
vi.mock('../lib/listeDossiers', () => ({ signalerMajDossiers: () => { faux.signaux++ } }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      // Le faux client honore `range` et annonce un `count` : sans quoi `lireTout` déclarerait toute
      // lecture INCOMPLÈTE et l'écran afficherait son bandeau au lieu de ses tuiles.
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      Object.assign(chaine, {
        select: () => chaine,
        eq: () => chaine,
        gte: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        // La création d'un dossier : seule son erreur est lue, et elle vaut null.
        insert: () => chaine,
        then: (suite: (r: { data: unknown[]; error: null; count: number }) => unknown) => {
          const toutes = faux.parTable[table] ?? []
          return Promise.resolve({
            data: toutes.slice(debut, fin + 1), error: null, count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
  },
}))

const ANNEE = new Date().getFullYear()
// Le même appel que l'écran, et non une constante : « à jour » veut dire « un relevé par mois
// écoulé », donc un nombre qui dépend du jour où le test tourne.
const MOIS_ECOULES = anneeEtMoisEcoules().moisEcoules

function dossier(id: string, nom: string) {
  return {
    id, nom, cabinet_id: 'cabinet-de-test', siret: null, contact_nom: null, contact_email: null,
    notes: null, archive: false, created_at: `${ANNEE}-01-02T00:00:00Z`, code_email: id,
    assujetti_tva: false, code_naf: null, libelle_naf: null, adresse: null,
  }
}

// Un relevé par mois écoulé : c'est ce qui fait qu'un dossier n'est PAS en alerte.
function relevesComplets(dossierId: string) {
  return Array.from({ length: MOIS_ECOULES }, (_, i) => ({
    dossier_id: dossierId, date: `${ANNEE}-${String(i + 1).padStart(2, '0')}-05`,
  }))
}

async function afficher() {
  faux.parTable.dossiers = [
    dossier('alpha', 'Alpha Santé'),
    dossier('bravo', 'Bravo Cabinet'),
    dossier('charlie', 'Charlie Soins'),
  ]
  // Une seule pièce à valider, sur Alpha : c'est le seul dossier en alerte des trois.
  faux.parTable.pieces = [
    { dossier_id: 'alpha', nom_fichier: 'facture.pdf', created_at: `${ANNEE}-09-01T08:00:00Z`, statut: 'a_valider' },
  ]
  faux.parTable.lignes_bancaires = [...relevesComplets('bravo'), ...relevesComplets('charlie')]
  faux.parTable.cotisations_declarees = [
    { dossier_id: 'bravo', echeance: `${ANNEE}-02-05` },
    { dossier_id: 'charlie', echeance: `${ANNEE}-02-05` },
  ]
  await act(async () => { render(<MemoryRouter><DossiersList /></MemoryRouter>) })
}

function valeurTuile(libelle: string): string {
  const tuile = [...document.querySelectorAll('.kpi')].find(
    (t) => t.querySelector('.kpi-libelle')?.textContent?.trim() === libelle,
  )
  if (!tuile) throw new Error(`Tuile « ${libelle} » introuvable — l’écran ne s’est pas affiché.`)
  return tuile.querySelector('.kpi-valeur')?.textContent?.trim() ?? ''
}

// `.cellule-identite-nom` n'appartient qu'aux lignes du tableau des dossiers : le widget des
// priorités porte les mêmes noms sous une autre classe, et les confondre ferait croire la liste
// inchangée alors qu'elle s'est vidée.
function nomsDeLaListe(): string[] {
  return [...document.querySelectorAll('.cellule-identite-nom')].map((n) => n.textContent ?? '')
}

describe('DossiersList — la recherche filtre la liste, jamais le tableau de bord', () => {
  it('les chiffres du cabinet ne bougent pas quand on cherche un dossier', async () => {
    await afficher()

    expect(nomsDeLaListe()).toEqual(['Alpha Santé', 'Bravo Cabinet', 'Charlie Soins'])
    expect(valeurTuile('Dossiers suivis')).toBe('3')
    expect(valeurTuile('À régler')).toBe('1')
    expect(valeurTuile('À jour')).toBe('2')
    expect(screen.getByText(/1 dossier\(s\) avec un point ouvert/)).toBeTruthy()

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Rechercher un dossier/), { target: { value: 'Bravo' } })
    })

    // La liste se réduit : c'est tout ce qu'une recherche doit faire.
    expect(nomsDeLaListe()).toEqual(['Bravo Cabinet'])

    // Et rien d'autre ne bouge. Avant correction : « À régler » tombait à 0 avec la mention « aucun
    // point ouvert », « À jour » montait à 3, et le widget des priorités continuait d'afficher Alpha
    // sous un sous-titre annonçant « 0 dossier(s) avec un point ouvert ».
    expect(valeurTuile('Dossiers suivis')).toBe('3')
    expect(valeurTuile('À régler')).toBe('1')
    expect(valeurTuile('À jour')).toBe('2')
    expect(screen.getByText(/1 dossier\(s\) avec un point ouvert/)).toBeTruthy()
  })

  it('et une recherche sans résultat ne déclare pas le cabinet à jour', async () => {
    // Le cas extrême, et celui qui rendait le défaut dangereux : à zéro dossier trouvé, les deux
    // tuiles annonçaient « aucun point ouvert » et « 3 à jour » — une bonne nouvelle fabriquée par
    // le texte tapé, que personne ne va vérifier.
    await afficher()

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Rechercher un dossier/), { target: { value: 'zzz' } })
    })

    expect(nomsDeLaListe()).toEqual([])
    expect(screen.getByText('Aucun dossier ne correspond.')).toBeTruthy()
    expect(valeurTuile('À régler')).toBe('1')
    expect(valeurTuile('À jour')).toBe('2')
  })
})

// L'ANNÉE DES EN-TÊTES VOYAGE AVEC LES CHIFFRES QU'ELLE ÉTIQUETTE. Les lectures de cet écran sont
// filtrées sur l'année (elles portent sur tout le cabinet), donc les chiffres d'une liste restée
// ouverte au Nouvel An sont ceux de l'année finie. L'en-tête, lui, était recalculé à chaque rendu :
// la première recherche tapée le faisait passer à la nouvelle année au-dessus de « 11/11 mois ».
// Le jeu d'essai ne porte aucun relevé : seuls les en-têtes sont regardés, et ils ne dépendent que
// de l'année. On ne feint que `Date` — feindre aussi les minuteurs gèlerait ceux dont
// `findByText` dépend, et chaque test partirait en expiration.
describe('DossiersList — l’année affichée est celle des chiffres, pas celle de l’horloge', () => {
  const VEILLE_DU_NOUVEL_AN = new Date(2026, 11, 31, 18, 0)
  const LENDEMAIN = new Date(2027, 0, 2, 9, 0)

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(VEILLE_DU_NOUVEL_AN)
    faux.parTable = { dossiers: [dossier('alpha', 'Alpha Santé'), dossier('bravo', 'Bravo Cabinet')] }
  })
  afterEach(() => { vi.useRealTimers() })

  async function monter() {
    let rendu!: ReturnType<typeof render>
    await act(async () => { rendu = render(<MemoryRouter><DossiersList /></MemoryRouter>) })
    return rendu
  }

  it('passer le Nouvel An écran ouvert ne réétiquette pas les chiffres de l’année finie', async () => {
    await monter()
    expect(screen.getByText('Relevés 2026')).toBeTruthy()

    vi.setSystemTime(LENDEMAIN)
    // Un rendu SANS rechargement : c'est exactement ce que produit une recherche tapée.
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Rechercher un dossier/), { target: { value: 'Bravo' } })
    })

    // Avant correction : « Relevés 2027 » et « Cotisations 2027 », au-dessus des chiffres de 2026.
    expect(screen.getByText('Relevés 2026')).toBeTruthy()
    expect(screen.getByText('Cotisations 2026')).toBeTruthy()
    expect(screen.queryAllByText(/2027/)).toHaveLength(0)
  })

  it('une liste RECHARGÉE après le Nouvel An change d’année avec ses chiffres', async () => {
    // Créer un dossier relance `load()` sur la liste ouverte, sans la remonter. Sans ce cas, « l'en-
    // tête ne bouge pas » serait satisfait par un en-tête figé au montage — qui, après ce
    // rechargement, étiquetterait 2026 des chiffres désormais lus sur 2027 : le même défaut, inversé.
    await monter()
    vi.setSystemTime(LENDEMAIN)

    await act(async () => { screen.getByRole('button', { name: '+ Nouveau dossier' }).click() })
    const champ = screen.getByLabelText('Nom du client')
    await act(async () => { fireEvent.change(champ, { target: { value: 'Charlie Soins' } }) })
    await act(async () => { fireEvent.submit(champ.closest('form')!) })

    expect(await screen.findByText('Relevés 2027')).toBeTruthy()
    expect(screen.queryAllByText(/Relevés 2026/)).toHaveLength(0)
  })

  it('et une liste affichée de nouveau repart sur la nouvelle année', async () => {
    // Garde symétrique : sans lui, « l'en-tête garde l'année de ses chiffres » serait satisfait par un
    // écran qui fige l'année pour toute la session — le défaut d'origine de « maintenant figé ».
    const premier = await monter()
    premier.unmount()
    vi.setSystemTime(LENDEMAIN)
    await monter()

    expect(await screen.findByText('Relevés 2027')).toBeTruthy()
  })
})

// Ce qui relie le tableau de bord à la barre latérale, et qu'aucun test de la barre seule ne peut
// voir : « Nouveau dossier » y arrive par l'URL, et la création doit prévenir la barre, qui ne
// « revient » pas au tableau de bord pour se relire puisqu'on y est déjà.
describe('DossiersList — le formulaire de création et la barre latérale', () => {
  beforeEach(() => {
    faux.parTable = { dossiers: [dossier('alpha', 'Alpha Santé')] }
    faux.signaux = 0
  })

  it('`?nouveau=1` ouvre le formulaire : c’est ce qu’envoie « Nouveau dossier » depuis la barre', async () => {
    await act(async () => {
      render(<MemoryRouter initialEntries={['/dossiers?nouveau=1']}><DossiersList /></MemoryRouter>)
    })
    expect(screen.getByLabelText('Nom du client')).toBeTruthy()
  })

  // Garde symétrique : sans lui, « le paramètre ouvre le formulaire » serait satisfait par un
  // formulaire toujours ouvert.
  it('sans le paramètre, le formulaire reste fermé', async () => {
    await act(async () => { render(<MemoryRouter initialEntries={['/dossiers']}><DossiersList /></MemoryRouter>) })
    expect(screen.queryByLabelText('Nom du client')).toBeNull()
  })

  it('créer un dossier prévient la barre latérale, puis referme le formulaire', async () => {
    await act(async () => { render(<MemoryRouter initialEntries={['/dossiers']}><DossiersList /></MemoryRouter>) })
    await act(async () => { screen.getByRole('button', { name: '+ Nouveau dossier' }).click() })
    const champ = screen.getByLabelText('Nom du client')
    await act(async () => { fireEvent.change(champ, { target: { value: 'Charlie Soins' } }) })
    await act(async () => { fireEvent.submit(champ.closest('form')!) })

    expect(faux.signaux).toBe(1)
    expect(screen.queryByLabelText('Nom du client')).toBeNull()
  })
})
