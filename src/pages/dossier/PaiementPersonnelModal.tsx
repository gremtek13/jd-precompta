import { useState, type CSSProperties } from 'react'
import {
  confirmationPaiementPersonnel, refusPaiementPersonnel, type ContextePaiementPersonnel,
} from '../../lib/cotisationPersonnelle'
import { montantDeLEcheance } from '../../lib/cotisationRapprochee'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import type { CotisationDeclaree } from '../../lib/types'

// LA FENÊTRE « PAYÉE DEPUIS LE COMPTE PERSONNEL » (ligne 26.6, phase C) : l'échéance, la date du paiement, et, avant le
// clic, ce que la base refuserait ou ce qu'elle écrira. Rien n'est calculé ici : le refus et la confirmation viennent de
// lib/cotisationPersonnelle.ts, qui les tient dans l'ordre et sous les mots de `enregistrer_paiement_personnel_cotisation`.
//
// LA DATE N'EST JAMAIS PROPOSÉE : c'est le jour où l'exploitant a payé de sa poche, un fait que le cabinet connaît. Une
// date pré-remplie (l'échéance, aujourd'hui) passerait un clic sans avoir été lue, et la 2035 compterait l'échéance ce
// jour-là.
//
// La fenêtre n'écrit pas : l'onglet appelle la base sous le verrou qu'il partage avec ses autres écritures du brouillon.
// Elle est rendue hors de la carte du tableau, dont l'enveloppe est un conteneur de requêtes (`.tableau-adaptable`) : un
// élément `position: fixed` sous un conteneur s'y rapporte, et la fenêtre se décalerait (voir CLAUDE.md, « Pièges de
// positionnement »).
export default function PaiementPersonnelModal({
  cotisation, contexte, enCours, attente, erreur, onDeclarer, onFermer,
}: {
  cotisation: CotisationDeclaree
  // Ce que l'onglet a lu, en entier : le modèle, le mouvement qui la paierait déjà, les exercices validés, l'ouverture.
  // Aujourd'hui se lit ici, à chaque rendu — une fenêtre ouverte à minuit passe au jour suivant.
  contexte: Omit<ContextePaiementPersonnel, 'aujourdHui'>
  // Une écriture du brouillon est en cours (celle-ci ou une autre de l'onglet).
  enCours: boolean
  // Pourquoi la déclaration attend : l'onglet relit ses listes, ou les a lues en partie — ce qu'elles diront décide du
  // refus, et une lecture partielle ne commande aucune écriture. Nul quand tout est lu.
  attente: string | null
  erreur: string | null
  onDeclarer: (date: string) => void
  onFermer: () => void
}) {
  const [date, setDate] = useState('')
  const refus = refusPaiementPersonnel(cotisation, date || null, { ...contexte, aujourdHui: aujourdHuiAParis() })
  const montant = montantDeLEcheance(cotisation)

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="titre-paiement-personnel" style={{ width: 'min(520px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="titre-paiement-personnel" style={{ marginTop: 0 }}>Payée depuis le compte personnel</h2>
        <p style={{ marginTop: -8 }}>
          Échéance du {formatDate(cotisation.echeance)} : {formatMoney(montant)}
          {cotisation.montant_verse != null ? ' versés' : ' appelés'}
          {cotisation.montant_csg_crds != null ? `, dont ${formatMoney(cotisation.montant_csg_crds)} de CSG-CRDS` : ', CSG-CRDS non saisie'}.
        </p>
        <div className="field">
          <label htmlFor="date-paiement-personnel">Date du paiement</label>
          <input
            id="date-paiement-personnel"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={enCours}
          />
        </div>
        <p className="muted" style={{ marginTop: -8 }}>
          Le jour où l’exploitant l’a payée de sa poche, tel que son relevé personnel le montre : l’application ne le
          propose pas.
        </p>
        {refus
          ? <p className={refus.cle === 'date_absente' ? 'muted' : 'error-text'}>{refus.message}</p>
          : <p>{confirmationPaiementPersonnel(cotisation, date, contexte.modele)}</p>}
        {attente && <p className="muted">{attente}</p>}
        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onFermer} disabled={enCours}>Annuler</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={refus !== null || enCours || attente !== null}
            onClick={() => onDeclarer(date)}
          >
            {enCours ? 'Déclaration…' : 'Déclarer le paiement'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20,
}
