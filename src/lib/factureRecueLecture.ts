import { cheminDuDossier, MOTIF_CHEMIN_HORS_DU_DOSSIER } from './cheminDuDossier'
import { sirenDuDossier } from './factureElectronique'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE « LIRE LA FACTURE ÉLECTRONIQUE » LIT (B4R-Q1 ; la règle et les mots : lib/factureRecueVue.ts). L'original stocké de
// la pièce, aux droits du cabinet — son chemin vérifié AVANT tout téléchargement (CFCS-Q1 : la base ne garde pas encore que
// le chemin d'une ligne commence par son dossier, et le client en insère) —, et le SIRET du dossier, qui juge l'acheteur.
// Ne rejette jamais : un refus, une lecture ratée ou qui lève tombent du côté refusé, avec leur motif ; rien ne se remplit.

export type OriginalRecu = { octets: Uint8Array; sirenDossier: string | null } | { refus: string }

export async function lireLOriginalRecu(dossierId: string, storagePath: string): Promise<OriginalRecu> {
  if (!cheminDuDossier(storagePath, dossierId)) return { refus: `Facture non lue : ${MOTIF_CHEMIN_HORS_DU_DOSSIER}.` }
  try {
    const [fichier, dossier] = await Promise.all([
      supabase.storage.from('pieces').download(storagePath),
      supabase.from('dossiers').select('id, siret').eq('id', dossierId).maybeSingle(),
    ])
    if (fichier.error || !fichier.data) {
      return { refus: `L’original de la facture n’a pas pu être téléchargé (${messageErreur(fichier.error, 'rien de rendu')}).` }
    }
    if (dossier.error) {
      return { refus: `Le SIRET du dossier n’a pas pu être lu (${messageErreur(dossier.error, 'lecture refusée')}) : rien ne vérifierait l’acheteur.` }
    }
    const ligne = dossier.data as { id: string; siret: string | null } | null
    if (ligne === null || ligne.id !== dossierId) {
      return { refus: 'Le dossier n’a pas été rendu : rien ne vérifierait l’acheteur de la facture.' }
    }
    return { octets: new Uint8Array(await fichier.data.arrayBuffer()), sirenDossier: sirenDuDossier(ligne.siret) }
  } catch (e) {
    return { refus: `L’original de la facture n’a pas pu être lu (${messageErreur(e, 'lecture interrompue')}).` }
  }
}
