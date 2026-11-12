import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { retirerFichiers } from './stockage'
import { preparerContenu } from './bornesStockage'
import { empreinteSha256 } from './logoDesFactures'
import { DEPOT_DES_HONORAIRES_PREVU, cheminDuDepot, type DepotLu } from './depotDesHonoraires'
import type { DossierLu, LettreDuClient, LienLu } from './depotDesHonorairesVue'
import { contenuDeLaFactureFigee, instantDeLaCopie, titreDeLaCopie } from './pdfFactureFigee'
import { pdfDesBlocs } from './pdfLettreDeMission'
import type { FactureEmise, FactureLigne } from './types'

// LE DÉPÔT DES HONORAIRES, LU ET ÉCRIT POUR L'ÉCRAN (ligne 47, LM8). Rien ne se lit tant que `DEPOT_DES_HONORAIRES_PREVU` est
// baissé : la production n'a ni la table ni les fonctions. Chaque lecture se fait EN ENTIER ou se dit illisible, et ne
// rejette jamais ; le geste tire le PDF des valeurs figées, le dépose dans le seau des pièces sous le dossier du client, puis
// appelle `deposer_honoraires_chez_le_client` seule, qui écrit la pièce et le dépôt ; sur un refus de la base, le fichier
// déposé se retire. Récit : HISTORIQUE.md, « 11/11/2026 — LM8 : LE DÉPÔT DES HONORAIRES, À L'ÉCRAN ».

/** Ce que la carte du dossier du cabinet lit, en entier. */
export type LectureDuDepot =
  | { etat: 'lue'; dossierId: string; depots: DepotLu[]; liens: LienLu[]; lettres: LettreDuClient[]; dossiers: DossierLu[] }
  | { etat: 'illisible'; dossierId: string; motif: string }

/** Une fonction qui rend une table, lue avec son compte : moins de lignes que le compte annoncé, c'est une lecture partielle. */
async function lireUneFonction(
  requete: PromiseLike<{ data: unknown; error: unknown; count: number | null }>, repli: string,
): Promise<{ lignes: unknown[] } | { motif: string }> {
  const { data, error, count } = await requete
  if (error) return { motif: messageErreur(error, repli) }
  if (!Array.isArray(data)) return { motif: 'la base n’a rendu aucune liste' }
  if (typeof count !== 'number') return { motif: 'la base n’a pas rendu de compte' }
  if (data.length < count) return { motif: `${data.length} ligne(s) lue(s) sur ${count}` }
  return { lignes: data }
}

export async function lireLeDepotDesHonoraires(dossierId: string, cabinetId: string): Promise<LectureDuDepot> {
  const illisible = (motif: string): LectureDuDepot => ({ etat: 'illisible', dossierId, motif })
  try {
    const [depots, liens, lettres, dossiers] = await Promise.all([
      lireUneFonction(supabase.rpc('depots_des_honoraires', { p_dossier_id: dossierId }, { count: 'exact' }),
        'les dépôts des honoraires n’ont pas pu être lus'),
      lireTout<LienLu>((debut, fin) => supabase.from('honoraires_factures').select('id, facture_id, lettre_id, cree_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<LettreDuClient>((debut, fin) => supabase.from('lettres_de_mission').select('id, dossier_client_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin)),
      lireTout<DossierLu>((debut, fin) => supabase.from('dossiers').select('id, nom', { count: 'exact' })
        .eq('cabinet_id', cabinetId).neq('id', dossierId).order('nom').order('id').range(debut, fin)),
    ])
    if ('motif' in depots) return illisible(depots.motif)
    const partielle = [liens, lettres, dossiers].find((l) => !l.complete)
    if (partielle) return illisible(partielle.motif ?? 'une lecture est restée partielle')
    return { etat: 'lue', dossierId, depots: depots.lignes as DepotLu[], liens: liens.lignes, lettres: lettres.lignes, dossiers: dossiers.lignes }
  } catch (e) {
    return illisible(messageErreur(e, 'les dépôts des honoraires n’ont pas pu être lus'))
  }
}

/** La lecture gardée AVEC le dossier, le cabinet et le compteur pour lesquels elle a été faite ; `null` avant son retour. */
export function useDepotDesHonoraires(dossierId: string, cabinetId: string | null, relecture: number): LectureDuDepot | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDuDepot } | null>(null)
  const cle = `${dossierId}#${cabinetId}#${relecture}`
  useEffect(() => {
    if (!DEPOT_DES_HONORAIRES_PREVU || cabinetId === null) return
    let annule = false
    void lireLeDepotDesHonoraires(dossierId, cabinetId)
      .then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${cabinetId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, cabinetId, relecture])
  if (!DEPOT_DES_HONORAIRES_PREVU || cabinetId === null) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}

export type IssueDuDepot = { ok: true; pieceId: string } | { ok: false; message: string }

