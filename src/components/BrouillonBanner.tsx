// Rappel permanent affiché sur chaque écran du brouillon comptable (Palier 5) — non négociable,
// voir la règle posée dès la conception de cette brique : jamais présenté comme une comptabilité
// tenue, toujours à valider par un expert-comptable inscrit.
export default function BrouillonBanner() {
  return (
    <div className="brouillon-banner">
      <strong>Brouillon</strong> — ces propositions ne remplacent jamais la tenue de comptabilité et doivent être
      vérifiées et validées par un expert-comptable inscrit avant tout usage fiscal ou légal.
    </div>
  )
}
