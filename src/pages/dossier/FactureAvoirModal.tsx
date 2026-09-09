import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { attribuerNumeroFacture, calculerLigne, calculerTotaux } from '../../lib/factures'
import { formatMoney } from '../../lib/format'
import type { FactureEmise, FactureLigne } from '../../lib/types'

interface LigneAvoirEdit {
  designation: string
  // Toujours saisie positive à l'écran ("je crédite 2 unités") — négatée seulement à l'enregistrement
  // (voir creerAvoir), plus intuitif que de demander de taper un signe négatif à la main.
  quantite: string
  prix_unitaire_ht: string
  taux_tva: string
}

interface Props {
  dossierId: string
  factureOrigine: FactureEmise
  onClose: () => void
  onCreated: () => void
}

// Facture d'avoir — corrige une facture déjà validée (immuable, voir FacturesTab) sans jamais la
// rouvrir, comme l'exige la loi française : un document distinct, avec son propre numéro séquentiel
// dans une série "A" indépendante de celle des factures (voir lib/factures.ts,
// prochain_numero_facture), qui référence la facture d'origine.
//
// Toujours créé directement validé, jamais en brouillon — contrairement à une facture normale
// (voir FactureFormModal) : un avoir en attente indéfiniment n'a pas de sens (la correction est
// décidée au moment où on la fait), et ça évite un vrai piège sinon inévitable — FacturesTab route un
// brouillon vers FactureFormModal, qui ne sait rien de la série "A" ni de facture_origine_id ; un
// avoir resté en brouillon serait réouvert par le mauvais formulaire.
//
// Pré-rempli avec les lignes de l'origine (équivaut à un avoir total) — reste librement modifiable
// avant validation pour un avoir partiel (une seule ligne sur trois, une quantité réduite...). Les
// montants restent positifs à l'écran ("je crédite 120 €") mais sont stockés négatifs en base (voir
// creerAvoir) : sommer tous les montant_ttc d'un dossier/année annule alors automatiquement l'effet de
// l'avoir sur le total, sans cas particulier à coder ailleurs (FactureApercu, un futur export...).
export default function FactureAvoirModal({ dossierId, factureOrigine, onClose, onCreated }: Props) {
  const [dateEmission, setDateEmission] = useState(new Date().toISOString().slice(0, 10))
  const [motif, setMotif] = useState('')
  const [mentionsLegales, setMentionsLegales] = useState(factureOrigine.mentions_legales ?? '')
  const [lignes, setLignes] = useState<LigneAvoirEdit[]>([])
  const [chargement, setChargement] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('facture_lignes').select('*').eq('facture_id', factureOrigine.id).order('ordre').then(({ data }) => {
      const l = (data ?? []) as FactureLigne[]
      setLignes(l.map((x) => ({
        designation: x.designation,
        quantite: String(x.quantite),
        prix_unitaire_ht: String(x.prix_unitaire_ht),
        taux_tva: String(x.taux_tva),
      })))
      setChargement(false)
    })
  }, [factureOrigine.id])

  function majLigne(index: number, patch: Partial<LigneAvoirEdit>) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }
  function retirerLigne(index: number) {
    setLignes((prev) => prev.filter((_, i) => i !== index))
  }

  const lignesNumeriques = lignes.map((l) => ({
    designation: l.designation,
    quantite: parseFloat(l.quantite) || 0,
    prix_unitaire_ht: parseFloat(l.prix_unitaire_ht) || 0,
    taux_tva: parseFloat(l.taux_tva) || 0,
  }))
  const totaux = calculerTotaux(lignesNumeriques)
  const lignesValides = lignesNumeriques.filter((l) => l.designation.trim() && l.quantite > 0)

  async function creerAvoir() {
    if (lignesValides.length === 0) {
      setError('Au moins une ligne avec une quantité doit rester à créditer.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const numero = await attribuerNumeroFacture(dossierId, dateEmission, 'avoir')
      const { data: userData } = await supabase.auth.getUser()
      const { data: inserted, error: insertError } = await supabase.from('factures_emises').insert({
        dossier_id: dossierId,
        type: 'avoir',
        facture_origine_id: factureOrigine.id,
        numero,
        statut: 'validee',
        validated_at: new Date().toISOString(),
        tiers_nom: factureOrigine.tiers_nom,
        tiers_adresse: factureOrigine.tiers_adresse,
        tiers_siret: factureOrigine.tiers_siret,
        date_emission: dateEmission,
        notes: motif.trim() || null,
        mentions_legales: mentionsLegales.trim() || null,
        emetteur_nom: factureOrigine.emetteur_nom,
        emetteur_siret: factureOrigine.emetteur_siret,
        emetteur_adresse: factureOrigine.emetteur_adresse,
        // Négatifs : voir l'en-tête de ce fichier.
        montant_ht: -totaux.montant_ht,
        montant_tva: -totaux.montant_tva,
        montant_ttc: -totaux.montant_ttc,
        created_by: userData.user?.id ?? null,
      }).select().single()
      if (insertError) throw insertError

      const { error: lignesError } = await supabase.from('facture_lignes').insert(
        lignesValides.map((l, i) => ({
          facture_id: inserted.id, ordre: i,
          designation: l.designation, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva,
          quantite: -l.quantite,
        })),
      )
      if (lignesError) throw lignesError

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Avoir pour la facture {factureOrigine.numero}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Client : {factureOrigine.tiers_nom}. Les lignes ci-dessous sont pré-remplies pour un avoir
          total — réduis une quantité ou retire une ligne pour un avoir partiel. Un numéro définitif
          (série "A", indépendante des factures) est attribué dès la création : il n'y a pas de
          brouillon d'avoir.
        </p>
        {chargement ? (
          <p className="muted">Chargement…</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="avoir-date">Date d'émission</label>
              <input id="avoir-date" type="date" required value={dateEmission} onChange={(e) => setDateEmission(e.target.value)} style={{ maxWidth: 200 }} />
            </div>

            <div className="field">
              <label>Lignes créditées</label>
              <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table>
                  <thead>
                    <tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>TVA %</th><th>Montant TTC</th><th></th></tr>
                  </thead>
                  <tbody>
                    {lignes.map((l, i) => {
                      const c = calculerLigne(parseFloat(l.quantite) || 0, parseFloat(l.prix_unitaire_ht) || 0, parseFloat(l.taux_tva) || 0)
                      return (
                        <tr key={i}>
                          <td><input value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} style={{ minWidth: 160 }} /></td>
                          <td><input type="number" step="0.01" min="0" value={l.quantite} onChange={(e) => majLigne(i, { quantite: e.target.value })} style={{ width: 65 }} /></td>
                          <td><input type="number" step="0.01" value={l.prix_unitaire_ht} onChange={(e) => majLigne(i, { prix_unitaire_ht: e.target.value })} style={{ width: 85 }} /></td>
                          <td><input type="number" step="0.1" value={l.taux_tva} onChange={(e) => majLigne(i, { taux_tva: e.target.value })} style={{ width: 65 }} /></td>
                          <td>{formatMoney(c.montant_ttc)}</td>
                          <td><button type="button" className="btn btn-outline btn-sm" onClick={() => retirerLigne(i)}>✕</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 24, marginTop: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div><span className="muted" style={{ display: 'block' }}>Total HT crédité</span><strong>{formatMoney(totaux.montant_ht)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TVA créditée</span><strong>{formatMoney(totaux.montant_tva)}</strong></div>
              <div><span className="muted" style={{ display: 'block' }}>Total TTC crédité</span><strong>{formatMoney(totaux.montant_ttc)}</strong></div>
            </div>

            <div className="field">
              <label htmlFor="avoir-motif">Motif (note interne, n'apparaît pas sur l'avoir)</label>
              <input id="avoir-motif" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="ex. Erreur de quantité, remise commerciale a posteriori…" />
            </div>

            <div className="field">
              <label htmlFor="avoir-mentions">Mentions légales</label>
              <textarea id="avoir-mentions" rows={2} value={mentionsLegales} onChange={(e) => setMentionsLegales(e.target.value)} />
            </div>

            {error && <p className="error-text">{error}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Annuler</button>
              <button
                type="button" className="btn btn-primary" disabled={saving} onClick={creerAvoir}
                title="Attribue un numéro définitif — l'avoir ne sera plus modifiable ensuite"
              >
                {saving ? 'Création…' : "Valider l'avoir"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
