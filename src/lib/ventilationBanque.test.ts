import { describe, expect, it } from 'vitest'
import type { MouvementBancaire } from './affectationBanque'
import type { ModeleComptable } from './engagement'
import { formatMoney } from './format'
import { partsDuReleve } from './partsDuReleve'
import type { Categorie, EcritureBrouillon, VentilationBancaire } from './types'
import {
  ecritureDeLaVentilation, montantSaisi, montantSigne, mouvementsVentilesDesynchronises, partsDesVentilations,
  recettesVentileesSurDossierAssujetti, refusVentilation, resteAVentiler, ventilationsIncoherentes, type PartSaisie,
} from './ventilationBanque'

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT_SOCIETE: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// TYPÉS sans `as` : le compilateur confronte chaque champ au type, donc à la table.
function mouvement(o: Partial<MouvementBancaire> = {}): MouvementBancaire {
  return {
    id: 'l1', date: '2025-03-12', libelle: 'PRLV SEPA OPERATEUR MOBILE', libelle_brut: null, montant: -120,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    ...o,
  }
}

function categorie(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-tel', dossier_id: null, code: 'telephone', libelle: 'Téléphone', ordre: 40,
    compte_comptable: '626000', poste_2035: 'Frais postaux et de télécommunications', ...o,
  }
}

