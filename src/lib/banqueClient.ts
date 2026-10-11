// « MA BANQUE » : CE QUE L'ÉCRAN DU CLIENT DIT DE SON RELEVÉ (espace client, étape P9 ; conception : HISTORIQUE.md,
// « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.5 et §6 ; la base : migration
// `banque_du_client`, étape P7).
//
// Le client qui porte la case « Banque » voit les mouvements du relevé que son cabinet a importé — date, libellé, montant —,
// l'ÉTAT de chacun pour lui, le solde LU au dernier relevé contrôlé, et les mois que le relevé couvre. Il propose une pièce
// comme justificatif d'un mouvement, retire sa proposition, écrit une précision : par les trois fonctions de la base
// (`proposer_justificatif`, `retirer_proposition`, `ecrire_precision_mouvement`), seules à écrire ces registres. Jamais la
// catégorie, le compte, la ventilation ni l'écriture : c'est le métier du cabinet (conception, §6.1).
//
// HYPOTHÈSE EC-Q5 (sans réponse du cabinet) : le client ne connecte pas sa banque (étape P8, pas faite) ; il voit le relevé
// que le cabinet a importé, et l'écran le dit.
//
// CE MODULE EST PUR (aucun import de `supabase.ts`) : l'écran lit, le module juge. Trois règles le tiennent :
//  1. L'état d'un mouvement se DÉDUIT du relevé (`mouvementJustifieParLeReleve`, le prédicat unique du FEC et de la piste
//     d'audit), de ses propositions et de son fil — jamais stocké. Il se TAIT si l'une de ces sources n'a pas été lue en
//     entier : un mouvement dont la proposition manque à la lecture se dirait « sans justificatif » d'une pièce envoyée.
//  2. Le solde se LIT au dernier relevé dont le contrôle de solde est cohérent ; il ne se calcule jamais en additionnant
//     les mouvements — un mouvement manquant le rendrait faux sans un mot (conception, §6.4).
//  3. Les refus des trois fonctions se disent AVANT le clic, dans leur ordre et sous leurs mots, confrontés au texte exporté
//     de la migration (banqueClient.test.ts). Un seul ne se dit pas d'avance côté client : l'exercice figé par la
//     validation, que le client ne lit pas (`exercices_valides` est au cabinet seul) — le module le dit quand l'appelant
//     connaît les exercices validés (le côté cabinet de P9), et l'écran du client reçoit le refus de la base.
import { mouvementJustifieParLeReleve } from './affectationBanque'
import { dateAParis } from './format'
import type { LectureComplete } from './lectureComplete'
import type { ControleReleveBancaire, JustificatifPropose, LigneBancaire, Piece, PrecisionMouvement, ReglementGroupe } from './types'

// ── Qui voit « Ma banque » ────────────────────────────────────────────────────────────────────────────────────────
/**
 * « Ma banque » s'offre-t-il au client (sa route, App.tsx ; son entrée, Layout.tsx ; sa tuile, ClientHome.tsx) ? Avec la
 * case « Banque » sur la société AFFICHÉE, et seulement une fois la banque du client en base (`COUVERTURE_EXPORTEE`, la
 * migration `banque_du_client` qui porte aussi ses deux registres) : avant elle, la RLS rendrait les propositions et le fil
 * VIDES sans erreur, et l'écran dirait « sans justificatif » d'un mouvement qui en a un.
 */
export function maBanqueOuverte(banqueExportee: boolean, droitBanque: boolean): boolean {
  return banqueExportee && droitBanque
}

// ── Ce que l'écran lit d'un mouvement ────────────────────────────────────────────────────────────────────────────────
// Les colonnes, et elles seules : celles que l'écran montre (date, libellé, montant) et celles dont l'état se déduit. La
// catégorie et les autres liens ne se lisent que pour savoir s'ils sont posés — l'écran n'en montre rien.
// Une seule chaîne littérale : supabase-js lit son type, et une concaténation le lui ferait perdre.
export const COLONNES_DU_MOUVEMENT =
  'id, dossier_id, date, libelle, montant, statut, piece_id, cotisation_id, categorie_id, emprunt_id, ventilee, reglement_groupe, compte_bilan, declaration_tva_id, prelevement_personnel, created_at'

