import { paiementNet, seuilAlignement } from './alignementBanque'
import { ecartEnJours, libelleExploitable } from './appariementBanque'
import { formatDate, formatMoney } from './format'
import { montantRetenu } from './montantRetenu'
import { centimesParDate, cleDuPaiement, rattachementsTresorerie, type PaiementDePiece, type PaiementParLeReleve, type PaiementsDesPieces } from './rattachement'
import { rejetAccepte, resteARegler } from './reglementGroupe'
import type { LigneBancaire, ModeComptable, Piece } from './types'

// LE PAIEMENT REJETÉ, PUIS REPRIS (REJET-Q1, tranchée par le cabinet le 01/11/2026 : « l'ouvrir », sur la recommandation).
//
// La banque rejette un prélèvement — une prime d'assurance, une cotisation, un abonnement —, puis le présente de nouveau :
// le relevé porte trois mouvements pour une seule pièce, le paiement, son rejet (une entrée d'argent), la reprise. Depuis
// le 31/10/2026, la 2035 et les écritures comptent juste une telle pièce quand les trois lui sont rapprochés : la somme
// SIGNÉE de ses paiements, chacun à sa date (`partsDesPaiements`, lib/rattachement.ts). Restait le geste : la fiche d'un
// mouvement refusait le rejet (« mauvais sens »), puis la reprise (la pièce paraissait déjà payée).
//
// LA RÈGLE (lib/reglementGroupe.ts, `rejetAccepte`, une fois) : un mouvement du sens contraire à celui qui règle la pièce
// se rapproche d'elle quand ses autres paiements, nets, l'ont payée dans son sens d'au moins son montant ; puis la pièce
// dont les paiements se soldent à zéro s'offre de nouveau, pour son montant entier, au mouvement de son sens
// (`restesAReglerDesPieces`, lib/controles.ts). Ici vit ce que la fiche en dit : les pièces qu'un mouvement peut défaire —
// celles qui ont un paiement de son montant, au centime, de l'autre sens —, celle qu'un signal justifie de proposer, et ce
// que le geste change à la 2035 — calculé par le moteur, jamais recopié.
//
// AUCUN LOT NE PREND UN REJET : le rapprochement automatique n'offre jamais une pièce déjà payée, et le lot des règles
// laisse de côté un mouvement qui défait peut-être un paiement (`justificatifPossible`, lib/reglesAffectation.ts) —
// affecté à une catégorie, le crédit d'un rejet compterait comme une recette pendant que la pièce resterait payée.

/** La fenêtre du SIGNAL qui propose une pièce en tête : huit semaines, le délai dans lequel le payeur peut demander le
 *  remboursement d'un prélèvement autorisé (code monétaire et financier, art. L133-25 et L133-25-1, I) ; le rejet ou le
 *  retour interbancaire d'un prélèvement tombe bien avant. Au-delà, la pièce reste au choix, jamais en tête. */
export const JOURS_DU_REJET = 56

export interface PieceDuRejet {
  piece: Piece
  /** Le paiement que ce mouvement défait : rapproché seul de la pièce, du montant opposé au centime, daté au plus tard le
   *  jour du mouvement — le plus récent s'il y en a plusieurs. */
  defait: PaiementParLeReleve
  /** Ce paiement tombe dans la fenêtre (`JOURS_DU_REJET`) : le signal qui permet de proposer la pièce en tête. */
  signal: boolean
}

const centimes = (euros: number) => Math.round(euros * 100)

/** Les autres paiements d'une pièce, hors ce mouvement — un paiement par la caisse en est toujours un autre. */
function autresPaiements(paiements: readonly PaiementDePiece[], ligneId: string): PaiementDePiece[] {
  return paiements.filter((p) => p.origine === 'caisse' || p.id !== ligneId)
}

