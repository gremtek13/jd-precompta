import {
  argumentsChoisirCompteContrepartie, argumentsEcrireVenteFacturee, argumentsRetirerEcritureVenteFacturee,
  ecrituresDeLaSource, identifiantDeLaSource, lignesDeLaSource, refusChoixCompteContrepartie, refusEcritureVenteFacturee,
  refusRetraitEcritureVenteFacturee, type ArgumentsEcrireVenteFacturee, type CleRefusCompteContrepartie, type ContexteEcritureVente,
  type LigneDuBrouillon, type MouvementPourEcriture,
} from './ecritureVenteFacturee'
import {
  ecrituresDesVentesFacturees, memeEcritureQueLeBrouillon, type EcrituresDesVentesFacturees, type EcritureVenteFacturee,
  type MotifNonEcrite, type MouvementDesEncaissements, type SourceEcritureVente,
} from './ecrituresVentesFacturees'
import type { EcrituresDesVentesDeLa2035 } from './declaration2035'
import {
  MOYENS_ENCAISSEMENT, mouvementLibre, type ExemplaireLu, type LigneDeFacture, type RefusEncaissement,
} from './encaissementsFactures'
import { formatDate, formatMoney } from './format'
import type { PlanComptable } from './planComptable'
import type { EcritureBrouillon, EncaissementFacture, FactureEmise, ModeComptable } from './types'
import { estFigee, frontiereDeValidation } from './validationExercice'
import { LIBELLE_MOTIF_VENTE, type EncaissementVendu, type FactureVendue, type PartVendue } from './ventesFacturees'

// L'ONGLET ÉCRITURES ÉCRIT LES VENTES FACTURÉES (ligne 28.6, chantier EC-Q3, étape VF4c1 ; conception : HISTORIQUE.md,
// « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 7, 11 et 14 ; « LES ÉCRITURES D'UNE VENTE FACTURÉE, EN
// MODULE » et « EN BASE », leurs « À REVOIR » R1 et R3). Un module PUR — il ne lit rien en base, n'appelle personne, ne
// lit pas l'horloge — qui, pour un dossier qui a basculé, rend l'ÉTAT de chaque source d'une vente facturée (une facture,
// un avoir, un encaissement — contre-passation comprise —, un mouvement que ses encaissements classent) en confrontant ce
// que la composition de VF4a écrit après la frontière de la validation (`ecrituresDeLaSource`) aux lignes du brouillon qui
// appartiennent à la source (`lignesDeLaSource`) ; et, pour chaque geste qu'il offre, le refus que la base rendrait, par
// les fonctions de lib/ecritureVenteFacturee.ts — jamais une règle recopiée ici.
//
// LES ÉTATS, et la règle de chacun (P : les lignes PROPOSÉES de la source ; V : ses lignes validées ; E : ce que la
// composition écrit après la frontière) :
//   - « à écrire » : E n'est pas vide, P l'est — rien n'est encore au brouillon (une part validée peut l'être : une source
//     à cheval sur la frontière ne réécrit que sa part ouverte) ;
//   - « à jour » : P est exactement E, date par date (`memeEcritureQueLeBrouillon` : comptes, sens, centimes, mouvement,
//     date et source ; le libellé n'en décide pas) ;
//   - « à réécrire » : P n'est plus E — une écriture proposée PÉRIMÉE (R3 : un compte de contrepartie remplacé, un
//     encaissement daté avant d'autres, un avoir, une contre-passation qui change la recomposition) ;
//   - « à retirer » : P n'est pas vide alors que E l'est — la source n'a plus rien à écrire (R3 : un encaissement retiré,
//     aussi par le client « Ventes » ; un mouvement déclassé ; une facture que la composition écarte désormais) ;
//   - « validée » : ni E ni P — ce qu'un exercice validé fige : ses écritures validées, ou une source datée d'un exercice
//     validé qui n'en a aucune (un manque que la validation refusera à l'étape VF7, et que l'écran DIT) ;
//   - « ne s'écrit pas » : la composition ne sait pas l'écrire (`nonEcrites`) ou le module des ventes facturées écarte sa
//     facture — le motif et ses mots : le compte de contrepartie à choisir ou refusé, un mouvement pas encore classé, un
//     écart hors du seuil des frais, une facture qui ne se compte pas sans deviner.
// Une source dont rien ne s'écrit, ni n'est écrit, ni n'est à dire (une facture de services en trésorerie : ses
// encaissements l'écrivent) n'est pas listée.
//
// LES GESTES : « Écrire » (à écrire) et « Réécrire » (à réécrire) passent `ecrire_vente_facturee`, avec la composition
// telle quelle (`argumentsEcrireVenteFacturee`) — la base la recompose et refuse ce qui diffère ; « Retirer » (à retirer)
// passe `retirer_ecriture_vente_facturee`. Le compte de contrepartie d'un encaissement par compensation, ou « autre »,
// sans mouvement se choisit là où la source dit « compte à choisir » ou « refusé » (`choisir_compte_contrepartie`) ; déjà
// choisi et accepté, il se CHANGE par la même fonction (VF4C1-Q1, étape VF4c3), tant que l'exercice de l'encaissement n'est
// pas validé — une écriture déjà passée sur l'ancien devient « à réécrire ». Chaque
// refus se lit AVANT le clic : `refusEcritureVenteFacturee`, `refusRetraitEcritureVenteFacturee`,
// `refusChoixCompteContrepartie`.
//
// LES LIGNES QUE CE MODULE PREND EN CHARGE (`ligneDUneVenteFacturee`) : celles qui portent une facture ou un encaissement
// (seule la fonction de VF4b remplit ces colonnes), et celles, sans aucune autre source, d'un mouvement que ses
// encaissements classent — le troisième genre de la garde G5. Les contrôles d'hier de l'onglet ne les jugent pas : une
// écriture d'une vente facturée n'a ni pièce, ni catégorie, et sa justification est sa facture.

