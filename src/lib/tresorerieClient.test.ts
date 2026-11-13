import { describe, expect, it } from 'vitest'
import * as module from './tresorerieClient'
import {
  HORIZON_EN_JOURS, NON_COMPTE_ACHATS, NON_COMPTE_PREVISIONNEL_DU_CABINET, NON_COMPTE_VENTES_FERMEES, TRESORERIE_A_90_JOURS_OFFERTE,
  composerTresorerie, departDesSoldes, dernierJourDeLHorizon, echeancesDeLEcheancier, finDeLHorizon, maTresorerieOuverte,
  NON_COMPTE_PAS_ENCORE_ENREGISTRE, NON_COMPTE_PEUT_ETRE_PAYEE, reglementDeLaCotisation, soldesDeLaBanque, type CreancesDeLaTresorerie, type Depart,
  type AchatsDeLaTresorerie, type DeclarationDePaiement, type EcheancesDeLaTresorerie, type MouvementDuReleve, type PartDeReglement,
  type PieceDAchatLue, reglementDeLAchat,
} from './tresorerieClient'
import type { LectureComplete } from './lectureComplete'
import { motsDuCabinet } from './espaceVentes'
import { SANS_IMPOT_SUR_LES_SOCIETES } from './echeancesFiscales'
import type { EcheanceDuClient } from './echeancierClient'
import type { FactureEmise } from './types'

// « MA TRÉSORERIE À 90 JOURS » (étape C8) : le module pur. Ce que ces cas gardent : l'horizon de 90 jours de Paris, borné
// des deux côtés ; le départ LU (jamais calculé), muet ou absent selon les relevés ; seules les créances à venir dans
// l'horizon comptées, les autres dites ; une échéance sans montant nommée, jamais 0 ; une source lue en partie qui rend la
// projection muette ; le point bas jamais flatté (les sorties d'abord) ; les centimes exacts ; les mots du client.

const AUJOURDHUI = '2026-11-13'

const departLu = (centimes: number, au = '2026-11-12'): Extract<Depart, { etat: 'lu' }> =>
  ({ etat: 'lu', centimes, au, comptes: 1, datesDifferentes: false })

const facture = (f: Partial<FactureEmise>): FactureEmise => ({
  id: 'f', dossier_id: 'd1', numero: 'F1', type: 'facture', statut: 'validee', facture_origine_id: null, date_emission: '2026-10-01',
  date_echeance: null, montant_ht: 0, montant_tva: 0, montant_ttc: 0, source_de_la_vente: false, acompte: false, tiers_nom: 'Client fictif',
  ...f,
} as FactureEmise)

// Une facture de `ttc` euros, une ligne à 0 %, sans encaissement : son reste dû est son TTC.
function ventes(factures: { id: string; numero: string; echeance: string | null; ttc: number }[]): CreancesDeLaTresorerie {
  return {
    etat: 'lues',
    listes: {
      factures: factures.map((f) => facture({ id: f.id, numero: f.numero, date_echeance: f.echeance, montant_ht: f.ttc, montant_ttc: f.ttc })),
      facturesIncompletes: null,
      lignes: factures.map((f) => ({ id: `l-${f.id}`, facture_id: f.id, quantite: 1, prix_unitaire_ht: f.ttc, taux_tva: 0 }) as never),
      encaissements: [], parts: [], encaissementsIncomplets: null,
    },
  }
}

const echeance = (e: Partial<EcheanceDuClient>): EcheanceDuClient => ({
  id: 'e', nature: 'cotisations', date: '2026-12-05', auMois: false, libelle: 'Cotisations sociales : échéance', precision: null,
  montant: null, prevision: false, ...e,
})

const echeances = (liste: EcheanceDuClient[], partiel: string | null = null): EcheancesDeLaTresorerie => ({ etat: 'lues', echeances: liste, cotisations: [], partiel })

const RELEVE_VIDE = { lignes: [], complete: true, motif: null }
// Les achats fermés (drapeau de B4 baissé, ou case « Achats » absente) : « non comptés », comme avant C8 + achats.
const FERMES: module.AchatsDeLaTresorerie = { etat: 'fermes' }

describe('l’horizon', () => {
  it('va d’aujourd’hui (inclus) à aujourd’hui plus 90 jours (exclu)', () => {
    expect(HORIZON_EN_JOURS).toBe(90)
    expect(finDeLHorizon(AUJOURDHUI)).toBe('2027-02-11')
    expect(dernierJourDeLHorizon(AUJOURDHUI)).toBe('2027-02-10')
    // Une année bissextile ne décale rien : le calendrier civil.
    expect(finDeLHorizon('2028-01-15')).toBe('2028-04-14')
  })

  it('compte une créance échue aujourd’hui et le dernier jour, pas le lendemain de l’horizon', () => {
    const t = composerTresorerie({ achats: FERMES,
      releve: RELEVE_VIDE,
      aujourdHui: AUJOURDHUI, depart: departLu(0),
      creances: ventes([
        { id: 'a', numero: 'F-A', echeance: AUJOURDHUI, ttc: 1 },
        { id: 'b', numero: 'F-B', echeance: '2027-02-10', ttc: 2 },
        { id: 'c', numero: 'F-C', echeance: '2027-02-11', ttc: 4 },
      ]),
      echeances: echeances([]),
    })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.mouvements.map((m) => m.id)).toEqual(['facture-a', 'facture-b'])
    expect(t.finCentimes).toBe(300)
    expect(t.nonComptes.find((n) => n.cle === 'creances-apres')).toEqual({ cle: 'creances-apres', phrase: 'Une facture échue après ces 90 jours.', centimes: 400 })
  })
})

