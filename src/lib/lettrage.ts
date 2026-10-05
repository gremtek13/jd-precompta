import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_FOURNISSEURS,
  COMPTE_FOURNISSEURS_IMMOBILISATIONS, libelleCompteTenu,
} from './comptes'
import { auxiliaireDuTiers } from './engagement'
import { dateAParis } from './format'
import type { ANouveau, EcritureBrouillon, ModeComptable, Piece } from './types'

// LE LETTRAGE DES COMPTES DE TIERS — ligne 32 de la feuille de route (05/10/2026).
//
// « Le lettrage de l'écriture fait référence au repère utilisé dans le système comptable pour apparier deux
// écritures (règlement-facture). La date de lettrage de l'écriture correspond à la date à laquelle l'opération de
// lettrage a été validée dans le système comptable. » (BOI-CF-IOR-60-40-20, § 240.) Le rapprochement bancaire relie
// une pièce à un mouvement ; le lettrage relie, dans un compte de tiers, la facture aux règlements qui la soldent.
//
// IL SE DÉDUIT DU RAPPROCHEMENT, IL NE SE SAISIT PAS. En engagement, une pièce écrit sa facture sur son compte de
// tiers et un règlement par paiement rapproché, sur ce même compte (lib/engagement.ts) : le geste qui apparie la
// facture et le paiement, c'est le rapprochement, et il est déjà celui du cabinet. Quand les lignes d'une pièce sur
// son compte de tiers se soldent au centime, elles reçoivent le même code. Rien n'est stocké : le lettrage suit les
// écritures, et un rapprochement annulé le défait de lui-même.
//
// NE SONT PAS LETTRÉES, et c'est délibéré :
// - une pièce payée EN PARTIE : elle reste ouverte, avec son reste (`comptesDeTiers`). Le format du FEC ne définit
//   aucun lettrage partiel, et un code posé sur ce qui ne se solde pas passerait, dans le logiciel qui l'importe,
//   pour un lettrage total ;
// - une pièce payée EN TROP : le compte de tiers porte ce que le fournisseur doit rendre ;
// - les lignes SANS PIÈCE : un virement du dirigeant au 455 ou au 467, les à-nouveaux d'une balance reprise, qui
//   n'ont pas de détail par tiers ;
// - rien en TRÉSORERIE : la charge y est face à la banque, et le 108 de l'exploitant n'est pas un compte de tiers.

// Les comptes que le lettrage apparie : ceux qu'une pièce d'engagement porte comme compte de tiers — 401, 404 et
// 411, et le compte du dirigeant d'une note de frais quand c'est un compte de tiers (455, 467). Jamais le 108,
// compte de capitaux de l'exploitant, ni les comptes de TVA, qui commencent pourtant aussi par 4.
export const COMPTES_LETTRABLES: ReadonlySet<string> = new Set([
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE,
  COMPTE_AUTRES_DEBITEURS_CREDITEURS,
])

export interface LettrageDeLigne {
  // Le repère commun aux lignes appariées (EcritureLet).
  code: string
  // AAAA-MM-JJ (DateLet).
  date: string
}

// Le code de rang `rang` : A à Z, puis AA à ZZ, puis AAA… — base 26 sans zéro, comme les colonnes d'un tableur.
// Des lettres seules, courtes, que tout logiciel d'import accepte.
export function codeLettrage(rang: number): string {
  let n = rang + 1
  let code = ''
  while (n > 0) {
    const reste = (n - 1) % 26
    code = String.fromCharCode(65 + reste) + code
    n = Math.floor((n - 1) / 26)
  }
  return code
}

// Le jour de création d'une ligne, à Paris. La base le pose sur chaque ligne (`default now()`) ; un instant illisible
// est ignoré plutôt que de faire lever le calcul — il tourne au rendu de l'onglet Écritures, qu'une seule ligne
// malformée ne doit pas emporter —, et la date retombe sur la date comptable de la plus récente.
function jourDeCreation(e: Pick<EcritureBrouillon, 'created_at'>): string | null {
  if (!e.created_at || Number.isNaN(Date.parse(e.created_at))) return null
  return dateAParis(e.created_at)
}