// ── Ce que le module lit ──────────────────────────────────────────────────────────────────────────────────────────────

/** Une facture ou un avoir du dossier, source ou non : ce que la composition, les refus et la confirmation lisent. */
export type FactureDesEcritures = FactureVendue & Pick<FactureEmise, 'montant_ttc'>

/**
 * Un encaissement du registre, retirés et contre-passations compris, avec son compte de contrepartie — et son auteur
 * (`cree_par`), que l'onglet Banque reconnaît parmi les accès du dossier (étape VF5a1, lib/mouvementsDesVentes.ts).
 */
export type EncaissementDesEcritures = EncaissementVendu & Pick<EncaissementFacture, 'compte_contrepartie' | 'cree_par'>

/** Un mouvement du dossier : ce que la composition en lit, et ce qui le classe, que les refus jugent. */
export type MouvementDesEcritures = MouvementDesEncaissements & MouvementPourEcriture

/** Ce que la lecture rend, EN ENTIER (lib/ecrituresVentesFactureesLecture.ts). */
export interface SourcesDesEcrituresDeVente {
  dossierId: string
  factures: readonly FactureDesEcritures[]
  lignes: readonly LigneDeFacture[]
  encaissements: readonly EncaissementDesEcritures[]
  parts: readonly PartVendue[]
  mouvements: readonly MouvementDesEcritures[]
  /** Les pièces désignées du dossier (`pieces.facture_id`, étape VF1) : le virement mixte s'écrit et se classe avec
   *  l'exemplaire unique et validé de sa facture d'avant (étape VF5h). */
  exemplaires: readonly ExemplaireLu[]
}

/** Une ligne du brouillon telle que ce module la confronte : la source, et ce que `memeEcritureQueLeBrouillon` compare. */
export type LigneDuBrouillonLue = LigneDuBrouillon & Pick<EcritureBrouillon, 'id' | 'date' | 'compte' | 'montant' | 'sens'>

export interface EntreesEcrituresDeVente {
  sources: SourcesDesEcrituresDeVente
  /** Le brouillon ENTIER du dossier. */
  brouillon: readonly LigneDuBrouillonLue[]
  /** Le modèle comptable du dossier, sans valeur par défaut. */
  mode: ModeComptable
  plan: PlanComptable
  anneesValidees: readonly number[]
  /** Le réglage du dossier (`dossiers.ventes_par_les_factures`). */
  ventesParLesFactures: boolean
}

// ── Ce que le module rend ─────────────────────────────────────────────────────────────────────────────────────────────

export type EtatSourceDeVente = 'a_ecrire' | 'a_jour' | 'a_reecrire' | 'a_retirer' | 'validee' | 'ne_s_ecrit_pas'

export const LIBELLE_ETAT_SOURCE: Readonly<Record<EtatSourceDeVente, string>> = {
  a_ecrire: 'à écrire',
  a_jour: 'à jour',
  a_reecrire: 'à réécrire',
  a_retirer: 'à retirer',
  validee: 'validée',
  ne_s_ecrit_pas: 'ne s’écrit pas',
}

/** Pourquoi la composition n'écrit rien pour une source : un motif de VF4a, ou la facture que le module écarte. */
export type MotifSansEcriture = MotifNonEcrite

