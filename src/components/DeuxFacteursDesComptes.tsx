import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { niveauDuJeton } from '../lib/doubleAuthentification'
import {
  CODE_AVANT_D_AFFAIBLIR, DEUX_FACTEURS_EXIGES_EXPORTE, confirmationDuGeste, etatDuCompteEnMots, exigenceRecommandee,
  gestesDuCompte, refusDuGesteAvantLeClic, type CompteDeuxFacteurs, type GesteDesDeuxFacteurs,
} from '../lib/deuxFacteursExiges'
import { agirSurLeCompte, lireLesComptes, type PerimetreDesComptes } from '../lib/deuxFacteursExigesAppels'
import { formatDate } from '../lib/format'

// LA DOUBLE AUTHENTIFICATION DES COMPTES, CÔTÉ CABINET (C7, second temps ; SEC-Q3 et SEC-Q4) : exiger, ne plus exiger,
// retirer le second facteur d'un appareil perdu, compte par compte. Monté d'une ligne dans l'onglet Équipe et dans
// l'onglet Accès ; le drapeau baissé, il ne rend rien et ne lit rien. La liste se lit EN ENTIER, rien avant son retour ;
// illisible, il le dit et n'offre aucun geste. Chaque geste se confirme en nommant le compte, part sous un verrou relâché
// après la relecture, et la base juge (l'autorité, le facteur vérifié) : l'écran n'offre que ce qu'elle dit permis. Lever
// et retirer demandent que l'auteur ait donné son code (SEC2-Q2) : le niveau de la session, lu de son jeton comme la porte
// de l'application le lit (aucune lecture neuve), dit ce refus avant le clic, aux mots de la base.

const LIBELLES: Readonly<Record<GesteDesDeuxFacteurs, string>> = {
  exiger: 'Exiger', lever: 'Ne plus exiger', retirer: 'Retirer le second facteur (appareil perdu)',
}

type Lecture = { etat: 'lecture' } | { etat: 'illisible'; message: string } | { etat: 'lue'; comptes: CompteDeuxFacteurs[] }

export default function DeuxFacteursDesComptes({ perimetre, cases }: {
  perimetre: PerimetreDesComptes
  /** Les cases de chaque accès client (onglet Accès), pour la recommandation de SEC-Q2 ; absentes : non lues. */
  cases?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}) {
  if (!DEUX_FACTEURS_EXIGES_EXPORTE) return null
  return <ListeDesComptes perimetre={perimetre} cases={cases} />
}

function ListeDesComptes({ perimetre, cases }: {
  perimetre: PerimetreDesComptes
  cases?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}) {
  const cabinetId = perimetre.genre === 'equipe' ? perimetre.cabinetId : null
  const dossierId = perimetre.genre === 'acces' ? perimetre.dossierId : null
  const cle = `${cabinetId ?? ''}|${dossierId ?? ''}`
  const [lecture, setLecture] = useState<{ cle: string; valeur: Lecture }>({ cle, valeur: { etat: 'lecture' } })
  const [message, setMessage] = useState<string | null>(null)
  const [relecture, setRelecture] = useState(0)
  const gesteEnCours = useRef(false)
  const [occupe, setOccupe] = useState(false)
  // Le jeton que la requête portera, celui dont la base lit `aal` (SEC2-Q2).
  const { session } = useAuth()
  const niveau = session ? niveauDuJeton(session.access_token) : null

  useEffect(() => {
    let annule = false
    // Le périmètre se refait de ses identifiants : l'objet du parent change à chaque rendu sans que le périmètre change.
    const lu: PerimetreDesComptes = cabinetId !== null ? { genre: 'equipe', cabinetId } : { genre: 'acces', dossierId: dossierId ?? '' }
    void lireLesComptes(lu).then((issue) => {
      if (annule) return
      setLecture({ cle, valeur: issue.ok ? { etat: 'lue', comptes: issue.valeur } : { etat: 'illisible', message: issue.message } })
    })
    return () => { annule = true }
  }, [cle, cabinetId, dossierId, relecture])

  async function agir(geste: GesteDesDeuxFacteurs, compte: CompteDeuxFacteurs) {
    if (gesteEnCours.current) return
    const refus = refusDuGesteAvantLeClic(geste, niveau)
    if (refus !== null) { setMessage(refus); return }
    if (!window.confirm(confirmationDuGeste(geste, compte))) return
    gesteEnCours.current = true
    setOccupe(true)
    setMessage(null)
    try {
      const issue = await agirSurLeCompte(geste, compte.userId)
      setMessage(issue.ok ? `${LIBELLES[geste]} : fait pour ${compte.email ?? 'ce compte'}.` : `Rien n’a changé : ${issue.message}`)
      setLecture({ cle, valeur: { etat: 'lecture' } })
      setRelecture((n) => n + 1)
    } finally {
      gesteEnCours.current = false
      setOccupe(false)
    }
  }

  const valeur: Lecture = lecture.cle === cle ? lecture.valeur : { etat: 'lecture' }
  const affaiblirRefuse = valeur.etat === 'lue'
    && valeur.comptes.some((c) => gestesDuCompte(c).some((g) => refusDuGesteAvantLeClic(g, niveau) !== null))
  return (
    <div className="card" data-testid="deux-facteurs-des-comptes">
      <h3 style={{ marginTop: 0 }}>Double authentification des comptes</h3>
      <p className="muted">
        Un compte exigé donne le code de son application d’authentification à chaque connexion ; recommandée pour le
        cabinet, l’équipe et tout accès client qui porte « Ventes », « Banque », « Achats » ou « Documents ».
      </p>
      {message && <p role="status">{message}</p>}
      {affaiblirRefuse && <p className="muted" data-testid="code-avant-d-affaiblir">{CODE_AVANT_D_AFFAIBLIR}</p>}
      {valeur.etat === 'lecture' && <p className="muted">Chargement…</p>}
      {valeur.etat === 'illisible' && (
        <p role="alert">La double authentification des comptes n’a pas pu être lue : {valeur.message} Aucun geste n’est offert.</p>
      )}
      {valeur.etat === 'lue' && valeur.comptes.length === 0 && <p className="muted">Aucun compte.</p>}
      {valeur.etat === 'lue' && valeur.comptes.length > 0 && (
        <ul className="liste-simple">
          {valeur.comptes.map((c) => (
            <li key={c.userId}>
              <span className="courriel">{c.email ?? 'compte sans adresse'}</span>
              {' — '}{etatDuCompteEnMots(c, formatDate)}
              {c.exigeeDepuis === null && exigenceRecommandee(c, cases?.[c.userId] ?? null) && <em> (recommandée)</em>}
              <span className="field-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {gestesDuCompte(c).map((g) => (
                  <button key={g} type="button" className="btn btn-sm" disabled={occupe || refusDuGesteAvantLeClic(g, niveau) !== null}
                    onClick={() => { void agir(g, c) }}>
                    {LIBELLES[g]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
