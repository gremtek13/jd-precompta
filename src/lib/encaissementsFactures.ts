import { SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF } from './alignementBanque'
import { libelleExploitable, tiersConfirmeParBanque } from './appariementBanque'
import { montantsDuDocument, TAUX_ADMIS } from './factureCii'
import { ajouterMois, anneeDe, dernierJourDuMois, formatDate, formatMoney, moisDe } from './format'
import type { PaiementsDesPieces } from './rattachement'
import { DEBUT_EMISSION_PME } from './statutTva'
import { STATUTS_ANNULATION_SUPERPDP, annuleeSurSaPlateforme, type StatutPlateformeLu } from './transmissionsFactures'
import type {
  EncaissementFacture, EncaissementFactureTaux, EtatTransmission, FactureEmise, FactureLigne, FactureSuperpdpEvent,
  LigneBancaire, MoyenEncaissement, Piece, StatutTva, TransmissionEncaissement, TransmissionFacture,
} from './types'

// LES ENCAISSEMENTS D'UNE FACTURE ÉMISE, TELS QUE L'ÉCRAN LES DIT (ligne 28.5, étape d2). Un module PUR : il ne lit rien
// en base, n'appelle personne et ne lit pas l'horloge — l'écran (étape d3) lui donne ce qu'il a lu, et la date du jour
// à Paris.
//
// Le registre vit en base depuis l'étape d1 (migration encaissements_des_factures) : seule `enregistrer_encaissement`
// l'écrit, et `retirer_encaissement` le retire ; depuis l'étape d4 (migration transmissions_des_encaissements),
// `declarer_encaissement_hors_application` garde ses déclarations et `annuler_encaissement` contre-passe un
// encaissement déclaré. Ce module dit AVANT le clic :
//   - l'OBLIGATION de déclarer le statut « Encaissée » (212) d'une facture, et pourquoi (`obligationEncaissee`) ;
//   - ce que la base REFUSERAIT, dans son ordre et sous ses mots (`refusEnregistrement`, `refusRetrait`) ;
//   - le TTC par taux que la facture a transmis, et ce qu'il en reste à encaisser (`resteAEncaisser`) ;
//   - la répartition par taux proposée pour un encaissement (`repartitionProposee`) ;
//   - l'échéance de sa déclaration (`echeanceDeDeclaration`) ;
//   - les encaissements que la pièce jumelle et le relevé permettent de proposer (`propositionsEncaissement`) ;
//   - depuis l'étape d4, ce qui est déclaré (`encaissementsDeclares`), où le statut se déclare
//     (`plateformeDeLaDeclaration`), ce que la déclaration hors application et la contre-passation refuseraient
//     (`refusDeclaration`, `refusContrePassation`) et ce que la contre-passation écrira (`contrePassationDe`) ;
//   - depuis l'étape d7 (migration cycle_de_vie_des_factures_emises), qu'un refus (210) ou un rejet (213) LU SUR LA
//     PLATEFORME DU CLIENT (`statuts_factures_recus`) fait refuser l'encaissement et la déclaration comme un refus de
//     Super PDP, sous les mêmes mots.
//
// Les sources sont publiques : CGI, art. 290 A, et ann. II, art. 242 nonies P — CIBS, art. L. 216-56 à compter du
// 01/01/2027 — ; BOI-TVA-DECLA-20-30-60 ; BOI-TVA-BASE-20-20 ; spécifications externes de la DGFiP v3.2 (§ 3.6.4 et
// annexe 7). AUCUN ARTICLE N'EST CITÉ À L'ÉCRAN : les messages disent la règle, et ne vieillissent pas au 01/01/2027,
// quand la TVA passe du CGI au CIBS.
//
// UN ENCAISSEMENT EST UNE AFFIRMATION, JAMAIS UNE DÉDUCTION : ce module PROPOSE, le cabinet confirme, et seule la
// fonction de la base écrit. Il suppose des lectures COMPLÈTES — une liste d'encaissements tronquée ferait dire un reste
// faux : l'écran qui n'a pas tout lu n'offre aucun formulaire (règle « lecture → formulaire → écriture »).

// ── Ce que l'écran lit ──────────────────────────────────────────────────────────────────────────────────────────────

/** La facture, telle que les refus, le reste et les propositions la lisent. */
export type FacturePourEncaissement = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'date_emission' | 'montant_ht' | 'montant_tva' | 'montant_ttc'
  | 'superpdp_invoice_id' | 'tiers_nom'>

/** Une ligne de facture : son `facture_id` la rattache, et le module ne garde que celles de SA facture. */
export type LigneDeFacture = Pick<FactureLigne, 'facture_id' | 'ordre' | 'designation' | 'quantite' | 'prix_unitaire_ht' | 'taux_tva'>

export type TransmissionLue = Pick<TransmissionFacture, 'facture_id' | 'etat' | 'hote' | 'flux_id'>
export type EvenementSuperpdpLu = Pick<FactureSuperpdpEvent, 'facture_id' | 'status_code'>
export type { StatutPlateformeLu }
export type EncaissementLu = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'montant' | 'ligne_bancaire_id' | 'annule_id' | 'retire_le'>
export type PartLue = Pick<EncaissementFactureTaux, 'encaissement_id' | 'taux' | 'montant'>
export type MouvementLu = Pick<LigneBancaire, 'id' | 'dossier_id' | 'date' | 'montant'>

/**
 * Ce que l'écran a lu pour la facture ouverte. Les listes sont celles du DOSSIER — le module filtre lui-même sur la
 * facture, comme la base : un filtre oublié du côté de l'appelant ferait juger une facture sur les encaissements d'une
 * autre. Les encaissements comprennent les retirés et les annulations : c'est ici qu'ils sont comptés, ou non.
 */
export interface ContexteFacture {
  /** Le dossier de l'écran : celui que la fonction de la base reçoit en premier paramètre. */
  dossierId: string
  facture: FacturePourEncaissement
  lignes: readonly LigneDeFacture[]
  transmissions: readonly TransmissionLue[]
  evenementsSuperpdp: readonly EvenementSuperpdpLu[]
  /** Les statuts lus sur la plateforme du client (étape d7) : un 210 ou un 213 refuse tout encaissement. */
  statutsRecus: readonly StatutPlateformeLu[]
  encaissements: readonly EncaissementLu[]
  parts: readonly PartLue[]
}

// ── Les moyens de paiement ──────────────────────────────────────────────────────────────────────────────────────────

export interface MoyenDePaiement {
  moyen: MoyenEncaissement
  libelle: string
  /** La date que l'encaissement porte pour ce moyen, quand la doctrine la dit ; nulle sinon (BOI-TVA-BASE-20-20). */
  dateARetenir: string | null
}

// Dans l'ordre de la contrainte `encaissements_factures_moyen` et de la liste d'`enregistrer_encaissement`, que
// encaissementsFactures.test.ts confronte au texte de la migration. La date à retenir suit les règles d'exigibilité
// auxquelles renvoie la doctrine du statut « Encaissée » (BOI-TVA-DECLA-20-30-60, §60) : BOI-TVA-BASE-20-20, §30 (les
// espèces), §40 (le chèque), §50 (le virement), §60 (l'effet de commerce). Pour les autres moyens elle ne dit rien, et
// l'écran ne dit rien non plus : on ne devine pas une règle.
export const MOYENS_ENCAISSEMENT: readonly MoyenDePaiement[] = [
  { moyen: 'virement', libelle: 'Virement', dateARetenir: 'Le jour où la somme est inscrite au compte, celui du relevé.' },
  {
    moyen: 'cheque',
    libelle: 'Chèque',
    dateARetenir: 'Le jour où le chèque est remis, ou reçu s’il est envoyé par la poste — pas celui de son crédit au compte.',
  },
  { moyen: 'carte', libelle: 'Carte bancaire', dateARetenir: null },
  { moyen: 'prelevement', libelle: 'Prélèvement', dateARetenir: null },
  { moyen: 'especes', libelle: 'Espèces', dateARetenir: 'Le jour où les espèces sont reçues.' },
  { moyen: 'effet', libelle: 'Effet de commerce', dateARetenir: 'Le jour où le client paie l’effet, à son échéance — même s’il a été escompté avant.' },
  { moyen: 'compensation', libelle: 'Compensation', dateARetenir: null },
  { moyen: 'autre', libelle: 'Autre', dateARetenir: null },
]

