import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { messageErreur } from '../../lib/messageErreur'
import {
  auteurDeChaqueSeuilPrevu, EXPLICATION_DE_LA_CARTE, HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE, LIBELLES_DES_SEUILS, REGLAGE_ILLISIBLE, SENS_DES_SEUILS,
  SEUIL_NON_ENREGISTRE, SOURCE_DU_CHIFFRE, TITRE_DE_LA_CARTE, marquesDansLOrdre, phraseDeLaMarque, phraseDesSeuilsDuDossier,
  phraseDuReglage, phrasesDesSeuilsEtDeLeurReglage, refusDuSeuil, seuilDeLaSaisie, seuilDuSens, type SensDuSeuil,
} from '../../lib/hausseDuChiffreDAffaires'
import { lireLeReglageDeLaHausse, reglerLeSeuil, type LectureDuReglage } from '../../lib/hausseDuChiffreDAffairesLecture'

// LA CARTE « ALERTE DE HAUSSE OU DE BAISSE DU CHIFFRE D'AFFAIRES » DE L'ONGLET INFORMATIONS (la demande du cabinet du
// 15/11/2026 ; ses réponses du 16/11/2026 ; la conception : docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md). Elle
// dit ce que l'alerte compare, règle les DEUX seuils du dossier — le cabinet les décide dossier par dossier, chacun à part
// (CA-Q2 (C)) : un formulaire par seuil, qui n'écrit que le sien — et montre les trimestres déjà marqués vus avec le client. Ce
// qu'elle dit vient du module (lib/hausseDuChiffreDAffaires.ts) ; ce qu'elle lit et écrit, de sa lecture
// (lib/hausseDuChiffreDAffairesLecture.ts), qui ne rejette jamais. Rien ne s'offre avant le retour de la lecture, ni sur une
// lecture ratée ; le refus d'une saisie se dit avant le clic ; l'écriture passe la fonction de la base seule, contre la valeur
// LUE qu'elle remplace, sous un verrou relâché après la relecture — un seul réglage à la fois pour la carte. Le drapeau
// `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` baissé, la carte ne rend rien et ne lit rien. Sous `AUTEUR_DE_CHAQUE_SEUIL_PREVU` (CA2-Q1),
// chaque seuil dit qui l'a réglé et quand — « toi », l'adresse que la session lit dans l'équipe, sinon « le cabinet ».

/** Ce que le cabinet tape, seuil par seuil ; un seuil absent repart de la valeur lue. */
type Saisies = Partial<Record<SensDuSeuil, string>>

