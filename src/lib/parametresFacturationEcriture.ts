import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import type { LogoEnvoye } from './logoDesFactures'
import type { ParametresEnvoyes } from './parametresFacturation'
import type { ParametresFacturation } from './types'

// LES DEUX GESTES DES PARAMÈTRES DE FACTURATION, PAR LA BASE SEULE (espace client, étape A5b1). Aucune policy n'écrit
// `parametres_facturation` (hors la restauration du super-administrateur) : seules `enregistrer_parametres_facturation` (le
// cabinet et le client « Ventes ») et `confirmer_rib` (le cabinet seul) le font, chacune avec son accès vérifié avant toute
// lecture, sous un verrou par dossier. Chacune rend la VERSION qu'elle a écrite, que l'écran relit de toute façon ; on vérifie
// ici qu'elle a bien rendu celle du dossier visé — la version neuve qui remplace celle qu'on annonçait remplacer, ou la version
// confirmée —, comme `adressesReceptionEcriture.ts`. Un refus se lève sous les mots de la base (`messageErreur`).

function versionEcrite(data: unknown, dossierId: string, attendu: { remplace: string | null } | { confirmee: string }): ParametresFacturation {
  const v = data as Partial<ParametresFacturation> | null
  const juste = v != null && typeof v === 'object' && typeof v.id === 'string' && v.dossier_id === dossierId
    && ('remplace' in attendu
      ? (v.remplace_id ?? null) === attendu.remplace
      : v.id === attendu.confirmee && v.rib_etat === 'confirme')
  if (!juste) throw new Error('La base n’a pas rendu les paramètres écrits : relis-les avant de recommencer.')
  return v as ParametresFacturation
}

/**
 * Enregistre une version : la première (`remplaceId` nul) ou celle qui REMPLACE la courante, tous ses champs (la saisie telle
 * qu'elle part, `saisieQuiPart`) et, la migration du logo en base, son logo (étape A5c1 : celui de la version remplacée
 * repris, `parametresEnvoyes`). Rend la version écrite ; lève le refus de la base.
 */
export async function enregistrerParametresFacturation(
  dossierId: string, remplaceId: string | null, parametres: ParametresEnvoyes & LogoEnvoye,
): Promise<ParametresFacturation> {
  const { data, error } = await supabase.rpc('enregistrer_parametres_facturation', {
    p_dossier_id: dossierId, p_remplace_id: remplaceId, p_parametres: parametres,
  })
  if (error) throw new Error(messageErreur(error, 'Les paramètres de facturation n’ont pas pu être enregistrés.'))
  return versionEcrite(data, dossierId, { remplace: remplaceId })
}

/** Confirme le RIB proposé de la version courante (le cabinet seul). Rend la version confirmée ; lève le refus de la base. */
export async function confirmerRib(dossierId: string, versionId: string): Promise<ParametresFacturation> {
  const { data, error } = await supabase.rpc('confirmer_rib', { p_dossier_id: dossierId, p_version_id: versionId })
  if (error) throw new Error(messageErreur(error, 'Le RIB n’a pas pu être confirmé.'))
  return versionEcrite(data, dossierId, { confirmee: versionId })
}
