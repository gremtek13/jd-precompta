export type DossierTab =
  | 'checklist'
  | 'documents'
  | 'pieces'
  | 'banque'
  | 'ecritures'
  | 'immobilisations'
  | 'cotisations'
  | 'cloture'
  | 'estimation'
  | 'packs'
  | 'informations'
  | 'acces'

interface Etape {
  id: DossierTab
  label: string
  icone: string
}

// Le cœur du parcours : de la collecte des justificatifs à la clôture de l'exercice, dans l'ordre où
// un dossier progresse réellement (import → pièces → rapprochement bancaire → écritures →
// immobilisations → cotisations → clôture). Une étape avant l'étape courante est mise en avant comme
// "parcourue" — un repère de navigation, pas un statut d'avancement réel (les pièces/le rapprochement
// continuent d'arriver toute l'année, rien n'est jamais vraiment "terminé" avant la clôture).
const ETAPES: Etape[] = [
  { id: 'checklist', label: 'Checklist', icone: '✅' },
  { id: 'documents', label: 'Documents', icone: '📥' },
  { id: 'pieces', label: 'Pièces', icone: '🧾' },
  { id: 'banque', label: 'Banque', icone: '🏦' },
  { id: 'ecritures', label: 'Écritures', icone: '📓' },
  { id: 'immobilisations', label: 'Immos', icone: '🏷️' },
  { id: 'cotisations', label: 'Cotisations', icone: '💶' },
  { id: 'cloture', label: 'Clôture', icone: '🏁' },
]

// Outils transverses, utilisables à tout moment de l'année plutôt qu'à une étape précise du parcours
// — affichés séparément pour ne pas casser la lecture linéaire de la ligne principale.
const OUTILS: Etape[] = [
  { id: 'informations', label: 'Informations', icone: '📋' },
  { id: 'estimation', label: 'Estimation', icone: '📈' },
  { id: 'packs', label: 'Packs', icone: '📦' },
  { id: 'acces', label: 'Accès', icone: '🔑' },
]

export default function DossierParcours({ tab, onChange }: { tab: DossierTab; onChange: (t: DossierTab) => void }) {
  const indexActuel = ETAPES.findIndex((e) => e.id === tab)

  return (
    <div style={{ marginBottom: 22 }}>
      <div className="parcours">
        {ETAPES.map((etape, i) => (
          <div className="parcours-etape-wrap" key={etape.id}>
            {i > 0 && <div className={`parcours-connecteur ${i <= indexActuel ? 'franchi' : ''}`} />}
            <button
              type="button"
              className={`parcours-etape ${etape.id === tab ? 'active' : ''} ${indexActuel >= 0 && i < indexActuel ? 'passe' : ''}`}
              onClick={() => onChange(etape.id)}
            >
              <span className="parcours-cercle">{etape.icone}</span>
              <span className="parcours-label">{etape.label}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="parcours-outils">
        <span className="muted" style={{ alignSelf: 'center' }}>Outils :</span>
        {OUTILS.map((etape) => (
          <button
            key={etape.id}
            type="button"
            className={`parcours-outil ${etape.id === tab ? 'active' : ''}`}
            onClick={() => onChange(etape.id)}
          >
            <span>{etape.icone}</span> {etape.label}
          </button>
        ))}
      </div>
    </div>
  )
}
