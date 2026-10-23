import { supabase } from './supabase'
import type { SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { lireLesSourcesDesEcrituresDeVente } from './ecrituresVentesFactureesLecture'
import { lireTout } from './lectureComplete'
import { messageErreur } from './messageErreur'
import type { TransmissionEncaissement } from './types'

// CE QUE L'ONGLET BANQUE LIT DES VENTES FACTURÉES D'UN DOSSIER QUI A BASCULÉ (ligne 28.65, chantier EC-Q3 ; le module
// pur est lib/mouvementsDesVentes.ts). Depuis l'étape VF5a1, la lecture de l'onglet Écritures
// (lib/ecrituresVentesFactureesLecture.ts) ; depuis l'étape VF5d, AVEC les déclarations des encaissements du dossier :
// la contre-passation qu'`annuler_encaissement` accepte en dépend — d'un encaissement déclaré, d'issue inconnue, ou,
// depuis l'étape VF5d2, jamais déclaré d'une facture source —, et la fiche d'un débit dit de chaque candidat ce que
// devient sa déclaration. Les deux dans le même appel, tout ou rien : une seule lecture partielle, refusée ou rompue, et
// rien ne se décide — l'état le dit, avec le motif de la première qui a manqué, et l'onglet retient tout geste et tout
// lot du relevé (`retenueDuReleve`). Gardée avec le dossier : chaque déclaration rendue est confrontée au dossier
// demandé. Ne rejette jamais.

/** Les colonnes des déclarations que l'onglet lit : de quoi dire un encaissement déclaré, rien de plus. */
export const COLONNES_DECLARATIONS_DU_RELEVE = 'id, dossier_id, encaissement_id, etat'

/** Le nom de la lecture des déclarations : c'est lui que le motif d'un manque nomme. */
export const NOM_DES_DECLARATIONS_DU_RELEVE = 'les déclarations des encaissements'

export type DeclarationDuReleve = Pick<TransmissionEncaissement, 'id' | 'dossier_id' | 'encaissement_id' | 'etat'>

export interface SourcesDesVentesDuReleve extends SourcesDesEcrituresDeVente {
  /** Les déclarations du DOSSIER, échouées et rejetées comprises : le module décide lui-même de ce qui compte. */
  declarations: readonly DeclarationDuReleve[]
}

export type LectureDesVentesEtDeclarations =
  | { dossierId: string; etat: 'lue'; sources: SourcesDesVentesDuReleve }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Les ventes facturées du dossier et les déclarations de ses encaissements, lues en entier ; ou « incomplète », avec le motif. */
export async function lireLesVentesDuReleve(dossierId: string): Promise<LectureDesVentesEtDeclarations> {
  try {
    const [ventes, declarations] = await Promise.all([
      lireLesSourcesDesEcrituresDeVente(dossierId),
      lireTout<DeclarationDuReleve>((debut, fin) =>
        supabase.from('transmissions_encaissements').select(COLONNES_DECLARATIONS_DU_RELEVE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    if (ventes.etat === 'incomplete') return ventes
    if (!declarations.complete) {
      return { dossierId, etat: 'incomplete', motif: `${NOM_DES_DECLARATIONS_DU_RELEVE} : ${declarations.motif ?? 'lecture incomplète'}` }
    }
    if (!declarations.lignes.every((d) => d.dossier_id === dossierId)) {
      return { dossierId, etat: 'incomplete', motif: `${NOM_DES_DECLARATIONS_DU_RELEVE} : une ligne rendue n'est pas de ce dossier` }
    }
    return { dossierId, etat: 'lue', sources: { ...ventes.sources, declarations: declarations.lignes } }
  } catch (erreur) {
    return { dossierId, etat: 'incomplete', motif: messageErreur(erreur, 'la lecture des ventes facturées a échoué') }
  }
}
