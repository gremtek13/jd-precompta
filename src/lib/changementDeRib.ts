import { estUnJourCivil } from './adressesReception'
import { ajouterJours, formatDate } from './format'
import { CONSEIL_VERIFICATION_RIB } from './parametresFacturationVue'

// LE DERNIER CHANGEMENT DU RIB DES FACTURES D'UN DOSSIER (espace client, étape A5b3a ; conception : HISTORIQUE.md, « LA
// FRAUDE AU FAUX RIB » ; décision du cabinet du 16/10/2026, A5-Q2). Un module PUR — il ne lit rien en base, n'appelle
// personne, ne lit pas l'horloge — que les écrans de l'étape A5b3b liront : la valeur que rend la fonction
// `dernier_changement_de_rib`, LUE SANS RIEN DEVINER, et ce que l'avis en dira au cabinet, au client « Ventes » et au
// client qui ne porte que « Banque ».
//
// POURQUOI UNE FONCTION. Un accès « Ventes » peut être un compte volé : changer le RIB que portent les factures détourne
// les paiements. Un RIB qu'un accès client pose ou change n'est que PROPOSÉ (étape A5a, MEG1-Q12) ; reste à dire chaque
// changement au cabinet et à tous les accès « Ventes » et « Banque » du dossier. L'accès qui ne porte que « Banque » ne lit
// pas la table des paramètres, et ne doit pas la lire : il n'en apprend que le JOUR, l'AUTEUR — le cabinet ou un accès
// client, jamais la personne — et l'ÉTAT du dernier changement, jamais l'IBAN, le BIC ni le titulaire (A5-Q2).
//
// CE QU'EST UN CHANGEMENT (la définition est celle de la migration, et elle seule) : une VERSION des paramètres qui pose,
// change (l'IBAN, le BIC ou le titulaire) ou retire le RIB ; la CONFIRMATION, par le cabinet, d'un RIB qui était proposé.
// Une version qui ne touche pas au RIB n'en est pas un. Le dernier se prend dans l'ordre de la chaîne des versions.
//
// CE QUE LA FONCTION REND, toujours un objet : `{ changement: null }` — le RIB n'a jamais changé, une AFFIRMATION de la
// base — ou `{ changement: { jour, geste, auteur, etat, rib_en_vigueur } }`. Toute autre forme est ILLISIBLE (`null`) :
// une clé de plus ou de moins, une valeur hors de sa liste, une combinaison que la fonction ne rend jamais (une
// proposition « par le cabinet », un retrait qui laisserait un RIB en vigueur…) — jamais « aucun changement », jamais un
// avis. changementDeRib.test.ts confronte ces listes au texte même de la fonction, quand l'export la porte, et chaque
// valeur que l'essai supabase/essais/dernierChangementDeRib.sql exige de la base, appel par appel, à la règle rejouée sur
// les versions de l'essai.

// ── Est-ce en base ? ──────────────────────────────────────────────────────────────────────────────────────────────────
// La migration `dernier_changement_de_rib` OUVRE à l'accès « Banque » une lecture qu'il n'avait pas : présentée au cabinet,
// elle a été appliquée sur son accord (A5B3-Q1), et l'export (supabase/schema) la porte. Ce drapeau est donc levé :
// lib/changementDeRibLecture.ts la lit pour l'avis de l'étape A5b3b, et la phrase de l'onglet Accès dit ce que la case
// « Banque » ouvre de plus (lib/droitsAcces.ts). changementDeRib.test.ts le confronte à l'export, et le module au texte
// même de la fonction. Un retour arrière de la migration ne viendrait qu'APRÈS le drapeau rebaissé en ligne : sinon
// l'écran recevrait un refus et le dirait.
export const CHANGEMENT_DE_RIB_EXPORTE: boolean = true

