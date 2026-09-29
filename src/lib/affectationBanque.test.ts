import { describe, expect, it } from 'vitest'
import {
  ecritureDuMouvement, idsMouvementsJustifiesParLeReleve, mouvementJustifieParLeReleve, mouvementsAffectes,
  mouvementsAffectesDesynchronises, natureDuCompte, recettesAffecteesSurDossierAssujetti, referenceDuReleve, refusAffectation,
  sensInhabituel, type MouvementBancaire,
} from './affectationBanque'
import type { Categorie, EcritureBrouillon } from './types'

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2025-03-12', libelle: 'FRAIS TENUE DE COMPTE', libelle_brut: null, montant: -8.5,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, prelevement_personnel: false,
    source_fichier: null, ...o,
  }
}

function categorie(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers', ...o,
  }
}

const RECETTES = categorie({ id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', compte_comptable: '706000', poste_2035: 'Recettes' })

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2025-03-12', compte: '627000',
    libelle: 'FRAIS TENUE DE COMPTE', montant: 8.5, sens: 'debit', statut: 'proposee', created_at: '2025-03-12T10:00:00Z',
    ...o,
  }
}

describe('natureDuCompte — lue au compte, jamais au libellé', () => {
  it('classe 7 : une recette ; classe 6 : une dépense', () => {
    expect(natureDuCompte('706000')).toBe('recette')
    expect(natureDuCompte('758000')).toBe('recette')
    expect(natureDuCompte('627000')).toBe('depense')
    expect(natureDuCompte('622600')).toBe('depense')
  })

  it('un compte de bilan, un compte trop court ou absent n’a pas de nature', () => {
    for (const compte of ['108000', '512000', '445660', '7', '60', '', null, undefined]) {
      expect(natureDuCompte(compte)).toBeNull()
    }
  })
})

describe('refusAffectation — dit avant d’écrire ce que la base refuserait', () => {
  it('accepte une dépense et, sur un dossier exonéré, une recette', () => {
    expect(refusAffectation(mouvement(), categorie(), false)).toBeNull()
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, false)).toBeNull()
  })

  it('refuse un mouvement déjà rapproché d’une pièce, d’une échéance ou classé en virement personnel', () => {
    for (const lien of [{ piece_id: 'p1' }, { cotisation_id: 'c1' }, { prelevement_personnel: true }]) {
      expect(refusAffectation(mouvement(lien), categorie(), false)).toMatch(/annule d’abord ce classement/)
    }
  })

  it('refuse une catégorie sans compte ou sur un compte de bilan, en la nommant', () => {
    expect(refusAffectation(mouvement(), categorie({ compte_comptable: null }), false))
      .toBe('La catégorie « Frais bancaires » n’a pas de compte de charge ou de produit (classe 6 ou 7).')
    expect(refusAffectation(mouvement(), categorie({ libelle: 'Exploitant', compte_comptable: '108000' }), false))
      .toMatch(/« Exploitant »/)
  })

  it('refuse une recette sur un dossier assujetti — sa TVA ne se lit pas sur un relevé — mais pas une dépense', () => {
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, true)).toMatch(/assujetti à la TVA/)
    // Même un débit sur une catégorie de recettes : c'est la TVA collectée qu'il diminuerait.
    expect(refusAffectation(mouvement({ montant: -20 }), RECETTES, true)).toMatch(/assujetti à la TVA/)
    expect(refusAffectation(mouvement(), categorie(), true)).toBeNull()
  })

  it('refuse un mouvement de zéro euro, qui n’a rien à écrire', () => {
    expect(refusAffectation(mouvement({ montant: 0 }), categorie(), false)).toMatch(/zéro euro/)
  })
})

describe('sensInhabituel — l’encaissement rangé en « Honoraires »', () => {
  it('signale un encaissement sur une dépense et un paiement sur une recette', () => {
    expect(sensInhabituel({ montant: 120 }, 'depense')).toBe(true)
    expect(sensInhabituel({ montant: -20 }, 'recette')).toBe(true)
  })

  it('se tait sur le sens ordinaire', () => {
    expect(sensInhabituel({ montant: -8.5 }, 'depense')).toBe(false)
    expect(sensInhabituel({ montant: 120 }, 'recette')).toBe(false)
  })
})