describe('qui voit la page', () => {
  it('son drapeau ET « Ma banque » ; baissé, personne', () => {
    expect(maTresorerieOuverte(true, true)).toBe(true)
    expect(maTresorerieOuverte(true, false)).toBe(false)
    expect(maTresorerieOuverte(false, true)).toBe(false)
    expect(TRESORERIE_A_90_JOURS_OFFERTE).toBe(false)
  })
})

// ── Les achats (B4), comptés derrière le drapeau de leur migration ───────────────────────────────────────────────────
const lues = <T,>(lignes: T[]): LectureComplete<T> => ({ lignes, complete: true, motif: null })
const piece = (p: Partial<PieceDAchatLue> & { id: string }): PieceDAchatLue => ({
  tiers: 'Fournisseur fictif', montant_ttc: 100, date_echeance: '2026-12-01', identite_numero: 'FA-1', identite_nature: 'facture', ...p,
})
const declaration = (d: Partial<DeclarationDePaiement> & { piece_id: string }): DeclarationDePaiement =>
  ({ date_paiement: '2026-11-01', montant: 100, retire_le: null, ...d })
const part = (p: Partial<PartDeReglement> & { piece_id: string }): PartDeReglement => ({ ligne_bancaire_id: 'm1', montant: -100, ...p })
const mouvement = (m: Partial<MouvementDuReleve> & { id: string }): MouvementDuReleve =>
  ({ date: '2026-10-30', montant: -100, cotisation_id: null, piece_id: null, ...m })
const achatsLus = (pieces: PieceDAchatLue[], declarations: DeclarationDePaiement[] = [], parts: PartDeReglement[] = []): AchatsDeLaTresorerie =>
  ({ etat: 'lus', pieces: lues(pieces), declarations: lues(declarations), parts: lues(parts) })

function avecAchats(achats: AchatsDeLaTresorerie, releve: MouvementDuReleve[] = [], creances: CreancesDeLaTresorerie = { etat: 'fermees' }, depart = departLu(100000)) {
  return composerTresorerie({ aujourdHui: AUJOURDHUI, depart, creances, echeances: echeances([]), achats, releve: lues(releve) })
}
function projetee(t: ReturnType<typeof composerTresorerie>) {
  if (t.etat !== 'projetee') throw new Error(t.etat)
  return t
}

