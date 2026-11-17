import { useState } from 'react'
import {
  A_EGALITE_DIT, AUCUN_CONTROLE, AUCUNE_CONCORDANCE, AUTRES_DIT, RESTE_CLASSABLE, associationDite, boutonDuLot,
  confirmationDuLot, confirmationDuRetraitDAssociation, type AssuranceMaladieDeLaFiche,
} from '../lib/associationsAssuranceMaladieVue'
import {
  controleDit, horsDit, justificationDuCandidat, refusDeLAssociation, refusDuRetraitDAssociation, type Candidat,
  type GroupeAAssocier, type Rapprochement, type RapprochementCalcule,
} from '../lib/rapprochementAssuranceMaladie'

// L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AUX CRÉDITS DU RELEVÉ, À L'ÉCRAN (conception 53, lot NOE5b). Le cabinet
// seul : la fiche d'un crédit dans l'onglet Banque, et la section NOEMIE de cet onglet. L'AFFICHAGE SEUL : le calcul, la
// proposition, les refus et les mots viennent de lib/rapprochementAssuranceMaladie.ts et lib/associationsAssuranceMaladieVue.ts ;
// les deux gestes — associer (un groupe, ou le lot) et défaire — sont ceux de l'onglet, sous SON verrou, relâché après la
// relecture. Rien ne part sans clic ; à égalité, rien n'est proposé ; un calcul muet (une lecture partielle) n'offre aucun
// geste. Aucun libellé du relevé n'est recopié.

function CarteDuCandidat({ r, c, bouton, occupe, onAssocier }: {
  r: RapprochementCalcule
  c: Candidat
  bouton: string
  occupe: boolean
  onAssocier: (groupe: GroupeAAssocier) => void
}) {
  const groupe = { mouvementId: c.mouvementId, paiementIds: c.paiementIds }
  const refus = refusDeLAssociation(r, [groupe])
  return (
    <div className="carte-rapprochement">
      <p style={{ margin: 0 }}>{justificationDuCandidat(c, r.paiementsParId)}</p>
      {refus ? (
        <p className="error-text" style={{ marginBottom: 0 }}>{refus}</p>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={occupe} onClick={() => onAssocier(groupe)}>{bouton}</button>
        </div>
      )}
    </div>
  )
}

/** La fiche d'un mouvement : ce qu'il est pour l'assurance maladie, et ses gestes. */
export function AssociationDansLaFiche({ fiche, occupe, erreur, onAssocier, onDefaire }: {
  fiche: AssuranceMaladieDeLaFiche
  occupe: boolean
  erreur: string | null
  onAssocier: (groupe: GroupeAAssocier) => void
  onDefaire: (mouvementId: string) => void
}) {
  const [aDefaire, setADefaire] = useState(false)
  if (fiche.genre === 'rien') return null
  const titre = <h3>Paiement de l’assurance maladie</h3>
  if (fiche.genre === 'muet') {
    return (
      <section className="fiche-mouvement-section" aria-label="Paiement de l’assurance maladie">
        {titre}
        <p className="fiche-mouvement-note" role="status">{fiche.raison}</p>
      </section>
    )
  }
  const { etat, rapprochement: r } = fiche
  const erreurDite = erreur && <p className="error-text" role="alert">{erreur}</p>
  if (etat.genre === 'hors') {
    return (
      <section className="fiche-mouvement-section" aria-label="Paiement de l’assurance maladie">
        {titre}
        <p className="fiche-mouvement-note">{horsDit(etat.raison)}</p>
      </section>
    )
  }
  if (etat.genre === 'associe') {
    const { mouvementId } = fiche
    const refus = refusDuRetraitDAssociation(r, mouvementId)
    // Ce que les contrôles disent de cette association (incohérente, ou contredite par le classement du mouvement).
    const alertes = r.controles.filter((c) => (c.genre === 'association_incoherente' || c.genre === 'association_contredite')
      && c.mouvementId === mouvementId)
    return (
      <section className="fiche-mouvement-section" aria-label="Paiement de l’assurance maladie">
        {titre}
        <div className="carte-rapprochement"><p style={{ margin: 0 }}>{associationDite(r, etat.paiementIds)}</p></div>
        {alertes.map((c) => <p key={c.genre} style={{ color: 'var(--color-warning)' }}>{controleDit(c, r.paiementsParId)}</p>)}
        <p className="fiche-mouvement-note">{RESTE_CLASSABLE}</p>
        {erreurDite}
        {refus ? (
          <p className="fiche-mouvement-note">{refus}</p>
        ) : aDefaire ? (
          <div role="alert">
            <p style={{ marginTop: 0 }}>{confirmationDuRetraitDAssociation(r, mouvementId, etat.paiementIds)}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => setADefaire(false)}>Garder</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={occupe} onClick={() => { setADefaire(false); onDefaire(mouvementId) }}>
                {occupe ? 'En cours…' : 'Défaire l’association'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={() => setADefaire(true)}>
              Défaire l’association…
            </button>
          </div>
        )}
      </section>
    )
  }
  if (etat.genre === 'propose') {
    return (
      <section className="fiche-mouvement-section" aria-label="Paiement de l’assurance maladie">
        {titre}
        <CarteDuCandidat r={r} c={etat.proposition} bouton="Associer" occupe={occupe} onAssocier={onAssocier} />
        <p className="fiche-mouvement-note">{RESTE_CLASSABLE}</p>
        {erreurDite}
        {etat.autres.length > 0 && (
          <>
            <p className="fiche-mouvement-note">{AUTRES_DIT}</p>
            {etat.autres.map((c) => (
              <CarteDuCandidat key={c.paiementIds.join(',')} r={r} c={c} bouton="Associer celui-ci" occupe={occupe} onAssocier={onAssocier} />
            ))}
          </>
        )}
      </section>
    )
  }
  return (
    <section className="fiche-mouvement-section" aria-label="Paiement de l’assurance maladie">
      {titre}
      <p className="fiche-mouvement-note">{A_EGALITE_DIT}</p>
      {erreurDite}
      {etat.candidats.map((c) => (
        <CarteDuCandidat key={c.paiementIds.join(',')} r={r} c={c} bouton="Associer celui-ci" occupe={occupe} onAssocier={onAssocier} />
      ))}
      <p className="fiche-mouvement-note">{RESTE_CLASSABLE}</p>
    </section>
  )
}

