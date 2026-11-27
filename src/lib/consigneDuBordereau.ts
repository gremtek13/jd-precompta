import { CONSIGNE_DU_BORDEREAU_AU_CLIENT } from './refusDesBordereaux'
import { sectionAssuranceMaladie, type ImportsDeLaSection } from './sectionAssuranceMaladie'

// LA CONSIGNE DU BORDEREAU, UNE LIGNE PERMANENTE DE « MES PIÈCES » (BOR6TQ1-Q1 (A), réponse du cabinet du 27/11/2026 ; la suite
// de BOR6T-Q1, HISTORIQUE.md, « BOR6T-Q1 ET BOR6T-Q2 »). La consigne ne se disait qu'APRÈS un refus — un bordereau déposé, lu,
// puis écarté ; la photo, elle, est déjà passée par la lecture (Textract) quand le refus tombe (RGPD.md § 8.7). Elle se dit
// donc AVANT, sous la zone de dépôt, en une ligne qui ne part jamais — sur les seuls dossiers de santé : la règle de la section
// de l'assurance maladie (lib/sectionAssuranceMaladie.ts : un code NAF de santé ou de la liste fermée, ou un import déjà en
// base), relue pour la société AFFICHÉE (lib/consigneDuBordereauLecture.ts). Hors d'elle, rien : un client hors de la santé ne
// lit jamais cette ligne, et tant que ce qui la décide n'est pas lu, elle se tait — elle ne s'affiche jamais à tort, et son
// absence n'affirme rien. Aux mots du client (le tutoiement, `MOTS_DU_CABINET`, consigneDuBordereau.test.ts).
//
// Un module PUR : ni base, ni horloge.

/** La ligne, aux mots du client : ce qui ne se dépose pas ici, pourquoi, puis la consigne de BOR6T-Q1. */
export const LIGNE_DU_BORDEREAU_DANS_MES_PIECES = 'Un bordereau de télétransmission ne se dépose pas ici : il porte les noms de '
  + `tes patients. ${CONSIGNE_DU_BORDEREAU_AU_CLIENT.charAt(0).toUpperCase()}${CONSIGNE_DU_BORDEREAU_AU_CLIENT.slice(1)}.`

/** Ce que deux lectures d'existence disent des imports du dossier (les paiements, le facturé) : une ligne lue d'un côté en
 *  prouve un ; sinon `inconnu`, jamais `aucun` — une lecture vide ne dit pas qu'il n'y en a pas, et seule la règle du code
 *  NAF décide alors. */
export function importsDesLecturesDExistence(paiements: boolean | null, facture: boolean | null): ImportsDeLaSection {
  return paiements === true || facture === true ? 'au-moins-un' : 'inconnu'
}

/** La ligne à montrer, ou nulle. `codeNaf` : `undefined` tant que le dossier n'est pas lu, `null` sans code. Sans défaut. */
export function ligneDuBordereau(codeNaf: string | null | undefined, imports: ImportsDeLaSection): string | null {
  return sectionAssuranceMaladie(codeNaf, imports).offerte ? LIGNE_DU_BORDEREAU_DANS_MES_PIECES : null
}