const TELEPHONE = categorie()
const FOURNITURES = categorie({ id: 'cat-fourn', code: 'fournitures', libelle: 'Fournitures', compte_comptable: '606400', poste_2035: 'Fournitures de bureau' })
const RECETTES = categorie({ id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', compte_comptable: '706000', poste_2035: 'Recettes' })
const FRAIS = categorie({ id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' })
const BILAN = categorie({ id: 'cat-bilan', code: 'exploitant', libelle: 'Exploitant', compte_comptable: '108000', poste_2035: null })
const SANS_COMPTE = categorie({ id: 'cat-vide', code: 'autre', libelle: 'Autre', compte_comptable: null, poste_2035: null })
const CATEGORIES = [TELEPHONE, FOURNITURES, RECETTES, FRAIS, BILAN, SANS_COMPTE]

// L'abonnement téléphonique pris en charge à 70 % : la part professionnelle en charge, le reste
// prélevé par l'exploitant.
const TELEPHONE_70: PartSaisie[] = [
  { categorie_id: 'cat-tel', part_personnelle: false, montant: -84 },
  { categorie_id: null, part_personnelle: true, montant: -36 },
]

// Une remise de carte bancaire créditée NETTE de sa commission : la recette brute, la commission en
// sens inverse du mouvement.
const REMISE = mouvement({ id: 'remise', libelle: 'REMISE CB', montant: 95 })
const REMISE_PARTS: PartSaisie[] = [
  { categorie_id: 'cat-recettes', part_personnelle: false, montant: 100 },
  { categorie_id: 'cat-frais', part_personnelle: false, montant: -5 },
]

function part(o: Partial<VentilationBancaire> = {}): VentilationBancaire {
  return {
    id: 'v1', dossier_id: 'd1', ligne_bancaire_id: 'l1', categorie_id: 'cat-tel', part_personnelle: false,
    montant: -84, created_at: '2025-03-12T10:00:00Z', ...o,
  }
}

function ecriture(o: Partial<EcritureBrouillon>): EcritureBrouillon {
  return {
    id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: 'l1', date: '2025-03-12', compte: '626000',
    libelle: 'PRLV SEPA OPERATEUR MOBILE', montant: 84, sens: 'debit', statut: 'proposee', created_at: '2025-03-12T10:00:00Z',
    ...o,
  }
}

const VENTILE = mouvement({ statut: 'rapprochee', ventilee: true })
const PARTS_TELEPHONE = [
  part({ id: 'v1', categorie_id: 'cat-tel', montant: -84 }),
  part({ id: 'v2', categorie_id: null, part_personnelle: true, montant: -36 }),
]
const ECRITURE_TELEPHONE = [
  ecriture({ id: 'e1', compte: '626000', sens: 'debit', montant: 84 }),
  ecriture({ id: 'e2', compte: '108000', sens: 'debit', montant: 36 }),
  ecriture({ id: 'e3', compte: '512000', sens: 'credit', montant: 120 }),
]

describe('montants saisis dans le sens du mouvement', () => {
  it('un paiement se ventile en montants positifs, rendus négatifs comme le relevé', () => {
    const paiement = mouvement({ montant: -120 })
    expect(montantSigne(paiement, 84)).toBe(-84)
    expect(montantSaisi(paiement, { montant: -84 })).toBe(84)
    // En sens inverse du mouvement : un remboursement dans un paiement.
    expect(montantSigne(paiement, -5)).toBe(5)
    expect(montantSaisi(paiement, { montant: 5 })).toBe(-5)
  })

  it('un encaissement garde ses signes, et la commission retenue est négative', () => {
    expect(montantSigne(REMISE, 100)).toBe(100)
    expect(montantSigne(REMISE, -5)).toBe(-5)
    expect(montantSaisi(REMISE, { montant: -5 })).toBe(-5)
  })

  it('le reste à ventiler, au centime, et négatif quand les parts dépassent', () => {
    const paiement = mouvement({ montant: -150 })
    expect(resteAVentiler(paiement, [80, 40])).toBe(30)
    expect(resteAVentiler(paiement, [80, 70])).toBe(0)
    expect(resteAVentiler(paiement, [100, 70])).toBe(-20)
    expect(resteAVentiler(REMISE, [100, -5])).toBe(0)
    // 0,1 + 0,2 vaut 0,30000000000000004 en flottants : le reste doit tomber juste.
    expect(resteAVentiler(mouvement({ montant: -0.3 }), [0.1, 0.2])).toBe(0)
    expect(resteAVentiler(mouvement({ montant: -0.3 }), [])).toBe(0.3)
  })
})

describe('refusVentilation — dit avant d’écrire ce que la base refuserait', () => {
  it('accepte l’abonnement mixte, la remise nette de sa commission, et la ventilation d’un mouvement déjà ventilé', () => {
    expect(refusVentilation(mouvement(), TELEPHONE_70, CATEGORIES, false)).toBeNull()
    expect(refusVentilation(REMISE, REMISE_PARTS, CATEGORIES, false)).toBeNull()
    // Rejouée sur un mouvement déjà ventilé, la ventilation remplace la précédente : ce n'est pas un
    // classement à annuler d'abord.
    expect(refusVentilation(VENTILE, TELEPHONE_70, CATEGORIES, false)).toBeNull()
  })

  it('refuse un mouvement déjà rapproché, affecté, rapproché d’un emprunt ou classé en virement personnel', () => {
    for (const o of [
      { statut: 'rapprochee' as const, piece_id: 'p1' },
      { statut: 'rapprochee' as const, cotisation_id: 'c1' },
      { statut: 'rapprochee' as const, categorie_id: 'cat-tel' },
      { statut: 'rapprochee' as const, emprunt_id: 'emp1', emprunt_echeance: 1 },
      { statut: 'ignoree' as const, prelevement_personnel: true },
    ]) {
      expect(refusVentilation(mouvement(o), TELEPHONE_70, CATEGORIES, false))
        .toBe('Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, affecté à une catégorie ou classé en virement personnel : annule d’abord ce classement.')
    }
  })

  it('refuse un mouvement de zéro euro', () => {
    expect(refusVentilation(mouvement({ montant: 0 }), TELEPHONE_70, CATEGORIES, false))
      .toBe('Un mouvement de zéro euro n’a rien à écrire.')
  })

  it('refuse moins de deux parts — une seule serait une affectation', () => {
    for (const parts of [[], [TELEPHONE_70[0]]]) {
      expect(refusVentilation(mouvement(), parts, CATEGORIES, false)).toBe('Une ventilation porte au moins deux parts.')
    }
  })

  it('refuse une part sans cible ou à deux cibles', () => {
    for (const cible of [
      { categorie_id: null, part_personnelle: false },
      { categorie_id: 'cat-tel', part_personnelle: true },
    ]) {
      expect(refusVentilation(mouvement(), [{ ...cible, montant: -84 }, TELEPHONE_70[1]], CATEGORIES, false))
        .toBe('Chaque part va à une catégorie ou au compte du dirigeant, jamais aux deux ni à aucun.')
    }
  })

  it('refuse une part nulle, illisible ou plus fine que le centime', () => {
    for (const montant of [0, Number.NaN, -84.001]) {
      expect(refusVentilation(mouvement(), [{ ...TELEPHONE_70[0], montant }, TELEPHONE_70[1]], CATEGORIES, false))
        .toBe('Chaque part porte un montant non nul, au centime.')
    }
  })

  it('refuse deux parts à la même catégorie, ou deux parts personnelles', () => {
    expect(refusVentilation(mouvement(), [
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -60 },
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -60 },
    ], CATEGORIES, false)).toBe('Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.')
    expect(refusVentilation(mouvement(), [
      { categorie_id: null, part_personnelle: true, montant: -60 },
      { categorie_id: null, part_personnelle: true, montant: -60 },
    ], CATEGORIES, false)).toBe('Deux parts vont à la même catégorie, ou au compte du dirigeant : réunis-les en une.')
  })

  it('refuse des parts qui ne font pas le mouvement, dites dans le sens du mouvement', () => {
    // Un paiement de 150 € ventilé en 80 et 40 : l'opérateur a saisi « 80 » et « 40 », pas « −80 ».
    expect(refusVentilation(mouvement({ montant: -150 }), [
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -80 },
      { categorie_id: null, part_personnelle: true, montant: -40 },
    ], CATEGORIES, false)).toBe(`Les parts font ${formatMoney(120)} au lieu des ${formatMoney(150)} du mouvement.`)
    // Au centime : 84,00 + 35,99 ne font pas 120,00.
    expect(refusVentilation(mouvement(), [TELEPHONE_70[0], { ...TELEPHONE_70[1], montant: -35.99 }], CATEGORIES, false))
      .toBe(`Les parts font ${formatMoney(119.99)} au lieu des ${formatMoney(120)} du mouvement.`)
  })

  it('refuse une catégorie inconnue du dossier', () => {
    expect(refusVentilation(mouvement(), [{ ...TELEPHONE_70[0], categorie_id: 'cat-autre-dossier' }, TELEPHONE_70[1]], CATEGORIES, false))
      .toBe('Cette catégorie n’existe pas pour ce dossier.')
  })

  it('refuse une catégorie sans compte de résultat, en nommant la première dans l’ordre des libellés', () => {
    expect(refusVentilation(mouvement(), [
      { categorie_id: 'cat-vide', part_personnelle: false, montant: -60 },
      { categorie_id: 'cat-bilan', part_personnelle: false, montant: -60 },
    ], CATEGORIES, false)).toBe('La catégorie « Autre » n’a pas de compte de charge ou de produit (classe 6 ou 7).')
    // Dans l'autre ordre des parts, le même nom : le message ne dépend pas de la saisie.
    expect(refusVentilation(mouvement(), [
      { categorie_id: 'cat-bilan', part_personnelle: false, montant: -60 },
      { categorie_id: 'cat-vide', part_personnelle: false, montant: -60 },
    ], CATEGORIES, false)).toBe('La catégorie « Autre » n’a pas de compte de charge ou de produit (classe 6 ou 7).')
  })

  it('refuse une part de recette sur un dossier assujetti, pas une ventilation en dépenses', () => {
    expect(refusVentilation(REMISE, REMISE_PARTS, CATEGORIES, true)).toMatch(/assujetti à la TVA/)
    expect(refusVentilation(mouvement(), [
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -84 },
      { categorie_id: 'cat-fourn', part_personnelle: false, montant: -36 },
    ], CATEGORIES, true)).toBeNull()
  })

  it('le premier refus l’emporte, dans l’ordre de la base', () => {
    // Classé ET sans parts : c'est le classement qu'il faut annuler d'abord.
    expect(refusVentilation(mouvement({ statut: 'rapprochee', piece_id: 'p1' }), [], CATEGORIES, false)).toMatch(/annule d’abord/)
    // De zéro euro ET une seule part : rien à écrire.
    expect(refusVentilation(mouvement({ montant: 0 }), [TELEPHONE_70[0]], CATEGORIES, false)).toMatch(/zéro euro/)
    // Une part nulle ET une somme fausse : la part d'abord.
    expect(refusVentilation(mouvement(), [{ ...TELEPHONE_70[0], montant: 0 }, TELEPHONE_70[1]], CATEGORIES, false)).toMatch(/non nul/)
  })
})

