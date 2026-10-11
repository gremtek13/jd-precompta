import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { lireLesDroitsVentes, type DroitsDeLaBase } from '../lib/espaceVentes'
import type { ArticleExoneration, StatutTva } from '../lib/types'
import FacturesTab from './dossier/FacturesTab'

// « MES VENTES › FACTURES » (espace client, étape P4a ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL
// DE GESTION DU CLIENT : LA CONCEPTION », §2.4). L'onglet Factures du cabinet, réutilisé et non recopié, en mode client
// (`espace="client"`) : les mêmes gestes, par les mêmes fonctions, que la base (P2) et les fonctions de la vente (P3)
// ouvrent à l'accès qui porte la case « Ventes ». La route n'existe qu'avec la case sur la société affichée (App.tsx).
//
// L'ÉCRAN LIT LA SOCIÉTÉ AFFICHÉE avant de rien offrir : son nom, son SIRET et son adresse (l'émetteur des factures), son
// statut de TVA et ce qui en dépend — l'onglet n'a rien d'autre. Et les cases telles que la BASE les voit, dans la même vague
// (lib/espaceVentes.ts, `lireLesDroitsVentes`) : une case retirée depuis la connexion ferme l'écran, et « Banque » décide de
// ce que la fenêtre des encaissements lit. Une lecture ratée n'offre AUCUN geste : un formulaire bâti sur un statut de TVA
// inconnu proposerait une mention et un taux faux, et l'écriture partirait (CLAUDE.md, « Lecture → formulaire → écriture »).

interface SocieteLue {
  nom: string
  siret: string | null
  adresse: string | null
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  numero_tva_attribue: boolean
  tva_sur_debits: boolean
}

const COLONNES_SOCIETE = 'nom, siret, adresse, statut_tva, article_exoneration, numero_tva_attribue, tva_sur_debits'

type Etat =
  | { etat: 'chargement' }
  | { etat: 'echec'; motif: string }
  | { etat: 'sans_ventes' }
  | { etat: 'lu'; societe: SocieteLue; droits: DroitsDeLaBase }

export default function ClientVentes() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [lecture, setLecture] = useState<Etat>({ etat: 'chargement' })

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) ; une réponse arrivée après un démontage ne
    // s'écrit pas.
    let annule = false
    Promise.all([
      supabase.from('dossiers').select(COLONNES_SOCIETE).eq('id', dossierId).maybeSingle(),
      lireLesDroitsVentes(
        supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles'),
      ),
    ]).then(([societe, cases]) => {
      if (annule) return
      if (societe.error) {
        setLecture({ etat: 'echec', motif: messageErreur(societe.error, 'ta société n’a pas pu être lue') })
      } else if (!societe.data) {
        setLecture({ etat: 'echec', motif: 'ta société n’a pas été trouvée' })
      } else if (cases.droits === null) {
        setLecture({ etat: 'echec', motif: `tes droits sur cette société n’ont pas pu être vérifiés (${cases.motif})` })
      } else if (!cases.droits.ventes) {
        setLecture({ etat: 'sans_ventes' })
      } else {
        setLecture({ etat: 'lu', societe: societe.data as SocieteLue, droits: cases.droits })
      }
    }, (erreur: unknown) => {
      if (!annule) setLecture({ etat: 'echec', motif: messageErreur(erreur, 'ta société n’a pas pu être lue') })
    })
    return () => { annule = true }
  }, [dossierId])

  if (!dossierId) {
    return <p className="muted">Aucune société ne t’est encore rattachée — contacte ton cabinet comptable.</p>
  }

  return (
    <>
      <div className="topbar"><h1>Mes ventes</h1></div>
      {lecture.etat === 'chargement' ? (
        <p className="muted">Chargement…</p>
      ) : lecture.etat === 'echec' ? (
        <p className="error-text">
          Tes factures ne s’affichent pas : {lecture.motif}. Sans elle, rien ne t’est proposé — une facture rédigée sur une
          société mal lue partirait avec une mention de TVA fausse. Recharge la page.
        </p>
      ) : lecture.etat === 'sans_ventes' ? (
        <p className="muted">
          Ton accès ne porte plus « Ventes » sur cette société : tes factures ne s’affichent pas ici. Pour les retrouver,
          demande à ton cabinet d’ajouter « Ventes » à ton accès.
        </p>
      ) : (
        <>
          <h2 style={{ margin: '0 0 12px' }}>Factures</h2>
          <FacturesTab
            espace="client"
            banque={lecture.droits.banque}
            dossierId={dossierId}
            dossierNom={lecture.societe.nom}
            dossierSiret={lecture.societe.siret}
            dossierAdresse={lecture.societe.adresse}
            statutTva={lecture.societe.statut_tva}
            articleExoneration={lecture.societe.article_exoneration}
            numeroTvaAttribue={lecture.societe.numero_tva_attribue === true}
            tvaSurDebits={lecture.societe.tva_sur_debits === true}
          />
        </>
      )}
    </>
  )
}
