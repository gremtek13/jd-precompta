import { justifieSonMouvement, mouvementLibre, remplirModele, type RefusEncaissement } from './encaissementsFactures'
import {
  refusCompteDeContrepartie, type EcrituresDesVentesFacturees, type EcritureVenteFacturee, type SourceEcritureVente,
} from './ecrituresVentesFacturees'
import { anneeDe } from './format'
import type { PlanComptable } from './planComptable'
import type { EcritureBrouillon, EncaissementFacture, FactureEmise, LigneBancaire } from './types'
import { exerciceQuiFige, frontiereDeValidation } from './validationExercice'
import { LIBELLE_MOTIF_VENTE } from './ventesFacturees'

// LES ÉCRITURES D'UNE VENTE FACTURÉE, ENVOYÉES À LA BASE (ligne 28.6, chantier EC-Q3, étape VF4b ; conception :
// HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 5, 6, 7 et 14). Un module PUR — il ne lit
// rien en base, n'appelle personne — que l'onglet Écritures lira à l'étape VF4c : ce qu'on envoie à
// `ecrire_vente_facturee` pour UNE source, tel que la composition de VF4a le rend (lib/ecrituresVentesFacturees.ts), et ce
// que la base refuserait — de cette fonction, de `retirer_ecriture_vente_facturee`, de `choisir_compte_contrepartie` —, dit
// AVANT le clic, dans l'ordre de la base et sous ses mots, sauf l'accès, que l'écran ne peut pas dire.
//
// CE QUE LA BASE TIENT (migration `ecritures_de_la_vente_facturee`, dans l'export ; appliquée le 20/10/2026) : elle
// RECOMPOSE en entiers les écritures d'une source depuis ses propres lignes (`ecriture_attendue_vente_facturee`, sur la
// règle du cumul de `calcul_vente_facturee`), les compare en multiensemble à celles qu'on lui envoie — date, compte, sens,
// centimes, mouvement ; le libellé n'en décide pas —, et remplace d'un tenant les écritures proposées de la source ; ce
// qu'un exercice validé fige ne se compare ni ne s'écrit plus. La garde G5 (`garder_lignes_de_la_vente_facturee`) ne laisse
// rien d'autre écrire, modifier ni retirer ces lignes. Le compte de contrepartie d'un encaissement par compensation (ou
// « autre ») sans mouvement est une colonne de l'encaissement, choisie par le cabinet seul (VF4A-Q2).
//
// LA RÉFÉRENCE : le texte des fonctions dans l'export, auquel ecritureVenteFacturee.test.ts confronte chaque liste —
// messages, ordre, codes et valeurs —, et l'essai supabase/essais/ecrituresVentesFacturees.sql, qui exige de la base chaque
// refus, code ET mots.

