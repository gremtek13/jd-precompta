import { referenceDuReleve } from './affectationBanque'
import { auxiliaireDuTiers, type CompteAuxiliaire } from './engagement'
import { centimesExacts, ecartDeFrais, justifieSonMouvement } from './encaissementsFactures'
import type { PlanComptable } from './planComptable'
import type { EcritureBrouillon, JournalCode, LigneBancaire, ModeComptable, SensEcriture } from './types'
import {
  regimeDeLaFacture, ventesFacturees, type EncaissementVendu, type FactureVendue, type SourcesVentesFacturees,
  type VentesFacturees,
} from './ventesFacturees'

// LES ÉCRITURES D'UNE VENTE FACTURÉE, COMPOSÉES (ligne 28.6, chantier EC-Q3, étape VF4a ; conception : HISTORIQUE.md,
// « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, § 6, § 7 et § 12). Un module PUR — il ne lit rien en
// base, n'appelle personne, ne lit pas l'horloge, ne connaît aucun écran — qui part des MÊMES lignes que le module des
// ventes facturées (lib/ventesFacturees.ts : les factures et avoirs sources, leurs lignes, le registre des encaissements
// et ses parts par taux), des mouvements que ces encaissements citent, du compte de contrepartie qu'un encaissement par
// compensation a reçu, du modèle comptable et du plan du dossier ; et qui rend, pour chaque SOURCE, les écritures qu'elle
// porte, ou la raison pour laquelle elle n'en porte pas encore. RIEN NE LE LIT HORS DE SES TESTS : l'étape VF4b écrira les
// fonctions qui vérifient et remplacent ces écritures en base (`ecrire_vente_facturee`, `retirer_ecriture_vente_facturee`),
// l'étape VF4c l'onglet Écritures, le FEC, la piste d'audit, le lettrage et la concordance.
//
// ── CE QUI S'ÉCRIT (§ 5), en centimes entiers ───────────────────────────────────────────────────────────────────────────
//
// p, v et h : le TTC d'une part d'un encaissement à un taux (le registre), sa TVA par la règle du cumul, et p − v — TELS
// QUE LE MODULE DES VENTES FACTURÉES LES REND (`ventesFacturees`), jamais recalculés ici : la CA3 et les écritures sortent
// du même calcul, et la liquidation de la TVA reste juste (§ 6, dernier point). La règle du cumul est une question
// ouverte (VF3-Q1) : changée là, elle changerait ici d'elle-même.
//
// [T], le compte de trésorerie de l'encaissement (EC3-Q7, tranché le 19/10/2026 : le chèque au 511 à sa remise, les
// espèces au 53) :
//   - il cite un mouvement DU MÊME JOUR : la banque (le 512 du plan), qui porte le mouvement ;
//   - il cite un mouvement d'un autre jour, ou n'en cite pas encore : les valeurs à l'encaissement (511) — la caisse (53)
//     pour des espèces ;
//   - par compensation, ou par un autre moyen sans mouvement : le compte de bilan que le cabinet a choisi pour lui, comme
//     pour un mouvement écrit sur un compte de bilan (ligne 26.7) ; tant qu'il n'est pas choisi, l'encaissement ne
//     s'écrit pas, et la raison se dit ;
//   - une contre-passation qui ne cite pas de mouvement défait son encaissement là où il a été écrit : elle prend le [T]
//     de l'encaissement qu'elle annule. Celle qui cite le DÉBIT qui a défait l'argent (le chèque revenu impayé) prend les
//     règles d'un mouvement, comme un encaissement.
// Le compte du produit suit la nature que la facture a figée : 706 (`prestations_de_services`) pour des services, 707
// (`ventes_de_biens`) pour des biens. Chaque compte est celui du PLAN du dossier, jamais un numéro écrit ici.
//
// EN TRÉSORERIE :
//   - la facture : rien, une recette n'existe qu'encaissée — sauf la TVA due avant l'encaissement (des biens, ou des
//     services sur l'option pour les débits) : le 411 au débit, le 44571 au crédit, à la date où elle est exigible ;
//   - l'avoir : l'inverse, à sa date ; pour des services, rien ;
//   - l'encaissement, à sa date : [T] au débit (p), le produit au crédit (h), le 44571 au crédit (v) — ou le 411 quand la
//     TVA était déjà due (un bien livré, une facture sur les débits), qu'il solde ;
//   - la contre-passation : l'inverse de son encaissement, à sa date.
// EN ENGAGEMENT :
//   - la facture, à sa date d'émission (EC3-Q12) : le 411 au débit (TTC), le produit au crédit (HT, par taux), la TVA au
//     44571 quand elle est due ce jour-là (un bien livré ce jour, une facture sur les débits), au compte de la TVA en
//     attente sinon (445800, EC3-Q6) ;
//   - l'avoir : l'inverse de l'écriture de sa facture, à sa date ;
//   - l'encaissement, à sa date : [T] au débit, le 411 au crédit (p) ; et, quand sa TVA devient exigible avec lui (des
//     services ; l'acompte d'un bien avant sa livraison), elle passe de la TVA en attente au 44571 (v) ;
//   - la contre-passation : l'inverse de son encaissement, à sa date.
// LE MOUVEMENT QUE DES ENCAISSEMENTS CITENT, classé par eux (G1), à sa date : la banque au débit de ce que les
// encaissements du même jour n'ont pas porté ; au crédit, le 511 (ou le 53) de ceux d'un autre jour, qui y étaient passés ;
// le 627 (`services_bancaires`) de l'écart des frais, sous le seuil min(2 %, 5 €) d'alignementBanque.ts que le registre
// tient (`ecartDeFrais`) ; rien quand tout est du même jour et sans écart. Le 512 d'un mouvement fait exactement son
// montant ; pour un débit (une contre-passation qui cite le mouvement qui a défait l'argent), les sens s'inversent.
//
// LA TVA ÉCRITE AU 44571 EST EXACTEMENT CELLE QUE LA CA3 COMPTE, à sa date : ce module ne décide pas où une TVA est
// exigible, il lit les EXIGIBILITÉS du module des ventes facturées. Une part dont le module fait une exigibilité
// « encaissement » passe au 44571 avec son encaissement ; une exigibilité de la livraison, de la facture sur les débits ou
// d'un avoir d'après passe au 44571 à SA date — en trésorerie face au 411, en engagement depuis la TVA en attente, dans
// l'écriture du document quand elle est du même jour, dans une écriture à elle sinon (la livraison d'un bien datée
// autrement que sa facture). Un avoir daté au plus tard de la livraison est déjà déduit de la TVA de la livraison (§ 6) :
// en trésorerie, il n'a pas d'écriture à lui.
//
// LE FEC (§ 5) : la facture, l'avoir et l'encaissement de trésorerie au journal des ventes (VE) ; l'encaissement
// d'engagement — un règlement — et le mouvement au journal de banque (BQ). PieceRef : le numéro de la facture (de l'avoir
// pour son écriture), le relevé pour un mouvement (`referenceDuReleve`) ; PieceDate : la date d'émission du document, celle
// du mouvement. L'auxiliaire du 411, celui d'une pièce de vente : « C » et la clé du nom du client (`auxiliaireDuTiers`) —
// un client ne change pas de compte à la bascule. Les clés que l'étape VF4c donnera à la numérotation du FEC
// (`numeroterFec`) sont celles d'ici : `facture|<facture ou avoir>|<date>`, `encaissement|<encaissement>|<date>`,
// `mouvement-encaissements|<mouvement>` — une écriture, une date (LPF, art. A47 A-1).
//
// CE QUE LA BASE VÉRIFIERA (VF4b, G5) : chaque écriture porte sa SOURCE — `facture_id` (la facture ou l'avoir),
// `encaissement_id`, ou, pour un mouvement, le seul `ligne_bancaire_id` de ses lignes — et se recompose à l'identique
// depuis les lignes de la base qu'elle cite : la composition ne dépend que d'elles, du compte de contrepartie et du plan.
// `lignesAuBrouillon` rend ce que la fonction écrira, `memeEcritureQueLeBrouillon` ce qu'elle comparera.

