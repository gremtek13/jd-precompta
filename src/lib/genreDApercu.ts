// CE QUE L'APERÇU D'UN FICHIER SAIT MONTRER DANS LE VOLET (components/ApercuDuFichier.tsx) : une image, un PDF, ou rien —
// et alors l'aperçu le dit et garde le bouton qui l'ouvre en grand. Décidé sur l'extension du NOM, comme la fiche d'une
// pièce l'a toujours fait : le type rendu par le stockage n'est connu qu'après le téléchargement, et la fiche d'un
// document (16/11/2026) reprend la même règle plutôt qu'une seconde.
export type GenreDApercu = 'image' | 'pdf' | 'autre'

export function genreDApercu(nom: string): GenreDApercu {
  const ext = nom.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'autre'
}