// CE QUE LA FICHE OFFRE, ET CE QUE LE LOT RETIENT, NE PART QUE DU MONTANT (relecture de la session, 02/11/2026). La première
// version acceptait toute pièce payée d'au moins le montant du mouvement (`rejetAccepte`), puis triait ces candidates pour
// chaque mouvement : 1 496 pièces offertes au rejet d'une recette de 20,37 €, et plus de cinq secondes pour juger 3 000
// crédits du lot des règles. Un rejet défait UN prélèvement : il en a le montant au centime. L'index range une fois, par
// instance de `paiements`, les paiements faits par un RAPPROCHEMENT SIMPLE, par montant en centimes ; chaque mouvement n'y
// lit que le montant opposé au sien, puis la date et `rejetAccepte`. La part d'un règlement groupé, l'encaissement d'un
// virement mixte et le paiement par la caisse n'y entrent pas : le rejet d'un virement groupé n'a le montant d'aucune part,
// et un rejet partiel n'a celui d'aucun paiement — ni l'un ni l'autre ne s'offre ; ils se classent à part, comme hier.
type EntreeDeLIndex = { pieceId: string; paiement: PaiementParLeReleve }
const INDEX_DES_PAIEMENTS = new WeakMap<PaiementsDesPieces, ReadonlyMap<number, readonly EntreeDeLIndex[]>>()
const PIECES_PAR_ID = new WeakMap<readonly Piece[], ReadonlyMap<string, Piece>>()

function indexDesPaiements(paiements: PaiementsDesPieces): ReadonlyMap<number, readonly EntreeDeLIndex[]> {
  const deja = INDEX_DES_PAIEMENTS.get(paiements)
  if (deja) return deja
  const index = new Map<number, EntreeDeLIndex[]>()
  for (const [pieceId, liste] of paiements) {
    for (const paiement of liste) {
      if (paiement.origine !== 'rapprochement') continue
      const cle = centimes(paiement.montant)
      const entrees = index.get(cle)
      if (entrees) entrees.push({ pieceId, paiement })
      else index.set(cle, [{ pieceId, paiement }])
    }
  }
  INDEX_DES_PAIEMENTS.set(paiements, index)
  return index
}

function piecesParId(pieces: readonly Piece[]): ReadonlyMap<string, Piece> {
  const deja = PIECES_PAR_ID.get(pieces)
  if (deja) return deja
  const parId = new Map(pieces.map((p) => [p.id, p]))
  PIECES_PAR_ID.set(pieces, parId)
  return parId
}

/** Les candidates, sans tri : pour chaque pièce, le plus récent de ses paiements que ce mouvement peut défaire. */
function candidatesDuRejet(
  ligne: Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'compte_bancaire_id'>,
  pieces: readonly Piece[],
  paiements: PaiementsDesPieces,
  exclues: ReadonlySet<string>,
): PieceDuRejet[] {
  if (!ligne.montant) return []
  const entrees = indexDesPaiements(paiements).get(-centimes(ligne.montant)) ?? []
  const plusRecent = new Map<string, PaiementParLeReleve>()
  for (const { pieceId, paiement } of entrees) {
    if (paiement.id === ligne.id || paiement.date > ligne.date || exclues.has(pieceId)) continue
    // UN MOUVEMENT SE RAPPROCHE DANS SON COMPTE (lot MCB3) : la banque rejette un prélèvement sur le compte qui l'a payé. Le
    // paiement d'un autre compte du dossier n'est pas celui que ce mouvement défait. Sans compte d'un côté ou de l'autre (la
    // migration pas appliquée), rien ne change.
    if (ligne.compte_bancaire_id !== undefined && paiement.compte_bancaire_id !== undefined
      && paiement.compte_bancaire_id !== ligne.compte_bancaire_id) continue
    const autre = plusRecent.get(pieceId)
    if (!autre || paiement.date > autre.date) plusRecent.set(pieceId, paiement)
  }
  const parId = piecesParId(pieces)
  const candidates: PieceDuRejet[] = []
  for (const [pieceId, defait] of plusRecent) {
    const piece = parId.get(pieceId)
    if (!piece || !rejetAccepte(piece, autresPaiements(paiements.get(pieceId) ?? [], ligne.id), ligne.montant)) continue
    candidates.push({ piece, defait, signal: ecartEnJours(defait.date, ligne.date) <= JOURS_DU_REJET })
  }
  return candidates
}