describe('ecritureDeLaVentilation — une ligne par part, puis la banque', () => {
  const equilibre = (lignes: { sens: string; montant: number }[]) =>
    Math.round(lignes.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100)

  it('l’abonnement mixte : la charge et le compte de l’exploitant au débit, la banque au crédit', () => {
    const lignes = ecritureDeLaVentilation(mouvement(), TELEPHONE_70, CATEGORIES, TRESORERIE)!
    expect(lignes.map((l) => [l.compte, l.sens, l.montant])).toEqual([
      ['626000', 'debit', 84],
      ['108000', 'debit', 36],
      ['512000', 'credit', 120],
    ])
    expect(equilibre(lignes)).toBe(0)
  })

  it('en engagement, la part personnelle va au compte choisi pour le dirigeant', () => {
    const lignes = ecritureDeLaVentilation(mouvement(), TELEPHONE_70, CATEGORIES, ENGAGEMENT_SOCIETE)!
    expect(lignes.map((l) => l.compte)).toEqual(['626000', '455000', '512000'])
  })

  it('la remise : la recette brute au crédit, la commission au débit, la banque au débit du net', () => {
    const lignes = ecritureDeLaVentilation(REMISE, REMISE_PARTS, CATEGORIES, TRESORERIE)!
    expect(lignes.map((l) => [l.compte, l.sens, l.montant])).toEqual([
      ['706000', 'credit', 100],
      ['627000', 'debit', 5],
      ['512000', 'debit', 95],
    ])
    expect(equilibre(lignes)).toBe(0)
  })

  it('équilibrée au centime, même sur des montants que les flottants arrondissent mal', () => {
    const lignes = ecritureDeLaVentilation(mouvement({ montant: -0.3 }), [
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -0.1 },
      { categorie_id: 'cat-fourn', part_personnelle: false, montant: -0.2 },
    ], CATEGORIES, TRESORERIE)!
    expect(lignes.map((l) => l.montant)).toEqual([0.1, 0.2, 0.3])
    expect(equilibre(lignes)).toBe(0)
  })

  it('le libellé complet quand l’import n’a gardé que le générique', () => {
    const lignes = ecritureDeLaVentilation(
      mouvement({ libelle: 'Mouvement bancaire', libelle_brut: 'PRLV SEPA OPERATEUR MOBILE REF 42' }), TELEPHONE_70, CATEGORIES, TRESORERIE,
    )!
    expect(new Set(lignes.map((l) => l.libelle))).toEqual(new Set(['PRLV SEPA OPERATEUR MOBILE REF 42']))
  })

  it('nulle quand une part ne peut pas s’écrire : catégorie absente, ou sortie des comptes de résultat', () => {
    expect(ecritureDeLaVentilation(mouvement(), [{ ...TELEPHONE_70[0], categorie_id: 'cat-inconnue' }, TELEPHONE_70[1]], CATEGORIES, TRESORERIE)).toBeNull()
    expect(ecritureDeLaVentilation(mouvement(), [{ ...TELEPHONE_70[0], categorie_id: 'cat-bilan' }, TELEPHONE_70[1]], CATEGORIES, TRESORERIE)).toBeNull()
    expect(ecritureDeLaVentilation(mouvement(), [{ ...TELEPHONE_70[0], categorie_id: 'cat-vide' }, TELEPHONE_70[1]], CATEGORIES, TRESORERIE)).toBeNull()
    // Une part sans cible n'a pas de compte non plus.
    expect(ecritureDeLaVentilation(mouvement(), [{ ...TELEPHONE_70[0], categorie_id: null }, TELEPHONE_70[1]], CATEGORIES, TRESORERIE)).toBeNull()
  })
})

