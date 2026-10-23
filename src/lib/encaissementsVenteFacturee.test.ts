import { describe, expect, it } from 'vitest'
import { TEXTE_ESSAI_VENTES_FACTUREES, correspondAuModele, etapesDeLEssai, refusExigesParLEssai } from '../test/essaiVentesFacturees'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  REFUS_CLASSEMENT, REFUS_CONTRE_PASSATION, REFUS_ENREGISTREMENT, REFUS_GARDE_MOUVEMENTS, REFUS_RATTACHEMENT, REFUS_RETRAIT,
  REFUS_RETRAIT_CLASSEMENT, debitObligatoire, justifieSonMouvement, mouvementLibre, paireNonDeclaree, refusClassement,
  refusContrePassation, refusContrePassationAvantLaDate, refusContrePassationVente, refusDuClassementDuReleve,
  refusEnregistrement, refusEnregistrementVente, refusRattachement, refusRetrait, refusRetraitDuClassement, refusRetraitVente,
  type ContexteFacture, type ContexteVente, type EncaissementDuReleve, type EncaissementLu, type EncaissementPourContrePassation,
  type FactureDuDossier, type FacturePourEncaissement, type LigneDeFacture, type MouvementClasse, type SaisieEncaissement,
} from './encaissementsFactures'

// LES REFUS DE LA VENTE FACTURÉE (chantier EC-Q3, étape VF2 ; migration `encaissements_de_la_vente_facturee`, en base et dans
// l'export), JOUÉS PAR LE MODULE : chaque fonction neuve — et les versions de la vente facturée des trois fonctions d'hier —
// parcourue rang par rang, dans l'ordre de la base, chaque refus encore en faute derrière celui qu'on corrige ; et, pour une
// facture qui n'est pas source, la même réponse qu'hier. Les mots et les codes se confrontent au texte des fonctions dans
// encaissementsFactures.test.ts ; ce que la base répond en vrai, supabase/essais/ventesFacturees.sql le prouve.

const D = 'd1'
const AUJOURD_HUI = '2027-11-02'

// La facture SOURCE : 1 000 € à 20 %, 100 € à 5,5 %, 50 € à 0 % — 1 355,50 € TTC, dont 1 200 € à 20 %.
const LIGNES: LigneDeFacture[] = [
  { facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { facture_id: 'f1', ordre: 2, designation: 'b', quantite: 1, prix_unitaire_ht: 100, taux_tva: 5.5 },
  { facture_id: 'f1', ordre: 3, designation: 'c', quantite: 1, prix_unitaire_ht: 50, taux_tva: 0 },
]
// Son avoir validé : 100 € HT à 20 %, enregistré en négatif — il crédite 120 € à 20 %. Un brouillon d'avoir (un état que
// la base ne laisse pas naître, ici pour que le filtre se voie) et l'avoir d'une autre facture ne créditent rien.
const LIGNES_AVOIRS: LigneDeFacture[] = [
  { facture_id: 'av1', ordre: 1, designation: 'remise', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20 },
  { facture_id: 'av2', ordre: 1, designation: 'remise', quantite: -1, prix_unitaire_ht: 50, taux_tva: 20 },
  { facture_id: 'av3', ordre: 1, designation: 'remise', quantite: -1, prix_unitaire_ht: 70, taux_tva: 5.5 },
]

function facture(o: Partial<FacturePourEncaissement> = {}): FacturePourEncaissement {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2027-0042', date_emission: '2027-10-01',
    emetteur_siret: '12345678200010', montant_ht: 1150, montant_tva: 205.5, montant_ttc: 1355.5, superpdp_invoice_id: null,
    tiers_nom: 'Client Fictif SAS', source_de_la_vente: true, ...o,
  }
}

function contexte(o: Partial<ContexteFacture> = {}): ContexteFacture {
  return {
    dossierId: D, facture: facture(), lignes: [...LIGNES, ...LIGNES_AVOIRS], transmissions: [], evenementsSuperpdp: [],
    statutsRecus: [], encaissements: [], parts: [], ...o,
  }
}

function factureDuDossier(o: Partial<FactureDuDossier>): FactureDuDossier {
  return { id: 'f1', dossier_id: D, numero: 'F2027-0042', type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, ...o }
}

const FACTURES: FactureDuDossier[] = [
  factureDuDossier({}),
  factureDuDossier({ id: 'av1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1' }),
  factureDuDossier({ id: 'av2', numero: null, type: 'avoir', statut: 'brouillon', facture_origine_id: 'f1', source_de_la_vente: false }),
  factureDuDossier({ id: 'av3', numero: 'A2027-0002', type: 'avoir', facture_origine_id: 'f9' }),
  factureDuDossier({ id: 'f2', numero: 'F2027-0043', source_de_la_vente: false }),
  factureDuDossier({ id: 'f3', numero: 'F2027-0044' }),
]

function vente(o: Partial<ContexteVente> = {}): ContexteVente {
  return { anneesValidees: [], factures: FACTURES, ...o }
}

function mouvement(o: Partial<MouvementClasse> = {}): MouvementClasse {
  return {
    id: 'm1', dossier_id: D, date: '2027-10-15', montant: 1355.5, statut: 'non_rapprochee', piece_id: null, cotisation_id: null,
    categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false,
    prelevement_personnel: false, encaissements_de_factures: false, ...o,
  }
}

function encaissement(o: Partial<EncaissementPourContrePassation> = {}): EncaissementPourContrePassation {
  return {
    id: 'e1', dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: null, annule_id: null, retire_le: null,
    date_encaissement: '2027-10-15', ...o,
  }
}

function saisie(o: Partial<SaisieEncaissement> = {}): SaisieEncaissement {
  return { date: '2027-10-15', montant: 100, moyen: 'virement', ligneBancaireId: null, repartition: [{ taux: 20, montant: 100 }], ...o }
}

// Chaque champ qui CLASSE un mouvement, posé seul : la base ne laisse naître que ces formes-là (le seul rapprochement).
const CLASSEMENTS: [string, Partial<MouvementClasse>][] = [
  ['rapproché d’une pièce', { statut: 'rapprochee', piece_id: 'p1' }],
  ['une cotisation', { statut: 'rapprochee', cotisation_id: 'c1' }],
  ['une catégorie', { statut: 'rapprochee', categorie_id: 'k1' }],
  ['un emprunt', { statut: 'rapprochee', emprunt_id: 'em1' }],
  ['un compte de bilan', { statut: 'rapprochee', compte_bilan: '580000' }],
  ['une déclaration de TVA', { statut: 'rapprochee', declaration_tva_id: 't1' }],
  ['ventilé', { statut: 'rapprochee', ventilee: true }],
  ['un règlement groupé', { statut: 'rapprochee', reglement_groupe: true }],
  ['personnel', { statut: 'ignoree', prelevement_personnel: true }],
  ['classé par ses encaissements', { statut: 'rapprochee', encaissements_de_factures: true }],
  ['écarté', { statut: 'ignoree' }],
  ['rapproché sans rien d’autre', { statut: 'rapprochee' }],
]

describe('le mouvement libre et ce qu’un mouvement justifie', () => {
  it('un mouvement libre : à traiter, que rien ne classe, ni écarté, ni personnel', () => {
    expect(mouvementLibre(mouvement())).toBe(true)
    for (const [quoi, o] of CLASSEMENTS) expect(mouvementLibre(mouvement(o)), quoi).toBe(false)
    // Un seul champ, sans le statut : la base ne le laisse pas naître, et le prédicat le juge quand même classé.
    for (const champ of ['piece_id', 'cotisation_id', 'categorie_id', 'emprunt_id', 'compte_bilan', 'declaration_tva_id'] as const) {
      expect(mouvementLibre(mouvement({ [champ]: 'x' })), champ).toBe(false)
    }
    for (const champ of ['ventilee', 'reglement_groupe', 'prelevement_personnel', 'encaissements_de_factures'] as const) {
      expect(mouvementLibre(mouvement({ [champ]: true })), champ).toBe(false)
    }
  })

  it('un encaissement justifie son mouvement tant qu’aucune contre-passation vivante SANS mouvement ne l’annule', () => {
    const e = encaissement({ ligne_bancaire_id: 'm1' })
    expect(justifieSonMouvement(e, [e])).toBe(true)
    const sansMouvement = encaissement({ id: 'c1', montant: -100, annule_id: 'e1' })
    expect(justifieSonMouvement(e, [e, sansMouvement])).toBe(false)
    expect(justifieSonMouvement(e, [e, { ...sansMouvement, retire_le: '2027-10-20T10:00:00Z' }])).toBe(true)
    // Le chèque revenu impayé : la contre-passation cite le débit, l'encaissement reste justifié par son crédit.
    expect(justifieSonMouvement(e, [e, { ...sansMouvement, ligne_bancaire_id: 'm_debit' }])).toBe(true)
    // Une contre-passation justifie toujours le débit qu'elle cite.
    expect(justifieSonMouvement({ id: 'c1' }, [e, { ...sansMouvement, ligne_bancaire_id: 'm_debit' }])).toBe(true)
  })
})

