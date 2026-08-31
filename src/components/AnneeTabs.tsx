export type ValeurAnnee = 'toutes' | 'sans_date' | number

// Filtre par année réutilisé dans chaque onglet dont la liste s'accumule sur plusieurs exercices (un
// dossier est par client, pas par année — voir Estimation) : Pièces, Documents, Banque, Écritures,
// Immobilisations, Cotisations, Clôture. Ne s'affiche que si plusieurs années coexistent réellement
// dans les données (pas une liste figée) — inutile de montrer un filtre sur un dossier qui débute.
export default function AnneeTabs({
  annees,
  valeur,
  onChange,
  sansDate,
}: {
  annees: number[]
  valeur: ValeurAnnee
  onChange: (v: ValeurAnnee) => void
  sansDate?: boolean
}) {
  if (annees.length <= 1 && !sansDate) return null

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <button className={`btn btn-sm ${valeur === 'toutes' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onChange('toutes')}>
        Toutes années
      </button>
      {annees.map((a) => (
        <button key={a} className={`btn btn-sm ${valeur === a ? 'btn-primary' : 'btn-outline'}`} onClick={() => onChange(a)}>
          {a}
        </button>
      ))}
      {sansDate && (
        <button className={`btn btn-sm ${valeur === 'sans_date' ? 'btn-primary' : 'btn-outline'}`} onClick={() => onChange('sans_date')}>
          Sans date
        </button>
      )}
    </div>
  )
}
