import { describe, expect, it } from 'vitest'
import { ecritureDuMouvement } from './affectationBanque'
import {
  envoisDuLot, justificatifPossible, REFUS_REGLE_SANS_TAUX, libelleCorrespond, motDistinctif, motifPropose, mouvementATraiter, mouvementsCouverts,
  normaliserPourRegle,
  planAffectationParRegles, refusMotif, regleApplicable, sensDuMouvement, TAILLE_ENVOI_AFFECTATION, totauxParCategorie,
} from './reglesAffectation'
import type { Categorie, CotisationDeclaree, LigneBancaire, Piece, RegleAffectationBancaire } from './types'

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV SEPA TRANSMEDICAL ECH/150325', montant: -38.4,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    source_fichier: 'releve-2025.csv', libelle_brut: null, created_at: '2025-04-01T10:00:00Z', ...o,
  }
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2025-03-01', tiers: 'Transmedical',
    montant_ht: 38.4, montant_tva: 0, montant_ttc: 38.4, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
    created_at: '2025-03-02T09:00:00Z', updated_at: '2025-03-02T09:00:00Z', ...o,
  }
}

function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'c1', dossier_id: 'd1', echeance: '2025-03-05', montant_appele: 412, montant_verse: null,
    montant_csg_crds: null, previsionnel: false, created_at: '2025-01-10T09:00:00Z', paiement_personnel_le: null, ...o,
  }
}

function categorie(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-honoraires', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 60,
    compte_comptable: '622600', poste_2035: 'Honoraires ne constituant pas des rétrocessions', ...o,
  }
}

function regle(o: Partial<RegleAffectationBancaire> = {}): RegleAffectationBancaire {
  return {
    id: 'r1', dossier_id: 'd1', motif: 'transmedical', sens: 'decaissement', categorie_id: 'cat-honoraires',
    taux_tva: null, created_at: '2025-04-02T10:00:00Z', ...o,
  }
}

const RECETTES = categorie({ id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 80, compte_comptable: '706000', poste_2035: 'Recettes' })
const FRAIS = categorie({ id: 'cat-frais', code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70, compte_comptable: '627000', poste_2035: 'Frais financiers' })
const HONORAIRES = categorie()
const aucunJustificatif = () => null

describe('normaliserPourRegle — la forme d’un motif enregistré et d’un libellé comparé', () => {
  it('minuscules sans accents, ponctuation ramenée à une espace', () => {
    expect(normaliserPourRegle('  VIR SEPA REÇU /DE CPAM Bouches-du-Rhône  ')).toBe('vir sepa recu de cpam bouches du rhone')
  })

  it('recolle un sigle pointé au lieu de le faire exploser en lettres isolées', () => {
    expect(normaliserPourRegle('PRLV SEPA C.A.R.P.I.M.K.O ECH')).toBe('prlv sepa carpimko ech')
  })
})

describe('libelleCorrespond — le motif se cherche en DÉBUT de mot', () => {
  it('trouve le motif au début d’un mot, et accepte un mot coupé par le relevé', () => {
    expect(libelleCorrespond('prlv sepa transmedical ech', 'transmedical')).toBe(true)
    expect(libelleCorrespond('prlv sepa transmedical ech', 'transmed')).toBe(true)
    expect(libelleCorrespond('vir recu de cpam bouches du rhone', 'cpam bouches')).toBe(true)
  })

  it('ne trouve pas un motif au milieu d’un autre mot', () => {
    expect(libelleCorrespond('vir transfert interne', 'sfr')).toBe(false)
    expect(libelleCorrespond('cb carrefour', 'four')).toBe(false)
  })

  it('un motif vide ne désigne rien', () => {
    expect(libelleCorrespond('frais tenue de compte', '')).toBe(false)
  })
})

