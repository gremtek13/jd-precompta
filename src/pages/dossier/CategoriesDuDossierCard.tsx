import { useEffect, useRef, useState } from 'react'
import {
  CATEGORIES_DU_DOSSIER_PREVUES, COMPTE_ET_POSTE_FIGES, codeDUneCategorieDuDossier, compteDeCategorie, estEmployee,
  jugerLaCategorie, memeCompteQue, phraseDesEmplois, postesDeLaClasse,
} from '../../lib/categoriesDuDossier'
import {
  creerLesCategories, lireLesCategoriesDuDossier, lireLesEmplois, modifierLaCategorie, supprimerLaCategorie,
  type LectureDesCategories, type LectureDesEmplois,
} from '../../lib/categoriesDuDossierLecture'
import type { PlanComptable } from '../../lib/planComptable'
import type { Categorie } from '../../lib/types'

// LES CATÉGORIES DU DOSSIER (ligne 43, étape PC7), derrière `CATEGORIES_DU_DOSSIER_PREVUES` — baissé, rien ne s'affiche.
// Le cabinet crée, modifie et supprime les catégories PROPRES au dossier ; les communes se montrent et disent qui les
// règle. Les règles et les mots : lib/categoriesDuDossier.ts ; la lecture et l'écriture : lib/categoriesDuDossierLecture.ts.
// Lues en partie, refusées ou rompues, les catégories ne se montrent pas et aucun geste n'est offert ; la modification
// lit d'abord les emplois de la catégorie (PC7-Q1 : employée, son compte et son poste restent ; elle ne se supprime pas).

export default function CategoriesDuDossierCard(props: { dossierId: string; plan: PlanComptable }) {
  return CATEGORIES_DU_DOSSIER_PREVUES ? <CategoriesDuDossier {...props} /> : null
}

/** Le choix du poste de la 2035 dans la liste fermée de la classe du compte saisi. */
export function ChoixDuPoste({ compte, poste, onChange, disabled, id }: {
  compte: string; poste: string; onChange: (poste: string) => void; disabled?: boolean; id: string
}) {
  const lu = compteDeCategorie(compte)
  const postes = 'refus' in lu ? [] : postesDeLaClasse(lu.classe)
  return (
    <select id={id} value={poste} onChange={(e) => onChange(e.target.value)} disabled={disabled || postes.length === 0}>
      <option value="">{postes.length === 0 ? 'Le compte d’abord' : 'Choisir le poste…'}</option>
      {postes.map((p) => <option key={p} value={p}>{p}</option>)}
    </select>
  )
}

