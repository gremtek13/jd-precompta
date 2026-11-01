import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import BarreRecherche from '../../components/BarreRecherche'
import { useAnnee } from '../../context/AnneeContext'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { natureDuCompte } from '../../lib/affectationBanque'
import { origineDite, ouvertureDuDossier, premierJourDeLaCaisse, type SaisieDeCaisse } from '../../lib/caisse'
import {
  confirmationDuRemplacement, confirmationDuRetrait, etatDeLaCaisseLu, etatDUneOperationRetiree, euros, especesDuJour,
  fluxDAvantLOuvertureDits, FORMULAIRE_VIDE, journalDeLaCaisse, phraseDuFluxDAvantLOuverture, libelleDeLaLigne, ligneVide, nomDeLOperation, operationsRetirees,
  phraseDesEspecesDuJour, refusDuRetraitDeLOperation, soldeAuJour, TAUX_PROPOSES, totauxDuJournal, verdictDuFormulaire,
  verdictDuMois, type ContexteDeLaCaisse, type DonneesDeLaCaisse, type FormulaireDeCaisse, type GenreSaisi,
  type JourDeLaCaisse, type LigneDuJournal,
} from '../../lib/caisseEcran'
import { lireLaCaisseDuDossier, type LectureDeLaCaisseDuDossier } from '../../lib/caisseDuDossierLecture'
import type { ModeleComptable } from '../../lib/engagement'
import { anneeDe, aujourdHuiAParis, formatDate } from '../../lib/format'
import { messageErreur } from '../../lib/messageErreur'
import { PAIEMENT_PAR_LA_CAISSE_EXPORTE } from '../../lib/paiementParLaCaisse'
import { correspondALaRecherche } from '../../lib/recherche'
import { supabase } from '../../lib/supabase'
import type { Categorie, OperationCaisse } from '../../lib/types'
import type { DossierTab } from '../../lib/ongletsDossier'

// LA CAISSE D'UN DOSSIER BNC, CÔTÉ CABINET (ligne 26.6, étape C4 ; MVP-D2). La conception : HISTORIQUE.md, « LA CAISSE D'UN
// DOSSIER BNC : LA CONCEPTION », § 4 (le double compte) et § 9 (le lot C4), et « … LA CONCEPTION REPRISE », § 7 (les écrans).
// Le cabinet saisit chaque mois, depuis le brouillard que le praticien lui remet, les recettes en espèces SANS facture de
// l'application, ses apports et ses prélèvements ; le versement des espèces en banque se classe depuis la fiche du crédit,
// dans Banque ; les espèces des factures d'un dossier basculé se lisent ici, sans geste.
//
// RIEN DE LA LOGIQUE N'EST ICI. Les refus des quatre fonctions de la base, la composition de l'écriture, les soldes, l'ensemble
// des espèces d'un jour sont ceux de lib/caisse.ts (C2) ; l'assemblage de ce que l'écran lit et de ce qui part est celui de
// lib/caisseEcran.ts. L'écran appelle, affiche, et pose les verrous.
//
// LES RÈGLES DES ÉCRANS QUI S'APPLIQUENT : rien avant le retour de la lecture ; la caisse lue EN ENTIER — lue en partie, refusée
// ou rompue, l'écran le dit (`BandeauLecturePartielle`) et n'offre AUCUN geste ; la lecture gardée avec l'identifiant du dossier
// (`DossierDetail` reste monté d'un dossier à l'autre : le composant est clé par dossier) ; un geste passe la fonction SQL seule,
// sous un verrou `useRef` posé avant l'appel et relâché dans un `finally` APRÈS la relecture ; chaque refus se dit AVANT le clic,
// sur la saisie telle qu'elle part ; une confirmation nomme ce qui part.

type Message = { genre: 'ok' | 'erreur'; texte: string }

const GENRES: readonly { valeur: GenreSaisi; libelle: string }[] = [
  { valeur: 'recette', libelle: 'Recette en espèces' },
  { valeur: 'apport', libelle: 'Apport en caisse de l’exploitant' },
  { valeur: 'prelevement', libelle: 'Prélèvement en espèces de l’exploitant' },
]

// Le nombre de lignes d'une saisie d'un mois à l'ouverture : de quoi saisir sans en ajouter une à une.
const LIGNES_DU_MOIS = 3

