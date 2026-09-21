import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import type { InformationsDossier, VehiculeType } from './types'

// Les informations déclaratives d'un dossier : véhicule, jours travaillés, avantages, notes.
//
// CE MODULE N'EXISTE PAS POUR DÉDUPLIQUER, MAIS POUR EMPÊCHER UN ÉCRASEMENT.
// Les deux écrans qui portent ce formulaire — InformationsTab (cabinet) et ClientInformations
// (client), jumeaux assumés — lisaient la ligne en `const { data } = …`, erreur jetée, puis la
// réenregistraient par un upsert portant TOUS les champs. Une lecture qui échoue laisse donc le
// formulaire sur ses valeurs INITIALES — véhicule « aucun », jours vide, avantages décochés, notes
// vide — et rien ne le dit : c'est exactement l'écran d'un dossier qui n'a jamais rien rempli.
// Le premier « Enregistrer » écrase alors ce qu'on n'a pas su lire.
//
// Ce que ça coûte n'est pas une ligne de moins mais une donnée FAUSSE en déclaration :
// `vehicule_type` commande le forfait kilométrique, donc la case BJ de la 2035 ; `notes` est du
// texte libre que personne ne relit, donc que personne ne verra disparaître.
//
// CE QUE LE CORRECTIF GARDE, ET CE QU'IL NE GARDE PAS — mesuré, pas supposé (21/09/2026) : un refus
// RLS rend ZÉRO LIGNE ET AUCUNE ERREUR (vérifié par impersonation d'un compte rattaché à rien sur
// la base réelle), donc il reste indiscernable d'un dossier neuf et AUCUN code ne peut l'attraper
// ici. Ce que lire l'erreur attrape, et qui suffisait à produire le dégât : session expirée (401),
// coupure réseau, 5xx, colonne renommée. Sur ceux-là l'écran refuse désormais d'enregistrer.

export interface LectureInformations {
  informations: InformationsDossier | null
  // Non nul = on ne SAIT PAS ce que porte le dossier. L'appelant doit alors refuser d'enregistrer,
  // pas afficher un formulaire vide : c'est la différence entre « rien à dire » et « on n'a pas lu ».
  erreur: string | null
}

export async function chargerInformationsDossier(dossierId: string): Promise<LectureInformations> {
  const { data, error } = await supabase
    .from('informations_dossier')
    .select('*')
    .eq('dossier_id', dossierId)
    .maybeSingle()
  if (error) {
    return {
      informations: null,
      erreur: messageErreur(error, "Les informations du dossier n'ont pas pu être lues."),
    }
  }
  return { informations: data ?? null, erreur: null }
}

// Ce que le formulaire porte à l'écran, avant nettoyage. Les champs numériques et textuels arrivent
// en chaînes parce que ce sont des `<input>` : la conversion est faite ici, une fois, plutôt que
// recopiée dans les deux écrans (c'est là qu'elle divergerait).
export interface SaisieInformations {
  vehiculeType: VehiculeType
  vehiculeLibelle: string
  joursTravailles: string
  ticketsRestaurant: boolean
  chequesVacances: boolean
  notes: string
}

export function payloadInformations(dossierId: string, saisie: SaisieInformations) {
  return {
    dossier_id: dossierId,
    vehicule_type: saisie.vehiculeType,
    // Un libellé sans véhicule ne désigne rien : le champ est grisé à l'écran, mais un champ grisé
    // GARDE sa valeur (règle déjà payée sur la carte Véhicules), donc on la retire ici.
    vehicule_libelle: saisie.vehiculeType === 'aucun' ? null : (saisie.vehiculeLibelle.trim() || null),
    jours_travailles_an: saisie.joursTravailles ? parseInt(saisie.joursTravailles, 10) : null,
    tickets_restaurant: saisie.ticketsRestaurant,
    cheques_vacances: saisie.chequesVacances,
    notes: saisie.notes.trim() || null,
    updated_at: new Date().toISOString(),
  }
}

// Upsert sur `dossier_id` (contrainte unique en base) : une seule ligne par dossier, qu'elle existe
// déjà ou non. Les deux colonnes de justificatifs reçus ne figurent PAS dans le payload, donc un
// update les laisse telles quelles — elles se cochent depuis la Checklist, pas depuis ce formulaire.
export async function enregistrerInformationsDossier(
  dossierId: string,
  saisie: SaisieInformations,
): Promise<string | null> {
  const { error } = await supabase
    .from('informations_dossier')
    .upsert(payloadInformations(dossierId, saisie), { onConflict: 'dossier_id' })
  return error ? messageErreur(error, "Les informations n'ont pas pu être enregistrées.") : null
}