export type MouvementDuClient = Pick<LigneBancaire,
  'id' | 'dossier_id' | 'date' | 'libelle' | 'montant' | 'statut' | 'piece_id' | 'cotisation_id' | 'categorie_id'
  | 'emprunt_id' | 'ventilee' | 'reglement_groupe' | 'compte_bilan' | 'declaration_tva_id' | 'prelevement_personnel'
  | 'created_at'>

// Les colonnes d'une pièce que l'écran montre : son nom et son jour de dépôt, comme « Mes pièces » — ni montant, ni
// catégorie, ni tiers lu par l'OCR (les accès clients restent restreints hors des trois domaines décidés).
export const COLONNES_DE_LA_PIECE = 'id, dossier_id, nom_fichier, created_at'
export type PieceDuClient = Pick<Piece, 'id' | 'dossier_id' | 'nom_fichier' | 'created_at'>

// ── L'état d'un mouvement, pour le client (conception, §6.2) ─────────────────────────────────────────────────────────
export const ETATS_DU_MOUVEMENT = [
  'sans_justificatif', 'demande', 'propose', 'justifie_piece', 'justifie_releve', 'traite', 'rien_a_fournir',
] as const
export type EtatDuMouvement = typeof ETATS_DU_MOUVEMENT[number]

// Les mots du client : on le tutoie, son cabinet est « ton cabinet ». « Sans justificatif » est NEUTRE : beaucoup de
// mouvements ne demandent rien, et le cabinet seul sait lesquels.
export const LIBELLE_DE_L_ETAT: Record<EtatDuMouvement, string> = {
  sans_justificatif: 'Sans justificatif',
  demande: 'Demandé par ton cabinet',
  propose: 'Justificatif envoyé',
  justifie_piece: 'Justifié par une pièce',
  justifie_releve: 'Justifié par le relevé',
  traite: 'Traité par ton cabinet',
  rien_a_fournir: 'Rien à fournir',
}

/**
 * L'état d'un mouvement, dans l'ordre de la conception : ce que le cabinet a classé d'abord (une pièce, un classement que
 * le relevé justifie, ou un rapprochement sans lien lisible), puis ce qu'il a écarté, puis ce que le client a envoyé, ce
 * que le cabinet demande, et le reste. Un virement personnel est justifié par le relevé, bien qu'« ignoré » au relevé.
 */
export function etatDuMouvement(
  mouvement: Pick<MouvementDuClient,
    'statut' | 'piece_id' | 'reglement_groupe' | 'categorie_id' | 'emprunt_id' | 'cotisation_id' | 'ventilee' | 'compte_bilan'
    | 'declaration_tva_id' | 'prelevement_personnel'>,
  propositionsActives: number,
  questionEnAttente: boolean,
): EtatDuMouvement {
  if (mouvement.statut === 'rapprochee') {
    if (mouvement.piece_id || mouvement.reglement_groupe) return 'justifie_piece'
    if (mouvementJustifieParLeReleve(mouvement)) return 'justifie_releve'
    return 'traite'
  }
  if (mouvement.prelevement_personnel) return 'justifie_releve'
  if (mouvement.statut === 'ignoree') return 'rien_a_fournir'
  if (propositionsActives > 0) return 'propose'
  if (questionEnAttente) return 'demande'
  return 'sans_justificatif'
}

/** Un mouvement qui attend encore une pièce du client : ni classé, ni écarté, et aucune pièce proposée. */
export function attendUnePiece(etat: EtatDuMouvement): boolean {
  return etat === 'sans_justificatif' || etat === 'demande'
}

/** Le client peut-il proposer une pièce ? Sur un mouvement que le cabinet n'a ni rapproché ni écarté. */
export function proposableParLeClient(mouvement: Pick<MouvementDuClient, 'statut' | 'prelevement_personnel'>): boolean {
  return mouvement.statut === 'non_rapprochee' && !mouvement.prelevement_personnel
}

export interface SituationDuMouvement {
  etat: EtatDuMouvement
  // Les propositions NON RETIRÉES, de la plus ancienne à la plus récente.
  propositions: JustificatifPropose[]
  // Le fil, dans l'ordre où il s'est écrit.
  precisions: PrecisionMouvement[]
  // Le dernier message du fil vient du cabinet : sa question attend une réponse.
  questionEnAttente: boolean
  // Les pièces qui justifient un mouvement rapproché (la sienne, ou les parts d'un virement qui en règle plusieurs) ;
  // nul quand les parts n'ont pas été lues en entier — on ne nomme pas une partie pour le tout.
  piecesQuiJustifient: string[] | null
}

