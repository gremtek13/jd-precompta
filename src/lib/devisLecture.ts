import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import { COLONNES_DE_L_EMETTEUR, type EmetteurDuDossier } from './devis'
import type { Devis, DevisFacture, FactureEmise } from './types'

// La facture tirée d'un devis, telle que la liste la dit (étape P6a2) : son numéro, nul tant qu'elle est un brouillon.
export type FactureDuDossier = Pick<FactureEmise, 'id' | 'dossier_id' | 'numero' | 'statut'>
export const COLONNES_FACTURE_TIREE = 'id, dossier_id, numero, statut'

// LES DEVIS D'UN DOSSIER ET LEURS LIENS, LUS EN ENTIER (espace client, étape P6a1 ; modèle : lib/contactsLecture.ts et
// lib/accesCaisseDuDossierLecture.ts). Les policies `devis_lecture` (le cabinet) et `devis_lecture_ventes` (le client qui
// porte « Ventes ») ouvrent toutes les lignes du dossier, toutes les colonnes ; de même pour `devis_factures`, dont l'état
// « facturé » se déduit (`etatDuDevis`, `factureTireeDe`). Rien ne se lit tant que `DEVIS_EXPORTES` est baissé : seule la vue
// « Devis », offerte drapeau levé, appelle ce module.
// Les factures du dossier (leurs numéros seuls, étape P6a2), pour dire celle que chaque devis facturé a tirée : un lien dont la
// facture n'est pas revenue rend la lecture partielle.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire et compte annoncé : les DEUX listes lues jusqu'au bout, ou la lecture
// est partielle — un lien manquant ferait dire « accepté » d'un devis déjà facturé. Elle ne rejette jamais : refusée ou
// rompue, elle le dit avec son motif. Une ligne d'un autre dossier la rend partielle. La réponse se rend avec le dossier
// lu : la page d'un dossier reste montée quand on passe à un autre.
export type LectureDesDevis =
  | {
      dossierId: string; etat: 'lue'; devis: Devis[]; liens: DevisFacture[]; factures: FactureDuDossier[]; complete: boolean
      motif: string | null
      // Le dossier tel que `enregistrer_devis` le lira pour poser l'émetteur (A7) ; nul s'il n'a pas pu être lu : partielle.
      emetteur: EmetteurDuDossier | null
    }
  | { dossierId: string; etat: 'echec'; motif: string }

export async function lireLesDevis(dossierId: string): Promise<LectureDesDevis> {
  try {
    const [devis, liens, factures, dossier] = await Promise.all([
      lireTout<Devis>((debut, fin) =>
        supabase.from('devis').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      lireTout<DevisFacture>((debut, fin) =>
        supabase.from('devis_factures').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
      ),
      lireTout<FactureDuDossier>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_FACTURE_TIREE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Une seule ligne, par sa clé : `maybeSingle` (une collection passerait par `lireTout`, lecturesPaginees.test.ts).
      supabase.from('dossiers').select(COLONNES_DE_L_EMETTEUR).eq('id', dossierId).maybeSingle(),
    ])
    const emetteur = dossier.error ? null : ((dossier.data as unknown as EmetteurDuDossier | null) ?? null)
    const etrangere = [...devis.lignes, ...liens.lignes, ...factures.lignes].some((l) => l.dossier_id !== dossierId)
    const facturesLues = new Set(factures.lignes.map((f) => f.id))
    const factureManquante = factures.complete && liens.lignes.some((l) => !facturesLues.has(l.facture_id))
    const complete = devis.complete && liens.complete && factures.complete && !etrangere && !factureManquante && emetteur !== null
    const motif = complete ? null
      : etrangere ? 'une ligne rendue n’est pas de ce dossier'
        : emetteur === null ? 'l’identité du dossier n’a pas pu être lue'
          : factureManquante ? 'la facture tirée d’un devis n’a pas été lue'
            : devis.motif ?? liens.motif ?? factures.motif ?? 'lecture incomplète'
    return {
      dossierId, etat: 'lue', devis: devis.lignes, liens: liens.lignes, factures: factures.lignes, complete, motif, emetteur,
    }
  } catch (e) {
    return { dossierId, etat: 'echec', motif: messageErreur(e, 'les devis n’ont pas pu être lus') }
  }
}
