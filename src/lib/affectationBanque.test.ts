import { describe, expect, it } from 'vitest'
import {
  ecritureDuMouvement, idsMouvementsJustifiesParLeReleve, mouvementJustifieParLeReleve, mouvementsAffectes,
  mouvementsAffectesDesynchronises, natureDuCompte, recettesAffecteesSansTaux, referenceDuReleve, refusAffectation,
  sensInhabituel, type MouvementBancaire,
} from './affectationBanque'
import type { Categorie, EcritureBrouillon } from './types'
import { NON_VALIDEE } from '../test/ecritures'

function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2025-03-12', libelle: 'FRAIS TENUE DE COMPTE', libelle_brut: null, montant: -8.5,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
    ...o,
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
    libelle: 'FRAIS TENUE DE COMPTE', montant: 8.5, sens: 'debit', statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, created_at: '2025-03-12T10:00:00Z',
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
    expect(refusAffectation(mouvement(), categorie(), false, null)).toBeNull()
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, false, null)).toBeNull()
  })

  it('refuse un mouvement déjà rapproché d’une pièce, d’une cotisation, d’un emprunt, ventilé ou classé en virement personnel', () => {
    for (const lien of [
      { piece_id: 'p1' }, { cotisation_id: 'c1' }, { prelevement_personnel: true },
      // Sans ce refus, l'écran proposerait d'affecter l'échéance d'un emprunt ; la base, elle, le refuse
      // par sa contrainte `lignes_bancaires_un_seul_rapprochement`, avec un message brut.
      { statut: 'rapprochee' as const, emprunt_id: 'emp1', emprunt_echeance: 1, emprunt_interets: 0, emprunt_assurance: 0 },
      // Même contrainte pour un mouvement ventilé : l'affecter d'un coup défait ses parts — c'est
      // « Annuler la ventilation » qu'il faut d'abord.
      { statut: 'rapprochee' as const, ventilee: true },
    ]) {
      expect(refusAffectation(mouvement(lien), categorie(), false, null))
        .toBe('Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, ventilé sur plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.')
    }
  })

  it('refuse une catégorie sans compte ou sur un compte de bilan, en la nommant', () => {
    expect(refusAffectation(mouvement(), categorie({ compte_comptable: null }), false, null))
      .toBe('La catégorie « Frais bancaires » n’a pas de compte de charge ou de produit (classe 6 ou 7).')
    expect(refusAffectation(mouvement(), categorie({ libelle: 'Exploitant', compte_comptable: '108000' }), false, null))
      .toMatch(/« Exploitant »/)
  })

  it('sur un dossier assujetti, une recette porte son taux — sa TVA ne se lit pas sur un relevé', () => {
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, true, null))
      .toBe('Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».')
    // Même un débit sur une catégorie de recettes : c'est la TVA collectée qu'il diminue.
    expect(refusAffectation(mouvement({ montant: -20 }), RECETTES, true, null)).toMatch(/choisis-le/)
    // Le taux choisi — ou l'exonération — la rend affectable.
    for (const taux of [20, 10, 5.5, 8.5, 0]) expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, true, taux)).toBeNull()
    expect(refusAffectation(mouvement(), categorie(), true, null)).toBeNull()
  })

  it('refuse un taux ailleurs que sur une recette d’un dossier assujetti', () => {
    const inapplicable = 'Un taux de TVA ne s’applique qu’à une recette d’un dossier assujetti.'
    // Une dépense : un taux y dirait une TVA déductible, que seule une facture ouvre.
    expect(refusAffectation(mouvement(), categorie(), true, 20)).toBe(inapplicable)
    // Un dossier exonéré ne collecte rien.
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, false, 20)).toBe(inapplicable)
    expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, false, 0)).toBe(inapplicable)
  })

  it('refuse un taux que la base ne prend pas en charge', () => {
    for (const taux of [2.1, 7, 19.6]) {
      expect(refusAffectation(mouvement({ montant: 120 }), RECETTES, true, taux)).toBe('Ce taux de TVA n’est pas pris en charge.')
    }
  })

  it('dans l’ordre de la base : le taux avant le zéro euro', () => {
    expect(refusAffectation(mouvement({ montant: 0 }), RECETTES, true, null)).toMatch(/choisis-le/)
  })

  it('refuse un mouvement de zéro euro, qui n’a rien à écrire', () => {
    expect(refusAffectation(mouvement({ montant: 0 }), categorie(), false, null)).toMatch(/zéro euro/)
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
    expect(ecritureDuMouvement(mouvement(), '627000', null)).toEqual([
      { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
      { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
    ])
  })

  it('un encaissement : la banque au débit, le produit au crédit', () => {
    expect(ecritureDuMouvement(mouvement({ montant: 1234.56, libelle: 'VIR CPAM' }), '706000', null)).toEqual([
      { compte: '706000', sens: 'credit', montant: 1234.56, libelle: 'VIR CPAM' },
      { compte: '512000', sens: 'debit', montant: 1234.56, libelle: 'VIR CPAM' },
    ])
  })

  it('le sens vient du SIGNE, pas de la nature : un remboursement reçu crédite la charge', () => {
    const [charge] = ecritureDuMouvement(mouvement({ montant: 30 }), '627000', null)
    expect(charge).toMatchObject({ compte: '627000', sens: 'credit', montant: 30 })
  })

  it('reprend la ligne brute quand l’import n’a gardé que le libellé générique', () => {
    const lignes = ecritureDuMouvement(mouvement({ libelle: 'Mouvement bancaire', libelle_brut: '12/03 PRLV SEPA BANQUE' }), '627000', null)
    expect(lignes.map((l) => l.libelle)).toEqual(['12/03 PRLV SEPA BANQUE', '12/03 PRLV SEPA BANQUE'])
  })

  it('une recette taxée : la banque au TTC, la recette au hors taxe, la TVA collectée à côté', () => {
    expect(ecritureDuMouvement(mouvement({ montant: 492.6, libelle: 'VIR CLIENT' }), '706000', 20)).toEqual([
      { compte: '706000', sens: 'credit', montant: 410.5, libelle: 'VIR CLIENT' },
      { compte: '445710', sens: 'credit', montant: 82.1, libelle: 'VIR CLIENT' },
      { compte: '512000', sens: 'debit', montant: 492.6, libelle: 'VIR CLIENT' },
    ])
  })

  it('un remboursement versé sur une recette taxée diminue la TVA collectée', () => {
    expect(ecritureDuMouvement(mouvement({ montant: -60 }), '706000', 20).map((l) => [l.compte, l.sens, l.montant])).toEqual([
      ['706000', 'debit', 50],
      ['445710', 'debit', 10],
      ['512000', 'credit', 60],
    ])
  })

  it('exonérée ou sans taux : deux lignes, jamais une TVA à zéro', () => {
    expect(ecritureDuMouvement(mouvement({ montant: 120 }), '706000', 0)).toHaveLength(2)
    // Un centime à 5,5 % ne porte aucune TVA au centime : pas de ligne à zéro, que la base refuserait.
    expect(ecritureDuMouvement(mouvement({ montant: 0.09 }), '706000', 5.5)).toHaveLength(2)
  })

  it('s’équilibre toujours, au centime exact', () => {
    for (const [montant, taux] of [[-0.01, null], [-8.5, null], [30, null], [1234.56, null], [492.6, 20], [99.99, 20], [12.34, 5.5], [-60, 8.5], [105.5, 10]] as const) {
      const lignes = ecritureDuMouvement(mouvement({ montant }), montant > 0 ? '706000' : '627000', taux)
      const solde = lignes.reduce((s, l) => s + Math.round(l.montant * 100) * (l.sens === 'debit' ? 1 : -1), 0)
      expect(solde, `${montant} à ${taux} %`).toBe(0)
      for (const l of lignes) expect(l.montant).toBe(Math.round(l.montant * 100) / 100)
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
    expect(mouvementsAffectes(lignes, categories, false).map((m) => m.ligne.id)).toEqual(['a'])
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
    ], categories, false)
    expect(affectes.map((m) => [m.ligne.id, m.nature, m.montantPoste])).toEqual([
      ['frais', 'depense', 8.5],
      ['rembourse', 'depense', -3],
      ['cpam', 'recette', 250],
      ['rejet', 'recette', -40],
    ])
  })

  it('une recette taxée d’un dossier assujetti compte au hors taxe, et son remboursement aussi', () => {
    const affectes = mouvementsAffectes([
      mouvement({ id: 'client', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20, montant: 120 }),
      mouvement({ id: 'avoir', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20, montant: -60 }),
      mouvement({ id: 'soins', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 0, montant: 80 }),
    ], categories, true)
    expect(affectes.map((m) => [m.ligne.id, m.taux, m.montantPoste])).toEqual([
      ['client', 20, 100],
      ['avoir', 20, -50],
      ['soins', 0, 80],
    ])
  })

  it('sur un dossier qui a cessé d’être assujetti, le taux gardé ne s’applique plus : le TTC compte', () => {
    const [m] = mouvementsAffectes(
      [mouvement({ statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20, montant: 120 })], categories, false)
    expect([m.taux, m.montantPoste]).toEqual([null, 120])
  })

  it('une catégorie passée sur un compte de bilan n’a plus de nature', () => {
    const [m] = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-bilan' })], categories, false)
    expect(m.nature).toBeNull()
  })
})

