import { useEffect, useState } from 'react'
import { DOSSIER_DU_CABINET_PREVU } from './dossierDuCabinet'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'

// LE DOSSIER DU CABINET, LU POUR L'ÉCRAN (ligne 47, lot LM2 ; la base : LM1, migration `dossier_du_cabinet`). Ce module LIT
// et ÉCRIT ; ce qu'on en dit vit dans lib/dossierDuCabinet.ts (pur). Rien ne se lit ni ne s'écrit tant que
// `DOSSIER_DU_CABINET_PREVU` est baissé : la colonne `cabinets.dossier_du_cabinet` n'existe pas encore, et la nommer ferait
// échouer chaque lecture — la liste des dossiers dirait alors une panne à chaque ouverture.
//
// Aucune lecture ne REJETTE : une panne tombe du côté signalé, avec son motif, et l'écran qui la porte n'en dit que ce qu'elle
// tait. Une désignation non lue ne se prend jamais pour « aucune » : le dossier resterait compté parmi les clients sans que
// personne le sache, et la suppression viderait le stockage d'un dossier que la base refuserait ensuite d'effacer.

/** Les dossiers que les cabinets lisibles ont désignés comme les leurs (la policy `cabinets_select`). */
export type LectureDesDesignations =
  | { etat: 'lue'; designes: ReadonlySet<string> }
  | { etat: 'illisible'; motif: string }

const AUCUNE: LectureDesDesignations = { etat: 'lue', designes: new Set<string>() }

/**
 * Les dossiers désignés de tous les cabinets que le compte lit — le sien ; tous pour le super-administrateur. Lue en ENTIER
 * (`lireTout`, tri total sur la clé) : une lecture partielle est illisible, jamais une liste plus courte. Le drapeau baissé,
 * aucune : rien n'est désigné tant que la colonne n'existe pas.
 */
export async function lireLesDossiersDesCabinets(): Promise<LectureDesDesignations> {
  if (!DOSSIER_DU_CABINET_PREVU) return AUCUNE
  try {
    const lu = await lireTout<{ id: string; dossier_du_cabinet: string | null }>((debut, fin) =>
      supabase.from('cabinets').select('id, dossier_du_cabinet', { count: 'exact' }).order('id').range(debut, fin),
    )
    if (!lu.complete) return { etat: 'illisible', motif: lu.motif ?? 'la lecture des cabinets est incomplète' }
    const designes = new Set<string>()
    for (const c of lu.lignes) if (typeof c.dossier_du_cabinet === 'string') designes.add(c.dossier_du_cabinet)
    return { etat: 'lue', designes }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'les cabinets n’ont pas pu être lus') }
  }
}

/** Ce que la carte de l'onglet Informations sait de la désignation, pour un dossier. */
export type LectureDeLaDesignation =
  | {
    etat: 'lue'
    dossierId: string
    cabinetId: string
    /** Le dossier désigné aujourd'hui par le cabinet du dossier, ou `null`. */
    dossierActuel: string | null
    /** Son nom, s'il se lit ; `null` sinon (un membre qui n'y est pas assigné, ou aucun). */
    nomDeLActuel: string | null
    /** Le dossier désigné porte une facture validée ou reprise (tout statut sauf « brouillon »). */
    actuelPorteUneFactureValidee: boolean
    /** Ce dossier-ci a un accès client. */
    porteUnAccesClient: boolean
    /** Ce dossier-ci porte une facture validée au nom et pour le compte d'un client (`mandataire_nom` posé). */
    porteUneFactureEnMandataire: boolean
  }
  | { etat: 'illisible'; dossierId: string; motif: string }

