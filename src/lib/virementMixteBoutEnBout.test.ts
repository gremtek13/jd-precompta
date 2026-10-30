import { describe, expect, it } from 'vitest'
import { concordance2035 } from './concordance2035'
import { calculerCa3 } from './declarationTva'
import { calculerDeclaration2035, type EcrituresDesVentesDeLa2035 } from './declaration2035'
import { lignesPourPiece } from './ecritures'
import { mouvementsClassesParEncaissements, type SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { partsEncaissees, refusClassement, type ExemplaireLu, type MouvementClasse } from './encaissementsFactures'
import { RECETTES_FACTUREES_NON_COMPTEES, recettesFactureesDuDossier, totauxPourAnnee } from './estimation'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { paiementsDesPieces, type PartEncaissee } from './rattachement'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { Categorie, EcritureBrouillon, Piece } from './types'
import { ventesFacturees } from './ventesFacturees'
import { D_BASCULE, brouillonDesVentes, composition, facture, ligneBancaire, mouvementDesVentes, pieceDeVente } from '../test/dossierBascule'
import { NON_VALIDEE } from '../test/ecritures'
import { encaissementVendu, ligneVendue } from '../test/ventesFacturees'
import { CAISSE_ABSENTE } from './recettesDeCaisse'

// LE VIREMENT MIXTE, DE BOUT EN BOUT (chantier EC-Q3, ligne 28.65, étape VF5h ; VF2-Q2, selon VF5-Q2 : la manière A, « le
// registre DATE la pièce »). Un dossier basculé, en trésorerie, assujetti, des services à 20 % :
//   - F2026-0001, une facture SOURCE de 120 € TTC du 02/01/2026, encaissée de 120 € le 08/01 par un virement du jour ;
//   - F2025-0042, une facture d'AVANT la bascule, de 60 € TTC du 15/12/2025 — sa vente se compte par sa pièce, l'exemplaire
//     désigné (étape VF1) —, encaissée de 60 € le 05/01/2026 sur le même virement ;
//   - le virement M, du 08/01/2026, de 179,50 € : 0,50 € de frais.
// Rien n'est écrit à la main : la composition écrit la part des sources et les frais, la pièce sa propre banque, datée par
// le virement (`partsEncaissees`, `paiementsDesPieces`) ; la 2035, la CA3, la situation et l'estimation comptent la vente
// d'avant une fois, à la date du virement — et sans la part du virement mixte, à sa date de facture, dans l'exercice
// d'avant. Sous les deux plans. Données FICTIVES.

const PLANS: readonly [string, PlanComptable][] = [['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE]]

const RECETTES = {
  id: 'c-recettes', dossier_id: null, code: 'recettes', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000',
  poste_2035: 'Recettes',
} as Categorie
const FRAIS_BANCAIRES = {
  id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 2, compte_comptable: '627000',
  poste_2035: 'Frais financiers',
} as Categorie

// L'exemplaire de F2025-0042 : la pièce de vente validée que le cabinet a désignée (étape VF1).
const EXEMPLAIRE: Piece = pieceDeVente({
  id: 'p-avant', date_piece: '2025-12-15', montant_ht: 50, montant_tva: 10, montant_ttc: 60, categorie_id: 'c-recettes', facture_id: 'f-avant',
})
const DESIGNEE: ExemplaireLu = { id: 'p-avant', dossier_id: D_BASCULE, facture_id: 'f-avant', statut: 'validee', type_piece: 'vente' }

function sources(exemplaires: readonly ExemplaireLu[]): SourcesDesEcrituresDeVente {
  const source = encaissementVendu({ id: 'e-source', facture_id: 'f-source', date_encaissement: '2026-01-08', montant: 120, ligne_bancaire_id: 'm' })
  const avant = encaissementVendu({ id: 'e-avant', facture_id: 'f-avant', date_encaissement: '2026-01-05', montant: 60, ligne_bancaire_id: 'm' })
  const ecran = (e: typeof source) => ({ ...e.encaissement, cree_le: `${e.encaissement.date_encaissement}T10:00:00Z`, compte_contrepartie: null, cree_par: null })
  return {
    dossierId: D_BASCULE,
    factures: [
      facture({ id: 'f-source', numero: 'F2026-0001', date_emission: '2026-01-02', montant_ttc: 120 }),
      facture({ id: 'f-avant', numero: 'F2025-0042', date_emission: '2025-12-15', montant_ttc: 60, source_de_la_vente: false }),
    ],
    lignes: [ligneVendue('f-source', 100, 20), ligneVendue('f-avant', 50, 20)],
    encaissements: [ecran(source), ecran(avant)],
    parts: [source.part, avant.part],
    mouvements: [mouvementDesVentes({ id: 'm', date: '2026-01-08', montant: 179.5 })],
    exemplaires,
  }
}

// Ce que l'écran calcule : les parts du virement mixte (tirées du registre comme `lireLesVentesFacturees` les rend), puis
// les paiements de chaque pièce.
function leDossier(plan: PlanComptable, exemplaires: readonly ExemplaireLu[] = [DESIGNEE]) {
  const s = sources(exemplaires)
  const c = composition(s, 'tresorerie', plan)
  const ventes = ventesFacturees({ dossierId: s.dossierId, factures: s.factures, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts })
  const encaissees: PartEncaissee[] = partsEncaissees(D_BASCULE, s.encaissements, { factures: s.factures }, exemplaires)
  const paiements = paiementsDesPieces(s.mouvements.map(ligneBancaire), [], encaissees)
  const lignesDeLExemplaire = lignesPourPiece(D_BASCULE, EXEMPLAIRE, { compte: '706000', immobilisation: false }, true,
    paiements.get(EXEMPLAIRE.id) ?? [], { mode: 'tresorerie', compteNotesDeFrais: '455000', plan })
  const brouillon: EcritureBrouillon[] = [
    ...brouillonDesVentes(c),
    ...lignesDeLExemplaire.map((l, i): EcritureBrouillon => ({
      ...l, id: `p${i + 1}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null, created_at: `${l.date}T12:00:00Z`,
      immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null,
      ...NON_VALIDEE,
    })),
  ]
  const ecritures: EcrituresDesVentesDeLa2035 = { etat: 'composees', composition: c }
  const declaration = (annee: number, p = paiements) => calculerDeclaration2035(
    annee, [EXEMPLAIRE], [RECETTES, FRAIS_BANCAIRES], [], [], [], true, p, [], [], plan, ventes, ecritures, CAISSE_ABSENTE)
  return { s, c, ventes, encaissees, paiements, brouillon, declaration, ecritures }
}

const centimes = (montant: number) => Math.round(montant * 100)

describe.each(PLANS)('le virement mixte, de bout en bout — %s', (_, plan) => {
  it('le classement compte les deux encaissements avec l’exemplaire, et le refuse sans lui sous ses mots', () => {
    const s = sources([DESIGNEE])
    const declasse: MouvementClasse[] = s.mouvements.map((m) => ({ ...m, statut: 'non_rapprochee', encaissements_de_factures: false }))
    expect(refusClassement(D_BASCULE, 'm', declasse, s.encaissements, { anneesValidees: [], factures: s.factures }, [DESIGNEE])).toBeNull()
    expect(refusClassement(D_BASCULE, 'm', declasse, s.encaissements, { anneesValidees: [], factures: s.factures }, [])?.message)
      .toMatch(/^Désignez d'abord l'exemplaire de la facture F2025-0042 : /)
  })

  it('les écritures : la part de la source et les frais du tout ; la pièce sa banque ; sur le virement, la banque fait son crédit', () => {
    const { c, brouillon } = leDossier(plan)
    expect(c.nonEcrites).toEqual([])
    const duMouvement = c.ecritures.filter((e) => e.source.genre === 'mouvement')
    expect(duMouvement.flatMap((e) => e.lignes.map((l) => [l.compte, l.sens, l.centimes]))).toEqual([
      [plan.banque, 'credit', 50], [plan.services_bancaires, 'debit', 50],
    ])
    const banque = brouillon.filter((l) => l.ligne_bancaire_id === 'm' && l.compte === plan.banque)
    expect(banque.map((l) => [l.piece_id ?? l.encaissement_id ?? 'm', l.date, l.sens, centimes(l.montant)])).toEqual([
      ['e-source', '2026-01-08', 'debit', 12000], ['m', '2026-01-08', 'credit', 50], ['p-avant', '2026-01-08', 'debit', 6000],
    ])
    expect(banque.reduce((t, l) => t + centimes(l.montant) * (l.sens === 'debit' ? 1 : -1), 0)).toBe(17950)
  })

  it('la 2035 : la vente d’avant compte une fois, en 2026, à la date du virement ; la concordance est entière', () => {
    const { declaration, brouillon, s } = leDossier(plan)
    const d2026 = declaration(2026)
    // 100 € de la facture source, 50 € HT de l'exemplaire, 0,50 € de frais.
    expect([d2026.totalRecettes, d2026.totalDepenses]).toEqual([150, 0.5])
    expect(d2026.sansPaiementConnu).toEqual([])
    expect(declaration(2025).totalRecettes).toBe(0)
    const conc = concordance2035(d2026, brouillon, {
      piecesValidees: new Set([EXEMPLAIRE.id]), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(s.mouvements),
    }, null)
    expect(conc.ecarts).toEqual([])
    expect(conc.concorde).toBe(true)
  })

  it('sans la part du virement mixte, la pièce retomberait à sa date de facture : l’exercice d’avant, « sans paiement connu »', () => {
    const { declaration } = leDossier(plan)
    const sansLaPart = paiementsDesPieces([ligneBancaire(sources([DESIGNEE]).mouvements[0])], [], [])
    expect(declaration(2025, sansLaPart).totalRecettes).toBe(50)
    expect(declaration(2025, sansLaPart).sansPaiementConnu.map((x) => x.piece.id)).toEqual(['p-avant'])
    expect(declaration(2026, sansLaPart).totalRecettes).toBe(100)
  })

  it('la CA3 de janvier 2026 : la TVA de la source à son encaissement, celle de l’exemplaire au virement — exigibles ensemble', () => {
    const { ventes, paiements } = leDossier(plan)
    const ca3 = (debut: string, fin: string, p = paiements) => calculerCa3(
      { pieces: [EXEMPLAIRE], paiements: p, pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventes, caisse: CAISSE_ABSENTE }, { debut, fin }, false, 0, 0)
    const janvier = ca3('2026-01-01', '2026-01-31')
    expect([janvier.cases.base08, janvier.cases.taxe08]).toEqual([150, 30])
    expect(janvier.retenues.map((r) => [r.piece.id, r.part, r.ligne])).toEqual([['p-avant', 1, '08']])
    expect(ca3('2025-12-01', '2025-12-31').retenues).toEqual([])
  })

  it('la situation de janvier et l’estimation de 2026 la comptent aussi, une fois', () => {
    const { ventes, paiements, ecritures } = leDossier(plan)
    const situation = calculerSituationIntermediaire([EXEMPLAIRE], [RECETTES, FRAIS_BANCAIRES], [], [], '2026-01-01', '2026-01-31', true,
      paiements, 'tresorerie', [], ventes, plan, ecritures, CAISSE_ABSENTE)
    expect(situation.recettes).toBe(150)
    const estimation = totauxPourAnnee([EXEMPLAIRE], [], 2026, true, paiements, 'tresorerie', [], recettesFactureesDuDossier(ventes, 'tresorerie'), CAISSE_ABSENTE)
    expect(estimation.ca).toBe(150)
    // « Ma simulation » ne compte pas encore les ventes facturées (jusqu'à VF8) : l'exemplaire seul, daté par le virement.
    expect(totauxPourAnnee([EXEMPLAIRE], [], 2026, true, paiements, 'tresorerie', [], RECETTES_FACTUREES_NON_COMPTEES, CAISSE_ABSENTE).ca).toBe(50)
  })

  it('sans l’exemplaire unique et validé : rien n’est payé, et le mouvement ne s’écrit pas — la facture nommée', () => {
    for (const exemplaires of [[], [{ ...DESIGNEE, statut: 'a_valider' }], [DESIGNEE, { ...DESIGNEE, id: 'p-autre' }]] as ExemplaireLu[][]) {
      const { c, encaissees } = leDossier(plan, exemplaires)
      expect(encaissees).toEqual([])
      expect(c.nonEcrites.map((n) => [n.source.genre, n.motif, n.facture])).toEqual([['mouvement', 'mouvement_facture_non_source', 'F2025-0042']])
    }
  })
})
