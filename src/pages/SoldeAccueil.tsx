import { Link } from 'react-router-dom'
import Sparkline from '../components/widgets/Sparkline'
import Widget from '../components/widgets/Widget'
import { useSoldeDuClient } from '../lib/banqueClientLecture'
import { finDuNumero } from '../lib/banqueClientParCompte'
import { formatDate, formatMoney } from '../lib/format'
import {
  banqueDeLAccueil, COURBE_A_VENIR, SOLDE_ILLISIBLE, SOLDE_MUET, SOLDE_SANS_RELEVE, soldeSansReleveSur, SOUS_TITRE_DU_SOLDE,
  TITRE_DU_SOLDE, type SoldeDeLAccueil,
} from '../lib/soldeDeLAccueil'

// LE SOLDE DU COMPTE SUR L'ACCUEIL DU CLIENT (demande du cabinet du 16/11/2026) : le montant qu'il y a sur le compte — le solde
// LU au dernier relevé contrôlé, celui que « Ma banque » affiche —, sa date, une petite courbe des soldes des relevés contrôlés
// des douze derniers mois, et le lien vers « Ma banque ». La règle : lib/soldeDeLAccueil.ts ; la lecture, celle de « Ma banque »
// (lib/banqueClientLecture.ts), à part des autres lectures de l'accueil — sa panne ne tait que cette carte.
//
// Montée par l'accueil sous la même garde que l'entrée « Ma banque » (`maBanqueOuverte`), clée par société ; la case « Banque »
// se relit À LA BASE dans la même vague que les relevés : sans elle, plus de carte du tout (jamais une carte vide « réservée »).
// Pendant la lecture, un squelette ; lue en partie ou refusée, une ligne discrète qui le dit — jamais « 0,00 € ».

function SoldeDUnCompte({ solde, largeurCourbe }: { solde: SoldeDeLAccueil; largeurCourbe: number }) {
  switch (solde.etat) {
    case 'lu':
      return (
        <div className="solde-accueil-corps">
          <div className="solde-accueil-montant-bloc">
            <div className="solde-accueil-montant">{formatMoney(solde.solde)}</div>
            <div className="solde-accueil-date">au relevé du {formatDate(solde.au)}</div>
          </div>
          {solde.courbe ? (
            <figure className="solde-accueil-courbe">
              <Sparkline valeurs={solde.courbe.map((p) => p.solde)} largeur={largeurCourbe} hauteur={48} />
              <figcaption>
                Tes {solde.courbe.length} derniers relevés, du {formatDate(solde.courbe[0].au)} au {formatDate(solde.au)}
              </figcaption>
            </figure>
          ) : (
            <p className="solde-accueil-note">{COURBE_A_VENIR}</p>
          )}
        </div>
      )
    case 'aucun_releve':
      return <p className="solde-accueil-note">{SOLDE_SANS_RELEVE}</p>
    case 'aucun_solde_sur':
      return <p className="solde-accueil-note">{soldeSansReleveSur(solde.releves)}</p>
    case 'muet':
      // Le motif technique en infobulle, comme « Ma banque » : un compte de lignes ne dit rien au client.
      return <p className="solde-accueil-note" title={solde.motif}>{SOLDE_MUET}</p>
  }
}

export default function SoldeAccueil({ dossierId }: { dossierId: string }) {
  const lecture = useSoldeDuClient(dossierId)

  if (lecture === null) {
    return <div className="skeleton skeleton-kpi span-12" aria-busy="true" aria-label="Chargement de ton solde" />
  }
  // La base ne voit pas (ou plus) la case « Banque » : pas de carte.
  if (lecture.etat === 'sans_banque') return null

  const banque = lecture.etat === 'lu' ? banqueDeLAccueil(lecture.comptes, lecture.controles) : null

  return (
    <Widget
      className="span-12 solde-accueil"
      titre={TITRE_DU_SOLDE}
      sousTitre={SOUS_TITRE_DU_SOLDE}
      action={<Link to="/ma-banque" className="btn btn-outline btn-sm">Voir ma banque</Link>}
    >
      {lecture.etat === 'echec' ? (
        <p className="solde-accueil-note" title={lecture.motif}>{SOLDE_ILLISIBLE}</p>
      ) : banque?.etat === 'retenue' ? (
        <p className="solde-accueil-note" title={banque.raison}>{SOLDE_MUET}</p>
      ) : banque?.etat === 'comptes' ? (
        // Chaque compte, son solde et sa date : des soldes de dates différentes ne s'additionnent jamais.
        <div className="solde-accueil-comptes">
          {banque.comptes.map(({ compte, solde }) => (
            <div key={compte.id} className="solde-accueil-compte">
              <div className="solde-accueil-compte-nom">
                {compte.libelle}
                {finDuNumero(compte) && <span className="solde-accueil-note"> — {finDuNumero(compte)}</span>}
              </div>
              <SoldeDUnCompte solde={solde} largeurCourbe={140} />
            </div>
          ))}
        </div>
      ) : banque?.etat === 'un' ? (
        <SoldeDUnCompte solde={banque.solde} largeurCourbe={220} />
      ) : null}
    </Widget>
  )
}
