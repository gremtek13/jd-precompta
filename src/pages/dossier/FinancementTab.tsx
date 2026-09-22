import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { ajouterMois, anneeDe, aujourdHuiSql, formatDate, formatMoney } from '../../lib/format'
import { COMPTE_BANQUE } from '../../lib/comptes'
import { capitalRestantDu, empruntActif, genererEcheancier, type Emprunt } from '../../lib/emprunts'
import { calculerSituationIntermediaire, moisEcoulesDeLAnnee } from '../../lib/situationIntermediaire'
import { calculerPlanTresorerie, echeancesCotisations, echeancesEmprunts, reserveSurMoyenne, reserveSurSolde, type EcheanceConnue } from '../../lib/planTresorerie'
import { calculerRatiosBancaires } from '../../lib/ratiosBancaires'
import { calculerPrevisionnel, type PrevisionnelBancaire } from '../../lib/previsionnel'
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
  const [piecesValidees, setPiecesValidees] = useState<Piece[]>([])
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
  const [previsionnel, setPrevisionnel] = useState<PrevisionnelBancaire | null>(null)
  // Non nul = on ne SAIT PAS s'il existe un prévisionnel enregistré. Distinct de « il n'y en a
  // pas » : l'enregistrement est un upsert qui porte TOUS les champs (voir PrevisionnelModal).
  const [previsionnelIllisible, setPrevisionnelIllisible] = useState<string | null>(null)
  const [previsionnelOuvert, setPrevisionnelOuvert] = useState(false)

  async function load() {
    setLoading(true)
    const [
      lectureEmprunts,
      lecturePieces,
      lectureCategories,
      lectureImmobilisations,
      lectureCotisations,
      lectureBanque,
      { data: previsionnelData, error: previsionnelError },
    ] = await Promise.all([
      lireTout<Emprunt>((debut, fin) =>
        supabase.from('emprunts').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('date_debut', { ascending: false }).order('id').range(debut, fin),
      ),
      // Lues par tranches (voir lib/lectureComplete.ts) : recettes et charges font la situation
      // intermédiaire, les ratios bancaires et le plan de trésorerie — trois chiffres qu'un banquier
      // regarde.
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('statut', 'validee').order('id').range(debut, fin),
      ),
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<Immobilisation>((debut, fin) =>
        supabase.from('immobilisations').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<CotisationDeclaree>((debut, fin) =>
        supabase.from('cotisations_declarees').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      // Solde de trésorerie recalculé depuis le détail (pas juste l'agrégat "aujourd'hui") pour
      // pouvoir aussi répondre "à telle date" dans la situation intermédiaire ci-dessous — sur tout
      // l'historique du brouillon d'écritures, comme un relevé, pas borné à l'année en cours.
      lireTout<{ date: string; sens: string; montant: number }>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('date, sens, montant', { count: 'exact' })
          .eq('dossier_id', dossierId).eq('compte', COMPTE_BANQUE).order('id').range(debut, fin),
      ),
      // QUATRIÈME COPIE DE « LECTURE → FORMULAIRE → UPSERT DE TOUS LES CHAMPS », par la porte que
      // le scanner ne regardait pas : une entrée de `Promise.all` s'écrit sans `await`. Les trois
      // premières (InformationsTab, ClientInformations, CabinetBrandingPage) sont corrigées depuis
      // le 21/09/2026 ; celle-ci jetait encore son erreur, donc une lecture refusée rendait
      // `previsionnel` nul — exactement l'écran d'un dossier qui n'a jamais rien enregistré, bouton
      // « Générer » compris — et le premier enregistrement écrasait les deux taux ET
      // `note_hypotheses`, du texte libre que personne ne relit donc que personne ne verrait partir.
      supabase.from('previsionnels_bancaires').select('*').eq('dossier_id', dossierId).maybeSingle(),
    ])
    setEmprunts(lectureEmprunts.lignes)
    setPiecesValidees(lecturePieces.lignes)
    setCategories(lectureCategories.lignes)
    setImmobilisations(lectureImmobilisations.lignes)
    setCotisations(lectureCotisations.lignes)
    setLignesBanque(lectureBanque.lignes as LigneBanque[])
    setPrevisionnelIllisible(previsionnelError ? messageErreur(previsionnelError, "Le prévisionnel enregistré n'a pas pu être lu.") : null)
    setPrevisionnel((previsionnelData ?? null) as PrevisionnelBancaire | null)
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Prévisionnel à 3 ans</h3>
        <button
          className="btn btn-outline btn-sm" onClick={() => setPrevisionnelOuvert(true)}
          disabled={!!previsionnelIllisible}
        >
          {previsionnel ? 'Modifier' : 'Générer'}
        </button>
      </div>
      <p className="muted" style={{ marginTop: -4, marginBottom: 26 }}>
        Projection sur 3 ans par taux de croissance annuel, à partir d'un CA et de charges de
        référence — les hypothèses restent celles du cabinet, jamais devinées par l'application.
        {previsionnel && (
          <> Dernière hypothèse enregistrée : {previsionnel.taux_croissance_ca} % CA / {previsionnel.taux_croissance_charges} % charges par an.</>
        )}
      </p>
      {previsionnelIllisible && (
        <p className="error-text" style={{ marginTop: -20, marginBottom: 26 }}>
          {previsionnelIllisible} Le formulaire reste fermé : il s'enregistre en remplaçant tous ses
          champs, note d'hypothèses comprise, donc l'ouvrir sans avoir lu ce qui existe reviendrait à
          l'effacer. Ce n'est pas « aucun prévisionnel », c'est « on ne sait pas ».
        </p>
      )}

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
          piecesValidees={piecesValidees}
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
          piecesValidees={piecesValidees}
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

      {previsionnelOuvert && (
        <PrevisionnelModal
          dossierId={dossierId}
          previsionnel={previsionnel}
          piecesValidees={piecesValidees}
          categories={categories}
          immobilisations={immobilisations}
          cotisations={cotisations}
          onClose={() => setPrevisionnelOuvert(false)}
          onSaved={load}
        />
      )}
    </>
  )
}

