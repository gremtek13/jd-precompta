import type { EtatDeLaCarteDeLInventaire } from '../../lib/inventaireDesControles'
import type { DossierTab } from '../../lib/ongletsDossier'

// LA CARTE « INVENTAIRE » DE LA CLÔTURE (ligne 35, INV6 ; conception 35, § 5.7) : un exercice d'un dossier en engagement,
// l'onglet Inventaire offert (`INVENTAIRE_EXPORTE`). Elle MONTRE ce que le module juge (lib/inventaireDesControles.ts,
// `etatDeLaCarteDeLInventaire`) et n'en réécrit aucune règle : combien de régularisations sont saisies, combien ne sont plus à
// jour, et si l'inventaire est déclaré. Elle n'écrit rien : son seul geste mène à l'onglet Inventaire, où tout se saisit. Une
// carte parmi les cartes de la Clôture, hors de toute grille, sans fenêtre. Avant lecture, l'attente ; sur une lecture
// partielle, le motif, sans un chiffre.
export default function InventaireDeLaClotureCard({ exercice, etat, onNavigate }: {
  exercice: number
  etat: EtatDeLaCarteDeLInventaire
  onNavigate?: (tab: DossierTab) => void
}) {
  if (etat.etat === 'sans_objet') return null
  const titre = etat.etat === 'prete' ? etat.carte.titre : `Inventaire ${exercice}`
  const enAttention = etat.etat === 'partielle' || (etat.etat === 'prete' && etat.carte.aFaire)
  return (
    <section
      className="card" aria-label={titre}
      style={{ marginBottom: 20, ...(enAttention ? { borderLeft: '3px solid var(--color-warning)' } : {}) }}
    >
      <h3 style={{ marginTop: 0 }}>{titre}</h3>
      {etat.etat === 'chargement' && <p className="muted" style={{ margin: 0 }}>Chargement…</p>}
      {etat.etat === 'partielle' && (
        <p className="error-text" style={{ margin: 0 }}>
          {`Lecture incomplète — ${etat.motif}. La carte ne dit rien de l’inventaire tant qu’elle ne l’a pas lu en entier ; la `
            + 'validation se suspend pour la même raison. Recharge la page.'}
        </p>
      )}
      {etat.etat === 'prete' && (
        <>
          <p className="muted" style={{ marginTop: -8 }}>{etat.carte.phrase}</p>
          {onNavigate && (
            <div className="fiche-mouvement-boutons">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('inventaire')}>
                Ouvrir l’inventaire
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
