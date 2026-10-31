import { describe, expect, it } from 'vitest'
import { calculerDeclaration2035 } from './declaration2035'
import { casesNegatives, valeursDesCases } from './cases2035'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces } from './rattachement'
import { cotisationsComptees } from './cotisationRapprochee'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import type { Categorie, CotisationDeclaree, LigneBancaire, Piece } from './types'

// RELECTURE DU 31/10/2026 — la 2035 d'un soignant EXONÉRÉ en trésorerie. Ces tests PROUVENT des défauts : ils décrivent
// ce que la déclaration DEVRAIT dire, et échouent tant que le moteur ne le dit pas (`it.fails`). Le jour où un défaut est
// corrigé, son test passe au vert, `it.fails` échoue, et il suffit d'en retirer le `.fails`.

const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2025-06-01', libelle: 'VIR', montant: 0, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  libelle_brut: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2025-06-02T09:00:00Z',
  encaissements_de_factures: false, ...o,
})

const exonere = (o: {
  categories: Categorie[]; lignes?: LigneBancaire[]; pieces?: Piece[]; cotisations?: CotisationDeclaree[]; annee?: number
}) => calculerDeclaration2035(
  o.annee ?? 2025, o.pieces ?? [], o.categories, [],
  cotisationsComptees(o.cotisations ?? [], o.lignes ?? [], 'tresorerie'), [], false,
  paiementsDesPieces(o.lignes ?? [], [], []), partsDuReleve(o.lignes ?? [], o.categories, [], false), [], PLAN_PAR_DEFAUT,
  ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
)

