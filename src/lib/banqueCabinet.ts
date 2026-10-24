// « MA BANQUE », CÔTÉ CABINET : CE QUE LE CLIENT A ENVOYÉ POUR UN MOUVEMENT (espace client, étape P9b ; conception :
// HISTORIQUE.md, « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.5, §2.6, §2.7 et §6.3 ;
// la base : migration `banque_du_client`, étape P7 ; l'écran du client : P9a, lib/banqueClient.ts).
//
// Le client qui porte la case « Banque » PROPOSE une pièce pour un mouvement (`justificatifs_proposes`) et répond aux
// questions du cabinet (`precisions_mouvements`). Le rapprochement reste au cabinet (§2.6) : la proposition n'écrit RIEN
// dans le relevé, et ce module ne fait que dire au cabinet ce qui a été proposé, par qui, et ce qu'il en advient.
//
// CE MODULE EST PUR (aucun import de `supabase.ts` ; la lecture est dans banqueCabinetLecture.ts). Quatre règles :
//  1. Rien ne se dit d'une lecture qui n'est pas revenue EN ENTIER : propositions et fil se lisent ensemble, et une liste
//     tronquée ferait dire « rien de proposé » d'un mouvement qui a une pièce envoyée.
//  2. L'origine (« client » ou « cabinet ») est celle que la BASE a écrite, déduite de l'appelant (`admin_du_dossier` au
//     moment de l'écriture) : on la lit, on ne la recalcule pas. Le compte, lui, se reconnaît parmi les accès du dossier
//     lus en entier, comme « par le client » des ventes (lib/auteursVentes.ts) — jamais deviné : un compte qui ne porte
//     plus d'accès se dit tel, et sur des accès pas lus en entier, aucun compte n'est reconnu.
//  3. Ce qu'il advient d'une proposition se LIT dans ce qui est en base — le mouvement rapproché de sa pièce, classé
//     autrement, figé ; sa pièce payée ailleurs, figée, absente — et se dit. Elle ne disparaît jamais d'elle-même : le
//     rapprochement ne la retire pas, et elle reste datée au registre.
//  4. Le filtre « Proposés par le client » ne change que la liste AFFICHÉE ; une case cochée sur une lecture qui cesse
//     d'être entière ne filtre plus.
import { sensCoherent } from './appariementBanque'
import { estLeClient, type AccesDuDossier, type EtatDuFiltre } from './auteursVentes'
import { etatDuMouvement, LIBELLE_DE_L_ETAT, refusDeRetirer } from './banqueClient'
import { formatDate, formatMoney } from './format'
import { NE_S_ASSOCIE_PAS } from './lotsDeLaJumelleInversee'
import type { PaiementDePiece } from './rattachement'
import type { JustificatifPropose, LigneBancaire, Piece, PrecisionMouvement } from './types'

// ── Les envois du client, lus pour le dossier ─────────────────────────────────────────────────────────────────────
export type EnvoisDuClient =
  // Pas encore revenus — la première lecture comme une relecture.
  | { etat: 'en_cours' }
  // Lus en partie, ou refusés : le motif, tel que `lireTout` le donne.
  | { etat: 'incomplets'; motif: string }
  | { etat: 'lus'; propositions: readonly JustificatifPropose[]; precisions: readonly PrecisionMouvement[] }

export const ENVOIS_EN_COURS: EnvoisDuClient = { etat: 'en_cours' }

/** Ce que `lireTout` rend d'une collection, réduit à ce dont ce module a besoin. */
export interface LectureDeLignes<T> {
  lignes: readonly T[]
  complete: boolean
  motif: string | null
}

/**
 * Les deux lectures, jugées ENSEMBLE : l'une partielle, rien ne se dit — même des lignes revenues, car une liste tronquée
 * ne dit pas ce qui manque.
 */
