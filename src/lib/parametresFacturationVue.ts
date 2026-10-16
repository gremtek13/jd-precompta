import { estLeClient, PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import { MOYENS_ENCAISSEMENT } from './encaissementsFactures'
import type { EspaceVentes } from './espaceVentes'
import {
  CHAMPS_DES_PARAMETRES, PROPOSITIONS_PAR_DEFAUT, ceQueDitLeRib, etatDuRibEnregistre, jourEtHeureAParis, refusConfirmationRib,
  refusEnregistrementParametres, ribEnVigueur, saisieQuiPart, versionCourante, type CleRefusConfirmationRib,
  type CleRefusEnregistrementParametres, type Geste, type ParametresEnvoyes, type RefusParametres, type SaisieParametresFacturation,
} from './parametresFacturation'
import type { MoyenEncaissement, ParametresFacturation } from './types'

// « PARAMÈTRES », À L'ÉCRAN (espace client, étape A5b1 ; MEG1-Q12, MEG1-Q13, A5-Q4 à A5-Q6, décisions du cabinet du
// 16/10/2026). Un module PUR : il ne lit rien en base, n'appelle personne, ne lit pas l'horloge. Il dit ce que la vue
// « Paramètres » de l'onglet Factures et de « Mes ventes » montre, et prépare ce que son formulaire envoie ; JAMAIS une règle
// de la base : ce que `enregistrer_parametres_facturation` et `confirmer_rib` refuseraient, ce que deviendra un RIB, le RIB en
// vigueur et qui a posé ou confirmé un RIB, c'est `lib/parametresFacturation.ts` qui le dit, sous les mots de la base.
//
// CE QUE CES PARAMÈTRES FONT AUJOURD'HUI : RIEN SUR UNE FACTURE. Aucune facture ne les lit ni ne les imprime avant l'étape
// A7, qui figera sur chaque facture validée ce qu'elle imprime. La vue le dit en tête, et aucun texte d'ici ne dit qu'un RIB
// ou une mention est imprimé : « en vigueur » se dit du RIB que les factures porteront QUAND elles porteront un RIB.
//
// « PAR LE CLIENT » AU CABINET SEUL, sur des accès lus EN ENTIER (`estLeClient`) : l'auteur d'une version, qui a posé et qui
// a confirmé un RIB ; jamais deviné, jamais « par le cabinet » d'un compte que les accès ne reconnaissent pas.

// ── Ce que la lecture permet de dire ─────────────────────────────────────────────────────────────────────────────────
export type ResumeParametres =
  // Lue en partie ou refusée : le motif, tel que la lecture le donne ; ni version ni vide ne se disent.
  | { etat: 'incomplete'; motif: string }
  // Lue en entier, mais les versions ne font pas une chaîne : rien n'est dit ni offert.
  | { etat: 'rompue' }
  // Lue en entier, sans aucune version : la seule fois où « aucun paramètre » se dit.
  | { etat: 'aucune' }
  | { etat: 'courante'; version: ParametresFacturation }

// Ce que la lecture rend (`lib/parametresFacturationLecture.ts`), décrit ici sans l'importer : ce module ne touche pas au client
// de la base, même par un type.
export interface VersionsLues {
  lignes: readonly ParametresFacturation[]
  complete: boolean
  motif: string | null
}

export function resumeDesParametres(lecture: VersionsLues, dossierId: string): ResumeParametres {
  if (!lecture.complete) return { etat: 'incomplete', motif: lecture.motif ?? 'lecture incomplète' }
  const courante = versionCourante(lecture.lignes, dossierId)
  if (courante === 'rompue') return { etat: 'rompue' }
  if (courante === null) return { etat: 'aucune' }
  return { etat: 'courante', version: courante }
}

export const TEXTE_ROMPUE = 'Les versions lues ne forment pas une suite (une version manque, ou plusieurs se suivent) : aucune '
  + 'n’est donc dite courante, et aucun geste n’est offert.'

// ── Chaque champ en mots ─────────────────────────────────────────────────────────────────────────────────────────────
// Les libellés des champs, dans l'ordre où la fonction les admet (le type les tient tous).
export const LIBELLES_DES_CHAMPS: Record<keyof ParametresEnvoyes, string> = {
  delai_paiement_jours: 'Délai de paiement',
  moyen_prefere: 'Moyen de paiement proposé',
  escompte: 'Conditions d’escompte',
  penalites: 'Pénalités de retard',
  mentions_complementaires: 'Mentions complémentaires',
  pied_de_page: 'Pied de page',
  iban: 'IBAN',
  bic: 'BIC',
  titulaire_compte: 'Titulaire du compte',
}

export const CHAMPS_DU_RIB: readonly (keyof ParametresEnvoyes)[] = ['iban', 'bic', 'titulaire_compte']
export const CHAMPS_DES_CONDITIONS: readonly (keyof ParametresEnvoyes)[] = CHAMPS_DES_PARAMETRES.filter((c) => !CHAMPS_DU_RIB.includes(c))

export const NON_RENSEIGNE = 'Non renseigné'

/** Le moyen sous son libellé, celui du registre des encaissements. */
export function libelleDuMoyen(moyen: MoyenEncaissement): string {
  return MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen
}

/** Le délai en jours : « 0 jour », « 1 jour », « 30 jours ». */
export function delaiEnJours(jours: number): string {
  return `${jours} jour${jours > 1 ? 's' : ''}`
}

/**
 * L'IBAN AFFICHÉ par groupes de quatre caractères (la présentation « papier » de l'ISO 13616) : l'affichage seulement — la
 * forme rangée, et celle qui part, reste l'électronique, sans aucun blanc (`saisieQuiPart` les retire).
 */
export function ibanParQuatre(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, '$1 ')
}

