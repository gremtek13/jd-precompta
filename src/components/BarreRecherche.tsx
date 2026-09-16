// Champ de recherche commun aux listes d'un dossier. Un seul composant plutôt qu'un <input> recopié
// par écran : même apparence, même placeholder, même comportement — et surtout le même décompte, qui
// distingue « ma recherche ne donne rien » de « la liste est vide », deux situations que les écrans
// confondaient en affichant le même « Aucun résultat ».
//
// Le filtrage lui-même reste à l'appelant (voir lib/recherche.ts) : chaque liste sait seuls quels
// champs sont pertinents chez elle, et c'est ce qui doit rester explicite dans chaque onglet.
interface Props {
  valeur: string
  onChange: (valeur: string) => void
  placeholder: string
  // Affiché uniquement pendant une recherche active — sinon c'est du bruit sur une liste complète.
  affiches: number
  total: number
}

export default function BarreRecherche({ valeur, onChange, placeholder, affiches, total }: Props) {
  const actif = valeur.trim().length > 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input
        // type="search" : le navigateur ajoute sa croix d'effacement et la touche Échap vide le champ,
        // sans qu'on ait à recoder un bouton.
        type="search"
        className="recherche"
        placeholder={placeholder}
        aria-label={placeholder}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
      />
      {actif && (
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          {affiches === 0 ? 'aucun résultat' : `${affiches} sur ${total}`}
        </span>
      )}
    </div>
  )
}
