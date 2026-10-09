import type { CodeStatutRecu } from './cdarRecu'
import { formatDate } from './format'
import type { DrapeauxPlateforme, FluxEcartes, IssueStatutLu, ReleveStatuts } from './receptionPlateforme'
import { badgeClasseStatutSuperpdp, libelleStatutSuperpdp } from './superpdpStatuts'
import { REGLE_AVOIR_INTERNE, STATUTS_ANNULATION_PLATEFORME } from './transmissionsFactures'
import type { StatutFactureRecu } from './types'

// CE QUE LES ÉCRANS DISENT DES STATUTS LUS SUR LA PLATEFORME DU CLIENT (ligne 28.5, étape d7, phase C), sans rien lire :
// le libellé d'un statut, la pastille du dernier, l'ordre où une facture les montre, le bilan d'un relevé et la phrase
// qui remplace « Vérifiez d'abord… » dans la fenêtre des encaissements. Les statuts eux-mêmes sont lus par l'écran
// (`statuts_factures_recus`), relevés par `plateforme-agreee` (action `relever`) ; ce que la base en déduit — un refus
// lu fait refuser l'encaissement, la déclaration et la transmission — reste le jugement du module des encaissements et
// de celui des transmissions. Les types seuls viennent du module de la réception.

/** Les colonnes qu'un écran lit d'un statut : toutes, sauf le dossier qu'il filtre et le lecteur qu'il ne montre pas. */
export const COLONNES_STATUT_LU =
  'id, facture_id, code, hote, flux_id, message_id, emis_le, createur_role, date_statut, motifs, commentaire, montants, lu_le'

/** Un statut tel qu'un écran le lit (`COLONNES_STATUT_LU`). */
export type StatutLu = Omit<StatutFactureRecu, 'dossier_id' | 'lu_par'>

// LES LIBELLÉS SONT CEUX DE LA DGFIP, et il n'en existe qu'une table : celle de `superpdpStatuts.ts`, sous les clés
// `fr:200` à `fr:213` (tableau 8 des spécifications externes, § 3.6.4). Un statut lu sur la plateforme du client et le
// même statut rendu par Super PDP se nomment pareil.

/** Le libellé de la DGFiP d'un statut lu : « Refusée », « Encaissée »… */
export function libelleStatutLu(code: string): string {
  return libelleStatutSuperpdp(`fr:${code}`)
}

/** La classe de pastille d'un statut lu : un refus ou un rejet en `badge-danger`, comme chez Super PDP. */
export function classeStatutLu(code: string): string {
  return badgeClasseStatutSuperpdp(`fr:${code}`)
}

/** 210 « Refusée » ou 213 « Rejetée » : la facture s'annule par un avoir interne (DGFiP, § 3.6.4). */
export function estUneAnnulation(code: string): boolean {
  return (STATUTS_ANNULATION_PLATEFORME as readonly string[]).includes(code)
}

/** Ce qu'un refus ou un rejet lu veut dire pour la facture, dans les mots de la règle. */
export const CONSEQUENCE_ANNULATION =
  `elle s’annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture (${REGLE_AVOIR_INTERNE})`

// MDT-40, qui a créé le message : les quatre rôles que l'écran nomme, ceux que `StatutFactureRecu` documente. Un autre
// code se montre tel quel, nommé comme un code : on ne nomme pas ce qu'on n'a pas lu dans une source.
const ROLES_CREATEUR: Record<string, string> = {
  BY: 'l’acheteur',
  SE: 'le vendeur',
  WK: 'une plateforme',
  DFH: 'l’administration',
}

/** Qui a posé le statut : « l’acheteur », « une plateforme »… ; null quand le message ne le dit pas lisiblement. */
export function auteurDuStatut(role: string | null): string | null {
  if (role == null) return null
  return ROLES_CREATEUR[role] ?? `le rôle ${role}`
}

