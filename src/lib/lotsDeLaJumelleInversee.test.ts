import { describe, expect, it } from 'vitest'
import {
  analyserAppariements, candidatsPieces, lotDesCertains, planRapprochementAutomatique, type Appariement,
} from './appariementBanque'
import { REFUS_EXEMPLAIRE_D_UNE_SOURCE, REFUS_VALIDATION_D_UNE_VENTE, type FacturePourMarquer } from './exemplairesDesFactures'
import { AUCUNE_FACTURE_SOURCE, facturesSourcesDe } from './facturesSources'
import {
  AUCUN_EXEMPLAIRE_DE_SOURCE, AUCUN_REFUS_DE_VALIDATION, exemplairesDesSourcesDe, jugeDeLaValidation, pontSansLaDesignation,
  raisonNonLue, refusDeValidationDesPieces, refusDeValiderEnLot, resumeDeLaSelection, resumeDesPairesEcartees, validationEnLot,
  type JugeDeLaValidation, type LectureDuPont,
} from './lotsDeLaJumelleInversee'
import { AUCUN_CANDIDAT, AUCUN_HORS_DES_LOTS } from './mouvementsDesVentes'
import { justificatifPossible, type JustificatifsDuDossier } from './reglesAffectation'
import type { LigneBancaire, Piece } from './types'
import type { FacturePourJumelle, TransmissionPourJumelle } from './ventesJumelles'
import { verdictDuPontDeLaPiece } from './exemplairesDesFactures'

// LES LOTS ET LE RELEVÉ DEVANT LA JUMELLE INVERSÉE (ligne 28.65, chantier EC-Q3, étape VF6d). Deux gardes en base, que les
// gestes en lot ne connaissaient pas : G3 (une pièce de vente qui devient validée dans un dossier basculé est désignée,
// déclarée, et jamais contraire au pont) et G4 (l'exemplaire d'une facture source ne justifie aucun mouvement). Ici, les
// plans purs, dans un dossier basculé et dans un dossier qui ne l'est pas — là, rien ne change. Données FICTIVES.

const D = 'd-bascule'

