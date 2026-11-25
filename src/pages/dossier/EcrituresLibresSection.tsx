import { useRef, useState } from 'react'
import { contrePasserEcritureLibre, enregistrerEcritureLibre, retirerEcritureLibre } from '../../lib/ecrituresLibresLecture'
import {
  CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE, composerLaContrePassation, contrePassationPourLaBase, estFigee, porteUnPoste,
  refusDeLEcritureAContrePasser, refusDeLaContrePassation, saisieProposeeDeLaContrePassation, type SaisieDeContrePassation,
} from '../../lib/contrePassationDesEcrituresLibres'
import {
  confirmationDeLaContrePassation, confirmationDuRetraitDUneContrePassation, mentionDeLaContrePassation, saisieDeLaContrePassation,
} from '../../lib/contrePassationDesEcrituresLibresVue'
import { aujourdHuiAParis, formatDate } from '../../lib/format'
import { telechargerTexte } from '../../lib/fec'
import { telechargerUnPdf } from '../../lib/apercu'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import ChoixDuJustificatif from './ChoixDuJustificatif'
import {
  AVERTISSEMENT_DU_LIBELLE, POSTES_DES_DEPENSES, POSTES_DES_RECETTES, avertissementsDeLEcritureLibre, classeDeResultat,
  composerEcrituresLibres, ecritureLibrePourLaBase, estRattachee, posteProposeDuCompte, propositionDeLaRegle,
  refusDeLEcritureLibre, type ModeComptableDeLEcriture,
} from '../../lib/ecritureLibre'
import { auteurDeLaVersion, instantDeLaVersion, referenceDeLEcritureLibre } from '../../lib/ecrituresLibresDesExports'
import {
  LIGNE_VIDE, compteDuFormulaire, confirmationDeLEcriture, confirmationDuRetrait, contexteDuJugement, ecrituresDeLExercice,
  equilibreDeLaSaisie, euros, formulaireDeLEcriture, formulaireVide, ligneDeLaPieceCitee, optionDeLaPieceCitee,
  optionsDesPiecesDUneEcritureLibre, saisieDuFormulaire, type FormulaireDEcritureLibre, type LectureDesEcrituresLibres,
  type LigneDuFormulaire,
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
// - La pièce citée, facultative (EL-Q8 (A)) : un choix parmi TOUTES les pièces du dossier que l'onglet a lues EN ENTIER,
//   « à valider » comprises et dites telles (ELQ8-Q1 (B), le 25/11/2026, comme l'inventaire ; `optionsDesPiecesDUneEcritureLibre`),
//   par le choix commun de l'inventaire (`ChoixDuJustificatif`) ; lues en partie, aucun choix, le motif dit, et la saisie part
//   avec ce qu'elle cite déjà. La liste et l'état des écritures libres nomment la pièce citée de chaque écriture.
// - La contre-passation (EL7), sous `CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE` seulement (baissé : la section d'EL5, à
//   l'identique) : une écriture FIGÉE par la validation de son exercice ne s'offre plus à « Modifier » ni à « Retirer », que la
//   base refuserait ; elle s'offre à « Contre-passer », sauf ce que son état retient, dit avant le clic (extournée, déjà
//   contre-passée). Le formulaire propose le premier jour de l'exercice ouvert, le libellé qui nomme l'écriture d'origine, hors de
//   la 2035 ; le motif est obligatoire ; les refus du module se disent avant le clic ; la confirmation NOMME les lignes au sens
//   inverse, les totaux et l'effet sur la 2035 ; le geste passe par `contre_passer_ecriture_libre` seule, sous son verrou `useRef`,
//   relâché après la relecture. Une contre-passation ne se modifie pas : ouverte, elle se retire (l'écriture d'origine redevient à
//   contre-passer) ; la liste dit qui contre-passe qui.
export default function EcrituresLibresSection({
  dossierId, annee, mode, lecture, frontiere, ouverture, categories, pieces, piecesIncompletes, relecture, relire,
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
  // TOUTES les pièces du dossier, lues par l'onglet, « à valider » comprises (ELQ8-Q1 (B)) : celles que l'état désigne (une
  // absente s'y dit « hors du jeu chargé ») et celles qu'une écriture peut citer.
  pieces: readonly Piece[]
  // Le motif d'une lecture des pièces partielle ou refusée ; nul quand elles sont lues en entier.
  piecesIncompletes: string | null
  relecture: boolean
  relire: () => Promise<void>
}) {
  const [formulaire, setFormulaire] = useState<FormulaireDEcritureLibre | null>(null)
  const [message, setMessage] = useState<{ genre: 'ok' | 'erreur'; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)
  const enregistrementEnCours = useRef(false)
  const retraitEnCours = useRef(false)
  // La contre-passation en saisie (EL7) : l'écriture visée et la saisie, telle qu'elle partira.
  const [contrePassation, setContrePassation] = useState<{ id: string; saisie: SaisieDeContrePassation } | null>(null)
  const contrePassationEnCours = useRef(false)

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
  // La contre-passation (EL7) : sa migration en base, le drapeau levé ; baissé, la section d'EL5, rien de plus.
  const contrePassationOfferte = CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE
  const ecritures = exercice === null ? [] : ecrituresDeLExercice(toutes, exercice)
  const contexte = contexteDuJugement(mode, frontiere, ouverture, aujourdHuiAParis())
  const saisie = formulaire === null ? null : saisieDuFormulaire(formulaire)
  const refus = saisie === null || contexte === null ? [] : refusDeLEcritureLibre(saisie, contexte)
  const avis = saisie === null ? [] : avertissementsDeLEcritureLibre(saisie, mode)
  const equilibre = saisie === null ? null : equilibreDeLaSaisie(saisie)
  const geler = enCours || relecture
  // Les pièces qui se citent : nulles tant qu'elles ne sont pas lues en entier — aucun choix ne s'offre alors.
  const citables = piecesIncompletes === null ? pieces : null
  const optionsDesPieces = citables === null ? [] : optionsDesPiecesDUneEcritureLibre(citables, dossierId)

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
    const pieceCitee = ligneDeLaPieceCitee(formulaire.pieceCiteeId, citables, dossierId)
    if (!window.confirm(confirmationDeLEcriture(formulaire, mode, [...new Set(avertissements)], pieceCitee))) return
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
    // Une contre-passation (EL7, le drapeau levé) : sa confirmation dit aussi l'écriture qui redevient à contre-passer.
    const confirmation = !e ? '' : contrePassationOfferte && (e.contre_passe_id ?? null) !== null
      ? confirmationDuRetraitDUneContrePassation(e, toutes) : confirmationDuRetrait(e)
    if (!e || !window.confirm(confirmation)) return
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

  // La contre-passation (EL7) : la saisie TELLE QU'ELLE PART, jugée par le module, composée, confirmée, puis la fonction seule.
  const visee = contrePassation === null ? null : toutes.find((x) => x.id === contrePassation.id) ?? null
  const refusDeLaSaisie = visee === null || contrePassation === null || contexte === null ? []
    : refusDeLaContrePassation(visee, contrePassation.saisie, contexte, toutes)
  function changerLaContrePassation(change: Partial<SaisieDeContrePassation>) {
    setContrePassation((c) => c === null ? c : { ...c, saisie: { ...c.saisie, ...change } })
  }
  async function contrePasser() {
    if (contrePassationEnCours.current) return
    if (contrePassation === null || visee === null || contexte === null) return
    const proposees = composerLaContrePassation(visee, contrePassation.saisie, contexte, toutes)
    if (proposees === null) return
    if (!window.confirm(confirmationDeLaContrePassation(visee, contrePassation.saisie, mode))) return
    contrePassationEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refusDeLaBase = await contrePasserEcritureLibre(visee.id, visee.version, contrePassationPourLaBase(contrePassation.saisie), proposees)
      if (refusDeLaBase !== null) setMessage({ genre: 'erreur', texte: `L’écriture n’a pas été contre-passée : ${refusDeLaBase}` })
      else {
        setContrePassation(null)
        setMessage({ genre: 'ok', texte: `Écriture libre ${referenceDeLEcritureLibre(visee)} contre-passée.` })
      }
      await relire()
    } finally {
      contrePassationEnCours.current = false
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
            // Sur une carte étroite (téléphone, volet ouvert), chaque écriture se replie en fiche, la cellule précédée de son
            // libellé (`table-empilable`) : la colonne des lignes ne se comprime plus à trois mots par ligne. La référence et la
            // date ne se coupent pas (« EL2026- / 0001 »).
            <div className="table-scroll tableau-adaptable">
              <table className="table table-empilable">
                <thead>
                  <tr><th>Numéro</th><th>Date</th><th>Libellé et lignes</th><th>Version</th><th /></tr>
                </thead>
                <tbody>
                  {ecritures.map((e) => {
                    // EL7, le drapeau levé : une écriture figée se contre-passe (ni « Modifier » ni « Retirer », que la base
                    // refuserait) ; une contre-passation ne se modifie pas. Baissé : les deux gestes d'EL5 sur toute écriture.
                    const figee = contrePassationOfferte && estFigee(e, frontiere)
                    const contrePasse = contrePassationOfferte && (e.contre_passe_id ?? null) !== null
                    const retenue = figee ? refusDeLEcritureAContrePasser(e, toutes, frontiere) : []
                    const mention = contrePassationOfferte ? mentionDeLaContrePassation(e, toutes) : null
                    return (
                      <tr key={e.id}>
                        <td data-libelle="Numéro" style={{ whiteSpace: 'nowrap' }}>{referenceDeLEcritureLibre(e)}</td>
                        <td data-libelle="Date" style={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</td>
                        <td data-libelle="Libellé et lignes">
                          {/* Un seul bloc : la cellule repliée en fiche est une rangée (le libellé, puis son contenu). */}
                          <div>
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
                            {e.piece_citee_id !== null && <div className="muted">{ligneDeLaPieceCitee(e.piece_citee_id, citables, dossierId)}</div>}
                            {mention !== null && <div className="muted">{mention}</div>}
                          </div>
                        </td>
                        <td data-libelle="Version">{e.version}, le {instantAParis(instantDeLaVersion(e))}, par {auteurDeLaVersion(e, lue.auteurs)}</td>
                        <td>
                          <div className="actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {!figee && !contrePasse && (
                              <button type="button" className="btn btn-outline btn-sm" disabled={geler || contrePassation !== null}
                                onClick={() => { setMessage(null); setFormulaire(formulaireDeLEcriture(e)) }}>Modifier</button>
                            )}
                            {!figee && <button type="button" className="btn btn-danger btn-sm" disabled={geler} onClick={() => retirer(e.id)}>Retirer</button>}
                            {figee && retenue.length === 0 && frontiere !== null && (
                              <button type="button" className="btn btn-outline btn-sm" disabled={geler || formulaire !== null || contexte === null}
                                onClick={() => { setMessage(null); setContrePassation({ id: e.id, saisie: saisieProposeeDeLaContrePassation(e, frontiere) }) }}>
                                Contre-passer
                              </button>
                            )}
                          </div>
                          {figee && <p className="muted" style={{ margin: '4px 0 0' }}>Figée par la validation de {e.exercice}.</p>}
                          {/* Ce que l'état de l'écriture retient, dit avant le clic ; « déjà contre-passée », la mention le dit. */}
                          {retenue.filter((r) => r.cle !== 'dejaContrePassee').map((r) => <p key={r.cle} className="muted" style={{ margin: '4px 0 0' }}>{r.message}</p>)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" disabled={geler || formulaire !== null || contrePassation !== null || contexte === null}
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
          <ChoixDuJustificatif
            id="ecriture-libre-piece" quoi="une pièce du dossier" desactive={geler}
            lecture={piecesIncompletes === null ? { etat: 'lue' } : { etat: 'incomplete', motif: piecesIncompletes }}
            options={optionsDesPieces}
            citee={formulaire.pieceCiteeId === null ? null : { genre: 'piece', id: formulaire.pieceCiteeId }}
            optionCitee={optionDeLaPieceCitee(formulaire.pieceCiteeId, citables, dossierId)}
            placeholder="Rechercher un tiers, une date, un montant…"
            onChoisir={(c) => setFormulaire({ ...formulaire, pieceCiteeId: c === null ? null : c.id })}
          />

          {formulaire.lignes.map((l, i) => {
            const compte = compteDuFormulaire(l.compte)
            const deResultat = mode === 'tresorerie' && classeDeResultat(compte) !== null
            const propose = deResultat ? posteProposeDuCompte(compte, categories) : null
            return (
              // `minWidth: 0` : un fieldset prend d'office la largeur de son contenu le plus large — l'option la plus longue du choix
              // du poste — et débordait la carte sur téléphone (vu au banc, 23/11/2026). Le poste prend sa propre rangée : comprimé
              // à côté des quatre champs, il ne montrait plus que son premier mot.
              <fieldset key={i} style={{ border: 'none', padding: 0, margin: '8px 0', minWidth: 0 }} aria-label={`Ligne ${i + 1}`}>
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
                    <label className="field" style={{ flex: '1 1 100%', minWidth: 0, maxWidth: '100%' }}>Effet sur la 2035
                      <select style={{ maxWidth: '100%' }} value={l.poste} onChange={(ev) => changerLigne(i, { poste: ev.target.value })}>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={geler || contexte === null || refus.length > 0}>
              {formulaire.id === null ? 'Passer l’écriture' : 'Remplacer l’écriture'}
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => setFormulaire(null)}>Abandonner</button>
          </div>
        </form>
      )}

      {contrePassationOfferte && contrePassation !== null && visee !== null && (
        <form style={{ marginTop: 16 }} onSubmit={(ev) => { ev.preventDefault(); void contrePasser() }} aria-label="Contre-passation de l’écriture libre">
          <h4 style={{ marginTop: 0 }}>Contre-passer {referenceDeLEcritureLibre(visee)} du {formatDate(visee.date)}</h4>
          <p className="muted">
            Une écriture libre neuve, dans un exercice ouvert, qui cite celle-ci et porte ses lignes au sens inverse. La 2035 de
            {' '}{visee.exercice}, validée, ne change pas.
          </p>
          <ul style={{ margin: '0 0 8px', paddingLeft: 18 }} aria-label="Lignes de la contre-passation">
            {saisieDeLaContrePassation(visee, contrePassation.saisie).lignes.map((l, i) => (
              <li key={i}>
                {l.compte}{l.compteLib ? ` ${l.compteLib}` : ''} : {l.sens === 'debit' ? 'débit' : 'crédit'} {euros(l.centimes)}
                {mode === 'tresorerie' && classeDeResultat(l.compte) !== null ? ` — 2035 : ${l.poste2035 ?? 'hors de la 2035'}` : ''}
              </li>
            ))}
          </ul>
          <div className="field-row" style={{ flexWrap: 'wrap' }}>
            <label className="field">Date de la contre-passation
              <input type="date" value={contrePassation.saisie.date} onChange={(ev) => changerLaContrePassation({ date: ev.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>Libellé de la contre-passation
              <input type="text" value={contrePassation.saisie.libelle} maxLength={200}
                onChange={(ev) => changerLaContrePassation({ libelle: ev.target.value })} />
            </label>
          </div>
          <p className="muted">{AVERTISSEMENT_DU_LIBELLE}</p>
          <label className="field">Motif de la contre-passation (au cabinet seul, jamais au FEC)
            <textarea value={contrePassation.saisie.motif} maxLength={2000} rows={2}
              onChange={(ev) => changerLaContrePassation({ motif: ev.target.value })} />
          </label>
          {mode === 'tresorerie' && porteUnPoste(visee) && (
            <fieldset style={{ border: 'none', padding: 0, margin: '8px 0', minWidth: 0 }}>
              <legend>Effet sur la 2035 de {contrePassation.saisie.date.slice(0, 4)}</legend>
              <label style={{ display: 'block' }}>
                <input type="radio" name="effet-de-la-contre-passation" checked={contrePassation.saisie.horsDeLa2035}
                  onChange={() => changerLaContrePassation({ horsDeLa2035: true })} />{' '}
                Hors de la 2035 : elle corrige les comptes, pas la 2035 (recommandé)
              </label>
              <label style={{ display: 'block' }}>
                <input type="radio" name="effet-de-la-contre-passation" checked={!contrePassation.saisie.horsDeLa2035}
                  onChange={() => changerLaContrePassation({ horsDeLa2035: false })} />{' '}
                Les postes de l’écriture d’origine, au sens inverse : la 2035 de cette année compte la correction
              </label>
            </fieldset>
          )}
          {refusDeLaSaisie.map((r) => <p key={r.cle} className="error-text">{r.message}</p>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={geler || contexte === null || refusDeLaSaisie.length > 0}>
              Contre-passer l’écriture
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={() => setContrePassation(null)}>Abandonner</button>
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
