import { useState, type CSSProperties } from 'react'
import {
  ceQuiFigeLEcheance, jugerLaModification, saisieDe, type ContexteDesGestes, type SaisieDeLEcheance,
} from '../../lib/gestesDesEcheances'
import { formatDate } from '../../lib/format'
import type { CotisationDeclaree } from '../../lib/types'
import ChampsDeLaDescription from './ChampsDeLaDescription'

// LA FENÊTRE « MODIFIER » D'UNE ÉCHÉANCE DE COTISATION (COT-Q3) : l'échéance pré-remplie telle qu'elle est en base, et, avant
// le clic, ce que la base refuserait ou ce que le geste change à son rapprochement. Rien n'est jugé ici : le refus et les
// effets viennent de lib/gestesDesEcheances.ts, sur la saisie telle qu'elle partirait, relus à chaque rendu — une relecture
// de l'onglet qui fige l'échéance ou la rapproche change ce que la fenêtre dit.
//
// La fenêtre n'écrit pas : l'onglet écrit, sous le verrou qu'il partage avec ses autres écritures du brouillon. Rendue hors
// de la carte du tableau, comme celle du paiement personnel (un conteneur de requêtes décalerait un élément fixe).
export default function ModifierEcheanceModal({
  cotisation, contexte, enCours, attente, erreur, onEnregistrer, onFermer,
}: {
  cotisation: CotisationDeclaree
  contexte: ContexteDesGestes
  enCours: boolean
  // Pourquoi l'enregistrement attend : l'onglet relit ses listes, ou les a lues en partie. Nul quand tout est lu.
  attente: string | null
  erreur: string | null
  onEnregistrer: (saisie: SaisieDeLEcheance) => void
  onFermer: () => void
}) {
  const [saisie, setSaisie] = useState<SaisieDeLEcheance>(() => saisieDe(cotisation))
  const jugement = jugerLaModification(cotisation, saisie, contexte)
  // Figée par la validation ou payée depuis le compte personnel, l'échéance ne se DÉCRIT plus que (TNS-Q2) : ses montants,
  // sa date et son marqueur restent tels qu'ils sont, et la fenêtre ne les offre pas. Sans la description, rien ne change.
  const descriptionSeule = saisie.description !== undefined && ceQuiFigeLEcheance(cotisation, contexte) !== null
  const figes = enCours || descriptionSeule
  const changer = (champ: keyof SaisieDeLEcheance) => (valeur: string | boolean) => setSaisie((s) => ({ ...s, [champ]: valeur }))

  return (
    <div style={overlayStyle}>
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="titre-modifier-echeance" style={{ width: 'min(560px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="titre-modifier-echeance" style={{ marginTop: 0 }}>
          {descriptionSeule ? 'Décrire' : 'Modifier'} l’échéance du {formatDate(cotisation.echeance)}
        </h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="modifier-echeance">Échéance</label>
            <input id="modifier-echeance" type="date" value={saisie.echeance} disabled={figes} onChange={(e) => changer('echeance')(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="modifier-appele">Montant appelé</label>
            <input id="modifier-appele" type="number" step="0.01" value={saisie.appele} disabled={figes} onChange={(e) => changer('appele')(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="modifier-verse">Montant versé</label>
            <input id="modifier-verse" type="number" step="0.01" value={saisie.verse} disabled={figes} onChange={(e) => changer('verse')(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="modifier-csg">dont CSG-CRDS</label>
            <input id="modifier-csg" type="number" step="0.01" value={saisie.csg} disabled={figes} onChange={(e) => changer('csg')(e.target.value)} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: -8 }}>
          CSG-CRDS : zéro pour un organisme qui n’en prélève pas (une caisse de retraite) ; laissée vide, elle reste « non
          saisie ». Versé : zéro pour une échéance qu’un crédit de l’organisme a couverte, sans paiement.
        </p>
        <div className="field">
          <label>
            <input type="checkbox" checked={saisie.previsionnel} disabled={figes} onChange={(e) => changer('previsionnel')(e.target.checked)} style={{ marginRight: 6 }} />
            Prévisionnel (estimation, pas encore un appel définitif)
          </label>
        </div>
        {/* L'organisme, l'année payée et la nature (TNS-Q2) : seulement sous le drapeau, sur une échéance lue avec ses colonnes. */}
        {saisie.description && (
          <ChampsDeLaDescription valeur={saisie.description} disabled={enCours} prefixe="modifier"
            onChange={(description) => setSaisie((s) => ({ ...s, description }))} />
        )}
        {'refus' in jugement
          ? <p className={jugement.refus.discret ? 'muted' : 'error-text'}>{jugement.refus.message}</p>
          : (
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              {jugement.effets.map((effet) => <li key={effet}>{effet}</li>)}
            </ul>
          )}
        {attente && <p className="muted">{attente}</p>}
        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onFermer} disabled={enCours}>Annuler</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={'refus' in jugement || enCours || attente !== null}
            onClick={() => onEnregistrer(saisie)}
          >
            {enCours ? 'Enregistrement…' : 'Enregistrer'}
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
