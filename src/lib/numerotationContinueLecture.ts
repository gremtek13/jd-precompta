// CE QUE LA CARTE « NUMÉROTATION DES FACTURES » LIT ET ÉCRIT (ligne 51.5, étape A9b ; la règle est dans
// lib/numerotationContinueCarte.ts). Appelés seulement le drapeau `NUMEROTATION_CONTINUE_PREVUE` levé : la migration d'A9a n'est
// pas en base tant qu'il est baissé, et lire ses tables ferait échouer chaque appel.
//
// La lecture se fait dans la même vague : l'état des quatre séries pour l'exercice (`etat_de_la_numerotation`, quatre lignes,
// jugées une à une), puis, EN ENTIER (`lireTout`, tri total terminé par la clé primaire), les paroles du cabinet
// (`continuite_des_series`) et les modèles posés (`modeles_numerotation`). Elle ne rejette jamais : un refus, une forme
// inattendue ou une requête qui lève rendent une lecture ILLISIBLE, avec son motif — et la carte n'offre alors aucun geste.
// La réponse porte le dossier et l'exercice lus : un écran qui en a changé entre-temps ne la prend pas pour la sienne.
// Chaque geste passe la fonction SQL seule, et rend une issue ; il ne lève jamais.

import { supabase } from './supabase'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import {
  modelePose, paroleLue, seriesLues,
  type ModelePose, type ParametresDeLaFin, type ParametresDeLaPose, type ParametresDesTrous, type ParoleLue, type SerieLue,
} from './numerotationContinueCarte'

export type LectureDeLaNumerotation =
  | { dossierId: string; annee: number; etat: 'lue'; series: SerieLue[]; paroles: ParoleLue[]; modeles: ModelePose[] }
  | { dossierId: string; annee: number; etat: 'illisible'; motif: string }

async function lireEnEntier<T>(lire: () => Promise<LectureComplete<T>>): Promise<LectureComplete<T>> {
  try {
    return await lire()
  } catch (erreur) {
    return { lignes: [], complete: false, motif: messageErreur(erreur, 'lecture interrompue') }
  }
}

export async function lireLaNumerotation(dossierId: string, annee: number): Promise<LectureDeLaNumerotation> {
  const illisible = (motif: string): LectureDeLaNumerotation => ({ dossierId, annee, etat: 'illisible', motif })
  try {
    const [etat, paroles, modeles] = await Promise.all([
      supabase.rpc('etat_de_la_numerotation', { p_dossier_id: dossierId, p_annee: annee }),
      lireEnEntier(() => lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('continuite_des_series')
          .select('id, modele, annuel, annee, geste, premier, dernier, motif, pose_le', { count: 'exact' })
          .eq('dossier_id', dossierId).order('pose_le').order('id').range(debut, fin),
      )),
      lireEnEntier(() => lireTout<Record<string, unknown>>((debut, fin) =>
        supabase.from('modeles_numerotation')
          .select('id, nature, emetteur, modele, annuel, depuis, premier_numero, pose_le', { count: 'exact' })
          .eq('dossier_id', dossierId).order('pose_le').order('id').range(debut, fin),
      )),
    ])
    if (etat.error) return illisible(`l’état des séries : ${messageErreur(etat.error, 'lecture refusée')}`)
    const series = seriesLues(etat.data)
    if (series === null) return illisible('l’état des séries : la base a rendu des lignes d’une autre forme.')
    if (!paroles.complete) return illisible(`les fins confirmées et les trous levés : ${paroles.motif ?? 'lecture incomplète'}`)
    if (!modeles.complete) return illisible(`les modèles posés : ${modeles.motif ?? 'lecture incomplète'}`)
    const parolesLues = paroles.lignes.map(paroleLue)
    if (parolesLues.some((p) => p === null)) return illisible('les fins confirmées et les trous levés : une ligne lue ne se croit pas.')
    const modelesLus = modeles.lignes.map(modelePose)
    if (modelesLus.some((m) => m === null)) return illisible('les modèles posés : une ligne lue ne se croit pas.')
    return {
      dossierId, annee, etat: 'lue', series, paroles: parolesLues as ParoleLue[], modeles: modelesLus as ModelePose[],
    }
  } catch (erreur) {
    return illisible(messageErreur(erreur, 'lecture interrompue'))
  }
}

export type Issue = { ok: true } | { ok: false; message: string }

const REPLI_DU_GESTE = 'refus de la base.'

/** Pose un modèle de numéro (`fixer_modele_numerotation`, le chef du cabinet seul). */
export async function poserLeModele(parametres: ParametresDeLaPose): Promise<Issue> {
  try {
    const { error } = await supabase.rpc('fixer_modele_numerotation', parametres)
    return error ? { ok: false, message: messageErreur(error, REPLI_DU_GESTE) } : { ok: true }
  } catch (erreur) {
    return { ok: false, message: messageErreur(erreur, REPLI_DU_GESTE) }
  }
}

/** Confirme la fin d'une série reprise (`confirmer_fin_de_serie`, le chef du cabinet seul). */
export async function confirmerLaFin(parametres: ParametresDeLaFin): Promise<Issue> {
  try {
    const { error } = await supabase.rpc('confirmer_fin_de_serie', parametres)
    return error ? { ok: false, message: messageErreur(error, REPLI_DU_GESTE) } : { ok: true }
  } catch (erreur) {
    return { ok: false, message: messageErreur(erreur, REPLI_DU_GESTE) }
  }
}

/** Lève, motif écrit, des trous d'une série (`lever_trous_de_numerotation`, le chef du cabinet seul). */
export async function leverLesTrous(parametres: ParametresDesTrous): Promise<Issue> {
  try {
    const { error } = await supabase.rpc('lever_trous_de_numerotation', parametres)
    return error ? { ok: false, message: messageErreur(error, REPLI_DU_GESTE) } : { ok: true }
  } catch (erreur) {
    return { ok: false, message: messageErreur(erreur, REPLI_DU_GESTE) }
  }
}
