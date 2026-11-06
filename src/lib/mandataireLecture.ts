import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import type { LectureDuMandataire } from './mentionsFigeesVue'

// LE NOM DU CABINET QUI VALIDE, LU POUR L'ÉCRAN (espace client, étape P4 ; lib/mentionsFigeesVue.ts, `mentionDuMandat`). Quand
// le cabinet valide une facture, `enregistrer_facture` fige le nom du cabinet du dossier comme mandataire : il le lit comme ceci,
// `cabinets.nom` du `cabinet_id` du dossier (`select c.nom from cabinets c where c.id = v_dossier.cabinet_id`). L'écran le lit de
// même — la policy `cabinets_select` ouvre la ligne à l'équipe du cabinet —, pour dire avant le clic la mention que la facture
// imprimera. Le nom n'est jamais deviné ni remplacé par un mot générique : une lecture qui échoue, un dossier ou un cabinet
// qu'on ne trouve pas, un nom absent, tombent du côté signalé avec leur motif, et la validation est retenue.
//
// Elle ne REJETTE jamais ; c'est l'écran qui la garde AVEC le dossier lu.

export async function lireLeMandataire(dossierId: string): Promise<LectureDuMandataire> {
  try {
    const dossier = await supabase.from('dossiers').select('cabinet_id').eq('id', dossierId).maybeSingle()
    if (dossier.error) return { etat: 'illisible', motif: messageErreur(dossier.error, 'le dossier n’a pas pu être lu') }
    if (!dossier.data) return { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' }
    const cabinetId = (dossier.data as { cabinet_id?: unknown }).cabinet_id
    if (typeof cabinetId !== 'string' || cabinetId === '') return { etat: 'illisible', motif: 'le cabinet du dossier n’a pas été rendu' }
    const cabinet = await supabase.from('cabinets').select('nom').eq('id', cabinetId).maybeSingle()
    if (cabinet.error) return { etat: 'illisible', motif: messageErreur(cabinet.error, 'le cabinet n’a pas pu être lu') }
    if (!cabinet.data) return { etat: 'illisible', motif: 'le cabinet n’a pas été trouvé' }
    const nom = (cabinet.data as { nom?: unknown }).nom
    // Une colonne absente n'est pas une colonne vide : on ne sait pas ce que la base figera.
    if (typeof nom !== 'string') return { etat: 'illisible', motif: 'le nom du cabinet n’a pas été rendu' }
    return { etat: 'lu', nom }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'le cabinet n’a pas pu être lu') }
  }
}
