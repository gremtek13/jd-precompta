import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { IconChevron } from './icons'
import Avatar from './widgets/Avatar'
import { GROUPES_PARCOURS, type IdGroupeParcours } from '../lib/ongletsDossier'
import { correspondALaRecherche } from '../lib/recherche'
import type { DossierDeBarre } from '../lib/listeDossiers'

// Dossiers de la barre latérale (ordinateur) : le dossier ouvert avec TOUS ses écrans d'un coup, puis
// les autres dossiers, à un clic chacun. Remplace, sur ordinateur, la barre d'onglets à menus
// déroulants du dossier (DossierParcours), où la moitié des écrans restait cachée derrière un clic, et
// le passage obligé par le tableau de bord pour changer de dossier.
//
// Réduite, la barre ne garde que les pastilles des dossiers : l'arborescence n'y tient pas, et c'est
// alors DossierParcours qui réapparaît en haut du dossier (voir index.css).

const DESTINATIONS = GROUPES_PARCOURS.filter((g) => g.cible)
const REGROUPEMENTS = GROUPES_PARCOURS.filter((g) => g.enfants)

// Groupes que l'opérateur a lui-même dépliés ou repliés — préférence d'affichage de ce navigateur,
// comme le thème. Sans choix enregistré, un groupe s'ouvre s'il contient l'écran affiché, et
// « Documents » s'ouvre toujours : c'est là que vivent les justificatifs, l'écran le plus fréquenté.
const CLE_GROUPES = 'jd-precompta-barre-groupes'
const GROUPE_OUVERT_PAR_DEFAUT: IdGroupeParcours = 'documents-groupe'

function lireGroupes(): Record<string, boolean> {
  try {
    const lu: unknown = JSON.parse(localStorage.getItem(CLE_GROUPES) ?? '{}')
    return lu !== null && typeof lu === 'object' ? (lu as Record<string, boolean>) : {}
  } catch {
    // Stockage indisponible ou valeur illisible : on repart des ouvertures par défaut.
    return {}
  }
}

export default function BarreDossiers({ dossiers, chargement, motif, recherche, dossierOuvertId, ongletActif, reduite }: {
  dossiers: DossierDeBarre[]
  chargement: boolean
  motif: string | null
  recherche: string
  dossierOuvertId: string | null
  ongletActif: string | null
  reduite: boolean
}) {
  const [groupes, setGroupes] = useState<Record<string, boolean>>(lireGroupes)

  const groupeDeLOnglet = REGROUPEMENTS.find((g) => g.enfants?.some((e) => e.id === ongletActif))?.id ?? null
  // Dérivé plutôt que forcé par un effet : un groupe replié explicitement le reste, même quand l'écran
  // affiché y vit — son titre le signale alors (voir `barre-groupe-titre contient-actif`).
  const estOuvert = (id: IdGroupeParcours) => groupes[id] ?? (id === GROUPE_OUVERT_PAR_DEFAUT || id === groupeDeLOnglet)

  function basculer(id: IdGroupeParcours) {
    const suivants = { ...groupes, [id]: !estOuvert(id) }
    setGroupes(suivants)
    try {
      localStorage.setItem(CLE_GROUPES, JSON.stringify(suivants))
    } catch {
      // Préférence non retenue : elle vaut pour cette visite, rien de plus.
    }
  }

  const alerte = motif && (
    <p className="barre-alerte">
      Liste des dossiers incomplète ({motif}) : un dossier peut manquer ici.
    </p>
  )

  if (reduite) {
    return (
      <div className="barre-dossiers barre-dossiers-rail">
        <span className="barre-separateur" aria-hidden="true" />
        {motif && (
          <span className="barre-alerte-rail" role="img" aria-label="Liste des dossiers incomplète" title={`Liste des dossiers incomplète : ${motif}`}>!</span>
        )}
        {dossiers.map((d) => (
          <Link
            key={d.id}
            to={`/dossiers/${d.id}`}
            className={`barre-dossier-rail${d.id === dossierOuvertId ? ' actif' : ''}`}
            aria-label={d.nom}
            aria-current={d.id === dossierOuvertId ? 'page' : undefined}
            title={d.nom}
          >
            <Avatar nom={d.nom} taille={34} />
          </Link>
        ))}
      </div>
    )
  }

  const ouvert = dossierOuvertId ? dossiers.find((d) => d.id === dossierOuvertId) : undefined
  const autres = dossiers.filter((d) => d.id !== dossierOuvertId && correspondALaRecherche([d.nom], recherche))

  return (
    <div className="barre-dossiers">
      {dossierOuvertId && (
        <section className="barre-section" aria-label="Dossier ouvert">
          <div className="barre-titre">Dossier ouvert</div>
          <Link to={`/dossiers/${dossierOuvertId}/checklist`} className="barre-dossier barre-dossier-ouvert">
            {ouvert ? <Avatar nom={ouvert.nom} taille={26} /> : <span className="skeleton barre-avatar-attente" />}
            <span className="barre-nom">{ouvert?.nom ?? (chargement ? 'Chargement…' : 'Ce dossier')}</span>
          </Link>
          <div className="barre-arbre">
            {DESTINATIONS.map((g) => (
              <NavLink key={g.id} to={`/dossiers/${dossierOuvertId}/${g.cible}`} className="barre-lien">
                {g.label}
              </NavLink>
            ))}
            {REGROUPEMENTS.map((g) => {
              const deplie = estOuvert(g.id)
              const contientActif = g.id === groupeDeLOnglet
              return (
                <div key={g.id} className="barre-groupe">
                  <button
                    type="button"
                    className={`barre-groupe-titre${!deplie && contientActif ? ' contient-actif' : ''}`}
                    aria-expanded={deplie}
                    onClick={() => basculer(g.id)}
                  >
                    <span>{g.label}</span>
                    <IconChevron width={13} height={13} className={`barre-chevron${deplie ? ' deplie' : ''}`} aria-hidden="true" />
                  </button>
                  {deplie && g.enfants?.map((e) => (
                    <NavLink key={e.id} to={`/dossiers/${dossierOuvertId}/${e.id}`} className="barre-lien">
                      {e.label}
                    </NavLink>
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="barre-section" aria-label="Dossiers">
        <div className="barre-titre">Dossiers</div>
        {alerte}
        {chargement ? (
          <div className="barre-chargement" aria-busy="true" aria-label="Chargement des dossiers">
            <span className="skeleton skeleton-ligne" />
            <span className="skeleton skeleton-ligne" />
            <span className="skeleton skeleton-ligne" />
          </div>
        ) : (
          <>
            {autres.map((d) => (
              <Link key={d.id} to={`/dossiers/${d.id}`} className="barre-dossier">
                <Avatar nom={d.nom} taille={26} />
                <span className="barre-nom">{d.nom}</span>
              </Link>
            ))}
            {autres.length === 0 && recherche.trim() !== '' && (
              <p className="barre-vide">Aucun dossier ne correspond à « {recherche.trim()} ».</p>
            )}
            {/* Seulement sur une lecture COMPLÈTE : une lecture refusée rend aussi une liste vide, et
                « aucun dossier » deviendrait alors une affirmation fausse au lieu d'une panne dite. */}
            {dossiers.length === 0 && !motif && recherche.trim() === '' && (
              <p className="barre-vide">Aucun dossier pour l’instant.</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