/**
 * Les pièces dont ce mouvement peut être le rejet : un paiement rapproché d'elle seule, du montant opposé au centime, daté
 * au plus tard le jour du mouvement, à toute distance, que la pièce accepte de voir défait (`rejetAccepte`). Celles que le
 * signal désigne d'abord, puis par la proximité du paiement. `exclues` : ce que le rapprochement ne touche plus (les pièces
 * figées) et les exemplaires des factures sources, que l'appelant connaît.
 */
export function piecesDuRejet(
  ligne: Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'compte_bancaire_id'>,
  pieces: readonly Piece[],
  paiements: PaiementsDesPieces,
  exclues: ReadonlySet<string>,
): PieceDuRejet[] {
  return candidatesDuRejet(ligne, pieces, paiements, exclues)
    .sort((a, b) => (a.signal ? 0 : 1) - (b.signal ? 0 : 1)
      || ecartEnJours(a.defait.date, ligne.date) - ecartEnJours(b.defait.date, ligne.date)
      || a.piece.id.localeCompare(b.piece.id))
}

/** La pièce que la fiche PROPOSE en tête : la seule que le signal désigne. À égalité — deux pièces au paiement du même
 *  montant dans la fenêtre —, aucune : l'opérateur ouvre les justificatifs et choisit. */
export function rejetPropose(candidates: readonly PieceDuRejet[]): PieceDuRejet | null {
  const signalees = candidates.filter((c) => c.signal)
  return signalees.length === 1 ? signalees[0] : null
}

/** Ce mouvement défait-il peut-être un paiement déjà rapproché d'une pièce, dans la fenêtre ? Ce qui retient un mouvement
 *  hors du lot des règles : l'index seul, sans tri, appelé pour chaque mouvement du lot. */
export function rejetPossible(ligne: Pick<LigneBancaire, 'id' | 'date' | 'montant' | 'compte_bancaire_id'>, pieces: readonly Piece[], paiements: PaiementsDesPieces): boolean {
  return candidatesDuRejet(ligne, pieces, paiements, new Set()).some((c) => c.signal)
}

/** Les signaux du rejet proposé, et ce que la banque ne confirme pas. */
export function signauxDuRejet(c: PieceDuRejet, ligne: Pick<LigneBancaire, 'date' | 'montant' | 'libelle' | 'libelle_brut'>): { ok: boolean; texte: string }[] {
  const signaux: { ok: boolean; texte: string }[] = []
  signaux.push({ ok: true, texte: `Paiement du ${formatDate(c.defait.date)} de ${formatMoney(Math.abs(c.defait.montant))} rapproché de cette pièce : même montant, au centime près` })
  const jours = ecartEnJours(c.defait.date, ligne.date)
  const ecart = jours === 0 ? 'Le même jour que ce paiement' : `${jours} jour${jours > 1 ? 's' : ''} après ce paiement`
  signaux.push(c.signal ? { ok: true, texte: ecart } : { ok: false, texte: `${ecart} : au-delà des huit semaines d’un rejet ou d’un remboursement` })
  signaux.push(/\b(rejet|rejete|impaye|retour|annulation|remboursement)/i.test(sansAccents(libelleExploitable(ligne)))
    ? { ok: true, texte: 'Le libellé bancaire dit un rejet ou un retour' }
    : { ok: false, texte: 'Le libellé bancaire ne dit pas de rejet' })
  signaux.push({ ok: false, texte: 'La banque ne relie pas deux mouvements : rien au relevé ne confirme que celui-ci défait ce paiement' })
  return signaux
}

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/\p{M}/gu, '')
}

// ── Ce que le geste change à la 2035 ──────────────────────────────────────────────────────────────────────────────────