export interface ChampAffiche {
  champ: keyof ParametresEnvoyes
  libelle: string
  valeur: string
  // Un champ vide se dit tel (« Non renseigné ») : l'écran l'affiche en discret.
  vide: boolean
}

function champAffiche(v: ParametresFacturation, champ: keyof ParametresEnvoyes): ChampAffiche {
  const libelle = LIBELLES_DES_CHAMPS[champ]
  const brut = v[champ]
  if (brut === null) return { champ, libelle, valeur: NON_RENSEIGNE, vide: true }
  const valeur = champ === 'delai_paiement_jours' ? delaiEnJours(brut as number)
    : champ === 'moyen_prefere' ? libelleDuMoyen(brut as MoyenEncaissement)
      : champ === 'iban' ? ibanParQuatre(brut as string)
        : String(brut)
  return { champ, libelle, valeur, vide: false }
}

/** Les six conditions d'une version, chacune en mots. */
export function conditionsDeLaVersion(v: ParametresFacturation): ChampAffiche[] {
  return CHAMPS_DES_CONDITIONS.map((c) => champAffiche(v, c))
}

/** Le RIB d'une version, l'IBAN par quatre ; null sans IBAN. */
export function ribDeLaVersion(v: ParametresFacturation): ChampAffiche[] | null {
  return v.iban === null ? null : CHAMPS_DU_RIB.map((c) => champAffiche(v, c))
}

// ── Qui, et quand ────────────────────────────────────────────────────────────────────────────────────────────────────
export const TITRE_VERSION_PAR_LE_CLIENT = 'Paramètres enregistrés par le client'

/** « Par le client » de l'auteur d'une version, au cabinet, sur des accès lus en entier ; null sinon. */
export function mentionVersionParLeClient(acces: AccesDuDossier, v: Pick<ParametresFacturation, 'auteur'>): { libelle: string; titre: string } | null {
  return estLeClient(acces, v.auteur) ? { libelle: PAR_LE_CLIENT, titre: TITRE_VERSION_PAR_LE_CLIENT } : null
}

// « par le client » d'un geste, précédé d'une espace — ou rien.
const parLeClient = (acces: AccesDuDossier, g: Geste) => (estLeClient(acces, g.parQui) ? ` ${PAR_LE_CLIENT}` : '')

/** L'état du RIB en un mot, pour la pastille : null sans RIB. */
export function pastilleDuRib(v: Pick<ParametresFacturation, 'iban' | 'rib_etat'>): 'Proposé' | 'Confirmé' | null {
  if (v.iban === null || v.rib_etat === null) return null
  return v.rib_etat === 'propose' ? 'Proposé' : 'Confirmé'
}