const centimes = (e: Pick<EcritureBrouillon, 'sens' | 'montant'>) =>
  (e.sens === 'debit' ? 1 : -1) * Math.round(e.montant * 100)

// Les lignes de chaque pièce sur chaque compte lettrable, en engagement : la facture et ses règlements.
function lignesParPieceEtCompte(ecritures: readonly EcritureBrouillon[]): Map<string, EcritureBrouillon[]> {
  const groupes = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.piece_id || !COMPTES_LETTRABLES.has(e.compte)) continue
    const cle = `${e.piece_id}|${e.compte}`
    groupes.set(cle, [...(groupes.get(cle) ?? []), e])
  }
  return groupes
}

// Le lettrage de chaque ligne lettrée, par identifiant d'écriture. Calculé sur TOUT le brouillon du dossier et non
// sur un exercice : une facture de décembre réglée en janvier porte le même code dans le FEC des deux exercices.
//
// LE CODE EST UNIQUE PAR COMPTE GÉNÉRAL, tous tiers confondus : un logiciel qui lettre par compte auxiliaire y trouve
// des codes distincts comme celui qui lettre par compte collectif. Les codes se donnent dans l'ordre où les lettrages
// sont nés — leur date, puis la date de leur première ligne, puis la pièce —, comme un logiciel les donne au fil des
// lettrages.
//
// LA DATE est celle à laquelle le lettrage s'est établi dans l'application (§ 240) : la création de la plus récente
// de ses lignes, à Paris — c'est l'écriture du règlement qui solde la facture —, et jamais avant la date comptable de
// la plus récente : un lettrage ne précède pas ce qu'il apparie.
//
// UNE PIÈCE N'A QU'UN LETTRAGE. Si deux de ses comptes lettrables se soldaient — rien ne l'écrit ainsi, il y faudrait
// une pièce désynchronisée, que « Régénérer » répare —, aucun ne serait lettré : une écriture du FEC qui porterait deux
// codes ressortirait parmi les anomalies de l'outil de la DGFiP (« Différents lettrages »).
export function lettrages(
  ecritures: readonly EcritureBrouillon[],
  // Sans valeur par défaut : en trésorerie rien ne se lettre, et l'oublier en engagement ne lettrerait rien.
  mode: ModeComptable,
): ReadonlyMap<string, LettrageDeLigne> {
  const resultat = new Map<string, LettrageDeLigne>()
  if (mode !== 'engagement') return resultat

  const soldes: { pieceId: string; compte: string; lignes: EcritureBrouillon[]; date: string; premiere: string }[] = []
  const comptesSoldesParPiece = new Map<string, number>()
  for (const lignes of lignesParPieceEtCompte(ecritures).values()) {
    if (lignes.reduce((total, e) => total + centimes(e), 0) !== 0) continue
    const pieceId = lignes[0].piece_id!
    comptesSoldesParPiece.set(pieceId, (comptesSoldesParPiece.get(pieceId) ?? 0) + 1)
    const plusRecente = lignes.reduce((max, e) => (e.date > max ? e.date : max), lignes[0].date)
    const creation = lignes.reduce((max, e) => {
      const jour = jourDeCreation(e)
      return jour !== null && jour > max ? jour : max
    }, plusRecente)
    soldes.push({
      pieceId, compte: lignes[0].compte, lignes,
      date: creation,
      premiere: lignes.reduce((min, e) => (e.date < min ? e.date : min), lignes[0].date),
    })
  }

  const parCompte = new Map<string, typeof soldes>()
  for (const s of soldes) {
    if (comptesSoldesParPiece.get(s.pieceId)! > 1) continue
    parCompte.set(s.compte, [...(parCompte.get(s.compte) ?? []), s])
  }
  for (const groupes of parCompte.values()) {
    groupes.sort((a, b) => a.date.localeCompare(b.date) || a.premiere.localeCompare(b.premiere) || a.pieceId.localeCompare(b.pieceId))
    groupes.forEach((g, rang) => {
      const lettrage = { code: codeLettrage(rang), date: g.date }
      for (const e of g.lignes) resultat.set(e.id, lettrage)
    })
  }
  return resultat
}