// ── Ce que le module lit, en plus des sources des ventes facturées ──────────────────────────────────────────────────────

/** Un mouvement du relevé, tel que l'écriture d'un encaissement et celle du mouvement le lisent. */
export type MouvementDesEncaissements = Pick<
  LigneBancaire, 'id' | 'dossier_id' | 'date' | 'montant' | 'libelle' | 'source_fichier' | 'encaissements_de_factures'
>

export interface EntreesEcrituresVentes {
  /** Les lignes que la lecture des ventes facturées a rendues, EN ENTIER (lib/ventesFactureesLecture.ts). */
  sources: SourcesVentesFacturees
  /** Les mouvements que les encaissements citent — d'autres peuvent y être, seuls ceux-là comptent. */
  mouvements: readonly MouvementDesEncaissements[]
  /** Le compte de bilan choisi pour un encaissement par compensation (ou par un autre moyen sans mouvement), par
   *  l'identifiant de l'encaissement. Où la base le gardera est une question de VF4b. */
  comptesDeContrepartie: ReadonlyMap<string, string>
  /** Le modèle comptable du dossier, sans valeur par défaut. */
  mode: ModeComptable
  /** Le plan du dossier (lib/planComptable.ts) : chaque compte y est pris. */
  plan: PlanComptable
}

