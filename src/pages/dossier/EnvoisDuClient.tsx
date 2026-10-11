import { useState } from 'react'
import { IconAttention, IconCoche } from '../../components/icons'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import {
  associable, auteurDuMessage, ceQueVoitLeClient, envoisDuMouvement, etatDeLaProposition, lecteursDeLaQuestion, phraseDeLaProposition,
  phraseDeLEtat, phraseDuRetrait, signauxDeLaProposition, silenceDesEnvois, titreDesPropositions,
  type AccesDuReleve, type ContexteDeLaProposition, type EnvoisDuClient,
} from '../../lib/banqueCabinet'
import { LONGUEUR_MAX_PRECISION, longueurEnCaracteres, refusDeLaPrecision } from '../../lib/banqueClient'
import { ouvrirJustificatif } from '../../lib/depot'
import { LIBELLE_QUESTION_MOUVEMENT } from '../../lib/droitsAcces'
import { fichierAMontrer } from '../../lib/fichiersPiece'
import { formatDate, formatMoney } from '../../lib/format'
import { nomDeLaPiece } from '../../lib/reglementGroupe'
import type { LigneBancaire } from '../../lib/types'

// CE QUE LE CLIENT A ENVOYÉ POUR UN MOUVEMENT, DANS SA FICHE (espace client, étape P9b ; lib/banqueCabinet.ts) : la pièce
// qu'il a proposée, EN TÊTE de la fiche et nommée comme telle, et le fil — ses réponses, les questions du cabinet.
//
// La proposition n'écrit rien : « Associer cette pièce » passe par le rapprochement de la fiche (`onRapprocher`), avec
// les refus du choix à la main — une pièce payée ailleurs, figée, un second paiement qui dépasserait son reste. Sur des
// envois pas lus en entier, ou pas encore revenus, rien n'est dit de ce que le client a envoyé, et aucun geste n'est offert.
// La question du cabinet s'écrit par `ecrire_precision_mouvement` seule, sous le verrou de l'onglet (BanqueTab).

export function PropositionsDuClient({ ligne, envois, acces, contexte, aTraiter, occupe, onAssocier }: {
  ligne: LigneBancaire
  envois: EnvoisDuClient
  acces: AccesDuDossier
  // Le contexte du rapprochement, sans la pièce : la fiche le tient (ses pièces, ses paiements, ses refus).
  contexte: (pieceId: string) => ContexteDeLaProposition
  aTraiter: boolean
  occupe: boolean
  onAssocier: (pieceId: string) => void
}) {
  const silence = silenceDesEnvois(envois)
  if (envois.etat !== 'lus') {
    return <p className="fiche-mouvement-note" role="status">{silence}</p>
  }
  const siens = envoisDuMouvement(envois, ligne.id)
  if (siens.courantes.length === 0 && siens.retirees.length === 0) return null
  const voit = ceQueVoitLeClient(ligne, siens)
  return (
    <section className="fiche-mouvement-section" aria-label="Ce que le client a proposé">
      {siens.courantes.length > 0 && <h3>{titreDesPropositions(siens.courantes)}</h3>}
      {siens.courantes.map((p) => {
        const c = contexte(p.piece_id)
        const piece = c.pieces.find((x) => x.id === p.piece_id) ?? null
        const etat = etatDeLaProposition(p, c)
        const phrase = phraseDeLEtat(etat)
        const offert = aTraiter && associable(etat)
        return (
          <div key={p.id} className="carte-rapprochement carte-proposee">
            <div className="carte-rapprochement-entete">
              <div className="carte-rapprochement-titres">
                <strong className="nom-fichier">{piece ? nomDeLaPiece(piece) : 'Pièce non lue'}</strong>
                <span>{phraseDeLaProposition(acces, p)}</span>
              </div>
              {piece && <strong className="carte-rapprochement-montant">{formatMoney(piece.montant_ttc)}</strong>}
            </div>
            {piece && etat.etat !== 'retenue' && etat.etat !== 'mouvement_classe' && (
              <ul className="signaux-rapprochement">
                {signauxDeLaProposition(piece, ligne).map((s) => (
                  <li key={s.texte} className={s.ok ? 'signal-concordant' : 'signal-reserve'}>
                    {s.ok ? <IconCoche width={15} height={15} aria-hidden="true" /> : <IconAttention width={15} height={15} aria-hidden="true" />}
                    <span>{s.texte}</span>
                  </li>
                ))}
              </ul>
            )}
            {phrase && (
              <p className={etat.etat === 'retenue' || (etat.etat === 'piece_payee_en_partie' && etat.refus === null) ? 'fiche-mouvement-note' : 'fiche-mouvement-alerte'}>
                {phrase}
              </p>
            )}
            <div className="carte-rapprochement-actions">
              {piece && (
                <button type="button" className="carte-rapprochement-lien" onClick={() => ouvrirJustificatif(fichierAMontrer(piece).chemin)}>
                  Voir le justificatif
                </button>
              )}
              {offert && (
                <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => onAssocier(p.piece_id)}>
                  Associer cette pièce
                </button>
              )}
            </div>
          </div>
        )
      })}
      {siens.retirees.length > 0 && (
        <p className="fiche-mouvement-note">
          {siens.retirees.length === 1 ? 'Proposition retirée' : `${siens.retirees.length} propositions retirées`} :{' '}
          {siens.retirees.map((p) => {
            const c = contexte(p.piece_id)
            const piece = c.pieces.find((x) => x.id === p.piece_id)
            return `${piece ? nomDeLaPiece(piece) : 'une pièce non lue'} — ${phraseDeLaProposition(acces, p)}, ${phraseDuRetrait(p)}`
          }).join(' ; ')}.
        </p>
      )}
      <p className="fiche-mouvement-note">Dans « Ma banque », le client voit ce mouvement « {voit} ».</p>
    </section>
  )
}