// ── Ce que la fonction rend ─────────────────────────────────────────────────────────────────────────────────────────
/** Ce qu'a fait le changement aux paramètres : une version qui pose, change ou retire le RIB, ou une confirmation. */
export const GESTES_DU_RIB = ['pose', 'change', 'retire', 'confirme'] as const
/** Qui l'a fait, d'après ce que la base a écrit : le cabinet, un accès client, ou ce qu'elle ne dit pas. */
export const AUTEURS_DU_CHANGEMENT = ['cabinet', 'client', 'inconnu'] as const
/** Où en est le RIB après lui (c'est l'état d'aujourd'hui : rien ne l'a changé depuis). */
export const ETATS_APRES_LE_CHANGEMENT = ['propose', 'confirme', 'retire'] as const
/** Ce qu'il a fait au RIB EN VIGUEUR — celui qu'une facture verrait (`ribEnVigueur`, lib/parametresFacturation.ts). */
export const EFFETS_SUR_LE_RIB_EN_VIGUEUR = ['aucun', 'inchange', 'pose', 'change', 'retire'] as const

export type GesteDuRib = (typeof GESTES_DU_RIB)[number]
export type AuteurDuChangement = (typeof AUTEURS_DU_CHANGEMENT)[number]
export type EtatApresLeChangement = (typeof ETATS_APRES_LE_CHANGEMENT)[number]
export type EffetSurLeRibEnVigueur = (typeof EFFETS_SUR_LE_RIB_EN_VIGUEUR)[number]

/** Les clés de la valeur, à chaque niveau, telles que la fonction les écrit. */
export const CLES_DU_CHANGEMENT = {
  racine: ['changement'],
  changement: ['jour', 'geste', 'auteur', 'etat', 'rib_en_vigueur'],
} as const

/** Le dernier changement, lu : son jour à Paris (AAAA-MM-JJ), et quatre mots. */
export interface ChangementDeRib {
  jour: string
  geste: GesteDuRib
  auteur: AuteurDuChangement
  etat: EtatApresLeChangement
  ribEnVigueur: EffetSurLeRibEnVigueur
}

/** La valeur lue : un changement, ou aucun — affirmé par la base. */
export interface DernierChangementLu {
  changement: ChangementDeRib | null
}

/**
 * Les combinaisons que la fonction rend, et elles seules — l'image exacte de sa règle (changementDeRib.test.ts la rejoue
 * sur toutes les chaînes courtes et retrouve ces quinze-là, ni plus ni moins) :
 *   - un RIB posé ou changé par le CABINET est confirmé d'emblée : les factures le porteront (posé quand aucun n'était en
 *     vigueur, changé, ou inchangé quand c'était déjà lui — il écartait alors une proposition) ;
 *   - par un ACCÈS CLIENT, il n'est que proposé : le RIB en vigueur ne bouge pas (aucun, ou inchangé) ;
 *   - un RETRAIT n'écrit pas qui l'a fait (`inconnu`) : il retire le RIB en vigueur, ou, quand aucun n'était confirmé, une
 *     proposition ;
 *   - une CONFIRMATION est le fait du cabinet (`inconnu` pour une ligne qu'aucune fonction n'écrit) : après elle, un RIB est
 *     en vigueur.
 */
export const COMBINAISONS_DU_CHANGEMENT: readonly string[] = [
  'pose|cabinet|confirme|pose',
  'pose|client|propose|aucun',
  'change|cabinet|confirme|pose', 'change|cabinet|confirme|change', 'change|cabinet|confirme|inchange',
  'change|client|propose|aucun', 'change|client|propose|inchange',
  'retire|inconnu|retire|aucun', 'retire|inconnu|retire|retire',
  'confirme|cabinet|confirme|pose', 'confirme|cabinet|confirme|change', 'confirme|cabinet|confirme|inchange',
  'confirme|inconnu|confirme|pose', 'confirme|inconnu|confirme|change', 'confirme|inconnu|confirme|inchange',
]
const COMBINAISONS: ReadonlySet<string> = new Set(COMBINAISONS_DU_CHANGEMENT)

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Exactement ces clés, ni plus ni moins.
const exactement = (o: Record<string, unknown>, cles: readonly string[]) =>
  Object.keys(o).length === cles.length && cles.every((c) => Object.prototype.hasOwnProperty.call(o, c))
