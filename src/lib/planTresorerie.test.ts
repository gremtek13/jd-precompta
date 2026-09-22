import { describe, expect, it } from 'vitest'
import { calculerPlanTresorerie, echeancesCotisations, echeancesEmprunts, reserveSurMoyenne, type LigneBanquePourPlan } from './planTresorerie'
import { ajouterMois, premierJourDuMoisCourant } from './format'
import type { Emprunt } from './emprunts'
import type { CotisationDeclaree } from './types'
import type { PlanTresorerie } from './planTresorerie'

const moisCourant = () => premierJourDuMoisCourant()
const cleMois = (decalage: number) => ajouterMois(moisCourant(), decalage).slice(0, 7)

describe('calculerPlanTresorerie', () => {
  it('démarre la projection au mois suivant, pas au mois en cours', () => {
    // Le mois en cours est exclu par construction (il n'est pas terminé). L'ancien calcul
    // l'étiquetait pourtant en première ligne : `toISOString()` sur un 1er du mois à minuit
    // heure de Paris rendait le mois précédent.
    const plan = calculerPlanTresorerie([], 10000, 6, 3)
    expect(plan.lignes.map((l) => l.mois)).toEqual([cleMois(1), cleMois(2), cleMois(3)])
  })

  it('exclut le mois en cours de la moyenne et inclut la borne basse', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: moisCourant(), sens: 'debit', montant: 999 },                  // mois en cours → exclu
      { date: ajouterMois(moisCourant(), -6), sens: 'debit', montant: 600 }, // borne basse → inclus
      { date: ajouterMois(moisCourant(), -7), sens: 'debit', montant: 777 }, // trop ancien → exclu
    ]
    expect(calculerPlanTresorerie(lignes, 0, 6, 1).moyenneEncaissements).toBe(100)
  })

  it('enchaîne les soldes d’un mois sur l’autre', () => {
    const lignes: LigneBanquePourPlan[] = [
      { date: ajouterMois(moisCourant(), -1), sens: 'debit', montant: 1200 },
      { date: ajouterMois(moisCourant(), -1), sens: 'credit', montant: 600 },
    ]
    const plan = calculerPlanTresorerie(lignes, 5000, 6, 2)
    expect(plan.moyenneEncaissements).toBe(200)
    expect(plan.moyenneDecaissements).toBe(100)
    expect(plan.lignes[0]).toMatchObject({ soldeDebut: 5000, soldeFin: 5100 })
    expect(plan.lignes[1]).toMatchObject({ soldeDebut: 5100, soldeFin: 5200 })
  })

  it('reste à zéro sans historique bancaire', () => {
    const plan = calculerPlanTresorerie([], 0, 6, 2)
    expect(plan.moyenneEncaissements).toBe(0)
    expect(plan.lignes.every((l) => l.soldeFin === 0)).toBe(true)
  })
})

// CE SUR QUOI LA MOYENNE REPOSE. Le module a toujours eu raison de rendre 0 sans historique — le test
// voisin « reste à zéro sans historique bancaire » le fige. Ce qui manquait est de pouvoir DISTINGUER
// ce zéro-là d'un zéro observé : les deux produisaient le même écran, sur le document qu'un cabinet
// montre à une banque.
describe('ce sur quoi la moyenne repose', () => {
  const ligne = (decalage: number, montant = 100): LigneBanquePourPlan =>
    ({ date: `${cleMois(decalage)}-15`, sens: 'debit', montant })

  it('compte les lignes et les mois RÉELLEMENT servis, pas ceux demandés', () => {
    const plan = calculerPlanTresorerie([ligne(-1), ligne(-1, 50), ligne(-3)], 0, 6, 1)
    expect(plan.nbLignesObservees).toBe(3)
    expect(plan.nbMoisAvecDonnees).toBe(2)
    expect(plan.nbMoisHistorique).toBe(6)
  })

  it('ne compte pas ce que la fenêtre écarte', () => {
    // Le mois en cours n'est pas terminé, le -7e est hors fenêtre : ni l'un ni l'autre n'est
    // « observé », sans quoi le compteur promettrait une assiette que la moyenne n'a pas utilisée.
    const plan = calculerPlanTresorerie([ligne(0), ligne(-7), ligne(-2)], 0, 6, 1)
    expect(plan.nbLignesObservees).toBe(1)
    expect(plan.nbMoisAvecDonnees).toBe(1)
  })

  it('LAISSE LE DIVISEUR AUX MOIS DEMANDÉS', () => {
    // Garde délibéré, et c'est la moitié du correctif : un mois calme est un VRAI zéro. Diviser par
    // les seuls mois servis ferait d'un cabinet en congés un cabinet deux fois plus actif — on dit
    // l'assiette, on ne la corrige pas.
    const plan = calculerPlanTresorerie([ligne(-1, 600)], 0, 6, 1)
    expect(plan.moyenneEncaissements).toBe(100)
  })
})