export type SituationsDuReleve =
  | { lues: false; motif: string }
  | { lues: true; parMouvement: Map<string, SituationDuMouvement> }

// L'ordre d'écriture : l'instant, puis l'identifiant pour départager deux lignes du même instant.
function chronologique<T extends { created_at: string; id: string }>(a: T, b: T): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * La situation de chaque mouvement lu. MUETTE si les mouvements, les propositions ou le fil n'ont pas été lus en
 * entier ; les parts des virements groupés lues en partie ne taisent que les pièces de ces virements.
 */
export function situationsDuReleve(sources: {
  mouvements: LectureComplete<MouvementDuClient>
  propositions: LectureComplete<JustificatifPropose>
  precisions: LectureComplete<PrecisionMouvement>
  reglements: LectureComplete<ReglementGroupe>
}): SituationsDuReleve {
  for (const [quoi, lecture] of [
    ['les mouvements n’ont pas été lus', sources.mouvements], ['les justificatifs envoyés n’ont pas été lus', sources.propositions],
    ['les précisions n’ont pas été lues', sources.precisions],
  ] as const) {
    if (!lecture.complete) return { lues: false, motif: `${quoi} en entier` }
  }
  const actives = new Map<string, JustificatifPropose[]>()
  for (const p of [...sources.propositions.lignes].sort(chronologique)) {
    if (p.retire_le !== null) continue
    actives.set(p.ligne_bancaire_id, [...(actives.get(p.ligne_bancaire_id) ?? []), p])
  }
  const fils = new Map<string, PrecisionMouvement[]>()
  for (const p of [...sources.precisions.lignes].sort(chronologique)) {
    fils.set(p.ligne_bancaire_id, [...(fils.get(p.ligne_bancaire_id) ?? []), p])
  }
  const parts = new Map<string, string[]>()
  for (const r of sources.reglements.lignes) {
    if (r.piece_id) parts.set(r.ligne_bancaire_id, [...(parts.get(r.ligne_bancaire_id) ?? []), r.piece_id])
  }
  const parMouvement = new Map<string, SituationDuMouvement>()
  for (const m of sources.mouvements.lignes) {
    const propositions = actives.get(m.id) ?? []
    const precisions = fils.get(m.id) ?? []
    const questionEnAttente = precisions.length > 0 && precisions[precisions.length - 1].origine === 'cabinet'
    const etat = etatDuMouvement(m, propositions.length, questionEnAttente)
    let piecesQuiJustifient: string[] | null = []
    if (etat === 'justifie_piece') {
      if (m.piece_id) piecesQuiJustifient = [m.piece_id]
      else piecesQuiJustifient = sources.reglements.complete ? parts.get(m.id) ?? [] : null
    }
    parMouvement.set(m.id, { etat, propositions, precisions, questionEnAttente, piecesQuiJustifient })
  }
  return { lues: true, parMouvement }
}

// ── Les filtres de l'écran ────────────────────────────────────────────────────────────────────────────────────────
export type FiltreEtat = 'tous' | 'attend' | 'propose' | 'justifie' | 'rien_a_fournir'

export const FILTRES_D_ETAT: readonly { valeur: FiltreEtat; libelle: string }[] = [
  { valeur: 'tous', libelle: 'Tous les mouvements' },
  { valeur: 'attend', libelle: 'Ce qui attend une pièce' },
  { valeur: 'propose', libelle: 'Justificatifs envoyés' },
  { valeur: 'justifie', libelle: 'Justifiés' },
  { valeur: 'rien_a_fournir', libelle: 'Rien à fournir' },
]

export function correspondAuFiltre(etat: EtatDuMouvement, filtre: FiltreEtat): boolean {
  switch (filtre) {
    case 'tous': return true
    case 'attend': return attendUnePiece(etat)
    case 'propose': return etat === 'propose'
    case 'justifie': return etat === 'justifie_piece' || etat === 'justifie_releve' || etat === 'traite'
    case 'rien_a_fournir': return etat === 'rien_a_fournir'
  }
}

/** Les années où le relevé porte un mouvement, la plus récente d'abord (lues sur la date civile, sans fuseau). */
export function anneesDuReleve(mouvements: readonly Pick<MouvementDuClient, 'date'>[]): number[] {
  return [...new Set(mouvements.map((m) => Number(m.date.slice(0, 4))))].sort((a, b) => b - a)
}

