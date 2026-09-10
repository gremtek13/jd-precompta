import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE } from '../../lib/ecritures'
import { capitalRestantDu, empruntActif, genererEcheancier, type Emprunt } from '../../lib/emprunts'
import { calculerSituationIntermediaire } from '../../lib/situationIntermediaire'
import { calculerPlanTresorerie, echeancesCotisations, echeancesEmprunts, type EcheanceConnue } from '../../lib/planTresorerie'
import { calculerRatiosBancaires } from '../../lib/ratiosBancaires'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece } from '../../lib/types'

interface LigneBanque { date: string; sens: 'debit' | 'credit'; montant: number }

// Première brique du "dossier bancaire automatisé" — l'échéancier des emprunts (voir lib/emprunts.ts),
// avec quelques ratios simples qui ne demandent pas de résoudre au préalable la question, plus large,
// d'un bilan complet par régime (BNC/société) : trésorerie et capacité de remboursement se calculent
// pareil dans les deux cas à partir du compte banque et des mensualités. La balance complète (tous
// comptes) reste dans l'onglet Statistiques plutôt que dupliquée ici — la situation intermédiaire
// ci-dessous s'en distingue : un état "à ce jour" regroupé par poste 2035 (comme Clôture), pas un
// tableau brut par compte.
export default function FinancementTab({ dossierId }: { dossierId: string }) {
  const [emprunts, setEmprunts] = useState<Emprunt[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [immobilisations, setImmobilisations] = useState<Immobilisation[]>([])
  const [cotisations, setCotisations] = useState<CotisationDeclaree[]>([])
  const [lignesBanque, setLignesBanque] = useState<LigneBanque[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Emprunt | 'new' | null>(null)
  const [echeancierDe, setEcheancierDe] = useState<Emprunt | null>(null)
  const [situationOuverte, setSituationOuverte] = useState(false)
  const [tresorerieOuverte, setTresorerieOuverte] = useState(false)
  const [dettesOuvertes, setDettesOuvertes] = useState(false)

  async function load() {
    setLoading(true)
    const [
      { data: empruntsData },
      { data: piecesData },
      { data: categoriesData },
      { data: immobilisationsData },
      { data: cotisationsData },
      { data: lignesBanqueData },
    ] = await Promise.all([
      supabase.from('emprunts').select('*').eq('dossier_id', dossierId).order('date_debut', { ascending: false }),
      supabase.from('pieces').select('*').eq('dossier_id', dossierId).eq('statut', 'validee'),
      supabase.from('categories').select('*').or(`dossier_id.eq.${dossierId},dossier_id.is.null`),
      supabase.from('immobilisations').select('*').eq('dossier_id', dossierId),
      supabase.from('cotisations_declarees').select('*').eq('dossier_id', dossierId),
      // Solde de trésorerie recalculé depuis le détail (pas juste l'agrégat "aujourd'hui") pour
      // pouvoir aussi répondre "à telle date" dans la situation intermédiaire ci-dessous — sur tout
      // l'historique du brouillon d'écritures, comme un relevé, pas borné à l'année en cours.
      supabase.from('ecritures_brouillon').select('date, sens, montant').eq('dossier_id', dossierId).eq('compte', COMPTE_BANQUE),
    ])
    setEmprunts((empruntsData ?? []) as Emprunt[])
    setPieces((piecesData ?? []) as Piece[])
    setCategories((categoriesData ?? []) as Categorie[])
    setImmobilisations((immobilisationsData ?? []) as Immobilisation[])
    setCotisations((cotisationsData ?? []) as CotisationDeclaree[])
    setLignesBanque((lignesBanqueData ?? []) as LigneBanque[])
    setLoading(false)
  }
  useEffect(() => { load() }, [dossierId])

  const soldeBanque = lignesBanque.length > 0
    ? Math.round(lignesBanque.reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100) / 100
    : 0

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
        Échéancier des emprunts, situation intermédiaire et quelques ratios utiles pour un dossier
        bancaire. La balance complète (tous comptes, sans regroupement par poste) reste dans l'onglet
        Statistiques — cet écran regroupe plutôt ce qui sert à un banquier.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="card" style={{ flex: '1 1 200px' }}>
          <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Trésorerie actuelle (banque)</span>
          <strong style={{ fontSize: '1.3rem' }}>{loading ? '—' : formatMoney(soldeBanque)}</strong>
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Situation intermédiaire</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setSituationOuverte(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Recettes, charges et résultat depuis le 1er janvier jusqu'à une date choisie, regroupés par
        poste 2035 comme dans l'onglet Clôture — un état « à ce jour » sans attendre la fin de
        l'exercice.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Plan de trésorerie</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setTresorerieOuverte(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Projection mensuelle du solde bancaire sur les prochains mois, à partir du rythme réel
        d'encaissements/décaissements observé sur l'historique — « si le rythme actuel se maintient »,
        pas un budget poste par poste.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Dettes & ratios bancaires</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setDettesOuvertes(true)}>Générer</button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Échéancier consolidé des dettes (emprunts + cotisations sociales) et deux ratios usuels pour
        un dossier bancaire : capacité de remboursement et taux d'endettement mensuel.
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Emprunts</h3>
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

      {situationOuverte && (
        <SituationIntermediaireModal
          pieces={pieces}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          lignesBanque={lignesBanque}
          onClose={() => setSituationOuverte(false)}
        />
      )}

      {tresorerieOuverte && (
        <PlanTresorerieModal
          lignesBanque={lignesBanque}
          soldeActuel={soldeBanque}
          emprunts={emprunts}
          cotisations={cotisations}
          onClose={() => setTresorerieOuverte(false)}
        />
      )}

      {dettesOuvertes && (
        <DettesRatiosModal
          pieces={pieces}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          emprunts={emprunts}
          lignesBanque={lignesBanque}
          capitalRestantTotal={capitalRestantTotal}
          mensualiteTotale={mensualiteTotale}
          onClose={() => setDettesOuvertes(false)}
        />
      )}
    </>
  )
}

function DettesRatiosModal({ pieces, categories, immobilisations, cotisations, emprunts, lignesBanque, capitalRestantTotal, mensualiteTotale, onClose }: {
  pieces: Piece[]; categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  emprunts: Emprunt[]; lignesBanque: LigneBanque[]; capitalRestantTotal: number; mensualiteTotale: number; onClose: () => void
}) {
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const debutAnnee = `${new Date().getFullYear()}-01-01`
  const moisEcoules = new Date().getMonth() + 1

  const situationAnnee = calculerSituationIntermediaire(pieces, categories, immobilisations, cotisations, debutAnnee, aujourdHui)
  // Moyenne sur 6 mois glissants, juste pour disposer d'un rythme d'encaissements de référence — les
  // réglages fins (nombre de mois, projection détaillée) restent dans la modale Plan de trésorerie.
  const plan = calculerPlanTresorerie(lignesBanque, 0, 6, 1)
  const ratios = calculerRatiosBancaires(situationAnnee, moisEcoules, capitalRestantTotal, mensualiteTotale, plan.moyenneEncaissements)

  const dansSixMois = new Date()
  dansSixMois.setMonth(dansSixMois.getMonth() + 6)
  const finPeriode = dansSixMois.toISOString().slice(0, 10)
  const echeances: EcheanceConnue[] = [
    ...echeancesEmprunts(emprunts, aujourdHui, finPeriode),
    ...echeancesCotisations(cotisations, aujourdHui, finPeriode),
  ].sort((a, b) => a.date.localeCompare(b.date))
  const totalCotisationsDues = cotisations
    .filter((c) => c.montant_verse == null)
    .reduce((s, c) => s + c.montant_appele, 0)

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(640px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Dettes & ratios bancaires</h2>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="card" style={{ flex: '1 1 170px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Dettes financières (emprunts)</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(Math.round(capitalRestantTotal * 100) / 100)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 170px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Cotisations sociales dues</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(Math.round(totalCotisationsDues * 100) / 100)}</strong>
          </div>
        </div>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0, marginBottom: 20 }}>
          CAF annuelle estimée (sur {moisEcoules} mois écoulés cette année, ramenée à 12) : <strong>{formatMoney(ratios.cafAnnuelleEstimee)}</strong>
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div className="card" style={{ flex: '1 1 220px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Capacité de remboursement</span>
            <strong style={{ fontSize: '1.2rem' }}>
              {ratios.capaciteRemboursementAnnees === null ? '—' : `${ratios.capaciteRemboursementAnnees} an${ratios.capaciteRemboursementAnnees >= 2 ? 's' : ''}`}
            </strong>
            <div className="muted" style={{ fontSize: '0.78rem' }}>Dettes financières / CAF — souvent souhaité ≤ 3-4 ans, seuil variable selon l'établissement.</div>
          </div>
          <div className="card" style={{ flex: '1 1 220px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Taux d'endettement mensuel</span>
            <strong style={{ fontSize: '1.2rem' }}>{ratios.tauxEndettementMensuel === null ? '—' : `${ratios.tauxEndettementMensuel} %`}</strong>
            <div className="muted" style={{ fontSize: '0.78rem' }}>Mensualités / moyenne des encaissements mensuels.</div>
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>Échéances des 6 prochains mois</h3>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {echeances.length === 0 ? (
            <div className="empty-state">Aucune échéance connue sur la période.</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead>
              <tbody>
                {echeances.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.libelle}</td>
                    <td>{formatMoney(e.montant)}</td>
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

function PlanTresorerieModal({ lignesBanque, soldeActuel, emprunts, cotisations, onClose }: {
  lignesBanque: LigneBanque[]; soldeActuel: number; emprunts: Emprunt[]; cotisations: CotisationDeclaree[]; onClose: () => void
}) {
  const [nbMoisHistorique, setNbMoisHistorique] = useState(6)
  const [nbMoisProjection, setNbMoisProjection] = useState(6)

  const plan = calculerPlanTresorerie(lignesBanque, soldeActuel, nbMoisHistorique, nbMoisProjection)
  const debutProjection = plan.lignes[0]?.mois ? `${plan.lignes[0].mois}-01` : new Date().toISOString().slice(0, 10)
  // "-31" plutôt que le vrai dernier jour du mois : comparaison de chaînes (YYYY-MM-DD), pas de
  // date réelle — sert seulement de borne haute, valide même pour un mois de moins de 31 jours.
  const finProjection = plan.lignes.at(-1)?.mois ? `${plan.lignes.at(-1)!.mois}-31` : debutProjection
  const echeances: EcheanceConnue[] = [
    ...echeancesEmprunts(emprunts, debutProjection, finProjection),
    ...echeancesCotisations(cotisations, debutProjection, finProjection),
  ].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Plan de trésorerie</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="tr-historique">Moyenne calculée sur (mois)</label>
            <input id="tr-historique" type="number" min="1" max="24" value={nbMoisHistorique} onChange={(e) => setNbMoisHistorique(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </div>
          <div className="field">
            <label htmlFor="tr-projection">Projeter sur (mois)</label>
            <input id="tr-projection" type="number" min="1" max="24" value={nbMoisProjection} onChange={(e) => setNbMoisProjection(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: -6 }}>
          Moyenne mensuelle observée sur les {nbMoisHistorique} derniers mois complets : {formatMoney(plan.moyenneEncaissements)} d'encaissements,{' '}
          {formatMoney(plan.moyenneDecaissements)} de décaissements — mensualités d'emprunts et cotisations déjà payées comprises, puisqu'elles
          transitent par le même compte banque.
        </p>

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginBottom: 20 }}>
          <table>
            <thead><tr><th>Mois</th><th>Solde début</th><th>Encaissements</th><th>Décaissements</th><th>Solde fin</th></tr></thead>
            <tbody>
              {plan.lignes.map((l) => (
                <tr key={l.mois}>
                  <td>{l.mois}</td>
                  <td>{formatMoney(l.soldeDebut)}</td>
                  <td>{formatMoney(l.encaissements)}</td>
                  <td>{formatMoney(l.decaissements)}</td>
                  <td style={l.soldeFin < 0 ? { color: 'var(--color-danger, #c0392b)', fontWeight: 600 } : undefined}>{formatMoney(l.soldeFin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 style={{ marginBottom: 6 }}>Échéances connues sur la période</h3>
        <p className="muted" style={{ marginTop: -4, marginBottom: 10, fontSize: '0.85rem' }}>
          À titre indicatif — déjà comprises dans la moyenne ci-dessus si l'emprunt ou la cotisation
          existe depuis plus de {nbMoisHistorique} mois. Utile surtout pour repérer un emprunt qui se
          termine bientôt ou trop récent pour être dans l'historique.
        </p>
        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {echeances.length === 0 ? (
            <div className="empty-state">Aucune échéance connue sur la période.</div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th></tr></thead>
              <tbody>
                {echeances.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.libelle}</td>
                    <td>{formatMoney(e.montant)}</td>
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

function SituationIntermediaireModal({ pieces, categories, immobilisations, cotisations, lignesBanque, onClose }: {
  pieces: Piece[]; categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  lignesBanque: LigneBanque[]; onClose: () => void
}) {
  const [dateFin, setDateFin] = useState(new Date().toISOString().slice(0, 10))
  const periodeDebut = `${new Date(dateFin).getFullYear()}-01-01`

  const situation = calculerSituationIntermediaire(pieces, categories, immobilisations, cotisations, periodeDebut, dateFin)
  const tresorerieADate = Math.round(
    lignesBanque.filter((l) => l.date <= dateFin).reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100,
  ) / 100

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(600px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Situation intermédiaire</h2>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor="situ-date">À la date du</label>
          <input id="situ-date" type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} />
        </div>
        <p className="muted" style={{ marginTop: -6 }}>
          Période du {formatDate(periodeDebut)} au {formatDate(dateFin)} — uniquement les pièces
          validées dont la catégorie a un poste 2035 renseigné (voir onglet Clôture pour compléter les
          postes manquants).
        </p>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Recettes</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.recettes)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Charges</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.charges)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Résultat intermédiaire</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(situation.resultat)}</strong>
          </div>
          <div className="card" style={{ flex: '1 1 160px' }}>
            <span className="muted" style={{ display: 'block', fontSize: '0.85rem' }}>Trésorerie à cette date</span>
            <strong style={{ fontSize: '1.2rem' }}>{formatMoney(tresorerieADate)}</strong>
          </div>
        </div>

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
          {situation.totauxParPoste.length === 0 ? (
            <div className="empty-state">Rien à afficher pour cette période.</div>
          ) : (
            <table>
              <thead><tr><th>Poste 2035</th><th>Total</th></tr></thead>
              <tbody>
                {situation.totauxParPoste.map(([poste, total]) => (
                  <tr key={poste}>
                    <td>{poste}</td>
                    <td>{formatMoney(total)}</td>
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
