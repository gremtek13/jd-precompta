import { formatDate, formatMoney } from './format'
import { baremeDeLAnnee, type TypeVehicule } from './baremeKilometrique'
import {
  centimesDesKilometres, depassementDeLaPremiereTranche, MOYENS_DE_REMBOURSEMENT, NATURES_DE_FRAIS, REFUS_DES_NOTES,
  TYPES_DE_VEHICULE, type EtatDeNote, type EtatDuJustificatif, type MoyenDeRemboursement, type NatureDeFrais, type SaisieDeNote,
} from './notesDeFrais'

// LES NOTES DE FRAIS, À L'ÉCRAN : LA RÈGLE ET LES MOTS (espace client, ligne 51.5, étape B8 ; la base : B7, `notes_de_frais`,
// préparée ; ses refus : lib/notesDeFrais.ts). Pur : aucun accès à la base (les lectures sont dans lib/notesDeFraisLecture.ts)
// — il se teste sans client Supabase.
//
// Côté client, « Mes notes de frais » : les notes que la base lui ouvre (les siennes par la case « Notes de frais » ; avec
// « Achats », aussi celles des autres accès dès qu'elles sont soumises), le formulaire d'un brouillon, le justificatif choisi
// parmi les pièces que la base permet de citer, et les gestes que son profil porte. Côté cabinet, la section de l'onglet
// Justificatifs : les notes soumises et la suite, à approuver, refuser sous un motif que l'auteur LIT, déclarer remboursées.
// Jamais une catégorie, un compte ni une écriture : la note d'un salarié au 421 vient après (B7-Q4).

/** « Mes notes de frais » existe-t-il ? Avec la migration, et la case « Notes de frais » OU « Achats » de la société affichée
 *  (relues ensuite à la base). B8-Q1, tranchée par le cabinet le 12/11/2026 : le dirigeant qui n'a que « Achats » approuve,
 *  refuse et rembourse les notes de ses salariés (MEG2-Q6 ; la base de B7 le lui permet déjà) ; la SAISIE d'une note reste à
 *  « Notes de frais » (`saisieOuverte`). */
export function mesNotesDeFraisOuvertes(migrationEnBase: boolean, droits: { frais: boolean; achats: boolean }): boolean {
  return migrationEnBase && (droits.frais || droits.achats)
}

/** La saisie d'une note (« Nouvelle note », un brouillon à soi) : la case « Notes de frais » seule l'ouvre (B8-Q1). */
export function saisieOuverte(droits: { frais: boolean }): boolean {
  return droits.frais
}

/** Dit au dirigeant qui n'a que « Achats » : il décide des notes soumises, il n'en saisit pas. */
export const SANS_LA_SAISIE = 'Ton accès « Achats » te fait approuver, refuser et rembourser les notes soumises à ta société ; '
  + 'pour saisir une note à toi, demande la case « Notes de frais » à ton cabinet.'

/** La liste vide du dirigeant « Achats » seul : la base ne lui rend que les notes SOUMISES par les autres. */
export const AUCUNE_NOTE_A_DECIDER = 'Aucune note de frais ne t’a encore été soumise.'

export const PRESENTATION_DE_MES_NOTES_DE_FRAIS = 'Les dépenses que tu as avancées pour ta société : saisis-les avec leur '
  + 'justificatif, puis soumets-les. Une note soumise ne se modifie plus ; elle est approuvée, puis son remboursement se déclare. '
  + 'Ta comptabilité, c’est ton cabinet qui la tient.'

export const SANS_LA_CASE_FRAIS = 'Ton accès à cette société n’ouvre pas ses notes de frais : demande-le à ton cabinet.'

export const LIBELLES_DES_NATURES: Readonly<Record<NatureDeFrais, string>> = {
  repas: 'Repas', hebergement: 'Hébergement', transport: 'Transport', carburant: 'Carburant',
  peage_stationnement: 'Péage et stationnement', fournitures: 'Fournitures', kilometres: 'Kilomètres', autre: 'Autre',
}