export function envoisDeLaLecture(
  propositions: LectureDeLignes<JustificatifPropose>, precisions: LectureDeLignes<PrecisionMouvement>,
): EnvoisDuClient {
  if (!propositions.complete) {
    return { etat: 'incomplets', motif: `les pièces proposées n’ont pas été lues en entier (${propositions.motif ?? 'lecture incomplète'})` }
  }
  if (!precisions.complete) {
    return { etat: 'incomplets', motif: `le fil des mouvements n’a pas été lu en entier (${precisions.motif ?? 'lecture incomplète'})` }
  }
  return { etat: 'lus', propositions: propositions.lignes, precisions: precisions.lignes }
}

/** Pourquoi rien ne se dit des envois, ou null quand ils sont lus en entier. */
export function silenceDesEnvois(envois: EnvoisDuClient): string | null {
  switch (envois.etat) {
    case 'lus': return null
    case 'en_cours': return 'Les pièces proposées par le client et le fil sont en cours de lecture.'
    case 'incomplets': return `Rien n’est dit de ce que le client a envoyé : ${envois.motif}. Recharge la page.`
  }
}

// ── Les accès du dossier, pour reconnaître le client et savoir qui lira une question ──────────────────────────────────
export interface AccesDuReleve {
  acces: AccesDuDossier
  // Les accès qui portent la case « Banque », sur une liste lue en entier ; nul sinon.
  avecBanque: number | null
}

export const ACCES_DU_RELEVE_EN_COURS: AccesDuReleve = { acces: { etat: 'en_cours' }, avecBanque: null }

/** La lecture des accès, jugée : entière, les comptes et le nombre d'accès « Banque » ; sinon son motif seul. */
export function accesDuReleveDeLaLecture(
  lecture: LectureDeLignes<{ user_id: string | null; droit_banque: boolean }>,
): AccesDuReleve {
  if (!lecture.complete) return { acces: { etat: 'incomplets', motif: lecture.motif ?? 'lecture incomplète' }, avecBanque: null }
  const comptes = [...new Set(
    lecture.lignes.map((l) => l.user_id).filter((c): c is string => typeof c === 'string' && c !== ''),
  )]
  return { acces: { etat: 'lus', comptes }, avecBanque: lecture.lignes.filter((l) => l.droit_banque === true).length }
}

/**
 * Qui lira la question : sur des accès lus en entier dont aucun ne porte la case « Banque », personne — la base l'écrit
 * quand même (le cabinet gère la banque du dossier), et on le dit avant le clic. Rien sur des accès pas lus en entier.
 */
export function lecteursDeLaQuestion(acces: AccesDuReleve): string | null {
  if (acces.avecBanque !== 0) return null
  return 'Aucun accès de ce dossier ne porte la case « Banque » : personne ne lira cette question dans l’espace client tant '
    + 'que la case n’est pas cochée (onglet Accès).'
}

// ── Qui a écrit ───────────────────────────────────────────────────────────────────────────────────────────────────
// Ce qui suit l'origine que la base a écrite : le compte reconnu parmi les accès, ou ce qu'on en sait.
function precisionSurLeCompte(acces: AccesDuDossier): string {
  switch (acces.etat) {
    case 'lus': return ', par un compte qui ne porte plus d’accès à ce dossier'
    case 'en_cours': return ' (les accès du dossier sont en cours de lecture)'
    case 'incomplets': return ' (les accès du dossier n’ont pas été lus en entier : le compte n’est pas reconnu)'
    case 'sans_objet': return ''
  }
}

/** « Proposée par le client le … », ou ce qu'on sait de son auteur. */
export function phraseDeLaProposition(acces: AccesDuDossier, p: Pick<JustificatifPropose, 'origine' | 'auteur_id' | 'created_at'>): string {
  const le = formatDate(p.created_at)
  if (p.origine === 'cabinet') return `Proposée par le cabinet le ${le}`
  if (estLeClient(acces, p.auteur_id)) return `Proposée par le client le ${le}`
  return `Proposée depuis l’espace client le ${le}${precisionSurLeCompte(acces)}`
}

