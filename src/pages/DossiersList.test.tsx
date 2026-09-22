import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
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
const faux = vi.hoisted(() => ({ parTable: {} as Record<string, unknown[]> }))

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
