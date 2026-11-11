import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  LIBELLE_ETAT_ECLATEMENT, argumentsDeLEclatement, confirmationDeLEclatement, eclatementAFaire, phraseDeLEclatement,
  type CarteDeLEclatement,
} from '../../lib/ouvertureEclatee'

// L'OUVERTURE DE LA BANQUE PAR COMPTE, DANS L'ONGLET ÉCRITURES (ligne 26.6, MCB5, sixième partie, suite ; le module est
// lib/ouvertureEclatee.ts, la lecture lib/ouvertureEclateeLecture.ts), sur le modèle de la section « Ventes facturées ». Côté
// CABINET seul, derrière `COMPTES_BANCAIRES_PREVUS` (l'onglet ne la monte pas drapeau baissé). L'exercice affiché s'ouvre au
// 512 du rôle avec l'argent de tous les comptes bancaires : la carte dit l'état de l'écriture qui en passe le solde de chaque
// compte à son 512, d'après ses relevés de la veille — à écrire, à jour, à réécrire, à retirer, ou retenue par un refus de
// la base, dit avec ses mots — et offre son geste, par `ecrire_ouverture_eclatee` seule.
//
// ELLE NE LIT RIEN ELLE-MÊME : l'onglet lit les comptes, le relevé et les contrôles avec le brouillon, dans la même
// relecture (`relire`), et lui passe l'état qu'il en tire (`carteDeLEclatement`). Lecture pas revenue, partielle ou refusée,
// relecture en cours, ou exercice figé par une validation : AUCUN geste. Le verrou est un `useRef`, posé avant le `try` et
// relâché dans le `finally`, APRÈS la relecture : plus tôt, la carte garderait son état d'avant le temps que la relecture
// revienne, et un second clic écrirait de nouveau. La confirmation NOMME chaque compte ouvert et son montant.

const BADGE: Readonly<Record<keyof typeof LIBELLE_ETAT_ECLATEMENT, string>> = {
  a_ecrire: 'badge-warning',
  a_jour: 'badge-ok',
  a_reecrire: 'badge-danger',
  a_retirer: 'badge-danger',
  retenu: 'badge-warning',
}

const GESTE = { a_ecrire: 'Écrire', a_reecrire: 'Réécrire', a_retirer: 'Retirer' } as const

export default function OuvertureEclateeCarte({ dossierId, annee, carte, relecture, relire }: {
  dossierId: string
  annee: number | string
  /** L'état tiré des lectures de l'onglet, toutes revenues pour ce dossier (`carteDeLEclatement`). */
  carte: CarteDeLEclatement
  /** Une relecture de l'onglet est en cours : l'état affiché est celui d'avant, et aucun geste ne part. */
  relecture: boolean
  /** La relecture de l'onglet : le brouillon, les comptes, le relevé et les contrôles ensemble. */
  relire: () => Promise<void>
}) {
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  if (carte.etat === 'masquee' || typeof annee !== 'number') return null

  const lue = carte.etat === 'lue' ? carte : null
  const aFaire = lue !== null && eclatementAFaire(lue.eclatement) ? lue.eclatement : null
  const gestePermis = aFaire !== null && !lue!.fige && !relecture

  async function agir() {
    if (aFaire === null || !gestePermis || typeof annee !== 'number' || ecritureEnCours.current) return
    if (!window.confirm(confirmationDeLEclatement(aFaire, annee))) return
    // Posé AVANT le `try`, et avant tout `await` : un second clic du même rendu trouve le verrou.
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('ecrire_ouverture_eclatee', argumentsDeLEclatement(dossierId, annee, aFaire))
      if (error) throw error
      // Relu AVANT de relâcher le verrou : jusque-là, la carte porte encore son état d'avant.
      await relire()
    } catch (e) {
      setErreur(messageErreur(e, `L’écriture de l’ouverture de la banque au 01/01/${annee} n’a pas pu se faire.`))
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        Ouverture de la banque par compte
        {lue !== null && (
          <span className={`badge ${BADGE[lue.eclatement.etat]}`}>{LIBELLE_ETAT_ECLATEMENT[lue.eclatement.etat]}</span>
        )}
      </h3>
      <p className="muted" style={{ marginTop: -8 }}>
        L’ouverture du 01/01/{annee} porte au compte de banque du rôle l’argent de tous les comptes bancaires. Une écriture, au
        journal des opérations diverses, passe le solde de chaque compte qui tient son 512 à son compte, d’après ses relevés du
        31/12/{annee - 1} ; la fonction qui l’écrit la recompose d’abord sur ces relevés.
      </p>

      {carte.etat === 'chargement' ? (
        <p className="muted" style={{ marginBottom: 0 }}>Chargement…</p>
      ) : carte.etat === 'illisible' ? (
        <p className="error-text" style={{ marginBottom: 0 }}>
          Les comptes bancaires, le relevé ou le brouillon n’ont pas pu être lus en entier ({carte.motif}). L’écriture de
          l’ouverture ne s’écrit ni ne se retire d’ici : un état calculé sur une lecture partielle ferait écrire ce qui est
          faux. Recharge la page.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 8px' }}>{phraseDeLEclatement(carte.eclatement, annee)}</p>
          {'lignes' in carte.eclatement && (
            <div className="table-scroll tableau-adaptable">
              <table className="table-empilable-etroite table-empilable-sans-jeu">
                <thead><tr><th>Compte</th><th>Débit</th><th>Crédit</th><th>Libellé</th></tr></thead>
                <tbody>
                  {carte.eclatement.lignes.map((l, i) => (
                    <tr key={`${l.compte_bancaire_id}-${i}`}>
                      <td data-libelle="Compte">{l.compte}</td>
                      <td data-libelle="Débit">{l.sens === 'debit' ? formatMoney(l.montant) : ''}</td>
                      <td data-libelle="Crédit">{l.sens === 'credit' ? formatMoney(l.montant) : ''}</td>
                      <td data-libelle="Libellé">{l.libelle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {carte.fige && (
            <p className="muted" style={{ marginBottom: 0 }}>L’exercice {annee} est validé : son ouverture ne change plus.</p>
          )}
          {aFaire !== null && !carte.fige && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                type="button"
                className={`btn btn-sm ${aFaire.etat === 'a_retirer' ? 'btn-danger' : 'btn-outline'}`}
                disabled={!gestePermis || enCours}
                onClick={agir}
              >
                {enCours ? '…' : GESTE[aFaire.etat]}
              </button>
            </div>
          )}
        </>
      )}
      {erreur && <p className="error-text" style={{ marginBottom: 0 }}>{erreur}</p>}
    </div>
  )
}
