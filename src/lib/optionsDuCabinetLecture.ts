import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import { MODULES_OPTIONNELS, modulesLus, OPTIONS_DES_CABINETS_PREVUES, TOUS_LES_MODULES, type ModuleOptionnel } from './modulesDuCabinet'
import { supabase } from './supabase'

// LA LECTURE DES MODULES OUVERTS (conception 56, § 2.3, lot OPT3). Une lecture par session, au chargement de la coque, sous la
// clé de ce qu'elle lit — le cabinet du compte du cabinet, le dossier affiché du client —, que le contexte
// (context/OptionsDuCabinetContext.tsx) relit au changement d'IDENTIFIANT seulement.
//   - Côté cabinet : la table `options_des_cabinets` du cabinet, EN ENTIER (`lireTout`, compte annoncé, tri total : la clé
//     primaire est (cabinet_id, module), et le cabinet est fixé) ; une ligne absente est un module fermé (OPT-Q3).
//   - Côté client : `modules_ouverts_du_dossier`, la seule porte que la base lui ouvre ; la table lui reste fermée.
// Elle ne rejette jamais : lue en partie, refusée, rompue, ou d'une forme inconnue, elle tombe du côté FERMÉ (`illisible` :
// le socle seul, un bandeau le dit), jamais un module ouvert qu'on n'a pas su lire. Le drapeau baissé, AUCUNE lecture : tout
// est ouvert, l'application est celle d'hier, requête comprise.

export type ModulesDuCabinetLus =
  | { readonly etat: 'lus'; readonly cle: string; readonly ouverts: readonly ModuleOptionnel[] }
  | { readonly etat: 'illisibles'; readonly cle: string; readonly motif: string }

/** Ce que vaut l'état « tous ouverts sans lecture » : celui du drapeau baissé. */
export const SANS_LECTURE_TOUT_OUVERT = { etat: 'lus', cle: '', ouverts: TOUS_LES_MODULES } as const satisfies ModulesDuCabinetLus

type OptionLue = { cabinet_id: unknown; module: unknown; ouverte: unknown }

/** Les modules ouverts d'un cabinet, lus de la table (compte du cabinet). `prevues` : le drapeau, en paramètre pour que les
 *  tests jouent ses deux états. */
export async function lireLesModulesDuCabinet(cabinetId: string, prevues: boolean = OPTIONS_DES_CABINETS_PREVUES): Promise<ModulesDuCabinetLus> {
  if (!prevues) return { ...SANS_LECTURE_TOUT_OUVERT, cle: cabinetId }
  try {
    const lecture = await lireTout<OptionLue>((debut, fin) =>
      supabase.from('options_des_cabinets').select('cabinet_id, module, ouverte', { count: 'exact' })
        .eq('cabinet_id', cabinetId).order('module').range(debut, fin),
    )
    if (!lecture.complete) return { etat: 'illisibles', cle: cabinetId, motif: lecture.motif ?? 'lecture incomplète' }
    const connus = MODULES_OPTIONNELS as readonly unknown[]
    if (lecture.lignes.some((l) => l.cabinet_id !== cabinetId || !connus.includes(l.module) || typeof l.ouverte !== 'boolean')) {
      return { etat: 'illisibles', cle: cabinetId, motif: 'une option rendue n’est pas lisible' }
    }
    const ouverts = modulesLus(lecture.lignes.filter((l) => l.ouverte === true).map((l) => l.module))
    if (ouverts === null) return { etat: 'illisibles', cle: cabinetId, motif: 'un module est rendu deux fois' }
    return { etat: 'lus', cle: cabinetId, ouverts }
  } catch (e) {
    return { etat: 'illisibles', cle: cabinetId, motif: messageErreur(e, 'la lecture des options du cabinet a échoué') }
  }
}

/** Les modules ouverts du cabinet d'un dossier, par `modules_ouverts_du_dossier` (accès client). */
export async function lireLesModulesDuDossier(dossierId: string, prevues: boolean = OPTIONS_DES_CABINETS_PREVUES): Promise<ModulesDuCabinetLus> {
  if (!prevues) return { ...SANS_LECTURE_TOUT_OUVERT, cle: dossierId }
  try {
    const { data, error } = await supabase.rpc('modules_ouverts_du_dossier', { p_dossier_id: dossierId })
    if (error) return { etat: 'illisibles', cle: dossierId, motif: messageErreur(error, 'la lecture des options du cabinet a échoué') }
    const ouverts = modulesLus(data)
    if (ouverts === null) return { etat: 'illisibles', cle: dossierId, motif: 'les modules rendus ne sont pas lisibles' }
    return { etat: 'lus', cle: dossierId, ouverts }
  } catch (e) {
    return { etat: 'illisibles', cle: dossierId, motif: messageErreur(e, 'la lecture des options du cabinet a échoué') }
  }
}
