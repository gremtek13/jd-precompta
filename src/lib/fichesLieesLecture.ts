import { lireLaDesignationDuDossier } from './dossierDuCabinetLecture'
import { FICHES_LIEES_PREVUES, type IdentiteLue } from './fichesLiees'
import type { DossierDuCabinetLu } from './fichesLieesVue'
import { lireTout, type TrancheLue } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LA FICHE LIÉE, LUE POUR L'ÉCRAN (ligne 47, lot LM3 ; la règle : lib/fichesLiees.ts ; ce qu'on en dit : lib/fichesLieesVue.ts).
// Rien ne se lit tant que `FICHES_LIEES_PREVUES` est baissé : `identites_des_fiches_liees` n'existe pas encore, et la nommer
// ferait échouer chaque ouverture de la vue « Clients ».
//
// Aucune lecture ne REJETTE : une panne tombe du côté signalé, avec son motif, et l'écran n'offre alors aucun geste. Une liste
// lue en partie est ILLISIBLE, jamais une liste plus courte : un dossier qu'on n'a pas lu se dirait « libre à relier », et une
// identité qu'on n'a pas lue se dirait « partie ».

/** Les identités que chaque dossier lié donne aujourd'hui (`identites_des_fiches_liees`), lues en entier. */
export type LectureDesIdentites = { etat: 'lue'; identites: IdentiteLue[] } | { etat: 'illisible'; motif: string }

/**
 * L'identité de chaque fiche liée du dossier du cabinet, lue par la fonction de la base (`security definer` : elle se lit sans
 * l'accès au dossier du client, LM3-Q2), par tranches triées sur la fiche — une ligne par fiche. Le drapeau baissé : aucune.
 */
export async function lireLesIdentitesDesFichesLiees(dossierId: string): Promise<LectureDesIdentites> {
  if (!FICHES_LIEES_PREVUES) return { etat: 'lue', identites: [] }
  try {
    const lu = await lireTout<IdentiteLue>(async (debut, fin) => {
      const r: TrancheLue<IdentiteLue> = await supabase.rpc('identites_des_fiches_liees', { p_dossier_id: dossierId }, { count: 'exact' })
        .order('contact_id').range(debut, fin)
      if (r.error) return { data: null, error: r.error, count: r.count }
      return { data: r.data ?? [], error: null, count: r.count }
    })
    if (!lu.complete) return { etat: 'illisible', motif: lu.motif ?? 'la lecture des identités est incomplète' }
    return { etat: 'lue', identites: lu.lignes }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'les identités des clients n’ont pas pu être lues') }
  }
}

/** Ce que la section des fiches liées sait avant le moindre geste. */
export type LectureDesFichesLiees =
  // Ce dossier n'est pas celui du cabinet : la section ne se montre pas (aucune fiche ne s'y lie).
  | { etat: 'horsDuDossierDuCabinet' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lue'; dossierDuCabinetId: string; dossiers: DossierDuCabinetLu[]; identites: IdentiteLue[] }

/**
 * La désignation du dossier (est-il celui du cabinet ?), puis — s'il l'est — les dossiers du même cabinet que le compte lit et
 * les identités des fiches liées, chacun en entier. Ne rejette jamais. Le drapeau baissé : hors du dossier du cabinet, sans lire.
 */
export async function lireCeQueLesFichesLieesDemandent(dossierId: string): Promise<LectureDesFichesLiees> {
  if (!FICHES_LIEES_PREVUES) return { etat: 'horsDuDossierDuCabinet' }
  const designation = await lireLaDesignationDuDossier(dossierId)
  if (designation.etat !== 'lue') return { etat: 'illisible', motif: designation.motif }
  if (designation.dossierActuel !== dossierId) return { etat: 'horsDuDossierDuCabinet' }
  const [dossiers, identites] = await Promise.all([lireLesDossiersDuCabinet(designation.cabinetId), lireLesIdentitesDesFichesLiees(dossierId)])
  if (dossiers.etat !== 'lue') return dossiers
  if (identites.etat !== 'lue') return identites
  return { etat: 'lue', dossierDuCabinetId: dossierId, dossiers: dossiers.dossiers, identites: identites.identites }
}

async function lireLesDossiersDuCabinet(
  cabinetId: string,
): Promise<{ etat: 'lue'; dossiers: DossierDuCabinetLu[] } | { etat: 'illisible'; motif: string }> {
  try {
    const lu = await lireTout<DossierDuCabinetLu>((debut, fin) =>
      supabase.from('dossiers').select('id, nom, denomination_imprimee, adresse, siret', { count: 'exact' }).eq('cabinet_id', cabinetId).order('id').range(debut, fin),
    )
    if (!lu.complete) return { etat: 'illisible', motif: lu.motif ?? 'la lecture des dossiers est incomplète' }
    return { etat: 'lue', dossiers: lu.lignes }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'les dossiers du cabinet n’ont pas pu être lus') }
  }
}