export type GesteDeVente = 'ecrire' | 'reecrire' | 'retirer'

export const LIBELLE_GESTE: Readonly<Record<GesteDeVente, string>> = { ecrire: 'Écrire', reecrire: 'Réécrire', retirer: 'Retirer' }

export interface ChoixDuCompte {
  encaissementId: string
  /**
   * « choisir » : le compte est à choisir, ou celui qu'il porte est refusé. « changer » (VF4C1-Q1, étape VF4c3) : il porte un
   * compte accepté, que le cabinet remplace, tant que l'exercice de l'encaissement n'est pas validé.
   */
  geste: 'choisir' | 'changer'
  /** Le compte que l'encaissement porte aujourd'hui — refusé pour « choisir », accepté pour « changer » ; nul quand il est à choisir. */
  actuel: string | null
  /** Ce que la source devient une fois le compte choisi : « à écrire », ou « à réécrire » si elle porte des lignes. */
  apresLeChoix: Extract<EtatSourceDeVente, 'a_ecrire' | 'a_reecrire'>
}

export interface SourceDeVenteEtat {
  /** `genre|identifiant` : la clé de la ligne à l'écran, et celle de son verrou. */
  cle: string
  source: SourceEcritureVente
  etat: EtatSourceDeVente
  /** Le nom de la source, en clair : ce que la confirmation et la ligne de l'écran disent. */
  nom: string
  /** La date de la source : l'émission d'une facture, l'encaissement, le mouvement. */
  date: string
  /** En euros : le TTC d'une facture (négatif pour un avoir), le montant d'un encaissement ou d'un mouvement. */
  montant: number
  /** Pourquoi rien ne s'écrit, pour « ne s'écrit pas » et « à retirer » ; nul sinon. */
  motif: MotifSansEcriture | null
  /** Ce que l'écran dit de l'état, en une phrase. */
  detail: string
  /** Ce que la composition écrit après la frontière : ce que « Écrire » et « Réécrire » envoient. */
  aEcrire: EcritureVenteFacturee[]
  /** Les lignes proposées de la source : ce que « Réécrire » remplace et « Retirer » retire. */
  proposees: LigneDuBrouillonLue[]
  /** Le nombre de ses lignes validées : elles ne se réécrivent ni ne se retirent plus. */
  validees: number
  /** Le geste offert, ou aucun. */
  geste: GesteDeVente | null
  /** Ce que la base refuserait de ce geste, sous ses mots ; nul quand elle l'accepterait. */
  refus: string | null
  /** Le choix du compte de contrepartie, quand la source le demande. */
  choixDuCompte: ChoixDuCompte | null
}

export type EtatsDesVentes =
  | { etat: 'lus'; dossierId: string; sources: SourceDeVenteEtat[]; contexte: ContexteEcritureVente }
  /** Les lectures ne se tiennent pas entre elles : une ligne du brouillon cite ce que la lecture n'a pas rendu. Aucun geste. */
  | { etat: 'incoherent'; dossierId: string; motif: string }

// ── Les lignes d'une vente facturée ───────────────────────────────────────────────────────────────────────────────────

/** Les mouvements du relevé que leurs encaissements classent (G1) : leurs lignes sans autre source sont du troisième genre. */
export function mouvementsClassesParEncaissements(
  lignes: readonly { id: string; encaissements_de_factures: boolean }[],
): Set<string> {
  return new Set(lignes.filter((l) => l.encaissements_de_factures).map((l) => l.id))
}

/**
 * Une ligne du brouillon est-elle d'une vente facturée ? Elle porte une facture ou un encaissement, ou elle est, sans
 * pièce ni aucune autre source, une ligne d'un des mouvements donnés — ceux que leurs encaissements classent, et ceux
 * que ce module liste comme sources (un mouvement déclassé qui garde ses lignes, R3).
 */
export function ligneDUneVenteFacturee(
  e: Pick<EcritureBrouillon, 'piece_id' | 'ligne_bancaire_id' | 'facture_id' | 'encaissement_id' | 'immobilisation_id'
    | 'vehicule_id' | 'declaration_tva_id' | 'cotisation_id'>,
  mouvementsDesVentes: ReadonlySet<string>,
): boolean {
  if (e.facture_id != null || e.encaissement_id != null) return true
  return e.ligne_bancaire_id != null && mouvementsDesVentes.has(e.ligne_bancaire_id) && e.piece_id == null
    && e.immobilisation_id == null && e.vehicule_id == null && e.declaration_tva_id == null && e.cotisation_id == null
}