describe('mouvementJustifieParLeReleve — le relevé pour seul justificatif', () => {
  it('un mouvement affecté à une catégorie, rapproché d’un emprunt ou d’une échéance de cotisation, ventilé, ou classé en virement personnel', () => {
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' }))).toBe(true)
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'rapprochee', emprunt_id: 'emp1', emprunt_echeance: 1 }))).toBe(true)
    expect(mouvementJustifieParLeReleve(mouvement({ montant: 20000, statut: 'rapprochee', emprunt_id: 'emp1' }))).toBe(true)
    // Une échéance de cotisation rapprochée s'écrit depuis le 01/10/2026 (lib/cotisationRapprochee.ts) :
    // son écriture au 646000 face à la banque n'a pas de pièce, le relevé la justifie.
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'rapprochee', cotisation_id: 'c1' }))).toBe(true)
    // Ventilé : ses parts vivent dans leur table, et le prédicat ne les lit pas — une part qu'on n'a pas
    // su lire ne fait pas d'une écriture juste une rupture.
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'rapprochee', ventilee: true }))).toBe(true)
    expect(mouvementJustifieParLeReleve(mouvement({ statut: 'ignoree', prelevement_personnel: true }))).toBe(true)
    expect([...idsMouvementsJustifiesParLeReleve([
      mouvement({ id: 'v', statut: 'rapprochee', ventilee: true }),
      mouvement({ id: 'n', statut: 'non_rapprochee' }),
    ])]).toEqual(['v'])
  })

  it('ni un mouvement rapproché d’une pièce, ni un mouvement ignoré ou à traiter', () => {
    const cas: Partial<MouvementBancaire>[] = [
      { statut: 'rapprochee', piece_id: 'p1' },
      { statut: 'ignoree' },
      { statut: 'non_rapprochee' },
      // Une catégorie sur un mouvement qui n'est pas rapproché : un état que la base refuse
      // (`lignes_bancaires_affectation_rapprochee`), jamais un justificatif.
      { statut: 'non_rapprochee', categorie_id: 'cat-frais' },
      // Même chose d'un emprunt (`lignes_bancaires_emprunt_rapproche`).
      { statut: 'non_rapprochee', emprunt_id: 'emp1' },
      // Et d'une ventilation (`lignes_bancaires_ventilation_rapprochee`).
      { statut: 'non_rapprochee', ventilee: true },
      // Et d'une échéance de cotisation (`lignes_bancaires_cotisation_rapprochee`).
      { statut: 'non_rapprochee', cotisation_id: 'c1' },
    ]
    for (const o of cas) expect(mouvementJustifieParLeReleve(mouvement(o))).toBe(false)
  })
})

