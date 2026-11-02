import {
  COLONNES_DE_LA_NATURE, COLONNES_DES_OPERATIONS_DU_CLIENT, COLONNES_DU_DOSSIER_DU_CLIENT, jourLu, type CategorieDeLaNature, type DossierDuClient,
  type JourDeLaCaisseDuClient, type NatureDesRecettesLue, type OperationDuClient,
} from './caisseClient'
import { lireTout, type LectureComplete, type TrancheLue } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// « MA CAISSE », CE QUE L'ÉCRAN DU PRATICIEN LIT (ligne 26.6, étape C12a ; le patron : « Ma banque », pages/ClientBanque.tsx).
//
// LA CASE SE LIT DEUX FOIS : à la connexion (AuthContext), pour la route, l'entrée et la tuile ; puis à la BASE, dans la même
// vague que les lectures qu'elle autorise (`droits_sur_le_dossier`) — une application installée reste ouverte des jours, et une
// case retirée entre-temps ferait lire des opérations que la RLS rend VIDES, sans erreur : l'écran dirait « aucune opération »
// d'une caisse qui en a. Sans la case, rien de ce qui a été lu n'est rendu.
//
// CE QUI SE LIT : le dossier (son statut de TVA, son mode, la nature des recettes que le cabinet a fixée) ; la nature, son compte
// seulement ; les opérations de la caisse (la policy `operations_caisse_lecture_caisse`), retirées comprises, par `lireTout` ;
// et la caisse jour par jour (`caisse_du_client`) pour l'année affichée ET chacune des suivantes jusqu'à l'année en cours — une
// saisie d'une année passée se juge aussi sur la caisse qui la suit —, chacune par `lireTout`, tri total sur le jour.
//
// ELLE NE REJETTE JAMAIS : une requête qui lève, un refus, une ligne illisible tombent du côté signalé, avec leur motif — jamais
// une liste vide. Elle se rend AVEC le dossier et l'année qu'elle a lus : l'écran ne prend pas une réponse d'une autre société.

export type LectureDeLaCaisseDuClient =
  | { dossierId: string; annee: number; etat: 'echec'; motif: string }
  | { dossierId: string; annee: number; etat: 'sans_caisse' }
  | {
    dossierId: string
    annee: number
    etat: 'lue'
    dossier: DossierDuClient
    nature: NatureDesRecettesLue
    operations: LectureComplete<OperationDuClient>
    jours: LectureComplete<JourDeLaCaisseDuClient>
  }

/**
 * La case « Caisse » rendue par `droits_sur_le_dossier`. Seul `true` accorde ; un refus, une réponse d'une autre forme ou une
 * requête qui lève ne rendent AUCUN droit, avec leur motif : l'échec tombe du côté fermé. La requête est ATTENDUE : un
 * constructeur de requête n'est pas une promesse.
 */
export async function lireLeDroitCaisse(requete: PromiseLike<{ data: unknown; error: unknown }>):
  Promise<{ caisse: boolean; motif: null } | { caisse: null; motif: string }> {
  try {
    const { data, error } = await requete
    if (error) return { caisse: null, motif: messageErreur(error, 'droits illisibles') }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { caisse: null, motif: 'droits illisibles' }
    return { caisse: (data as Record<string, unknown>).caisse === true, motif: null }
  } catch (erreur) {
    return { caisse: null, motif: messageErreur(erreur, 'droits illisibles') }
  }
}

// Les jours d'une année, par tranches : chaque ligne jugée à sa forme — une ligne illisible arrête la lecture comme un refus
// (`lireTout` la rend alors incomplète, sous ce motif).
async function lireLesJours(dossierId: string, annee: number): Promise<LectureComplete<JourDeLaCaisseDuClient>> {
  const lecture = await lireTout<JourDeLaCaisseDuClient>(async (debut, fin) => {
    const r: TrancheLue<unknown> = await supabase.rpc('caisse_du_client', { p_dossier_id: dossierId, p_annee: annee }, { count: 'exact' })
      .order('jour').range(debut, fin)
    if (r.error) return { data: null, error: r.error, count: r.count }
    const lignes = (r.data ?? []).map(jourLu)
    if (lignes.some((l) => l === null)) return { data: null, error: { message: 'une ligne de ta caisse est illisible' }, count: r.count }
    return { data: lignes as JourDeLaCaisseDuClient[], error: null, count: r.count }
  })
  return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
}

/** Tout ce que « Ma caisse » lit pour une année ; ne rejette jamais. */
export async function lireLaCaisseDuClient(dossierId: string, annee: number, anneeEnCours: number): Promise<LectureDeLaCaisseDuClient> {
  try {
    const [droit, dossierLu, operations] = await Promise.all([
      lireLeDroitCaisse(supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId })),
      supabase.from('dossiers').select(COLONNES_DU_DOSSIER_DU_CLIENT).eq('id', dossierId).maybeSingle(),
      lireTout<OperationDuClient>((debut, fin) =>
        supabase.from('operations_caisse').select(COLONNES_DES_OPERATIONS_DU_CLIENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('date').order('cree_le').order('id').range(debut, fin),
      ),
    ])
    if (droit.motif !== null) return { dossierId, annee, etat: 'echec', motif: `ton accès à ta caisse n’a pas pu être vérifié (${droit.motif})` }
    if (!droit.caisse) return { dossierId, annee, etat: 'sans_caisse' }
    if (dossierLu.error) return { dossierId, annee, etat: 'echec', motif: messageErreur(dossierLu.error, 'ta société n’a pas pu être lue') }
    const dossier = dossierLu.data as DossierDuClient | null
    if (dossier == null || dossier.id !== dossierId) return { dossierId, annee, etat: 'echec', motif: 'ta société n’a pas pu être lue' }
    const etrangere = operations.lignes.some((o) => o.dossier_id !== dossierId)
    const operationsGardees: LectureComplete<OperationDuClient> = !etrangere ? operations
      : { lignes: [], complete: false, motif: operations.motif ?? 'une opération rendue n’est pas de ta société' }
    const annees = Array.from({ length: Math.max(0, anneeEnCours - annee) + 1 }, (_, i) => annee + i)
    const [nature, ...parAnnee] = await Promise.all([
      lireLaNature(dossier),
      ...annees.map((a) => lireLesJours(dossierId, a)),
    ])
    const manque = parAnnee.find((l) => !l.complete)
    const jours: LectureComplete<JourDeLaCaisseDuClient> = manque
      ? { lignes: [], complete: false, motif: manque.motif }
      : { lignes: parAnnee.flatMap((l) => l.lignes), complete: true, motif: null }
    return { dossierId, annee, etat: 'lue', dossier, nature, operations: operationsGardees, jours }
  } catch (erreur) {
    return { dossierId, annee, etat: 'echec', motif: messageErreur(erreur, 'ta caisse n’a pas pu être lue') }
  }
}

// La nature des recettes que le cabinet a fixée : son compte seulement. Aucune nature, rien à lire.
async function lireLaNature(dossier: DossierDuClient): Promise<NatureDesRecettesLue> {
  if (dossier.categorie_recettes_client == null) return { etat: 'lue', categorie: null }
  try {
    const { data, error } = await supabase.from('categories').select(COLONNES_DE_LA_NATURE)
      .eq('id', dossier.categorie_recettes_client).maybeSingle()
    if (error) return { etat: 'illisible', motif: messageErreur(error, 'lecture refusée') }
    return { etat: 'lue', categorie: (data as CategorieDeLaNature | null) ?? null }
  } catch (erreur) {
    return { etat: 'illisible', motif: messageErreur(erreur, 'lecture refusée') }
  }
}
