import { useRef, useState } from 'react'
import { enregistrerEcritureLibre, retirerEcritureLibre } from '../../lib/ecrituresLibresLecture'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { telechargerTexte } from '../../lib/fec'
import { telechargerUnPdf } from '../../lib/apercu'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import {
  AVERTISSEMENT_DU_LIBELLE, POSTES_DES_DEPENSES, POSTES_DES_RECETTES, avertissementsDeLEcritureLibre, classeDeResultat,
  composerEcrituresLibres, ecritureLibrePourLaBase, estRattachee, posteProposeDuCompte, propositionDeLaRegle,
  refusDeLEcritureLibre, type ModeComptableDeLEcriture,
} from '../../lib/ecritureLibre'
import { auteurDeLaVersion, instantDeLaVersion, referenceDeLEcritureLibre } from '../../lib/ecrituresLibresDesExports'
import {
  LIGNE_VIDE, compteDuFormulaire, confirmationDeLEcriture, confirmationDuRetrait, contexteDuJugement, ecrituresDeLExercice,
  equilibreDeLaSaisie, euros, formulaireDeLEcriture, formulaireVide, saisieDuFormulaire, type FormulaireDEcritureLibre,
  type LectureDesEcrituresLibres, type LigneDuFormulaire,
} from '../../lib/ecrituresLibresVue'
import { effetDeLaLigne, genererEtatDesEcrituresLibresCsv, instantAParis, lignesDeLEtat, nomDuFichierDeLEtat, pdfDeLEtat } from '../../lib/etatDesEcrituresLibres'
import type { Categorie, Piece } from '../../lib/types'

