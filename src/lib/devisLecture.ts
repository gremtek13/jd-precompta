import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { COLONNES_DE_L_EMETTEUR, type EmetteurDuDossier } from './devis'
import type { Devis, DevisFacture } from './types'

// LES DEVIS D'UN DOSSIER ET LEURS LIENS, LUS EN ENTIER (espace client, étape P6a1 ; modèle : lib/contactsLecture.ts et
// lib/accesCaisseDuDossierLecture.ts). Les policies `devis_lecture` (le cabinet) et `devis_lecture_ventes` (le client qui
// porte « Ventes ») ouvrent toutes les lignes du dossier, toutes les colonnes ; de même pour `devis_factures`, dont l'état
// « facturé » se déduit (`etatDuDevis`, `factureTireeDe`). Rien ne se lit tant que `DEVIS_EXPORTES` est baissé : seule la vue
// « Devis », offerte drapeau levé, appelle ce module.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire et compte annoncé : les DEUX listes lues jusqu'au bout, ou la lecture
// est partielle — un lien manquant ferait dire « accepté » d'un devis déjà facturé. Elle ne rejette jamais : refusée ou
// rompue, elle le dit avec son motif. Une ligne d'un autre dossier la rend partielle. La réponse se rend avec le dossier
// lu : la page d'un dossier reste montée quand on passe à un autre.
export type LectureDesDevis =
  | {
      dossierId: string; etat: 'lue'; devis: Devis[]; liens: DevisFacture[]; complete: boolean; motif: string | null
      // Le dossier tel que `enregistrer_devis` le lira pour poser l'émetteur (A7) ; nul s'il n'a pas pu être lu : partielle.
      emetteur: EmetteurDuDossier | null
    }
  | { dossierId: string; etat: 'echec'; motif: string }

export async function lireLesDevis(dossierId: string): Promise<LectureDesDevis> {
  try {
    const [devis, liens, dossier] = await Promise.all([
      lireTout<Devis>((debut, fin) =>
        supabase.from('devis').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      lireTout<DevisFacture>((debut, fin) =>
        supabase.from('devis_factures').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      // Une seule ligne, par sa clé : `maybeSingle` (une collection passerait par `lireTout`, lecturesPaginees.test.ts).
      supabase.from('dossiers').select(COLONNES_DE_L_EMETTEUR).eq('id', dossierId).maybeSingle(),
    ])
    const emetteur = dossier.error ? null : ((dossier.data as unknown as EmetteurDuDossier | null) ?? null)
    const etrangere = [...devis.lignes, ...liens.lignes].some((l) => l.dossier_id !== dossierId)
    const complete = devis.complete && liens.complete && !etrangere && emetteur !== null
    const motif = complete ? null
      : etrangere ? 'une ligne rendue n’est pas de ce dossier'
        : emetteur === null ? 'l’identité du dossier n’a pas pu être lue'
          : devis.motif ?? liens.motif ?? 'lecture incomplète'
    return { dossierId, etat: 'lue', devis: devis.lignes, liens: liens.lignes, complete, motif, emetteur }
  } catch (e) {
    return { dossierId, etat: 'echec', motif: messageErreur(e, 'les devis n’ont pas pu être lus') }
  }
}