function DettesRatiosModal({ piecesValidees, categories, immobilisations, cotisations, emprunts, lignesBanque, capitalRestantTotal, mensualiteTotale, onClose }: {
  piecesValidees: Piece[]; categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  emprunts: Emprunt[]; lignesBanque: LigneBanque[]; capitalRestantTotal: number; mensualiteTotale: number; onClose: () => void
}) {
  const aujourdHui = aujourdHuiSql()
  const debutAnnee = `${new Date().getFullYear()}-01-01`
  // Les mois RÉELLEMENT écoulés, et non le numéro du mois courant : c'est le diviseur qui annualise
  // la CAF, et l'étiquette qui l'annonce juste en dessous (voir moisEcoulesDeLAnnee).
  const moisEcoules = moisEcoulesDeLAnnee(aujourdHui)

  const situationAnnee = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, debutAnnee, aujourdHui)
  // Moyenne sur 6 mois glissants, juste pour disposer d'un rythme d'encaissements de référence — les
  // réglages fins (nombre de mois, projection détaillée) restent dans la modale Plan de trésorerie.
  const plan = calculerPlanTresorerie(lignesBanque, 0, 6, 1)
  const ratios = calculerRatiosBancaires(situationAnnee, moisEcoules, capitalRestantTotal, mensualiteTotale, plan.moyenneEncaissements)
  // Le « — » du taux d'endettement ne dit pas POURQUOI : sans cette réserve, « pas encore assez
  // d'historique » et « le rythme est à zéro » se lisent pareil, sur un ratio qu'une banque regarde
  // en premier.
  const reserveMoyenne = reserveSurMoyenne(plan)

  const finPeriode = ajouterMois(aujourdHui, 6)
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
          CAF annuelle estimée (sur {moisEcoules.toFixed(1).replace('.', ',')} mois écoulés cette année,
          ramenée à 12) : <strong>{ratios.cafAnnuelleEstimee === 0 ? '—' : formatMoney(ratios.cafAnnuelleEstimee)}</strong>
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
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Mensualités / moyenne des encaissements mensuels des 6 derniers mois complets.
              {reserveMoyenne && <span style={{ color: 'var(--color-danger, #c0392b)' }}> {reserveMoyenne}</span>}
            </div>
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
  // Une projection bâtie sur rien a exactement la même tête qu'une projection bâtie sur six mois.
  const reserve = reserveSurMoyenne(plan)
  // Et le solde de DÉPART vient de la même source, sur une fenêtre plus large : tout l'historique.
  const reserveSolde = reserveSurSolde(lignesBanque)
  // UNE SEULE RÉSERVE À L'ÉCRAN, et l'ordre n'est pas arbitraire : un historique VIDE implique une
  // fenêtre vide, donc les deux se déclenchent ensemble et pour la même cause. Les afficher toutes
  // deux répéterait la même phrase en rouge sous elle-même — et une mise en garde qu'on répète cesse
  // d'être lue. Celle du solde est la plus complète : elle couvre le solde de départ ET la moyenne.
  // Le cas « fenêtre partielle » n'a, lui, aucun équivalent côté solde, donc il reste dit.
  const reserveAffichee = reserveSolde ?? reserve
  const debutProjection = plan.lignes[0]?.mois ? `${plan.lignes[0].mois}-01` : aujourdHuiSql()
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
        {reserveAffichee && (
          <p className="muted" style={{ marginTop: -4, color: 'var(--color-danger, #c0392b)' }}>{reserveAffichee}</p>
        )}

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

