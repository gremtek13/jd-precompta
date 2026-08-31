import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from '../../lib/types'
import BrouillonBanner from '../../components/BrouillonBanner'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

const POSTE_AMORTISSEMENTS = 'Amortissements'
const POSTE_COTISATIONS = 'Cotisations sociales personnelles'

// Palier 5, briques 5 et 6 réunies — postes de la 2035 et clôture brouillon. Regroupe et totalise
// par poste (recettes, achats, charges sociales, amortissements...) sans jamais calculer de
// résultat ou d'impôt : cette combinaison relève de règles BNC réelles (encaissements/décaissements,
// exercice de rattachement) que ce brouillon ne prétend pas maîtriser — voir le bandeau.
export default function ClotureTab({ dossierId }: { dossierId: string }) {
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [postesEdit, setPostesEdit] = useState<Record<string, string>>({})
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')

  async function load() {
    setLoading(true)
    const [{ data: categoriesData }, { data: piecesData }, { data: immobilisationsData }, { data: cotisationsData }] = await Promise.all([
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre'),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
    ])
    setCategories(categoriesData ?? [])
    setPieces(piecesData ?? [])
    setImmobilisations(immobilisationsData ?? [])
    setCotisations(cotisationsData ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null
  const immobilisationPieceIds = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))

  // Catégories utilisées par une pièce validée mais sans poste 2035 associé — le regroupement par
  // poste ignorera ces pièces tant que ce n'est pas renseigné.
  const categoriesSansPoste = categories.filter(
    (c) => !c.poste_2035 && pieces.some((p) => p.categorie_id === c.id),
  )

  async function savePoste(categorieId: string) {
    const valeur = (postesEdit[categorieId] ?? '').trim()
    if (!valeur) return
    const { error: saveError } = await supabase.from('categories').update({ poste_2035: valeur }).eq('id', categorieId)
    if (saveError) {
      setError(saveError.message)
      return
    }
    load()
  }

  // Un dossier est par client, pas par année : sans filtre, ce récapitulatif mélangerait tous les
  // exercices dans un seul total par poste — pas ce qu'on attend d'une clôture. "Toutes années" reste
  // disponible (utile pour un premier tour d'horizon) mais affiche un avertissement explicite.
  const anneesDisponibles = [...new Set([
    ...pieces.filter((p) => p.date_piece).map((p) => new Date(p.date_piece!).getFullYear()),
    ...cotisations.map((c) => new Date(c.echeance).getFullYear()),
    ...immobilisations.map((i) => new Date(i.date_acquisition).getFullYear()),
  ])].sort((a, b) => b - a)

  // Une pièce déjà enregistrée comme immobilisation est représentée par sa dotation annuelle (poste
  // Amortissements) plutôt que par son montant complet — même logique d'exclusion que l'onglet
  // Écritures, pour ne pas compter la dépense deux fois.
  const totauxParPoste = new Map<string, number>()
  for (const p of pieces) {
    if (immobilisationPieceIds.has(p.id)) continue
    if (anneeFilter !== 'toutes' && (!p.date_piece || new Date(p.date_piece).getFullYear() !== anneeFilter)) continue
    const cat = categorieById(p.categorie_id)
    if (!cat?.poste_2035) continue
    const montant = p.montant_ht ?? p.montant_ttc ?? 0
    const signe = p.type_piece === 'vente' ? 1 : -1
    totauxParPoste.set(cat.poste_2035, (totauxParPoste.get(cat.poste_2035) ?? 0) + signe * montant)
  }

  // La dotation d'une immobilisation compte pour chaque année de sa durée d'amortissement, pas
  // seulement l'année d'achat — filtrer par simple égalité d'année exclurait à tort les dotations des
  // années suivantes pour un bien acheté avant l'année sélectionnée.
  const totalAmortissements = immobilisations.reduce((sum, i) => {
    // "sans_date" n'est jamais utilisé sur cet onglet (AnneeTabs n'a pas sansDate ici) — seul "toutes"
    // demande le total non filtré, traité comme un cas particulier plutôt que deviné par le typage.
    if (typeof anneeFilter !== 'number') return sum + i.valeur / i.duree_annees
    const anneeAcquisition = new Date(i.date_acquisition).getFullYear()
    const dansLaDuree = anneeFilter >= anneeAcquisition && anneeFilter < anneeAcquisition + i.duree_annees
    return dansLaDuree ? sum + i.valeur / i.duree_annees : sum
  }, 0)
  if (totalAmortissements > 0) totauxParPoste.set(POSTE_AMORTISSEMENTS, -(totalAmortissements))

  const totalCotisations = cotisations.reduce((sum, c) => {
    if (anneeFilter !== 'toutes' && new Date(c.echeance).getFullYear() !== anneeFilter) return sum
    return sum + (c.montant_verse ?? c.montant_appele)
  }, 0)
  if (totalCotisations > 0) totauxParPoste.set(POSTE_COTISATIONS, -(totalCotisations))

  const lignes = [...totauxParPoste.entries()].sort((a, b) => b[1] - a[1])

  return (
    <>
      <BrouillonBanner />
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Regroupement des pièces validées par poste de la 2035, complété par les amortissements et les
        cotisations sociales versées. Un simple total par poste — pas un résultat ni un calcul d'impôt,
        ce travail reste celui de l'expert-comptable.
      </p>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {anneeFilter === 'toutes' && anneesDisponibles.length > 1 && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 20, color: 'var(--color-warning)' }}>
          ⚠ Plusieurs exercices ({anneesDisponibles.join(', ')}) sont mélangés dans ce total — sélectionne
          une année ci-dessus pour un vrai total de clôture.
        </p>
      )}

      {categoriesSansPoste.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Postes manquants</h3>
          <p className="muted" style={{ marginTop: -8 }}>
            Ces catégories sont utilisées par des pièces validées mais n'ont pas encore de poste 2035
            associé — leurs montants ne sont pas comptés dans le récapitulatif tant que ce n'est pas fait.
          </p>
          <table>
            <thead><tr><th>Catégorie</th><th>Poste 2035</th><th></th></tr></thead>
            <tbody>
              {categoriesSansPoste.map((c) => (
                <tr key={c.id}>
                  <td>{c.libelle}</td>
                  <td>
                    <input
                      style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '5px 8px', width: 220 }}
                      placeholder="ex. Achats, Loyers, Recettes..."
                      value={postesEdit[c.id] ?? ''}
                      onChange={(e) => setPostesEdit((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  </td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => savePoste(c.id)}>Enregistrer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : lignes.length === 0 ? (
          <div className="empty-state">Rien à regrouper pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Poste 2035</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map(([poste, total]) => (
                <tr key={poste}>
                  <td>{poste}</td>
                  <td>{formatMoney(total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