// ── LES COMPTES DE TIERS À UNE DATE ────────────────────────────────────────────────────────────────────────────
//
// Ce que le lettrage laisse ouvert, tiers par tiers : ce qu'on doit à chaque fournisseur, ce que chaque client doit
// encore, et depuis quand — la balance âgée. Arrêtée à une date : une pièce s'y lit avec ses seules lignes datées
// jusqu'à elle, si bien qu'une facture de décembre réglée en janvier est ouverte au 31 décembre.
//
// LE TOTAL D'UN COMPTE EST SON SOLDE DANS LA BALANCE GÉNÉRALE à la même date, et c'est ce qui rend la vue fiable : les
// lignes sans pièce (un virement du dirigeant au 455) et les à-nouveaux d'une balance reprise, qui n'ont pas de
// détail par tiers, y figurent chacun sur une ligne à part plutôt que de manquer au total.

// Le sens dans lequel un compte de tiers est normalement soldé : créditeur pour ce qu'on doit (un fournisseur, le
// dirigeant), débiteur pour ce qu'on attend (un client). Les montants de la vue se lisent dans ce sens, positifs
// quand le compte est dans son sens normal.
export function sensNormal(compte: string): 'debit' | 'credit' {
  return compte === COMPTE_CLIENTS ? 'debit' : 'credit'
}

export type EtatPieceDuTiers =
  // La facture, sans règlement à la date.
  | 'ouverte'
  // Réglée en partie : le reste est du même signe que la facture.
  | 'payee_en_partie'
  // Réglée au-delà de son montant : le compte de tiers porte le trop-payé.
  | 'payee_en_trop'
  // Un règlement sans facture à la date : un acompte versé avant elle, ou une facture datée plus tard.
  | 'reglement_sans_facture'

export interface PieceDuTiers {
  pieceId: string
  libelle: string
  // La date de la facture (la plus ancienne de ses lignes hors règlement), nulle quand seul un règlement précède la
  // date d'arrêté.
  dateFacture: string | null
  // Dans le sens normal du compte : positif pour une facture, négatif pour un avoir.
  facture: number
  regle: number
  reste: number
  // En jours, depuis la facture — depuis le premier règlement pour un règlement sans facture.
  age: number
  etat: EtatPieceDuTiers
}

export type OrigineDuSolde = 'tiers' | 'ouverture' | 'sans_piece'

export interface SoldeDeTiers {
  compte: string
  // Le compte auxiliaire du FEC (CompAuxNum) pour un 401, 404 ou 411 ; nul pour le 455 et le 467, qui n'en ont pas,
  // et pour les lignes sans détail par tiers.
  auxiliaire: string | null
  libelle: string
  origine: OrigineDuSolde
  // Dans le sens normal du compte.
  solde: number
  // Les pièces ouvertes à la date, les plus anciennes d'abord.
  pieces: PieceDuTiers[]
  // Le reste des pièces ouvertes par ancienneté : 30 jours au plus, 31 à 60, 61 à 90, plus de 90.
  tranches: [number, number, number, number]
}

const TRANCHES = [30, 60, 90] as const

function joursEntre(debut: string, fin: string): number {
  const jour = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((jour(fin) - jour(debut)) / 86_400_000)
}

function tranche(age: number): 0 | 1 | 2 | 3 {
  if (age <= TRANCHES[0]) return 0
  if (age <= TRANCHES[1]) return 1
  if (age <= TRANCHES[2]) return 2
  return 3
}

const euros = (c: number) => c / 100

