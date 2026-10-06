import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { anneeDe, aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { correspondALaRecherche } from '../../lib/recherche'
import { calculerBalance } from '../../lib/ecritures'
import { calculerEvolutionMensuelle } from '../../lib/tableauPilotage'
import { messageErreur } from '../../lib/messageErreur'
import type { ANouveau, Categorie, EcritureBrouillon, LettrageManuel, ModeComptable, Piece } from '../../lib/types'
import {
  comptesDeTiers, COMPTES_LETTRABLES, etatsDesLettragesManuels, lettragesProposes, refusLettrageManuel,
  type EtatLettrageManuel,
} from '../../lib/lettrage'
import { useAnnee } from '../../context/AnneeContext'
import type { DossierTab } from '../../components/DossierParcours'
import MonthlyBars from '../../components/widgets/MonthlyBars'
import ProgressRing from '../../components/widgets/ProgressRing'
import BarreRecherche from '../../components/BarreRecherche'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import { lireTout } from '../../lib/lectureComplete'
import ComptesDeTiersCard from './ComptesDeTiersCard'

const NB_MOIS_EVOLUTION = 6

// Balance des comptes (anciennement "Statistiques", renommé pour dire ce que l'écran affiche
// réellement — voir audit ergonomie comparatif) — vue transversale sur tout le brouillon (voir
// EcrituresTab, qui ne montre le journal que ligne à ligne, pièce par pièce) : un compte par ligne,
// avec son nombre d'écritures et ses totaux débit/crédit, pour repérer d'un coup d'œil un solde
// anormal (une charge créditrice, un compte oublié...) sans dérouler tout le journal. Toujours
// calculée depuis le même brouillon que EcrituresTab, jamais une comptabilité tenue à part (voir
// BrouillonBanner ailleurs dans l'onglet Écritures — même statut ici, juste pas répété pour ne pas
// surcharger un onglet de lecture).
export default function StatistiquesTab({ dossierId, onNavigate, modeComptable }: {
  dossierId: string
  onNavigate: (tab: DossierTab) => void
  // En engagement, l'écran porte en plus les comptes de tiers à une date (lib/lettrage.ts). Sans valeur par défaut :
  // oublié, un dossier en engagement perdrait sa balance âgée sans que rien le dise.
  modeComptable: ModeComptable
}) {
  const [ecritures, setEcritures] = useState<EcritureBrouillon[]>([])
  const [categories, setCategories] = useState<Categorie[]>([])
  const [pieces, setPieces] = useState<Piece[]>([])
  // L'ouverture d'un dossier repris d'un autre logiciel (voir lib/aNouveaux.ts).
  const [aNouveaux, setANouveaux] = useState<ANouveau[]>([])
  const [loading, setLoading] = useState(true)
  // Non nul quand le brouillon n'a pas pu être lu en entier — les totaux affichés portent alors sur une partie du
  // dossier (voir lib/lectureComplete.ts).
  const [lectureIncomplete, setLectureIncomplete] = useState<string | null>(null)
  // À part, parce que la conséquence n'est pas la même : les pièces ne servent qu'à l'avancement de l'année et, en
  // engagement, au nom des tiers. Elles étaient fondues dans le drapeau du brouillon, dont le bandeau disait alors que
  // les ÉCRITURES n'avaient pas pu être lues quand c'étaient les pièces.
  const [lecturePiecesIncomplete, setLecturePiecesIncomplete] = useState<string | null>(null)
  // À part, parce que la conséquence n'est pas la même : les catégories ne donnent que les LIBELLÉS
  // des comptes, aucun montant n'en dépend.
  const [lectureCategoriesIncomplete, setLectureCategoriesIncomplete] = useState<string | null>(null)
  // À part encore : ce n'est pas le brouillon qui manque, c'est l'ouverture — le bandeau doit dire
  // laquelle des deux on n'a pas pu lire.
  const [lectureANouveauxIncomplete, setLectureANouveauxIncomplete] = useState<string | null>(null)
  // Les lettrages faits à la main (ligne 32, seconde brique) : une facture et l'avoir qui la solde, sans mouvement
  // bancaire. Lus en partie, la carte des comptes de tiers ne conclut pas — une facture lettrée y paraîtrait ouverte.
  const [lettragesManuels, setLettragesManuels] = useState<LettrageManuel[]>([])
  const [lectureLettragesIncomplete, setLectureLettragesIncomplete] = useState<string | null>(null)
  // Verrou d'exécution du lettrage à la main et de son retrait : un état React ne prend effet qu'au rendu suivant, et
  // deux clics du même rendu enverraient deux fois le même lettrage — le second refusé par la base, avec un message
  // d'erreur sur un lettrage bien enregistré. Relâché APRÈS la relecture : avant, les pièces qu'on vient de lettrer
  // paraîtraient encore ouvertes, et un clic de plus les relettrerait.
  const lettrageEnCours = useRef(false)
  const [lettrageOccupe, setLettrageOccupe] = useState(false)
  const [erreurLettrage, setErreurLettrage] = useState<string | null>(null)
  // Exercice partagé avec Pièces/Banque/Écritures/Clôture, sélectionné dans l'en-tête du dossier
  // (voir AnneeContext) — pas de sélecteur local ici.
  const { annee: anneeFilter } = useAnnee()
  const [recherche, setRecherche] = useState('')

  // Le premier rendu porte déjà `loading` ; une relecture après un lettrage garde la vue affichée le temps qu'elle
  // revienne, le verrou retenant tout geste jusque-là. L'onglet se remonte d'un dossier à l'autre (`key` du dossier).
  const charger = useCallback(async () => {
    const [brouillon, lectureCategories, lecturePieces, lectureANouveaux, lectureLettrages] = await Promise.all([
      // Lues par tranches, triées sur un ordre TOTAL : PostgREST plafonne le nombre de lignes
      // rendues sans le signaler, et cet écran affiche des TOTAUX (voir lib/lectureComplete.ts).
      // Une balance calculée sur une partie du brouillon serait déséquilibrée sans raison visible —
      // exactement le badge rouge « écart … » qu'on a déjà appris à ne pas fabriquer par accident.
      lireTout<EcritureBrouillon>((debut, fin) =>
        supabase.from('ecritures_brouillon').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<Categorie>((debut, fin) =>
        supabase.from('categories').select('*', { count: 'exact' })
          .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('id').range(debut, fin),
      ),
      lireTout<Piece>((debut, fin) =>
        supabase.from('pieces').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<ANouveau>((debut, fin) =>
        supabase.from('a_nouveaux').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('compte').order('id').range(debut, fin),
      ),
      lireTout<LettrageManuel>((debut, fin) =>
        supabase.from('lettrages_manuels').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    setEcritures(brouillon.lignes)
    setCategories(lectureCategories.lignes)
    setPieces(lecturePieces.lignes)
    setANouveaux(lectureANouveaux.lignes)
    setLettragesManuels(lectureLettrages.lignes)
    setLectureIncomplete(brouillon.motif)
    setLecturePiecesIncomplete(lecturePieces.motif)
    setLectureANouveauxIncomplete(lectureANouveaux.motif)
    setLectureCategoriesIncomplete(lectureCategories.motif)
    setLectureLettragesIncomplete(lectureLettrages.motif)
    setLoading(false)
  }, [dossierId])

  useEffect(() => { charger() }, [charger])

  const ecrituresFiltrees = anneeFilter === 'toutes' ? ecritures : ecritures.filter((e) => anneeDe(e.date) === anneeFilter)
  // Les à-nouveaux appartiennent à l'exercice qu'ils ouvrent, comme toute écriture à celui de sa date.
  const aNouveauxFiltres = useMemo(
    () => (anneeFilter === 'toutes' ? aNouveaux : aNouveaux.filter((a) => anneeDe(a.date) === anneeFilter)),
    [aNouveaux, anneeFilter],
  )
  const ouverture = aNouveaux[0]?.date ?? null
  // Toutes années confondues, une écriture ANTÉRIEURE à l'ouverture est déjà dans les soldes repris :
  // la vue la compterait deux fois sur les comptes de bilan. Dit seulement quand c'est le cas — une
  // mise en garde permanente cesse d'être lue.
  const anterieuresALOuverture = anneeFilter === 'toutes' && ouverture
    ? ecritures.filter((e) => e.date < ouverture).length
    : 0

  // Tableau de pilotage (voir audit ergonomie comparatif) — deux repères qui manquaient à cet onglet :
  // une tendance de trésorerie récente (indépendante de l'exercice sélectionné, comme le plan de
  // trésorerie de Financement) et un avancement grossier du dossier en cours. Le détail complet de
  // l'avancement (points à traiter, documents attendus) reste dans Vue d'ensemble — pas dupliqué ici,
  // juste un chiffre de synthèse avec un renvoi.
  const evolutionMensuelle = useMemo(() => calculerEvolutionMensuelle(ecritures, NB_MOIS_EVOLUTION), [ecritures])
  const anneeCourante = new Date().getFullYear()
  const piecesAnnee = pieces.filter((p) => p.date_piece && anneeDe(p.date_piece) === anneeCourante)
  const piecesValideesAnnee = piecesAnnee.filter((p) => p.statut === 'validee')
  const avancementPct = piecesAnnee.length > 0 ? Math.round((piecesValideesAnnee.length / piecesAnnee.length) * 100) : null

  const balance = useMemo(
    () => calculerBalance(ecrituresFiltrees, categories, aNouveauxFiltres),
    [ecrituresFiltrees, categories, aNouveauxFiltres],
  )

  // LES COMPTES DE TIERS (lib/lettrage.ts), en engagement seulement : arrêtés au 31 décembre de l'exercice choisi
  // quand il est fini, sinon à aujourd'hui — un exercice en cours, ou toutes années confondues, se lit au jour où on le
  // regarde. Sur TOUT le brouillon et toute l'ouverture, pas sur l'exercice : une facture d'un exercice précédent encore
  // ouverte reste due, et `comptesDeTiers` ne garde d'elle-même que ce qui est daté jusqu'à l'arrêté.
  const aujourdHui = aujourdHuiAParis()
  const finExercice = typeof anneeFilter === 'number' ? `${anneeFilter}-12-31` : null
  const dateArrete = finExercice !== null && finExercice < aujourdHui ? finExercice : aujourdHui
  const soldesDeTiers = useMemo(
    () => comptesDeTiers(ecritures, pieces, aNouveaux, lettragesManuels, modeComptable, dateArrete),
    [ecritures, pieces, aNouveaux, lettragesManuels, modeComptable, dateArrete],
  )
  // LE LETTRAGE FAIT À LA MAIN (lib/lettrage.ts) : sur l'état d'aujourd'hui, TOUT le brouillon — c'est ce que la base
  // vérifie au clic. Il ne s'offre que sur la vue arrêtée à aujourd'hui, et seulement quand tout ce dont il dépend a été
  // lu : une pièce non lue n'a pas de tiers connu, et le cabinet lettrerait sur une vue fausse.
  const etatsLettrages = useMemo(
    () => etatsDesLettragesManuels(ecritures, pieces, lettragesManuels, modeComptable),
    [ecritures, pieces, lettragesManuels, modeComptable],
  )
  const propositions = useMemo(
    () => lettragesProposes(ecritures, pieces, lettragesManuels, modeComptable),
    [ecritures, pieces, lettragesManuels, modeComptable],
  )
  const nomDesPieces = useMemo(() => new Map(pieces.map((p) => [p.id, p.nom_fichier])), [pieces])
  const lettrageSuspendu = dateArrete !== aujourdHui
    ? 'Le lettrage à la main se fait sur la vue arrêtée à aujourd’hui : choisis l’exercice en cours, ou toutes les années, en tête du dossier.'
    : lecturePiecesIncomplete
      ? `Les pièces n’ont pas pu être lues en entier (${lecturePiecesIncomplete}) : le tiers d’une pièce non lue n’est pas connu, et le lettrage à la main attend une lecture complète. Recharge la page.`
      : null

  async function lettrer(compte: string, pieceIds: string[]): Promise<boolean> {
    if (lettrageEnCours.current) return false
    lettrageEnCours.current = true
    setLettrageOccupe(true)
    setErreurLettrage(null)
    try {
      // Refait au clic : la carte a pu changer depuis que le bouton s'est offert.
      const refus = lettrageSuspendu ?? refusLettrageManuel(compte, pieceIds, ecritures, pieces, lettragesManuels, modeComptable)
      if (refus) {
        setErreurLettrage(refus)
        return false
      }
      const { error } = await supabase.rpc('lettrer_pieces', { p_dossier_id: dossierId, p_compte: compte, p_pieces: pieceIds })
      if (error) {
        setErreurLettrage(messageErreur(error, 'Le lettrage n’a pas pu être enregistré.'))
        return false
      }
      await charger()
      return true
    } finally {
      lettrageEnCours.current = false
      setLettrageOccupe(false)
    }
  }

  // DÉFAIRE retire les lignes du lettrage, sous la policy de la table : aucune écriture n'en dépend, et rien du brouillon
  // ne bouge. La confirmation nomme ce qu'on perd.
  async function defaire(etat: EtatLettrageManuel) {
    if (lettrageEnCours.current) return
    const n = etat.pieceIds.length
    if (!window.confirm(
      `Défaire ce lettrage fait à la main ? ${n > 1 ? `Les ${n} pièces` : 'La pièce'} de ${etat.libelle} `
        + `${n > 1 ? 'redeviennent ouvertes' : 'redevient ouverte'} dans les comptes de tiers, et le FEC ne `
        + `${n > 1 ? 'les' : 'la'} lettrera plus. Aucune écriture n’est modifiée.`,
    )) return
    lettrageEnCours.current = true
    setLettrageOccupe(true)
    setErreurLettrage(null)
    try {
      const { error, count } = await supabase.from('lettrages_manuels').delete({ count: 'exact' })
        .eq('dossier_id', dossierId).eq('groupe', etat.groupe)
      if (error) setErreurLettrage(messageErreur(error, 'Le lettrage n’a pas pu être défait.'))
      // Une suppression qui ne touche aucune ligne ne lève rien : sans ce compte, un refus passerait pour un succès.
      else if (!count) setErreurLettrage('Rien n’a été défait : ce lettrage n’existe plus, ou la base l’a refusé. La vue est relue.')
      await charger()
    } finally {
      lettrageEnCours.current = false
      setLettrageOccupe(false)
    }
  }
  // Ce qu'il faut pour que la carte distingue « tout est soldé » de « rien n'est écrit », et dise les lignes d'un compte
  // de tiers antérieures à l'ouverture d'un dossier repris — que la vue compte une seconde fois quand l'arrêté la suit.
  const lignesDeTiers = ecritures.filter((e) => COMPTES_LETTRABLES.has(e.compte) && e.date <= dateArrete).length
    + aNouveaux.filter((a) => COMPTES_LETTRABLES.has(a.compte) && a.date <= dateArrete).length
  const tiersAvantOuverture = ouverture && ouverture <= dateArrete
    ? ecritures.filter((e) => COMPTES_LETTRABLES.has(e.compte) && e.date < ouverture).length
    : 0

  const lignesAffichees = balance.filter((l) =>
    correspondALaRecherche([l.compte, l.libelle, l.totalDebit, l.totalCredit, l.solde], recherche),
  )

  // Totaux calculés sur `balance` entière, jamais sur les lignes trouvées par la recherche. Une
  // balance n'est équilibrée que prise en entier : sommer un sous-ensemble (« 606 ») donne forcément
  // un écart, et le badge ci-dessous passait alors au rouge — le même badge qui signale un vrai
  // brouillon cassé. La recherche ne doit jamais fabriquer cette alerte.
  const totalDebit = balance.reduce((sum, l) => sum + l.totalDebit, 0)
  const totalCredit = balance.reduce((sum, l) => sum + l.totalCredit, 0)
  // Tolérance identique à analyserEcritures — un écart ici signale la même chose qu'un groupe
  // déséquilibré dans Écritures, mais vu depuis l'angle du compte plutôt que de la pièce.
  const desequilibre = Math.abs(totalDebit - totalCredit) > 0.02

  return (
    <>
      <BandeauLecturePartielle
        quoi="Les écritures du brouillon"
        motif={lectureIncomplete}
        consequence={
          'Les totaux débit/crédit et le badge d’équilibre ci-dessous portent donc sur une partie ' +
          'des écritures : un écart affiché ici ne prouverait rien.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les pièces du dossier"
        motif={lecturePiecesIncomplete}
        consequence={
          'L’avancement de l’année porte donc sur une partie des pièces.'
            + (modeComptable === 'engagement'
              ? ' Dans les comptes de tiers, un fournisseur ou un client peut s’afficher sous « divers », faute du nom lu sur sa pièce ; les montants, eux, viennent des écritures.'
              : '')
        }
      />
      <BandeauLecturePartielle
        quoi="Les à-nouveaux du dossier"
        accord="lus"
        motif={lectureANouveauxIncomplete}
        consequence={
          'Les totaux ci-dessous portent donc sur une ouverture incomplète : un écart affiché ici ne ' +
          'prouverait rien, et le solde des comptes de bilan est faux.'
        }
      />
      <BandeauLecturePartielle
        quoi="Les catégories du cabinet"
        motif={lectureCategoriesIncomplete}
        consequence={
          'Un compte peut donc s’afficher sans son libellé (« — »), et une recherche par le nom de sa ' +
          'catégorie ne pas le trouver. Les montants, eux, ne dépendent pas de cette lecture.'
        }
      />

      <p className="muted" style={{ marginTop: -8, marginBottom: 20 }}>
        Balance de tous les comptes utilisés dans le brouillon d'écritures — même donnée que l'onglet
        Écritures, regroupée par compte plutôt que par pièce. Solde positif = débiteur, négatif =
        créditeur.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Tableau de pilotage</h3>
        <p className="muted" style={{ marginTop: -8, fontSize: '0.82rem' }}>
          Encaissements/décaissements calculés depuis le compte banque (512) du brouillon
          d'écritures — nécessite que les écritures correspondantes aient déjà été générées (voir
          l'onglet Écritures). Indépendant de l'exercice sélectionné ci-dessus : une tendance
          récente reste utile même en consultant une année passée.
        </p>

        {loading ? (
          <div className="skeleton skeleton-widget" style={{ height: 180 }} />
        ) : evolutionMensuelle.length === 0 ? (
          <p className="muted">
            Aucune écriture bancaire générée pour l'instant — ce tableau se remplira au fil des
            écritures (voir l'onglet Écritures).
          </p>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <MonthlyBars mois={evolutionMensuelle} />
          </div>
        )}

        {avancementPct !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <ProgressRing ratio={avancementPct / 100} taille={64} epaisseur={7} statut={avancementPct === 100 ? 'ok' : 'warning'} libelle={`Avancement ${anneeCourante} : ${avancementPct} %`} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700 }}>Avancement {anneeCourante}</div>
              <div className="muted">
                {piecesValideesAnnee.length} pièce(s) validée(s) sur {piecesAnnee.length} déposée(s) cette année.
              </div>
            </div>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => onNavigate('checklist')}>
              Voir la vue d'ensemble
            </button>
          </div>
        )}
      </div>

      {aNouveauxFiltres.length > 0 && (
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 10 }}>
          {`Les à-nouveaux du ${formatDate(aNouveauxFiltres[0].date)}, repris de ${aNouveauxFiltres[0].source_nom}, `
            + 'sont compris dans les totaux : ils ouvrent l’exercice comme les soldes de la balance reprise.'}
        </p>
      )}
      {anterieuresALOuverture > 0 && (
        <p className="error-text" style={{ fontSize: '0.85rem', marginTop: 0, marginBottom: 10 }}>
          {`${anterieuresALOuverture} écriture${anterieuresALOuverture > 1 ? 's' : ''} du brouillon `
            + `précède${anterieuresALOuverture > 1 ? 'nt' : ''} l’ouverture du ${formatDate(ouverture)} : `
            + 'leur effet est déjà dans les soldes repris, et cette vue toutes années confondues le compte '
            + 'une seconde fois sur les comptes de bilan. Choisis un exercice pour lire une balance juste.'}
        </p>
      )}

      <div style={{ marginBottom: 14 }}>
        <BarreRecherche
          valeur={recherche}
          onChange={setRecherche}
          placeholder="Rechercher un numéro, un libellé de compte, un montant…"
          affiches={lignesAffichees.length}
          total={balance.length}
        />
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        {loading ? (
          <p className="muted" style={{ padding: 20 }}>Chargement…</p>
        ) : lignesAffichees.length === 0 ? (
          <div className="empty-state">
            {recherche.trim()
              ? `Aucun compte ne correspond à « ${recherche.trim()} ».`
              : "Aucun compte pour l'instant — génère des écritures depuis l'onglet Écritures."}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Compte</th>
                <th>Libellé</th>
                <th>Écritures</th>
                <th>Débit</th>
                <th>Crédit</th>
                <th>Solde</th>
              </tr>
            </thead>
            <tbody>
              {lignesAffichees.map((l) => (
                <tr key={l.compte}>
                  <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{l.compte}</td>
                  <td>{l.libelle}</td>
                  <td>{l.nbEcritures}</td>
                  <td>{formatMoney(l.totalDebit)}</td>
                  <td>{formatMoney(l.totalCredit)}</td>
                  <td>
                    {l.solde >= 0
                      ? <span>{formatMoney(l.solde)} <span className="muted">débiteur</span></span>
                      : <span>{formatMoney(-l.solde)} <span className="muted">créditeur</span></span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td colSpan={3}>{recherche.trim() ? 'Total (tous les comptes)' : 'Total'}</td>
                <td>{formatMoney(totalDebit)}</td>
                <td>{formatMoney(totalCredit)}</td>
                <td>
                  {desequilibre
                    ? <span className="badge badge-danger">écart {formatMoney(totalDebit - totalCredit)}</span>
                    : <span className="badge badge-ok">équilibré</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {modeComptable === 'engagement' && (
        <ComptesDeTiersCard
          soldes={soldesDeTiers}
          dateArrete={dateArrete}
          finExercice={dateArrete === finExercice}
          lectureIncomplete={lectureIncomplete ?? lectureANouveauxIncomplete ?? lectureLettragesIncomplete}
          lignesDeTiers={lignesDeTiers}
          anterieuresALOuverture={tiersAvantOuverture}
          ouverture={ouverture}
          loading={loading}
          lettrage={{
            suspendu: lettrageSuspendu,
            etats: etatsLettrages,
            propositions,
            nomDesPieces,
            refus: (compte, pieceIds) => refusLettrageManuel(compte, pieceIds, ecritures, pieces, lettragesManuels, modeComptable),
            occupe: lettrageOccupe,
            erreur: erreurLettrage,
            onLettrer: lettrer,
            onDefaire: defaire,
          }}
        />
      )}
    </>
  )
}
