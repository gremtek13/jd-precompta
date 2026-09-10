import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { calculerBalance } from '../../lib/ecritures'
import { calculerEvolutionMensuelle } from '../../lib/tableauPilotage'
import type { Categorie, EcritureBrouillon, Piece } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'
import type { DossierTab } from '../../components/DossierParcours'

const NB_MOIS_EVOLUTION = 6

// Balance des comptes (anciennement "Statistiques", renommé pour dire ce que l'écran affiche
// réellement — voir audit ergonomie comparatif) — vue transversale sur tout le brouillon (voir
// EcrituresTab, qui ne montre le journal que ligne à ligne, pièce par pièce) : un compte par ligne,
// avec son nombre d'écritures et ses totaux débit/crédit, pour repérer d'un coup d'œil un solde
// anormal (une charge créditrice, un compte oublié...) sans dérouler tout le journal. Toujours
// calculée depuis le même brouillon que EcrituresTab, jamais une comptabilité tenue à part (voir
// BrouillonBanner ailleurs dans l'onglet Écritures — même statut ici, juste pas répété pour ne pas
// surcharger un onglet de lecture).
export default function StatistiquesTab({ dossierId, onNavigate }: { dossierId: string; onNavigate: (tab: DossierTab) => void }) {
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [loading, setLoading] = useState(true)
  // Exercice partagé avec Pièces/Banque/Écritures/Clôture, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  const [recherche, setRecherche] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId),
    ]).then(([{ data: ecrituresData }, { data: categoriesData }, { data: piecesData }]) => {
      setEcritures(ecrituresData ?? [])
      setCategories(categoriesData ?? [])
      setPieces(piecesData ?? [])
      setLoading(false)
    })
  }, [dossierId])

  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => new Date(e.date).getFullYear() === anneeFilter)

  // Tableau de pilotage (voir audit ergonomie comparatif) — deux repères qui manquaient à cet onglet :
  // une tendance de trésorerie récente (indépendante de l'exercice sélectionné, comme le plan de
  // trésorerie de Financement) et un avancement grossier du dossier en cours. Le détail complet de
  // l'avancement (points à traiter, documents attendus) reste dans Vue d'ensemble — pas dupliqué ici,
  // juste un chiffre de synthèse avec un renvoi.
  const evolutionMensuelle = useMemo(() => calculerEvolutionMensuelle(ecritures, NB_MOIS_EVOLUTION), [ecritures])
  const anneeCourante = new Date().getFullYear()
  const piecesAnnee = pieces.filter((p) => p.date_piece && new Date(p.date_piece).getFullYear() === anneeCourante)
  const piecesValideesAnnee = piecesAnnee.filter((p) => p.statut === 'validee')
  const avancementPct = piecesAnnee.length > 0 ? Math.round((piecesValideesAnnee.length / piecesAnnee.length) * 100) : null
  const maxMontantEvolution = Math.max(1, ...evolutionMensuelle.flatMap((m) => [m.encaissements, m.decaissements]))

  const balance = useMemo(() => calculerBalance(ecrituresFiltrees, categories), [ecrituresFiltrees, categories])

  const rechercheNormalisee = recherche.trim().toLowerCase()
  const lignesAffichees = rechercheNormalisee
    ? balance.filter((l) => l.compte.toLowerCase().includes(rechercheNormalisee) || l.libelle.toLowerCase().includes(rechercheNormalisee))
    : balance

  const totalDebit = lignesAffichees.reduce((sum, l) => sum + l.totalDebit, 0)
  const totalCredit = lignesAffichees.reduce((sum, l) => sum + l.totalCredit, 0)
  // Tolérance identique à analyserEcritures — un écart ici signale la même chose qu'un groupe
  // déséquilibré dans Écritures, mais vu depuis l'angle du compte plutôt que de la pièce.
  const desequilibre = Math.abs(totalDebit - totalCredit) > 0.02

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Balance de tous les comptes utilisés dans le brouillon d'écritures — même donnée que l'onglet
        Écritures, regroupée par compte plutôt que par pièce. Solde positif = débiteur, négatif =
        créditeur.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Tableau de pilotage</h3>
        <p className="muted" style={{ marginTop: -8, fontSize: '0.82rem' }}>
          Encaissements/décaissements calculés depuis le compte banque (512) du brouillon
          d'écritures — nécessite que les écritures correspondantes aient déjà été générées (voir
          l'onglet Écritures). Indépendant de l'exercice sélectionné ci-dessus : une tendance
          récente reste utile même en consultant une année passée.
        </p>

        {loading ? (
          <p className="muted">Chargement…</p>
        ) : evolutionMensuelle.length === 0 ? (
          <p className="muted">
            Aucune écriture bancaire générée pour l'instant — ce tableau se remplira au fil des
            écritures (voir l'onglet Écritures).
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {evolutionMensuelle.map((m) => (
              <div key={m.mois}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 4 }}>
                  <span className="muted">{m.mois}</span>
                  <span>
                    <span style={{ color: 'var(--color-primary)' }}>+{formatMoney(m.encaissements)}</span>
                    {'  '}
                    <span style={{ color: 'var(--color-danger)' }}>-{formatMoney(m.decaissements)}</span>
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--color-bg)', overflow: 'hidden', marginBottom: 3 }}>
                  <div style={{ width: `${(m.encaissements / maxMontantEvolution) * 100}%`, height: '100%', background: 'var(--color-primary)' }} />
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--color-bg)', overflow: 'hidden' }}>
                  <div style={{ width: `${(m.decaissements / maxMontantEvolution) * 100}%`, height: '100%', background: 'var(--color-danger)' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {avancementPct !== null && (
          <p style={{ margin: 0 }}>
            Avancement {anneeCourante} : <strong>{avancementPct} %</strong> des pièces déposées cette
            année sont validées ({piecesValideesAnnee.length}/{piecesAnnee.length}).{' '}
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('checklist')}>
              Voir le détail dans Vue d'ensemble
            </button>
          </p>
        )}
      </div>

      <input
        placeholder="Rechercher par numéro ou libellé de compte…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        style={{ marginBottom: 14, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, width: 320, maxWidth: '100%' }}
      />

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : lignesAffichees.length === 0 ? (
          <div className="empty-state">Aucun compte pour l'instant — génère des écritures depuis l'onglet Écritures.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Écritures</th>
                <th>Débit</th>
                <th>Crédit</th>
                <th>Solde</th>
              </tr>
            </thead>
            <tbody>
              {lignesAffichees.map((l) => (
                <tr key={l.compte}>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{l.compte}</td>
                  <td>{l.libelle}</td>
                  <td>{l.nbEcritures}</td>
                  <td>{formatMoney(l.totalDebit)}</td>
                  <td>{formatMoney(l.totalCredit)}</td>
                  <td>
                    {l.solde >= 0
                      ? <span>{formatMoney(l.solde)} <span className="muted">débiteur</span></span>
                      : <span>{formatMoney(-l.solde)} <span className="muted">créditeur</span></span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3}>Total</td>
                <td>{formatMoney(totalDebit)}</td>
                <td>{formatMoney(totalCredit)}</td>
                <td>
                  {desequilibre
                    ? <span className="badge badge-danger">écart {formatMoney(totalDebit - totalCredit)}</span>
                    : <span className="badge badge-ok">équilibré</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}