/** Un compte de lignes, lu avec son erreur : `null` si la base ne l'a pas rendu. */
async function compte(requete: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | { motif: string }> {
  const { count, error } = await requete
  if (error) return { motif: messageErreur(error, 'un compte n’a pas pu être lu') }
  if (typeof count !== 'number') return { motif: 'la base n’a pas rendu de compte' }
  return count
}

/**
 * La désignation vue d'un dossier : son cabinet, le dossier que ce cabinet a désigné, et ce que `designer_dossier_du_cabinet`
 * jugerait — chaque compte comme la fonction le lit. Ne rejette jamais.
 */
export async function lireLaDesignationDuDossier(dossierId: string): Promise<LectureDeLaDesignation> {
  const illisible = (motif: string): LectureDeLaDesignation => ({ etat: 'illisible', dossierId, motif })
  try {
    const dossier = await supabase.from('dossiers').select('cabinet_id').eq('id', dossierId).maybeSingle()
    if (dossier.error) return illisible(messageErreur(dossier.error, 'le dossier n’a pas pu être lu'))
    const cabinetId = (dossier.data as { cabinet_id?: unknown } | null)?.cabinet_id
    if (typeof cabinetId !== 'string' || cabinetId === '') return illisible('le cabinet du dossier n’a pas été rendu')
    const cabinet = await supabase.from('cabinets').select('dossier_du_cabinet').eq('id', cabinetId).maybeSingle()
    if (cabinet.error) return illisible(messageErreur(cabinet.error, 'le cabinet n’a pas pu être lu'))
    if (!cabinet.data) return illisible('le cabinet du dossier n’a pas été trouvé')
    const actuel = (cabinet.data as { dossier_du_cabinet?: unknown }).dossier_du_cabinet
    // Une colonne absente n'est pas une colonne nulle : on ne sait pas ce que le cabinet a désigné.
    if (actuel !== null && typeof actuel !== 'string') return illisible('la désignation du cabinet n’a pas été rendue')

    let nomDeLActuel: string | null = null
    let actuelPorteUneFactureValidee = false
    if (actuel !== null) {
      if (actuel !== dossierId) {
        const nom = await supabase.from('dossiers').select('nom').eq('id', actuel).maybeSingle()
        if (nom.error) return illisible(messageErreur(nom.error, 'le dossier du cabinet n’a pas pu être lu'))
        const lu = (nom.data as { nom?: unknown } | null)?.nom
        nomDeLActuel = typeof lu === 'string' && lu.trim() !== '' ? lu : null
      }
      const validees = await compte(supabase.from('factures_emises').select('id', { count: 'exact', head: true })
        .eq('dossier_id', actuel).neq('statut', 'brouillon'))
      if (typeof validees !== 'number') return illisible(validees.motif)
      actuelPorteUneFactureValidee = validees > 0
    }
    const acces = await compte(supabase.from('memberships').select('id', { count: 'exact', head: true }).eq('dossier_id', dossierId))
    if (typeof acces !== 'number') return illisible(acces.motif)
    const enMandataire = await compte(supabase.from('factures_emises').select('id', { count: 'exact', head: true })
      .eq('dossier_id', dossierId).neq('statut', 'brouillon').not('mandataire_nom', 'is', null))
    if (typeof enMandataire !== 'number') return illisible(enMandataire.motif)
    return {
      etat: 'lue', dossierId, cabinetId, dossierActuel: actuel, nomDeLActuel, actuelPorteUneFactureValidee,
      porteUnAccesClient: acces > 0, porteUneFactureEnMandataire: enMandataire > 0,
    }
  } catch (e) {
    return illisible(messageErreur(e, 'la désignation n’a pas pu être lue'))
  }
}

/**
 * La désignation d'un dossier, lue pour l'écran et gardée AVEC le dossier (et le compteur de relecture) pour lequel elle a été
 * lue : un autre repart de `null` (« Chargement… »), et une réponse tardive ne s'inscrit pas. `null` aussi, et rien de lu,
 * tant que le drapeau est baissé.
 */
export function useDesignationDuDossier(dossierId: string, relecture: number): LectureDeLaDesignation | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDeLaDesignation } | null>(null)
  const cle = `${dossierId}#${relecture}`
  useEffect(() => {
    if (!DOSSIER_DU_CABINET_PREVU) return
    let annule = false
    void lireLaDesignationDuDossier(dossierId).then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, relecture])
  if (!DOSSIER_DU_CABINET_PREVU) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}

/** L'issue d'une désignation : la base l'a écrite, ou l'a refusée avec ses mots. */
export type IssueDeLaDesignation = { ok: true } | { ok: false; message: string }

/** Désigne `dossierId` comme le dossier du cabinet, ou retire la désignation (`null`), par la fonction de la base seule. */
export async function designerLeDossierDuCabinet(cabinetId: string, dossierId: string | null): Promise<IssueDeLaDesignation> {
  try {
    const { error } = await supabase.rpc('designer_dossier_du_cabinet', { p_cabinet_id: cabinetId, p_dossier_id: dossierId })
    if (error) return { ok: false, message: messageErreur(error, 'la base a refusé la désignation') }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: messageErreur(e, 'la désignation a échoué') }
  }
}

/**
 * Le dossier est-il celui d'un cabinet ? Lu AVANT toute suppression (lib/suppressionDossier.ts) : LÈVE si la base ne le dit
 * pas — mieux vaut ne rien supprimer que vider le stockage d'un dossier dont la ligne se refusera ensuite. Faux sans lire,
 * le drapeau baissé.
 */
export async function estDesigneCommeDossierDuCabinet(dossierId: string): Promise<boolean> {
  if (!DOSSIER_DU_CABINET_PREVU) return false
  const { data, error } = await supabase.from('cabinets').select('id').eq('dossier_du_cabinet', dossierId).maybeSingle()
  if (error) {
    throw new Error(`La désignation du dossier du cabinet n’a pas pu être lue : rien n’a été supprimé (${messageErreur(error, 'lecture refusée')}).`)
  }
  return data !== null
}