const parmi = <T extends string>(liste: readonly T[], v: unknown): v is T => typeof v === 'string' && (liste as readonly string[]).includes(v)

/**
 * La valeur rendue par `dernier_changement_de_rib`, lue sans rien deviner : `{ changement: null }` seulement pour l'objet
 * qui le dit ; sinon chaque clé là, aucune de plus, chaque mot de sa liste, le jour une date civile qui existe, et une
 * combinaison que la fonction rend. Toute autre valeur — un nul nu, un tableau, une clé de trop, l'IBAN qui s'y serait
 * glissé — : `null` (illisible).
 */
export function lireLeChangementDeRib(rendu: unknown): DernierChangementLu | null {
  if (!estObjet(rendu) || !exactement(rendu, CLES_DU_CHANGEMENT.racine)) return null
  const c = rendu.changement
  if (c === null) return { changement: null }
  if (!estObjet(c) || !exactement(c, CLES_DU_CHANGEMENT.changement)) return null
  if (typeof c.jour !== 'string' || !estUnJourCivil(c.jour)) return null
  if (!parmi(GESTES_DU_RIB, c.geste) || !parmi(AUTEURS_DU_CHANGEMENT, c.auteur) || !parmi(ETATS_APRES_LE_CHANGEMENT, c.etat)
    || !parmi(EFFETS_SUR_LE_RIB_EN_VIGUEUR, c.rib_en_vigueur)) return null
  if (!COMBINAISONS.has(`${c.geste}|${c.auteur}|${c.etat}|${c.rib_en_vigueur}`)) return null
  return { changement: { jour: c.jour, geste: c.geste, auteur: c.auteur, etat: c.etat, ribEnVigueur: c.rib_en_vigueur } }
}

// ── Ce que l'avis dit ───────────────────────────────────────────────────────────────────────────────────────────────
// Trois lecteurs : le CABINET (vouvoyé, comme la vue des paramètres le vouvoie), le client qui porte « Ventes » (il lit
// aussi la vue « Paramètres » de « Mes ventes »), le client qui ne porte que « Banque » (il n'a pas d'autre écran des
// paramètres). Le client est tutoyé, et aucun mot n'est celui du cabinet (src/lib/espaceVentes.ts, `MOTS_DU_CABINET`) :
// jamais « le client » pour lui — l'auteur se dit « un accès client de ton dossier », jamais la personne. Aucune facture
// n'imprime encore de RIB (étape A7) : ce que les factures « porteront » se dit au futur, « quand elles porteront un RIB »,
// comme la vue des paramètres le dit. Un client qui porte les deux cases lit l'avis « Ventes ».
export type DestinataireDuChangement = 'cabinet' | 'ventes' | 'banque'

/** L'avis : ce qui a changé, ce que les factures porteront, et ce qu'il faut faire. */
export interface AvisDuChangement {
  phrase: string
  factures: string
  conseil: string | null
}

const QUAND = 'quand elles porteront un RIB'

function phraseDuCabinet(c: ChangementDeRib, j: string): string {
  switch (c.geste) {
    case 'pose':
      return c.auteur === 'client'
        ? `Un accès client a proposé un RIB pour les factures le ${j} : il attend votre confirmation.`
        : `Le RIB des factures a été posé le ${j} par le cabinet.`
    case 'change':
      if (c.auteur === 'client') return `Un accès client a proposé un nouveau RIB pour les factures le ${j} : il attend votre confirmation.`
      // Le cabinet qui remet le RIB en vigueur écarte une proposition : c'est ce qu'il a fait.
      return c.ribEnVigueur === 'inchange'
        ? `Le RIB proposé pour les factures a été écarté le ${j} par le cabinet, qui a remis le RIB en vigueur.`
        : `Le RIB des factures a été changé le ${j} par le cabinet.`
    case 'retire':
      return c.ribEnVigueur === 'aucun'
        ? `Le RIB proposé pour les factures a été retiré le ${j}.`
        : `Le RIB des factures a été retiré le ${j}.`
    case 'confirme':
      return c.auteur === 'cabinet'
        ? `Le RIB proposé pour les factures a été confirmé le ${j} par le cabinet.`
        : `Le RIB proposé pour les factures a été confirmé le ${j}.`
  }
}

