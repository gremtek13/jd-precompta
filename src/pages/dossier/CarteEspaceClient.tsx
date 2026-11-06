import Widget from '../../components/widgets/Widget'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import {
  JOURS_DE_LA_FENETRE, LIMITE_DU_JOURNAL, debutDeLaFenetre, journalDeLEspaceClient, phraseDuCompte,
} from '../../lib/journalDeLEspaceClient'
import { useJournalDeLEspaceClient } from '../../lib/journalDeLEspaceClientLecture'

// LA CARTE P10 DE LA VUE D'ENSEMBLE, CÔTÉ CABINET : « Espace client : ce qui a bougé depuis le … » (étape B9b ; la règle
// dans lib/journalDeLEspaceClient.ts, la lecture dans lib/journalDeLEspaceClientLecture.ts). Ce que le CLIENT a fait depuis
// son espace sur les trente derniers jours, du plus récent au plus ancien, plafonné et dit.
//
// Sa lecture est la sienne : une lecture ratée ne tait que cette carte, jamais la Vue d'ensemble. Rien ne se dit avant le
// retour des lectures (un squelette) ; sur une lecture partielle, la carte le dit et ne liste rien. AUCUNE fenêtre ne s'ouvre
// d'ici (la grille `.bento` est un conteneur), aucun e-mail, aucune notification : une carte qui se lit, sans geste.
export default function CarteEspaceClient({ dossierId }: { dossierId: string }) {
  // Le jour à Paris, lu au rendu : la fenêtre se juge à ce jour.
  const aujourdhui = aujourdHuiAParis()
  const lecture = useJournalDeLEspaceClient(dossierId, aujourdhui)
  const journal = journalDeLEspaceClient({ acces: lecture.acces, sources: lecture.sources, aujourdhui })
  const depuis = debutDeLaFenetre(aujourdhui)

  return (
    <Widget
      className="span-12"
      titre={`Espace client : ce qui a bougé depuis le ${formatDate(depuis)}`}
      sousTitre={`Les gestes du client depuis son espace, les ${JOURS_DE_LA_FENETRE} derniers jours`}
    >
      {journal.etat === 'en_cours' && (
        <div aria-busy="true" aria-label="Chargement du journal de l’espace client">
          <div className="skeleton skeleton-ligne" />
          <div className="skeleton skeleton-ligne" />
          <div className="skeleton skeleton-ligne" />
        </div>
      )}
      {journal.etat === 'muet' && (
        <div className="check-ligne" role="status">
          <span className="check-dot check-attention" aria-label="Journal non lu en entier" />
          <div className="check-ligne-corps">
            <div className="check-ligne-libelle">Le journal ne peut pas être dit : une lecture est incomplète.</div>
            <div className="check-ligne-detail">{journal.motif}</div>
          </div>
        </div>
      )}
      {journal.etat === 'lu' && (
        <div>
          <p className="check-ligne-detail">{phraseDuCompte(journal)}</p>
          {journal.evenements.length > 0 && (
            <div role="list" aria-label="Gestes du client">
              {journal.evenements.map((e) => (
                <div key={`${e.genre}-${e.id}`} role="listitem" className="check-ligne">
                  <span className="check-dot check-neutre" aria-hidden="true" />
                  <div className="check-ligne-corps">
                    <div className="check-ligne-libelle">{e.libelle}</div>
                    <div className="check-ligne-detail">le {formatDate(e.le)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="check-ligne-detail">{LIMITE_DU_JOURNAL}</p>
        </div>
      )}
    </Widget>
  )
}
