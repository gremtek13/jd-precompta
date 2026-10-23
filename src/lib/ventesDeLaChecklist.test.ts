import { describe, expect, it } from 'vitest'
import { SANS_FACTURE_SOURCE } from '../test/ventesFacturees'
import { lignesPourPiece } from './ecritures'
import { partsEncaissees, type ExemplaireLu, type LigneDeFacture } from './encaissementsFactures'
import type { EncaissementDuMouvementLu, FactureDesGestes, LectureDesVentesDuReleve, SourcesDesGestes } from './mouvementsDesVentes'
import { pointsDeLaChecklist, type ContexteDeLaChecklist, type DonneesDeLaChecklist } from './pointsDeLaChecklist'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import type { Categorie, EcritureBrouillon, LigneBancaire, MoyenEncaissement } from './types'
import { pieceDeVente } from '../test/dossierBascule'
import { NON_VALIDEE } from '../test/ecritures'
import { detailDesEncaissementsSansMouvement, MOYENS_DU_RELEVE, ventesDeLaChecklist } from './ventesDeLaChecklist'

// CE QUE LA VUE D'ENSEMBLE DIT DES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (ligne 28.65, chantier EC-Q3, étape VF5f) :
// les mouvements réservés à des encaissements de factures, à classer, et les encaissements par un moyen du relevé qui
// attendent leur mouvement ; muets sur une lecture incomplète, sans objet pour un dossier qui n'a pas basculé. Puis les deux
// points de lib/pointsDeLaChecklist.ts qui les comptent, et les lignes non rapprochées, qui ne comptent plus un mouvement
// réservé deux fois. Données FICTIVES.

const D = 'd-bascule'

const facture = (o: Partial<FactureDesGestes> & Pick<FactureDesGestes, 'id' | 'numero'>): FactureDesGestes => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, tiers_nom: 'Client fictif',
  date_emission: '2026-03-01', montant_ttc: 600, ...o,
})
const ligneDeFacture = (factureId: string, ht: number): LigneDeFacture => ({
  facture_id: factureId, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: ht, taux_tva: 20,
})
const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-03-10', moyen: 'virement', ligne_bancaire_id: null, annule_id: null,
  cree_le: '2026-03-10T10:00:00Z', retire_le: null, cree_par: 'u-cabinet', ...o,
})
function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-03-12', libelle: 'VIR SEPA RECU FICTIF', montant: 600,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2026.csv', libelle_brut: null,
    created_at: '2026-04-01T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

// Deux factures sources (600 € chacune), et une facture d'avant la bascule.
const FACTURES = [
  facture({ id: 'f1', numero: 'F2026-0014', tiers_nom: 'SARL Horizon' }),
  facture({ id: 'f2', numero: 'F2026-0015', tiers_nom: 'Atelier Martin' }),
  facture({ id: 'f0', numero: 'F2025-0099', source_de_la_vente: false, tiers_nom: 'Ancien Client Dupuis' }),
]
const LIGNES = [ligneDeFacture('f1', 500), ligneDeFacture('f2', 500), ligneDeFacture('f0', 500)]

function lue(
  mouvements: readonly LigneBancaire[], encaissements: readonly EncaissementDuMouvementLu[] = [], exemplaires: readonly ExemplaireLu[] = [],
): LectureDesVentesDuReleve {
  const s: SourcesDesGestes = {
    dossierId: D, factures: FACTURES, lignes: LIGNES, encaissements, mouvements, exemplaires,
    parts: encaissements.filter((e) => e.annule_id == null).map((e) => ({ encaissement_id: e.id, taux: 20, montant: e.montant })),
  }
  return { dossierId: D, etat: 'lue', sources: s }
}
const reservesDe = (l: LectureDesVentesDuReleve, frontiere: string | null = null) => {
  const v = ventesDeLaChecklist(l, frontiere)
  return v.etat === 'lue' ? v.reserves.map((m) => m.id) : v.etat
}
const sansMouvementDe = (l: LectureDesVentesDuReleve, frontiere: string | null = null) => {
  const v = ventesDeLaChecklist(l, frontiere)
  return v.etat === 'lue' ? v.sansMouvement.map((e) => e.id) : v.etat
}