// ── Les refus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les refus d'`ecrire_vente_facturee`, dans son ordre et sous ses mots ; « % » : une valeur. */
export const REFUS_ECRITURE_VENTE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  {
    cle: 'genre_inconnu',
    modele: 'Une écriture de vente facturée a pour source une facture, un avoir, un encaissement ou un mouvement.',
    code: '22023',
  },
  {
    cle: 'dossier_non_bascule',
    modele: "Les factures de ce dossier ne sont pas la source de leurs ventes : aucune écriture de vente facturée ne s'y écrit.",
    code: '22023',
  },
  { cle: 'facture_introuvable', modele: 'Facture introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'avoir_introuvable', modele: 'Avoir introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'mouvement_introuvable', modele: 'Mouvement introuvable dans ce dossier.', code: 'P0002' },
  {
    cle: 'facture_non_source',
    modele: "Cette facture n'est pas la source de sa vente : elle se compte par sa pièce, sans écriture de vente facturée.",
    code: '22023',
  },
  {
    cle: 'avoir_non_source',
    modele: "Cet avoir n'est pas la source de sa vente : il se compte par sa pièce, sans écriture de vente facturée.",
    code: '22023',
  },
  {
    cle: 'encaissement_non_source',
    modele: "Cet encaissement est celui d'une facture qui n'est pas la source de sa vente : il n'a pas d'écriture de vente facturée.",
    code: '22023',
  },
  {
    cle: 'mouvement_sans_source',
    modele: "Ce mouvement ne justifie aucun encaissement d'une facture source de sa vente : il n'a pas d'écriture de vente facturée.",
    code: '22023',
  },
  {
    cle: 'lignes_illisibles',
    modele: "L'écriture proposée est illisible : une liste de lignes, chacune avec sa date, son compte, son sens, son montant positif au centime et son mouvement.",
    code: '22023',
  },
  { cle: 'vente_ecartee', modele: "La facture % ne se compte pas sans deviner (%) : ses écritures ne s'écrivent pas.", code: '22023' },
  {
    cle: 'compte_a_choisir',
    modele: "Cet encaissement s'écrit sur un compte de contrepartie que le cabinet choisit, et il n'est pas encore choisi.",
    code: '22023',
  },
  { cle: 'compte_refuse', modele: 'Le compte de contrepartie de cet encaissement, %, est refusé : %', code: '22023' },
  {
    cle: 'mouvement_facture_non_source',
    modele: "Ce mouvement porte aussi l'encaissement d'une facture qui n'est pas la source de sa vente : son écriture n'est pas encore conçue.",
    code: '22023',
  },
  {
    cle: 'mouvement_vente_ecartee',
    modele: "Ce mouvement porte l'encaissement d'une facture que les ventes facturées écartent : il ne s'écrit pas.",
    code: '22023',
  },
  {
    cle: 'mouvement_non_classe',
    modele: "Ce mouvement n'est pas encore classé par ses encaissements : son écriture attend ce classement.",
    code: '22023',
  },
  {
    cle: 'mouvement_ecart',
    modele: "Les encaissements que ce mouvement porte ne font pas son montant à l'écart des frais près : il ne s'écrit pas.",
    code: '22023',
  },
  { cle: 'frontiere', modele: "% : aucune écriture ne s'y passe plus.", code: '22023' },
  { cle: 'rien_a_ecrire', modele: "Cette source n'a rien à écrire : ses écritures, s'il y en a, se retirent.", code: '22023' },
  {
    cle: 'ecriture_differente',
    modele: "L'écriture proposée n'est pas celle que la base recompose pour cette source : relire la source, puis la recomposer.",
    code: '22023',
  },
] as const

export type CleRefusEcritureVente = (typeof REFUS_ECRITURE_VENTE)[number]['cle']

/** Les refus de `retirer_ecriture_vente_facturee`, dans son ordre et sous ses mots. */
export const REFUS_RETRAIT_ECRITURE_VENTE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  {
    cle: 'genre_inconnu',
    modele: 'Une écriture de vente facturée a pour source une facture, un avoir, un encaissement ou un mouvement.',
    code: '22023',
  },
  {
    cle: 'dossier_non_bascule',
    modele: "Les factures de ce dossier ne sont pas la source de leurs ventes : aucune écriture de vente facturée ne s'y écrit.",
    code: '22023',
  },
  { cle: 'facture_introuvable', modele: 'Facture introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'avoir_introuvable', modele: 'Avoir introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.', code: 'P0002' },
  { cle: 'mouvement_introuvable', modele: 'Mouvement introuvable dans ce dossier.', code: 'P0002' },
  {
    cle: 'mouvement_classe_autrement',
    modele: 'Ce mouvement est classé autrement que par ses encaissements : ses écritures sont celles de ce classement, et se retirent avec lui.',
    code: '22023',
  },
  {
    cle: 'mouvement_jamais_cite',
    modele: "Aucun encaissement d'une facture source de sa vente ne cite ce mouvement : il n'a pas d'écriture de vente facturée.",
    code: '22023',
  },
  {
    cle: 'encore_a_ecrire',
    modele: 'Cette source a encore à écrire : ses écritures se réécrivent, elles ne se retirent pas.',
    code: '22023',
  },
  { cle: 'validees', modele: 'Les écritures de cette source sont validées : elles ne se retirent plus.', code: '22023' },
  { cle: 'aucune_ecriture', modele: "Cette source n'a aucune écriture proposée à retirer.", code: '22023' },
] as const

export type CleRefusRetraitEcritureVente = (typeof REFUS_RETRAIT_ECRITURE_VENTE)[number]['cle']

