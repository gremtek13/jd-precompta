import { LETTRES_DE_MISSION_PREVUES } from '../../lib/lettresDeMission'
import { useMissionsDuClient } from '../../lib/lettresDeMissionLecture'
import { LIBELLE_MISSION, missionsEnVigueur } from '../../lib/lettresDeMissionVue'
import { aujourdHuiAParis, formatDate } from '../../lib/format'

// LES MISSIONS EN VIGUEUR D'UN CLIENT, DANS SON DOSSIER (ligne 47, LM5), derrière `LETTRES_DE_MISSION_PREVUES` : baissé, rien
// ne se lit ni ne s'affiche. Ce que la lettre confie au cabinet — les missions, la date d'effet, la fin de la première
// période —, JAMAIS un montant : la lecture ne demande pas les honoraires (`COLONNES_SANS_MONTANT`). La policy des lettres
// est celle du dossier du CABINET : un membre qui n'y est pas assigné n'y lit rien, et la RLS lui rendrait zéro ligne sans
// erreur — la carte le dit alors, sans jamais affirmer « aucune lettre » (la fonction qui ouvrirait la lecture aux membres
// assignés au seul dossier du client est proposée au cabinet, LM5-Q2). Rien ne s'affiche dans le dossier du cabinet.

export default function MissionsEnVigueurCard({ dossierId, estLeDossierDuCabinet }: { dossierId: string; estLeDossierDuCabinet: boolean }) {
  if (!LETTRES_DE_MISSION_PREVUES || estLeDossierDuCabinet) return null
  return <Carte dossierId={dossierId} />
}

function Carte({ dossierId }: { dossierId: string }) {
  const lecture = useMissionsDuClient(dossierId)
  const titre = <h3>Missions confiées au cabinet</h3>
  if (lecture === null) return <section className="card">{titre}<p className="muted">Chargement…</p></section>
  if (lecture.etat === 'illisible') {
    return <section className="card">{titre}<p className="error-text" role="alert">Les lettres de mission de ce client n’ont pas pu être lues en entier ({lecture.motif}).</p></section>
  }
  if (lecture.etat === 'sansDossierDuCabinet') {
    return <section className="card">{titre}<p className="muted">Le cabinet n’a pas désigné son dossier : aucune lettre de mission ne se rédige encore.</p></section>
  }
  if (lecture.etat === 'fermee') {
    return <section className="card">{titre}<p className="muted">Les lettres de mission se lisent dans le dossier du cabinet, qui ne t’est pas ouvert : ce que cette lettre confie au cabinet ne se dit pas ici.</p></section>
  }
  const enVigueur = missionsEnVigueur(lecture.lettres, dossierId, aujourdHuiAParis())
  return (
    <section className="card">
      {titre}
      {enVigueur.length === 0 ? <p className="muted">Aucune lettre de mission en vigueur aujourd’hui.</p> : (
        <ul className="liste-simple">
          {enVigueur.map((m) => (
            <li key={m.lettreId}>
              {m.missions.map((x) => LIBELLE_MISSION[x]).join(', ')}
              <span className="muted"> — depuis le {formatDate(m.dateEffet)}
                {m.finInitiale ? `, première période jusqu’au ${formatDate(m.finInitiale)}${m.reconduction ? ', reconduite tacitement' : ''}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