describe('les achats du client', () => {
  it('une facture d’achat à venir sort à son échéance, pour son reste dû, en centimes exacts', () => {
    const t = projetee(avecAchats(achatsLus([piece({ id: 'a', montant_ttc: 120.1, date_echeance: '2026-12-01' })])))
    expect(t.mouvements).toEqual([{
      id: 'achat-a', date: '2026-12-01', nature: 'achat', libelle: 'Facture FA-1 de Fournisseur fictif : ce que tu dois encore',
      centimes: -12010, prevision: false, soldeApresCentimes: 100000 - 12010,
    }])
    expect(t.sortiesCentimes).toBe(12010)
    expect(t.finCentimes).toBe(87990)
    // La ligne « achats non suivis » disparaît : ils sont comptés.
    expect(t.nonComptes.map((n) => n.cle)).not.toContain('achats')
  })

  it('l’horizon est borné des deux côtés : aujourd’hui inclus, le 90e jour inclus, le suivant dit à part', () => {
    const t = projetee(avecAchats(achatsLus([
      piece({ id: 'a', montant_ttc: 1, date_echeance: AUJOURDHUI }),
      piece({ id: 'b', montant_ttc: 2, date_echeance: '2027-02-10' }),
      piece({ id: 'c', montant_ttc: 4, date_echeance: '2027-02-11' }),
    ])))
    expect(t.mouvements.map((m) => m.id)).toEqual(['achat-a', 'achat-b'])
    expect(t.nonComptes.find((n) => n.cle === 'achats-apres')).toEqual({ cle: 'achats-apres', phrase: 'Une facture d’achat échue après ces 90 jours.', centimes: 400 })
  })

  it('en retard ou sans échéance : dits à part avec leur somme, jamais comptés', () => {
    const t = projetee(avecAchats(achatsLus([
      piece({ id: 'a', montant_ttc: 10, date_echeance: '2026-11-12' }),
      piece({ id: 'b', montant_ttc: 20, date_echeance: '2026-10-01' }),
      piece({ id: 'c', montant_ttc: 5.5, date_echeance: null }),
    ])))
    expect(t.mouvements).toEqual([])
    expect(t.finCentimes).toBe(100000)
    expect(t.nonComptes.find((n) => n.cle === 'achats-en-retard')).toEqual({
      cle: 'achats-en-retard', centimes: 3000, phrase: '2 factures d’achat en retard : tu les dois encore, mais la date de leur paiement n’est plus sûre.',
    })
    expect(t.nonComptes.find((n) => n.cle === 'achats-sans-echeance')).toEqual({
      cle: 'achats-sans-echeance', centimes: 550, phrase: 'Une facture d’achat sans date d’échéance : tu la dois encore.',
    })
  })

  it('une facture sans montant lu, un avoir : nommés, jamais comptés ni mis à 0', () => {
    const t = projetee(avecAchats(achatsLus([
      piece({ id: 'a', montant_ttc: null }),
      piece({ id: 'b', identite_nature: 'avoir', montant_ttc: 50 }),
      piece({ id: 'c', montant_ttc: -30 }),
    ])))
    expect(t.mouvements).toEqual([])
    expect(t.nonComptes.find((n) => n.cle === 'achats-sans-montant')).toEqual({
      cle: 'achats-sans-montant', centimes: null, phrase: 'Une facture d’achat dont le montant n’est pas lu : elle n’est pas comptée ici.',
    })
    expect(t.nonComptes.find((n) => n.cle === 'achats-avoirs')).toEqual({
      cle: 'achats-avoirs', centimes: null, phrase: '2 avoirs d’achat : ce qu’ils te rendent n’est pas compté ici.',
    })
  })

  it('une facture déjà réglée n’entre pas : déclarée payée, rapprochée d’un mouvement, ou réglée par une part de virement groupé', () => {
    const t = projetee(avecAchats(
      achatsLus(
        [piece({ id: 'declaree' }), piece({ id: 'rapprochee' }), piece({ id: 'groupee' }), piece({ id: 'due', montant_ttc: 7 })],
        [declaration({ piece_id: 'declaree' })], [part({ piece_id: 'groupee', ligne_bancaire_id: 'm2' })],
      ),
      [mouvement({ id: 'm1', piece_id: 'rapprochee' }), mouvement({ id: 'm2', montant: -300 })],
    ))
    expect(t.mouvements.map((m) => m.id)).toEqual(['achat-due'])
  })

  it('une déclaration retirée ne règle rien ; un paiement partiel laisse le reste, et rien d’autre', () => {
    const t = projetee(avecAchats(achatsLus(
      [piece({ id: 'retiree', montant_ttc: 100 }), piece({ id: 'partielle', montant_ttc: 100, date_echeance: '2026-12-02' })],
      [declaration({ piece_id: 'retiree', retire_le: '2026-11-05T10:00:00Z' }), declaration({ piece_id: 'partielle', montant: 40.25 })],
    )))
    expect(t.mouvements.map((m) => [m.id, m.centimes])).toEqual([['achat-retiree', -10000], ['achat-partielle', -5975]])
  })

  it('le même paiement déclaré puis rapproché ne se retire pas deux fois : la plus forte des deux sources', () => {
    const r = reglementDeLAchat('a', [mouvement({ id: 'm1', piece_id: 'a', montant: -60 })], [], [declaration({ piece_id: 'a', montant: 60 })], '2026-11-12')
    expect(r).toEqual({ payeCentimes: 6000, apresLeSoldeCentimes: 0 })
    // Une déclaration plus forte que le relevé l’emporte ; un remboursement ne rend jamais une somme négative.
    expect(reglementDeLAchat('a', [mouvement({ id: 'm1', piece_id: 'a', montant: -60 })], [], [declaration({ piece_id: 'a', montant: 80 })], '2026-11-12').payeCentimes).toBe(8000)
    expect(reglementDeLAchat('a', [mouvement({ id: 'm1', piece_id: 'a', montant: 25 })], [], [], '2026-11-12').payeCentimes).toBe(0)
    // Un paiement d’une autre pièce n’est jamais celui-ci.
    expect(reglementDeLAchat('a', [mouvement({ id: 'm1', piece_id: 'b' })], [part({ piece_id: 'b' })], [declaration({ piece_id: 'b' })], '2026-11-12').payeCentimes).toBe(0)
  })

  it('payé après la date du solde : ni dans le solde, ni compté, et dit avec sa somme', () => {
    const t = projetee(avecAchats(
      achatsLus([piece({ id: 'a', montant_ttc: 100 }), piece({ id: 'b', montant_ttc: 50 })], [declaration({ piece_id: 'a', date_paiement: '2026-11-13' })]),
      [mouvement({ id: 'm9', piece_id: 'b', date: '2026-11-12', montant: -50 })],
    ))
    expect(t.mouvements).toEqual([])
    // Le solde est lu au 12 novembre : le paiement déclaré du 13 est après lui ; celui du mouvement du 12, dans le solde.
    expect(t.nonComptes.find((n) => n.cle === 'achats-payes-depuis-le-releve')).toEqual({
      cle: 'achats-payes-depuis-le-releve', centimes: 10000,
      phrase: 'Payé sur tes factures d’achat depuis le 12 novembre 2026, date de ton dernier relevé contrôlé : ni dans ton solde, ni compté ici.',
    })
  })

  it('le même jour, les sorties passent avant les entrées, et la cotisation avant l’achat', () => {
    const t = projetee(composerTresorerie({
      aujourdHui: AUJOURDHUI, depart: departLu(0), releve: lues([]),
      creances: ventes([{ id: 'v', numero: 'F-V', echeance: '2026-12-05', ttc: 100 }]),
      echeances: echeances([echeance({ id: 'cotisation-1', montant: { valeur: 1, estimation: false } })]),
      achats: achatsLus([piece({ id: 'a', montant_ttc: 2, date_echeance: '2026-12-05' })]),
    }))
    expect(t.mouvements.map((m) => m.id)).toEqual(['cotisation-1', 'achat-a', 'facture-v'])
    expect(t.pointBas.centimes).toBe(-300)
  })

  it('une lecture des achats en partie, ou illisible, rend la projection muette avec son motif — jamais un chiffre', () => {
    const partielle = <T,>(): LectureComplete<T> => ({ lignes: [], complete: false, motif: 'lu en partie' })
    for (const achats of [
      { etat: 'lus', pieces: partielle(), declarations: lues([]), parts: lues([]) },
      { etat: 'lus', pieces: lues([]), declarations: partielle(), parts: lues([]) },
      { etat: 'lus', pieces: lues([]), declarations: lues([]), parts: partielle() },
    ] satisfies AchatsDeLaTresorerie[]) {
      expect(avecAchats(achats)).toMatchObject({ etat: 'muette', motif: 'tes achats : lu en partie' })
    }
    expect(avecAchats({ etat: 'illisibles', motif: 'refus' })).toMatchObject({ etat: 'muette', motif: 'tes achats : refus' })
  })

  it('achats fermés (drapeau baissé ou case absente) : « non comptés », dit à la même place qu’avant', () => {
    const t = projetee(avecAchats(FERMES))
    expect(t.nonComptes.map((n) => n.cle)).toEqual(['ventes-fermees', 'achats', 'previsionnel-du-cabinet', 'pas-encore-enregistre'])
    expect(t.nonComptes[1]).toEqual({ cle: 'achats', phrase: NON_COMPTE_ACHATS, centimes: null })
    expect(t.mouvements).toEqual([])
  })

  it('les achats sont comptés : lus, ils changent la projection, fermés non — la levée de B4 n’a plus rien à attendre d’ici', () => {
    const compte = projetee(avecAchats(achatsLus([piece({ id: 'a', montant_ttc: 250 })])))
    const non = projetee(avecAchats(FERMES))
    expect(compte.finCentimes).toBe(non.finCentimes - 25000)
    expect(compte.nonComptes.some((n) => n.cle === 'achats')).toBe(false)
    expect(non.nonComptes.some((n) => n.cle === 'achats')).toBe(true)
  })
})

