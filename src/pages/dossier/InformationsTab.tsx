import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { generatePack } from '../../lib/packGenerator'
import { supprimerDossierDefinitivement } from '../../lib/suppressionDossier'
import ConfirmationSuppression from '../../components/ConfirmationSuppression'
import type { VehiculeType } from '../../lib/types'

// Informations déclaratives saisies une fois par le cabinet (ou récupérées auprès du client) plutôt
// que déduites d'un document — un type de véhicule ou l'existence de tickets-restaurant ne se lit pas
// de manière fiable dans un relevé bancaire. Alimentent la Checklist (justificatifs à obtenir) et,
// plus tard, le calcul des paniers repas (jours_travailles_an).
//
// Porte aussi la "zone dangereuse" du dossier (export puis suppression définitive) — pas un onglet à
// part : une action aussi rare mérite d'être au bout du même écran de réglages plutôt que de justifier
// sa propre entrée de menu.
//
// SIRET/adresse (identité légale du dossier) : jusqu'ici saisis uniquement à la création du dossier
// (voir DossiersList), sans aucun moyen de les corriger ensuite — un vrai manque, découvert quand un
// SIRET manquant a bloqué une émission Super PDP sans qu'il y ait où le renseigner après coup. Vivent
// ici plutôt que dans "Informations du client" ci-dessous (données déclaratives différentes, propre
// table `informations_dossier`) : siret/adresse sont des colonnes de `dossiers` lui-même.
interface Props {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  onIdentiteUpdated: (siret: string | null, adresse: string | null) => void
}