/** Les refus de `choisir_compte_contrepartie`, dans son ordre et sous ses mots : le dernier est celui de
 * `refus_compte_de_contrepartie`, les règles de `refusCompteDeContrepartie`, sous ses mots. */
export const REFUS_COMPTE_CONTREPARTIE = [
  { cle: 'acces', modele: 'Accès refusé à ce dossier.', code: '42501' },
  { cle: 'encaissement_introuvable', modele: 'Encaissement introuvable dans ce dossier.', code: 'P0002' },
  {
    cle: 'retire',
    modele: "Cet encaissement est retiré : il ne s'écrit pas, et ne reçoit pas de compte de contrepartie.",
    code: '22023',
  },
  {
    cle: 'contre_passation',
    modele: "Une contre-passation s'écrit sur le compte de l'encaissement qu'elle annule : elle ne reçoit pas de compte de contrepartie.",
    code: '22023',
  },
  {
    cle: 'facture_non_source',
    modele: "Seul l'encaissement d'une facture source de sa vente s'écrit dans l'application : celui-ci ne reçoit pas de compte de contrepartie.",
    code: '22023',
  },
  { cle: 'frontiere', modele: '% : le compte de contrepartie de cet encaissement ne change plus.', code: '22023' },
  {
    cle: 'cite_un_mouvement',
    modele: "Cet encaissement cite un mouvement : il s'écrit par lui, sur la banque ou sur les valeurs à l'encaissement, jamais sur un compte de contrepartie.",
    code: '22023',
  },
  {
    cle: 'moyen',
    modele: "Seul un encaissement par compensation, ou par un autre moyen, s'écrit sur un compte de contrepartie : celui-ci se dit par son moyen de paiement.",
    code: '22023',
  },
  { cle: 'compte_absent', modele: 'Le compte de contrepartie est à choisir.', code: '22023' },
  { cle: 'compte_refuse', modele: '%', code: '22023' },
] as const

export type CleRefusCompteContrepartie = (typeof REFUS_COMPTE_CONTREPARTIE)[number]['cle']

/** Les refus de la garde G5 (`garder_lignes_de_la_vente_facturee`), dans l'ordre de son texte. */
export const REFUS_GARDE_LIGNES_VENTE = [
  {
    cle: 'insertion_sur_mouvement_classe',
    modele: 'Une écriture ne se passe sur un mouvement classé par ses encaissements que par la fonction qui écrit la vente facturée.',
    code: '42501',
  },
  { cle: 'retrait_hors_fonction', modele: "Une écriture de vente facturée ne se retire que par la fonction qui l'écrit.", code: '42501' },
  {
    cle: 'modification_hors_fonction',
    modele: "Une écriture de vente facturée ne se modifie que par la fonction qui l'écrit.",
    code: '42501',
  },
] as const

/** Les deux refus que la garde des encaissements gagne pour le compte de contrepartie, dans l'ordre de son texte. */
export const REFUS_GARDE_CONTREPARTIE = [
  {
    cle: 'naissance_avec_compte',
    modele: 'Un encaissement ne naît pas avec un compte de contrepartie : le cabinet le choisit ensuite, par sa fonction.',
    code: '42501',
  },
  {
    cle: 'compte_hors_fonction',
    modele: "Le compte de contrepartie d'un encaissement ne se choisit que par la fonction du cabinet.",
    code: '42501',
  },
] as const

type Liste = readonly { readonly cle: string; readonly modele: string }[]

function refusDe<C extends string>(liste: Liste, cle: C, ...valeurs: string[]): RefusEncaissement<C> {
  return { cle, message: remplirModele((liste.find((r) => r.cle === cle) as Liste[number]).modele, valeurs) }
}

// ── Ce que l'écran sait ───────────────────────────────────────────────────────────────────────────────────────────────

/** Une facture ou un avoir, tel que ces refus le lisent. */
export type FacturePourEcriture = Pick<FactureEmise, 'id' | 'dossier_id' | 'type' | 'numero' | 'source_de_la_vente' | 'facture_origine_id'>