describe('le départ', () => {
  it('somme les soldes LUS en centimes exacts, datée du plus ancien', () => {
    expect(departDesSoldes([{ etat: 'lu', solde: 0.1, au: '2026-10-31' }, { etat: 'lu', solde: 0.2, au: '2026-11-07' }]))
      .toEqual({ etat: 'lu', centimes: 30, au: '2026-10-31', comptes: 2, datesDifferentes: true })
    expect(departDesSoldes([{ etat: 'lu', solde: -12.34, au: '2026-10-31' }]))
      .toEqual({ etat: 'lu', centimes: -1234, au: '2026-10-31', comptes: 1, datesDifferentes: false })
  })

  it('muet sur une lecture partielle, sans solde sans relevé contrôlé — jamais 0', () => {
    expect(departDesSoldes([{ etat: 'muet', motif: 'lu en partie' }])).toEqual({ etat: 'muet', motif: 'lu en partie' })
    expect(departDesSoldes([])).toMatchObject({ etat: 'muet' })
    const sans = departDesSoldes([{ etat: 'aucun_releve' }])
    expect(sans.etat).toBe('sans_solde')
    const unDesComptes = departDesSoldes([{ etat: 'lu', solde: 5, au: '2026-10-31' }, { etat: 'aucun_solde_sur', releves: 2 }])
    expect(unDesComptes).toMatchObject({ etat: 'sans_solde' })
    expect(unDesComptes.etat === 'sans_solde' && unDesComptes.phrase).toMatch(/^Un de tes comptes bancaires n’a pas de solde contrôlé : /)
  })

  it('un compte : le solde du dernier relevé contrôlé ; plusieurs comptes : un solde par compte ; un relevé d’un compte inconnu : retenus', () => {
    const controles = {
      complete: true, motif: null, lignes: [
        { id: 'c1', solde_final: 10, coherent: true, periode_fin: '2026-10-31', created_at: '2026-11-01T00:00:00Z', compte_bancaire_id: 'k1' },
        { id: 'c2', solde_final: 20, coherent: true, periode_fin: '2026-09-30', created_at: '2026-10-01T00:00:00Z', compte_bancaire_id: 'k2' },
      ],
    }
    expect(soldesDeLaBanque({ etat: 'sans_objet' }, controles)).toEqual({ etat: 'lus', soldes: [{ etat: 'lu', solde: 10, au: '2026-10-31' }] })
    const compte = (id: string, principal: boolean) => ({ id, libelle: id, principal, fin_d_identifiant: null, ouvert_le: null, clos_le: null })
    expect(soldesDeLaBanque({ etat: 'lus', comptes: [compte('k1', true), compte('k2', false)] }, controles)).toEqual({
      etat: 'lus', soldes: [{ etat: 'lu', solde: 10, au: '2026-10-31' }, { etat: 'lu', solde: 20, au: '2026-09-30' }],
    })
    expect(soldesDeLaBanque({ etat: 'lus', comptes: [compte('k1', true)] }, controles).etat).toBe('retenus')
    expect(soldesDeLaBanque({ etat: 'illisible', motif: 'refus' }, controles).etat).toBe('retenus')
  })
})

