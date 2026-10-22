import { estLeClient, PAR_LE_CLIENT, TITRES_PAR_LE_CLIENT, type AccesDuDossier } from './auteursVentes'
import {
  encaissementsDuMouvement, MOYENS_ENCAISSEMENT, ordreDesEncaissements, refusDuClassementDuReleve,
  type CleRefusGardeMouvements, type EncaissementDuReleve, type FactureDuDossier, type MouvementClasse, type RefusEncaissement,
} from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import type { EncaissementFacture } from './types'

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
// Les gestes (classer, retirer un classement, rattacher) viennent avec l'étape VF5c ; les lots qui écartent un mouvement
// réservé avec VF5a2. Ce module ne les offre pas.

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