describe('ventesDeLaChecklist : la lecture', () => {
  it('sans objet pour un dossier qui n’a pas basculé ; incomplète avec son motif', () => {
    expect(ventesDeLaChecklist(null, null)).toEqual({ etat: 'sans_objet' })
    expect(ventesDeLaChecklist({ dossierId: D, etat: 'incomplete', motif: 'les encaissements : 1000 lignes lues sur 1200' }, null))
      .toEqual({ etat: 'incomplete', motif: 'les encaissements : 1000 lignes lues sur 1200' })
  })

  it('une lecture qui se dit d’un dossier et porte les sources d’un autre ne décide rien', () => {
    const l = lue([mouvement({ id: 'm1' })], [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })])
    if (l.etat !== 'lue') throw new Error('lue')
    const melee: LectureDesVentesDuReleve = { ...l, sources: { ...l.sources, dossierId: 'autre' } }
    expect(ventesDeLaChecklist(melee, null)).toEqual({ etat: 'incomplete', motif: 'la lecture rendue n’est pas celle de ce dossier' })
  })
})

describe('ventesDeLaChecklist : les mouvements réservés', () => {
  it('un crédit qu’un encaissement de facture source cite, pas encore classé : réservé ; classé, il ne l’est plus', () => {
    const e = encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })
    expect(reservesDe(lue([mouvement({ id: 'm1' })], [e]))).toEqual(['m1'])
    expect(reservesDe(lue([mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true })], [e]))).toEqual([])
  })

  it('un débit qu’une contre-passation cite : réservé aussi ; un mouvement que rien ne cite, jamais', () => {
    const encaissements = [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, moyen: 'cheque' }),
      encaissement({ id: 'c1', facture_id: 'f1', montant: -600, moyen: 'cheque', annule_id: 'e1', ligne_bancaire_id: 'm2', date_encaissement: '2026-03-20' }),
    ]
    expect(reservesDe(lue([mouvement({ id: 'm2', montant: -600, date: '2026-03-20' }), mouvement({ id: 'm3' })], encaissements))).toEqual(['m2'])
  })

  it('l’encaissement d’une facture d’avant la bascule, ou retiré, ne réserve rien', () => {
    expect(reservesDe(lue([mouvement({ id: 'm1' })], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600, ligne_bancaire_id: 'm1' })]))).toEqual([])
    expect(reservesDe(lue([mouvement({ id: 'm1' })], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', retire_le: '2026-03-15T10:00:00Z' }),
    ]))).toEqual([])
  })

  it('un mouvement que la validation fige ne se compte plus : rien ne le classe ; le lendemain de la frontière, si', () => {
    const l = lue([mouvement({ id: 'm1', date: '2025-12-31' }), mouvement({ id: 'm2', date: '2026-01-01' })], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1', date_encaissement: '2025-12-31' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 600, ligne_bancaire_id: 'm2', date_encaissement: '2026-01-01' }),
    ])
    expect(reservesDe(l, null)).toEqual(['m1', 'm2'])
    expect(reservesDe(l, '2025-12-31')).toEqual(['m2'])
  })

  it('un mouvement d’un autre dossier que la lecture porterait ne se compte pas', () => {
    const l = lue([mouvement({ id: 'm1', dossier_id: 'autre' })], [encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' })])
    expect(reservesDe(l)).toEqual([])
  })
})

