import { describe, expect, it } from 'vitest'
import {
  calculerDeclaration2035, dotationPourAnnee, dotationsNonProratisees, RESERVE_PRORATA_TEMPORIS,
  csgDeductible, partCsgNonDeductible,
  POSTE_AMORTISSEMENTS, POSTE_COTISATIONS, POSTE_CSG_DEDUCTIBLE, POSTE_INDEMNITES_KM,
} from './declaration2035'
import type { Categorie, CotisationDeclaree, Immobilisation, LigneBancaire, Piece, VehiculeDossier, VentilationBancaire } from './types'
import { partsDuReleve, type PartDuReleve } from './partsDuReleve'

const categories = [
  { id: 'c-achats', poste_2035: 'Achats' },
  { id: 'c-loyer', poste_2035: 'Loyers et charges locatives' },
  { id: 'c-recettes', poste_2035: 'Recettes' },
  { id: 'c-sans-poste', poste_2035: null },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10',
    montant_ht: 100, montant_ttc: 120, categorie_id: 'c-achats', ...o,
  }) as Piece

const calcul = (o: {
  pieces?: Piece[]; immos?: Immobilisation[]; cotis?: CotisationDeclaree[]; annee?: number
  vehicules?: VehiculeDossier[]; paiements?: LigneBancaire[]; mouvements?: PartDuReleve[]
}) => calculerDeclaration2035(
  o.annee ?? 2025, o.pieces ?? [], categories, o.immos ?? [], o.cotis ?? [], o.vehicules ?? [], true,
  o.paiements ?? [], o.mouvements ?? [],
)

const vehicule = (o: Partial<VehiculeDossier>): VehiculeDossier =>
  ({
    id: 'v', annee: 2025, type: 'voiture', puissance_fiscale: 6, motorisation: 'thermique',
    km_professionnel: 4000, ...o,
  }) as VehiculeDossier

describe('calculerDeclaration2035 — périmètre', () => {
  it('ne retient que les pièces validées', () => {
    // Une pièce « à valider » n'est pas encore relue par le cabinet : la faire entrer dans une
    // déclaration fiscale reviendrait à déclarer ce que l'OCR a cru lire.
    const d = calcul({ pieces: [piece({ id: 'a', statut: 'a_valider' }), piece({ id: 'b' })] })
    expect(d.depenses[0].nbPieces).toBe(1)
    expect(d.totalDepenses).toBe(100)
  })

  it('ne retient que l’exercice demandé', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', date_piece: '2024-12-31' }), piece({ id: 'b', date_piece: '2025-01-01' })],
    })
    expect(d.totalDepenses).toBe(100)
    // Une pièce d'un autre exercice n'est pas une anomalie : elle ne doit pas être signalée.
    expect(d.exclusions.sansDate).toHaveLength(0)
    expect(d.exclusions.sansPoste).toHaveLength(0)
  })

  // Un dossier EXONÉRÉ ne récupère pas la TVA : elle fait partie de sa dépense
  // (BOI-BNC-BASE-40-60-20 § 90), et l'option hors taxes n'est ouverte qu'aux assujettis
  // (BOI-BNC-BASE-20-10-30 § 60). Mesuré sur le dossier d'une infirmière : 852,00 € déclarés pour
  // 1 022,40 € payés, soit 170,40 € de dépenses absentes d'une 2035 signée.
  it('retient le TTC pour un dossier exonéré, TVA comprise', () => {
    const pieces = [piece({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 })]
    const exonere = calculerDeclaration2035(2025, pieces, categories, [], [], [], false, [], [])
    expect(exonere.totalDepenses).toBe(120)
    // Le garde symétrique : l'assujetti garde le hors taxes.
    expect(calcul({ pieces }).totalDepenses).toBe(100)
  })

  it('préfère le montant HT au TTC', () => {
    // Le 2035 se déclare hors taxe quand la TVA est récupérable. Prendre le TTC gonflerait la charge
    // du montant de la TVA, qui est déjà suivie à part.
    const d = calcul({ pieces: [piece({ montant_ht: 100, montant_ttc: 120 })] })
    expect(d.totalDepenses).toBe(100)
  })

  it('retombe sur le TTC quand le HT est absent', () => {
    const d = calcul({ pieces: [piece({ montant_ht: null, montant_ttc: 120 })] })
    expect(d.totalDepenses).toBe(120)
  })
})

describe('calculerDeclaration2035 — ce qui est écarté est dit', () => {
  it('remonte une pièce dont la catégorie n’a pas de poste 2035', () => {
    // Le défaut le plus grave que ce moteur corrige : l'ancien calcul l'écartait par un `continue`
    // muet. Une pièce validée, datée, chiffrée, mais absente du total sans que rien ne l'indique.
    const orpheline = piece({ id: 'orpheline', categorie_id: 'c-sans-poste' })
    const d = calcul({ pieces: [piece({ id: 'ok' }), orpheline] })
    expect(d.totalDepenses).toBe(100)
    expect(d.exclusions.sansPoste.map((p) => p.id)).toEqual(['orpheline'])
  })

  it('remonte une pièce sans catégorie du tout', () => {
    const d = calcul({ pieces: [piece({ id: 'nue', categorie_id: null })] })
    expect(d.exclusions.sansPoste.map((p) => p.id)).toEqual(['nue'])
  })

  it('remonte une pièce sans date, sans la confondre avec un autre exercice', () => {
    const d = calcul({ pieces: [piece({ id: 'sansdate', date_piece: null })] })
    expect(d.exclusions.sansDate.map((p) => p.id)).toEqual(['sansdate'])
    expect(d.totalDepenses).toBe(0)
  })

  it('remonte une pièce sans montant lisible', () => {
    const d = calcul({ pieces: [piece({ id: 'vide', montant_ht: null, montant_ttc: null })] })
    expect(d.exclusions.sansMontant.map((p) => p.id)).toEqual(['vide'])
  })
})

