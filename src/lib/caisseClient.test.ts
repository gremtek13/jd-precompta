import { describe, expect, it } from 'vitest'
import {
  ensembleDuJour, fluxDeLaCaisse, jugerLaSaisie, jugerLeRemplacement, jugerLeRetrait, MOTS_DE_LA_CAISSE, refus, soldesDeLaCaisse,
  type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type SaisieDeCaisse,
} from './caisse'
import { soldeAuJour } from './caisseEcran'
import {
  anneeFigee, auteurPourLeClient, caisseRejouee, confirmationDeLaCorrection, confirmationDeLaSaisie, confirmationDuRetrait,
  corrigeableParLeClient, devenirDeLaRetiree, dossierDuClient, GENRES_DU_CLIENT, horsDeLAnnee, jourLu, joursDuMois,
  libelleDeLaLigne, maCaisseOuverte, nomPourLeClient, PLAN_QUE_LE_CLIENT_NE_LIT_PAS, RAPPEL_DU_BROUILLARD,
  refusDuRetraitDuClient, retireesDuMois, saisieDuClient, saisieDuFormulaire, soldeLuAu, verdictDuFormulaire,
  type DossierDuClient, type JourDeLaCaisseDuClient, type NatureDesRecettesLue, type OperationDuClient,
} from './caisseClient'
import { motsDuCabinet } from './espaceVentes'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// « MA CAISSE » : CE QUE L'ÉCRAN DU PRATICIEN DIT ET ENVOIE (ligne 26.6, étape C12a). Ce que ces cas gardent :
//  1. la route ne s'offre qu'avec la case et la migration ; une ligne de `caisse_du_client` se juge à sa forme ;
//  2. la saisie du client fermée, sous les mots de la base, dans son ordre : le statut, la trésorerie, la nature ;
//  3. LA CAISSE REJOUÉE SUR CE QUE LE CLIENT LIT JUGE COMME LA CAISSE ENTIÈRE : sur des caisses tirées au hasard, ce que
//     `caisse_du_client` rendrait (simulé ici sur les flux de lib/caisse.ts, que `caisseDuClient.test.ts` confronte à la
//     fonction), rejoué par le module, rend pour chaque saisie, chaque retrait et chaque correction LE MÊME refus, sous les
//     mêmes mots, que `jugerLaSaisie`, `jugerLeRetrait` et `jugerLeRemplacement` sur la caisse entière — et le même solde ;
//  4. une lecture qui ne se recompose pas se dit, et le module n'y rejoue rien ;
//  5. aucun de ces jugements n'ouvre le plan du dossier, que le client ne lit pas ;
//  6. les mots du client : aucune forme du cabinet (`motsDuCabinet`).
// Données FICTIVES.

const MOI = 'u-client'
const DOSSIER = 'd1'
const NATURE = 'cat-honoraires'
const CAISSE = PLAN_PAR_DEFAUT.caisse
const AUJOURDHUI = '2026-11-02'

function dossierLu(o: Partial<DossierDuClient> = {}): DossierDuClient {
  return { id: DOSSIER, statut_tva: 'exonere', mode_comptable: 'tresorerie', assujetti_tva: false, categorie_recettes_client: NATURE, ...o }
}
const NATURE_LUE: NatureDesRecettesLue = { etat: 'lue', categorie: { id: NATURE, dossier_id: null, compte_comptable: '706000' } }

function operation(o: Partial<OperationDuClient>): OperationDuClient {
  return {
    id: 'o0', dossier_id: DOSSIER, genre: 'recette', date: '2026-03-12', montant: 100, categorie_id: NATURE, taux_tva: null,
    encaissements_du_jour: [], piece_id: null, origine: 'client', remplace_id: null, cree_le: '2026-03-12T18:00:00Z',
    cree_par: MOI, retire_le: null, ...o,
  }
}

function jour(o: Partial<JourDeLaCaisseDuClient>): JourDeLaCaisseDuClient {
  return {
    jour: '2026-03-12', report: 0, ouverture: 0, operations: 0, releve: 0, especes_des_factures: 0, encaissements_du_jour: [],
    solde: 0, fige: false, ...o,
  }
}

