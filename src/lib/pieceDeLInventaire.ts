// LA PIÈCE D'UNE ÉCRITURE D'INVENTAIRE (ligne 35, INV3 ; lib/inventaireDeLaValidation.ts) : un module sans import, que le
// FEC (lib/fec.ts), la numérotation que la validation contrôle (lib/validationExercice.ts) et la piste d'audit
// (lib/pisteAudit.ts) lisent tous trois — la validation l'importe sans entraîner le module de l'inventaire, qui importe
// lib/amortissements.ts, qui l'importe elle-même.

/**
 * L'exercice de la régularisation qu'une ligne d'inventaire cite, lu sur sa date : la base n'en date une qu'au 31 décembre de
 * cet exercice (sa constatation) ou au 1er janvier suivant (son extourne) — contrainte `ecritures_brouillon_inventaire_sans_autre_source`
 * et garde `garder_ecriture_d_inventaire` (INV2).
 */
export function exerciceDeLaLigneDInventaire(date: string): number {
  const annee = Number(date.slice(0, 4))
  return date.slice(5, 10) === '01-01' ? annee - 1 : annee
}

/** La pièce de l'écriture d'une régularisation, au FEC et dans la validation : l'état d'inventaire de son exercice, « Inventaire
 *  AAAA », daté du 31 décembre de cet exercice (INV-Q7 (A)). */
export function referenceDeLInventaire(exercice: number): string {
  return `Inventaire ${exercice}`
}