export const MOTS_DE_L_ETAT: Readonly<Record<EtatDeNote, string>> = {
  brouillon: 'Brouillon', soumise: 'Soumise', approuvee: 'Approuvée', refusee: 'Refusée', remboursee: 'Remboursée',
  retiree: 'Retirée',
}

export const LIBELLES_DU_REMBOURSEMENT: Readonly<Record<MoyenDeRemboursement, string>> = {
  virement: 'virement', cheque: 'chèque', especes: 'espèces', paie: 'avec la paie', autre: 'autre',
}

export const LIBELLES_DES_VEHICULES: Readonly<Record<TypeVehicule, string>> = {
  voiture: 'voiture', moto: 'moto', cyclomoteur: 'cyclomoteur',
}

/** Une ligne de `notes_de_frais`, telle que les écrans la lisent. */
export interface NoteDeFrais {
  id: string
  dossier_id: string
  auteur: string
  beneficiaire_salarie: string | null
  date_depense: string
  nature: NatureDeFrais
  motif: string
  montant_ttc: number
  montant_tva: number
  distance_km: number | null
  vehicule_type: TypeVehicule | null
  puissance_fiscale: number | null
  electrique: boolean | null
  piece_id: string | null
  etat: EtatDeNote
  version: number
  cree_le: string
  soumise_le: string | null
  approuvee_le: string | null
  refusee_le: string | null
  motif_refus: string | null
  remboursee_le: string | null
  date_remboursement: string | null
  moyen_remboursement: MoyenDeRemboursement | null
}

/** Une pièce que l'auteur a déposée dans le dossier : ce que la liste des justificatifs en dit. */
export interface PieceDeLAuteur {
  id: string
  dossier_id: string
  nom_fichier: string
  statut: string
  uploaded_by: string | null
  date_piece: string | null
  montant_ttc: number | null
  created_at: string
}

/** Les notes à montrer — un brouillon retiré ne se montre plus —, les plus récentes d'abord (date de la dépense, puis
 *  création, puis identifiant : un ordre total). */
export function notesAMontrer(notes: readonly NoteDeFrais[]): NoteDeFrais[] {
  return notes.filter((n) => n.etat !== 'retiree').sort((a, b) =>
    b.date_depense.localeCompare(a.date_depense) || b.cree_le.localeCompare(a.cree_le) || a.id.localeCompare(b.id))
}

const citeeParUneAutre = (pieceId: string, notes: readonly NoteDeFrais[], noteId: string | null) =>
  notes.some((n) => n.piece_id === pieceId && n.id !== noteId)

/**
 * Les pièces que la base laisse citer par la note `noteId` (nulle : une note neuve), sur des listes LUES EN ENTIER : déposées
 * par l'auteur dans ce dossier, encore à valider, qu'aucune autre note ne cite (B7-Q2). Les plus récentes d'abord.
 */