// ── Les noms et les phrases ───────────────────────────────────────────────────────────────────────────────────────────

const ORDRE_DES_GENRES: Record<SourceEcritureVente['genre'], number> = { facture: 0, avoir: 1, encaissement: 2, mouvement: 3 }

export const cleDeLaSource = (s: SourceEcritureVente) => `${s.genre}|${identifiantDeLaSource(s)}`

const libelleDuMoyen = (moyen: EncaissementFacture['moyen']) =>
  (MOYENS_ENCAISSEMENT.find((m) => m.moyen === moyen)?.libelle ?? moyen).toLowerCase()

const numeroDe = (f: Pick<FactureEmise, 'numero' | 'id'> | undefined, id: string) => f?.numero ?? id.slice(0, 8)

/** Les lignes d'une écriture, en clair : « le 10/11/2025 : 411000 au débit 120,00 € ; 706000 au crédit 100,00 € ». */
export function ecrituresEnClair(ecritures: readonly EcritureVenteFacturee[]): string {
  return ecritures.map((e) => `le ${formatDate(e.date)} : ${e.lignes
    .map((l) => `${l.compte} au ${l.sens === 'debit' ? 'débit' : 'crédit'} ${formatMoney(l.centimes / 100)}`).join(' ; ')}`)
    .join(' — ')
}

/** La confirmation d'un geste : elle NOMME la source et dit ce que le geste écrit, remplace ou retire. */
export function confirmationDuGeste(s: SourceDeVenteEtat): string {
  const validees = s.validees > 0
    ? ` ${s.validees === 1 ? 'Sa ligne validée reste' : `Ses ${s.validees} lignes validées restent`} : un exercice validé ne se rouvre pas.`
    : ''
  const nbProposees = `${s.proposees.length} ligne${s.proposees.length > 1 ? 's' : ''} proposée${s.proposees.length > 1 ? 's' : ''}`
  if (s.geste === 'retirer') {
    return `Retirer du brouillon les ${nbProposees} de ${s.nom} ? ${s.detail}${validees}`
  }
  const verbe = s.geste === 'reecrire' ? `Réécrire ${s.nom} ? Ses ${nbProposees} sont remplacées par` : `Écrire ${s.nom} au brouillon :`
  return `${verbe} ${ecrituresEnClair(s.aEcrire)}. La base recompose l’écriture et la refuse si elle diffère.${validees}`
}

/**
 * La confirmation du choix d'un compte de contrepartie : le compte, l'encaissement, et ce que le choix change. Pour un
 * CHANGEMENT (VF4C1-Q1), elle nomme aussi l'ancien compte, et dit ce que devient une écriture déjà passée.
 */
export function confirmationDuChoix(s: SourceDeVenteEtat, compte: string): string {
  const choix = s.choixDuCompte
  if (choix?.geste === 'changer') {
    const suite = choix.apresLeChoix === 'a_reecrire'
      ? `Son écriture déjà passée, sur le ${choix.actuel}, deviendra « à réécrire » : elle se réécrit ensuite d’ici, sur un clic.`
      : 'Aucune écriture n’est encore passée : il reste « à écrire ».'
    return `Changer le compte de contrepartie de ${s.nom}, du ${choix.actuel} au ${compte} ? ${suite}`
  }
  const suite = choix?.apresLeChoix === 'a_reecrire'
    ? 'Ses écritures proposées, sur l’ancien compte, seront « à réécrire ».'
    : 'Il sera « à écrire » : son écriture se passe ensuite d’ici, sur un clic.'
  return `Choisir le compte ${compte} comme contrepartie de ${s.nom} ? ${suite}`
}

/**
 * Le compte saisi est-il celui que l'encaissement porte déjà ? Changer pour le même compte ne changerait rien : l'écran ne
 * l'envoie pas. Ce n'est pas un refus de la base, qui l'accepterait.
 */
export function choixInchange(choix: ChoixDuCompte, saisie: string): boolean {
  return choix.geste === 'changer' && compteSaisi(saisie) === choix.actuel
}

// ── La composition des sources lues ───────────────────────────────────────────────────────────────────────────────────

export const MOTIF_NE_SE_COMPOSENT_PAS =
  'les ventes facturées lues ne se composent pas : une part, un encaissement ou une facture manque à l’autre'

/**
 * LA COMPOSITION DE VF4a SUR LES SOURCES LUES EN ENTIER, avec le compte de contrepartie que chaque encaissement porte : la
 * même pour la section « Ventes facturées », la liquidation de la TVA et la 2035 (les frais d'un mouvement d'encaissements).
 * « incohérente » quand les lectures ne se tiennent pas — la composition suppose qu'une part a son encaissement.
 */
