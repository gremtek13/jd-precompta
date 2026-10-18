import { useId } from 'react'
import { Link } from 'react-router-dom'
import { LIBELLE_ALLER_AUX_FACTURES } from '../lib/changementDeRib'
import { MENTION_DOSSIER_ARCHIVE, ceQueDitLaListe, type LectureDesDossiersAuRib } from '../lib/dossiersAuRibAConfirmer'
import { CONSEIL_VERIFICATION_RIB } from '../lib/parametresFacturationVue'

// LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET, sur son tableau de bord (espace client, étape A5b3d ; le
// pendant, pour tous les dossiers, de l'avis en tête de la Vue d'ensemble : `AvisChangementDeRib`). L'écran LIT
// (`useDossiersAuRibAConfirmer`, lib/dossiersAuRibAConfirmerLecture.ts : le seul appel de la base) et passe la lecture ici, qui
// ne fait que la dire ; ce qu'elle dit vit dans lib/dossiersAuRibAConfirmer.ts (pur) — aucune phrase n'est réécrite ni recopiée.
//
// Quatre états, jamais un cinquième : pas de lecture (drapeau baissé, aucune clé), ou pas revenue — RIEN, aucune affirmation avant
// la lecture, et l'écran qui la porte ne l'attend pas ; la liste vide, lue en entier — RIEN aussi (comme l'avis de la Vue d'ensemble
// sur « le RIB n'a jamais changé » : ce qui n'attend personne ne se signale pas) ; la liste — la pastille d'attention, le compte,
// une ligne par dossier DANS L'ORDRE de la fonction (le plus ancien changement d'abord : jamais retrié ici) et le conseil de
// vérification dit UNE fois, car chaque ligne est une proposition ; la lecture illisible ou refusée — une ligne DISCRÈTE, le
// motif en infobulle, jamais le silence qu'on prendrait pour « aucun ».
//
// Rien ne s'écrit d'ici (aucune marque « vu ») et aucune fenêtre ne s'ouvre : le tableau de bord est une grille. Chaque ligne MÈNE
// à l'onglet Factures de SON dossier ; la vue « Paramètres » est un état local de l'onglet, que le lien n'ouvre pas : son libellé
// ne le promet pas. Le nom du dossier est un simple texte : le lien de la ligne est le seul geste.

export default function RibsAConfirmer({ lecture, className }: { lecture: LectureDesDossiersAuRib | null; className?: string }) {
  const dit = ceQueDitLaListe(lecture)
  // Les noms accessibles : le titre nomme la section, et le nom du dossier DÉCRIT son lien (le libellé du lien reste celui du module).
  const racine = useId()
  if (dit.genre === 'rien' || dit.genre === 'aucun') return null

  const classes = (suite: string) => `avis-rib ribs-a-confirmer${suite}${className ? ` ${className}` : ''}`
  const titre = `${racine}-titre`

  if (dit.genre === 'lecture_manquee') {
    return (
      <section className={classes(' avis-rib-discret')} aria-labelledby={titre}>
        <p id={titre} className="avis-rib-phrase muted" title={dit.motif ?? undefined}>{dit.phrase}</p>
      </section>
    )
  }
  return (
    <section className={classes(' avis-rib-attente')} aria-labelledby={titre}>
      <span className="check-dot check-attention" aria-hidden="true" />
      <div className="avis-rib-corps">
        <p id={titre} className="avis-rib-phrase">{dit.phrase}</p>
        <ul className="ribs-a-confirmer-lignes">
          {dit.lignes.map((l) => (
            <li key={l.dossierId} className="ribs-a-confirmer-ligne">
              <span className="ribs-a-confirmer-qui">
                <span id={`${racine}-${l.dossierId}`} className="ribs-a-confirmer-nom">{l.nom}</span>
                {l.archive && <span className="badge badge-neutral">{MENTION_DOSSIER_ARCHIVE}</span>}
              </span>
              <span className="ribs-a-confirmer-avis">{l.avis.phrase}</span>
              <Link
                to={`/dossiers/${l.dossierId}/factures`} className="btn btn-outline btn-sm"
                aria-describedby={`${racine}-${l.dossierId}`}
              >{LIBELLE_ALLER_AUX_FACTURES}</Link>
            </li>
          ))}
        </ul>
        <p className="avis-rib-texte">{CONSEIL_VERIFICATION_RIB}</p>
      </div>
    </section>
  )
}
