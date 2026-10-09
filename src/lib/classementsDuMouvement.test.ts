import { describe, expect, it } from 'vitest'
import { refusAffectation, type MouvementBancaire } from './affectationBanque'
import { refusPaieUneDeclarationTva } from './classementsDuMouvement'
import { refusMouvementCompteDeBilan } from './compteDeBilan'
import { refusRapprochementCotisation } from './cotisationRapprochee'
import { refusEcheanceEmprunt } from './echeanceEmprunt'
import { refusReglementGroupe } from './reglementGroupe'
import { refusVentilation } from './ventilationBanque'
import { refusVirementPersonnel } from './virementPersonnel'

// Le refus d'un mouvement qui paie une déclaration de TVA (ligne 26.8) vit dans lib/classementsDuMouvement.ts, comme
// celui d'un mouvement écrit sur un compte de bilan (gardé par lib/compteDeBilan.test.ts) : les fonctions SQL des
// autres classements ne le refusent pas nommément, elles rencontrent la contrainte d'un seul rapprochement, dont le
// nom ne dit rien à l'opérateur. Chaque classement le dit donc avant le clic — et c'est ce que ce fichier garde.

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2026-04-20', libelle: 'PRLV DGFIP TVA', libelle_brut: null, montant: -1200,
    statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: 'q1',
    ...o,
  }
}

const PAIEMENT = 'Ce mouvement paie une déclaration de TVA : annule d’abord ce rapprochement.'
const REMBOURSEMENT = 'Ce mouvement est le remboursement d’un crédit de TVA : annule d’abord ce rapprochement.'

describe('refusPaieUneDeclarationTva — un mouvement rapproché d’une déclaration de TVA ne se classe pas autrement', () => {
  it('nomme le paiement d’un prélèvement et le remboursement d’un encaissement, et se tait sans déclaration', () => {
    expect(refusPaieUneDeclarationTva(mouvement())).toBe(PAIEMENT)
    expect(refusPaieUneDeclarationTva(mouvement({ montant: 300 }))).toBe(REMBOURSEMENT)
    expect(refusPaieUneDeclarationTva(mouvement({ declaration_tva_id: null }))).toBeNull()
  })

  // Sans ce refus, l'écran laisserait cliquer, et la base répondrait par le nom de sa contrainte : la déclaration resterait
  // payée sur le papier, et le mouvement compterait ailleurs.
  it('affecter, classer en virement personnel, ventiler, régler en groupe, rapprocher d’un emprunt, d’une cotisation, écrire sur un compte de bilan', () => {
    const categorie = { id: 'cat', libelle: 'Frais bancaires', compte_comptable: '627000' }
    const cotisation = { montant_verse: null, montant_appele: 1200, montant_csg_crds: null, paiement_personnel_le: null }
    for (const [ligne, attendu] of [[mouvement(), PAIEMENT], [mouvement({ montant: 300 }), REMBOURSEMENT]] as const) {
      expect(refusAffectation(ligne, categorie, false, null)).toBe(attendu)
      expect(refusVirementPersonnel(ligne)).toBe(attendu)
      expect(refusVentilation(ligne, [], [categorie], false)).toBe(attendu)
      expect(refusReglementGroupe(ligne, [], [], new Map())).toBe(attendu)
      expect(refusEcheanceEmprunt(ligne)).toBe(attendu)
      expect(refusRapprochementCotisation(ligne, cotisation, 'tresorerie')).toBe(attendu)
      expect(refusMouvementCompteDeBilan(ligne)).toBe(attendu)
    }
  })
})
