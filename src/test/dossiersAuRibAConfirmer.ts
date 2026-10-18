import type { ChangementDeRib } from '../lib/changementDeRib'
import { changementFictif } from './changementDeRib'

// LA LISTE DES DOSSIERS AU RIB À CONFIRMER, FICTIVE, telle que `dossiers_au_rib_a_confirmer` la rend (espace client, étape A5b3d) :
// `{ dossiers: [...] }`, chaque élément `{ dossier_id, nom, archive, changement }`, le changement aux clés de
// `dernier_changement_de_rib` (src/test/changementDeRib.ts). Les tests de l'écran la posent telle quelle ; le module la relit sans
// rien deviner, donc une forme fautive ici ferait rendre « illisible » — ce que les tests de l'écran veulent aussi, à dessein.

/** L'identifiant canonique du n-ième dossier fictif, tel que PostgreSQL l'écrit dans un `jsonb`. */
export const idDuDossierFictif = (n: number) => `a5b3d000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Un élément de la liste : un dossier fictif dont le dernier changement du RIB est une proposition (par défaut du 12/10/2026). */
export function elementRendu(n: number, o: { nom?: string; archive?: boolean; changement?: Partial<ChangementDeRib> } = {}): Record<string, unknown> {
  const c = changementFictif({ etat: 'propose', ...o.changement })
  const changement = { jour: c.jour, geste: c.geste, auteur: c.auteur, etat: c.etat, rib_en_vigueur: c.ribEnVigueur }
  return { dossier_id: idDuDossierFictif(n), nom: o.nom ?? `Dossier fictif ${n}`, archive: o.archive ?? false, changement }
}

/** La valeur que la base rend : les éléments dans l'ordre donné (c'est à l'appelant de les donner dans l'ordre de la fonction). */
export function listeRendue(...elements: Record<string, unknown>[]): unknown {
  return { dossiers: elements }
}
