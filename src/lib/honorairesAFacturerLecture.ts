import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { HONORAIRES_FACTURES_PREVUS, type AvoirRepris, type LettreAFacturer, type LienDHonoraires } from './honorairesAFacturer'
import type { DossierNomme } from './honorairesAFacturerVue'

// « À FACTURER », LU ET ÉCRIT POUR L'ÉCRAN (ligne 47, LM7). Rien ne se lit tant que `HONORAIRES_FACTURES_PREVUS` est baissé :
// la production n'a ni la table ni la fonction. Les lettres, les liens, les avoirs repris et les dossiers du cabinet se
// lisent EN ENTIER ou se disent illisibles, et la lecture ne rejette jamais ; les factures sont celles que l'onglet a lues.
// Le geste appelle `facturer_honoraires` seule, qui juge, crée le brouillon et pose ses liens, tout ou rien. Récit :
// HISTORIQUE.md, « 11/11/2026 — LM7 : « À FACTURER », À L'ÉCRAN ».

export type LectureDesHonoraires =
  | { etat: 'lue'; dossierId: string; lettres: LettreAFacturer[]; liens: LienDHonoraires[]; avoirsRepris: AvoirRepris[]; dossiers: DossierNomme[] }
  | { etat: 'illisible'; dossierId: string; motif: string }

// Une seule chaîne littérale : le client typé de Supabase en lit les colonnes.
const COLONNES_DES_LETTRES = 'id, remplace_id, dossier_client_id, date_effet, fin_initiale, reconduction_tacite, proposee_le, acceptee_le, refusee_le, retiree_le, fin_au, honoraires, premier_exercice'

export async function lireLesHonorairesAFacturer(dossierId: string, cabinetId: string): Promise<LectureDesHonoraires> {
  const illisible = (motif: string): LectureDesHonoraires => ({ etat: 'illisible', dossierId, motif })
  try {
    const [lettres, liens, avoirsRepris, dossiers] = await Promise.all([
      lireTout<LettreAFacturer>((debut, fin) => supabase.from('lettres_de_mission').select(COLONNES_DES_LETTRES, { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<LienDHonoraires>((debut, fin) => supabase.from('honoraires_factures')
        .select('facture_id, lettre_id, ligne, periode_debut, periode_fin, facturation', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      // Les avoirs repris de l'ancien logiciel qui créditent une facture (A8a) : la base les compte dans une facture créditée
      // en entier. Lus tous, l'appelant ne retient que ceux qui citent une facture.
      lireTout<{ facture_id: string; origine_id: string | null }>((debut, fin) => supabase.from('factures_importees')
        .select('facture_id, origine_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('facture_id').range(debut, fin)),
      lireTout<DossierNomme>((debut, fin) => supabase.from('dossiers').select('id, nom', { count: 'exact' })
        .eq('cabinet_id', cabinetId).neq('id', dossierId).order('nom').order('id').range(debut, fin)),
    ])
    const partielle = [lettres, liens, avoirsRepris, dossiers].find((l) => !l.complete)
    if (partielle) return illisible(partielle.motif ?? 'une lecture est restée partielle')
    return {
      etat: 'lue', dossierId, lettres: lettres.lignes, liens: liens.lignes, dossiers: dossiers.lignes,
      avoirsRepris: avoirsRepris.lignes.flatMap((a) => (a.origine_id === null ? [] : [{ facture_id: a.facture_id, origine_id: a.origine_id }])),
    }
  } catch (e) {
    return illisible(messageErreur(e, 'les honoraires à facturer n’ont pas pu être lus'))
  }
}

/** La lecture gardée AVEC le dossier, le cabinet et le compteur pour lesquels elle a été faite ; `null` avant son retour. */
export function useHonorairesAFacturer(dossierId: string, cabinetId: string | null, relecture: number): LectureDesHonoraires | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDesHonoraires } | null>(null)
  const cle = `${dossierId}#${cabinetId}#${relecture}`
  useEffect(() => {
    if (!HONORAIRES_FACTURES_PREVUS || cabinetId === null) return
    let annule = false
    void lireLesHonorairesAFacturer(dossierId, cabinetId)
      .then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${cabinetId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, cabinetId, relecture])
  if (!HONORAIRES_FACTURES_PREVUS || cabinetId === null) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}

export type IssueDeLaFacturation = { ok: true; factureId: string } | { ok: false; message: string }

/** Le clic « Facturer » : `facturer_honoraires` seule, sans autre clé de facture que les siennes. Ne rejette jamais. */
export async function facturerLesHonoraires(
  dossierId: string,
  elements: readonly { lettre_id: string; ligne: number; periode_debut: string; periode_fin: string }[],
  taux: number,
): Promise<IssueDeLaFacturation> {
  try {
    const { data, error } = await supabase.rpc('facturer_honoraires', {
      p_dossier_id: dossierId,
      p_elements: elements.map((e) => ({ lettre_id: e.lettre_id, ligne: e.ligne, periode_debut: e.periode_debut, periode_fin: e.periode_fin })),
      p_taux_tva: taux,
      p_facture: null,
    })
    if (error) return { ok: false, message: messageErreur(error, 'la base a refusé la facture d’honoraires') }
    if (typeof data !== 'string') return { ok: false, message: 'La base n’a pas rendu le brouillon créé : relis la liste des factures avant de facturer de nouveau.' }
    return { ok: true, factureId: data }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'la facture d’honoraires n’a pas pu être créée') }
  }
}
