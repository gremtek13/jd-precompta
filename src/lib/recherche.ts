// Filtre texte partagé par les listes des onglets d'un dossier (Pièces, Documents, Écritures,
// Factures, Banque, Immobilisations, Cotisations, Suppléments, Statistiques).
//
// Écrit une fois plutôt que réimplémenté à chaque écran : Banque et Statistiques avaient chacun leur
// version en `toLowerCase().includes()`, ni insensible aux accents ni multi-mots. Chercher « releve »
// ne trouvait donc pas « Relevé », et « edf janvier » ne trouvait rien du tout alors que les deux
// mots sont là — le genre d'échec qui fait conclure « il n'y a rien » sur une liste qui contient la
// ligne cherchée.
//
// Trois règles, toutes venues de l'usage réel :
//   - accents ignorés des deux côtés, parce qu'on ne tape pas les accents dans une barre de recherche ;
//   - virgule décimale ramenée au point, pour que « 192,00 » et « 192.00 » trouvent le même montant
//     (repris de la recherche de BanqueTab, qui gérait déjà ce cas) ;
//   - plusieurs mots = tous doivent être présents, dans n'importe quel ordre et n'importe quel champ.
export function normaliserPourRecherche(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,/g, '.')
}

// `champs` : ce que l'utilisateur voit sur la ligne. Un nombre est comparé avec deux décimales
// (« 192 » comme « 192,00 » trouvent un montant de 192). Les valeurs absentes sont ignorées plutôt
// que converties en « null »/« undefined », qui deviendraient cherchables par accident.
export function correspondALaRecherche(
  champs: (string | number | null | undefined)[],
  recherche: string,
): boolean {
  const termes = normaliserPourRecherche(recherche).split(/\s+/).filter(Boolean)
  if (termes.length === 0) return true

  // Jointure par une espace : un terme ne contient jamais d'espace (on vient de découper dessus),
  // donc aucun terme ne peut chevaucher deux champs par accident.
  const contenu = champs
    .filter((c): c is string | number => c !== null && c !== undefined && c !== '')
    .map((c) => normaliserPourRecherche(typeof c === 'number' ? c.toFixed(2) : c))
    .join(' ')

  return termes.every((terme) => contenu.includes(terme))
}
