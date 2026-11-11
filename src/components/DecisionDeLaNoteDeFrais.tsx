import { useState } from 'react'
import { MOYENS_DE_REMBOURSEMENT, type MoyenDeRemboursement } from '../lib/notesDeFrais'
import {
  LIBELLES_DU_REMBOURSEMENT, refusDuMotifDeRefus, refusDuRemboursement, type NoteDeFrais,
} from '../lib/notesDeFraisVue'
import { pourLEspace, type EspaceVentes } from '../lib/espaceVentes'

// LA DÉCISION SUR UNE NOTE DE FRAIS (ligne 51.5, étape B8) : le motif d'un refus, ou la date et le moyen d'un remboursement
// déclaré — le même formulaire chez le client « Achats » et au cabinet, sans lecture ni écriture : l'écran qui le monte
// appelle la fonction de la base, sous SON verrou. Le refus du module se dit avant le clic, sur la saisie telle qu'elle part.

export type DecisionSaisie =
  | { genre: 'refus'; motif: string }
  | { genre: 'remboursement'; date: string; moyen: MoyenDeRemboursement }

export default function DecisionDeLaNoteDeFrais({ note, genre, espace, libelleDuMotif, aujourdhui, occupe, annuler, envoyer }: {
  note: NoteDeFrais
  genre: 'refus' | 'remboursement'
  espace: EspaceVentes
  /** Le libellé du motif : il dit que l'auteur de la note le lit. */
  libelleDuMotif: string
  aujourdhui: string
  occupe: boolean
  annuler: () => void
  envoyer: (d: DecisionSaisie) => void
}) {
  const [motif, setMotif] = useState('')
  const [date, setDate] = useState(aujourdhui)
  const [moyen, setMoyen] = useState('')
  const refus = genre === 'refus' ? refusDuMotifDeRefus(motif) : refusDuRemboursement(note, date, moyen, aujourdhui)
  const dit = refus === null ? null : pourLEspace(espace, refus)
  return (
    <div style={{ marginTop: 6 }}>
      <div className="field-row aligne-bas" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {genre === 'refus' ? (
          <label style={{ flex: '1 1 260px' }}>
            {libelleDuMotif}
            <input type="text" value={motif} maxLength={200} disabled={occupe} onChange={(e) => setMotif(e.target.value)} />
          </label>
        ) : (
          <>
            <label>
              Remboursée le
              <input type="date" value={date} min={note.date_depense} max={aujourdhui} disabled={occupe} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Moyen du remboursement
              <select value={moyen} disabled={occupe} onChange={(e) => setMoyen(e.target.value)}>
                <option value="">{espace === 'client' ? 'Choisis…' : 'Choisir…'}</option>
                {MOYENS_DE_REMBOURSEMENT.map((m) => <option key={m} value={m}>{LIBELLES_DU_REMBOURSEMENT[m]}</option>)}
              </select>
            </label>
          </>
        )}
        <button type="button" className="btn btn-primary btn-sm" disabled={occupe || refus !== null} title={dit ?? undefined}
          onClick={() => envoyer(genre === 'refus' ? { genre, motif } : { genre, date, moyen: moyen as MoyenDeRemboursement })}>
          {genre === 'refus' ? 'Refuser la note' : 'Déclarer le remboursement'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" disabled={occupe} onClick={annuler}>Annuler</button>
      </div>
      {dit !== null && <p className="error-text">{dit}</p>}
    </div>
  )
}
