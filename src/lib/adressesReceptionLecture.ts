import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { AdresseReception } from './types'

// L'ADRESSE DE RÉCEPTION D'UN DOSSIER, LUE POUR L'ÉCRAN (espace client, étape A6b1 ; modèle : lib/articlesLecture.ts). La
// policy du cabinet et celle du client « Ventes » (migration `adresses_reception`, A6a) ouvrent toutes les lignes du
// dossier, TOUTES les colonnes : la chaîne des versions se juge sur ce qui est lu, jamais sur ce qu'on devine.
//
// DEUX LECTURES, CHACUNE AVEC SON ÉTAT. Les adresses, par `lireTout` (tri TOTAL terminé par la clé primaire — `cree_le`
// n'est pas unique — et compte annoncé) ; le SIRET du dossier, à part : la ligne du dossier, que la policy de lecture de
// `dossiers` ouvre déjà au client, et dont le module `adressesReception` tire le SIREN que la base compare à l'adresse.
// Aucune ne REJETTE : une requête qui lève ou qu'on refuse tombe du côté signalé, avec son motif (`messageErreur`), jamais
// en une liste vide qui laisserait croire qu'aucune adresse n'est déclarée. C'est l'écran qui décide : « aucune adresse »
// ne se dit que d'une liste lue en entier, et le moindre geste n'est offert que si les deux lectures sont revenues entières.
export interface LectureDesAdresses {
  lignes: AdresseReception[]
  // Lue jusqu'au bout, ou non : l'écran en décide (le vide, la version courante, les gestes).
  complete: boolean
  // Ce qui a manqué, en clair, quand `complete` est faux.
  motif: string | null
}

// Le SIRET tel que la colonne le porte (nul, un SIREN seul, ou quatorze chiffres) : c'est le module qui en tire le SIREN.
export type SiretDuDossier = { lu: true; siret: string | null } | { lu: false; motif: string }

export interface LectureAdressesDuDossier {
  adresses: LectureDesAdresses
  siret: SiretDuDossier
}

async function lireLesAdresses(dossierId: string): Promise<LectureDesAdresses> {
  try {
    const lecture = await lireTout<AdresseReception>((debut, fin) =>
      supabase.from('adresses_reception').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
    )
    return { lignes: lecture.lignes, complete: lecture.complete, motif: lecture.motif }
  } catch (e) {
    return { lignes: [], complete: false, motif: messageErreur(e, 'la lecture des adresses a échoué') }
  }
}

async function lireLeSiret(dossierId: string): Promise<SiretDuDossier> {
  try {
    const { data, error } = await supabase.from('dossiers').select('siret').eq('id', dossierId).maybeSingle()
    if (error) return { lu: false, motif: messageErreur(error, 'le SIRET du dossier n’a pas pu être lu') }
    // Une ligne absente n'est pas un SIRET absent : la base ne dit pas que le dossier n'en a pas, elle ne dit rien.
    if (data == null) return { lu: false, motif: 'le dossier n’a pas pu être lu' }
    const siret = (data as { siret: string | null }).siret
    return { lu: true, siret: typeof siret === 'string' ? siret : null }
  } catch (e) {
    return { lu: false, motif: messageErreur(e, 'le SIRET du dossier n’a pas pu être lu') }
  }
}

/** Les adresses du dossier et son SIRET, lus ensemble ; ne rejette jamais. */
export async function lireLesAdressesDuDossier(dossierId: string): Promise<LectureAdressesDuDossier> {
  const [adresses, siret] = await Promise.all([lireLesAdresses(dossierId), lireLeSiret(dossierId)])
  return { adresses, siret }
}
