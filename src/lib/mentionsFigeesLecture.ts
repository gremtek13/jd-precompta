import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { lireLesParametresFacturation } from './parametresFacturationLecture'
import { COLONNES_DE_L_IDENTITE, type IdentiteDuDossier, type LectureDeLaValidation } from './mentionsFigeesVue'

// CE QUE LA VALIDATION D'UNE FACTURE FIGE, LU POUR L'ÉCRAN (espace client, étape A7b ; lib/mentionsFigeesVue.ts) : la ligne
// du dossier — son SIRET, son adresse, son statut de TVA, son identité légale — et les versions de ses paramètres de
// facturation, LUES EN ENTIER (lib/parametresFacturationLecture.ts). La policy du dossier ouvre sa ligne au cabinet et à ses
// accès client ; celles des paramètres, au cabinet et au client « Ventes ».
//
// Elle ne REJETTE jamais : une requête qui lève ou qu'on refuse, une colonne qui ne revient pas, des versions lues en partie,
// tombent du côté signalé, avec leur motif — jamais en un dossier sans identité ni en des paramètres vides, qui feraient
// dire au formulaire « aucun RIB » d'un RIB qu'on n'a pas lu. C'est l'écran qui la garde AVEC le dossier lu.

const COLONNES = COLONNES_DE_L_IDENTITE.split(', ') as (keyof IdentiteDuDossier)[]

async function lireLIdentite(dossierId: string): Promise<IdentiteDuDossier | { motif: string }> {
  try {
    const { data, error } = await supabase.from('dossiers').select(COLONNES_DE_L_IDENTITE).eq('id', dossierId).maybeSingle()
    if (error) return { motif: messageErreur(error, 'le dossier n’a pas pu être lu') }
    if (!data) return { motif: 'le dossier n’a pas été trouvé' }
    const ligne = data as unknown as Record<string, unknown>
    // Une colonne absente n'est pas une colonne nulle : la lecture qui ne la rend pas ne dit rien de ce que la facture figera.
    const manquante = COLONNES.find((c) => ligne[c] === undefined)
    if (manquante) return { motif: `la colonne ${manquante} du dossier n’a pas été rendue` }
    return data as unknown as IdentiteDuDossier
  } catch (e) {
    return { motif: messageErreur(e, 'le dossier n’a pas pu être lu') }
  }
}

/** Le dossier et les versions de ses paramètres, tels que la validation les lira ; ne rejette jamais. */
export async function lireCeQueLaValidationFige(dossierId: string): Promise<LectureDeLaValidation> {
  const [identite, parametres] = await Promise.all([lireLIdentite(dossierId), lireLesParametresFacturation(dossierId)])
  if ('motif' in identite) return { etat: 'illisible', motif: identite.motif }
  if (!parametres.complete) {
    return { etat: 'illisible', motif: `les paramètres de facturation ne sont lus qu’en partie (${parametres.motif ?? 'lecture incomplète'})` }
  }
  return { etat: 'lu', identite, versions: parametres.lignes }
}