describe('ventesDeLaChecklist : les encaissements sans mouvement du relevé', () => {
  it('par virement, prélèvement, chèque, carte ou effet ; jamais en espèces, par compensation ni « autre »', () => {
    const moyens: MoyenEncaissement[] = ['virement', 'prelevement', 'cheque', 'carte', 'effet', 'especes', 'compensation', 'autre']
    const encaissements = moyens.map((moyen, i) => encaissement({ id: `e-${moyen}`, facture_id: 'f1', montant: 10 + i, moyen }))
    expect(sansMouvementDe(lue([], encaissements))).toEqual(['e-virement', 'e-prelevement', 'e-cheque', 'e-carte', 'e-effet'])
    expect([...MOYENS_DU_RELEVE].sort()).toEqual(['carte', 'cheque', 'effet', 'prelevement', 'virement'])
  })

  it('ni rattaché à un mouvement, ni retiré, ni d’une facture d’avant la bascule, ni d’un autre dossier', () => {
    expect(sansMouvementDe(lue([mouvement({ id: 'm1' })], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 100, retire_le: '2026-03-11T10:00:00Z' }),
      encaissement({ id: 'e3', facture_id: 'f0', montant: 100 }),
      encaissement({ id: 'e4', facture_id: 'f2', montant: 100, dossier_id: 'autre' }),
      encaissement({ id: 'e5', facture_id: 'f2', montant: 100 }),
    ]))).toEqual(['e5'])
  })

  it('une contre-passation ne se compte pas ; son encaissement, s’il n’a pas eu lieu (elle sans mouvement), non plus', () => {
    expect(sansMouvementDe(lue([], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 120, moyen: 'cheque' }),
      encaissement({ id: 'c1', facture_id: 'f1', montant: -120, moyen: 'cheque', annule_id: 'e1' }),
    ]))).toEqual([])
  })

  it('l’encaissement d’un chèque revenu impayé — sa contre-passation cite le débit — attend toujours le crédit de sa remise', () => {
    expect(sansMouvementDe(lue([mouvement({ id: 'm2', montant: -120 })], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 120, moyen: 'cheque' }),
      encaissement({ id: 'c1', facture_id: 'f1', montant: -120, moyen: 'cheque', annule_id: 'e1', ligne_bancaire_id: 'm2' }),
    ]))).toEqual(['e1'])
  })

  it('un encaissement daté dans un exercice que la validation fige ne se compte plus ; le lendemain de la frontière, si', () => {
    const l = lue([], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 100, date_encaissement: '2025-12-31' }),
      encaissement({ id: 'e2', facture_id: 'f1', montant: 100, date_encaissement: '2026-01-01' }),
    ])
    expect(sansMouvementDe(l, null)).toEqual(['e1', 'e2'])
    expect(sansMouvementDe(l, '2025-12-31')).toEqual(['e2'])
  })

  it('le détail nomme chacun — facture, moyen, date, montant —, six au plus, et dit où les trouver', () => {
    const v = ventesDeLaChecklist(lue([], [
      encaissement({ id: 'e1', facture_id: 'f1', montant: 120.5, moyen: 'cheque', date_encaissement: '2026-03-05' }),
      encaissement({ id: 'e2', facture_id: 'f2', montant: 300, moyen: 'virement', date_encaissement: '2026-03-06' }),
    ]), null)
    if (v.etat !== 'lue') throw new Error('lue')
    const detail = detailDesEncaissementsSansMouvement(v).replace(/ | /g, ' ')
    expect(detail).toContain('Dans Factures, vue « Règlements », leur colonne « Mouvement » porte « — » :')
    expect(detail).toContain('F2026-0014 (chèque du 05/03/2026, 120,50 €), F2026-0015 (virement du 06/03/2026, 300,00 €).')
    expect(detail).toContain('dans Banque')
    expect(detail).not.toContain('autre(s)')
    const huit = ventesDeLaChecklist(lue([], Array.from({ length: 8 }, (_, i) => encaissement({ id: `e${i}`, facture_id: 'f1', montant: 10 }))), null)
    if (huit.etat !== 'lue') throw new Error('lue')
    const long = detailDesEncaissementsSansMouvement(huit)
    expect(long.match(/F2026-0014/g)).toHaveLength(6)
    expect(long).toContain(' et 2 autre(s).')
  })
})

// ── Les deux points de la Vue d'ensemble ──────────────────────────────────────────────────────────────────────────────

function donnees(o: Partial<DonneesDeLaChecklist>): DonneesDeLaChecklist {
  return {
    piecesValidees: [], piecesAValider: [], cotisations: [], lignes: [], relevesIncoherents: [], doublonsTexte: [], immobilisations: [],
    natures: [], categories: [], ecritures: [], emprunts: [], ventilations: [], ventilationsPartielles: false, reglements: [],
    reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: [], declarationsTva: [],
    declarationsPartielles: false, facturesEmises: [], transmissions: [], jumellesPartielles: false, info: null, infoInconnue: null,
    anneesCloturees: [], ouverture: null, ouvertureIncomplete: null, aNouveaux: [], soldesReportes: [], entreesDeLOuvertureIncompletes: null,
    ventesFacturees: null, facturesSources: SANS_FACTURE_SOURCE, ...o,
  }
}
const CONTEXTE: ContexteDeLaChecklist = {
  assujettiTva: true, periodiciteTva: 'trimestrielle', statutTva: 'redevable', modele: { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT },
  frontiere: null, anneesValidees: [], aujourdHui: '2026-10-24', anneeCourante: 2026, moisEcoules: 9, premierJourDuMois: '2026-10-01',
}
const point = (d: DonneesDeLaChecklist, id: string, frontiere: string | null = null) =>
  pointsDeLaChecklist(d, { ...CONTEXTE, frontiere }).tousLesPointsATraiter.find((p) => p.id === id)

