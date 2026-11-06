import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import type { ActiviteDUnContact } from './contactsInactifs'

// L'ACTIVITÉ DES CONTACTS D'UN DOSSIER, LUE EN ENTIER : les factures et les devis qui citent un contact (`contact_id`), à leur
// date d'émission. Deux lectures par `lireTout` (compte annoncé, tri TOTAL par la clé primaire), toutes les lignes du dossier
// — celles qui ne citent aucun contact s'écartent ici, pas dans la requête : la liste des clients sans activité ne se dit que
// de deux lectures revenues ENTIÈRES (`complete`), et l'écran n'offre alors aucun geste sur une lecture partielle, refusée ou
// rompue. Une requête qui LÈVE rejette : l'écran le dit.
//
// Sous `DEVIS_CITENT_UN_CONTACT` seulement (src/lib/devis.ts) : avant la migration, `devis.contact_id` n'est pas en base.
export interface LectureDesActivites {
  activites: ActiviteDUnContact[]
  complete: boolean
  motif: string | null
}

interface Citant {
  id: string
  contact_id: string | null
  date_emission: string
}

export async function lireLesActivitesDesContacts(dossierId: string): Promise<LectureDesActivites> {
  const [factures, devis] = await Promise.all([
    lireTout<Citant>((debut, fin) =>
      supabase.from('factures_emises').select('id, contact_id, date_emission', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<Citant>((debut, fin) =>
      supabase.from('devis').select('id, contact_id, date_emission', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
  ])
  const activites = [...factures.lignes, ...devis.lignes]
    .filter((l) => l.contact_id != null)
    .map((l) => ({ contactId: l.contact_id as string, date: l.date_emission }))
  const motifs = [
    factures.complete ? null : `factures : ${factures.motif ?? 'lecture incomplète'}`,
    devis.complete ? null : `devis : ${devis.motif ?? 'lecture incomplète'}`,
  ].filter((m): m is string => m != null)
  return { activites, complete: motifs.length === 0, motif: motifs.length === 0 ? null : motifs.join(' ; ') }
}
