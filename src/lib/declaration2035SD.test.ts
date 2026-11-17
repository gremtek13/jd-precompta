import { describe, expect, it } from 'vitest'
import {
  avisDuTableauDesImmobilisations, calculer2035SD, modeLineaire, tableauDesImmobilisations, totauxDesLignes,
} from './declaration2035SD'
import type { Entree2035SD } from './declaration2035SD'
import { amortissementCumuleCentimes, dotationDeLExercice, rang360 } from './amortissements'
import { calculerDeclaration2035 } from './declaration2035'
import { arrondirPourFormulaire, valeursDesCases } from './cases2035'
import { cotisationsComptees } from './cotisationRapprochee'
import { paiementsDesPieces } from './rattachement'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import type { Categorie, Immobilisation, Piece } from './types'

// LA DÉCLARATION 2035-SD : CE QU'ELLE REPORTE (docs/conceptions/55-formulaire-2035-sd.md). Rigueur entière sur les reports :
// le tableau des immobilisations est confronté à la case CH que la 2035-B du MÊME jeu d'essai imprime, par le vrai moteur.

const bien = (o: Partial<Immobilisation>): Immobilisation => ({
  id: 'b', dossier_id: 'd1', piece_id: null, nature_id: null, libelle: 'Ordinateur', valeur: 1500,
  date_acquisition: '2025-01-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-01-01T00:00:00Z', ...o,
})

const entree = (o: Partial<Entree2035SD>): Entree2035SD => ({
  annee: 2025, formulaire: new Map(), immobilisations: [], assujettiTva: false, vehiculesSousLeBareme: false, ...o,
})

const categories = [{ id: 'c-achats', poste_2035: 'Achats' }, { id: 'c-recettes', poste_2035: 'Recettes' }] as Categorie[]