describe('refusEnregistrementVente — enregistrer_encaissement, la facture source', () => {
  const refusV = (c: ContexteFacture, s: SaisieEncaissement, mouvements = [mouvement()], v = vente()) =>
    refusEnregistrementVente(c, s, mouvements, AUJOURD_HUI, true, v)

  it('une facture qui n’est pas source : la même chose qu’hier, frontière, classement et avoirs ignorés', () => {
    const c = contexte({ facture: facture({ source_de_la_vente: false }) })
    const v = vente({ anneesValidees: [2027] })
    const classe = [mouvement({ statut: 'rapprochee', piece_id: 'p1' })]
    for (const s of [saisie(), saisie({ ligneBancaireId: 'm1' }), saisie({ montant: 1300, repartition: [{ taux: 20, montant: 1200 }, { taux: 5.5, montant: 100 }] })]) {
      expect(refusV(c, s, classe, v)).toEqual(refusEnregistrement(c, s, classe, AUJOURD_HUI, true))
    }
    expect(refusV(c, saisie({ ligneBancaireId: 'm1' }), classe, v)).toBeNull()
  })

  it('rang 11 : une date que la frontière d’un exercice validé fige, sous les deux phrases de la base', () => {
    const c = contexte()
    expect(refusV(c, saisie({ date: '2026-12-31' }), [mouvement()], vente({ anneesValidees: [2026] }))).toEqual({
      cle: 'frontiere', message: "L'exercice 2026 est validé : un encaissement de cette facture ne s'y date plus.",
    })
    expect(refusV(c, saisie({ date: '2025-06-30' }), [mouvement()], vente({ anneesValidees: [2026] }))?.message)
      .toBe("L'exercice 2025 est figé par la validation de l'exercice 2026 : un encaissement de cette facture ne s'y date plus.")
    expect(refusV(c, saisie({ date: '2027-01-01' }), [mouvement()], vente({ anneesValidees: [2026] }))).toBeNull()
    // Après les dates d'hier : une date future se dit avant la frontière.
    expect(refusV(c, saisie({ date: '2027-11-03' }), [mouvement()], vente({ anneesValidees: [2027] }))?.cle).toBe('date_future')
  })

  it('rang 17 : un mouvement déjà classé — chaque classement —, après le débit et avant le mouvement déjà pris', () => {
    const c = contexte()
    for (const [quoi, o] of CLASSEMENTS) {
      expect(refusV(c, saisie({ ligneBancaireId: 'm1' }), [mouvement(o)])?.cle, quoi).toBe('mouvement_classe')
    }
    expect(refusV(c, saisie({ ligneBancaireId: 'm1' }), [mouvement({ montant: -10, statut: 'rapprochee', piece_id: 'p' })])?.cle)
      .toBe('mouvement_debit')
    const pris = contexte({ encaissements: [encaissement({ ligne_bancaire_id: 'm1' })] })
    expect(refusV(pris, saisie({ ligneBancaireId: 'm1' }), [mouvement({ statut: 'rapprochee', piece_id: 'p' })])?.cle).toBe('mouvement_classe')
    expect(refusV(pris, saisie({ ligneBancaireId: 'm1' }))?.cle).toBe('mouvement_deja_pris')
  })

  it('le mouvement juge ce qu’il justifie comme la base : un encaissement contre-passé avec un débit le prend encore', () => {
    const autre = encaissement({ id: 'e9', facture_id: 'f3', montant: 1300, ligne_bancaire_id: 'm1' })
    const annulation = encaissement({ id: 'c9', facture_id: 'f3', montant: -1300, annule_id: 'e9' })
    const s = saisie({ ligneBancaireId: 'm1', montant: 100 })
    // Contre-passé sans mouvement : il n'a pas eu lieu sur m1, qui ne justifie que ce qu'on y met.
    expect(refusV(contexte({ encaissements: [autre, annulation] }), s)).toBeNull()
    // Contre-passé par un débit : l'argent est venu sur m1 — 1 300 + 100 dépassent 1 355,50 au-delà des frais.
    expect(refusV(contexte({ encaissements: [autre, { ...annulation, ligne_bancaire_id: 'm_debit' }] }), s)).toEqual({
      cle: 'mouvement_depasse',
      message: "Ce mouvement de 1355,50 € justifierait 1400,00 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
    })
  })

  it('rangs 27 et 29 : les plafonds nets des avoirs VALIDÉS de la facture, à la place des plafonds bruts', () => {
    const c = contexte()
    // 1 355,50 € moins l'avoir de 120 € : 1 235,50 € ; le brouillon et l'avoir d'une autre facture ne comptent pas.
    expect(refusV(c, saisie({ montant: 1235.51, repartition: [{ taux: 20, montant: 1080 }, { taux: 5.5, montant: 105.51 }, { taux: 0, montant: 50 }] })))
      .toEqual({ cle: 'plafond_facture_net', message: "L'encaissement dépasserait le total de la facture, net de ses avoirs : il reste 1235,50 € à encaisser." })
    // À 20 % : 1 200 € moins 120 € — 1 080 €.
    expect(refusV(c, saisie({ montant: 1080.01, repartition: [{ taux: 20, montant: 1080.01 }] }))).toEqual({
      cle: 'plafond_taux_net',
      message: "À 20 %, l'encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste 1080,00 € à encaisser à ce taux.",
    })
    expect(refusV(c, saisie({ montant: 1080, repartition: [{ taux: 20, montant: 1080 }] }))).toBeNull()
    expect(refusV(c, saisie({ montant: 1235.5, repartition: [{ taux: 20, montant: 1080 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }] })))
      .toBeNull()
    // Ce qui est déjà encaissé se déduit aussi, net des retraits.
    const deja = contexte({
      encaissements: [encaissement({ montant: 1000 }), encaissement({ id: 'e2', montant: 30, retire_le: '2027-10-20T10:00:00Z' })],
      parts: [{ encaissement_id: 'e1', taux: 20, montant: 1000 }, { encaissement_id: 'e2', taux: 20, montant: 30 }],
    })
    expect(refusV(deja, saisie({ montant: 80.01, repartition: [{ taux: 20, montant: 80.01 }] }))?.message)
      .toBe("À 20 %, l'encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste 80,00 € à encaisser à ce taux.")
    expect(refusV(deja, saisie({ montant: 235.51, repartition: [{ taux: 5.5, montant: 185.51 }, { taux: 0, montant: 50 }] }))?.message)
      .toBe("L'encaissement dépasserait le total de la facture, net de ses avoirs : il reste 235,50 € à encaisser.")
    // Les lignes d'un avoir manquent à la lecture : rien ne se déduit — l'écran doit les lire (ContexteVente).
    expect(refusV(contexte({ lignes: LIGNES }), saisie({ montant: 1080.01, repartition: [{ taux: 20, montant: 1080.01 }] }))).toBeNull()
  })

  it('dans l’ordre de la base : chaque refus passe avant le suivant, encore en faute — ceux d’une facture source compris', () => {
    const lignes: LigneDeFacture[] = [...LIGNES, ...LIGNES_AVOIRS, { facture_id: 'f1', ordre: 4, designation: 'd', quantite: 1, prix_unitaire_ht: 10, taux_tva: 19 }]
    const juste = facture({ montant_ht: 1160, montant_tva: 207.4, montant_ttc: 1367.4 })
    const deja = encaissement({ id: 'e9', ligne_bancaire_id: 'm_mille', montant: 1 })
    const mouvements = [mouvement({ id: 'm_mille', montant: 1000, statut: 'rapprochee', piece_id: 'p' }), mouvement({ id: 'm_debit', montant: -50 })]
    let c = contexte({
      facture: { ...juste, dossier_id: 'd2', statut: 'brouillon', type: 'avoir', montant_tva: 208 },
      lignes,
      transmissions: [{ facture_id: 'f1', canal: 'plateforme', etat: 'rejete', hote: 'h', flux_id: 'x' }],
    })
    let s = saisie({ date: null, montant: null, moyen: null, ligneBancaireId: 'inconnu', repartition: [] })
    let v = vente({ anneesValidees: [2027] })
    let m = mouvements
    let banque = false
    const etapes: [string, () => void][] = [
      ['mouvement_sans_banque', () => { banque = true }],
      ['facture_introuvable', () => { c = { ...c, facture: { ...c.facture, dossier_id: D } } }],
      ['brouillon', () => { c = { ...c, facture: { ...c.facture, statut: 'validee' } } }],
      ['avoir', () => { c = { ...c, facture: { ...c.facture, type: 'facture' } } }],
      ['rejetee', () => { c = { ...c, transmissions: [] } }],
      ['lignes_incoherentes', () => { c = { ...c, facture: juste } }],
      ['date_absente', () => { s = { ...s, date: '1999-12-31' } }],
      ['date_avant_2000', () => { s = { ...s, date: '2027-11-03' } }],
      ['date_future', () => { s = { ...s, date: '2027-10-15' } }],
      ['frontiere', () => { v = vente({ anneesValidees: [2026] }) }],
      ['montant_positif', () => { s = { ...s, montant: 10.001 } }],
      ['montant_centime', () => { s = { ...s, montant: 1247.41 } }],
      ['moyen_inconnu', () => { s = { ...s, moyen: 'cheque' } }],
      ['mouvement_hors_dossier', () => { s = { ...s, ligneBancaireId: 'm_debit' } }],
      ['mouvement_debit', () => { s = { ...s, ligneBancaireId: 'm_mille' }; c = { ...c, encaissements: [deja] } }],
      ['mouvement_classe', () => { m = [mouvement({ id: 'm_mille', montant: 1000 }), mouvements[1]] }],
      ['mouvement_deja_pris', () => { c = { ...c, encaissements: [{ ...deja, facture_id: 'f2' }] } }],
      ['mouvement_depasse', () => { s = { ...s, ligneBancaireId: null }; c = { ...c, encaissements: [] } }],
      ['repartition_illisible', () => { s = { ...s, repartition: [{ taux: 10, montant: 1 }, { taux: 19, montant: 0 }, { taux: 10, montant: 1 }] } }],
      ['taux_repete', () => { s = { ...s, repartition: [{ taux: 10, montant: 1 }, { taux: 19, montant: 0 }] } }],
      ['taux_hors_facture', () => { s = { ...s, repartition: [{ taux: 19, montant: 0 }, { taux: 20, montant: 1 }] } }],
      ['taux_non_admis', () => { s = { ...s, repartition: [{ taux: 20, montant: 0 }] } }],
      ['part_invalide', () => { s = { ...s, repartition: [{ taux: 20, montant: 1 }] } }],
      ['repartition_somme', () => { s = { ...s, repartition: [{ taux: 20, montant: 1247.41 }] } }],
      // Le plafond net : 1 367,40 − 120 = 1 247,40 €.
      ['plafond_facture_net', () => { s = { ...s, montant: 1080.01, repartition: [{ taux: 20, montant: 1080.01 }] } }],
      ['plafond_taux_net', () => { s = { ...s, montant: 1080, repartition: [{ taux: 20, montant: 1080 }] } }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusEnregistrementVente(c, s, m, AUJOURD_HUI, banque, v)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusEnregistrementVente(c, s, m, AUJOURD_HUI, banque, v)).toBeNull()
    // Toutes les clés, dans l'ordre du catalogue, sauf l'accès (la base seule) et les plafonds bruts (jamais pour une source).
    expect(vus).toEqual(REFUS_ENREGISTREMENT.map((r) => r.cle).filter((cle) => !['acces', 'plafond_facture', 'plafond_taux'].includes(cle)))
  })
})

describe('refusRetraitVente — retirer_encaissement, la facture source', () => {
  const vide = new Set<string>()

  it('une facture qui n’est pas source : la même chose qu’hier', () => {
    const e = encaissement({ facture_id: 'f2', ligne_bancaire_id: 'm1', date_encaissement: '2026-06-01' })
    const v = vente({ anneesValidees: [2026] })
    const m = [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })]
    expect(refusRetraitVente(D, 'e1', [e], vide, m, v)).toEqual(refusRetrait(D, 'e1', [e], vide))
    expect(refusRetraitVente(D, 'e1', [e], vide, m, v)).toBeNull()
  })

  it('rang 6 : daté d’un exercice que la frontière fige ; rang 7 : le mouvement dont il dépend, classé', () => {
    const e = encaissement({ ligne_bancaire_id: 'm1', date_encaissement: '2026-06-01' })
    expect(refusRetraitVente(D, 'e1', [e], vide, [mouvement()], vente({ anneesValidees: [2026] }))).toEqual({
      cle: 'frontiere', message: "L'exercice 2026 est validé : cet encaissement ne se retire plus.",
    })
    for (const [quoi, o] of CLASSEMENTS) {
      expect(refusRetraitVente(D, 'e1', [e], vide, [mouvement(o)], vente())?.cle, quoi).toBe('mouvement_classe')
    }
    expect(refusRetraitVente(D, 'e1', [e], vide, [mouvement()], vente())).toBeNull()
    // Sans mouvement : rien à juger.
    expect(refusRetraitVente(D, 'e1', [{ ...e, ligne_bancaire_id: null }], vide, [mouvement({ statut: 'rapprochee', piece_id: 'p' })], vente())).toBeNull()
  })

  it('une contre-passation sans mouvement dépend du mouvement de l’encaissement qu’elle annule', () => {
    const e = encaissement({ ligne_bancaire_id: 'm1' })
    const c = encaissement({ id: 'c1', montant: -100, annule_id: 'e1' })
    const classe = [mouvement({ statut: 'rapprochee', categorie_id: 'k1' })]
    expect(refusRetraitVente(D, 'c1', [e, c], vide, classe, vente())).toEqual({
      cle: 'mouvement_classe', message: "Le mouvement dont dépend cet encaissement est classé : le cabinet retire d'abord ce classement.",
    })
    expect(refusRetraitVente(D, 'c1', [e, c], vide, [mouvement()], vente())).toBeNull()
    // Une contre-passation qui cite son débit dépend de lui.
    const avecDebit = { ...c, ligne_bancaire_id: 'm_debit' }
    expect(refusRetraitVente(D, 'c1', [e, avecDebit], vide, [...classe, mouvement({ id: 'm_debit', montant: -100 })], vente())).toBeNull()
  })

  it('dans l’ordre de la base : les refus d’hier d’abord, la frontière, puis le mouvement', () => {
    const e = encaissement({ ligne_bancaire_id: 'm1', date_encaissement: '2026-06-01' })
    const c = encaissement({ id: 'c1', montant: -100, annule_id: 'e1' })
    const classe = [mouvement({ statut: 'rapprochee', piece_id: 'p' })]
    const v = vente({ anneesValidees: [2026] })
    expect(refusRetraitVente(D, 'e1', [e, c], vide, classe, v)?.cle).toBe('annule')
    expect(refusRetraitVente(D, 'e1', [e], vide, classe, v)?.cle).toBe('frontiere')
    expect(refusRetraitVente(D, 'e1', [e], vide, classe, vente())?.cle).toBe('mouvement_classe')
    expect(REFUS_RETRAIT.slice(-2).map((r) => r.cle)).toEqual(['frontiere', 'mouvement_classe'])
  })
})

