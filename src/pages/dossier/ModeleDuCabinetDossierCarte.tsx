import { useEffect, useRef, useState } from 'react'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import {
  MODELE_DU_CABINET_PREVU,
  confirmationDeLApplication,
  modeleAUnDossier,
  texteDUnChangementDuModele,
  type LectureDuModele,
} from '../../lib/modeleDuCabinet'
import { appliquerPuisRelireLePlan, lireLeModeleDuCabinet } from '../../lib/modeleDuCabinetLecture'
import type { LectureDuPlan } from '../../lib/planComptable'
import type { PlanLu } from '../../lib/planDepuisLaBalance'

// « APPLIQUER LE MODÈLE DU CABINET » SUR LE PLAN D'UN DOSSIER EXISTANT (ligne 43, étape PC5b ; la règle et les mots :
// lib/modeleDuCabinet.ts, `modeleAUnDossier` ; le chemin de l'écriture est celui de « Nouveau dossier »,
// `appliquerLeModeleAuDossier`, que `appliquerPuisRelireLePlan` suit de la relecture du plan).
//
// DERRIÈRE `MODELE_DU_CABINET_PREVU`, baissé : la carte ne se rend pas et ne lit rien. Levée, elle lit le modèle du cabinet
// du dossier (une fois par cabinet) ; tant qu'il n'est pas lu, ou s'il est refusé, rompu ou partiel, elle le dit et n'offre
// aucun geste. Le refus se dit AVANT le clic (modèle vide, exercice validé, plan qui tient déjà le modèle), la
// confirmation NOMME le nombre de rôles que le modèle règle et chaque compte qui change, le clic passe l'application sous un
// verrou `useRef` relâché APRÈS la relecture du plan, que la page reçoit (`onPlanRelu`) ; le refus de la base (une écriture
// ou un à-nouveau au dossier, l'accès) se dit en clair. Le modèle ne se copie qu'une fois : rien ne le ré-applique à un plan
// qui le tient.
export default function ModeleDuCabinetDossierCarte({ dossierId, cabinetId, planLu, onPlanRelu }: {
  dossierId: string
  /** Le cabinet du dossier, tel que la page l'a lu (`null` : pas encore lu). */
  cabinetId: string | null
  planLu: PlanLu
  onPlanRelu: (dossierId: string, lecture: LectureDuPlan) => void
}) {
  const { anneesValidees } = useExercicesValides()
  // Le modèle lu, avec le cabinet pour lequel il l'a été : une réponse pour un autre cabinet ne se montre pas.
  const [modele, setModele] = useState<{ cabinetId: string; lecture: LectureDuModele } | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Verrou d'exécution : posé avant le `try`, relâché dans le `finally`, après la relecture du plan.
  const applicationEnCours = useRef(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!MODELE_DU_CABINET_PREVU || cabinetId === null) return
    let annule = false
    void lireLeModeleDuCabinet(cabinetId).then((lu) => { if (!annule) setModele(lu) })
    return () => { annule = true }
  }, [cabinetId])

  if (!MODELE_DU_CABINET_PREVU) return null

  const lecture: LectureDuModele | null = cabinetId === null
    ? { modele: null, motif: 'le cabinet de ce dossier n’est pas connu' }
    : modele !== null && modele.cabinetId === cabinetId ? modele.lecture : null
  const offre = modeleAUnDossier(lecture, planLu, anneesValidees.length > 0)

  async function appliquer() {
    if (offre.etat !== 'a_appliquer') return
    if (applicationEnCours.current) return
    if (!window.confirm(confirmationDeLApplication(offre.regles, offre.changements))) return
    applicationEnCours.current = true
    setEnCours(true)
    setErreur(null)
    setMessage(null)
    try {
      const issue = await appliquerPuisRelireLePlan(dossierId)
      if (!issue.applique) {
        setErreur(issue.refus)
        return
      }
      if (issue.lecture.plan === null) {
        setErreur(`Le modèle a été appliqué, mais le plan n’a pas pu être relu (${issue.lecture.motif}) : recharge la page avant d’ouvrir le dossier.`)
        return
      }
      onPlanRelu(dossierId, issue.lecture)
      setMessage(`Modèle appliqué et plan relu : ${issue.nombre > 1 ? `${issue.nombre} rôles copiés` : issue.nombre === 1 ? 'un rôle copié' : 'aucun rôle copié'}.`)
    } finally {
      applicationEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Modèle de plan du cabinet</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Copie dans le plan de ce dossier les comptes que le cabinet donne à ses dossiers neufs. Le modèle ne se copie qu’une
        fois : ensuite, le dossier garde son propre plan.
      </p>
      {offre.etat === 'lecture' && <p className="muted">{offre.phrase}</p>}
      {offre.etat === 'refus' && <p className={lecture?.modele === null ? 'error-text' : 'muted'}>{offre.phrase}</p>}
      {offre.etat === 'a_appliquer' && (
        <>
          <p style={{ margin: '0 0 4px' }}>
            {`${offre.regles > 1 ? `${offre.regles} rôles s’écartent` : 'Un rôle s’écarte'} du plan de l’application ; ce que l’application du modèle change à ce dossier :`}
          </p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: '0.85rem' }}>
            {offre.changements.map((c) => <li key={c.role}>{texteDUnChangementDuModele(c)}</li>)}
          </ul>
          <button type="button" className="btn btn-primary btn-sm" onClick={appliquer} disabled={enCours}>
            {enCours ? 'Application…' : 'Appliquer le modèle du cabinet'}
          </button>
        </>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
      {message && <p className="muted">{message}</p>}
    </div>
  )
}