// Un mouvement rapproché d'une pièce : c'est lui qui la date (lib/rattachement.ts).
const paiement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2026-01-05', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
  piece_id: 'p', cotisation_id: null, categorie_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, id_externe: null,
  created_at: '2026-01-06T09:00:00Z', ...o,
})

describe("calculerDeclaration2035 — l'exercice est celui du paiement", () => {
  // CGI, art. 93 : les recettes encaissées et les dépenses payées au cours de l'année. Le moteur
  // lisait `anneeDe(date_piece)` — une facture de décembre réglée en janvier partait dans la
  // déclaration de l'année d'avant.
  const decembre = piece({ id: 'dec', date_piece: '2025-12-20' })
  const regleeEnJanvier = paiement({ piece_id: 'dec', date: '2026-01-05' })

  it("compte une facture de décembre réglée en janvier dans l'exercice du paiement", () => {
    expect(calcul({ annee: 2025, pieces: [decembre], paiements: [regleeEnJanvier] }).totalDepenses).toBe(0)
    expect(calcul({ annee: 2026, pieces: [decembre], paiements: [regleeEnJanvier] }).totalDepenses).toBe(100)
  })

  it('compte une recette dans l’exercice de son encaissement', () => {
    const recette = piece({ id: 'rec', type_piece: 'vente', categorie_id: 'c-recettes', date_piece: '2025-12-30', montant_ht: 500, montant_ttc: 500 })
    const encaissee = paiement({ piece_id: 'rec', date: '2026-01-12', montant: 500 })
    expect(calcul({ annee: 2025, pieces: [recette], paiements: [encaissee] }).totalRecettes).toBe(0)
    expect(calcul({ annee: 2026, pieces: [recette], paiements: [encaissee] }).totalRecettes).toBe(500)
  })

  it("retombe sur la date de facture sans paiement rapproché, et le dit", () => {
    const d = calcul({ annee: 2025, pieces: [decembre] })
    expect(d.totalDepenses).toBe(100)
    expect(d.sansPaiementConnu.map((s) => [s.piece.id, s.montant])).toEqual([['dec', 100]])
  })

  it('ne tient pas une pièce réglée pour une supposition', () => {
    const d = calcul({ annee: 2026, pieces: [decembre], paiements: [regleeEnJanvier] })
    expect(d.sansPaiementConnu).toEqual([])
  })

  it('ne dit pas « sans paiement » une note de frais, payée hors du compte', () => {
    const note = piece({ id: 'ndf', type_piece: 'note_frais', date_piece: '2025-06-01' })
    const d = calcul({ pieces: [note] })
    expect(d.totalDepenses).toBe(100)
    expect(d.sansPaiementConnu).toEqual([])
  })

  it('ne dit pas « sans paiement » une pièce écartée : elle ne compte pas du tout', () => {
    const d = calcul({ pieces: [piece({ id: 'orpheline', categorie_id: 'c-sans-poste' })] })
    expect(d.exclusions.sansPoste.map((p) => p.id)).toEqual(['orpheline'])
    expect(d.sansPaiementConnu).toEqual([])
  })

  it('date par son paiement une pièce sans date de facture, au lieu de l’écarter', () => {
    const sansDate = piece({ id: 'sd', date_piece: null })
    const d = calcul({ annee: 2026, pieces: [sansDate], paiements: [paiement({ piece_id: 'sd' })] })
    expect(d.totalDepenses).toBe(100)
    expect(d.exclusions.sansDate).toEqual([])
  })

  it('partage un paiement partiel : la part payée au paiement, le reste à la facture', () => {
    // 120 € de pièce, 48 € rapprochés en janvier : 40 % en 2026, 60 % en 2025 à la date de facture.
    const partiel = paiement({ piece_id: 'dec', montant: -48 })
    const en2025 = calcul({ annee: 2025, pieces: [decembre], paiements: [partiel] })
    const en2026 = calcul({ annee: 2026, pieces: [decembre], paiements: [partiel] })
    expect(en2025.totalDepenses).toBe(60)
    expect(en2026.totalDepenses).toBe(40)
    expect(en2025.sansPaiementConnu.map((s) => [s.piece.id, s.montant])).toEqual([['dec', 60]])
    expect(en2026.sansPaiementConnu).toEqual([])
  })

  it('ne se laisse pas dater par un mouvement qui n’est plus rapproché', () => {
    const remis = paiement({ piece_id: 'dec', statut: 'non_rapprochee' })
    expect(calcul({ annee: 2025, pieces: [decembre], paiements: [remis] }).totalDepenses).toBe(100)
  })
})