describe('pointsDeLaChecklist : les ventes facturées (VF5f)', () => {
  // Un crédit réservé (m1), un crédit ordinaire (m2), un chèque enregistré sans mouvement.
  const RELEVE = [mouvement({ id: 'm1' }), mouvement({ id: 'm2', montant: 80 })]
  const REGISTRE = [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm1' }),
    encaissement({ id: 'e2', facture_id: 'f2', montant: 300, moyen: 'cheque' }),
  ]

  it('les deux points, en « attention », leurs cibles et leurs mots', () => {
    const d = donnees({ lignes: RELEVE, ventesFacturees: lue(RELEVE, REGISTRE) })
    expect(point(d, 'mouvements-reserves')).toMatchObject({
      nb: 1, cible: 'banque', severite: 'attention', label: 'mouvement(s) réservé(s) à des encaissements de factures, à classer',
    })
    expect(point(d, 'mouvements-reserves')?.detail).toContain('« Réservé à l’encaissement de la facture')
    expect(point(d, 'encaissements-sans-mouvement')).toMatchObject({
      nb: 1, cible: 'factures', severite: 'attention',
      label: 'encaissement(s) de factures par virement, prélèvement, chèque, carte ou effet sans mouvement du relevé',
    })
    expect(point(d, 'encaissements-sans-mouvement')?.detail).toContain('F2026-0015 (chèque du 10/03/2026')
  })

  it('un mouvement réservé ne se compte plus parmi les lignes non rapprochées — figé, il y reste, comme hier', () => {
    const d = donnees({ lignes: RELEVE, ventesFacturees: lue(RELEVE, REGISTRE) })
    expect(point(d, 'lignes-non-rapprochees')?.nb).toBe(1)
    const figes = RELEVE.map((m) => ({ ...m, date: '2025-06-01' }))
    const fige = donnees({ lignes: figes, ventesFacturees: lue(figes, REGISTRE) })
    expect(point(fige, 'mouvements-reserves', '2025-12-31')?.nb).toBe(0)
    expect(point(fige, 'lignes-non-rapprochees', '2025-12-31')?.nb).toBe(2)
  })

  it('sur une lecture incomplète, les deux points se taisent et les lignes non rapprochées comptent tout, comme hier', () => {
    const d = donnees({ lignes: RELEVE, ventesFacturees: { dossierId: D, etat: 'incomplete', motif: 'les encaissements : refus' } })
    expect(point(d, 'mouvements-reserves')?.nb).toBe(0)
    expect(point(d, 'encaissements-sans-mouvement')?.nb).toBe(0)
    expect(point(d, 'lignes-non-rapprochees')?.nb).toBe(2)
  })

  it('un dossier qui n’a pas basculé : rien de neuf', () => {
    const d = donnees({ lignes: RELEVE, ventesFacturees: null })
    expect(point(d, 'mouvements-reserves')?.nb).toBe(0)
    expect(point(d, 'encaissements-sans-mouvement')?.nb).toBe(0)
    expect(point(d, 'lignes-non-rapprochees')?.nb).toBe(2)
  })
})

