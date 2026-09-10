import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import {
  LABEL_STATUT_SUPPLEMENT, LABEL_TYPE_SUPPLEMENT, type Supplement, type TypeSupplement,
} from '../../lib/supplements'
import {
  LABEL_TYPE_MOUVEMENT_CCA, soldeCca, type CompteCourantAssocie, type MouvementCca, type TypeMouvementCca,
} from '../../lib/cca'

interface FactureOption { id: string; numero: string | null; tiers_nom: string }

// Deuxième brique du brainstorm "facturation et gestion de supplément" (voir CLAUDE.md) : les
// prestations ponctuelles en plus de la mission courante (création/fermeture de société, situation
// intermédiaire...) et le suivi des comptes courants d'associés, deux besoins différents regroupés
// dans un même onglet car tous deux hors du flux de facturation habituel (voir FacturesTab).
export default function SupplementsTab({ dossierId }: { dossierId: string }) {
  const [supplements, setSupplements] = useState<Supplement[]>([])
  const [comptes, setComptes] = useState<CompteCourantAssocie[]>([])
  const [mouvements, setMouvements] = useState<MouvementCca[]>([])
  const [facturesDispo, setFacturesDispo] = useState<FactureOption[]>([])
  const [loading, setLoading] = useState(true)

  const [editingSupplement, setEditingSupplement] = useState<Supplement | 'new' | null>(null)
  const [facturerSupplement, setFacturerSupplement] = useState<Supplement | null>(null)
  const [editingCompte, setEditingCompte] = useState<CompteCourantAssocie | 'new' | null>(null)
  const [compteOuvert, setCompteOuvert] = useState<CompteCourantAssocie | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: sup }, { data: cptes }, { data: fact }] = await Promise.all([
      supabase.from('supplements').select('*').eq('dossier_id', dossierId).order('date_demande', { ascending: false }),
      supabase.from('comptes_courants_associes').select('*').eq('dossier_id', dossierId).order('nom_associe'),
      supabase.from('factures_emises').select('id, numero, tiers_nom').eq('dossier_id', dossierId).order('date_emission', { ascending: false }),
    ])
    setSupplements((sup ?? []) as Supplement[])
    setComptes((cptes ?? []) as CompteCourantAssocie[])
    setFacturesDispo((fact ?? []) as FactureOption[])
    // Mouvements de tous les comptes du dossier chargés en une fois (plutôt qu'à l'ouverture de
    // chaque modale) pour pouvoir afficher un solde par compte directement dans la liste de cartes.
    const comptesIds = (cptes ?? []).map((c) => c.id)
    if (comptesIds.length > 0) {
      const { data: mvts } = await supabase.from('mouvements_cca').select('*').in('compte_id', comptesIds).order('date', { ascending: false })
      setMouvements((mvts ?? []) as MouvementCca[])
    } else {
      setMouvements([])
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  async function supprimerSupplement(s: Supplement) {
    if (!window.confirm(`Supprimer "${s.libelle}" ?`)) return
    await supabase.from('supplements').delete().eq('id', s.id)
    load()
  }

  async function supprimerCompte(c: CompteCourantAssocie) {
    if (!window.confirm(`Supprimer le compte courant de ${c.nom_associe} et tous ses mouvements ? Cette action est irréversible.`)) return
    await supabase.from('comptes_courants_associes').delete().eq('id', c.id)
    load()
  }

  const soldesParCompte = new Map(comptes.map((c) => [c.id, soldeCca(mouvements.filter((m) => m.compte_id === c.id))]))

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Prestations ponctuelles en plus de la mission courante (création ou fermeture de société,
        situation intermédiaire...) et suivi des comptes courants d'associés — deux volets distincts
        de ce qui reste, en pratique, hors de la facturation récurrente du dossier.
      </p>

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Prestations ponctuelles</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setEditingSupplement('new')}>+ Nouvelle prestation</button>
        </div>
        <div className="card table-scroll" style={{ padding: 0 }}>
          {loading ? (
            <p className="muted" style={{ padding: 20 }}>Chargement…</p>
          ) : supplements.length === 0 ? (
            <div className="empty-state">Aucune prestation ponctuelle enregistrée.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Type</th><th className="hide-mobile">Libellé</th><th>Montant HT</th><th>Statut</th><th className="hide-mobile">Demandée le</th><th></th></tr>
              </thead>
              <tbody>
                {supplements.map((s) => (
                  <tr key={s.id}>
                    <td>{LABEL_TYPE_SUPPLEMENT[s.type]}</td>
                    <td className="hide-mobile">{s.libelle}</td>
                    <td>{formatMoney(s.montant_ht)}</td>
                    <td>
                      <span className={`badge ${s.statut === 'facturee' ? 'badge-ok' : 'badge-neutral'}`}>
                        {LABEL_STATUT_SUPPLEMENT[s.statut]}
                      </span>
                    </td>
                    <td className="hide-mobile">{formatDate(s.date_demande)}</td>
                    <td className="td-actions">
                      {s.statut === 'a_facturer' && (
                        <button className="btn btn-outline btn-sm" onClick={() => setFacturerSupplement(s)}>Marquer facturée</button>
                      )}
                      <button className="btn btn-outline btn-sm" onClick={() => setEditingSupplement(s)}>Modifier</button>
                      <button className="btn btn-danger btn-sm" onClick={() => supprimerSupplement(s)}>Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
          <h3 style={{ margin: 0 }}>Comptes courants d'associés</h3>
          <button className="btn btn-primary btn-sm" onClick={() => setEditingCompte('new')}>+ Nouveau compte</button>
        </div>
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : comptes.length === 0 ? (
          <div className="card empty-state">Aucun compte courant d'associé enregistré.</div>
        ) : (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {comptes.map((c) => (
              <div key={c.id} className="card" style={{ flex: '1 1 220px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <strong>{c.nom_associe}</strong>
                    {c.taux_interet_annuel != null && (
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{c.taux_interet_annuel} % / an (indicatif)</div>
                    )}
                  </div>
                  <button className="btn btn-danger btn-sm" onClick={() => supprimerCompte(c)}>Supprimer</button>
                </div>
                <p style={{ margin: '10px 0 4px' }}>
                  <span className="muted" style={{ fontSize: '0.85rem' }}>Solde actuel</span><br />
                  <strong style={{ fontSize: '1.3rem' }}>{formatMoney(soldesParCompte.get(c.id) ?? 0)}</strong>
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setCompteOuvert(c)}>Mouvements</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditingCompte(c)}>Modifier</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {editingSupplement && (
        <SupplementFormModal
          dossierId={dossierId}
          supplement={editingSupplement === 'new' ? null : editingSupplement}
          onClose={() => setEditingSupplement(null)}
          onSaved={load}
        />
      )}
      {facturerSupplement && (
        <MarquerFactureeModal
          supplement={facturerSupplement}
          facturesDispo={facturesDispo}
          onClose={() => setFacturerSupplement(null)}
          onSaved={load}
        />
      )}
      {editingCompte && (
        <CompteFormModal
          dossierId={dossierId}
          compte={editingCompte === 'new' ? null : editingCompte}
          onClose={() => setEditingCompte(null)}
          onSaved={load}
        />
      )}
      {compteOuvert && (
        <MouvementsModal
          compte={compteOuvert}
          mouvements={mouvements.filter((m) => m.compte_id === compteOuvert.id)}
          onClose={() => setCompteOuvert(null)}
          onChanged={load}
        />
      )}
    </>
  )
}

function SupplementFormModal({ dossierId, supplement, onClose, onSaved }: {
  dossierId: string; supplement: Supplement | null; onClose: () => void; onSaved: () => void
}) {
  const [type, setType] = useState<TypeSupplement>(supplement?.type ?? 'creation_societe')
  const [libelle, setLibelle] = useState(supplement?.libelle ?? '')
  const [montantHt, setMontantHt] = useState(supplement?.montant_ht != null ? String(supplement.montant_ht) : '')
  const [dateDemande, setDateDemande] = useState(supplement?.date_demande ?? new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState(supplement?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErreur(null)
    const payload = {
      dossier_id: dossierId,
      type,
      libelle: libelle.trim(),
      montant_ht: montantHt.trim() ? parseFloat(montantHt) : null,
      date_demande: dateDemande,
      notes: notes.trim() || null,
    }
    const { error } = supplement
      ? await supabase.from('supplements').update(payload).eq('id', supplement.id)
      : await supabase.from('supplements').insert(payload)
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
        <h2 style={{ marginTop: 0 }}>{supplement ? 'Modifier la prestation' : 'Nouvelle prestation ponctuelle'}</h2>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="sup-type">Type</label>
            <select id="sup-type" value={type} onChange={(e) => setType(e.target.value as TypeSupplement)}>
              {Object.entries(LABEL_TYPE_SUPPLEMENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sup-libelle">Libellé</label>
            <input id="sup-libelle" required value={libelle} onChange={(e) => setLibelle(e.target.value)} placeholder="ex. Création de SASU, dépôt de statuts…" />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sup-montant">Montant HT prévu (€, facultatif)</label>
              <input id="sup-montant" type="number" step="0.01" min="0" value={montantHt} onChange={(e) => setMontantHt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sup-date">Date de la demande</label>
              <input id="sup-date" type="date" required value={dateDemande} onChange={(e) => setDateDemande(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sup-notes">Notes (facultatif)</label>
            <textarea id="sup-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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

function MarquerFactureeModal({ supplement, facturesDispo, onClose, onSaved }: {
  supplement: Supplement; facturesDispo: FactureOption[]; onClose: () => void; onSaved: () => void
}) {
  const [factureId, setFactureId] = useState('')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function confirmer() {
    setSaving(true)
    setErreur(null)
    const { error } = await supabase.from('supplements').update({ statut: 'facturee', facture_id: factureId || null }).eq('id', supplement.id)
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
      <div className="card" style={{ width: 'min(440px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>Marquer « {supplement.libelle} » comme facturée</h2>
        <div className="field">
          <label htmlFor="sup-facture">Facture correspondante (facultatif)</label>
          <select id="sup-facture" value={factureId} onChange={(e) => setFactureId(e.target.value)}>
            <option value="">Aucune — facturée par un autre moyen</option>
            {facturesDispo.map((f) => <option key={f.id} value={f.id}>{f.numero ?? '(brouillon)'} — {f.tiers_nom}</option>)}
          </select>
        </div>
        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="button" className="btn btn-primary" onClick={confirmer} disabled={saving}>{saving ? 'Enregistrement…' : 'Confirmer'}</button>
        </div>
      </div>
    </div>
  )
}

function CompteFormModal({ dossierId, compte, onClose, onSaved }: {
  dossierId: string; compte: CompteCourantAssocie | null; onClose: () => void; onSaved: () => void
}) {
  const [nom, setNom] = useState(compte?.nom_associe ?? '')
  const [taux, setTaux] = useState(compte?.taux_interet_annuel != null ? String(compte.taux_interet_annuel) : '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function enregistrer(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErreur(null)
    const payload = {
      dossier_id: dossierId,
      nom_associe: nom.trim(),
      taux_interet_annuel: taux.trim() ? parseFloat(taux) : null,
    }
    const { error } = compte
      ? await supabase.from('comptes_courants_associes').update(payload).eq('id', compte.id)
      : await supabase.from('comptes_courants_associes').insert(payload)
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
      <div className="card" style={{ width: 'min(420px, 92vw)' }}>
        <h2 style={{ marginTop: 0 }}>{compte ? 'Modifier le compte' : "Nouveau compte courant d'associé"}</h2>
        <form onSubmit={enregistrer}>
          <div className="field">
            <label htmlFor="cca-nom">Nom de l'associé</label>
            <input id="cca-nom" required value={nom} onChange={(e) => setNom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cca-taux">Taux d'intérêt annuel (%, facultatif)</label>
            <input id="cca-taux" type="number" step="0.01" min="0" value={taux} onChange={(e) => setTaux(e.target.value)} />
          </div>
          <p className="muted" style={{ fontSize: '0.82rem' }}>
            Indicatif — les intérêts ne sont pas calculés automatiquement (les conventions varient
            trop d'un cabinet à l'autre), à saisir comme mouvement « Intérêts » une fois déterminés.
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

function MouvementsModal({ compte, mouvements, onClose, onChanged }: {
  compte: CompteCourantAssocie; mouvements: MouvementCca[]; onClose: () => void; onChanged: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [type, setType] = useState<TypeMouvementCca>('apport')
  const [montant, setMontant] = useState('')
  const [libelle, setLibelle] = useState('')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function ajouter(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErreur(null)
    const { error } = await supabase.from('mouvements_cca').insert({
      compte_id: compte.id, date, type, montant: parseFloat(montant), libelle: libelle.trim() || null,
    })
    setSaving(false)
    if (error) {
      setErreur(error.message)
      return
    }
    setMontant('')
    setLibelle('')
    onChanged()
  }

  async function supprimer(m: MouvementCca) {
    if (!window.confirm('Supprimer ce mouvement ?')) return
    await supabase.from('mouvements_cca').delete().eq('id', m.id)
    onChanged()
  }

  // `mouvements` arrive trié du plus récent au plus ancien (voir load()) — reconstitue le solde
  // après chaque ligne en parcourant dans l'ordre chronologique inverse, puis réaffiche du plus
  // récent au plus ancien comme un relevé, sans redemander à l'utilisateur de les additionner.
  const chronologique = [...mouvements].reverse()
  const avecSolde = chronologique
    .reduce<(MouvementCca & { soldeApres: number })[]>((acc, m) => {
      const precedent = acc.length > 0 ? acc[acc.length - 1].soldeApres : 0
      const soldeApres = Math.round((precedent + (m.type === 'retrait' ? -m.montant : m.montant)) * 100) / 100
      acc.push({ ...m, soldeApres })
      return acc
    }, [])
    .reverse()

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(600px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Mouvements — {compte.nom_associe}</h2>
        <p className="muted" style={{ marginTop: -8 }}>Solde actuel : <strong>{formatMoney(soldeCca(mouvements))}</strong></p>

        <form onSubmit={ajouter} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ flex: '1 1 130px', marginBottom: 0 }}>
            <label htmlFor="mvt-date">Date</label>
            <input id="mvt-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}>
            <label htmlFor="mvt-type">Type</label>
            <select id="mvt-type" value={type} onChange={(e) => setType(e.target.value as TypeMouvementCca)}>
              {Object.entries(LABEL_TYPE_MOUVEMENT_CCA).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 100px', marginBottom: 0 }}>
            <label htmlFor="mvt-montant">Montant (€)</label>
            <input id="mvt-montant" type="number" step="0.01" min="0.01" required value={montant} onChange={(e) => setMontant(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '2 1 160px', marginBottom: 0 }}>
            <label htmlFor="mvt-libelle">Libellé (facultatif)</label>
            <input id="mvt-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? '…' : 'Ajouter'}</button>
        </form>
        {erreur && <p className="error-text">{erreur}</p>}

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {mouvements.length === 0 ? (
            <div className="empty-state">Aucun mouvement enregistré.</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Montant</th><th className="hide-mobile">Libellé</th><th>Solde</th><th></th></tr></thead>
              <tbody>
                {avecSolde.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate(m.date)}</td>
                    <td>{LABEL_TYPE_MOUVEMENT_CCA[m.type]}</td>
                    <td>{m.type === 'retrait' ? '-' : '+'}{formatMoney(m.montant)}</td>
                    <td className="hide-mobile">{m.libelle ?? '—'}</td>
                    <td>{formatMoney(m.soldeApres)}</td>
                    <td className="td-actions"><button className="btn btn-danger btn-sm" onClick={() => supprimer(m)}>Supprimer</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