describe('ecritureDuMouvement — le compte de la catégorie face à la banque', () => {
  it('un débit : la charge au débit, la banque au crédit, au montant du mouvement', () => {
    expect(ecritureDuMouvement(mouvement(), '627000')).toEqual([
      { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
      { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
    ])
  })

  it('un encaissement : la banque au débit, le produit au crédit', () => {
    expect(ecritureDuMouvement(mouvement({ montant: 1234.56, libelle: 'VIR CPAM' }), '706000')).toEqual([
      { compte: '706000', sens: 'credit', montant: 1234.56, libelle: 'VIR CPAM' },
      { compte: '512000', sens: 'debit', montant: 1234.56, libelle: 'VIR CPAM' },
    ])
  })

  it('le sens vient du SIGNE, pas de la nature : un remboursement reçu crédite la charge', () => {
    const [charge] = ecritureDuMouvement(mouvement({ montant: 30 }), '627000')
    expect(charge).toMatchObject({ compte: '627000', sens: 'credit', montant: 30 })
  })

  it('reprend la ligne brute quand l’import n’a gardé que le libellé générique', () => {
    const lignes = ecritureDuMouvement(mouvement({ libelle: 'Mouvement bancaire', libelle_brut: '12/03 PRLV SEPA BANQUE' }), '627000')
    expect(lignes.map((l) => l.libelle)).toEqual(['12/03 PRLV SEPA BANQUE', '12/03 PRLV SEPA BANQUE'])
  })

  it('s’équilibre toujours', () => {
    for (const montant of [-0.01, -8.5, 30, 1234.56]) {
      const lignes = ecritureDuMouvement(mouvement({ montant }), '627000')
      const solde = lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0)
      expect(solde).toBe(0)
    }
  })
})

describe('mouvementsAffectes — ce qui compte dans un poste', () => {
  const categories = [categorie(), RECETTES, categorie({ id: 'cat-bilan', libelle: 'Exploitant', compte_comptable: '108000', poste_2035: null })]

  it('ne retient que les mouvements rapprochés qui portent une catégorie connue', () => {
    const lignes = [
      mouvement({ id: 'a', statut: 'rapprochee', categorie_id: 'cat-frais' }),
      mouvement({ id: 'b', statut: 'non_rapprochee', categorie_id: 'cat-frais' }),
      mouvement({ id: 'c', statut: 'rapprochee', categorie_id: null, piece_id: 'p1' }),
      mouvement({ id: 'd', statut: 'rapprochee', categorie_id: 'cat-inconnue' }),
      mouvement({ id: 'e', statut: 'ignoree', prelevement_personnel: true }),
    ]
    // Un virement personnel ne compte dans AUCUN poste : le compte du dirigeant est un compte de bilan.
    expect(mouvementsAffectes(lignes, categories).map((m) => m.ligne.id)).toEqual(['a'])
    // Les identifiants se lisent sur la LIGNE : un mouvement affecté à une catégorie qu'on n'a pas su
    // lire reste l'écriture d'un mouvement, pas une rupture de la piste d'audit — et un virement
    // personnel aussi a le relevé pour justificatif.
    expect([...idsMouvementsJustifiesParLeReleve(lignes)]).toEqual(['a', 'd', 'e'])
  })

  it('le montant du poste est positif quand il l’augmente, négatif pour un remboursement', () => {
    const affectes = mouvementsAffectes([
      mouvement({ id: 'frais', statut: 'rapprochee', categorie_id: 'cat-frais', montant: -8.5 }),
      mouvement({ id: 'rembourse', statut: 'rapprochee', categorie_id: 'cat-frais', montant: 3 }),
      mouvement({ id: 'cpam', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: 250 }),
      mouvement({ id: 'rejet', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: -40 }),
    ], categories)
    expect(affectes.map((m) => [m.ligne.id, m.nature, m.montantPoste])).toEqual([
      ['frais', 'depense', 8.5],
      ['rembourse', 'depense', -3],
      ['cpam', 'recette', 250],
      ['rejet', 'recette', -40],
    ])
  })

  it('une catégorie passée sur un compte de bilan n’a plus de nature', () => {
    const [m] = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-bilan' })], categories)
    expect(m.nature).toBeNull()
  })
})

describe('mouvementJustifieParLeReleve — le relevé pour seul justificatif', () => {
  it('un mouvement affecté à une catégorie, ou classé en virement personnel', () => {
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' }))).toBe(true)
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'ignoree', prelevement_personnel: true }))).toBe(true)
  })

  it('ni un mouvement rapproché d’une pièce ou d’une échéance, ni un mouvement ignoré ou à traiter', () => {
    const cas: Partial<MouvementBancaire>[] = [
      { statut: 'rapprochee', piece_id: 'p1' },
      { statut: 'rapprochee', cotisation_id: 'c1' },
      { statut: 'ignoree' },
      { statut: 'non_rapprochee' },
      // Une catégorie sur un mouvement qui n'est pas rapproché : un état que la base refuse
      // (`lignes_bancaires_affectation_rapprochee`), jamais un justificatif.
      { statut: 'non_rapprochee', categorie_id: 'cat-frais' },
    ]
    for (const o of cas) expect(mouvementJustifieParLeReleve(mouvement(o))).toBe(false)
  })
})