/**
 * Le retrait d'une proposition. `retirer_proposition` n'admet que son auteur ou le cabinet du dossier (son refus 3) : un
 * retrait qui n'est pas de l'auteur est donc du cabinet — la règle de la base, pas une supposition.
 */
export function phraseDuRetrait(p: Pick<JustificatifPropose, 'auteur_id' | 'retire_le' | 'retire_par'>): string | null {
  if (p.retire_le === null) return null
  return `retirée le ${formatDate(p.retire_le)} ${p.retire_par === p.auteur_id ? 'par son auteur' : 'par le cabinet'}`
}

/** L'auteur d'un message du fil, vu du cabinet. */
export function auteurDuMessage(acces: AccesDuDossier, q: Pick<PrecisionMouvement, 'origine' | 'auteur_id'>): string {
  if (q.origine === 'cabinet') return 'Le cabinet'
  if (estLeClient(acces, q.auteur_id)) return 'Le client'
  if (acces.etat === 'lus') return 'Depuis l’espace client, un compte qui ne porte plus d’accès à ce dossier'
  return 'Depuis l’espace client'
}

// ── Ce qui a été envoyé pour UN mouvement ─────────────────────────────────────────────────────────────────────────
export interface EnvoisDuMouvement {
  // Les propositions NON RETIRÉES, la plus récente d'abord : c'est la dernière envoyée que le cabinet regarde en premier.
  courantes: JustificatifPropose[]
  // Les retirées, la plus récente d'abord : elles restent, datées.
  retirees: JustificatifPropose[]
  // Le fil, dans l'ordre où il s'est écrit.
  fil: PrecisionMouvement[]
  // Le dernier message du fil vient du cabinet : sa question attend la réponse du client.
  questionEnAttente: boolean
}

// L'ordre d'écriture : l'instant, puis l'identifiant pour départager deux lignes du même instant.
function chronologique<T extends { created_at: string; id: string }>(a: T, b: T): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function envoisDuMouvement(
  envois: Extract<EnvoisDuClient, { etat: 'lus' }>, mouvementId: string,
): EnvoisDuMouvement {
  const siennes = envois.propositions.filter((p) => p.ligne_bancaire_id === mouvementId).sort((a, b) => chronologique(b, a))
  const fil = envois.precisions.filter((q) => q.ligne_bancaire_id === mouvementId).sort(chronologique)
  return {
    courantes: siennes.filter((p) => p.retire_le === null),
    retirees: siennes.filter((p) => p.retire_le !== null),
    fil,
    questionEnAttente: fil.length > 0 && fil[fil.length - 1].origine === 'cabinet',
  }
}

/** Le titre de la section : « par le client » quand toutes les propositions courantes viennent de son espace. */
export function titreDesPropositions(courantes: readonly Pick<JustificatifPropose, 'origine'>[]): string {
  const n = courantes.length
  if (courantes.every((p) => p.origine === 'client')) {
    return n === 1 ? 'Pièce proposée par le client' : `${n} pièces proposées par le client`
  }
  return n === 1 ? 'Pièce proposée pour ce mouvement' : `${n} pièces proposées pour ce mouvement`
}

/** Ce que l'écran du client dit de ce mouvement aujourd'hui (« Ma banque », lib/banqueClient.ts), avec ses mots. */
export function ceQueVoitLeClient(
  ligne: Parameters<typeof etatDuMouvement>[0], envoisDuMouv: Pick<EnvoisDuMouvement, 'courantes' | 'questionEnAttente'>,
): string {
  return LIBELLE_DE_L_ETAT[etatDuMouvement(ligne, envoisDuMouv.courantes.length, envoisDuMouv.questionEnAttente)]
}

