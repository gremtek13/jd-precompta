import { dateRelative } from '../lib/format'
import { IconPieces } from '../components/icons'
import { nomAccessibleDuGeste, type FichierDUnEnvoi } from '../lib/ouvertureDeMesPieces'
import { useOuvertureDeMesPieces } from '../lib/ouvertureDeMesPiecesGeste'

// « MES DERNIERS ENVOIS » DE L'ACCUEIL DU CLIENT : chaque ligne OUVRE son fichier (demande du cabinet du 16/11/2026). Elle
// menait à « Mes pièces », où le fichier ne s'ouvrait pas non plus ; « Tout voir » y mène toujours. La ligne entière est le
// bouton — la cible la plus large au doigt sur un téléphone —, et elle ne montre que ce qu'elle montrait : le statut dit au
// client, le nom du fichier, la date. Le geste est celui de « Mes pièces » (lib/ouvertureDeMesPiecesGeste.ts), sous verrou.

export interface EnvoiDeLAccueil {
  id: string
  nomFichier: string
  createdAt: string
  label: string
  /** Le fichier désigné par le module pur, ou nul quand la ligne n'en désigne aucun dans son dossier (l'échec se dit). */
  fichier: FichierDUnEnvoi | null
}

export default function DerniersEnvoisAccueil({ envois }: { envois: readonly EnvoiDeLAccueil[] }) {
  const ouverture = useOuvertureDeMesPieces()
  return (
    <>
      {ouverture.refus && <p className="error-text" role="alert" style={{ padding: '10px 20px 0', margin: 0 }}>{ouverture.refus}</p>}
      <div className="feed">
        {envois.map((d) => (
          <button
            key={d.id}
            type="button"
            className="feed-item feed-item-bouton"
            aria-label={`${nomAccessibleDuGeste(d.nomFichier)} (${d.label})`}
            disabled={ouverture.enCours}
            onClick={() => { void ouverture.ouvrir(d.fichier) }}
          >
            <span className="feed-icone"><IconPieces width={16} height={16} /></span>
            <span className="feed-texte">
              <strong>{d.label}</strong>
              <span className="feed-fichier">{d.nomFichier}</span>
            </span>
            <span className="feed-date">{dateRelative(d.createdAt)}</span>
          </button>
        ))}
      </div>
    </>
  )
}
