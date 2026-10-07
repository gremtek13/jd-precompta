import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { anneeDe, aujourdHuiAParis, aujourdHuiSql, formatDate, formatMoney } from '../../lib/format'
import {
  calculerCa3,
  comparerDeclarations,
  creditReporte,
  declarationPrecedente,
  dePeriode,
  dernierePeriodeClose,
  libellePeriode,
  LIGNES_CA3,
  periodesDeLAnnee,
  type DonneesTva,
  type LigneAffichee,
  type MotifNonPlacee,
} from '../../lib/declarationTva'
import {
  arrondiDeLaLiquidation,
  declarationDeLaCa3,
  ecritureDeLaLiquidation,
  parametresEnregistrement,
  phraseDuPaiement,
  phraseDuRemboursement,
  refusEnregistrement,
  remboursementSousLeSeuil,
  seSaisitALaMain,
  seuilRemboursement,
  suiviDesDeclarations,
  type DemandeDeDeclaration,
  type SuiviDeDeclaration,
} from '../../lib/liquidationTva'
import { libelleCompteTenu } from '../../lib/comptes'
import { estFigee } from '../../lib/validationExercice'
import { useExercicesValides } from '../../context/ExercicesValidesContext'
import { partsDuReleve, type PartDuReleve } from '../../lib/partsDuReleve'
import { paiementsDesPieces } from '../../lib/rattachement'
import { horsTaxeEtTva, libelleTaux } from '../../lib/tvaDuReleve'
import type {
  ANouveau, ArticleExoneration, Categorie, DeclarationTva, LigneBancaire, PeriodiciteTva, Piece, ReglementGroupe, StatutTva,
  VentilationBancaire,
} from '../../lib/types'
import BandeauLecturePartielle from '../../components/BandeauLecturePartielle'
import BrouillonBanner from '../../components/BrouillonBanner'
import StatutTvaCard, { FacturationElectroniqueCard, type ModificationStatutTva } from './StatutTvaCard'

// LA DÉCLARATION DE TVA (CA3), PRÉPARÉE CASE PAR CASE — ligne 28 de la feuille de route, étape 1.
//
// Le calcul vit dans lib/declarationTva.ts ; cet écran en montre le résultat, dit ce qu'il a écarté,
// et enregistre ce qui a été déposé. La transmission elle-même (un partenaire EDI) est l'étape 2 : en
// attendant, les cases se reportent à la main dans l'espace professionnel.
//
// C'est AUSSI ici que les déclarations déposées s'enregistrent et se comparent. Une déclaration se compare au
// calcul de SA période, avec la même règle que celle qui l'a préparée.
//
// ENREGISTRÉE, ELLE LIQUIDE LA TVA DE SA PÉRIODE (ligne 26.8, lib/liquidationTva.ts) : la base l'écrit avec son
// écriture de liquidation dans une transaction (`enregistrer_declaration_tva`) — la TVA collectée et déductible
// soldée au centime, ce qui se paie au 445510, le crédit au 445670, le remboursement demandé au 445830, l'arrondi à
// l'euro au 658000 ou au 758000. L'écran la montre avant le clic, et dit ce que la base refuserait. Une période
// antérieure à l'ouverture d'un dossier repris se saisit à la main, sans liquidation : sa TVA est dans les
// à-nouveaux. Le paiement d'une déclaration se rapproche dans Banque ; l'historique dit ce qui en reste dû.

interface Props {
  dossierId: string
  assujettiTva: boolean
  // Le statut de TVA du dossier, qui fait foi — `assujettiTva` en est déduit (lib/statutTva.ts). Il se règle ici.
  statutTva: StatutTva | null
  articleExoneration: ArticleExoneration | null
  onStatutUpdated: (modification: ModificationStatutTva) => void
  periodicite: PeriodiciteTva
  surDebits: boolean
  onRegimeUpdated: (modification: { tva_periodicite?: PeriodiciteTva; tva_sur_debits?: boolean }) => void
}

const LIBELLE_NON_PLACEE: Record<MotifNonPlacee, string> = {
  non_rapprochee: 'aucun paiement rapproché',
  sans_date: 'sans date',
}

const CADRES: { cadre: LigneAffichee['cadre']; titre: string }[] = [
  { cadre: 'operations', titre: 'Montant des opérations réalisées (cadre A)' },
  { cadre: 'brute', titre: 'TVA brute' },
  { cadre: 'deductible', titre: 'TVA déductible' },
  { cadre: 'solde', titre: 'TVA due ou crédit' },
]
// Les totaux se montrent toujours, même nuls ; le reste seulement quand il porte un montant : une
// liste de zéros à recopier cache les deux ou trois cases qui comptent.
const TOUJOURS_AFFICHEES = new Set(['16', '23', '28', '32'])

const nomPiece = (p: Piece) => p.tiers ?? p.nom_fichier
const pourcentage = (part: number) => `${Math.round(part * 100)} %`
// Une recette du relevé se reconnaît à sa catégorie et au libellé du mouvement.
const nomRecette = (p: PartDuReleve) => `${p.libelle} — ${p.ligne.libelle}`

interface Lu {
  pieces: Piece[]
  lignesBancaires: LigneBancaire[]
  // Les parts des virements qui règlent PLUSIEURS pièces (lib/reglementGroupe.ts) : chacune rend sa pièce
  // exigible ou déductible à la date du virement, pour sa part.
  reglements: ReglementGroupe[]
  pieceIdsImmobilisees: ReadonlySet<string>
  declarations: DeclarationTva[]
  // Ce qui range les RECETTES DU RELEVÉ — encaissées sans facture, affectées ou ventilées
  // (lib/tvaDuReleve.ts) : leurs catégories, et les parts des mouvements ventilés.
  categories: Categorie[]
  ventilations: VentilationBancaire[]
  // La date des à-nouveaux d'un dossier repris : une période qui la précède se saisit à la main.
  ouverture: string | null
  // Le motif de chaque lecture restée incomplète, nul quand elle est entière.
  lectures: {
    pieces: string | null; lignes: string | null; reglements: string | null; immobilisations: string | null; declarations: string | null
    categories: string | null; ventilations: string | null; ouverture: string | null
  }
}

