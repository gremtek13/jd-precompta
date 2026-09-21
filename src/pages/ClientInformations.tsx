import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../context/AuthContext'
import type { VehiculeType } from '../lib/types'
import { messageErreur } from '../lib/messageErreur'
import { chargerInformationsDossier, enregistrerInformationsDossier } from '../lib/informationsDossier'

// Version client du même formulaire que InformationsTab (cabinet) — mêmes champs, même table
// (informations_dossier, upsert sur dossier_id), juste un texte adapté à quelqu'un qui n'est pas
// comptable. Le client peut renseigner directement plutôt que de passer par un aller-retour avec le
// cabinet ; ce dernier garde la main dessus depuis son propre onglet Informations si besoin d'ajuster.
export default function ClientInformations() {
  const { dossierActifId } = useAuth()
  const dossierId = dossierActifId
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [vehiculeType, setVehiculeType] = useState<VehiculeType>('aucun')
  const [vehiculeLibelle, setVehiculeLibelle] = useState('')
  const [joursTravailles, setJoursTravailles] = useState('')
  const [ticketsRestaurant, setTicketsRestaurant] = useState(false)
  const [chequesVacances, setChequesVacances] = useState(false)
  const [notes, setNotes] = useState('')
  // Jumeau du cabinet : « on n'a pas pu lire » et « il n'y a rien à lire » donnent le même formulaire
  // vide, et l'enregistrement porte TOUS les champs (voir lib/informationsDossier.ts).
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)

  async function load() {
    if (!dossierId) return
    setLoading(true)
    const { informations, erreur } = await chargerInformationsDossier(dossierId)
    setErreurChargement(erreur)
    if (informations) {
      setVehiculeType(informations.vehicule_type)
      setVehiculeLibelle(informations.vehicule_libelle ?? '')
      setJoursTravailles(informations.jours_travailles_an != null ? String(informations.jours_travailles_an) : '')
      setTicketsRestaurant(informations.tickets_restaurant)
      setChequesVacances(informations.cheques_vacances)
      setNotes(informations.notes ?? '')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!dossierId) return
    // Enregistrer ce qu'on n'a pas su lire, c'est l'effacer. Seconde ceinture : le bouton est grisé.
    if (erreurChargement) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const erreur = await enregistrerInformationsDossier(dossierId, {
        vehiculeType, vehiculeLibelle, joursTravailles, ticketsRestaurant, chequesVacances, notes,
      })
      if (erreur) {
        setError(erreur)
        return
      }
      setSaved(true)
      load()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      setSaving(false)
    }
  }

  if (!dossierId) {
    return <p className="muted">Aucun dossier ne t'est encore rattaché — contacte JD Consult.</p>
  }

  return (
    <>
      <div className="topbar"><h1>Mes informations</h1></div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <div className="card" style={{ maxWidth: 640 }}>
          <p className="muted" style={{ marginTop: -4 }}>
            À renseigner une fois, tu pourras revenir modifier plus tard si ça change — ça aide le cabinet
            à savoir quels justificatifs te demander.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="vehiculeType">Véhicule</label>
                <select id="vehiculeType" value={vehiculeType} onChange={(e) => setVehiculeType(e.target.value as VehiculeType)}>
                  <option value="aucun">Aucun</option>
                  <option value="personnel_ik">Personnel — indemnités kilométriques (IK)</option>
                  <option value="societe">Véhicule de société</option>
                </select>
              </div>
              {vehiculeType !== 'aucun' && (
                <div className="field">
                  <label htmlFor="vehiculeLibelle">Véhicule (modèle)</label>
                  <input id="vehiculeLibelle" value={vehiculeLibelle} onChange={(e) => setVehiculeLibelle(e.target.value)} placeholder="ex. Peugeot 308" />
                </div>
              )}
            </div>

            <div className="field">
              <label htmlFor="jours">Jours travaillés dans l'année</label>
              <input id="jours" type="number" min={0} max={366} value={joursTravailles} onChange={(e) => setJoursTravailles(e.target.value)} style={{ maxWidth: 140 }} />
            </div>

            <div className="field">
              <label>
                <input type="checkbox" checked={ticketsRestaurant} onChange={(e) => setTicketsRestaurant(e.target.checked)} style={{ marginRight: 6 }} />
                J'ai des tickets restaurant
              </label>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={chequesVacances} onChange={(e) => setChequesVacances(e.target.checked)} style={{ marginRight: 6 }} />
                J'ai des chèques vacances
              </label>
            </div>

            <div className="field">
              <label htmlFor="notes">Autres informations utiles (mutuelle, local professionnel…)</label>
              <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {erreurChargement && (
              <p className="error-text">
                {erreurChargement} Tes réponses n'ont pas pu être chargées : le formulaire est
                peut-être vide alors que tu avais déjà répondu, et enregistrer maintenant effacerait
                ce que tu avais mis. Recharge la page avant de modifier quoi que ce soit.
              </p>
            )}
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn btn-primary" type="submit" disabled={saving || erreurChargement !== null}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              {saved && <span className="muted">Enregistré ✓</span>}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