// Le formulaire 2035-A/B du jeu d'essai, par le moteur de l'onglet Clôture : CH y est la somme des dotations du registre.
function formulaireDe(immobilisations: Immobilisation[], pieces: Piece[] = [], annee = 2025): Map<string, number> {
  const declaration = calculerDeclaration2035(
    annee, pieces, categories, immobilisations, cotisationsComptees([], [], 'tresorerie'), [], false,
    paiementsDesPieces([], [], [], []), [], [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
  )
  return arrondirPourFormulaire(valeursDesCases(declaration, AUCUNE_SAISIE_2035).valeurs, annee)
}

describe('modeLineaire', () => {
  it('dit le taux linéaire de la durée, au centième, à la française', () => {
    expect(modeLineaire(5)).toBe('L 20 %')
    expect(modeLineaire(3)).toBe('L 33,33 %')
    expect(modeLineaire(7)).toBe('L 14,29 %')
    expect(modeLineaire(10)).toBe('L 10 %')
  })
})

describe('le tableau des immobilisations, confronté à la case CH du même jeu d’essai', () => {
  // Trois biens dont chaque dotation 2025 tombe à un demi-euro près : arrondies seules, elles feraient une colonne qui ne
  // redit pas CH. Mis en service le 1er juillet (prorata), sur trois, quatre et sept ans.
  const biens = [
    bien({ id: 'b1', libelle: 'Ordinateur', valeur: 1005, date_acquisition: '2025-07-01', duree_annees: 3 }),
    bien({ id: 'b2', libelle: 'Bureau', valeur: 2004, date_acquisition: '2025-07-01', duree_annees: 4 }),
    bien({ id: 'b3', libelle: 'Fauteuil', valeur: 707, date_acquisition: '2025-07-01', duree_annees: 7 }),
    bien({ id: 'b4', libelle: 'Échographe', valeur: 12345.67, date_acquisition: '2023-03-15', date_mise_en_service: '2023-04-02', duree_annees: 5 }),
    // Acquis après l'exercice : hors du tableau.
    bien({ id: 'b5', libelle: 'Tablette', valeur: 800, date_acquisition: '2026-02-01', duree_annees: 3 }),
  ]
  const formulaire = formulaireDe(biens)
  const t = tableauDesImmobilisations(entree({ formulaire, immobilisations: biens }))

  it('la dotation nette (A − B) est la case CH que la 2035-B imprime, et la colonne 7 s’additionne en A', () => {
    expect(formulaire.get('CH')).toBeGreaterThan(0)
    expect(t.concorde).toBe(true)
    expect(t.totalGeneral).toBe(formulaire.get('CH'))
    expect(t.dotationNette).toBe(formulaire.get('CH'))
    expect(t.lignes.reduce((s, l) => s + l.annee, 0)).toBe(t.totalGeneral)
    expect(avisDuTableauDesImmobilisations(t)).toEqual([])
    // Le jeu d'essai mord : chaque dotation arrondie seule ferait une colonne qui ne redit pas CH.
    const arrondiesSeules = biens.filter((b) => b.date_acquisition <= '2025-12-31')
      .reduce((s, b) => s + Math.round(dotationDeLExercice(b, 2025)), 0)
    expect(arrondiesSeules).not.toBe(formulaire.get('CH'))
  })

  it('chaque dotation est l’arrondi inférieur ou supérieur de celle du registre, jamais plus loin', () => {
    for (const l of t.lignes) {
      const exacte = dotationDeLExercice(biens.find((b) => b.id === l.id)!, 2025)
      expect(Math.abs(l.annee - exacte), l.nature).toBeLessThan(1)
    }
  })

  it('les antérieurs sont le cumul au 31 décembre d’avant, la base la valeur, à l’euro', () => {
    const echographe = t.lignes.find((l) => l.id === 'b4')!
    expect(echographe.base).toBe(12346)
    expect(echographe.anterieurs).toBe(Math.round(Number(amortissementCumuleCentimes(biens[3], rang360('2024-12-31'))) / 100))
    expect(echographe.miseEnService).toBe('2023-04-02')
    expect(echographe.mode).toBe('L 20 %')
  })

  it('ne retient que les biens acquis au plus tard le 31 décembre, dans l’ordre de leur mise en service', () => {
    expect(t.lignes.map((l) => l.id)).toEqual(['b4', 'b2', 'b3', 'b1'])
  })

  it('un dossier qui n’est pas redevable porte le prix payé en colonne 2 et ne sert pas la colonne 3', () => {
    for (const l of t.lignes) {
      expect(l.prixTtc).toBe(l.base)
      expect(l.tvaDeduite).toBe(0)
    }
  })

  it('un dossier redevable : les colonnes 2 et 3 sont à saisir, et ses totaux aussi, jamais 0', () => {
    const r = tableauDesImmobilisations(entree({ formulaire, immobilisations: biens, assujettiTva: true }))
    expect(r.lignes.every((l) => l.prixTtc === 'a_saisir' && l.tvaDeduite === 'a_saisir')).toBe(true)
    expect(totauxDesLignes(r.lignes)).toMatchObject({ prixTtc: 'a_saisir', tvaDeduite: 'a_saisir' })
    expect(avisDuTableauDesImmobilisations(r).join(' ')).toMatch(/colonnes 2 et 3/)
  })

  it('un véhicule amorti sous le barème : (B) et la dotation nette sont à saisir, A reste la somme', () => {
    const r = tableauDesImmobilisations(entree({ formulaire, immobilisations: biens, vehiculesSousLeBareme: true }))
    expect(r.vehiculesSousLeBareme).toBe('a_saisir')
    expect(r.dotationNette).toBe('a_saisir')
    expect(r.totalGeneral).toBe(formulaire.get('CH'))
  })

  it('un tableau qui ne redit pas CH le dit, et ne force aucune ligne vers CH', () => {
    const autre = new Map(formulaire).set('CH', (formulaire.get('CH') ?? 0) + 40)
    const r = tableauDesImmobilisations(entree({ formulaire: autre, immobilisations: biens }))
    expect(r.concorde).toBe(false)
    expect(r.totalGeneral).toBe(t.lignes.length === 0 ? 0 : r.lignes.reduce((s, l) => s + l.annee, 0))
    expect(Math.abs(r.totalGeneral - (formulaire.get('CH') ?? 0))).toBeLessThanOrEqual(2)
    expect(avisDuTableauDesImmobilisations(r)[0]).toMatch(/ne redit pas la case CH/)
  })
})

describe('la récapitulation', () => {
  it('reporte CP en bénéfice, CR en déficit, depuis les cases que le PDF de la 2035-B imprime', () => {
    const pieces = [{
      id: 'p', statut: 'validee', type_piece: 'vente', date_piece: '2025-03-10', montant_ht: 5000, montant_ttc: 5000,
      categorie_id: 'c-recettes',
    } as Piece]
    const formulaire = formulaireDe([], pieces)
    const d = calculer2035SD(entree({ formulaire }))
    expect(d.benefice).toBe(formulaire.get('CP'))
    expect(d.deficit).toBe(formulaire.get('CR') ?? 0)

    const deficitaire = calculer2035SD(entree({ formulaire: new Map([['CP', 0], ['CR', 1234]]) }))
    expect(deficitaire).toMatchObject({ benefice: 0, deficit: 1234 })
  })

  it('un registre vide : un tableau vide, A et la dotation nette à 0 (rien ne s’imprime), concordant avec CH nulle', () => {
    const t = calculer2035SD(entree({ formulaire: new Map() })).immobilisations
    expect(t).toMatchObject({ lignes: [], totalGeneral: 0, dotationNette: 0, concorde: true })
  })
})
