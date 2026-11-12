import { useEffect, useRef, useState } from 'react'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import {
  changementsDuModele,
  comptesDuModele,
  confirmationDuModele,
  nomDuRole,
  refusDuModele,
  saisieDuModele,
  texteDUnChangementDuModele,
  type LectureDuModele,
  type SaisieDuModele,
  type SaisieDUnRole,
} from '../lib/modeleDuCabinet'
import {
  lireLeModeleDuCabinet,
  lireLesComptesDesCategoriesCommunes,
  reglerPuisRelireLeModele,
  type LectureDesCategoriesCommunes,
} from '../lib/modeleDuCabinetLecture'
import { rolesLusAuPlan } from '../lib/planComptable'

// LE MODÈLE DE PLAN DU CABINET, À L'ÉCRAN (ligne 43, étape PC5 ; la page du cabinet, que seul le chef ouvre — App.tsx).
// Le tableau des rôles : la racine du plan comptable, fixe et montrée ; le compte, le libellé et, pour les trois tiers, le
// préfixe des comptes auxiliaires, saisis. Rien ne s'offre avant que le modèle ET les catégories communes soient lus en
// entier (les refus 9 et 10 les comparent) ; lus en partie, refusés ou rompus, l'écran le dit et n'offre aucun geste. Le
// refus de la base se dit avant le clic, sur la saisie telle qu'elle part (lib/modeleDuCabinet.ts) ; la confirmation
// nomme chaque changement ; le clic passe `regler_modele_du_cabinet` seule, sous un verrou relâché APRÈS la relecture.

interface Lu {
  cabinetId: string
  modele: LectureDuModele
  categories: LectureDesCategoriesCommunes
}

export default function ModeleDuCabinetCarte({ cabinetId }: { cabinetId: string }) {
  const [lu, setLu] = useState<Lu | null>(null)
  const [saisie, setSaisie] = useState<SaisieDuModele | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Verrou d'exécution du réglage, en `useRef` : deux clics du même rendu ne règlent pas deux fois. Relâché après la
  // relecture du modèle, que le réglage attend.
  const reglageEnCours = useRef(false)

  useEffect(() => {
    let annule = false
    void Promise.all([lireLeModeleDuCabinet(cabinetId), lireLesComptesDesCategoriesCommunes()]).then(([modele, categories]) => {
      if (annule || modele.cabinetId !== cabinetId) return
      setLu({ cabinetId, modele: modele.lecture, categories })
      setSaisie(modele.lecture.modele ? saisieDuModele(modele.lecture.modele) : null)
    })
    return () => { annule = true }
  }, [cabinetId])

  const lecture = lu !== null && lu.cabinetId === cabinetId ? lu : null
  if (lecture === null) {
    return <div className="card"><h2>Modèle de plan du cabinet</h2><p className="muted">Chargement…</p></div>
  }
  const motif = lecture.modele.modele === null ? lecture.modele.motif
    : lecture.categories.etat === 'incomplets' ? `catégories communes : ${lecture.categories.motif}` : null
  const modele = lecture.modele.modele
  if (motif !== null || modele === null || saisie === null || lecture.categories.etat !== 'lus') {
    return (
      <div className="card">
        <h2>Modèle de plan du cabinet</h2>
        <BandeauLecturePartielle quoi="Le modèle de plan du cabinet" motif={motif} accord="lu"
          consequence="Rien ne s’enregistre d’ici tant qu’il n’est pas lu en entier, avec les catégories communes." />
      </div>
    )
  }

  const comptes = comptesDuModele(saisie)
  const refus = refusDuModele(comptes, lecture.categories.comptes)
  const changements = refus === null ? changementsDuModele(comptes, modele) : []

  function changer(role: keyof SaisieDuModele, champ: keyof SaisieDUnRole, valeur: string) {
    setSaisie((avant) => (avant === null ? avant : { ...avant, [role]: { ...avant[role], [champ]: valeur } }))
    setMessage(null)
  }

  async function regler() {
    if (reglageEnCours.current || refus !== null || changements.length === 0) return
    if (!window.confirm(confirmationDuModele(changements))) return
    reglageEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await reglerPuisRelireLeModele(cabinetId, comptes)
      if (!issue.regle) {
        setErreur(issue.refus)
        return
      }
      setLu((avant) => (avant === null || avant.cabinetId !== cabinetId ? avant : { ...avant, modele: issue.lecture }))
      setSaisie(issue.lecture.modele ? saisieDuModele(issue.lecture.modele) : null)
      setMessage('Modèle enregistré. Il s’appliquera aux dossiers créés à partir de maintenant ; aucun dossier existant ne change.')
    } finally {
      reglageEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card">
      <h2>Modèle de plan du cabinet</h2>
      <p className="muted">
        Les comptes que le cabinet donne à ses dossiers neufs : « Nouveau dossier » copie ce modèle dans le plan du dossier
        créé. Il ne change jamais un dossier existant, et chaque dossier garde ensuite son propre plan.
        {lecture.modele.regles.length === 0 ? ' Aujourd’hui, le modèle est le plan de l’application.' : ` Aujourd’hui, il règle ${lecture.modele.regles.length} rôle(s).`}
      </p>
      <div className="tableau-adaptable">
        <table className="table-formulaire table-empilable">
          <thead>
            <tr><th>Rôle</th><th>Racine</th><th>Compte</th><th>Libellé</th><th>Préfixe des auxiliaires</th></tr>
          </thead>
          <tbody>
            {rolesLusAuPlan().map((d) => {
              const s = saisie[d.role]
              if (s === undefined) return null
              return (
              <tr key={d.role}>
                <td data-libelle="Rôle">{nomDuRole(d.role)}</td>
                <td data-libelle="Racine">{d.racines.join(' ou ')}</td>
                <td data-libelle="Compte">
                  <input aria-label={`Compte — ${nomDuRole(d.role)}`} inputMode="numeric" value={s.compte}
                    onChange={(e) => changer(d.role, 'compte', e.target.value)} disabled={enCours} />
                </td>
                <td data-libelle="Libellé">
                  <input aria-label={`Libellé — ${nomDuRole(d.role)}`} value={s.libelle}
                    onChange={(e) => changer(d.role, 'libelle', e.target.value)} disabled={enCours} />
                </td>
                <td data-libelle="Préfixe des auxiliaires">
                  {d.prefixeAuxiliaireDefaut === null ? '—' : (
                    <input aria-label={`Préfixe — ${nomDuRole(d.role)}`} value={s.prefixe}
                      onChange={(e) => changer(d.role, 'prefixe', e.target.value)} disabled={enCours} />
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {refus !== null && <p className="error-text">{refus}</p>}
      {refus === null && changements.length > 0 && (
        <ul className="muted">
          {changements.map((c) => <li key={c.role}>{texteDUnChangementDuModele(c)}</li>)}
        </ul>
      )}
      {erreur && <p className="error-text">{erreur}</p>}
      {message && <p className="muted">{message}</p>}
      <div className="field-row aligne-bas" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => { void regler() }}
          disabled={enCours || refus !== null || changements.length === 0}>
          {enCours ? 'Enregistrement…' : 'Enregistrer le modèle'}
        </button>
      </div>
    </div>
  )
}