/**
 * Ce qu'une version dit de son RIB, en une phrase, d'après `ceQueDitLeRib` (qui l'a posé, qui l'a confirmé, d'un même
 * geste ou ensuite), au jour et à l'heure de Paris. Au cabinet, « par le client » d'un compte que les accès lus en entier
 * reconnaissent ; chez le client, son RIB proposé attend la confirmation de son cabinet. `rompue` ou null : rien à dire.
 */
export function etatDuRibDit(
  versions: readonly ParametresFacturation[], dossierId: string, versionId: string, espace: EspaceVentes, acces: AccesDuDossier,
): string | null | 'rompue' {
  const dit = ceQueDitLeRib(versions, dossierId, versionId)
  if (dit === null || dit === 'rompue') return dit
  const client = espace === 'client'
  const pc = (g: Geste) => (client ? '' : parLeClient(acces, g))
  switch (dit.rib) {
    case 'aucun':
      return 'Aucun RIB.'
    case 'propose':
      return client
        ? `Proposé le ${jourEtHeureAParis(dit.pose.le)} : en attente de la confirmation de ton cabinet.`
        : `Proposé${pc(dit.pose)} le ${jourEtHeureAParis(dit.pose.le)} : en attente de votre confirmation.`
    case 'confirme':
      return dit.dUnMemeGeste
        ? `Posé et confirmé${pc(dit.confirme)} d’un même geste le ${jourEtHeureAParis(dit.confirme.le)}.`
        : `Posé${pc(dit.pose)} le ${jourEtHeureAParis(dit.pose.le)}, confirmé${pc(dit.confirme)} le ${jourEtHeureAParis(dit.confirme.le)}.`
  }
}

/**
 * Quand la courante n'a qu'un RIB PROPOSÉ : le RIB EN VIGUEUR (`ribEnVigueur` — le confirmé d'avant, ou aucun), dit comme
 * celui que les factures porteront QUAND elles porteront un RIB, jamais comme imprimé aujourd'hui. Null quand la courante
 * n'a pas de RIB proposé (son RIB est alors lui-même en vigueur, ou il n'y en a aucun) ou que la chaîne est rompue.
 */
export function ribEnVigueurDit(
  versions: readonly ParametresFacturation[], dossierId: string, espace: EspaceVentes,
): { phrase: string; rib: ChampAffiche[] | null } | null {
  const courante = versionCourante(versions, dossierId)
  if (courante === null || courante === 'rompue' || courante.rib_etat !== 'propose') return null
  const enVigueur = ribEnVigueur(versions, dossierId)
  if (enVigueur === 'rompue') return null
  const client = espace === 'client'
  if (enVigueur === null) {
    return {
      phrase: client
        ? 'Aucun RIB confirmé ne le précède : jusqu’à la confirmation de ton cabinet, tes factures n’en porteront aucun, quand elles porteront un RIB.'
        : 'Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, quand elles porteront un RIB.',
      rib: null,
    }
  }
  const porteuse = versions.find((v) => v.id === enVigueur.version) as ParametresFacturation
  return {
    phrase: client
      ? 'Le RIB confirmé d’avant reste en vigueur : c’est lui que tes factures porteront, quand elles porteront un RIB, jusqu’à la confirmation de ton cabinet.'
      : 'Le RIB confirmé d’avant reste en vigueur : c’est lui que les factures porteront, quand elles porteront un RIB, tant que vous n’avez pas confirmé celui-ci.',
    rib: ribDeLaVersion(porteuse),
  }
}

// ── L'historique ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Les versions de la chaîne, la courante d'abord, jusqu'à la première ; `rompue` sur une chaîne qui n'en est pas une. */
export function versionsDeLaChaine(versions: readonly ParametresFacturation[], dossierId: string): ParametresFacturation[] | 'rompue' {
  const courante = versionCourante(versions, dossierId)
  if (courante === 'rompue') return 'rompue'
  if (courante === null) return []
  const parId = new Map(versions.filter((v) => v.dossier_id === dossierId).map((v) => [v.id, v]))
  const chaine: ParametresFacturation[] = [courante]
  for (let v: ParametresFacturation | undefined = courante; v?.remplace_id != null;) {
    v = parId.get(v.remplace_id)
    if (v) chaine.push(v)
  }
  return chaine
}