/** La section NOEMIE de l'onglet Banque : les contrôles, puis le lot des concordances. */
export function AssociationDansLaSection({ rapprochement: r, occupe, erreur, message, onAssocierLeLot }: {
  rapprochement: Rapprochement | null
  occupe: boolean
  erreur: string | null
  message: string | null
  onAssocierLeLot: (groupes: readonly GroupeAAssocier[]) => void
}) {
  const [aConfirmer, setAConfirmer] = useState(false)
  if (r === null) return null
  const titre = <h4 style={{ marginBottom: 6 }}>Le rapprochement avec le relevé</h4>
  if (r.etat === 'muet') {
    return <>{titre}<p className="muted" role="status">{r.raison}</p></>
  }
  const n = r.concordances.length
  const refus = n > 0 ? refusDeLAssociation(r, r.concordances) : null
  const confirmation = aConfirmer && n > 0 && refus === null ? confirmationDuLot(r) : null
  return (
    <>
      {titre}
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Des points d’attention, jamais bloquants : chaque crédit se classe en recette comme d’habitude.
      </p>
      {r.controles.length === 0 ? (
        <p className="muted" style={{ margin: '0 0 8px' }}>{AUCUN_CONTROLE}</p>
      ) : (
        <ul aria-label="Contrôles des paiements de l’assurance maladie" style={{ color: 'var(--color-warning)', marginTop: 0 }}>
          {r.controles.map((c) => (
            <li key={`${c.genre}|${c.genre === 'paiement_sans_credit' ? c.paiementId : c.mouvementId}`}>{controleDit(c, r.paiementsParId)}</li>
          ))}
        </ul>
      )}
      {message && <p role="status">{message}</p>}
      {erreur && <p className="error-text" role="alert">{erreur}</p>}
      {n === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{AUCUNE_CONCORDANCE}</p>
      ) : refus ? (
        <p className="error-text">{refus}</p>
      ) : confirmation ? (
        <div role="alert">
          <p style={{ marginTop: 0 }}>{confirmation.resume}</p>
          <ul>{confirmation.lignes.map((l) => <li key={l}>{l}</li>)}</ul>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" disabled={occupe} onClick={() => setAConfirmer(false)}>Garder</button>
            <button
              type="button" className="btn btn-primary" disabled={occupe}
              onClick={() => { onAssocierLeLot(r.concordances.map((c) => ({ mouvementId: c.mouvementId, paiementIds: c.paiementIds }))); setAConfirmer(false) }}
            >
              {occupe ? 'Association…' : `Associer ${n > 1 ? `ces ${n} crédits` : 'ce crédit'}`}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" disabled={occupe} onClick={() => setAConfirmer(true)}>{boutonDuLot(n)}</button>
        </div>
      )}
    </>
  )
}