describe('mouvementsAffectesDesynchronises — l’écriture que l’affectation produirait aujourd’hui', () => {
  const affecte = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })], [categorie()], false)
  const justes = [
    ecriture({ id: 'e1', compte: '627000', sens: 'debit' }),
    ecriture({ id: 'e2', compte: '512000', sens: 'credit' }),
  ]

  it('se tait quand l’écriture est celle attendue, dans n’importe quel ordre', () => {
    expect(mouvementsAffectesDesynchronises(justes, affecte, null)).toEqual([])
    expect(mouvementsAffectesDesynchronises([...justes].reverse(), affecte, null)).toEqual([])
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
      expect(mouvementsAffectesDesynchronises(ecritures, affecte, null)).toHaveLength(1)
    }
  })

  it('le compte de la catégorie a changé depuis l’affectation : l’écriture est périmée', () => {
    const recategorise = mouvementsAffectes(
      [mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })],
      [categorie({ compte_comptable: '627100' })],
      false,
    )
    expect(mouvementsAffectesDesynchronises(justes, recategorise, null)).toHaveLength(1)
  })

  it('les écritures d’une pièce ne comptent pas pour le mouvement, même quand elles le désignent', () => {
    const contrepartieDUnePiece = ecriture({ id: 'e9', piece_id: 'p1', compte: '512000', sens: 'credit' })
    expect(mouvementsAffectesDesynchronises([...justes, contrepartieDUnePiece], affecte, null)).toEqual([])
  })

  // UN MOUVEMENT D'UN EXERCICE VALIDÉ NE SE JUGE PLUS (lib/validationExercice.ts) : son écriture est validée, la base
  // refuse de la réécrire, et le dire « à réaffecter » laisserait un point en erreur que rien ne lève.
  it('ne juge plus un mouvement que la frontière de validation fige, frontière comprise', () => {
    const recategorise = mouvementsAffectes(
      [mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })],
      [categorie({ compte_comptable: '627100' })],
      false,
    )
    // Le mouvement du 12 mars 2025 : figé par la validation de 2025, et par une frontière posée le jour même.
    expect(mouvementsAffectesDesynchronises(justes, recategorise, '2025-12-31')).toEqual([])
    expect(mouvementsAffectesDesynchronises(justes, recategorise, '2025-03-12')).toEqual([])
    // La veille, il ne l'est pas : il se juge comme avant.
    expect(mouvementsAffectesDesynchronises(justes, recategorise, '2025-03-11')).toHaveLength(1)
  })

  it('une catégorie sans nature rend l’écriture périmée, quelle qu’elle soit', () => {
    const bilan = mouvementsAffectes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-frais' })], [categorie({ compte_comptable: '108000' })], false)
    expect(mouvementsAffectesDesynchronises(justes, bilan, null)).toHaveLength(1)
  })

  describe('une recette taxée', () => {
    const recette = mouvement({ id: 'l1', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20, montant: 120, libelle: 'VIR CLIENT' })
    const taxee = [
      ecriture({ id: 'e1', compte: '706000', sens: 'credit', montant: 100 }),
      ecriture({ id: 'e2', compte: '445710', sens: 'credit', montant: 20 }),
      ecriture({ id: 'e3', compte: '512000', sens: 'debit', montant: 120 }),
    ]
    const auTtc = [
      ecriture({ id: 'e1', compte: '706000', sens: 'credit', montant: 120 }),
      ecriture({ id: 'e3', compte: '512000', sens: 'debit', montant: 120 }),
    ]

    it('se tait sur les trois lignes attendues', () => {
      expect(mouvementsAffectesDesynchronises(taxee, mouvementsAffectes([recette], [RECETTES], true), null)).toEqual([])
    })

    it('signale la recette écrite au TTC alors qu’elle porte son taux', () => {
      expect(mouvementsAffectesDesynchronises(auTtc, mouvementsAffectes([recette], [RECETTES], true), null)).toHaveLength(1)
    })

    it('un dossier qui a cessé d’être assujetti attend l’écriture sans TVA : « Réaffecter » la réécrit', () => {
      const affectes = mouvementsAffectes([recette], [RECETTES], false)
      expect(mouvementsAffectesDesynchronises(taxee, affectes, null)).toHaveLength(1)
      expect(mouvementsAffectesDesynchronises(auTtc, affectes, null)).toEqual([])
    })
  })
})

