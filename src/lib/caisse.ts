import type { ModeleComptable } from './engagement'
import { tvaEnCentimes } from './tvaDuReleve'
import type {
  ANouveau, EncaissementFacture, FactureEmise, GenreOperationCaisse, OperationCaisse, OrigineOperationCaisse,
} from './types'
import { exerciceQuiFige, frontiereDeValidation } from './validationExercice'
import { compteDuDirigeant } from './virementPersonnel'

// LA CAISSE D'UN DOSSIER BNC, CE QUE LA BASE EN DIRA AVANT LE CLIC (ligne 26.6, étape C2 ; MVP-D2). La conception :
// HISTORIQUE.md, « LA CAISSE D'UN DOSSIER BNC : LA CONCEPTION — MVP-D2 (LIGNE 26.6) » et « LA CAISSE : LA SAISIE DU
// PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE (CAISSE-Q1 ET Q4) » ; la base : les migrations
// `caisse` et `caisse_retrait_et_versement` (C1, C1b), en base depuis le 30/10/2026.
//
// PUR : aucun appel au réseau, aucun import du client Supabase. Ce module redit, dans leur ORDRE, sous leurs MOTS et leurs
// CODES, les refus des quatre fonctions de la caisse — `enregistrer_operation_caisse`, `enregistrer_operations_de_caisse`,
// `retirer_operation_caisse`, `remplacer_operation_caisse` — jugés sur la saisie TELLE QU'ELLE PART ; il compose
// l'écriture au plan du dossier, en centimes entiers, comme la base la RECOMPOSE ; il rejoue la caisse jour par jour comme
// `premier_jour_negatif_de_la_caisse`, et dit le jour où elle passerait sous zéro sous les mots de `texte_caisse_negative`.
// La base reste juge : l'écran le dit pour qu'on ne clique pas pour rien, la base pour qu'aucun chemin ne le contourne.
// `caisse.test.ts` le confronte à l'essai (supabase/essais/caisse.sql : les mêmes cas, les mêmes verdicts), puis au
// texte des deux migrations (les mots et l'ordre des refus, relus dans le SQL).
//
// LA MIGRATION 4 (`paiement_par_la_caisse`, étape C8, préparée le 31/10/2026, pas encore appliquée) : ce module redit,
// DÈS AUJOURD'HUI, ce qu'elle change aux fonctions d'ici — la caisse bornée par l'ouverture de son compte (ce qui la
// précède est dans les comptes repris), et l'ensemble du jour d'une recette étendu aux paiements par la caisse de pièces
// de vente. Avant elle, l'un et l'autre ne changent rien tant que la production n'a ni paiement ni flux de caisse d'avant
// l'ouverture (relevé le 31/10/2026 : aucune opération de caisse, aucun encaissement ; le 29/10/2026 : aucun mouvement
// classé sur un compte de bilan, aucun à-nouveau au 53). Le premier est la correction d'un défaut de l'écran (le module
// comptait deux fois les espèces d'avant l'ouverture), qui doit précéder la base : d'ici là, un tel flux, la base le
// compte encore — elle reste la garde, et refuserait après le clic ce qu'il ôterait. Ses refus neufs à elle — le
// paiement, sa contrepartie, la pièce payée, le mouvement d'avant l'ouverture — sont ceux de lib/paiementParLaCaisse.ts.
//
// LE DRAPEAU. LES DEUX MIGRATIONS SONT EN BASE depuis le 30/10/2026 : `caisse`, par l'outil (version 20261030073812),
// puis `caisse_retrait_et_versement`, collée par le cabinet (version 20261030123801), toutes deux dans l'export. Le
// drapeau est levé : la table se lit (`caisseLecture.ts`), la sauvegarde la porte (`sauvegarde.ts`), le compte de bilan
// du relevé (`compteDeBilan.ts`) et la reprise (`aNouveaux.ts`) la connaissent, et les moteurs comptent ses recettes.
// Baissé, l'application se conduisait comme avant la caisse : les fonctions `…Selon` gardent cet état, que les tests
// jouent encore.
export const CAISSE_EXPORTEE = true

// ── Les mots de la base ───────────────────────────────────────────────────────────────────────────────────────────────

// 23503 depuis la relecture du 01/11/2026 : la pièce qu'un paiement cite, supprimée sous la contrepartie de ce paiement
// (`MOTS_DU_PAIEMENT.piece_payee_supprimee`) — le code de la clé qui la retient, que la garde du brouillon lève avant elle.
export type CodeDuRefus = '42501' | '22023' | '23514' | 'P0002' | '23503'

/** Un refus de la base, tel qu'elle le lèvera : son code et ses mots. */
export interface RefusCaisse {
  code: CodeDuRefus
  message: string
}

