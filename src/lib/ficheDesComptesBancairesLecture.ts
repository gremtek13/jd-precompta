import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { lireLesComptesDuDossier } from './comptesBancairesLecture'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { usageDesComptes, type LigneDeLaFiche, type UsageDUnCompte } from './ficheDesComptesBancaires'
import type { CompteDuReleve } from './importParCompte'

// La lecture et les écritures de la fiche des comptes bancaires (ligne 26.6, MCB6 ; pages/dossier/ComptesBancairesCard.tsx).
// La lecture ne rejette jamais : les comptes (lib/comptesBancairesLecture.ts, la lecture écrite une fois), puis ce que la base
// porte sous chacun — les dates et le compte de TOUS les mouvements, le compte de tous les contrôles —, chacun lu en entier ;
// une erreur ou une lecture partielle rendent `illisible`, et la carte n'offre alors aucun geste. Les écritures passent la
// table seule, sous sa policy du cabinet (`admin_du_dossier`) et sa garde (`garder_comptes_bancaires`) : aucune fonction
// `security definer`. Une écriture se vérifie : une ligne que la base n'a pas rendue n'est pas écrite.

export type LectureDeLaFiche =
  | { dossierId: string; etat: 'lue'; comptes: readonly CompteDuReleve[]; usages: ReadonlyMap<string, UsageDUnCompte> }
  | { dossierId: string; etat: 'illisible'; motif: string }

export type Issue = { ok: true } | { ok: false; message: string }

export async function lireLaFiche(dossierId: string): Promise<LectureDeLaFiche> {
  // Drapeau baissé, la table et la colonne n'existent pas : rien ne se lit (la carte ne se monte pas non plus).
  if (!COMPTES_BANCAIRES_PREVUS) return { dossierId, etat: 'illisible', motif: 'les comptes bancaires ne sont pas encore en base' }
  try {
    const [comptes, lignes, controles] = await Promise.all([
      lireLesComptesDuDossier(dossierId),
      lireTout<{ compte_bancaire_id: string | null; date: string }>((debut, fin) =>
        supabase.from('lignes_bancaires').select('compte_bancaire_id, date', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
      lireTout<{ compte_bancaire_id: string | null }>((debut, fin) =>
        supabase.from('controles_releves_bancaires').select('id, compte_bancaire_id', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    if (comptes.etat === 'sans_objet' || comptes.etat === 'en_cours') return { dossierId, etat: 'illisible', motif: 'les comptes bancaires ne sont pas lus' }
    if (comptes.etat === 'illisible') return { dossierId, etat: 'illisible', motif: `les comptes bancaires : ${comptes.motif}` }
    if (!lignes.complete) return { dossierId, etat: 'illisible', motif: `les mouvements du relevé : ${lignes.motif ?? 'lecture incomplète'}` }
    if (!controles.complete) return { dossierId, etat: 'illisible', motif: `les relevés contrôlés : ${controles.motif ?? 'lecture incomplète'}` }
    return { dossierId, etat: 'lue', comptes: comptes.comptes, usages: usageDesComptes(lignes.lignes, controles.lignes) }
  } catch (erreur) {
    return { dossierId, etat: 'illisible', motif: messageErreur(erreur, 'lecture impossible') }
  }
}

export async function creerLeCompte(dossierId: string, ligne: LigneDeLaFiche): Promise<Issue> {
  try {
    const { data, error } = await supabase.from('comptes_bancaires').insert({ dossier_id: dossierId, ...ligne }).select('id').maybeSingle()
    if (error) return { ok: false, message: messageErreur(error, 'la création a échoué') }
    if (!data) return { ok: false, message: 'la base n’a rendu aucun compte créé' }
    return { ok: true }
  } catch (erreur) {
    return { ok: false, message: messageErreur(erreur, 'la création a échoué') }
  }
}

// Seules les colonnes que la fiche corrige partent : jamais le dossier ni le rang, que la garde refuse de changer.
export async function corrigerLeCompte(dossierId: string, id: string, ligne: LigneDeLaFiche): Promise<Issue> {
  const { libelle, compte, compte_propre_depuis, ouvert_le, clos_le, fin_d_identifiant } = ligne
  try {
    const { data, error } = await supabase.from('comptes_bancaires')
      .update({ libelle, compte, compte_propre_depuis, ouvert_le, clos_le, fin_d_identifiant })
      .eq('id', id).eq('dossier_id', dossierId).select('id').maybeSingle()
    if (error) return { ok: false, message: messageErreur(error, 'la correction a échoué') }
    if (!data) return { ok: false, message: 'la base n’a rendu aucun compte corrigé' }
    return { ok: true }
  } catch (erreur) {
    return { ok: false, message: messageErreur(erreur, 'la correction a échoué') }
  }
}