// ── `caisse_du_client`, simulée sur la caisse ENTIÈRE ───────────────────────────────────────────────────────────────
// Les flux de `fluxDeLaCaisse` (ceux de `premier_jour_negatif_de_la_caisse`, que la fonction réunit), rangés par source et
// par jour comme la fonction les rend : le report des années d'avant au 1er janvier quand il n'est pas nul, chaque jour de
// l'année qui porte un flux, l'ensemble du jour (`ensembleDuJour`), le solde cumulé, le jour figé par la frontière.
function caisseDuClientSimulee(etat: EtatDeLaCaisse, annee: number, frontiere: string | null = null): JourDeLaCaisseDuClient[] {
  const debut = `${annee}-01-01`
  const fin = `${annee}-12-31`
  const flux = fluxDeLaCaisse(etat)
  const report = flux.filter((f) => f.jour < debut).reduce((s, f) => s + f.centimes, 0)
  const jours = new Set(flux.filter((f) => f.jour >= debut && f.jour <= fin).map((f) => f.jour))
  if (report !== 0) jours.add(debut)
  let solde = report
  return [...jours].sort().map((j) => {
    const du = (source: string) => flux.filter((f) => f.jour === j && f.source === source).reduce((s, f) => s + f.centimes, 0)
    const [ouverture, operations, releve, especes] = ['ouverture', 'operation', 'mouvement', 'encaissement'].map(du)
    const r = j === debut ? report : 0
    solde += ouverture + operations + releve + especes
    return {
      jour: j, report: r / 100, ouverture: ouverture / 100, operations: operations / 100, releve: releve / 100,
      especes_des_factures: especes / 100, encaissements_du_jour: ensembleDuJour(etat, j), solde: solde / 100,
      fige: frontiere != null && j <= frontiere,
    }
  })
}

// Le dossier tel que la BASE le juge pour le client, sur sa caisse entière.
function dossierReel(etat: EtatDeLaCaisse, o: Partial<DossierDeLaCaisse> = {}): DossierDeLaCaisse {
  return {
    quiEcrit: 'client', utilisateur: MOI, modele: { mode: 'tresorerie', compteNotesDeFrais: '', plan: PLAN_PAR_DEFAUT },
    assujetti: false, aujourdhui: AUJOURDHUI, ouverture: null, anneesValidees: [],
    categories: [{ id: NATURE, dossier_id: null, libelle: 'Honoraires', compte_comptable: '706000' }], caisse: etat,
    natureDesRecettesDuClient: NATURE, ...o,
  }
}

// Le plan que le client ne lit pas, PIÉGÉ : tout accès lève.
const PLAN_PIEGE = new Proxy(PLAN_QUE_LE_CLIENT_NE_LIT_PAS, {
  get(cible, cle) {
    if (typeof cle === 'string' && cle in cible) throw new Error(`le plan du dossier a été lu (${cle})`)
    return Reflect.get(cible, cle)
  },
})

// Ce que l'écran rejoue de ce qu'il lit, pour une année : les jours de cette année et des suivantes, ses opérations.
function rejoue(etat: EtatDeLaCaisse, annee: number): DossierDeLaCaisse {
  const jours = [annee, 2026].filter((a, i, t) => t.indexOf(a) === i).flatMap((a) => caisseDuClientSimulee(etat, a))
  const r = caisseRejouee(jours, etat.operations as OperationDuClient[], annee)
  if (r.motif !== null) throw new Error(`la caisse ne se rejoue pas : ${r.motif}`)
  const d = dossierDuClient({ dossier: dossierLu(), moi: MOI, aujourdhui: AUJOURDHUI }, NATURE_LUE, r.etat)
  return { ...d, modele: { ...d.modele, plan: PLAN_PIEGE } }
}