describe('calculerDeclaration2035 — totaux et résultat', () => {
  it('sépare recettes et dépenses, et calcule le résultat', () => {
    const d = calcul({
      pieces: [
        piece({ id: 'v', type_piece: 'vente', categorie_id: 'c-recettes', montant_ht: 1000 }),
        piece({ id: 'a', montant_ht: 300 }),
        piece({ id: 'l', categorie_id: 'c-loyer', montant_ht: 200 }),
      ],
    })
    expect(d.totalRecettes).toBe(1000)
    expect(d.totalDepenses).toBe(500)
    expect(d.resultat).toBe(500)
  })

  it('rend un résultat négatif en cas de déficit', () => {
    // Bénéfice et déficit ne vont pas dans la même case du formulaire : le moteur doit rendre le
    // signe, pas une valeur absolue que le consommateur devrait réinterpréter.
    const d = calcul({ pieces: [piece({ id: 'a', montant_ht: 800 })] })
    expect(d.resultat).toBe(-800)
  })

  it('rend des montants toujours positifs, le sens étant porté par `nature`', () => {
    const d = calcul({ pieces: [piece({ id: 'a', montant_ht: 300 })] })
    expect(d.depenses[0].montant).toBe(300)
    expect(d.depenses[0].nature).toBe('depense')
  })

  it('soustrait un avoir du poste plutôt que d’en faire une recette', () => {
    // Un montant négatif (avoir, remboursement fournisseur) diminue la charge ; en faire une recette
    // gonflerait à la fois les produits et les charges.
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 300 }), piece({ id: 'avoir', montant_ht: -100 })],
    })
    expect(d.totalDepenses).toBe(200)
    expect(d.totalRecettes).toBe(0)
  })

  it('cumule plusieurs pièces sur un même poste et les compte', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 100 }), piece({ id: 'b', montant_ht: 50 })],
    })
    expect(d.depenses).toHaveLength(1)
    expect(d.depenses[0].montant).toBe(150)
    expect(d.depenses[0].nbPieces).toBe(2)
  })

  it('classe les postes du plus gros au plus petit', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 100 }), piece({ id: 'l', categorie_id: 'c-loyer', montant_ht: 900 })],
    })
    expect(d.depenses.map((l) => l.poste)).toEqual(['Loyers et charges locatives', 'Achats'])
  })
})

describe('calculerDeclaration2035 — les mouvements du relevé affectés sans justificatif', () => {
  // Le cas qui a ouvert le chantier (ligne 26.6) : un infirmier ne transmet pas ses bordereaux, donc
  // ses recettes ne sont QUE des virements de l'Assurance maladie sur le relevé. Sans eux, sa 2035
  // n'avait presque pas de recettes.
  const categoriesDuReleve = [
    { id: 'c-recettes', compte_comptable: '706000', poste_2035: 'Recettes' },
    { id: 'c-achats', compte_comptable: '606400', poste_2035: 'Achats' },
    { id: 'c-frais', compte_comptable: '627000', poste_2035: 'Frais financiers' },
    { id: 'c-sans-poste', compte_comptable: '628000', poste_2035: null },
    { id: 'c-bilan', compte_comptable: '108000', poste_2035: 'Recettes' },
  ] as Categorie[]
  const affecte = (o: Partial<LigneBancaire>): LigneBancaire =>
    paiement({ piece_id: null, categorie_id: 'c-frais', date: '2025-03-12', ...o })
  const releve = (...lignes: LigneBancaire[]) => partsDuReleve(lignes, categoriesDuReleve, [])

  it('compte un encaissement affecté en recette, sans en faire une pièce', () => {
    const d = calcul({ mouvements: releve(affecte({ id: 'cpam', categorie_id: 'c-recettes', montant: 250 })) })
    expect(d.totalRecettes).toBe(250)
    expect(d.resultat).toBe(250)
    expect(d.recettes).toEqual([{ poste: 'Recettes', nature: 'recette', montant: 250, nbPieces: 0, nbMouvements: 1 }])
  })

  it('le compte l’année de sa date, et ne dit rien d’un mouvement d’un autre exercice', () => {
    const mouvements = releve(
      affecte({ id: 'cpam', categorie_id: 'c-recettes', date: '2024-12-31', montant: 250 }),
      affecte({ id: 'orphelin', categorie_id: 'c-sans-poste', date: '2024-12-30' }),
    )
    expect(calcul({ annee: 2025, mouvements }).totalRecettes).toBe(0)
    expect(calcul({ annee: 2025, mouvements }).exclusions.mouvementsSansPoste).toEqual([])
    expect(calcul({ annee: 2024, mouvements }).totalRecettes).toBe(250)
  })

  it('ajoute une dépense du relevé au poste de ses pièces, chacune comptée à part', () => {
    const d = calcul({
      pieces: [piece({ id: 'a', montant_ht: 100 })],
      mouvements: releve(affecte({ id: 'carte', categorie_id: 'c-achats', montant: -30 })),
    })
    expect(d.depenses).toEqual([{ poste: 'Achats', nature: 'depense', montant: 130, nbPieces: 1, nbMouvements: 1 }])
  })

  it('un remboursement reçu diminue sa charge au lieu de devenir une recette', () => {
    const d = calcul({
      mouvements: releve(affecte({ id: 'frais', montant: -8.5 }), affecte({ id: 'geste', montant: 3 })),
    })
    expect(d.totalDepenses).toBe(5.5)
    expect(d.totalRecettes).toBe(0)
  })

  it('un rejet de virement diminue les recettes', () => {
    const d = calcul({
      mouvements: releve(
        affecte({ id: 'cpam', categorie_id: 'c-recettes', montant: 250 }),
        affecte({ id: 'rejet', categorie_id: 'c-recettes', montant: -40 }),
      ),
    })
    expect(d.totalRecettes).toBe(210)
    expect(d.totalDepenses).toBe(0)
  })

  it('dit un mouvement dont la catégorie n’a pas de poste, sans le compter', () => {
    const d = calcul({ mouvements: releve(affecte({ id: 'x', categorie_id: 'c-sans-poste' })) })
    expect(d.exclusions.mouvementsSansPoste.map((m) => m.ligne.id)).toEqual(['x'])
    expect(d.totalDepenses).toBe(0)
  })

  it('dit un mouvement dont la catégorie a quitté les comptes de résultat, même avec un poste', () => {
    // Le poste dit « Recettes », le compte dit 108 : sans nature, le mouvement n'est ni l'un ni
    // l'autre, et le compter sur son poste le ferait entrer dans les recettes par la catégorie.
    const d = calcul({ mouvements: releve(affecte({ id: 'y', categorie_id: 'c-bilan', montant: 500 })) })
    expect(d.exclusions.mouvementsHorsResultat.map((m) => m.ligne.id)).toEqual(['y'])
    expect(d.exclusions.mouvementsSansPoste).toEqual([])
    expect(d.totalRecettes).toBe(0)
  })
})

