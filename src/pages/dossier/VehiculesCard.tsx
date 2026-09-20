import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { formatMoney } from '../../lib/format'
import {
  carburantApplicable, completerModificationVehicule, exercicesProposables,
  totalIndemnitesKilometriques, vehiculeDuDossier,
} from '../../lib/baremeKilometrique'
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
//
// Quand l'en-tête est sur « toutes années », l'écran ne saisit RIEN et propose de choisir. Il
// retombait auparavant sur l'année civile en cours : des kilomètres partaient alors sur un exercice
// que personne n'avait demandé, et l'indemnité revenait en « barème non renseigné » sans que le lien
// avec l'année soit visible. C'est le cas qui a fait perdre du temps en production.

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
  const { annee, setAnnee } = useAnnee()
  const [vehicules, setVehicules] = useState<VehiculeDossier[]>([])
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)

  // Null quand l'en-tête est sur « toutes années » : un kilométrage se rattache forcément à un
  // exercice précis, et la carte n'en choisit PAS un à la place de l'utilisateur. Elle retombait
  // auparavant sur l'année civile en cours — elle enregistrait alors des kilomètres sur un exercice
  // que personne n'avait demandé, et l'indemnité repartait en « barème non renseigné » sans que le
  // lien avec l'année saute aux yeux.
  const exercice = typeof annee === 'number' ? annee : null

  // Tous les exercices du dossier en une requête, filtrés ensuite en mémoire : quelques véhicules par
  // dossier, et cela donne gratuitement la liste des exercices déjà pourvus, qu'il faut de toute
  // façon proposer.
  async function charger() {
    setChargement(true)
    // Tri TOTAL : ni `annee` ni `created_at` ne sont uniques, donc `id` départage.
    const lecture = await lireTout<VehiculeDossier>((debut, fin) =>
      supabase.from('vehicules').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('annee', { ascending: false }).order('created_at').order('id').range(debut, fin),
    )
    if (!lecture.complete) setErreur(`Liste des véhicules incomplète : ${lecture.motif}`)
    setVehicules(lecture.lignes)
    setChargement(false)
  }

  useEffect(() => { charger() }, [dossierId])

  const vehiculesDeLExercice = vehicules.filter((v) => v.annee === exercice)
  const anneesAvecVehicules = [...new Set(vehicules.map((v) => v.annee))]
  const exercicesAuChoix = exercicesProposables(anneesAvecVehicules)
  const nbVehiculesDe = (a: number) => vehicules.filter((v) => v.annee === a).length

  // Verrou posé avant tout `await` : un double clic créerait deux véhicules vides.
  const ajoutEnCours = useRef(false)

  async function ajouter() {
    if (exercice === null || ajoutEnCours.current) return
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
  async function modifier(id: string, demande: Partial<VehiculeDossier>) {
    // Passe systématiquement par la règle de cohérence : un champ devenu sans objet est remis à zéro
    // dans la MÊME écriture (voir completerModificationVehicule). Le faire ici plutôt qu'au cas par cas
    // dans chaque `onChange` garantit qu'aucun champ ajouté plus tard n'y échappera par oubli.
    const champs = completerModificationVehicule(demande)
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

  const { total, nonCalcules } = exercice === null
    ? { total: 0, nonCalcules: [] }
    : totalIndemnitesKilometriques(vehiculesDeLExercice.map(vehiculeDuDossier), exercice)
  const baremeManquant = nonCalcules.some((n) => n.motif === 'barème non renseigné pour cet exercice')

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h3 style={{ marginTop: 0 }}>
        Véhicules et barème kilométrique{exercice !== null && ` — exercice ${exercice}`}
      </h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Cadre 7 du 2035-B. Le total des indemnités se reporte ligne 23 du 2035-A (case BJ, frais de
        véhicules). Le kilométrage est propre à chaque exercice : l'option pour le forfait se prend
        au 1<sup>er</sup> janvier et vaut pour l'année entière.
      </p>

      {erreur && <p className="error-text">{erreur}</p>}

      {chargement ? (
        <p className="muted">Chargement…</p>
      ) : exercice === null ? (
        /* L'en-tête du dossier est sur « toutes années ». La carte ne choisit PAS un exercice à la
           place de l'utilisateur : des kilomètres enregistrés sur une année que personne n'a
           demandée sont une donnée fausse, et le calcul qui échoue derrière ne dit pas pourquoi.
           Les exercices sont proposés ici même plutôt que par un renvoi vers l'en-tête — le choix se
           fait là où la question se pose. */
        <div style={{ padding: '4px 0 8px' }}>
          <p style={{ marginTop: 0 }}>
            Choisis l'exercice à renseigner : un kilométrage se rattache à une année précise, et
            l'option pour le forfait vaut pour l'année entière.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {exercicesAuChoix.map((a) => (
              <button key={a} className="btn btn-outline btn-sm" onClick={() => setAnnee(a)}>
                {a}
                {nbVehiculesDe(a) > 0 && (
                  <span className="muted" style={{ marginLeft: 6 }}>
                    · {nbVehiculesDe(a)} véhicule{nbVehiculesDe(a) > 1 ? 's' : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
          {anneesAvecVehicules.length === 0 && (
            <p className="muted" style={{ marginBottom: 0, marginTop: 10, fontSize: '0.85rem' }}>
              Aucun véhicule déclaré sur ce dossier, quel que soit l'exercice.
            </p>
          )}
        </div>
      ) : vehiculesDeLExercice.length === 0 ? (
        <div className="empty-state" style={{ padding: 16 }}>
          Aucun véhicule déclaré sur l'exercice {exercice}.
          {anneesAvecVehicules.length > 0 && (
            /* Dit où sont les véhicules plutôt que de laisser croire que le dossier n'en a aucun :
               c'est exactement la confusion qui fait ressaisir des kilomètres déjà enregistrés. */
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <span className="muted">Déjà renseignés sur :</span>
              {anneesAvecVehicules.map((a) => (
                <button key={a} className="btn btn-outline btn-sm" onClick={() => setAnnee(a)}>
                  {a} · {nbVehiculesDe(a)}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          {/* `table-formulaire` : une ligne de ce tableau est un FORMULAIRE, pas une donnée à lire.
              Sur téléphone, elle se replie en fiche empilée libellé/champ plutôt que de se comprimer
              — voir index.css. */}
          <table className="table-formulaire">
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
              {vehiculesDeLExercice.map((v) => {
                const indemnite = totalIndemnitesKilometriques([vehiculeDuDossier(v)], exercice)
                return (
                  <tr key={v.id}>
                    <td data-libelle="Modèle">
                      <input
                        value={v.modele ?? ''}
                        placeholder="ex. Peugeot 308"
                        onChange={(e) => modifier(v.id, { modele: e.target.value || null })}
                      />
                    </td>
                    <td data-libelle="Type">
                      <select value={v.type} onChange={(e) => modifier(v.id, { type: e.target.value as TypeVehicule })}>
                        {TYPES.map((t) => <option key={t.valeur} value={t.valeur}>{t.libelle}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Puiss. fisc.">
                      <input
                        type="number" min={0} max={99}
                        value={v.puissance_fiscale}
                        // Le cyclomoteur n'a pas de puissance fiscale au sens du barème.
                        disabled={v.type === 'cyclomoteur'}
                        onChange={(e) => modifier(v.id, { puissance_fiscale: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td data-libelle="Motorisation">
                      <select
                        value={v.motorisation ?? ''}
                        onChange={(e) => modifier(v.id, { motorisation: (e.target.value || null) as VehiculeDossier['motorisation'] })}
                      >
                        <option value="">—</option>
                        {MOTORISATIONS.map((m) => <option key={m} value={m}>{LIBELLE_MOTORISATION[m]}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Carburant">
                      <select
                        value={v.carburant ?? ''}
                        // Un véhicule électrique ou à hydrogène ne consomme aucun des carburants du
                        // formulaire : le champ est grisé plutôt que masqué, parce que la colonne
                        // existe sur le 2035-B et qu'une colonne absente passerait pour un oubli.
                        disabled={!carburantApplicable(v.motorisation)}
                        title={carburantApplicable(v.motorisation) ? undefined : 'Sans objet pour cette motorisation'}
                        onChange={(e) => modifier(v.id, { carburant: (e.target.value || null) as VehiculeDossier['carburant'] })}
                      >
                        <option value="">{carburantApplicable(v.motorisation) ? '—' : 'Sans objet'}</option>
                        {CARBURANTS.map((c) => <option key={c} value={c}>{LIBELLE_CARBURANT[c]}</option>)}
                      </select>
                    </td>
                    <td data-libelle="Km pro">
                      <input
                        type="number" min={0}
                        value={v.km_professionnel}
                        onChange={(e) => modifier(v.id, { km_professionnel: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td data-libelle="Indemnité" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {indemnite.nonCalcules.length > 0
                        ? <span className="muted" title={indemnite.nonCalcules[0].motif}>—</span>
                        : formatMoney(indemnite.total)}
                    </td>
                    <td className="td-action">
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
                <td data-libelle="Total ligne 23 (case BJ)" style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {baremeManquant ? '—' : formatMoney(total)}
                </td>
                <td className="td-action"></td>
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

      {/* Rien à ajouter tant qu'aucun exercice n'est choisi : le véhicule serait rattaché à une année
          devinée. Le bouton disparaît plutôt que d'être grisé — grisé, il laisserait chercher ce qui
          le débloque, alors que la réponse est juste au-dessus. */}
      {exercice !== null && (
        <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={ajouter}>
          + Ajouter un véhicule sur {exercice}
        </button>
      )}
    </div>
  )
}