function CategoriesDuDossier({ dossierId, plan }: { dossierId: string; plan: PlanComptable }) {
  const [lecture, setLecture] = useState<LectureDesCategories | null>(null)
  const [version, setVersion] = useState(0)
  const [saisie, setSaisie] = useState({ libelle: '', compte: '', poste: '' })
  const [edition, setEdition] = useState<{ categorie: Categorie; emplois: LectureDesEmplois | null; libelle: string; compte: string; poste: string } | null>(null)
  const [confirmation, setConfirmation] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)
  const ecritureEnCours = useRef(false)

  useEffect(() => {
    let annule = false
    void lireLesCategoriesDuDossier(dossierId).then((r) => { if (!annule) setLecture(r) })
    return () => { annule = true }
  }, [dossierId, version])

  const lues = lecture && lecture.dossierId === dossierId ? lecture : null
  if (!lues) return <div className="card" style={{ maxWidth: 760, marginTop: 20 }}><h3 style={{ marginTop: 0 }}>Catégories du dossier</h3><p className="muted">Chargement…</p></div>
  if (lues.etat === 'incompletes') {
    return (
      <div className="card" style={{ maxWidth: 760, marginTop: 20 }}>
        <h3 style={{ marginTop: 0 }}>Catégories du dossier</h3>
        <p className="error-text">Les catégories n’ont pas été lues en entier ({lues.motif}) : rien ne se crée ni ne se modifie d’ici.</p>
      </div>
    )
  }
  const categories = lues.categories
  const propres = categories.filter((c) => c.dossier_id !== null).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))
  const communes = categories.filter((c) => c.dossier_id === null).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))
  const saisieCommencee = saisie.libelle.trim() !== '' || saisie.compte.trim() !== '' || saisie.poste !== ''
  const jugement = jugerLaCategorie(saisie, { plan, categories, modifiee: null })
  const voisine = 'refus' in jugement ? null : memeCompteQue(jugement.compte, categories, null)

  async function ecrire(geste: () => Promise<{ ok: true } | { ok: false; refus: string }>, apres: () => void) {
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const issue = await geste()
      if (issue.ok) apres()
      else setErreur(issue.refus)
    } finally {
      setVersion((v) => v + 1)
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function creer() {
    if ('refus' in jugement) return
    const codes = new Set(categories.map((c) => c.code))
    await ecrire(() => creerLesCategories(dossierId, [{
      code: codeDUneCategorieDuDossier(jugement.compte, codes), libelle: jugement.libelle,
      compte_comptable: jugement.compte, poste_2035: jugement.poste,
    }]), () => setSaisie({ libelle: '', compte: '', poste: '' }))
  }

  async function ouvrir(categorie: Categorie) {
    setConfirmation(false)
    setErreur(null)
    setEdition({ categorie, emplois: null, libelle: categorie.libelle, compte: categorie.compte_comptable ?? '', poste: categorie.poste_2035 ?? '' })
    const emplois = await lireLesEmplois(dossierId, categorie.id)
    setEdition((e) => (e && e.categorie.id === categorie.id ? { ...e, emplois } : e))
  }

  const emploisLus = edition?.emplois?.etat === 'lus' ? edition.emplois.emplois : null
  const jugementEdition = edition && emploisLus
    ? jugerLaCategorie(edition, { plan, categories, modifiee: { categorie: edition.categorie, emplois: emploisLus } }) : null

  async function enregistrer() {
    if (!edition || !jugementEdition || 'refus' in jugementEdition) return
    await ecrire(() => modifierLaCategorie(dossierId, edition.categorie, {
      libelle: jugementEdition.libelle, compte_comptable: jugementEdition.compte, poste_2035: jugementEdition.poste,
    }), () => setEdition(null))
  }

  async function supprimer() {
    if (!edition || !emploisLus || estEmployee(emploisLus)) return
    await ecrire(() => supprimerLaCategorie(dossierId, edition.categorie.id), () => { setEdition(null); setConfirmation(false) })
  }

  return (
    <div className="card" style={{ maxWidth: 760, marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Catégories du dossier</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
        Vos habitudes de ventilation : une catégorie range une charge (classe 6) ou un produit (classe 7) sous un compte et un
        poste de la 2035. Le client du dossier lit les catégories (leur libellé compris).
      </p>
      {erreur && <p className="error-text">{erreur}</p>}
      {propres.length === 0 ? <p className="muted">Aucune catégorie propre à ce dossier.</p> : (
        <div className="table-scroll">
          <table>
            <thead><tr><th>Libellé</th><th>Compte</th><th>Poste de la 2035</th><th /></tr></thead>
            <tbody>
              {propres.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td><td>{c.compte_comptable ?? '—'}</td><td>{c.poste_2035 ?? '—'}</td>
                  <td><button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => void ouvrir(c)}>Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {edition && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
          <h4 style={{ margin: '0 0 6px' }}>Modifier « {edition.categorie.libelle} »</h4>
          {edition.emplois === null && <p className="muted">Chargement…</p>}
          {edition.emplois?.etat === 'illisibles' && (
            <p className="error-text">Ses emplois n’ont pas été lus ({edition.emplois.motif}) : rien ne se modifie d’ici.</p>
          )}
          {emploisLus && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>{phraseDesEmplois(emploisLus)}</p>
              <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 10 }}>
                <div className="field"><label htmlFor="cat-ed-libelle">Libellé</label>
                  <input id="cat-ed-libelle" value={edition.libelle} onChange={(e) => setEdition({ ...edition, libelle: e.target.value })} /></div>
                <div className="field"><label htmlFor="cat-ed-compte">Compte</label>
                  <input id="cat-ed-compte" value={edition.compte} disabled={estEmployee(emploisLus)} inputMode="numeric"
                    onChange={(e) => setEdition({ ...edition, compte: e.target.value, poste: '' })} /></div>
                <div className="field"><label htmlFor="cat-ed-poste">Poste de la 2035</label>
                  <ChoixDuPoste id="cat-ed-poste" compte={edition.compte} poste={edition.poste} disabled={estEmployee(emploisLus)}
                    onChange={(poste) => setEdition({ ...edition, poste })} /></div>
              </div>
              {estEmployee(emploisLus) && <p className="muted">{COMPTE_ET_POSTE_FIGES}</p>}
              {jugementEdition && 'refus' in jugementEdition && <p className="error-text">{jugementEdition.refus}</p>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" disabled={enCours || !jugementEdition || 'refus' in jugementEdition}
                  onClick={() => void enregistrer()}>Enregistrer</button>
                {!estEmployee(emploisLus) && !confirmation && (
                  <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => setConfirmation(true)}>Supprimer…</button>
                )}
                <button type="button" className="btn btn-secondary" disabled={enCours} onClick={() => { setEdition(null); setConfirmation(false) }}>Fermer</button>
              </div>
              {confirmation && (
                <p>
                  Supprimer la catégorie « {edition.categorie.libelle} » ({edition.categorie.compte_comptable ?? 'sans compte'}) ? Elle
                  n’est employée par rien ; elle ne se retrouvera pas.{' '}
                  <button type="button" className="btn btn-danger" disabled={enCours} onClick={() => void supprimer()}>Confirmer la suppression</button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
        <h4 style={{ margin: '0 0 6px' }}>Nouvelle catégorie</h4>
        <div className="field-row aligne-bas" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="field"><label htmlFor="cat-libelle">Libellé (lu par le client)</label>
            <input id="cat-libelle" value={saisie.libelle} onChange={(e) => setSaisie({ ...saisie, libelle: e.target.value })} /></div>
          <div className="field"><label htmlFor="cat-compte">Compte</label>
            <input id="cat-compte" value={saisie.compte} inputMode="numeric" placeholder="606400"
              onChange={(e) => setSaisie({ ...saisie, compte: e.target.value, poste: '' })} /></div>
          <div className="field"><label htmlFor="cat-poste">Poste de la 2035</label>
            <ChoixDuPoste id="cat-poste" compte={saisie.compte} poste={saisie.poste} onChange={(poste) => setSaisie({ ...saisie, poste })} /></div>
          <button type="button" className="btn btn-primary" disabled={enCours || 'refus' in jugement} onClick={() => void creer()}>
            {enCours ? 'Enregistrement…' : 'Créer la catégorie'}
          </button>
        </div>
        {saisieCommencee && 'refus' in jugement && <p className="error-text">{jugement.refus}</p>}
        {voisine && <p className="muted">La catégorie « {voisine.libelle} » tient déjà ce compte : les deux s’y additionneront.</p>}
      </div>

      {communes.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary>Catégories communes à tous les cabinets ({communes.length})</summary>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Seul l’administrateur de l’application en règle le compte et le poste.</p>
          <ul>{communes.map((c) => <li key={c.id}>{c.libelle} — {c.compte_comptable ?? 'sans compte'} — {c.poste_2035 ?? 'sans poste'}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
