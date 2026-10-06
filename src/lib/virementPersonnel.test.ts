import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import type { ModeleComptable } from './engagement'
import type { EcritureBrouillon } from './types'
import {
  compteDuDirigeant, ecritureDuVirementPersonnel, refusVirementPersonnel, virementsPersonnelsAEcrire,
} from './virementPersonnel'
import { NON_VALIDEE } from '../test/ecritures'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT_SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2025-03-12', libelle: 'VIR PERSONNEL', libelle_brut: null, montant: -500,
    statut: 'ignoree', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: true,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null,
    ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2025-03-12', compte: '108000',
    libelle: 'VIR PERSONNEL', montant: 500, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2025-03-12T10:00:00Z',
    ...o,
  }
}

describe('compteDuDirigeant — lu dans le modèle du dossier', () => {
  it('en trésorerie, le compte de l’exploitant, quel que soit le compte des notes de frais', () => {
    for (const compteNotesDeFrais of ['455000', '108000', '467000'] as const) {
      expect(compteDuDirigeant({ mode: 'tresorerie', compteNotesDeFrais })).toBe('108000')
    }
  })

  it('en engagement, le compte que le cabinet a choisi pour le dirigeant', () => {
    for (const compteNotesDeFrais of ['455000', '108000', '467000'] as const) {
      expect(compteDuDirigeant({ mode: 'engagement', compteNotesDeFrais })).toBe(compteNotesDeFrais)
    }
  })
})

describe('refusVirementPersonnel — dit avant d’écrire ce que la base refuserait', () => {
  it('un mouvement rapproché d’une pièce, d’une cotisation, d’un emprunt, affecté à une catégorie ou ventilé', () => {
    for (const o of [
      { piece_id: 'p1' }, { cotisation_id: 'c1' }, { categorie_id: 'cat-frais' }, { emprunt_id: 'emp1', emprunt_echeance: 1 },
      { ventilee: true },
    ]) {
      expect(refusVirementPersonnel(mouvement({ statut: 'rapprochee', prelevement_personnel: false, ...o })))
        .toBe('Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie ou ventilé sur plusieurs comptes : annule d’abord ce classement.')
    }
  })

  it('un mouvement de zéro euro', () => {
    expect(refusVirementPersonnel(mouvement({ montant: 0 }))).toBe('Un mouvement de zéro euro n’a rien à écrire.')
  })

  it('rien à redire d’un mouvement à traiter, ignoré ou déjà classé', () => {
    for (const o of [
      { statut: 'non_rapprochee', prelevement_personnel: false },
      { statut: 'ignoree', prelevement_personnel: false },
      { statut: 'ignoree', prelevement_personnel: true },
    ] satisfies Partial<MouvementBancaire>[]) {
      expect(refusVirementPersonnel(mouvement(o))).toBeNull()
    }
  })
})

describe('ecritureDuVirementPersonnel — le compte du dirigeant face à la banque', () => {
  it('un prélèvement de l’exploitant débite son compte et crédite la banque', () => {
    expect(ecritureDuVirementPersonnel(mouvement({ montant: -500 }), TRESORERIE)).toEqual([
      { compte: '108000', sens: 'debit', montant: 500, libelle: 'VIR PERSONNEL' },
      { compte: '512000', sens: 'credit', montant: 500, libelle: 'VIR PERSONNEL' },
    ])
  })

  it('un apport de sa poche crédite son compte et débite la banque', () => {
    expect(ecritureDuVirementPersonnel(mouvement({ montant: 1000, libelle: 'VIR APPORT' }), TRESORERIE)).toEqual([
      { compte: '108000', sens: 'credit', montant: 1000, libelle: 'VIR APPORT' },
      { compte: '512000', sens: 'debit', montant: 1000, libelle: 'VIR APPORT' },
    ])
  })

  it('en engagement, sur le compte choisi pour le dirigeant', () => {
    const [dirigeant, banque] = ecritureDuVirementPersonnel(mouvement({ montant: -500 }), ENGAGEMENT_SOCIETE)
    expect(dirigeant).toMatchObject({ compte: '455000', sens: 'debit', montant: 500 })
    expect(banque).toMatchObject({ compte: '512000', sens: 'credit', montant: 500 })
  })
})

