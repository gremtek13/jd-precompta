import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_FOURNISSEURS,
  COMPTE_FOURNISSEURS_IMMOBILISATIONS, libelleCompteTenu,
} from './comptes'
import { auxiliaireDuTiers } from './engagement'
import { dateAParis, formatMoney } from './format'
import type { ANouveau, EcritureBrouillon, LettrageManuel, ModeComptable, Piece } from './types'

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
//
// LE LETTRAGE FAIT À LA MAIN (seconde brique, 06/10/2026) apparie ce que le rapprochement ne peut pas voir : des pièces
// d'un même tiers qui se soldent ENTRE ELLES sans mouvement bancaire — une facture et son avoir, le reste d'une facture
// payée en partie qu'un avoir solde. Le geste est celui du cabinet (`lettrer_pieces`, table `lettrages_manuels`), et la
// base ne garde que l'appariement : le code et la date se calculent ici, comme ceux d'un lettrage déduit. Une somme
// vraie au moment du clic peut cesser de l'être — un rapprochement posé ou annulé depuis, un tiers corrigé — : chaque
// lettrage fait à la main est donc REVÉRIFIÉ à chaque lecture (`etatsDesLettragesManuels`), et seul celui qui tient
// encore est appliqué. Les autres sont dits, jamais portés au FEC.

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
// La même règle pour le jour où le cabinet a lettré à la main : la base le pose sur chaque ligne de `lettrages_manuels`.
function jourDeCreation(e: { created_at: string | null }): string | null {
  if (!e.created_at || Number.isNaN(Date.parse(e.created_at))) return null
  return dateAParis(e.created_at)
}

const centimes = (e: Pick<EcritureBrouillon, 'sens' | 'montant'>) =>
  (e.sens === 'debit' ? 1 : -1) * Math.round(e.montant * 100)

const somme = (lignes: readonly Pick<EcritureBrouillon, 'sens' | 'montant'>[]) =>
  lignes.reduce((total, e) => total + centimes(e), 0)

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
// lettrages. Un lettrage fait à la main prend sa place dans la même suite.
//
// LA DATE est celle à laquelle le lettrage s'est établi dans l'application (§ 240) : la création de la plus récente
// de ses lignes, à Paris — c'est l'écriture du règlement qui solde la facture —, et jamais avant la date comptable de
// la plus récente : un lettrage ne précède pas ce qu'il apparie. Pour un lettrage fait à la main, jamais avant non plus
// le jour où le cabinet a lettré : c'est ce jour-là que l'opération a été validée.
//
// UNE PIÈCE N'A QU'UN LETTRAGE. Si deux de ses comptes lettrables se soldaient — rien ne l'écrit ainsi, il y faudrait
// une pièce désynchronisée, que « Régénérer » répare —, aucun ne serait lettré : une écriture du FEC qui porterait deux
// codes ressortirait parmi les anomalies de l'outil de la DGFiP (« Différents lettrages »). La même règle écarte un
// lettrage fait à la main dont une pièce se solde ailleurs (`piece_lettree_ailleurs`).
export function lettrages(
  ecritures: readonly EcritureBrouillon[],
  // Le tiers de chaque pièce : un lettrage fait à la main ne s'applique qu'entre pièces d'un même tiers.
  pieces: readonly Pick<Piece, 'id' | 'tiers'>[],
  // Sans valeur par défaut : oubliés, les lettrages faits à la main disparaîtraient du FEC sans que rien le dise.
  lettragesManuels: readonly LettrageManuel[],
  // Sans valeur par défaut : en trésorerie rien ne se lettre, et l'oublier en engagement ne lettrerait rien.
  mode: ModeComptable,
): ReadonlyMap<string, LettrageDeLigne> {
  const resultat = new Map<string, LettrageDeLigne>()
  if (mode !== 'engagement') return resultat

  const parPieceEtCompte = lignesParPieceEtCompte(ecritures)
  const appliques = etatsDesLettragesManuels(ecritures, pieces, lettragesManuels, mode).filter((g) => g.motif === null)
  const dansUnLettrageManuel = new Set(appliques.flatMap((g) => g.pieceIds))

  const naissances: Naissance[] = []
  const soldees = soldesParPiece(parPieceEtCompte)
  for (const [pieceId, lignesSoldees] of soldees) {
    // Une pièce dont deux comptes se soldent n'est lettrée sur aucun ; une pièce d'un lettrage fait à la main qui tient
    // ne se solde jamais seule (`etatsDesLettragesManuels` le vérifie), la condition ne fait que le redire.
    if (lignesSoldees.length > 1 || dansUnLettrageManuel.has(pieceId)) continue
    naissances.push(naissance(pieceId, lignesSoldees[0], null))
  }
  for (const g of appliques) {
    naissances.push(naissance(g.groupe, g.pieceIds.flatMap((id) => parPieceEtCompte.get(`${id}|${g.compte}`) ?? []), g.le))
  }

  const parCompte = new Map<string, Naissance[]>()
  for (const n of naissances) parCompte.set(n.compte, [...(parCompte.get(n.compte) ?? []), n])
  for (const groupes of parCompte.values()) {
    groupes.sort((a, b) => a.date.localeCompare(b.date) || a.premiere.localeCompare(b.premiere) || a.cle.localeCompare(b.cle))
    groupes.forEach((g, rang) => {
      const lettrage = { code: codeLettrage(rang), date: g.date }
      for (const e of g.lignes) resultat.set(e.id, lettrage)
    })
  }
  return resultat
}