describe('la projection', () => {
  it('sans départ lu, rien ne se projette', () => {
    const sans: Depart = { etat: 'sans_solde', phrase: 'x' }
    expect(composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: sans, creances: { etat: 'fermees' }, echeances: echeances([]) }))
      .toEqual({ etat: 'sans_depart', depart: sans })
  })

  it('une source lue en partie rend la projection muette, avec son motif', () => {
    const lues = ventes([])
    if (lues.etat !== 'lues') throw new Error()
    const cas: [CreancesDeLaTresorerie, EcheancesDeLaTresorerie, RegExp][] = [
      [{ etat: 'illisibles', motif: 'rompue' }, echeances([]), /tes ventes : rompue/],
      [{ etat: 'lues', listes: { ...lues.listes, facturesIncompletes: '3 sur 5' } }, echeances([]), /tes ventes : 3 sur 5/],
      [{ etat: 'lues', listes: { ...lues.listes, encaissementsIncomplets: 'registre' } }, echeances([]), /tes ventes : registre/],
      [{ etat: 'fermees' }, { etat: 'illisibles', motif: 'refus' }, /tes échéances : refus/],
      [{ etat: 'fermees' }, echeances([], 'cotisations en partie'), /tes échéances : cotisations en partie/],
    ]
    for (const [creances, ech, motif] of cas) {
      const t = composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: departLu(100), creances, echeances: ech })
      expect(t.etat).toBe('muette')
      expect(t.etat === 'muette' && t.motif).toMatch(motif)
    }
  })

  it('jour après jour, les sorties d’abord le même jour : le point bas et le premier découvert', () => {
    const t = composerTresorerie({ achats: FERMES,
      releve: RELEVE_VIDE,
      aujourdHui: AUJOURDHUI, depart: departLu(10000),
      creances: ventes([{ id: 'f2', numero: 'F2', echeance: '2026-12-05', ttc: 150 }, { id: 'f3', numero: 'F3', echeance: '2026-11-20', ttc: 0.1 }]),
      echeances: echeances([
        echeance({ id: 'cot-1', date: '2026-12-05', montant: { valeur: 200.2, estimation: false } }),
        echeance({ id: 'cot-2', date: '2026-12-20', montant: { valeur: 0.2, estimation: true }, prevision: true }),
      ]),
    })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.mouvements.map((m) => [m.id, m.date, m.centimes, m.soldeApresCentimes, m.prevision])).toEqual([
      ['facture-f3', '2026-11-20', 10, 10010, false],
      // Le 5 décembre : la cotisation avant la facture, le point bas n'est jamais flatté.
      ['cot-1', '2026-12-05', -20020, -10010, false],
      ['facture-f2', '2026-12-05', 15000, 4990, false],
      ['cot-2', '2026-12-20', -20, 4970, true],
    ])
    expect(t.entreesCentimes).toBe(15010)
    expect(t.sortiesCentimes).toBe(20040)
    expect(t.finCentimes).toBe(4970)
    expect(t.pointBas).toEqual({ centimes: -10010, date: '2026-12-05' })
    expect(t.premierDecouvert).toBe('2026-12-05')
    expect(t.avecPrevision).toBe(true)
  })

  it('un départ déjà négatif est un découvert aujourd’hui ; un point bas au départ porte la date du solde', () => {
    const t = composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: departLu(-5, '2026-11-10'), creances: { etat: 'fermees' }, echeances: echeances([]) })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.premierDecouvert).toBe(AUJOURDHUI)
    expect(t.pointBas).toEqual({ centimes: -5, date: '2026-11-10' })
    expect(t.mouvements).toEqual([])
    expect(t.avecPrevision).toBe(false)
  })

  it('ce qui n’est pas compté se dit : retard, sans échéance, sans montant, ventes fermées, achats, cabinet, depuis le relevé', () => {
    const t = composerTresorerie({ achats: FERMES,
      releve: RELEVE_VIDE,
      aujourdHui: AUJOURDHUI, depart: departLu(0, '2026-10-31'),
      creances: ventes([
        { id: 'r1', numero: 'R1', echeance: '2026-11-12', ttc: 10 },
        { id: 'r2', numero: 'R2', echeance: '2026-01-01', ttc: 5 },
        { id: 's1', numero: 'S1', echeance: null, ttc: 7 },
      ]),
      echeances: echeances([
        echeance({ id: 'cfe-solde-2026', nature: 'impots', date: '2026-12-15', libelle: 'CFE 2026 : paiement' }),
        // La CA3 du mois en cours, datée du premier du mois : nommée, jamais comptée.
        echeance({ id: 'ca3-2026-10', nature: 'tva', date: '2026-11-01', auMois: true, libelle: 'TVA d’octobre 2026' }),
        // Au-delà de l'horizon : ni comptée ni nommée.
        echeance({ id: 'loin', date: '2027-05-01', montant: { valeur: 99, estimation: false } }),
      ]),
    })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.mouvements).toEqual([])
    expect(t.nonComptes).toEqual([
      { cle: 'creances-en-retard', phrase: '2 factures en retard : leur encaissement n’a plus de date sûre.', centimes: 1500 },
      { cle: 'creances-sans-echeance', phrase: 'Une facture sans date d’échéance.', centimes: 700 },
      { cle: 'echeance-cfe-solde-2026', phrase: 'CFE 2026 : paiement (15 décembre 2026) : son montant n’est pas connu ici.', centimes: null },
      { cle: 'echeance-ca3-2026-10', phrase: 'TVA d’octobre 2026 (courant novembre 2026) : son montant n’est pas connu ici.', centimes: null },
      { cle: 'achats', phrase: NON_COMPTE_ACHATS, centimes: null },
      { cle: 'previsionnel-du-cabinet', phrase: NON_COMPTE_PREVISIONNEL_DU_CABINET, centimes: null },
      { cle: 'pas-encore-enregistre', phrase: NON_COMPTE_PAS_ENCORE_ENREGISTRE, centimes: null },
      { cle: 'depuis-le-releve', phrase: 'Ce qui est entré ou sorti de ton compte depuis le 31 octobre 2026, date de ton dernier relevé contrôlé.', centimes: null },
    ])
    const fermees = composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: departLu(0), creances: { etat: 'fermees' }, echeances: echeances([]) })
    expect(fermees.etat === 'projetee' && fermees.nonComptes.map((n) => n.phrase)).toEqual([NON_COMPTE_VENTES_FERMEES, NON_COMPTE_ACHATS, NON_COMPTE_PREVISIONNEL_DU_CABINET, NON_COMPTE_PAS_ENCORE_ENREGISTRE])
  })

  it('une facture encaissée en partie compte son reste, un avoir déduit ; un avoir n’est pas une créance', () => {
    const base = ventes([{ id: 'f1', numero: 'F1', echeance: '2026-12-01', ttc: 100 }])
    if (base.etat !== 'lues') throw new Error()
    const listes = {
      ...base.listes,
      factures: [...base.listes.factures, facture({ id: 'av', numero: 'A1', type: 'avoir', facture_origine_id: 'f1', montant_ttc: -10, date_echeance: '2026-12-01' })],
      encaissements: [{ id: 'e1', dossier_id: 'd1', facture_id: 'f1', montant: 30.5, retire_le: null, annule_id: null } as never],
    }
    const t = composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: departLu(0), creances: { etat: 'lues', listes }, echeances: echeances([]) })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.mouvements.map((m) => [m.id, m.centimes])).toEqual([['facture-f1', 5950]])
  })
})

