import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { TYPE_RELANCE_FACTURE, type RelanceJournalisee } from './relances'

/** Les relances de factures d'un dossier, lues dans le journal des e-mails : « Relancée le … » s'en déduit. */
export type LectureDesRelances =
  | { complete: true; relances: RelanceJournalisee[] }
  | { complete: false; raison: string }

/**
 * Le journal des relances de factures du dossier, EN ENTIER (étape C5) : la ligne que `send-email` écrit après chaque
 * relance, qui cite sa facture. Le cabinet les lit par sa policy ; le client « Ventes », par la sienne une fois la
 * migration `relances_des_factures` en base. Lue en partie, refusée ou rompue, rien ne se dit d'une relance — et l'écran
 * n'offre pas « Relancer » : on relancerait sans savoir qu'on l'a déjà fait. Ne rejette jamais.
 */
export async function lireLesRelances(dossierId: string): Promise<LectureDesRelances> {
  try {
    const lu = await lireTout<RelanceJournalisee>((debut, fin) =>
      supabase.from('emails_envoyes').select('facture_id, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('type', TYPE_RELANCE_FACTURE)
        .order('created_at').order('id').range(debut, fin))
    return lu.complete
      ? { complete: true, relances: lu.lignes }
      : { complete: false, raison: lu.motif ?? 'le journal des relances n’a été lu qu’en partie' }
  } catch (e) {
    return { complete: false, raison: messageErreur(e, 'le journal des relances n’a pas pu être lu') }
  }
}