// Un lettrage né : ses lignes, son compte, sa date, et de quoi le ranger parmi les autres.
interface Naissance {
  cle: string
  compte: string
  lignes: EcritureBrouillon[]
  date: string
  premiere: string
}

function naissance(cle: string, lignes: EcritureBrouillon[], lettreLe: string | null): Naissance {
  const plusRecente = lignes.reduce((max, e) => (e.date > max ? e.date : max), lignes[0].date)
  const creation = lignes.reduce((max, e) => {
    const jour = jourDeCreation(e)
    return jour !== null && jour > max ? jour : max
  }, plusRecente)
  return {
    cle,
    compte: lignes[0].compte,
    lignes,
    date: lettreLe !== null && lettreLe > creation ? lettreLe : creation,
    premiere: lignes.reduce((min, e) => (e.date < min ? e.date : min), lignes[0].date),
  }
}

// Les lignes de chaque pièce sur les comptes où elles se soldent seules, par pièce : une entrée par compte soldé.
function soldesParPiece(parPieceEtCompte: ReadonlyMap<string, EcritureBrouillon[]>): Map<string, EcritureBrouillon[][]> {
  const soldees = new Map<string, EcritureBrouillon[][]>()
  for (const lignes of parPieceEtCompte.values()) {
    if (somme(lignes) !== 0) continue
    const pieceId = lignes[0].piece_id!
    soldees.set(pieceId, [...(soldees.get(pieceId) ?? []), lignes])
  }
  return soldees
}

// ── LES LETTRAGES FAITS À LA MAIN ───────────────────────────────────────────────────────────────────────────────
//
// Ce que `lettrer_pieces` a vérifié au moment du clic, refait à chaque lecture, plus ce que la base ne sait pas
// vérifier : que les pièces soient du même tiers. Un lettrage qui ne tient plus n'est PAS appliqué — ni au FEC, ni aux
// comptes de tiers — et son motif est rendu, pour que l'écran dise quoi faire : le défaire, le plus souvent.

export type MotifLettrageManuel =
  // Une de ses pièces a été supprimée depuis (`on delete set null`).
  | 'piece_supprimee'
  // Il n'apparie plus qu'une pièce : ses autres lignes ont été retirées hors de l'application.
  | 'une_seule_piece'
  // Ses pièces ne sont pas lettrées sur le même compte — défensif : `lettrer_pieces` n'écrit qu'un compte.
  | 'comptes_differents'
  // Une de ses pièces n'est pas dans la lecture : son tiers n'est pas connu.
  | 'piece_non_lue'
  // Une de ses pièces va au compte « divers », qui mêle des tiers différents.
  | 'tiers_non_identifie'
  // Ses pièces ne sont plus du même tiers : un tiers corrigé depuis.
  | 'tiers_differents'
  // Une de ses pièces n'a plus d'écriture sur ce compte.
  | 'sans_ecriture'
  // Une de ses pièces est désormais soldée par ses règlements : elle se lettre seule.
  | 'piece_soldee_seule'
  // Une de ses pièces se solde sur un autre compte de tiers — défensif, comme la règle d'un lettrage par pièce.
  | 'piece_lettree_ailleurs'
  // Ses pièces ne se soldent plus : un rapprochement posé ou annulé depuis.
  | 'ne_se_solde_plus'