// ── L'obligation de déclarer ─────────────────────────────────────────────────────────────────────────────────────────

export type EtatObligationEncaissee = 'due' | 'facultative' | 'sans_objet' | 'a_preciser' | 'refusee'

export interface ObligationEncaissee {
  etat: EtatObligationEncaissee
  /** La raison, en français, sans article de loi. */
  raison: string
}

export type FacturePourObligation = Pick<FactureEmise,
  'id' | 'statut' | 'type' | 'date_emission' | 'type_client' | 'nature_operation' | 'option_debits'>

const VALIDEE_NE_SE_COMPLETE_PLUS = 'et l’obligation en dépend ; validée, elle ne se complète plus.'

/**
 * Le statut « Encaissée » est-il dû pour cette facture ? Il ne vise que les opérations dont la TVA est exigible à
 * l'encaissement — des prestations de services, sans option pour les débits, hors autoliquidation — facturées à une
 * entreprise établie en France ou à un organisme public ; les paiements d'un particulier ou d'un client établi hors de
 * France relèvent de l'e-reporting (étape e). Un dossier en franchise y est tenu, sans TVA ; un dossier exonéré non.
 * Pour une PME ou une micro-entreprise — les dossiers de l'application, qui ne distingue pas les autres —, il ne vaut
 * que pour les factures émises à partir du 1er septembre 2027 (CGI, art. 290 A, et ann. II, art. 242 nonies P ;
 * BOI-TVA-DECLA-20-30-60, §1, §20, §30 et §120 ; spécifications externes v3.2, § 2.3.2).
 *
 * L'ORDRE DIT LE PLUS SÛR D'ABORD : une raison certaine de ne rien déclarer l'emporte sur une donnée inconnue — une
 * livraison de biens est sans objet quel que soit le statut de TVA du dossier —, puis vient ce qui reste à préciser,
 * puis la facture mixte, refusée (décision du cabinet du 08/10/2026, Q4), puis la date de la facture. Le statut de TVA
 * est celui du dossier aujourd'hui, comme pour la transmission de la facture ; l'option pour les débits est celle que
 * la facture a figée à sa validation.
 */
export function obligationEncaissee(
  facture: FacturePourObligation,
  lignes: readonly Pick<FactureLigne, 'facture_id' | 'taux_tva'>[],
  statutTva: StatutTva | null,
): ObligationEncaissee {
  const sansObjet = (raison: string): ObligationEncaissee => ({ etat: 'sans_objet', raison: `Sans objet : ${raison}` })
  const aPreciser = (raison: string): ObligationEncaissee => ({ etat: 'a_preciser', raison: `À préciser : ${raison}` })
  const siennes = lignes.filter((l) => l.facture_id === facture.id)

  if (facture.statut !== 'validee') return sansObjet('un brouillon n’est pas encore une facture.')
  if (facture.type !== 'facture') return sansObjet('un avoir ne s’encaisse pas ; seule une facture reçoit le statut « Encaissée ».')
  if (statutTva === 'exonere') {
    return sansObjet('le dossier est exonéré de TVA, et ses opérations exonérées sortent de la facturation électronique.')
  }
  if (facture.type_client === 'non_assujetti') {
    return sansObjet('la facture est adressée à un particulier ; ses paiements se déclareront par l’e-reporting.')
  }
  if (facture.type_client === 'etranger') {
    return sansObjet('le client est établi hors de France ; ses paiements se déclareront par l’e-reporting.')
  }
  if (facture.nature_operation === 'biens') {
    return sansObjet('la TVA d’une livraison de biens est due à la livraison, pas à l’encaissement.')
  }
  if (facture.option_debits === true) {
    return sansObjet('le dossier avait opté pour la TVA sur les débits : elle est due à la facture, pas à l’encaissement.')
  }
  // Un redevable qui ne facture aucune TVA : des opérations exonérées, ou dont la TVA est due par le client — rien
  // n'est exigible à l'encaissement. Un dossier en franchise, lui, déclare ses encaissements sans TVA.
  if (statutTva === 'redevable' && siennes.length > 0 && siennes.every((l) => l.taux_tva <= 0)) {
    return sansObjet('aucune ligne de la facture ne porte de TVA, et seule une TVA due à l’encaissement se déclare ainsi.')
  }
  if (statutTva == null) {
    return aPreciser('le statut de TVA du dossier, dont l’obligation dépend, n’est pas encore choisi (onglet TVA du dossier).')
  }
  if (facture.type_client == null) return aPreciser(`la facture ne dit pas à qui elle est adressée, ${VALIDEE_NE_SE_COMPLETE_PLUS}`)
  if (facture.nature_operation == null) {
    return aPreciser(`la facture ne dit pas si elle porte sur des biens ou des services, ${VALIDEE_NE_SE_COMPLETE_PLUS}`)
  }
  if (facture.option_debits == null) {
    return aPreciser(`la facture ne dit pas si le dossier avait opté pour la TVA sur les débits, ${VALIDEE_NE_SE_COMPLETE_PLUS}`)
  }
  if (facture.nature_operation === 'mixte') {
    return {
      etat: 'refusee',
      raison: 'Refusée : la facture mêle biens et services, et seule la part des services se déclarerait ; ses lignes ne disent pas laquelle.',
    }
  }
  if (facture.date_emission < DEBUT_EMISSION_PME) {
    return {
      etat: 'facultative',
      raison: `Facultative : la facture est du ${formatDate(facture.date_emission)}, et pour une PME ou une micro-entreprise `
        + 'l’obligation ne vaut que pour les factures émises à partir du 1er septembre 2027.',
    }
  }
  return {
    etat: 'due',
    raison: statutTva === 'franchise'
      ? 'Due : des prestations de services d’un dossier en franchise en base, déclarées sans TVA.'
      : 'Due : des prestations de services, dont la TVA est due à l’encaissement.',
  }
}

// ── Les montants : en centimes, comme la base ───────────────────────────────────────────────────────────────────────

// Un montant de la base, déjà au centime — un encaissement (sa contrainte), un mouvement (numeric(12,2)) — en centimes.
const centimes = (euros: number) => Math.round(euros * 100)

// ── DÉBUT COPIE centimesExacts ───────────────────────────────────────────────────────────────────────────────────────
// Ce bloc sera recopié AU CARACTÈRE PRÈS, avec celui de cdarEncaissee.ts qui le lit, dans les Edge Functions qui
// déposeront le statut « Encaissée » (étapes d6 et d8). cdarEncaisseeCopie.test.ts l'extrait d'ici.
/**
 * Un nombre en centimes, s'il s'écrit exactement au centime ; null sinon. La base juge `x = round(x, 2)` sur le nombre
 * que le navigateur lui envoie, écrit comme JSON.stringify l'écrit — c'est-à-dire comme String l'écrit : plus de deux
 * décimales, une écriture à exposant (1e-7), un nombre qui n'en est pas un (« NaN », « Infinity ») ne sont pas au
 * centime. Lire le texte plutôt que multiplier par cent : 1,005 × 100 vaut 100,49999999999999 en virgule flottante, et
 * un arrondi l'accepterait.
 */
export function centimesExacts(euros: number): number | null {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(euros))
  if (!m) return null
  const valeur = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -valeur : valeur
}
// ── FIN COPIE centimesExacts ─────────────────────────────────────────────────────────────────────────────────────────

// ── Le TTC par taux, et ce qu'il en reste à encaisser ───────────────────────────────────────────────────────────────

export interface TtcDuTaux {
  taux: number
  ttcCentimes: number
}

/**
 * Le TTC de chaque taux, tel que la facture électronique l'a transmis (BG-23) : celui de `montantsDuDocument`, ligne par
 * ligne puis sommé par taux, en centimes — le calcul même que la base refait (`montants_par_taux_facture`), confronté à
 * une table relevée en base (encaissementsBase.test.ts). Du taux le plus fort au plus faible.
 */
export function ttcParTaux(facture: Pick<FactureEmise, 'id' | 'type'>, lignes: readonly LigneDeFacture[]): TtcDuTaux[] {
  return montantsDuDocument(facture, lignes.filter((l) => l.facture_id === facture.id), null).groupes
    .map((g) => ({ taux: g.taux, ttcCentimes: g.baseCentimes + g.tvaCentimes }))
}

