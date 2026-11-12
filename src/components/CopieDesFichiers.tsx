import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  COPIE_DES_FICHIERS_PREVUE, PLAFOND_D_UN_LOT, rappelDeLaCopie, type LectureDesCopies,
} from '../lib/copieDesFichiers'
import { copierLesFichiersDuCabinet, lireLesCopiesDuCabinet, type IssueDeLaCopie } from '../lib/copieDesFichiersLecture'
import { aujourdHuiAParis } from '../lib/format'

// LA COPIE DES FICHIERS SUR UN SUPPORT DU CABINET (INAL6, lignes 20.65 et 44), sur le tableau de bord, HORS de la grille
// (comme les RIB à confirmer) : le rappel (« la dernière copie complète date de plus d'un mois ») pour toute l'équipe du
// cabinet, et le geste au chef seul — la base n'enregistre une copie que de lui. Sous le drapeau de la migration
// (`COPIE_DES_FICHIERS_PREVUE`) : baissé, rien ne se lit ni ne s'affiche.
//
// Le geste : un verrou `useRef`, posé avant le `try`, relâché dans le `finally` après la relecture. Une lecture partielle
// d'un inventaire ne fabrique AUCUN ZIP (lib/copieDesFichiersLecture.ts) ; la phrase le dit.

function telechargerLeZip(nom: string, octets: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(octets)], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Laisser le navigateur prendre le fichier avant de libérer l'adresse.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const LIBELLE_COPIER = 'Copier les fichiers des dossiers sur ce poste'

export default function CopieDesFichiers({ className }: { className?: string }) {
  const { estChef, monCabinetId } = useAuth()
  const [lecture, setLecture] = useState<{ cabinetId: string; lecture: LectureDesCopies } | null>(null)
  const [avancement, setAvancement] = useState<string | null>(null)
  const [issue, setIssue] = useState<IssueDeLaCopie | null>(null)
  const copieEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)

  const relire = useCallback(async (cabinetId: string) => {
    const lu = await lireLesCopiesDuCabinet(cabinetId)
    setLecture({ cabinetId, lecture: lu })
  }, [])

  useEffect(() => {
    if (!COPIE_DES_FICHIERS_PREVUE || !monCabinetId) return
    let annule = false
    void lireLesCopiesDuCabinet(monCabinetId).then((lu) => { if (!annule) setLecture({ cabinetId: monCabinetId, lecture: lu }) })
    return () => { annule = true }
  }, [monCabinetId])

  if (!COPIE_DES_FICHIERS_PREVUE || !monCabinetId) return null
  const lue = lecture !== null && lecture.cabinetId === monCabinetId ? lecture.lecture : null
  const rappel = rappelDeLaCopie(lue, aujourdHuiAParis())

  async function copier() {
    if (copieEnCours.current || !monCabinetId) return
    copieEnCours.current = true
    const cabinetId = monCabinetId
    try {
      setEnCours(true)
      setIssue(null)
      setAvancement('Lecture des dossiers…')
      const resultat = await copierLesFichiersDuCabinet(cabinetId, {
        telecharger: telechargerLeZip, maintenant: () => new Date(), avancement: setAvancement,
      })
      setIssue(resultat)
      await relire(cabinetId)
    } finally {
      setAvancement(null)
      setEnCours(false)
      copieEnCours.current = false
    }
  }

  const pastille = rappel.genre === 'rappel' ? 'check-attention' : rappel.genre === 'a_jour' ? 'check-neutre' : null
  return (
    <section className={`avis-rib copie-des-fichiers${rappel.genre === 'rappel' ? ' avis-rib-attente' : ' avis-rib-discret'}${className ? ` ${className}` : ''}`}
      aria-label="Copie des fichiers sur un support du cabinet">
      {pastille && <span className={`check-dot ${pastille}`} aria-hidden="true" />}
      <div className="avis-rib-corps">
        {rappel.genre === 'rien'
          ? <p className="avis-rib-phrase muted">Lecture de la dernière copie des fichiers…</p>
          : <p className={`avis-rib-phrase${rappel.genre === 'illisible' ? ' muted' : ''}`}
            title={rappel.genre === 'illisible' ? rappel.motif : undefined}>{rappel.phrase}</p>}
        {estChef && (
          <>
            <p className="avis-rib-texte">
              Tous les fichiers des dossiers du cabinet — pièces de tout exercice, documents, originaux des factures reprises —,
              chacun relu à son empreinte, en ZIP d’au plus {Math.round(PLAFOND_D_UN_LOT / 1024 / 1024)} Mio, un ZIP ou plus
              par dossier, chacun avec son manifeste. À ranger sur un disque ou un espace du cabinet, jamais sur Google Drive.
            </p>
            <div className="field-row">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void copier()} disabled={enCours}>
                {enCours ? 'Copie en cours…' : LIBELLE_COPIER}
              </button>
            </div>
          </>
        )}
        {avancement && <p className="avis-rib-texte muted" role="status">{avancement}</p>}
        {issue && !issue.ok && <p className="avis-rib-texte" role="alert">{issue.message}</p>}
        {issue && issue.ok && (
          <div className="avis-rib-texte" role="status">
            <p>
              {issue.bilan.lots} ZIP pour {issue.bilan.dossiers} dossier(s) : {issue.bilan.fichiers} fichier(s), dont{' '}
              {issue.bilan.verifies} vérifié(s) à leur empreinte, {issue.bilan.nonVerifies} sans empreinte en base.
            </p>
            {(issue.bilan.ecarts > 0 || issue.bilan.manquants > 0) && (
              <p role="alert">
                {issue.bilan.ecarts} écart(s) d’empreinte et {issue.bilan.manquants} fichier(s) manquant(s) : chaque manifeste les
                nomme. La copie n’est pas complète ; à signaler sans attendre.
              </p>
            )}
            <ul>{issue.bilan.decoupe.map((d) => <li key={d}>{d}</li>)}</ul>
            {issue.bilan.enregistrementRefuse && (
              <p role="alert">Les ZIP sont partis, mais la copie ne s’est pas enregistrée : {issue.bilan.enregistrementRefuse}</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
