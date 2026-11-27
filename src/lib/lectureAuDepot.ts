import { CODE_D_UN_BORDEREAU_LU, extractPiece, pdfTropLourdPourEtreLu, textractPeutLire, type ExtractionResult } from './extraction'

// LA LECTURE AU DÉPÔT, QUI RECONNAÎT UN BORDEREAU LU PAR TEXTRACT (conception 59, BOR6, troisième partie, 27/11/2026 ;
// BOR-Q9 (A)). Une photo d'un bordereau de télétransmission, ou un PDF numérisé sans couche de texte, échappe au refus du
// navigateur (`sansBordereau`, lib/bornesStockage.ts, qui lit la couche de texte d'un PDF) : aucune reconnaissance de
// caractères ne tourne dans le navigateur (écartée depuis le 21/09/2026), et seule la lecture d'`extract-piece` (Textract)
// peut le reconnaître. Elle le refuse alors sous un code (422, `bordereau`), sans rien citer au modèle ni rien rendre.
//
// Ce refus se distingue ici d'une lecture RATÉE, que le dépôt tolère (la pièce arrive sans rien de lu) : les deux chemins du
// dépôt (`lib/depot.ts` pour le client, `lib/importFichiers.ts` pour le cabinet) lisent AVANT l'envoi au stockage, et un
// bordereau reconnu ne s'y dépose jamais. Ce que cela ne couvre pas, dit plutôt que laissé croire : l'image est passée par
// Textract (AWS, dans l'Union européenne, comme toute pièce lue) ; une photo que Textract lit mal ne se reconnaît pas.
//
// Un module à part d'`extraction.ts` : il appelle `extractPiece` par son import, que les tests des deux chemins simulent.

/** Ce que la lecture rend aux deux chemins du dépôt. */
export type LectureAuDepot =
  | { etat: 'lue'; extraction: ExtractionResult }
  /** La lecture a la forme d'un bordereau de télétransmission : rien ne se dépose, rien n'a été cité ni rendu. */
  | { etat: 'bordereau' }
  /** La lecture a échoué (Textract, réseau, format) : le dépôt continue sans rien de lu, comme hier. */
  | { etat: 'ratee' }

/** Vrai si l'erreur levée par `extractPiece` est le refus d'un bordereau reconnu à sa lecture (le code, jamais la phrase). */
export function estUnBordereauLu(erreur: unknown): boolean {
  const code = erreur !== null && typeof erreur === 'object' ? (erreur as { code?: unknown }).code : undefined
  return code === CODE_D_UN_BORDEREAU_LU
}

/** Lit le fichier par `extract-piece`. Ne rejette jamais. */
export async function lireAuDepot(source: Blob, nom: string): Promise<LectureAuDepot> {
  try {
    return { etat: 'lue', extraction: await extractPiece(source, nom) }
  } catch (erreur) {
    return estUnBordereauLu(erreur) ? { etat: 'bordereau' } : { etat: 'ratee' }
  }
}

/**
 * LE FICHIER CHOISI À LA MAIN, LU AVANT SON STOCKAGE (BOR6, troisième partie, ce qui restait : la fiche d'une pièce et l'onglet
 * Cotisations, 27/11/2026) : la même lecture que les deux chemins du dépôt, sous les mêmes conditions qu'`importFichiers` — un
 * format que Textract ne lit pas, ou un PDF trop lourd pour la lecture, n'est pas lu et rend `ratee` (le dépôt continue comme
 * hier, rien n'y est reconnu). Ne rejette jamais.
 */
export async function lireAvantLeStockage(fichier: File): Promise<LectureAuDepot> {
  if (!textractPeutLire(fichier.name) || pdfTropLourdPourEtreLu(fichier)) return { etat: 'ratee' }
  return lireAuDepot(fichier, fichier.name)
}
