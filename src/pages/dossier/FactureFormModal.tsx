import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { attribuerNumeroFacture, calculerLigne, calculerTotaux, mentionsLegalesParDefaut } from '../../lib/factures'
import { formatMoney } from '../../lib/format'
import type { FactureEmise, FactureLigne } from '../../lib/types'

interface LigneEdit {
  id?: string // absent = ligne pas encore enregistrée
  designation: string
  quantite: string
  prix_unitaire_ht: string
  taux_tva: string
}

function ligneVide(): LigneEdit {
  return { designation: '', quantite: '1', prix_unitaire_ht: '', taux_tva: '0' }
}

interface Props {
  dossierId: string
  dossierNom: string
  dossierSiret: string | null
  dossierAdresse: string | null
  assujettiTva: boolean
  facture: FactureEmise | null // null = nouvelle facture ; jamais une facture déjà validée (voir FacturesTab)
  onAdresseUpdated: (adresse: string) => void
  onClose: () => void
  onSaved: () => void
}

// Formulaire de brouillon de facture — jamais ouvert sur une facture déjà validée (voir FacturesTab,
// qui ouvre FactureApercu à la place dans ce cas) : toute la logique ici suppose qu'on peut encore
// tout modifier librement. "Valider" attribue le numéro définitif (voir lib/factures.ts) et ferme la
// possibilité de reéditer — geste volontairement séparé d'un simple enregistrement de brouillon.
export default function FactureFormModal({ dossierId, dossierNom, dossierSiret, dossierAdresse, assujettiTva, facture, onAdresseUpdated, onClose, onSaved }: Props) {
  const [tiersNom, setTiersNom] = useState(facture?.tiers_nom ?? '')
  const [tiersAdresse, setTiersAdresse] = useState(facture?.tiers_adresse ?? '')
  const [tiersSiret, setTiersSiret] = useState(facture?.tiers_siret ?? '')
  const [dateEmission, setDateEmission] = useState(facture?.date_emission ?? new Date().toISOString().slice(0, 10))
  const [dateEcheance, setDateEcheance] = useState(facture?.date_echeance ?? '')
  const [notes, setNotes] = useState(facture?.notes ?? '')
  const [mentionsLegales, setMentionsLegales] = useState(facture?.mentions_legales ?? mentionsLegalesParDefaut(assujettiTva))
  const [emetteurAdresse, setEmetteurAdresse] = useState(facture?.emetteur_adresse ?? dossierAdresse ?? '')
  const [enregistrerAdresseDossier, setEnregistrerAdresseDossier] = useState(false)
  const [lignes, setLignes] = useState<LigneEdit[]>([ligneVide()])
  const [chargementLignes, setChargementLignes] = useState(!!facture)
  const [saving, setSaving] = useState<'brouillon' | 'validation' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!facture) return
    supabase.from('facture_lignes').select('*').eq('facture_id', facture.id).order('ordre').then(({ data }) => {
      const l = (data ?? []) as FactureLigne[]
      setLignes(l.length > 0
        ? l.map((x) => ({ id: x.id, designation: x.designation, quantite: String(x.quantite), prix_unitaire_ht: String(x.prix_unitaire_ht), taux_tva: String(x.taux_tva) }))
        : [ligneVide()])
      setChargementLignes(false)
    })
  }, [facture])

  function majLigne(index: number, patch: Partial<LigneEdit>) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function ajouterLigne() {
    setLignes((prev) => [...prev, ligneVide()])
  }
  function retirerLigne(index: number) {
    setLignes((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  const lignesNumeriques = lignes.map((l) => ({
    designation: l.designation,
    quantite: parseFloat(l.quantite) || 0,
    prix_unitaire_ht: parseFloat(l.prix_unitaire_ht) || 0,
    taux_tva: parseFloat(l.taux_tva) || 0,
  }))
  const totaux = calculerTotaux(lignesNumeriques)
  const lignesValides = lignesNumeriques.filter((l) => l.designation.trim() && l.quantite > 0)

  async function enregistrer(statutCible: 'brouillon' | 'validee') {
    if (!tiersNom.trim()) {
      setError('Le nom du client est obligatoire.')
      return
    }
    if (lignesValides.length === 0) {
      setError('Ajoute au moins une ligne avec une désignation et une quantité.')
      return
    }
    setSaving(statutCible === 'validee' ? 'validation' : 'brouillon')
    setError(null)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const payloadFacture = {
        dossier_id: dossierId,
        tiers_nom: tiersNom.trim(),
        tiers_adresse: tiersAdresse.trim() || null,
        tiers_siret: tiersSiret.trim() || null,
        date_emission: dateEmission,
        date_echeance: dateEcheance || null,
        notes: notes.trim() || null,
        mentions_legales: mentionsLegales.trim() || null,
        emetteur_nom: dossierNom || null,
        emetteur_siret: dossierSiret || null,
        emetteur_adresse: emetteurAdresse.trim() || null,
        montant_ht: totaux.montant_ht,
        montant_tva: totaux.montant_tva,
        montant_ttc: totaux.montant_ttc,
      }

      let factureId = facture?.id
      if (factureId) {
        const { error: updateError } = await supabase.from('factures_emises').update(payloadFacture).eq('id', factureId)
        if (updateError) throw updateError
        // Remplacement complet des lignes plutôt qu'un diff ligne à ligne — une facture a rarement plus
        // de quelques lignes, la complexité d'un vrai diff n'apporterait rien ici.
        await supabase.from('facture_lignes').delete().eq('facture_id', factureId)
      } else {
        const { data: inserted, error: insertError } = await supabase.from('factures_emises')
          .insert({ ...payloadFacture, created_by: userData.user?.id ?? null })
          .select().single()
        if (insertError) throw insertError
        factureId = inserted.id
      }

      const { error: lignesError } = await supabase.from('facture_lignes').insert(
        lignesValides.map((l, i) => ({ facture_id: factureId, ordre: i, ...l })),
      )
      if (lignesError) throw lignesError

      if (enregistrerAdresseDossier && emetteurAdresse.trim()) {
        const { error: adresseError } = await supabase.from('dossiers').update({ adresse: emetteurAdresse.trim() }).eq('id', dossierId)
        if (!adresseError) onAdresseUpdated(emetteurAdresse.trim())
      }

      if (statutCible === 'validee') {
        const numero = await attribuerNumeroFacture(dossierId, dateEmission)
        const { error: validationError } = await supabase.from('factures_emises')
          .update({ statut: 'validee', numero, validated_at: new Date().toISOString() })
          .eq('id', factureId)
        if (validationError) throw validationError
      }

      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(null)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    enregistrer('brouillon')
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>{facture ? 'Modifier le brouillon' : 'Nouvelle facture'}</h2>
        {chargementLignes ? (
          <p className="muted">Chargement…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="emetteur-adresse">Adresse de l'émetteur ({dossierNom}{dossierSiret ? ` — SIRET ${dossierSiret}` : ''})</label>
              <textarea id="emetteur-adresse" rows={2} value={emetteurAdresse} onChange={(e) => setEmetteurAdresse(e.target.value)} placeholder="Numéro, rue, code postal, ville" />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontWeight: 400 }}>
                <input type="checkbox" checked={enregistrerAdresseDossier} onChange={(e) => setEnregistrerAdresseDossier(e.target.checked)} />
                <span className="muted" style={{ fontSize: '0.8rem' }}>Enregistrer comme adresse du dossier (proposée par défaut la prochaine fois)</span>
              </label>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="tiers-nom">Client</label>
                <input id="tiers-nom" required value={tiersNom} onChange={(e) => setTiersNom(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="tiers-siret">SIRET client (optionnel)</label>
                <input id="tiers-siret" value={tiersSiret} onChange={(e) => setTiersSiret(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="tiers-adresse">Adresse du client</label>
              <textarea id="tiers-adresse" rows={2} value={tiersAdresse} onChange={(e) => setTiersAdresse(e.target.value)} />
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="date-emission">Date d'émission</label>
                <input id="date-emission" type="date" required value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="date-echeance">Date d'échéance (optionnel)</label>
                <input id="date-echeance" type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>Lignes</label>
              <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table>
                  <thead>
                    <tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>TVA %</th><th>Montant TTC</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => {
                      const c = calculerLigne(parseFloat(l.quantite) || 0, parseFloat(l.prix_unitaire_ht) || 0, parseFloat(l.taux_tva) || 0)
                      return (
                        <tr key={l.id ?? `nouvelle-${i}`}>
                          <td><input value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} style={{ minWidth: 160 }} /></td>
                          <td><input type="number" step="0.01" value={l.quantite} onChange={(e) => majLigne(i, { quantite: e.target.value })} style={{ width: 65 }} /></td>
                          <td><input type="number" step="0.01" value={l.prix_unitaire_ht} onChange={(e) => majLigne(i, { prix_unitaire_ht: e.target.value })} style={{ width: 85 }} /></td>
                          <td><input type="number" step="0.1" value={l.taux_tva} onChange={(e) => majLigne(i, { taux_tva: e.target.value })} style={{ width: 65 }} /></td>
                          <td>{formatMoney(c.montant_ttc)}</td>
                          <td><button type="button" className="btn btn-outline btn-sm" onClick={() => retirerLigne(i)} disabled={lignes.length === 1}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={ajouterLigne}>+ Ligne</button>
            </div>

            <div style={{ display: 'flex', gap: 24, marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div><span className="muted" style={{ display: 'block' }}>Total HT</span><strong>{formatMoney(totaux.montant_ht)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TVA</span><strong>{formatMoney(totaux.montant_tva)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TTC</span><strong>{formatMoney(totaux.montant_ttc)}</strong></div>
            </div>

            <div className="field">
              <label htmlFor="mentions">Mentions légales</label>
              <textarea id="mentions" rows={3} value={mentionsLegales} onChange={(e) => setMentionsLegales(e.target.value)} />
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Proposées par défaut selon le régime de TVA du dossier — à vérifier et ajuster, ce n'est pas une garantie de conformité complète.
              </span>
            </div>

            <div className="field">
              <label htmlFor="notes">Notes internes (n'apparaissent pas sur la facture)</label>
              <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={!!saving}>Annuler</button>
              <button type="submit" className="btn btn-outline" disabled={!!saving}>
                {saving === 'brouillon' ? 'Enregistrement…' : 'Enregistrer le brouillon'}
              </button>
              <button type="button" className="btn btn-primary" disabled={!!saving} onClick={() => enregistrer('validee')} title="Attribue un numéro définitif — la facture ne sera plus modifiable ensuite">
                {saving === 'validation' ? 'Validation…' : 'Valider la facture'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