// ── Ce que le module rend ──────────────────────────────────────────────────────────────────────────────────────────────

/** La source d'une écriture : ce que la base liera à elle, et ce que la fonction de VF4b remplacera d'un tenant. */
export type SourceEcritureVente =
  | { genre: 'facture'; factureId: string }
  | { genre: 'avoir'; factureId: string }
  | { genre: 'encaissement'; encaissementId: string; factureId: string }
  | { genre: 'mouvement'; ligneBancaireId: string }

export interface LigneVenteFacturee {
  compte: string
  sens: SensEcriture
  /** Positif, en centimes entiers. */
  centimes: number
  /** Le mouvement que la ligne porte : la banque d'un encaissement du même jour, chaque ligne d'un mouvement. */
  ligneBancaireId: string | null
}

export interface EcritureVenteFacturee {
  source: SourceEcritureVente
  /** La clé de l'écriture dans le FEC (VF4c) : une source, une date. */
  cle: string
  date: string
  journal: Extract<JournalCode, 'VE' | 'BQ'>
  pieceRef: string
  pieceDate: string
  libelle: string
  /** Le nom du client, d'où vient l'auxiliaire du 411 ; nul pour un mouvement. */
  tiers: string | null
  /** Triées par compte, sens et mouvement ; équilibrées ; aucune nulle. */
  lignes: LigneVenteFacturee[]
}

export type MotifNonEcrite =
  | 'vente_ecartee' | 'mouvement_inconnu' | 'compte_a_choisir' | 'compte_refuse' | 'mouvement_non_classe'
  | 'mouvement_facture_non_source' | 'mouvement_vente_ecartee' | 'mouvement_ecart'

export const LIBELLE_MOTIF_NON_ECRITE: Readonly<Record<MotifNonEcrite, string>> = {
  vente_ecartee: 'le module des ventes facturées écarte la facture : elle ne se compte pas, elle ne s’écrit pas',
  mouvement_inconnu: 'l’encaissement cite un mouvement qui n’a pas été lu : on ne sait pas s’il est du même jour',
  compte_a_choisir: 'un encaissement par compensation, ou par un autre moyen sans mouvement, s’écrit sur un compte de bilan que le cabinet choisit, et il n’est pas encore choisi',
  compte_refuse: 'le compte de contrepartie choisi ne peut pas recevoir cet encaissement',
  mouvement_non_classe: 'le mouvement n’est pas encore classé par ses encaissements : son écriture attend ce classement',
  mouvement_facture_non_source: 'le mouvement porte aussi l’encaissement d’une facture qui n’est pas source de sa vente : comment il s’écrit reste à concevoir (VF2-Q2)',
  mouvement_vente_ecartee: 'le mouvement porte l’encaissement d’une facture que le module écarte',
  mouvement_ecart: 'les encaissements qu’il porte ne font pas le mouvement à l’écart des frais près',
}

/** Une source qui ne s'écrit pas (encore), et pourquoi : comme `ecrituresSansObjet` le dit d'une pièce. */
export interface SourceNonEcrite {
  source: SourceEcritureVente
  motif: MotifNonEcrite
  detail: string
}

export interface EcrituresDesVentesFacturees {
  dossierId: string
  /** Par date, puis par clé. */
  ecritures: EcritureVenteFacturee[]
  nonEcrites: SourceNonEcrite[]
  /** Le calcul des ventes facturées dont ces écritures portent les montants. */
  ventes: VentesFacturees
}

// ── Les clés du FEC (VF4c) ─────────────────────────────────────────────────────────────────────────────────────────────