export function justificatifsCitables(
  pieces: readonly PieceDeLAuteur[], notes: readonly NoteDeFrais[], moi: string, dossierId: string, noteId: string | null,
): PieceDeLAuteur[] {
  return pieces
    .filter((p) => p.dossier_id === dossierId && p.uploaded_by === moi && p.statut === 'a_valider' && !citeeParUneAutre(p.id, notes, noteId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
}

/** Ce que l'écran sait du justificatif choisi, pour `refusDeLaSaisie` ; nul quand aucun n'est choisi. */
export function etatDuJustificatif(
  pieceId: string | null, pieces: readonly PieceDeLAuteur[], notes: readonly NoteDeFrais[], moi: string, dossierId: string,
  noteId: string | null,
): EtatDuJustificatif | null {
  if (pieceId === null) return null
  const piece = pieces.find((p) => p.id === pieceId)
  return {
    deposeParLAuteurDansCeDossier: piece !== undefined && piece.uploaded_by === moi && piece.dossier_id === dossierId,
    aValider: piece?.statut === 'a_valider',
    citeParUneAutreNote: citeeParUneAutre(pieceId, notes, noteId),
  }
}

// ── Le formulaire d'un brouillon ──────────────────────────────────────────────────────────────────────────────────────
export interface FormulaireDeNote {
  /** Nuls : une note neuve. */
  noteId: string | null
  versionLue: number | null
  pourUnSalarie: boolean
  salarie: string
  date: string
  nature: string
  motif: string
  ttc: string
  tva: string
  pieceId: string
  distance: string
  vehicule: string
  puissance: string
  electrique: '' | 'oui' | 'non'
}

export function formulaireNeuf(aujourdhui: string): FormulaireDeNote {
  return {
    noteId: null, versionLue: null, pourUnSalarie: false, salarie: '', date: aujourdhui, nature: '', motif: '', ttc: '', tva: '',
    pieceId: '', distance: '', vehicule: '', puissance: '', electrique: '',
  }
}

const enTexte = (m: number | null) => (m === null ? '' : String(m).replace('.', ','))

/** Le formulaire d'un brouillon lu : la version lue retenue, que l'écriture remplacera. */
export function formulaireDeLaNote(n: NoteDeFrais): FormulaireDeNote {
  return {
    noteId: n.id, versionLue: n.version, pourUnSalarie: n.beneficiaire_salarie !== null, salarie: n.beneficiaire_salarie ?? '',
    date: n.date_depense, nature: n.nature, motif: n.motif, ttc: n.nature === 'kilometres' ? '' : enTexte(n.montant_ttc),
    tva: n.nature === 'kilometres' || n.montant_tva === 0 ? '' : enTexte(n.montant_tva), pieceId: n.piece_id ?? '',
    distance: n.distance_km === null ? '' : String(n.distance_km), vehicule: n.vehicule_type ?? '',
    puissance: n.puissance_fiscale === null ? '' : String(n.puissance_fiscale),
    electrique: n.electrique === null ? '' : n.electrique ? 'oui' : 'non',
  }
}

/** Un montant saisi, virgule ou point ; nul s'il n'en a pas la forme (le refus le dira : jamais un zéro inventé). */
export function montantDuTexte(texte: string): number | null {
  const t = texte.trim().replace(/\s/g, '')
  if (!/^\d+([.,]\d+)?$/.test(t)) return null
  return Number(t.replace(',', '.'))
}

/** Un entier saisi ; NaN s'il n'en a pas la forme (le refus le dira), nul s'il est vide. */
function entierDuTexte(texte: string): number | null {
  const t = texte.trim()
  if (t === '') return null
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Le montant des kilomètres au barème de l'année de la dépense, en euros ; nul tant que la saisie ne le permet pas, ou quand
 *  le barème de l'année manque pour ce véhicule (jamais celui d'une autre année). */
export function montantDesKilometres(f: FormulaireDeNote): number | null {
  const distance = entierDuTexte(f.distance)
  const puissance = entierDuTexte(f.puissance)
  if (!DATE.test(f.date) || distance === null || !Number.isInteger(distance) || distance < 1 || distance > 100_000) return null
  if (!(TYPES_DE_VEHICULE as readonly string[]).includes(f.vehicule) || puissance === null || !Number.isInteger(puissance)
    || puissance > 99 || f.electrique === '') return null
  const centimes = centimesDesKilometres(f.date, distance, {
    type: f.vehicule as TypeVehicule, puissanceFiscale: puissance, electrique: f.electrique === 'oui',
  })
  return centimes === null ? null : Number(centimes) / 100
}

/**
 * La saisie TELLE QU'ELLE PART vers `enregistrer_note_de_frais` : pour des kilomètres, le montant du barème, ni TVA ni
 * justificatif ; sinon, ni distance ni véhicule — un champ devenu sans objet part nul, dans la même écriture.
 */
export function saisieDuFormulaire(f: FormulaireDeNote): SaisieDeNote {
  const kilometres = f.nature === 'kilometres'
  return {
    dateDepense: f.date === '' ? null : f.date,
    nature: f.nature === '' ? null : f.nature,
    motif: f.motif === '' ? null : f.motif,
    montantTtc: kilometres ? montantDesKilometres(f) : montantDuTexte(f.ttc),
    montantTva: kilometres || f.tva.trim() === '' ? null : (montantDuTexte(f.tva) ?? Number.NaN),
    beneficiaireSalarie: f.pourUnSalarie ? f.salarie : null,
    pieceId: kilometres || f.pieceId === '' ? null : f.pieceId,
    distanceKm: kilometres ? entierDuTexte(f.distance) : null,
    vehicule: kilometres
      ? {
        type: f.vehicule === '' ? null : f.vehicule, puissanceFiscale: entierDuTexte(f.puissance),
        electrique: f.electrique === '' ? null : f.electrique === 'oui',
      }
      : null,
  }
}

/** Les paramètres de `enregistrer_note_de_frais`, tirés de la saisie telle qu'elle part. */
export function parametresDeLEnregistrement(dossierId: string, f: FormulaireDeNote, s: SaisieDeNote): Record<string, unknown> {
  return {
    p_dossier_id: dossierId, p_note_id: f.noteId, p_version_lue: f.versionLue, p_date: s.dateDepense, p_nature: s.nature,
    p_motif: s.motif, p_montant_ttc: s.montantTtc, p_montant_tva: s.montantTva, p_beneficiaire_salarie: s.beneficiaireSalarie,
    p_piece_id: s.pieceId, p_distance_km: s.distanceKm, p_vehicule_type: s.vehicule?.type ?? null,
    p_puissance_fiscale: s.vehicule?.puissanceFiscale ?? null, p_electrique: s.vehicule?.electrique ?? null,
  }
}

// ── Les kilomètres de l'année et la première tranche (B7-Q3) ─────────────────────────────────────────────────────────────
// Chaque note se calcule au barème appliqué à SA distance, ce qui ne vaut que tant que le cumul de l'année de la même
// personne, pour ce type de véhicule, reste dans la première tranche. Au-delà, l'écran le SIGNALE ; rien ne se recalcule.

/** La personne d'une note : son auteur, ou le salarié qu'il saisit. */
const memePersonne = (a: Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie'>, b: Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie'>) =>
  a.auteur === b.auteur && a.beneficiaire_salarie === b.beneficiaire_salarie

/** Les kilomètres de l'année d'une personne pour un type de véhicule, des notes lues — ni retirées, ni refusées —, sans la
 *  note `sauf` (celle que le formulaire remplace). */
export function cumulDesKilometres(
  notes: readonly NoteDeFrais[], personne: Pick<NoteDeFrais, 'auteur' | 'beneficiaire_salarie'>, annee: number, type: TypeVehicule,
  sauf: string | null,
): number {
  return notes
    .filter((n) => n.id !== sauf && n.nature === 'kilometres' && n.etat !== 'retiree' && n.etat !== 'refusee'
      && n.vehicule_type === type && Number(n.date_depense.slice(0, 4)) === annee && memePersonne(n, personne))
    .reduce((s, n) => s + (n.distance_km ?? 0), 0)
}

/** Le signal de la première tranche, ou nul : au-delà de sa borne, le calcul note par note ne vaut plus. */
export function signalDeLaTranche(annee: number, type: TypeVehicule, cumulKm: number, espace: 'client' | 'cabinet'): string | null {
  if (depassementDeLaPremiereTranche(annee, type, cumulKm) !== true) return null
  const borne = baremeDeLAnnee(annee)?.lignes.find((l) => l.type === type)?.tranches[0]?.jusqua
  const qui = espace === 'client' ? 'ton cabinet régularise' : 'le cabinet régularise'
  return `${cumulKm.toLocaleString('fr-FR')} km en ${annee} pour ce type de véhicule : au-delà de la première tranche du barème `
    + `(${(borne ?? 0).toLocaleString('fr-FR')} km), le calcul note par note ne vaut plus, et ${qui} sur l’année.`
}

/** Le signal d'une note de kilomètres lue, sur le cumul de toute l'année des notes lues ; nul pour une autre note. */
export function signalDeLaNote(note: NoteDeFrais, notes: readonly NoteDeFrais[], espace: 'client' | 'cabinet'): string | null {
  if (note.nature !== 'kilometres' || note.vehicule_type === null || note.etat === 'retiree' || note.etat === 'refusee') return null
  const annee = Number(note.date_depense.slice(0, 4))
  return signalDeLaTranche(annee, note.vehicule_type, cumulDesKilometres(notes, note, annee, note.vehicule_type, null), espace)
}

// ── Les gestes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface GestesDeLaNote {
  modifier: boolean
  soumettre: boolean
  retirer: boolean
  approuver: boolean
  refuser: boolean
  rembourser: boolean
}

/**
 * Ce que l'appelant peut faire de la note, aux règles des six fonctions : son brouillon, son auteur (« Achats » en plus pour
 * celui d'un salarié) ; une note soumise, l'approuver ou la refuser, une approuvée, la rembourser — l'accès « Achats » ou le
 * cabinet. `frais` et `achats` sont les cases relues à la base ; le cabinet n'en a pas.
 */
export function gestesDeLaNote(
  note: NoteDeFrais, appelant: { moi: string; cabinet: boolean; frais: boolean; achats: boolean },
): GestesDeLaNote {
  const sonBrouillon = !appelant.cabinet && note.etat === 'brouillon' && note.auteur === appelant.moi && appelant.frais
    && (note.beneficiaire_salarie === null || appelant.achats)
  const decide = appelant.cabinet || appelant.achats
  return {
    modifier: sonBrouillon, soumettre: sonBrouillon, retirer: sonBrouillon,
    approuver: decide && note.etat === 'soumise', refuser: decide && note.etat === 'soumise',
    rembourser: decide && note.etat === 'approuvee',
  }
}

/** Ce que `soumettre_note_de_frais` refuserait d'un brouillon lu, après l'accès, l'état et la version : le barème des
 *  kilomètres, ou le justificatif — absent, ou validé depuis. Nul : rien à redire. */
export function refusDeLaSoumission(note: NoteDeFrais, pieces: readonly PieceDeLAuteur[]): string | null {
  const R = REFUS_DES_NOTES
  const annee = Number(note.date_depense.slice(0, 4))
  if (note.nature === 'kilometres') {
    if (note.distance_km === null || note.vehicule_type === null || note.puissance_fiscale === null || note.electrique === null) {
      return R.vehicule
    }
    const centimes = centimesDesKilometres(note.date_depense, note.distance_km, {
      type: note.vehicule_type, puissanceFiscale: note.puissance_fiscale, electrique: note.electrique,
    })
    if (centimes === null) return R.baremeAbsent(annee)
    if (BigInt(Math.round(note.montant_ttc * 100)) !== centimes) return R.baremeChange(annee)
    return null
  }
  if (note.piece_id === null) return R.sansJustificatif
  const piece = pieces.find((p) => p.id === note.piece_id)
  if (piece !== undefined && piece.statut !== 'a_valider') return R.justificatifValide
  return null
}

const uneLigne = (t: string, max: number) => t.replace(/^ +| +$/g, '') !== '' && t.length <= max && !/\p{Cc}/u.test(t)

/** Ce que `refuser_note_de_frais` refuserait du motif saisi ; nul : rien à redire. */
export function refusDuMotifDeRefus(motif: string): string | null {
  return uneLigne(motif, 200) ? null : REFUS_DES_NOTES.motifDuRefus
}

/** Ce que `rembourser_note_de_frais` refuserait : la date (entre la dépense et aujourd'hui, au jour de Paris), puis le moyen. */
export function refusDuRemboursement(note: NoteDeFrais, date: string, moyen: string, aujourdhui: string): string | null {
  if (!DATE.test(date) || date < note.date_depense || date > aujourdhui) return REFUS_DES_NOTES.dateDuRemboursement
  if (!(MOYENS_DE_REMBOURSEMENT as readonly string[]).includes(moyen)) return REFUS_DES_NOTES.moyenDuRemboursement
  return null
}

// ── Les mots ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Le nom d'une note : sa nature, sa date et son motif — ce qu'une confirmation NOMME. */
export function nomDeLaNote(n: Pick<NoteDeFrais, 'nature' | 'date_depense' | 'motif'>): string {
  return `${LIBELLES_DES_NATURES[n.nature]} du ${formatDate(n.date_depense)} — « ${n.motif} »`
}

/** Le détail d'une note de kilomètres : la distance et le véhicule ; nul pour une autre note. */
export function detailDesKilometres(n: NoteDeFrais): string | null {
  if (n.nature !== 'kilometres' || n.distance_km === null || n.vehicule_type === null) return null
  return `${n.distance_km.toLocaleString('fr-FR')} km en ${LIBELLES_DES_VEHICULES[n.vehicule_type]} de ${n.puissance_fiscale ?? '?'} CV`
    + `${n.electrique ? ', électrique' : ''}, au barème de ${n.date_depense.slice(0, 4)}`
}

/** Pour qui, et par qui, dit au client : lui, un salarié qu'il saisit, ou un autre accès de la société — jamais un nom de
 *  compte. */
export function personneDiteAuClient(n: NoteDeFrais, moi: string): string {
  const par = n.auteur === moi ? 'toi' : 'un autre accès de ta société'
  if (n.beneficiaire_salarie !== null) return `Pour ${n.beneficiaire_salarie}, saisie par ${par}`
  return n.auteur === moi ? 'Ta note' : 'La note d’un autre accès de ta société'
}

/** Pour qui, dit au cabinet. */
export function personneDiteAuCabinet(n: NoteDeFrais): string {
  return n.beneficiaire_salarie !== null
    ? `Pour le salarié ${n.beneficiaire_salarie}, saisie par un accès du client`
    : 'Saisie par un accès du client, pour lui-même'
}

/** Les passages de la note, datés : chacun s'ajoute, rien ne se réécrit. */
export function passagesDeLaNote(n: NoteDeFrais): string[] {
  const p: string[] = []
  if (n.soumise_le !== null) p.push(`soumise le ${formatDate(n.soumise_le)}`)
  if (n.approuvee_le !== null) p.push(`approuvée le ${formatDate(n.approuvee_le)}`)
  if (n.refusee_le !== null) p.push(`refusée le ${formatDate(n.refusee_le)} : « ${n.motif_refus ?? ''} »`)
  if (n.date_remboursement !== null && n.moyen_remboursement !== null) {
    p.push(`remboursée le ${formatDate(n.date_remboursement)}, ${n.moyen_remboursement === 'paie' ? '' : 'par '}${LIBELLES_DU_REMBOURSEMENT[n.moyen_remboursement]}`)
  }
  return p
}

const montantDit = (n: NoteDeFrais) => formatMoney(n.montant_ttc)

export function confirmationDeLaSoumission(n: NoteDeFrais): string {
  return `Soumettre la note ${nomDeLaNote(n)}, de ${montantDit(n)} ? Soumise, elle ne se modifie plus et ne se retire plus.`
}

export function confirmationDuRetrait(n: NoteDeFrais, nomDuJustificatif: string | null): string {
  return `Retirer le brouillon ${nomDeLaNote(n)}, de ${montantDit(n)} ? Il ne s’affichera plus`
    + (nomDuJustificatif !== null ? `, et le justificatif « ${nomDuJustificatif} » pourra justifier une autre note.` : '.')
}

export function confirmationDeLApprobation(n: NoteDeFrais): string {
  return `Approuver la note ${nomDeLaNote(n)}, de ${montantDit(n)} ? Approuvée, elle attend la déclaration de son remboursement.`
}

export function confirmationDuRefus(n: NoteDeFrais, motif: string): string {
  return `Refuser la note ${nomDeLaNote(n)}, de ${montantDit(n)}, sous le motif « ${motif} » ? Son auteur lira ce motif ; `
    + 'le refus ne se défait pas.'
}

export function confirmationDuRemboursement(n: NoteDeFrais, date: string, moyen: MoyenDeRemboursement): string {
  return `Déclarer remboursée la note ${nomDeLaNote(n)}, de ${montantDit(n)}, le ${formatDate(date)}, `
    + `${moyen === 'paie' ? '' : 'par '}${LIBELLES_DU_REMBOURSEMENT[moyen]} ? C’est une déclaration : rien ne s’écrit dans le relevé, `
    + 'la caisse ni les écritures.'
}

/** Les natures, dans l'ordre de la liste fermée, avec leurs libellés. */
export const NATURES_PROPOSEES = NATURES_DE_FRAIS.map((n) => ({ valeur: n, libelle: LIBELLES_DES_NATURES[n] }))
