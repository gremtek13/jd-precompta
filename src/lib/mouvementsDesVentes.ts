import { estLeClient, PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import {
  encaissementsDuMouvement, MOYENS_ENCAISSEMENT, ordreDesEncaissements, refusDuClassementDuReleve,
  type CleRefusGardeMouvements, type EncaissementDuReleve, type FactureDuDossier, type MouvementClasse, type RefusEncaissement,
} from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import type { EncaissementFacture, LigneBancaire } from './types'

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
// Les gestes (classer, retirer un classement, rattacher) viennent avec l'étape VF5c. Ce module ne les offre pas.

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
  return {
    resume: `${mouvements.length} mouvement${plusieurs ? 's' : ''} écarté${plusieurs ? 's' : ''} : `
      + `${plusieurs ? 'ils portent' : 'il porte'} des encaissements de factures.`,
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
