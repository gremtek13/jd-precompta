import { useEffect, useState } from 'react'
import { lireLesDroitsVentes } from './espaceVentes'
import { messageErreur } from './messageErreur'
import { supabase } from './supabase'
import type { ListesDesVentes } from './tuilesVentes'
import type { StatutTva } from './types'
import { lireLesVentesDuDossier } from './ventesLecture'

// CE QUE L'ACCUEIL DU CLIENT LIT DE SES VENTES : UNE LECTURE, PARTAGÉE (espace client, étapes P4b et A6b2). Les tuiles « À
// encaisser » et « À déclarer » et l'encart « Facture électronique » (« ce qui attend ») disent des NOMBRES des mêmes listes
// que l'onglet Factures : chacun relisant ses propres copies, ce serait deux séries de requêtes pour une page — et deux
// lectures qui pourraient diverger sans un mot (CLAUDE.md, « Une lecture que deux écrans comptent s'écrit une fois »). Le
// crochet est appelé UNE fois par l'accueil (`VentesDuClient`), qui passe la lecture aux deux.
//
// LES CASES SE RELISENT À LA BASE, comme « Mes ventes » les relit (`lireLesDroitsVentes`) : une lecture que la RLS refuse rend
// ZÉRO ligne sans erreur, et une case retirée depuis la connexion ferait dire « 0 » de ventes qu'elle ne montre plus. Sans la
// case, rien. Le statut de TVA de la société se lit avec elles : l'obligation de déclarer en dépend, et un statut mal lu
// changerait les comptes. Puis les listes de l'onglet Factures (lib/ventesLecture.ts). Pas encore revenu : `chargement`. Une
// lecture partielle ou en échec : un `echec` avec son motif — jamais un « 0 ».

export type VentesDuClient =
  | { etat: 'chargement' }
  | { etat: 'sans_ventes' }
  | { etat: 'echec'; motif: string }
  | { etat: 'lu'; listes: ListesDesVentes; statutTva: StatutTva | null }

/**
 * Les ventes de la société `dossierId`. Une réponse arrivée après un changement de société ne s'écrit pas, et la lecture est
 * gardée AVEC la société pour laquelle elle a été faite : une autre société repart de `chargement`, jamais des comptes de la
 * précédente.
 */
export function useVentesDuClient(dossierId: string): VentesDuClient {
  const [lue, setLue] = useState<{ dossierId: string; ventes: Exclude<VentesDuClient, { etat: 'chargement' }> } | null>(null)

  useEffect(() => {
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
        setLue({ dossierId, ventes: { etat: 'echec', motif: `tes droits n’ont pas pu être vérifiés (${cases.motif})` } })
      } else if (!cases.droits.ventes) {
        setLue({ dossierId, ventes: { etat: 'sans_ventes' } })
      } else if (societe.error) {
        setLue({ dossierId, ventes: { etat: 'echec', motif: messageErreur(societe.error, 'ta société n’a pas pu être lue') } })
      } else if (!societe.data) {
        setLue({ dossierId, ventes: { etat: 'echec', motif: 'ta société n’a pas été trouvée' } })
      } else {
        setLue({
          dossierId,
          ventes: { etat: 'lu', listes, statutTva: (societe.data as { statut_tva: StatutTva | null }).statut_tva },
        })
      }
    }, (erreur: unknown) => {
      if (!annule) setLue({ dossierId, ventes: { etat: 'echec', motif: messageErreur(erreur, 'tes ventes n’ont pas pu être lues') } })
    })
    return () => { annule = true }
  }, [dossierId])

  return lue !== null && lue.dossierId === dossierId ? lue.ventes : { etat: 'chargement' }
}
