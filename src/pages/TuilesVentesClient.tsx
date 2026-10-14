import { Link, useNavigate } from 'react-router-dom'
import { aujourdHuiAParis } from '../lib/format'
import { compterLesPastilles } from '../lib/tuilesVentes'
import type { VentesDuClient } from '../lib/ventesDuClientLecture'
import KpiTile from '../components/widgets/KpiTile'

// « À ENCAISSER » ET « À DÉCLARER » SUR L'ACCUEIL DU CLIENT (espace client, étape P4b ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.2). Monté par l'accueil seulement si « Mes ventes »
// est ouvert (`mesVentesOuvertes`) ; chaque tuile mène à « Mes ventes ».
//
// Depuis l'étape A6b2, il ne LIT plus : l'accueil lit les ventes UNE fois (`useVentesDuClient`, lib/ventesDuClientLecture.ts :
// les cases relues à la base, le statut de TVA, les listes de l'onglet Factures) et passe la lecture à ces tuiles comme à
// l'encart « Facture électronique », qui en tire « ce qui attend ». Les pastilles sont COMPTÉES (lib/tuilesVentes.ts).
// Pas encore revenu : des squelettes. Une lecture partielle ou en échec : aucun chiffre — un « 0 » serait faux —, une phrase
// qui le dit et mène à « Mes ventes ». Sans la case, rien.

export default function TuilesVentesClient({ dossierId, ventes }: { dossierId: string; ventes: VentesDuClient }) {
  const navigate = useNavigate()

  if (ventes.etat === 'chargement') {
    return (
      <>
        <div className="skeleton skeleton-kpi span-6" aria-busy="true" aria-label="Chargement de tes ventes" />
        <div className="skeleton skeleton-kpi span-6" aria-busy="true" aria-label="Chargement de tes ventes" />
      </>
    )
  }
  if (ventes.etat === 'sans_ventes') return null

  // Le jour à Paris, lu au rendu comme l'onglet le lit : une déclaration en retard l'est au jour de la base.
  const comptes = ventes.etat === 'lu'
    ? compterLesPastilles(dossierId, ventes.listes, ventes.statutTva, aujourdHuiAParis())
    : { etat: 'muettes' as const, motif: ventes.motif }

  if (comptes.etat === 'muettes') {
    return (
      <p className="muted span-12" style={{ margin: 0 }}>
        Tes ventes n’ont pas pu être toutes lues ({comptes.motif}) : ce qu’il te reste à encaisser et à déclarer ne se compte
        pas ici. <Link to="/mes-ventes">Mes ventes</Link> montre chaque facture.
      </p>
    )
  }

  const { aEncaisser, enPartie, aDeclarer, enRetard } = comptes
  return (
    <>
      <div className="span-6">
        <KpiTile
          libelle="À encaisser"
          valeur={aEncaisser}
          statut={aEncaisser > 0 ? 'warning' : 'ok'}
          detail={aEncaisser === 0
            ? 'aucune facture en attente de paiement'
            : `${aEncaisser > 1 ? 'factures' : 'facture'} en attente de paiement${enPartie > 0 ? `, dont ${enPartie} en partie` : ''}`}
          onClick={() => navigate('/mes-ventes')}
        />
      </div>
      <div className="span-6">
        <KpiTile
          libelle="À déclarer"
          valeur={aDeclarer}
          statut={enRetard > 0 ? 'danger' : aDeclarer > 0 ? 'warning' : 'ok'}
          detail={aDeclarer === 0
            ? 'aucun encaissement à déclarer'
            : `${aDeclarer > 1 ? 'factures' : 'facture'} dont l’encaissement est à déclarer${enRetard > 0 ? `, dont ${enRetard} en retard` : ''}`}
          onClick={() => navigate('/mes-ventes')}
        />
      </div>
    </>
  )
}