export interface ResteDuTaux {
  taux: number
  ttcCentimes: number
  encaisseCentimes: number
  /** Signé : négatif si les encaissements dépassent le taux, ce que la base ne laisse pas faire hors restauration. */
  resteCentimes: number
}

export interface ResteAEncaisser {
  ttcCentimes: number
  encaisseCentimes: number
  resteCentimes: number
  parTaux: ResteDuTaux[]
}

// Un encaissement qui compte : non retiré. Les annulations comptent aussi, en négatif — c'est la règle de la base, qui
// juge ses plafonds sur des montants NETS (enregistrer_encaissement, refus 12).
const compte = (e: Pick<EncaissementLu, 'retire_le'>) => e.retire_le == null

/** Ce qui reste à encaisser de la facture, en tout et par taux, NET des encaissements retirés et des annulations. */
export function resteAEncaisser(c: Pick<ContexteFacture, 'facture' | 'lignes' | 'encaissements' | 'parts'>): ResteAEncaisser {
  const comptes = c.encaissements.filter((e) => e.facture_id === c.facture.id && compte(e))
  const ids = new Set(comptes.map((e) => e.id))
  const siennes = c.parts.filter((p) => ids.has(p.encaissement_id))
  const parTaux = ttcParTaux(c.facture, c.lignes).map(({ taux, ttcCentimes }) => {
    const encaisseCentimes = siennes.filter((p) => p.taux === taux).reduce((s, p) => s + centimes(p.montant), 0)
    return { taux, ttcCentimes, encaisseCentimes, resteCentimes: ttcCentimes - encaisseCentimes }
  })
  const ttcCentimes = parTaux.reduce((s, t) => s + t.ttcCentimes, 0)
  const encaisseCentimes = comptes.reduce((s, e) => s + centimes(e.montant), 0)
  return { ttcCentimes, encaisseCentimes, resteCentimes: ttcCentimes - encaisseCentimes, parTaux }
}

// ── La répartition proposée ──────────────────────────────────────────────────────────────────────────────────────────

export interface PartProposee {
  taux: number
  centimes: number
}

/**
 * La répartition par taux d'un encaissement (décision du cabinet du 08/10/2026, Q3) : au prorata des RESTES de chaque
 * taux — pas des TTC d'origine, pour qu'un partiel déjà déclaré ne fasse jamais dépasser un taux —, les centimes de
 * l'arrondi aux plus forts restes de la division, à égalité au taux le plus haut. La somme vaut toujours le montant.
 * Un encaissement qui solde la facture prend ainsi exactement le reste de chaque taux : la division tombe juste. Le
 * cabinet peut la corriger ; `refusEnregistrement` juge la sienne.
 *
 * Null quand il n'y a rien à répartir : un montant qui n'est pas un nombre positif de centimes, ou aucun taux qui ait
 * encore un reste. Les produits se font en entiers longs : un montant et un reste de dix mille milliards d'euros, en
 * centimes, ne tiennent pas dans un produit de nombres à virgule flottante.
 */
export function repartitionProposee(
  montantCentimes: number,
  restes: readonly Pick<ResteDuTaux, 'taux' | 'resteCentimes'>[],
): PartProposee[] | null {
  if (!Number.isSafeInteger(montantCentimes) || montantCentimes <= 0) return null
  const poids = restes.map((r) => BigInt(Math.max(r.resteCentimes, 0)))
  const total = poids.reduce((s, p) => s + p, 0n)
  if (total === 0n) return null
  const montant = BigInt(montantCentimes)
  const parts = poids.map((p) => (montant * p) / total)
  const restesDeDivision = poids.map((p) => (montant * p) % total)
  // Il manque moins de centimes qu'il n'y a de restes de division non nuls (leur somme est `manque` fois le total) : un
  // taux sans reste à encaisser, dont le reste de division est nul, n'en reçoit jamais.
  let manque = montant - parts.reduce((s, p) => s + p, 0n)
  const ordre = restes.map((_, i) => i)
    .sort((a, b) => (restesDeDivision[a] === restesDeDivision[b]
      ? restes[b].taux - restes[a].taux
      : restesDeDivision[b] > restesDeDivision[a] ? 1 : -1))
  for (const i of ordre) {
    if (manque === 0n) break
    parts[i] += 1n
    manque -= 1n
  }
  return restes.map((r, i) => ({ taux: r.taux, centimes: Number(parts[i]) })).filter((p) => p.centimes > 0)
}

// ── Ce que la base refuserait ─────────────────────────────────────────────────────────────────────────────────────────

// Les refus d'`enregistrer_encaissement`, DANS SON ORDRE ET SOUS SES MOTS (supabase/schema/20261008180607_
// encaissements_des_factures.sql) : l'écran les dit avant le clic, et un refus de la base arrivé après — une écriture
// concurrente — dit la même chose. Le modèle est le texte de la fonction, apostrophes droites comprises : chaque « % »
// y reçoit une valeur, « %% » s'y écrit « % ». encaissementsFactures.test.ts extrait les messages de la fonction et
// les confronte à cette liste, ordre et texte.
export const REFUS_ENREGISTREMENT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'facture_introuvable', modele: 'Facture introuvable dans ce dossier.' },
  { cle: 'brouillon', modele: 'Seule une facture validée reçoit un encaissement : celle-ci est un brouillon.' },
  { cle: 'avoir', modele: "Un avoir ne reçoit pas d'encaissement : seule une facture en reçoit." },
  { cle: 'rejetee', modele: "Cette facture a été rejetée ou refusée : elle s'annule par un avoir interne, et aucun encaissement ne la suit." },
  {
    cle: 'lignes_incoherentes',
    modele: 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes : ses encaissements ne se répartissent pas par taux.',
  },
  { cle: 'date_absente', modele: "La date de l'encaissement est à renseigner." },
  { cle: 'date_avant_2000', modele: "Un encaissement ne se date pas avant l'an 2000." },
  { cle: 'date_future', modele: "Un encaissement ne se date pas dans l'avenir : nous sommes le %." },
  { cle: 'montant_positif', modele: 'Un encaissement est un montant positif.' },
  { cle: 'montant_centime', modele: 'Un encaissement se compte au centime.' },
  { cle: 'moyen_inconnu', modele: 'Le moyen de paiement est inconnu.' },
  { cle: 'mouvement_hors_dossier', modele: "Ce mouvement n'est pas un mouvement de ce dossier." },
  { cle: 'mouvement_debit', modele: "Un encaissement se justifie par un crédit : ce mouvement n'en est pas un." },
  { cle: 'mouvement_deja_pris', modele: 'Ce mouvement justifie déjà un encaissement de cette facture.' },
  {
    cle: 'mouvement_depasse',
    modele: "Ce mouvement de % € justifierait % € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
  },
  { cle: 'repartition_illisible', modele: 'La répartition par taux est illisible : une liste de taux et de montants.' },
  { cle: 'taux_repete', modele: 'Le taux de % %% figure deux fois dans la répartition.' },
  { cle: 'taux_hors_facture', modele: "Le taux de % %% n'est pas un taux de cette facture." },
  { cle: 'taux_non_admis', modele: "Le taux de % %% n'est pas un taux de TVA que la facturation électronique admet." },
  { cle: 'part_invalide', modele: 'Chaque part de la répartition est un montant positif, au centime.' },
  { cle: 'repartition_somme', modele: 'La répartition (% €) ne fait pas le montant encaissé (% €).' },
  { cle: 'plafond_facture', modele: "L'encaissement dépasserait le total de la facture : il reste % € à encaisser." },
  { cle: 'plafond_taux', modele: "À % %%, l'encaissement dépasserait ce que la facture porte : il reste % € à encaisser à ce taux." },
] as const

export type CleRefusEnregistrement = (typeof REFUS_ENREGISTREMENT)[number]['cle']

// Les refus de `retirer_encaissement`, de même.
export const REFUS_RETRAIT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.' },
  { cle: 'deja_retire', modele: 'Cet encaissement est déjà retiré.' },
  { cle: 'declare', modele: "Un encaissement déclaré ne se retire pas : il se contre-passe, et l'annulation se déclare à son tour." },
  { cle: 'annule', modele: "Cet encaissement est annulé par une contre-passation : retirez d'abord celle-ci." },
] as const

