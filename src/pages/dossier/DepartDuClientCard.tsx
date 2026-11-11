import { useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  DEPART_DU_CLIENT_PREVU, TITRE_DE_LA_CARTE, ceQueDitLaConservation, ceQueDitLaRemise, confirmationDeLaConservation,
  exercicesSansPaquet, refusDeLaConservation, termeAPoser,
} from '../../lib/departDuClient'
import { conserverLeDossier, leverLaConservation, type LectureDuDepart } from '../../lib/departDuClientLecture'
import { aujourdHuiAParis } from '../../lib/format'

// LA CARTE DU DÉPART D'UN CLIENT (ligne 44, INAL5 ; INAL-Q6, « Avoir le choix »), dans l'onglet Informations, juste avant
// la zone dangereuse. Elle offre les deux voies et dit, pour chacune, ce qu'elle fait et ce qui lui manque : (1) remettre
// les archives puis supprimer — les exercices dont le paquet n'a pas été téléchargé, nommés ; (2) garder le dossier dix ans
// — le terme qu'elle prendrait, ou celui qui court, et ce qu'elle interdit. La pose et la levée passent par les fonctions de
// la base seules, au chef ; leurs refus se disent AVANT le clic (`refusDeLaConservation`, dans l'ordre de la fonction) ; la
// pose se confirme en nommant le dossier et le terme. Une lecture illisible n'offre aucun geste. Verrou `useRef`, relâché
// après la relecture. Rien ne s'affiche le drapeau `DEPART_DU_CLIENT_PREVU` baissé.

export default function DepartDuClientCard(props: {
  dossierId: string
  dossierNom: string
  lecture: LectureDuDepart | null
  /** Fait relire le départ par l'onglet, après un geste, réussi ou non. */
  onDepartEcrit: () => void
}) {
  if (!DEPART_DU_CLIENT_PREVU) return null
  return <CarteDuDepart {...props} />
}

function CarteDuDepart({ dossierId, dossierNom, lecture: lu, onDepartEcrit }: {
  dossierId: string
  dossierNom: string
  lecture: LectureDuDepart | null
  onDepartEcrit: () => void
}) {
  const { estChef } = useAuth()
  const [enCours, setEnCours] = useState(false)
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  const gesteEnCours = useRef(false)

  // Une lecture d'un autre dossier n'est pas la sienne.
  const lecture = lu?.dossierId === dossierId ? lu : null
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  const lue = lecture?.etat === 'lue' ? lecture : null
  const manquants = lue ? exercicesSansPaquet(lue.exercices, lue.paquets, aujourdHuiAParis()) : []
  const aPoser = lue ? termeAPoser(lue.exercices) : null
  const refusDeLaPose = lue
    ? refusDeLaConservation({ estChef, conservation: lue.conservation, exercices: lue.exercices, accesClient: lue.accesClient })
    : null

  async function agir(geste: 'poser' | 'lever') {
    // Posé avant le `try` : dedans, le `return` d'un second clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (gesteEnCours.current || lue === null || !estChef) return
    if (geste === 'poser' && (refusDeLaPose !== null || aPoser === null)) return
    if (geste === 'lever' && lue.conservation === null) return
    gesteEnCours.current = true
    const dossierEcrit = dossierId
    try {
      const confirmation = geste === 'poser'
        ? confirmationDeLaConservation(dossierNom, aPoser!)
        : `Lever la conservation de « ${dossierNom} » : le dossier recevra de nouveau pièces, écritures, accès client et validations, et sa suppression attendra de nouveau le paquet d’archive de chaque exercice validé.`
      if (!window.confirm(confirmation)) return
      setEnCours(true)
      setAvis(null)
      const issue = geste === 'poser' ? await conserverLeDossier(dossierEcrit) : await leverLaConservation(dossierEcrit)
      setAvis(issue.ok
        ? { dossierId: dossierEcrit, erreur: null, fait: geste === 'poser' ? 'Le dossier est conservé ✓' : 'La conservation est levée ✓' }
        : { dossierId: dossierEcrit, erreur: `Rien n’a changé : ${issue.message}`, fait: null })
      // Relu, quoi qu'il arrive : le départ tel que la base le voit maintenant.
      onDepartEcrit()
    } finally {
      gesteEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 20 }} data-testid="depart-du-client">
      <h3 style={{ marginTop: 0 }}>{TITRE_DE_LA_CARTE}</h3>
      {lecture === null && <p className="muted">Chargement…</p>}
      {lecture?.etat === 'illisible' && (
        <p className="error-text" role="alert">
          Les paquets d’archive et la conservation du dossier n’ont pas pu être lus — {lecture.motif}. Aucun geste n’est offert
          tant qu’ils ne le sont pas.
        </p>
      )}
      {lue && (
        <>
          <p className="muted" style={{ marginTop: -8 }}>
            Au départ d’un client, le cabinet choisit entre deux voies.
          </p>
          <p data-testid="voie-remise">{ceQueDitLaRemise({ exercices: lue.exercices, manquants })}</p>
          <p data-testid="voie-conservation">{ceQueDitLaConservation({ conservation: lue.conservation, aPoser })}</p>
          {estChef ? (
            <>
              <div className="field-row" style={{ flexWrap: 'wrap', gap: 10 }}>
                {lue.conservation === null ? (
                  <button
                    type="button" className="btn btn-outline btn-sm" disabled={enCours || refusDeLaPose !== null}
                    onClick={() => { void agir('poser') }}
                  >
                    {enCours ? 'Enregistrement…' : 'Conserver le dossier dix ans'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => { void agir('lever') }}>
                    {enCours ? 'Enregistrement…' : 'Lever la conservation'}
                  </button>
                )}
              </div>
              {lue.conservation === null && refusDeLaPose !== null && (
                <p className="muted" style={{ marginBottom: 0 }}>{refusDeLaPose}</p>
              )}
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>Seul un comptable en chef conserve un dossier ou lève sa conservation.</p>
          )}
          {erreur && <p className="error-text" role="alert">{erreur}</p>}
          {fait && <p className="muted">{fait}</p>}
        </>
      )}
    </div>
  )
}