// LE DOUBLE COMPTE (suite de C8, 13/11/2026) : une échéance déjà prélevée est dans le solde lu — la compter encore à sa date
// la retirait deux fois. Ces cas échouaient avant la correction : l'échéance rapprochée entrait dans la projection.
describe('une échéance de cotisation déjà payée, un encaissement d’après le relevé', () => {
  const cotisation = (champs: { id: string; montant_verse?: number | null }) => ({
    id: champs.id, echeance: '2026-12-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 200,
    montant_verse: champs.montant_verse ?? null,
  })
  const mouvement = (m: Partial<MouvementDuReleve>): MouvementDuReleve => ({ id: 'm', date: '2026-10-30', montant: -200, cotisation_id: null, ...m })
  const releve = (lignes: MouvementDuReleve[]) => ({ lignes, complete: true, motif: null })
  const echeancesDe = (cotisations: ReturnType<typeof cotisation>[]): EcheancesDeLaTresorerie => ({
    etat: 'lues', partiel: null, cotisations,
    echeances: cotisations.map((c) => echeance({ id: `cotisation-${c.id}`, date: c.echeance, montant: { valeur: c.montant_appele, estimation: false } })),
  })

  it('la règle, cas par cas : dans le solde, prélevée après lui, peut-être payée, à payer', () => {
    const au = '2026-10-31'
    expect(reglementDeLaCotisation(cotisation({ id: 'c' }), [mouvement({ cotisation_id: 'c', date: au })], au)).toEqual({ etat: 'dans_le_solde', le: au })
    expect(reglementDeLaCotisation(cotisation({ id: 'c' }), [mouvement({ cotisation_id: 'c', date: '2026-11-03', montant: -200.01 })], au))
      .toEqual({ etat: 'apres_le_solde', le: '2026-11-03', centimes: 20001 })
    // Le mouvement fait foi sur le montant versé.
    expect(reglementDeLaCotisation(cotisation({ id: 'c', montant_verse: 150 }), [mouvement({ cotisation_id: 'c' })], au).etat).toBe('dans_le_solde')
    expect(reglementDeLaCotisation(cotisation({ id: 'c', montant_verse: 150.5 }), [mouvement({ cotisation_id: 'autre' })], au))
      .toEqual({ etat: 'peut_etre_payee', centimes: 15050 })
    expect(reglementDeLaCotisation(cotisation({ id: 'c' }), [mouvement({ cotisation_id: 'autre' })], au)).toEqual({ etat: 'a_payer' })
  })

  it('prélevée au jour du solde ou avant : n’entre pas ; après lui : dite avec sa somme ; versement noté : « peut-être déjà payée »', () => {
    const t = composerTresorerie({ achats: FERMES,
      aujourdHui: AUJOURDHUI, depart: departLu(100000, '2026-10-31'), creances: { etat: 'fermees' },
      echeances: echeancesDe([cotisation({ id: 'dans' }), cotisation({ id: 'apres' }), cotisation({ id: 'note', montant_verse: 200 }), cotisation({ id: 'due' })]),
      releve: releve([
        mouvement({ id: 'm1', cotisation_id: 'dans', date: '2026-10-31' }),
        mouvement({ id: 'm2', cotisation_id: 'apres', date: '2026-11-05' }),
      ]),
    })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    // Seule l'échéance que rien ne dit payée est comptée, une fois.
    expect(t.mouvements.map((m) => [m.id, m.centimes])).toEqual([['cotisation-due', -20000]])
    expect(t.finCentimes).toBe(80000)
    const dites = t.nonComptes.filter((n) => n.cle.startsWith('echeance-'))
    expect(dites).toEqual([
      { cle: 'echeance-cotisation-apres', centimes: 20000,
        phrase: 'Cotisations sociales : échéance (5 décembre 2026) : déjà prélevée le 5 novembre 2026, après ton dernier relevé contrôlé : ni dans ton solde, ni comptée ici.' },
      { cle: 'echeance-cotisation-note', centimes: 20000, phrase: `Cotisations sociales : échéance (5 décembre 2026) : ${NON_COMPTE_PEUT_ETRE_PAYEE}` },
    ])
  })

  it('un relevé lu en partie rend la projection muette', () => {
    const t = composerTresorerie({ achats: FERMES,
      aujourdHui: AUJOURDHUI, depart: departLu(0), creances: { etat: 'fermees' }, echeances: echeancesDe([cotisation({ id: 'c' })]),
      releve: { lignes: [], complete: false, motif: '10 sur 12' },
    })
    expect(t.etat === 'muette' && t.motif).toBe('ton relevé : 10 sur 12')
  })

  it('un encaissement daté après le solde (par son mouvement s’il en a un) se dit, jamais compté ; espèces et retirés à part', () => {
    const base = ventes([{ id: 'f1', numero: 'F1', echeance: '2026-12-01', ttc: 100 }])
    if (base.etat !== 'lues') throw new Error()
    const enc = (e: Record<string, unknown>) => ({ id: 'e', dossier_id: 'd1', facture_id: 'f1', annule_id: null, retire_le: null, ligne_bancaire_id: null, moyen: 'virement', ...e }) as never
    const listes = {
      ...base.listes,
      encaissements: [
        // Après le solde, sans mouvement : dit.
        enc({ id: 'e1', montant: 10, date_encaissement: '2026-11-05' }),
        // Daté après, mais son mouvement est du 30 octobre : dans le solde.
        enc({ id: 'e2', montant: 20, date_encaissement: '2026-11-06', ligne_bancaire_id: 'm-ancien' }),
        // Son mouvement est du 7 novembre : dit.
        enc({ id: 'e3', montant: 5.5, date_encaissement: '2026-10-20', ligne_bancaire_id: 'm-recent' }),
        enc({ id: 'e4', montant: 30, date_encaissement: '2026-11-05', moyen: 'especes' }),
        enc({ id: 'e5', montant: 40, date_encaissement: '2026-11-05', retire_le: '2026-11-06T00:00:00Z' }),
        // Au jour du solde : dedans.
        enc({ id: 'e6', montant: 1, date_encaissement: '2026-10-31' }),
      ],
    }
    const t = composerTresorerie({ achats: FERMES,
      aujourdHui: AUJOURDHUI, depart: departLu(0, '2026-10-31'), creances: { etat: 'lues', listes }, echeances: echeances([]),
      releve: releve([mouvement({ id: 'm-ancien', date: '2026-10-30', montant: 20 }), mouvement({ id: 'm-recent', date: '2026-11-07', montant: 5.5 })]),
    })
    if (t.etat !== 'projetee') throw new Error(t.etat)
    expect(t.nonComptes.find((n) => n.cle === 'encaisse-depuis-le-releve')).toEqual({
      cle: 'encaisse-depuis-le-releve', centimes: 1550,
      phrase: 'Encaissé sur tes factures depuis le 31 octobre 2026, date de ton dernier relevé contrôlé : ni dans ton solde, ni compté ici.',
    })
    // Le reste dû compte tout le registre non retiré (espèces comprises), comme hier : 100 − 10 − 20 − 5,5 − 30 − 1.
    expect(t.mouvements.map((m) => m.centimes)).toEqual([3350])
  })
})

