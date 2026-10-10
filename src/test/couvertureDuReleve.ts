// LA COUVERTURE DU RELEVÉ TELLE QUE LA BASE LA REND (`couverture_du_releve`, migration `banque_du_client`, espace client
// P7) : les mois DISTINCTS où le relevé porte un mouvement, chacun à son premier jour, dans l'ordre. Les doublures des
// écrans client la déduisent des MÊMES mouvements que leur table `lignes_bancaires` — refusée, retenue et notée avec
// elle —, pour qu'un test d'écran vaille drapeau levé comme baissé (`COUVERTURE_EXPORTEE`) : la bascule ne doit faire
// virer au rouge que ce qui distingue les deux états (espaceClientAvantCouverture.test.tsx, *.couverture.test.tsx).
export function couvertureDe(lignes: readonly unknown[]): string[] {
  const mois = new Set<string>()
  for (const ligne of lignes) {
    const date = (ligne as { date?: unknown } | null)?.date
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      // Une doublure qui ne sait pas lire sa propre ligne le dit, plutôt que de rendre un relevé plus court.
      throw new Error(`couvertureDe : un mouvement sans date civile (${JSON.stringify(ligne)})`)
    }
    mois.add(`${date.slice(0, 7)}-01`)
  }
  return [...mois].sort()
}