function piece(o: Partial<Piece> & Pick<Piece, 'id'>): Piece {
  return {
    dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/p.pdf`, nom_fichier: `${o.id}.pdf`, storage_hash: null,
    date_piece: '2026-06-02', tiers: 'Atelier fictif', montant_ht: null, montant_tva: null, montant_ttc: 600, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, created_at: '2026-06-02T09:00:00Z', updated_at: '2026-06-02T09:00:00Z', ...o,
  }
}

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-06-03', montant: 600, libelle: 'VIR SEPA RECU', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-03T09:00:00Z',
    encaissements_de_factures: false, ...o,
  }
}

// Deux factures sources (F2026-0021, F2026-0022), une facture d'avant la bascule (F2025-0099), validées ; ce que le pont et
// les gardes en lisent.
const FACTURES: FacturePourMarquer[] = [
  { id: 'f1', dossier_id: D, statut: 'validee', numero: 'F2026-0021', source_de_la_vente: true },
  { id: 'f2', dossier_id: D, statut: 'validee', numero: 'F2026-0022', source_de_la_vente: true },
  { id: 'f0', dossier_id: D, statut: 'validee', numero: 'F2025-0099', source_de_la_vente: false },
]
const FACTURES_DU_PONT: FacturePourJumelle[] = FACTURES.map((f) => ({
  id: f.id, dossier_id: D, statut: 'validee', type: 'facture', numero: f.numero, date_emission: '2026-05-20',
  emetteur_siret: '12345678900012', superpdp_invoice_id: null,
}))
// La plateforme a transmis F2026-0021 sous le flux 9 et F2026-0022 sous le flux 7.
const TRANSMISSIONS: TransmissionPourJumelle[] = [
  { facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-9' },
  { facture_id: 'f2', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-7' },
]
const PONT: LectureDuPont = { factures: FACTURES_DU_PONT, transmissions: TRANSMISSIONS, motif: null }
const lues = (lignes: FacturePourMarquer[]) => ({ lignes, complete: true, motif: null })

// Les pièces d'une sélection, dans un dossier basculé.
const ACHAT = piece({ id: 'achat', type_piece: 'achat' })
const NON_MARQUEE = piece({ id: 'non-marquee' })
const DECLAREE = piece({ id: 'declaree', vente_hors_des_factures: true })
const EXEMPLAIRE = piece({ id: 'exemplaire', facture_id: 'f1' })
const JUMELLE = piece({ id: 'jumelle', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' })
const JUMELLE_DESIGNEE = piece({ id: 'jumelle-designee', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', facture_id: 'f1' })
const JUMELLE_AILLEURS = piece({ id: 'jumelle-ailleurs', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', facture_id: 'f2' })
const DEJA_VALIDEE = piece({ id: 'deja-validee', statut: 'validee' })
const PIECES = [ACHAT, NON_MARQUEE, DECLAREE, EXEMPLAIRE, JUMELLE, JUMELLE_DESIGNEE, JUMELLE_AILLEURS, DEJA_VALIDEE]

const mots = (cle: (typeof REFUS_VALIDATION_D_UNE_VENTE)[number]['cle'], ...valeurs: string[]) => {
  let modele: string = REFUS_VALIDATION_D_UNE_VENTE.find((r) => r.cle === cle)?.modele ?? ''
  for (const v of valeurs) modele = modele.replace('%', v)
  return modele
}

describe('le pont, sans la désignation', () => {
  it('une pièce désignée à une autre facture que celle que son flux prouve : le pont dit celle du flux', () => {
    const avec = pontSansLaDesignation(FACTURES_DU_PONT, TRANSMISSIONS, [JUMELLE_AILLEURS])
    expect(verdictDuPontDeLaPiece(avec, 'jumelle-ailleurs')).toEqual({ genre: 'une', factureId: 'f1' })
    // Une pièce que rien ne prouve, désignée : le pont ne dit rien d'elle — la désignation est la marque, pas une preuve.
    expect(verdictDuPontDeLaPiece(pontSansLaDesignation(FACTURES_DU_PONT, TRANSMISSIONS, [EXEMPLAIRE]), 'exemplaire'))
      .toEqual({ genre: 'aucune' })
  })
})

describe('jugeDeLaValidation : dormante, jugée, ou non lue — jamais devinée', () => {
  it('un dossier qui n’a pas basculé : G3 dort, quoi qu’on ait lu', () => {
    expect(jugeDeLaValidation(false, null, null, PIECES)).toEqual({ etat: 'dormante' })
    expect(jugeDeLaValidation(false, { lignes: [], complete: false, motif: 'm' }, PONT, PIECES)).toEqual({ etat: 'dormante' })
  })
  it('basculé : pas encore revenues, lues en partie, ou le pont en partie — non lue, et le motif', () => {
    expect(jugeDeLaValidation(true, null, PONT, PIECES)).toEqual({ etat: 'non_lue', motif: null })
    expect(jugeDeLaValidation(true, lues(FACTURES), null, PIECES)).toEqual({ etat: 'non_lue', motif: null })
    expect(jugeDeLaValidation(true, { lignes: FACTURES, complete: false, motif: '2 sur 3' }, PONT, PIECES))
      .toEqual({ etat: 'non_lue', motif: '2 sur 3' })
    expect(jugeDeLaValidation(true, { lignes: FACTURES, complete: false, motif: null }, PONT, PIECES))
      .toEqual({ etat: 'non_lue', motif: 'lecture incomplète' })
    expect(jugeDeLaValidation(true, lues(FACTURES), { ...PONT, motif: 'les transmissions : 0 sur 2' }, PIECES))
      .toEqual({ etat: 'non_lue', motif: 'les transmissions : 0 sur 2' })
  })
  it('basculé et tout lu : jugée, sur le pont sans la désignation', () => {
    const juge = jugeDeLaValidation(true, lues(FACTURES), PONT, PIECES)
    expect(juge.etat).toBe('jugee')
    if (juge.etat !== 'jugee') return
    expect(juge.factures).toEqual(FACTURES)
    expect(verdictDuPontDeLaPiece(juge.pont, 'jumelle-ailleurs')).toEqual({ genre: 'une', factureId: 'f1' })
  })
})

describe('refusDeValiderEnLot et validationEnLot : ce que G3 refuserait, sous ses mots', () => {
  const JUGEE = jugeDeLaValidation(true, lues(FACTURES), PONT, PIECES)

  it('dans un dossier basculé, pièce par pièce', () => {
    expect(refusDeValiderEnLot(ACHAT, JUGEE)).toBeNull()
    expect(refusDeValiderEnLot(NON_MARQUEE, JUGEE)).toBe(mots('ni_designee_ni_declaree', 'non-marquee.pdf'))
    expect(refusDeValiderEnLot(DECLAREE, JUGEE)).toBeNull()
    // L'exemplaire d'une facture source se valide : c'est G4 qui le tient hors du relevé.
    expect(refusDeValiderEnLot(EXEMPLAIRE, JUGEE)).toBeNull()
    expect(refusDeValiderEnLot(JUMELLE, JUGEE)).toBe(mots('pont_une_facture', 'jumelle.pdf', 'F2026-0021'))
    expect(refusDeValiderEnLot(JUMELLE_DESIGNEE, JUGEE)).toBeNull()
    expect(refusDeValiderEnLot(JUMELLE_AILLEURS, JUGEE)).toBe(mots('pont_une_facture', 'jumelle-ailleurs.pdf', 'F2026-0021'))
    // Une pièce déjà validée ne se rejuge pas (EC3-Q1) : la valider de nouveau n'est pas un passage.
    expect(refusDeValiderEnLot(DEJA_VALIDEE, JUGEE)).toBeNull()
  })

  it('des preuves qui se contredisent : refusée, même désignée à l’une des deux factures', () => {
    // Le flux de F2026-0021 et l'identifiant Super PDP de F2026-0022 : deux factures, des preuves qui se contredisent.
    const superpdp = { ...FACTURES_DU_PONT[1], superpdp_invoice_id: 77 }
    const pont: LectureDuPont = { factures: [FACTURES_DU_PONT[0], superpdp, FACTURES_DU_PONT[2]], transmissions: TRANSMISSIONS, motif: null }
    const contraire = piece({ id: 'contraire', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', superpdp_invoice_id: 77, facture_id: 'f1' })
    const juge = jugeDeLaValidation(true, lues(FACTURES), pont, [contraire])
    expect(refusDeValiderEnLot(contraire, juge)).toBe(mots('preuves_contraires', 'contraire.pdf'))
  })

  it('la sélection : ce qui part, ce qui reste — dans son ordre', () => {
    const lot = validationEnLot(PIECES, JUGEE)
    expect(lot.aValider.map((p) => p.id)).toEqual(['achat', 'declaree', 'exemplaire', 'jumelle-designee', 'deja-validee'])
    expect(lot.ecartees.map((e) => e.piece.id)).toEqual(['non-marquee', 'jumelle', 'jumelle-ailleurs'])
    expect(lot.ecartees[0].raison).toBe(mots('ni_designee_ni_declaree', 'non-marquee.pdf'))
  })

  it('dans un dossier qui n’a pas basculé : rien ne change, tout part', () => {
    const dormante: JugeDeLaValidation = { etat: 'dormante' }
    const lot = validationEnLot(PIECES, dormante)
    expect(lot.aValider).toEqual(PIECES)
    expect(lot.ecartees).toEqual([])
    expect(refusDeValidationDesPieces(PIECES, dormante)).toEqual(new Map())
  })

  it('les factures ou le pont non lus : une pièce de vente qui deviendrait validée ne part pas ; le reste, si', () => {
    const juge: JugeDeLaValidation = { etat: 'non_lue', motif: '1 sur 3' }
    const lot = validationEnLot(PIECES, juge)
    expect(lot.aValider.map((p) => p.id)).toEqual(['achat', 'deja-validee'])
    expect(new Set(lot.ecartees.map((e) => e.raison))).toEqual(new Set([raisonNonLue('1 sur 3')]))
    expect(raisonNonLue('1 sur 3')).toBe('Les factures émises du dossier ne sont pas lues en entier (1 sur 3) : la validation '
      + 'd’une pièce de vente ne se juge pas — recharge la page.')
    expect(refusDeValiderEnLot(NON_MARQUEE, { etat: 'non_lue', motif: null }))
      .toBe('Les factures émises du dossier ne sont pas encore lues : la validation d’une pièce de vente attend leur lecture.')
  })

  it('refusDeValidationDesPieces : la table pièce → raison des refusées seulement', () => {
    expect([...refusDeValidationDesPieces(PIECES, JUGEE).keys()]).toEqual(['non-marquee', 'jumelle', 'jumelle-ailleurs'])
    expect(AUCUN_REFUS_DE_VALIDATION.size).toBe(0)
  })

  it('ce que l’écran en dit : combien', () => {
    expect(resumeDeLaSelection(0)).toBeNull()
    expect(resumeDeLaSelection(1)).toBe('1 pièce de la sélection ne se valide pas en lot : elle reste à valider.')
    expect(resumeDeLaSelection(3)).toBe('3 pièces de la sélection ne se valident pas en lot : elles restent à valider.')
    expect(resumeDesPairesEcartees(0)).toBeNull()
    expect(resumeDesPairesEcartees(1)).toBe('1 pièce écartée : elle ne se valide pas en lot.')
    expect(resumeDesPairesEcartees(2)).toBe('2 pièces écartées : elles ne se valident pas en lot.')
  })
})

// ── G4 : l'exemplaire d'une facture source dans les plans du relevé ────────────────────────────────────────────────────

const EX_SOURCE = piece({ id: 'ex-source', statut: 'validee', facture_id: 'f1', tiers: 'Librairie Rocher' })
const EX_AVANT = piece({ id: 'ex-avant', statut: 'validee', facture_id: 'f0', tiers: 'Ancien Client Dupuis', montant_ttc: 250 })
const AUTRE = piece({ id: 'autre', statut: 'validee', type_piece: 'vente', tiers: 'Atelier fictif' })
const EXEMPLAIRES = exemplairesDesSourcesDe([EX_SOURCE, EX_AVANT, AUTRE, ACHAT], FACTURES)
const SOURCES = EXEMPLAIRES.sources
const CREDIT = mouvement({ id: 'm-600', libelle: 'VIR LIBRAIRIE ROCHER' })
const CREDIT_AVANT = mouvement({ id: 'm-250', montant: 250, libelle: 'VIR ANCIEN CLIENT DUPUIS' })

describe('exemplairesDesSourcesDe : les factures sources, et les mots de G4 pour chaque exemplaire', () => {
  it('l’exemplaire d’une facture source, lui seul ; l’exemplaire d’une facture d’avant compte comme hier', () => {
    expect([...SOURCES]).toEqual([...facturesSourcesDe(FACTURES)])
    expect([...SOURCES]).toEqual(['f1', 'f2'])
    expect([...EXEMPLAIRES.raisons.entries()]).toEqual([[
      'ex-source', REFUS_EXEMPLAIRE_D_UNE_SOURCE[0].modele.replace('%', 'ex-source.pdf').replace('%', 'F2026-0021'),
    ]])
    expect(AUCUN_EXEMPLAIRE_DE_SOURCE).toEqual({ sources: new Set(), raisons: new Map() })
  })
})

describe('les plans du relevé ne prennent jamais l’exemplaire d’une facture source', () => {
  it('candidatsPieces : ni proposé, ni compté ; celui d’une facture d’avant, si', () => {
    expect(candidatsPieces(CREDIT, [EX_SOURCE], new Set(), SOURCES)).toEqual([])
    expect(candidatsPieces(CREDIT, [EX_SOURCE], new Set(), AUCUNE_FACTURE_SOURCE)).toEqual([EX_SOURCE])
    expect(candidatsPieces(CREDIT_AVANT, [EX_AVANT], new Set(), SOURCES)).toEqual([EX_AVANT])
  })

  it('le rapprochement automatique : l’exemplaire ne se retient pas, et ne dispute plus le crédit à une autre pièce', () => {
    const vide = { pieces: new Set<string>(), cotisations: new Set<string>() }
    expect(planRapprochementAutomatique([CREDIT], [EX_SOURCE], [], vide, AUCUN_HORS_DES_LOTS, SOURCES))
      .toEqual({ retenus: [], ecartesPourAmbiguite: 0, ecartesParLesVentes: [] })
    // Il ne dispute rien : l'autre pièce du même montant est seule, et se retient.
    expect(planRapprochementAutomatique([CREDIT], [EX_SOURCE, AUTRE], [], vide, AUCUN_HORS_DES_LOTS, SOURCES).retenus)
      .toEqual([{ ligneId: 'm-600', pieceId: 'autre' }])
    // Hier — et dans un dossier qui n'a pas basculé —, les deux se disputaient le crédit.
    expect(planRapprochementAutomatique([CREDIT], [EX_SOURCE, AUTRE], [], vide, AUCUN_HORS_DES_LOTS, AUCUNE_FACTURE_SOURCE))
      .toEqual({ retenus: [], ecartesPourAmbiguite: 1, ecartesParLesVentes: [] })
    // L'exemplaire d'une facture d'avant se rapproche comme hier (VF5h lui écrit sa banque sur un virement mixte).
    expect(planRapprochementAutomatique([CREDIT_AVANT], [EX_AVANT], [], vide, AUCUN_HORS_DES_LOTS, SOURCES).retenus)
      .toEqual([{ ligneId: 'm-250', pieceId: 'ex-avant' }])
  })

  it('l’appariement certain : l’exemplaire n’entre ni dans les paires, ni dans leur unicité', () => {
    const aValider = piece({ id: 'ex-a-valider', facture_id: 'f1', tiers: 'Librairie Rocher' })
    expect(analyserAppariements([aValider], [CREDIT], SOURCES)).toEqual({ certains: [], aArbitrer: [] })
    expect(analyserAppariements([aValider], [CREDIT], AUCUNE_FACTURE_SOURCE).certains.map((a) => a.piece.id)).toEqual(['ex-a-valider'])
    const autre = piece({ id: 'autre-a-valider', tiers: 'Librairie Rocher' })
    expect(analyserAppariements([aValider, autre], [CREDIT], SOURCES).certains.map((a) => a.piece.id)).toEqual(['autre-a-valider'])
    expect(analyserAppariements([aValider, autre], [CREDIT], AUCUNE_FACTURE_SOURCE).certains).toEqual([])
  })

  it('« Valider et rapprocher » : la paire dont la pièce ne se validerait pas est écartée, sous sa raison ; le mouvement réservé d’abord', () => {
    const paire = (id: string, ligne: LigneBancaire): Appariement => ({ piece: piece({ id }), ligne, ecartJours: 1 })
    const refus = new Map([['p-g3', 'raison de G3'], ['p-res', 'raison de G3 aussi']])
    const hors = new Map([['m-res', 'mots de la garde G2']])
    const lot = lotDesCertains(
      [paire('p-ok', mouvement({ id: 'm-ok' })), paire('p-g3', mouvement({ id: 'm-g3' })), paire('p-res', mouvement({ id: 'm-res' }))],
      hors, refus,
    )
    expect(lot.aEcrire.map((a) => a.piece.id)).toEqual(['p-ok'])
    expect(lot.ecartesParLaValidation.map((a) => [a.piece.id, a.raison])).toEqual([['p-g3', 'raison de G3']])
    expect(lot.ecartesParLesVentes.map((a) => a.piece.id)).toEqual(['p-res'])
    expect(lotDesCertains([paire('p-g3', mouvement({ id: 'm-g3' }))], AUCUN_HORS_DES_LOTS, AUCUN_REFUS_DE_VALIDATION).aEcrire)
      .toHaveLength(1)
  })

  describe('justificatifPossible : l’exemplaire n’est le justificatif d’aucun mouvement', () => {
    const aucun: JustificatifsDuDossier = {
      pieces: [], piecesRapprochees: new Set(), restesARegler: new Map(), cotisations: [], cotisationsRapprochees: new Set(),
      ventes: AUCUN_CANDIDAT, facturesSources: SOURCES,
    }
    it('ni par son montant, ni par son tiers, ni par un reste', () => {
      expect(justificatifPossible(CREDIT, { ...aucun, pieces: [EX_SOURCE] })).toBeNull()
      expect(justificatifPossible(mouvement({ id: 'm-autre', montant: 333, libelle: 'VIR LIBRAIRIE ROCHER' }), { ...aucun, pieces: [EX_SOURCE] }))
        .toBeNull()
      const avecReste = { ...aucun, pieces: [EX_SOURCE], piecesRapprochees: new Set(['ex-source']), restesARegler: new Map([['ex-source', 600]]) }
      expect(justificatifPossible(mouvement({ id: 'm-x', libelle: 'VIR X' }), avecReste)).toBeNull()
      // Hier — et dans un dossier qui n'a pas basculé —, chacun le disait.
      const hier = { ...aucun, facturesSources: AUCUNE_FACTURE_SOURCE }
      expect(justificatifPossible(CREDIT, { ...hier, pieces: [EX_SOURCE] })).toBe('Une pièce du même montant attend un rapprochement.')
      expect(justificatifPossible(mouvement({ id: 'm-autre', montant: 333, libelle: 'VIR LIBRAIRIE ROCHER' }), { ...hier, pieces: [EX_SOURCE] }))
        .toBe('Un justificatif de ce tiers n’est rapproché d’aucun mouvement.')
      expect(justificatifPossible(mouvement({ id: 'm-x', libelle: 'VIR X' }), { ...avecReste, facturesSources: AUCUNE_FACTURE_SOURCE }))
        .toBe('Une pièce payée en partie attend son solde : ce mouvement le règle peut-être.')
    })
    it('l’exemplaire d’une facture d’avant reste un justificatif', () => {
      expect(justificatifPossible(CREDIT_AVANT, { ...aucun, pieces: [EX_AVANT] })).toBe('Une pièce du même montant attend un rapprochement.')
    })
  })
})

// CE QUE LES PLANS ÉCARTENT EST UN PARAMÈTRE OBLIGATOIRE : chaque appel ci-dessous l'omet et porte `@ts-expect-error` — que
// `tsc -b` refuse dès qu'une valeur par défaut s'y glisserait. La fonction n'est jamais appelée : seul le compilateur la juge.
describe('les paramètres n’ont pas de valeur par défaut', () => {
  it('le compilateur refuse un appelant qui les oublie (les directives `@ts-expect-error` sont jugées par tsc -b)', () => {
    const sansEux = (lignes: LigneBancaire[], pieces: Piece[], certains: Appariement[]) => {
      const vide = { pieces: new Set<string>(), cotisations: new Set<string>() }
      // @ts-expect-error — les factures sources, omises
      analyserAppariements(pieces, lignes)
      // @ts-expect-error — omises
      candidatsPieces(lignes[0], pieces, new Set())
      // @ts-expect-error — omises
      planRapprochementAutomatique(lignes, pieces, [], vide, AUCUN_HORS_DES_LOTS)
      // @ts-expect-error — les refus de G3, omis
      lotDesCertains(certains, AUCUN_HORS_DES_LOTS)
      // @ts-expect-error — les factures sources des justificatifs, omises
      justificatifPossible(lignes[0], {
        pieces, piecesRapprochees: new Set(), restesARegler: new Map(), cotisations: [], cotisationsRapprochees: new Set(), ventes: AUCUN_CANDIDAT,
      })
      // @ts-expect-error — les pièces que le pont lit, omises
      jugeDeLaValidation(true, null, null)
    }
    expect(typeof sansEux).toBe('function')
  })
})