describe('partsDesVentilations — ce que la ventilation met dans les postes de la 2035', () => {
  it('une part par catégorie, jamais la part personnelle, à la date du mouvement', () => {
    const parts = partsDesVentilations([VENTILE], PARTS_TELEPHONE, CATEGORIES)
    expect(parts.map((p) => [p.categorie.id, p.nature, p.montantPoste, p.ligne.date])).toEqual([
      ['cat-tel', 'depense', 84, '2025-03-12'],
    ])
  })

  it('la remise : la recette brute augmente les recettes, la commission les frais financiers', () => {
    const remise = { ...REMISE, statut: 'rapprochee' as const, ventilee: true }
    const parts = partsDesVentilations([remise], [
      part({ id: 'r1', ligne_bancaire_id: 'remise', categorie_id: 'cat-recettes', montant: 100 }),
      part({ id: 'r2', ligne_bancaire_id: 'remise', categorie_id: 'cat-frais', montant: -5 }),
    ], CATEGORIES)
    expect(parts.map((p) => [p.categorie.id, p.nature, p.montantPoste])).toEqual([
      ['cat-recettes', 'recette', 100],
      ['cat-frais', 'depense', 5],
    ])
  })

  it('un remboursement dans un paiement diminue son poste', () => {
    const parts = partsDesVentilations([mouvement({ statut: 'rapprochee', ventilee: true, montant: -95 })], [
      part({ id: 'a', categorie_id: 'cat-tel', montant: -100 }),
      part({ id: 'b', categorie_id: 'cat-fourn', montant: 5 }),
    ], CATEGORIES)
    expect(parts.map((p) => [p.categorie.id, p.montantPoste])).toEqual([['cat-tel', 100], ['cat-fourn', -5]])
  })

  it('ne compte que les mouvements rapprochés ET ventilés', () => {
    for (const ligne of [
      mouvement({ statut: 'rapprochee', ventilee: false, reglement_groupe: false }),
      mouvement({ statut: 'non_rapprochee', ventilee: true }),
    ]) {
      expect(partsDesVentilations([ligne], PARTS_TELEPHONE, CATEGORIES)).toEqual([])
    }
  })

  it('écarte une part dont la catégorie n’a pas été lue, et garde celle sortie des comptes de résultat sans nature', () => {
    const parts = partsDesVentilations([VENTILE], [
      part({ id: 'a', categorie_id: 'cat-inconnue', montant: -60 }),
      part({ id: 'b', categorie_id: 'cat-bilan', montant: -60 }),
    ], CATEGORIES)
    expect(parts.map((p) => [p.categorie.id, p.nature, p.montantPoste])).toEqual([['cat-bilan', null, -60]])
  })

  it('les parts des autres mouvements ne s’en mêlent pas', () => {
    const parts = partsDesVentilations([VENTILE], [
      ...PARTS_TELEPHONE,
      part({ id: 'autre', ligne_bancaire_id: 'l2', categorie_id: 'cat-fourn', montant: -10 }),
    ], CATEGORIES)
    expect(parts.map((p) => p.categorie.id)).toEqual(['cat-tel'])
  })
})