/**
 * Le clic « Déposer chez le client ». La facture est celle que l'écran a lue ; ses lignes se relisent ici, en entier ; le PDF
 * se tire de leurs seules valeurs figées ; le fichier part sous le dossier du client ; la base juge et écrit. Ne rejette jamais.
 */
export async function deposerChezLeClient(p: {
  dossierId: string
  facture: FactureEmise
  numeroDeLOrigine: string | null
  dossierClientId: string
}): Promise<IssueDuDepot> {
  let chemin: string | null = null
  try {
    const lignes = await lireTout<FactureLigne>((debut, fin) => supabase.from('facture_lignes').select('*', { count: 'exact' })
      .eq('facture_id', p.facture.id).order('ordre').order('id').range(debut, fin))
    if (!lignes.complete) return { ok: false, message: `Les lignes de la facture n’ont pas pu être lues (${lignes.motif ?? 'lecture partielle'}) : rien n’a été déposé.` }
    const blocs = contenuDeLaFactureFigee(p.facture, lignes.lignes, p.numeroDeLOrigine)
    if (blocs === null) return { ok: false, message: 'Cette facture ne se tire pas de ses seules valeurs figées : rien n’a été déposé.' }
    const octets = await pdfDesBlocs(blocs, {
      titre: titreDeLaCopie(p.facture), pied: `Copie de la ${titreDeLaCopie(p.facture).toLowerCase()}, tirée de ses valeurs figées`,
      instant: instantDeLaCopie(p.facture),
    })
    const pret = preparerContenu('pieces', new Uint8Array(octets), 'application/pdf')
    if ('refus' in pret) return { ok: false, message: `Le PDF ne peut pas être déposé : ${pret.refus.message}.` }
    const empreinte = await empreinteSha256(pret.corps)
    chemin = cheminDuDepot(p.dossierClientId, Date.now(), p.facture)
    const envoi = await supabase.storage.from('pieces').upload(chemin, pret.corps, { contentType: pret.type, upsert: false })
    if (envoi.error) {
      chemin = null
      return { ok: false, message: messageErreur(envoi.error, 'le PDF n’a pas pu être déposé dans le dossier du client') }
    }
    const { data, error } = await supabase.rpc('deposer_honoraires_chez_le_client', {
      p_dossier_id: p.dossierId, p_facture_id: p.facture.id, p_chemin: chemin, p_empreinte: empreinte,
    })
    if (error || typeof data !== 'string') {
      await retirerFichiers('pieces', [chemin], 'dépôt des honoraires refusé', p.dossierClientId)
      return { ok: false, message: messageErreur(error, 'la base n’a pas rendu la pièce déposée') }
    }
    return { ok: true, pieceId: data }
  } catch (e) {
    if (chemin !== null) await retirerFichiers('pieces', [chemin], 'dépôt des honoraires interrompu', p.dossierClientId)
    return { ok: false, message: messageErreur(e, 'le dépôt chez le client a échoué') }
  }
}

/** « Mes pièces » : les pièces du dossier que le cabinet y a déposées pour ses honoraires (la pièce et sa nature). */
export type LectureDesHonorairesDeposes =
  | { etat: 'lue'; dossierId: string; natures: ReadonlyMap<string, string> }
  | { etat: 'illisible'; dossierId: string; motif: string }

export async function lireLesHonorairesDeposes(dossierId: string): Promise<LectureDesHonorairesDeposes> {
  try {
    const lu = await lireUneFonction(supabase.rpc('honoraires_deposes_au_dossier', { p_dossier_id: dossierId }, { count: 'exact' }),
      'les honoraires déposés n’ont pas pu être lus')
    if ('motif' in lu) return { etat: 'illisible', dossierId, motif: lu.motif }
    return { etat: 'lue', dossierId, natures: new Map((lu.lignes as { piece_id: string; nature: string }[]).map((l) => [l.piece_id, l.nature])) }
  } catch (e) {
    return { etat: 'illisible', dossierId, motif: messageErreur(e, 'les honoraires déposés n’ont pas pu être lus') }
  }
}

/** Gardée avec le dossier et le compteur ; `null` avant son retour, et rien de lu le drapeau baissé. */
export function useHonorairesDeposes(dossierId: string | null, relecture: number): LectureDesHonorairesDeposes | null {
  const [lue, setLue] = useState<{ cle: string; lecture: LectureDesHonorairesDeposes } | null>(null)
  const cle = `${dossierId}#${relecture}`
  useEffect(() => {
    if (!DEPOT_DES_HONORAIRES_PREVU || dossierId === null) return
    let annule = false
    void lireLesHonorairesDeposes(dossierId).then((lecture) => { if (!annule) setLue({ cle: `${dossierId}#${relecture}`, lecture }) })
    return () => { annule = true }
  }, [dossierId, relecture])
  if (!DEPOT_DES_HONORAIRES_PREVU || dossierId === null) return null
  return lue !== null && lue.cle === cle ? lue.lecture : null
}
