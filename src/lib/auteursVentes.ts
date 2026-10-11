import type { FactureEmise } from './types'

// QUI, DES AUTEURS D'UNE VENTE, EST LE CLIENT (espace client, étape P4c ; conception : HISTORIQUE.md, « L'ESPACE CLIENT
// DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.7).
//
// Chaque écriture du client se signe en base — `factures_emises.valide_par` et `created_by`, `transmissions_factures.cree_par`,
// `encaissements_factures.cree_par`, `transmissions_encaissements.cree_par` — d'un identifiant de compte, sans clé étrangère :
// rien n'y dit si ce compte est un membre du cabinet ou le titulaire. Le cabinet le reconnaît parmi les ACCÈS du dossier
// (`memberships.user_id`, que la policy `memberships_select` lui ouvre en entier) : un compte qui porte un accès client du
// dossier EST « le client ».
//
// TROIS CHOSES QUE CE MODULE NE FAIT JAMAIS.
//  1. Reconnaître le client sur une liste d'accès qui n'est pas lue EN ENTIER : en cours, partielle ou en échec, il ne dit
//     rien de personne (une liste tronquée ferait taire à tort un accès, et « pas le client » serait une affirmation).
//  2. Nommer un auteur nul : une facture d'avant P2, un brouillon que rien n'a signé, n'est de personne.
//  3. Dire « par le cabinet » d'un compte qu'il ne reconnaît pas : ce peut être un accès retiré depuis, dont la ligne
//     n'existe plus — on ne le devine pas, et l'aide du filtre le dit. Il n'y a donc qu'une mention, « par le client ».
//
// Pur : aucun accès à la base (la lecture est dans auteursVentesLecture.ts) — il se teste sans client Supabase.

export type AccesDuDossier =
  // La liste des accès n'est pas encore revenue.
  | { etat: 'en_cours' }
  // Lue en partie ou refusée : le motif, tel que `lireTout` le donne.
  | { etat: 'incomplets'; motif: string }
  // Lue EN ENTIER : les comptes qui portent un accès client du dossier AUJOURD'HUI.
  | { etat: 'lus'; comptes: readonly string[] }
  // L'espace du client : il ne lit pas les accès d'un autre, et rien n'y est dit « par le client ».
  | { etat: 'sans_objet' }

export const ACCES_SANS_OBJET: AccesDuDossier = { etat: 'sans_objet' }
export const ACCES_EN_COURS: AccesDuDossier = { etat: 'en_cours' }

/** Ce que `lireTout` rend d'une collection, réduit à ce dont ce module a besoin. */
export interface LectureDesAcces {
  lignes: readonly { user_id: string | null }[]
  complete: boolean
  motif: string | null
}

/**
 * La lecture des accès, jugée : entière, elle donne les comptes ; sinon elle ne donne QUE son motif — même si des lignes
 * sont revenues, car une liste tronquée ne dit pas qui manque.
 */
export function accesDeLaLecture(lecture: LectureDesAcces): AccesDuDossier {
  if (!lecture.complete) return { etat: 'incomplets', motif: lecture.motif ?? 'lecture incomplète' }
  const comptes = [...new Set(
    lecture.lignes.map((l) => l.user_id).filter((c): c is string => typeof c === 'string' && c !== ''),
  )]
  return { etat: 'lus', comptes }
}

/** Le compte est-il un accès client du dossier, sur une liste lue en entier ? Un auteur nul n'est personne. */
export function estLeClient(acces: AccesDuDossier, auteur: string | null | undefined): boolean {
  if (acces.etat !== 'lus') return false
  if (typeof auteur !== 'string' || auteur === '') return false
  return acces.comptes.includes(auteur)
}

/** La mention des fenêtres et des lignes : la seule, jamais un « par le cabinet ». */
export const PAR_LE_CLIENT = 'par le client'

// Ce que dit le survol de la mention, selon ce qui est fait : le mot nu « par le client » ne dit pas quoi.
export const TITRES_PAR_LE_CLIENT = {
  validee: 'Validée par le client',
  brouillon: 'Brouillon du client',
  transmission: 'Transmission déposée par le client',
  encaissement: 'Encaissement enregistré par le client',
  contrePassation: 'Contre-passation enregistrée par le client',
  declaration: 'Déclaration inscrite par le client',
} as const

export interface PastilleParLeClient {
  libelle: string
  titre: string
}

/**
 * La pastille d'une ligne de l'onglet Factures : une facture ou un avoir VALIDÉ dont `valide_par` est le client, un
 * BROUILLON dont `created_by` est le client. Rien d'autre : une facture validée par le cabinet d'un brouillon du client
 * n'est pas « par le client » (c'est le cabinet qui l'a émise), et une facture d'avant P2 (`valide_par` nul) n'a pas d'auteur.
 */
export function pastilleParLeClient(
  acces: AccesDuDossier, f: Pick<FactureEmise, 'statut' | 'valide_par' | 'created_by'>,
): PastilleParLeClient | null {
  if (f.statut === 'validee') {
    return estLeClient(acces, f.valide_par) ? { libelle: PAR_LE_CLIENT, titre: TITRES_PAR_LE_CLIENT.validee } : null
  }
  return estLeClient(acces, f.created_by) ? { libelle: PAR_LE_CLIENT, titre: TITRES_PAR_LE_CLIENT.brouillon } : null
}

/** Le filtre « Émises par le client » garde-t-il cette ligne ? Les VALIDÉES (factures et avoirs) dont le client est l'auteur. */
export function emiseParLeClient(acces: AccesDuDossier, f: Pick<FactureEmise, 'statut' | 'valide_par'>): boolean {
  return f.statut === 'validee' && estLeClient(acces, f.valide_par)
}

export type EtatDuFiltre = { disponible: true } | { disponible: false; raison: string }

/** Le filtre n'existe que sur des accès lus en entier ; sinon il est grisé et DIT pourquoi. */
export function etatDuFiltre(acces: AccesDuDossier): EtatDuFiltre {
  switch (acces.etat) {
    case 'lus':
      return { disponible: true }
    case 'en_cours':
      return { disponible: false, raison: 'Les accès du dossier sont en cours de lecture.' }
    case 'incomplets':
      return {
        disponible: false,
        raison: `La liste des accès du dossier n’a pas été lue en entier (${acces.motif}) : on ne peut pas dire quelles factures sont du client.`,
      }
    case 'sans_objet':
      return { disponible: false, raison: 'Ce filtre est celui du cabinet.' }
  }
}

export const LIBELLE_DU_FILTRE = 'Émises par le client'

// Ce que le filtre retient et ce qu'il ne reconnaît pas : un accès retiré n'a plus de ligne, on ne le devine pas.
export const AIDE_DU_FILTRE =
  'Les factures et avoirs validés par un compte qui porte aujourd’hui un accès client du dossier. Un accès retiré depuis '
  + 'n’est plus reconnu : ce qu’il a validé n’y figure pas, et rien n’est dit « par le client » de lui.'
