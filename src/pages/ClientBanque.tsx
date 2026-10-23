import { Fragment, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { formatDate, formatMoney } from '../lib/format'
import { lireTout, type LectureComplete } from '../lib/lectureComplete'
import { lireLesDroitsVentes } from '../lib/espaceVentes'
import { correspondALaRecherche } from '../lib/recherche'
import { deposerFichier } from '../lib/depot'
import {
  anneesDuReleve, argumentsDeLaPrecision, argumentsDeProposer, argumentsDeRetirer, attendUnePiece, auteurPourLeClient,
  COLONNES_DE_LA_PIECE, COLONNES_DES_ENCAISSEMENTS, COLONNES_DES_FACTURES, COLONNES_DU_MOUVEMENT, correspondAuFiltre,
  couvertureDuReleve, ENCAISSEMENTS_LUS_EN_PARTIE, FACTURES_LUES_EN_PARTIE, FILTRES_D_ETAT, LIBELLE_DE_L_ETAT, libelleDuMois, longueurEnCaracteres, LONGUEUR_MAX_PRECISION,
  proposableParLeClient, refusDeLaPrecision, refusDeProposer, refusDeRetirer, sensDeLaVente, situationsDuReleve,
  soldeAuReleve, ventesLues, type EncaissementDuClient, type EtatDuMouvement, type FactureDuClient, type FiltreEtat,
  type MouvementDuClient, type PieceDuClient, type SituationDuMouvement, type VentesDuClient,
} from '../lib/banqueClient'
import type { ControleReleveBancaire, JustificatifPropose, PrecisionMouvement, ReglementGroupe } from '../lib/types'
import BarreRecherche from '../components/BarreRecherche'
import BandeauLecturePartielle from '../components/BandeauLecturePartielle'

// « MA BANQUE » (espace client, étape P9 ; conception : HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU
// CLIENT : LA CONCEPTION », §2.5 et §6). L'écran du client qui porte la case « Banque » sur la société AFFICHÉE : les
// mouvements du relevé que son cabinet a importé, l'état de chacun POUR LUI (lib/banqueClient.ts), le solde LU au dernier
// relevé contrôlé, les mois couverts ; et trois gestes, par les trois fonctions de la base et elles seules — proposer une
// pièce (déjà déposée, ou déposée ici puis proposée), retirer sa proposition, écrire une précision. Rien n'est écrit dans
// le relevé : le rapprochement reste au cabinet. Jamais la catégorie, le compte ni l'écriture.
//
// LA CASE SE LIT DEUX FOIS, comme pour « Ma simulation » et « Mes ventes » : à la connexion (AuthContext), pour la route
// et l'entrée (App.tsx, Layout.tsx) ; puis à la BASE, dans la même vague que les lectures qu'elle autorise
// (`droits_sur_le_dossier`) — une application installée reste ouverte des jours, et une case retirée entre-temps ferait
// lire un relevé que la RLS rend VIDE, sans erreur : l'écran dirait « aucun mouvement » d'un compte qui en a.
//
// RIEN N'EST AFFIRMÉ NI OFFERT SUR UNE LECTURE ABSENTE, EN COURS OU PARTIELLE : « Chargement… » avant la première ; les
// mouvements lus en partie ne se montrent pas ; les propositions ou le fil lus en partie taisent l'état de chaque
// mouvement et retirent tous les gestes ; les pièces lues en partie retirent le seul choix d'une pièce déjà déposée ; le
// solde lu en partie se tait. Chaque écriture passe un seul verrou `useRef`, relâché après la relecture ; pendant elle,
// aucun geste n'est offert.
//
// LES ENCAISSEMENTS DE SES FACTURES (ligne 28.65, étape VF5g). Le client dont la base dit qu'il porte AUSSI « Ventes » lit
// ensuite ses factures et leur registre des encaissements — après la case, jamais avant : sans elle, la RLS les rendrait
// vides sans erreur, et un mouvement réservé passerait pour « sans justificatif ». Un mouvement classé par ses
// encaissements se dit « Encaissement de tes factures » ; réservé à eux, « Encaissement enregistré — ton cabinet le
// classe », sans pièce à envoyer (lib/banqueClient.ts). Le registre lu en partie : les mouvements que le cabinet n'a pas
// encore classés taisent leur état et n'offrent rien, le résumé se tait, le bandeau le dit. Un client « Banque » seul ne
// lit rien de plus (VF5-Q3).

type Lecture = {
  mouvements: LectureComplete<MouvementDuClient>
  propositions: LectureComplete<JustificatifPropose>
  precisions: LectureComplete<PrecisionMouvement>
  reglements: LectureComplete<ReglementGroupe>
  pieces: LectureComplete<PieceDuClient>
  controles: LectureComplete<ControleDuClient>
  ventes: VentesDuClient
}

type ControleDuClient = Pick<ControleReleveBancaire, 'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'>

type Etat =
  | { etat: 'chargement' }
  | { etat: 'echec'; motif: string }
  | { etat: 'sans_banque' }
  | { etat: 'lu'; lecture: Lecture; motifs: Motifs }

// Ce qui n'a pas été lu en entier, lecture par lecture : nul quand elle l'a été.
type Motifs = {
  mouvements: string | null
  envois: string | null
  pieces: string | null
  reglements: string | null
  controles: string | null
  ventes: string | null
}

// Ce qu'un geste a rendu, dit sous le mouvement qui l'a reçu.
type Retour = { mouvementId: string; texte: string; erreur: boolean }

// Les factures du client « Ventes » et leur registre des encaissements (étape VF5g), lus en entier ; ne rejette jamais —
// une requête qui lève rend le motif, et l'état neuf se tait.
async function lireLesVentesDuClient(dossierId: string): Promise<VentesDuClient> {
  try {
    const [factures, encaissements] = await Promise.all([
      lireTout<FactureDuClient>((debut, fin) =>
        supabase.from('factures_emises').select(COLONNES_DES_FACTURES, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<EncaissementDuClient>((debut, fin) =>
        supabase.from('encaissements_factures').select(COLONNES_DES_ENCAISSEMENTS, { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    // Lue en partie, le registre ne se rend pas : un mouvement réservé dont l'encaissement manque passerait pour libre.
    if (!factures.complete) return { droit: 'ventes', lues: false, motif: FACTURES_LUES_EN_PARTIE }
    if (!encaissements.complete) return { droit: 'ventes', lues: false, motif: ENCAISSEMENTS_LUS_EN_PARTIE }
    return ventesLues(dossierId, factures.lignes, encaissements.lignes)
  } catch (erreur) {
    return { droit: 'ventes', lues: false, motif: messageErreur(erreur, 'les encaissements de tes factures n’ont pas pu être lus') }
  }
}

// Toutes les lectures de l'écran, et les cases vues par la base, en une vague ; puis, pour un client « Ventes », ses ventes.
// Ce qui a été lu sans la case n'est pas montré : la base a pu rendre un relevé vide sans le dire.
async function lireLaBanque(dossierId: string): Promise<Etat> {
  try {
    const [droits, mouvements, propositions, precisions, reglements, pieces, controles] = await Promise.all([
      lireLesDroitsVentes(supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles')),
      lireTout<MouvementDuClient>((debut, fin) =>
        supabase.from('lignes_bancaires').select(COLONNES_DU_MOUVEMENT, { count: 'exact' })
          .eq('dossier_id', dossierId).order('date', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<JustificatifPropose>((debut, fin) =>
        supabase.from('justificatifs_proposes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
      ),
      lireTout<PrecisionMouvement>((debut, fin) =>
        supabase.from('precisions_mouvements').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at').order('id').range(debut, fin),
      ),
      lireTout<ReglementGroupe>((debut, fin) =>
        supabase.from('reglements_groupes').select('*', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
      lireTout<PieceDuClient>((debut, fin) =>
        supabase.from('pieces').select(COLONNES_DE_LA_PIECE, { count: 'exact' })
          .eq('dossier_id', dossierId).order('created_at', { ascending: false }).order('id').range(debut, fin),
      ),
      lireTout<ControleDuClient>((debut, fin) =>
        supabase.from('controles_releves_bancaires').select('id, solde_final, coherent, periode_fin, created_at', { count: 'exact' })
          .eq('dossier_id', dossierId).order('id').range(debut, fin),
      ),
    ])
    if (droits.motif !== null) return { etat: 'echec', motif: `ton accès à ta banque n’a pas pu être vérifié (${droits.motif})` }
    if (!droits.droits.banque) return { etat: 'sans_banque' }
    const ventes: VentesDuClient = droits.droits.ventes ? await lireLesVentesDuClient(dossierId) : { droit: 'banque_seule' }
    // Chaque lecture garde son drapeau, que le module relit (`situationsDuReleve`, `soldeAuReleve`, `couvertureDuReleve`) ;
    // et chacune a son motif, que l'écran dit avec sa conséquence propre : aucune lecture partielle ne passe pour entière.
    return {
      etat: 'lu',
      lecture: { mouvements, propositions, precisions, reglements, pieces, controles, ventes },
      motifs: {
        mouvements: mouvements.motif,
        envois: [propositions, precisions].find((l) => !l.complete)?.motif ?? null,
        pieces: pieces.motif,
        reglements: reglements.motif,
        controles: controles.motif,
        ventes: ventes.droit === 'ventes' && !ventes.lues ? ventes.motif : null,
      },
    }
  } catch (erreur) {
    return { etat: 'echec', motif: messageErreur(erreur, 'ta banque n’a pas pu être lue') }
  }
}

const CLASSE_DE_L_ETAT: Record<EtatDuMouvement, string> = {
  sans_justificatif: 'badge-neutral',
  demande: 'badge-warning',
  propose: 'badge-neutral',
  justifie_piece: 'badge-ok',
  justifie_releve: 'badge-ok',
  traite: 'badge-ok',
  rien_a_fournir: 'badge-neutral',
  encaissement_factures: 'badge-ok',
  encaissement_enregistre: 'badge-neutral',
}

// Ce que l'état veut dire, pour le client, en une phrase. Les deux états des ventes (étape VF5g) se disent par
// `sensDeLaVente`, selon le sens du mouvement et les factures qu'il porte.
const SENS_DE_L_ETAT: Record<Exclude<EtatDuMouvement, 'encaissement_factures' | 'encaissement_enregistre'>, string> = {
  sans_justificatif: 'Aucune pièce n’est rattachée à ce mouvement pour l’instant. Si tu as sa facture ou son reçu, '
    + 'envoie-le ici : beaucoup de mouvements n’en demandent pas, ton cabinet sait lesquels.',
  demande: 'Ton cabinet a une question sur ce mouvement : réponds-lui ci-dessous, ou envoie la pièce qui le justifie.',
  propose: 'Une pièce est envoyée pour ce mouvement : ton cabinet la rapprochera, ou te dira ce qui manque.',
  justifie_piece: 'Ton cabinet a rapproché ce mouvement de sa pièce : il n’attend rien de toi.',
  justifie_releve: 'Ton cabinet a classé ce mouvement sans pièce : ton relevé suffit à le justifier.',
  traite: 'Ton cabinet a traité ce mouvement : il n’attend rien de toi.',
  rien_a_fournir: 'Ton cabinet n’attend aucune pièce pour ce mouvement.',
}

export default function ClientBanque() {
  const { dossierActifId, session } = useAuth()
  const dossierId = dossierActifId
  const moi = session?.user.id ?? null
  const [lecture, setLecture] = useState<Etat>({ etat: 'chargement' })
  // La période : une année du relevé, ou toutes. Nulle tant que le client n'a rien choisi : la plus récente.
  const [periode, setPeriode] = useState<number | 'toutes' | null>(null)
  const [filtre, setFiltre] = useState<FiltreEtat>('tous')
  const [recherche, setRecherche] = useState('')
  const [ouvert, setOuvert] = useState<string | null>(null)
  const [retour, setRetour] = useState<Retour | null>(null)
  // UN verrou pour les trois gestes : ils relisent tous le même relevé, et un geste parti pendant la relecture d'un autre
  // s'appuierait sur une liste pas encore revenue. Relâché après la relecture.
  const ecritureEnCours = useRef(false)
  const [enCours, setEnCours] = useState(false)
  // Les empreintes déjà déposées depuis cet écran (lib/depot.ts) : un même fichier envoyé deux fois se dit « déjà là ».
  const empreintesDeposees = useRef(new Set<string>())

  useEffect(() => {
    if (!dossierId) return
    // La coque remonte l'écran à chaque changement de société (`<Outlet key>`) : une réponse arrivée après un démontage ne
    // s'écrit pas.
    let annule = false
    lireLaBanque(dossierId).then((etat) => { if (!annule) setLecture(etat) })
    return () => { annule = true }
  }, [dossierId])

  async function relire(id: string) {
    setLecture(await lireLaBanque(id))
  }

  async function proposer(mouvement: MouvementDuClient, pieceId: string) {
    if (ecritureEnCours.current || !dossierId) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('proposer_justificatif', argumentsDeProposer(dossierId, mouvement.id, pieceId))
      setRetour(error
        ? { mouvementId: mouvement.id, erreur: true, texte: `Ta pièce n’a pas été envoyée : ${messageErreur(error, 'raison inconnue')}` }
        : { mouvementId: mouvement.id, erreur: false, texte: 'Ta pièce est envoyée : ton cabinet la voit à côté de ce mouvement.' })
      await relire(dossierId)
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Le dépôt d'aujourd'hui (le même que « Mes pièces »), puis la proposition de la pièce créée : deux écritures, l'une
  // après l'autre. Un fichier reconnu comme un document (un relevé, une attestation) ne se propose pas — la fonction exige
  // une pièce — et l'écran le dit ; une pièce déposée dont la proposition échoue reste déposée, et l'écran le dit aussi.
  async function deposerPuisProposer(mouvement: MouvementDuClient, fichier: File) {
    if (ecritureEnCours.current || !dossierId) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const depot = await deposerFichier(dossierId, fichier, empreintesDeposees.current)
      if (depot.statut === 'doublon') {
        setRetour({ mouvementId: mouvement.id, erreur: true, texte: 'Ce fichier est déjà dans ton dossier : choisis-le dans la liste des pièces déjà déposées.' })
        return
      }
      if (depot.statut === 'erreur') {
        setRetour({ mouvementId: mouvement.id, erreur: true, texte: `Ton fichier n’a pas été déposé : ${depot.message}` })
        return
      }
      if (depot.cible.type !== 'piece') {
        setRetour({
          mouvementId: mouvement.id, erreur: true,
          texte: 'Ton fichier est bien arrivé dans ton dossier, mais il a été reconnu comme un document (un relevé, une '
            + 'attestation…), pas comme une facture ou un reçu : il ne s’envoie pas pour un mouvement.',
        })
        await relire(dossierId)
        return
      }
      const { error } = await supabase.rpc('proposer_justificatif', argumentsDeProposer(dossierId, mouvement.id, depot.cible.id))
      setRetour(error
        ? {
          mouvementId: mouvement.id, erreur: true,
          texte: `Ta pièce est déposée dans ton dossier, mais elle n’a pas été envoyée pour ce mouvement : `
            + `${messageErreur(error, 'raison inconnue')}`,
        }
        : { mouvementId: mouvement.id, erreur: false, texte: 'Ta pièce est déposée et envoyée : ton cabinet la voit à côté de ce mouvement.' })
      await relire(dossierId)
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  async function retirer(mouvementId: string, proposition: JustificatifPropose) {
    if (ecritureEnCours.current || !dossierId) return
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('retirer_proposition', argumentsDeRetirer(dossierId, proposition.id))
      setRetour(error
        ? { mouvementId, erreur: true, texte: `Ta proposition n’a pas été retirée : ${messageErreur(error, 'raison inconnue')}` }
        : { mouvementId, erreur: false, texte: 'Ta proposition est retirée. Elle reste datée dans l’historique de ton cabinet.' })
      await relire(dossierId)
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  // Rend vrai quand la précision est écrite : la zone de saisie se vide alors, et pas avant.
  async function preciser(mouvement: MouvementDuClient, texte: string): Promise<boolean> {
    if (ecritureEnCours.current || !dossierId) return false
    ecritureEnCours.current = true
    setEnCours(true)
    try {
      const { error } = await supabase.rpc('ecrire_precision_mouvement', argumentsDeLaPrecision(dossierId, mouvement.id, texte))
      setRetour(error
        ? { mouvementId: mouvement.id, erreur: true, texte: `Ta précision n’a pas été envoyée : ${messageErreur(error, 'raison inconnue')}` }
        : { mouvementId: mouvement.id, erreur: false, texte: 'Ta précision est envoyée à ton cabinet.' })
      await relire(dossierId)
      return !error
    } finally {
      ecritureEnCours.current = false
      setEnCours(false)
    }
  }

  if (!dossierId) {
    return <p className="muted">Aucune société ne t’est encore rattachée — contacte ton cabinet comptable.</p>
  }

  return (
    <>
      <div className="topbar"><h1>Ma banque</h1></div>
      {lecture.etat === 'chargement' ? (
        <p className="muted">Chargement…</p>
      ) : lecture.etat === 'echec' ? (
        <p className="error-text">
          Ta banque ne s’affiche pas : {lecture.motif}. Sans elle, rien ne t’est montré ni proposé. Recharge la page.
        </p>
      ) : lecture.etat === 'sans_banque' ? (
        <p className="muted">
          Ton accès ne porte plus « Banque » sur cette société : ta banque ne s’affiche pas ici. Pour la retrouver, demande à
          ton cabinet d’ajouter « Banque » à ton accès.
        </p>
      ) : (
        <Releve
          dossierId={dossierId}
          moi={moi}
          lecture={lecture.lecture}
          motifs={lecture.motifs}
          periode={periode}
          onPeriode={setPeriode}
          filtre={filtre}
          onFiltre={setFiltre}
          recherche={recherche}
          onRecherche={setRecherche}
          ouvert={ouvert}
          onOuvrir={setOuvert}
          retour={retour}
          enCours={enCours}
          onProposer={proposer}
          onDeposer={deposerPuisProposer}
          onRetirer={retirer}
          onPreciser={preciser}
        />
      )}
    </>
  )
}

interface ProprietesReleve {
  dossierId: string
  moi: string | null
  lecture: Lecture
  motifs: Motifs
  periode: number | 'toutes' | null
  onPeriode: (p: number | 'toutes') => void
  filtre: FiltreEtat
  onFiltre: (f: FiltreEtat) => void
  recherche: string
  onRecherche: (r: string) => void
  ouvert: string | null
  onOuvrir: (id: string | null) => void
  retour: Retour | null
  enCours: boolean
  onProposer: (m: MouvementDuClient, pieceId: string) => void
  onDeposer: (m: MouvementDuClient, fichier: File) => void
  onRetirer: (mouvementId: string, p: JustificatifPropose) => void
  onPreciser: (m: MouvementDuClient, texte: string) => Promise<boolean>
}

function Releve(p: ProprietesReleve) {
  const { lecture } = p
  const situations = situationsDuReleve(lecture)
  const solde = soldeAuReleve(lecture.controles)
  const couverture = couvertureDuReleve(lecture.mouvements)
  const annees = anneesDuReleve(lecture.mouvements.lignes)
  const periode = p.periode ?? annees[0] ?? 'toutes'
  const dansLaPeriode = lecture.mouvements.lignes.filter((m) => periode === 'toutes' || Number(m.date.slice(0, 4)) === periode)
  const etatDe = (m: MouvementDuClient): SituationDuMouvement | null => (situations.lues ? situations.parMouvement.get(m.id) ?? null : null)
  // Tous les états dits : ni situation muette, ni mouvement que le registre lu en partie tait (étape VF5g). Sinon, ni
  // résumé ni filtre d'état — un compte ou un filtre qui manquerait les mouvements tus affirmerait ce qu'on ne sait pas.
  const etatsDits = situations.lues && situations.tus === null
  const filtre: FiltreEtat = etatsDits ? p.filtre : 'tous'
  // Ce que le détail d'un mouvement sans état dit de son silence.
  const pourquoiTu = situations.lues
    ? 'L’état de ce mouvement ne s’affiche pas tant que les encaissements de tes factures n’ont pas été lus en entier.'
    : 'L’état de ce mouvement ne s’affiche pas tant que tes envois n’ont pas été lus en entier.'
  // « N sur M » : M après les filtres de l'écran (la période, l'état), avant la recherche.
  const filtres = dansLaPeriode.filter((m) => {
    const s = etatDe(m)
    return s === null ? filtre === 'tous' : correspondAuFiltre(s.etat, filtre)
  })
  const affiches = filtres.filter((m) => {
    const s = etatDe(m)
    return correspondALaRecherche([formatDate(m.date), m.libelle, m.montant, s ? LIBELLE_DE_L_ETAT[s.etat] : null], p.recherche)
  })
  const nomDesPieces = new Map(lecture.pieces.lignes.map((x) => [x.id, x.nom_fichier]))
  const libellePeriode = periode === 'toutes' ? 'tout ton relevé' : `${periode}`
  const attendent = situations.lues ? dansLaPeriode.filter((m) => attendUnePiece(situations.parMouvement.get(m.id)?.etat ?? 'traite')) : []
  const demandes = attendent.filter((m) => situations.lues && situations.parMouvement.get(m.id)?.etat === 'demande')
  const envoyes = situations.lues ? dansLaPeriode.filter((m) => situations.parMouvement.get(m.id)?.etat === 'propose') : []
  const enregistres = situations.lues
    ? dansLaPeriode.filter((m) => situations.parMouvement.get(m.id)?.etat === 'encaissement_enregistre')
    : []

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Tu vois ici le relevé de ton compte professionnel que ton cabinet a importé. Ta banque ne se connecte pas depuis ton
        espace : pour un relevé plus récent, envoie-le à ton cabinet dans « Mes pièces ».
      </p>

      <BandeauLecturePartielle
        quoi="Tes mouvements" accord="lus" motif={p.motifs.mouvements} technique={false}
        consequence="Ils ne s’affichent pas : un mouvement manquant passerait pour absent de ton relevé. Recharge la page."
      />
      <BandeauLecturePartielle
        quoi="Tes justificatifs envoyés et tes précisions" accord="lus"
        motif={p.motifs.envois} technique={false}
        consequence="L’état de chaque mouvement ne s’affiche pas, et rien ne t’est proposé : un justificatif déjà envoyé passerait pour manquant. Recharge la page."
      />
      <BandeauLecturePartielle
        quoi="Tes factures et leurs encaissements" accord="lus" motif={p.motifs.ventes} technique={false}
        consequence="L’état des mouvements que ton cabinet n’a pas encore classés ne s’affiche pas, et rien ne t’y est proposé : l’un d’eux règle peut-être une de tes factures. Recharge la page."
      />
      <BandeauLecturePartielle
        quoi="Tes pièces" accord="lues" motif={p.motifs.pieces} technique={false}
        consequence="Choisir une pièce déjà déposée ne t’est pas proposé ; tu peux en déposer une nouvelle. Recharge la page."
      />
      <BandeauLecturePartielle
        quoi="Les pièces des virements qui en règlent plusieurs" accord="lues" motif={p.motifs.reglements} technique={false}
        consequence="Leurs noms ne s’affichent pas. Recharge la page."
      />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Ton compte</h3>
        <SoldeDuReleve solde={solde} motif={p.motifs.controles} />
        <CouvertureDuCompte couverture={couverture} />
      </div>

      {lecture.mouvements.complete && (
        <>
          <h3>Tes mouvements</h3>
          {etatsDits && (
            <p style={{ marginTop: 0 }}>
              {attendent.length === 0
                ? `Sur ${libellePeriode}, aucun mouvement n’attend de pièce de ta part.`
                : `Sur ${libellePeriode}, ${attendent.length} mouvement(s) sans justificatif`
                  + (demandes.length > 0 ? `, dont ${demandes.length} demandé(s) par ton cabinet.` : '.')}
              {envoyes.length > 0 && ` ${envoyes.length} justificatif(s) envoyé(s) attendent ton cabinet.`}
              {enregistres.length > 0 && ` ${enregistres.length} encaissement(s) de tes factures attendent que ton cabinet les classe.`}
            </p>
          )}
          <div className="field-row" style={{ marginBottom: 6 }}>
            <div className="field">
              <label htmlFor="banque-periode">Période</label>
              <select
                id="banque-periode"
                value={String(periode)}
                onChange={(e) => p.onPeriode(e.target.value === 'toutes' ? 'toutes' : Number(e.target.value))}
              >
                {annees.map((a) => <option key={a} value={String(a)}>{a}</option>)}
                <option value="toutes">Toutes les années</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="banque-filtre">Afficher</label>
              <select
                id="banque-filtre"
                value={filtre}
                disabled={!etatsDits}
                onChange={(e) => p.onFiltre(e.target.value as FiltreEtat)}
              >
                {FILTRES_D_ETAT.map((f) => <option key={f.valeur} value={f.valeur}>{f.libelle}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <BarreRecherche
              valeur={p.recherche}
              onChange={p.onRecherche}
              placeholder="Rechercher un mouvement…"
              affiches={affiches.length}
              total={filtres.length}
            />
          </div>
          <div className="card table-scroll" style={{ padding: 0 }}>
            {affiches.length === 0 ? (
              <div className="empty-state">
                {lecture.mouvements.lignes.length === 0
                  ? 'Ton relevé ne porte encore aucun mouvement : ton cabinet n’a pas encore importé de relevé.'
                  : p.recherche.trim()
                    ? `Aucun mouvement ne correspond à « ${p.recherche.trim()} ».`
                    : 'Aucun mouvement de cette période ne correspond à ce choix.'}
              </div>
            ) : (
              <div className="tableau-adaptable">
                <table className="table-empilable table-empilable-en-carte">
                  <thead><tr><th>Date</th><th>Libellé</th><th>Montant</th><th>État</th><th>Détail</th></tr></thead>
                  <tbody>
                    {affiches.map((m) => {
                      const s = etatDe(m)
                      const estOuvert = p.ouvert === m.id
                      return (
                        <Fragment key={m.id}>
                          <tr>
                            <td data-libelle="Date">{formatDate(m.date)}</td>
                            <td data-libelle="Libellé">{m.libelle}</td>
                            <td data-libelle="Montant" style={{ whiteSpace: 'nowrap' }}>{formatMoney(m.montant)}</td>
                            <td data-libelle="État">
                              {s === null ? (
                                <span className="muted">—</span>
                              ) : (
                                <span className="pastilles-empilees">
                                  <span className={`badge badge-une-ligne ${CLASSE_DE_L_ETAT[s.etat]}`}>{LIBELLE_DE_L_ETAT[s.etat]}</span>
                                  {s.questionEnAttente && s.etat !== 'demande' && (
                                    <span className="badge badge-une-ligne badge-warning">Question de ton cabinet</span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="td-boutons">
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                aria-expanded={estOuvert}
                                onClick={() => p.onOuvrir(estOuvert ? null : m.id)}
                              >
                                {estOuvert ? 'Refermer' : 'Ouvrir'}
                              </button>
                            </td>
                          </tr>
                          {estOuvert && (
                            <tr>
                              <td colSpan={5} style={{ background: 'var(--color-surface-2)' }}>
                                <DetailDuMouvement
                                  {...p}
                                  mouvement={m}
                                  situation={s}
                                  pourquoiTu={pourquoiTu}
                                  nomDesPieces={nomDesPieces}
                                  piecesLues={lecture.pieces.complete}
                                  pieces={lecture.pieces.lignes}
                                  propositionsDuDossier={lecture.propositions.lignes}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}

function SoldeDuReleve({ solde, motif }: { solde: ReturnType<typeof soldeAuReleve>; motif: string | null }) {
  switch (solde.etat) {
    case 'lu':
      return (
        <>
          <p style={{ margin: '0 0 4px' }}>
            Solde au relevé du {formatDate(solde.au)} : <strong style={{ whiteSpace: 'nowrap' }}>{formatMoney(solde.solde)}</strong>
          </p>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: '0.85rem' }}>
            Le solde final du dernier relevé dont ton cabinet a contrôlé le solde. Il n’est jamais calculé en additionnant
            les mouvements : un mouvement manquant le rendrait faux.
          </p>
        </>
      )
    case 'aucun_releve':
      return <p className="muted" style={{ margin: '0 0 12px' }}>Pas de solde à afficher : ton cabinet n’a encore importé aucun relevé dont le solde a été contrôlé.</p>
    case 'aucun_solde_sur':
      return (
        <p className="muted" style={{ margin: '0 0 12px' }}>
          Pas de solde à afficher : le solde de tes relevés importés ({solde.releves}) n’a pas pu être contrôlé, ou leur
          période n’est pas datée.
        </p>
      )
    case 'muet':
      // Le motif technique en infobulle, comme les bandeaux du client : un compte de lignes ne lui dit rien.
      return <p className="error-text" style={{ margin: '0 0 12px' }} title={motif ?? undefined}>Le solde ne s’affiche pas : tes relevés contrôlés n’ont pas pu être lus en entier. Recharge la page.</p>
  }
}

function CouvertureDuCompte({ couverture }: { couverture: ReturnType<typeof couvertureDuReleve> }) {
  if (couverture.etat === 'muet') return null
  if (couverture.etat === 'vide') return <p className="muted" style={{ margin: 0 }}>Ton relevé ne porte encore aucun mouvement.</p>
  return (
    <>
      <p style={{ margin: '0 0 4px' }}>
        Ton relevé va de {libelleDuMois(couverture.premierMois)} à {libelleDuMois(couverture.dernierMois)}, dernier mouvement
        le {formatDate(couverture.dernierMouvement)}.
      </p>
      {couverture.moisSansMouvement.length > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Mois sans aucun mouvement dans ton relevé : {couverture.moisSansMouvement.map(libelleDuMois).join(', ')}. S’il
          manque un relevé, envoie-le dans « Mes pièces ».
        </p>
      )}
    </>
  )
}

function DetailDuMouvement(p: ProprietesReleve & {
  mouvement: MouvementDuClient
  situation: SituationDuMouvement | null
  pourquoiTu: string
  nomDesPieces: Map<string, string>
  piecesLues: boolean
  pieces: PieceDuClient[]
  propositionsDuDossier: JustificatifPropose[]
}) {
  const { mouvement: m, situation: s } = p
  const [choix, setChoix] = useState('')
  const [texte, setTexte] = useState('')
  const nom = (id: string) => p.nomDesPieces.get(id) ?? 'une pièce'
  // Les gestes : jamais sur une situation tue (propositions ou fil lus en partie), ni pendant une écriture et sa relecture.
  const gestes = s !== null && !p.enCours
  const retour = p.retour?.mouvementId === m.id ? p.retour : null
  const pieceChoisie = p.pieces.find((x) => x.id === choix) ?? null
  const refusDuChoix = pieceChoisie
    ? refusDeProposer({
      dossierId: p.dossierId, gereLaBanque: true, mouvement: m, piece: pieceChoisie, propositions: p.propositionsDuDossier,
      exercicesValides: { lus: false },
    })
    : null
  const refusDuTexte = refusDeLaPrecision({ dossierId: p.dossierId, gereLaBanque: true, mouvement: m, texte })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0' }}>
      {s === null ? (
        <p className="muted" style={{ margin: 0 }}>{p.pourquoiTu}</p>
      ) : (
        <p style={{ margin: 0 }}>
          <strong>{LIBELLE_DE_L_ETAT[s.etat]}.</strong>{' '}
          {s.etat === 'encaissement_factures' || s.etat === 'encaissement_enregistre'
            ? sensDeLaVente(s.etat, m.montant, s.facturesDeLaVente)
            : SENS_DE_L_ETAT[s.etat]}
          {s.etat === 'justifie_piece' && (
            s.piecesQuiJustifient === null
              ? ' Les pièces de ce virement ne s’affichent pas.'
              : s.piecesQuiJustifient.length > 0 && <> Pièce(s) : <span className="nom-fichier">{s.piecesQuiJustifient.map(nom).join(', ')}</span>.</>
          )}
        </p>
      )}

      {s !== null && s.propositions.length > 0 && (
        <div>
          <strong>Justificatifs envoyés</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {s.propositions.map((j) => {
              const refus = p.moi ? refusDeRetirer({
                dossierId: p.dossierId, gereLaBanque: true, proposition: j, appelant: p.moi, estCabinet: false,
              }) : null
              return (
                <li key={j.id} style={{ marginBottom: 6 }}>
                  <span className="nom-fichier">{nom(j.piece_id)}</span>
                  {' '}— {auteurPourLeClient(j, p.moi ?? '')}, le {formatDate(j.created_at)}
                  {/* Son auteur la retire ; celle d'un autre (ton cabinet, un autre accès) ne t'offre pas de bouton. */}
                  {p.moi && refus === null && (
                    <>
                      {' '}
                      <button type="button" className="btn btn-outline btn-sm" disabled={!gestes} onClick={() => p.onRetirer(m.id, j)}>
                        Retirer
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {s !== null && proposableParLeClient(m, s.etat) && (
        <div>
          <strong>Envoyer une pièce pour ce mouvement</strong>
          {p.piecesLues ? (
            <div className="field-row aligne-bas" style={{ marginTop: 6 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`piece-${m.id}`}>Une pièce déjà déposée</label>
                <select id={`piece-${m.id}`} value={choix} onChange={(e) => setChoix(e.target.value)} disabled={!gestes}>
                  <option value="">— Choisis une pièce —</option>
                  {p.pieces.map((x) => {
                    const deja = refusDeProposer({
                      dossierId: p.dossierId, gereLaBanque: true, mouvement: m, piece: x, propositions: p.propositionsDuDossier,
                      exercicesValides: { lus: false },
                    })
                    return (
                      <option key={x.id} value={x.id} disabled={deja !== null}>
                        {x.nom_fichier} — déposée le {formatDate(x.created_at)}{deja ? ' (déjà envoyée pour ce mouvement)' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!gestes || !pieceChoisie || refusDuChoix !== null}
                onClick={() => { if (pieceChoisie && refusDuChoix === null) p.onProposer(m, pieceChoisie.id) }}
              >
                Envoyer cette pièce
              </button>
            </div>
          ) : (
            <p className="muted" style={{ margin: '6px 0 0' }}>Choisir une pièce déjà déposée ne t’est pas proposé : tes pièces n’ont pas pu être lues en entier.</p>
          )}
          {refusDuChoix && <p className="error-text" style={{ margin: '6px 0 0' }}>{refusDuChoix.message}</p>}
          <div style={{ marginTop: 8 }}>
            <label className={`btn btn-outline btn-sm${gestes ? '' : ' disabled'}`} style={{ cursor: gestes ? 'pointer' : 'not-allowed' }}>
              Déposer une nouvelle pièce
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                style={{ display: 'none' }}
                disabled={!gestes}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onDeposer(m, f) }}
              />
            </label>
            <span className="muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>Elle arrive dans « Mes pièces », puis est envoyée pour ce mouvement.</span>
          </div>
        </div>
      )}

      {s !== null && (
        <div>
          <strong>Précisions</strong>
          {s.precisions.length === 0 ? (
            <p className="muted" style={{ margin: '6px 0' }}>Aucune précision sur ce mouvement pour l’instant.</p>
          ) : (
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
              {s.precisions.map((q) => (
                <li key={q.id} style={{ marginBottom: 6 }}>
                  <span className="muted">{auteurPourLeClient(q, p.moi ?? '')}, le {formatDate(q.created_at)} :</span>{' '}
                  <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{q.texte}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="field" style={{ marginBottom: 6 }}>
            <label htmlFor={`precision-${m.id}`}>Ta précision</label>
            <textarea
              id={`precision-${m.id}`}
              rows={3}
              value={texte}
              disabled={!gestes}
              placeholder="Ex. : abonnement du logiciel de télétransmission"
              onChange={(e) => setTexte(e.target.value)}
            />
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {longueurEnCaracteres(texte)} / {LONGUEUR_MAX_PRECISION.toLocaleString('fr-FR')} caractères. Une précision envoyée ne se modifie pas : on se corrige en en ajoutant une.
            </span>
          </div>
          {refusDuTexte && refusDuTexte.cle !== 'precision_vide' && <p className="error-text" style={{ margin: '0 0 6px' }}>{refusDuTexte.message}</p>}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!gestes || refusDuTexte !== null}
            onClick={async () => { if (refusDuTexte === null && await p.onPreciser(m, texte)) setTexte('') }}
          >
            Envoyer la précision
          </button>
        </div>
      )}

      {retour && <p className={retour.erreur ? 'error-text' : 'muted'} style={{ margin: 0 }} role="status">{retour.texte}</p>}
    </div>
  )
}