export type EtatDuPaiement = { etat: 'payee' } | { etat: 'payee_en_partie'; reste: number } | { etat: 'a_regler'; reste: number }

export interface DateComptee {
  date: string
  /** Ce que la 2035 compte de la pièce à cette date, en euros, signé comme la pièce : négatif le jour d'un rejet. */
  montant: number
  /** La date de la facture, faute de paiement net connu (`sans_paiement`) — une supposition que la 2035 dit. */
  sansPaiement: boolean
}

export type EffetDuPaiement =
  | { mode: 'engagement'; avant: EtatDuPaiement; apres: EtatDuPaiement }
  | { mode: 'tresorerie'; montantRetenu: null; avant: EtatDuPaiement; apres: EtatDuPaiement }
  | {
    mode: 'tresorerie'
    montantRetenu: number
    avant: EtatDuPaiement
    apres: EtatDuPaiement
    /** Chaque exercice où la pièce compte, avant ou après le geste, et ce qu'elle y compte, en euros. */
    parExercice: { annee: number; avant: number; apres: number }[]
    /** Où la pièce compte après le geste, date par date. */
    datesApres: DateComptee[]
  }

function etatDuPaiement(piece: Pick<Piece, 'type_piece' | 'montant_ttc'>, paiements: readonly { montant: number }[]): EtatDuPaiement {
  const reste = resteARegler(piece, paiements.map((p) => ({ id: '', montant: p.montant })), null)
  if (reste <= seuilAlignement(piece.montant_ttc ?? 0)) return { etat: 'payee' }
  return paiementNet(paiements).centimes === 0 ? { etat: 'a_regler', reste } : { etat: 'payee_en_partie', reste }
}

// La part que la 2035 compte à chaque date, comme `calculerDeclaration2035` (lib/declaration2035.ts) : `centimesParDate`,
// la part sans date en moins — l'écriture la porte au jour du dépôt, la 2035 nulle part.
function datesComptees(piece: Piece, montant: number, paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[]): DateComptee[] {
  const sansPaiement = new Set(rattachementsTresorerie(piece, paiements)
    .filter((r) => r.source !== 'paiement' && r.date !== null).map((r) => r.date as string))
  return centimesParDate(piece, montant, paiements)
    .map((m) => ({ date: m.date, montant: (m.centimes - m.centimesSansDate) / 100, sansPaiement: sansPaiement.has(m.date) }))
    .filter((d) => d.montant !== 0)
}

/**
 * Ce que le rapprochement de ce mouvement change à la pièce : où et pour combien la 2035 la compte, exercice par exercice
 * et date par date, et son état de paiement — calculé par les moteurs (`centimesParDate`, la somme signée des paiements,
 * chacun à sa date), sur ses paiements avant et après. En engagement, la pièce compte à sa facture : seul son état change.
 */
export function effetDuPaiementAjoute(
  piece: Piece,
  paiementsDeLaPiece: readonly PaiementDePiece[],
  ligne: Pick<LigneBancaire, 'id' | 'date' | 'montant'>,
  mode: ModeComptable,
  assujettiTva: boolean,
): EffetDuPaiement {
  const avantListe = autresPaiements(paiementsDeLaPiece, ligne.id)
  // Triés comme `paiementsDesPieces` les trie (par date, le relevé d'abord) : la répartition des centimes en dépend.
  const rang = (p: PaiementDePiece) => (p.origine === 'caisse' ? 1 : 0)
  const apresListe = [...avantListe, { id: ligne.id, date: ligne.date, montant: ligne.montant, origine: 'rapprochement' as const }]
    .sort((a, b) => a.date.localeCompare(b.date) || rang(a) - rang(b) || cleDuPaiement(a).localeCompare(cleDuPaiement(b)))
  const avant = etatDuPaiement(piece, avantListe)
  const apres = etatDuPaiement(piece, apresListe)
  if (mode === 'engagement') return { mode, avant, apres }
  const montant = montantRetenu(piece, assujettiTva)
  if (montant == null) return { mode, montantRetenu: null, avant, apres }
  const datesAvant = datesComptees(piece, montant, avantListe)
  const datesApres = datesComptees(piece, montant, apresListe)
  const annees = [...new Set([...datesAvant, ...datesApres].map((d) => Number(d.date.slice(0, 4))))].sort((a, b) => a - b)
  const total = (dates: readonly DateComptee[], annee: number) =>
    dates.filter((d) => Number(d.date.slice(0, 4)) === annee).reduce((s, d) => s + centimes(d.montant), 0) / 100
  return {
    mode, montantRetenu: montant, avant, apres, datesApres,
    parExercice: annees.map((annee) => ({ annee, avant: total(datesAvant, annee), apres: total(datesApres, annee) })),
  }
}

