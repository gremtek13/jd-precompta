import { useEffect, useState } from 'react'
import type { CotisationDeLEcheancier, DossierDeLEcheancier } from './echeancierClient'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// CE QUE « MON ÉCHÉANCIER » ET LA CARTE DE L'ACCUEIL LISENT (ligne 51.5, étape C1) : une lecture, écrite une fois — la page et
// la carte disent la même chose au même moment (le patron de `lib/piecesJointesEcarteesClientLecture.ts`).
//
// Deux lectures : le statut de TVA et la périodicité du dossier (une ligne), et les échéances de cotisation du dossier, EN
// ENTIER (`lireTout`, tri total terminé par la clé primaire). Le montant appelé ne se DEMANDE qu'avec « Banque » : sans elle,
// la colonne ne quitte pas la base, et l'écran ne peut pas la montrer par mégarde. Rien ne s'écrit.
//
// La lecture ne rejette jamais : une requête qui lève tombe du côté signalé. Elle rend « lu » (tout lu), « lu en partie »
// (le dossier ou les cotisations manquent : l'écran le dit et ne dit jamais « aucune échéance »), ou « illisible » (ni l'un ni
// l'autre). Le crochet la GARDE avec la société et le droit pour lesquels elle a été faite, et reste nul tant qu'elle n'est pas
// revenue : un client à plusieurs sociétés ne voit jamais l'échéancier de l'une sous l'autre, ni un montant lu sous « Banque »
// après que la société affichée a changé.

export type LectureEcheancier =
  | { etat: 'lu'; dossier: DossierDeLEcheancier; cotisations: CotisationDeLEcheancier[]; motif: null }
  | { etat: 'partiel'; dossier: DossierDeLEcheancier | null; cotisations: CotisationDeLEcheancier[]; motif: string }
  | { etat: 'illisible'; motif: string }

// Chaîne pour chaîne : le compilateur confronte chaque colonne à son type.
export const COLONNES_SANS_MONTANT = 'id, echeance, previsionnel, paiement_personnel_le'
export const COLONNES_AVEC_MONTANT = 'id, echeance, previsionnel, paiement_personnel_le, montant_appele'

const PERIODICITES = new Set(['mensuelle', 'trimestrielle'])
const STATUTS = new Set(['redevable', 'franchise', 'exonere'])

// La ligne du dossier, ou le motif de son absence. Une forme inattendue (un statut hors de la liste fermée) ne se devine pas.
async function lireLeDossier(dossierId: string): Promise<{ dossier: DossierDeLEcheancier } | { motif: string }> {
  const { data, error } = await supabase.from('dossiers').select('id, statut_tva, tva_periodicite').eq('id', dossierId).maybeSingle()
  if (error) return { motif: messageErreur(error, 'le dossier n’a pas pu être lu') }
  const ligne = data as { id?: unknown; statut_tva?: unknown; tva_periodicite?: unknown } | null
  if (!ligne || ligne.id !== dossierId) return { motif: 'le dossier n’a pas été rendu' }
  const statut = ligne.statut_tva ?? null
  if ((statut !== null && !STATUTS.has(String(statut))) || !PERIODICITES.has(String(ligne.tva_periodicite))) {
    return { motif: 'le dossier a été rendu sous une forme inattendue' }
  }
  return { dossier: { statut_tva: statut as DossierDeLEcheancier['statut_tva'], tva_periodicite: ligne.tva_periodicite as DossierDeLEcheancier['tva_periodicite'] } }
}

/** Lit ce que l'échéancier compose. Ne rejette jamais. */
export async function lireLEcheancier(dossierId: string, avecMontants: boolean): Promise<LectureEcheancier> {
  try {
    const [lu, cotisations] = await Promise.all([
      lireLeDossier(dossierId),
      lireTout<CotisationDeLEcheancier>((debut, fin) => (avecMontants
        ? supabase.from('cotisations_declarees').select(COLONNES_AVEC_MONTANT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('echeance').order('id').range(debut, fin)
        : supabase.from('cotisations_declarees').select(COLONNES_SANS_MONTANT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('echeance').order('id').range(debut, fin)
      )),
    ])
    const dossier = 'dossier' in lu ? lu.dossier : null
    const motifs = ['motif' in lu ? lu.motif : null, cotisations.complete ? null : cotisations.motif].filter((m): m is string => !!m)
    if (dossier !== null && cotisations.complete) return { etat: 'lu', dossier, cotisations: cotisations.lignes, motif: null }
    if (dossier === null && cotisations.lignes.length === 0 && !cotisations.complete) return { etat: 'illisible', motif: motifs.join(' ; ') }
    return { etat: 'partiel', dossier, cotisations: cotisations.lignes, motif: motifs.join(' ; ') }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'la lecture a échoué') }
  }
}

/**
 * La lecture de l'échéancier de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue (et toujours sans société).
 * Gardée avec la société ET le droit aux montants pour lesquels elle a été faite.
 */
export function useEcheancierDuClient(dossierId: string | null, avecMontants: boolean): LectureEcheancier | null {
  const [lue, setLue] = useState<{ dossierId: string; avecMontants: boolean; lecture: LectureEcheancier } | null>(null)

  useEffect(() => {
    if (!dossierId) return
    let annule = false
    lireLEcheancier(dossierId, avecMontants).then((lecture) => { if (!annule) setLue({ dossierId, avecMontants, lecture }) })
    return () => { annule = true }
  }, [dossierId, avecMontants])

  return lue !== null && lue.dossierId === dossierId && lue.avecMontants === avecMontants ? lue.lecture : null
}
