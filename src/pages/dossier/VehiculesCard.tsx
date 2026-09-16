import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatMoney } from '../../lib/format'
import { totalIndemnitesKilometriques, vehiculeDuDossier } from '../../lib/baremeKilometrique'
import type { TypeVehicule } from '../../lib/baremeKilometrique'
import type { VehiculeDossier } from '../../lib/types'
import { useAnnee } from '../../context/AnneeContext'

// Cadre 7 du 2035-B, « Barèmes kilométriques ». Sans ces lignes, la case BJ du 2035-A (ligne 23,
// frais de véhicules) reste vide alors que le bas du 2035-B dit « Total A à reporter ligne 23 de
// l'annexe 2035 A ».
//
// Le kilométrage est par EXERCICE, pas par véhicule : l'option pour le forfait se prend au 1er
// janvier et vaut pour l'année entière (notice 2035-NOT-SD, renvoi 12). Un même véhicule a donc une
// ligne par année, et l'écran suit l'exercice choisi en en-tête du dossier.

const TYPES: { valeur: TypeVehicule; libelle: string }[] = [
  { valeur: 'voiture', libelle: 'Voiture (tourisme)' },
  { valeur: 'moto', libelle: 'Moto (> 50 cm³)' },
  { valeur: 'cyclomoteur', libelle: 'Cyclomoteur (< 50 cm³)' },
]

const MOTORISATIONS = ['thermique', 'hydrogene', 'hybride', 'electrique'] as const
const CARBURANTS = ['diesel', 'super_sans_plomb', 'gpl'] as const

const LIBELLE_MOTORISATION: Record<(typeof MOTORISATIONS)[number], string> = {
  thermique: 'Thermique', hydrogene: 'À hydrogène', hybride: 'Hybride', electrique: 'Électrique',
}
const LIBELLE_CARBURANT: Record<(typeof CARBURANTS)[number], string> = {
  diesel: 'Diesel', super_sans_plomb: 'Super sans plomb', gpl: 'GPL',
}

