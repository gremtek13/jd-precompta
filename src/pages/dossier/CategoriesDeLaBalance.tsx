import { useEffect, useRef, useState } from 'react'
import type { LigneBalance } from '../../lib/balanceImport'
import { categoriesDepuisLaBalance, texteDUnEcart } from '../../lib/categoriesDepuisLaBalance'
import { codeDUneCategorieDuDossier, jugerLaCategorie } from '../../lib/categoriesDuDossier'
import { creerLesCategories, lireLesCategoriesDuDossier, type LectureDesCategories } from '../../lib/categoriesDuDossierLecture'
import { formatMoney } from '../../lib/format'
import type { PlanComptable } from '../../lib/planComptable'
import { ChoixDuPoste } from './CategoriesDuDossierCard'

// LE TROISIÈME TEMPS DE LA CARTE DE LA BALANCE (ligne 43, étape PC7) : les catégories que la balance PROPOSE, depuis ses
// comptes de charges et de produits (lib/categoriesDepuisLaBalance.ts). Rien n'est coché d'avance, aucun poste n'est
// deviné : le cabinet coche, choisit le poste, et la confirmation nomme chaque catégorie qui part ; une instruction les
// crée toutes ou aucune, puis les catégories sont relues. Lues en partie, aucune proposition ni aucun geste.

interface Choix { cochee: boolean; libelle: string; poste: string }