const minuscule = (texte: string) => texte.charAt(0).toLowerCase() + texte.slice(1)

/**
 * Ce qu'une version a CHANGÉ par rapport à celle qu'elle remplace, nommé : chaque condition sous son libellé ; le RIB
 * nommément — « RIB posé », « RIB retiré », ou « RIB changé (IBAN, BIC…) ». Vide quand rien n'a changé ; null pour la
 * première (rien à quoi la comparer). La confirmation d'un RIB n'est pas un changement de version : elle se dit par l'état.
 */
export function champsChanges(v: ParametresFacturation, remplacee: ParametresFacturation | null): string[] | null {
  if (remplacee === null) return null
  const changes = CHAMPS_DES_CONDITIONS.filter((c) => v[c] !== remplacee[c]).map((c) => LIBELLES_DES_CHAMPS[c])
  if (remplacee.iban === null && v.iban !== null) changes.push('RIB posé')
  else if (remplacee.iban !== null && v.iban === null) changes.push('RIB retiré')
  else if (v.iban !== null) {
    const parties = CHAMPS_DU_RIB.filter((c) => v[c] !== remplacee[c]).map((c) => (c === 'titulaire_compte' ? minuscule(LIBELLES_DES_CHAMPS[c]) : LIBELLES_DES_CHAMPS[c]))
    if (parties.length > 0) changes.push(`RIB changé (${parties.join(', ')})`)
  }
  return changes
}

export interface EntreeDeLHistorique {
  version: ParametresFacturation
  courante: boolean
  // Le jour et l'heure à Paris où la version a été enregistrée.
  quand: string
  parLeClient: { libelle: string; titre: string } | null
  rib: string
  // Les champs changés, nommés ; null pour la première version.
  changes: string[] | null
}

/**
 * L'historique, dès DEUX versions (une seule n'a pas d'histoire à dire) : chacune, la courante d'abord, avec son jour et son
 * heure à Paris, « par le client » au cabinet, l'état de son RIB et ce qu'elle a changé. Vide sous deux versions ;
 * `rompue` sur une chaîne qui n'en est pas une.
 */
export function historiqueDesParametres(
  versions: readonly ParametresFacturation[], dossierId: string, espace: EspaceVentes, acces: AccesDuDossier,
): EntreeDeLHistorique[] | 'rompue' {
  const chaine = versionsDeLaChaine(versions, dossierId)
  if (chaine === 'rompue') return 'rompue'
  if (chaine.length < 2) return []
  return chaine.map((v, i) => ({
    version: v,
    courante: i === 0,
    quand: jourEtHeureAParis(v.cree_le),
    parLeClient: espace === 'cabinet' ? mentionVersionParLeClient(acces, v) : null,
    rib: etatDuRibDit(versions, dossierId, v.id, espace, acces) as string,
    changes: champsChanges(v, chaine[i + 1] ?? null),
  }))
}

// ── Le formulaire ────────────────────────────────────────────────────────────────────────────────────────────────────
export const SAISIE_VIDE: SaisieParametresFacturation = {
  delai: '', moyen: '', escompte: '', penalites: '', mentions: '', piedDePage: '', iban: '', bic: '', titulaire: '',
}

/**
 * La saisie d'un dossier qui n'a encore AUCUNE version : les mentions proposées (MEG1-Q13, `PROPOSITIONS_PAR_DEFAUT`), des
 * propositions que la personne garde, change ou vide — rien n'est écrit avant « Enregistrer ».
 */
export function saisieProposee(): SaisieParametresFacturation {
  return {
    ...SAISIE_VIDE,
    delai: String(PROPOSITIONS_PAR_DEFAUT.delai_paiement_jours),
    escompte: PROPOSITIONS_PAR_DEFAUT.escompte,
    penalites: PROPOSITIONS_PAR_DEFAUT.penalites,
  }
}