describe('partsDuReleve — la ventilation rejoint les autres sources', () => {
  it('une part par catégorie, avec son libellé et son poste, à côté des mouvements affectés', () => {
    const affecte = mouvement({ id: 'frais', statut: 'rapprochee', categorie_id: 'cat-frais', montant: -8.5 })
    const parts = partsDuReleve([affecte, VENTILE], CATEGORIES, PARTS_TELEPHONE)
    expect(parts.map((p) => [p.ligne.id, p.origine, p.libelle, p.poste, p.nature, p.montantPoste])).toEqual([
      ['frais', 'affectation', 'Frais bancaires', 'Frais financiers', 'depense', 8.5],
      ['l1', 'ventilation', 'Téléphone', 'Frais postaux et de télécommunications', 'depense', 84],
    ])
  })
})

describe('recettesVentileesSurDossierAssujetti — la TVA qu’aucune CA3 ne voit', () => {
  const remise = { ...REMISE, statut: 'rapprochee' as const, ventilee: true }
  const parts = partsDesVentilations([remise, VENTILE], [
    part({ id: 'r1', ligne_bancaire_id: 'remise', categorie_id: 'cat-recettes', montant: 100 }),
    part({ id: 'r2', ligne_bancaire_id: 'remise', categorie_id: 'cat-frais', montant: -5 }),
    ...PARTS_TELEPHONE,
  ], CATEGORIES)

  it('un mouvement par entrée, s’il porte une part de recette', () => {
    expect(recettesVentileesSurDossierAssujetti(parts, true).map((l) => l.id)).toEqual(['remise'])
  })

  it('un mouvement qui porte deux parts de recette n’est compté qu’une fois', () => {
    const deux = partsDesVentilations([remise], [
      part({ id: 'r1', ligne_bancaire_id: 'remise', categorie_id: 'cat-recettes', montant: 60 }),
      part({ id: 'r3', ligne_bancaire_id: 'remise', categorie_id: 'cat-recettes-2', montant: 35 }),
    ], [...CATEGORIES, categorie({ id: 'cat-recettes-2', libelle: 'Autres produits', compte_comptable: '758000' })])
    expect(recettesVentileesSurDossierAssujetti(deux, true).map((l) => l.id)).toEqual(['remise'])
  })

  it('rien sur un dossier exonéré', () => {
    expect(recettesVentileesSurDossierAssujetti(parts, false)).toEqual([])
  })
})

