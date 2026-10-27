// Les lectures de la liste des dossiers d'un membre de l'équipe (23Q2Q2Q1-Q1, voir `dossiersOuverts.ts`) : les accès client
// du compte connecté, et l'ouverture d'un dossier par la base (`admin_du_dossier`). Écrites une fois pour la barre latérale
// (`listeDossiers.ts`), le tableau de bord (`DossiersList`) et la page d'un dossier (`DossierDetail`). Aucune ne lève : une
// panne se rend comme une lecture ratée, que la règle fait tomber du côté fermé.
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { dossiersAVerifier, dossiersOuverts, type AccesDuCompte, type DossiersOuverts, type OuvertureLue } from './dossiersOuverts'

/**
 * Les accès client du compte connecté, lus EN ENTIER : filtrés sur lui, car un chef lit aussi ceux des clients de ses
 * dossiers (`memberships_select`), et tri total par la clé.
 */
export async function lireLesAccesDuCompte(userId: string): Promise<AccesDuCompte> {
  try {
    const lecture = await lireTout<{ dossier_id: string }>((debut, fin) =>
      supabase.from('memberships').select('dossier_id', { count: 'exact' })
        .eq('user_id', userId).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { illisibles: lecture.motif ?? 'lecture incomplète' }
    return { dossiers: new Set(lecture.lignes.map((l) => l.dossier_id)) }
  } catch (erreur) {
    return { illisibles: messageErreur(erreur, 'lecture interrompue') }
  }
}

/** L'ouverture d'un dossier au compte connecté, par la fonction de la base qui ouvre ses onglets. Seul un booléen se lit. */
export async function lireLOuverture(dossierId: string): Promise<OuvertureLue> {
  try {
    const { data, error } = await supabase.rpc('admin_du_dossier', { p_dossier_id: dossierId })
    if (error) return { illisible: messageErreur(error, 'refus de la base') }
    if (typeof data !== 'boolean') return { illisible: 'réponse illisible de la base' }
    return { ouvert: data }
  } catch (erreur) {
    return { illisible: messageErreur(erreur, 'lecture interrompue') }
  }
}

/** Les dossiers que le cabinet ouvre au compte connecté : l'ouverture ne se demande que pour ceux où il a un accès client. */
export async function garderLesDossiersOuverts<T extends { id: string }>(
  dossiers: readonly T[], acces: AccesDuCompte,
): Promise<DossiersOuverts<T>> {
  const lues = await Promise.all(dossiersAVerifier(dossiers, acces).map(async (id) => [id, await lireLOuverture(id)] as const))
  return dossiersOuverts(dossiers, acces, new Map(lues))
}