export type CleRefusRetrait = (typeof REFUS_RETRAIT)[number]['cle']

export interface RefusEncaissement<C extends string> {
  cle: C
  message: string
}

// La mise en forme de RAISE en PL/pgSQL : chaque « % » reçoit la valeur suivante, « %% » s'écrit « % ». Un compte de
// valeurs qui ne tombe pas juste est une faute de ce module, que la base aurait refusée à la création de la fonction.
export function remplirModele(modele: string, valeurs: readonly string[]): string {
  let i = 0
  const texte = modele.replace(/%%|%/g, (m) => (m === '%%' ? '%' : valeurs[i++] ?? ''))
  if (i !== valeurs.length) throw new Error(`${valeurs.length} valeur(s) pour ${i} « % » : ${modele}`)
  return texte
}

function refus(cle: CleRefusEnregistrement, ...valeurs: string[]): RefusEncaissement<CleRefusEnregistrement> {
  const { modele } = REFUS_ENREGISTREMENT.find((r) => r.cle === cle) as (typeof REFUS_ENREGISTREMENT)[number]
  return { cle, message: remplirModele(modele, valeurs) }
}

// Les valeurs, écrites comme la base les écrit dans ses messages.
// Un montant : `replace(to_char(x, 'FM999999999990.00'), '.', ',')` — au centime, sans séparateur de milliers, la
// virgule décimale ; au-delà de douze chiffres avant la virgule, to_char n'écrit que des dièses (relevé sur
// PostgreSQL 16 le 08/10/2026 : « ############.## »).
export function euroCommeLaBase(centimesValeur: number): string {
  const a = Math.abs(centimesValeur)
  const entier = Math.floor(a / 100)
  const signe = centimesValeur < 0 ? '-' : ''
  if (entier >= 1_000_000_000_000) return `${signe}############,##`
  return `${signe}${entier},${String(a % 100).padStart(2, '0')}`
}

// Un taux : `replace(trim_scale(x)::text, '.', ',')` du nombre reçu en JSON — en notation décimale, sans zéro inutile ;
// la base lit 1e-7 comme 0.0000001 (relevé sur PostgreSQL 16).
export function tauxCommeLaBase(taux: number): string {
  return decimalSansExposant(String(taux)).replace('.', ',')
}

// String n'écrit un exposant que sous 10⁻⁶ — la virgule tombe alors avant tous les chiffres — et à partir de 10²¹,
// où elle tombe après les dix-sept chiffres au plus d'un nombre à virgule flottante : deux cas, jamais un troisième.
function decimalSansExposant(texte: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(texte)
  if (!m) return texte
  const [, signe, entier, fraction = '', exposant] = m
  const chiffres = entier + fraction
  const virgule = entier.length + Number(exposant)
  return virgule <= 0
    ? `${signe}0.${'0'.repeat(-virgule)}${chiffres}`
    : `${signe}${chiffres}${'0'.repeat(virgule - chiffres.length)}`
}

// Les bornes de la fonction, confrontées à son texte par le test.
export const DATE_PLANCHER = '2000-01-01'
export const BORNE_MONTANT_EUROS = 10_000_000_000_000

// LE SEUIL DES FRAIS BANCAIRES, celui de alignementBanque.ts (décision du cabinet du 23/09/2026) — min(2 %, 5 €) —, en
// centimes ENTIERS comme la base le juge : (encaissements − mouvement) × 100 ≤ min(5 € × 100, 2 % des encaissements),
// soit, en centimes, écart × 100 ≤ min(50 000, total × 2). `seuilAlignement` le calcule en virgule flottante : à la
// frontière, 2 % d'un montant ne tombe pas toujours juste, et l'écran doit dire exactement ce que la base fera.
export const SEUIL_POUR_CENT = Math.round(SEUIL_ALIGNEMENT_RELATIF * 100)
export const SEUIL_PLAFOND_CENTIMES = Math.round(SEUIL_ALIGNEMENT_PLAFOND_EUR * 100)

/** Un écart, en centimes, que des frais bancaires expliquent sur un montant de `baseCentimes`. */
export function ecartDeFrais(ecartCentimes: number, baseCentimes: number): boolean {
  return ecartCentimes * 100 <= Math.min(SEUIL_PLAFOND_CENTIMES * 100, baseCentimes * SEUIL_POUR_CENT)
}

// Une date civile AAAA-MM-JJ qui existe. Une autre forme ne parviendrait pas à la fonction — PostgREST refuserait de la
// lire comme une date — : l'écran la tient pour non renseignée.
function dateCivile(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const mois = moisDe(date)
  return mois >= 1 && mois <= 12 && Number(date.slice(8, 10)) >= 1 && date <= dernierJourDuMois(date)
}

// Un encaissement que la contre-passation vivante d'un autre annule : il ne justifie plus rien (refus 10 de la base).
function annuleParUneContrePassation(e: Pick<EncaissementLu, 'id'>, encaissements: readonly EncaissementLu[]): boolean {
  return encaissements.some((a) => a.annule_id === e.id && compte(a))
}

/**
 * Ce qui, de la facture seule, refuse tout encaissement — les refus 2 à 6 de la base, dans son ordre : une facture d'un
 * autre dossier, un brouillon, un avoir, une facture rejetée par une plateforme, rejetée ou refusée chez Super PDP ou
 * sur la plateforme du client (elle s'annule par un avoir interne), une facture dont l'en-tête ne se retrouve pas dans
 * ses lignes. Null quand elle peut en recevoir. L'accès au dossier (refus 1), seule la base le juge : l'écran n'existe
 * que pour qui lit le dossier.
 */
export function refusDeLaFacture(c: ContexteFacture): RefusEncaissement<CleRefusEnregistrement> | null {
  const f = c.facture
  if (f.dossier_id !== c.dossierId) return refus('facture_introuvable')
  if (f.statut !== 'validee') return refus('brouillon')
  if (f.type !== 'facture') return refus('avoir')
  if (c.transmissions.some((t) => t.facture_id === f.id && t.etat === 'rejete')
    || c.evenementsSuperpdp.some((e) => e.facture_id === f.id && STATUTS_ANNULATION_SUPERPDP.includes(e.status_code))
    || annuleeSurSaPlateforme(c.statutsRecus, f.id)) {
    return refus('rejetee')
  }
  const m = montantsDuDocument(f, c.lignes.filter((l) => l.facture_id === f.id), null)
  if (centimesExacts(f.montant_ht) !== m.htCentimes || centimesExacts(f.montant_tva) !== m.tvaCentimes
    || centimesExacts(f.montant_ttc) !== m.htCentimes + m.tvaCentimes) {
    return refus('lignes_incoherentes')
  }
  return null
}

export interface PartSaisie {
  taux: number
  /** En euros. */
  montant: number
}

export interface SaisieEncaissement {
  /** AAAA-MM-JJ ; null ou vide : pas encore saisie. */
  date: string | null
  /** En euros ; null : pas encore saisi. */
  montant: number | null
  /** Un des MOYENS_ENCAISSEMENT, ou ce que l'écran a reçu. */
  moyen: string | null
  /** Le mouvement qui prouve l'encaissement, facultatif. */
  ligneBancaireId: string | null
  /** Dans l'ordre de la saisie : la base juge ses parts dans cet ordre. */
  repartition: readonly PartSaisie[]
}

/**
 * Ce que `enregistrer_encaissement` refuserait de cette saisie : le PREMIER refus, dans l'ordre de la base et sous son
 * message, ou null quand elle l'accepterait. `mouvements` : ceux du dossier, où se cherche le mouvement cité ;
 * `aujourdHui` : la date du jour À PARIS (`aujourdHuiAParis`), celle que la base lit.
 */