export const MOTIFS_LETTRAGE_MANUEL: Readonly<Record<MotifLettrageManuel, string>> = {
  piece_supprimee: 'Une de ses pièces a été supprimée depuis.',
  une_seule_piece: 'Il n’apparie plus qu’une pièce.',
  comptes_differents: 'Ses pièces ne sont pas lettrées sur le même compte.',
  piece_non_lue: 'Une de ses pièces n’a pas pu être lue : son tiers n’est pas connu.',
  tiers_non_identifie: 'Une de ses pièces n’a pas de tiers identifié : au compte « divers », rien ne dit qu’elles sont du même tiers.',
  tiers_differents: 'Ses pièces ne sont plus du même tiers.',
  sans_ecriture: 'Une de ses pièces n’a plus d’écriture sur ce compte.',
  piece_soldee_seule: 'Une de ses pièces est désormais soldée par ses règlements : elle se lettre seule.',
  piece_lettree_ailleurs: 'Une de ses pièces se solde sur un autre compte de tiers, où elle est lettrée.',
  ne_se_solde_plus: 'Ses pièces ne se soldent plus.',
}

export interface EtatLettrageManuel {
  groupe: string
  compte: string
  // Le compte auxiliaire de ses pièces (CompAuxNum) pour un 401, 404 ou 411 ; nul pour le 455 et le 467.
  auxiliaire: string | null
  // Le tiers, ou le libellé du compte quand il n'a pas de compte auxiliaire.
  libelle: string
  // Les pièces encore présentes, dans l'ordre de leur identifiant.
  pieceIds: string[]
  // AAAA-MM-JJ : le jour où le cabinet a lettré, à Paris ; nul sur une date illisible.
  le: string | null
  // Ce qui reste sur le compte pour ces pièces, dans le sens normal du compte : nul pour un lettrage qui tient.
  reste: number
  // Nul quand le lettrage tient, et alors seulement il est appliqué.
  motif: MotifLettrageManuel | null
}

// Le compte « divers » d'un compte de tiers : là où va une pièce dont le tiers n'a pas de clé (lib/engagement.ts). Il
// mêle des tiers différents, donc rien n'y prouve que deux pièces soient du même tiers. Comparé au numéro exact : un
// fournisseur dont le nom finit par « divers » a son propre compte auxiliaire.
export function estDivers(compte: string, auxiliaire: string): boolean {
  return auxiliaire === auxiliaireDuTiers({ tiers: null }, compte)?.num
}

export function etatsDesLettragesManuels(
  ecritures: readonly EcritureBrouillon[],
  pieces: readonly Pick<Piece, 'id' | 'tiers'>[],
  lettragesManuels: readonly LettrageManuel[],
  mode: ModeComptable,
): EtatLettrageManuel[] {
  if (mode !== 'engagement') return []
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const parPieceEtCompte = lignesParPieceEtCompte(ecritures)
  const soldees = soldesParPiece(parPieceEtCompte)
  const sommeDe = (pieceId: string, compte: string) => somme(parPieceEtCompte.get(`${pieceId}|${compte}`) ?? [])

  const groupes = new Map<string, LettrageManuel[]>()
  for (const l of lettragesManuels) groupes.set(l.groupe, [...(groupes.get(l.groupe) ?? []), l])

  const etats = [...groupes.entries()].map(([groupe, lignesDuGroupe]): EtatLettrageManuel => {
    const lignes = [...lignesDuGroupe].sort((a, b) => a.id.localeCompare(b.id))
    const compte = lignes[0].compte
    const pieceIds = lignes.flatMap((l) => (l.piece_id ? [l.piece_id] : [])).sort()
    const jours = lignes.map(jourDeCreation).filter((j): j is string => j !== null)
    const reste = lignes.reduce((t, l) => t + (l.piece_id ? sommeDe(l.piece_id, l.compte) : 0), 0)
    const auxiliaires = pieceIds.map((id) => (pieceById.has(id) ? auxiliaireDuTiers(pieceById.get(id)!, compte) : null))
    const premier = auxiliaires.find((a) => a !== null) ?? null

    let motif: MotifLettrageManuel | null = null
    if (lignes.some((l) => !l.piece_id)) motif = 'piece_supprimee'
    else if (lignes.length < 2) motif = 'une_seule_piece'
    else if (lignes.some((l) => l.compte !== compte) || !COMPTES_LETTRABLES.has(compte)) motif = 'comptes_differents'
    else if (pieceIds.some((id) => !pieceById.has(id))) motif = 'piece_non_lue'
    else if (auxiliaires.some((a) => a !== null && estDivers(compte, a.num))) motif = 'tiers_non_identifie'
    else if (new Set(auxiliaires.map((a) => a?.num ?? '')).size > 1) motif = 'tiers_differents'
    else if (pieceIds.some((id) => !parPieceEtCompte.has(`${id}|${compte}`))) motif = 'sans_ecriture'
    else if (pieceIds.some((id) => sommeDe(id, compte) === 0)) motif = 'piece_soldee_seule'
    else if (pieceIds.some((id) => (soldees.get(id) ?? []).length > 0)) motif = 'piece_lettree_ailleurs'
    else if (reste !== 0) motif = 'ne_se_solde_plus'

    return {
      groupe,
      compte,
      auxiliaire: premier?.num ?? null,
      libelle: premier?.lib ?? libelleCompteTenu(compte) ?? compte,
      pieceIds,
      le: jours.length > 0 ? jours.reduce((max, j) => (j > max ? j : max)) : null,
      // `+ 0` : un reste nul retourné rend -0.
      reste: euros(sensNormal(compte) === 'debit' ? reste : -reste) + 0,
      motif,
    }
  })
  return etats.sort((a, b) =>
    ORDRE_DES_COMPTES.indexOf(a.compte) - ORDRE_DES_COMPTES.indexOf(b.compte)
    || a.libelle.localeCompare(b.libelle, 'fr')
    || (a.le ?? '').localeCompare(b.le ?? '')
    || a.groupe.localeCompare(b.groupe))
}

