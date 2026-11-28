// UNE MISE À JOUR RETIENT LA VERSION QU'ELLE REMPLACE (audit des écritures directes du navigateur, 28/11/2026).
//
// Un formulaire rempli par une lecture, puis réécrit champ par champ par `.update(…).eq('id', …)`, écrase ce qu'une autre
// session a changé depuis la lecture : deux onglets ouverts, le second l'emporte sans rien dire. Et une mise à jour que la
// base n'applique pas — la policy l'écarte, une garde la filtre, la ligne a changé — ne lève RIEN : PostgREST rend zéro
// ligne sans erreur. D'où les deux gestes, toujours ensemble :
//   1. les colonnes lues en filtres de la mise à jour (`retenirLaVersionLue`) : la ligne n'est écrite que si elle est
//      encore telle que l'écran l'a lue ;
//   2. la ligne rendue lue (`.select('id').maybeSingle()`) : aucune ligne veut dire « changé depuis, ou refusé », jamais
//      un succès.
// Aucune table de ces écrans ne porte de colonne de version que la base tienne : `pieces.updated_at` n'est posée qu'à
// l'insertion (aucun déclencheur ne la met à jour), elle ne prouverait rien. Les colonnes elles-mêmes font la version.
//
// Le scanner `misesAJourAvecLeurVersion.test.ts` garde le second geste sur toute mise à jour de `src/`.

/** Ce dont ce module se sert d'une requête de PostgREST : ses deux filtres d'égalité. */
export interface FiltrableParVersion<R> {
  eq(colonne: string, valeur: string | number | boolean): R
  is(colonne: string, valeur: null): R
}

/** Une valeur lue qu'un filtre d'égalité peut retenir. */
type ValeurRetenue = string | number | boolean | null

/**
 * Les `colonnes` de la ligne `lue` en filtres de la `requete` : `.is(colonne, null)` pour une valeur vide, `.eq(colonne, v)`
 * sinon. Une colonne que la lecture ne porte pas (`undefined`) ou dont la valeur n'est pas simple LÈVE : retenir une version
 * sans elle laisserait passer ce qu'on croit garder, et le dire au premier essai vaut mieux qu'un filtre muet.
 */
export function retenirLaVersionLue<R extends FiltrableParVersion<R>>(
  requete: R,
  lue: Readonly<Record<string, unknown>>,
  colonnes: readonly string[],
): R {
  let suite = requete
  for (const colonne of colonnes) {
    const valeur = lue[colonne]
    if (valeur === undefined) throw new Error(`Version lue : la colonne « ${colonne} » n’est pas dans la lecture.`)
    if (valeur !== null && typeof valeur !== 'string' && typeof valeur !== 'number' && typeof valeur !== 'boolean') {
      throw new Error(`Version lue : la colonne « ${colonne} » ne se retient pas par un filtre d’égalité.`)
    }
    const retenue = valeur as ValeurRetenue
    suite = retenue === null ? suite.is(colonne, null) : suite.eq(colonne, retenue)
  }
  return suite
}

/** Les colonnes d'une modification partielle (`{ champ: valeur }`) : celles qu'un geste d'un seul champ retient. */
export function colonnesDe(modification: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(modification)
}