export function compositionDesSources(
  sources: SourcesDesEcrituresDeVente, mode: ModeComptable, plan: PlanComptable,
): { etat: 'composee'; composition: EcrituresDesVentesFacturees } | { etat: 'incoherent'; motif: string } {
  try {
    return {
      etat: 'composee',
      composition: ecrituresDesVentesFacturees({
        sources: {
          dossierId: sources.dossierId, factures: sources.factures, lignes: sources.lignes, encaissements: sources.encaissements,
          parts: sources.parts,
        },
        mouvements: sources.mouvements,
        comptesDeContrepartie: new Map(sources.encaissements
          .filter((e) => e.compte_contrepartie != null).map((e) => [e.id, e.compte_contrepartie as string])),
        exemplaires: sources.exemplaires,
        mode, plan,
      }),
    }
  } catch {
    // Défensif : la composition suppose des lectures qui se tiennent (une part sans son encaissement, par exemple).
    return { etat: 'incoherent', motif: MOTIF_NE_SE_COMPOSENT_PAS }
  }
}

/**
 * CE QUE LA 2035 D'UN DOSSIER REÇOIT DE SES ÉCRITURES DE VENTES FACTURÉES (VF4C3-Q1 ; lib/declaration2035.ts,
 * `EcrituresDesVentesDeLa2035`), ou pourquoi elle ne se calcule pas. Un dossier qui n'a pas basculé : `sans_bascule` —
 * sauf si ses ventes facturées comptent une facture source, que la base interdit : les lectures ne se tiennent pas.
 * Basculé : la composition des sources lues EN ENTIER pour CE dossier ; pas encore revenues pour lui, « en attente » ;
 * partielles, refusées ou qui ne se composent pas, « incomplète » avec le motif. Pur : l'appelant lit, ceci juge.
 */
export function ecrituresDesVentesPourLa2035(entrees: {
  dossierId: string
  /** Le réglage du dossier (`dossiers.ventes_par_les_factures`). */
  ventesParLesFactures: boolean
  /** Les factures sources que les ventes facturées lues comptent (`VentesFacturees.sources`). */
  facturesSources: ReadonlySet<string>
  /** La lecture des sources (lib/ecrituresVentesFactureesLecture.ts), nulle tant qu'elle n'est pas revenue ou pas faite. */
  lecture: { dossierId: string; etat: 'lue'; sources: SourcesDesEcrituresDeVente } | { dossierId: string; etat: 'incomplete'; motif: string } | null
  mode: ModeComptable
  plan: PlanComptable
}):
  | { etat: 'pret'; ecritures: EcrituresDesVentesDeLa2035 }
  | { etat: 'en_attente' }
  | { etat: 'incomplete'; motif: string } {
  if (!entrees.ventesParLesFactures) {
    return entrees.facturesSources.size === 0 ? { etat: 'pret', ecritures: { etat: 'sans_bascule' } }
      : { etat: 'incomplete', motif: 'les ventes facturées comptent une facture source alors que le dossier ne se dit pas basculé : les lectures ne se tiennent pas' }
  }
  const { lecture } = entrees
  // Une lecture faite pour un autre dossier ne vaut jamais : celle de CE dossier n'est pas encore revenue.
  if (lecture === null || lecture.dossierId !== entrees.dossierId) return { etat: 'en_attente' }
  if (lecture.etat === 'incomplete') return { etat: 'incomplete', motif: lecture.motif }
  if (lecture.sources.dossierId !== entrees.dossierId) return { etat: 'incomplete', motif: 'la lecture rendue est celle d’un autre dossier' }
  const composee = compositionDesSources(lecture.sources, entrees.mode, entrees.plan)
  if (composee.etat === 'incoherent') return { etat: 'incomplete', motif: composee.motif }
  return { etat: 'pret', ecritures: { etat: 'composees', composition: composee.composition } }
}

