import { CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE } from './contrePassationDesEcrituresLibres'
import { ECRITURES_LIBRES_PREVUES } from './ecritureLibre'
import { colonnesDesEcrituresLibres, ecritureLibreDeLaLigne, type LectureDesEcrituresLibres } from './ecrituresLibresVue'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { equipeNommable, type MembreLu } from './ouverturesAttestees'
import { supabase } from './supabase'
import type { EcritureLibreDeLEtat } from './ecrituresLibresDesExports'
import type { CitationDUneEcritureLibre, CitationsDesEcrituresLibres } from './pieceCiteeParUneEcritureLibre'

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

// LES PIÈCES QUE LES ÉCRITURES LIBRES CITENT (ELQ8Q1-Q1 (A), 25/11/2026), lues pour que Justificatifs et la fiche d'une pièce disent
// AVANT le clic qu'une pièce citée ne se supprime pas (lib/pieceCiteeParUneEcritureLibre.ts). Une lecture À PART, plus courte que
// celle des écrans de l'onglet Écritures : la référence et la pièce citée seulement — ni libellé, ni motif, ni lignes, ni auteurs,
// que la règle n'a pas à connaître. Toutes les écritures du dossier qui citent une pièce, quel que soit leur exercice (une écriture
// d'un exercice validé la garde aussi). Puis les exercices validés du dossier, pour dire laquelle est FIGÉE — son exercice au plus
// tard le dernier validé, la frontière de `frontiere_validation` — : sa citation ne se retire plus, et la phrase ne propose pas de
// la retirer (relecture adverse du 25/11/2026). Par `lireTout`, tri total terminé par la clé primaire ; elle ne rejette jamais :
// l'une ou l'autre lue en partie, refusée, levée ou d'une autre forme, `illisibles` avec son motif — et alors aucune pièce n'est
// dite citée.

/** Les pièces citées par les écritures libres d'un dossier ; ne rejette jamais. */
export function lireLesCitationsDesEcrituresLibres(dossierId: string): Promise<CitationsDesEcrituresLibres> {
  return lireLesCitationsDesEcrituresLibresSelon(dossierId, ECRITURES_LIBRES_PREVUES)
}

/** La même lecture, selon que la table est en base : les deux états du drapeau, que les tests jouent. */
export async function lireLesCitationsDesEcrituresLibresSelon(dossierId: string, prevues: boolean): Promise<CitationsDesEcrituresLibres> {
  if (!prevues) return { dossierId, etat: 'absentes' }
  try {
    const [lecture, validations] = await Promise.all([
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('ecritures_libres').select('id, dossier_id, exercice, numero, piece_citee_id', { count: 'exact' })
          .eq('dossier_id', dossierId).not('piece_citee_id', 'is', null)
          .order('exercice').order('numero').order('id').range(debut, fin),
      ),
      lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('exercices_valides').select('dossier_id, annee', { count: 'exact' })
          .eq('dossier_id', dossierId).order('dossier_id').order('annee').range(debut, fin),
      ),
    ])
    if (!lecture.complete) return { dossierId, etat: 'illisibles', motif: lecture.motif ?? 'lecture incomplète' }
    if (!validations.complete) {
      return { dossierId, etat: 'illisibles', motif: `les exercices validés : ${validations.motif ?? 'lecture incomplète'}` }
    }
    let derniereValidee: number | null = null
    for (const v of validations.lignes) {
      if (v.dossier_id !== dossierId || !Number.isInteger(v.annee)) {
        return { dossierId, etat: 'illisibles', motif: 'un exercice validé n’a pas la forme que la base écrit' }
      }
      derniereValidee = Math.max(derniereValidee ?? (v.annee as number), v.annee as number)
    }
    const citations: CitationDUneEcritureLibre[] = []
    for (const l of lecture.lignes) {
      const { id, dossier_id: dossier, exercice, numero, piece_citee_id: piece } = l
      if (typeof id !== 'string' || id === '' || dossier !== dossierId || !Number.isInteger(exercice) || !Number.isInteger(numero)
        || (numero as number) < 1 || typeof piece !== 'string' || piece === '') {
        return { dossierId, etat: 'illisibles', motif: 'une écriture n’a pas la forme que la base écrit' }
      }
      citations.push({
        exercice: exercice as number, numero: numero as number, piece_citee_id: piece,
        figee: derniereValidee !== null && (exercice as number) <= derniereValidee,
      })
    }
    return { dossierId, etat: 'lues', citations }
  } catch (e) {
    return { dossierId, etat: 'illisibles', motif: messageErreur(e, 'la lecture a échoué') }
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