describe('refusContrePassationVente — annuler_encaissement et son cinquième paramètre, le débit', () => {
  const DECLARE = [{ encaissement_id: 'e1', etat: 'depose' as const }]
  const e1 = encaissement({ ligne_bancaire_id: 'm1', date_encaissement: '2027-10-15' })
  const DEBIT = mouvement({ id: 'm_debit', montant: -100, date: '2027-10-25' })
  // Le droit « Banque » de qui saisit : le cabinet le porte ; `banque: false`, le client qui n'a que « Ventes ».
  const refusCV = (o: { encaissements?: EncaissementPourContrePassation[]; date?: string | null; motif?: string | null; ligne?: string | null;
    mouvements?: MouvementClasse[]; v?: ContexteVente; banque?: boolean; id?: string } = {}) =>
    refusContrePassationVente(D, o.id ?? 'e1', o.encaissements ?? [e1], DECLARE, o.date === undefined ? '2027-10-25' : o.date,
      o.motif === undefined ? 'Chèque revenu impayé' : o.motif, AUJOURD_HUI, o.ligne === undefined ? null : o.ligne,
      o.mouvements ?? [mouvement(), DEBIT], o.banque ?? true, o.v ?? vente())

  it('sans débit cité, une facture qui n’est pas source : la même chose qu’hier, avec ou sans « Banque »', () => {
    const e = { ...e1, facture_id: 'f2' }
    for (const [date, motif] of [['2027-10-25', 'm'], [null, 'm'], ['2027-10-25', ''], ['2027-10-25', 'm'.repeat(2001)]] as const) {
      for (const banque of [true, false]) {
        expect(refusCV({ encaissements: [e], date, motif, v: vente({ anneesValidees: [2027] }), banque }))
          .toEqual(refusContrePassation(D, 'e1', [e], DECLARE, date, motif, AUJOURD_HUI))
      }
    }
  })

  // LA MIGRATION contre_passation_banque (chantier EC-Q3, ligne 28.65) : le débit cité est une donnée de la banque. Sans le
  // droit « Banque », il se refuse au rang 2, avant toute lecture — rien ne se dit de l'encaissement ni du mouvement, ni
  // de son montant —, sous les mots du rang 2 d'enregistrer_encaissement.
  it('rang 2 : sans « Banque », un débit cité se refuse avant tout autre refus ; avec lui, ce rang passe', () => {
    const NEUF = {
      cle: 'mouvement_sans_banque',
      message: "Le mouvement bancaire d'un encaissement ne se désigne qu'avec le droit « Banque » sur ce dossier : sans lui, l'encaissement s'enregistre sans mouvement.",
    }
    expect(refusCV({ ligne: 'm_debit', banque: false })).toEqual(NEUF)
    // Ce qu'il aurait appris sinon, chaque fois : un encaissement inconnu, un mouvement d'un autre dossier, un crédit, un
    // débit déjà classé, et le MONTANT d'un débit trop petit.
    const ailleurs: [string, Parameters<typeof refusCV>[0]][] = [
      ['encaissement_introuvable', { ligne: 'm_debit', id: 'inconnu' }],
      ['mouvement_non_source', { ligne: 'm_debit', encaissements: [{ ...e1, facture_id: 'f2' }] }],
      ['motif_absent', { ligne: 'm_debit', motif: ' ' }],
      ['mouvement_hors_dossier', { ligne: 'inconnu' }],
      ['mouvement_credit', { ligne: 'm1' }],
      ['mouvement_classe', { ligne: 'm_debit', mouvements: [mouvement({ ...DEBIT, statut: 'rapprochee', piece_id: 'p' })] }],
      ['mouvement_depasse', { ligne: 'm_debit', mouvements: [{ ...DEBIT, montant: -97.99 }] }],
    ]
    for (const [cle, o] of ailleurs) {
      expect(refusCV(o)?.cle, cle).toBe(cle)
      expect(refusCV({ ...o, banque: false }), cle).toEqual(NEUF)
    }
    // Avec « Banque », le débit libre que la contre-passation fait : accepté ; sans débit, « Banque » ne change rien.
    expect(refusCV({ ligne: 'm_debit' })).toBeNull()
    expect(refusCV({ banque: false })).toBeNull()
    expect(refusCV({ banque: false, motif: '' })?.cle).toBe('motif_absent')
  })

  it('rang 12 : la frontière, après les dates et avant le motif', () => {
    expect(refusCV({ date: '2026-12-31', v: vente({ anneesValidees: [2026] }) })?.cle).toBe('date_avant_encaissement')
    expect(refusCV({ encaissements: [{ ...e1, date_encaissement: '2026-06-01' }], date: '2026-12-31', motif: '', v: vente({ anneesValidees: [2026] }) }))
      .toEqual({ cle: 'frontiere', message: "L'exercice 2026 est validé : une contre-passation ne s'y date plus." })
    expect(refusCV({ encaissements: [{ ...e1, date_encaissement: '2026-06-01' }], date: '2027-01-02', motif: '', v: vente({ anneesValidees: [2026] }) })?.cle)
      .toBe('motif_absent')
  })

  it('rangs 15 à 19 : le débit cité — une facture source, de ce dossier, un débit, libre, que ses contre-passations ne dépassent pas', () => {
    expect(refusCV({ encaissements: [{ ...e1, facture_id: 'f2' }], ligne: 'm_debit' })?.cle).toBe('mouvement_non_source')
    // Le motif d'abord : le débit se juge après lui.
    expect(refusCV({ encaissements: [{ ...e1, facture_id: 'f2' }], ligne: 'm_debit', motif: ' ' })?.cle).toBe('motif_absent')
    expect(refusCV({ ligne: 'inconnu' })?.cle).toBe('mouvement_hors_dossier')
    expect(refusCV({ ligne: 'm_debit', mouvements: [{ ...DEBIT, dossier_id: 'd2' }] })?.cle).toBe('mouvement_hors_dossier')
    expect(refusCV({ ligne: 'm1' })?.cle).toBe('mouvement_credit')
    expect(refusCV({ ligne: 'm_debit', mouvements: [{ ...DEBIT, montant: 0 }] })?.cle).toBe('mouvement_credit')
    for (const [quoi, o] of CLASSEMENTS) {
      expect(refusCV({ ligne: 'm_debit', mouvements: [mouvement({ ...DEBIT, ...o })] })?.cle, quoi).toBe('mouvement_classe')
    }
    expect(refusCV({ ligne: 'm_debit' })).toBeNull()
    // La banque débite un peu plus que la contre-passation (des frais) : accepté ; un peu moins, ou trop de plus : refusé.
    expect(refusCV({ ligne: 'm_debit', mouvements: [{ ...DEBIT, montant: -102 }] })).toBeNull()
    expect(refusCV({ ligne: 'm_debit', mouvements: [{ ...DEBIT, montant: -97.99 }] })).toEqual({
      cle: 'mouvement_depasse',
      message: "Ce mouvement de 97,99 € justifierait 100,00 € de contre-passations : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    // Les contre-passations qui citent déjà ce débit comptent, une retirée non.
    const autre = encaissement({ id: 'c8', facture_id: 'f3', montant: -50, annule_id: 'e8', ligne_bancaire_id: 'm_debit' })
    expect(refusCV({ ligne: 'm_debit', encaissements: [e1, autre], mouvements: [{ ...DEBIT, montant: -150 }] })).toBeNull()
    expect(refusCV({ ligne: 'm_debit', encaissements: [e1, autre] })?.message)
      .toBe("Ce mouvement de 100,00 € justifierait 150,00 € de contre-passations : l'écart dépasse ce que des frais bancaires expliquent.")
    expect(refusCV({ ligne: 'm_debit', encaissements: [e1, { ...autre, retire_le: '2027-10-26T10:00:00Z' }] })).toBeNull()
  })

  it('rang 20 : sans débit cité, le mouvement de l’encaissement classé par ses encaissements', () => {
    const classe = [mouvement({ statut: 'rapprochee', encaissements_de_factures: true }), DEBIT]
    expect(refusCV({ mouvements: classe })).toEqual({
      cle: 'mouvement_encaissement_classe',
      message: "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l'encaissement, ou le cabinet retire d'abord ce classement.",
    })
    // Classé autrement — un état que G2 empêche — : ce refus-là ne le dit pas.
    expect(refusCV({ mouvements: [mouvement({ statut: 'rapprochee', piece_id: 'p' }), DEBIT] })).toBeNull()
    // Le débit cité : le rang 20 ne se juge pas.
    expect(refusCV({ mouvements: classe, ligne: 'm_debit' })).toBeNull()
    // Une facture qui n'est pas source, ou un encaissement sans mouvement : rien.
    expect(refusCV({ mouvements: classe, encaissements: [{ ...e1, facture_id: 'f2' }] })).toBeNull()
    expect(refusCV({ mouvements: classe, encaissements: [{ ...e1, ligne_bancaire_id: null }] })).toBeNull()
  })

  // CE QUE LA BASE ADMET, ET QUE LE CLASSEMENT REFUSERA ENSUITE (relevé le 19/10/2026, à trancher) : comme pour un crédit,
  // `annuler_encaissement` tolère des contre-passations qui DÉPASSENT le débit de ce que des frais expliqueraient — la banque
  // aurait débité un peu MOINS —, et n'importe quel débit plus grand ; `classer_mouvement_par_encaissements` n'admet que
  // l'inverse (la banque débite un peu plus : les frais d'un impayé) et refuse alors « elles le dépassent ». Le module dit
  // ce que dit la base, des deux côtés.
  it('un débit un peu plus petit que sa contre-passation : cité sans refus, puis jamais classé', () => {
    expect(refusCV({ ligne: 'm_debit', mouvements: [{ ...DEBIT, montant: -99 }] })).toBeNull()
    const cite = encaissement({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: 'm_debit' })
    expect(refusClassement(D, 'm_debit', [{ ...DEBIT, montant: -99 }], [e1, cite], vente())?.cle).toBe('debit_depasse')
  })

  it('les refus neufs, dans l’ordre du catalogue', () => {
    expect(REFUS_CONTRE_PASSATION.map((r) => r.cle).slice(0, 3)).toEqual(['acces', 'mouvement_sans_banque', 'encaissement_introuvable'])
    expect(REFUS_CONTRE_PASSATION.map((r) => r.cle).slice(11)).toEqual([
      'frontiere', 'motif_absent', 'motif_trop_long', 'mouvement_non_source', 'mouvement_hors_dossier', 'mouvement_credit',
      'mouvement_classe', 'mouvement_depasse', 'mouvement_encaissement_classe',
    ])
  })
})

// L'IMPAYÉ D'UN ENCAISSEMENT JAMAIS DÉCLARÉ (étape VF5d2, migration impaye_non_declare) : le rang 6 ne s'oppose plus à
// l'encaissement d'une facture SOURCE dont la contre-passation cite un débit — et à lui seul.
describe('l’impayé d’un encaissement jamais déclaré — le rang 6 levé pour une facture source et un débit cité', () => {
  const AUCUNE: { encaissement_id: string; etat: 'depose' | 'echec' | 'rejete' | 'envoi' }[] = []
  const e1 = encaissement({ ligne_bancaire_id: 'm1', date_encaissement: '2027-10-15' })
  const DEBIT = mouvement({ id: 'm_debit', montant: -100, date: '2027-10-25' })
  const refusCV = (o: { encaissements?: EncaissementPourContrePassation[]; declarations?: typeof AUCUNE; date?: string | null;
    motif?: string | null; ligne?: string | null; mouvements?: MouvementClasse[]; v?: ContexteVente; banque?: boolean; id?: string } = {}) =>
    refusContrePassationVente(D, o.id ?? 'e1', o.encaissements ?? [e1], o.declarations ?? AUCUNE, o.date === undefined ? '2027-10-25' : o.date,
      o.motif === undefined ? 'Chèque revenu impayé' : o.motif, AUJOURD_HUI, o.ligne === undefined ? 'm_debit' : o.ligne,
      o.mouvements ?? [mouvement(), DEBIT], o.banque ?? true, o.v ?? vente())
  const NON_DECLARE = { cle: 'non_declare', message: "Cet encaissement n'est pas déclaré : il se retire, sans contre-passation." }

  it('jamais déclaré, d’une facture source, avec le débit qui l’a défait : la contre-passation passe', () => {
    expect(refusCV()).toBeNull()
    // Une déclaration échouée ou rejetée ne déclare pas : de même.
    expect(refusCV({ declarations: [{ encaissement_id: 'e1', etat: 'echec' }] })).toBeNull()
    expect(refusCV({ declarations: [{ encaissement_id: 'e1', etat: 'rejete' }] })).toBeNull()
    // Déclaré, comme hier : avec ou sans débit.
    expect(refusCV({ declarations: [{ encaissement_id: 'e1', etat: 'depose' }] })).toBeNull()
  })

  it('sans débit, ou pour une facture qui n’est pas source : le refus d’hier, sous ses mots', () => {
    expect(refusCV({ ligne: null })).toEqual(NON_DECLARE)
    expect(refusCV({ ligne: null, mouvements: [mouvement({ statut: 'rapprochee', encaissements_de_factures: true }), DEBIT] })).toEqual(NON_DECLARE)
    const f2 = { ...e1, facture_id: 'f2' }
    expect(refusCV({ encaissements: [f2] })).toEqual(NON_DECLARE)
    expect(refusCV({ encaissements: [f2], ligne: null })).toEqual(NON_DECLARE)
    // Hors de la vente : la facture que la lecture n'a pas rendue n'est pas source — le refus d'hier, du côté fermé.
    expect(refusCV({ v: vente({ factures: FACTURES.filter((f) => f.id !== 'f1') }) })).toEqual(NON_DECLARE)
    // Et la fonction d'hier, à quatre paramètres, n'en sait rien : jamais déclaré, il se retire.
    expect(refusContrePassation(D, 'e1', [e1], AUCUNE, '2027-10-25', 'm', AUJOURD_HUI)).toEqual(NON_DECLARE)
  })

  it('le rang 2 d’abord : sans « Banque », le débit cité se refuse, avant le rang 6 comme hier', () => {
    expect(refusCV({ banque: false })?.cle).toBe('mouvement_sans_banque')
    expect(refusCV({ banque: false, encaissements: [{ ...e1, facture_id: 'f2' }] })?.cle).toBe('mouvement_sans_banque')
    expect(refusCV({ banque: false, ligne: null })).toEqual(NON_DECLARE)
  })

  it('dans l’ordre de la base : chaque refus encore en faute derrière celui qu’on corrige, le rang 6 sauté', () => {
    const cp = encaissement({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: 'm_autre' })
    let o: Parameters<typeof refusCV>[0] = {
      id: 'c1', encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }, cp], date: null, motif: ' ',
      ligne: 'inconnu', v: vente({ anneesValidees: [2027] }),
    }
    const etapes: [string, () => void][] = [
      ['contre_passation', () => { o = { ...o, id: 'e1' } }],
      ['retire', () => { o = { ...o, encaissements: [e1, cp] } }],
      ['deja_contre_passe', () => { o = { ...o, encaissements: [e1] } }],
      ['date_absente', () => { o = { ...o, date: '2027-10-14' } }],
      ['date_avant_encaissement', () => { o = { ...o, date: '2027-11-03' } }],
      ['date_future', () => { o = { ...o, date: '2027-10-25' } }],
      ['frontiere', () => { o = { ...o, v: vente() } }],
      ['motif_absent', () => { o = { ...o, motif: 'Chèque revenu impayé' } }],
      ['mouvement_hors_dossier', () => { o = { ...o, ligne: 'm1' } }],
      ['mouvement_credit', () => { o = { ...o, ligne: 'm_debit', mouvements: [mouvement(), { ...DEBIT, statut: 'rapprochee', piece_id: 'p' }] } }],
      ['mouvement_classe', () => { o = { ...o, mouvements: [mouvement(), { ...DEBIT, montant: -97.99 }] } }],
      ['mouvement_depasse', () => { o = { ...o, mouvements: [mouvement(), DEBIT] } }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusCV(o)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusCV(o)).toBeNull()
  })

  it('debitObligatoire : jamais déclaré, vivant, pas une contre-passation, d’une facture source', () => {
    const v = vente()
    expect(debitObligatoire(D, 'e1', [e1], AUCUNE, v)).toBe(true)
    expect(debitObligatoire(D, 'e1', [e1], [{ encaissement_id: 'e1', etat: 'echec' }], v)).toBe(true)
    expect(debitObligatoire(D, 'e1', [e1], [{ encaissement_id: 'e1', etat: 'depose' }], v)).toBe(false)
    expect(debitObligatoire(D, 'e1', [e1], [{ encaissement_id: 'e1', etat: 'envoi' }], v)).toBe(false)
    expect(debitObligatoire(D, 'e1', [{ ...e1, facture_id: 'f2' }], AUCUNE, v)).toBe(false)
    expect(debitObligatoire(D, 'e1', [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }], AUCUNE, v)).toBe(false)
    expect(debitObligatoire(D, 'c1', [e1, encaissement({ id: 'c1', montant: -100, annule_id: 'e1' })], AUCUNE, v)).toBe(false)
    expect(debitObligatoire('d2', 'e1', [e1], AUCUNE, v)).toBe(false)
    expect(debitObligatoire(D, 'e1', [e1], AUCUNE, vente({ factures: [] }))).toBe(false)
  })

  it('refusContrePassationAvantLaDate : ce qui décide l’offre — déclaré sans débit, jamais déclaré avec le débit à choisir', () => {
    const avant = (o: { declarations?: typeof AUCUNE; banque?: boolean; encaissements?: EncaissementPourContrePassation[] } = {}) =>
      refusContrePassationAvantLaDate(D, 'e1', o.encaissements ?? [e1], o.declarations ?? AUCUNE, AUJOURD_HUI, [mouvement(), DEBIT],
        o.banque ?? true, vente())
    // Jamais déclaré, d'une facture source : rien d'autre que la date ne s'y oppose ; sans « Banque », le débit ne se cite pas.
    expect(avant()?.cle).toBe('date_absente')
    expect(avant({ banque: false })?.cle).toBe('mouvement_sans_banque')
    // Déclaré : comme hier, sans débit — « Banque » n'y change rien.
    expect(avant({ declarations: [{ encaissement_id: 'e1', etat: 'depose' }] })?.cle).toBe('date_absente')
    expect(avant({ declarations: [{ encaissement_id: 'e1', etat: 'depose' }], banque: false })?.cle).toBe('date_absente')
    expect(avant({ declarations: [{ encaissement_id: 'e1', etat: 'envoi' }] })?.cle).toBe('issue_inconnue')
    // Jamais déclaré, d'une facture qui n'est pas source : il se retire.
    expect(avant({ encaissements: [{ ...e1, facture_id: 'f2' }] })).toEqual(NON_DECLARE)
    // Déjà contre-passé : l'offre se retient.
    expect(avant({ encaissements: [e1, encaissement({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: 'm_debit' })] })?.cle)
      .toBe('deja_contre_passe')
  })
})

