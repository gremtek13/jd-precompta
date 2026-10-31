import { describe, expect, it } from 'vitest'
import { ecritureDuMouvement } from './affectationBanque'
import { paiementNet, soldeDesPaiements } from './alignementBanque'
import { calculerDeclaration2035 } from './declaration2035'
import { CASES_2035, casesNegatives, valeursDesCases } from './cases2035'
import { concordance2035 } from './concordance2035'
import { calculerCa3, type DonneesTva } from './declarationTva'
import { lignesPourPiece, type LigneAGenerer } from './ecritures'
import type { ModeleComptable } from './engagement'
import { partsDuReleve } from './partsDuReleve'
import { centimesParDate, paiementsDesPieces, partDeLAnnee, partsDesPaiements, rattachementsTresorerie } from './rattachement'
import { cotisationsComptees } from './cotisationRapprochee'
import { piecesPayeesEnTrop, resteARegler } from './reglementGroupe'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { NON_VALIDEE } from '../test/ecritures'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import type { Categorie, CotisationDeclaree, EcritureBrouillon, LigneBancaire, Piece } from './types'

// RELECTURE DU 31/10/2026 — la 2035 d'un soignant EXONÉRÉ en trésorerie. Trois défauts, prouvés d'abord par des
// `it.fails`, puis corrigés : les tests ci-dessous disent ce que la déclaration doit dire, et ce qu'elle refuse.

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

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

// Une ligne d'écriture du brouillon, telle que la base la rend.
let numero = 0
const brouillon = (
  lignes: readonly (Pick<LigneAGenerer, 'compte' | 'sens' | 'montant'> & Partial<LigneAGenerer>)[],
  lien: Partial<EcritureBrouillon>,
): EcritureBrouillon[] => lignes.map((l) => ({
  id: `e${++numero}`, dossier_id: 'd1', piece_id: l.piece_id ?? null, ligne_bancaire_id: l.ligne_bancaire_id ?? null,
  date: l.date ?? '2025-06-01', compte: l.compte, libelle: l.libelle ?? 'écriture', montant: l.montant, sens: l.sens,
  statut: 'proposee', created_at: '2025-06-02T09:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
  cotisation_id: null, ...NON_VALIDEE, encaissement_id: null, facture_id: null, ...lien,
}))

const concordance = (d: ReturnType<typeof exonere>, ecritures: EcritureBrouillon[], pieces: Piece[] = []) => concordance2035(
  d, ecritures,
  { piecesValidees: new Set(pieces.map((p) => p.id)), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: new Set() },
  null,
)