/**
 * L'horodatage d'un statut TEL QU'ÉCRIT (MDT-78, AAAAMMJJHHMMSS), mis en forme sans être converti : son fuseau n'est pas
 * dit, et un instant deviné serait une affirmation. « 12/03/2027 à 14:05:09 (heure de la plateforme) ». Une valeur d'une
 * autre forme se montre telle quelle.
 */
export function horodatageTelQuEcrit(emisLe: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(emisLe)
  if (!m) return emisLe
  return `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}:${m[6]} (heure de la plateforme)`
}

// MDT-207, ce qu'un montant mesure (G7.12) : les trois qu'un paiement ou un encaissement porte. Un autre code se montre
// tel quel.
const NATURES_MONTANT: Record<string, string> = { MEN: 'encaissé', MPA: 'payé', RAP: 'reste à payer' }

/**
 * Les montants d'un statut (MDG-43) TELS QU'ÉCRITS — le point décimal et la devise du message, jamais convertis :
 * « encaissé 1200.00 EUR au taux 20.00 le 15/10/2027 ; … ». Une chaîne vide quand le message n'en porte pas.
 */
export function montantsTelsQuEcrits(montants: StatutLu['montants']): string {
  return montants.map((m) => {
    const nature = m.code == null ? null : NATURES_MONTANT[m.code] ?? m.code
    const morceaux = [nature, `${m.montant}${m.devise ? ` ${m.devise}` : ''}`]
    if (m.taux != null) morceaux.push(`au taux ${m.taux}`)
    if (m.date != null) morceaux.push(`le ${formatDate(m.date)}`)
    return morceaux.filter((x) => x != null).join(' ')
  }).join(' ; ')
}

/** Ce qu'il faut d'un statut pour le ranger. */
export type StatutOrdonnable = Pick<StatutLu, 'id' | 'facture_id' | 'code' | 'emis_le' | 'lu_le'>

