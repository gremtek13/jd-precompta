import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { calculerLigne, calculerTotaux, creerAvoir, lignesSaisies, refusAvoir } from '../../lib/factures'
import { aujourdHuiSql, formatMoney } from '../../lib/format'
import type { FactureEmise, FactureLigne } from '../../lib/types'
import { messageErreur } from '../../lib/messageErreur'

interface LigneAvoirEdit {
  designation: string
  // Toujours saisie positive à l'écran ("je crédite 2 unités") — négatée seulement à l'enregistrement
  // (lib/factures.ts:creerAvoir), plus intuitif que de demander de taper un signe négatif à la main.
  quantite: string
  prix_unitaire_ht: string
  taux_tva: string
}

interface Props {
  dossierId: string
  factureOrigine: FactureEmise
  // Ce que les autres avoirs de cette facture ont déjà crédité (lib/factures.ts:dejaCredite) ; null quand la liste
  // des factures n'a pas été lue en entier — on ne sait pas, et c'est alors la base qui juge du plafond.
  credite: number | null
  onClose: () => void
  onCreated: () => void
}

// Facture d'avoir — corrige une facture déjà validée (immuable, voir FacturesTab) sans jamais la
// rouvrir, comme l'exige la loi française : un document distinct, avec son propre numéro séquentiel
// dans une série "A" indépendante de celle des factures, qui référence la facture d'origine. Il
// s'enregistre d'un seul tenant par la base (lib/factures.ts:creerAvoir), qui reprend de la facture
// ses parties et ce qu'elle dit de l'opération.
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
export default function FactureAvoirModal({ dossierId, factureOrigine, credite, onClose, onCreated }: Props) {
  const [dateEmission, setDateEmission] = useState(aujourdHuiSql())
  const [motif, setMotif] = useState('')
  const [mentionsLegales, setMentionsLegales] = useState(factureOrigine.mentions_legales ?? '')
  const [lignes, setLignes] = useState<LigneAvoirEdit[]>([])
  const [chargement, setChargement] = useState(true)
  // Non nul = on ne SAIT PAS ce que la facture d'origine porte. Distinct d'un tableau vide, qui
  // voudrait dire « il n'y a rien à créditer » — voir l'effet ci-dessous.
  const [lignesIllisibles, setLignesIllisibles] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // UNE LECTURE REFUSÉE NE DOIT PAS PASSER POUR « RIEN À CRÉDITER ».
  //
  // L'erreur était jetée, donc `lignes` restait VIDE — et cet écran n'a aucun bouton « + Ligne » :
  // le tableau s'affichait vide sous un paragraphe qui annonce « les lignes ci-dessous sont
  // pré-remplies pour un avoir total », et « Valider l'avoir » répondait « Au moins une ligne avec
  // une quantité doit rester à créditer », c'est-à-dire un reproche à l'opérateur pour une panne
  // de lecture.
  //
  // Rectification de ce que j'avais écrit avant de l'exécuter : cette garde EST en place et elle
  // tient — aucun numéro de la série « A » n'est consommé, aucun avoir vide n'est créé. Ce que ça
  // coûte est plus étroit et reste réel : la seule façon légale de corriger une facture validée
  // (CLAUDE.md) paraît impossible, sur un motif faux, et rien ne dit à l'opérateur de réessayer.
  useEffect(() => {
    supabase.from('facture_lignes').select('*').eq('facture_id', factureOrigine.id).order('ordre').then(({ data, error: lectureError }) => {
      if (lectureError) {
        setLignesIllisibles(messageErreur(lectureError, "Les lignes de la facture d'origine n'ont pas pu être lues."))
        setChargement(false)
        return
      }
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
  // Une ligne sans désignation ou sans quantité ne part pas — mettre sa quantité à zéro est la façon d'écarter une
  // ligne d'un avoir partiel. Les TOTAUX sont donc ceux des lignes qui partent, et d'aucun autre jeu : la base stocke
  // l'en-tête tel qu'il est envoyé, et un total qui compterait une ligne écartée contredirait les lignes de l'avoir.
  const { valides: lignesValides, ecartees: lignesEcartees } = lignesSaisies(lignesNumeriques)
  const totaux = calculerTotaux(lignesValides)
  // Ce que la base refuserait, dit avant le clic (lib/factures.ts:refusAvoir).
  const refus = refusAvoir(factureOrigine, dateEmission, lignesValides, credite)

  // Verrou en `useRef`, et POSÉ AVANT LE `try` : dans le `try`, le `return` du deuxième clic
  // sortirait par le `finally`, qui relâcherait le verrou du PREMIER, encore en cours — il faut
  // trois clics pour le voir, et deux suffisent à croire la version fautive correcte (CLAUDE.md).
  //
  // Le doublon ne coûte pas une ligne de trop : la base CONSOMME un numéro de la suite annuelle à
  // chaque avoir qu'elle crée, et cette suite n'admet ni trou ni doublon. Deux clics, ce seraient
  // deux avoirs sur la même facture — la base refuse le second s'il dépasse ce qui reste à créditer,
  // pas s'il en crédite une partie.
  const creationEnCours = useRef(false)

  async function valider() {
    // Seconde ceinture : le bouton est déjà grisé sur un refus.
    if (refus) {
      setError(refus)
      return
    }
    if (creationEnCours.current) return
    creationEnCours.current = true
    setSaving(true)
    setError(null)
    try {
      await creerAvoir(dossierId, factureOrigine.id, { dateEmission, motif, mentionsLegales, lignes: lignesValides })
      onCreated()
      onClose()
    } catch (err) {
      setError(messageErreur(err))
    } finally {
      creationEnCours.current = false
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
        {credite != null && credite > 0 && (
          <p className="muted">
            D'autres avoirs ont déjà crédité {formatMoney(credite)} de cette facture : il en reste{' '}
            {formatMoney(Math.max(factureOrigine.montant_ttc - credite, 0))} à créditer.
          </p>
        )}
        {credite == null && (
          <p className="muted">
            La liste des factures n'a pas été lue en entier : ce que d'autres avoirs ont déjà crédité de
            cette facture n'est pas connu ici. La base refusera un avoir qui créditerait plus que ce qui reste.
          </p>
        )}
        {chargement ? (
          <p className="muted">Chargement…</p>
        ) : lignesIllisibles ? (
          <>
            <p className="error-text">
              {lignesIllisibles} Un avoir ne peut pas être créé sans elles : ce n'est pas que cette
              facture n'ait rien à créditer, c'est qu'on ne l'a pas lue. Réessaie.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Fermer</button>
            </div>
          </>
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

            {lignesEcartees > 0 && (
              <p className="muted" style={{ marginTop: 0 }}>
                {lignesEcartees === 1
                  ? 'Une ligne n’est pas créditée'
                  : `${lignesEcartees} lignes ne sont pas créditées`} : une ligne créditée porte une désignation et
                une quantité positive.
              </p>
            )}

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

            {(error ?? refus) && <p className="error-text">{error ?? refus}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Annuler</button>
              <button
                type="button" className="btn btn-primary" disabled={saving || refus != null} onClick={valider}
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
