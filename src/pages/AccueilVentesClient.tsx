import { attenteDeLEncart, type AttenteDeLEncart } from '../lib/encartFactureElectronique'
import { aujourdHuiAParis } from '../lib/format'
import { useVentesDuClient, type VentesDuClient } from '../lib/ventesDuClientLecture'
import EncartFactureElectronique from './dossier/EncartFactureElectronique'
import TuilesVentesClient from './TuilesVentesClient'

// CE QUE L'ACCUEIL DU CLIENT MONTRE DE SES VENTES (espace client, étapes P4b et A6b2) : les tuiles « À encaisser » et « À
// déclarer » et l'encart « Facture électronique », d'après UNE SEULE lecture des ventes (`useVentesDuClient`) — l'une et
// l'autre en comptent les pastilles de l'onglet Factures, et deux copies des requêtes pourraient diverger sans un mot.
// Monté par l'accueil seulement si « Mes ventes » est ouvert (`mesVentesOuvertes`), clé par la société : une autre société
// repart d'un composant neuf, en chargement. Sans la case « Ventes », relue à la base, ni tuile ni encart.

function attenteDe(dossierId: string, ventes: VentesDuClient): AttenteDeLEncart {
  if (ventes.etat === 'echec') return { etat: 'muette', motif: ventes.motif }
  if (ventes.etat !== 'lu') return { etat: 'en_cours' }
  return attenteDeLEncart(dossierId, ventes.listes, ventes.statutTva, aujourdHuiAParis())
}

export default function AccueilVentesClient({ dossierId }: { dossierId: string }) {
  const ventes = useVentesDuClient(dossierId)
  return (
    <>
      <TuilesVentesClient dossierId={dossierId} ventes={ventes} />
      {/* L'encart ne lit son état qu'une fois les cases relues à la base : sans la case « Ventes », rien — pas même la lecture
          de l'état, que la base refuserait. D'ici là, un squelette, comme les tuiles. */}
      {ventes.etat === 'chargement' && (
        <div className="skeleton skeleton-widget span-12" aria-busy="true" aria-label="Chargement de ta facture électronique" />
      )}
      {(ventes.etat === 'lu' || ventes.etat === 'echec') && (
        <EncartFactureElectronique key={dossierId} espace="client" dossierId={dossierId} attente={attenteDe(dossierId, ventes)} />
      )}
    </>
  )
}