/** Un encaissement du registre, tel que ces refus le lisent — retirés et contre-passations compris. */
export type EncaissementPourEcriture = Pick<EncaissementFacture,
  'id' | 'dossier_id' | 'facture_id' | 'date_encaissement' | 'montant' | 'moyen' | 'ligne_bancaire_id' | 'annule_id'
  | 'retire_le' | 'compte_contrepartie'>

/** Un mouvement du dossier, tel que ces refus le lisent : ce qui le classe, que le retrait juge (`mouvementLibre`). */
export type MouvementPourEcriture = Pick<LigneBancaire,
  'id' | 'dossier_id' | 'statut' | 'piece_id' | 'cotisation_id' | 'categorie_id' | 'emprunt_id' | 'compte_bilan'
  | 'declaration_tva_id' | 'ventilee' | 'reglement_groupe' | 'prelevement_personnel' | 'encaissements_de_factures'>

/** Une ligne du brouillon, telle que le retrait la reconnaît comme une ligne de la source. */
export type LigneDuBrouillon = Pick<EcritureBrouillon,
  'dossier_id' | 'statut' | 'facture_id' | 'encaissement_id' | 'ligne_bancaire_id' | 'piece_id' | 'immobilisation_id'
  | 'vehicule_id' | 'declaration_tva_id' | 'cotisation_id'>

/**
 * Ce que l'écran sait quand il écrit ou retire les écritures d'une source — tout lu EN ENTIER, comme le reste : une liste
 * partielle ferait dire un refus faux, et l'écran qui n'a pas tout lu n'offre aucun geste.
 */
export interface ContexteEcritureVente {
  /** Le dossier ANNONCÉ à la fonction. */
  dossierId: string
  /** Le réglage du dossier (`dossiers.ventes_par_les_factures`). */
  ventesParLesFactures: boolean
  /** Les années des exercices validés du dossier : la frontière, et la phrase d'`exercice_fige`. */
  anneesValidees: readonly number[]
  /** Les factures et avoirs du dossier, sources ou non. */
  factures: readonly FacturePourEcriture[]
  /** Le registre entier des encaissements du dossier. */
  encaissements: readonly EncaissementPourEcriture[]
  /** Les mouvements du dossier, et ce qui les classe. */
  mouvements: readonly MouvementPourEcriture[]
  /** La composition du dossier, sur les mêmes lignes (`ecrituresDesVentesFacturees`). */
  composition: EcrituresDesVentesFacturees
  /** Le plan du dossier, celui de la composition. */
  plan: PlanComptable
}

// ── La source ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** L'identifiant qu'on donne à la base pour une source : la facture ou l'avoir, l'encaissement, le mouvement. */
export function identifiantDeLaSource(source: SourceEcritureVente): string {
  if (source.genre === 'encaissement') return source.encaissementId
  if (source.genre === 'mouvement') return source.ligneBancaireId
  return source.factureId
}

function memeSource(a: SourceEcritureVente, b: SourceEcritureVente): boolean {
  return a.genre === b.genre && identifiantDeLaSource(a) === identifiantDeLaSource(b)
}

/** Les écritures que la composition rend pour CETTE source, après la frontière de la validation — ce que la base écrira. */
export function ecrituresDeLaSource(
  composition: Pick<EcrituresDesVentesFacturees, 'ecritures'>, source: SourceEcritureVente, anneesValidees: readonly number[],
): EcritureVenteFacturee[] {
  const frontiere = frontiereDeValidation(anneesValidees)
  return composition.ecritures.filter((e) => memeSource(e.source, source) && (frontiere == null || e.date > frontiere))
}

// ── Ce qu'on envoie ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Une ligne envoyée à la base : celle de `lignesAuBrouillon`, sans ce que la base pose elle-même. */
export interface LigneEnvoyee {
  date: string
  compte: string
  sens: 'debit' | 'credit'
  /** En euros, au centime. */
  montant: number
  ligne_bancaire_id: string | null
  libelle: string
}

export interface ArgumentsEcrireVenteFacturee {
  p_dossier_id: string
  p_source: SourceEcritureVente['genre']
  p_source_id: string
  p_lignes: LigneEnvoyee[]
}