// LE VIREMENT MIXTE (étape VF5h ; VF2-Q2, selon VF5-Q2) : le crédit m-mx, classé par ses encaissements, porte celui de la
// facture source F2026-0014 (600 €) et celui de la facture d'avant F2025-0099 (60 €), dont la pièce p-avant est
// l'exemplaire désigné ; ses écritures sont celles que la génération écrit, datées par le virement, sa banque sur lui. La
// Vue d'ensemble tire la part du virement mixte de la même lecture des ventes (`partsEncaissees`) : ces écritures ne sont
// pas « à régénérer », et la pièce n'est pas « payée en partie ». Lue en partie, cette lecture tait le second point —
// un virement mixte non lu ferait passer l'exemplaire pour payé en partie.
describe('pointsDeLaChecklist : l’exemplaire qu’un virement mixte paie (étape VF5h)', () => {
  const RECETTES = { id: 'c-rec', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' } as Categorie
  const EXEMPLAIRE = pieceDeVente({
    id: 'p-avant', dossier_id: D, date_piece: '2025-12-15', montant_ht: 50, montant_tva: 10, montant_ttc: 60, categorie_id: 'c-rec', facture_id: 'f0',
  })
  const DESIGNEE: ExemplaireLu = { id: 'p-avant', dossier_id: D, facture_id: 'f0', statut: 'validee', type_piece: 'vente' }
  const MIXTE = mouvement({ id: 'm-mx', date: '2026-03-12', montant: 660, statut: 'rapprochee', encaissements_de_factures: true })
  const REGISTRE = [
    encaissement({ id: 'e1', facture_id: 'f1', montant: 600, ligne_bancaire_id: 'm-mx', date_encaissement: '2026-03-12' }),
    encaissement({ id: 'ea', facture_id: 'f0', montant: 60, ligne_bancaire_id: 'm-mx', date_encaissement: '2026-03-12' }),
  ]
  // Les écritures de l'exemplaire, telles que la génération les écrit avec la part du virement mixte.
  const paiements = paiementsDesPieces([MIXTE], [], partsEncaissees(D, REGISTRE, { factures: FACTURES }, [DESIGNEE]))
  const ECRITES: EcritureBrouillon[] = lignesPourPiece(D, EXEMPLAIRE, { compte: '706000', immobilisation: false }, true,
    paiements.get('p-avant') ?? [], CONTEXTE.modele).map((l, i) => ({
    ...l, id: `ex${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null, created_at: `${l.date}T12:00:00Z`, immobilisation_id: null,
    vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE,
  }))
  const lesDonnees = (o: Partial<DonneesDeLaChecklist> = {}) => donnees({
    piecesValidees: [EXEMPLAIRE], categories: [RECETTES], lignes: [MIXTE], ecritures: ECRITES, ventesFacturees: lue([MIXTE], REGISTRE, [DESIGNEE]), ...o,
  })

  it('ses écritures, datées par le virement et sa banque sur lui, ne sont pas « à régénérer »', () => {
    expect(ECRITES.find((l) => l.compte === '512000')).toMatchObject({ date: '2026-03-12', ligne_bancaire_id: 'm-mx', sens: 'debit', montant: 60 })
    expect(point(lesDonnees(), 'desynchronisees')?.nb).toBe(0)
    expect(point(lesDonnees(), 'pieces-payees-en-partie')?.nb).toBe(0)
    // Le garde symétrique : sans la part — la désignation défaite —, les mêmes écritures sont à régénérer.
    expect(point(lesDonnees({ ventesFacturees: lue([MIXTE], REGISTRE, []) }), 'desynchronisees')?.nb).toBe(1)
  })

  it('payée pour moitié par un autre mouvement : sur des ventes lues en partie, le point « payée en partie » se tait', () => {
    const ACOMPTE = mouvement({ id: 'm-ac', date: '2026-02-01', montant: 30, statut: 'rapprochee', piece_id: 'p-avant' })
    const registre = [REGISTRE[0], { ...REGISTRE[1], montant: 30 }]
    const lignes = [MIXTE, ACOMPTE]
    // Lues en entier : 30 € + 30 € font la pièce ; rien n'est dit.
    expect(point(lesDonnees({ lignes, ventesFacturees: lue(lignes, registre, [DESIGNEE]) }), 'pieces-payees-en-partie')?.nb).toBe(0)
    // Lues en partie : le virement mixte manque, la pièce aurait l'air payée en partie — le point se tait.
    expect(point(lesDonnees({ lignes, ventesFacturees: { dossierId: D, etat: 'incomplete', motif: 'refusée' } }), 'pieces-payees-en-partie')?.nb)
      .toBe(0)
    // Le garde symétrique : sans le virement mixte, sur une lecture entière, la pièce EST payée en partie, et le point le dit.
    expect(point(lesDonnees({ lignes, ventesFacturees: lue(lignes, registre, []) }), 'pieces-payees-en-partie')?.nb).toBe(1)
  })
})