describe('mouvementsAffectesDesynchronises — l’écriture que l’affectation produirait aujourd’hui', () => {
  const affecte = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })], [categorie()])
  const justes = [
    ecriture({ id: 'e1', compte: '627000', sens: 'debit' }),
    ecriture({ id: 'e2', compte: '512000', sens: 'credit' }),
  ]

  it('se tait quand l’écriture est celle attendue, dans n’importe quel ordre', () => {
    expect(mouvementsAffectesDesynchronises(justes, affecte)).toEqual([])
    expect(mouvementsAffectesDesynchronises([...justes].reverse(), affecte)).toEqual([])
  })

  it('signale une écriture absente, sur un autre compte, dans l’autre sens ou à une autre date', () => {
    const casPerimes: EcritureBrouillon[][] = [
      [],
      [ecriture({ id: 'e1', compte: '628000', sens: 'debit' }), justes[1]],
      [ecriture({ id: 'e1', compte: '627000', sens: 'credit' }), ecriture({ id: 'e2', compte: '512000', sens: 'debit' })],
      [ecriture({ id: 'e1', date: '2025-03-13' }), justes[1]],
      [ecriture({ id: 'e1', montant: 9.5 }), justes[1]],
      [...justes, ecriture({ id: 'e3', compte: '627000' })],
    ]
    for (const ecritures of casPerimes) {
      expect(mouvementsAffectesDesynchronises(ecritures, affecte)).toHaveLength(1)
    }
  })

  it('le compte de la catégorie a changé depuis l’affectation : l’écriture est périmée', () => {
    const recategorise = mouvementsAffectes(
      [mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })],
      [categorie({ compte_comptable: '627100' })],
    )
    expect(mouvementsAffectesDesynchronises(justes, recategorise)).toHaveLength(1)
  })

  it('les écritures d’une pièce ne comptent pas pour le mouvement, même quand elles le désignent', () => {
    const contrepartieDUnePiece = ecriture({ id: 'e9', piece_id: 'p1', compte: '512000', sens: 'credit' })
    expect(mouvementsAffectesDesynchronises([...justes, contrepartieDUnePiece], affecte)).toEqual([])
  })

  it('une catégorie sans nature rend l’écriture périmée, quelle qu’elle soit', () => {
    const bilan = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })], [categorie({ compte_comptable: '108000' })])
    expect(mouvementsAffectesDesynchronises(justes, bilan)).toHaveLength(1)
  })
})

describe('referenceDuReleve — la pièce d’un mouvement affecté', () => {
  it('nomme le fichier du relevé quand l’import l’a gardé, sinon dit ce qu’il est', () => {
    expect(referenceDuReleve({ source_fichier: 'releve-mars-2025.pdf' })).toBe('releve-mars-2025.pdf')
    expect(referenceDuReleve({ source_fichier: null })).toBe('Relevé bancaire')
    expect(referenceDuReleve({ source_fichier: '   ' })).toBe('Relevé bancaire')
  })
})

describe('recettesAffecteesSurDossierAssujetti — un dossier devenu assujetti après coup', () => {
  const categories = [categorie(), RECETTES]
  const affectes = mouvementsAffectes([
    mouvement({ id: 'frais', statut: 'rapprochee', categorie_id: 'cat-frais' }),
    mouvement({ id: 'cpam', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: 250 }),
  ], categories)

  it('montre les recettes affectées, pas les dépenses', () => {
    expect(recettesAffecteesSurDossierAssujetti(affectes, true).map((m) => m.ligne.id)).toEqual(['cpam'])
  })

  it('se tait sur un dossier exonéré', () => {
    expect(recettesAffecteesSurDossierAssujetti(affectes, false)).toEqual([])
  })
})