// ── Écarter une proposition, supprimer un message (P9b2) ─────────────────────────────────────────────────────────────
// Deux gestes du cabinet, décidés le 11/10/2026 (P9B-Q1 et P9B-Q2), qui n'ajoutent rien à la base : `retirer_proposition`
// (la proposition reste au registre, datée) et la policy `precisions_mouvements_suppression_cabinet` (le message disparaît).
// Ce module dit ce qui précède le clic ; l'écriture est dans BanqueTab, sous le verrou des écritures de l'écran.

/**
 * « Écarter cette proposition » est offert sur la pièce que le CLIENT a proposée et que rien ne retient : un mouvement
 * rapproché de cette pièce la garde, et l'écarter ne dirait rien de juste. Sur un mouvement classé autrement ou figé elle
 * reste offerte — la proposition y reste sinon au registre, et le filtre « Proposés par le client » la montre encore.
 */
export function ecartable(p: Pick<JustificatifPropose, 'origine' | 'retire_le'>, etat: EtatDeLaProposition): boolean {
  return p.origine === 'client' && p.retire_le === null && etat.etat !== 'retenue'
}

/**
 * Ce que `retirer_proposition` refuserait au cabinet, avec les mots de la fonction (`REFUS_RETIRER`, confrontés à son texte
 * par banqueClient.test.ts) : une proposition d'un autre dossier, déjà retirée — et depuis quand. Le cabinet du dossier
 * passe l'accès (refus 1) et le refus d'auteur (3) : ils ne sont pas à redire ici.
 */
export function refusDEcarter(
  dossierId: string, p: Pick<JustificatifPropose, 'dossier_id' | 'auteur_id' | 'retire_le'>,
): string | null {
  return refusDeRetirer({ dossierId, gereLaBanque: true, proposition: p, appelant: '', estCabinet: true })?.message ?? null
}

/**
 * La confirmation de l'écart. Ce que le client verra ensuite de ce mouvement est TIRÉ de `etatDuMouvement`, sur les
 * propositions qui resteront : jamais écrit à la main, il suit l'écran du client. Une proposition retirée ne prévient
 * personne — la phrase dit où écrire pour expliquer pourquoi.
 */
export function confirmationDEcarter(
  ligne: Parameters<typeof etatDuMouvement>[0], siens: Pick<EnvoisDuMouvement, 'courantes' | 'questionEnAttente'>,
  proposition: Pick<JustificatifPropose, 'id'>, nomDeLaPiece: string,
): string {
  const aujourdhui = ceQueVoitLeClient(ligne, siens)
  const ensuite = ceQueVoitLeClient(ligne, {
    courantes: siens.courantes.filter((p) => p.id !== proposition.id), questionEnAttente: siens.questionEnAttente,
  })
  const vu = ensuite === aujourdhui
    ? `Dans « Ma banque », le client verra toujours ce mouvement « ${ensuite} ».`
    : `Dans « Ma banque », le client verra ensuite ce mouvement « ${ensuite} » (il le voit aujourd’hui « ${aujourdhui} »).`
  return `Écarter la pièce « ${nomDeLaPiece} », proposée par le client, pour ce mouvement ?\n\n${vu}\n\n`
    + 'La pièce reste dans ses pièces ; la proposition reste au registre, retirée par le cabinet et datée. Le client n’en est '
    + 'pas prévenu : pour lui dire pourquoi, écris-lui dans le fil, sous « Échanges avec le client ».'
}

const LONGUEUR_DES_PREMIERS_MOTS = 60

/** Les premiers mots d'un message : les blancs ramenés à une espace, coupés entre deux mots, « … » quand il y a plus. */
export function premiersMots(texte: string): string {
  const mots = texte.split(/\s+/).filter((m) => m !== '')
  let resume = ''
  for (const mot of mots) {
    const suite = resume === '' ? mot : `${resume} ${mot}`
    if (resume !== '' && [...suite].length > LONGUEUR_DES_PREMIERS_MOTS) return `${resume}…`
    resume = suite
  }
  // Un premier mot plus long que la limite se coupe, sinon la confirmation déborderait de la fenêtre.
  const caracteres = [...resume]
  return caracteres.length > LONGUEUR_DES_PREMIERS_MOTS ? `${caracteres.slice(0, LONGUEUR_DES_PREMIERS_MOTS).join('')}…` : resume
}