// ── Le solde, LU au relevé ────────────────────────────────────────────────────────────────────────────────────────
export type SoldeLu =
  | { etat: 'muet'; motif: string }
  | { etat: 'aucun_releve' }
  | { etat: 'aucun_solde_sur'; releves: number }
  | { etat: 'lu'; solde: number; au: string }

/**
 * Le solde final du relevé le plus récent dont le contrôle de solde est COHÉRENT et la période datée (la fin de période
 * la plus tardive ; à égalité, le contrôle enregistré le dernier). Un relevé incohérent ou sans date ne donne pas de solde :
 * on ne date pas un solde qu'on ne sait pas dater, et on ne montre pas un solde que le relevé lui-même contredit.
 */
export function soldeAuReleve(controles: LectureComplete<Pick<ControleReleveBancaire,
  'id' | 'solde_final' | 'coherent' | 'periode_fin' | 'created_at'>>): SoldeLu {
  if (!controles.complete) return { etat: 'muet', motif: controles.motif ?? 'les relevés contrôlés n’ont pas été lus en entier' }
  if (controles.lignes.length === 0) return { etat: 'aucun_releve' }
  let retenu: (typeof controles.lignes)[number] | null = null
  for (const c of controles.lignes) {
    if (!c.coherent || !c.periode_fin) continue
    if (retenu === null || c.periode_fin > (retenu.periode_fin as string)
      || (c.periode_fin === retenu.periode_fin && chronologique(c, retenu) > 0)) retenu = c
  }
  if (retenu === null) return { etat: 'aucun_solde_sur', releves: controles.lignes.length }
  return { etat: 'lu', solde: retenu.solde_final, au: retenu.periode_fin as string }
}

// ── Les mois que le relevé couvre ─────────────────────────────────────────────────────────────────────────────────
const NOMS_DES_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre',
  'novembre', 'décembre']

/** « mars 2026 » pour « 2026-03 ». */
export function libelleDuMois(mois: string): string {
  return `${NOMS_DES_MOIS[Number(mois.slice(5, 7)) - 1]} ${mois.slice(0, 4)}`
}

export type CouvertureDuReleve =
  | { etat: 'muet'; motif: string }
  | { etat: 'vide' }
  | { etat: 'lue'; premierMois: string; dernierMois: string; moisCouverts: number; moisSansMouvement: string[]; dernierMouvement: string }

/**
 * Les mois (AAAA-MM) où le relevé porte au moins un mouvement — ce que lit aussi `couverture_du_releve` —, son premier et
 * son dernier, et les mois ENTRE les deux sans aucun mouvement : un relevé qui manque, ou un mois sans opération ; le
 * client le sait, pas l'application. Muette sur une lecture partielle des mouvements.
 */
export function couvertureDuReleve(mouvements: LectureComplete<Pick<MouvementDuClient, 'date'>>): CouvertureDuReleve {
  if (!mouvements.complete) return { etat: 'muet', motif: mouvements.motif ?? 'les mouvements n’ont pas été lus en entier' }
  if (mouvements.lignes.length === 0) return { etat: 'vide' }
  const dates = mouvements.lignes.map((m) => m.date).sort()
  const couverts = new Set(dates.map((d) => d.slice(0, 7)))
  const premierMois = dates[0].slice(0, 7)
  const dernierMois = dates[dates.length - 1].slice(0, 7)
  const moisSansMouvement: string[] = []
  let annee = Number(premierMois.slice(0, 4))
  let mois = Number(premierMois.slice(5, 7))
  for (;;) {
    const courant = `${annee}-${String(mois).padStart(2, '0')}`
    if (courant >= dernierMois) break
    if (!couverts.has(courant)) moisSansMouvement.push(courant)
    mois += 1
    if (mois > 12) { mois = 1; annee += 1 }
  }
  return { etat: 'lue', premierMois, dernierMois, moisCouverts: couverts.size, moisSansMouvement, dernierMouvement: dates[dates.length - 1] }
}