// L'ordre du plus récent au plus ancien : l'instant de sa LECTURE d'abord (`lu_le`, que l'application a posé), puis son
// horodatage tel qu'écrit — comparé en texte, sa forme AAAAMMJJHHMMSS se trie ainsi, et un statut sans horodatage passe
// après —, puis l'identifiant, pour qu'un même jeu se lise toujours dans le même ordre.
function plusRecentDAbord(a: StatutOrdonnable, b: StatutOrdonnable): number {
  if (a.lu_le !== b.lu_le) return a.lu_le < b.lu_le ? 1 : -1
  const ea = a.emis_le ?? '', eb = b.emis_le ?? ''
  if (ea !== eb) return ea < eb ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Les statuts d'une facture, le refus en tête : un 210 ou un 213 d'abord — il décide de tout ce que la facture permet —,
 * puis du plus récent au plus ancien.
 */
export function statutsDeLaFacture<T extends StatutOrdonnable>(statuts: readonly T[], factureId: string): T[] {
  return statuts.filter((s) => s.facture_id === factureId).sort((a, b) =>
    (estUneAnnulation(a.code) === estUneAnnulation(b.code) ? plusRecentDAbord(a, b) : estUneAnnulation(a.code) ? -1 : 1))
}

/**
 * Le statut que la pastille d'une facture montre : le DERNIER lu — le plus récent par sa lecture, puis par son
 * horodatage tel qu'écrit —, sauf quand la facture a été refusée ou rejetée : le refus, alors, quoi qu'il soit venu
 * après lui. Un « Encaissée » lu après un refus ne rend pas la facture encaissable ; la pastille ne doit pas le laisser
 * croire. Null quand aucun statut n'est lu pour elle.
 */
export function statutDeLaPastille<T extends StatutOrdonnable>(statuts: readonly T[], factureId: string): T | null {
  return statutsDeLaFacture(statuts, factureId)[0] ?? null
}

// ── Le bilan d'un relevé ──────────────────────────────────────────────────────────────────────────────────────────

// La phrase accordée à son nombre : le pluriel commence à deux.
const accord = (n: number, singulier: string, pluriel: string) => (n >= 2 ? pluriel : singulier)

export interface StatutGarde {
  flux: string
  factureId: string
  /** Le numéro de la facture, ou null quand il n'a pas pu être lu. */
  numero: string | null
  code: CodeStatutRecu
  libelle: string
  classe: string
  /** Un 210 ou un 213 : il se dit en tête, avec sa conséquence. */
  annulation: boolean
  avertissements: string[]
}

export interface BilanDuReleve {
  /** « Statuts lus sur … le … » quand le relevé est allé au bout ; sinon, ce qu'on sait du dernier qui l'a fait. */
  titre: string
  gardes: StatutGarde[]
  /** Ce qui était déjà gardé, en une phrase ; null quand il n'y en a pas. */
  dejaLus: string | null
  /** Les statuts écartés, chacun avec sa raison — et, pour un statut sur un statut (le 601) du dossier, ce qu'il porte. */
  ecartes: { flux: string; texte: string; detail: string | null }[]
  /** Les échecs passagers : le relevé suivant les reprendra. */
  echecs: { flux: string; texte: string }[]
  /** Ce qui n'a pas été lu, compté : en attente, en erreur chez la plateforme, reporté, écarté de la liste. */
  comptes: string[]
  /** Le relevé n'est pas allé au bout : pourquoi, et quoi faire. */
  incomplet: string | null
  /** Le point de reprise n'a pas été enregistré : rien n'est perdu. */
  reprise: string | null
  /** Rien de nouveau : ni gardé, ni écarté, ni en échec. */
  rienDeNouveau: boolean
}

// Les flux que la RECHERCHE écarte avant toute lecture (la même forme que pour les factures, d'autres objets) : des
// messages qui ne sont pas des statuts de facture, ou que la plateforme décrit mal.
const LIBELLES_ECARTS_STATUTS: Record<keyof FluxEcartes, (n: number) => string> = {
  autre_flux: (n) => accord(n, `${n} message écarté : ce n’est pas un statut de facture émise`,
    `${n} messages écartés : ce ne sont pas des statuts de factures émises`),
  illisible: (n) => accord(n, `${n} statut écarté : sans identifiant ou sans date de mise à jour lisible`,
    `${n} statuts écartés : sans identifiant ou sans date de mise à jour lisible`),
  format: (n) => accord(n, `${n} statut écarté : dans un format que l’application ne lit pas`,
    `${n} statuts écartés : dans un format que l’application ne lit pas`),
  statut_inconnu: (n) => accord(n, `${n} statut écarté : la plateforme ne dit pas s’il est prêt`,
    `${n} statuts écartés : la plateforme ne dit pas s’ils sont prêts`),
  doublons: (n) => accord(n, `${n} doublon écarté : un statut que la plateforme a listé deux fois`,
    `${n} doublons écartés : des statuts que la plateforme a listés plus d’une fois`),
}

function detailDuStatutRejete(d: NonNullable<Extract<IssueStatutLu, { issue: 'ecarte' }>['detail']>): string {
  const morceaux = [`La plateforme de l’administration a rejeté un statut : le message ${d.reference}`]
  if (d.date_objet) morceaux.push(`du ${formatDate(d.date_objet)}`)
  let phrase = morceaux.join(' ')
  if (d.motifs) phrase += ` ; motifs : ${d.motifs}`
  if (d.commentaire) phrase += ` ; commentaire : ${d.commentaire}`
  // Un commentaire qui finit déjà sa phrase ne reçoit pas un second point.
  return /[.!?…]$/.test(phrase) ? phrase : `${phrase}.`
}

/**
 * Le bilan d'un relevé, en phrases. `numeros` donne le numéro de chaque facture gardée (null quand il n'a pas pu être
 * lu) ; `dateDe` met en forme un instant (le dernier relevé allé au bout).
 */
export function bilanDuReleve(
  releve: ReleveStatuts, numeros: ReadonlyMap<string, string | null>, dateDe: (instant: string) => string,
): BilanDuReleve {
  const gardes: StatutGarde[] = []
  const ecartes: BilanDuReleve['ecartes'] = []
  const echecs: BilanDuReleve['echecs'] = []
  let dejaLus = 0
  for (const i of releve.issues) {
    if (i.issue === 'garde') {
      gardes.push({
        flux: i.flux, factureId: i.facture_id, numero: numeros.get(i.facture_id) ?? null, code: i.code,
        libelle: libelleStatutLu(i.code), classe: classeStatutLu(i.code), annulation: estUneAnnulation(i.code),
        avertissements: i.avertissements,
      })
    } else if (i.issue === 'deja_lu') {
      dejaLus++
    } else if (i.issue === 'ecarte') {
      ecartes.push({ flux: i.flux, texte: i.raison, detail: i.detail ? detailDuStatutRejete(i.detail) : null })
    } else {
      echecs.push({ flux: i.flux, texte: `${i.raison} Le prochain relevé le reprendra.` })
    }
  }
  // Le refus en tête : il change ce que la facture permet. L'ordre du relevé est gardé pour le reste.
  gardes.sort((a, b) => Number(b.annulation) - Number(a.annulation))

  const comptes: string[] = []
  if (releve.en_attente > 0) {
    comptes.push(accord(releve.en_attente, `${releve.en_attente} statut en attente : la plateforme n’a pas fini de le traiter, il reviendra.`,
      `${releve.en_attente} statuts en attente : la plateforme n’a pas fini de les traiter, ils reviendront.`))
  }
  if (releve.en_erreur > 0) {
    comptes.push(accord(releve.en_erreur, `${releve.en_erreur} statut en erreur chez la plateforme : il ne se lit pas.`,
      `${releve.en_erreur} statuts en erreur chez la plateforme : ils ne se lisent pas.`))
  }
  if (releve.reportes > 0) {
    comptes.push(accord(releve.reportes, `${releve.reportes} statut prêt non lu cette fois (le temps ou le nombre) : le prochain relevé le lira.`,
      `${releve.reportes} statuts prêts non lus cette fois (le temps ou le nombre) : le prochain relevé les lira.`))
  }
  for (const cle of Object.keys(LIBELLES_ECARTS_STATUTS) as (keyof FluxEcartes)[]) {
    if (releve.ecartes[cle] > 0) comptes.push(`${LIBELLES_ECARTS_STATUTS[cle](releve.ecartes[cle])}.`)
  }

  const titre = releve.complete && releve.cycle_vie_lu_le
    ? `Statuts lus sur ${releve.hote} le ${dateDe(releve.cycle_vie_lu_le)}`
    : releve.cycle_vie_lu_le
      ? `Statuts lus en partie sur ${releve.hote} — le dernier relevé allé au bout date du ${dateDe(releve.cycle_vie_lu_le)}`
      : `Statuts lus en partie sur ${releve.hote}`
  const reprise = releve.erreur_reprise == null
    ? null
    : /relira/.test(releve.erreur_reprise)
      ? releve.erreur_reprise
      : `${releve.erreur_reprise} Rien n’est perdu : le prochain relevé relira ces statuts, et reconnaîtra ceux déjà gardés.`
  return {
    titre,
    gardes,
    dejaLus: dejaLus === 0 ? null : accord(dejaLus, `${dejaLus} statut déjà lu : reconnu, il ne s’écrit pas deux fois.`,
      `${dejaLus} statuts déjà lus : reconnus, ils ne s’écrivent pas deux fois.`),
    ecartes,
    echecs,
    comptes,
    incomplet: releve.complete ? null : `Relevé incomplet : ${releve.motif ?? 'la plateforme n’a pas tout rendu'}. Relancez la lecture pour la suite.`,
    reprise,
    rienDeNouveau: gardes.length === 0 && ecartes.length === 0 && echecs.length === 0,
  }
}

/**
 * Un relevé refusé, en mots : la phrase de la fonction telle quelle, et, quand la plateforme refuse l'identité ouverte
 * au cabinet, ce qu'il faut faire — les mêmes drapeaux que la réception.
 */
export function refusDuReleve(erreur: string, drapeaux: Pick<DrapeauxPlateforme, 'acces_refuse' | 'identifiants_refuses'>): string {
  if (drapeaux.identifiants_refuses) {
    return `${erreur} L’identifiant ou le secret enregistrés ne sont plus acceptés : demandez-en de nouveaux au client, puis `
      + 'saisissez-les par « Modifier » dans la fenêtre « Plateforme du client » (onglet Justificatifs).'
  }
  if (drapeaux.acces_refuse) {
    return `${erreur} Demandez au client d’ouvrir au cabinet le droit de lire les flux de son entreprise sur sa plateforme.`
  }
  return erreur
}

// ── La phrase de la fenêtre des encaissements ─────────────────────────────────────────────────────────────────────

export type EtatVerification =
  /** Un 210 ou un 213 lu : rien à vérifier, la déclaration est refusée — le module le dit (refus 6). */
  | { etat: 'refusee' }
  /** Le dernier relevé de cette plateforme est allé au bout, et aucun refus n'est lu. */
  | { etat: 'lus'; texte: string; relevable: boolean }
  /** Aucun relevé de cette plateforme n'est allé au bout (ou on ne sait pas lequel). */
  | { etat: 'non_lus'; texte: string; relevable: boolean }

/**
 * Ce que la fenêtre dit, au moment de déclarer le statut « Encaissée » d'une facture acceptée par la plateforme du
 * client (`hote`), de ce qu'on SAIT d'un refus de l'acheteur. `connexion` est celle que la base garde (null : aucune ;
 * undefined : illisible, `erreurConnexion` dit pourquoi). Le relevé n'est offert que sur la plateforme même qui a accepté
 * la facture : c'est la seule dont la connexion lit les statuts.
 */
export function verificationAvantDeclaration(
  hote: string,
  statutsDeLaFacture: readonly Pick<StatutLu, 'code'>[],
  connexion: { hote: string; cycle_vie_lu_le: string | null } | null | undefined,
  erreurConnexion: string | null,
  dateDe: (instant: string) => string,
): EtatVerification {
  if (statutsDeLaFacture.some((s) => estUneAnnulation(s.code))) return { etat: 'refusee' }
  const relevable = connexion != null && connexion.hote === hote
  if (relevable && connexion.cycle_vie_lu_le) {
    return {
      etat: 'lus', relevable,
      texte: `Statuts lus sur ${hote} le ${dateDe(connexion.cycle_vie_lu_le)} : aucun refus de l’acheteur. Un refus posé `
        + 'depuis n’est connu qu’en relisant les statuts.',
    }
  }
  const pourquoi = connexion === undefined
    ? ` La connexion à la plateforme n’a pas pu être lue${erreurConnexion ? ` (${erreurConnexion})` : ''} : les statuts ne se relèvent pas d’ici.`
    : connexion === null
      ? ' Aucune plateforme n’est reliée au dossier pour les lire : reliez-la dans l’onglet Justificatifs (« Plateforme du client »).'
      : connexion.hote !== hote
        ? ` La plateforme reliée au dossier est aujourd’hui ${connexion.hote} : les statuts de ${hote} ne se relèvent pas d’ici.`
        : ''
  return {
    etat: 'non_lus', relevable,
    texte: `Les statuts de ${hote} n’ont pas encore été lus : lisez-les avant de déclarer — un refus de l’acheteur annule `
      + `la facture, et aucun statut « Encaissée » ne la suit.${pourquoi}`,
  }
}