// ── Les états ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function nomDeLaSource(
  source: SourceEcritureVente, factures: ReadonlyMap<string, FactureDesEcritures>,
  encaissements: ReadonlyMap<string, EncaissementDesEcritures>, mouvements: ReadonlyMap<string, MouvementDesEcritures>,
): { nom: string; date: string; montant: number } {
  if (source.genre === 'facture' || source.genre === 'avoir') {
    const f = factures.get(source.factureId)!
    return {
      nom: `${source.genre === 'facture' ? 'la facture' : 'l’avoir'} ${numeroDe(f, f.id)} (${f.tiers_nom})`,
      date: f.date_emission, montant: f.montant_ttc,
    }
  }
  if (source.genre === 'encaissement') {
    const e = encaissements.get(source.encaissementId)!
    const f = factures.get(e.facture_id)
    const quoi = e.annule_id == null ? 'l’encaissement' : 'la contre-passation'
    return {
      nom: `${quoi} du ${formatDate(e.date_encaissement)} de la facture ${numeroDe(f, e.facture_id)} (${f?.tiers_nom ?? 'client inconnu'}, ${libelleDuMoyen(e.moyen)}, ${formatMoney(e.montant)})`,
      date: e.date_encaissement, montant: e.montant,
    }
  }
  const m = mouvements.get(source.ligneBancaireId)!
  return { nom: `le mouvement du ${formatDate(m.date)} « ${m.libelle} » (${formatMoney(m.montant)})`, date: m.date, montant: m.montant }
}

// P est-il exactement E, date par date ? Chaque écriture retrouve ses lignes, et aucune ligne proposée n'est d'une autre
// date.
function aJour(aEcrire: readonly EcritureVenteFacturee[], proposees: readonly LigneDuBrouillonLue[]): boolean {
  const dates = new Set(aEcrire.map((e) => e.date))
  if (proposees.some((l) => !dates.has(l.date))) return false
  return aEcrire.every((e) => memeEcritureQueLeBrouillon(e, proposees.filter((l) => l.date === e.date)))
}

const DETAIL: Record<Exclude<EtatSourceDeVente, 'ne_s_ecrit_pas' | 'validee' | 'a_retirer'>, string> = {
  a_ecrire: 'Rien n’est encore au brouillon : « Écrire » passe l’écriture que la base vérifie.',
  a_jour: 'Le brouillon porte exactement l’écriture que la source commande.',
  a_reecrire: 'Le brouillon porte une écriture proposée qui n’est plus celle que la source commande : « Réécrire » la remplace.',
}

/**
 * L'état de chaque source d'une vente facturée du dossier, et le geste qu'elle offre avec le refus que la base en
 * rendrait. Les lectures doivent être toutes faites EN ENTIER : l'appelant qui n'a pas tout lu n'appelle pas ce module.
 */