export function refusEnregistrement(
  c: ContexteFacture,
  s: SaisieEncaissement,
  mouvements: readonly MouvementLu[],
  aujourdHui: string,
): RefusEncaissement<CleRefusEnregistrement> | null {
  const surLaFacture = refusDeLaFacture(c)
  if (surLaFacture) return surLaFacture
  const f = c.facture

  // 7. La date : renseignée, pas avant l'an 2000, pas dans l'avenir.
  if (s.date == null || !dateCivile(s.date)) return refus('date_absente')
  if (s.date < DATE_PLANCHER) return refus('date_avant_2000')
  if (s.date > aujourdHui) return refus('date_future', formatDate(aujourdHui))

  // 8. Un montant positif, au centime. NaN et l'infini ne sont pas positifs et bornés — ni pour la base, pour qui NaN
  // dépasse tout nombre.
  if (s.montant == null || !(s.montant > 0 && s.montant < BORNE_MONTANT_EUROS)) return refus('montant_positif')
  const montant = centimesExacts(s.montant)
  if (montant == null) return refus('montant_centime')

  // 9. Un moyen de paiement connu — aucun n'est nul.
  if (!MOYENS_ENCAISSEMENT.some((m) => m.moyen === s.moyen)) return refus('moyen_inconnu')

  // 10. Le mouvement, s'il en cite un : de ce dossier, un crédit, qui ne justifie pas déjà un encaissement de cette
  // facture, et dont les encaissements — de toutes les factures : un virement peut en régler plusieurs — ne le
  // dépasseraient pas au-delà de l'écart que des frais expliquent.
  if (s.ligneBancaireId != null) {
    const mouvement = mouvements.find((m) => m.id === s.ligneBancaireId && m.dossier_id === c.dossierId)
    if (!mouvement) return refus('mouvement_hors_dossier')
    if (mouvement.montant <= 0) return refus('mouvement_debit')
    const justifies = c.encaissements.filter((e) =>
      e.ligne_bancaire_id === mouvement.id && compte(e) && !annuleParUneContrePassation(e, c.encaissements))
    if (justifies.some((e) => e.facture_id === f.id)) return refus('mouvement_deja_pris')
    const total = justifies.reduce((somme, e) => somme + centimes(e.montant), 0) + montant
    const credit = centimes(mouvement.montant)
    if (!ecartDeFrais(total - credit, total)) {
      return refus('mouvement_depasse', euroCommeLaBase(credit), euroCommeLaBase(total))
    }
  }

  // 11. La répartition : lisible, sans taux répété, des taux de la facture et admis, des parts positives au centime,
  // dont la somme fait le montant. Un nombre qui n'en est pas un — NaN, l'infini — part en JSON comme `null` : illisible.
  const r = s.repartition
  if (r.length === 0 || r.some((p) => !Number.isFinite(p.taux) || !Number.isFinite(p.montant))) {
    return refus('repartition_illisible')
  }
  const repete = r.find((p, i) => r.slice(0, i).some((q) => q.taux === p.taux))
  if (repete) return refus('taux_repete', tauxCommeLaBase(repete.taux))
  const lignes = c.lignes.filter((l) => l.facture_id === f.id)
  const horsFacture = r.find((p) => !lignes.some((l) => l.taux_tva === p.taux))
  if (horsFacture) return refus('taux_hors_facture', tauxCommeLaBase(horsFacture.taux))
  const nonAdmis = r.find((p) => !TAUX_ADMIS.includes(p.taux))
  if (nonAdmis) return refus('taux_non_admis', tauxCommeLaBase(nonAdmis.taux))
  const parts: number[] = []
  for (const p of r) {
    const part = centimesExacts(p.montant)
    if (part == null || part <= 0) return refus('part_invalide')
    parts.push(part)
  }
  const somme = parts.reduce((total, p) => total + p, 0)
  if (somme !== montant) return refus('repartition_somme', euroCommeLaBase(somme), euroCommeLaBase(montant))

  // 12. Les plafonds, sur des montants NETS : le reste de la facture, puis celui de chaque taux, dans l'ordre des parts.
  // Le total de la facture est son en-tête, au centime depuis le refus 6 ; le TTC d'un taux, celui de ses lignes.
  const comptes = c.encaissements.filter((e) => e.facture_id === f.id && compte(e))
  const deja = comptes.reduce((total, e) => total + centimes(e.montant), 0)
  const ttc = centimesExacts(f.montant_ttc) as number
  if (deja + montant > ttc) return refus('plafond_facture', euroCommeLaBase(Math.max(ttc - deja, 0)))
  const ids = new Set(comptes.map((e) => e.id))
  const ttcDesTaux = new Map(ttcParTaux(f, c.lignes).map((t) => [t.taux, t.ttcCentimes]))
  for (const [i, p] of r.entries()) {
    // Un taux des lignes de la facture : le refus 11 l'a vérifié.
    const ttcDuTaux = ttcDesTaux.get(p.taux) as number
    const dejaDuTaux = c.parts.filter((x) => ids.has(x.encaissement_id) && x.taux === p.taux)
      .reduce((total, x) => total + centimes(x.montant), 0)
    if (dejaDuTaux + parts[i] > ttcDuTaux) {
      return refus('plafond_taux', tauxCommeLaBase(p.taux), euroCommeLaBase(Math.max(ttcDuTaux - dejaDuTaux, 0)))
    }
  }
  return null
}

function refusR(cle: CleRefusRetrait): RefusEncaissement<CleRefusRetrait> {
  const { modele } = REFUS_RETRAIT.find((r) => r.cle === cle) as (typeof REFUS_RETRAIT)[number]
  return { cle, message: modele }
}

/**
 * Ce que `retirer_encaissement` refuserait, dans son ordre : un encaissement d'un autre dossier, déjà retiré, déclaré
 * (il se contre-passe), ou visé par une contre-passation vivante (elle se retire d'abord). `declares` : les
 * encaissements qu'une déclaration active vise (`encaissementsDeclares`, étape d4) — passé sans valeur par défaut :
 * l'écran qui l'oublierait laisserait retirer un encaissement déclaré.
 */
export function refusRetrait(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementLu[],
  declares: ReadonlySet<string>,
): RefusEncaissement<CleRefusRetrait> | null {
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId)
  if (!e) return refusR('encaissement_introuvable')
  if (!compte(e)) return refusR('deja_retire')
  if (declares.has(e.id)) return refusR('declare')
  if (annuleParUneContrePassation(e, encaissements)) return refusR('annule')
  return null
}

// ── Les déclarations, et la contre-passation d'un encaissement déclaré (étape d4) ────────────────────────────────────
//
// Le statut « Encaissée » se déclare par la plateforme qui a reçu la facture (BOI-TVA-DECLA-20-30-60, §120). D'abord
// HORS APPLICATION (décision du cabinet du 08/10/2026, Q2) : le cabinet ou le client le saisit sur la plateforme, et
// `declarer_encaissement_hors_application` garde ce qui a été déclaré (canal `manuel`). Un encaissement déclaré ne se
// retire plus : il se CONTRE-PASSE (`annuler_encaissement`) — un « décaissement », de montant négatif, qui porte « un
// motif d'annulation » (annexe 7 des spécifications externes, règles P1.15 et P1.17) —, et la contre-passation se
// déclare à son tour, sur la même plateforme. Migration transmissions_des_encaissements.

/** Une déclaration, telle que l'écran la lit (`transmissions_encaissements`). */
export type DeclarationLue = Pick<TransmissionEncaissement,
  'id' | 'dossier_id' | 'encaissement_id' | 'facture_id' | 'canal' | 'hote' | 'etat'>

/** Une transmission de la facture, telle que la déclaration la lit : son canal, son hôte, son état. */
export type TransmissionPourDeclaration = Pick<TransmissionFacture, 'facture_id' | 'canal' | 'hote' | 'etat'>

// Les états d'une déclaration qui la font COMPTER : partie sans issue connue (elle a peut-être atteint la plateforme),
// déposée, acceptée. Échouée ou rejetée, elle n'a rien fait compter. Ceux d'`encaissement_declare` et de l'index « une
// seule déclaration active par encaissement », qu'encaissementsFactures.test.ts confronte au texte de la migration.
export const ETATS_DECLARANTS: readonly EtatTransmission[] = ['envoi', 'depose', 'accepte']

/** Les encaissements DÉCLARÉS : ceux qu'une déclaration active vise — ce que `refusRetrait` attend. */
export function encaissementsDeclares(declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[]): Set<string> {
  return new Set(declarations.filter((d) => ETATS_DECLARANTS.includes(d.etat)).map((d) => d.encaissement_id))
}

// Le statut 200 « Déposée » de l'historique de Super PDP : le premier statut obligatoire d'une facture, que
// l'administration reçoit avant tout 212. Une facture déposée chez Super PDP qui le porte reçoit son statut « Encaissée »
// sans attendre la réception par la plateforme de l'acheteur (202), qui est facultative et peut ne jamais venir
// (spécifications externes, § 3.6.4, tableau 8).
export const STATUT_DEPOSEE_SUPERPDP = 'fr:200'

