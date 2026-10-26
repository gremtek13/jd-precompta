import type { CSSProperties, ReactNode } from 'react'

// UNE CONFIRMATION DANS LE FORMULAIRE D'UNE FACTURE (espace client, étape A2b) : remplacer une ligne déjà saisie par un article,
// ou mettre l'article au prix de la ligne. Elle dit ce qui sera remplacé ou changé AVANT qu'on confirme, et reste affichée dans
// la page (jamais un `window.confirm`, qu'on ne voit ni ne teste) ; elle n'écrit rien elle-même, ni ne tient de verrou : le
// formulaire qui l'ouvre fait l'un et l'autre. `refus` : ce que la base refuserait, dit avant le clic — le bouton se grise.
//
// SA CARTE DÉFILE (26/10/2026, 23Q2Q2-Q1), comme celle des autres fenêtres (`maxHeight: '92vh'`, `overflowY: 'auto'`). Le voile
// est fixe et ne défile pas, et il centre la carte : plus haute que l'écran, elle en débordait en haut comme en bas, hors
// d'atteinte. Mesuré sur la confirmation de l'entrée dans l'équipe, qui nomme ce que la personne perd : à 375 × 667 pixels,
// une carte de 888 pixels commençait à 111 pixels au-dessus de l'écran, et « Faire entrer dans l'équipe » restait dessous ;
// la confirmation du rattachement (23-Q2), aussi longue, était exposée de même.
export default function ConfirmationArticle({ titre, children, boutonLabel, occupe, refus, erreur, onConfirmer, onAnnuler }: {
  titre: string
  children: ReactNode
  boutonLabel: string
  occupe: boolean
  refus: string | null
  erreur: string | null
  onConfirmer: () => void
  onAnnuler: () => void
}) {
  return (
    <div style={overlayStyle}>
      <div className="card" role="alertdialog" aria-modal="true" aria-labelledby="article-confirmation-titre" style={{ width: 'min(480px, 92vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 id="article-confirmation-titre" style={{ marginTop: 0 }}>{titre}</h2>
        {children}
        {refus && <p className="error-text">{refus}</p>}
        {erreur && <p className="error-text" role="alert">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onAnnuler} disabled={occupe}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={onConfirmer} disabled={occupe || refus != null} title={refus ?? undefined}>
            {occupe ? 'Enregistrement…' : boutonLabel}
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
