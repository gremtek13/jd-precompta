import { messageErreur } from './messageErreur'
import { reprisesRetiennentLaTresoreriePrevues, type LectureDesReprisesDuModele } from './reprisesRetiennentLaTresorerie'
import { supabase } from './supabase'

// LA LECTURE DE CE QUI RETIENT LE PASSAGE EN ENGAGEMENT (A8B-Q3 ; la règle et les mots : lib/reprisesRetiennentLaTresorerie.ts).
// Le nombre de factures et d'avoirs à l'état « importee » du dossier — la lecture même que la garde de la base fait —, un
// COMPTE (`count: 'exact'`, aucune ligne rendue) : la policy `factures_emises_all` les ouvre au cabinet du dossier, le seul à
// régler son modèle comptable. Ne rejette jamais : une erreur, un compte absent ou une requête qui lève rendent une lecture
// ILLISIBLE, avec son motif — jamais « aucune facture reprise » deviné. Le drapeau baissé : `null`, sans appel au réseau.
export async function lireLesReprisesDuModele(dossierId: string): Promise<LectureDesReprisesDuModele | null> {
  if (!reprisesRetiennentLaTresoreriePrevues()) return null
  try {
    const { count, error } = await supabase.from('factures_emises').select('id', { count: 'exact', head: true })
      .eq('dossier_id', dossierId).eq('statut', 'importee')
    if (error) return { dossierId, etat: 'illisible', motif: messageErreur(error, 'les factures reprises n’ont pas pu être lues') }
    if (typeof count !== 'number') return { dossierId, etat: 'illisible', motif: 'la base n’a pas rendu de compte' }
    return { dossierId, etat: 'lue', nombre: count }
  } catch (erreur) {
    return { dossierId, etat: 'illisible', motif: messageErreur(erreur, 'les factures reprises n’ont pas pu être lues') }
  }
}