/**
 * Les arguments d'`ecrire_vente_facturee` pour UNE source : son genre, son identifiant, et les lignes de TOUTES ses
 * écritures datées après la frontière — une facture peut en porter deux, son émission et la livraison d'un bien à une
 * autre date, qui se remplacent ensemble. Les lignes sont celles de la composition, telles quelles ; le montant, ses
 * centimes divisés par cent, que la base relit au centime.
 */
export function argumentsEcrireVenteFacturee(
  dossierId: string, source: SourceEcritureVente, composition: Pick<EcrituresDesVentesFacturees, 'ecritures'>,
  anneesValidees: readonly number[],
): ArgumentsEcrireVenteFacturee {
  return {
    p_dossier_id: dossierId,
    p_source: source.genre,
    p_source_id: identifiantDeLaSource(source),
    p_lignes: ecrituresDeLaSource(composition, source, anneesValidees).flatMap((e) => e.lignes.map((l) => ({
      date: e.date, compte: l.compte, sens: l.sens, montant: l.centimes / 100, ligne_bancaire_id: l.ligneBancaireId,
      libelle: e.libelle,
    }))),
  }
}

/** Les arguments de `retirer_ecriture_vente_facturee`. */
export function argumentsRetirerEcritureVenteFacturee(dossierId: string, source: SourceEcritureVente) {
  return { p_dossier_id: dossierId, p_source: source.genre, p_source_id: identifiantDeLaSource(source) }
}

/** Les arguments de `choisir_compte_contrepartie`. */
export function argumentsChoisirCompteContrepartie(dossierId: string, encaissementId: string, compte: string | null) {
  return { p_dossier_id: dossierId, p_encaissement_id: encaissementId, p_compte: compte }
}

// ── Ce que la base refuserait ─────────────────────────────────────────────────────────────────────────────────────────

const MOTIF_VERS_REFUS = {
  compte_a_choisir: 'compte_a_choisir',
  mouvement_facture_non_source: 'mouvement_facture_non_source',
  mouvement_vente_ecartee: 'mouvement_vente_ecartee',
  mouvement_non_classe: 'mouvement_non_classe',
  mouvement_ecart: 'mouvement_ecart',
} as const satisfies Partial<Record<string, CleRefusEcritureVente>>

// La source introuvable, puis qui n'est pas celle d'une vente facturée : les rangs 4 à 11 de la base, que le retrait
// partage pour les quatre premiers. `sourceExigee` : le rang 8 à 11, qu'`ecrire` juge et que le retrait ne juge pas.
function refusDeLaSource(
  source: SourceEcritureVente, c: ContexteEcritureVente, sourceExigee: boolean,
): RefusEncaissement<CleRefusEcritureVente> | null {
  const non = (cle: CleRefusEcritureVente) => refusDe(REFUS_ECRITURE_VENTE, cle)
  const id = identifiantDeLaSource(source)
  if (source.genre === 'facture' || source.genre === 'avoir') {
    const doc = c.factures.find((f) => f.id === id && f.dossier_id === c.dossierId && f.type === source.genre)
    if (!doc) return non(source.genre === 'facture' ? 'facture_introuvable' : 'avoir_introuvable')
    if (sourceExigee && !doc.source_de_la_vente) return non(source.genre === 'facture' ? 'facture_non_source' : 'avoir_non_source')
    return null
  }
  if (source.genre === 'encaissement') {
    const e = c.encaissements.find((x) => x.id === id && x.dossier_id === c.dossierId)
    if (!e) return non('encaissement_introuvable')
    if (sourceExigee && !c.factures.some((f) => f.id === e.facture_id && f.source_de_la_vente)) return non('encaissement_non_source')
    return null
  }
  if (!c.mouvements.some((m) => m.id === id && m.dossier_id === c.dossierId)) return non('mouvement_introuvable')
  if (sourceExigee && !c.encaissements.some((e) => e.ligne_bancaire_id === id && e.retire_le == null
    && c.factures.some((f) => f.id === e.facture_id && f.source_de_la_vente) && justifieSonMouvement(e, c.encaissements))) {
    return non('mouvement_sans_source')
  }
  return null
}

