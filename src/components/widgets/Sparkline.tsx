// Tendance miniature (voir KpiTile) — historique en gris discret, dernier segment et point courant en
// couleur d'accent : l'œil va droit à "où on en est maintenant", le reste n'est que contexte. Ligne
// 2 px à bouts ronds, aire à 10 % d'opacité, point ≥ 8 px cerclé de la couleur de surface pour rester
// lisible là où il croise la ligne (voir guide de visualisation). Taille fixe en pixels plutôt que
// 100 % étiré : un SVG étiré déforme les épaisseurs de trait et transforme le point en ellipse.
export default function Sparkline({ valeurs, largeur = 120, hauteur = 36 }: { valeurs: number[]; largeur?: number; hauteur?: number }) {
  if (valeurs.length < 2) return null
  const min = Math.min(...valeurs)
  const max = Math.max(...valeurs)
  const marge = 5
  const x = (i: number) => marge + (i / (valeurs.length - 1)) * (largeur - marge * 2)
  const y = (v: number) => (max === min ? hauteur / 2 : marge + (1 - (v - min) / (max - min)) * (hauteur - marge * 2))
  const points = valeurs.map((v, i) => [x(i), y(v)] as const)
  const ligne = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ')
  const aire = `${ligne} L${x(valeurs.length - 1).toFixed(1)} ${hauteur} L${x(0).toFixed(1)} ${hauteur} Z`
  const [dx, dy] = points[points.length - 1]
  const [ax, ay] = points[points.length - 2]

  return (
    <svg className="sparkline" width={largeur} height={hauteur} viewBox={`0 0 ${largeur} ${hauteur}`} aria-hidden="true">
      <path d={aire} className="sparkline-aire" />
      <path d={ligne} className="sparkline-ligne" />
      <path d={`M${ax.toFixed(1)} ${ay.toFixed(1)} L${dx.toFixed(1)} ${dy.toFixed(1)}`} className="sparkline-actuel" />
      <circle cx={dx} cy={dy} r={4} className="sparkline-point" />
    </svg>
  )
}
