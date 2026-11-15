import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../context/AuthContext'
import { formatDate } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  EXPLICATION_DE_LA_CARTE, HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE, REGLAGE_ILLISIBLE, SEUIL_NON_ENREGISTRE, SEUIL_VIDE, SOURCE_DU_CHIFFRE,
  TITRE_DE_LA_CARTE, marquesDansLOrdre, phraseDeLaMarque, refusDuSeuil, seuilDeLaSaisie,
} from '../../lib/hausseDuChiffreDAffaires'
import { lireLeReglageDeLaHausse, reglerLeSeuilDeLaHausse, type LectureDuReglage } from '../../lib/hausseDuChiffreDAffairesLecture'
import { parQui } from '../../lib/revueAnalytiqueEcran'

// LA CARTE « ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES » DE L'ONGLET INFORMATIONS (la demande du cabinet du 15/11/2026 ; la
// conception : docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md). Elle dit ce que l'alerte compare, règle le seuil du
// dossier — le cabinet le décide dossier par dossier — et montre les trimestres déjà marqués vus avec le client. Ce qu'elle dit
// vient du module (lib/hausseDuChiffreDAffaires.ts) ; ce qu'elle lit et écrit, de sa lecture (lib/hausseDuChiffreDAffairesLecture.ts),
// qui ne rejette jamais. Rien ne s'offre avant le retour de la lecture, ni sur une lecture ratée ; le refus de la saisie se dit
// avant le clic ; l'écriture passe la fonction de la base seule, contre la valeur LUE qu'elle remplace, sous un verrou relâché
// après la relecture. Le drapeau `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` baissé, la carte ne rend rien et ne lit rien.

export default function HausseDuChiffreDAffairesCard({ dossierId }: { dossierId: string }) {
  const { session } = useAuth()
  const moi = session?.user.id ?? null
  const [lu, setLu] = useState<LectureDuReglage | null>(null)
  // Ce que le cabinet tape, avec le dossier où il le tape : sur un autre dossier, la saisie repart de la valeur lue.
  const [saisie, setSaisie] = useState<{ dossierId: string; texte: string } | null>(null)
  const [avis, setAvis] = useState<{ dossierId: string; erreur: string | null; fait: string | null } | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Le verrou d'exécution de l'enregistrement : `enCours` ne prend effet qu'au rendu suivant.
  const enregistrementEnCours = useRef(false)
  // Le dossier affiché : une relecture qui revient pour un autre ne remplace pas la sienne.
  const dossierAffiche = useRef(dossierId)
  const champ = useId()

  useEffect(() => {
    if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return
    dossierAffiche.current = dossierId
    let annule = false
    lireLeReglageDeLaHausse(dossierId).then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [dossierId])

  if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return null

  const lecture = lu?.dossierId === dossierId ? lu : null
  const seuilLu = lecture?.etat === 'lu' ? lecture.seuil?.seuil_de_hausse ?? null : null
  const texte = saisie?.dossierId === dossierId ? saisie.texte : seuilLu === null ? '' : String(seuilLu)
  const seuil = seuilDeLaSaisie(texte)
  const refus = refusDuSeuil(seuil)
  const inchange = refus === null && seuil === seuilLu
  const erreur = avis?.dossierId === dossierId ? avis.erreur : null
  const fait = avis?.dossierId === dossierId ? avis.fait : null

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (enregistrementEnCours.current) return
    enregistrementEnCours.current = true
    const dossierEcrit = dossierId
    try {
      if (lecture?.etat !== 'lu' || refus !== null || inchange) return
      setEnCours(true)
      setAvis(null)
      const ecrit = await reglerLeSeuilDeLaHausse(dossierEcrit, seuilLu, seuil)
      setAvis(ecrit.ok
        ? { dossierId: dossierEcrit, erreur: null, fait: ecrit.seuil === null ? 'Seuil retiré : l’alerte ne se calcule plus ✓' : `Seuil enregistré : ${ecrit.seuil} % ✓` }
        : { dossierId: dossierEcrit, erreur: ecrit.erreur, fait: null })
      // Relue, quoi qu'il arrive : la valeur, son auteur et son instant, tels que la base les tient maintenant.
      const relue = await lireLeReglageDeLaHausse(dossierEcrit)
      if (dossierAffiche.current === dossierEcrit) {
        setLu(relue)
        setSaisie(null)
      }
    } catch (erreurInattendue) {
      setAvis({ dossierId: dossierEcrit, erreur: messageErreur(erreurInattendue, SEUIL_NON_ENREGISTRE), fait: null })
    } finally {
      enregistrementEnCours.current = false
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
          <p>
            {lecture.seuil?.seuil_de_hausse != null
              ? `Seuil du dossier : ${lecture.seuil.seuil_de_hausse} %, réglé le ${formatDate(lecture.seuil.regle_le)}, ${parQui(lecture.seuil.regle_par, moi)}.`
              : SEUIL_VIDE}
          </p>
          <form onSubmit={enregistrer} className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div className="field">
              <label htmlFor={champ}>Seuil de hausse (en %)</label>
              <input
                id={champ} type="text" inputMode="numeric" value={texte} placeholder="aucun"
                onChange={(ev) => setSaisie({ dossierId, texte: ev.target.value })}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={enCours || refus !== null || inchange}>
              {enCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </form>
          {refus && <p className="error-text">{refus}</p>}
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