describe('relecture — les honoraires rétrocédés (ligne 3, AC) ne peuvent jamais se déclarer', () => {
  // Une infirmière titulaire encaisse 50 000 € de l'Assurance maladie et rétrocède 10 000 € à sa remplaçante, par
  // virement. Le formulaire attend AA = 50 000, AC = 10 000, AD = 40 000 (AD = ligne 1 − ligne 2 − ligne 3).
  const recettes = { id: 'c-rec', compte_comptable: '706000', poste_2035: 'Recettes' } as Categorie
  const cpam = mouvement({ id: 'cpam', categorie_id: 'c-rec', montant: 50_000 })

  it.fails('rangée dans une catégorie de CHARGE (6226), la rétrocession atteint AC', () => {
    const retro = { id: 'c-retro', compte_comptable: '622600', poste_2035: 'Honoraires rétrocédés' } as Categorie
    const d = exonere({ categories: [recettes, retro], lignes: [cpam, mouvement({ id: 'remp', categorie_id: 'c-retro', montant: -10_000 })] })
    const { valeurs } = valeursDesCases(d)
    // Constaté : AC = 0, AD = 50 000, et la ligne tombe dans « Postes sans case » (case du mauvais sens).
    expect(valeurs.get('AC')).toBe(10_000)
    expect(valeurs.get('AD')).toBe(40_000)
  })

  it('constaté : catégorie de charge → AC vide, rétrocession refusée comme « case du mauvais sens »', () => {
    const retro = { id: 'c-retro', compte_comptable: '622600', poste_2035: 'Honoraires rétrocédés' } as Categorie
    const d = exonere({ categories: [recettes, retro], lignes: [cpam, mouvement({ id: 'remp', categorie_id: 'c-retro', montant: -10_000 })] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(valeurs.get('AC')).toBe(0)
    expect(postesSansCase.map((p) => [p.raison, p.codeRefuse])).toEqual([['case du mauvais sens', 'AC']])
  })

  it('constaté : catégorie de PRODUIT (7xx) → AC négative, et AD gonflée de deux fois la rétrocession', () => {
    const retro = { id: 'c-retro', compte_comptable: '706100', poste_2035: 'Honoraires rétrocédés' } as Categorie
    const d = exonere({ categories: [recettes, retro], lignes: [cpam, mouvement({ id: 'remp', categorie_id: 'c-retro', montant: -10_000 })] })
    const { valeurs } = valeursDesCases(d)
    // Le résultat du moteur est juste (40 000), mais la case soustractive reçoit le signe de la recette : AD = AA − (−AC).
    expect(d.resultat).toBe(40_000)
    expect(valeurs.get('AC')).toBe(-10_000)
    expect(valeurs.get('AD')).toBe(60_000)
    expect(valeurs.get('CA')).toBe(60_000)
    expect(casesNegatives(d).map((c) => c.case.code)).toEqual(['AC'])
  })
})

describe('relecture — le remboursement d’une échéance de cotisation, selon qu’il est rapproché ou non', () => {
  // Un remboursement de l'Urssaf saisi comme une échéance NÉGATIVE (−300 €, dont 30 € de CSG-CRDS saisis en positif, comme
  // l'indique le décompte). Rapproché du crédit qui le paie, BK baisse de 270 € et BV de 21,03 €. Non rapproché, le moteur
  // lit la CSG-CRDS sans la signer comme le montant (`cotisationsComptees`, la troisième branche).
  const cotisation: CotisationDeclaree = {
    id: 'rbt', dossier_id: 'd1', echeance: '2025-11-15', montant_appele: -300, montant_verse: null, montant_csg_crds: 30,
    created_at: '2025-11-01T09:00:00Z', previsionnel: false, paiement_personnel_le: null,
  } as CotisationDeclaree
  const cats: Categorie[] = []

  it('rapproché : BK −270, BV −21,03', () => {
    const credit = mouvement({ id: 'urssaf', date: '2025-11-20', montant: 300, cotisation_id: 'rbt' })
    const { valeurs } = valeursDesCases(exonere({ categories: cats, lignes: [credit], cotisations: [cotisation] }))
    expect(valeurs.get('BK')).toBe(-270)
    expect(valeurs.get('BV')).toBe(-21.03)
  })

  it('constaté : non rapproché, BK −330 et BV +21,03', () => {
    const { valeurs } = valeursDesCases(exonere({ categories: cats, cotisations: [cotisation] }))
    expect(valeurs.get('BK')).toBe(-330)
    expect(valeurs.get('BV')).toBe(21.03)
  })

  it.fails('non rapproché : le même remboursement devrait donner les mêmes cases', () => {
    const { valeurs } = valeursDesCases(exonere({ categories: cats, cotisations: [cotisation] }))
    // Constaté : BK = −330 et BV = +21,03 — la CSG-CRDS d'un remboursement y est traitée comme une CSG payée.
    expect(valeurs.get('BK')).toBe(-270)
    expect(valeurs.get('BV')).toBe(-21.03)
  })
})

describe('relecture — une pièce payée, rejetée puis payée de nouveau', () => {
  // Une prime d'assurance de 1 200 € TTC (exonéré : le TTC compte) prélevée le 20/12/2025, le prélèvement rejeté le
  // 28/12/2025 (crédit de 1 200 €, rapproché de la même pièce), puis payée le 05/01/2026. Payée en 2026 seulement.
  const assurance = { id: 'c-ass', compte_comptable: '616000', poste_2035: "Primes d'assurance" } as Categorie
  const prime = {
    id: 'prime', statut: 'validee', type_piece: 'achat', date_piece: '2025-12-15', montant_ht: 1200, montant_tva: 0,
    montant_ttc: 1200, categorie_id: 'c-ass', created_at: '2025-12-16T09:00:00Z',
  } as Piece
  const lignes = [
    mouvement({ id: 'p1', date: '2025-12-20', montant: -1200, piece_id: 'prime' }),
    mouvement({ id: 'rejet', date: '2025-12-28', montant: 1200, piece_id: 'prime' }),
    mouvement({ id: 'p2', date: '2026-01-05', montant: -1200, piece_id: 'prime' }),
  ]

  it.fails('ne compte rien en 2025 et 1 200 € en 2026', () => {
    // Constaté : 800 € en 2025 et 400 € en 2026 — les montants se somment en valeur absolue (`partsDesPaiements`).
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2025 }).totalDepenses).toBe(0)
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2026 }).totalDepenses).toBe(1200)
  })

  it('constaté : 800 € en 2025, 400 € en 2026', () => {
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2025 }).totalDepenses).toBe(800)
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2026 }).totalDepenses).toBe(400)
  })
})