export default function HausseDuChiffreDAffairesCard({ dossierId }: { dossierId: string }) {
  const { session } = useAuth()
  const moi = session?.user.id ?? null
  const [lu, setLu] = useState<LectureDuReglage | null>(null)
  // Les saisies, avec le dossier où elles se tapent : sur un autre dossier, elles repartent des valeurs lues.
  const [saisies, setSaisies] = useState<{ dossierId: string; saisies: Saisies } | null>(null)
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Le verrou d'exécution des réglages : `enCours` ne prend effet qu'au rendu suivant.
  const reglageEnCours = useRef(false)
  // Le dossier affiché : une relecture qui revient pour un autre ne remplace pas la sienne.
  const dossierAffiche = useRef(dossierId)
  const racine = useId()

  useEffect(() => {
    if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return
    dossierAffiche.current = dossierId
    let annule = false
    lireLeReglageDeLaHausse(dossierId).then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [dossierId])

  if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return null

  const lecture = lu?.dossierId === dossierId ? lu : null
  const ligneLue = lecture?.etat === 'lu' ? lecture.seuil : null
  const saisiesDuDossier: Saisies = saisies?.dossierId === dossierId ? saisies.saisies : {}
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  /** Le formulaire d'un seuil, tel que la saisie le dit maintenant. */
  function etatDuSeuil(sens: SensDuSeuil) {
    const valeurLue = seuilDuSens(ligneLue, sens)
    const texte = saisiesDuDossier[sens] ?? (valeurLue === null ? '' : String(valeurLue))
    const seuil = seuilDeLaSaisie(texte)
    const refus = refusDuSeuil(sens, seuil)
    return { valeurLue, texte, seuil, refus, inchange: refus === null && seuil === valeurLue }
  }

  async function enregistrer(e: FormEvent, sens: SensDuSeuil) {
    e.preventDefault()
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (reglageEnCours.current) return
    reglageEnCours.current = true
    const dossierEcrit = dossierId
    try {
      const { valeurLue, seuil, refus, inchange } = etatDuSeuil(sens)
      if (lecture?.etat !== 'lu' || refus !== null || inchange) return
      setEnCours(true)
      setAvis(null)
      const ecrit = await reglerLeSeuil(dossierEcrit, sens, valeurLue, seuil)
      setAvis(ecrit.ok
        ? { dossierId: dossierEcrit, erreur: null, fait: phraseDuReglage(sens, ecrit.seuil) }
        : { dossierId: dossierEcrit, erreur: ecrit.erreur, fait: null })
      // Relue, quoi qu'il arrive : les deux seuils, le dernier réglage, tels que la base les tient maintenant. La saisie de CE
      // seuil repart de la valeur relue ; celle de l'autre, pas encore enregistrée, reste.
      const relue = await lireLeReglageDeLaHausse(dossierEcrit)
      if (dossierAffiche.current === dossierEcrit) {
        setLu(relue)
        setSaisies((avant) => {
          if (avant?.dossierId !== dossierEcrit) return null
          const reste = { ...avant.saisies }
          delete reste[sens]
          return { dossierId: dossierEcrit, saisies: reste }
        })
      }
    } catch (erreurInattendue) {
      setAvis({ dossierId: dossierEcrit, erreur: messageErreur(erreurInattendue, SEUIL_NON_ENREGISTRE), fait: null })
    } finally {
      reglageEnCours.current = false
      setEnCours(false)
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>{TITRE_DE_LA_CARTE}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{EXPLICATION_DE_LA_CARTE}</p>
      <p className="muted">{SOURCE_DU_CHIFFRE}</p>
      {!lecture ? <p className="muted">Chargement…</p> : lecture.etat === 'illisible' ? (
        <p className="error-text" title={lecture.motif}>{REGLAGE_ILLISIBLE}</p>
      ) : (
        <>
          {/* L'auteur de chaque seuil (CA2-Q1), la migration en base ; sinon le dernier réglage de la ligne, comme hier. */}
          {auteurDeChaqueSeuilPrevu()
            ? phrasesDesSeuilsEtDeLeurReglage(lecture.seuil, moi, lecture.equipe ?? new Map()).map((p) => <p key={p}>{p}</p>)
            : <p>{phraseDesSeuilsDuDossier(lecture.seuil, moi)}</p>}
          {SENS_DES_SEUILS.map((sens) => {
            const etat = etatDuSeuil(sens)
            const champ = `${racine}-${sens}`
            return (
              <div key={sens}>
                <form
                  onSubmit={(ev) => { void enregistrer(ev, sens) }} aria-label={LIBELLES_DES_SEUILS[sens]}
                  className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 10 }}
                >
                  <div className="field">
                    <label htmlFor={champ}>{LIBELLES_DES_SEUILS[sens]}</label>
                    <input
                      id={champ} type="text" inputMode="numeric" value={etat.texte} placeholder="aucun"
                      onChange={(ev) => {
                        const texte = ev.target.value
                        setSaisies((avant) => ({
                          dossierId, saisies: { ...(avant?.dossierId === dossierId ? avant.saisies : {}), [sens]: texte },
                        }))
                      }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={enCours || etat.refus !== null || etat.inchange}>
                    {enCours ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </form>
                {etat.refus && <p className="error-text">{etat.refus}</p>}
              </div>
            )
          })}
          {erreur && <p className="error-text">{erreur}</p>}
          {fait && <p className="muted">{fait}</p>}
          {lecture.vues.length > 0 && (
            <>
              <p className="muted" style={{ marginBottom: 4 }}>Trimestres vus avec le client :</p>
              <ul className="muted" style={{ marginTop: 0, paddingLeft: 20 }}>
                {marquesDansLOrdre(lecture.vues).map((v) => <li key={`${v.annee}-${v.trimestre}`}>{phraseDeLaMarque(v, moi)}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