// La facture dont dépend une facture, un avoir ou un encaissement ; nulle pour un mouvement.
function factureDeLaSource(source: SourceEcritureVente, c: ContexteEcritureVente): string | null {
  if (source.genre === 'facture') return source.factureId
  if (source.genre === 'encaissement') return c.encaissements.find((e) => e.id === source.encaissementId)?.facture_id ?? null
  if (source.genre === 'avoir') return c.factures.find((f) => f.id === source.factureId)?.facture_origine_id ?? null
  return null
}

/**
 * Ce qu'`ecrire_vente_facturee` refuserait pour cette source : le PREMIER refus, dans l'ordre de la base et sous ses mots,
 * ou null — l'accès, seule la base le juge ; le genre, le type le tient ; des lignes illisibles ou qui ne se retrouvent
 * pas, l'application ne les envoie pas, puisqu'elle envoie la composition. Dans l'ordre : le dossier qui n'a pas basculé ;
 * la source introuvable ; une source qui n'est pas celle d'une vente facturée ; une source que la composition ne sait pas
 * écrire, et pourquoi (une facture écartée, le compte de contrepartie, un mouvement) ; une source qui n'a rien à écrire
 * après la frontière.
 */
export function refusEcritureVenteFacturee(
  source: SourceEcritureVente, c: ContexteEcritureVente,
): RefusEncaissement<CleRefusEcritureVente> | null {
  const non = (cle: CleRefusEcritureVente, ...valeurs: string[]) => refusDe(REFUS_ECRITURE_VENTE, cle, ...valeurs)
  if (!c.ventesParLesFactures) return non('dossier_non_bascule')
  const introuvable = refusDeLaSource(source, c, true)
  if (introuvable) return introuvable
  const factureId = factureDeLaSource(source, c)
  const ecartee = factureId == null ? undefined : c.composition.ventes.ecartees.find((x) => x.factureId === factureId)
  if (ecartee) {
    // Une facture validée porte toujours son numéro ; un `%` nul, `raise` l'écrirait `<NULL>`.
    return non('vente_ecartee', ecartee.numero ?? '<NULL>', LIBELLE_MOTIF_VENTE[ecartee.motif])
  }
  const nonEcrite = c.composition.nonEcrites.find((n) => memeSource(n.source, source))
  if (nonEcrite?.motif === 'compte_refuse' && source.genre === 'encaissement') {
    const compte = compteDeTresorerie(source.encaissementId, c) ?? ''
    return non('compte_refuse', compte, refusCompteDeContrepartie(compte, c.plan) ?? '')
  }
  if (nonEcrite && nonEcrite.motif in MOTIF_VERS_REFUS) return non(MOTIF_VERS_REFUS[nonEcrite.motif as keyof typeof MOTIF_VERS_REFUS])
  // Un mouvement que la composition n'a pas lu : elle ne sait pas ce qu'il écrit, et la base, qui le lit, en jugera.
  if (nonEcrite) return null
  if (ecrituresDeLaSource(c.composition, source, c.anneesValidees).length === 0) return non('rien_a_ecrire')
  return null
}

// Le compte de contrepartie qui écrit un encaissement : le sien, ou, pour une contre-passation sans mouvement, celui de
// l'encaissement qu'elle annule.
function compteDeTresorerie(encaissementId: string, c: ContexteEcritureVente): string | null {
  const e = c.encaissements.find((x) => x.id === encaissementId)
  const t = e && e.annule_id != null && e.ligne_bancaire_id == null ? c.encaissements.find((x) => x.id === e.annule_id) : e
  return t?.compte_contrepartie ?? null
}

/** Les lignes du brouillon qui appartiennent à cette source : ce que la base remplace ou retire. */
export function lignesDeLaSource(brouillon: readonly LigneDuBrouillon[], source: SourceEcritureVente, dossierId: string): LigneDuBrouillon[] {
  const id = identifiantDeLaSource(source)
  return brouillon.filter((b) => b.dossier_id === dossierId && (
    source.genre === 'facture' || source.genre === 'avoir' ? b.facture_id === id
      : source.genre === 'encaissement' ? b.encaissement_id === id
        : b.ligne_bancaire_id === id && b.facture_id == null && b.encaissement_id == null && b.piece_id == null
          && b.immobilisation_id == null && b.vehicule_id == null && b.declaration_tva_id == null && b.cotisation_id == null))
}