// Lues par tranches (voir lib/lectureComplete.ts) : une déclaration bâtie sur une partie des pièces ou
// des paiements a exactement l'air d'une déclaration juste.
async function lireDonnees(dossierId: string): Promise<Lu> {
  const [
    lecturePieces, lectureLignes, lectureReglements, lectureImmobilisations, lectureDeclarations, lectureCategories, lectureVentilations,
    lectureOuverture,
  ] = await Promise.all([
    lireTout<Piece>((debut, fin) =>
      supabase.from('pieces').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Tous les RAPPROCHÉS, et non plus ceux qui portent une pièce : un virement qui règle plusieurs
    // pièces n'en porte aucune — ses pièces sont dans ses parts, et ce filtre l'aurait écarté en silence.
    lireTout<LigneBancaire>((debut, fin) =>
      supabase.from('lignes_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).eq('statut', 'rapprochee').order('id').range(debut, fin),
    ),
    lireTout<ReglementGroupe>((debut, fin) =>
      supabase.from('reglements_groupes').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<{ piece_id: string | null; id: string }>((debut, fin) =>
      supabase.from('immobilisations').select('piece_id, id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<DeclarationTva>((debut, fin) =>
      supabase.from('declarations_tva').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('periode_debut', { ascending: false }).order('id').range(debut, fin),
    ),
    // Les catégories du dossier ET celles du cabinet : c'est la classe de leur compte qui dit qu'un
    // mouvement affecté est une recette.
    lireTout<Categorie>((debut, fin) =>
      supabase.from('categories').select('*', { count: 'exact' })
        .or(`dossier_id.eq.${dossierId},dossier_id.is.null`).order('ordre').order('id').range(debut, fin),
    ),
    lireTout<VentilationBancaire>((debut, fin) =>
      supabase.from('ventilations_bancaires').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // L'ouverture du dossier : une période qui la précède se saisit à la main, sa TVA étant dans les à-nouveaux.
    lireTout<Pick<ANouveau, 'id' | 'date'>>((debut, fin) =>
      supabase.from('a_nouveaux').select('id, date', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
    ),
  ])
  return {
    pieces: lecturePieces.lignes,
    lignesBancaires: lectureLignes.lignes,
    reglements: lectureReglements.lignes,
    pieceIdsImmobilisees: new Set(lectureImmobilisations.lignes.map((i) => i.piece_id).filter((id): id is string => !!id)),
    declarations: lectureDeclarations.lignes,
    categories: lectureCategories.lignes,
    ventilations: lectureVentilations.lignes,
    ouverture: lectureOuverture.lignes[0]?.date ?? null,
    lectures: {
      pieces: lecturePieces.motif,
      lignes: lectureLignes.motif,
      reglements: lectureReglements.motif,
      immobilisations: lectureImmobilisations.motif,
      declarations: lectureDeclarations.motif,
      categories: lectureCategories.motif,
      ventilations: lectureVentilations.motif,
      ouverture: lectureOuverture.motif,
    },
  }
}

// Un montant saisi, la virgule admise ; nul quand le champ est vide ou illisible.
function montantSaisi(texte: string): number | null {
  if (texte.trim() === '') return null
  const lu = Number(texte.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(lu) ? lu : null
}

// Ce que la déclaration fait payer et ce que le relevé en porte (`suiviDesDeclarations`), en une phrase.
// Les pastilles de l'historique : le texte vient du module, qui le partage avec la fiche d'un mouvement ; le ton est d'ici.
function etatDuPaiement(s: SuiviDeDeclaration<DeclarationTva, LigneBancaire>): { texte: string; classe: string } {
  const classe = s.etatPaiement === 'payee' ? 'badge-ok'
    : s.etatPaiement === 'payee_en_trop' ? 'badge-danger'
      : s.etatPaiement === 'rien_a_payer' ? 'badge-neutral' : 'badge-warning'
  return { texte: phraseDuPaiement(s), classe }
}

function etatDuRemboursement(s: SuiviDeDeclaration<DeclarationTva, LigneBancaire>): { texte: string; classe: string } | null {
  const texte = phraseDuRemboursement(s)
  if (texte === null) return null
  const classe = s.etatRemboursement === 'recu' ? 'badge-ok' : s.etatRemboursement === 'recu_en_trop' ? 'badge-danger' : 'badge-warning'
  return { texte, classe }
}

export default function TvaTab({
  dossierId, assujettiTva, statutTva, articleExoneration, onStatutUpdated, periodicite, surDebits, onRegimeUpdated,
}: Props) {
  // Les exercices validés : une déclaration dont la période y tombe est figée avec eux, et ne s'y enregistre plus.
  const { anneesValidees, frontiere } = useExercicesValides()
  // Nul tant que la première lecture n'est pas revenue : l'écran montre alors ses squelettes.
  const [lu, setLu] = useState<Lu | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [erreurRegime, setErreurRegime] = useState<string | null>(null)
  // La période choisie, AVEC la périodicité pour laquelle elle l'a été : passer de trimestrielle à
  // mensuelle ramène à la dernière période close de la nouvelle périodicité au lieu de garder un
  // indice qui désignerait un tout autre intervalle.
  const [choix, setChoix] = useState<{ periodicite: PeriodiciteTva; annee: number; index: number } | null>(null)
  // Saisies propres à une période (crédit reporté, remboursement demandé, TVA nette d'une période saisie à la
  // main), clées par son début : changer de période repart de ce que le calcul propose pour elle.
  const [saisieCredit, setSaisieCredit] = useState<Record<string, string>>({})
  const [saisieRemboursement, setSaisieRemboursement] = useState<Record<string, string>>({})
  const [saisieMontant, setSaisieMontant] = useState<Record<string, string>>({})
  const [dateDepot, setDateDepot] = useState(aujourdHuiSql())
  const [ecritureEnCours, setEcritureEnCours] = useState(false)
  // Verrou d'exécution : un `useRef`, jamais un état React — deux clics du même rendu enregistreraient deux fois la
  // même déclaration (voir CLAUDE.md, « un verrou d'exécution »). UN seul pour l'enregistrement et le retrait : ils
  // écrivent la même table, et l'un pendant l'autre partirait d'une liste que l'autre est en train de changer.
  const ecriture = useRef(false)

  useEffect(() => {
    if (!assujettiTva) return
    let annule = false
    lireDonnees(dossierId).then((donnees) => { if (!annule) setLu(donnees) })
    return () => { annule = true }
  }, [dossierId, assujettiTva])

  // Après une écriture : l'écran garde ses chiffres pendant la relecture, puis les remplace.
  async function recharger() {
    setLu(await lireDonnees(dossierId))
  }

  async function changerRegime(modification: { tva_periodicite?: PeriodiciteTva; tva_sur_debits?: boolean }) {
    const avant = { tva_periodicite: periodicite, tva_sur_debits: surDebits }
    setErreurRegime(null)
    onRegimeUpdated(modification) // optimiste, annulé si l'enregistrement échoue
    const { error } = await supabase.from('dossiers').update(modification).eq('id', dossierId)
    if (error) {
      onRegimeUpdated(avant)
      setErreurRegime(messageErreur(error, "Le régime de TVA n'a pas pu être enregistré."))
    }
  }

  const statut = (
    <StatutTvaCard dossierId={dossierId} statut={statutTva} article={articleExoneration} onStatutUpdated={onStatutUpdated} />
  )
  const facturationElectronique = (
    <FacturationElectroniqueCard statut={statutTva} article={articleExoneration} periodicite={periodicite} surDebits={surDebits} />
  )

  if (!assujettiTva) {
    return (
      <>
        {statut}
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Pas de déclaration de TVA</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {statutTva === 'franchise'
              ? 'En franchise en base, le dossier ne facture ni ne déclare de TVA : il n’a pas de déclaration à déposer.'
              : statutTva === 'exonere'
                ? 'Exonéré, le dossier ne facture ni ne déclare de TVA : il n’a pas de déclaration à déposer.'
                : 'Tant que son statut de TVA est à préciser, le dossier est traité comme ne récupérant pas la TVA : '
                  + 'redevable, il préparerait ici ses déclarations.'}
          </p>
        </div>
        {facturationElectronique}
      </>
    )
  }

  const loading = lu === null
  const pieces = lu?.pieces ?? []
  const lignesBancaires = lu?.lignesBancaires ?? []
  const declarations = lu?.declarations ?? []
  const ouverture = lu?.ouverture ?? null
  const lectures = lu?.lectures ?? {
    pieces: null, lignes: null, reglements: null, immobilisations: null, declarations: null, categories: null, ventilations: null,
    ouverture: null,
  }
  const periodeParDefaut = dernierePeriodeClose(aujourdHuiSql(), periodicite)
  const selection = choix && choix.periodicite === periodicite
    ? choix
    : {
        periodicite,
        annee: anneeDe(periodeParDefaut.debut),
        index: periodesDeLAnnee(anneeDe(periodeParDefaut.debut), periodicite).findIndex((p) => p.debut === periodeParDefaut.debut),
      }
  const periodes = periodesDeLAnnee(selection.annee, periodicite)
  const periode = periodes[selection.index]
  // L'année qui précède l'ouverture d'un dossier repris est proposée : la déclaration de son dernier trimestre se
  // paie le plus souvent après la reprise, et se saisit donc ici pour que son paiement se rapproche.
  const anneesProposees = [...new Set([
    selection.annee,
    anneeDe(aujourdHuiSql()),
    ...(ouverture ? [anneeDe(ouverture) - 1] : []),
    ...declarations.map((d) => anneeDe(d.periode_debut)),
    ...pieces.map((p) => p.date_piece).filter((d): d is string => !!d).map(anneeDe),
    ...lignesBancaires.map((l) => anneeDe(l.date)),
  ])].sort((a, b) => b - a)

  const donnees: DonneesTva = {
    pieces,
    paiements: paiementsDesPieces(lignesBancaires, lu?.reglements ?? []),
    pieceIdsImmobilisees: lu?.pieceIdsImmobilisees ?? new Set(),
    releve: partsDuReleve(lignesBancaires, lu?.categories ?? [], lu?.ventilations ?? [], assujettiTva),
  }
  // Une période antérieure à l'ouverture d'un dossier repris se saisit à la main : sa TVA est dans les à-nouveaux,
  // et le calcul n'a rien à en dire.
  const aLaMain = seSaisitALaMain(periode, ouverture)
  const precedente = declarationPrecedente(declarations, periode.debut)
  const creditPropose = precedente ? creditReporte(precedente) : 0
  const creditTexte = saisieCredit[periode.debut] ?? String(creditPropose)
  const creditLu = montantSaisi(creditTexte)
  const creditValide = creditLu !== null && creditLu >= 0
  const remboursementTexte = saisieRemboursement[periode.debut] ?? '0'
  const remboursementLu = montantSaisi(remboursementTexte)
  const ca3 = calculerCa3(
    donnees, periode, surDebits, creditValide ? creditLu : 0, remboursementLu !== null && remboursementLu > 0 ? remboursementLu : 0,
  )
  const montantTexte = saisieMontant[periode.debut] ?? ''
  const dejaDeposees = declarations.filter((d) => d.periode_debut === periode.debut && d.periode_fin === periode.fin)
  const comparees = comparerDeclarations(declarations, donnees, surDebits)
  const suivis = suiviDesDeclarations(declarations, lignesBancaires)

  // CE QUE L'ENREGISTREMENT ÉCRIRA, et ce que la base refuserait — dit avant le clic, dans son ordre
  // (`refusEnregistrement`). Une CA3 préparée s'enregistre telle qu'elle est ; une période saisie à la main porte les
  // trois montants tapés.
  // Sans crédit dans la période (ligne 25), le champ du remboursement n'est pas proposé : ce qu'il gardait d'une saisie
  // antérieure ne compte plus.
  const demande: DemandeDeDeclaration = aLaMain
    ? { periode, ca3: null, remboursement: remboursementLu, tvaDeclaree: montantSaisi(montantTexte), credit: creditValide ? creditLu : null }
    : { periode, ca3, remboursement: ca3.cases.l25 > 0 ? remboursementLu : 0, tvaDeclaree: null, credit: null }
  const refus = refusEnregistrement(demande, {
    assujettiTva, aujourdhui: aujourdHuiAParis(), declarations, ouverture, anneesValidees,
  })
  const liquidee = aLaMain ? null : declarationDeLaCa3(ca3, periode)
  const liquidation = liquidee ? ecritureDeLaLiquidation(liquidee) : []
  const arrondi = liquidee ? arrondiDeLaLiquidation(liquidee) : 0
  // Le remboursement que la déclaration demandera : borné au crédit de la période pour une CA3 préparée.
  const remboursementDemande = aLaMain ? (remboursementLu ?? 0) : ca3.cases.l26
  const piecesHorsDeLaDeclaration = ca3.ecartees.length + ca3.releveEcartees.length + ca3.aValider.length

  // UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE : la déclaration proposée vient d'un calcul qui ne voit qu'une
  // partie des pièces, le crédit proposé d'un historique qui peut en manquer une, et l'ouverture décide de ce qui se
  // saisit à la main.
  const lectureIncomplete = lectures.pieces ?? lectures.lignes ?? lectures.reglements ?? lectures.immobilisations ?? lectures.declarations
    ?? lectures.categories ?? lectures.ventilations ?? lectures.ouverture

  async function enregistrer() {
    if (ecriture.current || lectureIncomplete || !creditValide || refus) return
    ecriture.current = true
    setEcritureEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('enregistrer_declaration_tva', parametresEnregistrement(dossierId, demande, dateDepot || null))
      if (error) throw error
      // Les montants saisis pour cette période ont servi : la prochaine visite repart du calcul.
      const oublier = (s: Record<string, string>) => {
        const copie = { ...s }
        delete copie[periode.debut]
        return copie
      }
      setSaisieMontant(oublier)
      setSaisieRemboursement(oublier)
      // Le verrou tient jusqu'à la relecture : relâché avant, un second clic enregistrerait la même
      // déclaration une seconde fois, la mention « déjà déposée » n'étant pas encore revenue.
      await recharger()
    } catch (err) {
      setErreur(messageErreur(err, "La déclaration n'a pas pu être enregistrée."))
    } finally {
      ecriture.current = false
      setEcritureEnCours(false)
    }
  }

  async function retirer(d: DeclarationTva) {
    if (ecriture.current) return
    const libelle = libellePeriode(d.periode_debut, d.periode_fin)
    const paiements = suivis.find((s) => s.declaration.id === d.id)?.mouvements.length ?? 0
    // Ce qui part avec elle, nommé : sa liquidation, les mouvements qui la paient — dont le nombre ne se dit que d'un
    // relevé lu en entier, une lecture partielle pouvant en manquer un — et le crédit qu'elle reporte.
    const consequences = [
      ...(d.cases ? ['son écriture de liquidation part avec elle'] : []),
      ...(lectures.lignes
        ? ['les mouvements qui la paient, s’il y en a, retournent à traiter sans leur écriture']
        : paiements > 0 ? [`${paiements} mouvement(s) qui la paient retournent à traiter sans leur écriture`] : []),
      'le crédit qu’elle reporte ne sera plus proposé sur la déclaration suivante',
    ]
    const phrase = consequences.length > 1
      ? `${consequences.slice(0, -1).join(', ')} et ${consequences[consequences.length - 1]}`
      : consequences[0]
    if (!window.confirm(`Retirer la déclaration ${dePeriode(libelle)} ? ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`)) return
    ecriture.current = true
    setEcritureEnCours(true)
    setErreur(null)
    try {
      const { error } = await supabase.rpc('retirer_declaration_tva', { p_declaration_id: d.id })
      if (error) throw error
      await recharger()
    } catch (err) {
      setErreur(messageErreur(err, "La déclaration n'a pas pu être retirée."))
    } finally {
      ecriture.current = false
      setEcritureEnCours(false)
    }
  }

  const lignesAffichees = (cadre: LigneAffichee['cadre']) =>
    LIGNES_CA3.filter((l) => l.cadre === cadre && (TOUJOURS_AFFICHEES.has(l.ligne) || ca3.cases[l.montant] !== 0))

  const champCredit = (
    <div className="field">
      <label htmlFor="tva-credit">Crédit reporté de la déclaration précédente (ligne 22)</label>
      <input
        id="tva-credit"
        inputMode="numeric"
        value={creditTexte}
        onChange={(e) => setSaisieCredit((s) => ({ ...s, [periode.debut]: e.target.value }))}
        style={{ width: 140 }}
      />
    </div>
  )
  const noteCredit = (
    <>
      <p className="muted" style={{ marginTop: 4 }}>
        {precedente
          ? `Repris de la déclaration ${dePeriode(libellePeriode(precedente.periode_debut, precedente.periode_fin))}, sa ligne 27.`
          : 'Aucune déclaration enregistrée pour la période précédente : si elle reportait un crédit (sa ligne 27), saisissez-le ici.'}
      </p>
      {!creditValide && <p className="error-text">Le crédit reporté doit être un montant positif ou nul.</p>}
    </>
  )
  const champRemboursement = (
    <div className="field">
      <label htmlFor="tva-remboursement">Remboursement demandé (ligne 26)</label>
      <input
        id="tva-remboursement"
        inputMode="numeric"
        value={remboursementTexte}
        onChange={(e) => setSaisieRemboursement((s) => ({ ...s, [periode.debut]: e.target.value }))}
        style={{ width: 140 }}
      />
    </div>
  )
  const champDate = (
    <div className="field">
      <label htmlFor="tva-date-depot">Déposée le</label>
      <input id="tva-date-depot" type="date" value={dateDepot} onChange={(e) => setDateDepot(e.target.value)} />
    </div>
  )
  const boutonEnregistrer = (libelle: string) => (
    <button
      className="btn btn-primary btn-sm"
      onClick={enregistrer}
      disabled={ecritureEnCours || !!lectureIncomplete || !creditValide || refus !== null}
    >
      {ecritureEnCours ? 'Enregistrement…' : libelle}
    </button>
  )
  const suiteEnregistrement = (
    <>
      {remboursementSousLeSeuil(periode.fin, remboursementDemande) && (
        <p className="muted" style={{ color: 'var(--color-danger)' }}>
          Un remboursement de crédit n’est accordé qu’à partir de {formatMoney(seuilRemboursement(periode.fin))}
          {periode.fin.slice(5) === '12-31' ? ' au titre du 31 décembre' : ' en cours d’année (150 € au titre du 31 décembre)'} :
          l’administration peut refuser celui-ci, qui reste alors à reporter.
        </p>
      )}
      {lectureIncomplete && (
        <p className="error-text">
          Enregistrement suspendu : une lecture est incomplète, donc la déclaration et le crédit proposés
          peuvent être faux. Rechargez la page.
        </p>
      )}
      {!lectureIncomplete && refus && <p className="error-text">{refus}</p>}
      {erreur && <p className="error-text">{erreur}</p>}
    </>
  )

  return (
    <>
      <BrouillonBanner />

      <BandeauLecturePartielle
        quoi="Les justificatifs"
        accord="lus"
        motif={lectures.pieces}
        consequence="La déclaration ci-dessous porte sur une partie d’entre eux : ne la déposez pas en l’état."
      />
      <BandeauLecturePartielle
        quoi="Les paiements rapprochés"
        accord="lus"
        motif={lectures.lignes ?? lectures.reglements}
        consequence="Une pièce dont le paiement n’a pas été lu ne compte dans aucune période, et ce qui reste à payer d’une déclaration peut être faux."
      />
      <BandeauLecturePartielle
        quoi="Les immobilisations"
        motif={lectures.immobilisations}
        consequence="La TVA d’un bien immobilisé peut figurer en ligne 20 au lieu de 19."
      />
      <BandeauLecturePartielle
        quoi="Les déclarations déposées"
        motif={lectures.declarations}
        consequence="Le crédit à reporter proposé et l’historique ci-dessous peuvent en manquer une."
      />
      <BandeauLecturePartielle
        quoi="Les catégories et les parts ventilées"
        accord="lues"
        motif={lectures.categories ?? lectures.ventilations}
        consequence="Une recette encaissée sans facture, affectée ou ventilée depuis le relevé, peut manquer à la déclaration."
      />
      <BandeauLecturePartielle
        quoi="L’ouverture du dossier"
        accord="lue"
        motif={lectures.ouverture}
        consequence="Une période antérieure à la reprise du dossier se saisit à la main : sans l’ouverture, l’écran ne sait pas lesquelles."
      />

      {statut}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Régime de TVA</h3>
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="tva-periodicite">Déclaration CA3</label>
            <select
              id="tva-periodicite"
              value={periodicite}
              onChange={(e) => changerRegime({ tva_periodicite: e.target.value as PeriodiciteTva })}
            >
              <option value="trimestrielle">Trimestrielle</option>
              <option value="mensuelle">Mensuelle</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="tva-exigibilite">TVA des recettes due</label>
            <select
              id="tva-exigibilite"
              value={surDebits ? 'debits' : 'encaissements'}
              onChange={(e) => changerRegime({ tva_sur_debits: e.target.value === 'debits' })}
            >
              <option value="encaissements">À l’encaissement (prestations de services)</option>
              <option value="debits">Sur les débits (option)</option>
            </select>
          </div>
        </div>
        {erreurRegime && <p className="error-text">{erreurRegime}</p>}
        <p className="muted" style={{ marginBottom: 0 }}>
          Une recette compte à la date de son encaissement, c’est-à-dire du mouvement bancaire rapproché
          — ou à la date de sa facture sur option pour les débits. Une recette encaissée sans facture,
          affectée ou ventilée depuis le relevé, compte à la date du mouvement, au taux choisi en
          l’affectant. Un achat compte à la date de son paiement ; une note de frais, payée hors du
          compte professionnel, à sa date. À partir du 1er janvier 2027 le régime simplifié disparaît :
          la CA3 devient trimestrielle, mensuelle sur demande.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="field-row aligne-bas">
          <div className="field">
            <label htmlFor="tva-annee">Année</label>
            <select
              id="tva-annee"
              value={selection.annee}
              onChange={(e) => setChoix({ periodicite, annee: Number(e.target.value), index: Math.min(selection.index, periodes.length - 1) })}
            >
              {anneesProposees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tva-periode">Période</label>
            <select
              id="tva-periode"
              value={selection.index}
              onChange={(e) => setChoix({ periodicite, annee: selection.annee, index: Number(e.target.value) })}
            >
              {periodes.map((p, i) => <option key={p.debut} value={i}>{p.libelle}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ marginTop: 16 }}>
            <div className="skeleton skeleton-ligne" style={{ width: '60%' }} />
            <div className="skeleton skeleton-ligne" style={{ width: '40%' }} />
            <div className="skeleton skeleton-ligne" style={{ width: '50%' }} />
          </div>
        ) : aLaMain ? (
          <>
            <h3 style={{ marginBottom: 4 }}>Déclaration {dePeriode(periode.libelle)}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Cette période précède l’ouverture du dossier ({formatDate(ouverture)}) : sa TVA est dans les
              à-nouveaux, au 445510 ou au 445670. Sa déclaration se saisit telle qu’elle a été déposée, sans
              liquidation : elle sert à rapprocher son paiement ou son remboursement dans Banque, et à reporter
              son crédit sur la déclaration suivante.
            </p>

            {dejaDeposees.map((d) => (
              <p key={d.id} className="muted">
                <span className="badge badge-neutral">déjà déposée</span>{' '}
                Une déclaration est enregistrée pour cette période
                {d.date_declaration ? `, déposée le ${formatDate(d.date_declaration)}` : ''} : TVA nette
                de {formatMoney(d.tva_declaree)}.
              </p>
            ))}

            <div className="field-row aligne-bas" style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="tva-montant">TVA nette de la période (ligne 16 moins lignes 19 à 21)</label>
                <input
                  id="tva-montant"
                  inputMode="decimal"
                  value={montantTexte}
                  onChange={(e) => setSaisieMontant((s) => ({ ...s, [periode.debut]: e.target.value }))}
                  style={{ width: 140 }}
                />
              </div>
              {champCredit}
              {champRemboursement}
              {champDate}
              {boutonEnregistrer('Enregistrer la déclaration')}
            </div>
            {noteCredit}
            {suiteEnregistrement}
          </>
        ) : (
          <>
            <h3 style={{ marginBottom: 4 }}>CA3 — {periode.libelle}</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Du {formatDate(periode.debut)} au {formatDate(periode.fin)}. Montants en euros, arrondis ligne
              par ligne à l’euro le plus proche, comme l’exige la notice.
            </p>

            {dejaDeposees.map((d) => (
              <p key={d.id} className="muted">
                <span className="badge badge-neutral">déjà déposée</span>{' '}
                Une déclaration est enregistrée pour cette période
                {d.date_declaration ? `, déposée le ${formatDate(d.date_declaration)}` : ''} : TVA nette
                de {formatMoney(d.tva_declaree)}.
              </p>
            ))}

            {ca3.neant ? (
              <p><strong>Déclaration « néant »</strong> : aucune case à remplir (cochez la case néant, 0010).</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Ligne</th><th>Libellé</th><th>Code</th><th>Base hors taxe</th><th>Montant</th></tr>
                  </thead>
                  <tbody>
                    {CADRES.map(({ cadre, titre }) => {
                      const lignes = lignesAffichees(cadre)
                      if (lignes.length === 0) return null
                      return [
                        <tr key={`titre-${cadre}`}><td colSpan={5}><strong>{titre}</strong></td></tr>,
                        ...lignes.map((l) => (
                          <tr key={l.ligne}>
                            <td>{l.ligne}</td>
                            <td>{l.libelle}</td>
                            <td className="muted">{l.code}</td>
                            <td>{l.base ? formatMoney(ca3.cases[l.base]) : ''}</td>
                            <td><strong>{formatMoney(ca3.cases[l.montant])}</strong></td>
                          </tr>
                        )),
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="field-row aligne-bas" style={{ marginTop: 16 }}>
              {champCredit}
              {ca3.cases.l25 > 0 && champRemboursement}
            </div>
            {noteCredit}
            {ca3.cases.l25 > 0 && (
              <p className="muted" style={{ marginTop: 4 }}>
                La période se solde par un crédit de {formatMoney(ca3.cases.l25)} (ligne 25). Ce dont vous
                demandez le remboursement (formulaire 3519, en euros entiers) ne se reporte pas : le Trésor le
                rembourse, et son virement se rapproche de la déclaration dans Banque.
              </p>
            )}

            {ca3.ecartees.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="error-text" style={{ marginBottom: 6 }}>
                  {ca3.ecartees.length} pièce(s) de la période ne sont pas dans les cases ci-dessus : on ne sait pas
                  les y placer sans deviner. Corrigez-les dans Justificatifs, ou reportez-les à la main.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Pièce</th><th>HT</th><th>TVA</th><th>Pourquoi</th></tr></thead>
                    <tbody>
                      {ca3.ecartees.map((e) => (
                        <tr key={e.piece.id}>
                          <td>{formatDate(e.piece.date_piece)}</td>
                          <td>{nomPiece(e.piece)}{e.part < 1 ? ` (part payée : ${pourcentage(e.part)})` : ''}</td>
                          <td>{formatMoney(e.piece.montant_ht)}</td>
                          <td>{formatMoney(e.piece.montant_tva)}</td>
                          <td>{e.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ca3.releveEcartees.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <p className="error-text" style={{ marginBottom: 6 }}>
                  {ca3.releveEcartees.length} recette(s) du relevé encaissée(s) dans la période ne sont pas dans les
                  cases ci-dessus. Corrigez-les dans Banque, ou reportez-les à la main.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Recette</th><th>Montant</th><th>Pourquoi</th></tr></thead>
                    <tbody>
                      {ca3.releveEcartees.map((e, i) => (
                        <tr key={`${e.part.ligne.id}-${i}`}>
                          <td>{formatDate(e.part.ligne.date)}</td>
                          <td>{nomRecette(e.part)}</td>
                          <td>{formatMoney(e.part.montantReleve)}</td>
                          <td>{e.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {ca3.aValider.length > 0 && (
              <p className="error-text">
                {ca3.aValider.length} pièce(s) encore à valider tombent dans cette période et ne sont pas
                comptées : {ca3.aValider.map(nomPiece).join(', ')}. Validez-les avant de déposer.
              </p>
            )}

            {ca3.cases.E2 > 0 && (
              <p className="muted" style={{ color: 'var(--color-danger)' }}>
                Une partie des recettes n’est pas taxée (ligne E2). Si elle relève d’une activité exonérée,
                la TVA des dépenses communes n’est déductible qu’en partie (coefficient de déduction), ce
                que ce calcul n’applique pas.
              </p>
            )}

            {ca3.achatsEnDeviseSansTva.length > 0 && (
              <p className="muted" style={{ color: 'var(--color-danger)' }}>
                {ca3.achatsEnDeviseSansTva.length} achat(s) en devise sans TVA sont payés dans la période
                ({ca3.achatsEnDeviseSansTva.map(nomPiece).join(', ')}). S’il s’agit de services achetés à un
                fournisseur établi hors de France, la TVA est à autoliquider (ligne A3), ce que ce calcul ne
                fait pas.
              </p>
            )}

            {ca3.nonPlacees.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>
                  {ca3.nonPlacees.length} pièce(s) ne sont rattachées à aucun paiement : elles ne comptent dans
                  aucune déclaration tant qu’on ne les rapproche pas
                </summary>
                <p className="muted">
                  Une recette encaissée en espèces, ou réglée avec d’autres par un seul virement, n’est
                  rattachée à aucun mouvement : elle se reporte à la main. Un achat payé hors du compte
                  professionnel se classe en note de frais, qui compte à sa date.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Date</th><th>Pièce</th><th>TTC</th><th>TVA</th><th>Pourquoi</th></tr></thead>
                    <tbody>
                      {ca3.nonPlacees.map(({ piece, motif }) => (
                        <tr key={piece.id}>
                          <td>{formatDate(piece.date_piece)}</td>
                          <td>{nomPiece(piece)}</td>
                          <td>{formatMoney(piece.montant_ttc)}</td>
                          <td>{formatMoney(piece.montant_tva)}</td>
                          <td>{LIBELLE_NON_PLACEE[motif]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {ca3.retenues.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>Les {ca3.retenues.length} pièce(s) retenues, ligne par ligne</summary>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Ligne</th><th>Date</th><th>Pièce</th><th>Part</th><th>HT</th><th>TVA</th></tr></thead>
                    <tbody>
                      {ca3.retenues.map((r) => (
                        <tr key={r.piece.id}>
                          <td>{r.ligne}</td>
                          <td>{formatDate(r.piece.date_piece)}</td>
                          <td>{nomPiece(r.piece)}</td>
                          <td>{pourcentage(r.part)}</td>
                          <td>{formatMoney(r.piece.montant_ht)}</td>
                          <td>{formatMoney(r.piece.montant_tva)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {ca3.releveRetenues.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary>Les {ca3.releveRetenues.length} recette(s) du relevé retenues, ligne par ligne</summary>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>Ligne</th><th>Date</th><th>Recette</th><th>Taux</th><th>HT</th><th>TVA</th></tr></thead>
                    <tbody>
                      {ca3.releveRetenues.map((r, i) => {
                        const { ht, tva } = horsTaxeEtTva(r.part.montantReleve, r.part.taux)
                        return (
                          <tr key={`${r.part.ligne.id}-${i}`}>
                            <td>{r.ligne}</td>
                            <td>{formatDate(r.part.ligne.date)}</td>
                            <td>{nomRecette(r.part)}</td>
                            <td>{r.part.taux == null ? '' : libelleTaux(r.part.taux)}</td>
                            <td>{formatMoney(r.part.montantReleve < 0 ? -ht : ht)}</td>
                            <td>{formatMoney(r.part.montantReleve < 0 ? -tva : tva)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <details style={{ marginTop: 12 }}>
              <summary>Ce que ce calcul ne fait pas</summary>
              <ul className="muted">
                <li>L’autoliquidation : services achetés à un fournisseur établi hors de France (lignes A3, B2 et B4).</li>
                <li>Le coefficient de déduction d’une activité en partie exonérée.</li>
                <li>
                  Les exclusions du droit à déduction : véhicule de tourisme et son entretien, part du carburant
                  qui n’est pas déductible, cadeaux au-delà de 73 € TTC, logement.
                </li>
                <li>Les taux particuliers : 2,1 %, la Corse (le 10 % d’un dossier corse est porté ici en 9B).</li>
                <li>Le formulaire 3519 qui accompagne une demande de remboursement (ligne 26) : il se dépose à part.</li>
                <li>Les taxes assimilées (ligne 29, annexe 3310-A).</li>
                <li>La régularisation d’une période déjà déposée (lignes 5B et 2C).</li>
                <li>
                  Les factures émises dans l’application : une recette n’est comptée que si son justificatif est
                  dans Justificatifs, ou si son encaissement est affecté ou ventilé depuis le relevé, comme pour
                  la 2035.
                </li>
                <li>La dernière CA12 (régime simplifié, exercice 2026), à déposer au plus tard le 4 mai 2027.</li>
              </ul>
            </details>

            <h3 style={{ marginTop: 24 }}>Enregistrer la déclaration déposée</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Une fois la CA3 déposée, enregistrez-la telle qu’elle est ci-dessus : elle liquide la TVA de la
              période au brouillon par l’écriture ci-dessous, propose son crédit à la déclaration suivante, et
              son paiement se rapproche ensuite dans Banque. Elle permet aussi de voir, plus tard, qu’une pièce
              de la période a changé depuis.
            </p>
            <div className="table-scroll">
              <table>
                <caption className="muted" style={{ textAlign: 'left', captionSide: 'top' }}>
                  Écriture de liquidation, au {formatDate(periode.fin)}
                </caption>
                <thead><tr><th>Compte</th><th>Libellé</th><th>Débit</th><th>Crédit</th></tr></thead>
                <tbody>
                  {liquidation.length === 0 ? (
                    <tr><td colSpan={4} className="muted">Rien à liquider : la période ne porte aucune TVA.</td></tr>
                  ) : liquidation.map((l) => (
                    <tr key={l.compte}>
                      <td>{l.compte}</td>
                      <td>{libelleCompteTenu(l.compte) ?? ''}</td>
                      <td>{l.sens === 'debit' ? formatMoney(l.montant) : ''}</td>
                      <td>{l.sens === 'credit' ? formatMoney(l.montant) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {arrondi !== 0 && (
              <p className="muted" style={{ marginTop: 4 }}>
                L’arrondi à l’euro des lignes de la CA3 fait {formatMoney(Math.abs(arrondi))}
                {arrondi > 0 ? ' de charge (658000), que la 2035 compte en frais divers de gestion.' : ' de produit (758000), que la 2035 compte en gains divers.'}
              </p>
            )}
            {piecesHorsDeLaDeclaration > 0 && (
              <p className="muted" style={{ color: 'var(--color-danger)' }}>
                Les pièces écartées ou à valider ci-dessus ne sont pas dans la déclaration qui sera enregistrée :
                leur TVA restera aux comptes 4456 et 4457, et rien ne la soldera. Si vous les avez reportées à la
                main sur la déclaration déposée, corrigez-les avant de l’enregistrer.
              </p>
            )}
            <div className="field-row aligne-bas">
              {champDate}
              {boutonEnregistrer('Enregistrer comme déposée')}
            </div>
            {suiteEnregistrement}
          </>
        )}
      </div>

      <div className="card table-scroll" style={{ padding: 0 }}>
        <h3 style={{ margin: 16 }}>Déclarations déposées</h3>
        {!loading && declarations.length === 0 ? (
          <div className="empty-state">
            {lectures.declarations ? 'Les déclarations déposées n’ont pas pu être lues.' : 'Aucune déclaration enregistrée pour ce dossier.'}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Période</th><th>Déposée le</th><th>Crédit reçu</th><th>TVA nette déposée</th><th>Recalculée aujourd’hui</th>
                <th>Écart</th><th>Paiement</th><th></th>
              </tr>
            </thead>
            <tbody>
              {comparees.map(({ declaration: d, recalcul, ecart, enEcart }) => {
                const suivi = suivis.find((s) => s.declaration.id === d.id)
                const paiement = suivi ? etatDuPaiement(suivi) : null
                const remboursement = suivi ? etatDuRemboursement(suivi) : null
                const figee = estFigee(d.periode_fin, frontiere)
                return (
                  <tr key={d.id}>
                    <td>{libellePeriode(d.periode_debut, d.periode_fin)}</td>
                    <td>{d.date_declaration ? formatDate(d.date_declaration) : '—'}</td>
                    <td>{formatMoney(d.credit_anterieur)}</td>
                    <td>{formatMoney(d.tva_declaree)}</td>
                    {d.cases ? (
                      <>
                        <td>{formatMoney(recalcul)}</td>
                        <td>
                          {enEcart
                            ? <span className="badge badge-danger" title="Une pièce de la période a changé depuis le dépôt : à régulariser sur une déclaration suivante (ligne 5B si le calcul a augmenté, 2C s'il a baissé).">{formatMoney(ecart)}</span>
                            : <span className="badge badge-ok">aucun</span>}
                        </td>
                      </>
                    ) : (
                      <td colSpan={2} className="muted">saisie à la main, avant l’ouverture</td>
                    )}
                    <td>
                      {/* Sur un relevé lu en partie, ce qui reste dû serait faux : on ne le dit pas. */}
                      {lectures.lignes ? '—' : (
                        <>
                          {paiement && <span className={`badge ${paiement.classe}`}>{paiement.texte}</span>}
                          {remboursement && <> <span className={`badge ${remboursement.classe}`}>{remboursement.texte}</span></>}
                        </>
                      )}
                    </td>
                    <td>
                      {figee
                        ? <span className="badge badge-neutral" title="Sa période tombe dans un exercice validé : elle est figée avec lui.">figée</span>
                        : <button className="btn btn-danger btn-sm" onClick={() => retirer(d)} disabled={ecritureEnCours}>Retirer</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {facturationElectronique}
    </>
  )
}
