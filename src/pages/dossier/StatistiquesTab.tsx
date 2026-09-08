import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { calculerBalance } from '../../lib/ecritures'
import type { Categorie, EcritureBrouillon } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

// Balance des comptes — vue transversale sur tout le brouillon (voir EcrituresTab, qui ne montre le
// journal que ligne à ligne, pièce par pièce) : un compte par ligne, avec son nombre d'écritures et
// ses totaux débit/crédit, pour repérer d'un coup d'œil un solde anormal (une charge créditrice, un
// compte oublié...) sans dérouler tout le journal. Toujours calculée depuis le même brouillon que
// EcrituresTab, jamais une comptabilité tenue à part (voir BrouillonBanner ailleurs dans l'onglet
// Écritures — même statut ici, juste pas répété pour ne pas surcharger un onglet de lecture).
export default function StatistiquesTab({ dossierId }: { dossierId: string }) {
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('ecritures_brouillon').select('*').eq('dossier_id', dossierId),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
    ]).then(([{ data: ecrituresData }, { data: categoriesData }]) => {
      setEcritures(ecrituresData ?? [])
      setCategories(categoriesData ?? [])
      setLoading(false)
    })
  }, [dossierId])

  const anneesDisponibles = useMemo(
    () => [...new Set(ecritures.map((e) => new Date(e.date).getFullYear()))].sort((a, b) => b - a),
    [ecritures],
  )
  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => new Date(e.date).getFullYear() === anneeFilter)

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

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

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