function facturesDuCabinet(c: ChangementDeRib): string {
  switch (c.ribEnVigueur) {
    case 'pose':
      return `Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, ${QUAND}.`
    case 'change':
      return `Les factures porteront ce RIB à la place du précédent, ${QUAND}.`
    case 'retire':
      return 'Les factures ne porteront plus de RIB, tant qu’un autre n’est pas posé et confirmé.'
    case 'inchange':
      return c.etat === 'propose'
        ? `Le RIB confirmé d’avant reste en vigueur : c’est lui que les factures porteront, ${QUAND}, tant que vous n’avez pas confirmé celui-ci.`
        : 'Le RIB que les factures porteront ne change pas : c’était déjà lui.'
    case 'aucun':
      return c.etat === 'propose'
        ? `Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, ${QUAND}.`
        : 'Aucun RIB n’était confirmé : les factures n’en porteront toujours aucun.'
  }
}

function phraseDuClient(c: ChangementDeRib, j: string): string {
  switch (c.geste) {
    case 'pose':
      return c.auteur === 'client'
        ? `Un RIB a été proposé pour tes factures le ${j}, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.`
        : `Ton cabinet a posé le RIB de tes factures le ${j}.`
    case 'change':
      if (c.auteur === 'client') {
        return `Un nouveau RIB a été proposé pour tes factures le ${j}, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.`
      }
      return c.ribEnVigueur === 'inchange'
        ? `Ton cabinet a écarté le RIB proposé pour tes factures le ${j}, et remis celui qui était en vigueur.`
        : `Ton cabinet a changé le RIB de tes factures le ${j}.`
    case 'retire':
      return c.ribEnVigueur === 'aucun'
        ? `Le RIB proposé pour tes factures a été retiré le ${j}.`
        : `Le RIB de tes factures a été retiré le ${j}.`
    case 'confirme':
      return c.auteur === 'cabinet'
        ? `Ton cabinet a confirmé le RIB proposé pour tes factures, le ${j}.`
        : `Le RIB proposé pour tes factures a été confirmé le ${j}.`
  }
}

function facturesDuClient(c: ChangementDeRib): string {
  switch (c.ribEnVigueur) {
    case 'pose':
      return `Aucun RIB n’était confirmé avant lui : tes factures porteront celui-ci, ${QUAND}.`
    case 'change':
      return `Tes factures porteront ce RIB à la place du précédent, ${QUAND}.`
    case 'retire':
      return 'Tes factures ne porteront plus de RIB, tant qu’un autre n’est pas posé et confirmé par ton cabinet.'
    case 'inchange':
      return c.etat === 'propose'
        ? `Le RIB confirmé d’avant reste en vigueur : c’est lui que tes factures porteront, ${QUAND}, jusqu’à la confirmation de ton cabinet.`
        : 'Le RIB de tes factures ne change pas : c’était déjà lui.'
    case 'aucun':
      return c.etat === 'propose'
        ? `Aucun RIB confirmé ne le précède : jusqu’à la confirmation de ton cabinet, tes factures n’en porteront aucun, ${QUAND}.`
        : 'Aucun RIB n’était confirmé : tes factures n’en porteront toujours aucun.'
  }
}

/** Le conseil au client : qu'il prévienne son cabinet s'il n'attendait pas ce changement ; « Ventes » sait où en lire le détail. */
export const CONSEIL_AU_CLIENT_VENTES = 'Si tu ne l’attendais pas, préviens ton cabinet sans attendre : le détail est dans « Mes ventes › Paramètres ».'
export const CONSEIL_AU_CLIENT_BANQUE = 'Si tu ne l’attendais pas, préviens ton cabinet sans attendre.'
/** Au cabinet, d'un retrait dont la base ne dit pas l'auteur : où le lire. */
export const CONSEIL_D_UN_RETRAIT = 'L’historique des paramètres (Factures › Paramètres) dit qui l’a retiré.'

