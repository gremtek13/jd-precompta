import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageErreur } from '../lib/messageErreur'
import { aujourdHuiAParis, formatDate, formatMoney } from '../lib/format'
import { lireTout, type LectureComplete } from '../lib/lectureComplete'
import { lireLesDroitsVentes } from '../lib/espaceVentes'
import { correspondALaRecherche } from '../lib/recherche'
import { EnTeteTriable, SelecteurDeTri } from '../components/EnTeteTriable'
import { trierLignes, type ColonneTriable } from '../lib/triDesTableaux'
import { useTriDuTableau } from '../lib/useTriDuTableau'
import { deposerFichier } from '../lib/depot'
import {
  anneesDuReleve, argumentsDeLaPrecision, argumentsDeProposer, argumentsDeRetirer, attendUnePiece, auteurPourLeClient,
  COLONNES_DE_LA_PIECE, COLONNES_DES_ENCAISSEMENTS, COLONNES_DES_FACTURES, COLONNES_DU_MOUVEMENT, COLONNES_DU_MOUVEMENT_PAR_COMPTE,
  correspondAuFiltre,
  couvertureDuReleve, ENCAISSEMENTS_LUS_EN_PARTIE, FACTURES_LUES_EN_PARTIE, FILTRES_D_ETAT, LIBELLE_DE_L_ETAT, libelleDuMois, longueurEnCaracteres, LONGUEUR_MAX_PRECISION,
  proposableParLeClient, refusDeLaPrecision, refusDeProposer, refusDeRetirer, sensDeLaVente, situationsDuReleve,
  soldeAuReleve, ventesLues, type EncaissementDuClient, type EtatDuMouvement, type FactureDuClient, type FiltreEtat,
  type MouvementDuClient, type PieceDuClient, type SituationDuMouvement, type VentesDuClient,
} from '../lib/banqueClient'
import type { JustificatifPropose, PrecisionMouvement, ReglementGroupe } from '../lib/types'
import { COMPTES_BANCAIRES_PREVUS } from '../lib/comptesBancaires'
import {
  banqueParCompte, correspondAuCompte, filtreDeCompteValide, finDuNumero,
  type ComptesDuClient, type CompteDuClient, type CouvertureDUnCompte, type FiltreDeCompte,
} from '../lib/banqueClientParCompte'
import { lireLesComptesDuClient, lireLesControlesDuClient, type ControleDuClient } from '../lib/banqueClientLecture'
import {
  A_VENIR, analyseDeMaBanque, ANALYSE_SANS_RELEVE, ANALYSE_SANS_TOTAL_DES_COMPTES, anneeDeMaBanque, INTRODUCTION_DE_L_ANALYSE,
  libelleDeLaCouverture, motsDeLAnnee, NON_COUVERT, TITRE_DE_L_ANALYSE, variationEnPourcent,
  anneesCocheesParDefaut, AUCUN_MOIS_COUVERT, AUCUNE_ANNEE_COCHEE, courbesDesAnnees, echelleDesCourbes, LEGENDE_DU_MOIS_EN_PARTIE,
  LEGENDE_DU_TROU, MESURES_DES_COURBES, TITRE_DES_COURBES,
  type AnneeDeMaBanque, type CourbeDUneAnnee, type EtatDuMois, type MesureDesCourbes, type SourceDUnCompte, type Totaux,
} from '../lib/analyseDeMaBanque'
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
// lit rien de plus (VF5-Q3). Le détail d'un virement mixte classé nomme aussi la facture d'avant la bascule qu'il paie, dans
// la même ligne « Facture(s) » que les factures sources (étape VF8h, VF5H-Q3) : le module la tire du même registre, lu par
// les mêmes deux lectures — rien de plus n'est lu.
//
// PLUSIEURS COMPTES BANCAIRES (ligne 26.6, lot MCB7 ; MCB-Q8 : « Banque » ouvre tous les comptes), derrière
// `COMPTES_BANCAIRES_PREVUS` : levé, l'écran lit aussi les comptes du dossier (leur nom, leur rang, la fin de l'identifiant,
// l'ouverture et la clôture — jamais leur compte du plan) et le compte de chaque mouvement et de chaque relevé contrôlé. Dès
// deux comptes, chacun dit son solde LU au dernier relevé contrôlé de CE compte et ses mois sans mouvement, et les mouvements
// se filtrent par compte (lib/banqueClientParCompte.ts). Les comptes illisibles, ou un mouvement d'un compte que la lecture
// n'a pas rendu : ni solde ni mois ne se disent, et aucun geste ne s'offre. Baissé, rien de cela n'est lu : l'écran d'hier.
//
// « MON ANNÉE » (demande du cabinet du 16/11/2026) : les entrées, les sorties et leur différence, année par année et mois par
// mois, et la comparaison à la même période de l'année d'avant (lib/analyseDeMaBanque.ts). Rien de plus n'est lu : les
// mouvements et les relevés contrôlés de cette même vague, le début de la période de chaque relevé compris. Un mois qu'aucun
// relevé contrôlé ne couvre se dit « non couvert », jamais 0 ; une lecture partielle tait toute la section ; plusieurs
// comptes : chacun son année, jamais leur total.

