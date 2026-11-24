import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  COLONNES_DES_REGLAGES_D_EXPORT, REGLAGES_D_EXPORT_PREVUS, REGLAGES_NON_ENREGISTRES, reglagesLisibles, reglagesPourLaBase,
  type LectureDesReglagesDExport, type SaisieDesReglages,
} from './reglagesDExport'
import type { ReglagesDExport } from './types'

// CE QUE L'EXPORT VERS UN LOGICIEL COMPTABLE LIT ET ÉCRIT DE SES RÉGLAGES GARDÉS (EXP-Q4 (A)). Le jugement est celui du module
// pur (lib/reglagesDExport.ts) ; ici, la lecture de la ligne d'un dossier pour un logiciel, et l'écriture par sa fonction
// SQL, son erreur lue et dite. Aucune lecture ne REJETTE : refusée, partielle, d'un autre dossier ou d'une forme que la base
// ne donne pas, elle revient « illisible », avec son motif — et l'écran n'offre alors aucun formulaire prérempli, ni
// l'enregistrement. Drapeau `REGLAGES_D_EXPORT_PREVUS` baissé, rien ne part vers la base : la table n'existe pas.

/** Les réglages gardés d'un dossier pour un logiciel, lus en entier — une ligne au plus — ; ou « illisibles ». */
export async function lireLesReglagesDExport(dossierId: string, logiciel: string): Promise<LectureDesReglagesDExport> {
  const illisibles = (motif: string): LectureDesReglagesDExport => ({ dossierId, logiciel, etat: 'illisibles', motif })
  if (!REGLAGES_D_EXPORT_PREVUS) return illisibles('les réglages d’export ne se gardent pas encore en base')
  try {
    const lecture = await lireTout<ReglagesDExport>((debut, fin) =>
      supabase.from('reglages_d_export').select(COLONNES_DES_REGLAGES_D_EXPORT, { count: 'exact' })
        .eq('dossier_id', dossierId).eq('logiciel', logiciel).order('id').range(debut, fin),
    )
    if (!lecture.complete) return illisibles(lecture.motif ?? 'lecture incomplète')
    if (lecture.lignes.length > 1 || lecture.lignes.some((l) => l.dossier_id !== dossierId || l.logiciel !== logiciel)) {
      return illisibles('une ligne rendue n’est pas celle de ce dossier et de ce logiciel')
    }
    const gardes = lecture.lignes[0] ?? null
    if (gardes !== null && !reglagesLisibles(gardes)) return illisibles('une valeur gardée n’a pas la forme que la base lui donne')
    return { dossierId, logiciel, etat: 'lus', gardes }
  } catch (erreur) {
    return illisibles(messageErreur(erreur, 'la lecture des réglages d’export a échoué'))
  }
}

/**
 * Les réglages d'un dossier pour un logiciel, d'un seul geste (`enregistrer_reglages_d_export`), contre la version lue qu'ils
 * remplacent (nulle : aucune ligne n'était gardée). Rend la version écrite. Ne rejette jamais.
 */
export async function enregistrerLesReglagesDExport(
  dossierId: string, logiciel: string, saisie: SaisieDesReglages, versionLue: number | null,
): Promise<{ ok: true; version: number } | { ok: false; erreur: string }> {
  if (!REGLAGES_D_EXPORT_PREVUS) return { ok: false, erreur: REGLAGES_NON_ENREGISTRES }
  try {
    const { data, error } = await supabase.rpc('enregistrer_reglages_d_export', {
      p_dossier_id: dossierId, p_logiciel: logiciel, p_reglages: reglagesPourLaBase(saisie), p_version_lue: versionLue,
    })
    if (error) return { ok: false, erreur: messageErreur(error, REGLAGES_NON_ENREGISTRES) }
    if (typeof data !== 'number' || !Number.isInteger(data) || data < 1) return { ok: false, erreur: REGLAGES_NON_ENREGISTRES }
    return { ok: true, version: data }
  } catch (erreur) {
    return { ok: false, erreur: messageErreur(erreur, REGLAGES_NON_ENREGISTRES) }
  }
}