describe('paireNonDeclaree — la paire d’un encaissement jamais déclaré et de sa contre-passation ne se déclare pas', () => {
  const e = encaissement({ id: 'e1' })
  const c = encaissement({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: 'm_debit' })
  const declares = (...ids: string[]) => new Set(ids)

  it('ni l’encaissement ni sa contre-passation, quand aucun des deux n’est déclaré', () => {
    expect(paireNonDeclaree(e, [e, c], declares())).toBe(true)
    expect(paireNonDeclaree(c, [e, c], declares())).toBe(true)
  })

  it('l’encaissement déclaré défait la paire : sa contre-passation se déclare, comme hier', () => {
    expect(paireNonDeclaree(e, [e, c], declares('e1'))).toBe(false)
    expect(paireNonDeclaree(c, [e, c], declares('e1'))).toBe(false)
  })

  it('la contre-passation déclarée la défait aussi : l’encaissement est à déclarer, pour que la plateforme ait les deux', () => {
    expect(paireNonDeclaree(e, [e, c], declares('c1'))).toBe(false)
    expect(paireNonDeclaree(c, [e, c], declares('c1'))).toBe(false)
  })

  it('sans contre-passation vivante, pas de paire ; un retiré n’en est d’aucune', () => {
    expect(paireNonDeclaree(e, [e], declares())).toBe(false)
    expect(paireNonDeclaree(e, [e, { ...c, retire_le: '2027-10-26T10:00:00Z' }], declares())).toBe(false)
    expect(paireNonDeclaree({ ...c, retire_le: '2027-10-26T10:00:00Z' }, [e, c], declares())).toBe(false)
    expect(paireNonDeclaree({ ...e, retire_le: '2027-10-26T10:00:00Z' }, [e, c], declares())).toBe(false)
  })
})

