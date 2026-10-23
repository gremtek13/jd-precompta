import { libelleExploitable, motsDuLibelle, motsIdentifiants, motsSeConfirment, tiersConfirmeParBanque } from './appariementBanque'
import { estLeClient, PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import {
  ecartDeFrais, encaissementsDeclares, encaissementsDuMouvement, justifieSonMouvement, mouvementLibre, MOYENS_ENCAISSEMENT,
  ordreDesEncaissements, refusClassement, refusContrePassationVente, refusDuClassementDuReleve, refusRattachement,
  refusRetraitDuClassement, resteAEncaisserVente, SEUIL_PLAFOND_CENTIMES,
  type CleRefusGardeMouvements, type ContexteVente, type DeclarationLue, type EncaissementDuReleve, type EncaissementLu,
  type FactureDuDossier, type LigneDeFacture, type MouvementClasse, type PartLue, type RefusEncaissement,
} from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import type { PlanComptable } from './planComptable'
import type { EncaissementFacture, FactureEmise, LigneBancaire } from './types'
import { dateFigee } from './validationExercice'

// LE RELEVÉ RECONNAÎT LES MOUVEMENTS DES VENTES FACTURÉES (ligne 28.65, chantier EC-Q3, étape VF5a1 ; conception :
// HISTORIQUE.md, « VF5, LA BANQUE : LA CONCEPTION », § 3 à 5). Un module PUR — il ne lit rien en base, n'appelle personne,
// ne lit pas l'horloge — qui dit, pour l'onglet Banque d'un dossier qui a basculé, ce que la base sait déjà de chaque
// mouvement depuis l'étape VF2 :
//   - « classé » : ses encaissements de factures le classent (`lignes_bancaires.encaissements_de_factures`, posé par
//     `classer_mouvement_par_encaissements`, le cabinet seul) ;
//   - « réservé » : un encaissement vivant d'une facture SOURCE le cite et le justifie, et il n'est pas encore classé —
//     la garde G2 (`garder_mouvement_reserve`) ne lui laisse alors aucun autre classement que par ses encaissements ;
//   - rien : un mouvement comme hier, que rien de ce module ne touche.
// LA RÈGLE N'EST PAS RECOPIÉE ICI : l'état se tire du refus que la garde opposerait (`refusDuClassementDuReleve`, ses deux
// derniers refus), les encaissements portés du même filtre que la garde et le classement (`encaissementsDuMouvement`),
// dans l'ordre de la garde (`ordreDesEncaissements`) — lib/encaissementsFactures.ts, confronté au texte de la migration.
// Les mots de « pourquoi rien d'autre ne s'offre » sont ceux de la garde, tels que la base les rendrait.
//
// L'AUTEUR : un encaissement enregistré par un compte qui porte un accès client du dossier est « proposé par le client »
// (lib/auteursVentes.ts) — reconnu sur des accès lus EN ENTIER seulement ; sinon personne n'est nommé, et rien n'est jamais
// dit « par le cabinet ». Le rattachement après coup d'un encaissement à son mouvement (le cabinet seul) ne laisse pas de
// trace de son auteur en base : c'est l'encaissement qui est du client, et la pastille le dit de lui.
//
// LE TOUT OU RIEN : sur un dossier basculé, la lecture des ventes facturées (celle de l'onglet Écritures,
// lib/ecrituresVentesFactureesLecture.ts) est lue en entier, ou rien ne se décide — pas encore revenue, partielle,
// refusée ou d'un autre dossier, l'onglet ne sait pas quels mouvements sont réservés : il le dit, et retient tout geste et
// tout lot (`retenueDuReleve`). Un dossier qui n'a pas basculé ne lit rien de plus et ne change en rien (« sans objet »).
//
// LES LOTS (étape VF5a2, plus bas) : aucun lot du relevé — le rapprochement automatique, « Valider et rapprocher », les
// règles d'affectation, la règle d'ignorance — ne prend un mouvement classé ou réservé. Ce module en dit la liste
// (`mouvementsHorsDesLots`), que chaque plan reçoit sans valeur par défaut, et ce qu'une carte de lot dit de ceux qu'elle
// écarte (`ecartDuLot`) ; les plans eux-mêmes restent dans leurs modules (lib/reglesAffectation.ts,
// lib/appariementBanque.ts, lib/reglesIgnorees.ts), et le relevé compte ses mouvements par `comptesDuReleve`.
//
// LES GESTES DU CABINET SUR UN CRÉDIT (étape VF5c, en fin de module) : classer un mouvement réservé par ses encaissements,
// retirer ce classement, rattacher à un crédit un encaissement enregistré sans mouvement, ou y enregistrer l'encaissement
// d'une facture (`gestesDuCredit`) — la sélection et l'ordre des candidats, les phrases, l'état d'après ; chaque refus est
// celui des fonctions de la base, redit par lib/encaissementsFactures.ts, jamais recopié ici.
//
// LES GESTES DU CABINET SUR UN DÉBIT (étape VF5d, tout à la fin) : le miroir des précédents pour l'impayé et la somme
// rendue — classer un débit réservé par ses contre-passations, retirer ce classement, y rattacher une contre-passation
// enregistrée sans mouvement, ou y contre-passer l'encaissement d'une facture — déclaré, ou, depuis l'étape VF5d2,
// jamais déclaré (`gestesDuDebit`), par les mêmes jugements.
//
// LES CANDIDATS (étape VF5e, en fin de module) : ce que les ventes facturées proposent pour un mouvement LIBRE — une facture
// source ouverte, un encaissement enregistré sans mouvement pour un crédit ; une contre-passation enregistrée sans mouvement
// pour un débit —, chacun accepté par le jugement du module qui redit la base, désigné par son montant (le mouvement se
// classerait alors, à l'écart des frais près) ou par son client, cité au libellé. Ils disent au lot des règles un
// justificatif possible (lib/reglesAffectation.ts, `justificatifPossible`), écartent le mouvement des trois autres lots
// (`horsDesLotsAvecLesCandidats`), et la fiche d'un crédit libre les propose en tête. Rien ne s'écrit seul.

// ── Ce que le module lit ──────────────────────────────────────────────────────────────────────────────────────────────

/** Un encaissement du registre, retirés et contre-passations compris : ce que la garde ordonne, ce que la fiche dit. */
export type EncaissementDuMouvementLu = EncaissementDuReleve & Pick<EncaissementFacture, 'date_encaissement' | 'moyen' | 'cree_par'>

/**
 * Les ventes facturées du dossier, lues EN ENTIER (lib/ecrituresVentesFactureesLecture.ts, `lireLesSourcesDesEcrituresDeVente`,
 * qui en rend davantage) : les factures et avoirs, le registre entier des encaissements, les mouvements du relevé.
 */
export interface SourcesDuReleve {
  dossierId: string
  factures: readonly FactureDuDossier[]
  encaissements: readonly EncaissementDuMouvementLu[]
  mouvements: readonly MouvementClasse[]
}

/** La lecture telle que l'onglet la reçoit : lue, ou incomplète avec le motif de son premier manque. */
export type LectureDesVentesDuReleve =
  | { dossierId: string; etat: 'lue'; sources: SourcesDuReleve }
  | { dossierId: string; etat: 'incomplete'; motif: string }

// ── Ce que le module rend ─────────────────────────────────────────────────────────────────────────────────────────────

/** Un encaissement — ou une contre-passation — que le mouvement porte, dans l'ordre de la garde. */
export interface EncaissementPorte {
  id: string
  factureId: string
  /** Le numéro de la facture ; une facture validée en porte toujours un (`factures_emises_figees`). */
  numero: string
  date: string
  montant: number
  moyen: string
  contrePassation: boolean
  /** Enregistré par un compte qui porte un accès client du dossier, sur des accès lus en entier. */
  parLeClient: boolean
}

export interface MouvementDeVente {
  id: string
  etat: 'classe' | 'reserve'
  montant: number
  encaissements: readonly EncaissementPorte[]
  /** Les numéros des factures, sans doublon, dans l'ordre des encaissements. */
  factures: readonly string[]
  /** Chacun de ses encaissements est du client — jamais sur une liste vide, ni sur des accès qui ne sont pas lus en entier. */
  parLeClient: boolean
  /** Ce que la garde opposerait à tout autre classement : les mots de « pourquoi rien d'autre ne s'offre ». */
  refus: RefusEncaissement<CleRefusGardeMouvements>
}

export type VentesDuReleve =
  // Le dossier n'a pas basculé : rien n'est lu de plus, rien ne change.
  | { etat: 'sans_objet' }
  // Basculé, la lecture n'est pas revenue — ou c'est celle d'un autre dossier.
  | { etat: 'en_cours' }
  // Basculé, lue en partie ou refusée.
  | { etat: 'incomplete'; motif: string }
  // Basculé, lue en entier : les mouvements classés ou réservés, par identifiant.
  | { etat: 'lue'; mouvements: ReadonlyMap<string, MouvementDeVente> }

const SANS_NUMERO = 'sans numéro'

function libelleDuMoyen(moyen: string): string {
  return MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen
}

/** Le mouvement, s'il est classé par ses encaissements ou réservé à eux ; null sinon. */
export function mouvementDeVente(
  m: MouvementClasse,
  sources: Pick<SourcesDuReleve, 'factures' | 'encaissements'>,
  acces: AccesDuDossier,
): MouvementDeVente | null {
  const refus = refusDuClassementDuReleve(m, sources.encaissements, sources)
  if (refus === null) return null
  const etat = refus.cle === 'classe_par_ses_encaissements' ? 'classe' : refus.cle === 'reserve' ? 'reserve' : null
  if (etat === null) return null
  const encaissements = encaissementsDuMouvement(m.id, sources.encaissements, sources).sort(ordreDesEncaissements)
    .map((e): EncaissementPorte => ({
      id: e.id,
      factureId: e.facture_id,
      numero: sources.factures.find((f) => f.id === e.facture_id)?.numero ?? SANS_NUMERO,
      date: e.date_encaissement,
      montant: e.montant,
      moyen: libelleDuMoyen(e.moyen),
      contrePassation: e.annule_id != null,
      parLeClient: estLeClient(acces, e.cree_par),
    }))
  return {
    id: m.id,
    etat,
    montant: m.montant,
    encaissements,
    factures: [...new Set(encaissements.map((e) => e.numero))],
    parLeClient: encaissements.length > 0 && encaissements.every((e) => e.parLeClient),
    refus,
  }
}

/**
 * Ce que l'onglet Banque sait des ventes facturées de son relevé. `ventesParLesFactures` : le réglage du dossier, sans
 * valeur par défaut ; `lecture` : nulle tant qu'elle n'est pas revenue ; `acces` : les accès du dossier, qui reconnaissent
 * le client. La lecture d'un autre dossier vaut une lecture pas encore revenue : rien ne s'en décide.
 */
export function ventesDuReleve(
  ventesParLesFactures: boolean,
  dossierId: string,
  lecture: LectureDesVentesDuReleve | null,
  acces: AccesDuDossier,
): VentesDuReleve {
  if (!ventesParLesFactures) return { etat: 'sans_objet' }
  if (lecture === null || lecture.dossierId !== dossierId) return { etat: 'en_cours' }
  if (lecture.etat === 'incomplete') return { etat: 'incomplete', motif: lecture.motif }
  if (lecture.sources.dossierId !== dossierId) return { etat: 'en_cours' }
  const mouvements = new Map<string, MouvementDeVente>()
  for (const m of lecture.sources.mouvements) {
    if (m.dossier_id !== dossierId) continue
    const vente = mouvementDeVente(m, lecture.sources, acces)
    if (vente) mouvements.set(m.id, vente)
  }
  return { etat: 'lue', mouvements }
}

/**
 * Ce qui retient tout geste et tout lot du relevé d'un dossier basculé : la lecture pas encore revenue, ou incomplète —
 * le motif, que les cartes des lots disent. Null : rien ne retient (lue, ou dossier qui n'a pas basculé).
 */
export function retenueDuReleve(v: VentesDuReleve): string | null {
  if (v.etat === 'en_cours') return 'les ventes facturées du dossier ne sont pas encore lues'
  if (v.etat === 'incomplete') return `les ventes facturées du dossier : ${v.motif}`
  return null
}

// ── Les lots du relevé (étape VF5a2) ──────────────────────────────────────────────────────────────────────────────────
//
// UN MOUVEMENT DES VENTES FACTURÉES N'ENTRE DANS AUCUN LOT. Classé par ses encaissements, il est déjà « rapproché » ;
// réservé, il reste « à traiter » en base (`statut = 'non_rapprochee'`), mais la garde G2 lui refuse tout autre
// classement : un lot qui le prendrait échouerait ENTIER (l'affectation par envois de cent, la règle d'ignorance en une
// seule mise à jour) ou ligne par ligne (le rapprochement automatique), sans jamais rien écrire de faux. Chaque plan reçoit
// donc ces mouvements en paramètre OBLIGATOIRE, les laisse de côté et les rend à part ; la carte du lot dit combien, et
// pourquoi — les mots de la garde, tels que `mouvementDeVente` les a tirés de `refusDuClassementDuReleve`.

/** Les mouvements qu'aucun lot ne prend : par identifiant, pourquoi — les mots de la garde G2. */
export type MouvementsHorsDesLots = ReadonlyMap<string, string>

/** Aucun : le relevé d'un dossier qui n'a pas basculé. */
export const AUCUN_HORS_DES_LOTS: MouvementsHorsDesLots = new Map()

/**
 * Les mouvements qu'aucun lot du relevé ne prend : classés par leurs encaissements ou réservés à eux, sur des ventes lues
 * EN ENTIER. Aucun sur un dossier qui n'a pas basculé. Sur des ventes pas encore revenues ou lues en partie, on ne sait
 * pas lesquels : la liste est vide, et c'est `retenueDuReleve` — non nulle EXACTEMENT dans ces deux cas — qui suspend
 * alors chaque lot ; aucun lot ne part jamais sur cette liste vide-là.
 */
export function mouvementsHorsDesLots(v: VentesDuReleve): MouvementsHorsDesLots {
  if (v.etat !== 'lue') return AUCUN_HORS_DES_LOTS
  return new Map([...v.mouvements.values()].map((m) => [m.id, m.refus.message]))
}

export interface MouvementEcarte<L> {
  ligne: L
  /** Les mots de la garde G2. */
  raison: string
}

export interface EcartDuLot<L> {
  /** Combien, en une phrase. */
  resume: string
  /** Chacun, dans l'ordre du plan, avec les mots de la garde. */
  mouvements: readonly MouvementEcarte<L>[]
}

/** Ce qu'une carte de lot dit des mouvements que son plan a écartés parce qu'ils portent des encaissements ; null : aucun. */
export function ecartDuLot<L extends { id: string }>(ecartes: readonly L[], hors: MouvementsHorsDesLots): EcartDuLot<L> | null {
  const mouvements = ecartes.flatMap((ligne) => {
    const raison = hors.get(ligne.id)
    return raison === undefined ? [] : [{ ligne, raison }]
  })
  if (mouvements.length === 0) return null
  const plusieurs = mouvements.length > 1
  const debut = `${mouvements.length} mouvement${plusieurs ? 's' : ''} écarté${plusieurs ? 's' : ''} : `
  // Ceux qu'un candidat de la vente justifie peut-être (étape VF5e) se disent autrement que ceux que leurs encaissements
  // portent : ils restent à rapprocher, depuis leur fiche.
  const candidats = mouvements.filter((m) => JUSTIFICATIFS_DE_LA_VENTE.has(m.raison)).length
  const portes = mouvements.length - candidats
  if (candidats === 0) return { resume: `${debut}${plusieurs ? 'ils portent' : 'il porte'} des encaissements de factures.`, mouvements }
  if (portes === 0) {
    return {
      resume: `${debut}une vente facturée ${plusieurs ? 'les' : 'le'} justifie peut-être — ${plusieurs ? 'ils restent' : 'il reste'} `
        + `à rapprocher depuis ${plusieurs ? 'leur' : 'sa'} fiche.`,
      mouvements,
    }
  }
  return {
    resume: `${debut}${portes} ${portes > 1 ? 'portent' : 'porte'} des encaissements de factures, ${candidats} `
      + `${candidats > 1 ? 'sont peut-être justifiés' : 'est peut-être justifié'} par une vente facturée, à rapprocher depuis `
      + `${candidats > 1 ? 'leur' : 'sa'} fiche.`,
    mouvements,
  }
}

// ── Les comptes du relevé (étape VF5a2) ───────────────────────────────────────────────────────────────────────────────
//
// UN MOUVEMENT RÉSERVÉ N'EST PAS « NON RAPPROCHÉ » : il n'attend pas de pièce, il attend que le cabinet le classe par ses
// encaissements (étape VF5c). Il ne disparaît pas pour autant des comptes : il s'y compte À PART, avec son total. Le
// compte ne se dit que de ventes lues en entier ; pas encore revenues ou lues en partie, le relevé compte ses mouvements
// non rapprochés comme hier, et dit que certains sont peut-être réservés. Un dossier qui n'a pas basculé ne change en rien.

export interface CompteDeMouvements {
  nombre: number
  total: number
}

export type ComptesDuReleve =
  | { etat: 'connus'; aRapprocher: CompteDeMouvements; reserves: CompteDeMouvements }
  | { etat: 'incertains'; nonRapproches: CompteDeMouvements }

// La somme dans l'ordre du relevé, comme l'écran la faisait : un dossier qui n'a pas basculé garde son total au flottant près.
function compter(lignes: readonly Pick<LigneBancaire, 'montant'>[]): CompteDeMouvements {
  return { nombre: lignes.length, total: lignes.reduce((s, l) => s + l.montant, 0) }
}

/** Les mouvements non rapprochés du relevé (`statut = 'non_rapprochee'`, lu en entier ou signalé), comptés. */
export function comptesDuReleve(
  nonRapprochees: readonly Pick<LigneBancaire, 'id' | 'montant'>[],
  v: VentesDuReleve,
): ComptesDuReleve {
  if (v.etat === 'en_cours' || v.etat === 'incomplete') return { etat: 'incertains', nonRapproches: compter(nonRapprochees) }
  const reserve = (l: Pick<LigneBancaire, 'id'>) => v.etat === 'lue' && v.mouvements.has(l.id)
  return {
    etat: 'connus',
    aRapprocher: compter(nonRapprochees.filter((l) => !reserve(l))),
    reserves: compter(nonRapprochees.filter(reserve)),
  }
}

/** La phrase des « Écarts à vérifier » ; celle d'hier quand aucun mouvement n'est réservé. */
export function texteDesNonRapproches(c: ComptesDuReleve): string {
  if (c.etat === 'incertains') {
    return `${c.nonRapproches.nombre} mouvement(s) bancaire(s) non rapproché(s) (${formatMoney(c.nonRapproches.total)}), dont `
      + 'peut-être des mouvements réservés à des encaissements de factures : les ventes facturées du dossier ne sont pas lues '
      + 'en entier'
  }
  const hier = `${c.aRapprocher.nombre} mouvement(s) bancaire(s) non rapproché(s) (${formatMoney(c.aRapprocher.total)})`
  if (c.reserves.nombre === 0) return hier
  return `${hier} · ${c.reserves.nombre} mouvement(s) réservé(s) à des encaissements de factures, à classer par eux `
    + `(${formatMoney(c.reserves.total)})`
}

// ── Les pastilles de la liste ─────────────────────────────────────────────────────────────────────────────────────────

export interface PastilleDeVente {
  texte: string
  /** « ok » : la pastille verte d'un mouvement classé ; « attention » : celle d'un mouvement réservé. */
  ton: 'ok' | 'attention'
  /** Ce que dit le survol de la mention « proposé par le client » ; nul sans elle. */
  titre: string | null
}

export const PASTILLE_CLASSE = 'Encaissements de factures'
export const PROPOSE_PAR_LE_CLIENT = `proposé ${PAR_LE_CLIENT}`

function enumeration(numeros: readonly string[]): string {
  return numeros.join(', ')
}

/** La pastille d'un mouvement classé ou réservé, dans la liste du relevé comme en tête de sa fiche. */
export function pastilleDeVente(m: MouvementDeVente): PastilleDeVente {
  if (m.etat === 'classe') {
    return { texte: m.factures.length > 0 ? `${PASTILLE_CLASSE} — ${enumeration(m.factures)}` : PASTILLE_CLASSE, ton: 'ok', titre: null }
  }
  const debit = m.montant < 0
  const plusieurs = m.factures.length > 1
  const objet = debit
    ? (plusieurs ? 'aux contre-passations des factures' : 'à la contre-passation de la facture')
    : (plusieurs ? 'aux encaissements des factures' : 'à l’encaissement de la facture')
  const texte = `Réservé ${objet} ${enumeration(m.factures)}${m.parLeClient ? ` — ${PROPOSE_PAR_LE_CLIENT}` : ''}`
  return {
    texte,
    ton: 'attention',
    titre: m.parLeClient ? (debit ? TITRES_PAR_LE_CLIENT.contrePassation : TITRES_PAR_LE_CLIENT.encaissement) : null,
  }
}

// ── La fiche d'un mouvement ───────────────────────────────────────────────────────────────────────────────────────────

export type VenteDuMouvement =
  // Rien de ce module : la fiche d'hier, entière.
  | { etat: 'libre' }
  // Classé ou réservé : la carte, et aucune section de classement.
  | { etat: 'porte'; mouvement: MouvementDeVente }
  // On ne sait pas — les ventes facturées ne sont pas lues en entier — ou il est classé sans qu'on lise ses encaissements :
  // la note, et aucune section de classement non plus.
  | { etat: 'retenu'; note: string }

/** Ce que la fiche d'un mouvement montre de ses ventes facturées. */
export function venteDuMouvement(v: VentesDuReleve, ligne: MouvementClasse): VenteDuMouvement {
  if (v.etat === 'lue') {
    const porte = v.mouvements.get(ligne.id)
    if (porte) return { etat: 'porte', mouvement: porte }
  }
  // Classé par ses encaissements, la ligne le dit d'elle-même : la garde le refuse à tout autre classement, quoi qu'on ait
  // lu de ses encaissements.
  const classe = ligne.encaissements_de_factures ? refusDuClassementDuReleve(ligne, [], { factures: [] }) : null
  if (v.etat === 'en_cours') {
    return {
      etat: 'retenu',
      note: `${classe ? `${classe.message} ` : ''}Les ventes facturées du dossier sont en cours de lecture : rien ne s’offre sur ce `
        + 'mouvement avant qu’elles soient revenues.',
    }
  }
  if (v.etat === 'incomplete') {
    return {
      etat: 'retenu',
      note: `${classe ? `${classe.message} ` : ''}Les ventes facturées du dossier n’ont pas pu être lues en entier (${v.motif}) : `
        + 'ce mouvement porte peut-être l’encaissement d’une facture, et rien ne s’offre. Recharge la page.',
    }
  }
  if (classe) return { etat: 'retenu', note: classe.message }
  return { etat: 'libre' }
}

export interface LigneDeLaCarte {
  cle: string
  /** La facture, le moyen et la date ; le montant à part, comme les parts d'un mouvement ventilé. */
  libelle: string
  montant: number
  /** La mention « par le client » et son survol, ou rien. */
  parLeClient: { libelle: string; titre: string } | null
}

export interface CarteDeVente {
  titre: string
  lignes: readonly LigneDeLaCarte[]
  /** Ce que les encaissements font ensemble, face au mouvement ; nul quand il n'y en a qu'un du montant du mouvement. */
  ensemble: string | null
  /** Pourquoi rien d'autre ne s'offre : les mots de la garde. */
  pourquoi: string
  /** Où la suite se passe. */
  suite: string
  /** Les accès du dossier lus en partie : personne n'est reconnu, et la carte le dit. */
  noteDesAuteurs: string | null
}

export const TITRE_CLASSE = 'Classé par ses encaissements de factures'
export const TITRE_RESERVE = 'Réservé à des encaissements de factures'

/** La carte qui, dans la fiche d'un mouvement classé ou réservé, dit ce qui le porte et pourquoi rien d'autre ne s'offre. */
export function carteDeVente(m: MouvementDeVente, acces: AccesDuDossier): CarteDeVente {
  const lignes = m.encaissements.map((e): LigneDeLaCarte => ({
    cle: e.id,
    libelle: `${e.contrePassation ? 'Contre-passation, facture' : 'Facture'} ${e.numero} — ${e.moyen.toLowerCase()} du ${formatDate(e.date)}`,
    montant: e.montant,
    parLeClient: e.parLeClient
      ? { libelle: PAR_LE_CLIENT, titre: e.contrePassation ? TITRES_PAR_LE_CLIENT.contrePassation : TITRES_PAR_LE_CLIENT.encaissement }
      : null,
  }))
  const total = m.encaissements.reduce((somme, e) => somme + Math.round(e.montant * 100), 0)
  const unSeulDuMontant = m.encaissements.length === 1 && total === Math.round(m.montant * 100)
  return {
    titre: m.etat === 'classe' ? TITRE_CLASSE : TITRE_RESERVE,
    lignes,
    ensemble: unSeulDuMontant ? null : `Ensemble : ${formatMoney(total / 100)} ; le mouvement : ${formatMoney(m.montant)}.`,
    pourquoi: m.refus.message,
    suite: m.etat === 'classe'
      ? 'Ses écritures se passent dans l’onglet Écritures, section « Ventes facturées ».'
      : 'Tant qu’il n’est pas classé par ses encaissements, leurs écritures attendent dans l’onglet Écritures, section '
        + '« Ventes facturées ».',
    noteDesAuteurs: acces.etat === 'incomplets'
      ? `Les accès du dossier n’ont pas été lus en entier (${acces.motif}) : on ne peut pas dire quels encaissements le `
        + 'client a enregistrés.'
      : null,
  }
}

// ── Les gestes du cabinet sur la fiche d'un crédit (étape VF5c) ───────────────────────────────────────────────────────
//
// LA FICHE D'UN CRÉDIT : « ENCAISSEMENT D'UNE FACTURE » (conception de VF5, § 5, puce VF5c). Côté cabinet, pour un dossier
// BASCULÉ dont les ventes facturées sont lues en entier, sur un CRÉDIT (les débits viennent avec VF5d) :
//   - RÉSERVÉ (un encaissement d'une facture source le cite et le justifie) : ses encaissements, leur total face au crédit
//     et l'écart des frais ; « Classer par ses encaissements » (`classer_mouvement_par_encaissements`), refusé avant le clic
//     par `refusClassement`, confirmé par une phrase qui nomme les factures, les montants et les frais portés au compte des
//     services bancaires du plan ;
//   - CLASSÉ par ses encaissements : « Retirer ce classement » (`retirer_classement_par_encaissements`, refusé avant le
//     clic par `refusRetraitDuClassement`) ; la confirmation dit que ses écritures deviennent « à retirer » dans l'onglet
//     Écritures ;
//   - LIBRE, ou réservé sans que ses encaissements fassent encore le crédit (une remise de chèques se rattache
//     encaissement par encaissement, et le classement attend) : les encaissements de factures sources enregistrés sans
//     mouvement, le plus proche de ce qui reste d'abord, chacun jugé par `refusRattachement`, avec ce que le mouvement
//     deviendrait après (`refusClassement` joué sur l'état d'après) ; et les factures sources qui restent à encaisser, la
//     plus proche d'abord, que la fenêtre des encaissements ouvre sur ce mouvement, IMPOSÉ.
// Rien ne s'offre sur des ventes facturées pas encore revenues, lues en partie, refusées ou d'un autre dossier (la retenue
// de VF5a1), ni, pour le complément, sur un mouvement qu'un exercice validé fige — son classement le dit par son refus.

/** Une facture du dossier telle que la fiche d'un crédit la nomme : son client, sa date, son TTC — de quoi ouvrir la fenêtre. */
export type FactureDesGestes = FactureDuDossier & Pick<FactureEmise, 'tiers_nom' | 'date_emission' | 'montant_ttc'>

/**
 * Ce que les gestes lisent : les ventes facturées du dossier, lues EN ENTIER par la lecture de l'onglet Écritures
 * (lib/ecrituresVentesFactureesLecture.ts) — les factures nommées, les lignes des factures sources et de leurs avoirs, le
 * registre et ses parts par taux (le reste d'une facture), les mouvements.
 */
export interface SourcesDesGestes extends SourcesDuReleve {
  factures: readonly FactureDesGestes[]
  lignes: readonly LigneDeFacture[]
  parts: readonly PartLue[]
}

export type LectureDesGestes =
  | { dossierId: string; etat: 'lue'; sources: SourcesDesGestes }
  | { dossierId: string; etat: 'incomplete'; motif: string }

export interface GesteConfirme {
  /** Ce que la base refuserait, sous ses mots : dit avant le clic, le bouton grisé. Nul : le geste s'offre. */
  refus: string | null
  /** La confirmation, qui NOMME ce que le geste fait. */
  confirmation: string
}

/** Un encaissement enregistré sans mouvement, qu'on rattacherait à ce crédit. */
export interface EncaissementARattacher extends GesteConfirme {
  id: string
  /** La facture, son client, le moyen et la date ; le montant à part. */
  libelle: string
  montant: number
  /** Le client de sa facture est cité au libellé du mouvement (`tiersConfirmeParBanque`, étape VF5e). */
  clientCite: boolean
}

/** Une facture source qui reste à encaisser, que la fenêtre des encaissements ouvrirait sur ce crédit. */
export interface FactureAEncaisser {
  facture: FactureDesGestes
  libelle: string
  resteCentimes: number
}

export interface ComplementDuCredit {
  /** Ce qui reste pour faire le crédit, en centimes : le crédit entier d'un mouvement libre. Toujours positif ici. */
  manqueCentimes: number
  /**
   * Les candidats de ses ventes facturées (étape VF5e, `candidatsDuMouvement`), proposés EN TÊTE de la fiche, le plus petit
   * écart d'abord : sur un crédit libre seulement — vide sur un crédit réservé, que ses encaissements portent déjà. Chacun
   * figure aussi dans `rattachables` ou `factures`, dont le geste est le sien.
   */
  proposes: readonly CandidatDeLaVente[]
  rattachables: readonly EncaissementARattacher[]
  factures: readonly FactureAEncaisser[]
  /** Ni l'un ni l'autre : ce que la fiche en dit. */
  note: string | null
}

export type GestesDuCredit =
  // Rien de neuf : un dossier qui n'a pas basculé, des ventes facturées qui ne sont pas lues en entier, un débit, un
  // mouvement classé autrement, ou un crédit libre que rien n'attend.
  | { etat: 'aucun' }
  | { etat: 'classe'; retrait: GesteConfirme }
  | { etat: 'reserve'; ensemble: string; classement: GesteConfirme; complement: ComplementDuCredit | null }
  | { etat: 'libre'; complement: ComplementDuCredit }

// Celui d'un crédit comme celui d'un débit (étape VF5d) : rien ne s'offre.
export const AUCUN_GESTE: Extract<GestesDuCredit, { etat: 'aucun' }> = { etat: 'aucun' }

export const TITRE_CLASSER = 'Classer par ses encaissements'
export const TITRE_RETIRER = 'Retirer ce classement'
export const TITRE_RATTACHER = 'Rattacher un encaissement enregistré sans mouvement'
export const TITRE_ENREGISTRER = 'Enregistrer l’encaissement d’une facture'
// La section des candidats de la vente, en tête de la fiche d'un crédit libre (étape VF5e).
export const TITRE_PROPOSES = 'Proposés par ses ventes facturées'

const enCentimes = (montant: number) => Math.round(montant * 100)
const euros = (centimes: number) => formatMoney(centimes / 100)

// Un texte comparé octet par octet, comme la base sous `collate "C"` : un départage qui ne dépend de rien.
function ordreC(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Ce qui reste pour faire ce crédit, en centimes : son montant, moins ce que portent les encaissements de factures sources
 * qui le citent et le justifient — ceux que le classement compte (`encaissementsDuMouvement`). Négatif quand ils le
 * dépassent (l'écart des frais).
 */
export function manqueDuCredit(
  mouvement: Pick<MouvementClasse, 'id' | 'montant'>,
  encaissements: readonly EncaissementLu[],
  vente: Pick<ContexteVente, 'factures'>,
): number {
  const portes = encaissementsDuMouvement(mouvement.id, encaissements, vente)
  return enCentimes(mouvement.montant) - portes.reduce((total, e) => total + enCentimes(e.montant), 0)
}

/**
 * Le montant que la fenêtre propose pour l'encaissement d'une facture sur un crédit IMPOSÉ, en centimes : tout le reste de
 * la facture quand ce qui reste du crédit le fait à l'écart des frais près (la banque crédite un peu moins) ; sinon le plus
 * petit des deux — une remise de chèques porte plusieurs factures, et une facture payée en plusieurs fois laisse un reste.
 * Le cabinet le corrige ; la base juge ce qui part.
 */
export function montantSurLeCredit(resteFactureCentimes: number, manqueCentimes: number): number {
  if (manqueCentimes <= 0) return resteFactureCentimes
  const ecart = resteFactureCentimes - manqueCentimes
  if (ecart >= 0 && ecartDeFrais(ecart, resteFactureCentimes)) return resteFactureCentimes
  return Math.min(resteFactureCentimes, manqueCentimes)
}

// Une contre-passation se dit telle, comme dans la carte de VF5a1 : un débit n'en porte pas d'autres (étape VF5d).
function libelleDeLEncaissement(e: EncaissementDuMouvementLu, factures: readonly FactureDesGestes[]): string {
  const f = factures.find((x) => x.id === e.facture_id)
  return `${e.annule_id != null ? 'Contre-passation, facture' : 'Facture'} ${f?.numero ?? SANS_NUMERO}${f ? ` (${f.tiers_nom})` : ''} — `
    + `${libelleDuMoyen(e.moyen).toLowerCase()} du ${formatDate(e.date_encaissement)}`
}

/**
 * Le mouvement tel que la fiche le reçoit de l'onglet : son identifiant, son dossier, et son libellé — celui où le client
 * d'une facture se lit (étape VF5e), la lecture des ventes facturées ne portant pas le libellé brut.
 */
export type LigneDesGestes = Pick<LigneBancaire, 'id' | 'dossier_id' | 'libelle' | 'libelle_brut'>

const leCredit = (m: Pick<MouvementClasse, 'date' | 'montant'>) => `ce crédit du ${formatDate(m.date)} de ${formatMoney(m.montant)}`

const DANS_LES_ECRITURES = 'l’onglet Écritures, section « Ventes facturées »'

// Ce que ses encaissements font face au crédit : ce qui reste à faire, l'égalité, les frais, ou un écart que des frais
// n'expliquent pas (le refus du classement le dit alors aussi, sous ses mots).
function phraseDeLEnsemble(totalCentimes: number, creditCentimes: number, compteDesFrais: string): string {
  const face = `Ses encaissements font ${euros(totalCentimes)} pour un crédit de ${euros(creditCentimes)}`
  const manque = creditCentimes - totalCentimes
  if (manque > 0) {
    return `${face} : il reste ${euros(manque)} à rattacher ou à enregistrer pour faire le crédit, et son classement attend `
      + 'qu’il soit fait.'
  }
  if (manque === 0) return `Ses encaissements font exactement le crédit, ${euros(creditCentimes)}.`
  return ecartDeFrais(-manque, totalCentimes)
    ? `${face} : l’écart, ${euros(-manque)}, est celui des frais bancaires, que ses écritures porteront au ${compteDesFrais}.`
    : `${face} : l’écart, ${euros(-manque)}, dépasse ce que des frais bancaires expliquent.`
}

function confirmationDuClassement(
  m: MouvementClasse, portes: readonly EncaissementDuMouvementLu[], factures: readonly FactureDesGestes[], compteDesFrais: string,
): string {
  const lignes = portes.map((e) => `— ${libelleDeLEncaissement(e, factures)} : ${formatMoney(e.montant)}`)
  const frais = portes.reduce((total, e) => total + enCentimes(e.montant), 0) - enCentimes(m.montant)
  return `Classer ${leCredit(m)} par ses encaissements ?\n\n${lignes.join('\n')}\n\n`
    + (frais > 0
      ? `Les frais bancaires, ${euros(frais)}, seront portés au ${compteDesFrais} par ses écritures.`
      : 'Aucun frais bancaire : ses encaissements font exactement le crédit.')
    + ` Il sera rapproché par eux, et ne recevra plus aucun autre classement ; ses écritures se passent ensuite dans ${DANS_LES_ECRITURES}.`
}

function confirmationDuRetrait(m: MouvementClasse, numeros: readonly string[]): string {
  const factures = numeros.length === 0 ? '' : ` (${numeros.length > 1 ? 'factures' : 'facture'} ${numeros.join(', ')})`
  return `Retirer le classement de ${leCredit(m)} par ses encaissements${factures} ?\n\n`
    + 'Il redevient à traiter, toujours réservé à ses encaissements : il ne reçoit aucun autre classement tant qu’ils le '
    + `citent. Ses écritures, s’il en a été passé, deviennent « à retirer » dans ${DANS_LES_ECRITURES} : elles se retirent `
    + 'là.'
}

// L'ÉTAT D'APRÈS un rattachement : le classement joué sur le registre où l'encaissement citerait ce mouvement.
function apresLeRattachement(
  dossierId: string, m: MouvementClasse, e: EncaissementDuMouvementLu, s: SourcesDesGestes, vente: ContexteVente,
): string {
  const apres = s.encaissements.map((x) => (x.id === e.id ? { ...x, ligne_bancaire_id: m.id } : x))
  const refus = refusClassement(dossierId, m.id, s.mouvements, apres, vente)
  if (refus === null) return 'Ses encaissements feront alors le crédit : il restera à le classer par eux.'
  if (refus.cle === 'credit_non_fait') {
    return `Il restera ${euros(manqueDuCredit(m, apres, vente))} pour faire le crédit : son classement attendra qu’il soit fait.`
  }
  return `Il ne pourra pas encore se classer par ses encaissements : « ${refus.message} »`
}

function complementDuCredit(
  dossierId: string, m: MouvementClasse, manque: number, s: SourcesDesGestes, vente: ContexteVente, libelle: string,
  proposes: readonly CandidatDeLaVente[],
): ComplementDuCredit {
  const sources = new Set(s.factures.filter((f) => f.dossier_id === dossierId && f.source_de_la_vente).map((f) => f.id))
  const cite = (e: EncaissementDuMouvementLu) => clientCite(e.facture_id, s.factures, libelle)
  // Des encaissements — pas des contre-passations, qui se justifient par un débit — de factures sources, sans mouvement, non
  // retirés, et que rien ne dit « n'avoir pas eu lieu » : une contre-passation sans mouvement qui les annule les ferait
  // rattacher sans qu'ils pèsent rien sur le crédit.
  const rattachables = s.encaissements
    .filter((e) => e.dossier_id === dossierId && e.ligne_bancaire_id == null && e.retire_le == null && e.annule_id == null
      && sources.has(e.facture_id) && justifieSonMouvement(e, s.encaissements))
    .sort((a, b) => Math.abs(enCentimes(a.montant) - manque) - Math.abs(enCentimes(b.montant) - manque)
      || Number(cite(b)) - Number(cite(a)) || ordreC(a.date_encaissement, b.date_encaissement) || ordreC(a.id, b.id))
    .map((e): EncaissementARattacher => {
      const libelle = libelleDeLEncaissement(e, s.factures)
      return {
        id: e.id,
        libelle,
        montant: e.montant,
        clientCite: cite(e),
        refus: refusRattachement(dossierId, e.id, m.id, s.encaissements, s.mouvements, vente)?.message ?? null,
        confirmation: `Rattacher à ${leCredit(m)} l’encaissement suivant ?\n\n— ${libelle} : ${formatMoney(e.montant)}\n\n`
          + 'Un encaissement ne se rattache qu’une fois : il citera ce mouvement, que la base réserve alors à ses '
          + `encaissements. ${apresLeRattachement(dossierId, m, e, s, vente)}`,
      }
    })
  const factures = s.factures
    .filter((f) => sources.has(f.id) && f.type === 'facture' && f.statut === 'validee')
    .map((f) => ({
      facture: f,
      resteCentimes: resteAEncaisserVente({ facture: f, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts }, vente)
        .resteCentimes,
    }))
    .filter((x) => x.resteCentimes > 0)
    .sort((a, b) => Math.abs(a.resteCentimes - manque) - Math.abs(b.resteCentimes - manque)
      || ordreC(a.facture.numero ?? '', b.facture.numero ?? '') || ordreC(a.facture.id, b.facture.id))
    .map((x): FactureAEncaisser => ({
      ...x,
      libelle: `${x.facture.numero ?? SANS_NUMERO} — ${x.facture.tiers_nom}, du ${formatDate(x.facture.date_emission)} — reste `
        + euros(x.resteCentimes),
    }))
  return {
    manqueCentimes: manque,
    proposes,
    rattachables,
    factures,
    note: rattachables.length === 0 && factures.length === 0
      ? 'Aucun encaissement de facture source n’attend son mouvement, et aucune facture source ne reste à encaisser : rien ne '
        + 'se rattache ni ne s’enregistre ici.'
      : null,
  }
}

// LA RETENUE DE VF5a1, commune aux fiches d'un crédit et d'un débit : des ventes facturées lues en entier — l'état du
// relevé ET la lecture, l'un et l'autre du dossier du mouvement —, et le mouvement tel que cette lecture l'a rendu,
// dans la même relecture que leur registre. Null : rien ne s'offre.
function mouvementDesGestes<S extends SourcesDesGestes>(
  ventes: VentesDuReleve,
  lecture: { dossierId: string; etat: 'lue'; sources: S } | { dossierId: string; etat: 'incomplete'; motif: string } | null,
  ligne: Pick<MouvementClasse, 'id' | 'dossier_id'>,
): { m: MouvementClasse; s: S } | null {
  if (ventes.etat !== 'lue' || lecture === null || lecture.etat !== 'lue') return null
  const dossierId = ligne.dossier_id
  const s = lecture.sources
  if (lecture.dossierId !== dossierId || s.dossierId !== dossierId) return null
  const m = s.mouvements.find((x) => x.id === ligne.id && x.dossier_id === dossierId)
  return m ? { m, s } : null
}

/**
 * Les gestes du cabinet sur la fiche d'un CRÉDIT d'un dossier basculé (étape VF5c). `ventes` : ce que l'onglet sait de son
 * relevé (`ventesDuReleve`) — rien ne s'offre s'il n'est pas lu en entier ; `lecture` : la même lecture des ventes
 * facturées, avec ce que les gestes lisent de plus ; `anneesValidees` : celles du dossier (la frontière) ; `plan` : le
 * compte des frais bancaires.
 */
export function gestesDuCredit(
  ventes: VentesDuReleve,
  lecture: LectureDesGestes | null,
  ligne: LigneDesGestes,
  anneesValidees: readonly number[],
  plan: Pick<PlanComptable, 'services_bancaires'>,
): GestesDuCredit {
  const lu = mouvementDesGestes(ventes, lecture, ligne)
  if (lu === null || lu.m.montant <= 0) return AUCUN_GESTE
  const { m, s } = lu
  const dossierId = ligne.dossier_id
  const vente: ContexteVente = { anneesValidees, factures: s.factures }
  const portes = encaissementsDuMouvement(m.id, s.encaissements, vente).sort(ordreDesEncaissements)
  if (m.encaissements_de_factures) {
    return {
      etat: 'classe',
      retrait: {
        refus: refusRetraitDuClassement(dossierId, m.id, s.mouvements, vente)?.message ?? null,
        confirmation: confirmationDuRetrait(m, [...new Set(portes.map((e) => s.factures.find((f) => f.id === e.facture_id)?.numero
          ?? SANS_NUMERO))]),
      },
    }
  }
  if (!mouvementLibre(m)) return AUCUN_GESTE
  const manque = manqueDuCredit(m, s.encaissements, vente)
  // Les candidats, sur un crédit libre seulement (`candidatsDuMouvement` le vérifie) : ceux de la même lecture.
  const proposes = portes.length === 0 ? candidatsDuMouvement(candidatsDeLaVente(ventes, lecture, anneesValidees), ligne) : []
  const complement = manque > 0 && dateFigee(m.date, anneesValidees) === null
    ? complementDuCredit(dossierId, m, manque, s, vente, libelleExploitable(ligne), proposes)
    : null
  if (portes.length === 0) return complement !== null && complement.note === null ? { etat: 'libre', complement } : AUCUN_GESTE
  return {
    etat: 'reserve',
    ensemble: phraseDeLEnsemble(enCentimes(m.montant) - manque, enCentimes(m.montant), plan.services_bancaires),
    classement: {
      refus: refusClassement(dossierId, m.id, s.mouvements, s.encaissements, vente)?.message ?? null,
      confirmation: confirmationDuClassement(m, portes, s.factures, plan.services_bancaires),
    },
    complement,
  }
}

// ── Les gestes du cabinet sur la fiche d'un débit (étape VF5d) ────────────────────────────────────────────────────────
//
// LA FICHE D'UN DÉBIT : L'IMPAYÉ ET LA SOMME RENDUE (conception de VF5, § 5, puce VF5d). Côté cabinet, pour un dossier
// BASCULÉ dont les ventes facturées sont lues en entier, sur un DÉBIT — le chèque revenu impayé, la somme rendue au
// client —, le miroir des gestes d'un crédit, par les mêmes fonctions de la base :
//   - RÉSERVÉ (une contre-passation d'une facture source le cite) : ses contre-passations, leur total face au débit et
//     l'écart des frais — la banque débite un peu PLUS que ce qu'elles défont, jamais moins : des contre-passations qui
//     dépassent le débit, fût-ce de quelques frais, la base ne les classe pas (`debit_depasse` ; conception de VF5,
//     § 8, point 4, à l'expert-comptable) ; « Classer par ses contre-passations »
//     (`classer_mouvement_par_encaissements`, refusé avant le clic par `refusClassement`) ;
//   - CLASSÉ par ses contre-passations : « Retirer ce classement » (`retirer_classement_par_encaissements`) ;
//   - LIBRE, ou réservé sans que ses contre-passations fassent encore le débit (deux chèques revenus impayés
//     ensemble) : les contre-passations de factures sources enregistrées sans mouvement que `refusRattachement` accepte
//     sur ce débit (`rattacher_mouvement_encaissement`) ; et les encaissements que `refusContrePassationVente` accepte
//     de contre-passer en citant ce débit, à sa date — des encaissements de factures sources, DÉCLARÉS, ou, depuis
//     l'étape VF5d2 (migration impaye_non_declare), jamais déclarés : citer le débit est ce qui fait contre-passer ces
//     derniers, et ni eux ni leur contre-passation ne se déclarent ; chaque candidat le dit (`declaration`). Pour
//     ceux-là, la fenêtre des encaissements s'ouvre sur la facture, ce débit IMPOSÉ à la contre-passation et sa date
//     proposée : c'est elle qui porte la date, le motif et leurs refus, et qui écrit, par `annuler_encaissement` seule.
// Chaque candidat est choisi par le jugement du module qui redit la fonction de la base, jamais par une règle recopiée
// ici. Les mêmes retenues que sur un crédit : rien sur des ventes facturées qui ne sont pas lues en entier, ni, pour le
// complément, sur un débit qu'un exercice validé fige.

/**
 * Ce que les gestes d'un débit lisent de plus que ceux d'un crédit : les déclarations des encaissements du dossier
 * (lib/ventesDuReleveLecture.ts), lues en entier avec le reste — un encaissement déclaré se contre-passe, une déclaration
 * d'issue inconnue retient la contre-passation, et celle d'un encaissement jamais déclaré ne se déclare pas.
 */
export interface SourcesDuDebit extends SourcesDesGestes {
  declarations: readonly Pick<DeclarationLue, 'encaissement_id' | 'etat'>[]
}

export type LectureDuDebit =
  | { dossierId: string; etat: 'lue'; sources: SourcesDuDebit }
  | { dossierId: string; etat: 'incomplete'; motif: string }

/** Un encaissement que la fenêtre des encaissements contre-passerait en citant ce débit. */
export interface EncaissementAContrePasser {
  id: string
  /** Sa facture, telle que la lecture l'a rendue : de quoi ouvrir la fenêtre. */
  facture: FactureDesGestes
  /** La facture, son client, le moyen et la date ; le montant à part. */
  libelle: string
  montant: number
  /** Ce que le débit deviendrait, la contre-passation enregistrée. */
  apres: string
  /** Ce que devient sa déclaration : déclaré, sa contre-passation se déclare à son tour ; jamais déclaré, ni l'un ni l'autre. */
  declaration: string
  /** Le client de sa facture est cité au libellé du débit (`tiersConfirmeParBanque`, étape VF5e). */
  clientCite: boolean
}

/** Ce qu'un encaissement à contre-passer dit de sa déclaration, selon qu'il a été déclaré ou non (étape VF5d2). */
export const DECLARATION_DU_CANDIDAT = {
  declare: 'Déclaré : sa contre-passation se déclare ensuite à son tour, sur la plateforme de sa déclaration.',
  jamaisDeclare: 'Jamais déclaré : ni lui ni sa contre-passation ne se déclarent — l’argent est venu, puis reparti, avant '
    + 'que rien n’en soit dit.',
} as const

export interface ComplementDuDebit {
  /** Ce qui reste pour faire le débit, en centimes, en valeur absolue : le débit entier d'un mouvement libre. Positif ici. */
  manqueCentimes: number
  /** Toutes acceptées par `refusRattachement` : leur `refus` est nul. */
  rattachables: readonly EncaissementARattacher[]
  aContrePasser: readonly EncaissementAContrePasser[]
  /** Ni l'un ni l'autre : ce que la fiche en dit. */
  note: string | null
}

export type GestesDuDebit =
  // Rien de neuf : un dossier qui n'a pas basculé, des ventes facturées qui ne sont pas lues en entier, un crédit, un
  // mouvement classé autrement, ou un débit libre que rien n'attend — une dépense, l'immense majorité.
  | { etat: 'aucun' }
  | { etat: 'classe'; retrait: GesteConfirme }
  | { etat: 'reserve'; ensemble: string; classement: GesteConfirme; complement: ComplementDuDebit | null }
  | { etat: 'libre'; complement: ComplementDuDebit }

export const TITRE_CLASSER_DEBIT = 'Classer par ses contre-passations'
export const TITRE_RATTACHER_CONTRE_PASSATION = 'Rattacher une contre-passation enregistrée sans mouvement'
export const TITRE_CONTRE_PASSER = 'Contre-passer l’encaissement d’une facture'

// Le motif que la fenêtre fera saisir : `annuler_encaissement` le juge APRÈS la frontière et AVANT le débit cité — les
// candidats se jugent donc avec un motif, pour que le débit le soit aussi. La fenêtre exige le vrai.
const LE_MOTIF_DE_LA_FENETRE = '(le motif, saisi dans la fenêtre)'
// L'identifiant de la contre-passation que la fenêtre écrirait : un nom qu'aucun identifiant de la base (un UUID) ne
// porte.
const LA_CONTRE_PASSATION = '(la contre-passation)'

/**
 * Ce qui reste pour faire ce débit, en centimes, en valeur absolue : son montant, moins ce que défont les
 * contre-passations de factures sources qui le citent — celles que le classement compte (`encaissementsDuMouvement`).
 * Négatif quand elles le dépassent ; positif de quelques frais quand la banque a débité un peu plus.
 */
export function manqueDuDebit(
  mouvement: Pick<MouvementClasse, 'id' | 'montant'>,
  encaissements: readonly EncaissementLu[],
  vente: Pick<ContexteVente, 'factures'>,
): number {
  const portes = encaissementsDuMouvement(mouvement.id, encaissements, vente)
  return portes.reduce((total, e) => total + enCentimes(e.montant), 0) - enCentimes(mouvement.montant)
}

const leDebit = (m: Pick<MouvementClasse, 'date' | 'montant'>) => `ce débit du ${formatDate(m.date)} de ${formatMoney(m.montant)}`

// Ce que ses contre-passations font face au débit, en valeur absolue : l'égalité, des contre-passations qui le
// dépassent (le refus du classement le dit aussi, sous ses mots), les frais (la banque débite un peu plus), ou ce qui
// reste à faire.
function phraseDuDebit(totalCentimes: number, debitCentimes: number, compteDesFrais: string): string {
  const face = `Ses contre-passations font ${euros(totalCentimes)} pour un débit de ${euros(debitCentimes)}`
  const manque = debitCentimes - totalCentimes
  if (manque === 0) return `Ses contre-passations font exactement le débit, ${euros(debitCentimes)}.`
  if (manque < 0) {
    return `${face} : elles le dépassent de ${euros(-manque)}. La base ne classe un débit que si ses contre-passations le `
      + 'font, ou qu’il les dépasse de quelques frais — jamais l’inverse.'
  }
  return ecartDeFrais(manque, totalCentimes)
    ? `${face} : l’écart, ${euros(manque)}, est celui des frais bancaires, que ses écritures porteront au ${compteDesFrais}.`
    : `${face} : il reste ${euros(manque)} à rattacher ou à contre-passer pour faire le débit, et son classement attend `
      + 'qu’il soit fait.'
}

function confirmationDuClassementDuDebit(
  m: MouvementClasse, portes: readonly EncaissementDuMouvementLu[], factures: readonly FactureDesGestes[], compteDesFrais: string,
): string {
  const lignes = portes.map((e) => `— ${libelleDeLEncaissement(e, factures)} : ${formatMoney(e.montant)}`)
  const frais = portes.reduce((total, e) => total + enCentimes(e.montant), 0) - enCentimes(m.montant)
  return `Classer ${leDebit(m)} par ses contre-passations ?\n\n${lignes.join('\n')}\n\n`
    + (frais > 0
      ? `Les frais bancaires, ${euros(frais)}, seront portés au ${compteDesFrais} par ses écritures.`
      : 'Aucun frais bancaire : ses contre-passations font exactement le débit.')
    + ` Il sera rapproché par elles, et ne recevra plus aucun autre classement ; ses écritures se passent ensuite dans ${DANS_LES_ECRITURES}.`
}

function confirmationDuRetraitDuDebit(m: MouvementClasse, numeros: readonly string[]): string {
  const factures = numeros.length === 0 ? '' : ` (${numeros.length > 1 ? 'factures' : 'facture'} ${numeros.join(', ')})`
  return `Retirer le classement de ${leDebit(m)} par ses contre-passations${factures} ?\n\n`
    + 'Il redevient à traiter, toujours réservé à ses contre-passations : il ne reçoit aucun autre classement tant qu’elles '
    + `le citent. Ses écritures, s’il en a été passé, deviennent « à retirer » dans ${DANS_LES_ECRITURES} : elles se retirent `
    + 'là.'
}

// L'ÉTAT D'APRÈS un geste sur le débit — une contre-passation rattachée, ou écrite par la fenêtre — : le classement
// joué sur le registre où elle citerait ce débit. Des contre-passations qui ne le font pas encore laissent un reste
// (`debit_ecart`) ; qui le dépassent, ou tout autre refus, il ne se classera pas tel quel.
function apresSurLeDebit(
  dossierId: string, m: MouvementClasse, apres: readonly EncaissementLu[], s: SourcesDuDebit, vente: ContexteVente,
): string {
  const refus = refusClassement(dossierId, m.id, s.mouvements, apres, vente)
  if (refus === null) return 'Ses contre-passations feront alors le débit : il restera à le classer par elles.'
  if (refus.cle === 'debit_ecart') {
    return `Il restera ${euros(manqueDuDebit(m, apres, vente))} pour faire le débit : son classement attendra qu’il soit fait.`
  }
  return `Il ne pourra pas se classer par ses contre-passations : « ${refus.message} »`
}

// Ce que le rattachement d'une contre-passation fait à l'encaissement qu'elle annule : sans mouvement, elle disait
// qu'il n'avait pas eu lieu sur le crédit qu'il cite ; rattachée à son débit, elle dit que l'argent est venu, puis
// reparti — et l'encaissement justifie de nouveau ce crédit (`justifieSonMouvement`).
function effetSurLOrigine(e: EncaissementDuMouvementLu, s: SourcesDuDebit): string {
  const origine = s.encaissements.find((x) => x.id === e.annule_id)
  if (origine?.ligne_bancaire_id == null) return ''
  const credit = s.mouvements.find((x) => x.id === origine.ligne_bancaire_id)
  return ` L’encaissement qu’elle annule justifie alors de nouveau ${credit ? `le crédit du ${formatDate(credit.date)}` : 'le mouvement'} `
    + 'qu’il cite : l’argent est venu, puis reparti par ce débit.'
}

function complementDuDebit(
  dossierId: string, m: MouvementClasse, manque: number, s: SourcesDuDebit, vente: ContexteVente, aujourdHui: string,
  libelleDuDebit: string,
): ComplementDuDebit {
  // Le plus petit écart d'abord, puis — l'ordre des candidats d'un crédit (étape VF5e) — le client cité au libellé du débit,
  // puis la date et l'identifiant. Un impayé ne se devine pas : la liste reste entière, l'ordre et la mention seuls changent.
  const cite = (e: EncaissementDuMouvementLu) => clientCite(e.facture_id, s.factures, libelleDuDebit)
  const proche = (a: EncaissementDuMouvementLu, b: EncaissementDuMouvementLu) =>
    Math.abs(Math.abs(enCentimes(a.montant)) - manque) - Math.abs(Math.abs(enCentimes(b.montant)) - manque)
    || Number(cite(b)) - Number(cite(a)) || ordreC(a.date_encaissement, b.date_encaissement) || ordreC(a.id, b.id)
  // Les contre-passations sans mouvement que la base rattacherait à ce débit : son jugement seul les choisit — un
  // encaissement (un crédit), une contre-passation retirée, déjà rattachée, d'une facture qui n'est pas source ou d'un
  // autre dossier, ou qui dépasserait le débit au-delà des frais, il le refuse.
  const rattachables = s.encaissements
    .filter((e) => refusRattachement(dossierId, e.id, m.id, s.encaissements, s.mouvements, vente) === null)
    .sort(proche)
    .map((e): EncaissementARattacher => {
      const libelle = libelleDeLEncaissement(e, s.factures)
      const apres = s.encaissements.map((x) => (x.id === e.id ? { ...x, ligne_bancaire_id: m.id } : x))
      return {
        id: e.id,
        libelle,
        montant: e.montant,
        clientCite: cite(e),
        refus: null,
        confirmation: `Rattacher à ${leDebit(m)} la contre-passation suivante ?\n\n— ${libelle} : ${formatMoney(e.montant)}\n\n`
          + 'Une contre-passation ne se rattache qu’une fois : elle citera ce débit, que la base réserve alors à ses '
          + `contre-passations.${effetSurLOrigine(e, s)} ${apresSurLeDebit(dossierId, m, apres, s, vente)}`,
      }
    })
  // Les encaissements que la base contre-passerait en citant ce débit, à sa date : son jugement seul les choisit — un
  // encaissement retiré, déjà contre-passé, d'une facture qui n'est pas source, d'issue de déclaration inconnue,
  // postérieur au débit, ou que le débit ne ferait pas à l'écart des frais près, il le refuse. Jamais déclaré, celui d'une
  // facture source se contre-passe en citant ce débit (étape VF5d2) : il est candidat, et le dit. Le cabinet porte le
  // droit « Banque ».
  const declares = encaissementsDeclares(s.declarations)
  const aContrePasser = s.encaissements
    .filter((e) => refusContrePassationVente(
      dossierId, e.id, s.encaissements, s.declarations, m.date, LE_MOTIF_DE_LA_FENETRE, aujourdHui, m.id, s.mouvements, true, vente,
    ) === null)
    .sort(proche)
    .flatMap((e): EncaissementAContrePasser[] => {
      const facture = s.factures.find((f) => f.id === e.facture_id)
      if (!facture) return []
      const apres: EncaissementLu[] = [...s.encaissements, {
        id: LA_CONTRE_PASSATION, dossier_id: dossierId, facture_id: e.facture_id, montant: -e.montant, ligne_bancaire_id: m.id,
        annule_id: e.id, retire_le: null,
      }]
      return [{
        id: e.id, facture, libelle: libelleDeLEncaissement(e, s.factures), montant: e.montant,
        apres: apresSurLeDebit(dossierId, m, apres, s, vente),
        declaration: declares.has(e.id) ? DECLARATION_DU_CANDIDAT.declare : DECLARATION_DU_CANDIDAT.jamaisDeclare,
        clientCite: cite(e),
      }]
    })
  return {
    manqueCentimes: manque,
    rattachables,
    aContrePasser,
    note: rattachables.length === 0 && aContrePasser.length === 0
      ? 'Aucune contre-passation de facture source n’attend son mouvement, et aucun encaissement de facture source ne se '
        + 'contre-passe sur ce débit : rien ne se rattache ni ne se contre-passe ici.'
      : null,
  }
}

/**
 * Les gestes du cabinet sur la fiche d'un DÉBIT d'un dossier basculé (étape VF5d), comme `gestesDuCredit` ; `lecture`
 * porte en plus les déclarations des encaissements, et `aujourdHui` — le jour à Paris, que la base lit — borne la date
 * d'une contre-passation.
 */
export function gestesDuDebit(
  ventes: VentesDuReleve,
  lecture: LectureDuDebit | null,
  ligne: LigneDesGestes,
  anneesValidees: readonly number[],
  plan: Pick<PlanComptable, 'services_bancaires'>,
  aujourdHui: string,
): GestesDuDebit {
  const lu = mouvementDesGestes(ventes, lecture, ligne)
  if (lu === null || lu.m.montant >= 0) return AUCUN_GESTE
  const { m, s } = lu
  const dossierId = ligne.dossier_id
  const vente: ContexteVente = { anneesValidees, factures: s.factures }
  const portes = encaissementsDuMouvement(m.id, s.encaissements, vente).sort(ordreDesEncaissements)
  if (m.encaissements_de_factures) {
    return {
      etat: 'classe',
      retrait: {
        refus: refusRetraitDuClassement(dossierId, m.id, s.mouvements, vente)?.message ?? null,
        confirmation: confirmationDuRetraitDuDebit(m, [...new Set(portes.map((e) => s.factures.find((f) => f.id === e.facture_id)?.numero
          ?? SANS_NUMERO))]),
      },
    }
  }
  if (!mouvementLibre(m)) return AUCUN_GESTE
  const manque = manqueDuDebit(m, s.encaissements, vente)
  const refus = refusClassement(dossierId, m.id, s.mouvements, s.encaissements, vente)
  // Le complément, tant que le classement dit le débit PAS ENCORE FAIT : rien ne le cite (`aucun_encaissement`), ou ses
  // contre-passations ne le font pas aux frais près (`debit_ecart`). Fait aux frais près, il se classe ; dépassé, une
  // contre-passation de plus n'y changerait rien ; figé, le classement oppose d'abord la frontière, et rien ne s'offre.
  const complement = refus?.cle === 'aucun_encaissement' || refus?.cle === 'debit_ecart'
    ? complementDuDebit(dossierId, m, manque, s, vente, aujourdHui, libelleExploitable(ligne))
    : null
  if (portes.length === 0) return complement !== null && complement.note === null ? { etat: 'libre', complement } : AUCUN_GESTE
  return {
    etat: 'reserve',
    ensemble: phraseDuDebit(enCentimes(-m.montant) - manque, enCentimes(-m.montant), plan.services_bancaires),
    classement: { refus: refus?.message ?? null, confirmation: confirmationDuClassementDuDebit(m, portes, s.factures, plan.services_bancaires) },
    complement,
  }
}

// ── Les candidats du relevé (étape VF5e) ──────────────────────────────────────────────────────────────────────────────────
//
// CE QUE LES VENTES FACTURÉES PROPOSENT POUR UN MOUVEMENT LIBRE (conception de VF5, § 5, puce VF5e). Sur un dossier BASCULÉ
// dont les ventes facturées sont lues en entier, un mouvement libre — que rien ne classe, qu'aucun encaissement ne réserve,
// qu'aucun exercice validé ne fige — peut être celui qu'une vente attend :
//   - un CRÉDIT : une facture source OUVERTE (validée, dont le reste net de ses avoirs est positif, `resteAEncaisserVente`) ;
//     un ENCAISSEMENT d'une facture source enregistré sans mouvement (le chèque saisi avant sa remise, l'encaissement d'un
//     client sans « Banque ») ;
//   - un DÉBIT : une CONTRE-PASSATION d'une facture source enregistrée sans mouvement (le chèque revenu impayé saisi depuis
//     la facture). Rien de plus pour un débit : un impayé ne se devine pas.
// UN CANDIDAT N'EST PROPOSÉ QUE SI LA BASE L'ACCEPTERAIT, par le jugement du module qui la redit, jamais par une règle
// recopiée : un encaissement ou une contre-passation, par `refusRattachement` sur ce mouvement ; une facture, par
// `refusRattachement` d'un encaissement FICTIF de cette facture, daté du mouvement, du montant que la fenêtre proposerait
// (`montantSurLeCredit`) — ce sont les refus du mouvement cité d'`enregistrer_encaissement` pour une facture source (la
// frontière du rang 11, le rang 10, le rang 17), et la fenêtre, qui lit en plus les transmissions de la facture, rejuge
// tout avant l'envoi. Puis il doit être DÉSIGNÉ :
//   - par son MONTANT : le mouvement se classerait alors par ses encaissements — `refusClassement` joué sur l'état d'après,
//     la facture encaissée de tout son reste —, c'est-à-dire à l'écart des frais près (`min(2 %, 5 €)`, « LA BANQUE FAIT
//     FOI ») : la banque crédite un peu moins que l'encaissement, ou débite un peu plus que la contre-passation ;
//   - ou par son CLIENT, cité au libellé du mouvement (`tiersConfirmeParBanque`, le signal des pièces) — un paiement en
//     deux fois échappe au montant, pas au nom.
// L'ORDRE : le plus petit écart au mouvement d'abord, puis un encaissement avant une facture (il est déjà saisi), le
// client cité, la date et l'identifiant, octet par octet.
//
// RIEN NE S'ÉCRIT SEUL. Un candidat dit au lot des règles que le mouvement a peut-être son justificatif
// (`justificatifDeLaVente`, lu par `justificatifPossible`) : le lot le met « à rapprocher » ; il écarte le mouvement des
// trois autres lots (`horsDesLotsAvecLesCandidats`) ; la fiche d'un crédit le propose en tête, et c'est le clic, puis la
// confirmation, qui rattache ou ouvre la fenêtre. VIDES sur des ventes pas encore revenues, lues en partie, refusées ou
// d'un autre dossier — et alors aucun lot ne part (`retenueDuReleve`, VF5a1) — comme sur un dossier qui n'a pas basculé.

/** Ce qu'un candidat dit au lot des règles et à la fiche, dans les mots de la conception. */
export const JUSTIFICATIF_FACTURE = 'Une facture de l’application attend son encaissement : ce crédit la règle peut-être.'
export const JUSTIFICATIF_ENCAISSEMENT = 'Un encaissement enregistré attend son mouvement.'
export const JUSTIFICATIF_CONTRE_PASSATION = 'Une contre-passation enregistrée attend son mouvement.'
const JUSTIFICATIFS_DE_LA_VENTE: ReadonlySet<string> = new Set([
  JUSTIFICATIF_FACTURE, JUSTIFICATIF_ENCAISSEMENT, JUSTIFICATIF_CONTRE_PASSATION,
])

/** Une facture source ouverte : son reste net de ses avoirs validés, positif, en centimes. */
export interface FactureSourceOuverte {
  facture: FactureDesGestes
  resteCentimes: number
}

/**
 * De quoi juger chaque candidat sur un mouvement : la lecture des ventes facturées, lue en entier, et la frontière ; les
 * mouvements et les factures du dossier par identifiant, et les mots de chaque client — lus une fois pour tout le relevé,
 * que `horsDesLotsAvecLesCandidats` parcourt mouvement par mouvement.
 */
interface JugeDesCandidats {
  dossierId: string
  sources: SourcesDesGestes
  vente: ContexteVente
  anneesValidees: readonly number[]
  mouvementsParId: ReadonlyMap<string, MouvementClasse>
  facturesParId: ReadonlyMap<string, FactureDesGestes>
  motsDesClients: ReadonlyMap<string, readonly string[]>
}

/**
 * Les candidats de la vente d'un dossier : les deux listes de la puce VF5e — les factures sources ouvertes, les
 * encaissements (contre-passations comprises) de factures sources enregistrés sans mouvement — et la lecture qui les
 * juge sur chaque mouvement. Sans elle : aucun candidat (`AUCUN_CANDIDAT`).
 */
export interface CandidatsDeLaVente {
  facturesSourcesOuvertes: readonly FactureSourceOuverte[]
  encaissementsSansMouvement: readonly EncaissementDuMouvementLu[]
  juge: JugeDesCandidats | null
}

/** Aucun : un dossier qui n'a pas basculé, ou des ventes facturées qui ne sont pas lues en entier. */
export const AUCUN_CANDIDAT: CandidatsDeLaVente = { facturesSourcesOuvertes: [], encaissementsSansMouvement: [], juge: null }

/**
 * Les candidats de la vente, tirés de la lecture même des gestes (la retenue de VF5a1 : l'état du relevé ET la lecture,
 * lus en entier, du même dossier). `anneesValidees` : celles du dossier — un mouvement qu'elles figent n'a pas de candidat.
 */
export function candidatsDeLaVente(
  ventes: VentesDuReleve,
  lecture: LectureDesGestes | null,
  anneesValidees: readonly number[],
): CandidatsDeLaVente {
  if (ventes.etat !== 'lue' || lecture === null || lecture.etat !== 'lue') return AUCUN_CANDIDAT
  const s = lecture.sources
  if (lecture.dossierId !== s.dossierId) return AUCUN_CANDIDAT
  const dossierId = s.dossierId
  const vente: ContexteVente = { anneesValidees, factures: s.factures }
  const sources = new Set(s.factures.filter((f) => f.dossier_id === dossierId && f.source_de_la_vente).map((f) => f.id))
  return {
    facturesSourcesOuvertes: s.factures
      .filter((f) => sources.has(f.id) && f.type === 'facture' && f.statut === 'validee')
      .map((facture) => ({
        facture,
        resteCentimes: resteAEncaisserVente({ facture, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts }, vente)
          .resteCentimes,
      }))
      .filter((x) => x.resteCentimes > 0),
    encaissementsSansMouvement: encaissementsEnregistresSansMouvement(s),
    juge: {
      dossierId, sources: s, vente, anneesValidees,
      mouvementsParId: new Map(s.mouvements.filter((m) => m.dossier_id === dossierId).map((m) => [m.id, m])),
      facturesParId: new Map(s.factures.map((f) => [f.id, f])),
      motsDesClients: new Map(s.factures.filter((f) => sources.has(f.id)).map((f) => [f.id, motsIdentifiants(f.tiers_nom)])),
    },
  }
}

/**
 * Les encaissements (contre-passations comprises) de factures sources du dossier enregistrés sans mouvement — comme les
 * rattachables de VF5c : non retirés, de factures sources, et que rien ne dit « n'avoir pas eu lieu ». La liste des
 * candidats, et celle que la Vue d'ensemble compte (étape VF5f, lib/ventesDeLaChecklist.ts) : une seule règle pour les deux.
 */
export function encaissementsEnregistresSansMouvement(
  s: Pick<SourcesDuReleve, 'dossierId' | 'factures' | 'encaissements'>,
): EncaissementDuMouvementLu[] {
  const sources = new Set(s.factures.filter((f) => f.dossier_id === s.dossierId && f.source_de_la_vente).map((f) => f.id))
  return s.encaissements.filter((e) => e.dossier_id === s.dossierId && e.ligne_bancaire_id == null
    && e.retire_le == null && sources.has(e.facture_id) && justifieSonMouvement(e, s.encaissements))
}

/** Ce qu'un candidat porterait sur le mouvement, et ce qui le désigne. */
export interface CandidatDeLaVente {
  genre: 'encaissement' | 'facture' | 'contre_passation'
  /** L'encaissement (ou la contre-passation) à rattacher ; ou la facture, dont la fenêtre enregistrerait l'encaissement. */
  id: string
  facture: FactureDesGestes
  /** La facture, son client, le moyen et la date — ou le reste d'une facture. */
  libelle: string
  /** Le montant de l'encaissement, ou le reste de la facture, en centimes, en valeur absolue. */
  montantCentimes: number
  /** L'écart entre ce montant et le mouvement, en centimes, en valeur absolue. */
  ecartCentimes: number
  /** Le mouvement se classerait alors, à l'écart des frais près. */
  parLeMontant: boolean
  /** Le client de la facture est cité au libellé du mouvement. */
  parLeClient: boolean
  /** Ce qui le désigne : le montant, le client — une phrase chacun, la fiche les dit comme les signaux d'une pièce. */
  signaux: readonly string[]
  /** Ce qu'il porterait sur le mouvement, en une phrase : ce que la fiche nomme avant le geste. */
  titre: string
}

// L'identifiant de l'encaissement qu'une facture candidate recevrait : un nom qu'aucun identifiant de la base (un UUID) ne
// porte.
const L_ENCAISSEMENT_CANDIDAT = '(l’encaissement candidat)'

function clientCite(factureId: string, factures: readonly FactureDesGestes[], libelle: string): boolean {
  const f = factures.find((x) => x.id === factureId)
  return f != null && tiersConfirmeParBanque(f.tiers_nom, libelle)
}

/** Les phrases des deux signaux d'un candidat. */
export const SIGNAL_MONTANT_CREDIT = 'Le montant : le crédit la solde, à l’écart des frais près.'
export const SIGNAL_MONTANT_DEBIT = 'Le montant : elle ferait ce débit, à l’écart des frais près.'
export const signalDuClient = (client: string) => `Le client, ${client}, est cité au libellé du mouvement.`

function signauxDuCandidat(parLeMontant: boolean, parLeClient: boolean, credit: boolean, client: string): string[] {
  return [
    parLeMontant ? (credit ? SIGNAL_MONTANT_CREDIT : SIGNAL_MONTANT_DEBIT) : null,
    parLeClient ? signalDuClient(client) : null,
  ].filter((x): x is string => x !== null)
}

const TITRES_DES_CANDIDATS = {
  encaissement: 'Encaissement enregistré sans mouvement',
  facture: 'Facture à encaisser',
  contre_passation: 'Contre-passation enregistrée sans mouvement',
} as const

/**
 * Les candidats de la vente pour CE mouvement, le plus petit écart d'abord ; vide sur un mouvement qui n'est pas libre, que
 * des encaissements réservent, qu'un exercice validé fige, que la lecture n'a pas rendu, d'un autre dossier, ou sans
 * candidat. `ligne` : le mouvement tel que l'onglet le lit — son libellé, où le client se lit.
 */
export function candidatsDuMouvement(c: CandidatsDeLaVente, ligne: LigneDesGestes): CandidatDeLaVente[] {
  const j = c.juge
  if (j === null || ligne.dossier_id !== j.dossierId) return []
  const { dossierId, sources: s, vente } = j
  const m = j.mouvementsParId.get(ligne.id)
  if (!m || m.montant === 0 || !mouvementLibre(m) || encaissementsDuMouvement(m.id, s.encaissements, vente).length > 0) return []
  if (dateFigee(m.date, j.anneesValidees) !== null) return []
  const credit = m.montant > 0
  const motsBanque = motsDuLibelle(libelleExploitable(ligne))
  const mouvementCentimes = Math.abs(enCentimes(m.montant))
  const candidats: { candidat: CandidatDeLaVente; date: string }[] = []
  // CE QUI PEUT DÉSIGNER UN CANDIDAT, AVANT TOUT JUGEMENT : son client cité au libellé (`tiersConfirmeParBanque`, en deux
  // moitiés), ou un écart au mouvement que les frais peuvent couvrir — `ecartDeFrais` n'en admet jamais plus de
  // `SEUIL_PLAFOND_CENTIMES`. Ni l'un ni l'autre : il ne serait pas proposé, et les jugements de la base, qui parcourent le
  // relevé entier, ne se jouent pas pour rien — sur 3 000 mouvements libres et 50 factures ouvertes, ils prenaient plus de
  // six secondes à chaque relecture du relevé. Un filtre, jamais une règle : le montant ne désigne qu'au verdict de
  // `refusClassement`. Null : rien ne peut le désigner.
  const designable = (facture: FactureDesGestes, montantCentimes: number): { parLeClient: boolean } | null => {
    const parLeClient = motsSeConfirment(j.motsDesClients.get(facture.id) ?? motsIdentifiants(facture.tiers_nom), motsBanque)
    return parLeClient || Math.abs(montantCentimes - mouvementCentimes) <= SEUIL_PLAFOND_CENTIMES ? { parLeClient } : null
  }
  const ajouter = (
    genre: CandidatDeLaVente['genre'], id: string, facture: FactureDesGestes, texte: string, montantCentimes: number,
    parLeMontant: boolean, parLeClient: boolean, date: string,
  ) => {
    if (!parLeMontant && !parLeClient) return
    candidats.push({
      candidat: {
        genre, id, facture, libelle: texte, montantCentimes, ecartCentimes: Math.abs(montantCentimes - mouvementCentimes),
        parLeMontant, parLeClient, signaux: signauxDuCandidat(parLeMontant, parLeClient, credit, facture.tiers_nom),
        titre: TITRES_DES_CANDIDATS[genre],
      },
      date,
    })
  }
  for (const e of c.encaissementsSansMouvement) {
    // Un crédit attend un encaissement, un débit une contre-passation.
    if ((e.annule_id == null) !== credit) continue
    const facture = j.facturesParId.get(e.facture_id)
    if (!facture) continue
    const montantCentimes = Math.abs(enCentimes(e.montant))
    const designe = designable(facture, montantCentimes)
    if (designe === null || refusRattachement(dossierId, e.id, m.id, s.encaissements, s.mouvements, vente) !== null) continue
    const apres = s.encaissements.map((x) => (x.id === e.id ? { ...x, ligne_bancaire_id: m.id } : x))
    ajouter(credit ? 'encaissement' : 'contre_passation', e.id, facture, libelleDeLEncaissement(e, s.factures), montantCentimes,
      refusClassement(dossierId, m.id, s.mouvements, apres, vente) === null, designe.parLeClient, e.date_encaissement)
  }
  if (credit) {
    for (const o of c.facturesSourcesOuvertes) {
      const designe = designable(o.facture, o.resteCentimes)
      if (designe === null) continue
      const fictif = (montantCentimes: number, ligneBancaireId: string | null): EncaissementDuMouvementLu => ({
        id: L_ENCAISSEMENT_CANDIDAT, dossier_id: dossierId, facture_id: o.facture.id, montant: montantCentimes / 100,
        ligne_bancaire_id: ligneBancaireId, annule_id: null, retire_le: null, date_encaissement: m.date, moyen: 'virement',
        cree_le: m.date, cree_par: null,
      })
      // La base l'accepterait-elle sur ce crédit, du montant que la fenêtre proposerait ?
      const propose = fictif(montantSurLeCredit(o.resteCentimes, mouvementCentimes), null)
      if (refusRattachement(dossierId, propose.id, m.id, [...s.encaissements, propose], s.mouvements, vente) !== null) continue
      // Et le crédit la solderait-il, à l'écart des frais près ?
      const solde = refusClassement(dossierId, m.id, s.mouvements, [...s.encaissements, fictif(o.resteCentimes, m.id)], vente) === null
      ajouter('facture', o.facture.id, o.facture,
        `${o.facture.numero ?? SANS_NUMERO} — ${o.facture.tiers_nom}, du ${formatDate(o.facture.date_emission)} — reste `
          + euros(o.resteCentimes),
        o.resteCentimes, solde, designe.parLeClient, o.facture.date_emission)
    }
  }
  return candidats
    .sort((a, b) => a.candidat.ecartCentimes - b.candidat.ecartCentimes
      || Number(a.candidat.genre === 'facture') - Number(b.candidat.genre === 'facture')
      || Number(b.candidat.parLeClient) - Number(a.candidat.parLeClient)
      || ordreC(a.date, b.date) || ordreC(a.candidat.id, b.candidat.id))
    .map((x) => x.candidat)
}

/**
 * Ce que les candidats de la vente disent d'un mouvement au lot des règles et à la fiche (`justificatifPossible`) : un
 * encaissement — ou, à défaut, une facture — qui le justifie peut-être, sur un crédit ; une contre-passation qui le ferait
 * aux frais près, sur un débit — le client seul ne désigne pas un impayé. Null : rien.
 */
export function justificatifDeLaVente(c: CandidatsDeLaVente, ligne: LigneDesGestes): string | null {
  const candidats = candidatsDuMouvement(c, ligne)
  if (candidats.some((x) => x.genre === 'encaissement')) return JUSTIFICATIF_ENCAISSEMENT
  if (candidats.some((x) => x.genre === 'facture')) return JUSTIFICATIF_FACTURE
  if (candidats.some((x) => x.genre === 'contre_passation' && x.parLeMontant)) return JUSTIFICATIF_CONTRE_PASSATION
  return null
}

/**
 * LE DOUBLE COMPTE DU RELEVÉ : les mouvements que ni le rapprochement automatique, ni « Valider et rapprocher », ni la
 * règle d'ignorance ne prennent. Ceux qu'aucun lot ne prend déjà (classés ou réservés, sous les mots de la garde), ET ceux
 * qu'un candidat de la vente justifie peut-être, sous sa phrase : rapprochés d'une pièce ou ignorés, ils ne pourraient plus
 * être cités par l'encaissement qui les attend. Le lot des règles reçoit les seuls premiers, et met les seconds « à
 * rapprocher » par `justificatifPossible`. Aucun mouvement de plus n'entre dans un lot.
 */
export function horsDesLotsAvecLesCandidats(
  hors: MouvementsHorsDesLots,
  c: CandidatsDeLaVente,
  lignes: readonly LigneDesGestes[],
): MouvementsHorsDesLots {
  if (c.juge === null) return hors
  const avec = new Map(hors)
  for (const l of lignes) {
    if (avec.has(l.id)) continue
    const raison = justificatifDeLaVente(c, l)
    if (raison !== null) avec.set(l.id, raison)
  }
  return avec
}