// Chaque refus, son code et son GABARIT — le texte du `raise exception` de la fonction, ses `%` compris, que `former`
// remplit dans l'ordre. Les apostrophes sont celles de la base : ce sont SES mots, que l'écran redit tels quels.
// `caisse.test.ts` relit chaque gabarit dans le texte des migrations, et l'ordre de chaque liste ci-dessous.
export const MOTS_DE_LA_CAISSE = {
  acces: { code: '42501', gabarit: 'Accès refusé à ce dossier.' },
  tresorerie: { code: '22023', gabarit: 'La caisse ne se tient que dans un dossier en comptabilité de trésorerie.' },
  genre: { code: '22023', gabarit: 'Une opération de caisse est une recette en espèces, un apport ou un prélèvement de l\'exploitant.' },
  date_absente: { code: '22023', gabarit: 'La date de l\'opération de caisse est à renseigner.' },
  date_avant_2000: { code: '22023', gabarit: 'Une opération de caisse ne se date pas avant l\'an 2000.' },
  date_future: { code: '22023', gabarit: 'Une opération de caisse ne se date pas dans l\'avenir : nous sommes le %.' },
  date_avant_ouverture: { code: '22023', gabarit: 'Cette opération précède l\'ouverture du dossier, le % : elle est dans les comptes repris.' },
  frontiere: { code: '23514', gabarit: '% : sa caisse ne change plus.' },
  montant_absent: { code: '22023', gabarit: 'Le montant de l\'opération de caisse est à renseigner.' },
  montant_centime: { code: '22023', gabarit: 'Le montant d\'une opération de caisse est au centime.' },
  montant_nul: { code: '22023', gabarit: 'Une opération de caisse de zéro euro n\'a rien à écrire.' },
  montant_negatif: { code: '22023', gabarit: 'Le montant d\'un apport ou d\'un prélèvement est positif : un apport fait entrer des espèces, un prélèvement les fait sortir.' },
  montant_borne: { code: '22023', gabarit: 'Le montant d\'une opération de caisse dépasse ce que l\'application compte.' },
  categorie_absente: { code: '22023', gabarit: 'La nature d\'une recette en espèces est une catégorie de produit du dossier : à choisir.' },
  categorie_inconnue: { code: '22023', gabarit: 'Cette catégorie n\'existe pas pour ce dossier.' },
  categorie_sans_produit: { code: '22023', gabarit: 'La catégorie « % » n\'a pas de compte de produit (classe 7) : une recette en espèces ne s\'y range pas.' },
  categorie_de_trop: { code: '22023', gabarit: 'Un apport ou un prélèvement n\'a pas de catégorie : il s\'écrit face au compte de l\'exploitant.' },
  taux_absent: { code: '22023', gabarit: 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».' },
  taux_inconnu: { code: '22023', gabarit: 'Ce taux de TVA n\'est pas pris en charge.' },
  taux_de_trop: { code: '22023', gabarit: 'Un taux de TVA ne s\'applique qu\'à une recette d\'un dossier assujetti.' },
  ensemble_absent: { code: '22023', gabarit: 'La saisie d\'une recette dit les encaissements en espèces de factures de son jour qu\'elle a lus : une liste d\'identifiants, vide s\'il n\'y en a aucun.' },
  ensemble_doublon: { code: '22023', gabarit: 'La saisie d\'une recette nomme chaque encaissement de son jour une seule fois.' },
  ensemble_manquant: { code: '22023', gabarit: 'Un encaissement en espèces de la facture % du même jour a été enregistré depuis ta lecture : relis la caisse.' },
  // La migration `paiement_par_la_caisse` : les paiements par la caisse de pièces de vente du jour, sans nommer la pièce.
  ensemble_paiement_manquant: { code: '22023', gabarit: 'Un paiement en espèces d\'une pièce de vente du même jour a été enregistré depuis ta lecture : relis la caisse.' },
  ensemble_en_trop: { code: '22023', gabarit: 'L\'encaissement de la facture % que ta lecture comptait n\'est pas dans la caisse de ce jour : relis la caisse.' },
  ensemble_paiement_en_trop: { code: '22023', gabarit: 'Le paiement d\'une pièce que ta lecture comptait n\'est pas un paiement en espèces d\'une pièce de vente de ce jour : relis la caisse.' },
  ensemble_etranger: { code: '22023', gabarit: 'Un encaissement que ta lecture comptait n\'est pas un encaissement de ce dossier : relis la caisse.' },
  ensemble_hors_recette: { code: '22023', gabarit: 'Seule une recette reconnaît les encaissements en espèces de son jour.' },
  ecriture_incomplete: { code: '22023', gabarit: 'L\'écriture proposée est incomplète.' },
  ecriture_fausse: { code: '22023', gabarit: 'L\'écriture proposée ne correspond pas à cette opération de caisse et au plan du dossier (la caisse : %).' },
  ecriture_desequilibree: { code: '23514', gabarit: 'Écriture déséquilibrée : % au débit, % au crédit.' },
  // La saisie d'un mois.
  mois_pas_un_tableau: { code: '22023', gabarit: 'Une saisie de caisse est un tableau JSON d\'opérations.' },
  mois_vide: { code: '22023', gabarit: 'La saisie ne porte aucune opération.' },
  mois_trop_long: { code: '22023', gabarit: 'Une saisie range mille opérations au plus ; celle-ci en porte % : la partager.' },
  mois_pas_un_objet: { code: '22023', gabarit: 'Une opération de la saisie est un objet JSON aux champs d\'une opération de caisse.' },
  mois_champ_inconnu: { code: '22023', gabarit: '« % » n\'est pas un champ d\'une opération de caisse.' },
  mois_champ_illisible: { code: '22023', gabarit: 'Une opération de la saisie porte un champ illisible : le genre, la date, la catégorie et les encaissements du jour sont des textes, le montant et le taux des nombres.' },
  mois_date_illisible: { code: '22023', gabarit: 'La date de l\'opération est illisible : elle s\'écrit AAAA-MM-JJ.' },
  mois_identifiant_illisible: { code: '22023', gabarit: 'Une opération de la saisie porte un identifiant illisible (sa catégorie ou un encaissement du jour).' },
  // Le retrait et le remplacement.
  operation_inconnue: { code: 'P0002', gabarit: 'Cette opération n\'est pas dans la caisse de ce dossier : relis ta caisse.' },
  operation_du_cabinet: { code: '42501', gabarit: 'Cette opération a été saisie par ton cabinet : demande-lui de la corriger.' },
  operation_d_un_autre_acces: { code: '42501', gabarit: 'Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.' },
  operation_retiree: { code: 'P0002', gabarit: 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.' },
} as const satisfies Record<string, { code: CodeDuRefus; gabarit: string }>

export type CleDuRefus = keyof typeof MOTS_DE_LA_CAISSE

// L'ORDRE DES `raise` DANS LE CORPS DE CHAQUE FONCTION, tel que le texte des migrations les écrit — les refus de la caisse
// négative, dont le texte vient de `texte_caisse_negative`, à part (`GESTES_DE_LA_CAISSE`). L'accès, que
// `qui_ecrit_la_caisse` lève pour toutes, vient avant chacune.
export const ORDRE_DES_REFUS: Readonly<Record<
  'enregistrer_operation_caisse' | 'enregistrer_operations_de_caisse' | 'retirer_operation_caisse' | 'remplacer_operation_caisse',
  readonly CleDuRefus[]
>> = {
  enregistrer_operation_caisse: [
    'tresorerie', 'genre', 'date_absente', 'date_avant_2000', 'date_future', 'date_avant_ouverture', 'frontiere',
    'montant_absent', 'montant_centime', 'montant_nul', 'montant_negatif', 'montant_borne', 'categorie_absente',
    'categorie_inconnue', 'categorie_sans_produit', 'categorie_de_trop', 'taux_absent', 'taux_inconnu', 'taux_de_trop',
    'ensemble_absent', 'ensemble_doublon', 'ensemble_manquant', 'ensemble_paiement_manquant', 'ensemble_en_trop',
    'ensemble_paiement_en_trop', 'ensemble_etranger',
    'ensemble_hors_recette', 'ecriture_incomplete', 'ecriture_fausse', 'ecriture_desequilibree',
  ],
  enregistrer_operations_de_caisse: [
    'mois_pas_un_tableau', 'mois_vide', 'mois_trop_long', 'mois_pas_un_objet', 'mois_champ_inconnu', 'mois_champ_illisible',
    'mois_date_illisible', 'mois_identifiant_illisible',
  ],
  retirer_operation_caisse: [
    'operation_inconnue', 'operation_du_cabinet', 'operation_d_un_autre_acces', 'operation_retiree', 'frontiere',
  ],
  remplacer_operation_caisse: [
    'operation_inconnue', 'operation_du_cabinet', 'operation_d_un_autre_acces', 'operation_retiree', 'frontiere',
  ],
}

/** Remplit un gabarit de la base : chaque `%`, dans l'ordre, par la valeur suivante — le `raise exception '…', a, b`. */
export function former(gabarit: string, ...valeurs: readonly string[]): string {
  let i = 0
  return gabarit.replace(/%/g, () => valeurs[i++] ?? '%')
}

/** Un refus de la base sous sa clé : son code, et son gabarit rempli. */
export function refus(cle: CleDuRefus, ...valeurs: readonly string[]): RefusCaisse {
  const { code, gabarit } = MOTS_DE_LA_CAISSE[cle]
  return { code, message: former(gabarit, ...valeurs) }
}

// LES MOTS D'UNE CAISSE QUI PASSERAIT SOUS ZÉRO (`texte_caisse_negative`) : le geste, son montant, le jour et le solde.
// Un geste inconnu prend la phrase générale, comme le `else` de la base.
export const GESTES_DE_LA_CAISSE = {
  prelevement: 'Ce prélèvement de %s € rendrait la caisse négative le %s (%s €) : saisis d\'abord les recettes en espèces qui le précèdent.',
  especes_rendues: 'Ces espèces rendues, %s €, rendraient la caisse négative le %s (%s €) : saisis d\'abord les recettes en espèces qui les précèdent.',
  paiement: 'Ce paiement de %s € rendrait la caisse négative le %s (%s €) : saisis d\'abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n\'est pas la caisse : c\'est une note de frais.',
  retrait_recette: 'Retirer cette recette de %s € rendrait la caisse négative le %s (%s €) : retire d\'abord les sorties d\'espèces qui la suivent.',
  retrait_apport: 'Retirer cet apport de %s € rendrait la caisse négative le %s (%s €) : retire d\'abord les sorties d\'espèces qui le suivent.',
  retrait_paiement: 'Retirer ce paiement de %s € rendrait la caisse négative le %s (%s €) : retire d\'abord les sorties d\'espèces qui le suivent.',
  versement: 'Ce versement de %s € rendrait la caisse négative le %s (%s €) : saisis d\'abord les recettes en espèces qui le précèdent.',
  retrait_d_especes_retire: 'Retirer ce retrait d\'espèces de %s € pour la caisse rendrait la caisse négative le %s (%s €) : retire d\'abord les sorties d\'espèces qui le suivent.',
  mouvement_change: 'Ce changement d\'un mouvement classé sur la caisse la rendrait négative le %s (%s €).',
  contre_passation: 'Cette contre-passation de %s € en espèces rendrait la caisse négative le %s (%s €) : la caisse n\'a plus ces espèces ce jour-là.',
  retrait_encaissement: 'Retirer cet encaissement de %s € en espèces rendrait la caisse négative le %s (%s €) : ses espèces ont déjà servi.',
  rattachement_encaissement: 'Rattacher à un mouvement cet encaissement de %s € en espèces rendrait la caisse négative le %s (%s €) : ses espèces ont déjà servi.',
  ouverture_au_credit: 'Une ouverture de la caisse au crédit, %s €, la rendrait négative le %s (%s €) : le solde d\'une caisse est débiteur ou nul.',
  retrait_ouverture: 'Retirer l\'ouverture de la caisse, %s €, la rendrait négative le %s (%s €) : retire d\'abord les sorties d\'espèces qui la suivent.',
  ouverture_change: 'Ce changement de l\'ouverture de la caisse la rendrait négative le %s (%s €).',
  lot: 'La caisse serait négative le %s (%s €) : saisis d\'abord les recettes en espèces qui précèdent ce jour.',
  autre: 'Cette écriture rendrait la caisse négative le %s (%s €).',
} as const

export type GesteDeLaCaisse = keyof typeof GESTES_DE_LA_CAISSE

/** Un montant en centimes, tel que `to_char(…, 'FM999999999990.00')` l'écrit, la virgule pour le point : sans signe. */
function euros(centimes: number): string {
  const a = Math.abs(centimes)
  return `${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`
}

/** Une date civile AAAA-MM-JJ, telle que `to_char(…, 'DD/MM/YYYY')` l'écrit. */
export function jourDit(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`
}

/**
 * Les mots d'une caisse qui passerait sous zéro, ceux de `texte_caisse_negative` : le montant du geste (sans signe), le
 * jour, et le solde de ce jour, précédé du signe moins typographique quand il est négatif. Montants en CENTIMES.
 */
export function texteCaisseNegative(geste: string, montantCentimes: number, jour: string, soldeCentimes: number): string {
  const gabarit = (GESTES_DE_LA_CAISSE as Record<string, string>)[geste] ?? GESTES_DE_LA_CAISSE.autre
  const solde = `${soldeCentimes < 0 ? '−' : ''}${euros(soldeCentimes)}`
  // Deux gestes ne disent pas leur montant (le changement d'un mouvement, d'une ouverture), ni la saisie d'un mois, ni le
  // `else` : leur gabarit n'a que le jour et le solde.
  const valeurs = (gabarit.match(/%s/g) ?? []).length === 3 ? [euros(montantCentimes), jourDit(jour), solde] : [jourDit(jour), solde]
  let i = 0
  return gabarit.replace(/%s/g, () => valeurs[i++])
}

// ── Les nombres tels que la base les lit ──────────────────────────────────────────────────────────────────────────────

// Un montant envoyé en JSON se lit en base comme un `numeric` EXACT : `10.005` n'est pas au centime, et `0.1 + 0.2` non
// plus. Le texte que `JSON.stringify` écrit pour ce nombre (`String`) le dit : au centime, il a deux décimales au plus.
// Rend les centimes exacts, ou nul quand le nombre n'est pas au centime (ou n'est pas un nombre fini).
export function centimesDe(montant: number): number | null {
  if (!Number.isFinite(montant)) return null
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(montant))
  if (!m) return null
  const valeur = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -valeur : valeur
}

/** Les taux qu'une recette porte, ceux du relevé (`recettes_assujetties_du_releve`). */
export const TAUX_DE_LA_CAISSE: readonly number[] = [0, 5.5, 8.5, 10, 20]
/**
 * Les genres qu'`enregistrer_operation_caisse` saisit — le paiement d'une pièce a sa fonction, `regler_piece_par_la_caisse`
 * (la migration 4 ; lib/paiementParLaCaisse.ts).
 */
export const GENRES_SAISIS: readonly GenreOperationCaisse[] = ['recette', 'apport', 'prelevement']
// La borne de la base : un montant de dix mille milliards d'euros ou plus n'est pas compté.
const BORNE_CENTIMES = 1_000_000_000_000_000

// ── La caisse lue, jour par jour ──────────────────────────────────────────────────────────────────────────────────────

/** Ce que la caisse lit d'une opération. */
export type OperationDeLaCaisse = Pick<
  OperationCaisse, 'id' | 'genre' | 'date' | 'montant' | 'retire_le' | 'origine' | 'cree_par' | 'remplace_id'
  | 'categorie_id' | 'taux_tva' | 'encaissements_du_jour' | 'piece_id'
>
/** Un mouvement du relevé, tel que la caisse le lit : classé sur son compte, ou non. */
export interface MouvementDeLaCaisse { id: string; date: string; montant: number; compte_bilan: string | null }
/** Un encaissement d'une facture, tel que la caisse le lit. */
export type EncaissementDeLaCaisse = Pick<
  EncaissementFacture, 'id' | 'facture_id' | 'date_encaissement' | 'montant' | 'moyen' | 'ligne_bancaire_id' | 'annule_id' | 'retire_le'
>
/** Une facture, telle que la caisse la lit : sa source, et son numéro pour les mots d'un refus. */
export type FactureDeLaCaisse = Pick<FactureEmise, 'id' | 'numero' | 'source_de_la_vente'>

/**
 * Tout ce que `premier_jour_negatif_de_la_caisse` lit d'un dossier : ses à-nouveaux, ses opérations (retirées comprises :
 * elles ne comptent pas), ses mouvements, les encaissements de ses factures et ces factures. Le compte de la caisse vient
 * du PLAN du dossier, jamais en dur.
 */
export interface EtatDeLaCaisse {
  compteCaisse: string
  ouvertures: readonly Pick<ANouveau, 'date' | 'compte' | 'sens' | 'montant'>[]
  operations: readonly OperationDeLaCaisse[]
  mouvements: readonly MouvementDeLaCaisse[]
  encaissements: readonly EncaissementDeLaCaisse[]
  factures: readonly FactureDeLaCaisse[]
  /**
   * Les pièces de VENTE que des paiements par la caisse citent, lues avec eux : l'ensemble qu'une recette reconnaît compte
   * ces paiements-là (la migration `paiement_par_la_caisse`). Absentes, aucun paiement n'est d'une pièce de vente — ce qui
   * est vrai tant que la migration n'est pas en base, où aucun paiement n'existe ; l'écran qui les règle (lot C9b, derrière
   * `PAIEMENT_PAR_LA_CAISSE_EXPORTE`) les lira et les passera.
   */
  piecesDeVente?: readonly string[]
}

export type SourceDuFlux = 'ouverture' | 'operation' | 'mouvement' | 'encaissement'

/** Un flux de la caisse : son jour et ce qu'il y apporte, en centimes signés (négatif : il en sort). */
export interface FluxDeLaCaisse { jour: string; centimes: number; source: SourceDuFlux; id: string | null }

const enCentimes = (montant: number) => Math.round(montant * 100)

// Les espèces d'une facture SOURCE qui n'ont pas rejoint la banque par leur propre mouvement : un encaissement en espèces
// sans mouvement, non retiré, ou la contre-passation sans mouvement d'un tel encaissement — ce que la composition des ventes
// facturées écrit au compte de la caisse (EC3-Q7). Celui d'une facture qui n'est pas source ne s'écrit pas : il n'y entre pas.
// Publique pour C6-Q1 : un tel encaissement dit aussi que le dossier tient une caisse (lib/controlesDeLaCaisse.ts).
export function especesDUneFactureSource(
  e: EncaissementDeLaCaisse, etat: Pick<EtatDeLaCaisse, 'encaissements' | 'factures'>,
): boolean {
  const facture = etat.factures.find((f) => f.id === e.facture_id)
  if (!facture?.source_de_la_vente || e.retire_le != null || e.ligne_bancaire_id != null) return false
  if (e.annule_id == null) return e.moyen === 'especes'
  const annule = etat.encaissements.find((o) => o.id === e.annule_id)
  return annule != null && annule.ligne_bancaire_id == null && annule.moyen === 'especes'
}

/**
 * Le premier jour que la caisse compte : la date des à-nouveaux de SON compte (une reprise n'a qu'une date), ou rien quand
 * la reprise n'en porte pas — comme `premier_jour_negatif_de_la_caisse` le borne depuis la migration
 * `paiement_par_la_caisse`. Ce qui le précède est dans les comptes repris : le 53 de la balance le porte déjà.
 */
export function premierJourDeLaCaisse(etat: Pick<EtatDeLaCaisse, 'compteCaisse' | 'ouvertures'>): string | null {
  return etat.ouvertures.filter((a) => a.compte === etat.compteCaisse).map((a) => a.date).sort()[0] ?? null
}

/** L'ouverture du DOSSIER : la plus ancienne date de ses à-nouveaux, tout compte confondu (celle qui refuse une opération). */
export function ouvertureDuDossier(etat: { ouvertures: readonly Pick<ANouveau, 'date'>[] }): string | null {
  return etat.ouvertures.map((a) => a.date).sort()[0] ?? null
}

/**
 * Les flux de la caisse, comme `premier_jour_negatif_de_la_caisse` les réunit : l'ouverture (les à-nouveaux du compte de
 * la caisse, au débit ou au crédit), les opérations non retirées (un prélèvement en sort ; les autres, leur montant
 * signé), les mouvements classés sur le compte de la caisse (un crédit — le versement en banque — la vide, un débit la
 * remplit), les espèces des factures sources sans mouvement et leurs contre-passations ; à partir du premier jour que la
 * caisse compte (`premierJourDeLaCaisse`) — ce qui le précède, un retrait au distributeur de la veille classé sur la
 * caisse par exemple, se compterait sinon une seconde fois après le 53 repris qui le porte déjà.
 */
export function fluxDeLaCaisse(etat: EtatDeLaCaisse): FluxDeLaCaisse[] {
  const premierJour = premierJourDeLaCaisse(etat)
  return fluxSansBorne(etat).filter((f) => premierJour == null || f.jour >= premierJour)
}

function fluxSansBorne(etat: EtatDeLaCaisse): FluxDeLaCaisse[] {
  return [
    ...etat.ouvertures.filter((a) => a.compte === etat.compteCaisse).map((a) => ({
      jour: a.date, centimes: (a.sens === 'debit' ? 1 : -1) * enCentimes(a.montant), source: 'ouverture' as const, id: null,
    })),
    ...etat.operations.filter((o) => o.retire_le == null).map((o) => ({
      jour: o.date, centimes: (o.genre === 'prelevement' ? -1 : 1) * enCentimes(o.montant), source: 'operation' as const, id: o.id,
    })),
    ...etat.mouvements.filter((l) => l.compte_bilan === etat.compteCaisse).map((l) => ({
      jour: l.date, centimes: -enCentimes(l.montant), source: 'mouvement' as const, id: l.id,
    })),
    ...etat.encaissements.filter((e) => especesDUneFactureSource(e, etat)).map((e) => ({
      jour: e.date_encaissement, centimes: enCentimes(e.montant), source: 'encaissement' as const, id: e.id,
    })),
  ]
}

/**
 * LES FLUX D'AVANT L'OUVERTURE DU DOSSIER (ligne 26.6, étape C9b ; le défaut K1 de la relecture du 31/10/2026) : ce qui
 * précède la reprise et que la caisse lit pourtant — un retrait au distributeur de la veille classé sur la caisse, une
 * opération restaurée. Deux cas, selon la reprise :
 *   - elle porte la caisse (`premierJourDeLaCaisse`) : la caisse borne son compte à ce jour, et ces flux ne comptent pas
 *     (`compte` faux) — le 53 repris les porte déjà ;
 *   - elle ne la porte pas, mais le dossier est repris (`ouvertureDuDossier`) : rien ne borne la caisse, et ces flux
 *     comptent (`compte` vrai), alors qu'ils sont dans les comptes repris : à retirer.
 * Rien pour un dossier qui n'est pas repris. Dans l'ordre des jours, puis de la source. PUR : ni la caisse ni ses soldes ne
 * changent ici ; l'écran le DIT (CaisseTab), la Vue d'ensemble dit le mouvement à retirer (lib/pointsDeLaChecklist.ts).
 */
export function fluxAvantLOuverture(etat: EtatDeLaCaisse): (FluxDeLaCaisse & { compte: boolean })[] {
  const premierJour = premierJourDeLaCaisse(etat)
  const ouverture = premierJour ?? ouvertureDuDossier(etat)
  if (ouverture == null) return []
  return fluxSansBorne(etat)
    .filter((f) => f.jour < ouverture)
    .map((f) => ({ ...f, compte: premierJour == null }))
    .sort((a, b) => a.jour.localeCompare(b.jour) || a.source.localeCompare(b.source) || (a.id ?? '').localeCompare(b.id ?? ''))
}

/** Le solde de la caisse à la fin de chaque jour qui porte un flux, l'ouverture comprise, en centimes. */
export function soldesDeLaCaisse(etat: EtatDeLaCaisse): { jour: string; centimes: number }[] {
  const parJour = new Map<string, number>()
  for (const f of fluxDeLaCaisse(etat)) parJour.set(f.jour, (parJour.get(f.jour) ?? 0) + f.centimes)
  let solde = 0
  return [...parJour.keys()].sort().map((jour) => {
    solde += parJour.get(jour)!
    return { jour, centimes: solde }
  })
}

/** Le premier jour où la caisse est négative, et son solde en centimes ; nul quand elle ne l'est jamais. */
export function premierJourNegatif(etat: EtatDeLaCaisse): { jour: string; centimes: number } | null {
  return soldesDeLaCaisse(etat).find((s) => s.centimes < 0) ?? null
}

/** Le refus de la caisse jamais négative pour ce geste, ou rien : `texte_caisse_negative`, en 23514. */
export function refusDeLaCaisse(etat: EtatDeLaCaisse, geste: GesteDeLaCaisse, montantCentimes: number): RefusCaisse | null {
  const negatif = premierJourNegatif(etat)
  return negatif ? { code: '23514', message: texteCaisseNegative(geste, montantCentimes, negatif.jour, negatif.centimes) } : null
}

/** Les encaissements en espèces de factures sources que la caisse compte CE jour-là, triés par identifiant. */
export function encaissementsDuJour(etat: EtatDeLaCaisse, jour: string): string[] {
  return etat.encaissements.filter((e) => e.date_encaissement === jour && especesDUneFactureSource(e, etat))
    .map((e) => e.id).sort()
}

/**
 * Les paiements par la caisse, non retirés, de pièces de VENTE, CE jour-là (la migration `paiement_par_la_caisse`) : le
 * paiement compte sa vente, le total du jour ne la compte pas une seconde fois. Triés par identifiant.
 */
export function paiementsDeVenteDuJour(etat: EtatDeLaCaisse, jour: string): string[] {
  const ventes = new Set(etat.piecesDeVente ?? [])
  return etat.operations.filter((o) => o.genre === 'paiement' && o.retire_le == null && o.date === jour
    && o.piece_id != null && ventes.has(o.piece_id)).map((o) => o.id).sort()
}

/**
 * L'ensemble qu'une recette du jour doit reconnaître (CAISSE-Q2, (A)) : les encaissements en espèces de factures sources
 * que la caisse compte CE jour-là, et les paiements par la caisse de pièces de vente de ce jour — ce que la saisie passe,
 * trié par identifiant comme la base le range.
 */
export function ensembleDuJour(etat: EtatDeLaCaisse, jour: string): string[] {
  return [...encaissementsDuJour(etat, jour), ...paiementsDeVenteDuJour(etat, jour)].sort()
}

// ── L'écriture d'une opération, au plan du dossier ────────────────────────────────────────────────────────────────────

/** Une ligne de l'écriture d'une opération de caisse, telle qu'elle part à la base. */
export interface LigneEcritureCaisse { compte: string; sens: 'debit' | 'credit'; montant: number; libelle: string }

/** La catégorie d'une recette, telle que la caisse la lit (du dossier, ou commune : `dossier_id` nul). */
export interface CategorieDeLaCaisse { id: string; dossier_id: string | null; libelle: string; compte_comptable: string | null }

/** Une opération à écrire : ce que l'écran a saisi, la catégorie résolue. */
export interface OperationAEcrire {
  genre: 'recette' | 'apport' | 'prelevement'
  date: string
  montant: number
  taux_tva: number | null
  categorie: Pick<CategorieDeLaCaisse, 'libelle' | 'compte_comptable'> | null
}

/** Le libellé de l'écriture, composé comme la base le compose, sans nom : celui que la base exige s'il en part un. */
export function libelleDeLOperation(op: Pick<OperationAEcrire, 'genre' | 'date' | 'montant' | 'categorie'>): string {
  if (op.genre === 'recette') {
    return `${op.montant > 0 ? 'Recettes en espèces du ' : 'Espèces rendues le '}${jourDit(op.date)} — ${op.categorie?.libelle ?? ''}`
  }
  return op.genre === 'apport' ? 'Apport en caisse de l\'exploitant' : 'Prélèvement en espèces de l\'exploitant'
}

interface LigneEnCentimes { compte: string; sens: 'debit' | 'credit'; centimes: number }

// L'écriture attendue, en centimes ENTIERS, comme la base la recompose : la caisse face au produit hors taxe et à sa TVA
// pour une recette (l'inverse pour des espèces rendues), face au compte de l'exploitant pour un apport (l'inverse pour un
// prélèvement). Une ligne à zéro n'en est pas une : une recette exonérée n'a pas de ligne de TVA.
function ecritureEnCentimes(op: OperationAEcrire, modele: ModeleComptable): LigneEnCentimes[] {
  const centimes = Math.abs(centimesDe(op.montant) ?? enCentimes(op.montant))
  const sortie = op.genre === 'prelevement' || op.montant < 0
  const tva = op.genre === 'recette' && op.taux_tva != null && op.taux_tva > 0 ? tvaEnCentimes(centimes, op.taux_tva) : 0
  const lignes: LigneEnCentimes[] = [
    { compte: modele.plan.caisse, sens: sortie ? 'credit' : 'debit', centimes },
    {
      compte: op.genre === 'recette' ? op.categorie?.compte_comptable ?? '' : compteDuDirigeant(modele),
      sens: sortie ? 'debit' : 'credit',
      centimes: centimes - tva,
    },
    { compte: modele.plan.tva_collectee, sens: op.montant < 0 ? 'debit' : 'credit', centimes: tva },
  ]
  return lignes.filter((l) => l.centimes > 0)
}

/** L'écriture d'une opération de caisse au plan du dossier, telle qu'elle part à `enregistrer_operation_caisse`. */
export function ecritureDeLOperation(op: OperationAEcrire, modele: ModeleComptable): LigneEcritureCaisse[] {
  const libelle = libelleDeLOperation(op)
  return ecritureEnCentimes(op, modele).map((l) => ({ compte: l.compte, sens: l.sens, montant: l.centimes / 100, libelle }))
}

// ── Le dossier, tel que les refus le lisent ───────────────────────────────────────────────────────────────────────────

/**
 * Ce que les fonctions de la caisse lisent d'un dossier, en plus de sa caisse : qui écrit (`qui_ecrit_la_caisse` : le
 * cabinet, le client, ou personne), l'utilisateur, son modèle et son plan, s'il est assujetti, le jour à Paris, l'ouverture
 * d'un dossier repris (la plus ancienne date de ses à-nouveaux), ses exercices validés, ses catégories et les communes.
 */
export interface DossierDeLaCaisse {
  quiEcrit: OrigineOperationCaisse | null
  utilisateur: string | null
  modele: ModeleComptable
  assujetti: boolean
  aujourdhui: string
  ouverture: string | null
  anneesValidees: readonly number[]
  categories: readonly CategorieDeLaCaisse[]
  caisse: EtatDeLaCaisse
}

/**
 * Une saisie telle qu'elle part à `enregistrer_operation_caisse` — ses paramètres, rien d'autre : le genre et la date en
 * texte, le montant et le taux en nombres, la catégorie, l'ensemble du jour (des identifiants, ou nul), l'écriture (ce qui
 * part en JSON, quelle que soit sa forme).
 */
export interface SaisieDeCaisse {
  genre: string | null
  date: string | null
  montant: number | null
  categorie_id: string | null
  taux_tva: number | null
  encaissements_du_jour: readonly (string | null)[] | null
  ecritures: unknown
}

const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/

function frontiereFranchie(date: string, dossier: DossierDeLaCaisse): RefusCaisse | null {
  const frontiere = frontiereDeValidation(dossier.anneesValidees)
  if (frontiere == null || date > frontiere) return null
  const annee = Number(date.slice(0, 4))
  return refus('frontiere', exerciceQuiFige(annee, dossier.anneesValidees) ?? `L'exercice ${annee} est validé`)
}

/**
 * Les refus de la DATE d'une opération de caisse, dans l'ordre de la base : renseignée, pas avant 2000, pas dans l'avenir à
 * Paris, pas avant l'ouverture d'un dossier repris, pas dans un exercice figé. Ceux d'`enregistrer_operation_caisse`, que
 * `regler_piece_par_la_caisse` dit sous les mêmes mots.
 */
export function jugerLaDate(date: string | null, dossier: DossierDeLaCaisse): { refus: RefusCaisse } | { refus: null; date: string } {
  if (date == null) return { refus: refus('date_absente') }
  if (date < '2000-01-01') return { refus: refus('date_avant_2000') }
  if (date > dossier.aujourdhui) return { refus: refus('date_future', jourDit(dossier.aujourdhui)) }
  if (dossier.ouverture != null && date < dossier.ouverture) return { refus: refus('date_avant_ouverture', jourDit(dossier.ouverture)) }
  const figee = frontiereFranchie(date, dossier)
  return figee ? { refus: figee } : { refus: null, date }
}

/**
 * Les refus du MONTANT d'une opération de caisse, dans l'ordre de la base : renseigné, au centime, non nul, positif quand
 * `positif` l'exige (un apport, un prélèvement), borné. Ceux d'`enregistrer_operation_caisse` ; `regler_piece_par_la_caisse`
 * dit les mêmes, sauf le signe, que le sens de la pièce juge ensuite.
 */
export function jugerLeMontant(montant: number | null, positif: boolean):
  { refus: RefusCaisse } | { refus: null; montant: number; centimes: number } {
  if (montant == null) return { refus: refus('montant_absent') }
  const centimes = centimesDe(montant)
  if (centimes == null) return { refus: refus('montant_centime') }
  if (centimes === 0) return { refus: refus('montant_nul') }
  if (positif && centimes < 0) return { refus: refus('montant_negatif') }
  if (Math.abs(centimes) >= BORNE_CENTIMES) return { refus: refus('montant_borne') }
  return { refus: null, montant, centimes }
}

function numeroDeLaFacture(encaissementId: string, etat: EtatDeLaCaisse): string | null {
  const e = etat.encaissements.find((x) => x.id === encaissementId)
  if (!e) return null
  return etat.factures.find((f) => f.id === e.facture_id)?.numero ?? null
}

// L'écriture reçue, comparée en MULTIENSEMBLE à l'attendue, en centimes exacts : autant de lignes, chacune des attendues
// présente, et le libellé de la base pour toute ligne qui en porte un.
function ecritureRecue(ecritures: unknown): { compte: string; sens: string; montant: number; libelle: unknown }[] | null {
  if (!Array.isArray(ecritures)) return null
  const lignes: { compte: string; sens: string; montant: number; libelle: unknown }[] = []
  for (const e of ecritures) {
    if (typeof e !== 'object' || e == null || Array.isArray(e)) return null
    const x = e as Record<string, unknown>
    if (typeof x.compte !== 'string' || typeof x.sens !== 'string' || typeof x.montant !== 'number' || !Number.isFinite(x.montant)) return null
    if (x.libelle !== undefined && x.libelle !== null && typeof x.libelle !== 'string') return null
    lignes.push({ compte: x.compte, sens: x.sens, montant: x.montant, libelle: x.libelle })
  }
  return lignes
}

function ecritureConformeALaCaisse(recue: readonly { compte: string; sens: string; montant: number; libelle: unknown }[],
  attendue: readonly LigneEnCentimes[], libelle: string): boolean {
  if (recue.length !== attendue.length) return false
  const restantes = recue.map((l) => ({ compte: l.compte, sens: l.sens, centimes: centimesDe(l.montant) }))
  for (const a of attendue) {
    const i = restantes.findIndex((r) => r.compte === a.compte && r.sens === a.sens && r.centimes === a.centimes)
    if (i < 0) return false
    restantes.splice(i, 1)
  }
  return recue.every((l) => typeof l.libelle !== 'string' || l.libelle === libelle)
}

/** L'opération qu'une saisie acceptée écrit, telle que la base l'insère. */
function operationDeLaSaisie(saisie: SaisieDeCaisse, id: string, dossier: DossierDeLaCaisse): OperationDeLaCaisse {
  return {
    id, genre: saisie.genre as GenreOperationCaisse, date: saisie.date!, montant: saisie.montant!,
    categorie_id: saisie.categorie_id, taux_tva: saisie.taux_tva,
    encaissements_du_jour: saisie.genre === 'recette' ? [...new Set(saisie.encaissements_du_jour as string[])].sort() : null,
    piece_id: null, origine: dossier.quiEcrit ?? 'cabinet', cree_par: dossier.utilisateur, remplace_id: null, retire_le: null,
  }
}

/** La caisse après l'ajout d'une opération. */
export function avecLOperation(etat: EtatDeLaCaisse, operation: OperationDeLaCaisse): EtatDeLaCaisse {
  return { ...etat, operations: [...etat.operations, operation] }
}

/** La caisse après le retrait d'une opération (`retire_le` posé ; elle ne compte plus). */
export function sansLOperation(etat: EtatDeLaCaisse, operationId: string, instant: string): EtatDeLaCaisse {
  return { ...etat, operations: etat.operations.map((o) => (o.id === operationId ? { ...o, retire_le: instant } : o)) }
}

/**
 * Ce qu'`enregistrer_operation_caisse` refuserait de CETTE saisie, telle qu'elle part, dans son ordre et sous ses mots ;
 * nul quand elle l'écrirait. La caisse jamais négative se juge ici quand la saisie fait sortir des espèces — un
 * prélèvement, des espèces rendues —, sauf dans la saisie d'un mois (`dansUnLot`), qui la juge à sa fin. L'opération
 * acceptée est rendue avec la caisse qui la porte : la saisie d'un mois et le remplacement continuent sur elle.
 */
export function jugerLaSaisie(saisie: SaisieDeCaisse, dossier: DossierDeLaCaisse, dansUnLot: boolean, id: string):
  { refus: RefusCaisse } | { refus: null; operation: OperationDeLaCaisse; caisse: EtatDeLaCaisse } {
  const r = (x: RefusCaisse) => ({ refus: x })
  // 1. L'accès, avant toute lecture.
  if (dossier.quiEcrit == null) return r(refus('acces'))
  // 2. Le dossier en trésorerie.
  if (dossier.modele.mode !== 'tresorerie') return r(refus('tresorerie'))
  // 3. Le genre.
  const genre = saisie.genre
  if (genre == null || !(GENRES_SAISIS as readonly string[]).includes(genre)) return r(refus('genre'))
  // 4. La date.
  const laDate = jugerLaDate(saisie.date, dossier)
  if (laDate.refus) return r(laDate.refus)
  const { date } = laDate
  // 5. Le montant.
  const leMontant = jugerLeMontant(saisie.montant, genre !== 'recette')
  if (leMontant.refus) return r(leMontant.refus)
  const { montant, centimes } = leMontant
  // 6. La catégorie d'une recette, et son compte de produit.
  let categorie: CategorieDeLaCaisse | null = null
  if (genre === 'recette') {
    if (saisie.categorie_id == null) return r(refus('categorie_absente'))
    categorie = dossier.categories.find((c) => c.id === saisie.categorie_id) ?? null
    if (categorie == null) return r(refus('categorie_inconnue'))
    if (categorie.compte_comptable == null || !/^7[0-9]{2}/.test(categorie.compte_comptable)) {
      return r(refus('categorie_sans_produit', categorie.libelle))
    }
  } else if (saisie.categorie_id != null) {
    return r(refus('categorie_de_trop'))
  }
  // 7. Le taux.
  if (genre === 'recette' && dossier.assujetti) {
    if (saisie.taux_tva == null) return r(refus('taux_absent'))
    if (!TAUX_DE_LA_CAISSE.includes(saisie.taux_tva)) return r(refus('taux_inconnu'))
  } else if (saisie.taux_tva != null) {
    return r(refus('taux_de_trop'))
  }
  // 8. L'ensemble du jour : les espèces des factures sources que la caisse compte ce jour-là.
  const etat = dossier.caisse
  if (genre === 'recette') {
    const recus = saisie.encaissements_du_jour
    if (recus == null || recus.some((x) => x == null)) return r(refus('ensemble_absent'))
    const distincts = [...new Set(recus as string[])].sort()
    if (distincts.length !== recus.length) return r(refus('ensemble_doublon'))
    const attendus = encaissementsDuJour(etat, date)
    const paiements = paiementsDeVenteDuJour(etat, date)
    const manquant = attendus.filter((x) => !distincts.includes(x)).sort()[0]
    if (manquant != null) return r(refus('ensemble_manquant', numeroDeLaFacture(manquant, etat) ?? '(sans numéro)'))
    if (paiements.some((x) => !distincts.includes(x))) return r(refus('ensemble_paiement_manquant'))
    const enTrop = distincts.filter((x) => !attendus.includes(x) && !paiements.includes(x)).sort()[0]
    if (enTrop != null) {
      if (etat.encaissements.some((e) => e.id === enTrop)) {
        return r(refus('ensemble_en_trop', numeroDeLaFacture(enTrop, etat) ?? '(sans numéro)'))
      }
      return r(etat.operations.some((o) => o.id === enTrop && o.genre === 'paiement')
        ? refus('ensemble_paiement_en_trop')
        : refus('ensemble_etranger'))
    }
  } else if (saisie.encaissements_du_jour != null && saisie.encaissements_du_jour.length > 0) {
    return r(refus('ensemble_hors_recette'))
  }
  // 9. L'écriture, recomposée en centimes entiers et comparée en multiensemble.
  const recue = ecritureRecue(saisie.ecritures)
  if (recue == null) return r(refus('ecriture_incomplete'))
  const op: OperationAEcrire = { genre: genre as OperationAEcrire['genre'], date, montant, taux_tva: saisie.taux_tva, categorie }
  if (!ecritureConformeALaCaisse(recue, ecritureEnCentimes(op, dossier.modele), libelleDeLOperation(op))) {
    return r(refus('ecriture_fausse', dossier.modele.plan.caisse))
  }
  // L'opération et son écriture, d'un tenant.
  const operation = operationDeLaSaisie(saisie, id, dossier)
  const caisse = avecLOperation(etat, operation)
  // 10. La caisse jamais négative, dite ici sous les mots du geste ; une saisie d'un mois la juge à sa fin.
  if (!dansUnLot && (genre === 'prelevement' || centimes < 0)) {
    const negative = refusDeLaCaisse(caisse, genre === 'prelevement' ? 'prelevement' : 'especes_rendues', centimes)
    if (negative) return r(negative)
  }
  return { refus: null, operation, caisse }
}

/** Le refus d'`enregistrer_operation_caisse` pour cette saisie, ou rien. */
export function refusDeLaSaisie(saisie: SaisieDeCaisse, dossier: DossierDeLaCaisse): RefusCaisse | null {
  return jugerLaSaisie(saisie, dossier, false, 'saisie').refus
}

// ── La saisie d'un mois ───────────────────────────────────────────────────────────────────────────────────────────────

const CHAMPS_D_UNE_OPERATION = ['genre', 'date', 'montant', 'categorie_id', 'taux_tva', 'encaissements_du_jour', 'ecritures']

// Un identifiant tel que Postgres le lit (`::uuid`) : trente-deux chiffres hexadécimaux, un tiret permis après chaque
// groupe de quatre, des accolades autour ; rendu sous sa forme canonique, en minuscules.
function uuidLu(texte: string): string | null {
  const m = /^\{?([0-9a-f]{4}(?:-?[0-9a-f]{4}){7})\}?$/i.exec(texte)
  if (!m || texte.startsWith('{') !== texte.endsWith('}')) return null
  const h = m[1].replace(/-/g, '').toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// Une date AAAA-MM-JJ qui existe au calendrier, comme `::date` la lit.
function dateExiste(texte: string): boolean {
  const [a, m, j] = texte.split('-').map(Number)
  if (a < 1 || m < 1 || m > 12 || j < 1) return false
  const bissextile = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
  return j <= [31, bissextile ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

// L'ordre des octets (`collate "C"`) : celui des points de code.
function avantEnC(a: string, b: string): boolean {
  const x = Array.from(a).map((c) => c.codePointAt(0)!)
  const y = Array.from(b).map((c) => c.codePointAt(0)!)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i]
  return x.length < y.length
}

const typeJson = (v: unknown): string => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v

/**
 * Ce qu'`enregistrer_operations_de_caisse` refuserait de CETTE saisie d'un mois, telle qu'elle part (le tableau JSON),
 * dans son ordre et sous ses mots ; nul quand elle l'écrirait. Tout ou rien : le premier refus d'une opération repart
 * sous son code, nommé par son rang et son jour ; la caisse jamais négative se juge à la fin, sur toute la saisie.
 */
export function refusDeLaSaisieDUnMois(operations: unknown, dossier: DossierDeLaCaisse): RefusCaisse | null {
  return jugerLaSaisieDUnMois(operations, dossier).refus
}

export function jugerLaSaisieDUnMois(operations: unknown, dossier: DossierDeLaCaisse):
  { refus: RefusCaisse } | { refus: null; caisse: EtatDeLaCaisse; ids: string[] } {
  if (dossier.quiEcrit == null) return { refus: refus('acces') }
  if (!Array.isArray(operations)) return { refus: refus('mois_pas_un_tableau') }
  if (operations.length === 0) return { refus: refus('mois_vide') }
  if (operations.length > 1000) return { refus: refus('mois_trop_long', String(operations.length)) }
  let courant = dossier
  const ids: string[] = []
  for (let i = 0; i < operations.length; i++) {
    let jourLu: string | null = null
    const nomme = (x: RefusCaisse): { refus: RefusCaisse } => ({
      refus: { code: x.code, message: `Opération n° ${i + 1}${jourLu != null ? `, du ${jourLu}` : ''} : ${x.message}` },
    })
    const op = operations[i]
    if (typeJson(op) !== 'object') return nomme(refus('mois_pas_un_objet'))
    const champs = op as Record<string, unknown>
    const inconnus = Object.keys(champs).filter((k) => !CHAMPS_D_UNE_OPERATION.includes(k))
    if (inconnus.length > 0) {
      const premier = inconnus.reduce((a, b) => (avantEnC(b, a) ? b : a))
      const lettres = Array.from(premier)
      return nomme(refus('mois_champ_inconnu', lettres.length > 80 ? `${lettres.slice(0, 79).join('')}…` : premier))
    }
    const type = (cle: string) => typeJson(champs[cle] === undefined ? null : champs[cle])
    if (!['null', 'string'].includes(type('genre')) || !['null', 'string'].includes(type('date'))
      || !['null', 'number'].includes(type('montant')) || !['null', 'string'].includes(type('categorie_id'))
      || !['null', 'number'].includes(type('taux_tva')) || !['null', 'array'].includes(type('encaissements_du_jour'))
      || (Array.isArray(champs.encaissements_du_jour) && champs.encaissements_du_jour.some((x) => typeof x !== 'string'))) {
      return nomme(refus('mois_champ_illisible'))
    }
    const date = (champs.date ?? null) as string | null
    if (date != null && (!DATE_CIVILE.test(date) || !dateExiste(date))) return nomme(refus('mois_date_illisible'))
    jourLu = date != null ? jourDit(date) : null
    const categorie = (champs.categorie_id ?? null) as string | null
    const categorieLue = categorie == null ? null : uuidLu(categorie)
    const encaissements = Array.isArray(champs.encaissements_du_jour)
      ? (champs.encaissements_du_jour as string[]).map(uuidLu) : null
    if ((categorie != null && categorieLue == null) || (encaissements != null && encaissements.some((x) => x == null))) {
      return nomme(refus('mois_identifiant_illisible'))
    }
    const saisie: SaisieDeCaisse = {
      genre: (champs.genre ?? null) as string | null, date, montant: (champs.montant ?? null) as number | null,
      categorie_id: categorieLue, taux_tva: (champs.taux_tva ?? null) as number | null,
      encaissements_du_jour: encaissements, ecritures: champs.ecritures ?? null,
    }
    const id = `saisie-${i + 1}`
    const jugee = jugerLaSaisie(saisie, courant, true, id)
    if (jugee.refus) return nomme(jugee.refus)
    courant = { ...courant, caisse: jugee.caisse }
    ids.push(id)
  }
  const negative = refusDeLaCaisse(courant.caisse, 'lot', 0)
  return negative ? { refus: negative } : { refus: null, caisse: courant.caisse, ids }
}

// ── Le retrait et le remplacement ─────────────────────────────────────────────────────────────────────────────────────

// Les cinq premiers refus du retrait, qui sont aussi ceux du remplacement sur l'ancienne opération : l'accès, l'opération
// de ce dossier, pour le client ses propres opérations seulement, une opération déjà retirée ou remplacée, la frontière.
function refusDeLAncienne(operationId: string | null, dossier: DossierDeLaCaisse):
  { refus: RefusCaisse } | { refus: null; operation: OperationDeLaCaisse } {
  if (dossier.quiEcrit == null) return { refus: refus('acces') }
  const operation = operationId == null ? undefined : dossier.caisse.operations.find((o) => o.id === operationId)
  if (operation == null) return { refus: refus('operation_inconnue') }
  if (dossier.quiEcrit === 'client' && operation.origine === 'cabinet') return { refus: refus('operation_du_cabinet') }
  if (dossier.quiEcrit === 'client' && operation.cree_par !== dossier.utilisateur) return { refus: refus('operation_d_un_autre_acces') }
  if (operation.retire_le != null) return { refus: refus('operation_retiree') }
  const figee = frontiereFranchie(operation.date, dossier)
  if (figee) return { refus: figee }
  return { refus: null, operation }
}

// Une opération qui APPORTAIT des espèces — une recette, un apport, le paiement d'une pièce de vente — ne se retire pas si
// la caisse passait alors sous zéro : son retrait se juge sous les mots de son geste.
function retraitJuge(operation: OperationDeLaCaisse, caisse: EtatDeLaCaisse): RefusCaisse | null {
  const centimes = enCentimes(operation.montant)
  if (operation.genre === 'prelevement' || centimes <= 0) return null
  return refusDeLaCaisse(caisse, `retrait_${operation.genre}` as GesteDeLaCaisse, centimes)
}

/**
 * Ce que `retirer_operation_caisse` refuserait, dans son ordre et sous ses mots, ou rien ; avec la caisse qu'il laisse.
 * `instant` est celui du retrait (la base pose `now()`).
 */
export function jugerLeRetrait(operationId: string | null, dossier: DossierDeLaCaisse, instant: string):
  { refus: RefusCaisse } | { refus: null; caisse: EtatDeLaCaisse } {
  const ancienne = refusDeLAncienne(operationId, dossier)
  if (ancienne.refus) return { refus: ancienne.refus }
  const caisse = sansLOperation(dossier.caisse, ancienne.operation.id, instant)
  const negative = retraitJuge(ancienne.operation, caisse)
  return negative ? { refus: negative } : { refus: null, caisse }
}

export function refusDuRetrait(operationId: string | null, dossier: DossierDeLaCaisse): RefusCaisse | null {
  return jugerLeRetrait(operationId, dossier, 'maintenant').refus
}

/**
 * Ce que `remplacer_operation_caisse` refuserait, dans son ordre et sous ses mots, ou rien ; avec la caisse qu'il laisse.
 * Les cinq premiers refus du retrait sur l'ancienne ; puis l'ancienne retirée, la nouvelle jugée par les refus
 * d'`enregistrer_operation_caisse` (une sortie neuve parle la première, sous ses mots) ; enfin la caisse, sous les mots du
 * retrait de l'ANCIENNE quand elle apportait des espèces que la nouvelle ne rend pas. Un remplacement qui ne passe sous
 * zéro qu'un instant passe.
 */
export function jugerLeRemplacement(operationId: string | null, saisie: SaisieDeCaisse, dossier: DossierDeLaCaisse,
  instant: string, id: string): { refus: RefusCaisse } | { refus: null; caisse: EtatDeLaCaisse; operation: OperationDeLaCaisse } {
  const ancienne = refusDeLAncienne(operationId, dossier)
  if (ancienne.refus) return { refus: ancienne.refus }
  const sansElle: DossierDeLaCaisse = { ...dossier, caisse: sansLOperation(dossier.caisse, ancienne.operation.id, instant) }
  const nouvelle = jugerLaSaisie(saisie, sansElle, false, id)
  if (nouvelle.refus) return { refus: nouvelle.refus }
  const operation = { ...nouvelle.operation, remplace_id: ancienne.operation.id }
  const caisse = { ...nouvelle.caisse, operations: nouvelle.caisse.operations.map((o) => (o.id === id ? operation : o)) }
  const negative = retraitJuge(ancienne.operation, caisse)
  return negative ? { refus: negative } : { refus: null, caisse, operation }
}

export function refusDuRemplacement(operationId: string | null, saisie: SaisieDeCaisse, dossier: DossierDeLaCaisse): RefusCaisse | null {
  return jugerLeRemplacement(operationId, saisie, dossier, 'maintenant', 'remplacante').refus
}

// ── Le remplacement et l'origine, lus ─────────────────────────────────────────────────────────────────────────────────

/**
 * La chaîne des versions d'une opération, de la première saisie à la dernière : chaque version qui en remplace une pointe
 * celle qu'elle remplace par `remplace_id` (une opération n'est remplacée qu'une fois :
 * `operations_caisse_un_remplacement`). Une opération inconnue rend une chaîne vide ; un cycle, que la base refuse,
 * s'arrête au premier retour.
 */
export function versionsDeLOperation(operationId: string, operations: readonly Pick<OperationCaisse, 'id' | 'remplace_id'>[]):
  Pick<OperationCaisse, 'id' | 'remplace_id'>[] {
  const parId = new Map(operations.map((o) => [o.id, o]))
  const remplacante = new Map(operations.filter((o) => o.remplace_id != null).map((o) => [o.remplace_id!, o]))
  let premiere = parId.get(operationId)
  if (!premiere) return []
  const vues = new Set<string>([premiere.id])
  while (premiere.remplace_id != null && parId.has(premiere.remplace_id) && !vues.has(premiere.remplace_id)) {
    premiere = parId.get(premiere.remplace_id)!
    vues.add(premiere.id)
  }
  const chaine = [premiere]
  const parcourues = new Set<string>([premiere.id])
  for (let suivante = remplacante.get(premiere.id); suivante && !parcourues.has(suivante.id); suivante = remplacante.get(suivante.id)) {
    chaine.push(suivante)
    parcourues.add(suivante.id)
  }
  return chaine
}

/** L'opération qui en remplace une autre, ou rien. */
export function remplacanteDe<O extends Pick<OperationCaisse, 'id' | 'remplace_id'>>(operationId: string, operations: readonly O[]): O | null {
  return operations.find((o) => o.remplace_id === operationId) ?? null
}

// CE QUE L'ORIGINE DIT AU CABINET (CAISSE2-Q1) : une opération que le client a saisie se marque « saisie par le client »,
// celle qui en remplace une « remplacée par le client » ; celles du cabinet ne se marquent pas. Sur une lecture faite en
// entier seulement : c'est à l'écran (C4) de ne pas l'appeler sur une liste partielle.
export function origineDite(operation: Pick<OperationCaisse, 'origine' | 'remplace_id'>): string | null {
  if (operation.origine !== 'client') return null
  return operation.remplace_id != null ? 'remplacée par le client' : 'saisie par le client'
}