describe('virementsPersonnelsAEcrire — ceux dont l’écriture manque ou n’est plus celle attendue', () => {
  const justes = [
    ecriture({ id: 'e1', compte: '108000', sens: 'debit' }),
    ecriture({ id: 'e2', compte: '512000', sens: 'credit' }),
  ]

  it('un virement classé avant que le bouton n’écrive : sans écriture, il est à écrire', () => {
    expect(virementsPersonnelsAEcrire([], [mouvement()], TRESORERIE, null).map((l) => l.id)).toEqual(['l1'])
  })

  it('se tait quand l’écriture est celle attendue, dans n’importe quel ordre', () => {
    expect(virementsPersonnelsAEcrire(justes, [mouvement()], TRESORERIE, null)).toEqual([])
    expect(virementsPersonnelsAEcrire([...justes].reverse(), [mouvement()], TRESORERIE, null)).toEqual([])
  })

  it('signale une écriture sur un autre compte, dans l’autre sens, d’un autre montant ou à une autre date', () => {
    const casPerimes: EcritureBrouillon[][] = [
      [ecriture({ id: 'e1', compte: '455000', sens: 'debit' }), justes[1]],
      [ecriture({ id: 'e1', sens: 'credit' }), ecriture({ id: 'e2', compte: '512000', sens: 'debit' })],
      [ecriture({ id: 'e1', montant: 400 }), ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 400 })],
      [ecriture({ id: 'e1', date: '2025-03-13' }), ecriture({ id: 'e2', compte: '512000', sens: 'credit', date: '2025-03-13' })],
      [...justes, ecriture({ id: 'e3', compte: '108000' })],
    ]
    for (const ecritures of casPerimes) {
      expect(virementsPersonnelsAEcrire(ecritures, [mouvement()], TRESORERIE, null)).toHaveLength(1)
    }
  })

  it('le compte attendu suit le modèle : en engagement, l’écriture sur 108 d’une société est à reprendre', () => {
    expect(virementsPersonnelsAEcrire(justes, [mouvement()], ENGAGEMENT_SOCIETE, null)).toHaveLength(1)
    const surLe455 = [ecriture({ id: 'e1', compte: '455000' }), justes[1]]
    expect(virementsPersonnelsAEcrire(surLe455, [mouvement()], ENGAGEMENT_SOCIETE, null)).toEqual([])
  })

  it('les écritures d’une pièce ne comptent pas pour le mouvement, même quand elles le désignent', () => {
    const contrepartieDUnePiece = [
      ecriture({ id: 'e8', piece_id: 'p1', compte: '108000', sens: 'debit' }),
      ecriture({ id: 'e9', piece_id: 'p1', compte: '512000', sens: 'credit' }),
    ]
    expect(virementsPersonnelsAEcrire(contrepartieDUnePiece, [mouvement()], TRESORERIE, null)).toHaveLength(1)
  })

  it('ne rend que des virements personnels qu’on PEUT écrire', () => {
    const lignes = [
      mouvement({ id: 'a-traiter', statut: 'non_rapprochee', prelevement_personnel: false }),
      mouvement({ id: 'ignore', statut: 'ignoree', prelevement_personnel: false }),
      mouvement({ id: 'affecte', statut: 'rapprochee', prelevement_personnel: false, categorie_id: 'cat-frais' }),
      mouvement({ id: 'zero', montant: 0 }),
      mouvement({ id: 'rapproche', statut: 'rapprochee', piece_id: 'p1' }),
      mouvement({ id: 'a-ecrire' }),
    ]
    expect(virementsPersonnelsAEcrire([], lignes, TRESORERIE, null).map((l) => l.id)).toEqual(['a-ecrire'])
  })

  // La base refuse d'écrire dans un exercice validé : réclamer l'écriture d'un virement qui y tombe laisserait un
  // point que rien ne lève. La frontière elle-même est figée ; le lendemain ne l'est pas.
  it('ne réclame rien d’un exercice validé, la frontière comprise', () => {
    const lignes = [
      mouvement({ id: 'fige', date: '2024-12-31' }),
      mouvement({ id: 'ouvert', date: '2025-01-01' }),
    ]
    expect(virementsPersonnelsAEcrire([], lignes, TRESORERIE, '2024-12-31').map((l) => l.id)).toEqual(['ouvert'])
    // Le garde symétrique : sans exercice validé, les deux se réclament.
    expect(virementsPersonnelsAEcrire([], lignes, TRESORERIE, null).map((l) => l.id)).toEqual(['fige', 'ouvert'])
  })
})