// ── Les refus des trois fonctions, dits avant le clic ─────────────────────────────────────────────────────────────
// Chaque liste suit l'ordre de la fonction (migration `banque_du_client`) et ses mots, « % » compris ; banqueClient.test.ts
// les confronte au texte exporté. Le refus 1 dit aussi « dossier inexistant » : l'écran n'en connaît que d'existants.
export const REFUS_PROPOSER = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'mouvement_hors_dossier', refus: 2, modele: "Ce mouvement n'est pas un mouvement de ce dossier." },
  { cle: 'piece_hors_dossier', refus: 3, modele: "Cette pièce n'est pas une pièce de ce dossier." },
  { cle: 'exercice_fige', refus: 4, modele: "% : un justificatif ne s'y propose plus." },
  { cle: 'deja_proposee', refus: 5, modele: 'Cette pièce est déjà proposée pour ce mouvement.' },
] as const

export const REFUS_RETIRER = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'proposition_hors_dossier', refus: 2, modele: "Cette proposition n'est pas une proposition de ce dossier." },
  { cle: 'pas_l_auteur', refus: 3, modele: 'Seuls son auteur et le cabinet retirent cette proposition.' },
  { cle: 'deja_retiree', refus: 4, modele: 'Cette proposition est déjà retirée, depuis le %.' },
] as const

export const REFUS_PRECISION = [
  { cle: 'acces', refus: 1, modele: 'Accès refusé à ce dossier.' },
  { cle: 'mouvement_hors_dossier', refus: 2, modele: "Ce mouvement n'est pas un mouvement de ce dossier." },
  { cle: 'precision_vide', refus: 3, modele: "Une précision vide ne s'écrit pas." },
  { cle: 'precision_trop_longue', refus: 4, modele: 'Une précision tient en 2 000 caractères au plus.' },
] as const

type Refus<L extends readonly { cle: string; refus: number }[]> = { cle: L[number]['cle']; refus: number; message: string }

function refus<L extends readonly { cle: string; refus: number; modele: string }[]>(
  liste: L, cle: L[number]['cle'], ...valeurs: string[]
): Refus<L> {
  const r = liste.find((x) => x.cle === cle) as L[number]
  let i = 0
  return { cle, refus: r.refus, message: r.modele.replace(/%/g, () => valeurs[i++] ?? '%') }
}

// Les blancs que la base ôte d'une précision (`btrim(…, E' \t\n\r')`), et sa longueur en CARACTÈRES, comme `length()` de
// PostgreSQL : une émoticône compte pour un, quand `String.length` de JavaScript la compterait pour deux.
export const BLANCS_D_UNE_PRECISION = ' \t\n\r'
export const LONGUEUR_MAX_PRECISION = 2000
const BLANCS_AUX_BORDS = /^[ \t\n\r]+|[ \t\n\r]+$/g

export function longueurEnCaracteres(texte: string): number {
  return [...texte].length
}

/** Les exercices validés du dossier, tels que l'appelant a pu les lire — le client ne les lit pas. */
export type ExercicesValidesLus = { lus: true; annees: readonly number[] } | { lus: false }

/**
 * Ce que `exercice_fige` dirait de l'année d'un mouvement d'un dossier dont les exercices validés sont `annees` : « validé »
 * quand il l'est, sinon l'exercice validé qui le fige — le premier validé après lui.
 */
export function exerciceFige(annee: number, annees: readonly number[]): string {
  if (annees.includes(annee)) return `L'exercice ${annee} est validé`
  return `L'exercice ${annee} est figé par la validation de l'exercice ${Math.min(...annees.filter((a) => a > annee))}`
}

/** Ce que `proposer_justificatif` refuserait, dans son ordre ; nul si elle accepterait (ce que l'appelant sait lire). */
export function refusDeProposer(c: {
  dossierId: string
  gereLaBanque: boolean
  mouvement: Pick<MouvementDuClient, 'id' | 'dossier_id' | 'date'>
  piece: Pick<PieceDuClient, 'id' | 'dossier_id'>
  // Toutes les propositions du dossier, lues en entier.
  propositions: readonly Pick<JustificatifPropose, 'ligne_bancaire_id' | 'piece_id' | 'retire_le'>[]
  exercicesValides: ExercicesValidesLus
}): Refus<typeof REFUS_PROPOSER> | null {
  if (!c.gereLaBanque) return refus(REFUS_PROPOSER, 'acces')
  if (c.mouvement.dossier_id !== c.dossierId) return refus(REFUS_PROPOSER, 'mouvement_hors_dossier')
  if (c.piece.dossier_id !== c.dossierId) return refus(REFUS_PROPOSER, 'piece_hors_dossier')
  if (c.exercicesValides.lus && c.exercicesValides.annees.length > 0) {
    const frontiere = `${Math.max(...c.exercicesValides.annees)}-12-31`
    if (c.mouvement.date <= frontiere) {
      return refus(REFUS_PROPOSER, 'exercice_fige', exerciceFige(Number(c.mouvement.date.slice(0, 4)), c.exercicesValides.annees))
    }
  }
  if (c.propositions.some((p) => p.ligne_bancaire_id === c.mouvement.id && p.piece_id === c.piece.id && p.retire_le === null)) {
    return refus(REFUS_PROPOSER, 'deja_proposee')
  }
  return null
}