/**
 * La confirmation de la suppression d'un message : elle le NOMME (qui, quand, ses premiers mots), dit que le client ne le
 * verra plus et que c'est définitif. Quand le message supprimé est la dernière question en attente, le client verra
 * le mouvement autrement : la phrase le dit, tirée de `etatDuMouvement` comme celle de l'écart.
 */
export function confirmationDeSupprimer(
  ligne: Parameters<typeof etatDuMouvement>[0], acces: AccesDuDossier, siens: EnvoisDuMouvement, message: PrecisionMouvement,
): string {
  const restant = siens.fil.filter((q) => q.id !== message.id)
  const aujourdhui = ceQueVoitLeClient(ligne, siens)
  const ensuite = ceQueVoitLeClient(ligne, {
    courantes: siens.courantes, questionEnAttente: restant.length > 0 && restant[restant.length - 1].origine === 'cabinet',
  })
  const vu = ensuite === aujourdhui ? '' : ` Dans « Ma banque », il verra ensuite ce mouvement « ${ensuite} » (il le voit aujourd’hui « ${aujourdhui} »).`
  return `Supprimer ce message du fil ?\n\n${auteurDuMessage(acces, message)}, le ${formatDate(message.created_at)} : `
    + `« ${premiersMots(message.texte)} »\n\nLe client ne le verra plus.${vu} La suppression est définitive : le message ne se récupère pas.`
}

// ── Ce qu'il advient d'une proposition ────────────────────────────────────────────────────────────────────────────
export type EtatDeLaProposition =
  // Le mouvement est rapproché de CETTE pièce (seule, ou parmi les parts d'un virement qui en règle plusieurs).
  | { etat: 'retenue' }
  // Le mouvement est classé autrement : rapproché d'autre chose, ignoré, virement personnel.
  | { etat: 'mouvement_classe' }
  // Un exercice validé fige le mouvement : plus rien ne s'y rapproche.
  | { etat: 'mouvement_fige'; figeePar: string }
  // La pièce ne figure pas parmi les pièces lues.
  | { etat: 'piece_non_lue'; lecturePartielle: boolean }
  // La pièce est l'exemplaire d'une facture source de sa vente (étape VF6d) : la base refuse qu'elle soit rapprochée (G4) ;
  // `raison`, ses mots.
  | { etat: 'exemplaire_d_une_source'; raison: string }
  // La pièce porte une écriture d'un exercice validé (en trésorerie) : elle ne se rapproche plus.
  | { etat: 'piece_figee' }
  // La pièce est déjà payée par un autre mouvement, et rien n'en reste à régler.
  | { etat: 'piece_rapprochee_ailleurs'; paiements: readonly Pick<PaiementDePiece, 'date' | 'montant'>[] }
  // Payée en partie ailleurs : ce mouvement peut en régler le reste, sauf refus (`refusSecondPaiement`).
  | { etat: 'piece_payee_en_partie'; reste: number; refus: string | null }
  | { etat: 'a_associer' }

