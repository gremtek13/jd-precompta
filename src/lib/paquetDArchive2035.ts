import { avertissementDuFormulaire } from './modeles2035'
import { casesDeLInstantane, lireInstantane2035 } from './validationExercice'
import { messageErreur } from './messageErreur'
import type { Pdf2035DuPaquet } from './paquetDArchive'

// LE PDF DE LA 2035 VALIDÉE, POUR LE PAQUET D'ARCHIVE (ligne 44, lot INAL3c). Le même remplissage que le bouton de l'onglet
// Clôture pour un exercice validé (`telechargerFormulaire` avec son instantané) : les cases du `formulaire` figé, à l'euro, et
// le déclarant de l'instantané, sur le modèle que lib/modeles2035.ts choisit — le millésime de l'exercice, sinon le dernier
// livré, l'avertissement écrit sur chaque page par remplir2035.ts et rendu ici pour le manifeste (2035S-Q5).
//
// La page 3 (annexe 2035-E) reste vierge : la validation ne la fige pas — ses lignes se tirent de saisies et du forfait
// kilométrique tels qu'ils sont au jour du calcul —, et le paquet ne porte que ce que l'exercice validé a scellé.
//
// Ne lève jamais : un instantané illisible, un modèle introuvable ou que pdf.js ne lit pas rendent un motif, que le paquet
// écrit dans son manifeste (lib/paquetDArchive.ts dit pourquoi il part alors sans le PDF).
//
// remplir2035.ts (et pdf.js avec lui) ne se charge qu'ici, au clic : l'onglet Écritures, qui monte le bouton du paquet, ne
// le charge pas à son ouverture — et un chargement qui échoue n'est qu'un PDF de plus qui ne se fait pas.
export async function la2035DuPaquet(declaration: unknown, annee: number): Promise<Pdf2035DuPaquet> {
  if (declaration === null || declaration === undefined) {
    return { etat: 'impossible', motif: 'la validation de l’exercice n’a figé aucune 2035' }
  }
  const instantane = lireInstantane2035(declaration)
  if (instantane === null) return { etat: 'impossible', motif: 'la 2035 validée n’a pas une forme que l’application sait relire' }
  if (instantane.annee !== annee) {
    return { etat: 'impossible', motif: `la 2035 validée porte l’exercice ${instantane.annee}, pas ${annee}` }
  }
  try {
    const { remplir2035 } = await import('./remplir2035')
    const { pdf, codesSansAncrage } = await remplir2035(casesDeLInstantane(instantane.formulaire), instantane.entete, null, annee)
    return { etat: 'rempli', octets: pdf, casesNonPlacees: [...codesSansAncrage], avertissement: avertissementDuFormulaire(annee) }
  } catch (e) {
    return { etat: 'impossible', motif: messageErreur(e, 'le formulaire 2035 n’a pas pu être rempli') }
  }
}