export const cleFecFacture = (factureId: string, date: string) => `facture|${factureId}|${date}`
export const cleFecEncaissement = (encaissementId: string, date: string) => `encaissement|${encaissementId}|${date}`
export const cleFecMouvementEncaissements = (ligneBancaireId: string) => `mouvement-encaissements|${ligneBancaireId}`

// ── Les refus d'un compte de contrepartie ──────────────────────────────────────────────────────────────────────────────

/**
 * Pourquoi ce compte ne peut pas être la contrepartie d'un encaissement par compensation, nul quand il le peut. Une
 * HYPOTHÈSE de VF4a, à reprendre avec l'écran qui le fera choisir (VF5) et la base qui le gardera (VF4b) : un compte de
 * bilan (classe 1 à 5) sous la forme des comptes de l'application ; ni le compte des clients, que l'encaissement solde ;
 * ni un compte de trésorerie du plan, qu'un moyen de paiement choisit déjà ; ni un compte de TVA.
 */
export function refusCompteDeContrepartie(compte: string, plan: PlanComptable): string | null {
  if (!/^[1-5][0-9]{5,9}$/.test(compte)) return 'Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.'
  if (compte === plan.clients) return 'Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.'
  if ([plan.banque, plan.valeurs_a_l_encaissement, plan.caisse].includes(compte)) {
    return 'Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.'
  }
  if (compte.startsWith('445')) return 'Un compte de TVA ne reçoit pas un encaissement : la TVA d’une vente s’écrit avec elle.'
  return null
}

// ── La composition ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Les montants d'une écriture, signés (positif au débit), par compte et par mouvement : la somme des montants d'une même
// clé fait une ligne, et une ligne nulle disparaît. Rendue triée : la même écriture rend toujours les mêmes lignes.
class Solde {
  private readonly parCle = new Map<string, { compte: string; ligneBancaireId: string | null; centimes: number }>()

  ajouter(compte: string, centimes: number, ligneBancaireId: string | null = null): this {
    const cle = `${compte}|${ligneBancaireId ?? ''}`
    const actuel = this.parCle.get(cle) ?? { compte, ligneBancaireId, centimes: 0 }
    actuel.centimes += centimes
    this.parCle.set(cle, actuel)
    return this
  }

  lignes(): LigneVenteFacturee[] {
    return [...this.parCle.values()]
      .filter((l) => l.centimes !== 0)
      .map((l) => ({ compte: l.compte, sens: l.centimes > 0 ? 'debit' as const : 'credit' as const, centimes: Math.abs(l.centimes), ligneBancaireId: l.ligneBancaireId }))
      .sort(ordreDesLignes)
  }
}

