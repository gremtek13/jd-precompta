import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { calculerBalance } from '../../lib/ecritures'
import { calculerEvolutionMensuelle } from '../../lib/tableauPilotage'
import type { Categorie, EcritureBrouillon, Piece } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'
import type { DossierTab } from '../../components/DossierParcours'
import MonthlyBars from '../../components/widgets/MonthlyBars'
import ProgressRing from '../../components/widgets/ProgressRing'

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
          <div className="skeleton skeleton-widget" style={{ height: 180 }} />
        ) : evolutionMensuelle.length === 0 ? (
          <p className="muted">
            Aucune écriture bancaire générée pour l'instant — ce tableau se remplira au fil des
            écritures (voir l'onglet Écritures).
          </p>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <MonthlyBars mois={evolutionMensuelle} />
          </div>
        )}

        {avancementPct !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <ProgressRing ratio={avancementPct / 100} taille={64} epaisseur={7} statut={avancementPct === 100 ? 'ok' : 'warning'} libelle={`Avancement ${anneeCourante} : ${avancementPct} %`} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>Avancement {anneeCourante}</div>
              <div className="muted">
                {piecesValideesAnnee.length} pièce(s) validée(s) sur {piecesAnnee.length} déposée(s) cette année.
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('checklist')}>
              Voir la vue d'ensemble
            </button>
          </div>
        )}
      </div>

      <input
        className="recherche"
        placeholder="Rechercher par numéro ou libellé de compte…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
        style={{ marginBottom: 14, width: 340 }}
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
