// LA CARTE « TON DOSSIER CHEZ TON CABINET » DE L'ACCUEIL DU CLIENT (ligne 51.5, étape C2 ; MEG3-Q6). Par exercice, sa
// phase dite aux mots du client — jamais un montant, un compte, un nombre, un libellé ni un nom. Drapeau baissé : ni
// lecture, ni carte. Avant la lecture : un squelette, jamais une liste vide. Lue en partie : la carte le dit, sans
// exercice. Rien ne s'écrit d'ici.
import Widget from './widgets/Widget'
import { ETAT_DU_DOSSIER_EXPORTE, phraseDeLExercice, SI_LA_LECTURE_MANQUE, statutDeLExercice, TITRE_DE_LA_CARTE } from '../lib/etatDuDossier'
import { useEtatDuDossier } from '../lib/etatDuDossierLecture'

export default function CarteEtatDuDossier({ dossierId }: { dossierId: string | null }) {
  const lecture = useEtatDuDossier(dossierId)
  if (!ETAT_DU_DOSSIER_EXPORTE || !dossierId) return null
  if (lecture === null) {
    return <div className="skeleton skeleton-widget span-5" aria-busy="true" aria-label="Chargement de l’état de ton dossier" />
  }
  return (
    <Widget className="span-5" titre={TITRE_DE_LA_CARTE} sousTitre={lecture.complete ? 'Où en est chaque exercice.' : undefined}>
      {lecture.complete ? (
        <ul className="liste-etat-dossier" aria-label="Où en est chaque exercice">
          {lecture.exercices.map((e) => (
            <li key={e.annee} className="check-ligne" data-statut={statutDeLExercice(e)}>
              <div>
                <div className="check-ligne-libelle">Exercice {e.annee}</div>
                <div className="check-ligne-detail">{phraseDeLExercice(e)}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="check-ligne-detail" role="status">{SI_LA_LECTURE_MANQUE}</p>
      )}
    </Widget>
  )
}