function SituationIntermediaireModal({ piecesValidees, categories, immobilisations, cotisations, lignesBanque, onClose }: {
  piecesValidees: Piece[]; categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  lignesBanque: LigneBanque[]; onClose: () => void
}) {
  const [dateFin, setDateFin] = useState(aujourdHuiSql())
  const periodeDebut = `${anneeDe(dateFin)}-01-01`

  const situation = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, periodeDebut, dateFin)
  const tresorerieADate = Math.round(
    lignesBanque.filter((l) => l.date <= dateFin).reduce((s, l) => s + (l.sens === 'debit' ? l.montant : -l.montant), 0) * 100,
  ) / 100
  // « 0,00 € » est juste quand rien n'est comptabilisé, et c'est ce qui le rend dangereux.
  const reserveSolde = reserveSurSolde(lignesBanque)

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
          postes manquants). La dotation aux amortissements est rapportée à la période, et un bien
          acquis après cette date n'y figure pas.
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
        {reserveSolde && (
          <p className="muted" style={{ marginTop: -6, marginBottom: 16, color: 'var(--color-danger, #c0392b)' }}>{reserveSolde}</p>
        )}

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

function PrevisionnelModal({ dossierId, previsionnel, piecesValidees, categories, immobilisations, cotisations, onClose, onSaved }: {
  dossierId: string; previsionnel: PrevisionnelBancaire | null
  piecesValidees: Piece[]; categories: Categorie[]; immobilisations: Immobilisation[]; cotisations: CotisationDeclaree[]
  onClose: () => void; onSaved: () => void
}) {
  const anneeParDefaut = new Date().getFullYear() - 1
  const [anneeReference, setAnneeReference] = useState(previsionnel?.annee_reference ?? anneeParDefaut)
  const [caReference, setCaReference] = useState(String(previsionnel?.ca_reference ?? 0))
  const [chargesReference, setChargesReference] = useState(String(previsionnel?.charges_reference ?? 0))
  const [tauxCa, setTauxCa] = useState(String(previsionnel?.taux_croissance_ca ?? 0))
  const [tauxCharges, setTauxCharges] = useState(String(previsionnel?.taux_croissance_charges ?? 0))
  const [note, setNote] = useState(previsionnel?.note_hypotheses ?? '')
  const [saving, setSaving] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Simple point de départ, jamais enregistré tel quel — réutilise le même calcul que la situation
  // intermédiaire (voir plus haut) sur une année civile complète, pour préremplir CA et charges de
  // référence sans resaisir depuis Clôture. Le cabinet reste libre d'ajuster avant d'enregistrer.
  function precharger() {
    const situation = calculerSituationIntermediaire(piecesValidees, categories, immobilisations, cotisations, `${anneeReference}-01-01`, `${anneeReference}-12-31`)
    setCaReference(String(situation.recettes))
    setChargesReference(String(situation.charges))
  }

  const lignes = calculerPrevisionnel(
    anneeReference, parseFloat(caReference) || 0, parseFloat(chargesReference) || 0,
    parseFloat(tauxCa) || 0, parseFloat(tauxCharges) || 0,
  )

  async function enregistrer() {
    setSaving(true)
    setErreur(null)
    const { error } = await supabase.from('previsionnels_bancaires').upsert({
      dossier_id: dossierId,
      annee_reference: anneeReference,
      ca_reference: parseFloat(caReference) || 0,
      charges_reference: parseFloat(chargesReference) || 0,
      taux_croissance_ca: parseFloat(tauxCa) || 0,
      taux_croissance_charges: parseFloat(tauxCharges) || 0,
      note_hypotheses: note.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'dossier_id' })
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
      <div className="card" style={{ width: 'min(680px, 92vw)', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Prévisionnel à 3 ans</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          Projection simple par taux de croissance annuel uniforme, à partir d'une année de référence —
          les hypothèses restent celles du cabinet, jamais devinées par l'application.
        </p>

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-annee">Année de référence</label>
            <input id="prev-annee" type="number" value={anneeReference} onChange={(e) => setAnneeReference(parseInt(e.target.value, 10) || anneeParDefaut)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 14 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={precharger}>Précharger depuis cette année</button>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-ca">CA de référence (€)</label>
            <input id="prev-ca" type="number" step="0.01" value={caReference} onChange={(e) => setCaReference(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prev-charges">Charges de référence (€)</label>
            <input id="prev-charges" type="number" step="0.01" value={chargesReference} onChange={(e) => setChargesReference(e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="prev-taux-ca">Croissance CA (%/an)</label>
            <input id="prev-taux-ca" type="number" step="0.1" value={tauxCa} onChange={(e) => setTauxCa(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="prev-taux-charges">Croissance charges (%/an)</label>
            <input id="prev-taux-charges" type="number" step="0.1" value={tauxCharges} onChange={(e) => setTauxCharges(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="prev-note">Note d'hypothèses</label>
          <textarea
            id="prev-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="ex. Croissance portée par l'ouverture d'un nouveau secteur au T2, hausse tarifaire prévue en année 2…"
          />
        </div>

        <div className="table-scroll" style={{ border: '1px solid var(--color-border)', borderRadius: 8, marginTop: 10, marginBottom: 16 }}>
          <table>
            <thead><tr><th>Année</th><th>CA prévisionnel</th><th>Charges prévisionnelles</th><th>Résultat prévisionnel</th></tr></thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.annee}>
                  <td>{l.annee}</td>
                  <td>{formatMoney(l.ca)}</td>
                  <td>{formatMoney(l.charges)}</td>
                  <td>{formatMoney(l.resultat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {erreur && <p className="error-text">{erreur}</p>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Fermer</button>
          <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer les hypothèses'}
          </button>
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
  const [dateDebut, setDateDebut] = useState(emprunt?.date_debut ?? aujourdHuiSql())
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