export default function VehiculesCard({ dossierId }: { dossierId: string }) {
  const { annee } = useAnnee()
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)

  // L'exercice courant, ou l'année en cours quand l'en-tête affiche « toutes » — un kilométrage se
  // rattache forcément à une année précise.
  const exercice = typeof annee === 'number' ? annee : new Date().getFullYear()

  async function charger() {
    setChargement(true)
    const { data, error } = await supabase
      .from('vehicules').select('*').eq('dossier_id', dossierId).eq('annee', exercice)
      .order('created_at')
    if (error) setErreur(error.message)
    setVehicules(data ?? [])
    setChargement(false)
  }

  useEffect(() => { charger() }, [dossierId, exercice])

  // Verrou posé avant tout `await` : un double clic créerait deux véhicules vides.
  const ajoutEnCours = useRef(false)

  async function ajouter() {
    if (ajoutEnCours.current) return
    ajoutEnCours.current = true
    try {
      const { error } = await supabase.from('vehicules').insert({ dossier_id: dossierId, annee: exercice })
      if (error) { setErreur(error.message); return }
      setErreur(null)
      await charger()
    } finally {
      ajoutEnCours.current = false
    }
  }

  // Écriture immédiate sur changement de champ : une modale de plus pour six champs ferait perdre
  // plus de temps qu'elle n'en fait gagner. L'échec est dit, jamais avalé.
  async function modifier(id: string, champs: Partial<VehiculeDossier>) {
    setVehicules((v) => v.map((x) => (x.id === id ? { ...x, ...champs } : x)))
    const { error } = await supabase.from('vehicules').update(champs).eq('id', id)
    if (error) { setErreur(error.message); charger() } else setErreur(null)
  }

  async function supprimer(id: string) {
    const { error } = await supabase.from('vehicules').delete().eq('id', id)
    if (error) { setErreur(error.message); return }
    setErreur(null)
    await charger()
  }

  const { total, nonCalcules } = totalIndemnitesKilometriques(vehicules.map(vehiculeDuDossier), exercice)
  const baremeManquant = nonCalcules.some((n) => n.motif === 'barème non renseigné pour cet exercice')

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>Véhicules et barème kilométrique — exercice {exercice}</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Cadre 7 du 2035-B. Le total des indemnités se reporte ligne 23 du 2035-A (case BJ, frais de
        véhicules). Le kilométrage est propre à chaque exercice : l'option pour le forfait se prend
        au 1<sup>er</sup> janvier et vaut pour l'année entière.
      </p>

      {erreur && <p className="error-text">{erreur}</p>}

      {chargement ? (
        <p className="muted">Chargement…</p>
      ) : vehicules.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>
          Aucun véhicule déclaré sur cet exercice.
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Modèle</th>
                <th>Type</th>
                <th style={{ width: 90 }}>Puiss. fisc.</th>
                <th>Motorisation</th>
                <th>Carburant</th>
                <th style={{ width: 120 }}>Km pro</th>
                <th style={{ textAlign: 'right' }}>Indemnité</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vehicules.map((v) => {
                const indemnite = totalIndemnitesKilometriques([vehiculeDuDossier(v)], exercice)
                return (
                  <tr key={v.id}>
                    <td>
                      <input
                        value={v.modele ?? ''}
                        placeholder="ex. Peugeot 308"
                        onChange={(e) => modifier(v.id, { modele: e.target.value || null })}
                      />
                    </td>
                    <td>
                      <select value={v.type} onChange={(e) => modifier(v.id, { type: e.target.value as TypeVehicule })}>
                        {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number" min={0} max={99}
                        value={v.puissance_fiscale}
                        // Le cyclomoteur n'a pas de puissance fiscale au sens du barème.
                        disabled={v.type === 'cyclomoteur'}
                        onChange={(e) => modifier(v.id, { puissance_fiscale: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <select
                        value={v.motorisation ?? ''}
                        onChange={(e) => modifier(v.id, { motorisation: (e.target.value || null) as VehiculeDossier['motorisation'] })}
                      >
                        <option value="">—</option>
                        {MOTORISATIONS.map((m) => <option key={m} value={m}>{LIBELLE_MOTORISATION[m]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select
                        value={v.carburant ?? ''}
                        onChange={(e) => modifier(v.id, { carburant: (e.target.value || null) as VehiculeDossier['carburant'] })}
                      >
                        <option value="">—</option>
                        {CARBURANTS.map((c) => <option key={c} value={c}>{LIBELLE_CARBURANT[c]}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number" min={0}
                        value={v.km_professionnel}
                        onChange={(e) => modifier(v.id, { km_professionnel: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {indemnite.nonCalcules.length > 0
                        ? <span className="muted" title={indemnite.nonCalcules[0].motif}>—</span>
                        : formatMoney(indemnite.total)}
                    </td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => supprimer(v.id)}>Retirer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>
                  Total à reporter ligne 23 (case BJ)
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {baremeManquant ? '—' : formatMoney(total)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {baremeManquant && (
        // Dit franchement pourquoi rien n'est calculé, plutôt que d'afficher un zéro qui passerait
        // pour un montant. Un barème kilométrique est publié chaque année par l'administration ;
        // appliquer celui d'une autre année produirait une déduction fausse.
        <p style={{ color: 'var(--color-warning)', marginBottom: 0 }}>
          ⚠ Le barème kilométrique {exercice} n'est pas encore renseigné dans l'application : les
          kilomètres sont bien enregistrés, mais l'indemnité ne peut pas être calculée. Rien n'est
          reporté ligne 23 tant que le barème officiel n'a pas été saisi.
        </p>
      )}

      <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={ajouter}>
        + Ajouter un véhicule
      </button>
    </div>
  )
}
