import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { aujourdHuiAParis } from '../lib/format'
import {
  HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE, LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE, PLAFOND_DU_TABLEAU_DE_BORD, SEUILS_ILLISIBLES,
  TITRE_DU_TABLEAU_DE_BORD, alerteAVoir, dossiersACalculer, phraseDesIllisibles, phraseDesNonCalcules, phraseDuTableauDeBord,
  phraseDuTitre, type HausseJugee,
} from '../lib/hausseDuChiffreDAffaires'
import { lireLaHausseDuDossier, lireLesSeuilsDesDossiers, type DossierDeLaHausse } from '../lib/hausseDuChiffreDAffairesLecture'
import { TITRE_MON_CABINET } from '../lib/dossierDuCabinet'

// LES DOSSIERS DONT LE CHIFFRE D'AFFAIRES ATTEINT L'UN DE LEURS SEUILS — À LA HAUSSE OU À LA BAISSE —, SUR LE TABLEAU DE BORD DU
// CABINET (la demande du cabinet du 15/11/2026 ; ses réponses du 16/11/2026, dont CA-Q4 (A) : tout le cabinet du dossier ; la
// conception : docs/conceptions/52-alerte-hausse-du-chiffre-d-affaires.md, § 4). Le pendant, pour les dossiers que le compte
// suit, de l'alerte de la Vue d'ensemble — le même jugement (lib/hausseDuChiffreDAffaires.ts), sur la même lecture
// (lib/hausseDuChiffreDAffairesLecture.ts, `lireLaHausseDuDossier`) : les seuils d'abord, d'une lecture ; puis, pour les seuls
// dossiers qui en ont un, l'un après l'autre, au plus `PLAFOND_DU_TABLEAU_DE_BORD`, et ce qui reste se dit. Une ligne par alerte
// que personne n'a marquée vue avec le client, qui MÈNE à la Vue d'ensemble de son dossier, où se pose la marque : rien ne
// s'écrit d'ici, aucune fenêtre ne s'ouvre (le tableau de bord est une grille). Rien avant le retour des lectures ; rien quand
// rien n'attend le cabinet ; une lecture ratée, une ligne discrète — jamais le silence qu'on prendrait pour « aucune alerte ».
// Le drapeau `HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE` baissé, rien ne se rend et rien ne se lit.

export type DossierDuTableauDeBord = DossierDeLaHausse & { nom: string; archive?: boolean }

type Releve =
  | { etat: 'illisible'; motif: string }
  | { etat: 'lu'; alertes: { dossier: DossierDuTableauDeBord; hausse: HausseJugee }[]; illisibles: number; nonCalcules: number }

/** Les alertes des dossiers suivis, pour CETTE clé : `null` sans clé ou drapeau baissé, « en cours » tant qu'elles ne sont pas revenues. */
function useHaussesDesDossiers(dossiers: readonly DossierDuTableauDeBord[], cle: string | null): Releve | { etat: 'en_cours' } | null {
  const [lu, setLu] = useState<{ cle: string; releve: Releve } | null>(null)
  // Les dossiers lus ne changent qu'avec leur liste : la clé de la lecture les porte, pour qu'une liste relue relise.
  const cleComplete = cle === null ? null : `${cle}|${dossiers.map((d) => `${d.id}:${d.assujetti_tva}:${d.mode_comptable}`).join(',')}`

  useEffect(() => {
    if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE || cleComplete === null) return
    let annule = false
    const enLecture = cleComplete
    void (async () => {
      const seuils = await lireLesSeuilsDesDossiers()
      if (seuils.etat === 'illisible') {
        if (!annule) setLu({ cle: enLecture, releve: { etat: 'illisible', motif: seuils.motif } })
        return
      }
      const { aCalculer, nonCalcules } = dossiersACalculer(dossiers, seuils.seuils, PLAFOND_DU_TABLEAU_DE_BORD)
      const aujourdHui = aujourdHuiAParis()
      const alertes: Extract<Releve, { etat: 'lu' }>['alertes'] = []
      let illisibles = 0
      // L'un après l'autre : chaque dossier lit ses collections entières, et le tableau de bord n'en lance pas dix à la fois.
      for (const dossier of aCalculer) {
        if (annule) return
        const { lecture } = await lireLaHausseDuDossier(dossier, aujourdHui)
        if (lecture.etat === 'illisible') illisibles += 1
        else if (alerteAVoir(lecture.hausse)) alertes.push({ dossier, hausse: lecture.hausse })
      }
      if (!annule) setLu({ cle: enLecture, releve: { etat: 'lu', alertes, illisibles, nonCalcules } })
    })()
    return () => { annule = true }
    // `dossiers` est dans la clé complète, qui seule décide de relire : une liste relue à l'identique ne relit rien.
  }, [cleComplete])

  if (!HAUSSE_DU_CHIFFRE_D_AFFAIRES_PREVUE || cleComplete === null) return null
  return lu !== null && lu.cle === cleComplete ? lu.releve : { etat: 'en_cours' }
}

