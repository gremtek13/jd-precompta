import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { calculerLigne } from '../../lib/factures'
import { formatDate, formatMoney } from '../../lib/format'
import type { FactureEmise, FactureLigne } from '../../lib/types'

// Aperçu imprimable d'une facture validée — pas de génération PDF côté serveur pour l'instant (voir
// discussion sur la transmission via une plateforme agréée, pas encore branchée) : la boîte de
// dialogue d'impression du navigateur ("Enregistrer en PDF") suffit à obtenir un fichier envoyable en
// attendant. Seul .facture-imprimable reste visible en impression (voir index.css), tout le reste de
// l'appli (menu, boutons, autres onglets) est masqué.
export default function FactureApercu({ facture, onClose }: { facture: FactureEmise; onClose: () => void }) {
  const [lignes, setLignes] = useState<FactureLigne[] | null>(null)

  useEffect(() => {
    supabase.from('facture_lignes').select('*').eq('facture_id', facture.id).order('ordre')
      .then(({ data }) => setLignes((data ?? []) as FactureLigne[]))
  }, [facture.id])

  return (
    <div style={overlayStyle}>
      <div className="card facture-imprimable" style={{ width: 'min(720px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="facture-imprimable-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 16 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={onClose}>Fermer</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>Imprimer / Enregistrer en PDF</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <strong>{facture.emetteur_nom}</strong>
            {facture.emetteur_adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{facture.emetteur_adresse}</div>}
            {facture.emetteur_siret && <div className="muted">SIRET {facture.emetteur_siret}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0 }}>FACTURE {facture.numero}</h2>
            <div className="muted">Émise le {formatDate(facture.date_emission)}</div>
            {facture.date_echeance && <div className="muted">Échéance le {formatDate(facture.date_echeance)}</div>}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <span className="muted" style={{ display: 'block', marginBottom: 2 }}>Facturé à</span>
          <strong>{facture.tiers_nom}</strong>
          {facture.tiers_adresse && <div className="muted" style={{ whiteSpace: 'pre-line' }}>{facture.tiers_adresse}</div>}
          {facture.tiers_siret && <div className="muted">SIRET {facture.tiers_siret}</div>}
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Désignation</th><th>Qté</th><th>PU HT</th><th>TVA</th><th>Total HT</th><th>Total TTC</th></tr>
            </thead>
            <tbody>
              {lignes === null ? (
                <tr><td colSpan={6} className="muted">Chargement…</td></tr>
              ) : (
                lignes.map((l) => {
                  const c = calculerLigne(l.quantite, l.prix_unitaire_ht, l.taux_tva)
                  return (
                    <tr key={l.id}>
                      <td>{l.designation}</td>
                      <td>{l.quantite}</td>
                      <td>{formatMoney(l.prix_unitaire_ht)}</td>
                      <td>{l.taux_tva} %</td>
                      <td>{formatMoney(c.montant_ht)}</td>
                      <td>{formatMoney(c.montant_ttc)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total HT</span><span>{formatMoney(facture.montant_ht)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Total TVA</span><span>{formatMoney(facture.montant_tva)}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Total TTC</span><span>{formatMoney(facture.montant_ttc)}</span></div>
          </div>
        </div>

        {facture.mentions_legales && (
          <p className="muted" style={{ marginTop: 24, whiteSpace: 'pre-line', fontSize: '0.8rem' }}>{facture.mentions_legales}</p>
        )}
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