export function etatsDesVentesFacturees(entrees: EntreesEcrituresDeVente): EtatsDesVentes {
  const { sources, mode, plan, anneesValidees } = entrees
  const dossierId = sources.dossierId
  const factures = new Map(sources.factures.filter((f) => f.dossier_id === dossierId).map((f) => [f.id, f]))
  const encaissements = new Map(sources.encaissements.filter((e) => e.dossier_id === dossierId).map((e) => [e.id, e]))
  const mouvements = new Map(sources.mouvements.filter((m) => m.dossier_id === dossierId).map((m) => [m.id, m]))
  const brouillon = entrees.brouillon.filter((b) => b.dossier_id === dossierId)

  // Une ligne qui cite ce que la lecture n'a pas rendu : les lectures ne se tiennent pas, et rien ne se décide dessus.
  const inconnue = brouillon.find((b) => (b.facture_id != null && !factures.has(b.facture_id))
    || (b.encaissement_id != null && !encaissements.has(b.encaissement_id)))
  if (inconnue) {
    return {
      etat: 'incoherent', dossierId,
      motif: 'une écriture du brouillon cite une facture ou un encaissement que la lecture n’a pas rendu',
    }
  }

  const composee = compositionDesSources(sources, mode, plan)
  if (composee.etat === 'incoherent') return { etat: 'incoherent', dossierId, motif: composee.motif }
  const composition = composee.composition
  const contexte: ContexteEcritureVente = {
    dossierId, ventesParLesFactures: entrees.ventesParLesFactures, anneesValidees,
    factures: [...factures.values()], encaissements: [...encaissements.values()], mouvements: [...mouvements.values()],
    composition, plan,
  }
  const frontiere = frontiereDeValidation(anneesValidees)
  const estSource = (factureId: string) => factures.get(factureId)?.source_de_la_vente === true
    && factures.get(factureId)?.statut === 'validee'

  // ── Les sources candidates : ce que la composition écrit ou dit, ce que le brouillon porte, et chaque encaissement
  // vivant d'une facture source (pour qu'aucun ne manque à la liste sans un mot).
  const candidates = new Map<string, SourceEcritureVente>()
  const ajouter = (s: SourceEcritureVente) => { if (!candidates.has(cleDeLaSource(s))) candidates.set(cleDeLaSource(s), s) }
  for (const e of composition.ecritures) ajouter(e.source)
  for (const n of composition.nonEcrites) ajouter(n.source)
  for (const e of encaissements.values()) {
    if (e.retire_le == null && estSource(e.facture_id)) ajouter({ genre: 'encaissement', encaissementId: e.id, factureId: e.facture_id })
  }
  const citesParUneSource = new Set([...encaissements.values()]
    .filter((e) => e.ligne_bancaire_id != null && factures.get(e.facture_id)?.source_de_la_vente === true)
    .map((e) => e.ligne_bancaire_id as string))
  for (const b of brouillon) {
    if (b.facture_id != null) {
      ajouter(factures.get(b.facture_id)!.type === 'avoir' ? { genre: 'avoir', factureId: b.facture_id } : { genre: 'facture', factureId: b.facture_id })
    } else if (b.encaissement_id != null) {
      ajouter({ genre: 'encaissement', encaissementId: b.encaissement_id, factureId: encaissements.get(b.encaissement_id)!.facture_id })
    } else if (b.ligne_bancaire_id != null && citesParUneSource.has(b.ligne_bancaire_id) && b.piece_id == null
      && b.immobilisation_id == null && b.vehicule_id == null && b.declaration_tva_id == null && b.cotisation_id == null) {
      // Un mouvement classé AUTREMENT porte les lignes de cet autre classement : elles ne sont pas d'une vente facturée.
      const m = mouvements.get(b.ligne_bancaire_id)
      if (m && (m.encaissements_de_factures || mouvementLibre(m))) ajouter({ genre: 'mouvement', ligneBancaireId: m.id })
    }
  }

  const etats: SourceDeVenteEtat[] = []
  for (const [cle, source] of candidates) {
    // Une source dont la lecture n'a pas rendu la ligne : la composition ne la cite que depuis ce qu'elle a lu, et le
    // brouillon a été confronté plus haut ; un mouvement cité qui manque se dit par la composition (`mouvement_inconnu`).
    if (source.genre === 'mouvement' && !mouvements.has(source.ligneBancaireId)) continue
    const toutes = composition.ecritures.filter((e) => cleDeLaSource(e.source) === cle)
    const aEcrire = ecrituresDeLaSource(composition, source, anneesValidees)
    const siennes = lignesDeLaSource(brouillon, source, dossierId) as LigneDuBrouillonLue[]
    const proposees = siennes.filter((l) => l.statut === 'proposee')
    const validees = siennes.filter((l) => l.statut === 'validee').length
    const nonEcrite = composition.nonEcrites.find((n) => cleDeLaSource(n.source) === cle)
    const factureId = source.genre === 'facture' ? source.factureId
      : source.genre === 'encaissement' ? source.factureId
        : source.genre === 'avoir' ? factures.get(source.factureId)?.facture_origine_id ?? null : null
    const ecartee = factureId == null ? undefined : composition.ventes.ecartees.find((x) => x.factureId === factureId)
    const motif: MotifSansEcriture | null = nonEcrite?.motif ?? (ecartee ? 'vente_ecartee' : null)
    const detailDuMotif = nonEcrite?.detail
      ?? (ecartee ? `la facture ${numeroDe(factures.get(ecartee.factureId), ecartee.factureId)} ne se compte pas sans deviner : ${LIBELLE_MOTIF_VENTE[ecartee.motif]}` : null)

    let etat: EtatSourceDeVente
    let detail: string
    if (aEcrire.length > 0) {
      etat = proposees.length === 0 ? 'a_ecrire' : aJour(aEcrire, proposees) ? 'a_jour' : 'a_reecrire'
      detail = DETAIL[etat as keyof typeof DETAIL]
      if (toutes.length > aEcrire.length) detail += ' Sa part datée d’un exercice validé ne se réécrit plus.'
    } else if (proposees.length > 0) {
      etat = 'a_retirer'
      detail = motif && detailDuMotif
        ? `Cette source ne s’écrit plus — ${detailDuMotif} : ses écritures proposées se retirent.`
        : 'Cette source n’a plus rien à écrire (un encaissement retiré, un mouvement déclassé…) : ses écritures proposées se retirent.'
    } else if (motif && detailDuMotif) {
      etat = 'ne_s_ecrit_pas'
      detail = `${detailDuMotif.charAt(0).toUpperCase()}${detailDuMotif.slice(1)}.`
    } else if (validees > 0 || toutes.some((e) => estFigee(e.date, frontiere))) {
      etat = 'validee'
      detail = validees > 0
        ? 'Ses écritures sont validées avec leur exercice : elles ne se réécrivent ni ne se retirent plus.'
        : 'Cette source est datée d’un exercice validé et n’y a aucune écriture : rien ne s’y écrit plus — une opération découverte après coup se corrige sur l’exercice suivant.'
    } else {
      // Rien d'écrit, rien à écrire, rien à dire : une facture de services en trésorerie, que ses encaissements écrivent.
      continue
    }

    const geste: GesteDeVente | null = etat === 'a_ecrire' ? 'ecrire' : etat === 'a_reecrire' ? 'reecrire' : etat === 'a_retirer' ? 'retirer' : null
    const refus = geste === 'retirer'
      ? refusRetraitEcritureVenteFacturee(source, contexte, brouillon)?.message ?? null
      : geste != null ? refusEcritureVenteFacturee(source, contexte)?.message ?? null : null
    // LE CHOIX DU COMPTE DE CONTREPARTIE : à choisir ou refusé, il se choisit ; accepté, il se CHANGE (VF4C1-Q1, recommandée
    // et retenue à l'étape VF4c3) — tant que la base l'accepterait de ce compte même (`refusChoixCompteContrepartie` : ni
    // l'exercice validé, ni un encaissement retiré, contre-passé, qui cite un mouvement ou se dit par son moyen), et que la
    // source a encore une écriture à passer ou à reprendre.
    const actuel = source.genre === 'encaissement' ? encaissements.get(source.encaissementId)?.compte_contrepartie ?? null : null
    const apresLeChoix = proposees.length > 0 ? 'a_reecrire' as const : 'a_ecrire' as const
    const choixDuCompte: ChoixDuCompte | null = source.genre !== 'encaissement' ? null
      : motif === 'compte_a_choisir' || motif === 'compte_refuse'
        ? { encaissementId: source.encaissementId, geste: 'choisir', actuel, apresLeChoix }
        : actuel !== null && motif === null && (etat === 'a_ecrire' || etat === 'a_jour' || etat === 'a_reecrire')
          && refusChoixCompteContrepartie(source.encaissementId, actuel, contexte) === null
          ? { encaissementId: source.encaissementId, geste: 'changer', actuel, apresLeChoix }
          : null
    etats.push({
      cle, source, etat, ...nomDeLaSource(source, factures, encaissements, mouvements), motif: etat === 'a_retirer' || etat === 'ne_s_ecrit_pas' ? motif : null,
      detail, aEcrire, proposees, validees, geste, refus, choixDuCompte,
    })
  }
  etats.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    || ORDRE_DES_GENRES[a.source.genre] - ORDRE_DES_GENRES[b.source.genre] || (a.cle < b.cle ? -1 : a.cle > b.cle ? 1 : 0))
  return { etat: 'lus', dossierId, sources: etats, contexte }
}