export default function HaussesDuChiffreDAffaires({ dossiers, dossiersDuCabinet, cle, className }: {
  dossiers: readonly DossierDuTableauDeBord[]
  dossiersDuCabinet: ReadonlySet<string>
  // La clé de la lecture : le compte connecté, quand la liste des dossiers est revenue ; nulle, rien ne se lit.
  cle: string | null
  className?: string
}) {
  const releve = useHaussesDesDossiers(dossiers, cle)
  const racine = useId()
  if (releve === null || releve.etat === 'en_cours') return null
  const classes = (suite: string) => `avis-rib ribs-a-confirmer${suite}${className ? ` ${className}` : ''}`
  if (releve.etat === 'illisible') {
    return (
      <section className={classes(' avis-rib-discret')} aria-label={TITRE_DU_TABLEAU_DE_BORD}>
        <p className="avis-rib-phrase muted" title={releve.motif}>{SEUILS_ILLISIBLES}</p>
      </section>
    )
  }
  const { alertes, illisibles, nonCalcules } = releve
  if (alertes.length === 0 && illisibles === 0 && nonCalcules === 0) return null
  const titre = `${racine}-titre`
  return (
    <section className={classes(alertes.length > 0 ? ' avis-rib-attente' : ' avis-rib-discret')} aria-labelledby={titre}>
      {alertes.length > 0 && <span className="check-dot check-attention" aria-hidden="true" />}
      <div className="avis-rib-corps">
        <p id={titre} className="avis-rib-phrase">{alertes.length > 0 ? phraseDuTitre(alertes.length) : TITRE_DU_TABLEAU_DE_BORD}</p>
        {alertes.length > 0 && (
          <ul className="ribs-a-confirmer-lignes">
            {alertes.map(({ dossier, hausse }) => (
              <li key={dossier.id} className="ribs-a-confirmer-ligne">
                <span className="ribs-a-confirmer-qui">
                  <span id={`${racine}-${dossier.id}`} className="ribs-a-confirmer-nom">{dossier.nom}</span>
                  {dossiersDuCabinet.has(dossier.id) && <span className="badge badge-neutral">{TITRE_MON_CABINET}</span>}
                </span>
                <span className="ribs-a-confirmer-avis">{phraseDuTableauDeBord(hausse)}</span>
                <Link to={`/dossiers/${dossier.id}/checklist`} className="btn btn-outline btn-sm" aria-describedby={`${racine}-${dossier.id}`}>
                  {LIBELLE_OUVRIR_LA_VUE_D_ENSEMBLE}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {illisibles > 0 && <p className="avis-rib-texte muted">{phraseDesIllisibles(illisibles)}</p>}
        {nonCalcules > 0 && <p className="avis-rib-texte muted">{phraseDesNonCalcules(nonCalcules)}</p>}
      </div>
    </section>
  )
}