export interface ContexteDeLaProposition {
  ligne: Pick<LigneBancaire, 'statut' | 'piece_id' | 'prelevement_personnel' | 'reglement_groupe'>
  // L'exercice validé qui fige le mouvement, avec les mots de la base ; nul quand rien ne le fige.
  figeePar: string | null
  // Les pièces que ce mouvement règle par un virement groupé, sur des parts lues en entier ; nul sinon.
  piecesDuReglement: readonly string[] | null
  pieces: readonly Piece[]
  piecesLuesEnEntier: boolean
  piecesFigees: ReadonlySet<string>
  // Les pièces que le rapprochement ne touche plus (payées, figées) et ce qu'il reste à régler de celles payées en partie,
  // tels que la fiche les juge pour son choix à la main : la proposition passe par le MÊME chemin.
  horsRapprochement: ReadonlySet<string>
  restesARegler: ReadonlyMap<string, number>
  paiementsDeLaPiece: readonly Pick<PaiementDePiece, 'date' | 'montant'>[]
  // Le refus d'un second paiement de cette pièce par ce mouvement (`refusSecondPaiement`), calculé par l'appelant.
  refusSecondPaiement: string | null
  // Les exemplaires des factures sources parmi les pièces lues, chacun sous les mots de G4 (étape VF6d ;
  // lib/lotsDeLaJumelleInversee.ts, `exemplairesDesSourcesDe`) : pièce → raison. Sans valeur par défaut ; vide sur un
  // dossier qui n'a pas basculé.
  exemplairesDesSources: ReadonlyMap<string, string>
}

/** L'état d'une proposition courante, dans l'ordre : le mouvement d'abord, puis sa pièce. */
export function etatDeLaProposition(p: Pick<JustificatifPropose, 'piece_id'>, c: ContexteDeLaProposition): EtatDeLaProposition {
  if (c.ligne.statut === 'rapprochee') {
    if (c.ligne.piece_id === p.piece_id) return { etat: 'retenue' }
    if (c.ligne.reglement_groupe && c.piecesDuReglement?.includes(p.piece_id)) return { etat: 'retenue' }
  }
  if (c.ligne.statut !== 'non_rapprochee' || c.ligne.prelevement_personnel) return { etat: 'mouvement_classe' }
  if (c.figeePar !== null) return { etat: 'mouvement_fige', figeePar: c.figeePar }
  if (!c.pieces.some((x) => x.id === p.piece_id)) return { etat: 'piece_non_lue', lecturePartielle: !c.piecesLuesEnEntier }
  // L'exemplaire d'une facture source ne s'associe à aucun mouvement, figé ou payé ailleurs : G4 le dit d'abord.
  const exemplaire = c.exemplairesDesSources.get(p.piece_id)
  if (exemplaire !== undefined) return { etat: 'exemplaire_d_une_source', raison: exemplaire }
  if (c.piecesFigees.has(p.piece_id)) return { etat: 'piece_figee' }
  const reste = c.restesARegler.get(p.piece_id)
  if (reste !== undefined) return { etat: 'piece_payee_en_partie', reste, refus: c.refusSecondPaiement }
  if (c.horsRapprochement.has(p.piece_id)) return { etat: 'piece_rapprochee_ailleurs', paiements: c.paiementsDeLaPiece }
  return { etat: 'a_associer' }
}

/** La proposition s'associe-t-elle d'ici, par « Associer » ? */
export function associable(e: EtatDeLaProposition): boolean {
  return e.etat === 'a_associer' || (e.etat === 'piece_payee_en_partie' && e.refus === null)
}

/** Ce que la fiche dit de l'état d'une proposition — rien pour une proposition qui s'associe sans réserve. */
export function phraseDeLEtat(e: EtatDeLaProposition): string | null {
  switch (e.etat) {
    case 'retenue':
      return 'Retenue : ce mouvement est rapproché de cette pièce. La proposition reste au registre, datée.'
    case 'mouvement_classe':
      return 'Ce mouvement est déjà classé autrement : la pièce proposée n’est pas retenue. La proposition reste au '
        + 'registre, datée ; rien ne la retire d’elle-même.'
    case 'mouvement_fige':
      return `${e.figeePar} : ce mouvement ne se rapproche plus, la pièce proposée ne s’y associe pas.`
    case 'piece_non_lue':
      return e.lecturePartielle
        ? 'La pièce proposée ne figure pas parmi les pièces lues — elles ne l’ont pas été en entier : recharge la page.'
        : 'La pièce proposée ne figure pas parmi les pièces du dossier : elle a peut-être été supprimée depuis la lecture. '
          + 'Recharge la page.'
    case 'exemplaire_d_une_source':
      return `${e.raison} ${NE_S_ASSOCIE_PAS}`
    case 'piece_figee':
      return 'Cette pièce porte une écriture d’un exercice validé : elle ne se rapproche plus d’aucun mouvement.'
    case 'piece_rapprochee_ailleurs':
      return e.paiements.length === 0
        ? 'Cette pièce est déjà rapprochée d’un autre mouvement : elle ne s’associe pas à celui-ci.'
        : `Cette pièce est déjà rapprochée d’un autre mouvement (${e.paiements.map((x) => `${formatDate(x.date)}, `
          + `${formatMoney(x.montant)}`).join(' ; ')}) : elle ne s’associe pas à celui-ci.`
    case 'piece_payee_en_partie':
      return e.refus ?? `Cette pièce est déjà payée en partie : ce mouvement en règlerait le reste (${formatMoney(e.reste)}).`
    case 'a_associer':
      return null
  }
}

