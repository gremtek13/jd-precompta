import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import type { LectureDuMandataire } from './mentionsFigeesVue'
import { DOSSIER_DU_CABINET_PREVU, estLeDossierDuCabinet } from './dossierDuCabinet'

// LE NOM DU CABINET QUI VALIDE, LU POUR L'ÉCRAN (espace client, étape P4 ; lib/mentionsFigeesVue.ts, `mentionDuMandat`). Quand
// le cabinet valide une facture, `enregistrer_facture` fige le nom du cabinet du dossier comme mandataire : il le lit comme ceci,
// `cabinets.nom` du `cabinet_id` du dossier (`select c.nom from cabinets c where c.id = v_dossier.cabinet_id`). L'écran le lit de
// même — la policy `cabinets_select` ouvre la ligne à l'équipe du cabinet —, pour dire avant le clic la mention que la facture
// imprimera. Le nom n'est jamais deviné ni remplacé par un mot générique : une lecture qui échoue, un dossier ou un cabinet
// qu'on ne trouve pas, un nom absent, tombent du côté signalé avec leur motif, et la validation est retenue.
//
// Sur le DOSSIER DU CABINET (ligne 47, LM2 ; `cabinets.dossier_du_cabinet`, lu le drapeau levé seulement), la base ne fige
// aucun mandataire : la lecture rend `sans_mandat`, et la confirmation ne parle plus de mandat.
//
// Elle ne REJETTE jamais ; c'est l'écran qui la garde AVEC le dossier lu.

export async function lireLeMandataire(dossierId: string): Promise<LectureDuMandataire> {
  try {
    const dossier = await supabase.from('dossiers').select('cabinet_id').eq('id', dossierId).maybeSingle()
    if (dossier.error) return { etat: 'illisible', motif: messageErreur(dossier.error, 'le dossier n’a pas pu être lu') }
    if (!dossier.data) return { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' }
    const cabinetId = (dossier.data as { cabinet_id?: unknown }).cabinet_id
    if (typeof cabinetId !== 'string' || cabinetId === '') return { etat: 'illisible', motif: 'le cabinet du dossier n’a pas été rendu' }
    // La désignation ne se lit que sa migration en base : avant, la colonne n'existe pas et la nommer ferait échouer la lecture.
    const cabinet = await supabase.from('cabinets').select(DOSSIER_DU_CABINET_PREVU ? 'nom, dossier_du_cabinet' : 'nom')
      .eq('id', cabinetId).maybeSingle()
    if (cabinet.error) return { etat: 'illisible', motif: messageErreur(cabinet.error, 'le cabinet n’a pas pu être lu') }
    if (!cabinet.data) return { etat: 'illisible', motif: 'le cabinet n’a pas été trouvé' }
    if (DOSSIER_DU_CABINET_PREVU) {
      const designe = (cabinet.data as { dossier_du_cabinet?: unknown }).dossier_du_cabinet
      // Une colonne absente n'est pas nulle : on ne sait pas si la base figera un mandataire.
      if (designe !== null && typeof designe !== 'string') return { etat: 'illisible', motif: 'la désignation du dossier du cabinet n’a pas été rendue' }
      if (estLeDossierDuCabinet(designe, dossierId)) return { etat: 'sans_mandat' }
    }
    const nom = (cabinet.data as { nom?: unknown }).nom
    // Une colonne absente n'est pas une colonne vide : on ne sait pas ce que la base figera.
    if (typeof nom !== 'string') return { etat: 'illisible', motif: 'le nom du cabinet n’a pas été rendu' }
    return { etat: 'lu', nom }
  } catch (e) {
    return { etat: 'illisible', motif: messageErreur(e, 'le cabinet n’a pas pu être lu') }
  }
}