describe('ventilationsIncoherentes — le drapeau et les parts ne disent plus la même chose', () => {
  it('se tait sur une ventilation dont les parts font le mouvement', () => {
    expect(ventilationsIncoherentes([VENTILE], PARTS_TELEPHONE)).toEqual([])
  })

  it('un mouvement ventilé qui porte moins de deux parts', () => {
    expect(ventilationsIncoherentes([VENTILE], [PARTS_TELEPHONE[0]]).map((v) => v.raison)).toEqual(['moins_de_deux_parts'])
    expect(ventilationsIncoherentes([VENTILE], []).map((v) => v.raison)).toEqual(['moins_de_deux_parts'])
  })

  it('des parts qui ne font pas le mouvement, au centime', () => {
    expect(ventilationsIncoherentes([VENTILE], [PARTS_TELEPHONE[0], { ...PARTS_TELEPHONE[1], montant: -35.99 }])
      .map((v) => v.raison)).toEqual(['somme_differente'])
  })

  it('des parts sur un mouvement qui n’est pas ventilé', () => {
    expect(ventilationsIncoherentes([mouvement({ statut: 'rapprochee', categorie_id: 'cat-tel' })], PARTS_TELEPHONE)
      .map((v) => v.raison)).toEqual(['parts_sans_ventilation'])
  })

  it('se tait sur un mouvement ni ventilé ni porteur de parts', () => {
    expect(ventilationsIncoherentes([mouvement()], [])).toEqual([])
  })
})