// LA SECTION « ÉCRITURES DE L'EXPERT-COMPTABLE » DE L'ONGLET ÉCRITURES (EL5 ; conception 54, § 3 à § 5 et le lot EL5). Montée
// par l'onglet sous `ECRITURES_LIBRES_PREVUES` seulement : le drapeau baissé, elle n'existe pas, et rien n'est lu.
//
// - La liste de l'exercice affiché, LUE EN ENTIER : pas encore revenue, « Chargement… » ; lue en partie ou illisible, le motif
//   et AUCUN geste (ni saisie, ni remplacement, ni retrait, ni état).
// - Tout compte du cabinet qui suit le dossier écrit (EL-Q1 : `admin_du_dossier`, la base le vérifie et pose l'auteur) : l'onglet
//   n'est qu'au cabinet ; aucune case de rôle ici, la base seule tranche.
// - La saisie compte par compte, TELLE QU'ELLE PART (`saisieDuFormulaire`) : l'équilibre affiché, les refus du module dits avant
//   le clic dans l'ordre de la base, les avertissements sous chaque ligne, le poste proposé (un clic le prend), la règle de la
//   trésorerie proposée devant une charge ou un produit rattaché ; la confirmation NOMME les lignes, les totaux et l'effet sur
//   la 2035 ; les gestes par `enregistrer_ecriture_libre` et `retirer_ecriture_libre` seules, chacun sous son verrou `useRef`,
//   relâché après la relecture.
export default function EcrituresLibresSection({
  dossierId, annee, mode, lecture, frontiere, ouverture, categories, pieces, relecture, relire,
}: {
  dossierId: string
  annee: number | 'toutes' | 'sans_date'
  mode: ModeComptableDeLEcriture
  // La lecture de l'onglet ; nulle tant qu'elle n'est pas revenue.
  lecture: LectureDesEcrituresLibres | null
  frontiere: string | null
  // La date des à-nouveaux (l'ouverture), nulle sans reprise ; `undefined` tant qu'ils ne sont pas lus en entier : aucun geste.
  ouverture: string | null | undefined
  categories: readonly Categorie[]
  // Les pièces que l'état peut citer, lues par l'onglet (une absente s'y dit « hors du jeu chargé »).
  pieces: readonly Piece[]
  relecture: boolean
  relire: () => Promise<void>
}) {
  const [formulaire, setFormulaire] = useState<FormulaireDEcritureLibre | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const enregistrementEnCours = useRef(false)
  const retraitEnCours = useRef(false)

  const lue = lecture !== null && lecture.dossierId === dossierId ? lecture : null
  const exercice = typeof annee === 'number' ? annee : null

  const titre = <h3 style={{ marginTop: 0 }}>Écritures de l’expert-comptable</h3>
  if (lue === null) return <div className="card" style={{ marginBottom: 20 }}>{titre}<p className="muted">Chargement…</p></div>
  if (lue.etat === 'absentes') return null
  if (lue.etat === 'illisibles') {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        {titre}
        <BandeauLecturePartielle quoi="Les écritures de l’expert-comptable" motif={lue.motif}
          consequence="Aucune ne se passe, ne se modifie ni ne se retire d’ici, et le FEC comme la 2035 attendent leur relecture." />
      </div>
    )
  }

  const toutes = lue.ecritures
  const ecritures = exercice === null ? [] : ecrituresDeLExercice(toutes, exercice)
  const contexte = contexteDuJugement(mode, frontiere, ouverture, aujourdHuiAParis())
  const saisie = formulaire === null ? null : saisieDuFormulaire(formulaire)
  const refus = saisie === null || contexte === null ? [] : refusDeLEcritureLibre(saisie, contexte)
  const avis = saisie === null ? [] : avertissementsDeLEcritureLibre(saisie, mode)
  const equilibre = saisie === null ? null : equilibreDeLaSaisie(saisie)
  const geler = enCours || relecture

  function changerLigne(i: number, change: Partial<LigneDuFormulaire>) {
    setFormulaire((f) => f === null ? f : { ...f, lignes: f.lignes.map((l, j) => (j === i ? { ...l, ...change } : l)) })
  }

  async function enregistrer() {
    if (enregistrementEnCours.current) return
    if (formulaire === null || contexte === null) return
    const s = saisieDuFormulaire(formulaire)
    const proposees = composerEcrituresLibres(s, contexte)
    if (proposees === null) return
    const avertissements = avertissementsDeLEcritureLibre(s, mode).map((a) => a.message)
    if (!window.confirm(confirmationDeLEcriture(formulaire, mode, [...new Set(avertissements)]))) return
    enregistrementEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refusDeLaBase = await enregistrerEcritureLibre(
        dossierId, ecritureLibrePourLaBase(s, formulaire.id, formulaire.pieceCiteeId), proposees, formulaire.versionLue,
      )
      if (refusDeLaBase !== null) setMessage({ genre: 'erreur', texte: `L’écriture n’a pas été passée : ${refusDeLaBase}` })
      else {
        setFormulaire(null)
        setMessage({ genre: 'ok', texte: 'Écriture libre passée.' })
      }
      await relire()
    } finally {
      enregistrementEnCours.current = false
      setEnCours(false)
    }
  }

  async function retirer(id: string) {
    if (retraitEnCours.current) return
    const e = ecritures.find((x) => x.id === id)
    if (!e || !window.confirm(confirmationDuRetrait(e))) return
    retraitEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refusDeLaBase = await retirerEcritureLibre(e.id, e.version)
      if (refusDeLaBase !== null) setMessage({ genre: 'erreur', texte: `L’écriture n’a pas été retirée : ${refusDeLaBase}` })
      else {
        if (formulaire?.id === e.id) setFormulaire(null)
        setMessage({ genre: 'ok', texte: `Écriture libre ${referenceDeLEcritureLibre(e)} retirée.` })
      }
      await relire()
    } finally {
      retraitEnCours.current = false
      setEnCours(false)
    }
  }

  const piecesParId = new Map(pieces.map((p) => [p.id, p]))
  const contexteDeLEtat = { mode, auteurs: lue.auteurs, pieces: piecesParId }
  function telechargerCsv() {
    if (exercice === null) return
    telechargerTexte(nomDuFichierDeLEtat(exercice, 'csv'), genererEtatDesEcrituresLibresCsv(lignesDeLEtat(toutes, exercice, contexteDeLEtat)))
  }
  async function telechargerPdf() {
    if (exercice === null) return
    const octets = await pdfDeLEtat(toutes, exercice, contexteDeLEtat)
    const r = telechargerUnPdf(octets, nomDuFichierDeLEtat(exercice, 'pdf'))
    if (!r.ok) setMessage({ genre: 'erreur', texte: r.message })
  }

  const postesDe = (compte: string) => classeDeResultat(compte) === 7 ? POSTES_DES_RECETTES : POSTES_DES_DEPENSES
  const refusGeneraux = refus.filter((r) => r.ligne === undefined)

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      {titre}
      <p className="muted">
        Une opération diverse (journal OD), saisie compte par compte, que rien d’autre dans l’application ne produit. Sa pièce est
        l’état des écritures libres de l’exercice ; la banque, la caisse et le résultat ne s’y passent pas.
      </p>
      {lue.motifDesAuteurs && <p className="muted">Les auteurs non lus se disent « le cabinet » ({lue.motifDesAuteurs}).</p>}
      {message && <p className={message.genre === 'erreur' ? 'error-text' : 'success-text'} role="status">{message.texte}</p>}

      {exercice === null ? (
        <p className="muted">Choisir un exercice dans l’en-tête du dossier pour voir et passer ses écritures libres.</p>
      ) : (
        <>
          {ecritures.length === 0 ? <p className="muted">Aucune écriture libre dans l’exercice {exercice}.</p> : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Numéro</th><th>Date</th><th>Libellé et lignes</th><th>Version</th><th /></tr>
                </thead>
                <tbody>
                  {ecritures.map((e) => (
                    <tr key={e.id}>
                      <td>{referenceDeLEcritureLibre(e)}</td>
                      <td>{formatDate(e.date)}</td>
                      <td>
                        <div>{e.libelle}{e.avec_extourne ? ' (extournée au 1er janvier suivant)' : ''}</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {e.lignes.map((l, i) => (
                            <li key={i}>
                              {l.compte}{l.compte_lib ? ` ${l.compte_lib}` : ''} : {l.sens === 'debit' ? 'débit' : 'crédit'} {euros(l.centimes)}
                              {mode === 'tresorerie' && classeDeResultat(l.compte) !== null ? ` — 2035 : ${effetDeLaLigne(l, mode)}` : ''}
                            </li>
                          ))}
                        </ul>
                        <div className="muted">Motif : {e.motif}</div>
                      </td>
                      <td>{e.version}, le {instantAParis(instantDeLaVersion(e))}, par {auteurDeLaVersion(e, lue.auteurs)}</td>
                      <td>
                        <div className="actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-outline btn-sm" disabled={geler}
                            onClick={() => { setMessage(null); setFormulaire(formulaireDeLEcriture(e)) }}>Modifier</button>
                          <button type="button" className="btn btn-danger btn-sm" disabled={geler} onClick={() => retirer(e.id)}>Retirer</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={geler || formulaire !== null || contexte === null}
              onClick={() => { setMessage(null); setFormulaire(formulaireVide(`${exercice}-12-31`)) }}>Nouvelle écriture libre</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={telechargerCsv}>État des écritures libres (CSV)</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={telechargerPdf}>État des écritures libres (PDF)</button>
          </div>
          {contexte === null && <p className="muted">Les à-nouveaux du dossier ne sont pas lus en entier : aucune écriture ne se passe d’ici.</p>}
        </>
      )}

      {formulaire !== null && saisie !== null && equilibre !== null && (
        <form style={{ marginTop: 16 }} onSubmit={(ev) => { ev.preventDefault(); void enregistrer() }} aria-label="Saisie de l’écriture libre">
          <h4 style={{ marginTop: 0 }}>{formulaire.id === null ? 'Nouvelle écriture libre' : `Remplacer la version ${formulaire.versionLue}`}</h4>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <label className="field">Date
              <input type="date" value={formulaire.date} onChange={(ev) => setFormulaire({ ...formulaire, date: ev.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>Libellé
              <input type="text" value={formulaire.libelle} maxLength={200}
                onChange={(ev) => setFormulaire({ ...formulaire, libelle: ev.target.value })} />
            </label>
          </div>
          <p className="muted">{AVERTISSEMENT_DU_LIBELLE}</p>
          <label className="field">Motif (au cabinet seul, jamais au FEC)
            <textarea value={formulaire.motif} maxLength={2000} rows={2}
              onChange={(ev) => setFormulaire({ ...formulaire, motif: ev.target.value })} />
          </label>

          {formulaire.lignes.map((l, i) => {
            const compte = compteDuFormulaire(l.compte)
            const deResultat = mode === 'tresorerie' && classeDeResultat(compte) !== null
            const propose = deResultat ? posteProposeDuCompte(compte, categories) : null
            return (
              <fieldset key={i} style={{ border: 'none', padding: 0, margin: '8px 0' }} aria-label={`Ligne ${i + 1}`}>
                <div className="field-row aligne-bas" style={{ flexWrap: 'wrap' }}>
                  <label className="field">Compte
                    <input type="text" inputMode="numeric" value={l.compte} onChange={(ev) => changerLigne(i, { compte: ev.target.value })} />
                  </label>
                  <label className="field">Libellé du compte (s’il n’en a pas)
                    <input type="text" value={l.compteLib} onChange={(ev) => changerLigne(i, { compteLib: ev.target.value })} />
                  </label>
                  <label className="field">Sens
                    <select value={l.sens} onChange={(ev) => changerLigne(i, { sens: ev.target.value === 'credit' ? 'credit' : 'debit' })}>
                      <option value="debit">Débit</option>
                      <option value="credit">Crédit</option>
                    </select>
                  </label>
                  <label className="field">Montant
                    <input type="text" inputMode="decimal" value={l.montant} onChange={(ev) => changerLigne(i, { montant: ev.target.value })} />
                  </label>
                  {deResultat && (
                    <label className="field">Effet sur la 2035
                      <select value={l.poste} onChange={(ev) => changerLigne(i, { poste: ev.target.value })}>
                        <option value="">Hors de la 2035</option>
                        {postesDe(compte).map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </label>
                  )}
                  {formulaire.lignes.length > 2 && (
                    <button type="button" className="btn btn-outline btn-sm"
                      onClick={() => setFormulaire({ ...formulaire, lignes: formulaire.lignes.filter((_, j) => j !== i) })}>Retirer la ligne</button>
                  )}
                </div>
                {propose !== null && l.poste !== propose && (
                  <p className="muted">Poste proposé par la catégorie du compte : {propose}.{' '}
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => changerLigne(i, { poste: propose })}>Le prendre</button>
                  </p>
                )}
                {refus.filter((r) => r.ligne === i).map((r) => <p key={r.cle} className="error-text">{r.message}</p>)}
                {avis.filter((a) => a.ligne === i).map((a) => <p key={a.cle} className="muted">{a.message}</p>)}
              </fieldset>
            )
          })}
          <button type="button" className="btn btn-outline btn-sm"
            onClick={() => setFormulaire({ ...formulaire, lignes: [...formulaire.lignes, { ...LIGNE_VIDE }] })}>Ajouter une ligne</button>

          <p>
            Débit {euros(equilibre.debit)} — crédit {euros(equilibre.credit)}
            {equilibre.ecart === 0 ? ' : équilibrée.' : ` : écart de ${euros(Math.abs(equilibre.ecart))}.`}
          </p>
          <label>
            <input type="checkbox" checked={formulaire.avecExtourne}
              onChange={(ev) => setFormulaire({ ...formulaire, avecExtourne: ev.target.checked })} />{' '}
            Extourner au 1er janvier suivant (une écriture du 31 décembre seulement)
          </label>
          {avis.filter((a) => a.ligne === undefined).map((a) => <p key={a.cle} className="muted">{a.message}</p>)}
          {estRattachee(saisie.lignes, mode) && (
            <p>
              <button type="button" className="btn btn-outline btn-sm"
                onClick={() => setFormulaire(appliquerLaRegle(formulaire, mode))}>Passer hors de la 2035, avec son extourne</button>
            </p>
          )}
          {refusGeneraux.map((r) => <p key={r.cle} className="error-text">{r.message}</p>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-sm" disabled={geler || contexte === null || refus.length > 0}>
              {formulaire.id === null ? 'Passer l’écriture' : 'Remplacer l’écriture'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => setFormulaire(null)}>Abandonner</button>
          </div>
        </form>
      )}
    </div>
  )
}

/** La règle de la trésorerie appliquée au formulaire (`propositionDeLaRegle`) : les postes vidés, l'extourne au 31 décembre. */
function appliquerLaRegle(f: FormulaireDEcritureLibre, mode: ModeComptableDeLEcriture): FormulaireDEcritureLibre {
  const proposee = propositionDeLaRegle(saisieDuFormulaire(f), mode)
  return {
    ...f, avecExtourne: proposee.avecExtourne,
    lignes: f.lignes.map((l, i) => (proposee.lignes[i].poste2035 === null ? { ...l, poste: '' } : l)),
  }
}