describe('calculerDeclaration2035 — les échéances d’emprunt rapprochées', () => {
  // Le prélèvement mensuel d'un prêt : les intérêts sont une charge financière (ligne 31), l'assurance
  // une prime (total BH), le capital un remboursement de dette qui n'entre pas dans le résultat.
  const categoriesDuReleve = [{ id: 'c-frais', compte_comptable: '627000', poste_2035: 'Frais financiers' }] as Categorie[]
  const echeance = (o: Partial<LigneBancaire> = {}): LigneBancaire => paiement({
    piece_id: null, date: '2025-03-06', montant: -540, emprunt_id: 'emp1', emprunt_echeance: 2,
    emprunt_interets: 36, emprunt_assurance: 21.03, ...o,
  })
  const releve = (...lignes: LigneBancaire[]) => partsDuReleve(lignes, categoriesDuReleve, [])

  it('compte les intérêts en frais financiers et l’assurance en primes, jamais le capital', () => {
    const d = calcul({ mouvements: releve(echeance()) })
    expect(d.depenses).toEqual([
      { poste: 'Frais financiers', nature: 'depense', montant: 36, nbPieces: 0, nbMouvements: 1 },
      { poste: "Primes d'assurance", nature: 'depense', montant: 21.03, nbPieces: 0, nbMouvements: 1 },
    ])
    expect(d.totalDepenses).toBe(57.03)
    expect(d.totalRecettes).toBe(0)
  })

  it('les intérêts rejoignent les frais bancaires affectés sur la même ligne', () => {
    const d = calcul({
      mouvements: releve(echeance(), paiement({ id: 'frais', piece_id: null, categorie_id: 'c-frais', date: '2025-03-12', montant: -8.5 })),
    })
    expect(d.depenses.find((l) => l.poste === 'Frais financiers'))
      .toEqual({ poste: 'Frais financiers', nature: 'depense', montant: 44.5, nbPieces: 0, nbMouvements: 2 })
  })

  it('à la date du prélèvement, pas à celle de l’échéance', () => {
    const mouvements = releve(echeance({ date: '2026-01-04', emprunt_echeance: 12 }))
    expect(calcul({ annee: 2025, mouvements }).totalDepenses).toBe(0)
    expect(calcul({ annee: 2026, mouvements }).totalDepenses).toBe(57.03)
  })

  it('ni le déblocage ni une échéance qui n’est pas rapprochée', () => {
    const d = calcul({
      mouvements: releve(
        echeance({ id: 'deblocage', montant: 12000, emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 }),
        echeance({ id: 'a-traiter', statut: 'non_rapprochee' }),
      ),
    })
    expect(d.totalRecettes).toBe(0)
    expect(d.totalDepenses).toBe(0)
  })
})