export default function CaisseTab(props: {
  dossierId: string
  modele: ModeleComptable
  assujettiTva: boolean
  ventesParLesFactures: boolean
  onNavigate: (onglet: DossierTab) => void
}) {
  // Une clé par dossier : le formulaire, la saisie du mois et la lecture ne passent pas d'un dossier à l'autre.
  return <CaisseDuDossier key={props.dossierId} {...props} />
}

function CaisseDuDossier({ dossierId, modele, assujettiTva, ventesParLesFactures, onNavigate }: {
  dossierId: string
  modele: ModeleComptable
  assujettiTva: boolean
  ventesParLesFactures: boolean
  onNavigate: (onglet: DossierTab) => void
}) {
  const { annee } = useAnnee()
  const { anneesValidees } = useExercicesValides()
  const [lecture, setLecture] = useState<LectureDeLaCaisseDuDossier | null>(null)
  const [formulaire, setFormulaire] = useState<FormulaireDeCaisse>(FORMULAIRE_VIDE)
  // L'opération que le formulaire remplace, ou nulle : il saisit une opération neuve.
  const [remplace, setRemplace] = useState<string | null>(null)
  const [moisOuvert, setMoisOuvert] = useState(false)
  const [mois, setMois] = useState<FormulaireDeCaisse[]>(() => Array.from({ length: LIGNES_DU_MOIS }, () => FORMULAIRE_VIDE))
  const [message, setMessage] = useState<Message | null>(null)
  const [recherche, setRecherche] = useState('')
  // UN verrou pour tous les gestes qui écrivent (saisir, saisir un mois, retirer, remplacer) : deux gestes qui se croisent
  // jugeraient la caisse sur deux lectures différentes. Un `useRef`, posé avant le premier `await` : un état React laisse passer
  // deux clics du même rendu. Relâché dans un `finally`, APRÈS la relecture — sinon la liste montrerait encore ce qui vient de
  // partir, le temps qu'elle revienne.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  const formulaireRef = useRef<HTMLFormElement>(null)

  const enTresorerie = modele.mode === 'tresorerie'

  async function relire() {
    setLecture(await lireLaCaisseDuDossier(dossierId, ventesParLesFactures))
  }

  useEffect(() => {
    // En engagement la caisse ne se tient pas : rien à lire, et l'écran le dit.
    if (!enTresorerie) return undefined
    let annule = false
    lireLaCaisseDuDossier(dossierId, ventesParLesFactures).then((l) => { if (!annule) setLecture(l) })
    return () => { annule = true }
  }, [dossierId, ventesParLesFactures, enTresorerie])

  const donnees: DonneesDeLaCaisse | null = lecture !== null && lecture.etat === 'lue' ? lecture.donnees : null
  // Le jour à Paris, relu à chaque rendu : « maintenant » ne se lit jamais au chargement d'un module.
  const ctx: ContexteDeLaCaisse = { modele, assujettiTva, aujourdhui: aujourdHuiAParis(), anneesValidees }
  const etat = useMemo(() => (donnees ? etatDeLaCaisseLu(modele, donnees) : null), [donnees, modele])
  // Le journal nomme le paiement d'une pièce par son type et sa date (étape C9b), jamais par son tiers.
  const journal = useMemo(
    () => (donnees && etat ? journalDeLaCaisse(etat, donnees.operations, donnees.mouvements, donnees.piecesPayees) : []),
    [donnees, etat],
  )

  // ── Les gestes ──────────────────────────────────────────────────────────────────────────────────────────────────────

  // Un geste : le verrou, l'appel, la relecture (même sur un refus : la base répond souvent « relis la caisse »), le message.
  // `appel` rend le refus de la base en clair, ou rien quand elle a écrit.
  async function agir(appel: () => Promise<string | null>, reussite: string, echec: string, apres?: () => void) {
    // Le verrou est lu ET posé ici, avant le premier `await` : l'enveloppe de tous les gestes, qui n'ont chacun que leur refus.
    if (ecritureEnCours.current) return
    ecritureEnCours.current = true
    setEnCours(true)
    setMessage(null)
    try {
      const refus = await appel()
      if (refus !== null) {
        setMessage({ genre: 'erreur', texte: `${echec} : ${refus}` })
      } else {
        apres?.()
        setMessage({ genre: 'ok', texte: reussite })
      }
      await relire()
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Chaque fonction de la base par son propre appel, son `{ error }` lu et rendu : jamais une écriture supposée réussie.
  async function appelerEnregistrer(s: SaisieDeCaisse): Promise<string | null> {
    const { error } = await supabase.rpc('enregistrer_operation_caisse', {
      p_dossier_id: dossierId, p_genre: s.genre, p_date: s.date, p_montant: s.montant, p_categorie_id: s.categorie_id,
      p_taux_tva: s.taux_tva, p_encaissements_du_jour: s.encaissements_du_jour, p_ecritures: s.ecritures,
    })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerRemplacer(operationId: string, s: SaisieDeCaisse): Promise<string | null> {
    const { error } = await supabase.rpc('remplacer_operation_caisse', {
      p_dossier_id: dossierId, p_operation_id: operationId, p_genre: s.genre, p_date: s.date, p_montant: s.montant,
      p_categorie_id: s.categorie_id, p_taux_tva: s.taux_tva, p_encaissements_du_jour: s.encaissements_du_jour,
      p_ecritures: s.ecritures,
    })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerEnregistrerLeMois(operations: SaisieDeCaisse[]): Promise<string | null> {
    const { error } = await supabase.rpc('enregistrer_operations_de_caisse', { p_dossier_id: dossierId, p_operations: operations })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  async function appelerRetirer(operationId: string): Promise<string | null> {
    const { error } = await supabase.rpc('retirer_operation_caisse', { p_dossier_id: dossierId, p_operation_id: operationId })
    return error ? messageErreur(error, 'raison inconnue') : null
  }

  const verdict = donnees ? verdictDuFormulaire(formulaire, ctx, donnees, remplace) : null

  function dateEnregistree(date: string): string {
    const dite = formatDate(date)
    return annee !== 'toutes' && annee !== 'sans_date' && anneeDe(date) !== annee
      ? `${dite} (dans l’exercice ${anneeDe(date)}, que le sélecteur d’exercice de l’en-tête affiche)` : dite
  }

  function remettreLeFormulaire() {
    setFormulaire((f) => ({ ...FORMULAIRE_VIDE, genre: f.genre, date: f.date }))
    setRemplace(null)
  }

  async function enregistrer() {
    if (ecritureEnCours.current || !donnees || verdict === null || verdict.etat !== 'permis') return
    const s = verdict.saisie
    const ancienne = remplace == null ? null : donnees.operations.find((o) => o.id === remplace) ?? null
    if (remplace != null) {
      // La confirmation d'un remplacement nomme l'ancienne qui part et la nouvelle ; un refus ne pose aucun verrou.
      if (ancienne == null || !window.confirm(confirmationDuRemplacement(ancienne, s, donnees))) return
    }
    const date = s.date ?? ''
    await agir(
      () => (remplace == null ? appelerEnregistrer(s) : appelerRemplacer(remplace, s)),
      `${remplace == null ? 'Opération enregistrée' : 'Opération remplacée'} le ${dateEnregistree(date)}.`,
      remplace == null ? 'L’opération n’a pas été enregistrée' : 'L’opération n’a pas été remplacée',
      remettreLeFormulaire,
    )
  }

  async function enregistrerLeMois() {
    if (ecritureEnCours.current || !donnees) return
    const v = verdictDuMois(mois, ctx, donnees)
    if (v.etat !== 'permis') return
    await agir(
      () => appelerEnregistrerLeMois(v.operations),
      `${v.operations.length} opération${v.operations.length > 1 ? 's' : ''} enregistrée${v.operations.length > 1 ? 's' : ''}.`,
      'Le mois n’a pas été enregistré (rien n’est écrit : tout ou rien)',
      () => setMois(Array.from({ length: LIGNES_DU_MOIS }, () => FORMULAIRE_VIDE)),
    )
  }

  async function retirer(o: OperationCaisse) {
    if (ecritureEnCours.current || !donnees) return
    if (!window.confirm(confirmationDuRetrait(o, ctx, donnees))) return
    await agir(
      () => appelerRetirer(o.id),
      `Retiré : ${nomDeLOperation(o, donnees.categories)}.`,
      'L’opération n’a pas été retirée',
      () => { if (remplace === o.id) remettreLeFormulaire() },
    )
  }

  function preparerLeRemplacement(o: OperationCaisse) {
    if (ecritureEnCours.current) return
    setRemplace(o.id)
    setMessage(null)
    setFormulaire({
      genre: o.genre === 'apport' || o.genre === 'prelevement' ? o.genre : 'recette',
      date: o.date,
      categorieId: o.categorie_id ?? '',
      taux: o.taux_tva != null ? String(o.taux_tva) : '',
      montant: String(o.montant).replace('.', ','),
    })
    formulaireRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  // ── Ce qui s'affiche ────────────────────────────────────────────────────────────────────────────────────────────────

  if (!enTresorerie) {
    return (
      <div className="card">
        <strong>La caisse ne se tient qu’en comptabilité de trésorerie.</strong>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          Ce dossier est tenu en comptabilité d’engagement : aucune opération de caisse ne s’y saisit, et ses espèces se
          comptent comme celles d’un paiement ordinaire.
        </p>
      </div>
    )
  }

  if (lecture === null || lecture.dossierId !== dossierId) return <p className="muted">Chargement…</p>

  if (lecture.etat === 'absente') {
    return <p className="muted">La caisse n’est pas encore en base : ses migrations attendent leur application.</p>
  }

  if (lecture.etat === 'incomplete' || donnees === null || etat === null) {
    return (
      <BandeauLecturePartielle
        quoi="La caisse du dossier"
        accord="lue"
        motif={lecture.etat === 'incomplete' ? lecture.motif : 'lecture incomplète'}
        consequence="Aucun solde, aucune opération ni aucun total ne s’affichent, et rien ne s’écrit d’ici : recharge la page."
      />
    )
  }

  const categoriesDeProduit = donnees.categories.filter((c: Categorie) => natureDuCompte(c.compte_comptable) === 'recette')
  const surLAnnee = (j: JourDeLaCaisse) => annee === 'toutes' || annee === 'sans_date' || anneeDe(j.jour) === annee
  const jours = journal.filter(surLAnnee)
  const totaux = totauxDuJournal(jours)
  // Le solde à la fin de l'exercice affiché, ou le dernier connu.
  const borne = annee === 'toutes' || annee === 'sans_date' ? '9999-12-31' : `${annee}-12-31`
  const solde = soldeAuJour(etat, borne)
  const lignesVisibles = (j: JourDeLaCaisse): LigneDuJournal[] => j.lignes.filter((l) =>
    correspondALaRecherche([formatDate(j.jour), j.jour, libelleDeLaLigne(l, donnees.categories), Math.abs(l.centimes) / 100], recherche))
  const joursAffiches = jours.map((j) => ({ jour: j, lignes: lignesVisibles(j) })).filter((x) => x.lignes.length > 0)
  const nbLignes = jours.reduce((n, j) => n + j.lignes.length, 0)
  const nbAffichees = joursAffiches.reduce((n, x) => n + x.lignes.length, 0)

  const recette = formulaire.genre === 'recette'
  const especes = recette && formulaire.date !== '' ? especesDuJour(etat, formulaire.date) : []
  const phraseDesEspeces = phraseDesEspecesDuJour(especes)
  const operationsPleines = mois.filter((l) => !ligneVide(l)).length
  const verdictDuMoisCourant = verdictDuMois(mois, ctx, donnees)
  const retirees = operationsRetirees(donnees.operations)
  // LES FLUX D'AVANT L'OUVERTURE (étape C9b ; le défaut K1) : la migration `paiement_par_la_caisse` borne la caisse en base
  // comme l'écran la borne ; avec elle, l'onglet dit ce que le journal ne compte pas, et ce qu'il compte à tort. Sans elle, la
  // base compte encore ce qui précède : l'écran se tait, comme hier.
  const avantLOuverture = PAIEMENT_PAR_LA_CAISSE_EXPORTE ? fluxDAvantLOuvertureDits(etat, donnees) : []
  const jourDeLOuverture = premierJourDeLaCaisse(etat) ?? ouvertureDuDossier(etat)

  function champ<K extends keyof FormulaireDeCaisse>(cle: K, valeur: FormulaireDeCaisse[K]) {
    setFormulaire((f) => ({ ...f, [cle]: valeur }))
  }

  function champDuMois(i: number, cle: keyof FormulaireDeCaisse, valeur: string) {
    setMois((lignes) => lignes.map((l, j) => (j === i ? { ...l, [cle]: valeur } : l)))
  }

  const choixDeCategorie = (valeur: string, surChangement: (v: string) => void, id: string, libelle: string) => (
    <select id={id} aria-label={libelle} value={valeur} onChange={(e) => surChangement(e.target.value)}>
      <option value="">Choisir une catégorie…</option>
      {categoriesDeProduit.map((c: Categorie) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
    </select>
  )

  const choixDeTaux = (valeur: string, surChangement: (v: string) => void, id: string, libelle: string) => (
    <select id={id} aria-label={libelle} value={valeur} onChange={(e) => surChangement(e.target.value)}>
      <option value="">Choisir un taux…</option>
      {TAUX_PROPOSES.map((t) => <option key={t.valeur} value={String(t.valeur)}>{t.libelle}</option>)}
    </select>
  )

  return (
    <>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        La caisse du dossier : les recettes en espèces du praticien qui n’ont pas de facture dans l’application, ses apports
        et ses prélèvements — saisis depuis son brouillard de caisse, le détail restant chez lui. Aucun nom ici : un total par
        jour et par nature. Un versement d’espèces en banque se classe depuis la fiche du crédit, dans l’onglet Banque.{' '}
        <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('banque')}>Ouvrir Banque</button>
      </p>

      {message && (
        <p className={message.genre === 'erreur' ? 'error-text' : 'muted'} role={message.genre === 'erreur' ? 'alert' : 'status'}>
          {message.texte}
        </p>
      )}

      <div className="stat-grid">
        <div className="card">
          <span className="muted" style={{ display: 'block' }}>
            Solde de la caisse{annee !== 'toutes' && annee !== 'sans_date' ? ` à la fin de ${annee}` : ''}
          </span>
          <strong style={{ fontSize: '1.3rem' }}>{euros(solde)}</strong>
        </div>
        <div className="card">
          <span className="muted" style={{ display: 'block' }}>Recettes en espèces</span>
          <strong style={{ fontSize: '1.3rem' }}>{euros(totaux.recettes)}</strong>
        </div>
        <div className="card">
          <span className="muted" style={{ display: 'block' }}>Prélèvements de l’exploitant</span>
          <strong style={{ fontSize: '1.3rem' }}>{euros(totaux.prelevements)}</strong>
        </div>
        <div className="card">
          <span className="muted" style={{ display: 'block' }}>Versements en banque</span>
          <strong style={{ fontSize: '1.3rem' }}>{euros(totaux.versements)}</strong>
        </div>
      </div>

      {/* Un vrai formulaire : « Entrée » dans un champ l'envoie, et son nom le distingue des gestes du journal. */}
      <form
        className="card" ref={formulaireRef} style={{ marginBottom: 20 }} aria-label="Saisie d’une opération"
        onSubmit={(e) => { e.preventDefault(); void enregistrer() }}
      >
        <strong>
          {remplace != null && donnees.operations.find((o) => o.id === remplace)
            ? `Remplacer ${nomDeLOperation(donnees.operations.find((o) => o.id === remplace)!, donnees.categories)}`
            : 'Saisir une opération'}
        </strong>
        <div className="field-row aligne-bas" style={{ marginTop: 10 }}>
          <div className="field">
            <label htmlFor="caisse-genre">Nature</label>
            <select
              id="caisse-genre"
              value={formulaire.genre}
              onChange={(e) => champ('genre', e.target.value as GenreSaisi)}
            >
              {GENRES.map((g) => <option key={g.valeur} value={g.valeur}>{g.libelle}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="caisse-date">Jour</label>
            <input id="caisse-date" type="date" value={formulaire.date} onChange={(e) => champ('date', e.target.value)} />
          </div>
          {recette && (
            <div className="field">
              <label htmlFor="caisse-categorie">Catégorie de produit</label>
              {choixDeCategorie(formulaire.categorieId, (v) => champ('categorieId', v), 'caisse-categorie', 'Catégorie de produit')}
            </div>
          )}
          {recette && assujettiTva && (
            <div className="field">
              <label htmlFor="caisse-taux">Taux de TVA</label>
              {choixDeTaux(formulaire.taux, (v) => champ('taux', v), 'caisse-taux', 'Taux de TVA')}
            </div>
          )}
          <div className="field">
            <label htmlFor="caisse-montant">{recette ? 'Montant du jour (TTC)' : 'Montant'}</label>
            <input
              id="caisse-montant"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={recette ? 'ex. 485,00' : 'ex. 100,00'}
              value={formulaire.montant}
              onChange={(e) => champ('montant', e.target.value)}
            />
          </div>
        </div>
        {recette && (
          <p className="muted" style={{ margin: '0 0 8px' }}>
            Le total des espèces reçues ce jour-là, pour cette nature et ce taux, tel que le brouillard du praticien le porte
            — sans les règlements en espèces des factures de l’application, que la caisse compte déjà. Des espèces rendues se
            saisissent en négatif.
          </p>
        )}
        {phraseDesEspeces && <p className="fiche-mouvement-alerte">{phraseDesEspeces}</p>}
        {verdict !== null && (verdict.etat === 'refuse' || verdict.etat === 'illisible') && (
          <p className="error-text" role="alert">{verdict.message}</p>
        )}
        <div className="fiche-mouvement-boutons" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={enCours || verdict === null || verdict.etat !== 'permis'}
          >
            {enCours ? 'Écriture…' : remplace == null ? 'Enregistrer' : 'Remplacer'}
          </button>
          {remplace != null && (
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours} onClick={remettreLeFormulaire}>
              Annuler le remplacement
            </button>
          )}
        </div>
      </form>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <strong>Saisir un mois</strong>
          <button type="button" className="btn btn-outline btn-sm" aria-expanded={moisOuvert} onClick={() => setMoisOuvert((o) => !o)}>
            {moisOuvert ? 'Replier' : 'Saisir un mois…'}
          </button>
        </div>
        {moisOuvert && (
          <>
            <p className="muted" style={{ margin: '8px 0' }}>
              Plusieurs opérations d’un coup, depuis le brouillard du mois : tout ou rien. Si une ligne est refusée, aucune
              n’est écrite, et le refus nomme son rang et son jour.
            </p>
            <div className="tableau-adaptable">
              <table className="table-formulaire table-empilable">
                <thead>
                  <tr>
                    <th>Nature</th><th>Jour</th><th>Catégorie</th>{assujettiTva && <th>Taux</th>}<th>Montant</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {mois.map((l, i) => (
                    <tr key={i}>
                      <td data-libelle="Nature">
                        <select aria-label={`Nature de la ligne ${i + 1}`} value={l.genre} onChange={(e) => champDuMois(i, 'genre', e.target.value)}>
                          {GENRES.map((g) => <option key={g.valeur} value={g.valeur}>{g.libelle}</option>)}
                        </select>
                      </td>
                      <td data-libelle="Jour">
                        <input aria-label={`Jour de la ligne ${i + 1}`} type="date" value={l.date} onChange={(e) => champDuMois(i, 'date', e.target.value)} />
                      </td>
                      <td data-libelle="Catégorie">
                        {l.genre === 'recette'
                          ? choixDeCategorie(l.categorieId, (v) => champDuMois(i, 'categorieId', v), `caisse-mois-categorie-${i}`, `Catégorie de la ligne ${i + 1}`)
                          : <span className="muted">—</span>}
                      </td>
                      {assujettiTva && (
                        <td data-libelle="Taux">
                          {l.genre === 'recette'
                            ? choixDeTaux(l.taux, (v) => champDuMois(i, 'taux', v), `caisse-mois-taux-${i}`, `Taux de la ligne ${i + 1}`)
                            : <span className="muted">—</span>}
                        </td>
                      )}
                      <td data-libelle="Montant">
                        <input
                          aria-label={`Montant de la ligne ${i + 1}`} type="text" inputMode="decimal" autoComplete="off"
                          value={l.montant} onChange={(e) => champDuMois(i, 'montant', e.target.value)}
                        />
                      </td>
                      <td className="td-boutons">
                        <button
                          type="button" className="btn btn-outline btn-sm" disabled={enCours || mois.length === 1}
                          onClick={() => setMois((lignes) => lignes.filter((_, j) => j !== i))}
                        >
                          Retirer la ligne
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(verdictDuMoisCourant.etat === 'refuse' || verdictDuMoisCourant.etat === 'illisible') && (
              <p className="error-text" role="alert">{verdictDuMoisCourant.message}</p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              <button
                type="button" className="btn btn-outline btn-sm" disabled={enCours}
                onClick={() => setMois((lignes) => [...lignes, { ...FORMULAIRE_VIDE, genre: lignes.at(-1)?.genre ?? 'recette', date: lignes.at(-1)?.date ?? '' }])}
              >
                Ajouter une ligne
              </button>
              <button
                type="button" className="btn btn-primary btn-sm"
                disabled={enCours || verdictDuMoisCourant.etat !== 'permis'}
                onClick={enregistrerLeMois}
              >
                {enCours ? 'Écriture…' : `Enregistrer le mois (${operationsPleines} opération${operationsPleines > 1 ? 's' : ''})`}
              </button>
            </div>
          </>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un jour, une nature, un montant…"
          affiches={nbAffichees}
          total={nbLignes}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {joursAffiches.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucune ligne de la caisse ne correspond à « ${recherche.trim()} ».`
              : 'Aucune opération dans la caisse pour cet exercice.'}
          </div>
        ) : (
          <div className="tableau-adaptable">
            <table className="table-empilable-etroite table-empilable">
              <thead>
                <tr><th>Nature</th><th>Entrée</th><th>Sortie</th><th></th></tr>
              </thead>
              <tbody>
                {joursAffiches.map(({ jour, lignes }) => (
                  <Fragment key={jour.jour}>
                  <tr className="caisse-jour">
                    <td colSpan={4}>
                      <strong>{formatDate(jour.jour)}</strong>
                      <span className="muted"> — solde de la caisse en fin de journée : </span>
                      <strong>{euros(jour.solde)}</strong>
                    </td>
                  </tr>
                  {lignes.map((l, i) => {
                    const o = l.nature === 'operation' ? l.operation : null
                    const gestes = o !== null && (o.genre === 'recette' || o.genre === 'apport' || o.genre === 'prelevement')
                    const refusDuRetrait = o !== null && gestes ? refusDuRetraitDeLOperation(o.id, ctx, donnees) : null
                    const origine = o !== null ? origineDite(o) : null
                    return (
                      <tr key={`${jour.jour}-${l.nature}-${o?.id ?? i}`}>
                        <td data-libelle="Nature">
                          {/* Un seul enfant : repliée en fiche (téléphone), la cellule est un `flex` dont chaque enfant se partage la
                              place — le texte et ses pastilles, séparés, laissaient au texte une colonne si étroite qu'un mot s'y coupait. */}
                          <div>
                            {libelleDeLaLigne(l, donnees.categories)}
                            {origine && <> <span className="badge badge-neutral">{origine}</span></>}
                            {o !== null && o.remplace_id != null && <> <span className="badge badge-neutral">Remplace une version retirée</span></>}
                            {l.nature === 'encaissement' && <> <span className="badge badge-neutral">Comptée par la facture</span></>}
                            {o !== null && o.genre === 'paiement' && <> <span className="badge badge-neutral">Se retire depuis la fiche de la pièce</span></>}
                          </div>
                        </td>
                        <td data-libelle="Entrée">{l.centimes > 0 ? euros(l.centimes) : ''}</td>
                        <td data-libelle="Sortie">{l.centimes < 0 ? euros(-l.centimes) : ''}</td>
                        <td className="td-boutons">
                          {o !== null && gestes && (
                            <>
                              <button
                                type="button" className="btn btn-outline btn-sm"
                                disabled={enCours || refusDuRetrait != null}
                                title={refusDuRetrait ?? undefined}
                                onClick={() => retirer(o)}
                              >
                                Retirer
                              </button>
                              <button
                                type="button" className="btn btn-outline btn-sm"
                                disabled={enCours}
                                onClick={() => preparerLeRemplacement(o)}
                              >
                                Remplacer
                              </button>
                              {refusDuRetrait != null && <span className="muted">{refusDuRetrait}</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {avantLOuverture.length > 0 && jourDeLOuverture !== null && (
        <div className="card" style={{ marginTop: 20 }}>
          <strong>Avant l’ouverture du dossier</strong>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            {avantLOuverture.map((f, i) => (
              <li key={`${f.jour}-${i}`} className={f.compte ? 'error-text' : undefined}>
                {phraseDuFluxDAvantLOuverture(f, jourDeLOuverture)}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Un mouvement du relevé se retire de la caisse depuis sa fiche, dans l’onglet Banque (« Remettre à traiter »).
          </p>
        </div>
      )}

      {retirees.length > 0 && (
        <details className="card" style={{ marginTop: 20 }}>
          <summary>Opérations retirées ou remplacées ({retirees.length})</summary>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
            {retirees.map((o) => (
              <li key={o.id}>
                {nomDeLOperation(o, donnees.categories, null)} — {etatDUneOperationRetiree(o, donnees.operations)}
                {origineDite(o) ? ` (${origineDite(o)})` : ''}
              </li>
            ))}
          </ul>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Elles ne comptent plus dans la caisse : leur écriture est retirée avec elles. Rien ne se supprime.
          </p>
        </details>
      )}
    </>
  )
}
