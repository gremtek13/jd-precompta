import { useState, type CSSProperties } from 'react'
import { formatDate, formatMoney } from '../../lib/format'
import { pourLEspace, type EspaceVentes } from '../../lib/espaceVentes'
import {
  jugerLAcompte, resumeDeLAcompte, type EtatAcomptesDuDevis, type SaisieAcompte,
} from '../../lib/acomptesDuDevis'
import type { Devis, ModeComptable } from '../../lib/types'

// L'ACOMPTE D'UN DEVIS ACCEPTÉ (espace client, étape P5b5a), derrière `ACOMPTES_PREVUS` : un pourcentage du devis ou un
// montant TTC, au choix (P5B-Q1), et la date du versement, facultative (P5B2-Q1). Elle ne fait que SAISIR : la vue
// (DevisVue.tsx) tient le verrou, la confirmation qui nomme le devis, le client, le TTC exact et la date du versement, et
// l'écriture, par `facturer_acompte_devis` seule.
//
// AVANT LE CLIC, sur la saisie TELLE QU'ELLE PART (`jugerLAcompte`, lib/acomptesDuDevis.ts) : le TTC exact et les lignes
// que la base calculera, ou le premier refus — ceux de la base dans son ordre et sous ses mots, le devis de biens
// (P5B3-Q1) et la date du versement à venir — ; « Facturer l'acompte » grisé sous le refus.

type Props = {
  espace: EspaceVentes
  dossierId: string
  // Le devis tel que la liste l'a lu, et son état d'acompte lu avec lui.
  devis: Devis
  etat: EtatAcomptesDuDevis
  mode: ModeComptable
  aujourdHui: string
  occupe: boolean
  erreur: string | null
  onClose: () => void
  onFacturer: (saisie: SaisieAcompte) => void
}

export default function DevisAcompteModal(props: Props) {
  const { espace, dossierId, devis, etat, mode, aujourdHui, occupe, erreur } = props
  const dire = (texte: string) => pourLEspace(espace, texte)
  const [saisie, setSaisie] = useState<SaisieAcompte>({ mode: 'pourcentage', montant: '', dateVersement: '' })
  const jugement = jugerLAcompte({ dossierId, devis, etat, mode, saisie, aujourdHui })
  const nAcomptes = etat.acomptesValides.length

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="devis-acompte-titre" style={{ width: 'min(600px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="devis-acompte-titre" style={{ marginTop: 0 }}>Acompte sur le devis {devis.numero}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <span className="nom-fichier">{devis.tiers_nom}</span> — {formatMoney(devis.montant_ttc)} TTC, accepté
          {devis.date_reponse ? ` le ${formatDate(devis.date_reponse)}` : ''}.
          {nAcomptes > 0 && ` ${nAcomptes === 1 ? 'Un acompte validé' : `${nAcomptes} acomptes validés`} : le nouveau se répartit sur ce qui reste à facturer.`}
        </p>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend>Le montant de l’acompte</legend>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio" name="devis-acompte-mode" checked={saisie.mode === 'pourcentage'}
                onChange={() => setSaisie((s) => ({ ...s, mode: 'pourcentage' }))}
              />
              Un pourcentage du devis
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input
                type="radio" name="devis-acompte-mode" checked={saisie.mode === 'ttc'}
                onChange={() => setSaisie((s) => ({ ...s, mode: 'ttc' }))}
              />
              Un montant TTC
            </label>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="devis-acompte-montant">{saisie.mode === 'pourcentage' ? 'Pourcentage du devis (%)' : 'Montant TTC (€)'}</label>
          <input
            id="devis-acompte-montant" inputMode="decimal" value={saisie.montant}
            onChange={(e) => setSaisie((s) => ({ ...s, montant: e.target.value }))}
          />
        </div>

        <div className="field">
          <label htmlFor="devis-acompte-versement">Date du versement (facultative)</label>
          <input
            id="devis-acompte-versement" type="date" value={saisie.dateVersement}
            onChange={(e) => setSaisie((s) => ({ ...s, dateVersement: e.target.value }))}
          />
        </div>

        {erreur ? <p className="error-text" role="alert">{erreur}</p>
          : !jugement.ok ? <p className="error-text">{dire(jugement.refus)}</p>
            : (
              <div aria-label="L’acompte calculé">
                <p>{dire(resumeDeLAcompte(jugement))}</p>
                <ul className="muted" style={{ marginTop: 0 }}>
                  {jugement.prepare.lignes.map((l) => (
                    <li key={`${l.taux_tva}|${l.nature ?? ''}`}>
                      {l.designation} : {formatMoney(l.prix_unitaire_ht)} HT, TVA {String(l.taux_tva).replace('.', ',')} %
                    </li>
                  ))}
                </ul>
              </div>
            )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={props.onClose} disabled={occupe}>Annuler</button>
          <button
            type="button" className="btn btn-primary" disabled={occupe || !jugement.ok}
            onClick={() => props.onFacturer(saisie)}
          >
            {occupe ? 'Facturation…' : 'Facturer l’acompte'}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