/**
 * Ce que `retirer_ecriture_vente_facturee` refuserait : le dossier qui n'a pas basculé ; la source introuvable ; un
 * mouvement classé autrement que par ses encaissements, dont les lignes sans pièce sont celles de cet autre classement ;
 * un mouvement libre qu'aucun encaissement d'une facture source n'a jamais cité (retirés compris) ; une source pour
 * laquelle la composition rend encore des écritures après la frontière (elle se réécrit) ; des écritures toutes
 * validées ; aucune écriture proposée. `brouillon` : les écritures du dossier, lues en entier.
 */
export function refusRetraitEcritureVenteFacturee(
  source: SourceEcritureVente, c: ContexteEcritureVente, brouillon: readonly LigneDuBrouillon[],
): RefusEncaissement<CleRefusRetraitEcritureVente> | null {
  const non = (cle: CleRefusRetraitEcritureVente) => refusDe(REFUS_RETRAIT_ECRITURE_VENTE, cle)
  if (!c.ventesParLesFactures) return non('dossier_non_bascule')
  const introuvable = refusDeLaSource(source, c, false)
  if (introuvable) return non(introuvable.cle as CleRefusRetraitEcritureVente)
  if (source.genre === 'mouvement') {
    const m = c.mouvements.find((x) => x.id === source.ligneBancaireId && x.dossier_id === c.dossierId)
    if (m && !m.encaissements_de_factures && !mouvementLibre(m)) return non('mouvement_classe_autrement')
    if (!c.encaissements.some((e) => e.ligne_bancaire_id === source.ligneBancaireId && e.dossier_id === c.dossierId
      && c.factures.some((f) => f.id === e.facture_id && f.source_de_la_vente))) return non('mouvement_jamais_cite')
  }
  if (ecrituresDeLaSource(c.composition, source, c.anneesValidees).length > 0) return non('encore_a_ecrire')
  const siennes = lignesDeLaSource(brouillon, source, c.dossierId)
  if (!siennes.some((b) => b.statut === 'proposee')) return non(siennes.some((b) => b.statut === 'validee') ? 'validees' : 'aucune_ecriture')
  return null
}

/**
 * Ce que `choisir_compte_contrepartie` refuserait : l'encaissement introuvable, retiré, une contre-passation, d'une
 * facture qui n'est pas source, daté d'un exercice que la frontière fige, qui cite un mouvement, d'un autre moyen que la
 * compensation ou « autre », aucun compte, puis un compte que `refusCompteDeContrepartie` refuse, sous ses mots.
 */
export function refusChoixCompteContrepartie(
  encaissementId: string, compte: string | null, c: Pick<ContexteEcritureVente, 'dossierId' | 'anneesValidees' | 'factures' | 'encaissements' | 'plan'>,
): RefusEncaissement<CleRefusCompteContrepartie> | null {
  const non = (cle: CleRefusCompteContrepartie, ...valeurs: string[]) => refusDe(REFUS_COMPTE_CONTREPARTIE, cle, ...valeurs)
  const e = c.encaissements.find((x) => x.id === encaissementId && x.dossier_id === c.dossierId)
  if (!e) return non('encaissement_introuvable')
  if (e.retire_le != null) return non('retire')
  if (e.annule_id != null) return non('contre_passation')
  if (!c.factures.some((f) => f.id === e.facture_id && f.source_de_la_vente)) return non('facture_non_source')
  const frontiere = frontiereDeValidation(c.anneesValidees)
  if (frontiere != null && e.date_encaissement <= frontiere) {
    // Au plus tard à la frontière, l'exercice est validé ou figé par un exercice validé qui le suit : jamais nul ici.
    return non('frontiere', exerciceQuiFige(anneeDe(e.date_encaissement), c.anneesValidees) as string)
  }
  if (e.ligne_bancaire_id != null) return non('cite_un_mouvement')
  if (e.moyen !== 'compensation' && e.moyen !== 'autre') return non('moyen')
  if (compte == null) return non('compte_absent')
  const refus = refusCompteDeContrepartie(compte, c.plan)
  return refus == null ? null : non('compte_refuse', refus)
}
