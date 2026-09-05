import { ICONES_PARCOURS } from './icons'

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
  | 'virements'
  | 'acces'
  | 'assistant'

interface Etape {
  id: DossierTab
  label: string
}

// Le cœur du parcours : de la collecte des justificatifs à la clôture de l'exercice, dans l'ordre où
// un dossier progresse réellement (import → pièces → rapprochement bancaire → écritures →
// immobilisations → cotisations → clôture). Une étape avant l'étape courante est mise en avant comme
// "parcourue" — un repère de navigation, pas un statut d'avancement réel (les pièces/le rapprochement
// continuent d'arriver toute l'année, rien n'est jamais vraiment "terminé" avant la clôture).
const ETAPES: Etape[] = [
  { id: 'checklist', label: 'Checklist' },
  { id: 'documents', label: 'Documents' },
  { id: 'pieces', label: 'Pièces' },
  { id: 'banque', label: 'Banque' },
  { id: 'ecritures', label: 'Écritures' },
  { id: 'immobilisations', label: 'Immos' },
  { id: 'cotisations', label: 'Cotisations' },
  { id: 'cloture', label: 'Clôture' },
]

// Outils transverses, utilisables à tout moment de l'année plutôt qu'à une étape précise du parcours
// — affichés séparément pour ne pas casser la lecture linéaire de la ligne principale.
const OUTILS: Etape[] = [
  { id: 'informations', label: 'Informations' },
  { id: 'estimation', label: 'Estimation' },
  { id: 'virements', label: 'Virements' },
  { id: 'packs', label: 'Packs' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'acces', label: 'Accès' },
]

export default function DossierParcours({ tab, onChange }: { tab: DossierTab; onChange: (t: DossierTab) => void }) {
  const indexActuel = ETAPES.findIndex((e) => e.id === tab)

  return (
    <div style={{ marginBottom: 22 }}>
      <div className="parcours">
        {ETAPES.map((etape, i) => {
          const Icone = ICONES_PARCOURS[etape.id]
          return (
            <div className="parcours-etape-wrap" key={etape.id}>
              {i > 0 && <div className={`parcours-connecteur ${i <= indexActuel ? 'franchi' : ''}`} />}
              <button
                type="button"
                className={`parcours-etape ${etape.id === tab ? 'active' : ''} ${indexActuel >= 0 && i < indexActuel ? 'passe' : ''}`}
                onClick={() => onChange(etape.id)}
              >
                <span className="parcours-cercle"><Icone /></span>
                <span className="parcours-label">{etape.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      <div className="parcours-outils">
        <span className="muted" style={{ alignSelf: 'center' }}>Outils :</span>
        {OUTILS.map((etape) => {
          const Icone = ICONES_PARCOURS[etape.id]
          return (
            <button
              key={etape.id}
              type="button"
              className={`parcours-outil ${etape.id === tab ? 'active' : ''}`}
              onClick={() => onChange(etape.id)}
            >
              <Icone width={15} height={15} /> {etape.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
