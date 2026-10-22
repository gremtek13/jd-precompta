import { SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF } from './alignementBanque'
import { libelleExploitable, tiersConfirmeParBanque } from './appariementBanque'
import { montantsDuDocument, TAUX_ADMIS } from './factureCii'
import { anneeDe, dernierJourDuMois, formatDate, formatMoney, moisDe } from './format'
import { frequenceDesPaiements, periodeDe } from './periodesEreporting'
import type { PaiementsDesPieces } from './rattachement'
import { DEBUT_EMISSION_PME } from './statutTva'
import { STATUTS_ANNULATION_SUPERPDP, annuleeSurSaPlateforme, type StatutPlateformeLu } from './transmissionsFactures'
import { exerciceQuiFige, frontiereDeValidation } from './validationExercice'
import { jumellesDeLaFacture, type PiecePourJumelle } from './ventesJumelles'
import type {
  EncaissementFacture, EncaissementFactureTaux, EtatTransmission, FactureEmise, FactureLigne, FactureSuperpdpEvent,
  LigneBancaire, MoyenEncaissement, StatutTva, TransmissionEncaissement, TransmissionFacture,
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
//   - l'échéance de sa déclaration (`echeanceDeDeclaration`), que lib/periodesEreporting.ts calcule depuis l'étape e1 ;
//   - les encaissements que la pièce jumelle et le relevé permettent de proposer (`propositionsEncaissement`) ;
//   - depuis l'étape d4, ce qui est déclaré (`encaissementsDeclares`), où le statut se déclare
//     (`plateformeDeLaDeclaration`), ce que la déclaration hors application et la contre-passation refuseraient
//     (`refusDeclaration`, `refusContrePassation`) et ce que la contre-passation écrira (`contrePassationDe`) ;
//   - depuis l'étape d7 (migration cycle_de_vie_des_factures_emises), qu'un refus (210) ou un rejet (213) LU SUR LA
//     PLATEFORME DU CLIENT (`statuts_factures_recus`) fait refuser l'encaissement et la déclaration comme un refus de
//     Super PDP, sous les mêmes mots ;
//   - depuis l'espace client (étape P2, migration ventes_du_client, `VENTES_DU_CLIENT_EXPORTEES`), qu'un mouvement ne se
//     désigne qu'avec le droit « Banque » (`gereLaBanque`, obligatoire) : le client qui ne porte que « Ventes » encaisse
//     sans mouvement, et rien ne lui est proposé ;
//   - depuis le chantier EC-Q3, étape VF2 (migrations source_de_la_vente et encaissements_de_la_vente_facturee), ce que la
//     base refuse DE PLUS pour une facture SOURCE de sa vente — la frontière d'un exercice validé, un mouvement déjà
//     classé, les plafonds nets de ses avoirs, la contre-passation qui cite le débit qui défait l'encaissement —, et ce
//     que refusent les trois fonctions neuves du cabinet (rattacher un encaissement à son mouvement, classer un mouvement
//     par ses encaissements, retirer ce classement) et la garde des mouvements réservés (G2) : en fin de module ;
//   - depuis l'étape VF5b, ce que la fenêtre des encaissements lit d'une facture source : son reste net des avoirs, les
//     débits qu'une contre-passation cite, la frontière que le client ne lit pas, le geste qui rendrait un mouvement
//     inclassable — tout à la fin ;
//   - depuis la migration contre_passation_banque (chantier EC-Q3, ligne 28.65), que la contre-passation ne cite un débit
//     qu'avec le droit « Banque », comme un encaissement ne désigne un mouvement qu'avec lui : le même refus, au même rang
//     (`refusContrePassationVente`, qui reçoit ce droit).
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

/** La facture, telle que les refus, le reste et les propositions la lisent — son numéro et son émetteur figé pour
 * reconnaître sa pièce jumelle par son identité (lib/ventesJumelles.ts), et sa source (étape VF2) : une facture source de
 * sa vente reçoit des refus de plus (`refusEnregistrementVente`). */
export type FacturePourEncaissement = Pick<FactureEmise,
  'id' | 'dossier_id' | 'statut' | 'type' | 'numero' | 'date_emission' | 'emetteur_siret' | 'montant_ht' | 'montant_tva'
  | 'montant_ttc' | 'superpdp_invoice_id' | 'tiers_nom' | 'source_de_la_vente'>

/** Une ligne de facture : son `facture_id` la rattache, et le module ne garde que celles de SA facture. */
export type LigneDeFacture = Pick<FactureLigne, 'facture_id' | 'ordre' | 'designation' | 'quantite' | 'prix_unitaire_ht' | 'taux_tva'>

/** Une transmission de la facture : son canal dit si son flux est l'identifiant de Super PDP (lib/ventesJumelles.ts). */
export type TransmissionLue = Pick<TransmissionFacture, 'facture_id' | 'canal' | 'etat' | 'hote' | 'flux_id'>
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

/**
 * Ce que le reste lit : la facture — son identifiant, son type et sa source, rien d'autre (la fiche d'un crédit, étape
 * VF5c, n'en lit pas davantage) —, ses lignes, le registre et ses parts.
 */
export type ContexteDuReste = Pick<ContexteFacture, 'lignes' | 'encaissements' | 'parts'> & {
  facture: Pick<FacturePourEncaissement, 'id' | 'type' | 'source_de_la_vente'>
}

/** Ce qui reste à encaisser de la facture, en tout et par taux, NET des encaissements retirés et des annulations. */
export function resteAEncaisser(c: ContexteDuReste): ResteAEncaisser {
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

// LES VENTES DU CLIENT SONT-ELLES DANS L'EXPORT ? (espace client, étape P2.) La migration `ventes_du_client` fait
// accepter par les fonctions des encaissements le client qui porte le droit « Ventes », et donne à
// `enregistrer_encaissement` un refus NEUF, au rang 2 : le mouvement bancaire ne se désigne qu'avec le droit « Banque ».
// Appliquée en production le 10/10/2026 (20261010123950), puis `ventes_du_client_facturation` (20261010130643) ;
// l'export porte les deux depuis. Ce module dit ce refus à son rang (`mouvement_sans_banque`) — sans effet sur le cabinet,
// qui porte les deux droits —, et encaissementsFactures.test.ts le confronte au texte de la fonction : au texte entier
// tant que ceci est `true`, et le test vire au rouge si l'export et ce drapeau cessent de dire la même chose.
export const VENTES_DU_CLIENT_EXPORTEES: boolean = true

// Les refus d'`enregistrer_encaissement`, DANS SON ORDRE ET SOUS SES MOTS (sa dernière définition exportée, celle de la
// migration encaissements_de_la_vente_facturee) : l'écran les dit avant le clic, et un refus de la base arrivé après — une
// écriture concurrente — dit la même chose. Le modèle est le texte de la fonction, apostrophes droites comprises : chaque
// « % » y reçoit une valeur, « %% » s'y écrit « % ». encaissementsFactures.test.ts extrait les messages de la fonction et
// les confronte à cette liste, ordre et texte. `venteFacturee` marque les refus qui ne visent qu'une facture SOURCE de sa
// vente (étape VF2) : pour toute autre facture, la base ne les oppose jamais, et les plafonds sont ceux d'hier.
export const REFUS_ENREGISTREMENT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  // Depuis la migration ventes_du_client (`VENTES_DU_CLIENT_EXPORTEES`) : juste après l'accès, avant la facture.
  {
    cle: 'mouvement_sans_banque',
    modele: "Le mouvement bancaire d'un encaissement ne se désigne qu'avec le droit « Banque » sur ce dossier : sans lui, l'encaissement s'enregistre sans mouvement.",
  },
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
  // Rang 11 : son encaissement compte dans l'exercice de sa date, que la validation fige.
  { cle: 'frontiere', modele: "% : un encaissement de cette facture ne s'y date plus.", venteFacturee: true },
  { cle: 'montant_positif', modele: 'Un encaissement est un montant positif.' },
  { cle: 'montant_centime', modele: 'Un encaissement se compte au centime.' },
  { cle: 'moyen_inconnu', modele: 'Le moyen de paiement est inconnu.' },
  { cle: 'mouvement_hors_dossier', modele: "Ce mouvement n'est pas un mouvement de ce dossier." },
  { cle: 'mouvement_debit', modele: "Un encaissement se justifie par un crédit : ce mouvement n'en est pas un." },
  // Rang 17 (G2) : le mouvement d'un encaissement d'une facture source ne porte rien d'autre, et n'est pas encore classé.
  {
    cle: 'mouvement_classe',
    modele: "Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — retirer d'abord ce classement.",
    venteFacturee: true,
  },
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
  // Rangs 27 et 29 (EC3-Q10) : à la place des plafonds bruts, ceux d'une facture source, nets de ses avoirs validés.
  {
    cle: 'plafond_facture_net',
    modele: "L'encaissement dépasserait le total de la facture, net de ses avoirs : il reste % € à encaisser.",
    venteFacturee: true,
  },
  { cle: 'plafond_taux', modele: "À % %%, l'encaissement dépasserait ce que la facture porte : il reste % € à encaisser à ce taux." },
  {
    cle: 'plafond_taux_net',
    modele: "À % %%, l'encaissement dépasserait ce que la facture porte, net de ses avoirs : il reste % € à encaisser à ce taux.",
    venteFacturee: true,
  },
] as const

export type CleRefusEnregistrement = (typeof REFUS_ENREGISTREMENT)[number]['cle']

// Les refus de `retirer_encaissement`, de même ; les deux derniers pour une facture source seulement.
export const REFUS_RETRAIT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.' },
  { cle: 'deja_retire', modele: 'Cet encaissement est déjà retiré.' },
  { cle: 'declare', modele: "Un encaissement déclaré ne se retire pas : il se contre-passe, et l'annulation se déclare à son tour." },
  { cle: 'annule', modele: "Cet encaissement est annulé par une contre-passation : retirez d'abord celle-ci." },
  { cle: 'frontiere', modele: '% : cet encaissement ne se retire plus.', venteFacturee: true },
  {
    cle: 'mouvement_classe',
    modele: "Le mouvement dont dépend cet encaissement est classé : le cabinet retire d'abord ce classement.",
    venteFacturee: true,
  },
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

// Un encaissement que la contre-passation vivante d'un autre annule — avec ou sans mouvement : il ne se retire plus, et ne
// se contre-passe pas deux fois (les refus de `retirer_encaissement` et d'`annuler_encaissement`).
function annuleParUneContrePassation(e: Pick<EncaissementLu, 'id'>, encaissements: readonly EncaissementLu[]): boolean {
  return encaissements.some((a) => a.annule_id === e.id && compte(a))
}

/**
 * L'encaissement JUSTIFIE-T-IL le mouvement qu'il cite (`encaissement_justifie_son_mouvement` en base, depuis la migration
 * encaissements_de_la_vente_facturee) ? Oui, tant qu'aucune contre-passation vivante SANS MOUVEMENT ne l'annule : celle-là
 * dit que l'encaissement n'a pas eu lieu sur ce mouvement — une erreur, une somme jamais reçue. Une contre-passation qui
 * cite un DÉBIT dit au contraire que l'argent est venu, puis reparti (le chèque revenu impayé) : l'encaissement reste
 * justifié par son crédit. Seule la contre-passation d'une facture source cite un mouvement : pour toute autre facture, le
 * prédicat dit exactement ce que disait hier « annulé par une contre-passation vivante ».
 */
export function justifieSonMouvement(e: Pick<EncaissementLu, 'id'>, encaissements: readonly EncaissementLu[]): boolean {
  return !encaissements.some((c) => c.annule_id === e.id && compte(c) && c.ligne_bancaire_id == null)
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
 * Ce que `enregistrer_encaissement` refuserait de cette saisie, pour une facture qui n'est PAS source de sa vente : le
 * PREMIER refus, dans l'ordre de la base et sous son message, ou null quand elle l'accepterait. `mouvements` : ceux du
 * dossier, où se cherche le mouvement cité ; `aujourdHui` : la date du jour À PARIS (`aujourdHuiAParis`), celle que la
 * base lit ; `gereLaBanque` : le droit « Banque » de qui saisit sur ce dossier (`gere_la_banque` en base) — le cabinet le
 * porte toujours, un client s'il lui est coché. Passé sans valeur par défaut : un écran du client qui l'oublierait
 * laisserait désigner un mouvement que la base refuse. Pour une facture SOURCE (étape VF2), la base refuse davantage, que
 * seule `refusEnregistrementVente` dit : elle lit ce qui classe les mouvements, les exercices validés et les avoirs.
 */
export function refusEnregistrement(
  c: ContexteFacture,
  s: SaisieEncaissement,
  mouvements: readonly MouvementLu[],
  aujourdHui: string,
  gereLaBanque: boolean,
): RefusEncaissement<CleRefusEnregistrement> | null {
  return jugerEnregistrement(c, s, mouvements, aujourdHui, gereLaBanque, null)
}

/**
 * Ce que `enregistrer_encaissement` refuserait de cette saisie, la facture source ou non : les refus de
 * `refusEnregistrement`, et, pour une facture SOURCE de sa vente (`facture.source_de_la_vente`), la frontière d'un
 * exercice validé (rang 11), un mouvement déjà classé (rang 17) et les plafonds nets de ses avoirs validés (rangs 27 et
 * 29, à la place des plafonds bruts). `mouvements` : ceux du dossier, avec ce qui les classe ; `vente` : les exercices
 * validés et les factures du dossier — les lignes des avoirs de la facture dans `c.lignes`. Pour une facture qui n'est
 * pas source, la même chose que `refusEnregistrement`. La fenêtre des encaissements le lit depuis l'étape VF5b.
 */
export function refusEnregistrementVente(
  c: ContexteFacture,
  s: SaisieEncaissement,
  mouvements: readonly MouvementClasse[],
  aujourdHui: string,
  gereLaBanque: boolean,
  vente: ContexteVente,
): RefusEncaissement<CleRefusEnregistrement> | null {
  return jugerEnregistrement(c, s, mouvements, aujourdHui, gereLaBanque, vente)
}

// Le jugement d'`enregistrer_encaissement`, dans son ordre. `vente` nul : sans ce qu'une facture source demande de lire
// de plus — la facture est jugée comme une facture qui n'est pas source.
function jugerEnregistrement(
  c: ContexteFacture,
  s: SaisieEncaissement,
  mouvements: readonly (MouvementLu | MouvementClasse)[],
  aujourdHui: string,
  gereLaBanque: boolean,
  vente: ContexteVente | null,
): RefusEncaissement<CleRefusEnregistrement> | null {
  // Juste après l'accès (refus 1, que seule la base juge), avant la facture : le mouvement qui prouve l'encaissement est
  // une donnée de la banque, et sans le droit « Banque » il ne se désigne pas — l'encaissement s'enregistre sans lui
  // (espace client, étape P2 ; migration ventes_du_client).
  if (s.ligneBancaireId != null && !gereLaBanque) return refus('mouvement_sans_banque')
  const surLaFacture = refusDeLaFacture(c)
  if (surLaFacture) return surLaFacture
  const f = c.facture
  const source = vente != null && f.source_de_la_vente

  // 7. La date : renseignée, pas avant l'an 2000, pas dans l'avenir ; pour une facture source, pas dans un exercice que
  // la validation fige (rang 11 : son encaissement compte dans l'exercice de sa date).
  if (s.date == null || !dateCivile(s.date)) return refus('date_absente')
  if (s.date < DATE_PLANCHER) return refus('date_avant_2000')
  if (s.date > aujourdHui) return refus('date_future', formatDate(aujourdHui))
  if (vente != null && source) {
    const fige = dateFigeePourLaVente(s.date, vente.anneesValidees)
    if (fige) return refus('frontiere', fige)
  }

  // 8. Un montant positif, au centime. NaN et l'infini ne sont pas positifs et bornés — ni pour la base, pour qui NaN
  // dépasse tout nombre.
  if (s.montant == null || !(s.montant > 0 && s.montant < BORNE_MONTANT_EUROS)) return refus('montant_positif')
  const montant = centimesExacts(s.montant)
  if (montant == null) return refus('montant_centime')

  // 9. Un moyen de paiement connu — aucun n'est nul.
  if (!MOYENS_ENCAISSEMENT.some((m) => m.moyen === s.moyen)) return refus('moyen_inconnu')

  // 10. Le mouvement, s'il en cite un : de ce dossier, un crédit — pour une facture source, que rien ne classe encore (rang
  // 17) —, qui ne justifie pas déjà un encaissement de cette facture, et dont les encaissements — de toutes les factures :
  // un virement peut en régler plusieurs — ne le dépasseraient pas au-delà de l'écart que des frais expliquent. Ce qu'un
  // mouvement justifie se lit comme la base le lit depuis l'étape VF2 (`justifieSonMouvement`) : pour un mouvement
  // qu'aucune contre-passation ne cite, comme hier.
  if (s.ligneBancaireId != null) {
    const mouvement = mouvements.find((m) => m.id === s.ligneBancaireId && m.dossier_id === c.dossierId)
    if (!mouvement) return refus('mouvement_hors_dossier')
    if (mouvement.montant <= 0) return refus('mouvement_debit')
    if (source && !mouvementLibre(mouvement as MouvementClasse)) return refus('mouvement_classe')
    const justifies = c.encaissements.filter((e) =>
      e.ligne_bancaire_id === mouvement.id && compte(e) && justifieSonMouvement(e, c.encaissements))
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
  // Le total de la facture est son en-tête, au centime depuis le refus 6 ; le TTC d'un taux, celui de ses lignes. Pour une
  // facture source, l'un et l'autre moins ce que ses avoirs validés créditent (EC3-Q10, rangs 27 et 29), tel que leurs
  // lignes le transmettent.
  const comptes = c.encaissements.filter((e) => e.facture_id === f.id && compte(e))
  const deja = comptes.reduce((total, e) => total + centimes(e.montant), 0)
  const credites = vente != null && source ? creditesDesAvoirs(f.id, c.lignes, vente) : new Map<number, number>()
  const credite = [...credites.values()].reduce((total, x) => total + x, 0)
  const ttc = (centimesExacts(f.montant_ttc) as number) - credite
  if (deja + montant > ttc) {
    return refus(source ? 'plafond_facture_net' : 'plafond_facture', euroCommeLaBase(Math.max(ttc - deja, 0)))
  }
  const ids = new Set(comptes.map((e) => e.id))
  const ttcDesTaux = new Map(ttcParTaux(f, c.lignes).map((t) => [t.taux, t.ttcCentimes]))
  for (const [i, p] of r.entries()) {
    // Un taux des lignes de la facture : le refus 11 l'a vérifié.
    const ttcDuTaux = (ttcDesTaux.get(p.taux) as number) - (credites.get(p.taux) ?? 0)
    const dejaDuTaux = c.parts.filter((x) => ids.has(x.encaissement_id) && x.taux === p.taux)
      .reduce((total, x) => total + centimes(x.montant), 0)
    if (dejaDuTaux + parts[i] > ttcDuTaux) {
      return refus(source ? 'plafond_taux_net' : 'plafond_taux', tauxCommeLaBase(p.taux),
        euroCommeLaBase(Math.max(ttcDuTaux - dejaDuTaux, 0)))
    }
  }
  return null
}

function refusR(cle: CleRefusRetrait, ...valeurs: string[]): RefusEncaissement<CleRefusRetrait> {
  const { modele } = REFUS_RETRAIT.find((r) => r.cle === cle) as (typeof REFUS_RETRAIT)[number]
  return { cle, message: remplirModele(modele, valeurs) }
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

/**
 * Ce que `retirer_encaissement` refuserait, la facture source ou non : les refus de `refusRetrait`, puis, pour un
 * encaissement d'une facture SOURCE de sa vente, sa date que la frontière d'un exercice validé fige (rang 6), et le
 * mouvement dont il dépend — le sien, ou, pour une contre-passation sans mouvement, celui de l'encaissement qu'elle
 * annule — classé (rang 7 : le cabinet retire d'abord ce classement ; par ses encaissements, le retrait changerait ce
 * qu'il justifie ; autrement, le retrait de la contre-passation le ferait justifier de nouveau l'encaissement, en plus de
 * son classement). `mouvements` : ceux du dossier, lus en entier, avec ce qui les classe.
 */
export function refusRetraitVente(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementPourContrePassation[],
  declares: ReadonlySet<string>,
  mouvements: readonly MouvementClasse[],
  vente: ContexteVente,
): RefusEncaissement<CleRefusRetrait> | null {
  const hier = refusRetrait(dossierId, encaissementId, encaissements, declares)
  if (hier) return hier
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId) as EncaissementPourContrePassation
  if (!factureSource(e.facture_id, vente)) return null
  const fige = dateFigeePourLaVente(e.date_encaissement, vente.anneesValidees)
  if (fige) return refusR('frontiere', fige)
  const ligne = e.ligne_bancaire_id ?? encaissements.find((x) => x.id === e.annule_id)?.ligne_bancaire_id ?? null
  const mouvement = ligne == null ? undefined : mouvements.find((m) => m.id === ligne)
  if (mouvement && !mouvementLibre(mouvement)) return refusR('mouvement_classe')
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
  // Depuis la migration contre_passation_banque (chantier EC-Q3, ligne 28.65) : juste après l'accès, avant toute lecture —
  // le débit qu'une contre-passation cite est une donnée de la banque, et sans le droit « Banque » il ne se cite pas. Le
  // refus du rang 2 d'`enregistrer_encaissement`, sous ses mots et son code (`mouvement_sans_banque` de
  // REFUS_ENREGISTREMENT) ; `contrePassationBanque` le marque : la base ne l'oppose qu'à un débit cité.
  {
    cle: 'mouvement_sans_banque',
    modele: "Le mouvement bancaire d'un encaissement ne se désigne qu'avec le droit « Banque » sur ce dossier : sans lui, l'encaissement s'enregistre sans mouvement.",
    contrePassationBanque: true,
  },
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
  // Depuis la migration encaissements_de_la_vente_facturee (étape VF2) : la frontière, pour une facture source (rang 12) ;
  // puis, quand la contre-passation cite le DÉBIT qui défait l'encaissement (le cinquième paramètre), ce qui le refuse
  // (rangs 15 à 19) ; sans débit, le mouvement de l'encaissement d'une facture source classé par ses encaissements (20).
  { cle: 'frontiere', modele: "% : une contre-passation ne s'y date plus.", venteFacturee: true },
  { cle: 'motif_absent', modele: 'Le motif de la contre-passation est à renseigner.' },
  { cle: 'motif_trop_long', modele: 'Le motif de la contre-passation dépasse 2 000 caractères.' },
  {
    cle: 'mouvement_non_source',
    modele: "Seule la contre-passation d'une facture source de sa vente cite le mouvement qui défait l'encaissement.",
    venteFacturee: true,
  },
  { cle: 'mouvement_hors_dossier', modele: "Ce mouvement n'est pas un mouvement de ce dossier.", venteFacturee: true },
  { cle: 'mouvement_credit', modele: "Une contre-passation se justifie par un débit : ce mouvement n'en est pas un.", venteFacturee: true },
  {
    cle: 'mouvement_classe',
    modele: "Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — retirer d'abord ce classement.",
    venteFacturee: true,
  },
  {
    cle: 'mouvement_depasse',
    modele: "Ce mouvement de % € justifierait % € de contre-passations : l'écart dépasse ce que des frais bancaires expliquent.",
    venteFacturee: true,
  },
  {
    cle: 'mouvement_encaissement_classe',
    modele: "Le mouvement de l'encaissement contre-passé est classé par ses encaissements : la contre-passation cite le débit qui défait l'encaissement, ou le cabinet retire d'abord ce classement.",
    venteFacturee: true,
  },
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
 * Ce que `annuler_encaissement` refuserait, depuis la migration encaissements_de_la_vente_facturee (étape VF2), qui lui
 * donne un CINQUIÈME paramètre : `ligneBancaireId`, le DÉBIT qui défait l'encaissement (le chèque revenu impayé, la somme
 * rendue), nul pour la contre-passation d'hier. Dans l'ordre de la base : depuis la migration contre_passation_banque, un
 * débit cité sans le droit « Banque » (rang 2, avant toute lecture) ; les refus de `refusContrePassation` jusqu'à la
 * date ; pour une facture source, la frontière d'un exercice validé (rang 12) ; le motif ; s'il cite un mouvement, une
 * facture qui n'est pas source, un mouvement d'un autre dossier, un crédit, un mouvement déjà classé, des
 * contre-passations qui dépasseraient le débit au-delà des frais (rangs 15 à 19) ; sans mouvement, pour une facture
 * source, le mouvement de l'encaissement classé par ses encaissements (rang 20). Sans débit cité et pour une facture qui
 * n'est pas source, la même chose que `refusContrePassation`, quel que soit le droit « Banque ». `mouvements` : ceux du
 * dossier, lus en entier, avec ce qui les classe ; `gereLaBanque` : le droit « Banque » de qui saisit sur ce dossier
 * (`gere_la_banque` en base), comme `refusEnregistrement` le reçoit — passé sans valeur par défaut : un écran du client
 * qui l'oublierait laisserait citer un débit que la base refuse.
 */
export function refusContrePassationVente(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementPourContrePassation[],
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[],
  date: string | null,
  motif: string | null,
  aujourdHui: string,
  ligneBancaireId: string | null,
  mouvements: readonly MouvementClasse[],
  gereLaBanque: boolean,
  vente: ContexteVente,
): RefusEncaissement<CleRefusContrePassation> | null {
  // Juste après l'accès (refus 1, que seule la base juge), avant toute lecture : le débit cité est une donnée de la
  // banque — sans le droit « Banque », rien ne se dit de lui ni de l'encaissement (migration contre_passation_banque).
  if (ligneBancaireId != null && !gereLaBanque) return refusC('mouvement_sans_banque')
  // Les refus d'hier jusqu'à la date — un motif valable à la place du sien : la base juge le motif APRÈS la frontière.
  const avantLeMotif = refusContrePassation(dossierId, encaissementId, encaissements, declarations, date, 'motif', aujourdHui)
  if (avantLeMotif) return avantLeMotif
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId) as EncaissementPourContrePassation
  const source = factureSource(e.facture_id, vente)
  if (source) {
    // La date est une date civile, que les refus d'hier ont jugée.
    const fige = dateFigeePourLaVente(date as string, vente.anneesValidees)
    if (fige) return refusC('frontiere', fige)
  }
  if (motif == null || videPourLaBase(motif)) return refusC('motif_absent')
  if (caracteres(motif) > LONGUEUR_MAX_TEXTE) return refusC('motif_trop_long')
  if (ligneBancaireId != null) {
    if (!source) return refusC('mouvement_non_source')
    const mouvement = mouvements.find((m) => m.id === ligneBancaireId && m.dossier_id === dossierId)
    if (!mouvement) return refusC('mouvement_hors_dossier')
    if (mouvement.montant >= 0) return refusC('mouvement_credit')
    if (!mouvementLibre(mouvement)) return refusC('mouvement_classe')
    // Comme pour un crédit, en valeur absolue : les contre-passations qui citent ce débit — toutes, non retirées —, et
    // celle-ci, ne le dépassent que de ce que des frais expliquent.
    const total = encaissements.filter((x) => x.ligne_bancaire_id === mouvement.id && compte(x))
      .reduce((somme, x) => somme + centimes(x.montant), 0) - centimes(e.montant)
    const debit = Math.abs(centimes(mouvement.montant))
    if (!ecartDeFrais(Math.abs(total) - debit, Math.abs(total))) {
      return refusC('mouvement_depasse', euroCommeLaBase(debit), euroCommeLaBase(Math.abs(total)))
    }
  } else if (source && e.ligne_bancaire_id != null) {
    if (mouvements.find((m) => m.id === e.ligne_bancaire_id)?.encaissements_de_factures) {
      return refusC('mouvement_encaissement_classe')
    }
  }
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

/**
 * Quand l'encaissement doit être déclaré (CGI, ann. II, art. 242 nonies P, III ; BOI-TVA-DECLA-20-30-60, §170 à §210).
 * Au réel, chaque mois : les données doivent parvenir à l'administration dans les dix jours qui suivent la fin du mois
 * (§190) — le 10 du mois suivant. En franchise en base, par bimestre civil (janvier-février, mars-avril…) : entre le
 * 25 et la fin du mois qui suit le bimestre (§210), à un jour qui dépend de l'entreprise et que l'application ne connaît
 * pas — elle retient le 25, la borne prudente. Le régime simplifié, entre le 25 et la fin du mois suivant (§200), finit
 * au 01/01/2027, avant que l'obligation ne commence pour une PME : le 10 reste la borne prudente pour tout redevable.
 * Null pour un dossier exonéré ou au statut à préciser, et pour une date qui n'en est pas une. Sur le calendrier civil :
 * le fuseau de qui regarde n'y change rien.
 *
 * LA FRÉQUENCE, LA PÉRIODE ET L'ÉCHÉANCE VIENNENT DE lib/periodesEreporting.ts (étape e1) : le statut « Encaissée » et
 * l'e-reporting des paiements se déclarent au même rythme, et une seule source le dit. Le statut « Encaissée » est sans
 * objet pour un dossier exonéré (`obligationEncaissee`) : ce que le module propose à un exonéré pour ses éventuelles
 * prestations taxables ne vaut pas ici.
 */
export function echeanceDeDeclaration(dateEncaissement: string, statutTva: StatutTva | null): EcheanceDeclaration | null {
  if (statutTva !== 'redevable' && statutTva !== 'franchise') return null
  const frequence = frequenceDesPaiements(statutTva)
  const periode = frequence == null ? null : periodeDe(dateEncaissement, frequence.frequence)
  if (frequence == null || periode == null) return null
  const date = periode.echeance
  return {
    frequence: frequence.frequence === 'bimestre' ? 'bimestrielle' : 'mensuelle',
    periodeDebut: periode.debut,
    periodeFin: periode.fin,
    date,
    libelle: `Paiements ${periode.libelleDe} : à déclarer au plus tard le ${formatDate(date)}`
      + `${periode.prudence ? ` (${periode.prudence})` : ''}.`,
  }
}

// ── Les propositions ──────────────────────────────────────────────────────────────────────────────────────────────────

export type PieceLue = PiecePourJumelle

/**
 * La PIÈCE JUMELLE : la même vente, revenue comme pièce du dossier de la plateforme du client ou de Super PDP. Le pont
 * de la ligne 28.6 la reconnaît (lib/ventesJumelles.ts) : par le flux qui l'a transmise, par l'identifiant de Super PDP
 * — celui de la facture, ou celui que sa transmission a gardé —, ou par l'identité que son original dit (numéro, SIREN
 * figé, année : règle G1.42). Rien d'autre ne relie une facture émise à une pièce : ni un nom, ni un montant. Une pièce
 * dont les preuves se contredisent n'est la jumelle de rien.
 */
export function piecesJumelles(c: Pick<ContexteFacture, 'facture' | 'transmissions'>, pieces: readonly PieceLue[]): PieceLue[] {
  const jumelles = new Set(jumellesDeLaFacture(c.facture, c.transmissions, pieces).map((j) => j.pieceId))
  return pieces.filter((p) => jumelles.has(p.id))
}

/**
 * Un mouvement du relevé, tel que les propositions le lisent : son libellé, ce que le cabinet en a dit, et — depuis l'étape
 * VF5b — tout ce qui le classe (`MouvementClasse`) : pour une facture source, seul un mouvement LIBRE se propose.
 */
export type MouvementPropose = MouvementClasse & Pick<LigneBancaire, 'libelle' | 'libelle_brut'>

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
 * `gereLaBanque` : le droit « Banque » de qui saisit (`refusEnregistrement`) — sans lui, AUCUNE : chacune désigne un
 * mouvement, que la base refuserait (espace client, étape P2).
 *
 * `vente` (étape VF5b, sans valeur par défaut) : chaque proposition se juge par `refusEnregistrementVente`, qui rend pour une
 * facture qui n'est pas source exactement ce que rendait `refusEnregistrement` — rien n'y change. Pour une facture SOURCE de
 * sa vente : le reste est NET de ses avoirs validés (`resteAEncaisserVente`, le plafond de la base), et seuls des
 * mouvements LIBRES se proposent — par le jugement même de la base (`refusEnregistrementVente`, rang 17 : un mouvement que
 * rien ne classe encore), jamais par une règle recopiée ici. La pièce jumelle ne propose donc plus ses paiements : chacun
 * est un mouvement rapproché d'elle, ou un règlement groupé, que ce rang refuse (la vente se compte par la facture ; G4 le
 * figera à l'étape VF6).
 */
export function propositionsEncaissement(
  c: ContexteFacture,
  pieces: readonly PieceLue[],
  paiements: PaiementsDesPieces,
  mouvements: readonly MouvementPropose[],
  aujourdHui: string,
  gereLaBanque: boolean,
  vente: ContexteVente,
): PropositionEncaissement[] {
  if (!gereLaBanque) return []
  const reste = resteAEncaisserVente(c, vente)
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
    if (refusEnregistrementVente(c, saisie, mouvements, aujourdHui, gereLaBanque, vente)) return null
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
  // pris. Un encaissement retiré, ou annulé par une contre-passation vivante sans mouvement, l'a libéré
  // (`justifieSonMouvement`). Un débit ne fait jamais le reste à l'écart des frais près, et un mouvement d'un autre
  // dossier, la base le refuserait : le jugement final les écarte.
  const pris = new Set(c.encaissements
    .filter((e) => compte(e) && justifieSonMouvement(e, c.encaissements))
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

// ── La facture validée, source de sa vente (chantier EC-Q3, étape VF2) ──────────────────────────────────────────────
//
// LA DÉCISION DU CABINET DU 18/10/2026 (EC-Q3) : une facture validée dans l'application devient la SOURCE de sa vente — ses
// encaissements la compteront (étape VF3), et non plus sa pièce jumelle. Les deux migrations de l'étape VF2
// (`source_de_la_vente` et `encaissements_de_la_vente_facturee`, en base et dans l'export) fixent la source à la
// validation (lib/sourceDeLaVente.ts), RÉSERVENT à ses encaissements le mouvement qui les justifie (G2), le font CLASSER par
// eux, par le cabinet seul (G1), et donnent aux fonctions des encaissements leurs refus neufs (ci-dessus, `venteFacturee`).
// Cette section dit, AVANT le clic, dans l'ordre de la base et sous ses mots, l'accès excepté, ce que refusent les trois
// fonctions neuves du cabinet et la garde des mouvements. Depuis l'étape VF5a1, l'onglet Banque lit la garde
// (`refusDuClassementDuReleve`, par lib/mouvementsDesVentes.ts) ; depuis l'étape VF5b, la fenêtre des encaissements lit les
// jugements de la vente ; depuis l'étape VF5c, la fiche d'un crédit classe, retire un classement et rattache par
// `refusClassement`, `refusRetraitDuClassement` et `refusRattachement` ; les débits suivent (VF5d). Aucun dossier n'a
// basculé (étape VF8) : aucune facture n'est source, et ces refus ne se rencontrent pas encore.
// encaissementsFactures.test.ts confronte chaque liste au texte de sa fonction, codes compris, et
// supabase/essais/ventesFacturees.sql éprouve chaque refus en base.

/** Un mouvement tel que les refus d'une facture source le lisent : ce qui le classe, et s'il l'est par ses encaissements. */
export type MouvementClasse = MouvementLu & Pick<LigneBancaire,
  'statut' | 'piece_id' | 'cotisation_id' | 'categorie_id' | 'emprunt_id' | 'compte_bilan' | 'declaration_tva_id'
  | 'ventilee' | 'reglement_groupe' | 'prelevement_personnel' | 'encaissements_de_factures'>

/** Une facture du dossier, telle que ces refus la lisent : sa source, son numéro, et la facture que corrige un avoir. */
export type FactureDuDossier = Pick<FactureEmise,
  'id' | 'dossier_id' | 'numero' | 'type' | 'statut' | 'facture_origine_id' | 'source_de_la_vente'>

/**
 * Ce qu'une facture source demande de lire de plus que l'écran d'hier — lu EN ENTIER, comme le reste : une liste partielle
 * ferait dire un refus faux, et l'écran qui n'a pas tout lu n'offre aucun geste.
 */
export interface ContexteVente {
  /**
   * Les années des exercices validés du dossier (`exercices_valides`) : la frontière, et la phrase d'`exercice_fige`. Côté
   * CLIENT, `'illisibles'` (`ANNEES_ILLISIBLES`, étape VF5b) : la table ne s'ouvre qu'au cabinet, et le module saute alors la
   * frontière — la base la jugera. Jamais une liste vide à la place : elle affirmerait qu'aucun exercice n'est validé.
   */
  anneesValidees: readonly number[] | typeof ANNEES_ILLISIBLES
  /**
   * Les factures du dossier, leur source comprise : celle d'un encaissement, et les avoirs validés d'une facture source,
   * dont le plafond net déduit ce que leurs LIGNES créditent — que `ContexteFacture.lignes` doit donc porter aussi.
   */
  factures: readonly FactureDuDossier[]
}

/** Un encaissement tel que la garde des mouvements l'ordonne : par sa création, puis son identifiant. */
export type EncaissementDuReleve = EncaissementLu & Pick<EncaissementFacture, 'cree_le'>

/**
 * Un mouvement LIBRE (`mouvement_libre` en base) : à traiter, que rien ne classe — ni pièce, ni cotisation, ni catégorie,
 * ni emprunt, ni compte de bilan, ni déclaration de TVA, ni ventilation, ni règlement groupé, ni ses encaissements —, ni
 * écarté, ni personnel. Le seul qu'un encaissement d'une facture source cite.
 */
export function mouvementLibre(m: Pick<MouvementClasse, Exclude<keyof MouvementClasse, keyof MouvementLu>>): boolean {
  return m.statut === 'non_rapprochee' && m.piece_id == null && m.cotisation_id == null && m.categorie_id == null
    && m.emprunt_id == null && m.compte_bilan == null && m.declaration_tva_id == null && !m.ventilee && !m.reglement_groupe
    && !m.prelevement_personnel && !m.encaissements_de_factures
}

function factureSource(factureId: string, vente: Pick<ContexteVente, 'factures'>): boolean {
  return vente.factures.some((f) => f.id === factureId && f.source_de_la_vente)
}

// La phrase de la base pour une date que la frontière d'un exercice validé fige (`exercice_fige`), ou rien — rien aussi
// quand les exercices validés ne se lisent pas (le client, étape VF5b) : la base juge alors seule.
function dateFigeePourLaVente(date: string, anneesValidees: ContexteVente['anneesValidees']): string | null {
  if (anneesValidees === ANNEES_ILLISIBLES) return null
  const frontiere = frontiereDeValidation(anneesValidees)
  return frontiere != null && date <= frontiere ? exerciceQuiFige(anneeDe(date), anneesValidees) : null
}

// Ce que les avoirs VALIDÉS d'une facture créditent, par taux et en centimes, tel que leurs lignes le transmettent — dans
// le sens du document : un avoir s'y lit en montants positifs (`montants_par_taux_facture` en base, EC3-Q10). Tous les
// taux de tous les avoirs : le plafond de la facture déduit leur somme, celui d'un taux ce qui est à ce taux.
function creditesDesAvoirs(factureId: string, lignes: readonly LigneDeFacture[], vente: Pick<ContexteVente, 'factures'>): Map<number, number> {
  const parTaux = new Map<number, number>()
  for (const a of vente.factures) {
    if (a.type !== 'avoir' || a.statut !== 'validee' || a.facture_origine_id !== factureId) continue
    for (const t of ttcParTaux(a, lignes)) parTaux.set(t.taux, (parTaux.get(t.taux) ?? 0) + t.ttcCentimes)
  }
  return parTaux
}

// Un texte comparé comme la base le compare sous `collate "C"`, ou comme elle compare un identifiant ou un instant écrit
// en ISO dans un même fuseau : octet par octet — jamais `localeCompare`, qui range la ponctuation autrement.
function ordreC(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** L'ordre de la garde des mouvements : par la création, puis l'identifiant, octet par octet. */
export function ordreDesEncaissements(a: Pick<EncaissementDuReleve, 'cree_le' | 'id'>, b: Pick<EncaissementDuReleve, 'cree_le' | 'id'>): number {
  return ordreC(a.cree_le, b.cree_le) || ordreC(a.id, b.id)
}

/** Une liste de refus d'une fonction ou d'une garde, avec le code de chacun (`using errcode`). */
type ListeAvecCodes = readonly { readonly cle: string; readonly modele: string; readonly code: string }[]

function refusDe<C extends string>(liste: ListeAvecCodes, cle: C, ...valeurs: string[]): RefusEncaissement<C> {
  const { modele } = liste.find((r) => r.cle === cle) as ListeAvecCodes[number]
  return { cle, message: remplirModele(modele, valeurs) }
}

// Les refus de `rattacher_mouvement_encaissement`, DANS SON ORDRE, SOUS SES MOTS ET SES CODES : un encaissement — ou une
// contre-passation — d'une facture source enregistré sans mouvement se rattache UNE FOIS, de nul à un mouvement, par le
// cabinet seul (`admin_du_dossier`) : le chèque remis avant son crédit, les encaissements d'un client sans « Banque »,
// l'impayé constaté au relevé.
export const REFUS_RATTACHEMENT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'retire', modele: 'Cet encaissement est retiré : il ne se rattache plus à un mouvement.', code: '22023' },
  { cle: 'deja_rattache', modele: "Cet encaissement cite déjà un mouvement : il ne se rattache qu'une fois.", code: '22023' },
  {
    cle: 'facture_non_source',
    modele: "Seul l'encaissement d'une facture source de sa vente se rattache après coup au mouvement qui le prouve.",
    code: '22023',
  },
  { cle: 'frontiere', modele: '% : cet encaissement ne se rattache plus à un mouvement.', code: '22023' },
  { cle: 'mouvement_absent', modele: 'Le mouvement à rattacher est à désigner.', code: '22023' },
  { cle: 'mouvement_hors_dossier', modele: "Ce mouvement n'est pas un mouvement de ce dossier.", code: '22023' },
  { cle: 'mouvement_debit', modele: "Un encaissement se justifie par un crédit : ce mouvement n'en est pas un.", code: '22023' },
  { cle: 'mouvement_credit', modele: "Une contre-passation se justifie par un débit : ce mouvement n'en est pas un.", code: '22023' },
  {
    cle: 'mouvement_classe',
    modele: "Ce mouvement est déjà classé : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien ne classe encore — retirer d'abord ce classement.",
    code: '22023',
  },
  { cle: 'mouvement_deja_pris', modele: 'Ce mouvement justifie déjà un encaissement de cette facture.', code: '22023' },
  {
    cle: 'mouvement_depasse',
    modele: "Ce mouvement de % € justifierait % € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
    code: '22023',
  },
  {
    cle: 'contre_passations_depassent',
    modele: "Ce mouvement de % € justifierait % € de contre-passations : l'écart dépasse ce que des frais bancaires expliquent.",
    code: '22023',
  },
  {
    cle: 'origine_classee',
    modele: "Le mouvement de l'encaissement contre-passé est classé : rattachée à un débit, la contre-passation le lui ferait justifier de nouveau — le cabinet retire d'abord ce classement.",
    code: '22023',
  },
  {
    cle: 'origine_depassee',
    modele: "Le mouvement de l'encaissement contre-passé, de % €, justifierait alors % € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.",
    code: '22023',
  },
] as const

export type CleRefusRattachement = (typeof REFUS_RATTACHEMENT)[number]['cle']

// Les refus de `classer_mouvement_par_encaissements`, de même : le cabinet classe un mouvement par les encaissements de
// factures sources qu'il justifie, quand ce qu'ils portent fait son montant à l'écart des frais près — la banque crédite un
// peu moins que les encaissements, ou débite un peu plus que les contre-passations, jamais l'inverse.
export const REFUS_CLASSEMENT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'mouvement_introuvable', modele: 'Mouvement introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'frontiere', modele: '% : ce mouvement ne change plus.', code: '22023' },
  { cle: 'deja_classe_par_ses_encaissements', modele: 'Ce mouvement est déjà classé par ses encaissements.', code: '22023' },
  { cle: 'deja_classe', modele: "Ce mouvement est déjà classé : retirer d'abord ce classement.", code: '22023' },
  {
    cle: 'aucun_encaissement',
    modele: "Ce mouvement ne justifie aucun encaissement d'une facture source de sa vente : il ne se classe pas par des encaissements.",
    code: '22023',
  },
  {
    cle: 'credit_non_fait',
    modele: 'Les encaissements que ce mouvement justifie font % € pour un crédit de % € : ce qui le dépasse reste à traiter.',
    code: '22023',
  },
  {
    cle: 'credit_ecart',
    modele: "Les encaissements que ce mouvement justifie font % € pour un crédit de % € : l'écart dépasse ce que des frais bancaires expliquent.",
    code: '22023',
  },
  {
    cle: 'debit_depasse',
    modele: 'Les contre-passations que ce mouvement justifie font % € pour un débit de % € : elles le dépassent.',
    code: '22023',
  },
  {
    cle: 'debit_ecart',
    modele: "Les contre-passations que ce mouvement justifie font % € pour un débit de % € : l'écart dépasse ce que des frais bancaires expliquent.",
    code: '22023',
  },
] as const

export type CleRefusClassement = (typeof REFUS_CLASSEMENT)[number]['cle']

// Les refus de `retirer_classement_par_encaissements` : le mouvement redevient à traiter, toujours réservé à ses
// encaissements (G2).
export const REFUS_RETRAIT_CLASSEMENT = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'mouvement_introuvable', modele: 'Mouvement introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'frontiere', modele: '% : ce mouvement ne change plus.', code: '22023' },
  { cle: 'non_classe', modele: "Ce mouvement n'est pas classé par ses encaissements.", code: '22023' },
] as const

export type CleRefusRetraitClassement = (typeof REFUS_RETRAIT_CLASSEMENT)[number]['cle']

// Les refus de la garde des mouvements (`garder_mouvement_reserve`, G2), dans l'ordre de son texte : les deux premiers
// tiennent le drapeau — il ne naît posé qu'à la restauration, et ne change que par les deux fonctions du cabinet — ; les
// deux derniers, ce que dit à l'avance `refusDuClassementDuReleve`, pour qui classerait le mouvement autrement : par la
// policy du cabinet comme par une fonction du relevé (affecter, ventiler, rapprocher, régler un groupe…).
export const REFUS_GARDE_MOUVEMENTS = [
  {
    cle: 'naissance_classee',
    modele: "Un mouvement ne naît pas classé par des encaissements : le cabinet l'y classe ensuite, par sa fonction.",
    code: '42501',
  },
  {
    cle: 'drapeau_hors_fonction',
    modele: "Un mouvement ne se classe par ses encaissements, et ne cesse de l'être, que par la fonction du cabinet.",
    code: '42501',
  },
  {
    cle: 'classe_par_ses_encaissements',
    modele: "Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d'abord celui-ci.",
    code: '23514',
  },
  {
    cle: 'reserve',
    modele: "Ce mouvement justifie un encaissement de la facture %, source de sa vente : il se classe par ses encaissements, et par rien d'autre.",
    code: '23514',
  },
] as const

export type CleRefusGardeMouvements = (typeof REFUS_GARDE_MOUVEMENTS)[number]['cle']

/**
 * Ce que `rattacher_mouvement_encaissement` refuserait : le PREMIER refus, dans l'ordre de la base et sous son message, ou
 * null — l'accès (refus 1), seule la base le juge : le cabinet seul rattache. Dans l'ordre : l'encaissement introuvable,
 * retiré, qui cite déjà un mouvement, d'une facture qui n'est pas source, daté d'un exercice que la frontière fige ; aucun
 * mouvement désigné, un mouvement d'un autre dossier, un débit pour un encaissement, un crédit pour une contre-passation,
 * un mouvement déjà classé ; pour un encaissement, un mouvement qui justifie déjà un encaissement de cette facture, puis
 * l'écart des frais sur ce qu'il justifierait — cet encaissement compris s'il le justifie ; pour une contre-passation,
 * l'écart des frais sur les contre-passations du débit, puis le mouvement de l'encaissement qu'elle annule — classé, ou
 * qu'il justifierait alors au-delà des frais : rattachée à son débit, elle cesse de dire que l'encaissement n'a pas eu
 * lieu sur lui, qui le justifie de nouveau. `encaissements` et `mouvements` : ceux du dossier, lus en entier.
 */
export function refusRattachement(
  dossierId: string,
  encaissementId: string,
  ligneBancaireId: string | null,
  encaissements: readonly EncaissementPourContrePassation[],
  mouvements: readonly MouvementClasse[],
  vente: ContexteVente,
): RefusEncaissement<CleRefusRattachement> | null {
  const refusA = (cle: CleRefusRattachement, ...valeurs: string[]) => refusDe(REFUS_RATTACHEMENT, cle, ...valeurs)
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId)
  if (!e) return refusA('encaissement_introuvable')
  if (!compte(e)) return refusA('retire')
  if (e.ligne_bancaire_id != null) return refusA('deja_rattache')
  if (!factureSource(e.facture_id, vente)) return refusA('facture_non_source')
  const fige = dateFigeePourLaVente(e.date_encaissement, vente.anneesValidees)
  if (fige) return refusA('frontiere', fige)
  if (ligneBancaireId == null) return refusA('mouvement_absent')
  const m = mouvements.find((x) => x.id === ligneBancaireId && x.dossier_id === dossierId)
  if (!m) return refusA('mouvement_hors_dossier')
  const contrePassation = e.annule_id != null
  if (!contrePassation && m.montant <= 0) return refusA('mouvement_debit')
  if (contrePassation && m.montant >= 0) return refusA('mouvement_credit')
  if (!mouvementLibre(m)) return refusA('mouvement_classe')
  const vivants = encaissements.filter((x) => compte(x))
  if (!contrePassation) {
    if (vivants.some((x) => x.ligne_bancaire_id === m.id && x.facture_id === e.facture_id && justifieSonMouvement(x, encaissements))) {
      return refusA('mouvement_deja_pris')
    }
    // Ce que le mouvement justifierait : ce qu'il justifie déjà, et cet encaissement s'il le justifie (une contre-passation
    // sans mouvement dit qu'il n'a pas eu lieu, et il ne pèse alors rien).
    const total = vivants.filter((x) => (x.ligne_bancaire_id === m.id || x.id === e.id) && justifieSonMouvement(x, encaissements))
      .reduce((somme, x) => somme + centimes(x.montant), 0)
    const credit = centimes(m.montant)
    if (!ecartDeFrais(total - credit, total)) return refusA('mouvement_depasse', euroCommeLaBase(credit), euroCommeLaBase(total))
    return null
  }
  const total = vivants.filter((x) => x.ligne_bancaire_id === m.id).reduce((somme, x) => somme + centimes(x.montant), 0)
    + centimes(e.montant)
  const debit = Math.abs(centimes(m.montant))
  if (!ecartDeFrais(Math.abs(total) - debit, Math.abs(total))) {
    return refusA('contre_passations_depassent', euroCommeLaBase(debit), euroCommeLaBase(Math.abs(total)))
  }
  const ligneOrigine = encaissements.find((x) => x.id === e.annule_id)?.ligne_bancaire_id ?? null
  const origine = ligneOrigine == null ? undefined : mouvements.find((x) => x.id === ligneOrigine)
  if (origine) {
    if (!mouvementLibre(origine)) return refusA('origine_classee')
    const justifies = vivants.filter((x) => x.ligne_bancaire_id === origine.id
      && (justifieSonMouvement(x, encaissements) || x.id === e.annule_id))
      .reduce((somme, x) => somme + centimes(x.montant), 0)
    const credit = centimes(origine.montant)
    if (!ecartDeFrais(justifies - credit, justifies)) {
      return refusA('origine_depassee', euroCommeLaBase(credit), euroCommeLaBase(justifies))
    }
  }
  return null
}

/**
 * Les encaissements — contre-passations comprises — de factures SOURCES, non retirés, qui citent ce mouvement et le
 * justifient : ceux que la garde G2 regarde pour le dire réservé, et que le classement compte (étape VF5a1 : le relevé les
 * nomme, lib/mouvementsDesVentes.ts). Les encaissements des factures qui ne sont pas sources n'y sont pas : leurs ventes
 * se comptent par leurs pièces. Dans l'ordre de la liste reçue.
 */
export function encaissementsDuMouvement<E extends EncaissementLu>(
  mouvementId: string,
  encaissements: readonly E[],
  vente: Pick<ContexteVente, 'factures'>,
): E[] {
  return encaissements.filter((x) => x.ligne_bancaire_id === mouvementId && compte(x)
    && factureSource(x.facture_id, vente) && justifieSonMouvement(x, encaissements))
}

// Ce que ces encaissements portent sur un mouvement, en centimes, et s'il en est au moins un.
function porteDesSources(mouvementId: string, encaissements: readonly EncaissementLu[], vente: Pick<ContexteVente, 'factures'>) {
  const justifies = encaissementsDuMouvement(mouvementId, encaissements, vente)
  return { aucun: justifies.length === 0, centimes: justifies.reduce((somme, x) => somme + centimes(x.montant), 0) }
}

/**
 * Ce que `classer_mouvement_par_encaissements` refuserait : le PREMIER refus, dans l'ordre de la base et sous son message,
 * ou null — l'accès, seule la base le juge. Dans l'ordre : le mouvement introuvable, daté d'un exercice que la frontière
 * fige, déjà classé par ses encaissements, classé autrement, qui ne justifie aucun encaissement d'une facture source ;
 * pour un crédit, des encaissements qui ne le font pas — ce qui le dépasse reste à traiter —, ou qui le dépassent au-delà
 * des frais ; pour un débit, des contre-passations qui le dépassent, ou qui ne le font pas à l'écart des frais près.
 */
export function refusClassement(
  dossierId: string,
  ligneBancaireId: string,
  mouvements: readonly MouvementClasse[],
  encaissements: readonly EncaissementLu[],
  vente: ContexteVente,
): RefusEncaissement<CleRefusClassement> | null {
  const refusK = (cle: CleRefusClassement, ...valeurs: string[]) => refusDe(REFUS_CLASSEMENT, cle, ...valeurs)
  const m = mouvements.find((x) => x.id === ligneBancaireId && x.dossier_id === dossierId)
  if (!m) return refusK('mouvement_introuvable')
  const fige = dateFigeePourLaVente(m.date, vente.anneesValidees)
  if (fige) return refusK('frontiere', fige)
  if (m.encaissements_de_factures) return refusK('deja_classe_par_ses_encaissements')
  if (!mouvementLibre(m)) return refusK('deja_classe')
  const porte = porteDesSources(m.id, encaissements, vente)
  if (porte.aucun) return refusK('aucun_encaissement')
  const montant = centimes(m.montant)
  const ecart = porte.centimes - montant
  if (montant > 0 && ecart < 0) return refusK('credit_non_fait', euroCommeLaBase(porte.centimes), euroCommeLaBase(montant))
  if (montant > 0 && !ecartDeFrais(ecart, porte.centimes)) {
    return refusK('credit_ecart', euroCommeLaBase(porte.centimes), euroCommeLaBase(montant))
  }
  if (montant < 0 && ecart < 0) {
    return refusK('debit_depasse', euroCommeLaBase(Math.abs(porte.centimes)), euroCommeLaBase(Math.abs(montant)))
  }
  if (montant < 0 && !ecartDeFrais(ecart, Math.abs(porte.centimes))) {
    return refusK('debit_ecart', euroCommeLaBase(Math.abs(porte.centimes)), euroCommeLaBase(Math.abs(montant)))
  }
  return null
}

/**
 * Ce que `retirer_classement_par_encaissements` refuserait : le mouvement introuvable, daté d'un exercice que la frontière
 * fige, ou qui n'est pas classé par ses encaissements — l'accès, seule la base le juge.
 */
export function refusRetraitDuClassement(
  dossierId: string,
  ligneBancaireId: string,
  mouvements: readonly MouvementClasse[],
  vente: Pick<ContexteVente, 'anneesValidees'>,
): RefusEncaissement<CleRefusRetraitClassement> | null {
  const refusQ = (cle: CleRefusRetraitClassement, ...valeurs: string[]) => refusDe(REFUS_RETRAIT_CLASSEMENT, cle, ...valeurs)
  const m = mouvements.find((x) => x.id === ligneBancaireId && x.dossier_id === dossierId)
  if (!m) return refusQ('mouvement_introuvable')
  const fige = dateFigeePourLaVente(m.date, vente.anneesValidees)
  if (fige) return refusQ('frontiere', fige)
  if (!m.encaissements_de_factures) return refusQ('non_classe')
  return null
}

/**
 * Ce que la garde des mouvements (G2) opposerait à TOUT AUTRE CLASSEMENT de ce mouvement — l'affecter, le ventiler, le
 * rapprocher d'une pièce, d'une cotisation, d'un emprunt ou d'une déclaration, l'écrire sur un compte de bilan, régler un
 * groupe, l'écarter, le dire personnel —, qu'un écran du relevé dira avant le clic (étape VF5) : classé par ses
 * encaissements, il ne reçoit rien d'autre ; réservé — il justifie un encaissement non retiré d'une facture source —, il
 * ne se classe que par ses encaissements, et la base nomme la facture du premier de ces encaissements, par sa création
 * puis son identifiant. Null : la garde laisse passer, comme hier. Le retour à un mouvement libre (retirer un classement)
 * n'est jamais refusé par elle.
 */
export function refusDuClassementDuReleve(
  mouvement: MouvementClasse,
  encaissements: readonly EncaissementDuReleve[],
  vente: Pick<ContexteVente, 'factures'>,
): RefusEncaissement<CleRefusGardeMouvements> | null {
  if (mouvement.encaissements_de_factures) return refusDe(REFUS_GARDE_MOUVEMENTS, 'classe_par_ses_encaissements')
  const premier = encaissementsDuMouvement(mouvement.id, encaissements, vente).sort(ordreDesEncaissements)[0]
  if (!premier) return null
  // Une facture validée porte toujours son numéro (`factures_emises_figees`) ; un `%` nul, `raise` l'écrirait `<NULL>`.
  const numero = vente.factures.find((f) => f.id === premier.facture_id)?.numero ?? '<NULL>'
  return refusDe(REFUS_GARDE_MOUVEMENTS, 'reserve', numero)
}

// ── La fenêtre des encaissements juge une facture source (chantier EC-Q3, étape VF5b) ──────────────────────────────────
//
// La fenêtre des encaissements (EncaissementsFactureModal.tsx, les deux espaces) passe aux jugements de la vente —
// `refusEnregistrementVente`, `refusRetraitVente`, `refusContrePassationVente` et `propositionsEncaissement` avec son
// contexte —, qui rendent pour une facture qui n'est PAS source de sa vente exactement ce que rendaient les jugements
// d'hier : encaissementsFenetreVente.test.ts le prouve sur un tirage. Ce qui suit ne vaut que pour une facture SOURCE : son
// reste net des avoirs, la frontière que le client ne lit pas, les débits qu'une contre-passation peut citer, et le geste
// qui rendrait un mouvement inclassable — dit avant le clic, jamais refusé : la base l'admet (l'aligner serait une
// migration, à revoir avec VF7 ; conception de VF5, § 7).

/**
 * Les exercices validés, côté CLIENT : `exercices_valides` ne s'ouvre qu'au cabinet (sa policy, `admin_du_dossier` ;
 * décision de P9a). `ContexteVente.anneesValidees` les dit alors illisibles, et le module saute la frontière d'un exercice
 * validé : c'est la base qui la juge, à l'envoi, et son refus revient sous ses mots.
 */
export const ANNEES_ILLISIBLES = 'illisibles' as const

/** Ce que la fenêtre du CLIENT dit d'une facture source, puisqu'elle ne lit pas la frontière (`frontiereJugeeParLaBase`). */
export const FRONTIERE_JUGEE_PAR_LA_BASE = 'Les exercices que ton cabinet a validés ne se lisent pas d’ici : une date que l’un '
  + 'd’eux fige ne se dit donc pas avant l’envoi — c’est la base qui la refusera, et son refus se dira ici.'

/** La frontière d'un exercice validé, qu'une facture source subit, se juge-t-elle par la base seule (le client) ? */
export function frontiereJugeeParLaBase(
  facture: Pick<FacturePourEncaissement, 'source_de_la_vente'>,
  vente: Pick<ContexteVente, 'anneesValidees'>,
): boolean {
  return facture.source_de_la_vente && vente.anneesValidees === ANNEES_ILLISIBLES
}

/**
 * Ce qui reste à encaisser, tel que la base le plafonne : pour une facture qui n'est pas source, `resteAEncaisser` ; pour
 * une facture SOURCE, net de ce que ses avoirs VALIDÉS créditent, en tout et par taux (EC3-Q10, les rangs 27 et 29
 * d'`enregistrer_encaissement`) — les lignes de ses avoirs dans `c.lignes`, les avoirs dans `vente.factures`. C'est ce reste
 * que la fenêtre propose, et que ses propositions font.
 */
export function resteAEncaisserVente(
  c: ContexteDuReste,
  vente: Pick<ContexteVente, 'factures'>,
): ResteAEncaisser {
  const brut = resteAEncaisser(c)
  if (!c.facture.source_de_la_vente) return brut
  const credites = creditesDesAvoirs(c.facture.id, c.lignes, vente)
  const credite = [...credites.values()].reduce((total, x) => total + x, 0)
  const parTaux = brut.parTaux.map((t) => {
    const ttcCentimes = t.ttcCentimes - (credites.get(t.taux) ?? 0)
    return { ...t, ttcCentimes, resteCentimes: ttcCentimes - t.encaisseCentimes }
  })
  const ttcCentimes = brut.ttcCentimes - credite
  return { ttcCentimes, encaisseCentimes: brut.encaisseCentimes, resteCentimes: ttcCentimes - brut.encaisseCentimes, parTaux }
}

/**
 * Les débits qu'une contre-passation d'une facture source peut citer (le cinquième paramètre d'`annuler_encaissement`) :
 * ceux du dossier, LIBRES — un mouvement que rien ne classe, comme la base l'exige —, le plus proche du montant de
 * l'encaissement d'abord, puis par date et par identifiant. Aucun n'est imposé : `refusContrePassationVente` juge celui
 * qu'on choisit, avant le clic.
 */
export function debitsCitables<M extends MouvementClasse>(
  dossierId: string,
  encaissement: Pick<EncaissementLu, 'montant'>,
  mouvements: readonly M[],
): M[] {
  const cible = Math.abs(centimes(encaissement.montant))
  const ecart = (m: M) => Math.abs(Math.abs(centimes(m.montant)) - cible)
  return mouvements.filter((m) => m.dossier_id === dossierId && m.montant < 0 && mouvementLibre(m))
    .sort((a, b) => ecart(a) - ecart(b) || ordreC(a.date, b.date) || ordreC(a.id, b.id))
}

// L'identifiant de ce que le geste écrirait, et celui du complément d'un mouvement payé en partie : des noms qu'aucun
// identifiant de la base (un UUID) ne porte.
const LE_GESTE = '(le geste)'
const LE_COMPLEMENT = '(le complément)'

/** Le début de ce que la fenêtre dit d'un geste qui rendrait un mouvement inclassable. */
export const NE_POURRA_PAS_SE_CLASSER = 'Ce mouvement ne pourra pas se classer par ses encaissements'

/** La fin : ce que la base fait du geste, et de ce qui suit. */
export const LA_BASE_ADMET_LE_GESTE = 'La base admet ce geste ; c’est le classement du mouvement, ensuite, qu’elle refusera.'

/**
 * Le mouvement deviendrait-il INCLASSABLE par ses encaissements ? `refusClassement` joué sur l'état d'APRÈS le geste
 * (`encaissementsApres` : le registre, et ce que le geste y écrirait), complété de ce qui reste à faire du mouvement par une
 * facture source fictive : un crédit payé en partie n'est pas inclassable, il attend ses autres encaissements (une remise de
 * chèques) ; un crédit qui justifie aussi l'encaissement d'une facture qui n'est pas source, ou un débit que ses
 * contre-passations dépasseraient, ne se classera jamais. La phrase, ou null : le classement resterait possible. Un
 * mouvement qui n'est pas libre n'a rien à en dire — le geste lui-même serait refusé.
 */
export function inclassableApres(
  dossierId: string,
  ligneBancaireId: string,
  mouvements: readonly MouvementClasse[],
  encaissementsApres: readonly EncaissementLu[],
  vente: ContexteVente,
): string | null {
  const m = mouvements.find((x) => x.id === ligneBancaireId && x.dossier_id === dossierId)
  if (!m || !mouvementLibre(m)) return null
  const justifies = encaissementsApres.filter((x) => x.ligne_bancaire_id === m.id && compte(x)
    && justifieSonMouvement(x, encaissementsApres))
  const manque = centimes(m.montant) - justifies.reduce((total, x) => total + centimes(x.montant), 0)
  const complete = manque !== 0 && Math.sign(manque) === Math.sign(m.montant)
  const encaissements: EncaissementLu[] = complete
    ? [...encaissementsApres, {
      id: LE_COMPLEMENT, dossier_id: dossierId, facture_id: LE_COMPLEMENT, montant: manque / 100, ligne_bancaire_id: m.id,
      annule_id: null, retire_le: null,
    }]
    : [...encaissementsApres]
  const factures: FactureDuDossier[] = complete
    ? [...vente.factures, {
      id: LE_COMPLEMENT, dossier_id: dossierId, numero: null, type: 'facture', statut: 'validee', facture_origine_id: null,
      source_de_la_vente: true,
    }]
    : [...vente.factures]
  const refus = refusClassement(dossierId, m.id, mouvements, encaissements, { anneesValidees: vente.anneesValidees, factures })
  if (!refus) return null
  const nonSources = [...new Set(justifies.filter((x) => !factureSource(x.facture_id, vente))
    .map((x) => vente.factures.find((f) => f.id === x.facture_id)?.numero ?? 'une facture'))]
  const raison = nonSources.length > 0
    ? `il justifie aussi l’encaissement de ${nonSources.join(', ')}, une facture qui n’est pas source de sa vente, que son `
      + 'classement ne compte pas.'
    : `« ${refus.message} »`
  return `${NE_POURRA_PAS_SE_CLASSER} : ${raison} ${LA_BASE_ADMET_LE_GESTE}`
}

/**
 * L'encaissement d'une facture SOURCE sur le mouvement que la saisie cite rendrait-il ce mouvement inclassable
 * (`inclassableApres`) ? Null pour une facture qui n'est pas source, une saisie sans mouvement, ou un montant qui ne se
 * compte pas encore — la saisie est alors refusée, et son refus le dit.
 */
export function inclassableApresEnregistrement(
  c: ContexteFacture,
  s: SaisieEncaissement,
  mouvements: readonly MouvementClasse[],
  vente: ContexteVente,
): string | null {
  if (!c.facture.source_de_la_vente || s.ligneBancaireId == null || s.montant == null) return null
  const montant = centimesExacts(s.montant)
  if (montant == null || montant <= 0) return null
  const apres: EncaissementLu[] = [...c.encaissements, {
    id: LE_GESTE, dossier_id: c.dossierId, facture_id: c.facture.id, montant: montant / 100, ligne_bancaire_id: s.ligneBancaireId,
    annule_id: null, retire_le: null,
  }]
  return inclassableApres(c.dossierId, s.ligneBancaireId, mouvements, apres, vente)
}

/**
 * La contre-passation d'un encaissement d'une facture SOURCE qui cite ce débit rendrait-elle le débit inclassable
 * (`inclassableApres`) — des contre-passations qui le dépasseraient, de l'écart des frais que la base admet à la citation
 * et que le classement refuse (`debit_depasse`) ? Null sans débit cité, ou pour une facture qui n'est pas source.
 */
export function inclassableApresContrePassation(
  dossierId: string,
  encaissementId: string,
  encaissements: readonly EncaissementLu[],
  ligneBancaireId: string | null,
  mouvements: readonly MouvementClasse[],
  vente: ContexteVente,
): string | null {
  if (ligneBancaireId == null) return null
  const e = encaissements.find((x) => x.id === encaissementId && x.dossier_id === dossierId)
  if (!e || !factureSource(e.facture_id, vente)) return null
  const apres: EncaissementLu[] = [...encaissements, {
    id: LE_GESTE, dossier_id: dossierId, facture_id: e.facture_id, montant: -e.montant, ligne_bancaire_id: ligneBancaireId,
    annule_id: e.id, retire_le: null,
  }]
  return inclassableApres(dossierId, ligneBancaireId, mouvements, apres, vente)
}
