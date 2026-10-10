import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { aujourdHuiAParis, formatDate, formatMoney } from '../../lib/format'
import { lireTout } from '../../lib/lectureComplete'
import { messageErreur } from '../../lib/messageErreur'
import { LIBELLE_MOTIF_CONTRE_PASSATION, LIBELLE_NOTE_DECLARATION } from '../../lib/droitsAcces'
import BandeauLecturePartielle, { type AccordLecture } from '../../components/BandeauLecturePartielle'
import {
  ETATS_DECLARANTS, MOYENS_ENCAISSEMENT, REFUS_DECLARATION, centimesExacts, contrePassationDe, echeanceDeDeclaration,
  encaissementsDeclares, obligationEncaissee, piecesJumelles, plateformeAcceptee, plateformeDeLaDeclaration, propositionsEncaissement,
  refusContrePassation, refusDeLaFacture, refusDeclaration, refusEnregistrement, refusRetrait, repartitionProposee,
  resteAEncaisser,
  type ContexteFacture, type DeclarationLue, type EncaissementLu, type EtatObligationEncaissee, type EvenementSuperpdpLu,
  type LigneDeFacture, type MouvementPropose, type PartLue, type PieceLue, type ResteDuTaux, type SaisieEncaissement,
  type TransmissionLue, type TransmissionPourDeclaration,
} from '../../lib/encaissementsFactures'
import { lireMontantSaisi, montantPourSaisie, partsEnMots, tauxAffiche } from '../../lib/encaissementsAffichage'
import { lireConnexionPlateforme, type ConnexionPlateformeVue } from '../../lib/receptionPlateforme'
import {
  COLONNES_STATUT_LU, CONSEQUENCE_ANNULATION, auteurDuStatut, classeStatutLu, estUneAnnulation, horodatageTelQuEcrit,
  libelleStatutLu, montantsTelsQuEcrits, statutsDeLaFacture, verificationAvantDeclaration, type StatutLu,
} from '../../lib/statutsLus'
import { releverEtNommer, type ResultatReleve } from '../../lib/releveStatuts'
import BilanReleveStatuts from './BilanReleveStatuts'
import { paiementsDesPieces, type LignePayante, type PartReglee } from '../../lib/rattachement'
import type {
  EncaissementFacture, FactureEmise, FactureSuperpdpEvent, Piece, StatutTva, TransmissionEncaissement, TransmissionFacture,
} from '../../lib/types'

interface Props {
  dossierId: string
  facture: FactureEmise
  // Le statut de TVA du dossier aujourd'hui : l'obligation et l'échéance en dépendent, et la facture ne le fige pas.
  statutTva: StatutTva | null
  onClose: () => void
  // L'onglet relit ses encaissements : sa pastille doit dire ce que la fenêtre vient d'écrire.
  onUpdated: () => void
}

// LES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étapes d3 et d4) : ce que la facture doit déclarer, ce qui en reste
// à encaisser, les encaissements enregistrés et leur déclaration, la saisie d'un nouveau — rien d'autre ne part d'ici que
// vers la base. Le registre est écrit par quatre fonctions seulement : `enregistrer_encaissement` et `retirer_encaissement`
// (étape d1), `declarer_encaissement_hors_application` et `annuler_encaissement` (étape d4) ; ce qu'elles refuseraient se
// dit AVANT le clic, sous leurs mots, par le module d2 (encaissementsFactures.ts).
//
// LA DÉCLARATION SE FAIT HORS DE L'APPLICATION (décision du cabinet du 08/10/2026, Q2) : le cabinet ou le client saisit
// le statut « Encaissée » sur la plateforme qui a reçu la facture, et la fenêtre GARDE ce qui a été déclaré. Rien ne part
// d'ici vers une plateforme : la fenêtre dit ce qu'il faut y saisir, champ par champ, et inscrit ensuite que c'est fait.
// Une déclaration ne s'efface pas — la plateforme de l'administration ne dédoublonne pas, un statut déclaré deux fois
// est compté deux fois — : un encaissement déclaré ne se retire plus, il se CONTRE-PASSE, et la contre-passation se
// déclare à son tour.
//
// TOUT SE LIT EN ENTIER, ET RIEN NE SE PROPOSE SUR UNE LECTURE PARTIELLE : un encaissement manquant ferait dire un
// reste faux, un mouvement manquant laisserait proposer un virement déjà pris, une déclaration manquante laisserait
// retirer un encaissement déclaré ou le déclarer deux fois — et le premier clic écrirait sur cette base fausse (règle
// « lecture → formulaire → écriture »).

type LigneLue = LigneDeFacture & { id: string }
type TransmissionEcran = TransmissionLue & TransmissionPourDeclaration & Pick<TransmissionFacture, 'id' | 'cree_le'>
type EvenementEcran = EvenementSuperpdpLu & Pick<FactureSuperpdpEvent, 'id' | 'occurred_at'>
type EncaissementEcran = EncaissementLu & Pick<EncaissementFacture, 'date_encaissement' | 'moyen' | 'motif' | 'cree_le'>
type PartEcran = PartLue & { dossier_id: string }
type MouvementEcran = MouvementPropose & LignePayante
type ReglementEcran = PartReglee & { id: string }
type PieceEcran = PieceLue & Pick<Piece, 'tiers' | 'nom_fichier'>
type DeclarationEcran = DeclarationLue & Pick<TransmissionEncaissement, 'note' | 'cree_le'>

interface Lu {
  // La facture et ses avoirs : un avoir réduit ce que le client doit encore, à l'écran seulement.
  factures: FactureEmise[]
  lignes: LigneLue[]
  transmissions: TransmissionEcran[]
  evenements: EvenementEcran[]
  encaissements: EncaissementEcran[]
  parts: PartEcran[]
  mouvements: MouvementEcran[]
  reglements: ReglementEcran[]
  pieces: PieceEcran[]
  // Les déclarations du DOSSIER (étape d4) : l'ensemble des déclarés décide du retrait, de la déclaration et de la
  // contre-passation.
  declarations: DeclarationEcran[]
  // Les statuts de LA facture lus sur la plateforme du client (étape d7) : un refus ou un rejet fait refuser
  // l'encaissement et sa déclaration, comme la base.
  statuts: StatutLu[]
}

interface Manque {
  quoi: string
  accord: AccordLecture
  motif: string
  consequence: string
}

// Ce qu'une lecture partielle coûte : la fenêtre ne montre alors ni reste, ni formulaire.
const CONSEQUENCE = 'Rien n’est proposé : un reste ou une proposition bâtis sur une liste incomplète seraient faux. Rouvre cette fenêtre.'
// Et celle des déclarations, qui décident de ce qui se retire, se déclare ou se contre-passe.
const CONSEQUENCE_DECLARATIONS = 'Rien n’est proposé — ni enregistrer, ni retirer, ni déclarer, ni contre-passer : un '
  + 'encaissement déclaré qu’on ne verrait pas se retirerait, ou se déclarerait une seconde fois, et l’administration le '
  + 'compterait deux fois. Rouvre cette fenêtre.'
// Et celle des statuts lus sur la plateforme du client, qui disent un refus de l'acheteur.
const CONSEQUENCE_STATUTS = 'Rien n’est proposé — ni enregistrer, ni déclarer : un refus de l’acheteur qu’on ne verrait '
  + 'pas laisserait proposer l’encaissement ou la déclaration d’une facture refusée. Rouvre cette fenêtre.'

