import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { capitalRestantDu, empruntActif, genererEcheancier, type Emprunt } from '../../lib/emprunts'

// Première brique du "dossier bancaire automatisé" — l'échéancier des emprunts (voir lib/emprunts.ts),
// avec quelques ratios simples qui ne demandent pas de résoudre au préalable la question, plus large,
// d'un bilan complet par régime (BNC/société) : trésorerie et capacité de remboursement se calculent
// pareil dans les deux cas à partir du compte banque et des mensualités. La situation intermédiaire
// détaillée (balance complète) reste dans l'onglet Statistiques plutôt que dupliquée ici.
export default function FinancementTab({ dossierId }: { dossierId: string }) {
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Emprunt | 'new' | null>(null)
  const [echeancierDe, setEcheancierDe] = useState<Emprunt | null>(null)
  const [soldeBanque, setSoldeBanque] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('emprunts').select('*').eq('dossier_id', dossierId).order('date_debut', { ascending: false })
    setEmprunts((data ?? []) as Emprunt[])
    // Trésorerie actuelle — solde du compte banque (512) sur tout l'historique du brouillon
    // d'écritures, comme un relevé : pas borné à l'année en cours, contrairement à Statistiques.
    const { data: lignesBanque } = await supabase.from('ecritures_brouillon').select('sens, montant').eq('dossier_id', dossierId).eq('compte', '512000')
    if (lignesBanque) {
      const solde = lignesBanque.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0)
      setSoldeBanque(Math.round(solde * 100) / 100)
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  async function supprimer(e: Emprunt) {
    if (!window.confirm(`Supprimer l'emprunt "${e.nom}" ? Cette action est irréversible.`)) return
    await supabase.from('emprunts').delete().eq('id', e.id)
    load()
  }

  const empruntsActifs = emprunts.filter((e) => empruntActif(e))
  const mensualiteTotale = empruntsActifs.reduce((s, e) => s + genererEcheancier(e)[0].mensualite, 0)
  const capitalRestantTotal = empruntsActifs.reduce((s, e) => s + capitalRestantDu(e), 0)

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Échéancier des emprunts du dossier et quelques ratios utiles pour un dossier bancaire. La
        situation intermédiaire détaillée (balance complète des comptes) reste dans l'onglet
        Statistiques — cet écran se concentre sur ce qu'elle ne couvre pas : les conditions des prêts
        en cours.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Trésorerie actuelle (banque)</span>
          <strong style={{ fontSize: '1.3rem' }}>{soldeBanque === null ? '—' : formatMoney(soldeBanque)}</strong>
        </div>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Mensualités en cours (total)</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(Math.round(mensualiteTotale * 100) / 100)}</strong>
        </div>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Capital restant dû (total)</span>
          <strong style={{ fontSize: '1.3rem' }}>{formatMoney(Math.round(capitalRestantTotal * 100) / 100)}</strong>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>+ Nouvel emprunt</button>
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : emprunts.length === 0 ? (
          <div className="empty-state">Aucun emprunt enregistré.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Nom</th><th className="hide-mobile">Organisme</th><th>Capital initial</th><th className="hide-mobile">Taux</th><th>Mensualité</th><th>Restant dû</th><th></th></tr>
            </thead>
            <tbody>
              {emprunts.map((e) => {
                const mensualite = genererEcheancier(e)[0].mensualite
                const restant = capitalRestantDu(e)
                return (
                  <tr key={e.id}>
                    <td>
                      {e.nom}
                      {!empruntActif(e) && <div className="muted" style={{ fontSize: '0.78rem' }}>Soldé</div>}
                    </td>
                    <td className="hide-mobile">{e.organisme_preteur ?? '—'}</td>
                    <td>{formatMoney(e.capital_initial)}</td>
                    <td className="hide-mobile">{e.taux_annuel} %</td>
                    <td>{formatMoney(mensualite)}</td>
                    <td>{formatMoney(restant)}</td>
                    <td className="td-actions">
                      <button className="btn btn-outline btn-sm" onClick={() => setEcheancierDe(e)}>Échéancier</button>
                      <button className="btn btn-outline btn-sm" onClick={() => setEditing(e)}>Modifier</button>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimer(e)}>Supprimer</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EmpruntFormModal
          dossierId={dossierId}
          emprunt={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      {echeancierDe && <EcheancierModal emprunt={echeancierDe} onClose={() => setEcheancierDe(null)} />}
    </>
  )
}

function EmpruntFormModal({ dossierId, emprunt, onClose, onSaved }: { dossierId: string; emprunt: Emprunt | null; onClose: () => void; onSaved: () => void }) {
  const [nom, setNom] = useState(emprunt?.nom ?? '')
  const [organisme, setOrganisme] = useState(emprunt?.organisme_preteur ?? '')
  const [capital, setCapital] = useState(emprunt ? String(emprunt.capital_initial) : '')
  const [taux, setTaux] = useState(emprunt ? String(emprunt.taux_annuel) : '')
  const [dateDebut, setDateDebut] = useState(emprunt?.date_debut ?? new Date().toISOString().slice(0, 10))
  const [dureeMois, setDureeMois] = useState(emprunt ? String(emprunt.duree_mois) : '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErreur(null)
    const payload = {
      dossier_id: dossierId,
      nom: nom.trim(),
      organisme_preteur: organisme.trim() || null,
      capital_initial: parseFloat(capital),
      taux_annuel: parseFloat(taux),
      date_debut: dateDebut,
      duree_mois: parseInt(dureeMois, 10),
    }
    const { error } = emprunt
      ? await supabase.from('emprunts').update(payload).eq('id', emprunt.id)
      : await supabase.from('emprunts').insert(payload)
    setSaving(false)
    if (error) {
      setErreur(error.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(480px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>{emprunt ? "Modifier l'emprunt" : 'Nouvel emprunt'}</h2>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="emp-nom">Nom</label>
            <input id="emp-nom" required value={nom} onChange={(e) => setNom(e.target.value)} placeholder="ex. Prêt matériel, Prêt BPI…" />
          </div>
          <div className="field">
            <label htmlFor="emp-organisme">Organisme prêteur (facultatif)</label>
            <input id="emp-organisme" value={organisme} onChange={(e) => setOrganisme(e.target.value)} />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-capital">Capital initial (€)</label>
              <input id="emp-capital" type="number" step="0.01" min="0.01" required value={capital} onChange={(e) => setCapital(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="emp-taux">Taux annuel (%)</label>
              <input id="emp-taux" type="number" step="0.01" min="0" required value={taux} onChange={(e) => setTaux(e.target.value)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="emp-date">Date de début</label>
              <input id="emp-date" type="date" required value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="emp-duree">Durée (mois)</label>
              <input id="emp-duree" type="number" step="1" min="1" required value={dureeMois} onChange={(e) => setDureeMois(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Amortissement à mensualité constante — le calcul le plus courant pour un prêt professionnel.
          </p>
          {erreur && <p className="error-text">{erreur}</p>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EcheancierModal({ emprunt, onClose }: { emprunt: Emprunt; onClose: () => void }) {
  const lignes = genererEcheancier(emprunt)
  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Échéancier — {emprunt.nom}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {formatMoney(emprunt.capital_initial)} sur {emprunt.duree_mois} mois à {emprunt.taux_annuel} %,
          à partir du {formatDate(emprunt.date_debut)}.
        </p>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          <table>
            <thead><tr><th>#</th><th>Date</th><th>Mensualité</th><th>Intérêts</th><th>Capital remboursé</th><th>Restant dû</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.numero}>
                  <td>{l.numero}</td>
                  <td>{formatDate(l.date)}</td>
                  <td>{formatMoney(l.mensualite)}</td>
                  <td>{formatMoney(l.interets)}</td>
                  <td>{formatMoney(l.capitalRembourse)}</td>
                  <td>{formatMoney(l.capitalRestant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