describe('la route, et ce que la base rend', () => {
  it('« Ma caisse » ne s’offre qu’avec la case et la migration', () => {
    expect(maCaisseOuverte(true, true)).toBe(true)
    expect(maCaisseOuverte(true, false)).toBe(false)
    expect(maCaisseOuverte(false, true)).toBe(false)
    expect(maCaisseOuverte(false, false)).toBe(false)
  })

  it('juge une ligne de `caisse_du_client` à sa forme', () => {
    const bonne = { ...jour({ encaissements_du_jour: ['e1'], solde: 12.5 }) }
    expect(jourLu(bonne)).toEqual(bonne)
    // Un numeric rendu en texte se lit ; tout le reste se refuse.
    expect(jourLu({ ...bonne, solde: '12.50' })?.solde).toBe(12.5)
    expect(jourLu({ ...bonne, solde: 'douze' })).toBeNull()
    expect(jourLu({ ...bonne, report: null })).toBeNull()
    expect(jourLu({ ...bonne, jour: '12/03/2026' })).toBeNull()
    expect(jourLu({ ...bonne, fige: 'non' })).toBeNull()
    expect(jourLu({ ...bonne, encaissements_du_jour: null })).toBeNull()
    expect(jourLu({ ...bonne, encaissements_du_jour: [1] })).toBeNull()
    expect(jourLu([bonne])).toBeNull()
    expect(jourLu(null)).toBeNull()
  })
})

describe('la saisie du client, ouverte ou fermée, sous les mots de la base', () => {
  it('s’ouvre sur un dossier exonéré ou en franchise, en trésorerie, à la nature de produit fixée', () => {
    expect(saisieDuClient(dossierLu(), NATURE_LUE)).toEqual({ ouverte: true })
    expect(saisieDuClient(dossierLu({ statut_tva: 'franchise' }), NATURE_LUE)).toEqual({ ouverte: true })
    // Une nature du dossier lui-même, aussi.
    expect(saisieDuClient(dossierLu(), { etat: 'lue', categorie: { id: NATURE, dossier_id: DOSSIER, compte_comptable: '706100' } }))
      .toEqual({ ouverte: true })
  })

  it('se ferme dans l’ordre de la base : le statut, la trésorerie, la nature', () => {
    const fermee = (d: DossierDuClient, n: NatureDesRecettesLue = NATURE_LUE) => {
      const s = saisieDuClient(d, n)
      return s.ouverte ? null : s.raison
    }
    const horsStatut = refus('acces_hors_statut').message
    expect(fermee(dossierLu({ statut_tva: 'redevable' }))).toBe(horsStatut)
    expect(fermee(dossierLu({ statut_tva: null }))).toBe(horsStatut)
    // Le statut d'abord, même en engagement et sans nature.
    expect(fermee(dossierLu({ statut_tva: 'redevable', mode_comptable: 'engagement', categorie_recettes_client: null }))).toBe(horsStatut)
    expect(fermee(dossierLu({ mode_comptable: 'engagement', categorie_recettes_client: null }))).toBe(refus('tresorerie').message)
    expect(fermee(dossierLu({ categorie_recettes_client: null }), { etat: 'lue', categorie: null })).toBe(refus('nature_absente').message)
    const sansProduit = refus('nature_sans_produit').message
    expect(fermee(dossierLu(), { etat: 'lue', categorie: null })).toBe(sansProduit)
    expect(fermee(dossierLu(), { etat: 'lue', categorie: { id: NATURE, dossier_id: null, compte_comptable: '626000' } })).toBe(sansProduit)
    expect(fermee(dossierLu(), { etat: 'lue', categorie: { id: NATURE, dossier_id: null, compte_comptable: null } })).toBe(sansProduit)
    expect(fermee(dossierLu(), { etat: 'lue', categorie: { id: NATURE, dossier_id: 'd-autre', compte_comptable: '706000' } })).toBe(sansProduit)
    expect(fermee(dossierLu(), { etat: 'lue', categorie: { id: 'autre', dossier_id: null, compte_comptable: '706000' } })).toBe(sansProduit)
    expect(fermee(dossierLu(), { etat: 'illisible', motif: 'refusée' })).toContain('n’a pas pu être lue (refusée)')
  })
})