/**
 * La plateforme sur laquelle se déclare le statut « Encaissée » d'un encaissement de cette facture : celle qui l'a
 * ACCEPTÉE — l'hôte de sa transmission acceptée, ou Super PDP quand la facture y est déposée et que son historique porte
 * le statut 200. Elle peut ne plus être la plateforme du dossier : c'est bien là que le statut se déclare. Null
 * sinon — jamais transmise par l'application, partie sans issue connue, déposée sans accusé, échouée : la base refuse
 * alors la déclaration (refus 7). Une facture n'a qu'une transmission active, et une transmission acceptée le reste :
 * il n'y en a jamais deux.
 */
export function plateformeAcceptee(
  factureId: string,
  transmissions: readonly TransmissionPourDeclaration[],
  evenementsSuperpdp: readonly EvenementSuperpdpLu[],
): string | null {
  const deposee = evenementsSuperpdp.some((e) => e.facture_id === factureId && e.status_code === STATUT_DEPOSEE_SUPERPDP)
  const acceptee = transmissions.find((t) => t.facture_id === factureId
    && (t.etat === 'accepte' || (t.canal === 'superpdp' && t.etat === 'depose' && deposee)))
  return acceptee?.hote ?? null
}

// Les refus de `declarer_encaissement_hors_application` et d'`annuler_encaissement`, DANS LEUR ORDRE ET SOUS LEURS MOTS
// (migration transmissions_des_encaissements) : l'écran les dit avant le clic. encaissementsFactures.test.ts les
// confronte au texte des fonctions, et aux messages que la base a rendus en production (transmissionsEncaissements.sql).
export const REFUS_DECLARATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.' },
  { cle: 'retire', modele: "Cet encaissement est retiré : il n'a jamais été déclaré, et ne se déclare plus." },
  { cle: 'deja_declare', modele: "Cet encaissement est déjà déclaré : une déclaration ne se fait qu'une fois." },
  {
    cle: 'contre_passation_non_declaree',
    modele: "L'encaissement que cette contre-passation annule n'est pas déclaré : elle ne se déclare pas.",
  },
  {
    cle: 'facture_rejetee',
    modele: "Cette facture a été rejetée ou refusée : elle s'annule par un avoir interne, et aucun statut « Encaissée » ne la suit.",
  },
  {
    cle: 'sans_transmission_acceptee',
    modele: "Aucune transmission de cette facture par l'application n'a été acceptée par une plateforme : son statut « Encaissée » ne se déclare d'ici qu'après.",
  },
  { cle: 'note_trop_longue', modele: 'La note de la déclaration dépasse 2 000 caractères.' },
] as const

export type CleRefusDeclaration = (typeof REFUS_DECLARATION)[number]['cle']

export const REFUS_CONTRE_PASSATION = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.' },
  { cle: 'contre_passation', modele: "Une annulation ne se contre-passe pas : l'encaissement qu'elle annulait se saisit de nouveau." },
  { cle: 'retire', modele: "Un encaissement retiré ne s'annule pas : il n'a jamais été déclaré." },
  { cle: 'non_declare', modele: "Cet encaissement n'est pas déclaré : il se retire, sans contre-passation." },
  {
    cle: 'issue_inconnue',
    modele: "La déclaration de cet encaissement a une issue inconnue : il ne s'annule pas tant qu'elle n'est pas tranchée.",
  },
  { cle: 'deja_contre_passe', modele: 'Cet encaissement est déjà annulé par une contre-passation.' },
  { cle: 'date_absente', modele: 'La date de la contre-passation est à renseigner.' },
  { cle: 'date_avant_encaissement', modele: "Une contre-passation ne se date pas avant l'encaissement qu'elle annule, du %." },
  { cle: 'date_future', modele: "Une contre-passation ne se date pas dans l'avenir : nous sommes le %." },
  { cle: 'motif_absent', modele: 'Le motif de la contre-passation est à renseigner.' },
  { cle: 'motif_trop_long', modele: 'Le motif de la contre-passation dépasse 2 000 caractères.' },
] as const

export type CleRefusContrePassation = (typeof REFUS_CONTRE_PASSATION)[number]['cle']

function refusD(cle: CleRefusDeclaration): RefusEncaissement<CleRefusDeclaration> {
  const { modele } = REFUS_DECLARATION.find((r) => r.cle === cle) as (typeof REFUS_DECLARATION)[number]
  return { cle, message: modele }
}

function refusC(cle: CleRefusContrePassation, ...valeurs: string[]): RefusEncaissement<CleRefusContrePassation> {
  const { modele } = REFUS_CONTRE_PASSATION.find((r) => r.cle === cle) as (typeof REFUS_CONTRE_PASSATION)[number]
  return { cle, message: remplirModele(modele, valeurs) }
}

// Une note, un motif : 2 000 caractères au plus — la longueur du commentaire du statut (MDT-126).
export const LONGUEUR_MAX_TEXTE = 2000

// Ce que la base appelle vide et long. `btrim` sans second argument n'ôte que des ESPACES (U+0020) — une tabulation, un
// saut de ligne restent, et un motif fait d'un saut de ligne est un motif pour elle. `length` compte des CARACTÈRES ;
// String.length compte des unités UTF-16, et un caractère hors du plan de base (un emoji) en vaut deux.
const videPourLaBase = (texte: string) => /^ *$/.test(texte)
const caracteres = (texte: string) => [...texte].length

/**
 * Ce que `declarer_encaissement_hors_application` refuserait : le PREMIER refus, dans l'ordre de la base et sous son
 * message, ou null quand elle inscrirait la déclaration. Les listes sont celles du DOSSIER — le module filtre lui-même
 * sur l'encaissement et sa facture. L'accès au dossier (refus 1), seule la base le juge. L'obligation de déclarer ne
 * se juge pas ici : `obligationEncaissee` la dit, et l'écran n'offre pas de déclarer ce qui est sans objet. Un refus
 * (210) ou un rejet (213) lu sur la plateforme du client (`statutsRecus`, étape d7) refuse comme un refus de Super PDP.
 */
export function refusDeclaration(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementLu[],
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[],
  transmissions: readonly TransmissionPourDeclaration[],
  evenementsSuperpdp: readonly EvenementSuperpdpLu[],
  statutsRecus: readonly StatutPlateformeLu[],
  note: string | null,
): RefusEncaissement<CleRefusDeclaration> | null {
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId)
  if (!e) return refusD('encaissement_introuvable')
  if (!compte(e)) return refusD('retire')
  const declares = encaissementsDeclares(declarations)
  if (declares.has(e.id)) return refusD('deja_declare')
  if (e.annule_id != null) {
    // Une contre-passation suit l'encaissement qu'elle annule, là où il a été déclaré.
    if (!declares.has(e.annule_id)) return refusD('contre_passation_non_declaree')
  } else {
    if (transmissions.some((t) => t.facture_id === e.facture_id && t.etat === 'rejete')
      || evenementsSuperpdp.some((ev) => ev.facture_id === e.facture_id && STATUTS_ANNULATION_SUPERPDP.includes(ev.status_code))
      || annuleeSurSaPlateforme(statutsRecus, e.facture_id)) {
      return refusD('facture_rejetee')
    }
    if (plateformeAcceptee(e.facture_id, transmissions, evenementsSuperpdp) == null) return refusD('sans_transmission_acceptee')
  }
  if (note != null && !videPourLaBase(note) && caracteres(note) > LONGUEUR_MAX_TEXTE) return refusD('note_trop_longue')
  return null
}

/**
 * La plateforme où la déclaration se fait — ce que l'écran dit (« saisissez le statut sur … ») et ce que la base
 * inscrira : pour un encaissement, celle qui a accepté sa facture ; pour une contre-passation, celle où l'encaissement
 * qu'elle annule a été déclaré. Null quand il n'y en a pas.
 */
