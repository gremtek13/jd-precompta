import { Link } from 'react-router-dom'
import ListeEcheances from '../components/ListeEcheances'
import Widget from '../components/widgets/Widget'
import { useAuth } from '../context/AuthContext'
import { droitsSur } from '../lib/droitsAcces'
import { ECHEANCIER_ILLISIBLE, ECHEANCIER_SANS_MONTANTS, ECHEANCIER_VIDE, composerEcheancier } from '../lib/echeancierClient'
import { useEcheancierDuClient } from '../lib/echeancierClientLecture'
import { SANS_IMPOT_SUR_LES_SOCIETES } from '../lib/echeancesFiscales'
import { aujourdHuiAParis } from '../lib/format'

// LA CARTE « MES PROCHAINES ÉCHÉANCES » DE L'ACCUEIL DU CLIENT (ligne 51.5, étape C1) : les premières échéances de « Mon
// échéancier », d'après la MÊME lecture (lib/echeancierClientLecture.ts), lue À PART des autres lectures de l'accueil — sa panne
// ne tait que sa carte. Montée par l'accueil avec une clé par société. Les montants, sous la case « Banque » de la société
// qu'elle montre seulement, lue comme la page la lit.
const NB_ECHEANCES_DE_LA_CARTE = 4

export default function EcheancierAccueil({ dossierId }: { dossierId: string }) {
  const { droitsParDossier } = useAuth()
  // `?? {}` : une doublure de contexte sans droits n'en accorde aucun (seul `true` accorde, lib/droitsAcces.ts).
  const avecMontants = droitsSur(droitsParDossier ?? {}, dossierId).banque === true
  const lecture = useEcheancierDuClient(dossierId, avecMontants)
  const echeancier = lecture && lecture.etat !== 'illisible'
    ? composerEcheancier({
      aujourdHui: aujourdHuiAParis(), dossier: lecture.dossier, cotisations: lecture.cotisations, avecMontants,
      // Le régime d'imposition ne se lit pas encore en base (LIA4) : aucun dossier n'a d'IS au calendrier (LIA8).
      impot: SANS_IMPOT_SUR_LES_SOCIETES,
    })
    : null

  return (
    <Widget
      className="span-12"
      titre="Mes prochaines échéances"
      sousTitre="Ce que tu vas devoir déclarer ou payer, et quand"
      action={<Link to="/mon-echeancier" className="btn btn-outline btn-sm">Tout voir</Link>}
    >
      {lecture === null ? (
        <p className="muted" aria-busy="true">Chargement…</p>
      ) : lecture.etat === 'illisible' ? (
        <p className="error-text" title={lecture.motif}>{ECHEANCIER_ILLISIBLE}</p>
      ) : (
        <>
          {lecture.etat === 'partiel' && (
            <p className="error-text" title={lecture.motif}>
              Ton échéancier n’a pas pu être lu en entier : il peut manquer des échéances, recharge la page.
            </p>
          )}
          {echeancier && echeancier.echeances.length > 0 ? (
            <ListeEcheances echeances={echeancier.echeances.slice(0, NB_ECHEANCES_DE_LA_CARTE)} parMois={false} />
          ) : lecture.etat === 'lu' ? (
            <p className="widget-vide">{ECHEANCIER_VIDE}</p>
          ) : null}
          {!avecMontants && <p className="echeancier-note">{ECHEANCIER_SANS_MONTANTS}</p>}
        </>
      )}
    </Widget>
  )
}