// ── Une caisse fictive écrite à la main ──────────────────────────────────────────────────────────────────────────────
// Ouverte au 1er janvier 2025 (80 €), des recettes, un versement en banque, les espèces d'une facture source, un paiement
// d'une pièce de vente par la caisse, une opération du cabinet, une retirée.
function caisseFictive(): EtatDeLaCaisse {
  return {
    compteCaisse: CAISSE,
    ouvertures: [{ date: '2025-01-01', compte: CAISSE, sens: 'debit', montant: 80 }, { date: '2025-01-01', compte: '512000', sens: 'debit', montant: 900 }],
    operations: [
      operation({ id: 'o1', date: '2025-06-03', montant: 40, cree_le: '2025-06-03T18:00:00Z' }),
      operation({ id: 'o2', date: '2026-03-12', montant: 100, cree_le: '2026-03-12T18:00:00Z' }),
      operation({ id: 'o3', date: '2026-03-12', genre: 'prelevement', montant: 30, categorie_id: null, origine: 'cabinet', cree_par: 'u-cabinet', cree_le: '2026-03-12T19:00:00Z' }),
      operation({ id: 'o4', date: '2026-03-20', montant: 60, retire_le: '2026-03-21T08:00:00Z' }),
      operation({ id: 'o5', date: '2026-03-20', montant: 55, remplace_id: 'o4', cree_le: '2026-03-21T08:00:00Z' }),
      operation({ id: 'o6', date: '2026-04-02', genre: 'paiement', montant: 25, categorie_id: null, piece_id: 'p-vente', origine: 'cabinet', cree_par: 'u-cabinet' }),
    ],
    mouvements: [{ id: 'm1', date: '2026-03-25', montant: 150, compte_bilan: CAISSE }, { id: 'm2', date: '2026-03-25', montant: 10, compte_bilan: '580000' }],
    encaissements: [
      { id: 'e1', facture_id: 'f1', date_encaissement: '2026-04-02', montant: 45, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null },
      { id: 'e2', facture_id: 'f1', date_encaissement: '2026-04-03', montant: 45, moyen: 'cheque', ligne_bancaire_id: null, annule_id: null, retire_le: null },
    ],
    factures: [{ id: 'f1', numero: 'F2026-0001', source_de_la_vente: true }],
    piecesDeVente: ['p-vente'],
  }
}

describe('la caisse rejouée sur ce que le client lit', () => {
  it('se recompose, et rend les soldes et l’ensemble du jour de la caisse entière', () => {
    const etat = caisseFictive()
    const jours = [...caisseDuClientSimulee(etat, 2025), ...caisseDuClientSimulee(etat, 2026)]
    const r = caisseRejouee(jours, etat.operations as OperationDuClient[], 2025)
    expect(r.motif).toBeNull()
    for (const j of jours) expect(soldeAuJour(r.etat!, j.jour), j.jour).toBe(soldeAuJour(etat, j.jour))
    expect(ensembleDuJour(r.etat!, '2026-04-02')).toEqual(ensembleDuJour(etat, '2026-04-02'))
    expect(ensembleDuJour(etat, '2026-04-02')).toEqual(['e1', 'o6'])
    // Depuis 2026 : le report de 2025 (80 + 40 = 120 €) porte ce qui précède.
    const de2026 = caisseDuClientSimulee(etat, 2026)
    expect(de2026[0]).toMatchObject({ jour: '2026-01-01', report: 120, solde: 120 })
    const r2026 = caisseRejouee(de2026, etat.operations as OperationDuClient[], 2026)
    expect(r2026.motif).toBeNull()
    for (const j of de2026) expect(soldeAuJour(r2026.etat!, j.jour)).toBe(soldeAuJour(etat, j.jour))
  })

  it('ne compte le report que de la première année lue : celui d’une suivante est le solde de la précédente', () => {
    const etat = caisseFictive()
    const jours = [...caisseDuClientSimulee(etat, 2025), ...caisseDuClientSimulee(etat, 2026)]
    expect(jours.find((j) => j.jour === '2026-01-01')?.report).toBe(120)
    const r = caisseRejouee(jours, etat.operations as OperationDuClient[], 2025)
    expect(soldeAuJour(r.etat!, '2026-12-31')).toBe(soldeAuJour(etat, '2026-12-31'))
  })

  it('dit une lecture qui ne se recompose pas, sans rien rejouer', () => {
    const etat = caisseFictive()
    const jours = caisseDuClientSimulee(etat, 2026)
    const ops = etat.operations as OperationDuClient[]
    // Une opération que la lecture des opérations ne rend pas.
    expect(caisseRejouee(jours, ops.filter((o) => o.id !== 'o5'), 2026).motif)
      .toBe('le total des opérations du 20/03/2026 ne se retrouve pas dans tes opérations lues')
    expect(caisseRejouee(jours, ops.filter((o) => o.id !== 'o2'), 2026).motif)
      .toBe('les opérations du 12/03/2026 ne se retrouvent pas dans le total que la base a compté')
    // Une opération lue que la base n'a pas comptée (une borne qu'elle pose, une saisie entre les deux lectures).
    expect(caisseRejouee(jours, [...ops, operation({ id: 'o9', date: '2026-05-05', montant: 12 })], 2026).motif)
      .toBe('les opérations du 05/05/2026 ne se retrouvent pas dans le total que la base a compté')
    // Un solde qui ne se recompose pas.
    const faux = jours.map((j) => (j.jour === '2026-03-25' ? { ...j, solde: j.solde + 1 } : j))
    expect(caisseRejouee(faux, ops, 2026).motif).toBe('le solde du 25/03/2026 ne se recompose pas')
    // Une opération retirée ne compte pas.
    expect(caisseRejouee(jours, ops.map((o) => (o.id === 'o4' ? { ...o, retire_le: null } : o)), 2026).motif).not.toBeNull()
  })

  it('dit l’année figée d’après les jours lus, ou ne dit rien', () => {
    expect(anneeFigee([jour({ jour: '2025-06-03', fige: true }), jour({ jour: '2026-03-12' })], 2025)).toBe(true)
    // Un jour figé d'une année suivante fige celle-ci : la frontière est un 31 décembre.
    expect(anneeFigee([jour({ jour: '2026-03-12', fige: true })], 2025)).toBe(true)
    expect(anneeFigee([jour({ jour: '2026-03-12', fige: false })], 2026)).toBe(false)
    // Rien de lu de l'année, et rien de figé après : la base en juge seule.
    expect(anneeFigee([jour({ jour: '2026-03-12', fige: false })], 2025)).toBeNull()
    expect(anneeFigee([], 2026)).toBeNull()
  })
})