export function FilDuMouvement({ dossierId, ligne, envois, acces, occupe, onDemander }: {
  dossierId: string
  ligne: LigneBancaire
  envois: EnvoisDuClient
  acces: AccesDuReleve
  occupe: boolean
  // Rend vrai quand la question est écrite et relue : le brouillon s'efface alors, et seulement alors.
  onDemander: (texte: string) => Promise<boolean>
}) {
  const [texte, setTexte] = useState('')
  const lus = envois.etat === 'lus'
  const siens = lus ? envoisDuMouvement(envois, ligne.id) : null
  // Le cabinet gère la banque du dossier (`admin_du_dossier`) : seuls les refus du texte peuvent tomber.
  const refus = refusDeLaPrecision({ dossierId, gereLaBanque: true, mouvement: ligne, texte })
  const lecteurs = lecteursDeLaQuestion(acces)
  const gestes = lus && !occupe

  return (
    <section className="fiche-mouvement-section" aria-label="Échanges avec le client">
      <h3>Échanges avec le client</h3>
      {siens === null ? (
        <p className="fiche-mouvement-note">
          {envois.etat === 'en_cours'
            ? 'Le fil de ce mouvement est en cours de lecture : la question attend qu’il soit revenu.'
            : 'Le fil de ce mouvement n’a pas été lu en entier : il ne s’affiche pas, et aucune question ne part d’ici. Recharge la page.'}
        </p>
      ) : siens.fil.length === 0 ? (
        <p className="fiche-mouvement-note">Aucun échange sur ce mouvement.</p>
      ) : (
        <ul className="fil-mouvement">
          {siens.fil.map((q) => (
            <li key={q.id} className={q.origine === 'cabinet' ? 'fil-mouvement-cabinet' : 'fil-mouvement-client'}>
              <span className="muted">{auteurDuMessage(acces.acces, q)}, le {formatDate(q.created_at)} :</span>{' '}
              <span className="fil-mouvement-texte">{q.texte}</span>
            </li>
          ))}
        </ul>
      )}
      {siens?.questionEnAttente && <p className="fiche-mouvement-note">La dernière question attend la réponse du client.</p>}
      <div className="field">
        <label htmlFor={`question-${ligne.id}`}>{LIBELLE_QUESTION_MOUVEMENT}</label>
        <textarea
          id={`question-${ligne.id}`}
          rows={3}
          value={texte}
          disabled={!gestes}
          onChange={(e) => setTexte(e.target.value)}
        />
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {longueurEnCaracteres(texte)} / {LONGUEUR_MAX_PRECISION.toLocaleString('fr-FR')} caractères.
        </span>
      </div>
      {lecteurs && <p className="fiche-mouvement-note">{lecteurs}</p>}
      {refus && refus.cle !== 'precision_vide' && <p className="fiche-mouvement-alerte">{refus.message}</p>}
      <div className="fiche-mouvement-boutons">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={!gestes || refus !== null}
          onClick={async () => { if (refus === null && await onDemander(texte)) setTexte('') }}
        >
          Demander au client
        </button>
      </div>
    </section>
  )
}