// ── Ce que l'écran envoie ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les arguments du geste d'une source : `ecrire_vente_facturee` ou `retirer_ecriture_vente_facturee`. */
export function argumentsDuGeste(
  s: SourceDeVenteEtat, contexte: ContexteEcritureVente,
): { fonction: 'ecrire_vente_facturee'; args: ArgumentsEcrireVenteFacturee }
  | { fonction: 'retirer_ecriture_vente_facturee'; args: ReturnType<typeof argumentsRetirerEcritureVenteFacturee> } {
  return s.geste === 'retirer'
    ? { fonction: 'retirer_ecriture_vente_facturee', args: argumentsRetirerEcritureVenteFacturee(contexte.dossierId, s.source) }
    : { fonction: 'ecrire_vente_facturee', args: argumentsEcrireVenteFacturee(contexte.dossierId, s.source, contexte.composition, contexte.anneesValidees) }
}

/**
 * Le compte saisi, tel qu'il part : sans ses espaces (« 467 100 » se tape, aucun compte n'en contient) ; nul quand rien
 * n'est saisi. C'est SUR CETTE VALEUR que le refus se lit, et c'est elle que la fonction reçoit.
 */
export function compteSaisi(saisie: string): string | null {
  const compte = saisie.replace(/\s+/g, '')
  return compte === '' ? null : compte
}

/** Ce que `choisir_compte_contrepartie` refuserait de la saisie telle qu'elle part, sous ses mots ; nul sinon. */
export function refusDuChoix(
  encaissementId: string, saisie: string, contexte: ContexteEcritureVente,
): RefusEncaissement<CleRefusCompteContrepartie> | null {
  return refusChoixCompteContrepartie(encaissementId, compteSaisi(saisie), contexte)
}

export function argumentsDuChoix(contexte: ContexteEcritureVente, encaissementId: string, saisie: string) {
  return argumentsChoisirCompteContrepartie(contexte.dossierId, encaissementId, compteSaisi(saisie))
}