describe('mouvementsVentilesDesynchronises — l’écriture que les parts produiraient aujourd’hui', () => {
  it('se tait quand l’écriture est celle attendue, dans n’importe quel ordre', () => {
    expect(mouvementsVentilesDesynchronises(ECRITURE_TELEPHONE, [VENTILE], PARTS_TELEPHONE, CATEGORIES, TRESORERIE)).toEqual([])
    expect(mouvementsVentilesDesynchronises([...ECRITURE_TELEPHONE].reverse(), [VENTILE], PARTS_TELEPHONE, CATEGORIES, TRESORERIE)).toEqual([])
  })

  it('une écriture absente, sur un autre compte, d’un autre montant ou à une autre date', () => {
    const cas: EcritureBrouillon[][] = [
      [],
      ECRITURE_TELEPHONE.slice(0, 2),
      ECRITURE_TELEPHONE.map((e) => e.compte === '626000' ? { ...e, compte: '606400' } : e),
      ECRITURE_TELEPHONE.map((e) => e.compte === '626000' ? { ...e, montant: 80 } : e),
      ECRITURE_TELEPHONE.map((e) => e.compte === '108000' ? { ...e, sens: 'credit' as const } : e),
      ECRITURE_TELEPHONE.map((e) => ({ ...e, date: '2025-03-13' })),
    ]
    for (const ecritures of cas) {
      expect(mouvementsVentilesDesynchronises(ecritures, [VENTILE], PARTS_TELEPHONE, CATEGORIES, TRESORERIE).map((l) => l.id)).toEqual(['l1'])
    }
  })

  it('une catégorie dont le compte a changé depuis — le cas réel', () => {
    const recomptee = [{ ...TELEPHONE, compte_comptable: '626100' }, ...CATEGORIES.slice(1)]
    expect(mouvementsVentilesDesynchronises(ECRITURE_TELEPHONE, [VENTILE], PARTS_TELEPHONE, recomptee, TRESORERIE).map((l) => l.id)).toEqual(['l1'])
    // Sortie des comptes de résultat : l'écriture ne peut plus être celle d'une ventilation.
    const bilan = [{ ...TELEPHONE, compte_comptable: '108000' }, ...CATEGORIES.slice(1)]
    expect(mouvementsVentilesDesynchronises(ECRITURE_TELEPHONE, [VENTILE], PARTS_TELEPHONE, bilan, TRESORERIE).map((l) => l.id)).toEqual(['l1'])
  })

  it('en engagement, la part personnelle attendue est sur le compte du dirigeant choisi', () => {
    expect(mouvementsVentilesDesynchronises(ECRITURE_TELEPHONE, [VENTILE], PARTS_TELEPHONE, CATEGORIES, ENGAGEMENT_SOCIETE).map((l) => l.id)).toEqual(['l1'])
    const au455 = ECRITURE_TELEPHONE.map((e) => e.compte === '108000' ? { ...e, compte: '455000' } : e)
    expect(mouvementsVentilesDesynchronises(au455, [VENTILE], PARTS_TELEPHONE, CATEGORIES, ENGAGEMENT_SOCIETE)).toEqual([])
  })

  it('ne juge pas ce qu’il n’a pas lu : une catégorie absente de la liste écarte le mouvement', () => {
    expect(mouvementsVentilesDesynchronises([], [VENTILE], PARTS_TELEPHONE, CATEGORIES.filter((c) => c.id !== 'cat-tel'), TRESORERIE)).toEqual([])
  })

  it('ne redit pas une ventilation incohérente, ni un mouvement qui n’est pas ventilé', () => {
    expect(mouvementsVentilesDesynchronises([], [VENTILE], [PARTS_TELEPHONE[0]], CATEGORIES, TRESORERIE)).toEqual([])
    expect(mouvementsVentilesDesynchronises([], [mouvement({ statut: 'rapprochee', categorie_id: 'cat-tel' })], [], CATEGORIES, TRESORERIE)).toEqual([])
  })

  it('les écritures d’une pièce sur le même mouvement ne comptent pas', () => {
    // La contrepartie banque d'une pièce désigne aussi un mouvement : elle appartient à la pièce.
    const avecPiece = [...ECRITURE_TELEPHONE, ecriture({ id: 'p', piece_id: 'p1', compte: '512000', sens: 'credit', montant: 120 })]
    expect(mouvementsVentilesDesynchronises(avecPiece, [VENTILE], PARTS_TELEPHONE, CATEGORIES, TRESORERIE)).toEqual([])
  })
})
