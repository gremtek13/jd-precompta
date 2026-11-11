import { supabase } from './supabase'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { COMPTES_BANCAIRES_PREVUS } from './comptesBancaires'
import { lireLesComptesDuDossier } from './comptesBancairesLecture'
import type { ControleReleveBancaire, LigneBancaire } from './types'
import type { LectureDuReleveDeLOuverture } from './ouvertureEclatee'

// LA LECTURE DE L'ÉCLATEMENT DE L'OUVERTURE (ligne 26.6, MCB5, sixième partie, suite ; la carte
// pages/dossier/OuvertureEclateeCarte.tsx, le module lib/ouvertureEclatee.ts). Ce que l'onglet Écritures ne lit pas déjà :
// les comptes bancaires, TOUT le relevé (le solde de chaque compte au 31 décembre se lit sur ses seuls relevés, et une
// activité d'avant le 1er janvier attend son ouverture) et tous les contrôles des relevés, chacun lu en entier. Elle ne
// rejette jamais : une erreur ou une lecture partielle rendent `illisible`, et la carte n'offre alors aucun geste. Drapeau
// `COMPTES_BANCAIRES_PREVUS` baissé : rien ne se lit, sans appel au réseau — `sans_objet`, et la carte ne se monte pas.
// Gardée avec le dossier pour lequel elle a été lue : l'onglet reste monté d'un dossier à l'autre.
export async function lireLOuvertureEclatee(dossierId: string): Promise<LectureDuReleveDeLOuverture> {
  if (!COMPTES_BANCAIRES_PREVUS) return { dossierId, etat: 'sans_objet' }
  try {
    const [comptes, lignes, controles] = await Promise.all([
      lireLesComptesDuDossier(dossierId),
      lireTout<Pick<LigneBancaire, 'id' | 'source_fichier' | 'montant' | 'date'> & { compte_bancaire_id: string | null }>((debut, fin) =>
        supabase.from('lignes_bancaires').select('id, compte_bancaire_id, source_fichier, montant, date', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
      lireTout<ControleReleveBancaire & { compte_bancaire_id: string | null }>((debut, fin) =>
        supabase.from('controles_releves_bancaires').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin)),
    ])
    if (comptes.etat === 'sans_objet') return { dossierId, etat: 'sans_objet' }
    if (comptes.etat === 'en_cours') return { dossierId, etat: 'illisible', motif: 'les comptes bancaires ne sont pas lus' }
    if (comptes.etat === 'illisible') return { dossierId, etat: 'illisible', motif: `les comptes bancaires : ${comptes.motif}` }
    if (!lignes.complete) return { dossierId, etat: 'illisible', motif: `les mouvements du relevé : ${lignes.motif ?? 'lecture incomplète'}` }
    if (!controles.complete) return { dossierId, etat: 'illisible', motif: `les relevés contrôlés : ${controles.motif ?? 'lecture incomplète'}` }
    return { dossierId, etat: 'lue', comptes, lignes: lignes.lignes, controles: controles.lignes }
  } catch (erreur) {
    return { dossierId, etat: 'illisible', motif: messageErreur(erreur, 'lecture impossible') }
  }
}