export default function InformationsTab({ dossierId, dossierNom, dossierSiret, dossierAdresse, onIdentiteUpdated }: Props) {
  const { estChef } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [siret, setSiret] = useState(dossierSiret ?? '')
  const [adresse, setAdresse] = useState(dossierAdresse ?? '')
  const [savingIdentite, setSavingIdentite] = useState(false)
  const [erreurIdentite, setErreurIdentite] = useState<string | null>(null)
  const [identiteEnregistree, setIdentiteEnregistree] = useState(false)

  const [exportEnCours, setExportEnCours] = useState(false)
  const [exportErreur, setExportErreur] = useState<string | null>(null)
  const [confirmerSuppression, setConfirmerSuppression] = useState(false)
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [suppressionErreur, setSuppressionErreur] = useState<string | null>(null)

  const [vehiculeType, setVehiculeType] = useState<VehiculeType>('aucun')
  const [vehiculeLibelle, setVehiculeLibelle] = useState('')
  const [joursTravailles, setJoursTravailles] = useState('')
  const [ticketsRestaurant, setTicketsRestaurant] = useState(false)
  const [chequesVacances, setChequesVacances] = useState(false)
  const [notes, setNotes] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('informations_dossier').select('*').eq('dossier_id', dossierId).maybeSingle()
    if (data) {
      setVehiculeType(data.vehicule_type)
      setVehiculeLibelle(data.vehicule_libelle ?? '')
      setJoursTravailles(data.jours_travailles_an != null ? String(data.jours_travailles_an) : '')
      setTicketsRestaurant(data.tickets_restaurant)
      setChequesVacances(data.cheques_vacances)
      setNotes(data.notes ?? '')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [dossierId])

  async function enregistrerIdentite(e: FormEvent) {
    e.preventDefault()
    setSavingIdentite(true)
    setErreurIdentite(null)
    setIdentiteEnregistree(false)
    const siretNettoye = siret.trim() || null
    const adresseNettoyee = adresse.trim() || null
    const { error: updateError } = await supabase.from('dossiers').update({ siret: siretNettoye, adresse: adresseNettoyee }).eq('id', dossierId)
    setSavingIdentite(false)
    if (updateError) {
      setErreurIdentite(updateError.message)
      return
    }
    setIdentiteEnregistree(true)
    onIdentiteUpdated(siretNettoye, adresseNettoyee)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload = {
        dossier_id: dossierId,
        vehicule_type: vehiculeType,
        vehicule_libelle: vehiculeType === 'aucun' ? null : (vehiculeLibelle.trim() || null),
        jours_travailles_an: joursTravailles ? parseInt(joursTravailles, 10) : null,
        tickets_restaurant: ticketsRestaurant,
        cheques_vacances: chequesVacances,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      }
      // Upsert sur dossier_id (contrainte unique en base) : une seule ligne d'informations par
      // dossier, qu'elle existe déjà ou non.
      const { error: upsertError } = await supabase.from('informations_dossier').upsert(payload, { onConflict: 'dossier_id' })
      if (upsertError) throw upsertError
      setSaved(true)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  // Export "clôture" : un pack complet (ZIP des pièces + Excel récap), sur toute l'histoire du
  // dossier plutôt qu'une période choisie — même mécanisme que l'onglet Packs (voir packGenerator),
  // juste avec une plage assez large pour tout couvrir. Comme les packs périodiques, ne reprend que
  // les pièces validées ayant une date renseignée (limite déjà connue de generatePack, pas nouvelle
  // ici) — pense à valider les pièces en attente avant de l'utiliser en vue d'une suppression.
  async function exporterAvantSuppression() {
    setExportEnCours(true)
    setExportErreur(null)
    try {
      const periodeDebut = '2000-01-01'
      const periodeFin = new Date().toISOString().slice(0, 10)
      const { nbPieces, storagePathZip, storagePathExcel, totalTtc } = await generatePack(dossierId, dossierNom, periodeDebut, periodeFin)
      if (nbPieces === 0) {
        setExportErreur("Aucune pièce validée à exporter sur ce dossier (les pièces sans date ne sont jamais incluses dans un pack).")
        return
      }
      const { data: userData } = await supabase.auth.getUser()
      await supabase.from('packs').insert({
        dossier_id: dossierId, periode_debut: periodeDebut, periode_fin: periodeFin,
        generated_by: userData.user!.id, storage_path_zip: storagePathZip, storage_path_excel: storagePathExcel,
        nb_pieces: nbPieces, total_ttc: totalTtc,
      })
      const { data: signed } = await supabase.storage.from('packs').createSignedUrl(storagePathZip, 60)
      if (signed) window.open(signed.signedUrl, '_blank')
    } catch (err) {
      setExportErreur(err instanceof Error ? err.message : "L'export a échoué.")
    } finally {
      setExportEnCours(false)
    }
  }

  async function confirmerEtSupprimer() {
    setSuppressionEnCours(true)
    setSuppressionErreur(null)
    try {
      await supprimerDossierDefinitivement(dossierId)
      navigate('/dossiers')
    } catch (err) {
      setSuppressionErreur(err instanceof Error ? err.message : 'La suppression a échoué.')
      setSuppressionEnCours(false)
    }
  }

  if (loading) return <p className="muted">Chargement…</p>

  return (
    <>
    <div className="card" style={{ maxWidth: 640, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Identité du dossier</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        SIRET et adresse de "{dossierNom}" — repris automatiquement sur chaque nouvelle facture émise
        et requis pour la transmettre via Super PDP.
      </p>
      <form onSubmit={enregistrerIdentite}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="identite-siret">SIRET</label>
            <input id="identite-siret" value={siret} onChange={(e) => setSiret(e.target.value)} placeholder="14 chiffres" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="identite-adresse">Adresse</label>
          <textarea id="identite-adresse" rows={2} value={adresse} onChange={(e) => setAdresse(e.target.value)} />
        </div>
        {erreurIdentite && <p className="error-text">{erreurIdentite}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={savingIdentite}>
            {savingIdentite ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {identiteEnregistree && <span className="muted">Enregistré ✓</span>}
        </div>
      </form>
    </div>

    <div className="card" style={{ maxWidth: 640 }}>
      <h3 style={{ marginTop: 0 }}>Informations du client</h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Renseigné une fois, rarement modifié — sert à savoir quels justificatifs demander (voir la Checklist)
        et plus tard au calcul des paniers repas.
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
            Tickets restaurant
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={chequesVacances} onChange={(e) => setChequesVacances(e.target.checked)} style={{ marginRight: 6 }} />
            Chèques vacances
          </label>
        </div>

        <div className="field">
          <label htmlFor="notes">Autres informations (mutuelle, local professionnel…)</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error && <p className="error-text">{error}</p>}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {saved && <span className="muted">Enregistré ✓</span>}
        </div>
      </form>
    </div>

    <div className="card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        Zone dangereuse <span className="badge badge-danger">irréversible</span>
      </h3>
      <p className="muted" style={{ marginTop: -8 }}>
        Exporte un pack complet (toutes les pièces validées, du début à aujourd'hui) avant de
        supprimer ce dossier si tu comptes archiver le dossier en clôture — la suppression retire
        aussi définitivement toutes les écritures, immobilisations, factures et accès client rattachés,
        et rien de tout ça n'est récupérable ensuite.
      </p>
      {exportErreur && <p className="error-text">{exportErreur}</p>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={exporterAvantSuppression} disabled={exportEnCours}>
          {exportEnCours ? 'Export…' : 'Exporter avant suppression'}
        </button>
        {estChef && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmerSuppression(true)}>
            Supprimer ce dossier définitivement
          </button>
        )}
      </div>
      {!estChef && (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Seul un comptable en chef peut supprimer un dossier.
        </p>
      )}
    </div>

    {confirmerSuppression && (
      <ConfirmationSuppression
        titre="Supprimer ce dossier"
        description={`Cette action supprime définitivement "${dossierNom}" et tout ce qui lui est rattaché (pièces, écritures, immobilisations, factures, accès client...). Elle est irréversible.`}
        nomAttendu={dossierNom}
        boutonLabel="Supprimer définitivement"
        enCours={suppressionEnCours}
        erreur={suppressionErreur}
        onConfirmer={confirmerEtSupprimer}
        onAnnuler={() => { setConfirmerSuppression(false); setSuppressionErreur(null) }}
      />
    )}
    </>
  )
}
