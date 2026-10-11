import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis } from '../lib/format'
import { lireLesDroitsVentes } from '../lib/espaceVentes'
import { lireLesVentesDuDossier } from '../lib/ventesLecture'
import { compterLesPastilles, type ListesDesVentes } from '../lib/tuilesVentes'
import type { StatutTva } from '../lib/types'
import KpiTile from '../components/widgets/KpiTile'

// « À ENCAISSER » ET « À DÉCLARER » SUR L'ACCUEIL DU CLIENT (espace client, étape P4b ; conception : HISTORIQUE.md, « L'ESPACE
// CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.2). Monté par l'accueil seulement si « Mes ventes »
// est ouvert (`mesVentesOuvertes`) ; chaque tuile mène à « Mes ventes ».
//
// LES CASES SE RELISENT À LA BASE, comme « Mes ventes » les relit (`lireLesDroitsVentes`) : une lecture que la RLS refuse rend
// ZÉRO ligne sans erreur, et une case retirée depuis la connexion ferait dire « 0 » de ventes qu'elle ne montre plus. Sans la
// case, rien. Le statut de TVA de la société se lit avec elles : l'obligation de déclarer en dépend, et un statut mal lu
// changerait les comptes. Puis les listes de l'onglet Factures (lib/ventesLecture.ts), et leurs pastilles comptées
// (lib/tuilesVentes.ts). Pas encore revenu : des squelettes. Une lecture partielle ou en échec : aucun chiffre — un « 0 »
// serait faux —, une phrase qui le dit et mène à « Mes ventes ».

type Etat =
  | { etat: 'chargement' }
  | { etat: 'sans_ventes' }
  | { etat: 'echec'; motif: string }
  | { etat: 'lu'; listes: ListesDesVentes; statutTva: StatutTva | null }

export default function TuilesVentesClient({ dossierId }: { dossierId: string }) {
  const navigate = useNavigate()
  const [lecture, setLecture] = useState<Etat>({ etat: 'chargement' })

  useEffect(() => {
    // Une réponse arrivée après un démontage ne s'écrit pas. L'accueil clé ce composant par la société (`key`) : une autre
    // société repart d'un composant neuf, en chargement, jamais des comptes de la précédente.
    let annule = false
    Promise.all([
      lireLesDroitsVentes(
        supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles'),
      ),
      supabase.from('dossiers').select('statut_tva').eq('id', dossierId).maybeSingle(),
      lireLesVentesDuDossier(dossierId),
    ]).then(([cases, societe, listes]) => {
      if (annule) return
      if (cases.droits === null) {
        setLecture({ etat: 'echec', motif: `tes droits n’ont pas pu être vérifiés (${cases.motif})` })
      } else if (!cases.droits.ventes) {
        setLecture({ etat: 'sans_ventes' })
      } else if (societe.error) {
        setLecture({ etat: 'echec', motif: messageErreur(societe.error, 'ta société n’a pas pu être lue') })
      } else if (!societe.data) {
        setLecture({ etat: 'echec', motif: 'ta société n’a pas été trouvée' })
      } else {
        setLecture({ etat: 'lu', listes, statutTva: (societe.data as { statut_tva: StatutTva | null }).statut_tva })
      }
    }, (erreur: unknown) => {
      if (!annule) setLecture({ etat: 'echec', motif: messageErreur(erreur, 'tes ventes n’ont pas pu être lues') })
    })
    return () => { annule = true }
  }, [dossierId])

  if (lecture.etat === 'chargement') {
    return (
      <>
        <div className="skeleton skeleton-kpi span-6" aria-busy="true" aria-label="Chargement de tes ventes" />
        <div className="skeleton skeleton-kpi span-6" aria-busy="true" aria-label="Chargement de tes ventes" />
      </>
    )
  }
  if (lecture.etat === 'sans_ventes') return null

  // Le jour à Paris, lu au rendu comme l'onglet le lit : une déclaration en retard l'est au jour de la base.
  const comptes = lecture.etat === 'lu'
    ? compterLesPastilles(dossierId, lecture.listes, lecture.statutTva, aujourdHuiAParis())
    : { etat: 'muettes' as const, motif: lecture.motif }

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
