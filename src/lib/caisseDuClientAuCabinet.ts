import type { OperationCaisse } from './types'

// CE QUE LE CLIENT A SAISI DANS SA CAISSE, DIT AU CABINET (ligne 26.6, étape C11 ; la conception reprise, § 5 ; CAISSE2-Q1,
// (A) : une saisie du praticien compte dès qu'il l'enregistre, et le cabinet la retire ou la remplace s'il la juge fausse).
//
// « PAR LE CLIENT » N'EST JAMAIS DEVINÉ. La base pose l'origine de chaque opération (`operations_caisse.origine`,
// « cabinet » ou « client », jamais reçue de l'appelant : `qui_ecrit_la_caisse`) ; l'onglet Caisse la dit
// (lib/caisse.ts, `origineDite` : « saisie par le client », « remplacée par le client »), sur la caisse lue en entier. Aucune
// liste d'accès n'y ajoute rien : un compte qui porte un accès client peut aussi être de l'équipe, et qui RETIRE une
// opération ne se prouve pas par la liste des accès d'aujourd'hui — le retrait se dit sans auteur.
//
// LE POINT D'INFORMATION DE LA VUE D'ENSEMBLE compte les opérations que le client a saisies et que le cabinet n'a pas encore
// vues dans l'onglet Caisse — sans état de revue en base (CAISSE2-Q1) : « vues » est une mémoire de CE navigateur, la liste
// des identifiants que l'onglet a montrés sur une caisse lue en entier. Elle peut manquer (un autre navigateur, une
// navigation privée, des données effacées) : le point compte alors tout ce que le client a saisi, et le dit. Ce n'est pas une
// revue : aucun geste n'y est attaché, la validation de l'exercice reste la revue du cabinet.

/** La clé de la mémoire d'un dossier, dans ce navigateur. */
export function cleDesOperationsVues(dossierId: string): string {
  return `jd-precompta-caisse-vue-${dossierId}`
}

/** Ce que ce navigateur a retenu : les identifiants vus, ou rien (jamais retenu, illisible, ou stockage indisponible). */
export type OperationsVues = { etat: 'retenues'; ids: ReadonlySet<string> } | { etat: 'aucune' }

const IDENTIFIANT = /^[0-9A-Za-z-]{1,64}$/

/** Lit la mémoire ; une valeur qu'on ne reconnaît pas vaut « aucune » — le point compte alors tout, jamais moins. */
export function lireLesOperationsVues(dossierId: string): OperationsVues {
  try {
    const brute = localStorage.getItem(cleDesOperationsVues(dossierId))
    if (brute === null) return { etat: 'aucune' }
    const ids: unknown = JSON.parse(brute)
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && IDENTIFIANT.test(id))) return { etat: 'aucune' }
    return { etat: 'retenues', ids: new Set(ids as string[]) }
  } catch {
    return { etat: 'aucune' }
  }
}

/** Retient les identifiants des opérations du client qu'une caisse lue EN ENTIER montre ; un stockage indisponible ne retient rien. */
export function retenirLesOperationsVues(dossierId: string, operations: readonly Pick<OperationCaisse, 'id' | 'origine'>[]): void {
  try {
    const ids = operations.filter((o) => o.origine === 'client').map((o) => o.id).sort()
    localStorage.setItem(cleDesOperationsVues(dossierId), JSON.stringify(ids))
  } catch {
    // Rien de retenu : le point comptera de nouveau ces opérations, et le dira.
  }
}

/** Les opérations saisies par le client que ce navigateur n'a pas vues dans l'onglet Caisse (retirées comprises). */
export function saisiesDuClientNonVues(
  operations: readonly Pick<OperationCaisse, 'id' | 'origine'>[], vues: OperationsVues,
): Pick<OperationCaisse, 'id' | 'origine'>[] {
  return operations.filter((o) => o.origine === 'client' && (vues.etat === 'aucune' || !vues.ids.has(o.id)))
}

/** La phrase du point, ou rien quand il n'y a rien à dire. */
export function phraseDesSaisiesDuClient(nombre: number, vues: OperationsVues): string | null {
  if (nombre === 0) return null
  const quoi = nombre === 1 ? '1 opération de caisse saisie par le client' : `${nombre} opérations de caisse saisies par le client`
  return vues.etat === 'retenues'
    ? `${quoi} depuis ta dernière visite de l’onglet Caisse sur ce navigateur : elle${nombre === 1 ? '' : 's'} compte${nombre === 1 ? '' : 'nt'} déjà, marquée${nombre === 1 ? '' : 's'} « par le client ».`
    : `${quoi}, que ce navigateur ne t’a pas encore montrée${nombre === 1 ? '' : 's'} dans l’onglet Caisse : elle${nombre === 1 ? '' : 's'} compte${nombre === 1 ? '' : 'nt'} déjà, marquée${nombre === 1 ? '' : 's'} « par le client ».`
}

export const NOM_DU_POINT_DES_SAISIES = 'Saisies du client dans sa caisse'
export const LIBELLE_OUVRIR_LA_CAISSE = 'Ouvrir la caisse'
