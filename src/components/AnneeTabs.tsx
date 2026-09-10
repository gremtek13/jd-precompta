export type ValeurAnnee = 'toutes' | 'sans_date' | number

// Sélecteur d'exercice en contrôle segmenté (un conteneur, l'option active en pastille) — soit
// partagé entre onglets via l'en-tête du dossier (voir AnneeContext, DossierDetail), soit local aux
// onglets dont la date n'est pas celle de l'exercice (Documents, Factures...). Ne s'affiche que si
// plusieurs années coexistent réellement dans les données — inutile sur un dossier qui débute.
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
    <div className="segmented" role="tablist" aria-label="Exercice">
      <button type="button" role="tab" aria-selected={valeur === 'toutes'} className={valeur === 'toutes' ? 'active' : ''} onClick={() => onChange('toutes')}>
        Toutes
      </button>
      {annees.map((a) => (
        <button key={a} type="button" role="tab" aria-selected={valeur === a} className={valeur === a ? 'active' : ''} onClick={() => onChange(a)}>
          {a}
        </button>
      ))}
      {sansDate && (
        <button type="button" role="tab" aria-selected={valeur === 'sans_date'} className={valeur === 'sans_date' ? 'active' : ''} onClick={() => onChange('sans_date')}>
          Sans date
        </button>
      )}
    </div>
  )
}