describe('calculerDeclaration2035 — les mouvements ventilés sur plusieurs comptes', () => {
  // lib/ventilationBanque.ts : un même paiement dans plusieurs postes, et la part personnelle dans aucun.
  const categoriesDuReleve = [
    { id: 'c-tel', libelle: 'Téléphone', compte_comptable: '626000', poste_2035: 'Frais postaux et de télécommunications' },
    { id: 'c-internet', libelle: 'Internet', compte_comptable: '626100', poste_2035: 'Frais postaux et de télécommunications' },
    { id: 'c-achats', libelle: 'Achats', compte_comptable: '606400', poste_2035: 'Achats' },
    { id: 'c-recettes', libelle: 'Recettes', compte_comptable: '706000', poste_2035: 'Recettes' },
    { id: 'c-frais', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' },
  ] as Categorie[]
  const ventile = (o: Partial<LigneBancaire> = {}): LigneBancaire =>
    paiement({ id: 'v', piece_id: null, ventilee: true, id_externe: null, date: '2025-03-12', montant: -120, ...o })
  const part = (o: Partial<VentilationBancaire>): VentilationBancaire => ({
    id: 'x', dossier_id: 'd1', ligne_bancaire_id: 'v', categorie_id: 'c-tel', part_personnelle: false, montant: -84,
    created_at: '2025-03-12T10:00:00Z', ...o,
  })
  const releve = (lignes: LigneBancaire[], parts: VentilationBancaire[]) => partsDuReleve(lignes, categoriesDuReleve, parts)

  it('compte chaque part dans son poste, et jamais la part personnelle', () => {
    const d = calcul({
      mouvements: releve([ventile()], [
        part({ id: 'a', categorie_id: 'c-tel', montant: -84 }),
        part({ id: 'b', categorie_id: null, part_personnelle: true, montant: -36 }),
      ]),
    })
    expect(d.depenses).toEqual([
      { poste: 'Frais postaux et de télécommunications', nature: 'depense', montant: 84, nbPieces: 0, nbMouvements: 1 },
    ])
    expect(d.totalDepenses).toBe(84)
  })

  it('la remise de carte : la recette brute en recettes, la commission en frais financiers', () => {
    const d = calcul({
      mouvements: releve([ventile({ montant: 95 })], [
        part({ id: 'a', categorie_id: 'c-recettes', montant: 100 }),
        part({ id: 'b', categorie_id: 'c-frais', montant: -5 }),
      ]),
    })
    expect(d.totalRecettes).toBe(100)
    expect(d.totalDepenses).toBe(5)
    expect(d.resultat).toBe(95)
  })

  it('un mouvement ventilé sur deux catégories du même poste y compte UNE fois', () => {
    const d = calcul({
      mouvements: releve([ventile()], [
        part({ id: 'a', categorie_id: 'c-tel', montant: -84 }),
        part({ id: 'b', categorie_id: 'c-internet', montant: -36 }),
      ]),
    })
    expect(d.depenses).toEqual([
      { poste: 'Frais postaux et de télécommunications', nature: 'depense', montant: 120, nbPieces: 0, nbMouvements: 1 },
    ])
  })

  it('l’année du mouvement, et rien d’un mouvement qui n’est pas ventilé', () => {
    const parts = [part({ id: 'a', categorie_id: 'c-achats', montant: -84 }), part({ id: 'b', categorie_id: 'c-tel', montant: -36 })]
    expect(calcul({ annee: 2025, mouvements: releve([ventile({ date: '2026-01-02' })], parts) }).totalDepenses).toBe(0)
    expect(calcul({ annee: 2026, mouvements: releve([ventile({ date: '2026-01-02' })], parts) }).totalDepenses).toBe(120)
    expect(calcul({ mouvements: releve([ventile({ ventilee: false, id_externe: null, statut: 'non_rapprochee' })], parts) }).totalDepenses).toBe(0)
  })
})

describe('amortissements et cotisations', () => {
  const immo = (o: Partial<Immobilisation>): Immobilisation =>
    ({ id: 'i', piece_id: null, date_acquisition: '2024-06-01', valeur: 3000, duree_annees: 3, ...o }) as Immobilisation

  it('compte la dotation sur chaque année de la durée, pas seulement l’année d’achat', () => {
    expect(dotationPourAnnee(immo({}), 2024)).toBe(1000)
    expect(dotationPourAnnee(immo({}), 2025)).toBe(1000)
    expect(dotationPourAnnee(immo({}), 2026)).toBe(1000)
  })

  it('ne compte rien avant l’acquisition ni après la fin de la durée', () => {
    expect(dotationPourAnnee(immo({}), 2023)).toBe(0)
    expect(dotationPourAnnee(immo({}), 2027)).toBe(0)
  })

  it('ajoute la dotation comme dépense sur son propre poste', () => {
    const d = calcul({ immos: [immo({})] })
    expect(d.depenses.find((l) => l.poste === POSTE_AMORTISSEMENTS)?.montant).toBe(1000)
  })

  it('remplace le montant d’achat d’une pièce immobilisée par sa dotation', () => {
    // Sans ça, un ordinateur à 3 000 € serait compté intégralement en charge l'année de l'achat ET
    // amorti sur trois ans — la dépense apparaîtrait deux fois.
    const d = calcul({
      pieces: [piece({ id: 'ordi', montant_ht: 3000 })],
      immos: [immo({ piece_id: 'ordi' })],
    })
    expect(d.depenses.find((l) => l.poste === 'Achats')).toBeUndefined()
    expect(d.totalDepenses).toBe(1000)
  })

  it('retient le montant versé plutôt que l’appel quand il est connu', () => {
    const d = calcul({
      cotis: [{ echeance: '2025-05-05', montant_appele: 500, montant_verse: 480 } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(480)
  })

  it('retombe sur l’appel quand rien n’a encore été versé', () => {
    const d = calcul({
      cotis: [{ echeance: '2025-05-05', montant_appele: 500, montant_verse: null } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(500)
  })

  it('ignore une cotisation d’un autre exercice', () => {
    const d = calcul({
      cotis: [{ echeance: '2024-05-05', montant_appele: 500, montant_verse: 500 } as CotisationDeclaree],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)).toBeUndefined()
  })
})

// LA CSG-CRDS SORT DE LA LIGNE 25, SA PART DÉDUCTIBLE VA EN LIGNE 14 (case BV).
//
// Présentation relevée sur une 2035 réelle déposée par le cabinet : BV remplie, case CC (« Divers à
// réintégrer ») vide, et BT + BZ = BK au centime sans la CSG. Elle est forcée par le formulaire —
// BK et BV entrent tous deux dans le total des lignes 8 à 32, donc la CSG présente dans les deux
// serait déduite deux fois.
describe('calculerDeclaration2035 — la CSG-CRDS ventilée', () => {
  const cotis = (o: Partial<CotisationDeclaree>): CotisationDeclaree =>
    ({ echeance: '2025-05-05', montant_appele: 0, montant_verse: null, montant_csg_crds: null, ...o } as CotisationDeclaree)

  it('retire la CSG-CRDS ENTIÈRE de la ligne 25', () => {
    // 5 000 de cotisation dont 970 de CSG-CRDS : la ligne 25 n'en porte que 4 030. Les 970 entiers
    // sortent — pas seulement la part non déductible : c'est ce que « tout au compte 108 » veut dire.
    const d = calcul({ cotis: [cotis({ montant_verse: 5000, montant_csg_crds: 970 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(4030)
  })

  it('porte les 6,8 points déductibles sur son PROPRE poste', () => {
    const d = calcul({ cotis: [cotis({ montant_verse: 5000, montant_csg_crds: 970 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_CSG_DEDUCTIBLE)?.montant).toBe(680)
  })

  it('ne déduit plus les 2,9 points non déductibles — c’est tout l’objet', () => {
    // Le code TEL QU'IL ÉTAIT déduisait 5 000. Il déduit maintenant 4 030 + 680 = 4 710, soit
    // exactement 290 de moins : la part non déductible de 970.
    const d = calcul({ cotis: [cotis({ montant_verse: 5000, montant_csg_crds: 970 })] })
    expect(d.totalDepenses).toBe(4710)
  })

  it('LAISSE la cotisation entière quand la CSG-CRDS n’est pas saisie', () => {
    // Garde symétrique, et c'est l'état de toute la production : inventer un taux sur le montant
    // total d'un appel donnerait une valeur plausible et fausse.
    const d = calcul({ cotis: [cotis({ montant_verse: 5000 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(5000)
    expect(d.depenses.find((l) => l.poste === POSTE_CSG_DEDUCTIBLE)).toBeUndefined()
  })

  it('ne crée pas de poste BV pour une CSG-CRDS saisie à zéro', () => {
    // Un appel de retraite ventilé à zéro de CSG est un cas réel : une ligne « CSG déductible 0,00 € »
    // sur le formulaire serait du bruit.
    const d = calcul({ cotis: [cotis({ montant_verse: 5000, montant_csg_crds: 0 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(5000)
    expect(d.depenses.find((l) => l.poste === POSTE_CSG_DEDUCTIBLE)).toBeUndefined()
  })

  it('ne retire que la CSG de l’EXERCICE demandé', () => {
    const d = calcul({
      cotis: [
        cotis({ montant_verse: 5000, montant_csg_crds: 970 }),
        cotis({ echeance: '2024-05-05', montant_verse: 9000, montant_csg_crds: 9700 }),
      ],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(4030)
    expect(d.depenses.find((l) => l.poste === POSTE_CSG_DEDUCTIBLE)?.montant).toBe(680)
  })

  it('S’ACCORDE AU CENTIME AVEC L’AVERTISSEMENT DE CLÔTURE', () => {
    // Les deux viennent de `partCsgNonDeductible`, et c'est pour ça : sommer puis arrondir, ou
    // arrondir chaque cotisation puis sommer, ne donnent pas le même centime. L'écran et le
    // formulaire annonceraient alors deux montants différents pour la même chose.
    const lot = [
      cotis({ montant_verse: 1000, montant_csg_crds: 33.33 }),
      cotis({ montant_verse: 1000, montant_csg_crds: 33.33 }),
      cotis({ montant_verse: 1000, montant_csg_crds: 33.34 }),
    ]
    const d = calcul({ cotis: lot })
    const part = partCsgNonDeductible(lot, 2025)!
    expect(d.depenses.find((l) => l.poste === POSTE_CSG_DEDUCTIBLE)?.montant).toBe(part.csgDeductible)
    expect(d.depenses.find((l) => l.poste === POSTE_COTISATIONS)?.montant).toBe(3000 - part.totalCsgCrds)
  })
})

describe('calculerDeclaration2035 — indemnités kilométriques', () => {
  it('porte le total du cadre 7 dans un poste à lui', () => {
    // 4 000 km, 6 CV thermique : l'exemple publié par l'administration, 2 660 €.
    const d = calcul({ vehicules: [vehicule({})] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)?.montant).toBe(2660)
    expect(d.totalDepenses).toBe(2660)
  })

  it('n’emprunte pas le kilométrage d’un autre exercice', () => {
    // L'option pour le forfait se prend au 1er janvier et vaut l'année entière (notice, renvoi 12) :
    // un véhicule saisi pour 2024 n'a rien à faire dans la déclaration 2025.
    const d = calcul({ vehicules: [vehicule({ annee: 2024 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)).toBeUndefined()
    expect(d.indemnitesKilometriques).toBeNull()
  })

  it('additionne les véhicules d’un même exercice', () => {
    const d = calcul({
      vehicules: [vehicule({ id: 'a' }), vehicule({ id: 'b', puissance_fiscale: 3, km_professionnel: 1000 })],
    })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)?.montant).toBe(2660 + 529)
  })

  it('remonte un véhicule non calculé au lieu de le faire disparaître', () => {
    // Absent du total, c'est une déduction perdue que personne ne verrait manquer — et sur le PDF,
    // rien ne distinguerait une case BJ amputée d'une case BJ juste.
    const d = calcul({ vehicules: [vehicule({}), vehicule({ id: 'b', annee: 2023 })], annee: 2023 })
    expect(d.indemnitesKilometriques?.total).toBe(0)
    expect(d.indemnitesKilometriques?.nonCalcules).toHaveLength(1)
    expect(d.indemnitesKilometriques?.nonCalcules[0].motif).toBe('barème non renseigné pour cet exercice')
  })

  it('ne crée pas de poste quand le total est nul', () => {
    // Un véhicule déclaré sans trajet professionnel est un cas réel : il ne doit pas écrire une
    // ligne à zéro dans la déclaration, mais il ne doit pas non plus être signalé comme un défaut.
    const d = calcul({ vehicules: [vehicule({ km_professionnel: 0 })] })
    expect(d.depenses.find((l) => l.poste === POSTE_INDEMNITES_KM)).toBeUndefined()
    expect(d.indemnitesKilometriques).toEqual({ total: 0, nonCalcules: [] })
  })

  it('range un hybride et un véhicule à hydrogène dans la table thermique', () => {
    // Seuls les 100 % électriques ont leur propre table. Confondre les deux vaut 20 % de la
    // déduction — 3 192 € au lieu de 2 660 € sur le même trajet.
    const thermique = calcul({ vehicules: [vehicule({})] }).indemnitesKilometriques?.total
    for (const motorisation of ['hybride', 'hydrogene'] as const) {
      expect(calcul({ vehicules: [vehicule({ motorisation })] }).indemnitesKilometriques?.total)
        .toBe(thermique)
    }
    expect(calcul({ vehicules: [vehicule({ motorisation: 'electrique' })] }).indemnitesKilometriques?.total)
      .toBe(3192)
  })
})

// LA PREMIÈRE ANNUITÉ D'UN BIEN ACQUIS EN COURS D'ANNÉE EST SURÉVALUÉE, ET RIEN NE LE DISAIT.
//
// `dotationPourAnnee` compte la dotation en ENTIER dès l'année d'acquisition, là où l'amortissement
// fiscal se calcule prorata temporis depuis la mise en service. La simplification est assumée et
// écrite dans `types.ts` ; ce qui ne l'était pas, c'est le silence — la réserve ne vivait que dans
// un commentaire de source renvoyant à « le bandeau », qui est le rappel générique « Brouillon »
// affiché sur tous les écrans et ne dit rien de tout cela. `dotationsNonProratisees` la CALCULE,
// pour qu'elle puisse être montrée là où le chiffre est lu — et signé.
//
// Le jeu d'essai est typé SANS `as` : le compilateur vérifie alors chaque champ contre la table,
// exhaustivement, là où un objet nu laisserait passer une colonne inventée ou manquante.
const immobilisation = (o: Partial<Immobilisation> = {}): Immobilisation => ({
  id: 'i-1', dossier_id: 'd-1', piece_id: null, nature_id: null,
  libelle: 'Ordinateur', valeur: 12000, date_acquisition: '2025-01-01', duree_annees: 5,
  created_at: '2025-01-01T09:00:00Z', ...o,
})

describe('dotationsNonProratisees', () => {
  it('se tait sur un bien acquis le 1er janvier', () => {
    // Le garde qui empêche la mise en garde d'être permanente : au 1er janvier la première annuité
    // est bien pleine, il n'y a RIEN à reprendre. Une mise en garde toujours affichée cesse d'être
    // lue, puis emporte ses voisines dans son discrédit.
    expect(dotationsNonProratisees([immobilisation()], 2025)).toEqual([])
  })

  it('chiffre l’écart d’un bien acquis en milieu d’année', () => {
    // 12 000 € sur 5 ans = 2 400 € par an. Acquis le 1er juillet, le prorata temporis (convention
    // 30/360) n'en retient que la moitié : 1 200 €. L'écart de 1 200 € part en déduction sur une
    // déclaration signée, sans que rien ne le signale.
    expect(dotationsNonProratisees([immobilisation({ date_acquisition: '2025-07-01' })], 2025)).toEqual([
      { libelle: 'Ordinateur', dateAcquisition: '2025-07-01', dotationComptee: 2400, dotationProratisee: 1200 },
    ])
  })

  it('va jusqu’au cas extrême — un bien acquis le 31 décembre', () => {
    // Un seul jour d'usage sur l'exercice, et l'application déduit une annuité entière. C'est le cas
    // qui dit le mieux ce que la simplification coûte : 2 400 € comptés pour 6,67 € dus.
    expect(dotationsNonProratisees([immobilisation({ date_acquisition: '2025-12-31' })], 2025)).toEqual([
      { libelle: 'Ordinateur', dateAcquisition: '2025-12-31', dotationComptee: 2400, dotationProratisee: 6.67 },
    ])
  })

  it('arrondit au centime, sur la dotation ET sur le prorata', () => {
    // 10 000 / 3 ne tombe pas juste : sans arrondi, l'écran afficherait 3333.3333333333335.
    expect(dotationsNonProratisees(
      [immobilisation({ valeur: 10000, duree_annees: 3, date_acquisition: '2025-10-01' })], 2025,
    )).toEqual([
      { libelle: 'Ordinateur', dateAcquisition: '2025-10-01', dotationComptee: 3333.33, dotationProratisee: 833.33 },
    ])
  })

  it('ne rend QUE l’année d’acquisition', () => {
    // Les annuités intermédiaires sont justes des deux côtés — une année pleine est une année
    // pleine. Les signaler ferait crier au loup sur quatre exercices au lieu d'un.
    const immo = immobilisation({ date_acquisition: '2025-07-01' })
    expect(dotationsNonProratisees([immo], 2026)).toEqual([])
    expect(dotationsNonProratisees([immo], 2027)).toEqual([])
  })

  it('ne retient que les biens concernés d’un registre mêlé', () => {
    expect(dotationsNonProratisees([
      immobilisation({ id: 'a', libelle: 'Bureau', date_acquisition: '2025-01-01' }),
      immobilisation({ id: 'b', libelle: 'Véhicule', date_acquisition: '2025-04-01' }),
      immobilisation({ id: 'c', libelle: 'Ancien', date_acquisition: '2023-05-01' }),
    ], 2025).map((d) => d.libelle)).toEqual(['Véhicule'])
  })

  it('porte une réserve qui NOMME la conséquence, pas seulement le procédé', () => {
    // Même exigence que `BandeauLecturePartielle` : « lecture partielle » tout seul ne dit pas si
    // c'est grave. Ici il faut que la phrase dise que l'annuité est trop élevée et qu'il reste un
    // reliquat après la durée — sans quoi l'opérateur lit « prorata temporis » et passe.
    expect(RESERVE_PRORATA_TEMPORIS).toContain('prorata temporis')
    expect(RESERVE_PRORATA_TEMPORIS).toContain('trop')
    expect(RESERVE_PRORATA_TEMPORIS).toContain('reliquat')
    expect(RESERVE_PRORATA_TEMPORIS).toContain('signer')
  })
})

// LA CSG-CRDS EST DÉDUITE EN ENTIER, ET 2,9 DE SES 9,7 POINTS NE SONT PAS DÉDUCTIBLES.
//
// Le moteur porte la cotisation COMPLÈTE en case BK (ligne 25). L'application sait pourtant
// ventiler : `montant_csg_crds` existe et l'écran Cotisations le saisit — il affichait même la part
// déductible, avec les deux taux écrits en dur DANS le composant, donc hors de portée des tests et
// invisibles pour le moteur. On signale sans corriger, comme `doublonFraisVehicules`.
const cotisation = (o: Partial<CotisationDeclaree> = {}): CotisationDeclaree => ({
  id: 'c-1', dossier_id: 'd-1', echeance: '2025-03-05',
  montant_appele: 3000, montant_verse: 3000, montant_csg_crds: 970,
  previsionnel: false, created_at: '2025-03-05T09:00:00Z', ...o,
})

describe('partCsgNonDeductible', () => {
  it('se tait quand l’exercice ne porte aucune cotisation', () => {
    // Rien à dire, donc rien à afficher : une mise en garde permanente cesse d'être lue.
    expect(partCsgNonDeductible([], 2025)).toBeNull()
    expect(partCsgNonDeductible([cotisation({ echeance: '2024-03-05' })], 2025)).toBeNull()
  })

  it('chiffre la part à réintégrer', () => {
    // 970 € de CSG-CRDS : 6,8/9,7 déductibles = 680,00 €, donc 290,00 € déduits à tort.
    expect(partCsgNonDeductible([cotisation()], 2025)).toEqual({
      nbVentilees: 1, nbSansVentilation: 0,
      totalCsgCrds: 970, csgDeductible: 680, csgNonDeductible: 290,
    })
  })

  it('les deux parts font toujours EXACTEMENT le total', () => {
    // Ce que ce test garde : la PROPRIÉTÉ (les deux parts somment au total), pas la formule. Il ne
    // distingue PAS la forme par complément de la forme directe sur 2,9/9,7 — mesuré, elles ne
    // diffèrent sur aucun des 20 millions de montants au centime de 0,01 € à 200 000 €. La mutation
    // correspondante ne mord donc pas, et c'est écrit dans le module plutôt que maquillé ici.
    for (const montant of [0.01, 3.33, 99.99, 1234.56, 970, 4567.89]) {
      const part = partCsgNonDeductible([cotisation({ montant_csg_crds: montant })], 2025)!
      expect(part.csgDeductible + part.csgNonDeductible).toBeCloseTo(montant, 10)
    }
  })

  it('compte à part les cotisations SANS ventilation, au lieu de les traiter comme zéro', () => {
    // Le point du contrôle : « pas de CSG saisie » n'est pas « pas de CSG ». Les confondre ferait
    // annoncer « rien à réintégrer » sur un dossier qui n'a jamais renseigné le détail — la famille
    // des lectures dont l'échec ressemble à un résultat vide, appliquée à une saisie.
    expect(partCsgNonDeductible([
      cotisation({ id: 'a' }),
      cotisation({ id: 'b', montant_csg_crds: null }),
      cotisation({ id: 'c', montant_csg_crds: null }),
    ], 2025)).toEqual({
      nbVentilees: 1, nbSansVentilation: 2,
      totalCsgCrds: 970, csgDeductible: 680, csgNonDeductible: 290,
    })
  })

  it('se tait quand la CSG est à zéro sur toutes les cotisations ventilées', () => {
    // Garde SYMÉTRIQUE, et sa première version ne mordait pas : elle posait un exercice SANS
    // cotisation, donc `null`, indistinguable d'un filtre trop large. Un appel de retraite sans
    // ligne de CSG est un cas réel, et il ne doit rien déclencher — c'est lui qui sépare
    // « l'écran avertit quand il faut » de « l'écran avertit toujours ».
    expect(partCsgNonDeductible([cotisation({ montant_csg_crds: 0 })], 2025)).toEqual({
      nbVentilees: 1, nbSansVentilation: 0,
      totalCsgCrds: 0, csgDeductible: 0, csgNonDeductible: 0,
    })
  })

  it('ne retient que les cotisations de l’exercice demandé', () => {
    const part = partCsgNonDeductible([
      cotisation({ id: 'a', echeance: '2025-03-05' }),
      cotisation({ id: 'b', echeance: '2024-03-05' }),
    ], 2025)!
    expect(part.nbVentilees).toBe(1)
    expect(part.totalCsgCrds).toBe(970)
  })

  it('csgDeductible applique 6,8 sur 9,7, arrondi au centime', () => {
    expect(csgDeductible(970)).toBe(680)
    expect(csgDeductible(100)).toBe(70.1)
    expect(csgDeductible(0)).toBe(0)
  })
})
