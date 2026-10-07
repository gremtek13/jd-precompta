import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { messageErreur } from '../../lib/messageErreur'
import {
  EXONERATIONS,
  STATUTS_TVA,
  ecritureDuStatut,
  exonerationDe,
  manqueMentionTva,
  mentionTva,
  obligationsFacturationElectronique,
  resumeObligations,
  type EtatObligation,
} from '../../lib/statutTva'
import type { ArticleExoneration, PeriodiciteTva, StatutTva } from '../../lib/types'

// LE STATUT DE TVA DU DOSSIER, ET CE QU'IL LUI FAIT DEVOIR À LA FACTURATION ÉLECTRONIQUE (ligne 28.5, étape a).
//
// Le statut se règle ici, dans l'onglet TVA, et le badge « TVA » de l'en-tête y mène — comme le badge du modèle
// comptable mène à Écritures. Il se choisit en deux temps : le statut et, pour un dossier exonéré ou en partie
// exonéré, l'article ; puis « Enregistrer ». Des BOUTONS et non des boutons radio, et une liste qui n'écrit rien
// à son changement : sur un champ qui a le focus, les flèches du clavier changent la valeur, donc l'enregistreraient.
// Ce statut décide du montant de chaque pièce (hors taxes pour un redevable, TVA comprise sinon) : un changement
// glissé sous la main se verrait sur toutes les déclarations du dossier.

export interface ModificationStatutTva {
  statut_tva: StatutTva | null
  article_exoneration: ArticleExoneration | null
  assujetti_tva: boolean
}

interface Props {
  dossierId: string
  statut: StatutTva | null
  article: ArticleExoneration | null
  // Ce que la base a écrit — `assujetti_tva` compris, que son déclencheur déduit du statut.
  onStatutUpdated: (modification: ModificationStatutTva) => void
}

const LIBELLE_STATUT: Record<StatutTva, string> = Object.fromEntries(STATUTS_TVA.map((s) => [s.statut, s.libelle])) as Record<StatutTva, string>
const EXPLICATION_STATUT: Record<StatutTva, string> = Object.fromEntries(STATUTS_TVA.map((s) => [s.statut, s.explication])) as Record<StatutTva, string>