type Lecture = {
  mouvements: LectureComplete<MouvementDuClient>
  propositions: LectureComplete<JustificatifPropose>
  precisions: LectureComplete<PrecisionMouvement>
  reglements: LectureComplete<ReglementGroupe>
  pieces: LectureComplete<PieceDuClient>
  controles: LectureComplete<ControleDuClient>
  ventes: VentesDuClient
  comptes: ComptesDuClient
}

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
  comptes: string | null
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

// Les gestes se retiennent quand les comptes ne se partagent pas (MCB7) : seconde ligne, l'écran ne les offre pas.
function gestesRetenusParLesComptes(etat: Etat): boolean {
  return etat.etat === 'lu' && banqueParCompte(etat.lecture.comptes, etat.lecture.mouvements, etat.lecture.controles).etat === 'retenue'
}

// Toutes les lectures de l'écran, et les cases vues par la base, en une vague ; puis, pour un client « Ventes », ses ventes.
// Ce qui a été lu sans la case n'est pas montré : la base a pu rendre un relevé vide sans le dire.
async function lireLaBanque(dossierId: string): Promise<Etat> {
  // Lu une fois par lecture : le drapeau (une constante, que les tests jouent dans ses deux états) décide de toute la vague.
  const parCompte = COMPTES_BANCAIRES_PREVUS
  try {
    const [droits, mouvements, propositions, precisions, reglements, pieces, controles, comptes] = await Promise.all([
      lireLesDroitsVentes(supabase.rpc('droits_sur_le_dossier', { p_dossier_id: dossierId }), (e) => messageErreur(e, 'droits illisibles')),
      lireTout<MouvementDuClient>((debut, fin) =>
        // Deux chaînes littérales, deux requêtes : supabase-js lit le type de chacune.
        parCompte
          ? supabase.from('lignes_bancaires').select(COLONNES_DU_MOUVEMENT_PAR_COMPTE, { count: 'exact' })
            .eq('dossier_id', dossierId).order('date', { ascending: false }).order('id').range(debut, fin)
          : supabase.from('lignes_bancaires').select(COLONNES_DU_MOUVEMENT, { count: 'exact' })
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
      // Les relevés contrôlés et les comptes : la lecture que le solde de l'accueil fait aussi (lib/banqueClientLecture.ts).
      lireLesControlesDuClient(dossierId, parCompte),
      parCompte ? lireLesComptesDuClient(dossierId) : Promise.resolve<ComptesDuClient>({ etat: 'sans_objet' }),
    ])
    if (droits.motif !== null) return { etat: 'echec', motif: `ton accès à ta banque n’a pas pu être vérifié (${droits.motif})` }
    if (!droits.droits.banque) return { etat: 'sans_banque' }
    const ventes: VentesDuClient = droits.droits.ventes ? await lireLesVentesDuClient(dossierId) : { droit: 'banque_seule' }
    // Chaque lecture garde son drapeau, que le module relit (`situationsDuReleve`, `soldeAuReleve`, `couvertureDuReleve`) ;
    // et chacune a son motif, que l'écran dit avec sa conséquence propre : aucune lecture partielle ne passe pour entière.
    return {
      etat: 'lu',
      lecture: { mouvements, propositions, precisions, reglements, pieces, controles, ventes, comptes },
      motifs: {
        mouvements: mouvements.motif,
        envois: [propositions, precisions].find((l) => !l.complete)?.motif ?? null,
        pieces: pieces.motif,
        reglements: reglements.motif,
        controles: controles.motif,
        ventes: ventes.droit === 'ventes' && !ventes.lues ? ventes.motif : null,
        comptes: comptes.etat === 'illisible' ? comptes.motif : null,
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
  const [filtreCompte, setFiltreCompte] = useState<FiltreDeCompte>('tous')
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
    if (ecritureEnCours.current || !dossierId || gestesRetenusParLesComptes(lecture)) return
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
    if (ecritureEnCours.current || !dossierId || gestesRetenusParLesComptes(lecture)) return
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
    if (ecritureEnCours.current || !dossierId || gestesRetenusParLesComptes(lecture)) return
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
    if (ecritureEnCours.current || !dossierId || gestesRetenusParLesComptes(lecture)) return false
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
          filtreCompte={filtreCompte}
          onFiltreCompte={setFiltreCompte}
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
  filtreCompte: FiltreDeCompte
  onFiltreCompte: (c: FiltreDeCompte) => void
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
  // Le tri choisi d'un toucher sur un en-tête (16/11/2026) : l'affichage seul, remis à l'ordre d'origine au changement de dossier.
  const { tri, trierPar, choisirTri } = useTriDuTableau(p.dossierId)
  const situations = situationsDuReleve(lecture)
  const solde = soldeAuReleve(lecture.controles)
  const couverture = couvertureDuReleve(lecture.mouvements)
  // Les comptes bancaires (MCB7) : `un`, l'écran d'hier ; `comptes`, chacun nommé ; `retenue`, rien par compte ni aucun geste.
  const banque = banqueParCompte(lecture.comptes, lecture.mouvements, lecture.controles)
  const comptesNommes = banque.etat === 'comptes' ? banque.comptes : null
  const gestesRetenus = banque.etat === 'retenue'
  const filtreCompte = filtreDeCompteValide(p.filtreCompte, banque)
  const nomDuCompte = new Map((comptesNommes ?? []).map((e) => [e.compte.id, e.compte.libelle]))
  const annees = anneesDuReleve(lecture.mouvements.lignes)
  const periode = p.periode ?? annees[0] ?? 'toutes'
  // La période et le compte : les filtres de l'écran, que le résumé suit aussi (il le dit) ; la recherche, elle, n'y touche pas.
  const dansLaPeriode = lecture.mouvements.lignes.filter((m) => (periode === 'toutes' || Number(m.date.slice(0, 4)) === periode)
    && correspondAuCompte(m, filtreCompte))
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
    return correspondALaRecherche([formatDate(m.date), m.libelle, m.montant, s ? LIBELLE_DE_L_ETAT[s.etat] : null,
      nomDuCompte.get(m.compte_bancaire_id ?? '') ?? null], p.recherche)
  })
  // LE TRI CHOISI (16/11/2026) : il n'ordonne que les lignes dessinées ; le résumé, les filtres et le compteur restent sur les
  // listes d'avant. Un mouvement dont l'état est tu va en fin, comme toute valeur vide. Le compte, seulement s'il est nommé.
  const colonnesTri: ColonneTriable<MouvementDuClient>[] = [
    { cle: 'date', libelle: 'Date', type: 'date', valeur: (m) => m.date },
    ...(comptesNommes !== null
      ? [{ cle: 'compte', libelle: 'Compte', type: 'texte', valeur: (m) => nomDuCompte.get(m.compte_bancaire_id ?? '') } satisfies ColonneTriable<MouvementDuClient>]
      : []),
    { cle: 'libelle', libelle: 'Libellé', type: 'texte', valeur: (m) => m.libelle },
    { cle: 'montant', libelle: 'Montant', type: 'montant', valeur: (m) => m.montant },
    { cle: 'etat', libelle: 'État', type: 'rang', valeur: (m) => etatDe(m)?.etat, ordre: Object.keys(LIBELLE_DE_L_ETAT) },
  ]
  const affichesTries = trierLignes(affiches, colonnesTri, tri)
  const nomDesPieces = new Map(lecture.pieces.lignes.map((x) => [x.id, x.nom_fichier]))
  const libellePeriode = (periode === 'toutes' ? 'tout ton relevé' : `${periode}`)
    + (filtreCompte === 'tous' ? '' : ` sur le compte « ${nomDuCompte.get(filtreCompte) ?? ''} »`)
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
      <BandeauLecturePartielle
        quoi="Tes comptes bancaires" accord="lus" motif={p.motifs.comptes} technique={false}
        consequence="Ni le solde ni les mois de chaque compte ne s’affichent, et rien ne t’est proposé : le solde d’un compte passerait pour celui de toute ta banque. Recharge la page."
      />

      {banque.etat === 'retenue' ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Tes comptes</h3>
          <p className="error-text" style={{ margin: 0 }} title={banque.raison}>
            Ni le solde ni les mois de tes comptes ne s’affichent, et rien ne t’est proposé : tes comptes bancaires n’ont pas
            pu être lus en entier, ou un mouvement est d’un compte qui ne s’est pas affiché. Recharge la page.
          </p>
        </div>
      ) : comptesNommes !== null ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Tes comptes</h3>
          {comptesNommes.map((e, i) => (
            <section key={e.compte.id} aria-label={`Compte « ${e.compte.libelle} »`} style={i === 0 ? undefined : { borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
              <h4 style={{ margin: '0 0 4px' }}>{e.compte.libelle}</h4>
              <EtatDuCompte compte={e.compte} />
              <SoldeDuReleve solde={e.solde} motif={p.motifs.controles} />
              <CouvertureDUnCompteBancaire couverture={e.couverture} />
            </section>
          ))}
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Ton compte</h3>
          <SoldeDuReleve solde={solde} motif={p.motifs.controles} />
          <CouvertureDuCompte couverture={couverture} />
        </div>
      )}

      <MonAnnee lecture={lecture} />

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
            {comptesNommes !== null && (
              <div className="field">
                <label htmlFor="banque-compte">Compte</label>
                <select id="banque-compte" value={filtreCompte} onChange={(e) => p.onFiltreCompte(e.target.value)}>
                  <option value="tous">Tous les comptes</option>
                  {comptesNommes.map((e) => <option key={e.compte.id} value={e.compte.id}>{e.compte.libelle}</option>)}
                </select>
              </div>
            )}
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
                <SelecteurDeTri colonnes={colonnesTri} etat={tri} onChoisir={choisirTri} />
                <table className="table-empilable table-empilable-en-carte">
                  <thead>
                    <tr>
                      <EnTeteTriable colonne="date" etat={tri} onTrier={trierPar}>Date</EnTeteTriable>
                      {comptesNommes !== null && <EnTeteTriable colonne="compte" etat={tri} onTrier={trierPar}>Compte</EnTeteTriable>}
                      <EnTeteTriable colonne="libelle" etat={tri} onTrier={trierPar}>Libellé</EnTeteTriable>
                      <EnTeteTriable colonne="montant" etat={tri} onTrier={trierPar}>Montant</EnTeteTriable>
                      <EnTeteTriable colonne="etat" etat={tri} onTrier={trierPar}>État</EnTeteTriable>
                      <th>Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affichesTries.map((m) => {
                      const s = etatDe(m)
                      const estOuvert = p.ouvert === m.id
                      return (
                        <Fragment key={m.id}>
                          <tr>
                            <td data-libelle="Date">{formatDate(m.date)}</td>
                            {comptesNommes !== null && <td data-libelle="Compte">{nomDuCompte.get(m.compte_bancaire_id ?? '')}</td>}
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
                              <td colSpan={comptesNommes !== null ? 6 : 5} style={{ background: 'var(--color-surface-2)' }}>
                                <DetailDuMouvement
                                  {...p}
                                  mouvement={m}
                                  situation={s}
                                  pourquoiTu={pourquoiTu}
                                  nomDesPieces={nomDesPieces}
                                  piecesLues={lecture.pieces.complete}
                                  pieces={lecture.pieces.lignes}
                                  propositionsDuDossier={lecture.propositions.lignes}
                                  gestesRetenus={gestesRetenus}
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

// ── « Mon année » ──────────────────────────────────────────────────────────────────────────────────────────────────────
function MonAnnee({ lecture }: { lecture: Lecture }) {
  const [choixAnnee, setChoixAnnee] = useState<number | null>(null)
  const [choixCompte, setChoixCompte] = useState<string | null>(null)
  // Le jour de Paris, lu au rendu (jamais au chargement du module) : il borne le mois en cours et le cumul à date.
  const aujourdHui = aujourdHuiAParis()
  const analyse = analyseDeMaBanque({ mouvements: lecture.mouvements, controles: lecture.controles, comptes: lecture.comptes, aujourdHui })
  const titre = <h3 id="mon-annee-titre" style={{ marginTop: 0 }}>{TITRE_DE_L_ANALYSE}</h3>
  if (analyse.etat === 'muette') {
    return (
      <section className="card" aria-labelledby="mon-annee-titre" style={{ marginBottom: 20 }}>
        {titre}
        <p className="error-text" style={{ margin: 0 }}>{analyse.raison}</p>
      </section>
    )
  }
  const comptes = analyse.etat === 'comptes' ? analyse.comptes : null
  const choisi = comptes === null ? null : comptes.find((c) => c.compte.id === choixCompte) ?? comptes[0]
  const source = choisi === null ? (analyse.etat === 'un' ? analyse.source : null) : choisi.source
  if (source === null) return null
  const annee = source.etat === 'lue' ? (choixAnnee !== null && source.annees.includes(choixAnnee) ? choixAnnee : source.annees[0]) : null
  const a = source.etat === 'lue' && annee !== null ? anneeDeMaBanque(source, annee, aujourdHui) : null
  return (
    <section className="card" aria-labelledby="mon-annee-titre" style={{ marginBottom: 20 }}>
      {titre}
      <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>{INTRODUCTION_DE_L_ANALYSE}</p>
      {comptes !== null && <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>{ANALYSE_SANS_TOTAL_DES_COMPTES}</p>}
      <div className="field-row" style={{ marginBottom: 6 }}>
        {source.etat === 'lue' && annee !== null && (
          <div className="field annee-banque-choix">
            <label htmlFor="banque-annee-analyse">Année</label>
            <select id="banque-annee-analyse" value={String(annee)} onChange={(e) => setChoixAnnee(Number(e.target.value))}>
              {source.annees.map((x) => <option key={x} value={String(x)}>{x}</option>)}
            </select>
          </div>
        )}
        {comptes !== null && choisi !== null && (
          <div className="field annee-banque-choix">
            <label htmlFor="banque-annee-compte">Compte analysé</label>
            <select id="banque-annee-compte" value={choisi.compte.id} onChange={(e) => setChoixCompte(e.target.value)}>
              {comptes.map((c) => <option key={c.compte.id} value={c.compte.id}>{c.compte.libelle}</option>)}
            </select>
          </div>
        )}
      </div>
      {a === null ? <p className="muted" style={{ margin: 0 }}>{ANALYSE_SANS_RELEVE}</p> : <DetailDeLAnnee a={a} />}
      {/* Clée par compte : un autre compte analysé repart des années cochées et de la mesure par défaut. La société, elle,
          remonte tout l'écran (`<Outlet key>` de la coque). */}
      {source.etat === 'lue' && <ComparerLesAnnees key={choisi?.compte.id ?? 'un'} source={source} aujourdHui={aujourdHui} />}
    </section>
  )
}

const seCompte = (m: EtatDuMois): m is Extract<EtatDuMois, { etat: 'couvert' | 'en_partie' }> => m.etat === 'couvert' || m.etat === 'en_partie'
const euros = (centimes: number) => formatMoney(centimes / 100)
const INITIALES_DES_MOIS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

function DetailDeLAnnee({ a }: { a: AnneeDeMaBanque }) {
  const comptes = a.mois.filter(seCompte)
  return (
    <>
      <p style={{ margin: '0 0 8px' }}>{motsDeLAnnee(a)}</p>
      {comptes.length === 0 ? (
        <p className="muted" style={{ margin: '0 0 8px' }}>Aucun mois de {a.annee} n’est couvert : rien ne s’y compte.</p>
      ) : (
        <p style={{ margin: '0 0 8px' }} data-testid="totaux-de-l-annee">
          <strong>{a.complete ? `Sur l’année ${a.annee}` : `Sur les mois couverts de ${a.annee}`}</strong> : entrées{' '}
          <span style={{ whiteSpace: 'nowrap' }}>{euros(a.totaux.entrees)}</span>, sorties{' '}
          <span style={{ whiteSpace: 'nowrap' }}>{euros(a.totaux.sorties)}</span>, différence{' '}
          <strong style={{ whiteSpace: 'nowrap' }}>{euros(a.totaux.difference)}</strong>.
        </p>
      )}
      <ComparaisonDeLAnnee a={a} />
      <GrapheDeLAnnee a={a} />
      <div className="table-scroll">
        <div className="tableau-adaptable">
          <table className="table-empilable" aria-label={`Mois par mois, ${a.annee}`}>
            <thead>
              <tr><th>Mois</th><th>Entrées</th><th>Sorties</th><th>Différence</th><th>Relevé</th></tr>
            </thead>
            <tbody>
              {a.mois.map((m) => (
                <tr key={m.mois}>
                  <td data-libelle="Mois">{libelleDuMois(m.mois)}</td>
                  <td data-libelle="Entrées" style={{ whiteSpace: 'nowrap' }}>{seCompte(m) ? euros(m.entrees) : '—'}</td>
                  <td data-libelle="Sorties" style={{ whiteSpace: 'nowrap' }}>{seCompte(m) ? euros(m.sorties) : '—'}</td>
                  <td data-libelle="Différence" style={{ whiteSpace: 'nowrap' }}>{seCompte(m) ? euros(m.difference) : '—'}</td>
                  <td data-libelle="Relevé">
                    {m.etat === 'non_couvert'
                      ? <span className="badge badge-une-ligne badge-warning">{NON_COUVERT}</span>
                      : <span className={m.etat === 'a_venir' ? 'muted' : undefined}>{libelleDeLaCouverture(m)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            {comptes.length > 0 && (
              <tfoot>
                <tr>
                  <td data-libelle="Mois"><strong>{a.complete ? 'Année' : 'Mois couverts'}</strong></td>
                  <td data-libelle="Entrées" style={{ whiteSpace: 'nowrap' }}>{euros(a.totaux.entrees)}</td>
                  <td data-libelle="Sorties" style={{ whiteSpace: 'nowrap' }}>{euros(a.totaux.sorties)}</td>
                  <td data-libelle="Différence" style={{ whiteSpace: 'nowrap' }}><strong>{euros(a.totaux.difference)}</strong></td>
                  <td data-libelle="Relevé">{a.complete ? 'couverte' : `${a.moisCouvertsEnEntier} sur 12 en entier`}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  )
}

function ComparaisonDeLAnnee({ a }: { a: AnneeDeMaBanque }) {
  const c = a.comparaison
  const avant = a.annee - 1
  if (c.etat === 'tue') return <p className="muted" style={{ margin: '0 0 8px' }} data-testid="comparaison-de-l-annee">{c.raison}</p>
  const ligne = (nom: string, n: number, n1: number, enPourcent: boolean) => {
    const v = enPourcent ? variationEnPourcent(n, n1) : null
    return (
      <li>
        {nom} : <strong style={{ whiteSpace: 'nowrap' }}>{euros(n)}</strong>, contre <span style={{ whiteSpace: 'nowrap' }}>{euros(n1)}</span> en {avant}
        {v !== null && <> (<span style={{ whiteSpace: 'nowrap' }}>{v}</span>)</>}
      </li>
    )
  }
  const parties = (t: Totaux, u: Totaux) => (
    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
      {ligne('Entrées', t.entrees, u.entrees, true)}
      {ligne('Sorties', t.sorties, u.sorties, true)}
      {ligne('Différence', t.difference, u.difference, false)}
    </ul>
  )
  return (
    <div style={{ margin: '0 0 12px' }} data-testid="comparaison-de-l-annee">
      <h4 style={{ margin: '4px 0 0' }}>Comparée à {avant}</h4>
      <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.85rem' }}>
        Du 01/01/{a.annee} au {formatDate(c.jusquAu)}, contre la même période de {avant} (du 01/01/{avant} au {formatDate(c.jusquAuN1)}).
        {c.interrompue && ' Elle s’arrête là : la suite de l’année n’est pas couverte sans interruption.'}
      </p>
      {parties(c.n, c.n1)}
    </div>
  )
}

// Les barres des entrées et des sorties de chaque mois ; un mois non couvert : un cadre en pointillé, jamais une barre à zéro.
function GrapheDeLAnnee({ a }: { a: AnneeDeMaBanque }) {
  const haut = 8
  const bas = 132
  const largeurMois = 30
  const maximum = Math.max(1, ...a.mois.filter(seCompte).flatMap((m) => [m.entrees, m.sorties]))
  const hauteur = (c: number) => (c / maximum) * (bas - haut)
  return (
    <>
      <svg className="annee-banque-graphe" viewBox={`0 0 ${12 * largeurMois + 12} 152`} role="img" aria-label={`Entrées et sorties de chaque mois de ${a.annee}`}>
        <line className="annee-banque-axe" x1={4} x2={12 * largeurMois + 8} y1={bas} y2={bas} />
        {a.mois.map((m, i) => {
          const x = 6 + i * largeurMois
          return (
            <g key={m.mois}>
              {seCompte(m) ? (
                <>
                  <rect className="annee-banque-entrees" x={x + 3} width={11} y={bas - hauteur(m.entrees)} height={hauteur(m.entrees)}>
                    <title>{`${libelleDuMois(m.mois)}, entrées : ${euros(m.entrees)}`}</title>
                  </rect>
                  <rect className="annee-banque-sorties" x={x + 15} width={11} y={bas - hauteur(m.sorties)} height={hauteur(m.sorties)}>
                    <title>{`${libelleDuMois(m.mois)}, sorties : ${euros(m.sorties)}`}</title>
                  </rect>
                </>
              ) : m.etat === 'non_couvert' ? (
                <rect className="annee-banque-absent" x={x + 3} width={23} y={haut} height={bas - haut}>
                  <title>{`${libelleDuMois(m.mois)} : ${NON_COUVERT}`}</title>
                </rect>
              ) : null}
              <text className="annee-banque-mois" x={x + 15} y={bas + 15} textAnchor="middle">{INITIALES_DES_MOIS[i]}</text>
            </g>
          )
        })}
      </svg>
      <p className="annee-banque-legende" aria-hidden="true">
        <span className="entrees">Entrées</span><span className="sorties">Sorties</span><span className="absent">{NON_COUVERT}</span>
        {a.mois.some((m) => m.etat === 'a_venir') && <span>{A_VENIR} : sans barre</span>}
      </p>
    </>
  )
}

// ── « Comparer les années » (demande du cabinet du 16/11/2026) ─────────────────────────────────────────────────────────
// Une courbe par année cochée, la mesure choisie, les douze mois en abscisse (lib/analyseDeMaBanque.ts, `courbesDesAnnees`).
// Un mois non couvert n'a pas de point : la courbe s'interrompt ; un mois couvert en partie a un point creux, non relié ; un
// mois à venir n'a rien. Chaque année garde son style (une nuance de la charte ET un trait) d'après son rang parmi les années
// offertes — décocher une année ne change pas celui des autres. Les valeurs exactes sont dans le tableau, sans survol.
const STYLES_DES_COURBES = 5
const LARGEUR_COURBES = 380
const HAUTEUR_COURBES = 220
const MARGE_GAUCHE = 52
const MARGE_DROITE = 8
const MARGE_HAUTE = 10
const MARGE_BASSE = 24

/** Une graduation de l'axe : l'euro entier, sans centimes (le tableau porte les centimes). */
const eurosEntiers = (centimes: number) => formatMoney(Math.round(centimes / 100)).replace(/,00(?=\s*€)/, '')

function ComparerLesAnnees({ source, aujourdHui }: { source: Extract<SourceDUnCompte, { etat: 'lue' }>; aujourdHui: string }) {
  const [cochees, setCochees] = useState<number[]>(() => anneesCocheesParDefaut(source, aujourdHui))
  const [mesure, setMesure] = useState<MesureDesCourbes>('entrees')
  const ident = useId()
  const libelleDeLaMesure = MESURES_DES_COURBES.find((m) => m.valeur === mesure)?.libelle ?? ''
  // De la plus récente à l'ancienne, comme le sélecteur ; une année cochée qui n'est plus offerte ne compte pas.
  const annees = source.annees.filter((a) => cochees.includes(a))
  const courbes = courbesDesAnnees(source, annees, mesure, aujourdHui)
  const style = (annee: number) => `annee-banque-courbe annee-banque-courbe-${source.annees.indexOf(annee) % STYLES_DES_COURBES}`
  const basculer = (annee: number, coche: boolean) =>
    setCochees((avant) => (coche ? [...avant.filter((a) => a !== annee), annee] : avant.filter((a) => a !== annee)))

  return (
    <div className="annee-banque-comparer" data-testid="comparer-les-annees">
      <h4 style={{ margin: '0 0 6px' }}>{TITRE_DES_COURBES}</h4>
      <fieldset className="annee-banque-cases">
        <legend>Années</legend>
        {source.annees.map((a) => (
          <label key={a}>
            <input type="checkbox" checked={cochees.includes(a)} onChange={(e) => basculer(a, e.target.checked)} /> {a}
          </label>
        ))}
      </fieldset>
      <div className="segmented segmented-a-la-ligne" role="group" aria-label="Mesure" style={{ margin: '4px 0 8px' }}>
        {MESURES_DES_COURBES.map((m) => (
          <button key={m.valeur} type="button" className={mesure === m.valeur ? 'active' : undefined}
            aria-pressed={mesure === m.valeur} onClick={() => setMesure(m.valeur)}>{m.libelle}</button>
        ))}
      </div>
      {courbes.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{AUCUNE_ANNEE_COCHEE}</p>
      ) : (
        <>
          <GrapheDesCourbes courbes={courbes} style={style} ident={ident} libelleDeLaMesure={libelleDeLaMesure} />
          <ul className="annee-banque-legende-courbes" aria-label="Légende">
            {courbes.map((c) => (
              <li key={c.annee}>
                <svg width="30" height="10" aria-hidden="true" focusable="false">
                  <line className={style(c.annee)} x1={1} x2={29} y1={5} y2={5} />
                </svg>
                <strong>{c.annee}</strong>
                {c.total === null
                  ? <span className="muted"> — {AUCUN_MOIS_COUVERT}</span>
                  : <span> — <span style={{ whiteSpace: 'nowrap' }}>{euros(c.total)}</span> sur {c.moisCouverts} mois couvert{c.moisCouverts > 1 ? 's' : ''}</span>}
              </li>
            ))}
          </ul>
          <p className="annee-banque-legende" style={{ marginTop: 0 }}>
            <span className="courbe-plein">mois couvert</span>
            {courbes.some((c) => c.points.some((p) => p.etat === 'en_partie')) && <span className="courbe-creux">{LEGENDE_DU_MOIS_EN_PARTIE}</span>}
            {courbes.some((c) => c.points.some((p) => p.etat === 'non_couvert')) && <span className="courbe-trou">{LEGENDE_DU_TROU}</span>}
          </p>
          <div className="table-scroll">
            <div className="tableau-adaptable">
              <table className="table-empilable" aria-label={`${libelleDeLaMesure}, mois par mois et année par année`}>
                <thead>
                  <tr><th>Mois</th>{courbes.map((c) => <th key={c.annee}>{c.annee}</th>)}</tr>
                </thead>
                <tbody>
                  {INITIALES_DES_MOIS.map((_, i) => (
                    <tr key={i}>
                      <td data-libelle="Mois">{NOMS_DES_MOIS[i]}</td>
                      {courbes.map((c) => {
                        const p = c.points[i]
                        return (
                          <td key={c.annee} data-libelle={String(c.annee)} style={{ whiteSpace: 'nowrap' }}>
                            {p.etat === 'couvert' && euros(p.valeur)}
                            {p.etat === 'en_partie' && <>{euros(p.valeur)} <span className="muted">(jusqu’au {formatDate(p.jusquAu)})</span></>}
                            {p.etat === 'non_couvert' && '—'}
                            {p.etat === 'a_venir' && <span className="muted">{A_VENIR}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td data-libelle="Mois"><strong>Mois couverts</strong></td>
                    {courbes.map((c) => (
                      <td key={c.annee} data-libelle={String(c.annee)} style={{ whiteSpace: 'nowrap' }}>
                        {c.total === null ? '—' : <strong>{euros(c.total)}</strong>}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const NOMS_DES_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function GrapheDesCourbes({ courbes, style, ident, libelleDeLaMesure }: {
  courbes: CourbeDUneAnnee[]; style: (annee: number) => string; ident: string; libelleDeLaMesure: string
}) {
  const echelle = echelleDesCourbes(courbes)
  const largeurMois = (LARGEUR_COURBES - MARGE_GAUCHE - MARGE_DROITE) / 12
  const bas = HAUTEUR_COURBES - MARGE_BASSE
  const x = (i: number) => MARGE_GAUCHE + (i + 0.5) * largeurMois
  const y = (c: number) => bas - ((c - echelle.bas) / (echelle.haut - echelle.bas)) * (bas - MARGE_HAUTE)
  const nommees = courbes.map((c) => c.annee).join(', ')
  const titre = `${TITRE_DES_COURBES} : ${libelleDeLaMesure.toLowerCase()} de chaque mois, ${nommees}`
  const description = `Une courbe par année cochée (${nommees}), de janvier à décembre. Un mois non couvert par un relevé `
    + 'contrôlé n’a pas de point, la courbe s’y interrompt ; un mois couvert en partie a un point creux, non relié. '
    + 'Les montants exacts sont dans le tableau qui suit.'
  return (
    <svg className="annee-banque-courbes" viewBox={`0 0 ${LARGEUR_COURBES} ${HAUTEUR_COURBES}`} role="img"
      aria-labelledby={`${ident}-titre ${ident}-desc`}>
      <title id={`${ident}-titre`}>{titre}</title>
      <desc id={`${ident}-desc`}>{description}</desc>
      {echelle.graduations.map((g) => (
        <g key={g}>
          <line className={g === 0 ? 'annee-banque-zero' : 'annee-banque-grille'} x1={MARGE_GAUCHE} x2={LARGEUR_COURBES - MARGE_DROITE} y1={y(g)} y2={y(g)} />
          <text className="annee-banque-graduation" x={MARGE_GAUCHE - 6} y={y(g) + 3.5} textAnchor="end">{eurosEntiers(g)}</text>
        </g>
      ))}
      {INITIALES_DES_MOIS.map((initiale, i) => (
        <text key={i} className="annee-banque-mois" x={x(i)} y={bas + 16} textAnchor="middle">{initiale}</text>
      ))}
      {courbes.map((c) => (
        <g key={c.annee} data-annee={c.annee}>
          {c.troncons.map((t) => (
            <polyline key={t.debut} className={style(c.annee)} fill="none"
              points={Array.from({ length: t.fin - t.debut + 1 }, (_, k) => {
                const p = c.points[t.debut + k]
                return p.etat === 'couvert' ? `${x(t.debut + k)},${y(p.valeur)}` : ''
              }).join(' ')} />
          ))}
          {c.points.map((p, i) => (p.etat === 'couvert' || p.etat === 'en_partie') && (
            <circle key={p.mois} className={`${style(c.annee)} ${p.etat === 'couvert' ? 'annee-banque-point' : 'annee-banque-point-creux'}`}
              cx={x(i)} cy={y(p.valeur)} r={p.etat === 'couvert' ? 3 : 3.5}>
              <title>{`${libelleDuMois(p.mois)}${p.etat === 'en_partie' ? ` (jusqu’au ${formatDate(p.jusquAu)})` : ''} : ${euros(p.valeur)}`}</title>
            </circle>
          ))}
        </g>
      ))}
    </svg>
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

// Ce que le client lit d'un compte, en une ligne discrète : le principal, la fin de son numéro, son ouverture et sa clôture.
// Jamais son compte du plan.
function EtatDuCompte({ compte }: { compte: CompteDuClient }) {
  const morceaux = [
    compte.principal ? 'compte principal' : null,
    finDuNumero(compte),
    compte.ouvert_le ? `ouvert le ${formatDate(compte.ouvert_le)}` : null,
    compte.clos_le ? `clos le ${formatDate(compte.clos_le)}` : null,
  ].filter((x): x is string => x !== null)
  if (morceaux.length === 0) return null
  const texte = morceaux.join(', ')
  return <p className="muted" style={{ margin: '0 0 6px', fontSize: '0.85rem' }}>{texte.charAt(0).toUpperCase() + texte.slice(1)}.</p>
}

// Les mois d'un compte (MCB7) : son premier et son dernier mouvement, et les mois où il attend un relevé sans en porter, nommés
// sous son nom. Muette sur des mouvements lus en partie, comme celle d'hier.
function CouvertureDUnCompteBancaire({ couverture }: { couverture: CouvertureDUnCompte }) {
  if (couverture.etat === 'muet') return null
  return (
    <>
      {couverture.premierMouvement === null || couverture.dernierMouvement === null ? (
        <p className="muted" style={{ margin: '0 0 4px' }}>Ce compte ne porte encore aucun mouvement dans ton relevé.</p>
      ) : (
        <p style={{ margin: '0 0 4px' }}>
          Mouvements du {formatDate(couverture.premierMouvement)} au {formatDate(couverture.dernierMouvement)}.
        </p>
      )}
      {couverture.moisSansMouvement.length > 0 && (
        <p className="muted" style={{ margin: '0 0 8px', fontSize: '0.85rem' }}>
          Mois sans aucun mouvement sur ce compte : {couverture.moisSansMouvement.map(libelleDuMois).join(', ')}. S’il manque
          un relevé de ce compte, envoie-le dans « Mes pièces ».
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
  // Les comptes ne se partagent pas (MCB7) : aucun geste.
  gestesRetenus: boolean
}) {
  const { mouvement: m, situation: s } = p
  const [choix, setChoix] = useState('')
  const [texte, setTexte] = useState('')
  const nom = (id: string) => p.nomDesPieces.get(id) ?? 'une pièce'
  // Les gestes : jamais sur une situation tue (propositions ou fil lus en partie), ni pendant une écriture et sa relecture.
  const gestes = s !== null && !p.enCours && !p.gestesRetenus
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
