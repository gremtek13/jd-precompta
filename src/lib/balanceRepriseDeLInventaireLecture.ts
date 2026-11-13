import { INVENTAIRE_EXPORTE } from './inventaire'
import type { LigneDeLaBalanceReprise } from './regularisationRepriseEcran'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE L'ONGLET INVENTAIRE LIT DE LA BALANCE REPRISE (ligne 35, INV3-Q2 (A) ; lib/regularisationRepriseEcran.ts) : toutes les
// lignes des à-nouveaux du dossier — leur date ouvre le premier exercice, leurs comptes sous le 486, le 487, le 408 et le 418 sont
// ceux qu'une régularisation reprise extourne —, EN ENTIER, par `lireTout`, sous un tri total terminé par la clé primaire. À PART
// de la lecture de l'inventaire (lib/inventaireDeLEcranLecture.ts, qui n'en lit que la première date) : une balance lue en partie
// ne retire que la section des régularisations reprises, jamais le reste de l'onglet. TOUT OU RIEN : une lecture partielle,
// refusée, rompue, d'un autre dossier ou illisible, et l'état dit « incomplète » avec son motif — la section n'offre alors aucun
// geste. Gardée avec le dossier : le résultat se rend avec son identifiant. Ne rejette jamais. Le drapeau baissé
// (`INVENTAIRE_EXPORTE`), elle ne lit RIEN.

export type LectureDeLaBalanceReprise =
  | { dossierId: string; etat: 'absente' }
  | { dossierId: string; etat: 'incomplete'; motif: string }
  | { dossierId: string; etat: 'lue'; lignes: LigneDeLaBalanceReprise[] }

// Un littéral d'un seul tenant : le client typé lit le type d'une colonne dans la chaîne.
export const COLONNES_DE_LA_BALANCE = 'id, dossier_id, date, compte, sens, montant'

function ligneCroyable(l: Record<string, unknown>): boolean {
  return typeof l.id === 'string' && typeof l.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.date)
    && typeof l.compte === 'string' && (l.sens === 'debit' || l.sens === 'credit')
    && typeof l.montant === 'number' && Number.isFinite(l.montant)
}

/** Les lignes de la balance reprise du dossier, lues en entier ; ou « incomplète », avec le motif. Ne rejette jamais. */
export async function lireLaBalanceRepriseDuDossier(dossierId: string): Promise<LectureDeLaBalanceReprise> {
  return lireLaBalanceRepriseDuDossierSelon(dossierId, INVENTAIRE_EXPORTE)
}

/** La même lecture, selon que l'onglet est offert : les deux états du drapeau, que les tests jouent. */
export async function lireLaBalanceRepriseDuDossierSelon(dossierId: string, offert: boolean): Promise<LectureDeLaBalanceReprise> {
  if (!offert) return { dossierId, etat: 'absente' }
  try {
    const lecture = await lireTout<Record<string, unknown>>((debut, fin) =>
      supabase.from('a_nouveaux').select(COLONNES_DE_LA_BALANCE, { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin))
    if (!lecture.complete) return { dossierId, etat: 'incomplete', motif: `la balance reprise : ${lecture.motif ?? 'lecture incomplète'}` }
    if (lecture.lignes.some((l) => l.dossier_id !== dossierId)) {
      return { dossierId, etat: 'incomplete', motif: 'la balance reprise : une ligne rendue n’est pas de ce dossier' }
    }
    if (!lecture.lignes.every(ligneCroyable)) return { dossierId, etat: 'incomplete', motif: 'la balance reprise : une ligne lue ne se croit pas' }
    return {
      dossierId, etat: 'lue',
      lignes: lecture.lignes.map((l) => ({ date: l.date as string, compte: l.compte as string, sens: l.sens as 'debit' | 'credit', montant: l.montant as number })),
    }
  } catch (e) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(e, 'la lecture de la balance reprise a échoué') }
  }
}