/** Ce que `retirer_proposition` refuserait, dans son ordre ; nul si elle accepterait. */
export function refusDeRetirer(c: {
  dossierId: string
  gereLaBanque: boolean
  proposition: Pick<JustificatifPropose, 'dossier_id' | 'auteur_id' | 'retire_le'>
  // L'identifiant du compte qui retire, et s'il est du cabinet du dossier (`admin_du_dossier`).
  appelant: string
  estCabinet: boolean
}): Refus<typeof REFUS_RETIRER> | null {
  if (!c.gereLaBanque) return refus(REFUS_RETIRER, 'acces')
  if (c.proposition.dossier_id !== c.dossierId) return refus(REFUS_RETIRER, 'proposition_hors_dossier')
  if (c.proposition.auteur_id !== c.appelant && !c.estCabinet) return refus(REFUS_RETIRER, 'pas_l_auteur')
  if (c.proposition.retire_le !== null) {
    // `to_char(retire_le at time zone 'Europe/Paris', 'DD/MM/YYYY')` : le jour À PARIS, où que soit le client.
    const jour = dateAParis(c.proposition.retire_le)
    return refus(REFUS_RETIRER, 'deja_retiree', `${jour.slice(8, 10)}/${jour.slice(5, 7)}/${jour.slice(0, 4)}`)
  }
  return null
}

/** Ce que `ecrire_precision_mouvement` refuserait, dans son ordre ; nul si elle accepterait. */
export function refusDeLaPrecision(c: {
  dossierId: string
  gereLaBanque: boolean
  mouvement: Pick<MouvementDuClient, 'dossier_id'>
  texte: string
}): Refus<typeof REFUS_PRECISION> | null {
  if (!c.gereLaBanque) return refus(REFUS_PRECISION, 'acces')
  if (c.mouvement.dossier_id !== c.dossierId) return refus(REFUS_PRECISION, 'mouvement_hors_dossier')
  if (c.texte.replace(BLANCS_AUX_BORDS, '') === '') return refus(REFUS_PRECISION, 'precision_vide')
  if (longueurEnCaracteres(c.texte) > LONGUEUR_MAX_PRECISION) return refus(REFUS_PRECISION, 'precision_trop_longue')
  return null
}

// ── Les arguments, tels que supabase-js les envoie ────────────────────────────────────────────────────────────────
export function argumentsDeProposer(dossierId: string, mouvementId: string, pieceId: string) {
  return { p_dossier_id: dossierId, p_ligne_bancaire_id: mouvementId, p_piece_id: pieceId }
}

export function argumentsDeRetirer(dossierId: string, propositionId: string) {
  return { p_dossier_id: dossierId, p_proposition_id: propositionId }
}

// Le texte part TEL QUEL : la base l'écrit tel quel (« Le texte s'écrit tel quel »), et ce que le client a tapé — ses
// retours à la ligne compris — est ce que son cabinet lira.
export function argumentsDeLaPrecision(dossierId: string, mouvementId: string, texte: string) {
  return { p_dossier_id: dossierId, p_ligne_bancaire_id: mouvementId, p_texte: texte }
}

// ── Qui a écrit, pour le client ───────────────────────────────────────────────────────────────────────────────────
/** L'auteur d'une proposition ou d'une précision, vu du client : lui, son cabinet, ou un autre accès de sa société. */
export function auteurPourLeClient(ligne: Pick<JustificatifPropose, 'origine' | 'auteur_id'>, moi: string): string {
  if (ligne.origine === 'cabinet') return 'Ton cabinet'
  return ligne.auteur_id === moi ? 'Toi' : 'Un autre accès de ta société'
}