export function comptesDeTiers(
  ecritures: readonly EcritureBrouillon[],
  pieces: readonly Pick<Piece, 'id' | 'tiers' | 'nom_fichier'>[],
  aNouveaux: readonly ANouveau[],
  mode: ModeComptable,
  // AAAA-MM-JJ : la vue se lit au soir de ce jour.
  dateArrete: string,
): SoldeDeTiers[] {
  if (mode !== 'engagement') return []
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const enSensNormal = (compte: string, c: number) => (sensNormal(compte) === 'debit' ? c : -c)
  const soldes = new Map<string, SoldeDeTiers & { centimes: number; trancheCentimes: [number, number, number, number] }>()
  const entree = (compte: string, auxiliaire: string | null, libelle: string, origine: OrigineDuSolde) => {
    const cle = `${compte}|${origine}|${auxiliaire ?? ''}`
    let s = soldes.get(cle)
    if (!s) {
      s = { compte, auxiliaire, libelle, origine, solde: 0, pieces: [], tranches: [0, 0, 0, 0], centimes: 0, trancheCentimes: [0, 0, 0, 0] }
      soldes.set(cle, s)
    }
    return s
  }

  for (const a of aNouveaux) {
    if (!COMPTES_LETTRABLES.has(a.compte) || a.date > dateArrete) continue
    entree(a.compte, null, 'Repris à l’ouverture, sans détail par tiers', 'ouverture').centimes += enSensNormal(a.compte, centimes(a))
  }

  const parPiece = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!COMPTES_LETTRABLES.has(e.compte) || e.date > dateArrete) continue
    if (!e.piece_id) {
      entree(e.compte, null, 'Écritures sans pièce', 'sans_piece').centimes += enSensNormal(e.compte, centimes(e))
      continue
    }
    const cle = `${e.piece_id}|${e.compte}`
    parPiece.set(cle, [...(parPiece.get(cle) ?? []), e])
  }

  for (const lignes of parPiece.values()) {
    const compte = lignes[0].compte
    const pieceId = lignes[0].piece_id!
    const piece = pieceById.get(pieceId)
    const auxiliaire = auxiliaireDuTiers(piece ?? { tiers: null }, compte)
    const s = auxiliaire
      ? entree(compte, auxiliaire.num, auxiliaire.lib, 'tiers')
      : entree(compte, null, libelleCompteTenu(compte) ?? compte, 'tiers')
    const facture = lignes.filter((e) => !e.ligne_bancaire_id)
    const reglements = lignes.filter((e) => e.ligne_bancaire_id)
    const factureCentimes = facture.reduce((t, e) => t + enSensNormal(compte, centimes(e)), 0)
    const resteCentimes = lignes.reduce((t, e) => t + enSensNormal(compte, centimes(e)), 0)
    s.centimes += resteCentimes
    if (resteCentimes === 0) continue
    const dateFacture = facture.length > 0 ? facture.reduce((min, e) => (e.date < min ? e.date : min), facture[0].date) : null
    const origine = dateFacture ?? reglements.reduce((min, e) => (e.date < min ? e.date : min), reglements[0].date)
    const age = Math.max(0, joursEntre(origine, dateArrete))
    const etat: EtatPieceDuTiers = facture.length === 0
      ? 'reglement_sans_facture'
      : reglements.length === 0
        ? 'ouverte'
        : Math.sign(resteCentimes) === Math.sign(factureCentimes) ? 'payee_en_partie' : 'payee_en_trop'
    s.pieces.push({
      pieceId,
      libelle: piece?.nom_fichier ?? lignes[0].libelle,
      dateFacture,
      facture: euros(factureCentimes),
      regle: euros(factureCentimes - resteCentimes),
      reste: euros(resteCentimes),
      age,
      etat,
    })
    s.trancheCentimes[tranche(age)] += resteCentimes
  }

  const ordreCompte = [COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_AUTRES_DEBITEURS_CREDITEURS]
  const ordreOrigine: Record<OrigineDuSolde, number> = { tiers: 0, sans_piece: 1, ouverture: 2 }
  return [...soldes.values()]
    // Un tiers dont tout est soldé n'a rien à dire ; un tiers au solde nul mais qui porte un trop-payé et une facture
    // ouverte, si : ce sont deux pièces à rapprocher, pas une balance à zéro.
    .filter((s) => s.centimes !== 0 || s.pieces.length > 0)
    .map(({ centimes: c, trancheCentimes, ...s }) => ({
      ...s,
      solde: euros(c),
      tranches: trancheCentimes.map(euros) as [number, number, number, number],
      pieces: [...s.pieces].sort((a, b) => b.age - a.age || a.pieceId.localeCompare(b.pieceId)),
    }))
    .sort((a, b) =>
      ordreCompte.indexOf(a.compte) - ordreCompte.indexOf(b.compte)
      || ordreOrigine[a.origine] - ordreOrigine[b.origine]
      || a.libelle.localeCompare(b.libelle, 'fr')
      || (a.auxiliaire ?? '').localeCompare(b.auxiliaire ?? ''))
}
