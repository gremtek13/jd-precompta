import { useAuth } from '../context/AuthContext'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'
import ListeEcheances from '../components/ListeEcheances'
import { droitsSur } from '../lib/droitsAcces'
import {
  ECHEANCIER_CONDITIONS, ECHEANCIER_ILLISIBLE, ECHEANCIER_INTRODUCTION, ECHEANCIER_LECTURE_PARTIELLE, ECHEANCIER_SANS_MONTANTS,
  ECHEANCIER_VIDE, composerEcheancier,
} from '../lib/echeancierClient'
import { useEcheancierDuClient } from '../lib/echeancierClientLecture'
import { SANS_IMPOT_SUR_LES_SOCIETES } from '../lib/echeancesFiscales'
import { aujourdHuiAParis } from '../lib/format'

// « MON ÉCHÉANCIER » (ligne 51.5, partie C, étape C1) : ouvert à TOUT accès client. Les dates de ce que le client va devoir
// déclarer ou payer sur les douze mois qui viennent ; les montants de ses cotisations seulement avec la case « Banque » de la
// société affichée, lue comme les routes de `App.tsx` la lisent. Rien ne s'écrit d'ici.
//
// Le vide est une affirmation : « Aucune échéance » ne se dit que d'une lecture complète ; avant elle, « Chargement… » ; lue en
// partie, le bandeau le dit au-dessus de ce qui a été lu ; illisible, l'écran le dit et ne montre rien d'autre. « Aujourd'hui »
// est le jour de Paris, lu au rendu.
export default function ClientEcheancier() {
  const { dossierActifId, droitsParDossier } = useAuth()
  // `?? {}` : une doublure de contexte sans droits n'en accorde aucun (seul `true` accorde, lib/droitsAcces.ts).
  const avecMontants = droitsSur(droitsParDossier ?? {}, dossierActifId).banque === true
  const lecture = useEcheancierDuClient(dossierActifId, avecMontants)

  if (!dossierActifId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte ton cabinet comptable.</p>
  }

  const echeancier = lecture && lecture.etat !== 'illisible'
    ? composerEcheancier({
      aujourdHui: aujourdHuiAParis(), dossier: lecture.dossier, cotisations: lecture.cotisations, avecMontants,
      // Le régime d'imposition ne se lit pas encore en base (LIA4) : aucun dossier n'a d'IS au calendrier (LIA8).
      impot: SANS_IMPOT_SUR_LES_SOCIETES,
    })
    : null

  return (
    <>
      <div className="topbar"><h1>Mon échéancier</h1></div>
      <p className="muted" style={{ marginTop: -12, marginBottom: 20 }}>{ECHEANCIER_INTRODUCTION}</p>

      {lecture?.etat === 'partiel' && (
        <BandeauLecturePartielle quoi="Ton échéancier" accord="lu" motif={lecture.motif} technique={false} consequence={ECHEANCIER_LECTURE_PARTIELLE} />
      )}

      <div className="card">
        {lecture === null ? (
          <p className="muted" aria-busy="true">Chargement…</p>
        ) : lecture.etat === 'illisible' ? (
          <p className="error-text" title={lecture.motif}>{ECHEANCIER_ILLISIBLE}</p>
        ) : echeancier && echeancier.echeances.length > 0 ? (
          <ListeEcheances echeances={echeancier.echeances} parMois />
        ) : lecture.etat === 'lu' ? (
          <p className="muted">{ECHEANCIER_VIDE}</p>
        ) : null}

        {echeancier && (
          <>
            {echeancier.avisTva && <p className="echeancier-note">{echeancier.avisTva}</p>}
            {echeancier.avisImpot && <p className="echeancier-note">{echeancier.avisImpot}</p>}
            <p className="echeancier-note">{ECHEANCIER_CONDITIONS}</p>
            {!avecMontants && <p className="echeancier-note">{ECHEANCIER_SANS_MONTANTS}</p>}
          </>
        )}
      </div>
    </>
  )
}