// Les pièces que solde un lettrage fait à la main QUI TIENT : en engagement, une facture lettrée avec son avoir
// n'attend plus de règlement, et les écrans qui comptent les factures « sans règlement rapproché » la retirent.
export function piecesLettreesALaMain(etats: readonly EtatLettrageManuel[]): Set<string> {
  return new Set(etats.filter((e) => e.motif === null).flatMap((e) => e.pieceIds))
}

// Ce que `lettrer_pieces` refuserait, dit AVANT le clic et dans le même ordre — plus ce que la base ne sait pas
// vérifier : que les pièces soient du même tiers, identifié. Calculé sur TOUT le brouillon, comme la base.
export function refusLettrageManuel(
  compte: string,
  pieceIds: readonly string[],
  ecritures: readonly EcritureBrouillon[],
  pieces: readonly Pick<Piece, 'id' | 'tiers'>[],
  lettragesManuels: readonly LettrageManuel[],
  mode: ModeComptable,
): string | null {
  if (mode !== 'engagement') return 'Le lettrage ne se fait que dans un dossier tenu en engagement.'
  if (!COMPTES_LETTRABLES.has(compte)) return 'Ce compte n’est pas un compte de tiers qui se lettre.'
  if (pieceIds.length < 2) return 'Un lettrage fait à la main apparie au moins deux pièces.'
  if (new Set(pieceIds).size !== pieceIds.length) return 'Une pièce est choisie deux fois.'

  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const parPieceEtCompte = lignesParPieceEtCompte(ecritures)
  const soldees = soldesParPiece(parPieceEtCompte)
  const lettreesALaMain = new Set(lettragesManuels.flatMap((l) => (l.piece_id ? [l.piece_id] : [])))
  for (const id of pieceIds) {
    // La base dit « n'appartient pas à ce dossier » ; ici, une pièce absente de la lecture n'est simplement pas lue.
    if (!pieceById.has(id)) return 'Une des pièces n’a pas pu être lue : son tiers n’est pas connu.'
    if (lettreesALaMain.has(id)) return 'Une des pièces est déjà lettrée à la main avec d’autres : défais d’abord ce lettrage.'
    const lignes = parPieceEtCompte.get(`${id}|${compte}`)
    if (!lignes) return 'Une des pièces n’a aucune écriture sur ce compte : génère d’abord ses écritures.'
    if (somme(lignes) === 0) return 'Une des pièces est déjà soldée par ses règlements : elle se lettre seule.'
    if ((soldees.get(id) ?? []).length > 0) return 'Une des pièces se solde sur un autre compte de tiers, où elle est lettrée.'
  }

  const auxiliaires = pieceIds.map((id) => auxiliaireDuTiers(pieceById.get(id)!, compte))
  if (auxiliaires.some((a) => a !== null && estDivers(compte, a.num))) {
    return 'Une des pièces n’a pas de tiers identifié : au compte « divers », rien ne dit qu’elles sont du même tiers.'
  }
  if (new Set(auxiliaires.map((a) => a?.num ?? '')).size > 1) return 'Ces pièces ne sont pas du même tiers.'

  const reste = pieceIds.reduce((t, id) => t + somme(parPieceEtCompte.get(`${id}|${compte}`)!), 0)
  if (reste !== 0) return `Ces pièces ne se soldent pas : il reste ${formatMoney(euros(Math.abs(reste)))} sur le compte.`
  return null
}