describe('la caisse rejouée juge comme la caisse entière', () => {
  const formulaire = (genre: 'recette' | 'apport' | 'prelevement', date: string, montant: string) => ({ genre, date, montant })

  it('sur des cas écrits : la recette, le prélèvement qui viderait la caisse, la date à venir, le montant', () => {
    const etat = caisseFictive()
    const synth = rejoue(etat, 2026)
    const jours = caisseDuClientSimulee(etat, 2026)
    const cas: [ReturnType<typeof formulaire>, string | null][] = [
      [formulaire('recette', '2026-04-02', '50'), null],
      [formulaire('prelevement', '2026-03-12', '500'), 'Ce prélèvement de 500,00 € rendrait la caisse négative le 12/03/2026 (−310,00 €) : saisis d’abord les recettes en espèces qui le précèdent.'],
      [formulaire('apport', '2026-12-01', '10'), 'Une opération de caisse ne se date pas dans l’avenir : nous sommes le 02/11/2026.'],
      [formulaire('recette', '2026-03-12', '10,005'), MOTS_DE_LA_CAISSE.montant_centime.gabarit],
      [formulaire('apport', '2026-03-12', '-5'), MOTS_DE_LA_CAISSE.montant_negatif.gabarit],
      [formulaire('recette', '2026-03-12', '0'), MOTS_DE_LA_CAISSE.montant_nul.gabarit],
    ]
    for (const [f, attendu] of cas) {
      const v = verdictDuFormulaire(f, 2026, jours, synth, null)
      const reel = jugerLaSaisie({ ...saisieDuFormulaire(f, jours), encaissements_du_jour: f.genre === 'recette' ? ensembleDuJour(etat, f.date) : null },
        dossierReel(etat), false, 'saisie')
      expect(v.etat === 'refuse' ? v.message.replace(/'/g, '’') : null, JSON.stringify(f)).toBe(attendu?.replace(/'/g, '’') ?? null)
      expect(v.etat === 'refuse' ? v.message : null).toBe(reel.refus?.message ?? null)
    }
    // Permis : la recette du 2 avril reconnaît les espèces de ce jour, et la caisse passe à 50 € de plus.
    const v = verdictDuFormulaire(formulaire('recette', '2026-04-02', '50'), 2026, jours, synth, null)
    expect(v.etat).toBe('permis')
    if (v.etat !== 'permis') return
    expect(v.saisie).toEqual({ genre: 'recette', date: '2026-04-02', montant: 50, categorie_id: null, taux_tva: null, encaissements_du_jour: ['e1', 'o6'], ecritures: null })
    expect(v.soldeApres).toBe(soldeAuJour(etat, '2026-04-02') + 5000)
  })

  it('refuse une date hors de l’année affichée, et ne juge rien sur rien de tapé', () => {
    const etat = caisseFictive()
    const synth = rejoue(etat, 2026)
    const jours = caisseDuClientSimulee(etat, 2026)
    expect(verdictDuFormulaire(formulaire('recette', '2025-12-31', '10'), 2026, jours, synth, null))
      .toMatchObject({ etat: 'refuse', message: horsDeLAnnee(2026) })
    expect(verdictDuFormulaire(formulaire('recette', '', '10'), 2026, jours, synth, null)).toEqual({ etat: 'vide' })
    expect(verdictDuFormulaire(formulaire('recette', '2026-03-12', '  '), 2026, jours, synth, null)).toEqual({ etat: 'vide' })
    expect(verdictDuFormulaire(formulaire('recette', '2026-03-12', 'douze'), 2026, jours, synth, null).etat).toBe('illisible')
  })

  it('sur une batterie tirée : chaque saisie, chaque retrait, chaque correction, le même refus et le même solde', () => {
    const t = tirage(20261102)
    const entier = (n: number) => entierTire(t, n)
    const jourTire = (annee: number) => {
      const max = annee === 2026 ? 306 : 365
      const d = new Date(Date.UTC(annee, 0, 1 + entier(max)))
      return d.toISOString().slice(0, 10)
    }
    let comparees = 0
    let refusees = 0
    let negatives = 0
    for (let n = 0; n < 60; n++) {
      // Une caisse : une ouverture (ou aucune), des opérations du client et du cabinet, des retirées, des versements, des
      // retraits au distributeur, des espèces de factures, des paiements de pièces de vente.
      const operations: OperationDeLaCaisse[] = []
      for (let i = 0; i < 2 + entier(12); i++) {
        const genre = (['recette', 'recette', 'apport', 'prelevement', 'paiement'] as const)[entier(5)]
        const annee = entier(3) === 0 ? 2025 : 2026
        operations.push(operation({
          id: `o${n}-${i}`, genre, date: jourTire(annee), montant: (genre === 'recette' && entier(6) === 0 ? -1 : 1) * (1 + entier(30000)) / 100,
          categorie_id: genre === 'recette' ? NATURE : null, piece_id: genre === 'paiement' ? (entier(2) ? 'p-vente' : 'p-achat') : null,
          origine: entier(3) === 0 ? 'cabinet' : 'client', cree_par: entier(3) === 0 ? 'u-cabinet' : entier(5) === 0 ? 'u-autre' : MOI,
          retire_le: entier(6) === 0 ? '2026-10-01T08:00:00Z' : null, cree_le: `2026-0${1 + entier(9)}-01T08:00:00Z`,
        }))
      }
      const etat: EtatDeLaCaisse = {
        compteCaisse: CAISSE,
        ouvertures: entier(2) ? [{ date: '2025-01-01', compte: CAISSE, sens: 'debit', montant: entier(50000) / 100 }] : [],
        operations,
        mouvements: Array.from({ length: entier(4) }, (_, i) => ({
          id: `m${n}-${i}`, date: jourTire(entier(2) ? 2026 : 2025), montant: (entier(3) === 0 ? -1 : 1) * (1 + entier(20000)) / 100,
          compte_bilan: entier(4) ? CAISSE : '580000',
        })),
        encaissements: Array.from({ length: entier(4) }, (_, i) => ({
          id: `e${n}-${i}`, facture_id: entier(2) ? 'f-source' : 'f-avant', date_encaissement: jourTire(2026), montant: (1 + entier(20000)) / 100,
          moyen: entier(4) ? 'especes' as const : 'cheque' as const, ligne_bancaire_id: entier(5) === 0 ? 'm-x' : null, annule_id: null, retire_le: null,
        })),
        factures: [{ id: 'f-source', numero: 'F2026-0007', source_de_la_vente: true }, { id: 'f-avant', numero: 'F2025-0009', source_de_la_vente: false }],
        piecesDeVente: ['p-vente'],
      }
      // La base garde la caisse jamais négative : une caisse tirée qui le serait reçoit, au premier jour, l'apport qui manque.
      const plusBas = Math.min(0, ...soldesDeLaCaisse(etat).map((x) => x.centimes))
      if (plusBas < 0) {
        operations.push(operation({ id: `o${n}-apport`, genre: 'apport', date: '2025-01-01', montant: -plusBas / 100, categorie_id: null, origine: 'cabinet', cree_par: 'u-cabinet' }))
      }
      expect(soldesDeLaCaisse(etat).every((x) => x.centimes >= 0)).toBe(true)
      for (const annee of [2025, 2026]) {
        const jours = [annee, 2026].filter((a, i, l) => l.indexOf(a) === i).flatMap((a) => caisseDuClientSimulee(etat, a))
        const synth = rejoue(etat, annee)
        const reel = dossierReel(etat)
        // Les saisies.
        for (let k = 0; k < 8; k++) {
          const genre = GENRES_DU_CLIENT[entier(3)].genre
          const montant = ['0', '10,005', '-3', String((1 + entier(80000)) / 100).replace('.', ',')][entier(8) < 5 ? 3 : entier(3)]
          const f = formulaire(genre, jourTire(annee), montant)
          const v = verdictDuFormulaire(f, annee, jours, synth, null)
          const saisie: SaisieDeCaisse = { ...saisieDuFormulaire(f, jours), encaissements_du_jour: genre === 'recette' ? ensembleDuJour(etat, f.date) : null }
          const juge = jugerLaSaisie(saisie, reel, false, 'saisie')
          expect(v.etat === 'refuse' ? v.message : null, `${n} ${JSON.stringify(f)}`).toBe(juge.refus?.message ?? null)
          if (v.etat === 'permis' && !juge.refus) expect(v.soldeApres).toBe(soldeAuJour(juge.caisse, f.date))
          comparees++
          if (v.etat === 'refuse') refusees++
          if (v.etat === 'refuse' && v.message.includes('négative')) negatives++
        }
        // Les retraits et les corrections : chaque opération de l'année.
        for (const o of operations.filter((x) => x.date >= `${annee}-01-01`)) {
          expect(refusDuRetraitDuClient(o.id, synth), `retrait ${o.id}`).toBe(jugerLeRetrait(o.id, reel, 'maintenant').refus?.message ?? null)
          const f = formulaire(GENRES_DU_CLIENT[entier(3)].genre, jourTire(annee), String((1 + entier(40000)) / 100).replace('.', ','))
          const v = verdictDuFormulaire(f, annee, jours, synth, o.id)
          const saisie: SaisieDeCaisse = { ...saisieDuFormulaire(f, jours), encaissements_du_jour: f.genre === 'recette' ? ensembleDuJour(etat, f.date) : null }
          const juge = jugerLeRemplacement(o.id, saisie, reel, 'maintenant', 'saisie')
          expect(v.etat === 'refuse' ? v.message : null, `correction ${o.id} ${JSON.stringify(f)}`).toBe(juge.refus?.message ?? null)
          if (v.etat === 'permis' && !juge.refus) expect(v.soldeApres).toBe(soldeAuJour(juge.caisse, f.date))
          comparees++
        }
      }
    }
    // Les témoins : la batterie touche chaque issue.
    expect(comparees).toBeGreaterThan(1000)
    expect(refusees).toBeGreaterThan(100)
    expect(negatives).toBeGreaterThan(5)
  })
})