describe('ce que rien ne permet de voir', () => {
  it('un paiement pas encore enregistré ni rapproché se dit toujours, sans somme, dans toute projection', () => {
    expect(NON_COMPTE_PAS_ENCORE_ENREGISTRE).toMatch(/pas encore enregistré ni rapproché/)
    expect(NON_COMPTE_PAS_ENCORE_ENREGISTRE).toMatch(/dans ton solde et dans ce calcul/)
    expect(motsDuCabinet(NON_COMPTE_PAS_ENCORE_ENREGISTRE)).toEqual([])
    const cas: [CreancesDeLaTresorerie, EcheancesDeLaTresorerie][] = [
      [{ etat: 'fermees' }, echeances([])],
      [ventes([{ id: 'f', numero: 'F', echeance: '2026-12-01', ttc: 10 }]), echeances([echeance({ montant: { valeur: 1, estimation: false } })])],
    ]
    for (const [creances, ech] of cas) {
      const t = composerTresorerie({ achats: FERMES, releve: RELEVE_VIDE, aujourdHui: AUJOURDHUI, depart: departLu(0), creances, echeances: ech })
      if (t.etat !== 'projetee') throw new Error(t.etat)
      expect(t.nonComptes.filter((n) => n.phrase === NON_COMPTE_PAS_ENCORE_ENREGISTRE)).toEqual([
        { cle: 'pas-encore-enregistre', phrase: NON_COMPTE_PAS_ENCORE_ENREGISTRE, centimes: null },
      ])
    }
  })
})

