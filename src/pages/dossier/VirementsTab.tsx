import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import type { LigneBancaire } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'

// Prélèvements de l'exploitant — virements du compte pro vers le compte personnel, marqués depuis
// l'onglet Banque (bouton "Virement personnel" sur un mouvement non rapproché). Une lecture seule ici :
// le marquage se fait à la source, sur le mouvement bancaire lui-même, pas de saisie indépendante
// possible puisqu'un virement personnel n'a par nature aucun justificatif à déposer.
export default function VirementsTab({ dossierId }: { dossierId: string }) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('lignes_bancaires')
      .select('*')
      .eq('dossier_id', dossierId)
      .eq('prelevement_personnel', true)
      .order('date', { ascending: false })
    setLignes(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function retirer(ligneId: string) {
    await supabase.from('lignes_bancaires').update({
      statut: 'non_rapprochee', prelevement_personnel: false,
    }).eq('id', ligneId)
    load()
  }

  const anneesDisponibles = [...new Set(lignes.map((l) => new Date(l.date).getFullYear()))].sort((a, b) => b - a)
  const filtered = anneeFilter === 'toutes' ? lignes : lignes.filter((l) => new Date(l.date).getFullYear() === anneeFilter)
  const total = filtered.reduce((s, l) => s + Math.abs(l.montant), 0)

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Virements du compte pro vers le compte personnel — pas des charges, exclus des totaux par poste
        de l'onglet Clôture. Un mouvement se marque comme tel depuis l'onglet Banque ("Virement
        personnel" sur une ligne non rapprochée) ; retire-le ici s'il faut revenir en arrière.
      </p>

      <AnneeTabs annees={anneesDisponibles} valeur={anneeFilter} onChange={setAnneeFilter} />

      {filtered.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <span className="muted" style={{ display: 'block' }}>Total prélevé{anneeFilter !== 'toutes' ? ` en ${anneeFilter}` : ''}</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(total)}</strong>
        </div>
      )}

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Aucun virement personnel marqué pour l'instant.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Montant</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.date)}</td>
                  <td>{l.libelle}</td>
                  <td>{formatMoney(l.montant)}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => retirer(l.id)}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