describe('les mots et le mois', () => {
  const etat = caisseFictive()
  const jours = caisseDuClientSimulee(etat, 2026)
  const ops = etat.operations as OperationDuClient[]

  it('nomme une opération sans sa nature, et dit qui l’a saisie', () => {
    expect(nomPourLeClient(ops[1])).toMatch(/^la recette du 12\/03\/2026 de 100,00\s€$/)
    expect(auteurPourLeClient(ops[1], MOI)).toBe('saisie par toi')
    expect(auteurPourLeClient(ops[2], MOI)).toBe('saisie par ton cabinet')
    expect(auteurPourLeClient({ origine: 'client', cree_par: 'u-autre' }, MOI)).toBe('saisie depuis un autre accès')
    expect(corrigeableParLeClient(ops[1], MOI)).toBe(true)
    expect(corrigeableParLeClient(ops[2], MOI)).toBe(false)
    expect(corrigeableParLeClient(ops[3], MOI)).toBe(false)
    expect(corrigeableParLeClient(operation({ cree_par: 'u-autre' }), MOI)).toBe(false)
    expect(corrigeableParLeClient(operation({ genre: 'paiement' }), MOI)).toBe(false)
  })

  it('confirme en nommant ce qui part, et ce que devient la caisse du jour', () => {
    const synth = rejoue(etat, 2026)
    const v = verdictDuFormulaire({ genre: 'recette', date: '2026-03-12', montant: '20' }, 2026, jours, synth, null)
    if (v.etat !== 'permis') throw new Error('permis attendu')
    expect(confirmationDeLaSaisie(v.saisie, v.soldeApres)).toMatch(/^Enregistrer une recette du 12\/03\/2026 de 20,00\s€ \? Ta caisse du 12\/03\/2026 passera à 210,00\s€\./)
    const c = verdictDuFormulaire({ genre: 'recette', date: '2026-03-12', montant: '90' }, 2026, jours, synth, 'o2')
    if (c.etat !== 'permis') throw new Error('permis attendu')
    expect(confirmationDeLaCorrection(ops[1], c.saisie, c.soldeApres))
      .toMatch(/^Remplacer la recette du 12\/03\/2026 de 100,00\s€ par une recette du 12\/03\/2026 de 90,00\s€ \? .* passera à 180,00\s€\.$/)
    expect(confirmationDuRetrait(ops[1], synth.caisse)).toMatch(/^Retirer la recette du 12\/03\/2026 de 100,00\s€ \? .* passera à 90,00\s€\.$/)
  })

  it('range le mois jour par jour, sous le solde lu', () => {
    const mars = joursDuMois(jours, ops, '2026-03')
    expect(mars.map((j) => j.jour)).toEqual(['2026-03-12', '2026-03-20', '2026-03-25'])
    expect(mars[0].lignes.map((l) => (l.nature === 'operation' ? l.operation.id : l.nature))).toEqual(['o2', 'o3'])
    expect(mars[0].lignes.map((l) => l.centimes)).toEqual([10000, -3000])
    expect(mars[2].lignes).toEqual([{ nature: 'releve', centimes: -15000 }])
    expect(mars.map((j) => j.solde)).toEqual([19000, 24500, 9500])
    expect(joursDuMois(jours, ops, '2026-01')[0].lignes).toEqual([{ nature: 'report', centimes: 12000 }])
    expect(joursDuMois(jours, ops, '2026-04')[0].lignes.map((l) => l.nature)).toEqual(['operation', 'especes'])
    expect(soldeLuAu(jours, '2026-03-31')).toBe(9500)
    expect(soldeLuAu(jours, '2025-12-31')).toBe(0)
    expect(retireesDuMois(ops, '2026-03').map((o) => o.id)).toEqual(['o4'])
    expect(devenirDeLaRetiree(ops[3], ops)).toMatch(/^remplacée par une recette du 20\/03\/2026 de 55,00/)
  })

  it('ne dit aucune forme du cabinet', () => {
    const textes = [
      RAPPEL_DU_BROUILLARD, horsDeLAnnee(2026), ...GENRES_DU_CLIENT.map((g) => g.libelle),
      ...(['report', 'ouverture', 'releve', 'especes'] as const).flatMap((nature) => [-1, 1].map((s) => libelleDeLaLigne({ nature, centimes: s }, '2026-01-01'))),
      ...Object.keys(MOTS_DE_LA_CAISSE).map((k) => refus(k as keyof typeof MOTS_DE_LA_CAISSE, 'x', 'y').message),
    ]
    for (const t of textes) expect(motsDuCabinet(t), t).toEqual([])
  })
})