describe('motDistinctif et refusMotif — un motif doit nommer un tiers', () => {
  it('trois lettres suffisent à un nom, jamais à un code d’opération', () => {
    expect(motDistinctif('edf')).toBe(true)
    expect(motDistinctif('cb')).toBe(false)
    expect(motDistinctif('prlv')).toBe(false)
    expect(motDistinctif('sepa')).toBe(false)
    expect(motDistinctif('sarl')).toBe(false)
  })

  it('cinq chiffres au moins pour une référence, six caractères pour un identifiant mêlé', () => {
    expect(motDistinctif('2025')).toBe(false)
    expect(motDistinctif('12345')).toBe(true)
    expect(motDistinctif('fr12z')).toBe(false)
    expect(motDistinctif('fr12zzz123456')).toBe(true)
  })

  it('refuse un motif vide, fait de mots de relevé, ou de moins de cinq chiffres', () => {
    expect(refusMotif('')).toMatch(/Indique un mot/)
    expect(refusMotif('  / ')).toMatch(/Indique un mot/)
    expect(refusMotif('PRLV SEPA')).toMatch(/type d’opération/)
    expect(refusMotif('2025')).toMatch(/type d’opération/)
    expect(refusMotif('12 34 5')).toMatch(/type d’opération/)
  })

  it('accepte un nom, même noyé dans des mots de relevé, et le juge sous sa forme normalisée', () => {
    expect(refusMotif('prlv sepa transmedical')).toBeNull()
    expect(refusMotif('CPAM')).toBeNull()
    expect(refusMotif('12345')).toBeNull()
  })
})

describe('motifPropose — un point de départ, jamais une décision', () => {
  it('le premier mot distinctif du libellé', () => {
    expect(motifPropose(ligne(), [])).toBe('transmedical')
    expect(motifPropose(ligne({ libelle: 'VIR SEPA RECU /DE CPAM BOUCHES DU RHONE', montant: 48.2 }), [])).toBe('cpam')
    expect(motifPropose(ligne({ libelle: 'PRLV SEPA C.A.R.P.I.M.K.O' }), [])).toBe('carpimko')
  })

  it('lit le libellé brut quand l’import n’a gardé que le générique', () => {
    expect(motifPropose(ligne({ libelle: 'Mouvement bancaire', libelle_brut: '12/03/2025 | FRAIS TENUE DE COMPTE | -8,50' }), [])).toBe('frais')
  })

  it('ne propose rien quand aucun mot ne nomme personne', () => {
    expect(motifPropose(ligne({ libelle: 'PRLV SEPA' }), [])).toBeNull()
  })

  it('une référence seule : le plus long début commun à TOUTE sa famille', () => {
    const lignes = [
      ligne({ id: 'a', libelle: '8812345670001111', montant: 120 }),
      ligne({ id: 'b', libelle: '8812345670002222', montant: 80 }),
      ligne({ id: 'c', libelle: '8812399990003333', montant: 60 }),
    ]
    // Les trois partagent « 88123 » ; « 8812345670 » n'est commun qu'à deux d'entre elles. Le début
    // proposé est celui de la famille ENTIÈRE, pas de la paire la plus proche.
    expect(motifPropose(lignes[0], lignes)).toBe('88123')
    expect(motifPropose(lignes[0], lignes.slice(0, 2))).toBe('881234567000')
  })

  it('deux références qui ne partagent que quatre chiffres ne forment pas une famille', () => {
    // Quatre chiffres se retrouvent par hasard dans une date ou un montant, et la base refuse un motif de
    // chiffres seuls plus court que cinq : proposer « 8812 » serait proposer un motif qu'on ne peut pas retenir.
    const a = ligne({ id: 'a', libelle: '8812345670001111', montant: 120 })
    const b = ligne({ id: 'b', libelle: '8812999990002222', montant: 80 })
    expect(motifPropose(a, [a, b])).toBeNull()
  })

  it('une référence sans famille ne propose rien, et la famille ne se cherche que dans le même sens', () => {
    const encaissement = ligne({ id: 'a', libelle: '8812345670001111', montant: 120 })
    const paiement = ligne({ id: 'b', libelle: '8812345670002222', montant: -80 })
    expect(motifPropose(encaissement, [encaissement])).toBeNull()
    expect(motifPropose(encaissement, [encaissement, paiement])).toBeNull()
  })
})

