import { Link } from 'react-router-dom'
import {
  LIBELLE_ALLER_AUX_FACTURES, LIBELLE_OUVRIR_MES_VENTES, NOM_DE_L_AVIS_DU_CABINET, NOM_DE_L_AVIS_DU_CLIENT, ceQueDitLAvis,
  type DestinataireDuChangement, type LectureDeLAvis,
} from '../lib/changementDeRib'
import { aujourdHuiAParis } from '../lib/format'
import type { DossierTab } from './DossierParcours'

// L'AVIS DU DERNIER CHANGEMENT DU RIB DES FACTURES (espace client, étape A5b3b ; conception : HISTORIQUE.md, « LA FRAUDE AU FAUX
// RIB » et « LE DERNIER CHANGEMENT DU RIB, EN BASE »). UNE ligne pour les deux espaces, `espace` OBLIGATOIRE : en tête de la Vue
// d'ensemble du cabinet, et sur l'accueil du client qui porte « Ventes » ou « Banque » sur la société affichée. L'écran LIT
// (`useDernierChangementDeRib`, lib/changementDeRibLecture.ts : le seul appel de la base) et passe la lecture ici, qui ne fait que
// la dire ; ce que la ligne dit, et combien de temps elle reste, vit dans lib/changementDeRib.ts (pur) — aucune phrase n'est
// réécrite ni recopiée ici.
//
// Quatre états, jamais un cinquième : pas de lecture (drapeau baissé, aucune case), ou pas revenue — RIEN, aucune affirmation avant
// la lecture, et l'écran qui porte l'avis ne l'attend pas ; lue sans changement à dire (`{ changement: null }`, ou un changement
// dont la durée est passée) — rien ; un changement à dire — une pastille (d'attention devant un RIB proposé, qui attend la
// confirmation du cabinet ; neutre sinon : le texte garde sa couleur, le statut se lit à la pastille), la phrase, ce que les
// factures porteront, le conseil ; lecture illisible ou refusée — une ligne DISCRÈTE, le motif en infobulle, jamais le silence
// d'un « aucun changement » qu'on croirait lu.
//
// Rien ne s'écrit d'ici (aucune marque « vu », aucune table) et aucune fenêtre ne s'ouvre : la Vue d'ensemble est une grille. Le
// cabinet est mené à l'onglet Factures (la vue « Paramètres » est un état local de l'onglet, que le bouton n'ouvre pas : son
// libellé ne le promet pas) ; le client « Ventes », à « Mes ventes » ; le client « Banque » seul n'a pas d'écran des paramètres,
// donc aucun lien.

type Props = { lecture: LectureDeLAvis | null; className?: string } & (
  | { espace: 'cabinet'; onNavigate: (tab: DossierTab) => void }
  | { espace: 'client'; destinataire: Exclude<DestinataireDuChangement, 'cabinet'> }
)

export default function AvisChangementDeRib(props: Props) {
  const { lecture, className, espace } = props
  const destinataire: DestinataireDuChangement = props.espace === 'cabinet' ? 'cabinet' : props.destinataire
  // Le jour à Paris, lu au rendu : la durée de l'avis se juge à ce jour, jamais à celui du chargement d'un module.
  const dit = ceQueDitLAvis(lecture, destinataire, aujourdHuiAParis())
  if (dit.genre === 'rien') return null

  const nom = espace === 'cabinet' ? NOM_DE_L_AVIS_DU_CABINET : NOM_DE_L_AVIS_DU_CLIENT
  const menerA = espace === 'cabinet'
    ? <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onNavigate('factures')}>{LIBELLE_ALLER_AUX_FACTURES}</button>
    : destinataire === 'ventes'
      ? <Link to="/mes-ventes" className="btn btn-outline btn-sm">{LIBELLE_OUVRIR_MES_VENTES}</Link>
      : null
  const classes = (suite: string) => `avis-rib${suite}${className ? ` ${className}` : ''}`

  if (dit.genre === 'lecture_manquee') {
    return (
      <section className={classes(' avis-rib-discret')} aria-label={nom}>
        <p className="avis-rib-phrase muted" title={dit.motif ?? undefined}>{dit.phrase}</p>
        {menerA}
      </section>
    )
  }
  return (
    <section className={classes(dit.attend ? ' avis-rib-attente' : '')} aria-label={nom}>
      <span className={`check-dot ${dit.attend ? 'check-attention' : 'check-neutre'}`} aria-hidden="true" />
      <div className="avis-rib-corps">
        <p className="avis-rib-phrase">{dit.avis.phrase}</p>
        <p className="avis-rib-texte">{dit.avis.factures}</p>
        {dit.avis.conseil !== null && <p className="avis-rib-texte">{dit.avis.conseil}</p>}
      </div>
      {menerA}
    </section>
  )
}