export function plateformeDeLaDeclaration(
  encaissement: Pick<EncaissementLu, 'facture_id' | 'annule_id'>,
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat' | 'hote'>[],
  transmissions: readonly TransmissionPourDeclaration[],
  evenementsSuperpdp: readonly EvenementSuperpdpLu[],
): string | null {
  if (encaissement.annule_id != null) {
    const annulee = declarations.find((d) => d.encaissement_id === encaissement.annule_id && ETATS_DECLARANTS.includes(d.etat))
    return annulee?.hote ?? null
  }
  return plateformeAcceptee(encaissement.facture_id, transmissions, evenementsSuperpdp)
}

/** Un encaissement, tel que la contre-passation le lit : sa date compte. */
export type EncaissementPourContrePassation = EncaissementLu & Pick<EncaissementFacture, 'date_encaissement'>

/**
 * Ce que `annuler_encaissement` refuserait : le PREMIER refus, dans l'ordre de la base et sous son message, ou null.
 * `date` : celle du DÉCAISSEMENT — le jour où l'encaissement est défait (le chèque revenu impayé, la somme rendue), ou,
 * pour une déclaration faite par erreur, celui où elle est corrigée ; jamais avant l'encaissement, jamais dans l'avenir
 * (décision à confirmer par le cabinet : HISTORIQUE.md, étape d4). `aujourdHui` : le jour À PARIS, celui que la base lit.
 */
export function refusContrePassation(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementPourContrePassation[],
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[],
  date: string | null,
  motif: string | null,
  aujourdHui: string,
): RefusEncaissement<CleRefusContrePassation> | null {
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId)
  if (!e) return refusC('encaissement_introuvable')
  if (e.annule_id != null) return refusC('contre_passation')
  if (!compte(e)) return refusC('retire')
  const declaration = declarations.find((d) => d.encaissement_id === e.id && ETATS_DECLARANTS.includes(d.etat))
  if (!declaration) return refusC('non_declare')
  if (declaration.etat === 'envoi') return refusC('issue_inconnue')
  if (annuleParUneContrePassation(e, encaissements)) return refusC('deja_contre_passe')
  if (date == null || !dateCivile(date)) return refusC('date_absente')
  if (date < e.date_encaissement) return refusC('date_avant_encaissement', formatDate(e.date_encaissement))
  if (date > aujourdHui) return refusC('date_future', formatDate(aujourdHui))
  if (motif == null || videPourLaBase(motif)) return refusC('motif_absent')
  if (caracteres(motif) > LONGUEUR_MAX_TEXTE) return refusC('motif_trop_long')
  return null
}

/**
 * Ce que la contre-passation d'un encaissement écrira — ce que la confirmation nomme : le montant et chaque part par
 * taux, opposés, en centimes ; le moyen de paiement est le sien.
 */
export function contrePassationDe(
  encaissement: Pick<EncaissementLu, 'id' | 'montant'>,
  parts: readonly PartLue[],
): { montantCentimes: number; parts: PartProposee[] } {
  return {
    montantCentimes: -centimes(encaissement.montant),
    parts: parts.filter((p) => p.encaissement_id === encaissement.id)
      .map((p) => ({ taux: p.taux, centimes: -centimes(p.montant) }))
      .sort((a, b) => b.taux - a.taux),
  }
}

// ── L'échéance de la déclaration ─────────────────────────────────────────────────────────────────────────────────────

