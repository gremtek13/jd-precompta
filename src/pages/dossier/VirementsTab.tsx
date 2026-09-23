import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, formatDate, formatMoney } from '../../lib/format'
import type { LigneBancaire } from '../../lib/types'
import AnneeTabs, { type ValeurAnnee } from '../../components/AnneeTabs'
import BarreRecherche from '../../components/BarreRecherche'
import { correspondALaRecherche } from '../../lib/recherche'
import { lireTout } from '../../lib/lectureComplete'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'

// Prélèvements de l'exploitant — virements du compte pro vers le compte personnel, marqués depuis
// l'onglet Banque (bouton "Virement personnel" sur un mouvement non rapproché). Une lecture seule ici :
// le marquage se fait à la source, sur le mouvement bancaire lui-même, pas de saisie indépendante
// possible puisqu'un virement personnel n'a par nature aucun justificatif à déposer.
export default function VirementsTab({ dossierId }: { dossierId: string }) {
  const [lignes, setLignes] = useState<LigneBancaire[]>([])
  const [loading, setLoading] = useState(true)
  const [anneeFilter, setAnneeFilter] = useState<ValeurAnnee>('toutes')
  const [recherche, setRecherche] = useState('')
  // Non nul quand la liste n'a pas pu être lue en entier — voir lib/lectureComplete.ts.
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    // Lue par tranches (voir lib/lectureComplete.ts) : cette liste est petite aujourd'hui, mais
    // elle porte un TOTAL — et un total calculé sur une lecture tronquée a l'air d'un total.
    const lecture = await lireTout<LigneBancaire>((debut, fin) =>
      supabase.from('lignes_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId)
        .eq('prelevement_personnel', true)
        .order('date', { ascending: false }).order('id').range(debut, fin),
    )
    setLignes(lecture.lignes)
    setLectureIncomplete(lecture.complete ? null : lecture.motif)
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function retirer(ligneId: string) {
    await supabase.from('lignes_bancaires').update({
      statut: 'non_rapprochee', prelevement_personnel: false,
    }).eq('id', ligneId)
    load()
  }

  const anneesDisponibles = [...new Set(lignes.map((l) => anneeDe(l.date)))].sort((a, b) => b - a)
  const filtered = anneeFilter === 'toutes' ? lignes : lignes.filter((l) => anneeDe(l.date) === anneeFilter)

  // La recherche ne filtre que les lignes affichées : le total prélevé ci-dessous reste celui de
  // l'année sélectionnée. Un « total » qui suivrait le texte tapé ne voudrait plus rien dire.
  const affichees = filtered.filter((l) =>
    correspondALaRecherche([l.libelle, l.montant, l.date, formatDate(l.date)], recherche),
  )
  // LE SIGNE SE PERD DANS LE TOTAL, ET NULLE PART AILLEURS. La ligne affiche `formatMoney(montant)`,
  // donc une entrée s'y voit ; le total, lui, sommait des VALEURS ABSOLUES. Or le bouton « Virement
  // personnel » de l'onglet Banque n'est borné par aucun signe, et c'est le seul qui nomme la
  // situation d'un mouvement venu du compte personnel — un apport marqué ainsi FAISAIT MONTER le
  // « Total prélevé » au lieu de le réduire, sous un libellé qui dit l'inverse.
  // On ne tranche PAS ce que le cabinet doit faire d'un apport (le distinguer vraiment serait une
  // décision produit, compte 108) : on l'écarte d'un total qui ne le désigne pas, et on le DIT.
  const prelevements = filtered.filter((l) => l.montant < 0)
  const apports = filtered.filter((l) => l.montant > 0)
  const total = prelevements.reduce((s, l) => s + Math.abs(l.montant), 0)
  const totalApports = apports.reduce((s, l) => s + l.montant, 0)

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les virements personnels"
        motif={lectureIncomplete}
        consequence="Le total ci-dessous porte donc sur une partie d’entre eux."
      />

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
          {/* Rendu seulement quand il apprend quelque chose — une mise en garde permanente cesse
              d'être lue, puis emporte ses voisines (voir `dotationsNonProratisees`). */}
          {apports.length > 0 && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0, color: 'var(--color-danger)' }}>
              {apports.length} mouvement(s) ENTRANT(s), pour {formatMoney(totalApports)}, ne sont pas
              comptés ci-dessus : un virement <em>vers</em> le compte pro est un apport, pas un
              prélèvement. Vérifie ce marquage dans l'onglet Banque.
            </p>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un libellé, un montant…"
          affiches={affichees.length}
          total={filtered.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : affichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun virement ne correspond à « ${recherche.trim()} ».`
              : "Aucun virement personnel marqué pour l'instant."}
          </div>
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
              {affichees.map((l) => (
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
