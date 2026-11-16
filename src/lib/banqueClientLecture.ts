import { useEffect, useState } from 'react'
import { COLONNES_DES_COMPTES_DU_CLIENT, type ComptesDuClient, type CompteDuClient } from './banqueClientParCompte'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesDroitsVentes } from './espaceVentes'
import { lireTout, type LectureComplete } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { ControleDeLAccueil } from './soldeDeLAccueil'
import { supabase } from './supabase'

// CE QUE « MA BANQUE » ET LE SOLDE DE L'ACCUEIL LISENT DES RELEVÉS (espace client, étape P9 ; le solde de l'accueil, demande
// du cabinet du 16/11/2026) : les contrôles des relevés du dossier et, le drapeau `COMPTES_BANCAIRES_PREVUS` levé, ses comptes
// bancaires — écrits une fois, pour que la page et l'accueil disent le même solde au même moment (le patron de
// `lib/echeancierClientLecture.ts`). Rien ne s'écrit.

/** Un contrôle de relevé, tel que le client le lit : le solde final, sa cohérence et sa période ; son compte, le drapeau levé. */
export type ControleDuClient = ControleDeLAccueil

/**
 * Les contrôles des relevés du dossier, EN ENTIER (tri total par la clé primaire), leur drapeau rendu tel quel à l'appelant,
 * qui le dit. Le compte de chaque relevé n'est demandé que `parCompte` : avant la migration `comptes_bancaires`, la colonne
 * n'existe pas, et la nommer ferait échouer toute la lecture.
 */
export async function lireLesControlesDuClient(dossierId: string, parCompte: boolean): Promise<LectureComplete<ControleDuClient>> {
  const controles = await lireTout<ControleDuClient>((debut, fin) =>
    // Deux chaînes littérales, deux requêtes : supabase-js lit le type de chacune.
    parCompte
      ? supabase.from('controles_releves_bancaires').select('id, solde_final, coherent, periode_fin, created_at, compte_bancaire_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin)
      : supabase.from('controles_releves_bancaires').select('id, solde_final, coherent, periode_fin, created_at', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
  )
  // Lue en partie, la lecture garde son motif : `soldeAuReleve` se tait, et l'écran le dit.
  return controles.complete ? controles : { ...controles, motif: controles.motif ?? 'les relevés contrôlés n’ont pas été lus en entier' }
}

/**
 * Les comptes bancaires du dossier (MCB7), les colonnes que l'écran montre et rien de plus ; ne rejette jamais — une requête
 * qui lève, ou une lecture partielle, rendent `illisible`.
 */
export async function lireLesComptesDuClient(dossierId: string): Promise<ComptesDuClient> {
  try {
    const lecture = await lireTout<CompteDuClient>((debut, fin) =>
      supabase.from('comptes_bancaires').select(COLONNES_DES_COMPTES_DU_CLIENT, { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    )
    return lecture.complete ? { etat: 'lus', comptes: lecture.lignes } : { etat: 'illisible', motif: lecture.motif ?? 'lecture incomplète' }
  } catch (erreur) {
    return { etat: 'illisible', motif: messageErreur(erreur, 'lecture impossible') }
  }
}

/**
 * Ce que l'accueil lit pour le solde : la case « Banque » relue À LA BASE dans la même vague (une case retirée depuis la
 * connexion ferait lire des relevés que la RLS rend VIDES, sans erreur — l'accueil dirait « aucun relevé » d'un compte qui
 * en a), les contrôles et, le drapeau levé, les comptes.
 */
export type LectureDuSolde =
  | { etat: 'echec'; motif: string }
  | { etat: 'sans_banque' }
  | { etat: 'lu'; controles: LectureComplete<ControleDuClient>; comptes: ComptesDuClient }

/** Lit le solde de l'accueil. Ne rejette jamais : une requête qui lève tombe du côté signalé. */
export async function lireLeSoldeDuClient(dossierId: string): Promise<LectureDuSolde> {
  // Lu une fois par lecture : le drapeau décide de toute la vague.
  const parCompte = COMPTES_BANCAIRES_PREVUS
  try {
    const [droits, controles, comptes] = await Promise.all([
      lireLesDroitsVentes(supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles')),
      lireLesControlesDuClient(dossierId, parCompte),
      parCompte ? lireLesComptesDuClient(dossierId) : Promise.resolve<ComptesDuClient>({ etat: 'sans_objet' }),
    ])
    if (droits.motif !== null) return { etat: 'echec', motif: `ton accès à ta banque n’a pas pu être vérifié (${droits.motif})` }
    if (!droits.droits.banque) return { etat: 'sans_banque' }
    return { etat: 'lu', controles, comptes }
  } catch (erreur) {
    return { etat: 'echec', motif: messageErreur(erreur, 'ta banque n’a pas pu être lue') }
  }
}

/**
 * La lecture du solde de la société `dossierId`, ou `null` tant qu'elle n'est pas revenue. Gardée avec la société pour
 * laquelle elle a été faite : un client à plusieurs sociétés ne voit jamais le solde de l'une sous l'autre.
 */
export function useSoldeDuClient(dossierId: string): LectureDuSolde | null {
  const [lue, setLue] = useState<{ dossierId: string; lecture: LectureDuSolde } | null>(null)

  useEffect(() => {
    let annule = false
    lireLeSoldeDuClient(dossierId).then((lecture) => { if (!annule) setLue({ dossierId, lecture }) })
    return () => { annule = true }
  }, [dossierId])

  return lue !== null && lue.dossierId === dossierId ? lue.lecture : null
}