export default function StatutTvaCard({ dossierId, statut, article, onStatutUpdated }: Props) {
  // Un statut à préciser s'affiche d'office en édition — c'est la question à laquelle cette carte existe pour
  // répondre —, et c'est le rendu qui le décide, pas cet état : il ne dit que « Changer le statut » a été cliqué.
  const [edition, setEdition] = useState(false)
  const [choix, setChoix] = useState<StatutTva | null>(statut)
  const [articleChoisi, setArticleChoisi] = useState<ArticleExoneration | null>(article)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  // Verrou d'exécution : un `useRef`, posé AVANT le `try` et relâché dans le `finally` (voir CLAUDE.md).
  const ecriture = useRef(false)

  // Ce que « Enregistrer » écrirait. L'article ne vaut que pour un dossier exonéré ou redevable : la franchise n'en
  // a pas, et c'est `ecritureDuStatut` qui le retire — la même écriture partout, pour l'aperçu comme pour la base.
  const prevu = choix == null ? null : ecritureDuStatut(choix, articleChoisi)
  const modifie = prevu != null && (prevu.statut_tva !== statut || prevu.article_exoneration !== article)
  // Ce que le changement fait aux montants du dossier, dit avant le clic.
  const devientRedevable = choix === 'redevable' && statut !== 'redevable'
  const cesseDEtreRedevable = choix != null && choix !== 'redevable' && statut === 'redevable'

  function annuler() {
    setChoix(statut)
    setArticleChoisi(article)
    setErreur(null)
    setEdition(false)
  }

  async function enregistrer() {
    if (prevu == null || !modifie) return
    if (ecriture.current) return
    ecriture.current = true
    setEnCours(true)
    setErreur(null)
    try {
      const { data, error } = await supabase
        .from('dossiers')
        .update(prevu)
        .eq('id', dossierId)
        .select('statut_tva, article_exoneration, assujetti_tva')
        .single()
      if (error || !data) {
        setErreur(messageErreur(error, 'Le statut de TVA n’a pas pu être enregistré.'))
        return
      }
      onStatutUpdated(data as ModificationStatutTva)
      setEdition(false)
    } catch (err) {
      setErreur(messageErreur(err, 'Le statut de TVA n’a pas pu être enregistré.'))
    } finally {
      ecriture.current = false
      setEnCours(false)
    }
  }

  const exoneration = exonerationDe(article)
  const mentionEnregistree = mentionTva(statut, article)

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Statut de TVA</h3>
      {!edition && statut != null ? (
        <>
          <p style={{ margin: 0 }}>
            <strong>{LIBELLE_STATUT[statut]}</strong>
            {exoneration && <> — {statut === 'redevable' ? 'en partie exonéré : ' : ''}{exoneration.objet.toLowerCase()} ({exoneration.reference})</>}
          </p>
          <p className="muted" style={{ margin: '4px 0 0' }}>{EXPLICATION_STATUT[statut]}</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {mentionEnregistree
              ? <>Mention proposée sur ses factures : « {mentionEnregistree} »</>
              : statut === 'redevable'
                ? 'Ses factures portent la TVA : aucune mention d’exonération n’y est proposée.'
                : manqueMentionTva(statut, article)}
          </p>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setEdition(true)}>
            Changer le statut
          </button>
        </>
      ) : (
        <>
          {statut == null && (
            <p className="alerte-tva" style={{ margin: '0 0 10px' }}>
              Le statut de TVA de ce dossier est à préciser. Il décide de la mention de ses factures, du motif transmis à
              une plateforme, et de ce qu’il doit à la facturation électronique.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {STATUTS_TVA.map((s) => (
              <button
                key={s.statut}
                type="button"
                className={`btn btn-sm ${choix === s.statut ? 'btn-primary' : 'btn-outline'}`}
                aria-pressed={choix === s.statut}
                disabled={enCours}
                onClick={() => setChoix(s.statut)}
              >
                {s.libelle}
              </button>
            ))}
          </div>
          {choix != null && <p className="muted" style={{ margin: 0 }}>{EXPLICATION_STATUT[choix]}</p>}
          {(choix === 'exonere' || choix === 'redevable') && (
            <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label htmlFor="statut-tva-article">
                {choix === 'exonere' ? 'Article de l’exonération' : 'Une partie de son activité est-elle exonérée ?'}
              </label>
              <select
                id="statut-tva-article"
                value={articleChoisi ?? ''}
                disabled={enCours}
                onChange={(e) => setArticleChoisi(e.target.value === '' ? null : e.target.value as ArticleExoneration)}
              >
                <option value="">
                  {choix === 'exonere' ? 'Non précisé — la mention se saisira sur chaque facture' : 'Non — toute son activité est taxable'}
                </option>
                {EXONERATIONS.map((e) => (
                  <option key={e.code} value={e.code}>{e.objet} ({e.reference})</option>
                ))}
              </select>
            </div>
          )}
          {prevu != null && (
            <p className="muted" style={{ margin: '10px 0 0' }}>
              {mentionTva(prevu.statut_tva, prevu.article_exoneration)
                ? <>Mention proposée sur ses factures : « {mentionTva(prevu.statut_tva, prevu.article_exoneration)} »</>
                : prevu.statut_tva === 'redevable'
                  ? 'Ses factures portent la TVA : aucune mention d’exonération n’y est proposée.'
                  : manqueMentionTva(prevu.statut_tva, prevu.article_exoneration)}
            </p>
          )}
          {devientRedevable && (
            <p className="alerte-tva" style={{ margin: '10px 0 0' }}>
              Redevable, le dossier récupère la TVA qu’il paie : ses pièces seront retenues hors taxes, la TVA se ventilera
              dans ses écritures, et cet onglet préparera ses déclarations.
            </p>
          )}
          {cesseDEtreRedevable && (
            <p className="alerte-tva" style={{ margin: '10px 0 0' }}>
              Le dossier ne récupérera plus la TVA qu’il paie : ses pièces seront retenues TVA comprise, et cet onglet ne
              préparera plus de déclaration.
            </p>
          )}
          {erreur && <p className="error-text">{erreur}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" disabled={!modifie || enCours} onClick={enregistrer}>
              {enCours ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {statut != null && (
              <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={annuler}>Annuler</button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const CLASSE_ETAT: Record<EtatObligation, string> = {
  due: 'badge-ok',
  en_partie: 'badge-ok',
  non_due: 'badge-neutral',
  a_preciser: 'badge-warning',
}
const LIBELLE_ETAT: Record<EtatObligation, string> = {
  due: 'Due',
  en_partie: 'Due en partie',
  non_due: 'Non due',
  a_preciser: 'À préciser',
}

// Ce que le statut ENREGISTRÉ fait devoir au dossier — jamais celui qu'on est en train de choisir.
export function FacturationElectroniqueCard({ statut, article, periodicite, surDebits }: {
  statut: StatutTva | null
  article: ArticleExoneration | null
  periodicite: PeriodiciteTva
  surDebits: boolean
}) {
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Facturation électronique</h3>
      <p className="muted" style={{ marginTop: -8 }}>{resumeObligations(statut, article)}</p>
      <ul className="obligations-fe">
        {obligationsFacturationElectronique(statut, article, periodicite, surDebits).map((o) => (
          <li key={o.cle}>
            <span className={`badge ${CLASSE_ETAT[o.etat]}`}>{LIBELLE_ETAT[o.etat]}</span>
            <div>
              <strong>{o.libelle}</strong>
              <p className="muted" style={{ margin: '2px 0 0' }}>{o.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