async function lireDonnees(dossierId: string, factureId: string): Promise<{ lu: Lu; manques: Manque[] }> {
  const [
    factures, lignes, transmissions, evenements, encaissements, parts, mouvements, reglements, pieces, declarations, statuts,
  ] = await Promise.all([
    lireTout<FactureEmise>((debut, fin) =>
      supabase.from('factures_emises').select('*', { count: 'exact' })
        .eq('dossier_id', dossierId).or(`id.eq.${factureId},facture_origine_id.eq.${factureId}`)
        .order('date_emission').order('id').range(debut, fin),
    ),
    lireTout<LigneLue>((debut, fin) =>
      supabase.from('facture_lignes').select('id, facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva', { count: 'exact' })
        .eq('facture_id', factureId).order('ordre').order('id').range(debut, fin),
    ),
    lireTout<TransmissionEcran>((debut, fin) =>
      supabase.from('transmissions_factures').select('id, facture_id, canal, etat, hote, flux_id, cree_le', { count: 'exact' })
        .eq('facture_id', factureId).order('cree_le').order('id').range(debut, fin),
    ),
    lireTout<EvenementEcran>((debut, fin) =>
      supabase.from('facture_superpdp_events').select('id, facture_id, status_code, occurred_at', { count: 'exact' })
        .eq('facture_id', factureId).order('occurred_at').order('id').range(debut, fin),
    ),
    // Les encaissements et les parts du DOSSIER, retirés et annulations compris : un mouvement se juge sur tous les
    // encaissements qu'il justifie, de toutes les factures — le module filtre lui-même ceux de la facture.
    lireTout<EncaissementEcran>((debut, fin) =>
      supabase.from('encaissements_factures')
        .select('id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, annule_id, motif, cree_le, retire_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date_encaissement').order('cree_le').order('id').range(debut, fin),
    ),
    lireTout<PartEcran>((debut, fin) =>
      supabase.from('encaissements_factures_taux').select('encaissement_id, dossier_id, taux, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('encaissement_id').order('taux').range(debut, fin),
    ),
    lireTout<MouvementEcran>((debut, fin) =>
      supabase.from('lignes_bancaires')
        .select('id, dossier_id, date, montant, libelle, libelle_brut, statut, piece_id, reglement_groupe, prelevement_personnel, compte_bilan, emprunt_id, declaration_tva_id, cotisation_id', { count: 'exact' })
        .eq('dossier_id', dossierId).order('date').order('id').range(debut, fin),
    ),
    lireTout<ReglementEcran>((debut, fin) =>
      supabase.from('reglements_groupes').select('id, ligne_bancaire_id, piece_id, montant', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    lireTout<PieceEcran>((debut, fin) =>
      supabase.from('pieces').select('id, dossier_id, flux_hote, flux_id, superpdp_invoice_id, identite_numero, identite_siren_vendeur, identite_date, identite_nature, tiers, nom_fichier', { count: 'exact' })
        .eq('dossier_id', dossierId).order('id').range(debut, fin),
    ),
    // Les déclarations du DOSSIER, échouées et rejetées comprises : le module décide lui-même de ce qui compte.
    lireTout<DeclarationEcran>((debut, fin) =>
      supabase.from('transmissions_encaissements')
        .select('id, dossier_id, encaissement_id, facture_id, canal, hote, etat, note, cree_le', { count: 'exact' })
        .eq('dossier_id', dossierId).order('cree_le').order('id').range(debut, fin),
    ),
    // Les statuts de la facture, tri TOTAL : un relevé en écrit plusieurs dans la même milliseconde.
    lireTout<StatutLu>((debut, fin) =>
      supabase.from('statuts_factures_recus').select(COLONNES_STATUT_LU, { count: 'exact' })
        .eq('dossier_id', dossierId).eq('facture_id', factureId).order('lu_le').order('id').range(debut, fin),
    ),
  ])
  const manques: Manque[] = []
  // Chaque drapeau lu nommément : un drapeau jeté laisserait le bandeau éteint sur une lecture tronquée.
  const noter = (quoi: string, accord: AccordLecture, complete: boolean, motif: string | null, consequence = CONSEQUENCE) => {
    if (!complete) manques.push({ quoi, accord, motif: motif ?? 'lecture incomplète', consequence })
  }
  noter('La facture et ses avoirs', 'lus', factures.complete, factures.motif)
  noter('Les lignes de la facture', 'lues', lignes.complete, lignes.motif)
  noter('Les transmissions de la facture', 'lues', transmissions.complete, transmissions.motif)
  noter('L’historique de Super PDP', 'lu', evenements.complete, evenements.motif)
  noter('Les encaissements du dossier', 'lus', encaissements.complete, encaissements.motif)
  noter('La répartition des encaissements', 'lue', parts.complete, parts.motif)
  noter('Les mouvements du relevé', 'lus', mouvements.complete, mouvements.motif)
  noter('Les règlements groupés', 'lus', reglements.complete, reglements.motif)
  noter('Les pièces du dossier', 'lues', pieces.complete, pieces.motif)
  noter('Les déclarations des encaissements', 'lues', declarations.complete, declarations.motif, CONSEQUENCE_DECLARATIONS)
  noter('Les statuts lus sur la plateforme du client', 'lus', statuts.complete, statuts.motif, CONSEQUENCE_STATUTS)
  return {
    lu: {
      factures: factures.lignes, lignes: lignes.lignes, transmissions: transmissions.lignes, evenements: evenements.lignes,
      encaissements: encaissements.lignes, parts: parts.lignes, mouvements: mouvements.lignes, reglements: reglements.lignes,
      pieces: pieces.lignes, declarations: declarations.lignes, statuts: statuts.lignes,
    },
    manques,
  }
}

interface Formulaire {
  date: string
  montant: string
  moyen: string
  ligneBancaireId: string | null
  // Une part par taux de la facture, dans l'ordre du reste (le taux le plus fort d'abord) : c'est l'ordre de la saisie,
  // que la base suit pour dire la première part en excès.
  parts: { taux: number; montant: string }[]
}

// Les centimes d'un montant tapé, s'il en est un, positif et au centime ; null sinon.
function centimesDuTexte(texte: string): number | null {
  const n = lireMontantSaisi(texte)
  if (n == null || Number.isNaN(n)) return null
  const c = centimesExacts(n)
  return c != null && c > 0 ? c : null
}

function partsProposees(montantCentimes: number | null, parTaux: readonly ResteDuTaux[]): Formulaire['parts'] {
  const proposees = montantCentimes == null ? null : repartitionProposee(montantCentimes, parTaux)
  return parTaux.map((t) => {
    const p = proposees?.find((x) => x.taux === t.taux)
    return { taux: t.taux, montant: p ? montantPourSaisie(p.centimes) : '' }
  })
}

// Le moyen n'est JAMAIS proposé : c'est le cabinet qui sait comment le client a payé, et la date à retenir en dépend.
function formulaireVierge(parTaux: readonly ResteDuTaux[], resteCentimes: number): Formulaire {
  const montant = resteCentimes > 0 ? resteCentimes : null
  return {
    date: '', montant: montant == null ? '' : montantPourSaisie(montant), moyen: '', ligneBancaireId: null,
    parts: partsProposees(montant, parTaux),
  }
}

function contexteDe(dossierId: string, factureId: string, lu: Lu): ContexteFacture | null {
  const facture = lu.factures.find((f) => f.id === factureId)
  if (!facture) return null
  return {
    dossierId, facture, lignes: lu.lignes, transmissions: lu.transmissions, evenementsSuperpdp: lu.evenements,
    statutsRecus: lu.statuts, encaissements: lu.encaissements, parts: lu.parts,
  }
}

// Ce que le formulaire envoie, tel que le module et la base le jugent. Une part laissée vide ne part pas : la base veut
// des parts positives, et un taux sans part n'en reçoit rien.
function saisieDe(f: Formulaire): SaisieEncaissement {
  return {
    date: f.date === '' ? null : f.date,
    montant: lireMontantSaisi(f.montant),
    moyen: f.moyen === '' ? null : f.moyen,
    ligneBancaireId: f.ligneBancaireId,
    repartition: f.parts.filter((p) => p.montant.trim() !== '')
      .map((p) => ({ taux: p.taux, montant: lireMontantSaisi(p.montant) ?? Number.NaN })),
  }
}

// Ce qu'une lecture donne à la fenêtre : rien sur une lecture partielle, et le formulaire neuf qu'elle permet — `undefined`
// quand elle n'en permet aucun (lecture partielle), `null` quand la facture n'a pas été retrouvée.
function etatLu(r: { lu: Lu; manques: Manque[] }, dossierId: string, factureId: string): {
  manques: Manque[]; lu: Lu | null; formulaire: Formulaire | null | undefined
} {
  if (r.manques.length > 0) return { manques: r.manques, lu: null, formulaire: undefined }
  const c = contexteDe(dossierId, factureId, r.lu)
  const reste = c ? resteAEncaisser(c) : null
  return { manques: [], lu: r.lu, formulaire: reste ? formulaireVierge(reste.parTaux, reste.resteCentimes) : null }
}

const libelleMoyen = (moyen: string) => MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen
const libelleMouvement = (m: Pick<MouvementEcran, 'date' | 'libelle'> | undefined) =>
  (m ? `${formatDate(m.date)} · ${m.libelle}` : '—')

// L'ÉTAPE OUVERTE SOUS LA LISTE (étape d4) : la déclaration hors application d'un encaissement — ou d'une
// contre-passation —, ou la contre-passation d'un encaissement déclaré. Une seule à la fois, désignée par l'IDENTIFIANT
// de l'encaissement : elle se juge sur la ligne relue, jamais sur celle du clic.
type Etape =
  | { type: 'declarer'; encaissementId: string; note: string }
  | { type: 'contre-passer'; encaissementId: string; date: string; motif: string }

// L'obligation sous laquelle « Déclaré sur la plateforme » s'offre : sans objet, à préciser ou refusée, rien ne se
// déclare d'ici, et la fenêtre dit pourquoi.
const DECLARATION_OFFERTE: readonly EtatObligationEncaissee[] = ['due', 'facultative']

// Une note faite de blancs n'est pas une note : elle part nulle, comme la base la tiendrait.
const noteEnvoyee = (note: string) => (note.trim() === '' ? null : note)

// La déclaration ACTIVE d'un encaissement — partie sans issue connue, déposée ou acceptée —, s'il en a une : la base
// n'en admet qu'une.
function declarationActive(declarations: readonly DeclarationEcran[], encaissementId: string): DeclarationEcran | undefined {
  return declarations.find((d) => d.encaissement_id === encaissementId && ETATS_DECLARANTS.includes(d.etat))
}

const MANIERE: Record<DeclarationEcran['canal'], string> = {
  manuel: 'à la main',
  plateforme: 'par l’API de la plateforme du client',
  superpdp: 'par Super PDP',
}

// Les parts d'un encaissement, en centimes, du taux le plus fort au plus faible — l'ordre du reste par taux.
function partsDeLEncaissement(parts: readonly PartLue[], encaissementId: string) {
  return parts.filter((p) => p.encaissement_id === encaissementId)
    .map((p) => ({ taux: p.taux, centimes: Math.round(p.montant * 100) }))
    .sort((a, b) => b.taux - a.taux)
}

const messageDeclaration = (cle: (typeof REFUS_DECLARATION)[number]['cle']) =>
  (REFUS_DECLARATION.find((r) => r.cle === cle) as (typeof REFUS_DECLARATION)[number]).modele

export default function EncaissementsFactureModal({ dossierId, facture: factureOuverte, statutTva, onClose, onUpdated }: Props) {
  const [lu, setLu] = useState<Lu | null>(null)
  const [manques, setManques] = useState<Manque[]>([])
  const [formulaire, setFormulaire] = useState<Formulaire | null>(null)
  const [etape, setEtape] = useState<Etape | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // La connexion à la plateforme du client, lue en base (aucun appel à la plateforme) : elle dit si les statuts ont été
  // relevés jusqu'au bout, et quand. `undefined` tant qu'elle n'est pas lue, ou quand sa lecture a échoué.
  const [connexion, setConnexion] = useState<ConnexionPlateformeVue | null | undefined>(undefined)
  const [connexionErreur, setConnexionErreur] = useState<string | null>(null)
  const [resultatReleve, setResultatReleve] = useState<ResultatReleve | null>(null)

  // `vider` : le formulaire repart de ce qui vient d'être lu — à l'ouverture, et après un geste réussi, quand le reste
  // et les propositions ont changé. Après un refus de la base, la saisie reste, pour qu'on la corrige.
  async function lire(vider: boolean) {
    const etat = etatLu(await lireDonnees(dossierId, factureOuverte.id), dossierId, factureOuverte.id)
    setManques(etat.manques)
    setLu(etat.lu)
    if (vider && etat.formulaire !== undefined) setFormulaire(etat.formulaire)
  }

  // La première lecture. Rien ne la devance : la fenêtre est clée par facture dans l'onglet, et ses gestes attendent
  // qu'un formulaire existe. Une fenêtre fermée avant la réponse ne l'écrit pas.
  useEffect(() => {
    let fermee = false
    lireDonnees(dossierId, factureOuverte.id).then((r) => {
      if (fermee) return
      const etat = etatLu(r, dossierId, factureOuverte.id)
      setManques(etat.manques)
      setLu(etat.lu)
      if (etat.formulaire !== undefined) setFormulaire(etat.formulaire)
    })
    lireConnexionPlateforme(dossierId).then((r) => {
      if (fermee) return
      setConnexion(r.erreur === null ? r.donnees.connexion : undefined)
      setConnexionErreur(r.erreur)
    })
    return () => { fermee = true }
  }, [dossierId, factureOuverte.id])

  async function lireConnexion() {
    const r = await lireConnexionPlateforme(dossierId)
    setConnexion(r.erreur === null ? r.donnees.connexion : undefined)
    setConnexionErreur(r.erreur)
  }

  // UN SEUL VERROU pour les cinq gestes de la fenêtre — le relevé des statuts compris —, posé avant le `try` et relâché dans le `finally`, APRÈS la
  // relecture : un clic pendant qu'elle court repartirait d'un état qu'on n'a pas encore vu. Deux clics sur
  // « Enregistrer » enregistreraient deux fois le même argent — la base le plafonne, pas un paiement partiel répété.
  const verrou = useRef(false)

  const aujourdHui = aujourdHuiAParis()
  const contexte = lu ? contexteDe(dossierId, factureOuverte.id, lu) : null
  const facture = lu?.factures.find((f) => f.id === factureOuverte.id) ?? factureOuverte
  const nature = `la facture ${facture.numero ?? ''} (${facture.tiers_nom})`

  async function enregistrer() {
    // Ce que la base refuserait a déjà grisé le bouton : un clic n'arrive ici que sur une saisie qu'elle accepterait.
    if (verrou.current || !contexte || !lu || !formulaire) return
    const saisie = saisieDe(formulaire)
    verrou.current = true
    setEnCours('enregistrer')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('enregistrer_encaissement', {
        p_dossier_id: dossierId,
        p_facture_id: facture.id,
        p_date: saisie.date,
        p_montant: saisie.montant,
        p_moyen: saisie.moyen,
        p_ligne_bancaire_id: saisie.ligneBancaireId,
        // Dans l'ordre de la saisie : la base dit la première part qui dépasse son taux.
        p_repartition: saisie.repartition.map((p) => ({ taux: p.taux, montant: p.montant })),
      })
      if (error) setErreur(messageErreur(error, 'L’encaissement n’a pas pu être enregistré.'))
      else setMessage(`Encaissement enregistré : ${formatMoney(saisie.montant)} le ${formatDate(saisie.date as string)}.`)
      // Dans tous les cas : un refus arrivé après le clic est une écriture concurrente, que la relecture montre.
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'L’encaissement n’a pas pu être enregistré.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  // LE RETRAIT D'UN ENCAISSEMENT JAMAIS DÉCLARÉ : il reste au registre, marqué retiré, et ne compte plus. La
  // confirmation nomme ce qui est retiré — la date, le montant, la facture.
  async function retirer(e: EncaissementEcran) {
    if (verrou.current || !lu) return
    if (refusRetrait(dossierId, e.id, lu.encaissements, encaissementsDeclares(lu.declarations))) return
    if (!window.confirm(
      `Retirer l’encaissement du ${formatDate(e.date_encaissement)} de ${formatMoney(e.montant)} sur ${nature} ?\n\n`
      + 'Il reste au registre, marqué retiré : il ne compte plus dans ce qui est encaissé, et ne se rétablit pas — '
      + 'un encaissement retiré par erreur se saisit de nouveau.',
    )) return
    verrou.current = true
    setEnCours(`retirer-${e.id}`)
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('retirer_encaissement', { p_dossier_id: dossierId, p_encaissement_id: e.id })
      if (error) setErreur(messageErreur(error, 'L’encaissement n’a pas pu être retiré.'))
      else setMessage(`Encaissement du ${formatDate(e.date_encaissement)} retiré : il reste au registre, marqué retiré.`)
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'L’encaissement n’a pas pu être retiré.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  // LA DÉCLARATION HORS APPLICATION : le cabinet inscrit qu'il a saisi le statut sur la plateforme. Elle ne s'efface
  // pas — un clic par erreur laisserait l'encaissement déclaré pour toujours, et ne se corrigerait que par une
  // contre-passation : la confirmation NOMME ce qui est déclaré, et le dit. Ce que la base refuserait a déjà grisé le
  // bouton de l'étape.
  async function declarer() {
    if (verrou.current || !lu || etape?.type !== 'declarer') return
    const e = lu.encaissements.find((x) => x.id === etape.encaissementId)
    if (!e) return
    const note = noteEnvoyee(etape.note)
    const hote = plateformeDeLaDeclaration(e, lu.declarations, lu.transmissions, lu.evenements) ?? '—'
    const dont = partsEnMots(partsDeLEncaissement(lu.parts, e.id))
    const contrePassation = e.annule_id != null
    if (!window.confirm(
      `Vous déclarez avoir saisi sur ${hote} le statut « Encaissée » de ${nature} : `
      + (contrePassation
        ? `${formatMoney(e.montant)} décaissés le ${formatDate(e.date_encaissement)}, dont ${dont}, avec le motif d’annulation « ${e.motif ?? ''} ». `
        : `${formatMoney(e.montant)} encaissés le ${formatDate(e.date_encaissement)}, dont ${dont}. `)
      + 'Cette mention ne s’efface pas.\n\n'
      + 'Ne confirmez qu’une fois le statut saisi sur la plateforme : une déclaration inscrite ici ne se retire plus, et une '
      + 'erreur ne se corrige que par une contre-passation, déclarée à son tour.',
    )) return
    verrou.current = true
    setEnCours('declarer')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('declarer_encaissement_hors_application', {
        p_dossier_id: dossierId, p_encaissement_id: e.id, p_note: note,
      })
      if (error) setErreur(messageErreur(error, 'La déclaration n’a pas pu être inscrite.'))
      else {
        setMessage(`Déclaration inscrite : ${contrePassation ? 'la contre-passation' : 'l’encaissement'} du `
          + `${formatDate(e.date_encaissement)} (${formatMoney(e.montant)}) est déclaré${contrePassation ? 'e' : ''} sur ${hote}.`)
        setEtape(null)
      }
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'La déclaration n’a pas pu être inscrite.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  // LA CONTRE-PASSATION D'UN ENCAISSEMENT DÉCLARÉ : un encaissement de montant opposé, réparti comme lui, de même moyen,
  // qui porte son motif. La confirmation nomme ce qui sera écrit, et ce qui suit : la déclarer à son tour.
  async function contrePasser() {
    if (verrou.current || !lu || etape?.type !== 'contre-passer') return
    const e = lu.encaissements.find((x) => x.id === etape.encaissementId)
    if (!e) return
    const cp = contrePassationDe(e, lu.parts)
    const hote = declarationActive(lu.declarations, e.id)?.hote ?? '—'
    if (!window.confirm(
      `Contre-passer l’encaissement du ${formatDate(e.date_encaissement)} de ${formatMoney(e.montant)} sur ${nature} ?\n\n`
      + `Sera écrite au registre une contre-passation datée du ${formatDate(etape.date)} : ${formatMoney(cp.montantCentimes / 100)}, `
      + `dont ${partsEnMots(cp.parts)}, du même moyen de paiement (${libelleMoyen(e.moyen)}), motif « ${etape.motif} ».\n\n`
      + `Elle se déclare ensuite à son tour sur ${hote} ; puis le bon encaissement s’enregistre : l’annulation libère le reste `
      + 'de la facture et le mouvement.',
    )) return
    verrou.current = true
    setEnCours('contre-passer')
    setErreur(null)
    setMessage(null)
    try {
      const { error } = await supabase.rpc('annuler_encaissement', {
        p_dossier_id: dossierId, p_encaissement_id: e.id, p_date: etape.date, p_motif: etape.motif,
      })
      if (error) setErreur(messageErreur(error, 'La contre-passation n’a pas pu être enregistrée.'))
      else {
        setMessage(`Contre-passation enregistrée : ${formatMoney(cp.montantCentimes / 100)} le ${formatDate(etape.date)}. `
          + `Elle se déclare à son tour sur ${hote}.`)
        setEtape(null)
      }
      await lire(!error)
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'La contre-passation n’a pas pu être enregistrée.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  // LE RELEVÉ DES STATUTS, AU MOMENT DE DÉCLARER (étape d7) : sur un clic, sous le verrou de la fenêtre — une déclaration
  // inscrite pendant qu'il court se jugerait sur des statuts qu'on n'a pas encore relus. La fenêtre relit sa facture, ses
  // statuts et la connexion avant de relâcher, et l'onglet relit les siens.
  async function releverStatuts() {
    if (verrou.current) return
    verrou.current = true
    setEnCours('relever')
    setErreur(null)
    setMessage(null)
    setResultatReleve(null)
    try {
      const r = await releverEtNommer(dossierId, false)
      if (r.erreur !== null) setErreur(r.erreur)
      else setResultatReleve(r.resultat)
      await Promise.all([lire(false), lireConnexion()])
      onUpdated()
    } catch (err) {
      setErreur(messageErreur(err, 'Les statuts de la plateforme n’ont pas pu être lus.'))
    } finally {
      setEnCours(null)
      verrou.current = false
    }
  }

  return (
    <div style={overlayStyle}>
      <div className="card" style={{ width: 'min(820px, 95vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <h2 style={{ marginTop: 0 }}>Encaissements de la facture {facture.numero}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {facture.tiers_nom}, du {formatDate(facture.date_emission)}, {formatMoney(facture.montant_ttc)} TTC. Un encaissement
          s’enregistre ici, au registre du dossier ; rien ne part vers une plateforme ni vers l’administration.
        </p>

        {manques.length > 0 ? (
          <>
            {manques.map((m) => (
              <BandeauLecturePartielle key={m.quoi} quoi={m.quoi} motif={m.motif} accord={m.accord} consequence={m.consequence} />
            ))}
          </>
        ) : !lu ? (
          <p className="muted">Chargement…</p>
        ) : !contexte ? (
          <p className="error-text">Cette facture n’a pas été retrouvée dans le dossier : rien n’est proposé. Rouvre l’onglet Factures.</p>
        ) : (
          <Contenu
            dossierId={dossierId} contexte={contexte} lu={lu} statutTva={statutTva} aujourdHui={aujourdHui}
            formulaire={formulaire} setFormulaire={setFormulaire} etape={etape} setEtape={setEtape} enCours={enCours}
            onEnregistrer={enregistrer} onRetirer={retirer} onDeclarer={declarer} onContrePasser={contrePasser}
            connexion={connexion} connexionErreur={connexionErreur} onRelever={releverStatuts}
          />
        )}

        {resultatReleve && <BilanReleveStatuts resultat={resultatReleve} />}
        {message && <p className="muted" role="status">{message}</p>}
        {erreur && <p className="error-text">{erreur}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={enCours != null}>Fermer</button>
        </div>
      </div>
    </div>
  )
}

function Contenu({
  dossierId, contexte, lu, statutTva, aujourdHui, formulaire, setFormulaire, etape, setEtape, enCours, onEnregistrer,
  onRetirer, onDeclarer, onContrePasser, connexion, connexionErreur, onRelever,
}: {
  dossierId: string
  contexte: ContexteFacture
  lu: Lu
  statutTva: StatutTva | null
  aujourdHui: string
  formulaire: Formulaire | null
  setFormulaire: (f: Formulaire) => void
  etape: Etape | null
  setEtape: (e: Etape | null) => void
  enCours: string | null
  onEnregistrer: () => void
  onRetirer: (e: EncaissementEcran) => void
  onDeclarer: () => void
  onContrePasser: () => void
  connexion: ConnexionPlateformeVue | null | undefined
  connexionErreur: string | null
  onRelever: () => void
}) {
  const facture = lu.factures.find((f) => f.id === contexte.facture.id) as FactureEmise
  const statuts = statutsDeLaFacture(lu.statuts, facture.id)
  const obligation = obligationEncaissee(facture, lu.lignes, statutTva)
  const reste = resteAEncaisser(contexte)
  const surLaFacture = refusDeLaFacture(contexte)
  const siens = lu.encaissements.filter((e) => e.facture_id === facture.id)
  const partsDe = (id: string) => lu.parts.filter((p) => p.encaissement_id === id)
  const mouvement = (id: string | null) => (id == null ? undefined : lu.mouvements.find((m) => m.id === id))
  const declares = encaissementsDeclares(lu.declarations)
  const offerte = DECLARATION_OFFERTE.includes(obligation.etat)
  const hoteAcceptee = plateformeAcceptee(facture.id, lu.transmissions, lu.evenements)

  // L'étape ouverte se montre : elle naît sous la liste, que la fenêtre fait souvent défiler hors de vue.
  const refEtape = useRef<HTMLDivElement>(null)
  const cleEtape = etape ? `${etape.type}-${etape.encaissementId}` : null
  useEffect(() => {
    if (cleEtape) refEtape.current?.scrollIntoView?.({ block: 'nearest' })
  }, [cleEtape])

  // L'effet des avoirs, À L'ÉCRAN SEULEMENT : la base ne les déduit pas, et le plafond d'un encaissement reste le total
  // de la facture (entrée d2). Le client, lui, ne doit plus ce qu'un avoir a crédité.
  const avoirs = lu.factures.filter((f) => f.type === 'avoir' && f.statut === 'validee' && f.facture_origine_id === facture.id)
  const crediteCentimes = avoirs.reduce((s, a) => s + Math.round(-a.montant_ttc * 100), 0)
  const attenduCentimes = Math.max(reste.resteCentimes - crediteCentimes, 0)

  // Cette fenêtre est celle du cabinet, qui porte les deux droits (`gere_la_banque` en base) : un mouvement s'y désigne.
  const gereLaBanque = true
  const propositions = propositionsEncaissement(
    contexte, lu.pieces, paiementsDesPieces(lu.mouvements, lu.reglements), lu.mouvements, aujourdHui, gereLaBanque,
  )
  const saisie = formulaire ? saisieDe(formulaire) : null
  const refus = saisie ? refusEnregistrement(contexte, saisie, lu.mouvements, aujourdHui, gereLaBanque) : null
  const choisie = formulaire?.ligneBancaireId ? propositions.find((p) => p.ligneBancaireId === formulaire.ligneBancaireId) ?? null : null
  const moyen = formulaire ? MOYENS_ENCAISSEMENT.find((m) => m.moyen === formulaire.moyen) ?? null : null
  const echeanceSaisie = formulaire && formulaire.date !== '' ? echeanceDeDeclaration(formulaire.date, statutTva) : null
  const nomPiece = (id: string) => {
    const p = lu.pieces.find((x) => x.id === id)
    return p ? (p.tiers ?? p.nom_fichier) : 'une pièce'
  }
  // LA JUMELLE OU UNE AUTRE PIÈCE (ligne 28.6, lib/ventesJumelles.ts) : un mouvement qui paie la pièce jumelle de cette
  // facture paie la même vente — c'est attendu ; un mouvement qui paie une autre pièce, que rien ne relie à la facture,
  // paie peut-être le PDF de la même vente, qui la compterait deux fois. Le pont le dit ; les refus n'en dépendent pas.
  const idsJumelles = new Set(piecesJumelles(contexte, lu.pieces).map((p) => p.id))
  const payeesJumelles = choisie ? choisie.piecesPayees.filter((id) => idsJumelles.has(id)) : []
  const payeesAutres = choisie ? choisie.piecesPayees.filter((id) => !idsJumelles.has(id)) : []

  // Où et comment le statut se déclare, ou pourquoi rien ne se déclare d'ici.
  const commentSeDeclare = !offerte
    ? obligation.etat === 'sans_objet'
      ? 'Aucun encaissement de cette facture ne se déclare.'
      : obligation.etat === 'a_preciser'
        ? statutTva == null
          ? 'Rien ne se déclare d’ici : précisez d’abord le statut de TVA du dossier.'
          : 'Rien ne se déclare d’ici tant que l’obligation est à préciser.'
        : 'Rien ne se déclare d’ici pour une facture mixte : seule la part des services se déclarerait, et ses lignes ne disent pas laquelle.'
    : surLaFacture?.cle === 'rejetee'
      ? messageDeclaration('facture_rejetee')
      : hoteAcceptee == null
        ? messageDeclaration('sans_transmission_acceptee')
        : `Il se déclare hors de l’application, sur ${hoteAcceptee} — la plateforme qui a accepté la facture : le cabinet ou le `
          + 'client y saisit le statut « Encaissée », puis l’inscrit ici par « Déclaré sur la plateforme ». Rien ne part d’ici '
          + 'vers la plateforme ni vers l’administration.'

  function changerMontant(texte: string) {
    if (!formulaire) return
    setFormulaire({ ...formulaire, montant: texte, parts: partsProposees(centimesDuTexte(texte), reste.parTaux) })
  }

  function choisirMouvement(id: string) {
    if (!formulaire) return
    const p = propositions.find((x) => x.ligneBancaireId === id)
    if (!p) {
      setFormulaire({ ...formulaire, ligneBancaireId: null })
      return
    }
    // La proposition remplit la date, le montant et la répartition ; le moyen reste à choisir.
    setFormulaire({
      ...formulaire,
      ligneBancaireId: p.ligneBancaireId,
      date: p.date,
      montant: montantPourSaisie(p.montantCentimes),
      parts: reste.parTaux.map((t) => {
        const part = p.repartition.find((x) => x.taux === t.taux)
        return { taux: t.taux, montant: part ? montantPourSaisie(part.centimes) : '' }
      }),
    })
  }

  // Ce que la colonne « Déclaration » dit d'un encaissement : déclaré (où, quand, la note) ; à déclarer, où et avant
  // quand ; ou pourquoi il ne se déclare pas d'ici. Et, d'une contre-passation, l'encaissement qu'elle annule et son motif.
  function celluleDeclaration(e: EncaissementEcran): ReactNode {
    if (e.retire_le != null) return '—'
    const annule = e.annule_id == null ? undefined : lu.encaissements.find((x) => x.id === e.annule_id)
    const lignes: ReactNode[] = []
    if (e.annule_id != null) {
      lignes.push(
        <div key="annule">
          Annule l’encaissement {annule ? `du ${formatDate(annule.date_encaissement)} de ${formatMoney(annule.montant)}` : ''} —
          motif : « {e.motif ?? ''} »
        </div>,
      )
    }
    const d = declarationActive(lu.declarations, e.id)
    if (d) {
      lignes.push(
        <div key="declare">
          Déclaré {MANIERE[d.canal]} sur {d.hote} le {formatDate(d.cree_le)}{d.etat === 'envoi' ? ' — issue inconnue' : ''}
        </div>,
      )
      if (d.note) lignes.push(<div key="note" className="note-declaration">Note : {d.note}</div>)
      return <div>{lignes}</div>
    }
    const refusDecl = offerte
      ? refusDeclaration(dossierId, e.id, lu.encaissements, lu.declarations, lu.transmissions, lu.evenements, lu.statuts, null)
      : null
    if (!offerte) lignes.push(<div key="hors">Ne se déclare pas d’ici : voir le statut « Encaissée » ci-dessus.</div>)
    else if (refusDecl == null) {
      lignes.push(<div key="ou">À déclarer sur {plateformeDeLaDeclaration(e, lu.declarations, lu.transmissions, lu.evenements)}</div>)
    } else lignes.push(<div key="refus">{refusDecl.message}</div>)
    // L'échéance, tant que le statut est (ou peut être) dû : une facture rejetée n'en a plus, une obligation sans objet ou
    // refusée non plus.
    const echeance = (offerte && (refusDecl == null || refusDecl.cle === 'sans_transmission_acceptee'))
      || obligation.etat === 'a_preciser'
      ? echeanceDeDeclaration(e.date_encaissement, statutTva)
      : null
    // Un retard ne se dit que d'une obligation DUE : facultative, rien n'est en retard.
    const enRetard = echeance != null && obligation.etat === 'due' && echeance.date < aujourdHui
    if (echeance) {
      lignes.push(
        <div key="echeance">
          {echeance.libelle}
          {enRetard && <> <span className="badge badge-danger">Échéance dépassée</span></>}
        </div>,
      )
    }
    return <div>{lignes}</div>
  }

  const enEtape = etape ? lu.encaissements.find((x) => x.id === etape.encaissementId && x.facture_id === facture.id) : undefined

  return (
    <>
      <div className="field">
        <label>Le statut « Encaissée »</label>
        <p style={{ margin: 0 }}>{obligation.raison}</p>
        <p className="muted" style={{ margin: '4px 0 0' }}>{commentSeDeclare}</p>
      </div>

      {statuts.length > 0 && (
        <div className="field">
          <label>Statuts lus sur la plateforme du client</label>
          <ul className="statuts-lus">
            {statuts.map((s) => <StatutDeLaFacture key={s.id} statut={s} />)}
          </ul>
        </div>
      )}

      <div className="field">
        <label>Reste à encaisser : {formatMoney(reste.resteCentimes / 100)}</label>
        <div className="table-scroll tableau-adaptable">
          <table className="table-empilable-etroite">
            <thead><tr><th>Taux de TVA</th><th>TTC de la facture</th><th>Encaissé</th><th>Reste</th></tr></thead>
            <tbody>
              {reste.parTaux.map((t) => (
                <tr key={t.taux}>
                  <td data-libelle="Taux de TVA">{tauxAffiche(t.taux)}</td>
                  <td data-libelle="TTC de la facture">{formatMoney(t.ttcCentimes / 100)}</td>
                  <td data-libelle="Encaissé">{formatMoney(t.encaisseCentimes / 100)}</td>
                  <td data-libelle="Reste">{formatMoney(t.resteCentimes / 100)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Total</strong></td>
                <td data-libelle="TTC de la facture">{formatMoney(reste.ttcCentimes / 100)}</td>
                <td data-libelle="Encaissé">{formatMoney(reste.encaisseCentimes / 100)}</td>
                <td data-libelle="Reste">{formatMoney(reste.resteCentimes / 100)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {avoirs.length > 0 && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {avoirs.length === 1 ? 'L’avoir' : 'Les avoirs'} {avoirs.map((a) => a.numero ?? '—').join(', ')} de cette facture
            {avoirs.length === 1 ? ' en crédite ' : ' en créditent '}{formatMoney(crediteCentimes / 100)} : le client ne doit plus
            que {formatMoney(attenduCentimes / 100)} sur ce reste. C’est un affichage seulement — la base ne déduit pas les
            avoirs, et un encaissement reste plafonné au total de la facture.
          </p>
        )}
      </div>

      <div className="field">
        <label>Encaissements enregistrés</label>
        {siens.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Aucun encaissement enregistré pour cette facture.</p>
        ) : (
          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable">
              <thead>
                <tr><th>Date</th><th>Moyen</th><th>Montant</th><th>Mouvement</th><th>Répartition</th><th>État</th><th>Déclaration</th><th></th></tr>
              </thead>
              <tbody>
                {siens.map((e) => {
                  const refusDuRetrait = refusRetrait(dossierId, e.id, lu.encaissements, declares)
                  // « Déclaré sur la plateforme » : un encaissement ou une contre-passation qui compte, pas encore déclaré,
                  // que la base inscrirait, sous une obligation due ou facultative.
                  const declarable = offerte && e.retire_le == null && !declares.has(e.id)
                    && refusDeclaration(dossierId, e.id, lu.encaissements, lu.declarations, lu.transmissions, lu.evenements, lu.statuts, null) == null
                  // « Contre-passer » : un encaissement déclaré, à la place de « Retirer ». Tout ce qui précède la date se
                  // juge sans elle : un premier refus « date à renseigner » dit que rien d'autre ne s'y oppose.
                  const refusCp = refusDuRetrait?.cle === 'declare'
                    ? refusContrePassation(dossierId, e.id, lu.encaissements, lu.declarations, null, null, aujourdHui)
                    : null
                  const contrePassable = refusCp?.cle === 'date_absente'
                  const contrePasse = lu.encaissements.some((a) => a.annule_id === e.id && a.retire_le == null)
                  return (
                    <tr key={e.id}>
                      <td data-libelle="Date">{formatDate(e.date_encaissement)}</td>
                      <td data-libelle="Moyen">{libelleMoyen(e.moyen)}</td>
                      <td data-libelle="Montant">{formatMoney(e.montant)}</td>
                      <td data-libelle="Mouvement" style={{ overflowWrap: 'anywhere' }}>{libelleMouvement(mouvement(e.ligne_bancaire_id))}</td>
                      <td data-libelle="Répartition">
                        <span>{partsDe(e.id).map((p) => `${tauxAffiche(p.taux)} : ${formatMoney(p.montant)}`).join(' · ') || '—'}</span>
                      </td>
                      <td data-libelle="État">
                        {e.retire_le != null
                          ? <span className="badge badge-neutral">Retiré le {formatDate(e.retire_le)}</span>
                          : e.annule_id != null
                            ? <span className="badge badge-warning">Annulation</span>
                            : contrePasse
                              ? <span className="badge badge-neutral">Contre-passé</span>
                              : <span className="badge badge-ok">Enregistré</span>}
                      </td>
                      <td data-libelle="Déclaration" className="muted cellule-declaration">{celluleDeclaration(e)}</td>
                      <td className="td-actions">
                        {refusDuRetrait == null && (
                          <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={() => onRetirer(e)}>
                            {enCours === `retirer-${e.id}` ? 'Retrait…' : 'Retirer'}
                          </button>
                        )}
                        {declarable && (
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={enCours != null}
                            onClick={() => setEtape({ type: 'declarer', encaissementId: e.id, note: '' })}
                          >
                            Déclaré sur la plateforme
                          </button>
                        )}
                        {contrePassable && (
                          <button
                            type="button" className="btn btn-outline btn-sm" disabled={enCours != null}
                            onClick={() => setEtape({ type: 'contre-passer', encaissementId: e.id, date: '', motif: '' })}
                          >
                            Contre-passer
                          </button>
                        )}
                        {refusDuRetrait != null && refusDuRetrait.cle !== 'deja_retire' && (
                          <span className="muted" style={{ fontSize: '0.82rem' }}>{refusDuRetrait.message}</span>
                        )}
                        {refusCp != null && !contrePassable && (
                          <span className="muted" style={{ fontSize: '0.82rem' }}>{refusCp.message}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {etape?.type === 'declarer' && enEtape && (
        <div ref={refEtape}>
          <EtapeDeclaration
            dossierId={dossierId} lu={lu} facture={facture} encaissement={enEtape} etape={etape} setEtape={setEtape}
            enCours={enCours} onDeclarer={onDeclarer} connexion={connexion} connexionErreur={connexionErreur}
            onRelever={onRelever}
          />
        </div>
      )}
      {etape?.type === 'contre-passer' && enEtape && (
        <div ref={refEtape}>
          <EtapeContrePassation
            dossierId={dossierId} lu={lu} encaissement={enEtape} etape={etape} setEtape={setEtape} aujourdHui={aujourdHui}
            enCours={enCours} onContrePasser={onContrePasser}
          />
        </div>
      )}

      {surLaFacture ? (
        <p className="alerte-tva">{surLaFacture.message}</p>
      ) : reste.resteCentimes <= 0 ? (
        <p className="muted">La facture est entièrement encaissée : il n’y a plus rien à enregistrer.</p>
      ) : formulaire && saisie && (
        <div className="field">
          <label>Enregistrer un encaissement</label>

          <div className="field">
            <label htmlFor="encaissement-mouvement">Mouvement du relevé (facultatif)</label>
            <select
              id="encaissement-mouvement" value={formulaire.ligneBancaireId ?? ''}
              onChange={(ev) => choisirMouvement(ev.target.value)}
            >
              <option value="">Aucun mouvement</option>
              {propositions.map((p) => (
                <option key={p.ligneBancaireId} value={p.ligneBancaireId}>
                  {libelleMouvement(mouvement(p.ligneBancaireId))} · {formatMoney(p.creditCentimes / 100)}
                  {p.ecartCentimes !== 0 ? ` (écart ${formatMoney(p.ecartCentimes / 100)})` : ''}
                </option>
              ))}
            </select>
            {propositions.length === 0 ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Aucun mouvement ne se propose : ni paiement de la pièce jumelle, ni crédit du relevé qui fasse le reste à
                l’écart des frais près. Un encaissement sans mouvement s’enregistre aussi (espèces, chèque pas encore crédité).
              </p>
            ) : choisie ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {choisie.source === 'jumelle' ? 'Paiement de la pièce jumelle — la même vente, reçue comme pièce. ' : 'Crédit du relevé. '}
                {choisie.explication}
                {choisie.clientCite ? ' Le libellé du mouvement cite le client.' : ''}
                {payeesJumelles.length > 0
                  ? ` Ce mouvement paie la pièce jumelle de cette facture (${payeesJumelles.map(nomPiece).join(', ')}) : `
                    + 'c’est la même vente.'
                  : ''}
                {payeesAutres.length > 0
                  ? ` Ce mouvement paie ${payeesJumelles.length > 0 ? 'aussi' : 'déjà'} `
                    + `${payeesAutres.length > 1 ? 'd’autres pièces' : 'une autre pièce'}, que rien ne relie à cette facture `
                    + `(${payeesAutres.map(nomPiece).join(', ')}) : si c’est le PDF de cette vente, elle compte deux fois — `
                    + 'ne gardez qu’une pièce par facture.'
                  : ''}
              </p>
            ) : (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {propositions.length === 1 ? 'Un mouvement se propose' : `${propositions.length} mouvements se proposent`} :
                le choisir remplit la date, le montant et la répartition.
              </p>
            )}
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="encaissement-date">Date de l’encaissement</label>
              <input
                id="encaissement-date" type="date" value={formulaire.date}
                onChange={(ev) => setFormulaire({ ...formulaire, date: ev.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="encaissement-montant">Montant encaissé (€)</label>
              <input
                id="encaissement-montant" type="text" inputMode="decimal" value={formulaire.montant}
                onChange={(ev) => changerMontant(ev.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="encaissement-moyen">Moyen de paiement</label>
              <select
                id="encaissement-moyen" value={formulaire.moyen}
                onChange={(ev) => setFormulaire({ ...formulaire, moyen: ev.target.value })}
              >
                <option value="">Choisir…</option>
                {MOYENS_ENCAISSEMENT.map((m) => <option key={m.moyen} value={m.moyen}>{m.libelle}</option>)}
              </select>
            </div>
          </div>
          {moyen?.dateARetenir && <p className="muted" style={{ margin: '-6px 0 8px' }}>Date à retenir : {moyen.dateARetenir}</p>}
          {formulaire.date !== '' && formulaire.date < facture.date_emission && (
            <p className="muted" style={{ margin: '-6px 0 8px' }}>
              Payé avant la date de la facture : un acompte, dont l’échéance de déclaration court depuis le paiement.
            </p>
          )}
          {echeanceSaisie && <p className="muted" style={{ margin: '-6px 0 8px' }}>{echeanceSaisie.libelle}</p>}

          <div className="table-scroll tableau-adaptable">
            <table className="table-empilable table-formulaire">
              <thead><tr><th>Taux de TVA</th><th>Reste à ce taux</th><th>Part encaissée (€)</th></tr></thead>
              <tbody>
                {formulaire.parts.map((p, i) => {
                  const t = reste.parTaux.find((x) => x.taux === p.taux)
                  return (
                    <tr key={p.taux}>
                      <td data-libelle="Taux de TVA">{tauxAffiche(p.taux)}</td>
                      <td data-libelle="Reste à ce taux">{t ? formatMoney(t.resteCentimes / 100) : '—'}</td>
                      <td data-libelle="Part encaissée (€)">
                        <input
                          aria-label={`Part à ${tauxAffiche(p.taux)}`} type="text" inputMode="decimal" value={p.montant}
                          onChange={(ev) => setFormulaire({
                            ...formulaire,
                            parts: formulaire.parts.map((q, j) => (j === i ? { ...q, montant: ev.target.value } : q)),
                          })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            Proposée au prorata de ce qui reste à chaque taux ; corrigible. Une part laissée vide n’est pas envoyée.
          </p>

          {refus && <p className="alerte-tva" style={{ marginTop: 0 }}>{refus.message}</p>}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onEnregistrer}>
              {enCours === 'enregistrer' ? 'Enregistrement…' : 'Enregistrer l’encaissement'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// UN STATUT LU SUR LA PLATEFORME DU CLIENT : son libellé de la DGFiP, sa date — civile, ou l'horodatage tel qu'écrit, son
// fuseau n'étant pas dit —, qui l'a posé, ses motifs, son commentaire et ses montants tels qu'écrits ; un refus ou un
// rejet porte sa conséquence. Un 211 n'est jamais un encaissement : c'est l'acheteur qui dit avoir payé.
function StatutDeLaFacture({ statut: s }: { statut: StatutLu }) {
  const annulation = estUneAnnulation(s.code)
  const auteur = auteurDuStatut(s.createur_role)
  const quand = s.date_statut ? `du ${formatDate(s.date_statut)}` : s.emis_le ? `horodaté le ${horodatageTelQuEcrit(s.emis_le)}` : null
  const montants = montantsTelsQuEcrits(s.montants)
  return (
    <li className={annulation ? 'releve-annulation' : undefined}>
      <span className={`badge ${classeStatutLu(s.code)}`}>{libelleStatutLu(s.code)}</span>
      {quand && <> {quand}</>}
      {auteur && <>, posé par {auteur}</>}
      {annulation && <> — {CONSEQUENCE_ANNULATION}.</>}
      {s.code === '211' && <> — l’acheteur dit avoir payé ; ce n’est pas un encaissement, qui s’enregistre ici.</>}
      {s.motifs && <div>Motifs : {s.motifs}</div>}
      {s.commentaire && <div>Commentaire : {s.commentaire}</div>}
      {montants && <div>Montants, tels qu’écrits : {montants}</div>}
      <div className="releve-avertissement">Lu sur {s.hote} le {formatDate(s.lu_le)}</div>
    </li>
  )
}

// « DÉCLARÉ SUR LA PLATEFORME » : ce qu'il faut saisir sur la plateforme, champ par champ (le numéro de la facture, la
// date de paiement, le montant encaissé TTC en euros et sa répartition par taux — fiche officielle du statut ; pour une
// contre-passation, des montants négatifs et le motif d'annulation en commentaire, règles P1.15 et P1.17 de l'annexe 7
// des spécifications externes), une note facultative, et les refus de la base avant le clic.
function EtapeDeclaration({
  dossierId, lu, facture, encaissement: e, etape, setEtape, enCours, onDeclarer, connexion, connexionErreur, onRelever,
}: {
  dossierId: string
  lu: Lu
  facture: FactureEmise
  encaissement: EncaissementEcran
  etape: Extract<Etape, { type: 'declarer' }>
  setEtape: (e: Etape | null) => void
  enCours: string | null
  onDeclarer: () => void
  connexion: ConnexionPlateformeVue | null | undefined
  connexionErreur: string | null
  onRelever: () => void
}) {
  const contrePassation = e.annule_id != null
  const hote = plateformeDeLaDeclaration(e, lu.declarations, lu.transmissions, lu.evenements)
  const refus = refusDeclaration(dossierId, e.id, lu.encaissements, lu.declarations, lu.transmissions, lu.evenements, lu.statuts, noteEnvoyee(etape.note))
  // Un refus de l'ACHETEUR fait sur la plateforme du client ne se connaît qu'une fois ses statuts relevés (étape d7) :
  // la fenêtre dit ce qu'elle en SAIT — lus jusqu'au bout et quand, ou pas encore — et offre de les relever. Celui que
  // Super PDP rend, la base et le module le connaissent. Une contre-passation suit l'encaissement qu'elle annule, la
  // facture eût-elle été refusée depuis.
  const surPlateformeDuClient = !contrePassation && hote != null && lu.transmissions.some((t) =>
    t.facture_id === facture.id && t.hote === hote && t.canal === 'plateforme' && t.etat === 'accepte')
  const verification = surPlateformeDuClient && hote != null
    ? verificationAvantDeclaration(hote, statutsDeLaFacture(lu.statuts, facture.id), connexion, connexionErreur, formatDate)
    : null
  const champs: { champ: string; valeur: string }[] = [
    { champ: 'Plateforme', valeur: hote ?? '—' },
    { champ: 'Numéro de la facture', valeur: facture.numero ?? '—' },
    { champ: contrePassation ? 'Date du décaissement' : 'Date de paiement', valeur: formatDate(e.date_encaissement) },
    {
      champ: contrePassation ? 'Montant décaissé TTC, en euros (négatif)' : 'Montant encaissé TTC, en euros',
      valeur: formatMoney(e.montant),
    },
    ...partsDeLEncaissement(lu.parts, e.id).map((p) => ({ champ: `Dont, au taux de ${tauxAffiche(p.taux)}`, valeur: formatMoney(p.centimes / 100) })),
    ...(contrePassation ? [{ champ: 'Commentaire : le motif d’annulation', valeur: e.motif ?? '—' }] : []),
  ]
  return (
    <div className="field etape-encaissement">
      <h3>
        Déclaré sur la plateforme — {contrePassation ? 'la contre-passation' : 'l’encaissement'} du {formatDate(e.date_encaissement)}
      </h3>
      <p>
        Saisissez d’abord sur la plateforme le statut « Encaissée » de la facture, avec ces données ; puis inscrivez ici que
        c’est fait. Rien ne part d’ici.
        {contrePassation && ' Une contre-passation est un décaissement : ses montants se saisissent en négatif, et son motif '
          + 'd’annulation en commentaire du statut.'}
      </p>
      {/* Un refus lu n'a rien à vérifier : la déclaration est refusée, et le refus de la base le dit sous le tableau. */}
      {verification && verification.etat !== 'refusee' && (
        <div className="verification-declaration">
          <p>{verification.texte}</p>
          {verification.relevable && (
            <button type="button" className="btn btn-outline btn-sm" disabled={enCours != null} onClick={onRelever}>
              {enCours === 'relever' ? 'Lecture des statuts…' : 'Lire les statuts de la plateforme'}
            </button>
          )}
        </div>
      )}
      <div className="table-scroll tableau-adaptable">
        <table className="table-empilable-etroite">
          <thead><tr><th>Champ de la plateforme</th><th>À saisir</th></tr></thead>
          <tbody>
            {champs.map((c) => (
              <tr key={c.champ}>
                <td><strong>{c.champ}</strong></td>
                <td data-libelle="À saisir" style={{ overflowWrap: 'anywhere' }}>{c.valeur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field">
        {/* La note est lue par le client qui porte la case « Ventes » (migration ventes_du_client) : le libellé le dit. */}
        <label htmlFor="declaration-note">{LIBELLE_NOTE_DECLARATION}</label>
        <textarea
          id="declaration-note" rows={3} value={etape.note}
          onChange={(ev) => setEtape({ ...etape, note: ev.target.value })}
        />
        <p className="muted" style={{ margin: '4px 0 0' }}>2 000 caractères au plus. Elle ne se modifie plus ensuite.</p>
      </div>
      {refus && <p className="alerte-tva" style={{ marginTop: 0 }}>{refus.message}</p>}
      <div className="rangee-boutons">
        <button type="button" className="btn btn-outline" disabled={enCours != null} onClick={() => setEtape(null)}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onDeclarer}>
          {enCours === 'declarer' ? 'Inscription…' : 'Inscrire la déclaration'}
        </button>
      </div>
    </div>
  )
}

// « CONTRE-PASSER » UN ENCAISSEMENT DÉCLARÉ : la date du décaissement, jamais proposée — l'écran ne la choisit pas à la
// place du cabinet —, le motif d'annulation, ce qui sera écrit, et les refus de la base avant le clic, au jour de Paris.
function EtapeContrePassation({ dossierId, lu, encaissement: e, etape, setEtape, aujourdHui, enCours, onContrePasser }: {
  dossierId: string
  lu: Lu
  encaissement: EncaissementEcran
  etape: Extract<Etape, { type: 'contre-passer' }>
  setEtape: (e: Etape | null) => void
  aujourdHui: string
  enCours: string | null
  onContrePasser: () => void
}) {
  const hote = declarationActive(lu.declarations, e.id)?.hote ?? '—'
  const cp = contrePassationDe(e, lu.parts)
  const refus = refusContrePassation(
    dossierId, e.id, lu.encaissements, lu.declarations, etape.date === '' ? null : etape.date, etape.motif, aujourdHui,
  )
  return (
    <div className="field etape-encaissement">
      <h3>Contre-passer l’encaissement du {formatDate(e.date_encaissement)} — {formatMoney(e.montant)}</h3>
      <p>
        Un encaissement déclaré ne se retire pas : il s’annule par une contre-passation de montant opposé, qui se déclare à
        son tour sur {hote} ; puis le bon encaissement s’enregistre.
      </p>
      <div className="field">
        <label htmlFor="contre-passation-date">Date du décaissement</label>
        <input
          id="contre-passation-date" type="date" value={etape.date}
          onChange={(ev) => setEtape({ ...etape, date: ev.target.value })}
        />
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Le jour où l’encaissement est défait — le chèque revenu impayé, la somme rendue — ou, pour une déclaration faite
          par erreur, le jour où elle est corrigée ; ni avant l’encaissement ({formatDate(e.date_encaissement)}), ni dans
          l’avenir.
        </p>
      </div>
      <div className="field">
        {/* Le motif est lu par le client qui porte la case « Ventes » (migration ventes_du_client) : le libellé le dit. */}
        <label htmlFor="contre-passation-motif">{LIBELLE_MOTIF_CONTRE_PASSATION}</label>
        <textarea
          id="contre-passation-motif" rows={3} value={etape.motif}
          onChange={(ev) => setEtape({ ...etape, motif: ev.target.value })}
        />
        <p className="muted" style={{ margin: '4px 0 0' }}>Obligatoire, 2 000 caractères au plus.</p>
      </div>
      <p className="muted">
        Sera écrit : {formatMoney(cp.montantCentimes / 100)}, dont {partsEnMots(cp.parts)}, du même moyen de paiement
        ({libelleMoyen(e.moyen)}).
      </p>
      {refus && <p className="alerte-tva" style={{ marginTop: 0 }}>{refus.message}</p>}
      <div className="rangee-boutons">
        <button type="button" className="btn btn-outline" disabled={enCours != null} onClick={() => setEtape(null)}>Annuler</button>
        <button type="button" className="btn btn-primary" disabled={refus != null || enCours != null} onClick={onContrePasser}>
          {enCours === 'contre-passer' ? 'Contre-passation…' : 'Enregistrer la contre-passation'}
        </button>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 20,
}