/**
 * Ce que l'avis du dernier changement dit à son lecteur : la phrase (quoi, quand, qui — le cabinet ou un accès client,
 * jamais la personne —, et l'attente d'une confirmation), ce que les factures porteront, et le conseil — au cabinet, celui
 * de la confirmation d'un RIB (`CONSEIL_VERIFICATION_RIB`, la même phrase que la vue des paramètres) devant un RIB proposé ;
 * au client, toujours, de prévenir son cabinet s'il n'attendait pas ce changement.
 */
export function avisDuChangement(c: ChangementDeRib, destinataire: DestinataireDuChangement): AvisDuChangement {
  const j = formatDate(c.jour)
  if (destinataire === 'cabinet') {
    return {
      phrase: phraseDuCabinet(c, j),
      factures: facturesDuCabinet(c),
      conseil: c.etat === 'propose' ? CONSEIL_VERIFICATION_RIB : c.geste === 'retire' ? CONSEIL_D_UN_RETRAIT : null,
    }
  }
  return {
    phrase: phraseDuClient(c, j),
    factures: facturesDuClient(c),
    conseil: destinataire === 'ventes' ? CONSEIL_AU_CLIENT_VENTES : CONSEIL_AU_CLIENT_BANQUE,
  }
}

// ── Combien de temps l'avis reste, et à qui il parle (espace client, étape A5b3b) ─────────────────────────────────────
// Décisions du cabinet du 17/10/2026 (A5B3-Q4, Q5, Q7 : « comme recommandé »). L'avis n'a pas de marque « vu » : rien ne
// s'écrit, aucune table. Il dure tant que la règle ci-dessous le dit, jugée à CHAQUE rendu sur le jour que l'appelant donne.
//  · chez le CABINET, un RIB PROPOSÉ reste affiché tant qu'il est le dernier changement — une confirmation, un retrait ou un
//    autre RIB est un changement NOUVEAU, qui prend sa place, et une version qui ne touche pas au RIB n'en est pas un (la
//    fonction ne la rend pas) : il attend son geste, quel que soit son âge ;
//  · tout le reste — chez le cabinet un changement qui n'est pas une proposition, chez le client TOUT changement, proposition
//    comprise (son cabinet en est averti à part) — reste TRENTE JOURS, le jour du changement compris : du J au J + 29.
/** Combien de jours un changement reste affiché, quand rien ne le retient. */
export const DUREE_DE_L_AVIS_EN_JOURS = 30

/**
 * Le changement à montrer, ou rien. `aujourdhui` (AAAA-MM-JJ, le jour à Paris) est DONNÉ par l'appelant : ce module ne lit pas
 * l'horloge. `{ changement: null }` ne montre rien ; chez le cabinet, un RIB proposé se montre toujours ; sinon le changement
 * se montre tant que `aujourdhui < jour + 30 jours` (J + 29 est le dernier jour). Un jour POSTÉRIEUR à aujourd'hui — l'horloge
 * de l'appareil en retard — se montre : un avis ne se tait jamais sur un jour qu'on ne sait pas placer. Pour la même raison,
 * un « aujourd'hui » qui n'est pas un jour civil ne tait rien.
 */
export function changementAMontrer(lu: DernierChangementLu, destinataire: DestinataireDuChangement, aujourdhui: string): ChangementDeRib | null {
  const c = lu.changement
  if (c === null) return null
  if (destinataire === 'cabinet' && c.etat === 'propose') return c
  if (!estUnJourCivil(aujourdhui)) return c
  return aujourdhui < ajouterJours(c.jour, DUREE_DE_L_AVIS_EN_JOURS) ? c : null
}

/**
 * L'avis que lit un client, selon les cases de la société AFFICHÉE : « Ventes » (avec ou sans « Banque » : qui porte les deux
 * lit l'avis « Ventes ») ou « Banque » seul ; aucun sinon — et alors AUCUN appel, la base refuserait (42501). Les cases sont
 * celles que l'accueil décide déjà (`mesVentesOuvertes`, `maBanqueOuverte`), drapeaux d'export compris.
 */