describe('reserveSurMoyenne', () => {
  const plan = (o: Partial<PlanTresorerie>): PlanTresorerie => ({
    moyenneEncaissements: 0, moyenneDecaissements: 0, nbMoisHistorique: 6,
    nbLignesObservees: 0, nbMoisAvecDonnees: 0, lignes: [], ...o,
  })

  it('se tait quand tous les mois demandés sont servis', () => {
    // Une mise en garde permanente cesse d'être lue, puis emporte ses voisines dans son discrédit.
    expect(reserveSurMoyenne(plan({ nbLignesObservees: 12, nbMoisAvecDonnees: 6 }))).toBeNull()
  })

  it('dit que la moyenne ne repose sur RIEN quand aucun mouvement n’a été lu', () => {
    const texte = reserveSurMoyenne(plan({}))
    expect(texte).toContain('ne repose sur rien')
    // Le zéro est une AFFIRMATION tant que personne ne dit qu'il n'a rien été lu.
    expect(texte).toContain('0,00 € ne veut pas dire')
    // Et la cause est actionnable : un relevé importé ne produit aucune écriture à lui seul.
    expect(texte).toContain('écritures générées')
  })

  it('distingue « rien lu » de « lu sur une partie » — jamais la même conséquence', () => {
    const partiel = reserveSurMoyenne(plan({ nbLignesObservees: 4, nbMoisAvecDonnees: 2 }))
    expect(partiel).toContain('2 de ces 6 mois')
    expect(partiel).toContain('sous-estimée')
    // Garde symétrique : la conséquence de l'un ne doit pas s'afficher sur l'autre.
    expect(partiel).not.toContain('ne repose sur rien')
    expect(reserveSurMoyenne(plan({}))).not.toContain('sous-estimée')
  })

  it('accorde le singulier quand il ne manque qu’un mois', () => {
    const texte = reserveSurMoyenne(plan({ nbLignesObservees: 9, nbMoisAvecDonnees: 5 }))
    expect(texte).toContain('le mois restant compte')
    expect(texte).not.toContain('mois restants comptent')
  })
})

describe('échéances connues', () => {
  const pret: Emprunt = {
    id: 'e1', dossier_id: 'd1', nom: 'Matériel', organisme_preteur: null,
    capital_initial: 12000, taux_annuel: 3, date_debut: '2026-01-31', duree_mois: 24,
    created_at: '2026-01-01T00:00:00Z',
  }

  it('ne retient que les échéances d’emprunt de la période demandée', () => {
    const echeances = echeancesEmprunts([pret], '2026-04-01', '2026-06-30')
    expect(echeances.map((e) => e.date)).toEqual(['2026-04-30', '2026-05-31', '2026-06-30'])
    expect(echeances.every((e) => e.libelle.includes('Matériel'))).toBe(true)
  })

  it('ignore un emprunt pas encore commencé', () => {
    expect(echeancesEmprunts([pret], '2025-01-01', '2025-06-30')).toEqual([])
  })

  it('ne retient que les cotisations non versées de la période', () => {
    const cotisations = [
      { id: 'c1', dossier_id: 'd1', echeance: '2026-05-05', montant_appele: 300, montant_verse: null },
      { id: 'c2', dossier_id: 'd1', echeance: '2026-05-20', montant_appele: 400, montant_verse: 400 }, // déjà payée
      { id: 'c3', dossier_id: 'd1', echeance: '2026-09-05', montant_appele: 500, montant_verse: null }, // hors période
    ] as CotisationDeclaree[]
    const echeances = echeancesCotisations(cotisations, '2026-04-01', '2026-06-30')
    expect(echeances).toHaveLength(1)
    expect(echeances[0]).toMatchObject({ date: '2026-05-05', montant: 300 })
  })
})