export interface LettrageProposé {
  compte: string
  auxiliaire: string | null
  libelle: string
  // Dans l'ordre de leur identifiant.
  pieceIds: string[]
  // Dans le sens normal du compte : ce que les pièces du sens normal portent ensemble (les factures, quand un avoir
  // les solde).
  montant: number
}

// Les lettrages évidents, PROPOSÉS — c'est le clic du cabinet qui lettre. Pour chaque tiers, parmi ses pièces ouvertes
// qui pourraient se lettrer (`refusLettrageManuel` ne dirait rien de chacune) : toutes ensemble quand elles se soldent
// — un tiers au solde nul qui porte encore des pièces ouvertes —, sinon les PAIRES qui se soldent sans doute possible,
// une facture et un avoir du même montant que rien d'autre chez ce tiers ne pourrait solder. Quand deux factures du
// même montant attendent un seul avoir, rien n'est proposé : choisir la première serait trancher par l'ordre de tri.
export function lettragesProposes(
  ecritures: readonly EcritureBrouillon[],
  pieces: readonly Pick<Piece, 'id' | 'tiers'>[],
  lettragesManuels: readonly LettrageManuel[],
  mode: ModeComptable,
): LettrageProposé[] {
  if (mode !== 'engagement') return []
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const parPieceEtCompte = lignesParPieceEtCompte(ecritures)
  const soldees = soldesParPiece(parPieceEtCompte)
  const lettreesALaMain = new Set(lettragesManuels.flatMap((l) => (l.piece_id ? [l.piece_id] : [])))

  const parTiers = new Map<string, { compte: string; auxiliaire: string | null; libelle: string; restes: Map<string, number> }>()
  for (const lignes of parPieceEtCompte.values()) {
    const pieceId = lignes[0].piece_id!
    const compte = lignes[0].compte
    const piece = pieceById.get(pieceId)
    const reste = somme(lignes)
    if (!piece || reste === 0 || lettreesALaMain.has(pieceId) || (soldees.get(pieceId) ?? []).length > 0) continue
    const auxiliaire = auxiliaireDuTiers(piece, compte)
    if (auxiliaire && estDivers(compte, auxiliaire.num)) continue
    const cle = `${compte}|${auxiliaire?.num ?? ''}`
    if (!parTiers.has(cle)) {
      parTiers.set(cle, { compte, auxiliaire: auxiliaire?.num ?? null, libelle: auxiliaire?.lib ?? libelleCompteTenu(compte) ?? compte, restes: new Map() })
    }
    parTiers.get(cle)!.restes.set(pieceId, reste)
  }

  const propositions: LettrageProposé[] = []
  for (const tiers of parTiers.values()) {
    const ouvertes = [...tiers.restes.entries()].sort(([a], [b]) => a.localeCompare(b))
    const propose = (ids: string[]) => {
      const normal = ids.reduce((t, id) => {
        const r = tiers.restes.get(id)!
        const enSensNormal = sensNormal(tiers.compte) === 'debit' ? r : -r
        return enSensNormal > 0 ? t + enSensNormal : t
      }, 0)
      propositions.push({ compte: tiers.compte, auxiliaire: tiers.auxiliaire, libelle: tiers.libelle, pieceIds: ids, montant: euros(normal) })
    }
    if (ouvertes.length < 2) continue
    if (ouvertes.reduce((t, [, r]) => t + r, 0) === 0) {
      propose(ouvertes.map(([id]) => id))
      continue
    }
    const combien = new Map<number, number>()
    for (const [, r] of ouvertes) combien.set(r, (combien.get(r) ?? 0) + 1)
    for (const [id, r] of ouvertes) {
      // Chaque paire une fois : depuis la pièce du sens positif.
      if (r < 0 || combien.get(r) !== 1 || combien.get(-r) !== 1) continue
      const autre = ouvertes.find(([, x]) => x === -r)![0]
      propose([id, autre].sort())
    }
  }
  return propositions.sort((a, b) =>
    ORDRE_DES_COMPTES.indexOf(a.compte) - ORDRE_DES_COMPTES.indexOf(b.compte)
    || a.libelle.localeCompare(b.libelle, 'fr')
    || a.pieceIds[0].localeCompare(b.pieceIds[0]))
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
  // Le lettrage fait à la main où la pièce figure, qu'il tienne ou non : une pièce ouverte qui y figure attend qu'on le
  // défasse ou que ses pièces se soldent de nouveau, et ne se lettre pas une seconde fois.
  lettrageManuel: string | null
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

// Fournisseurs, fournisseurs d'immobilisations, clients, puis le dirigeant : l'ordre de la vue et de ses listes.
const ORDRE_DES_COMPTES: readonly string[] = [
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_AUTRES_DEBITEURS_CREDITEURS,
]

// UN LETTRAGE FAIT À LA MAIN FERME SES PIÈCES À UNE DATE quand il tient et que leurs lignes datées jusqu'à elle se
// soldent ensemble, chacune y ayant déjà au moins une ligne : un avoir daté après l'arrêté laisse la facture ouverte à
// l'arrêté, comme un règlement daté après lui. Ce qui ne se solde pas à la date se lit pièce par pièce, comme avant.
export function comptesDeTiers(
  ecritures: readonly EcritureBrouillon[],
  pieces: readonly Pick<Piece, 'id' | 'tiers' | 'nom_fichier'>[],
  aNouveaux: readonly ANouveau[],
  // Sans valeur par défaut : oubliés, une facture et l'avoir qui la solde resteraient ouverts tous les deux.
  lettragesManuels: readonly LettrageManuel[],
  mode: ModeComptable,
  // AAAA-MM-JJ : la vue se lit au soir de ce jour.
  dateArrete: string,
): SoldeDeTiers[] {
  if (mode !== 'engagement') return []
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const lettrageDeLaPiece = new Map(lettragesManuels.flatMap((l) => (l.piece_id ? [[l.piece_id, l.groupe] as const] : [])))
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

  const fermees = new Set<string>()
  for (const g of etatsDesLettragesManuels(ecritures, pieces, lettragesManuels, mode)) {
    if (g.motif !== null) continue
    const cles = g.pieceIds.map((id) => `${id}|${g.compte}`)
    if (cles.some((c) => !parPiece.has(c)) || cles.reduce((t, c) => t + somme(parPiece.get(c)!), 0) !== 0) continue
    for (const c of cles) fermees.add(c)
  }

  for (const [cle, lignes] of parPiece) {
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
    if (resteCentimes === 0 || fermees.has(cle)) continue
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
      lettrageManuel: lettrageDeLaPiece.get(pieceId) ?? null,
    })
    s.trancheCentimes[tranche(age)] += resteCentimes
  }

  const ordreOrigine: Record<OrigineDuSolde, number> = { tiers: 0, sans_piece: 1, ouverture: 2 }
  return [...soldes.values()]
    // Un tiers dont tout est soldé n'a rien à dire ; un tiers au solde nul mais qui porte un trop-payé et une facture
    // ouverte, si : ce sont deux pièces à lettrer ensemble, pas une balance à zéro.
    .filter((s) => s.centimes !== 0 || s.pieces.length > 0)
    .map(({ centimes: c, trancheCentimes, ...s }) => ({
      ...s,
      solde: euros(c),
      tranches: trancheCentimes.map(euros) as [number, number, number, number],
      pieces: [...s.pieces].sort((a, b) => b.age - a.age || a.pieceId.localeCompare(b.pieceId)),
    }))
    .sort((a, b) =>
      ORDRE_DES_COMPTES.indexOf(a.compte) - ORDRE_DES_COMPTES.indexOf(b.compte)
      || ordreOrigine[a.origine] - ordreOrigine[b.origine]
      || a.libelle.localeCompare(b.libelle, 'fr')
      || (a.auxiliaire ?? '').localeCompare(b.auxiliaire ?? ''))
}