function etatDit(e: EtatDuPaiement): string {
  switch (e.etat) {
    case 'payee': return '« payée »'
    case 'payee_en_partie': return `« payée en partie » (reste ${formatMoney(e.reste)})`
    case 'a_regler': return `« à régler » (${formatMoney(e.reste)}, aucun paiement net)`
  }
}

/** Ce que la fiche dit de l'effet, avant le clic : une phrase par ligne. */
export function phrasesDeLEffet(effet: EffetDuPaiement, piece: Pick<Piece, 'statut' | 'date_piece'>): string[] {
  const phrases: string[] = []
  const etat = etatDit(effet.avant) === etatDit(effet.apres)
    ? `La pièce reste ${etatDit(effet.apres)}.`
    : `La pièce passe de ${etatDit(effet.avant)} à ${etatDit(effet.apres)}.`
  if (effet.mode === 'engagement') {
    return [
      'En engagement, la pièce compte à la date de sa facture : ce geste ne change pas l’exercice où elle compte, seulement '
        + 'ce qu’il en reste à régler, au compte du tiers.',
      etat,
    ]
  }
  if (effet.montantRetenu === null) {
    return ['Le montant retenu de la pièce n’est pas lu : la 2035 ne la compte pas, et ce geste n’y change rien.', etat]
  }
  for (const e of effet.parExercice) {
    const ecart = Math.round((e.apres - e.avant) * 100) / 100
    phrases.push(ecart === 0
      ? `2035 de ${e.annee} : inchangée — la pièce y compte pour ${formatMoney(e.apres)}.`
      : `2035 de ${e.annee} : la pièce y compte pour ${formatMoney(e.apres)} au lieu de ${formatMoney(e.avant)} `
        + `(${formatMoney(Math.abs(ecart))} ${ecart < 0 ? 'de moins' : 'de plus'}).`)
  }
  if (effet.datesApres.length > 0) {
    phrases.push(`Après ce geste, la 2035 la compte : ${effet.datesApres.map((d) => `${formatMoney(d.montant)} le ${formatDate(d.date)}`
      + (d.sansPaiement ? ', date de sa facture, faute de paiement net connu' : '')).join(' ; ')}.`)
  }
  phrases.push(etat)
  if (effet.apres.etat === 'a_regler') {
    phrases.push('Jusqu’à la reprise, la 2035 la dit « sans paiement connu », et son écriture, qu’il faudra régénérer, ne '
      + 's’équilibre pas : la Checklist le dit. La reprise, un mouvement de son sens, se rapproche ensuite d’elle pour son montant entier.')
  }
  if (piece.statut !== 'validee') phrases.push('Pièce à valider : la 2035 ne la compte qu’une fois validée.')
  return phrases
}

/** Les pièces dont les paiements par le relevé se soldent à zéro — un prélèvement et son rejet, pas encore repris : ce que
 *  la liste des pièces dit « Paiement rejeté », plutôt que « Rapprochée ». */
export function piecesAuPaiementRejete(paiements: PaiementsDesPieces): ReadonlySet<string> {
  return new Set([...paiements].filter(([, liste]) => liste.length > 0 && paiementNet(liste).centimes === 0).map(([id]) => id))
}