describe('relecture — les honoraires rétrocédés (ligne 3, AC) et les débours (ligne 2, AB)', () => {
  // Une infirmière titulaire encaisse 50 000 € de l'Assurance maladie et rétrocède 10 000 € à sa remplaçante, par
  // virement. Le formulaire attend AA = 50 000, AC = 10 000, AD = 40 000 (AD = ligne 1 − ligne 2 − ligne 3).
  const recettes = { id: 'c-rec', compte_comptable: '706000', poste_2035: 'Recettes' } as Categorie
  const retroEnCharge = { id: 'c-retro', compte_comptable: '622600', poste_2035: 'Honoraires rétrocédés' } as Categorie
  const cpam = mouvement({ id: 'cpam', categorie_id: 'c-rec', montant: 50_000 })
  const remplacante = mouvement({ id: 'remp', categorie_id: 'c-retro', montant: -10_000 })

  it('rangée dans une catégorie de CHARGE (6226), la rétrocession atteint AC, en positif, et AD est net', () => {
    const d = exonere({ categories: [recettes, retroEnCharge], lignes: [cpam, remplacante] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(valeurs.get('AA')).toBe(50_000)
    expect(valeurs.get('AC')).toBe(10_000)
    expect(valeurs.get('AD')).toBe(40_000)
    // Le résultat du formulaire est celui du moteur : la rétrocession n'entre pas AUSSI au cadre 3.
    expect(valeurs.get('BR')).toBe(0)
    expect(valeurs.get('CA')).toBe(40_000)
    expect(valeurs.get('CP')).toBe(d.resultat)
    expect(postesSansCase).toEqual([])
    expect(casesNegatives(d)).toEqual([])
  })

  it('rangée en charge, elle concorde avec ses écritures : une charge au 622600 face à la banque', () => {
    const d = exonere({ categories: [recettes, retroEnCharge], lignes: [cpam, remplacante] })
    const ecritures = [
      ...brouillon(ecritureDuMouvement(cpam, '706000', null, PLAN_PAR_DEFAUT), { ligne_bancaire_id: 'cpam', date: cpam.date }),
      ...brouillon(ecritureDuMouvement(remplacante, '622600', null, PLAN_PAR_DEFAUT), { ligne_bancaire_id: 'remp', date: remplacante.date }),
    ]
    const c = concordance(d, ecritures)
    expect(c.ecarts).toEqual([])
    expect(c.ecritures).toEqual({ recettes: 50_000, depenses: 10_000, resultat: 40_000 })
    // Le résultat des écritures est celui que le formulaire déclare en CP.
    expect(c.ecritures.resultat).toBe(valeursDesCases(d).valeurs.get('CP'))
  })

  it('les débours payés pour le client (AB) suivent la même règle', () => {
    const debours = { id: 'c-deb', compte_comptable: '467000', poste_2035: 'Débours' } as Categorie
    const d = exonere({ categories: [recettes, { ...debours, compte_comptable: '622800' }], lignes: [
      cpam, mouvement({ id: 'deb', categorie_id: 'c-deb', montant: -1_200 }),
    ] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(valeurs.get('AB')).toBe(1_200)
    expect(valeurs.get('AD')).toBe(48_800)
    expect(postesSansCase).toEqual([])
  })

  it('rangée en PRODUIT (7xx), une rétrocession est une recette : elle n’entre plus dans AC, et se dit sans case', () => {
    // Le sens d'une recette sous ce poste est ambigu — c'est la rétrocession REÇUE par la remplaçante, une recette de la
    // ligne 1 —, et la retrancher l'ôterait de son résultat. Elle n'atteint plus AC avec le signe de la recette
    // (AC = −10 000, AD = 60 000 hier), et Clôture la montre, avec le code de la case refusée.
    const retroEnProduit = { id: 'c-retro', compte_comptable: '706100', poste_2035: 'Honoraires rétrocédés' } as Categorie
    const d = exonere({ categories: [recettes, retroEnProduit], lignes: [cpam, remplacante] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(d.resultat).toBe(40_000)
    expect(valeurs.get('AC')).toBe(0)
    expect(postesSansCase.map((p) => [p.ligne.nature, p.raison, p.codeRefuse])).toEqual([['recette', 'case du mauvais sens', 'AC']])
    expect(casesNegatives(d)).toEqual([])
  })

  it('la remplaçante qui range sa rétrocession REÇUE en « Rétrocessions » ne la voit pas retranchée de ses recettes', () => {
    // Hier : une recette positive sous ce poste entrait en AC, et AD = AA − AC l'ôtait du résultat déclaré, pendant que le
    // moteur l'ajoutait. Le formulaire déclarait 20 000 € de moins que le moteur, sans rien dire.
    const recue = { id: 'c-recue', compte_comptable: '706000', poste_2035: 'Rétrocessions' } as Categorie
    const d = exonere({ categories: [recue], lignes: [mouvement({ id: 'tit', categorie_id: 'c-recue', montant: 10_000 })] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(valeurs.get('AC')).toBe(0)
    expect(postesSansCase.map((p) => p.codeRefuse)).toEqual(['AC'])
  })

  it('une case de recettes qui ne se retranche pas refuse toujours une dépense', () => {
    const malRangee = { id: 'c-mal', compte_comptable: '606000', poste_2035: 'Recettes' } as Categorie
    const d = exonere({ categories: [recettes, malRangee], lignes: [cpam, mouvement({ id: 'x', categorie_id: 'c-mal', montant: -300 })] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(valeurs.get('AA')).toBe(50_000)
    expect(postesSansCase.map((p) => [p.ligne.nature, p.raison, p.codeRefuse])).toEqual([['depense', 'case du mauvais sens', 'AA']])
  })

  it('seules les lignes 2 et 3 se retranchent : l’exception ne vaut pour aucune autre case', () => {
    expect(CASES_2035.filter((c) => c.soustractive).map((c) => c.code)).toEqual(['AB', 'AC'])
  })
})

describe('relecture — le remboursement d’une échéance de cotisation, selon qu’il est rapproché ou non', () => {
  // Un remboursement de l'Urssaf saisi comme une échéance NÉGATIVE (−300 €, dont 30 € de CSG-CRDS saisis en positif, comme
  // l'indique le décompte). Rapproché du crédit qui le paie ou non, BK baisse de 270 € et BV de 21,03 €.
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

  it('non rapproché : le même remboursement donne les mêmes cases', () => {
    const { valeurs } = valeursDesCases(exonere({ categories: cats, cotisations: [cotisation] }))
    expect(valeurs.get('BK')).toBe(-270)
    expect(valeurs.get('BV')).toBe(-21.03)
  })

  it('payé depuis le compte personnel : les mêmes cases encore', () => {
    const { valeurs } = valeursDesCases(exonere({ categories: cats, cotisations: [{ ...cotisation, paiement_personnel_le: '2025-11-20' }] }))
    expect(valeurs.get('BK')).toBe(-270)
    expect(valeurs.get('BV')).toBe(-21.03)
  })

  it('une échéance PAYÉE non rapprochée garde sa CSG-CRDS positive, saisie positive ou négative', () => {
    for (const csg of [30, -30]) {
      const payee = { ...cotisation, id: `p${csg}`, montant_appele: 300, montant_csg_crds: csg }
      expect(cotisationsComptees([payee], [], 'tresorerie')[0]).toMatchObject({ montant: 300, csgCrds: 30, ligne: null })
      const { valeurs } = valeursDesCases(exonere({ categories: cats, cotisations: [payee] }))
      expect(valeurs.get('BK')).toBe(270)
      expect(valeurs.get('BV')).toBe(21.03)
    }
  })

  it('les trois façons de compter une échéance signent sa CSG-CRDS comme son montant, et la taisent inconnue', () => {
    const rembourse = cotisationsComptees([cotisation], [], 'tresorerie')[0]
    expect(rembourse).toMatchObject({ montant: -300, csgCrds: -30, ligne: null, paiementPersonnel: null })
    expect(cotisationsComptees([{ ...cotisation, montant_csg_crds: null }], [], 'tresorerie')[0].csgCrds).toBeNull()
  })
})

describe('relecture — une pièce payée, rejetée puis payée de nouveau', () => {
  // Une prime d'assurance de 1 200 € TTC (exonéré : le TTC compte) prélevée le 20/12/2025, le prélèvement rejeté le
  // 28/12/2025 (crédit de 1 200 €, rapproché de la même pièce), puis payée le 05/01/2026. Payée en 2026 seulement.
  const assurance = { id: 'c-ass', compte_comptable: '616000', poste_2035: "Primes d'assurance" } as Categorie
  const prime = {
    id: 'prime', dossier_id: 'd1', statut: 'validee', type_piece: 'achat', date_piece: '2025-12-15', montant_ht: 1200, montant_tva: 0,
    montant_ttc: 1200, categorie_id: 'c-ass', created_at: '2025-12-16T09:00:00Z', tiers: 'Assureur', nom_fichier: 'prime.pdf', devise: 'EUR',
  } as Piece
  const lignes = [
    mouvement({ id: 'p1', date: '2025-12-20', montant: -1200, piece_id: 'prime' }),
    mouvement({ id: 'rejet', date: '2025-12-28', montant: 1200, piece_id: 'prime' }),
    mouvement({ id: 'p2', date: '2026-01-05', montant: -1200, piece_id: 'prime' }),
  ]
  const paiements = () => paiementsDesPieces(lignes, [], []).get('prime') ?? []

  it('ne compte rien en 2025 et 1 200 € en 2026', () => {
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2025 }).totalDepenses).toBe(0)
    expect(exonere({ categories: [assurance], lignes, pieces: [prime], annee: 2026 }).totalDepenses).toBe(1200)
  })

  it('le rejet porte une part NÉGATIVE, à sa date ; les parts somment à la pièce', () => {
    const r = rattachementsTresorerie(prime, paiements())
    expect(r).toEqual([
      { date: '2025-12-20', part: 1, source: 'paiement' },
      { date: '2025-12-28', part: -1, source: 'paiement' },
      { date: '2026-01-05', part: 1, source: 'paiement' },
    ])
    expect(partDeLAnnee(r, 2025)).toBe(0)
    expect(partDeLAnnee(r, 2026)).toBe(1)
    expect(centimesParDate(prime, 1200, paiements()).map((m) => m.centimes)).toEqual([120_000, -120_000, 120_000])
  })

  it('l’écriture de la pièce s’équilibre à chaque date, donc dans chaque exercice, et concorde avec la 2035', () => {
    const generees = lignesPourPiece('d1', prime, { compte: '616000', immobilisation: false }, false, paiements(), TRESORERIE)
    const soldeParDate = new Map<string, number>()
    for (const l of generees) {
      // Aucune ligne de montant négatif ni nul : la part négative s'écrit dans l'autre sens, comme un avoir.
      expect(l.montant).toBeGreaterThan(0)
      soldeParDate.set(l.date, (soldeParDate.get(l.date) ?? 0) + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100))
    }
    expect([...soldeParDate]).toEqual([['2025-12-20', 0], ['2025-12-28', 0], ['2026-01-05', 0]])
    // Le rejet : la charge au crédit du 616000, face à la banque au débit.
    expect(generees.filter((l) => l.date === '2025-12-28').map((l) => [l.compte, l.sens, l.montant]).sort())
      .toEqual([['512000', 'debit', 1200], ['616000', 'credit', 1200]])
    const ecritures = brouillon(generees, {})
    for (const annee of [2025, 2026]) {
      const d = exonere({ categories: [assurance], lignes, pieces: [prime], annee })
      expect(concordance(d, ecritures.filter((e) => e.date.startsWith(String(annee))), [prime]).ecarts).toEqual([])
    }
  })

  it('n’est ni payée de trop, ni restée à régler : son second prélèvement se règle', () => {
    expect(piecesPayeesEnTrop([prime], paiementsDesPieces(lignes, [], []))).toEqual([])
    expect(soldeDesPaiements(prime, paiements())).toMatchObject({ paye: 1200, reste: 0 })
    // Avant le second prélèvement, le rejet rend à régler ce qu'il défait.
    expect(resteARegler(prime, paiements(), 'p2')).toBe(1200)
    expect(resteARegler(prime, paiements(), null)).toBe(0)
  })

  it('rejetée et pas encore reprise, elle n’a pas de paiement net : comptée à sa facture, et dite sans paiement', () => {
    const avantReprise = lignes.slice(0, 2)
    expect(paiementNet(paiementsDesPieces(avantReprise, [], []).get('prime') ?? [])).toEqual({ centimes: 0, sens: 0 })
    expect(partsDesPaiements(prime, paiementsDesPieces(avantReprise, [], []).get('prime') ?? [])).toEqual({ parts: [], reste: 1 })
    const d = exonere({ categories: [assurance], lignes: avantReprise, pieces: [prime], annee: 2025 })
    expect(d.totalDepenses).toBe(1200)
    expect(d.sansPaiementConnu.map((s) => [s.piece.id, s.montant])).toEqual([['prime', 1200]])
  })

  it('un prélèvement et son rejet LE MÊME JOUR font une part nulle : aucune charge ce jour-là, la banque se solde', () => {
    const memeJour = [
      mouvement({ id: 'p1', date: '2025-12-20', montant: -1200, piece_id: 'prime' }),
      mouvement({ id: 'rejet', date: '2025-12-20', montant: 1200, piece_id: 'prime' }),
      mouvement({ id: 'p2', date: '2026-01-05', montant: -1200, piece_id: 'prime' }),
    ]
    const p = paiementsDesPieces(memeJour, [], []).get('prime') ?? []
    expect(centimesParDate(prime, 1200, p)).toEqual([
      { date: '2025-12-20', centimes: 0, centimesSansDate: 0 },
      { date: '2026-01-05', centimes: 120_000, centimesSansDate: 0 },
    ])
    const generees = lignesPourPiece('d1', prime, { compte: '616000', immobilisation: false }, false, p, TRESORERIE)
    expect(generees.filter((l) => l.date === '2025-12-20').map((l) => [l.compte, l.sens, l.montant]).sort())
      .toEqual([['512000', 'credit', 1200], ['512000', 'debit', 1200]])
    expect(exonere({ categories: [assurance], lignes: memeJour, pieces: [prime], annee: 2025 }).totalDepenses).toBe(0)
  })

  it('des paiements de même sens rendent les parts d’hier, au bit près', () => {
    // La formule d'avant, en valeur absolue : la référence de la neutralité, sur des montants qui flottent mal.
    const hier = (ttc: number, ms: number[]) => {
      const paye = ms.reduce((s, m) => s + Math.abs(m), 0)
      const reste = Math.round((ttc - paye) * 100) / 100
      return reste <= Math.min(ttc * 0.02, 5) ? ms.map((m) => Math.abs(m) / paye) : ms.map((m) => Math.abs(m) / ttc)
    }
    const cas: [number, number[]][] = [
      [0.3, [-0.1, -0.2]], [0.3, [0.1, 0.2]], [1200, [-400, -400, -400]], [100.1, [-98.1]], [1000, [-333.33, -333.33]],
      [40, [-20, -20]], [256.16, [-251.16]], [1000, [-500, -505.01]],
    ]
    for (const [ttc, ms] of cas) {
      const { parts } = partsDesPaiements({ montant_ttc: ttc }, ms.map((montant, i) => ({ date: `2025-0${i + 1}-01`, montant })))
      expect(parts.map((p) => p.part), `${ttc} ${ms}`).toEqual(hier(ttc, ms))
    }
  })

  it('la CA3 d’un dossier assujetti défait la déduction au mois du rejet, et la refait à la reprise', () => {
    const achat = { ...prime, montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 } as Piece
    const donnees: DonneesTva = {
      pieces: [achat], paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [],
      ventesFacturees: ventesFactureesVides('d1'), caisse: CAISSE_ABSENTE,
    }
    expect(calculerCa3(donnees, { debut: '2025-12-01', fin: '2025-12-31' }, false, 0, 0).cases.l20).toBe(0)
    expect(calculerCa3(donnees, { debut: '2025-12-01', fin: '2025-12-27' }, false, 0, 0).cases.l20).toBe(200)
    expect(calculerCa3(donnees, { debut: '2026-01-01', fin: '2026-01-31' }, false, 0, 0).cases.l20).toBe(200)
  })

  it('le rejet d’un paiement partiel le jour de la facture : ni division par zéro, ni NaN', () => {
    // 600 € payés le 10/12, leur rejet le 15/12 — le jour de la facture, qui porte le reste de 600 € —, 600 € le 05/01.
    const partiel = [
      mouvement({ id: 'a', date: '2025-12-10', montant: -600, piece_id: 'prime' }),
      mouvement({ id: 'r', date: '2025-12-15', montant: 600, piece_id: 'prime' }),
      mouvement({ id: 'b', date: '2026-01-05', montant: -600, piece_id: 'prime' }),
    ]
    const p = paiementsDesPieces(partiel, [], []).get('prime') ?? []
    expect(rattachementsTresorerie(prime, p)).toEqual([
      { date: '2025-12-10', part: 0.5, source: 'paiement' },
      { date: '2025-12-15', part: -0.5, source: 'paiement' },
      { date: '2025-12-15', part: 0.5, source: 'sans_paiement' },
      { date: '2026-01-05', part: 0.5, source: 'paiement' },
    ])
    const achat = { ...prime, montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 } as Piece
    const donnees: DonneesTva = {
      pieces: [achat], paiements: paiementsDesPieces(partiel, [], []), pieceIdsImmobilisees: new Set(), releve: [],
      ventesFacturees: ventesFactureesVides('d1'), caisse: CAISSE_ABSENTE,
    }
    const dec = calculerCa3(donnees, { debut: '2025-12-15', fin: '2025-12-15' }, false, 0, 0).cases
    expect(Number.isFinite(dec.l15)).toBe(true)
    // Le 15/12 défait la moitié payée le 10 : 100 € de TVA, que la période du 10 avait déduits, se REVERSENT en ligne 15
    // — jamais une ligne 20 négative.
    expect(dec.l15).toBe(100)
    expect(dec.l20).toBe(0)
    expect(calculerCa3(donnees, { debut: '2025-12-01', fin: '2025-12-31' }, false, 0, 0).cases.l20).toBe(0)
    // Et une pièce SANS date dont le rejet tombe le jour de son dépôt : la part sans date ne se divise pas par zéro.
    const sansDate = { ...prime, date_piece: null, created_at: '2025-12-15T09:00:00Z' } as Piece
    const morceaux = centimesParDate(sansDate, 1200, p)
    expect(morceaux.every((m) => Number.isFinite(m.centimes) && Number.isFinite(m.centimesSansDate))).toBe(true)
    expect(morceaux.find((m) => m.date === '2025-12-15')).toEqual({ date: '2025-12-15', centimes: 0, centimesSansDate: 60_000 })
  })
})

// RELECTURE DE 3564fcb (31/10/2026) : une période qui ne porte que la part négative d'une pièce positive — le mois d'un
// rejet — ne l'inscrit jamais en négatif sur une ligne de taux. La ligne se choisit au signe de ce que la période porte.
describe('relecture — la CA3 du mois d’un rejet n’inscrit aucune ligne négative', () => {
  const T = (mois: string) => ({ debut: `${mois}-01`, fin: `${mois}-${mois.endsWith('02') ? '28' : '31'}` })
  const base = {
    id: 'p', dossier_id: 'd1', statut: 'validee', date_piece: '2025-12-15', categorie_id: null,
    created_at: '2025-12-16T09:00:00Z', tiers: 'Tiers', nom_fichier: 'p.pdf', devise: 'EUR',
  }
  // Payée le 20/12, son paiement rejeté le 08/01, payée de nouveau le 05/02 : le sens de chaque mouvement est celui qui
  // règle la pièce (`regle`), puis l'inverse, puis le même.
  const releve = (regle: 1 | -1, montant: number) => [
    mouvement({ id: 'm1', date: '2025-12-20', montant: regle * montant, piece_id: 'p' }),
    mouvement({ id: 'm2', date: '2026-01-08', montant: -regle * montant, piece_id: 'p' }),
    mouvement({ id: 'm3', date: '2026-02-05', montant: regle * montant, piece_id: 'p' }),
  ]
  const ca3 = (piece: Piece, lignes: LigneBancaire[], mois: string) => calculerCa3({
    pieces: [piece], paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [],
    ventesFacturees: ventesFactureesVides('d1'), caisse: CAISSE_ABSENTE,
  }, T(mois), false, 0, 0).cases

  it('un achat : déduit en décembre, REVERSÉ en janvier (ligne 15), déduit de nouveau en février', () => {
    const achat = { ...base, type_piece: 'achat', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 } as Piece
    const lignes = releve(-1, 1200)
    expect(ca3(achat, lignes, '2025-12')).toMatchObject({ l15: 0, l20: 200 })
    expect(ca3(achat, lignes, '2026-01')).toMatchObject({ l15: 200, l20: 0, l23: 0 })
    expect(ca3(achat, lignes, '2026-02')).toMatchObject({ l15: 0, l20: 200 })
  })

  it('une vente taxée : en janvier, une régularisation en B5 et en ligne 21, jamais une base négative', () => {
    const vente = { ...base, type_piece: 'vente', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 } as Piece
    const lignes = releve(1, 1200)
    expect(ca3(vente, lignes, '2025-12')).toMatchObject({ A1: 1000, base08: 1000, taxe08: 200, B5: 0, l21: 0 })
    expect(ca3(vente, lignes, '2026-01')).toMatchObject({ A1: 0, base08: 0, taxe08: 0, l16: 0, B5: 1000, l21: 200 })
  })

  it('une vente exonérée : en janvier, F8 et non une E2 négative', () => {
    const vente = { ...base, type_piece: 'vente', montant_ht: 1200, montant_tva: 0, montant_ttc: 1200 } as Piece
    const lignes = releve(1, 1200)
    expect(ca3(vente, lignes, '2025-12')).toMatchObject({ E2: 1200, F8: 0 })
    expect(ca3(vente, lignes, '2026-01')).toMatchObject({ E2: 0, F8: 1200 })
  })

  it('un avoir payé d’un seul sens garde ses lignes d’hier : l15 pour un avoir fournisseur, B5 et l21 pour un avoir client', () => {
    const avoirFournisseur = { ...base, type_piece: 'achat', montant_ht: -100, montant_tva: -20, montant_ttc: -120 } as Piece
    expect(ca3(avoirFournisseur, [mouvement({ id: 'r', date: '2025-12-20', montant: 120, piece_id: 'p' })], '2025-12'))
      .toMatchObject({ l15: 20, l20: 0 })
    const avoirClient = { ...base, type_piece: 'vente', montant_ht: -100, montant_tva: -20, montant_ttc: -120 } as Piece
    expect(ca3(avoirClient, [mouvement({ id: 'r', date: '2025-12-20', montant: -120, piece_id: 'p' })], '2025-12'))
      .toMatchObject({ A1: 0, base08: 0, B5: 100, l21: 20 })
  })

  it('une période dont la TVA s’arrondit à zéro garde la ligne de la pièce, celle d’hier', () => {
    // Un avoir fournisseur de 0,06 € dont 0,01 € de TVA, remboursé en deux fois : la TVA de janvier s'arrondit à zéro, et
    // la pièce y reste rangée en ligne 15, comme avant.
    const avoir = { ...base, type_piece: 'achat', montant_ht: -0.05, montant_tva: -0.01, montant_ttc: -0.06 } as Piece
    const lignes = [
      mouvement({ id: 'a', date: '2025-12-20', montant: 0.03, piece_id: 'p' }),
      mouvement({ id: 'b', date: '2026-01-20', montant: 0.03, piece_id: 'p' }),
    ]
    const janvier = calculerCa3({
      pieces: [avoir], paiements: paiementsDesPieces(lignes, [], []), pieceIdsImmobilisees: new Set(), releve: [],
      ventesFacturees: ventesFactureesVides('d1'), caisse: CAISSE_ABSENTE,
    }, T('2026-01'), false, 0, 0)
    expect(janvier.cases.l15).toBe(0)
    expect(janvier.retenues.map((r) => r.ligne)).toEqual(['15'])
  })

  it('aucune ligne de la CA3 ne porte une somme négative, quels que soient les sens et les mois des paiements', () => {
    const LIGNES = ['A1', 'B5', 'E2', 'F8', 'base08', 'taxe08', 'base09', 'taxe09', 'base9B', 'taxe9B', 'base10', 'taxe10',
      'l15', 'l16', 'l19', 'l20', 'l21', 'l22', 'l23'] as const
    const mois = ['2025-12', '2026-01', '2026-02']
    const pieces = [
      { ...base, type_piece: 'achat', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 },
      { ...base, type_piece: 'achat', montant_ht: -100, montant_tva: -20, montant_ttc: -120 },
      { ...base, type_piece: 'vente', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200 },
      { ...base, type_piece: 'vente', montant_ht: -100, montant_tva: -20, montant_ttc: -120 },
      { ...base, type_piece: 'vente', montant_ht: 1200, montant_tva: 0, montant_ttc: 1200 },
      { ...base, type_piece: 'vente', montant_ht: -120, montant_tva: 0, montant_ttc: -120 },
    ] as Piece[]
    // Trois mouvements de 1 200, 200 ou 120 €, chacun dans l'un ou l'autre sens, chacun dans l'un des trois mois.
    let cas = 0
    for (const piece of pieces) {
      for (let code = 0; code < 6 ** 3; code++) {
        const lignes = [0, 1, 2].map((i) => {
          const chiffre = Math.floor(code / 6 ** i) % 6
          const sens = chiffre % 2 === 0 ? 1 : -1
          const montant = [1200, 200, 120][i]
          return mouvement({ id: `m${i}`, date: `${mois[Math.floor(chiffre / 2)]}-1${i}`, montant: sens * montant, piece_id: 'p' })
        })
        for (const m of mois) {
          const cases = ca3(piece, lignes, m)
          for (const l of LIGNES) {
            expect(cases[l], `${piece.type_piece} ${piece.montant_tva} ${lignes.map((x) => `${x.date}:${x.montant}`)} ${m} ${l}`)
              .toBeGreaterThanOrEqual(0)
          }
          cas++
        }
      }
    }
    expect(cas).toBe(6 * 216 * 3)
  })
})