/** Les signaux d'une pièce proposée : ce que le cabinet vérifie avant d'associer, la concordance n'étant PAS garantie. */
export function signauxDeLaProposition(piece: Piece, ligne: LigneBancaire): { ok: boolean; texte: string }[] {
  const signaux: { ok: boolean; texte: string }[] = []
  if (piece.statut === 'a_valider') signaux.push({ ok: false, texte: 'Pièce à valider : ses montants n’ont pas encore été relus' })
  if (piece.montant_ttc == null) {
    signaux.push({ ok: false, texte: 'Aucun montant lu sur la pièce' })
  } else if (Math.round(Math.abs(piece.montant_ttc) * 100) === Math.round(Math.abs(ligne.montant) * 100)) {
    signaux.push({ ok: true, texte: 'Même montant, au centime près' })
  } else {
    signaux.push({ ok: false, texte: `Montants différents : ${formatMoney(piece.montant_ttc)} sur la pièce, ${formatMoney(ligne.montant)} au relevé` })
  }
  if (!sensCoherent(piece, ligne)) {
    signaux.push({
      ok: false,
      texte: ligne.montant > 0
        ? 'Sens contraire : la pièce attend un paiement, le relevé montre un crédit'
        : 'Sens contraire : la pièce attend un encaissement, le relevé montre un débit',
    })
  }
  return signaux
}

// ── Le filtre « Proposés par le client » de l'onglet Banque ───────────────────────────────────────────────────────────
export const LIBELLE_FILTRE_PROPOSES = 'Proposés par le client'

export const AIDE_FILTRE_PROPOSES =
  'Les mouvements pour lesquels une pièce envoyée depuis l’espace client est proposée, et pas retirée. Le filtre ne change '
  + 'que la liste affichée : ni les totaux, ni le contrôle de solde, ni les rapprochements en lot.'

export const PASTILLE_PROPOSE = 'Pièce proposée par le client'

/** Le filtre n'existe que sur des envois lus en entier ; sinon il est grisé et DIT pourquoi. */
export function etatDuFiltreProposes(envois: EnvoisDuClient): EtatDuFiltre {
  const silence = silenceDesEnvois(envois)
  return silence === null ? { disponible: true } : { disponible: false, raison: silence }
}

/** Les mouvements qui ont une proposition courante venue de l'espace client ; vide sur des envois pas lus en entier. */
export function mouvementsProposesParLeClient(envois: EnvoisDuClient): ReadonlySet<string> {
  if (envois.etat !== 'lus') return new Set()
  return new Set(envois.propositions.filter((p) => p.retire_le === null && p.origine === 'client').map((p) => p.ligne_bancaire_id))
}

/** Le filtre garde-t-il ce mouvement ? Décoché, ou sur des envois pas lus en entier, il garde tout. */
export function gardeParLeFiltre(envois: EnvoisDuClient, actif: boolean, proposes: ReadonlySet<string>, mouvementId: string): boolean {
  if (!actif || envois.etat !== 'lus') return true
  return proposes.has(mouvementId)
}