describe('referenceDuReleve — la pièce d’un mouvement affecté', () => {
  it('nomme le fichier du relevé quand l’import l’a gardé, sinon dit ce qu’il est', () => {
    expect(referenceDuReleve({ source_fichier: 'releve-mars-2025.pdf' })).toBe('releve-mars-2025.pdf')
    expect(referenceDuReleve({ source_fichier: null })).toBe('Relevé bancaire')
    expect(referenceDuReleve({ source_fichier: '   ' })).toBe('Relevé bancaire')
  })
})

describe('recettesAffecteesSansTaux — un dossier devenu assujetti après coup', () => {
  const categories = [categorie(), RECETTES]
  const lignes = [
    mouvement({ id: 'frais', statut: 'rapprochee', categorie_id: 'cat-frais' }),
    mouvement({ id: 'cpam', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: 250 }),
    mouvement({ id: 'client', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20, montant: 120 }),
    mouvement({ id: 'soins', statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 0, montant: 80 }),
  ]

  it('montre les recettes affectées sans taux — ni les dépenses, ni une recette dont le taux est choisi, exonérée comprise', () => {
    expect(recettesAffecteesSansTaux(mouvementsAffectes(lignes, categories, true), true, null).map((m) => m.ligne.id)).toEqual(['cpam'])
  })

  it('se tait sur un dossier exonéré', () => {
    expect(recettesAffecteesSansTaux(mouvementsAffectes(lignes, categories, false), false, null)).toEqual([])
  })

  // Un dossier devenu assujetti APRÈS une validation : la recette d'un exercice validé ne se réaffecte plus — la base
  // le refuse —, donc la réclamer laisserait un point que rien ne lève. Celle d'après, si.
  it('ne réclame pas la recette d’un exercice validé, la frontière comprise — celle d’après, si', () => {
    const datees = [
      mouvement({ id: 'figee', date: '2025-12-31', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: 250 }),
      mouvement({ id: 'ouverte', date: '2026-01-01', statut: 'rapprochee', categorie_id: 'cat-recettes', montant: 250 }),
    ]
    const affectes = mouvementsAffectes(datees, categories, true)
    expect(recettesAffecteesSansTaux(affectes, true, '2025-12-31').map((m) => m.ligne.id)).toEqual(['ouverte'])
    expect(recettesAffecteesSansTaux(affectes, true, null).map((m) => m.ligne.id)).toEqual(['figee', 'ouverte'])
  })
})