describe('mouvementATraiter — ce que le lot peut affecter', () => {
  it('à traiter seulement, jamais un virement personnel ni un mouvement de zéro euro', () => {
    expect(mouvementATraiter(ligne())).toBe(true)
    expect(mouvementATraiter(ligne({ statut: 'ignoree' }))).toBe(false)
    expect(mouvementATraiter(ligne({ statut: 'rapprochee', piece_id: 'p1' }))).toBe(false)
    // Défensif : l'écran classe un virement personnel « ignoré », mais la marque seule doit suffire à
    // l'écarter — la base refuserait de l'affecter, et le lot entier avec lui.
    expect(mouvementATraiter(ligne({ prelevement_personnel: true }))).toBe(false)
    expect(mouvementATraiter(ligne({ montant: 0 }))).toBe(false)
  })
})

describe('mouvementsCouverts — ce qu’une règle nouvelle proposerait', () => {
  it('les seuls mouvements à traiter, du même sens, que le motif désigne', () => {
    const lignes = [
      ligne({ id: 'a' }),
      ligne({ id: 'b', libelle: 'PRLV SEPA TRANSMEDICAL ECH/150425' }),
      ligne({ id: 'c', montant: 38.4 }),
      ligne({ id: 'd', statut: 'rapprochee', categorie_id: 'cat-honoraires' }),
      ligne({ id: 'e', statut: 'ignoree' }),
      ligne({ id: 'f', statut: 'ignoree', prelevement_personnel: true }),
      ligne({ id: 'g', montant: 0 }),
      ligne({ id: 'h', libelle: 'PRLV SEPA SWISSLIFE' }),
    ]
    expect(mouvementsCouverts('TRANSMEDICAL', 'decaissement', lignes).map((l) => l.id)).toEqual(['a', 'b'])
    expect(mouvementsCouverts('', 'decaissement', lignes)).toEqual([])
  })
})

