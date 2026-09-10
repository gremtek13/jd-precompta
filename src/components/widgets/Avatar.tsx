// Initiales sur pastille teintée — un repère visuel par dossier/tiers dans les listes, à la place d'une
// colonne de texte nu. Une seule teinte (celle du cabinet) plutôt qu'une couleur par nom : la variété
// de couleurs n'aurait porté aucune information et se serait heurtée à la charte de chaque cabinet.
export function initiales(nom: string): string {
  const mots = nom.trim().split(/[\s\-_]+/).filter(Boolean)
  if (mots.length === 0) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}

export default function Avatar({ nom, taille = 36 }: { nom: string; taille?: number }) {
  return (
    <span className="avatar" style={{ width: taille, height: taille, fontSize: taille * 0.36 }} aria-hidden="true">
      {initiales(nom)}
    </span>
  )
}
