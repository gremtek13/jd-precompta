import { supabase } from './supabase'
import type { SaisieAdresseReception } from './adressesReception'
import type { AdresseReception } from './types'

// LA DÉCLARATION D'UNE ADRESSE DE RÉCEPTION, PAR LA BASE SEULE (espace client, étape A6b1). Aucune policy n'écrit
// `adresses_reception` : seule `declarer_adresse_reception` le fait, avec son accès (`gere_les_ventes`, le cabinet ou le
// client « Ventes ») vérifié avant toute lecture, sous un verrou par dossier. Elle rend la LIGNE qu'elle a écrite, que
// l'écran relit de toute façon ; on vérifie ici qu'elle a bien rendu l'adresse du dossier visé, qui remplace celle qu'on
// annonçait remplacer. Un refus se lève sous les mots de la base (le message de l'erreur, que `messageErreur` rend tel quel).

function ecrite(data: unknown, dossierId: string, remplaceId: string | null): AdresseReception {
  const ligne = data as Partial<AdresseReception> | null
  if (ligne == null || typeof ligne !== 'object' || typeof ligne.id !== 'string' || typeof ligne.identifiant !== 'string'
    || ligne.dossier_id !== dossierId || (ligne.remplace_id ?? null) !== remplaceId) {
    throw new Error('La base n’a pas rendu l’adresse déclarée : relis-la avant de recommencer.')
  }
  return ligne as AdresseReception
}

/** Déclare l'adresse (`remplace_id` nul pour la première, sinon la courante qu'elle remplace). Rend la ligne écrite. */
export async function declarerAdresseReception(dossierId: string, saisie: SaisieAdresseReception): Promise<AdresseReception> {
  const { data, error } = await supabase.rpc('declarer_adresse_reception', {
    p_dossier_id: dossierId, p_forme: saisie.forme, p_identifiant: saisie.identifiant, p_plateforme: saisie.plateforme,
    p_prise_effet: saisie.prise_effet, p_verification: saisie.verification, p_verifiee_le: saisie.verifiee_le,
    p_remplace_id: saisie.remplace_id,
  })
  if (error) throw new Error(error.message)
  return ecrite(data, dossierId, saisie.remplace_id)
}