describe('regleApplicable — une règle, plusieurs, ou un conflit', () => {
  it('aucune : pas de motif, l’autre sens, ou zéro euro', () => {
    expect(regleApplicable(ligne({ libelle: 'PRLV SEPA SWISSLIFE' }), [regle()])).toEqual({ etat: 'aucune' })
    expect(regleApplicable(ligne({ montant: 38.4 }), [regle()])).toEqual({ etat: 'aucune' })
    expect(regleApplicable(ligne({ montant: 0 }), [regle({ sens: 'encaissement' }), regle()])).toEqual({ etat: 'aucune' })
  })

  it('une seule règle : proposée', () => {
    const r = regle()
    expect(regleApplicable(ligne(), [r])).toEqual({ etat: 'proposee', regle: r })
  })

  it('plusieurs règles d’accord sur la catégorie : la plus précise est montrée', () => {
    const large = regle({ id: 'r1', motif: 'transmedical' })
    const precise = regle({ id: 'r2', motif: 'sepa transmedical' })
    expect(regleApplicable(ligne(), [large, precise])).toEqual({ etat: 'proposee', regle: precise })
  })

  it('d’accord sans que l’une contienne l’autre : aucun conflit, la plus longue est montrée', () => {
    const cpam = regle({ id: 'r1', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes' })
    const soins = regle({ id: 'r2', motif: 'soins', sens: 'encaissement', categorie_id: 'cat-recettes' })
    expect(regleApplicable(ligne({ libelle: 'VIR CPAM 13 SOINS', montant: 48.2 }), [cpam, soins]))
      .toEqual({ etat: 'proposee', regle: soins })
  })

  it('en désaccord, la plus précise l’emporte quand elle CONTIENT les autres', () => {
    const large = regle({ id: 'r1', motif: 'amazon', categorie_id: 'cat-achats' })
    const precise = regle({ id: 'r2', motif: 'amazon prime', categorie_id: 'cat-autre' })
    expect(regleApplicable(ligne({ libelle: 'CB AMAZON PRIME 12/03' }), [large, precise])).toEqual({ etat: 'proposee', regle: precise })
  })

  it('en désaccord sans que l’une contienne l’autre : aucune n’est proposée', () => {
    const cpam = regle({ id: 'r1', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes' })
    const bouches = regle({ id: 'r2', motif: 'bouches', sens: 'encaissement', categorie_id: 'cat-frais' })
    expect(regleApplicable(ligne({ libelle: 'VIR CPAM BOUCHES DU RHONE', montant: 48.2 }), [cpam, bouches]))
      .toEqual({ etat: 'conflit', regles: [cpam, bouches] })
  })
})

describe('planAffectationParRegles — ce que « Affecter les N » écrirait', () => {
  const regles = [
    regle(),
    regle({ id: 'r2', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes' }),
    regle({ id: 'r3', motif: 'frais', categorie_id: 'cat-frais' }),
  ]

  it('propose les mouvements à traiter qu’une règle désigne, et rien d’autre', () => {
    const lignes = [
      ligne({ id: 'a' }),
      ligne({ id: 'b', libelle: 'VIR CPAM 13', montant: 48.2 }),
      ligne({ id: 'c', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5 }),
      ligne({ id: 'd', libelle: 'PRLV SEPA SWISSLIFE' }),
      ligne({ id: 'e', statut: 'rapprochee', piece_id: 'p1' }),
      ligne({ id: 'f', statut: 'ignoree' }),
    ]
    const plan = planAffectationParRegles(lignes, regles, [HONORAIRES, RECETTES, FRAIS], false, aucunJustificatif)
    expect(plan.propositions.map((p) => `${p.ligne.id}:${p.categorie.id}:${p.regle.id}`))
      .toEqual(['a:cat-honoraires:r1', 'b:cat-recettes:r2', 'c:cat-frais:r3'])
    expect(plan.refus).toEqual([])
    expect(plan.conflits).toEqual([])
  })

  it('sur un dossier assujetti, une règle de recette sans taux ne range rien, et dit où le taux se choisit', () => {
    const plan = planAffectationParRegles([ligne({ id: 'b', libelle: 'VIR CPAM 13', montant: 48.2 })], regles, [HONORAIRES, RECETTES, FRAIS], true, aucunJustificatif)
    expect(plan.propositions).toEqual([])
    expect(plan.refus.map((r) => [r.ligne.id, r.raison])).toEqual([['b', REFUS_REGLE_SANS_TAUX]])
  })

  it('sur un dossier assujetti, la règle de recette transmet son taux — exonération comprise', () => {
    for (const taux of [20, 0]) {
      const avecTaux = [regle({ id: 'r2', motif: 'client', sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: taux })]
      const plan = planAffectationParRegles([ligne({ id: 'b', libelle: 'VIR CLIENT DUPONT', montant: 120 })], avecTaux, [RECETTES], true, aucunJustificatif)
      expect(plan.refus).toEqual([])
      expect(plan.propositions.map((p) => [p.ligne.id, p.taux])).toEqual([['b', taux]])
    }
  })

  it('un taux gardé par la règle ne s’applique plus sur un dossier qui a cessé d’être assujetti, ni à une dépense', () => {
    const recette = regle({ id: 'r2', motif: 'client', sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: 20 })
    const plan = planAffectationParRegles([ligne({ id: 'b', libelle: 'VIR CLIENT DUPONT', montant: 120 })], [recette], [RECETTES], false, aucunJustificatif)
    expect(plan.propositions.map((p) => p.taux)).toEqual([null])
    const depense = planAffectationParRegles([ligne()], [regle({ taux_tva: 20 })], [HONORAIRES], true, aucunJustificatif)
    expect(depense.propositions.map((p) => p.taux)).toEqual([null])
  })

  it('une catégorie que la règle vise mais qu’on n’a pas lue est refusée, jamais devinée', () => {
    const plan = planAffectationParRegles([ligne()], regles, [RECETTES, FRAIS], false, aucunJustificatif)
    expect(plan.propositions).toEqual([])
    expect(plan.refus[0].raison).toMatch(/ne figure pas parmi les catégories lues/)
  })

  it('une catégorie dont le compte n’est plus de résultat est refusée', () => {
    const plan = planAffectationParRegles([ligne()], regles, [categorie({ compte_comptable: '108000' }), RECETTES, FRAIS], false, aucunJustificatif)
    expect(plan.propositions).toEqual([])
    expect(plan.refus[0].raison).toMatch(/pas de compte de charge ou de produit/)
  })

  it('les conflits sont rendus à part', () => {
    const conflit = regle({ id: 'r4', motif: 'sepa', categorie_id: 'cat-frais' })
    // « sepa » n'est pas un motif acceptable pour l'écran, mais la base ne le refuse pas : le plan doit
    // quand même savoir ne pas trancher.
    const plan = planAffectationParRegles([ligne()], [regle(), conflit], [HONORAIRES, FRAIS], false, aucunJustificatif)
    expect(plan.propositions).toEqual([])
    expect(plan.conflits.map((c) => c.regles.map((r) => r.id))).toEqual([['r1', 'r4']])
  })

  it('sans règle, rien', () => {
    expect(planAffectationParRegles([ligne()], [], [HONORAIRES], false, aucunJustificatif)).toEqual({ propositions: [], aRapprocher: [], refus: [], conflits: [] })
  })
})

describe('justificatifPossible — un paiement qui a peut-être sa pièce ne s’affecte pas en lot', () => {
  const aucun = {
    pieces: [], piecesRapprochees: new Set<string>(), restesARegler: new Map<string, number>(), cotisations: [],
    cotisationsRapprochees: new Set<string>(),
  }

  it('une pièce du même montant dans la fenêtre du rapprochement — à valider comprise', () => {
    const justificatifs = { ...aucun, pieces: [piece({ tiers: null, statut: 'a_valider', date_piece: '2025-03-10' })] }
    expect(justificatifPossible(ligne(), justificatifs)).toMatch(/pièce du même montant/)
  })

  it('une échéance de cotisation du même montant', () => {
    const justificatifs = { ...aucun, cotisations: [cotisation({ montant_appele: 38.4, echeance: '2025-03-10' })] }
    expect(justificatifPossible(ligne(), justificatifs)).toMatch(/échéance de cotisation/)
  })

  it('une pièce de ce tiers non rapprochée, quel que soit son montant', () => {
    const justificatifs = { ...aucun, pieces: [piece({ montant_ttc: 76.8, montant_ht: 76.8, date_piece: '2025-06-01' })] }
    expect(justificatifPossible(ligne(), justificatifs)).toMatch(/justificatif de ce tiers/)
  })

  it('une pièce déjà rapprochée, d’un autre tiers ou de l’autre sens ne retient rien', () => {
    const rapprochee = piece({ id: 'p1' })
    expect(justificatifPossible(ligne(), { ...aucun, pieces: [rapprochee], piecesRapprochees: new Set(['p1']) })).toBeNull()
    expect(justificatifPossible(ligne(), { ...aucun, pieces: [piece({ tiers: 'Swisslife', montant_ttc: 90, montant_ht: 90 })] })).toBeNull()
    expect(justificatifPossible(ligne(), { ...aucun, pieces: [piece({ type_piece: 'vente', montant_ttc: 90, montant_ht: 90 })] })).toBeNull()
    expect(justificatifPossible(ligne(), aucun)).toBeNull()
  })

  // UNE PIÈCE PAYÉE EN PARTIE ATTEND SON SOLDE : rapprochée de son acompte, elle échappait aux questions précédentes, et le
  // solde affecté en lot aurait compté la dépense une seconde fois.
  it('une pièce payée en partie de ce tiers, ou dont le reste vaut le mouvement', () => {
    const acomptee = piece({ id: 'p1', montant_ttc: 100, montant_ht: 100, date_piece: '2025-01-15' })
    const avecReste = (p: Piece, reste: number) => ({ ...aucun, pieces: [p], piecesRapprochees: new Set([p.id]), restesARegler: new Map([[p.id, reste]]) })
    expect(justificatifPossible(ligne(), avecReste(acomptee, 61.6))).toMatch(/payée en partie attend son solde/)
    // Un autre tiers, mais dont le reste vaut le mouvement.
    const autre = piece({ id: 'p2', tiers: 'Swisslife', montant_ttc: 100, montant_ht: 100 })
    expect(justificatifPossible(ligne(), avecReste(autre, 38.4))).toMatch(/payée en partie attend son solde/)
    // Gardes symétriques : un autre tiers et un autre reste, l'autre sens, ou une pièce réglée — sans reste à régler.
    expect(justificatifPossible(ligne(), avecReste(autre, 50))).toBeNull()
    expect(justificatifPossible(ligne(), avecReste({ ...acomptee, type_piece: 'vente' }, 61.6))).toBeNull()
    expect(justificatifPossible(ligne(), { ...aucun, pieces: [acomptee], piecesRapprochees: new Set(['p1']) })).toBeNull()
  })

  it('le plan met ces mouvements à rapprocher, jamais dans le lot', () => {
    const justificatifs = { ...aucun, pieces: [piece({ montant_ttc: 76.8, montant_ht: 76.8, date_piece: '2025-06-01' })] }
    const plan = planAffectationParRegles([ligne(), ligne({ id: 'l2', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5 })],
      [regle(), regle({ id: 'r3', motif: 'frais', categorie_id: 'cat-frais' })], [HONORAIRES, FRAIS], false,
      (l) => justificatifPossible(l, justificatifs))
    expect(plan.propositions.map((p) => p.ligne.id)).toEqual(['l2'])
    expect(plan.aRapprocher.map((r) => [r.ligne.id, r.regle.id])).toEqual([['l1', 'r1']])
    expect(plan.aRapprocher[0].raison).toMatch(/justificatif de ce tiers/)
  })
})

describe('totauxParCategorie — le lot relu avant de cliquer', () => {
  it('compte et somme par catégorie, dans l’ordre des catégories, au centime', () => {
    const plan = planAffectationParRegles([
      ligne({ id: 'a', libelle: 'VIR CPAM', montant: 0.1 }),
      ligne({ id: 'b', libelle: 'VIR CPAM', montant: 0.2 }),
      ligne({ id: 'c', libelle: 'FRAIS CB', montant: -8.5 }),
      ligne({ id: 'd' }),
    ], [
      regle(),
      regle({ id: 'r2', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes' }),
      regle({ id: 'r3', motif: 'frais', categorie_id: 'cat-frais' }),
    ], [RECETTES, FRAIS, HONORAIRES], false, aucunJustificatif)
    expect(totauxParCategorie(plan.propositions).map((t) => [t.categorie.id, t.nombre, t.montant])).toEqual([
      ['cat-honoraires', 1, -38.4],
      ['cat-frais', 1, -8.5],
      ['cat-recettes', 2, 0.3],
    ])
  })
})

describe('totauxParCategorie — deux catégories au même rang', () => {
  it('se rangent par libellé, quel que soit l’ordre des mouvements', () => {
    const assurance = categorie({ id: 'cat-assurance', code: 'assurance', libelle: 'Assurance', ordre: 50, compte_comptable: '616000' })
    const abonnements = categorie({ id: 'cat-abonnements', code: 'abonnements', libelle: 'Abonnements', ordre: 50, compte_comptable: '651000' })
    const plan = planAffectationParRegles([
      ligne({ id: 'a', libelle: 'PRLV SEPA SWISSLIFE' }),
      ligne({ id: 'b' }),
    ], [
      regle({ id: 'r1', motif: 'swisslife', categorie_id: 'cat-assurance' }),
      regle({ id: 'r2', motif: 'transmedical', categorie_id: 'cat-abonnements' }),
    ], [assurance, abonnements], false, aucunJustificatif)
    expect(totauxParCategorie(plan.propositions).map((t) => t.categorie.libelle)).toEqual(['Abonnements', 'Assurance'])
  })
})

describe('envoisDuLot — ce qui part vers la base', () => {
  it('l’écriture de chaque mouvement est celle de l’affectation à l’unité, dans l’ordre du lot', () => {
    const plan = planAffectationParRegles([ligne({ id: 'a' }), ligne({ id: 'b', libelle: 'VIR CPAM', montant: 48.2 })],
      [regle(), regle({ id: 'r2', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes' })],
      [HONORAIRES, RECETTES], false, aucunJustificatif)
    expect(envoisDuLot(plan.propositions)).toEqual([[
      { ligne_bancaire_id: 'a', categorie_id: 'cat-honoraires', taux_tva: null, ecritures: ecritureDuMouvement(plan.propositions[0].ligne, '622600', null) },
      { ligne_bancaire_id: 'b', categorie_id: 'cat-recettes', taux_tva: null, ecritures: ecritureDuMouvement(plan.propositions[1].ligne, '706000', null) },
    ]])
  })

  it('une recette taxée part avec son taux, et l’écriture à trois lignes qu’il donne', () => {
    const plan = planAffectationParRegles([ligne({ id: 'b', libelle: 'VIR CLIENT DUPONT', montant: 120 })],
      [regle({ id: 'r2', motif: 'client', sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: 20 })],
      [RECETTES], true, aucunJustificatif)
    const [[envoi]] = envoisDuLot(plan.propositions)
    expect(envoi.taux_tva).toBe(20)
    expect(envoi.ecritures.map((e) => [e.compte, e.sens, e.montant])).toEqual([
      ['706000', 'credit', 100],
      ['445710', 'credit', 20],
      ['512000', 'debit', 120],
    ])
  })

  it('découpe le lot en envois de la taille demandée, sans rien perdre ni doubler', () => {
    const lignes = Array.from({ length: 5 }, (_, i) => ligne({ id: `l${i}` }))
    const plan = planAffectationParRegles(lignes, [regle()], [HONORAIRES], false, aucunJustificatif)
    const envois = envoisDuLot(plan.propositions, 2)
    expect(envois.map((e) => e.map((a) => a.ligne_bancaire_id))).toEqual([['l0', 'l1'], ['l2', 'l3'], ['l4']])
  })

  it('cent par envoi : le délai de la base se mesure à cette taille', () => {
    expect(TAILLE_ENVOI_AFFECTATION).toBe(100)
    const lignes = Array.from({ length: 250 }, (_, i) => ligne({ id: `l${i}` }))
    const plan = planAffectationParRegles(lignes, [regle()], [HONORAIRES], false, aucunJustificatif)
    expect(envoisDuLot(plan.propositions).map((e) => e.length)).toEqual([100, 100, 50])
  })
})

describe('sensDuMouvement', () => {
  it('encaissement, décaissement, ou rien pour zéro euro', () => {
    expect(sensDuMouvement({ montant: 12 })).toBe('encaissement')
    expect(sensDuMouvement({ montant: -12 })).toBe('decaissement')
    expect(sensDuMouvement({ montant: 0 })).toBeNull()
  })
})
