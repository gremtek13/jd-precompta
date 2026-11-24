import { CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE } from './contrePassationDesEcrituresLibres'
import { ECRITURES_LIBRES_PREVUES } from './ecritureLibre'
import { colonnesDesEcrituresLibres, ecritureLibreDeLaLigne, type LectureDesEcrituresLibres } from './ecrituresLibresVue'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { equipeNommable, type MembreLu } from './ouverturesAttestees'
import { supabase } from './supabase'
import type { EcritureLibreDeLEtat } from './ecrituresLibresDesExports'

// LES ÉCRITURES LIBRES D'UN DOSSIER, LUES POUR LES ÉCRANS DU CABINET (EL5 ; conception 54, § 4 ; modèle : lib/caisseLecture.ts).
// La policy `ecritures_libres_lecture` (`admin_du_dossier`) ouvre au chef, au membre assigné et au super-administrateur toutes
// les écritures du dossier, leurs lignes (la colonne jsonb `lignes`) et leur motif ; le client n'en lit rien.
//
// Par `lireTout`, tri TOTAL terminé par la clé primaire et compte annoncé. Elle ne REJETTE jamais : une requête qui lève, une
// lecture partielle ou une ligne dont la forme n'est pas celle que la base écrit rendent `illisibles`, avec leur motif — jamais
// une liste vide, qui ferait calculer une 2035 sans les écritures de l'expert. Elle se rend AVEC l'identifiant du dossier lu.
// Puis les adresses des auteurs, de `cabinet_admins`, sous la session de qui regarde (le patron de P1TQ2Q1-Q1) : une adresse
// qui ne revient pas se dit « le cabinet », et leur lecture ratée ne retient rien.
//
// LE DRAPEAU BAISSÉ (`ECRITURES_LIBRES_PREVUES`), ELLE NE LIT RIEN : la table n'est pas en base (PostgREST : relation inconnue).
// Elle rend l'absence, sans appel au réseau.

/** Les écritures libres d'un dossier, lues en entier, et l'adresse de leurs auteurs ; ne rejette jamais. */
export function lireLesEcrituresLibres(dossierId: string): Promise<LectureDesEcrituresLibres> {
  return lireLesEcrituresLibresSelon(dossierId, ECRITURES_LIBRES_PREVUES)
}

/** La même lecture, selon que la table est en base, et la colonne de la contre-passation (EL7) : les états des deux drapeaux,
 *  que les tests jouent. */
export async function lireLesEcrituresLibresSelon(
  dossierId: string, prevues: boolean, contrePassation: boolean = CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE,
): Promise<LectureDesEcrituresLibres> {
  if (!prevues) return { dossierId, etat: 'absentes' }
  let ecritures: EcritureLibreDeLEtat[]
  try {
    const lecture = await lireTout<unknown>((debut, fin) =>
      supabase.from('ecritures_libres').select(colonnesDesEcrituresLibres(contrePassation), { count: 'exact' })
        .eq('dossier_id', dossierId).order('exercice').order('numero').order('id').range(debut, fin),
    )
    if (!lecture.complete) return { dossierId, etat: 'illisibles', motif: lecture.motif ?? 'lecture incomplète' }
    const relues = lecture.lignes.map((l) => ecritureLibreDeLaLigne(l, dossierId))
    if (relues.some((e) => e === null)) {
      return { dossierId, etat: 'illisibles', motif: 'une écriture n’a pas la forme que la base écrit' }
    }
    ecritures = relues as EcritureLibreDeLEtat[]
  } catch (e) {
    return { dossierId, etat: 'illisibles', motif: messageErreur(e, 'la lecture a échoué') }
  }
  const comptes = [...new Set(ecritures.flatMap((e) => [e.cree_par, e.modifie_par]).filter((c): c is string => c !== null))].sort()
  if (comptes.length === 0) return { dossierId, etat: 'lues', ecritures, auteurs: new Map(), motifDesAuteurs: null }
  try {
    const equipe = await lireTout<MembreLu>((debut, fin) =>
      supabase.from('cabinet_admins').select('user_id, email', { count: 'exact' })
        .in('user_id', comptes).order('user_id').range(debut, fin),
    )
    return {
      dossierId, etat: 'lues', ecritures, auteurs: equipeNommable(equipe.lignes),
      motifDesAuteurs: equipe.complete ? null : `l’équipe : ${equipe.motif ?? 'lecture incomplète'}`,
    }
  } catch (e) {
    return { dossierId, etat: 'lues', ecritures, auteurs: new Map(), motifDesAuteurs: `l’équipe : ${messageErreur(e, 'la lecture a échoué')}` }
  }
}

// LES DEUX GESTES (EL5), par les deux fonctions de la base SEULES (aucune policy d'écriture sur la table) : chacun rend le refus
// de la base, en clair (`messageErreur`), ou nul quand elle a écrit — jamais une écriture supposée réussie. L'écran les appelle
// sous son verrou, après la confirmation, puis relit.

/** Passe ou remplace une écriture libre : `p_ecriture` et `p_ecritures` tels que le module les compose (EL1). */
export async function enregistrerEcritureLibre(
  dossierId: string, ecriture: unknown, ecritures: unknown, versionLue: number | null,
): Promise<string | null> {
  const { error } = await supabase.rpc('enregistrer_ecriture_libre', {
    p_dossier_id: dossierId, p_ecriture: ecriture, p_ecritures: ecritures, p_version_lue: versionLue,
  })
  return error ? messageErreur(error, 'raison inconnue') : null
}

/** Retire une écriture libre et ses lignes au brouillon, contre la version lue. */
export async function retirerEcritureLibre(id: string, versionLue: number): Promise<string | null> {
  const { error } = await supabase.rpc('retirer_ecriture_libre', { p_id: id, p_version_lue: versionLue })
  return error ? messageErreur(error, 'raison inconnue') : null
}

/** Contre-passe une écriture libre figée (EL7), contre la version lue : `p_contre_passation` et `p_ecritures` tels que le module
 *  les compose (lib/contrePassationDesEcrituresLibres.ts). Le refus de la base, en clair, ou nul quand elle a écrit. */
export async function contrePasserEcritureLibre(
  id: string, versionLue: number, contrePassation: unknown, ecritures: unknown,
): Promise<string | null> {
  const { error } = await supabase.rpc('contre_passer_ecriture_libre', {
    p_id: id, p_version_lue: versionLue, p_contre_passation: contrePassation, p_ecritures: ecritures,
  })
  return error ? messageErreur(error, 'raison inconnue') : null
}
