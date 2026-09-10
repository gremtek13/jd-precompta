// Anneau d'avancement — la piste non remplie est une teinte plus claire de la même couleur que le
// remplissage (jamais un gris étranger), pour que l'état se lise sur tout l'anneau. La valeur au
// centre reste en couleur de texte (voir guide de visualisation : le texte ne porte pas la couleur
// de la donnée).
export default function ProgressRing({
  ratio, taille = 72, epaisseur = 8, statut = 'ok', libelle,
}: { ratio: number; taille?: number; epaisseur?: number; statut?: 'ok' | 'warning' | 'danger'; libelle?: string }) {
  const r = (taille - epaisseur) / 2
  const circonference = 2 * Math.PI * r
  const borne = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0))
  return (
    <div className="ring" style={{ width: taille, height: taille }} role="img" aria-label={libelle ?? `${Math.round(borne * 100)} %`}>
      <svg width={taille} height={taille} viewBox={`0 0 ${taille} ${taille}`} aria-hidden="true">
        <circle cx={taille / 2} cy={taille / 2} r={r} className={`ring-piste ring-piste-${statut}`} strokeWidth={epaisseur} />
        <circle
          cx={taille / 2} cy={taille / 2} r={r}
          className={`ring-valeur ring-valeur-${statut}`}
          strokeWidth={epaisseur}
          strokeDasharray={`${circonference * borne} ${circonference}`}
          transform={`rotate(-90 ${taille / 2} ${taille / 2})`}
        />
      </svg>
      <span className="ring-texte">{Math.round(borne * 100)}<small>%</small></span>
    </div>
  )
}