function ordreC(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** L'ordre des lignes d'une écriture : compte, débit avant crédit, mouvement. */
export function ordreDesLignes(a: LigneVenteFacturee, b: LigneVenteFacturee): number {
  return ordreC(a.compte, b.compte) || (a.sens === b.sens ? 0 : a.sens === 'debit' ? -1 : 1)
    || ordreC(a.ligneBancaireId ?? '', b.ligneBancaireId ?? '')
}

type Tresorerie = { compte: string; ligneBancaireId: string | null } | { refus: MotifNonEcrite; detail: string }

const nommer = (f: Pick<FactureVendue, 'numero' | 'id'>) => f.numero ?? f.id.slice(0, 8)

/**
 * Les écritures des ventes facturées d'un dossier, et ce qui ne s'en écrit pas. Pur et déterministe : les mêmes lignes
 * rendent les mêmes écritures, dans le même ordre, quel que soit l'ordre de leur lecture.
 */
export function ecrituresDesVentesFacturees(entrees: EntreesEcrituresVentes): EcrituresDesVentesFacturees {
  const { sources, mode, plan } = entrees
  const dossierId = sources.dossierId
  const ventes = ventesFacturees(sources)
  const nonEcrites: SourceNonEcrite[] = []
  const nonEcrite = (source: SourceEcritureVente, motif: MotifNonEcrite, precision?: string) =>
    nonEcrites.push({ source, motif, detail: precision ? `${LIBELLE_MOTIF_NON_ECRITE[motif]} (${precision})` : LIBELLE_MOTIF_NON_ECRITE[motif] })

  const factures = new Map(sources.factures
    .filter((f) => f.dossier_id === dossierId && ventes.sources.has(f.id))
    .map((f) => [f.id, f]))
  const ecartees = new Set(ventes.ecartees.map((e) => e.factureId))
  const encaissements = sources.encaissements.filter((e) => e.dossier_id === dossierId)
  const encaissementParId = new Map(encaissements.map((e) => [e.id, e]))
  const mouvements = new Map(entrees.mouvements.filter((m) => m.dossier_id === dossierId).map((m) => [m.id, m]))
  const produitDe = (f: FactureVendue) => (regimeDeLaFacture(f) === 'livraison' ? plan.ventes_de_biens : plan.prestations_de_services)

  // Les écritures en cours, par clé : une source et une date.
  const enCours = new Map<string, { ecriture: Omit<EcritureVenteFacturee, 'lignes'>; solde: Solde }>()
  const ecriture = (e: Omit<EcritureVenteFacturee, 'lignes'>) => {
    let x = enCours.get(e.cle)
    if (!x) {
      x = { ecriture: e, solde: new Solde() }
      enCours.set(e.cle, x)
    }
    return x.solde
  }

  for (const e of ventes.ecartees) nonEcrite({ genre: 'facture', factureId: e.factureId }, 'vente_ecartee', e.detail)

  // [T] : le compte de trésorerie d'un encaissement (EC3-Q7).
  const tresorerieDe = (e: EncaissementVendu, profondeur = 0): Tresorerie => {
    if (e.annule_id != null && e.ligne_bancaire_id == null) {
      const original = encaissementParId.get(e.annule_id)
      // Le module des ventes facturées écarte déjà une contre-passation sans original lisible : défensif.
      if (!original || profondeur > 0) return { refus: 'vente_ecartee', detail: 'contre-passation sans son encaissement' }
      return tresorerieDe(original, profondeur + 1)
    }
    if (e.ligne_bancaire_id != null) {
      const m = mouvements.get(e.ligne_bancaire_id)
      if (!m) return { refus: 'mouvement_inconnu', detail: `encaissement du ${e.date_encaissement}` }
      if (m.date === e.date_encaissement) return { compte: plan.banque, ligneBancaireId: m.id }
      return { compte: e.moyen === 'especes' ? plan.caisse : plan.valeurs_a_l_encaissement, ligneBancaireId: null }
    }
    if (e.moyen === 'especes') return { compte: plan.caisse, ligneBancaireId: null }
    if (e.moyen === 'compensation' || e.moyen === 'autre') {
      const choisi = entrees.comptesDeContrepartie.get(e.id)
      if (choisi == null) return { refus: 'compte_a_choisir', detail: `encaissement du ${e.date_encaissement}` }
      const refus = refusCompteDeContrepartie(choisi, plan)
      if (refus) return { refus: 'compte_refuse', detail: `${choisi} : ${refus}` }
      return { compte: choisi, ligneBancaireId: null }
    }
    return { compte: plan.valeurs_a_l_encaissement, ligneBancaireId: null }
  }

  // ── Les encaissements et les contre-passations ──
  const exigiblesALEncaissement = new Set(ventes.exigibilites
    .filter((x) => x.origine === 'encaissement').map((x) => `${x.encaissementId}|${x.taux}`))
  const tresoreries = new Map<string, Tresorerie>()
  for (const p of ventes.parts) {
    const f = factures.get(p.factureId)!
    const e = encaissementParId.get(p.encaissementId)!
    let t = tresoreries.get(e.id)
    if (!t) {
      t = tresorerieDe(e)
      tresoreries.set(e.id, t)
      if ('refus' in t) nonEcrite({ genre: 'encaissement', encaissementId: e.id, factureId: f.id }, t.refus, t.detail)
    }
    if ('refus' in t) continue
    const solde = ecriture({
      source: { genre: 'encaissement', encaissementId: e.id, factureId: f.id }, cle: cleFecEncaissement(e.id, p.date),
      date: p.date, journal: mode === 'tresorerie' ? 'VE' : 'BQ', pieceRef: nommer(f), pieceDate: f.date_emission,
      libelle: `${e.annule_id == null ? 'Encaissement' : 'Contre-passation'}, facture ${nommer(f)} — ${f.tiers_nom}`,
      tiers: f.tiers_nom,
    })
    const exigible = exigiblesALEncaissement.has(`${e.id}|${p.taux}`)
    solde.ajouter(t.compte, p.ttcCentimes, t.ligneBancaireId)
    if (mode === 'tresorerie') {
      solde.ajouter(produitDe(f), -p.htCentimes)
      solde.ajouter(exigible ? plan.tva_collectee : plan.clients, -p.tvaCentimes)
    } else {
      solde.ajouter(plan.clients, -p.ttcCentimes)
      if (exigible) solde.ajouter(plan.tva_collectee_en_attente, p.tvaCentimes).ajouter(plan.tva_collectee, -p.tvaCentimes)
    }
  }

  // ── La facture, l'avoir, et la TVA due avant l'encaissement ──
  const documentDe = (factureId: string, avoirId: string | null, date: string) => {
    const f = factures.get(factureId)!
    const doc = avoirId == null ? f : factures.get(avoirId)!
    const source: SourceEcritureVente = avoirId == null ? { genre: 'facture', factureId } : { genre: 'avoir', factureId: avoirId }
    return ecriture({
      source, cle: cleFecFacture(doc.id, date), date, journal: 'VE', pieceRef: nommer(doc), pieceDate: doc.date_emission,
      libelle: `${avoirId == null ? 'Facture' : 'Avoir'} ${nommer(doc)} — ${f.tiers_nom}`, tiers: f.tiers_nom,
    })
  }
  if (mode === 'engagement') {
    for (const d of ventes.documents) {
      const f = factures.get(d.factureId)!
      documentDe(d.factureId, d.avoirId, d.date)
        .ajouter(plan.clients, d.ttcCentimes)
        .ajouter(produitDe(f), -d.baseCentimes)
        .ajouter(plan.tva_collectee_en_attente, -d.tvaCentimes)
    }
  }
  for (const x of ventes.exigibilites) {
    if (x.origine === 'encaissement') continue
    const solde = documentDe(x.factureId, x.origine === 'avoir' ? x.avoirId : null, x.date)
    solde.ajouter(mode === 'tresorerie' ? plan.clients : plan.tva_collectee_en_attente, x.tvaCentimes)
    solde.ajouter(plan.tva_collectee, -x.tvaCentimes)
  }

  // ── Les mouvements que des encaissements citent ──
  for (const m of [...mouvements.values()].sort((a, b) => ordreC(a.id, b.id))) {
    const citants = encaissements.filter((e) => e.ligne_bancaire_id === m.id && e.retire_le == null)
    // Ce qu'il justifie (`encaissement_justifie_son_mouvement`) : un encaissement qu'aucune contre-passation vivante sans
    // mouvement n'annule — la porte du classement (lib/encaissementsFactures.ts, `refusClassement`).
    const justifies = citants.filter((e) => justifieSonMouvement(e, encaissements))
    if (!justifies.some((e) => factures.has(e.facture_id))) continue
    const source: SourceEcritureVente = { genre: 'mouvement', ligneBancaireId: m.id }
    if (justifies.some((e) => !factures.has(e.facture_id))) {
      nonEcrite(source, 'mouvement_facture_non_source')
      continue
    }
    if (justifies.some((e) => ecartees.has(e.facture_id))) {
      nonEcrite(source, 'mouvement_vente_ecartee')
      continue
    }
    const montant = centimesExacts(m.montant)
    const total = justifies.reduce((s, e) => s + (centimesExacts(e.montant) ?? Number.NaN), 0)
    if (montant == null || !Number.isFinite(total)) {
      nonEcrite(source, 'mouvement_ecart', 'un montant illisible')
      continue
    }
    // Ceux du même jour ont porté la banque eux-mêmes ; ceux d'un autre jour sont passés au 511 (au 53 pour des espèces),
    // que le mouvement solde.
    const solde = new Solde()
    let memeJour = 0
    for (const e of justifies) {
      const c = centimesExacts(e.montant)!
      if (e.date_encaissement === m.date) memeJour += c
      else solde.ajouter(e.moyen === 'especes' ? plan.caisse : plan.valeurs_a_l_encaissement, -c, m.id)
    }
    const frais = total - montant
    solde.ajouter(plan.banque, montant - memeJour, m.id).ajouter(plan.services_bancaires, frais, m.id)
    const lignes = solde.lignes()
    if (lignes.length === 0) continue
    if (!m.encaissements_de_factures) {
      nonEcrite(source, 'mouvement_non_classe', `mouvement du ${m.date}`)
      continue
    }
    if (frais < 0 || !ecartDeFrais(frais, Math.abs(total))) {
      nonEcrite(source, 'mouvement_ecart', `mouvement du ${m.date}`)
      continue
    }
    enCours.set(cleFecMouvementEncaissements(m.id), {
      ecriture: {
        source, cle: cleFecMouvementEncaissements(m.id), date: m.date, journal: 'BQ', pieceRef: referenceDuReleve(m),
        pieceDate: m.date, libelle: m.libelle, tiers: null,
      },
      solde,
    })
  }

  const ecritures = [...enCours.values()]
    .map(({ ecriture: e, solde }) => ({ ...e, lignes: solde.lignes() }))
    .filter((e) => e.lignes.length > 0)
    .sort((a, b) => ordreC(a.date, b.date) || ordreC(a.cle, b.cle))
  return { dossierId, ecritures, nonEcrites, ventes }
}

// ── Ce que la base écrira, et ce qu'elle comparera (VF4b) ─────────────────────────────────────────────────────────────

/** Une ligne de `ecritures_brouillon` telle que la fonction de VF4b l'écrira : proposée, sans pièce, liée à sa source. */
export type LigneAuBrouillon = Pick<
  EcritureBrouillon,
  'dossier_id' | 'piece_id' | 'ligne_bancaire_id' | 'date' | 'compte' | 'libelle' | 'montant' | 'sens' | 'statut'
  | 'facture_id' | 'encaissement_id'
>

/** Les colonnes de la source, sur chaque ligne : une seule des deux, ou aucune pour un mouvement (la garde de VF2). */
export function colonnesDeLaSource(source: SourceEcritureVente): Pick<EcritureBrouillon, 'facture_id' | 'encaissement_id'> {
  if (source.genre === 'encaissement') return { facture_id: null, encaissement_id: source.encaissementId }
  if (source.genre === 'mouvement') return { facture_id: null, encaissement_id: null }
  return { facture_id: source.factureId, encaissement_id: null }
}

export function lignesAuBrouillon(dossierId: string, e: EcritureVenteFacturee): LigneAuBrouillon[] {
  const colonnes = colonnesDeLaSource(e.source)
  return e.lignes.map((l) => ({
    dossier_id: dossierId, piece_id: null, ligne_bancaire_id: l.ligneBancaireId, date: e.date, compte: l.compte,
    libelle: e.libelle, montant: l.centimes / 100, sens: l.sens, statut: 'proposee' as const, ...colonnes,
  }))
}

/**
 * Les lignes du brouillon d'une écriture sont-elles celles que la composition rend — mêmes comptes, sens, montants au
 * centime, mouvements, date et source ? Ce que la fonction de VF4b refusera de ne pas trouver, et ce que l'onglet
 * Écritures de VF4c dira « à réécrire ». Le libellé n'en décide pas.
 */
export function memeEcritureQueLeBrouillon(
  e: EcritureVenteFacturee,
  brouillon: readonly Pick<EcritureBrouillon, 'ligne_bancaire_id' | 'date' | 'compte' | 'montant' | 'sens' | 'facture_id' | 'encaissement_id'>[],
): boolean {
  const colonnes = colonnesDeLaSource(e.source)
  const lues: LigneVenteFacturee[] = []
  for (const b of brouillon) {
    const centimes = centimesExacts(b.montant)
    if (b.date !== e.date || b.facture_id !== colonnes.facture_id || b.encaissement_id !== colonnes.encaissement_id
      || centimes == null || centimes <= 0) return false
    lues.push({ compte: b.compte, sens: b.sens, centimes, ligneBancaireId: b.ligne_bancaire_id })
  }
  const forme = (l: readonly LigneVenteFacturee[]) => JSON.stringify([...l].sort((a, b) => ordreDesLignes(a, b) || a.centimes - b.centimes))
  return forme(lues) === forme(e.lignes)
}

/** L'auxiliaire d'une ligne dans le FEC : celui du 411 d'une pièce de vente, tiré du nom du client ; nul ailleurs. */
export function auxiliaireDeLaLigne(e: Pick<EcritureVenteFacturee, 'tiers'>, ligne: Pick<LigneVenteFacturee, 'compte'>): CompteAuxiliaire | null {
  return e.tiers == null ? null : auxiliaireDuTiers({ tiers: e.tiers }, ligne.compte)
}
