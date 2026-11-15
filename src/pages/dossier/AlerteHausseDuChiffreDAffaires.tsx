import { useEffect, useId, useRef, useState } from 'react'
import { aujourdHuiAParis } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import {
  HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE, LIBELLE_MARQUER_VUE, MARQUE_NON_ENREGISTREE, SOURCE_DU_CHIFFRE, ceQueDitLaVue,
  confirmationDeLaMarque, type LectureDeLaHausse, type Trimestre,
} from '../../lib/hausseDuChiffreDAffaires'
import { lireLaHausseDuDossier, marquerLaHausseVue, type DossierDeLaHausse } from '../../lib/hausseDuChiffreDAffairesLecture'

// L'ALERTE DE HAUSSE DU CHIFFRE D'AFFAIRES DANS LA VUE D'ENSEMBLE (la demande du cabinet du 15/11/2026 ; la conception :
// docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md, § 4). Un point d'ATTENTION, au-dessus des tuiles comme l'avis d'un
// changement de RIB — et non une ligne de « Travail à effectuer » : ce n'est pas une anomalie du dossier, la tuile « Anomalies »
// ne la compte pas, la validation d'un exercice ne la lit pas, et la révision ne la range dans aucun cycle. Elle dit le constat,
// les deux chiffres comparés et le seuil du dossier, et rien de ce qu'il faudrait en faire. Son seul geste : la marquer vue avec
// le client, pour CE trimestre (une confirmation qui nomme le trimestre, la fonction de la base seule, un verrou relâché après
// la relecture). Sa lecture est la sienne : sa panne ne tait qu'elle, jamais la Vue d'ensemble, qui ne l'attend pas. Rien avant
// le retour de la lecture ; une lecture ratée, un trimestre en attente de son relevé ou sans comparaison : une ligne discrète.
// Le drapeau `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` baissé, rien ne se rend et rien ne se lit.

type Lue = Awaited<ReturnType<typeof lireLaHausseDuDossier>>

export default function AlerteHausseDuChiffreDAffaires({ dossier, className }: { dossier: DossierDeLaHausse; className?: string }) {
  const [lu, setLu] = useState<Lue | null>(null)
  const [erreur, setErreur] = useState<{ dossierId: string; message: string } | null>(null)
  const [enCours, setEnCours] = useState(false)
  // Le verrou d'exécution de la marque : `enCours` ne prend effet qu'au rendu suivant.
  const marqueEnCours = useRef(false)
  const dossierAffiche = useRef(dossier.id)
  const titre = useId()
  const { id, assujetti_tva: assujettiTva, mode_comptable: mode } = dossier

  useEffect(() => {
    if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return
    dossierAffiche.current = id
    let annule = false
    // Le jour de Paris, lu à la lecture : le dernier trimestre clos en dépend.
    lireLaHausseDuDossier({ id, assujetti_tva: assujettiTva, mode_comptable: mode }, aujourdHuiAParis())
      .then((lecture) => { if (!annule) setLu(lecture) })
    return () => { annule = true }
  }, [id, assujettiTva, mode])

  if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE) return null

  const lecture: LectureDeLaHausse = lu?.dossierId === id ? lu.lecture : { etat: 'en_cours' }
  const dit = ceQueDitLaVue(lecture)
  const message = erreur?.dossierId === id ? erreur.message : null

  async function marquer(trimestre: Trimestre) {
    // Posé avant le `try` : dedans, le `return` du deuxième clic sortirait par le `finally` et relâcherait le verrou du premier.
    if (marqueEnCours.current) return
    marqueEnCours.current = true
    const dossierEcrit = id
    try {
      if (!window.confirm(confirmationDeLaMarque(trimestre))) return
      setEnCours(true)
      setErreur(null)
      const ecrit = await marquerLaHausseVue(dossierEcrit, trimestre)
      if (!ecrit.ok) setErreur({ dossierId: dossierEcrit, message: ecrit.erreur })
      // Relue, quoi qu'il arrive : la marque posée tait l'alerte ; refusée, l'alerte reste et le refus se dit.
      const relue = await lireLaHausseDuDossier({ id: dossierEcrit, assujetti_tva: assujettiTva, mode_comptable: mode }, aujourdHuiAParis())
      if (dossierAffiche.current === dossierEcrit) setLu(relue)
    } catch (erreurInattendue) {
      setErreur({ dossierId: dossierEcrit, message: messageErreur(erreurInattendue, MARQUE_NON_ENREGISTREE) })
    } finally {
      marqueEnCours.current = false
      setEnCours(false)
    }
  }

  if (dit.genre === 'rien') return null
  const classes = (suite: string) => `avis-rib${suite}${className ? ` ${className}` : ''}`
  if (dit.genre === 'discret') {
    return (
      <section className={classes(' avis-rib-discret')} aria-label="Alerte de hausse du chiffre d’affaires">
        <span className="check-dot check-neutre" aria-hidden="true" />
        <p className="avis-rib-phrase muted" title={lecture.etat === 'illisible' ? lecture.motif : undefined}>{dit.phrase}</p>
      </section>
    )
  }
  return (
    <section className={classes(' avis-rib-attente')} aria-labelledby={titre}>
      <span className="check-dot check-attention" aria-hidden="true" />
      <div className="avis-rib-corps">
        <p id={titre} className="avis-rib-phrase"><strong>{dit.titre}</strong></p>
        {dit.phrases.map((phrase) => <p key={phrase} className="avis-rib-texte">{phrase}</p>)}
        <p className="avis-rib-texte muted">{SOURCE_DU_CHIFFRE}</p>
        {message && <p className="error-text">{message}</p>}
      </div>
      <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => { void marquer(dit.trimestre) }}>
        {enCours ? 'Enregistrement…' : LIBELLE_MARQUER_VUE}
      </button>
    </section>
  )
}
