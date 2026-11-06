import { dateEnLettres, moisEnLettres, type EcheanceDuClient, type NatureEcheance } from '../lib/echeancierClient'
import { formatMoney } from '../lib/format'

// LA LISTE DES ÉCHÉANCES DU CLIENT (ligne 51.5, étape C1), écrite une fois pour « Mon échéancier » et la carte de l'accueil :
// la date, ce qui est dû, sa condition, et le montant quand l'écran en a un (`montant` n'est jamais posé sans « Banque », voir
// lib/echeancierClient.ts). Rien ne s'y écrit, rien ne s'y lit : elle montre ce qu'on lui donne.

const NATURES: Record<NatureEcheance, string> = { impots: 'Impôts', tva: 'TVA', cotisations: 'Cotisations' }

function Ligne({ echeance }: { echeance: EcheanceDuClient }) {
  return (
    <li className="echeance" data-echeance={echeance.id}>
      <span className="echeance-date">{dateEnLettres(echeance)}</span>
      <div className="echeance-corps">
        <div className="echeance-libelle">{echeance.libelle}</div>
        {echeance.precision && <div className="echeance-precision">{echeance.precision}</div>}
        <div className="echeance-pastilles">
          <span className="badge badge-neutral">{NATURES[echeance.nature]}</span>
          {echeance.prevision && <span className="badge badge-warning">Prévisionnelle</span>}
        </div>
      </div>
      {echeance.montant && (
        <span className="echeance-montant">
          {echeance.montant.estimation ? `≈ ${formatMoney(echeance.montant.valeur)}` : formatMoney(echeance.montant.valeur)}
          {echeance.montant.estimation && <small>estimation</small>}
        </span>
      )}
    </li>
  )
}

/** Les échéances, rangées par mois (`parMois`) ou à la suite (la carte de l'accueil). */
export default function ListeEcheances({ echeances, parMois }: { echeances: readonly EcheanceDuClient[]; parMois: boolean }) {
  if (!parMois) {
    return <ul className="echeancier-liste">{echeances.map((e) => <Ligne key={e.id} echeance={e} />)}</ul>
  }
  const mois: { cle: string; echeances: EcheanceDuClient[] }[] = []
  for (const e of echeances) {
    const cle = e.date.slice(0, 7)
    const dernier = mois[mois.length - 1]
    if (dernier?.cle === cle) dernier.echeances.push(e)
    else mois.push({ cle, echeances: [e] })
  }
  return (
    <>
      {mois.map((m, i) => {
        const titre = moisEnLettres(`${m.cle}-01`)
        return (
          <section key={m.cle} aria-label={titre} className={i > 0 ? 'echeancier-mois-suite' : undefined}>
            <h3 className="echeancier-mois">{titre.charAt(0).toUpperCase() + titre.slice(1)}</h3>
            <ul className="echeancier-liste">{m.echeances.map((e) => <Ligne key={e.id} echeance={e} />)}</ul>
          </section>
        )
      })}
    </>
  )
}