describe('les échéances de l’échéancier', () => {
  it('composées AVEC leurs montants ; lues en partie, le motif ; illisibles, illisibles', () => {
    const lues = echeancesDeLEcheancier({
      etat: 'lu', motif: null, dossier: { statut_tva: 'exonere', tva_periodicite: 'mensuelle', mode_comptable: 'tresorerie' },
      cotisations: [{ id: 'c1', echeance: '2026-12-05', previsionnel: false, paiement_personnel_le: null, montant_appele: 321.45 }],
    }, AUJOURDHUI, SANS_IMPOT_SUR_LES_SOCIETES)
    if (lues.etat !== 'lues') throw new Error()
    expect(lues.partiel).toBeNull()
    expect(lues.echeances.find((e) => e.id === 'cotisation-c1')?.montant).toEqual({ valeur: 321.45, estimation: false })
    const partielles = echeancesDeLEcheancier({ etat: 'partiel', motif: null, dossier: null, cotisations: [] }, AUJOURDHUI, SANS_IMPOT_SUR_LES_SOCIETES)
    expect(partielles.etat === 'lues' && partielles.partiel).toBe('ton échéancier n’a été lu qu’en partie')
    expect(echeancesDeLEcheancier({ etat: 'illisible', motif: 'x' }, AUJOURDHUI, SANS_IMPOT_SUR_LES_SOCIETES)).toEqual({ etat: 'illisibles', motif: 'x' })
  })
})

describe('les mots', () => {
  it('tutoient et ne nomment aucun onglet', () => {
    const textes = Object.entries(module)
      .filter(([nom, v]) => typeof v === 'string' && /^(TRESORERIE_|NON_COMPTE_)/.test(nom) && nom !== 'TRESORERIE_A_90_JOURS_OFFERTE')
      .map(([, v]) => v as string)
    expect(textes.length).toBeGreaterThanOrEqual(12)
    textes.push(module.nonCompteEnRetard(1), module.nonCompteEnRetard(3), module.nonCompteSansEcheance(2), module.nonCompteApres(2),
      module.nonCompteDepuisLeReleve('2026-11-01'), module.phraseDuDecouvert('2026-12-01'), module.nonComptePrelevee('2026-11-02'),
      module.nonCompteEncaisseDepuisLeReleve('2026-11-01'), module.nonCompteAchatsEnRetard(1), module.nonCompteAchatsEnRetard(3),
      module.nonCompteAchatsSansEcheance(1), module.nonCompteAchatsSansEcheance(2), module.nonCompteAchatsApres(1), module.nonCompteAchatsApres(2),
      module.nonCompteAchatsSansMontant(1), module.nonCompteAchatsSansMontant(2), module.nonCompteAvoirsDAchat(1), module.nonCompteAvoirsDAchat(2),
      module.nonCompteAchatsPayesDepuisLeReleve('2026-11-01'))
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })

  it('l’introduction, dite avant toute lecture, n’affirme rien', () => {
    expect(module.TRESORERIE_INTRODUCTION).not.toMatch(/\b(aucun|aucune|rien)\b|(^|[^\d,.])0(\s|$|,00)/i)
  })
})
