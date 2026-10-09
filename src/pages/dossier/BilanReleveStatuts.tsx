import { formatDate } from '../../lib/format'
import type { ResultatReleve } from '../../lib/releveStatuts'
import { bilanDuReleve, CONSEQUENCE_ANNULATION } from '../../lib/statutsLus'

// LE BILAN D'UN RELEVÉ DES STATUTS DES FACTURES ÉMISES (ligne 28.5, étape d7, phase C), le même dans les trois écrans qui
// l'offrent : l'onglet Factures, la fenêtre des encaissements et celle de la plateforme du client. Il reçoit le relevé
// que l'écran a lancé sur un clic (`releverEtNommer`, lib/releveStatuts.ts) ; il ne lit rien. Les statuts gardés d'abord,
// un refus en tête et en rouge avec sa conséquence ; puis ce qui ne l'a pas été, et pourquoi.
export default function BilanReleveStatuts({ resultat }: { resultat: ResultatReleve }) {
  const b = bilanDuReleve(resultat.releve, resultat.numeros, formatDate)
  return (
    <div className="releve-statuts">
      <h3>{b.titre}</h3>
      {b.rienDeNouveau && <p>Pas de nouveau statut sur une facture du dossier.</p>}
      {resultat.numerosIncomplets && (
        <p className="muted">
          Les numéros des factures n’ont pas pu être lus en entier ({resultat.numerosIncomplets}) : les statuts sont gardés,
          l’onglet Factures les montre sur chaque facture.
        </p>
      )}
      {b.gardes.length > 0 && (
        <ul className="plateforme-liste">
          {b.gardes.map((g) => (
            <li key={g.flux} className={g.annulation ? 'releve-annulation' : undefined}>
              <strong>{g.numero ?? 'Une facture du dossier (numéro non lu)'}</strong> :{' '}
              <span className={`badge ${g.classe}`}>{g.libelle}</span>
              {g.annulation && <> — {CONSEQUENCE_ANNULATION}.</>}
              {g.avertissements.length > 0 && (
                <div className="releve-avertissement">Données écartées du message : {g.avertissements.join(' ')}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(b.dejaLus || b.comptes.length > 0) && (
        <ul className="plateforme-liste muted">
          {b.dejaLus && <li>{b.dejaLus}</li>}
          {b.comptes.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      {b.ecartes.length > 0 && (
        <>
          <p className="releve-sous-titre">Non rattachés à une facture du dossier, donc non gardés :</p>
          <ul className="plateforme-liste">
            {b.ecartes.map((e) => (
              <li key={e.flux}>
                {e.texte}
                {e.detail && <div className="releve-avertissement">{e.detail}</div>}
              </li>
            ))}
          </ul>
        </>
      )}
      {b.echecs.length > 0 && (
        <>
          <p className="releve-sous-titre">En échec :</p>
          <ul className="plateforme-liste">
            {b.echecs.map((e) => <li key={e.flux}>{e.texte}</li>)}
          </ul>
        </>
      )}
      {b.incomplet && <p className="alerte-tva">{b.incomplet}</p>}
      {b.reprise && <p className="error-text">{b.reprise}</p>}
    </div>
  )
}