export function destinataireDuClient(ventesOuvertes: boolean, banqueOuverte: boolean): Exclude<DestinataireDuChangement, 'cabinet'> | null {
  if (ventesOuvertes) return 'ventes'
  return banqueOuverte ? 'banque' : null
}

// Quand la lecture n'a pas pu se faire : une ligne DISCRÈTE, jamais le silence qu'on prendrait pour « aucun changement », jamais
// une alarme. Elle n'affirme rien, ne nomme ni IBAN ni personne, et dit où regarder quand il y a un endroit.
export const LECTURE_MANQUEE_AU_CABINET =
  'Le dernier changement du RIB des factures n’a pas pu être lu pour l’instant : l’historique des paramètres (Factures › Paramètres) le dit.'
export const LECTURE_MANQUEE_AU_CLIENT = 'Le dernier changement du RIB de tes factures n’a pas pu être lu pour l’instant : recharge la page.'

/** Le bouton du cabinet : il mène à l'onglet Factures (la vue « Paramètres » est un état local de l'onglet, qu'il n'ouvre pas). */
export const LIBELLE_ALLER_AUX_FACTURES = 'Aller aux factures'
/** Le lien du client « Ventes » : il mène à « Mes ventes » ; « Banque » seul n'a pas d'écran des paramètres, donc aucun lien. */
export const LIBELLE_OUVRIR_MES_VENTES = 'Ouvrir « Mes ventes »'
/** Le nom accessible de la ligne, par lecteur. */
export const NOM_DE_L_AVIS_DU_CABINET = 'Dernier changement du RIB des factures'
export const NOM_DE_L_AVIS_DU_CLIENT = 'Dernier changement du RIB de tes factures'

/** Une lecture du changement, telle que `lib/changementDeRibLecture.ts` la rend (structure seule : ce module n'importe pas la base). */
export type LectureDeLAvis =
  | { etat: 'en_cours' }
  | { etat: 'lue'; lu: DernierChangementLu }
  | { etat: 'illisible' }
  | { etat: 'refusee'; motif: string }

/** Ce que l'écran dit : rien, l'avis (avec son attente de confirmation), ou la ligne discrète d'une lecture manquée. */
export type CeQueDitLAvis =
  | { genre: 'rien' }
  | { genre: 'avis'; changement: ChangementDeRib; avis: AvisDuChangement; attend: boolean }
  | { genre: 'lecture_manquee'; phrase: string; motif: string | null }

/**
 * Ce qu'un écran dit de la lecture du dernier changement. `null` — drapeau baissé, pas de dossier, aucune case : rien, et
 * aucun appel n'a eu lieu. `en_cours` : RIEN (ni squelette ni « aucun » : aucune affirmation avant la lecture, et l'écran qui
 * porte l'avis ne l'attend pas). `lue` : l'avis seulement si la règle de durée en donne un, `{ changement: null }` ou un
 * changement passé ne disent rien. `illisible` et `refusee` : la ligne discrète, `refusee` portant son motif pour l'infobulle.
 * `attend` : le RIB est proposé — la pastille d'attention.
 */
export function ceQueDitLAvis(lecture: LectureDeLAvis | null, destinataire: DestinataireDuChangement, aujourdhui: string): CeQueDitLAvis {
  if (lecture === null || lecture.etat === 'en_cours') return { genre: 'rien' }
  if (lecture.etat === 'lue') {
    const c = changementAMontrer(lecture.lu, destinataire, aujourdhui)
    return c === null ? { genre: 'rien' } : { genre: 'avis', changement: c, avis: avisDuChangement(c, destinataire), attend: c.etat === 'propose' }
  }
  return {
    genre: 'lecture_manquee',
    phrase: destinataire === 'cabinet' ? LECTURE_MANQUEE_AU_CABINET : LECTURE_MANQUEE_AU_CLIENT,
    motif: lecture.etat === 'refusee' ? lecture.motif : null,
  }
}
