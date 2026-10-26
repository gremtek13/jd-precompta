import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { reglageDuDossier } from './droitsAcces'
import type { FactureDeLaBascule, LectureDeLaBascule, ListesDeLaBascule } from './basculeDesVentes'

// CE QUE LA CARTE « SOURCE DES VENTES » LIT (chantier EC-Q3, étape VF8b ; le module pur est lib/basculeDesVentes.ts), dans la
// même vague : la ligne du dossier par sa clé — le réglage, jugé par `reglageDuDossier` (lib/droitsAcces.ts, jamais un
// troisième jugement de la colonne), et la date de la bascule telle que lue —, puis, EN ENTIER (`lireTout`, tri total par la
// clé primaire), les factures du dossier (ce que la garde du réglage lit, avec leur date et leur statut), ses accès clients
// (la case « Ventes ») et ses pièces de vente à valider. Ce module ne rejette jamais : un refus, une ligne absente ou une
// requête qui lève rendent un réglage illisible, ou des listes partielles, avec leur motif — et la carte n'offre alors aucun
// geste. La réponse porte le dossier lu : un écran qui en a changé entre-temps ne la prend pas pour la sienne.

async function lireLeDossier(dossierId: string): Promise<Pick<LectureDeLaBascule, 'reglage' | 'depuis'>> {
  try {
    const { data, error } = await supabase.from('dossiers')
      .select('ventes_par_les_factures, ventes_par_les_factures_depuis').eq('id', dossierId).maybeSingle()
    if (error) return { reglage: { etat: 'illisible', motif: messageErreur(error, 'lecture refusée') }, depuis: undefined }
    return { reglage: reglageDuDossier(data), depuis: data?.ventes_par_les_factures_depuis }
  } catch (erreur) {
    return { reglage: { etat: 'illisible', motif: messageErreur(erreur, 'lecture interrompue') }, depuis: undefined }
  }
}

// Une requête qui LÈVE tombe du côté signalé, comme une lecture refusée : jamais une liste vide qui affirmerait l'absence.
async function lireEnEntier<T>(lire: () => Promise<LectureComplete<T>>): Promise<LectureComplete<T>> {
  try {
    return await lire()
  } catch (erreur) {
    return { lignes: [], complete: false, motif: messageErreur(erreur, 'lecture interrompue') }
  }
}

export async function lireLaBascule(dossierId: string): Promise<LectureDeLaBascule> {
  const [dossier, factures, acces, pieces] = await Promise.all([
    lireLeDossier(dossierId),
    lireEnEntier(() => lireTout<FactureDeLaBascule>((debut, fin) =>
      supabase.from('factures_emises')
        .select('id, numero, type, statut, validated_at, source_de_la_vente, date_emission', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )),
    lireEnEntier(() => lireTout<{ id: string; droit_ventes: boolean }>((debut, fin) =>
      supabase.from('memberships').select('id, droit_ventes', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )),
    lireEnEntier(() => lireTout<{ id: string }>((debut, fin) =>
      supabase.from('pieces').select('id', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('type_piece', 'vente').eq('statut', 'a_valider').order('id').range(debut, fin),
    )),
  ])
  const partielles = [
    factures.complete ? null : `les factures : ${factures.motif ?? 'lecture incomplète'}`,
    acces.complete ? null : `les accès : ${acces.motif ?? 'lecture incomplète'}`,
    pieces.complete ? null : `les pièces de vente : ${pieces.motif ?? 'lecture incomplète'}`,
  ].filter((motif) => motif != null)
  const listes: ListesDeLaBascule = partielles.length > 0
    ? { etat: 'partielles', motif: partielles.join(' ; ') }
    : { etat: 'lues', factures: factures.lignes, acces: acces.lignes, piecesDeVenteAValider: pieces.lignes.length }
  return { dossierId, ...dossier, listes }
}