export interface EcheanceDeclaration {
  frequence: 'mensuelle' | 'bimestrielle'
  /** La période dont l'encaissement fait partie, bornes comprises. */
  periodeDebut: string
  periodeFin: string
  /** Au plus tard ce jour-là, AAAA-MM-JJ. */
  date: string
  libelle: string
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const deMois = (mois: number) => (/^[aeiouy]/.test(MOIS[mois - 1]) ? `d’${MOIS[mois - 1]}` : `de ${MOIS[mois - 1]}`)

/**
 * Quand l'encaissement doit être déclaré (CGI, ann. II, art. 242 nonies P, III ; BOI-TVA-DECLA-20-30-60, §170 à §210).
 * Au réel, chaque mois : les données doivent parvenir à l'administration dans les dix jours qui suivent la fin du mois
 * (§190) — le 10 du mois suivant. En franchise en base, par bimestre civil (janvier-février, mars-avril…) : entre le
 * 25 et la fin du mois qui suit le bimestre (§210), à un jour qui dépend de l'entreprise et que l'application ne connaît
 * pas — elle retient le 25, la borne prudente. Le régime simplifié, entre le 25 et la fin du mois suivant (§200), finit
 * au 01/01/2027, avant que l'obligation ne commence pour une PME : le 10 reste la borne prudente pour tout redevable.
 * Null pour un dossier exonéré ou au statut à préciser, et pour une date qui n'en est pas une. Sur le calendrier civil :
 * le fuseau de qui regarde n'y change rien.
 */
export function echeanceDeDeclaration(dateEncaissement: string, statutTva: StatutTva | null): EcheanceDeclaration | null {
  if ((statutTva !== 'redevable' && statutTva !== 'franchise') || !dateCivile(dateEncaissement)) return null
  const annee = anneeDe(dateEncaissement)
  const mois = moisDe(dateEncaissement)
  if (statutTva === 'redevable') {
    const debut = `${dateEncaissement.slice(0, 7)}-01`
    const date = `${ajouterMois(debut, 1).slice(0, 7)}-10`
    return {
      frequence: 'mensuelle',
      periodeDebut: debut,
      periodeFin: dernierJourDuMois(debut),
      date,
      libelle: `Paiements ${deMois(mois)} ${annee} : à déclarer au plus tard le ${formatDate(date)}.`,
    }
  }
  const premier = mois % 2 === 1 ? mois : mois - 1
  const debut = `${annee}-${String(premier).padStart(2, '0')}-01`
  const date = `${ajouterMois(debut, 2).slice(0, 7)}-25`
  return {
    frequence: 'bimestrielle',
    periodeDebut: debut,
    periodeFin: dernierJourDuMois(ajouterMois(debut, 1)),
    date,
    libelle: `Paiements ${deMois(premier)} et ${MOIS[premier]} ${annee} : à déclarer au plus tard le ${formatDate(date)} `
      + '(du 25 à la fin du mois selon l’entreprise ; l’application retient le 25).',
  }
}

// ── Les propositions ──────────────────────────────────────────────────────────────────────────────────────────────────

export type PieceLue = Pick<Piece, 'id' | 'dossier_id' | 'flux_hote' | 'flux_id' | 'superpdp_invoice_id'>

/**
 * La PIÈCE JUMELLE : la même vente, entrée aussi comme pièce du dossier — réimportée depuis la plateforme du client, par
 * le flux qui l'a transmise (`flux_hote`, `flux_id` de la transmission), ou par l'ancienne synchronisation de Super PDP
 * (`superpdp_invoice_id`). Rien d'autre ne relie une facture émise à une pièce : ni un nom, ni un montant.
 */
export function piecesJumelles(c: Pick<ContexteFacture, 'facture' | 'transmissions'>, pieces: readonly PieceLue[]): PieceLue[] {
  const f = c.facture
  const flux = c.transmissions.filter((t) => t.facture_id === f.id && t.flux_id != null)
  return pieces.filter((p) => p.dossier_id === f.dossier_id && (
    (f.superpdp_invoice_id != null && p.superpdp_invoice_id === f.superpdp_invoice_id)
    || flux.some((t) => p.flux_hote === t.hote && p.flux_id === t.flux_id)))
}

/** Un mouvement du relevé, tel que les propositions le lisent : son libellé, et ce que le cabinet en a dit. */
export type MouvementPropose = MouvementLu & Pick<LigneBancaire,
  'libelle' | 'libelle_brut' | 'prelevement_personnel' | 'compte_bilan' | 'emprunt_id' | 'declaration_tva_id' | 'cotisation_id'>

// Ce que le cabinet a classé comme autre chose que le paiement d'un client : un apport de l'exploitant, un virement
// interne ou un dépôt de garantie (compte de bilan), le déblocage d'un emprunt, le remboursement d'un crédit de TVA ou
// de cotisations. Ce n'est pas deviner : c'est lire ce qu'il a dit.
function classeAilleurs(m: MouvementPropose): boolean {
  return m.prelevement_personnel || m.compte_bilan != null || m.emprunt_id != null || m.declaration_tva_id != null
    || m.cotisation_id != null
}

export interface PropositionEncaissement {
  /** `jumelle` : un paiement de la pièce jumelle ; `releve` : un crédit du relevé qui fait le reste à l'écart près. */
  source: 'jumelle' | 'releve'
  ligneBancaireId: string
  /** La date du mouvement : celle d'un virement ; pour un chèque, l'écran demande celle de sa remise. */
  date: string
  montantCentimes: number
  repartition: PartProposee[]
  /** Ce que la banque a crédité pour cette facture : le mouvement, ou sa part dans un règlement groupé. */
  creditCentimes: number
  /** Le crédit moins le montant proposé : négatif, la banque a crédité moins (des frais) ; positif, plus. */
  ecartCentimes: number
  /** L'encaissement solderait la facture. */
  solde: boolean
  /** Payé avant la date de la facture : un acompte. */
  avantLaFacture: boolean
  /** Le libellé du mouvement cite le client, mot à mot. Un signal, jamais une condition. */
  clientCite: boolean
  /**
   * Les pièces que ce mouvement paie déjà (`paiementsDesPieces`), triées : la jumelle, ou une pièce de vente que rien ne
   * relie à la facture — le PDF de la même vente déposé à la main, le plus souvent, mais aussi bien le paiement d'une
   * autre facture du même montant, d'un autre mois. L'écran le dit ; le module n'en décide rien.
   */
  piecesPayees: string[]
  explication: string
}

const SEUIL_DIT = `sous le seuil des frais bancaires (${SEUIL_POUR_CENT} % du montant, ${SEUIL_PLAFOND_CENTIMES / 100} € au plus)`

function explication(creditCentimes: number, resteCentimes: number, solde: boolean, avantLaFacture: boolean): string {
  const credit = formatMoney(creditCentimes / 100)
  const reste = formatMoney(resteCentimes / 100)
  const ecart = creditCentimes - resteCentimes
  let texte: string
  if (ecart === 0) texte = 'Le crédit fait exactement ce qui reste à encaisser.'
  else if (ecart > 0) texte = `La banque a crédité ${credit} pour ${reste} restant à encaisser : seul ce reste s’encaisse.`
  else if (solde) {
    texte = `La banque a crédité ${credit} pour ${reste} restant à encaisser : ${formatMoney(-ecart / 100)} d’écart, ${SEUIL_DIT}. `
      + 'La facture s’encaisse en entier, comme la déclaration de TVA de l’application la compte.'
  } else texte = `Paiement partiel : ${credit} sur ${reste} restant à encaisser.`
  return avantLaFacture
    ? `${texte} Payé avant la date de la facture : un acompte, dont l’échéance de déclaration court depuis le paiement.`
    : texte
}

/**
 * Les encaissements que l'écran peut proposer — RIEN NE S'ÉCRIT SEUL : le cabinet choisit, complète (le moyen de
 * paiement, la date d'un chèque) et confirme. Deux sources (note de conception, § 3.5) :
 *   1. les paiements de la PIÈCE JUMELLE (`paiementsDesPieces` : ses mouvements rapprochés et ses parts de règlements
 *      groupés), à leur date et à leur montant — le reste entier quand la banque a crédité un peu moins, sous le seuil
 *      des frais, ou plus ; un paiement partiel au-delà ;
 *   2. les crédits du relevé que rien ne rattache encore à un encaissement vivant, datés du jour de la facture ou après,
 *      dont le montant fait le reste à l'écart des frais près — dans les deux sens —, sans le nom du client exigé : il
 *      ne fait que les classer.
 * Chacune est un encaissement que la base ACCEPTERAIT aujourd'hui (`refusEnregistrement`, sur sa répartition proposée) :
 * un paiement déjà enregistré, un mouvement daté de demain ou une facture qui ne reçoit rien ne se proposent pas. Les
 * propositions se jugent chacune seule : l'écran les recalcule après chaque enregistrement. La jumelle d'abord, dans
 * l'ordre de ses paiements ; puis le relevé, le plus petit écart d'abord, le client cité d'abord, puis par date.
 */
export function propositionsEncaissement(
  c: ContexteFacture,
  pieces: readonly PieceLue[],
  paiements: PaiementsDesPieces,
  mouvements: readonly MouvementPropose[],
  aujourdHui: string,
): PropositionEncaissement[] {
  const reste = resteAEncaisser(c)
  if (reste.resteCentimes <= 0) return []
  const f = c.facture
  const parId = new Map(mouvements.map((m) => [m.id, m]))
  const vus = new Set<string>()
  const piecesDuMouvement = new Map<string, string[]>()
  for (const [pieceId, liste] of paiements) {
    for (const p of liste) piecesDuMouvement.set(p.id, [...(piecesDuMouvement.get(p.id) ?? []), pieceId])
  }

  const proposer = (source: PropositionEncaissement['source'], m: MouvementPropose, creditCentimes: number): PropositionEncaissement | null => {
    // Un crédit qui passe le reste laisse un écart négatif, toujours sous le seuil : il solde la facture.
    const solde = ecartDeFrais(reste.resteCentimes - creditCentimes, reste.resteCentimes)
    const montantCentimes = solde ? reste.resteCentimes : creditCentimes
    // Un paiement négatif — un remboursement — n'a pas de répartition, et ne se propose pas.
    const repartition = repartitionProposee(montantCentimes, reste.parTaux)
    if (!repartition) return null
    const saisie: SaisieEncaissement = {
      date: m.date,
      montant: montantCentimes / 100,
      // Le moyen ne se propose pas, le cabinet le choisit ; il ne décide d'aucun autre refus.
      moyen: MOYENS_ENCAISSEMENT[0].moyen,
      ligneBancaireId: m.id,
      repartition: repartition.map((p) => ({ taux: p.taux, montant: p.centimes / 100 })),
    }
    if (refusEnregistrement(c, saisie, mouvements, aujourdHui)) return null
    const avantLaFacture = m.date < f.date_emission
    return {
      source,
      ligneBancaireId: m.id,
      date: m.date,
      montantCentimes,
      repartition,
      creditCentimes,
      ecartCentimes: creditCentimes - montantCentimes,
      solde,
      avantLaFacture,
      clientCite: tiersConfirmeParBanque(f.tiers_nom, libelleExploitable(m)),
      piecesPayees: [...(piecesDuMouvement.get(m.id) ?? [])].sort(),
      explication: explication(creditCentimes, reste.resteCentimes, solde, avantLaFacture),
    }
  }

  // Un mouvement de la jumelle reste à elle, même quand son paiement ne se propose pas — déjà enregistré, ou un
  // remboursement : le relevé ne le reproposera pas comme un crédit sans lien.
  const deLaJumelle: PropositionEncaissement[] = []
  for (const piece of piecesJumelles(c, pieces)) {
    for (const paiement of paiements.get(piece.id) ?? []) {
      const m = parId.get(paiement.id)
      if (!m || vus.has(m.id)) continue
      vus.add(m.id)
      const p = proposer('jumelle', m, centimes(paiement.montant))
      if (p) deLaJumelle.push(p)
    }
  }

  // Un mouvement qui justifie déjà un encaissement vivant, de cette facture ou d'une autre, ne se propose pas : il est
  // pris. Un encaissement retiré, ou annulé par une contre-passation vivante, l'a libéré. Un débit ne fait jamais le
  // reste à l'écart des frais près, et un mouvement d'un autre dossier, la base le refuserait : le jugement final les
  // écarte.
  const pris = new Set(c.encaissements
    .filter((e) => compte(e) && !annuleParUneContrePassation(e, c.encaissements))
    .map((e) => e.ligne_bancaire_id))
  const duReleve: PropositionEncaissement[] = []
  for (const m of mouvements) {
    if (vus.has(m.id) || pris.has(m.id) || classeAilleurs(m) || m.date < f.date_emission) continue
    const credit = centimes(m.montant)
    if (!ecartDeFrais(Math.abs(credit - reste.resteCentimes), reste.resteCentimes)) continue
    const p = proposer('releve', m, credit)
    if (p) duReleve.push(p)
  }
  duReleve.sort((a, b) => Math.abs(a.ecartCentimes) - Math.abs(b.ecartCentimes)
    || Number(b.clientCite) - Number(a.clientCite)
    || a.date.localeCompare(b.date)
    || (a.ligneBancaireId < b.ligneBancaireId ? -1 : a.ligneBancaireId > b.ligneBancaireId ? 1 : 0))
  return [...deLaJumelle, ...duReleve]
}