/** La saisie qui part de la COURANTE, tous ses champs ; l'IBAN par quatre, pour le relire (il part sans aucun blanc). */
export function saisieDeLaVersion(v: ParametresFacturation): SaisieParametresFacturation {
  return {
    delai: v.delai_paiement_jours === null ? '' : String(v.delai_paiement_jours),
    moyen: v.moyen_prefere ?? '',
    escompte: v.escompte ?? '',
    penalites: v.penalites ?? '',
    mentions: v.mentions_complementaires ?? '',
    piedDePage: v.pied_de_page ?? '',
    iban: v.iban === null ? '' : ibanParQuatre(v.iban),
    bic: v.bic ?? '',
    titulaire: v.titulaire_compte ?? '',
  }
}

/**
 * Rien ne diffère-t-il de la version remplacée, sur la saisie TELLE QU'ELLE PART (des blancs ajoutés ne sont pas un
 * changement) ? Pour une première version, rien ne diffère d'une saisie vide : une version sans rien n'a rien à enregistrer.
 */
export function rienNeChange(remplacee: ParametresFacturation | null, saisie: SaisieParametresFacturation): boolean {
  const part = saisieQuiPart(saisie)
  return CHAMPS_DES_PARAMETRES.every((c) => part[c] === (remplacee === null ? null : remplacee[c]))
}

/** Le premier refus de la base sur la saisie TELLE QU'ELLE PART ; null quand elle l'accepterait ; `rompue`. */
export function refusDeLaSaisieParametres(
  dossierId: string, remplaceId: string | null, saisie: SaisieParametresFacturation, versions: readonly ParametresFacturation[],
): RefusParametres<CleRefusEnregistrementParametres> | null | 'rompue' {
  return refusEnregistrementParametres(dossierId, remplaceId, saisieQuiPart(saisie), versions)
}

/**
 * Ce que deviendra le RIB, dit AVANT le clic, d'après `etatDuRibEnregistre` sur la saisie telle qu'elle part (une saisie que
 * la base accepterait : l'appelant ne le demande pas sous un refus). Changé par le client : seulement proposé jusqu'à la
 * confirmation de son cabinet (MEG1-Q12) ; changé par le cabinet : confirmé d'emblée, en son nom ; vidé : retiré tout de
 * suite (A5-Q5) ; inchangé : son état gardé — un RIB proposé ne se confirme pas en réenregistrant (A5-Q4).
 */
export function ceQueDeviendraLeRib(
  remplacee: ParametresFacturation | null, saisie: SaisieParametresFacturation, espace: EspaceVentes,
): string {
  const client = espace === 'client'
  const { quoi, etat } = etatDuRibEnregistre(remplacee, saisieQuiPart(saisie), !client)
  const avait = remplacee !== null && remplacee.iban !== null
  switch (quoi) {
    case 'aucun':
      if (!avait) return 'Aucun RIB n’est saisi.'
      return client
        ? 'Tu vides le RIB : il est retiré dès l’enregistrement, sans attendre ton cabinet.'
        : 'Le RIB est vidé : il est retiré dès l’enregistrement.'
    case 'inchange':
      if (etat === 'propose') {
        return client
          ? 'Le RIB ne change pas : il reste en attente de la confirmation de ton cabinet.'
          : 'Le RIB ne change pas : il reste seulement proposé — enregistrer ne le confirme pas, « Confirmer le RIB » le fait.'
      }
      return 'Le RIB ne change pas : il reste confirmé.'
    case 'confirme':
      // Le cabinet qui retouche le BIC ou le titulaire d'un RIB PROPOSÉ en garde l'IBAN : l'enregistrer le confirme d'emblée
      // (MEG1-Q12), sans passer par « Confirmer le RIB » ni par son conseil — c'est pourtant cet IBAN qu'un faux RIB détourne.
      if (remplacee !== null && remplacee.rib_etat === 'propose' && remplacee.iban !== null
        && saisieQuiPart(saisie).iban === remplacee.iban) {
        return `Le RIB change, mais garde l’IBAN proposé, que vous n’avez pas confirmé : l’enregistrer le confirmera d’emblée, en votre nom. ${CONSEIL_VERIFICATION_RIB}`
      }
      return `${avait ? 'Le RIB change' : 'Le RIB est posé'} : il sera confirmé d’emblée, en votre nom.`
    case 'propose':
      return `${avait ? 'Le RIB change' : 'Le RIB est posé'} : il ne sera que proposé, jusqu’à la confirmation de ton cabinet.`
  }
}

