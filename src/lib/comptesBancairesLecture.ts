import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import type { CompteDuReleve, LectureDesComptes } from './importParCompte'

// La lecture des comptes bancaires d'un dossier, pour l'import d'un relevé (MCB2). Elle ne rejette jamais : une erreur ou
// une lecture partielle rendent `illisible`, et l'import se retient. Drapeau `COMPTES_BANCAIRES_PREVUS` baissé, la table
// n'existe pas encore : rien ne se lit, `sans_objet`, et l'import reste celui d'un seul compte.
export async function lireLesComptesDuDossier(dossierId: string): Promise<LectureDesComptes> {
  if (!COMPTES_BANCAIRES_PREVUS) return { etat: 'sans_objet' }
  try {
    const lecture = await lireTout<CompteDuReleve>((debut, fin) =>
      supabase.from('comptes_bancaires').select('id, libelle, principal, fin_d_identifiant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'illisible', motif: lecture.motif ?? 'lecture incomplète' }
    // Le principal d'abord, puis les autres par libellé : l'ordre de la liste où l'on choisit.
    const comptes = [...lecture.lignes].sort((a, b) => Number(b.principal) - Number(a.principal) || a.libelle.localeCompare(b.libelle, 'fr'))
    return { etat: 'lus', comptes }
  } catch (erreur) {
    return { etat: 'illisible', motif: messageErreur(erreur, 'lecture impossible') }
  }
}
