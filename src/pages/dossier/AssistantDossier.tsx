import { IconAssistant } from '../../components/icons'
import PanneauDroit from '../../components/PanneauDroit'
import { usePanneauDroit } from '../../lib/panneauDroit'
import AssistantTab from './AssistantTab'

// L'assistant n'est pas une étape du dossier : il sert « à tout moment, sur n'importe quelle
// question » (voir audit ergonomie), d'où sa place hors des onglets. Sur ordinateur il occupe le
// panneau de droite, la liste restant visible à côté ; sur mobile le même volet devient la carte
// flottante d'avant (voir .panneau-droit dans index.css) — une seule conversation, deux présentations.
const NOM = 'assistant'

export default function AssistantDossier({ dossierId, dossierNom }: { dossierId: string; dossierNom: string | null }) {
  const { ouvert, basculer, fermer } = usePanneauDroit(NOM)
  return (
    <>
      {/* `key` : une instance par dossier. Cette page ne se remonte pas quand on passe d'un dossier à
          l'autre par la barre latérale, et le volet reste ouvert — sans la clé, la conversation du
          dossier précédent resterait sélectionnée (le message suivant partirait dans son fil, sous le
          nouveau dossier), et une lecture plus lente de son historique pourrait arriver APRÈS celle du
          nouveau et la remplacer. */}
      <PanneauDroit nom={NOM}>
        <AssistantTab key={dossierId} dossierId={dossierId} dossierNom={dossierNom} onFermer={fermer} />
      </PanneauDroit>

      {/* La bulle d'ouverture, sur mobile seulement : sur ordinateur, c'est le bouton de l'en-tête du
          dossier (BoutonAssistant) — deux boutons, un seul volet. */}
      <button
        type="button"
        onClick={basculer}
        aria-label={ouvert ? "Fermer l'assistant" : "Ouvrir l'assistant"}
        aria-expanded={ouvert}
        aria-controls="panneau-droit"
        className="assistant-bouton"
      >
        <IconAssistant width={24} height={24} />
      </button>
    </>
  )
}

// Le bouton de l'en-tête du dossier, sur ordinateur (voir la maquette validée : à côté du sélecteur
// d'exercice). Enfoncé tant que l'assistant occupe le panneau — un autre contenu qui prend sa place le
// relâche de lui-même.
export function BoutonAssistant() {
  const { ouvert, basculer } = usePanneauDroit(NOM)
  return (
    <button
      type="button"
      className={`bouton-assistant${ouvert ? ' actif' : ''}`}
      onClick={basculer}
      aria-pressed={ouvert}
      aria-controls="panneau-droit"
    >
      <IconAssistant width={16} height={16} />
      Assistant
    </button>
  )
}