// ── La confirmation d'un RIB (le cabinet seul) ───────────────────────────────────────────────────────────────────────
// Le conseil que dit toute confirmation d'un RIB proposé, par « Confirmer le RIB » comme par un enregistrement qui en garde
// l'IBAN (`ceQueDeviendraLeRib`) : une seule phrase, pour qu'aucun des deux chemins ne le taise.
export const CONSEIL_VERIFICATION_RIB = 'Avant de le confirmer, vérifiez-le auprès du client par un autre moyen que '
  + 'l’application — à un numéro de téléphone que vous connaissez déjà, par exemple : un accès « Ventes » peut être un '
  + 'compte volé, et un faux RIB détourne les paiements de tous ses clients.'

export interface ConfirmationDuRib {
  rib: ChampAffiche[]
  propose: string
  fait: string
  conseil: string
}

/**
 * Ce que la confirmation dit avant le clic : le RIB qu'elle confirme (l'IBAN par quatre, le BIC, le titulaire), qui l'a
 * proposé et quand, ce que la confirmation fait, et de le vérifier auprès du client par un autre moyen que l'application.
 * Null quand la version n'a pas de RIB proposé (rien à confirmer) ou que la chaîne est rompue.
 */
export function confirmationDuRib(
  versions: readonly ParametresFacturation[], dossierId: string, version: ParametresFacturation, acces: AccesDuDossier,
): ConfirmationDuRib | null {
  const dit = ceQueDitLeRib(versions, dossierId, version.id)
  const rib = ribDeLaVersion(version)
  if (dit === null || dit === 'rompue' || dit.rib !== 'propose' || rib === null) return null
  return {
    rib,
    propose: `Proposé${parLeClient(acces, dit.pose)} le ${jourEtHeureAParis(dit.pose.le)}.`,
    fait: 'Le confirmer en fait le RIB que les factures du dossier porteront, quand elles porteront un RIB ; la version dira '
      + 'que vous l’avez confirmé, et quand.',
    conseil: CONSEIL_VERIFICATION_RIB,
  }
}

/** Le refus de `confirmer_rib` dit avant le clic ; null quand elle confirmerait ; `rompue`. */
export function refusDeLaConfirmation(
  dossierId: string, versionId: string, versions: readonly ParametresFacturation[],
): RefusParametres<CleRefusConfirmationRib> | null | 'rompue' {
  return refusConfirmationRib(dossierId, versionId, versions)
}

// ── Les phrases de la vue ────────────────────────────────────────────────────────────────────────────────────────────
/** La phrase d'en-tête : ce que ces paramètres font AUJOURD'HUI — aucune facture ne les lit ni ne les imprime encore. */
export function phraseDEnTete(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Aucune de tes factures ne lit ni n’imprime encore ces paramètres : elles le feront avec une étape à venir. Ton cabinet '
      + 'les lit aussi, et les tient avec toi ; un RIB que tu poses ou changes n’est que proposé, jusqu’à ce que ton cabinet '
      + 'le confirme.'
    : 'Aucune facture ne lit ni n’imprime encore ces paramètres : elles le feront avec une étape à venir. Le client qui '
      + 'porte la case « Ventes » les lit et les tient avec vous ; un RIB qu’il pose ou change n’est que proposé, jusqu’à ce que '
      + 'vous le confirmiez.'
}

/** Ce que le formulaire d'une première version dit de ses propositions (MEG1-Q13). */
export function phraseDesPropositions(espace: EspaceVentes): string {
  return espace === 'client'
    ? 'Le délai, l’escompte et les pénalités sont des propositions (C. com., art. L441-9 et L441-10) : garde-les, change-les '
      + 'ou vide-les. Rien n’est enregistré avant « Enregistrer ».'
    : 'Le délai, l’escompte et les pénalités sont des propositions (C. com., art. L441-9 et L441-10) : gardez-les, changez-les '
      + 'ou videz-les. Rien n’est enregistré avant « Enregistrer ».'
}