describe('refusRattachement — rattacher_mouvement_encaissement, une fois, de nul à un mouvement', () => {
  it('un encaissement, rang par rang, chaque refus encore en faute derrière celui qu’on corrige', () => {
    let encaissements: EncaissementPourContrePassation[] = [encaissement({ dossier_id: 'd2', retire_le: '2027-10-20T10:00:00Z', ligne_bancaire_id: 'm9', facture_id: 'f2', date_encaissement: '2026-06-01' })]
    let ligne: string | null = null
    let mouvements = [mouvement({ id: 'm1', montant: -10, statut: 'rapprochee', piece_id: 'p' }), mouvement({ id: 'm2', montant: 98, statut: 'rapprochee', piece_id: 'p' })]
    let v = vente({ anneesValidees: [2026] })
    const pris = encaissement({ id: 'e2', montant: 98, ligne_bancaire_id: 'm2' })
    const etapes: [string, () => void][] = [
      ['encaissement_introuvable', () => { encaissements = [{ ...encaissements[0], dossier_id: D }] }],
      ['retire', () => { encaissements = [{ ...encaissements[0], retire_le: null }] }],
      ['deja_rattache', () => { encaissements = [{ ...encaissements[0], ligne_bancaire_id: null }] }],
      ['facture_non_source', () => { encaissements = [{ ...encaissements[0], facture_id: 'f1' }] }],
      ['frontiere', () => { v = vente() }],
      ['mouvement_absent', () => { ligne = 'inconnu' }],
      ['mouvement_hors_dossier', () => { ligne = 'm1' }],
      ['mouvement_debit', () => { ligne = 'm2' }],
      ['mouvement_classe', () => { mouvements = [mouvements[0], { ...mouvements[1], statut: 'non_rapprochee', piece_id: null }]; encaissements = [...encaissements, pris] }],
      ['mouvement_deja_pris', () => { encaissements = [encaissements[0], { ...pris, facture_id: 'f3' }] }],
      ['mouvement_depasse', () => { encaissements = [encaissements[0]] }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusRattachement(D, 'e1', ligne, encaissements, mouvements, v)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusRattachement(D, 'e1', ligne, encaissements, mouvements, v)).toBeNull()
    expect(vus).toEqual(REFUS_RATTACHEMENT.map((r) => r.cle).filter((cle) => !['acces', 'mouvement_credit', 'contre_passations_depassent', 'origine_classee', 'origine_depassee'].includes(cle)))
  })

  it('les mots : la frontière, le dépassement, ce que le mouvement justifierait — cet encaissement compris s’il le justifie', () => {
    const e = encaissement({ date_encaissement: '2026-06-01' })
    expect(refusRattachement(D, 'e1', 'm1', [e], [mouvement()], vente({ anneesValidees: [2026] }))?.message)
      .toBe("L'exercice 2026 est validé : cet encaissement ne se rattache plus à un mouvement.")
    const autre = encaissement({ id: 'e2', facture_id: 'f3', montant: 1300, ligne_bancaire_id: 'm1' })
    expect(refusRattachement(D, 'e1', 'm1', [encaissement(), autre], [mouvement()], vente())).toEqual({
      cle: 'mouvement_depasse',
      message: "Ce mouvement de 1355,50 € justifierait 1400,00 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    // Contre-passé sans mouvement, l'encaissement ne pèse rien : il se rattache sans rien dépasser.
    const sansMouvement = encaissement({ id: 'c1', montant: -100, annule_id: 'e1' })
    expect(refusRattachement(D, 'e1', 'm1', [encaissement(), autre, sansMouvement], [mouvement()], vente())).toBeNull()
    // Sous le seuil des frais, l'écart passe.
    expect(refusRattachement(D, 'e1', 'm1', [encaissement({ montant: 57.5 }), autre], [mouvement()], vente())).toBeNull()
  })

  it('une contre-passation : un débit, libre, que ses contre-passations ne dépassent pas ; le mouvement d’origine, libre et pas dépassé', () => {
    const origine = encaissement({ id: 'e0', montant: 100, ligne_bancaire_id: 'm1' })
    const c = encaissement({ id: 'c1', montant: -100, annule_id: 'e0' })
    const credit = mouvement({ id: 'm1', montant: 100 })
    const debit = mouvement({ id: 'm_debit', montant: -100 })
    const r = (o: { enc?: EncaissementPourContrePassation[]; m?: MouvementClasse[]; ligne?: string } = {}) =>
      refusRattachement(D, 'c1', o.ligne ?? 'm_debit', o.enc ?? [origine, c], o.m ?? [credit, debit], vente())
    expect(r()).toBeNull()
    expect(r({ ligne: 'm1' })?.cle).toBe('mouvement_credit')
    expect(r({ m: [credit, { ...debit, statut: 'rapprochee', piece_id: 'p' }] })?.cle).toBe('mouvement_classe')
    expect(r({ m: [credit, { ...debit, montant: -97 }] })).toEqual({
      cle: 'contre_passations_depassent',
      message: "Ce mouvement de 97,00 € justifierait 100,00 € de contre-passations : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    expect(r({ m: [{ ...credit, statut: 'rapprochee', encaissements_de_factures: true }, debit] })?.cle).toBe('origine_classee')
    // Rattachée, la contre-passation rend l'encaissement d'origine au crédit, qui justifie déjà un autre encaissement.
    const autre = encaissement({ id: 'e5', facture_id: 'f3', montant: 100, ligne_bancaire_id: 'm1' })
    expect(r({ enc: [origine, c, autre] })).toEqual({
      cle: 'origine_depassee',
      message: "Le mouvement de l'encaissement contre-passé, de 100,00 €, justifierait alors 200,00 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    // L'encaissement d'origine sans mouvement : rien à juger de lui.
    expect(r({ enc: [{ ...origine, ligne_bancaire_id: null }, c] })).toBeNull()
  })
})

describe('refusClassement et refusRetraitDuClassement — le cabinet classe un mouvement par ses encaissements', () => {
  const sources = (montants: number[], ligne = 'm1') => montants.map((montant, i) =>
    encaissement({ id: `e${i}`, facture_id: i % 2 === 0 ? 'f1' : 'f3', montant, ligne_bancaire_id: ligne }))

  it('rang par rang : introuvable, la frontière, déjà classé, classé autrement, rien d’une facture source', () => {
    const v = vente()
    expect(refusClassement(D, 'm9', [mouvement()], sources([1355.5]), v)?.cle).toBe('mouvement_introuvable')
    expect(refusClassement(D, 'm1', [mouvement({ dossier_id: 'd2' })], sources([1355.5]), v)?.cle).toBe('mouvement_introuvable')
    expect(refusClassement(D, 'm1', [mouvement({ date: '2026-12-31', statut: 'rapprochee', piece_id: 'p' })], [], vente({ anneesValidees: [2026] })))
      .toEqual({ cle: 'frontiere', message: "L'exercice 2026 est validé : ce mouvement ne change plus." })
    expect(refusClassement(D, 'm1', [mouvement({ statut: 'rapprochee', encaissements_de_factures: true })], [], v)?.cle)
      .toBe('deja_classe_par_ses_encaissements')
    for (const [quoi, o] of CLASSEMENTS.filter(([q]) => q !== 'classé par ses encaissements')) {
      expect(refusClassement(D, 'm1', [mouvement(o)], [], v)?.cle, quoi).toBe('deja_classe')
    }
    expect(refusClassement(D, 'm1', [mouvement()], [], v)?.cle).toBe('aucun_encaissement')
    // Ni un encaissement d'une facture qui n'est pas source, ni un retiré, ni un contre-passé sans mouvement.
    expect(refusClassement(D, 'm1', [mouvement()], [encaissement({ facture_id: 'f2', ligne_bancaire_id: 'm1', montant: 1355.5 })], v)?.cle)
      .toBe('aucun_encaissement')
    expect(refusClassement(D, 'm1', [mouvement()], [encaissement({ ligne_bancaire_id: 'm1', montant: 1355.5, retire_le: '2027-10-20T10:00:00Z' })], v)?.cle)
      .toBe('aucun_encaissement')
    expect(refusClassement(D, 'm1', [mouvement()], [...sources([1355.5]), encaissement({ id: 'c0', montant: -1355.5, annule_id: 'e0' })], v)?.cle)
      .toBe('aucun_encaissement')
    expect(refusClassement(D, 'm1', [mouvement()], sources([1355.5]), v)).toBeNull()
  })

  it('un crédit : ses encaissements le font, à l’écart des frais près — la banque crédite un peu moins, jamais plus', () => {
    const v = vente()
    expect(refusClassement(D, 'm1', [mouvement()], sources([1000, 355.5]), v)).toBeNull()
    expect(refusClassement(D, 'm1', [mouvement()], sources([1000, 355.49]), v)).toEqual({
      cle: 'credit_non_fait',
      message: 'Les encaissements que ce mouvement justifie font 1355,49 € pour un crédit de 1355,50 € : ce qui le dépasse reste à traiter.',
    })
    // 5 € de frais au plus : 1 360,50 € d'encaissements pour 1 355,50 € crédités passent, un centime de plus non.
    expect(refusClassement(D, 'm1', [mouvement()], sources([1000, 360.5]), v)).toBeNull()
    expect(refusClassement(D, 'm1', [mouvement()], sources([1000, 360.51]), v)).toEqual({
      cle: 'credit_ecart',
      message: "Les encaissements que ce mouvement justifie font 1360,51 € pour un crédit de 1355,50 € : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    // 2 % d'un petit montant — 2 % des ENCAISSEMENTS, comme la base : 102,04 € pour 100 € passent (2,04 € ≤ 2,0408 €),
    // 102,05 € non (2,05 € > 2,041 €).
    expect(refusClassement(D, 'm1', [mouvement({ montant: 100 })], sources([102.04]), v)).toBeNull()
    expect(refusClassement(D, 'm1', [mouvement({ montant: 100 })], sources([102.05]), v)?.cle).toBe('credit_ecart')
    // Un encaissement d'une facture qui n'est pas source ne compte pas dans ce que le mouvement porte.
    expect(refusClassement(D, 'm1', [mouvement()], [...sources([1000]), encaissement({ id: 'x', facture_id: 'f2', montant: 355.5, ligne_bancaire_id: 'm1' })], v)?.cle)
      .toBe('credit_non_fait')
  })

  it('un débit : ses contre-passations ne le dépassent pas, et le font à l’écart des frais près', () => {
    const v = vente()
    const contrePassations = (montants: number[]) => montants.map((montant, i) =>
      encaissement({ id: `c${i}`, montant, annule_id: `e${i}`, ligne_bancaire_id: 'm_debit' }))
    const debit = mouvement({ id: 'm_debit', montant: -100 })
    expect(refusClassement(D, 'm_debit', [debit], contrePassations([-100]), v)).toBeNull()
    expect(refusClassement(D, 'm_debit', [{ ...debit, montant: -102 }], contrePassations([-100]), v)).toBeNull()
    expect(refusClassement(D, 'm_debit', [debit], contrePassations([-60, -40.01]), v)).toEqual({
      cle: 'debit_depasse',
      message: 'Les contre-passations que ce mouvement justifie font 100,01 € pour un débit de 100,00 € : elles le dépassent.',
    })
    expect(refusClassement(D, 'm_debit', [{ ...debit, montant: -102.01 }], contrePassations([-100]), v)).toEqual({
      cle: 'debit_ecart',
      message: "Les contre-passations que ce mouvement justifie font 100,00 € pour un débit de 102,01 € : l'écart dépasse ce que des frais bancaires expliquent.",
    })
    expect(REFUS_CLASSEMENT.map((r) => r.cle).slice(6)).toEqual(['credit_non_fait', 'credit_ecart', 'debit_depasse', 'debit_ecart'])
  })

  it('retirer le classement : introuvable, la frontière, pas classé par ses encaissements', () => {
    const classe = mouvement({ statut: 'rapprochee', encaissements_de_factures: true })
    expect(refusRetraitDuClassement(D, 'm9', [classe], vente())?.cle).toBe('mouvement_introuvable')
    expect(refusRetraitDuClassement(D, 'm1', [{ ...classe, date: '2025-03-01' }], vente({ anneesValidees: [2026] })))
      .toEqual({ cle: 'frontiere', message: "L'exercice 2025 est figé par la validation de l'exercice 2026 : ce mouvement ne change plus." })
    expect(refusRetraitDuClassement(D, 'm1', [mouvement()], vente())).toEqual({
      cle: 'non_classe', message: "Ce mouvement n'est pas classé par ses encaissements.",
    })
    expect(refusRetraitDuClassement(D, 'm1', [classe], vente())).toBeNull()
  })
})

describe('refusDuClassementDuReleve — la garde des mouvements réservés (G2), pour tout autre classement', () => {
  const lu = (o: Partial<EncaissementDuReleve>): EncaissementDuReleve => ({
    id: 'e1', dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null,
    cree_le: '2027-10-15T10:00:00.5+00:00', ...o,
  })

  it('classé par ses encaissements, il ne reçoit rien d’autre', () => {
    expect(refusDuClassementDuReleve(mouvement({ statut: 'rapprochee', encaissements_de_factures: true }), [], vente())).toEqual({
      cle: 'classe_par_ses_encaissements',
      message: "Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d'abord celui-ci.",
    })
  })

  it('réservé : il justifie un encaissement non retiré d’une facture source — la base nomme la facture du premier', () => {
    expect(refusDuClassementDuReleve(mouvement(), [lu({})], vente())).toEqual({
      cle: 'reserve',
      message: "Ce mouvement justifie un encaissement de la facture F2027-0042, source de sa vente : il se classe par ses encaissements, et par rien d'autre.",
    })
    // Le premier par sa création — un instant plus tôt, sans fraction de seconde, s'écrit plus court —, puis par son identifiant.
    const plusTot = lu({ id: 'e9', facture_id: 'f3', cree_le: '2027-10-15T10:00:00+00:00' })
    expect(refusDuClassementDuReleve(mouvement(), [lu({}), plusTot], vente())?.message).toContain('la facture F2027-0044,')
    const memeInstant = lu({ id: 'e0', facture_id: 'f3' })
    expect(refusDuClassementDuReleve(mouvement(), [lu({}), memeInstant], vente())?.message).toContain('la facture F2027-0044,')
  })

  it('libre comme hier : rien d’une facture source, retiré, contre-passé sans mouvement ; contre-passé par un débit, réservé', () => {
    expect(refusDuClassementDuReleve(mouvement(), [], vente())).toBeNull()
    expect(refusDuClassementDuReleve(mouvement(), [lu({ facture_id: 'f2' })], vente())).toBeNull()
    expect(refusDuClassementDuReleve(mouvement(), [lu({ retire_le: '2027-10-20T10:00:00Z' })], vente())).toBeNull()
    expect(refusDuClassementDuReleve(mouvement(), [lu({ ligne_bancaire_id: 'm2' })], vente())).toBeNull()
    const sansMouvement = lu({ id: 'c1', montant: -100, annule_id: 'e1', ligne_bancaire_id: null })
    expect(refusDuClassementDuReleve(mouvement(), [lu({}), sansMouvement], vente())).toBeNull()
    expect(refusDuClassementDuReleve(mouvement(), [lu({}), { ...sansMouvement, ligne_bancaire_id: 'm_debit' }], vente())?.cle).toBe('reserve')
  })
})

describe('les refus d’hier ne voient pas une facture source sans le contexte de la vente', () => {
  it('refusEnregistrement juge une facture source comme une autre : refusEnregistrementVente seule dit ses refus', () => {
    const c = contexte()
    const s = saisie({ date: '2026-06-01', ligneBancaireId: 'm1' })
    expect(refusEnregistrement(c, s, [mouvement({ statut: 'rapprochee', piece_id: 'p' })], AUJOURD_HUI, true)).toBeNull()
    expect(refusEnregistrementVente(c, s, [mouvement({ statut: 'rapprochee', piece_id: 'p' })], AUJOURD_HUI, true, vente({ anneesValidees: [2026] }))?.cle)
      .toBe('frontiere')
  })

  it('une lecture d’encaissements sans source : la garde ne les voit pas', () => {
    const e: EncaissementLu = { id: 'e1', dossier_id: D, facture_id: 'f9', montant: 1, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null }
    expect(refusDuClassementDuReleve(mouvement(), [{ ...e, cree_le: '2027-10-15T10:00:00Z' }], vente())).toBeNull()
  })
})

// ── L'essai, confronté ──────────────────────────────────────────────────────────────────────────────────────────────
// supabase/essais/ventesFacturees.sql exige de la base CHAQUE refus neuf de la migration, sous ses mots et son code : ce
// que le module redit avant le clic est ce que la base répond. Et chaque refus que l'essai exige est un refus du texte
// d'une fonction de l'export (ou le nom d'une contrainte qu'il pose), sous le même code — l'essai ne demande rien que la
// base ne dise.
describe('l’essai de la vente facturée, confronté au module et au texte des fonctions', () => {
  const refus = refusExigesParLEssai()
  const exige = (modele: string, code: string) => refus.some((e) => e.code === code && correspondAuModele(modele, e.attendu))
  // Les refus d'hier se rangent sous le code de leur famille ; ceux de la vente facturée sont tous en 22023 ; celui que la
  // migration contre_passation_banque ajoute à la contre-passation — un débit cité sans « Banque » —, en 42501.
  const venteFacturee = (r: object) => 'venteFacturee' in r && r.venteFacturee === true
  const NEUFS: readonly (readonly [string, string])[] = [
    ...[...REFUS_ENREGISTREMENT, ...REFUS_RETRAIT, ...REFUS_CONTRE_PASSATION].filter(venteFacturee).map((r) => [r.modele, '22023'] as const),
    ...REFUS_CONTRE_PASSATION.filter((r) => 'contrePassationBanque' in r).map((r) => [r.modele, '42501'] as const),
    ...[...REFUS_RATTACHEMENT, ...REFUS_CLASSEMENT, ...REFUS_RETRAIT_CLASSEMENT, ...REFUS_GARDE_MOUVEMENTS].map((r) => [r.modele, r.code] as const),
  ]
  const FONCTIONS = [
    'garder_mouvement_reserve', 'garder_encaissement_facture', 'enregistrer_encaissement', 'retirer_encaissement',
    'annuler_encaissement', 'rattacher_mouvement_encaissement', 'classer_mouvement_par_encaissements',
    'retirer_classement_par_encaissements', 'garder_ventes_par_les_factures', 'fixer_source_de_la_vente',
    'garder_ecriture_vente_facturee', 'garder_factures_validees',
  ]
  const raiseSql = FONCTIONS.flatMap((nom) => {
    const sql = derniereDefinitionSql(nom)
    return [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
      .map((m) => [m[1].replace(/''/g, "'"), m[2]] as const)
  })

  it('l’essai se lit : ses étapes, ses refus exigés', () => {
    expect(etapesDeLEssai().length).toBeGreaterThan(140)
    expect(refus.length).toBeGreaterThan(80)
    expect(NEUFS.length).toBe(48)
  })

  it('chaque refus neuf du module y est exigé de la base, sous ses mots et son code', () => {
    for (const [modele, code] of NEUFS) expect(exige(modele, code), `${code} ${modele}`).toBe(true)
  })

  it('chaque refus qu’il exige est dans le texte d’une fonction, sous le même code, ou nomme une contrainte de l’export', () => {
    const export_ = fichiersDuSchema().map((f) => f.texte).join('\n')
    for (const e of refus) {
      const contrainte = /^%(\w+)%$/.exec(e.attendu)
      if (contrainte) {
        expect(export_, e.controle).toMatch(new RegExp(`add constraint ${contrainte[1]}\\b`))
        expect(e.code, e.controle).toBe('23514')
        continue
      }
      expect(raiseSql.some(([m, c]) => c === e.code && correspondAuModele(m, e.attendu)), `${e.controle} : ${e.code} ${e.attendu}`).toBe(true)
    }
  })

  it('vire au rouge sur un refus que l’essai n’exigerait plus, ou qu’il exigerait sous un autre code', () => {
    const [modele, code] = NEUFS.find(([m]) => m.startsWith('Le mouvement à rattacher')) as readonly [string, string]
    expect(exige(modele, code)).toBe(true)
    expect(exige(modele, '23514')).toBe(false)
    const plante = TEXTE_ESSAI_VENTES_FACTUREES.replace("'Le mouvement à rattacher est à désigner.'", "'Le mouvement à rattacher est à désigner !'")
    expect(plante).not.toBe(TEXTE_ESSAI_VENTES_FACTUREES)
    expect(refusExigesParLEssai(plante).some((e) => e.code === code && correspondAuModele(modele, e.attendu))).toBe(false)
    expect(correspondAuModele('% : ce mouvement ne change plus.', "L'exercice 2025 est validé : ce mouvement ne change plus.")).toBe(true)
    expect(correspondAuModele('% : ce mouvement ne change plus.', "L'exercice 2025 est validé : ce mouvement ne change pas.")).toBe(false)
    expect(correspondAuModele('À % %%, il reste % €.', 'À 20 %, il reste 3,00 €.')).toBe(true)
  })
})