export default function CategoriesDeLaBalance({ dossierId, lignes, plan }: { dossierId: string; lignes: readonly LigneBalance[]; plan: PlanComptable }) {
  const [lecture, setLecture] = useState<LectureDesCategories | null>(null)
  const [version, setVersion] = useState(0)
  const [choix, setChoix] = useState<Record<string, Choix>>({})
  const [confirmation, setConfirmation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const creationEnCours = useRef(false)

  useEffect(() => {
    let annule = false
    void lireLesCategoriesDuDossier(dossierId).then((r) => { if (!annule) setLecture(r) })
    return () => { annule = true }
  }, [dossierId, version])

  const lues = lecture && lecture.dossierId === dossierId ? lecture : null
  const titre = <h4 style={{ margin: '0 0 6px' }}>3. Les catégories que la balance propose</h4>
  if (!lues) return <div style={{ marginTop: 18 }}>{titre}<p className="muted">Chargement…</p></div>
  if (lues.etat === 'incompletes') {
    return <div style={{ marginTop: 18 }}>{titre}<p className="error-text">Les catégories n’ont pas été lues en entier ({lues.motif}) : rien n’est proposé.</p></div>
  }
  const { proposees, ecartes } = categoriesDepuisLaBalance(lignes, plan, lues.categories)
  const choixDe = (compte: string, libelle: string | null): Choix => choix[compte] ?? { cochee: false, libelle: libelle ?? '', poste: '' }
  const cochees = proposees.filter((p) => choixDe(p.compte, p.libelle).cochee)
  const jugees = cochees.map((p) => {
    const c = choixDe(p.compte, p.libelle)
    const autres = cochees.filter((q) => q !== p).map((q) => choixDe(q.compte, q.libelle).libelle.trim().toLocaleLowerCase('fr'))
    const j = jugerLaCategorie({ libelle: c.libelle, compte: p.compte, poste: c.poste }, { plan, categories: lues.categories, modifiee: null })
    return 'refus' in j ? { p, refus: j.refus }
      : autres.includes(j.libelle.toLocaleLowerCase('fr')) ? { p, refus: `« ${j.libelle} » est coché deux fois : deux catégories ne portent pas le même nom.` }
        : { p, ligne: j }
  })
  const refus = jugees.find((j) => 'refus' in j)
  const categoriesLues = lues.categories

  async function creer() {
    if (creationEnCours.current || cochees.length === 0 || refus) return
    creationEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const codes = new Set<string>(categoriesLues.map((c) => c.code))
      const aCreer = jugees.flatMap((j) => ('ligne' in j && j.ligne ? [j.ligne] : [])).map((l) => {
        const code = codeDUneCategorieDuDossier(l.compte, codes)
        codes.add(code)
        return { code, libelle: l.libelle, compte_comptable: l.compte, poste_2035: l.poste }
      })
      const issue = await creerLesCategories(dossierId, aCreer)
      if (issue.ok) { setChoix({}); setConfirmation(false) } else setErreur(issue.refus)
    } finally {
      setVersion((v) => v + 1)
      creationEnCours.current = false
      setEnCours(false)
    }
  }

  const changer = (compte: string, libelle: string | null, champ: Partial<Choix>) =>
    setChoix((avant) => ({ ...avant, [compte]: { ...(avant[compte] ?? { cochee: false, libelle: libelle ?? '', poste: '' }), ...champ } }))

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
      {titre}
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Les comptes de charges et de produits de la balance disent vos habitudes de ventilation. Cochez ceux qui deviennent des
        catégories de ce dossier et choisissez leur poste de la 2035 : rien n’est deviné, rien ne part sans votre clic.
      </p>
      {erreur && <p className="error-text">{erreur}</p>}
      {proposees.length === 0 ? <p className="muted">La balance ne propose aucune catégorie de plus.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th /><th>Compte</th><th>Libellé (lu par le client)</th><th>Poste de la 2035</th><th>Solde</th></tr></thead>
            <tbody>
              {proposees.map((p) => {
                const c = choixDe(p.compte, p.libelle)
                return (
                  <tr key={p.compte}>
                    <td><input type="checkbox" aria-label={`Créer la catégorie ${p.compte}`} checked={c.cochee} disabled={enCours}
                      onChange={(e) => { setConfirmation(false); changer(p.compte, p.libelle, { cochee: e.target.checked }) }} /></td>
                    <td>{p.compte}{p.numeros.some((n) => n !== p.compte) ? ` (${p.numeros.join(', ')})` : ''}</td>
                    <td><input aria-label={`Libellé de ${p.compte}`} value={c.libelle} disabled={enCours}
                      onChange={(e) => { setConfirmation(false); changer(p.compte, p.libelle, { libelle: e.target.value }) }} /></td>
                    <td><ChoixDuPoste id={`balance-poste-${p.compte}`} compte={p.compte} poste={c.poste} disabled={enCours}
                      onChange={(poste) => { setConfirmation(false); changer(p.compte, p.libelle, { poste }) }} /></td>
                    <td>{formatMoney(p.solde / 100)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {refus && 'refus' in refus && <p className="error-text">{refus.p.compte} : {refus.refus}</p>}
      {cochees.length > 0 && !refus && !confirmation && (
        <button type="button" className="btn btn-primary" disabled={enCours} onClick={() => setConfirmation(true)}>
          Créer {cochees.length > 1 ? `les ${cochees.length} catégories cochées` : 'la catégorie cochée'}…
        </button>
      )}
      {confirmation && !refus && (
        <div>
          <p>Créer dans ce dossier :</p>
          <ul>{jugees.map((j) => ('ligne' in j && j.ligne ? <li key={j.p.compte}>« {j.ligne.libelle} », compte {j.ligne.compte}, poste « {j.ligne.poste} »</li> : null))}</ul>
          <button type="button" className="btn btn-primary" disabled={enCours} onClick={() => void creer()}>{enCours ? 'Création…' : 'Confirmer'}</button>{' '}
          <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => setConfirmation(false)}>Annuler</button>
        </div>
      )}
      {ecartes.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary>{ecartes.length} compte{ecartes.length > 1 ? 's' : ''} de charges ou de produits écarté{ecartes.length > 1 ? 's' : ''}</summary>
          <ul>{ecartes.map((e, i) => <li key={`${e.numero}-${i}`}>{texteDUnEcart(e)}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
