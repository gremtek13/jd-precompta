import { DEVISE_PIVOT, montantPlausiblePourDevise } from './devises'
import type { LigneBancaire, Piece } from './types'

// Appariement pièce ↔ mouvement bancaire, et tri entre ce qui est certain et ce qui demande un
// arbitrage.
//
// L'intention produit : le cabinet ne doit relire que les cas douteux. Une pièce dont la banque
// confirme le montant, la date ET le fournisseur n'apprend rien à personne — la faire relire une par
// une, c'est le travail d'employé que cette application est censée supprimer. Mais « valider » est un
// acte professionnel : on ne le fait pas sur une ressemblance, on le fait sur une concordance.
//
// **Trois signaux indépendants, tous obligatoires.** Deux ne suffisent pas, et ce n'est pas une
// précaution théorique : sur le premier jeu de données réel, une pièce à 198 € avait le bon montant
// et la bonne date, un seul candidat en face — et un tiers lu « DARNIS JEREMY » (le nom du client
// lui-même) là où la banque disait « PRLV SEPA TRANSMEDICAL ». Les deux premiers critères la
// validaient avec un fournisseur faux. Le troisième l'a écartée.
//
// Un faux négatif coûte un clic. Un faux positif inscrit une donnée fausse comme vérifiée par le
// cabinet. Les règles ci-dessous penchent donc systématiquement vers l'arbitrage.

// Écart maximal entre la date de la pièce et celle du mouvement bancaire.
//
// Sept jours, et pas cinq, parce qu'un prélèvement mensuel est facturé le 1er ou le dernier jour du
// mois et débité le 5, le 6 ou le 7. À cinq jours, le cas le plus courant d'un dossier — l'abonnement
// prélevé — ne s'apparie jamais.
//
// Mesuré sur le relevé réel du dossier pilote, 41 pièces contre 385 mouvements :
//
//   tolérance |  certains | à arbitrer
//           5 |         0 |          4
//           6 |         4 |          5
//           7 |         6 |          6   <- retenu
//     8 à 15  |         6 |          7
//          30 |         4 |         21
//
// La courbe dit deux choses. Tout ce qui est gagnable l'est à sept jours : de 8 à 15, plus une seule
// paire certaine de plus. Et au-delà, ça se RETOURNE — à trente jours les mouvements récurrents du
// même montant deviennent interchangeables, « plusieurs mouvements possibles » explose, et le nombre
// de paires sûres RECULE. Élargir davantage ne rendrait pas le rapprochement plus permissif, ça le
// rendrait plus bête.
export const JOURS_TOLERANCE = 7

// Libellé générique posé par l'import quand la colonne « Libellé » du relevé est vide sur cette
// ligne (voir BanqueTab). Il ne dit rien : dans ce cas la ligne brute du fichier, conservée à part,
// contient le vrai texte de la banque. Sur le premier relevé réel, 250 lignes sur 385 étaient dans ce
// cas — sans ce repli, les deux tiers d'un relevé ne peuvent confirmer aucun fournisseur.
const LIBELLE_GENERIQUE = 'Mouvement bancaire'

export function libelleExploitable(ligne: Pick<LigneBancaire, 'libelle' | 'libelle_brut'>): string {
  const libelle = ligne.libelle?.trim() ?? ''
  if (libelle && libelle !== LIBELLE_GENERIQUE) return libelle
  return ligne.libelle_brut?.trim() ?? ''
}

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Mots trop courants pour identifier qui que ce soit. « Cabinet Martin » et « Cabinet Dupont » se
// confirmeraient l'un l'autre sur « cabinet » — exactement le faux positif que ce module existe pour
// éviter. S'y ajoutent les mots que la banque colle devant tous ses libellés.
const MOTS_NON_DISCRIMINANTS = new Set([
  'sarl', 'sasu', 'eurl', 'selarl', 'scop', 'societe', 'entreprise', 'cabinet', 'groupe',
  'monsieur', 'madame', 'france', 'paris', 'facture', 'client', 'compte', 'service', 'services',
  'prlv', 'sepa', 'virement', 'carte', 'achat', 'paiement', 'prelevement', 'mouvement', 'bancaire',
])

// Les mots d'un tiers qui peuvent réellement l'identifier. Cinq caractères au minimum : en dessous,
// un fragment se retrouve par hasard dans n'importe quel libellé bancaire.
export function motsIdentifiants(tiers: string | null): string[] {
  if (!tiers) return []
  return normaliser(tiers)
    .split(' ')
    .filter((mot) => mot.length >= 5 && !MOTS_NON_DISCRIMINANTS.has(mot))
}

// Le fournisseur lu sur la pièce se retrouve-t-il dans le libellé de la banque ? Un seul mot
// identifiant suffit, parce qu'un OCR ajoute volontiers du bruit autour du nom — sur le jeu réel,
// « Transmedical\net soigner redevient » (un bout du slogan collé au nom) est bien le même
// fournisseur que « PRLV SEPA TRANSMEDICAL ».
//
// Le sens de la recherche compte : on cherche le mot de la PIÈCE dans le libellé de la BANQUE, jamais
// l'inverse. Les libellés bancaires sont tronqués (« PRLV SEPA MACSF-ASSU- ») ; chercher leurs mots
// dans le tiers échouerait sur une troncature.
// La comparaison se fait mot à mot, jamais en cherchant une sous-chaîne dans le libellé entier : un
// nom peut en contenir un autre. « PRLV SEPA MEDICAL SERVICE » contient la suite de lettres
// « medical » présente aussi dans « Transmedical » — au centime et au jour près, ça validait le
// prélèvement d'un tout autre fournisseur. Défaut trouvé par le test, pas par la relecture.
//
// Un mot tronqué reste accepté, parce que les banques coupent leurs libellés
// (« SWISSLIFE PREVOYAN »), mais seulement en début de mot : l'un des deux doit commencer par
// l'autre. « medical » et « transmedical » ne se confirment donc dans aucun sens.
// Préfixe de terminal carte collé au nom du commerçant par la banque : « CB30ANTHROPIC* C »,
// « CB59FLAMACO », « CB30CONVERGENCE ». Il n'est séparé par rien, donc la comparaison mot à mot ne
// retrouve jamais le commerçant — « cb30convergence » ne commence pas par « convergence » et
// réciproquement. Constaté sur les trois dossiers : 56 mouvements par carte, dont AUCUN ne pouvait
// confirmer son fournisseur. Ils partaient tous à l'arbitrage manuel, en silence.
//
// Retiré mot par mot, jamais par une recherche de sous-chaîne dans le libellé entier : c'est
// précisément ce que ce module refuse de faire (voir plus bas). Le mot nettoyé reste soumis au
// plancher de cinq caractères, donc « CB30cote de boeu » ne rend pas « cote » identifiant.
const PREFIXE_CARTE = /^cb\d+/

export function tiersConfirmeParBanque(tiers: string | null, libelleBanque: string): boolean {
  const mots = motsIdentifiants(tiers)
  if (mots.length === 0) return false
  const motsBanque = normaliser(libelleBanque)
    .split(' ')
    .flatMap((m) => (PREFIXE_CARTE.test(m) ? [m, m.replace(PREFIXE_CARTE, '')] : [m]))
    .filter((m) => m.length >= 5)
  if (motsBanque.length === 0) return false
  return mots.some((mot) => motsBanque.some((b) => b.startsWith(mot) || mot.startsWith(b)))
}

export type MotifArbitrage =
  | 'plusieurs mouvements possibles'
  | 'plusieurs pièces possibles'
  | 'aucun fournisseur lu sur la pièce'
  | 'fournisseur non confirmé par le libellé bancaire'
  | 'sens contraire au type de pièce'

export interface Appariement {
  piece: Piece
  ligne: LigneBancaire
  ecartJours: number
}

export interface AppariementDouteux extends Appariement {
  motif: MotifArbitrage
}

export interface AnalyseAppariements {
  // Concordance sur les trois signaux : ces pièces peuvent être validées et rapprochées en un geste.
  certains: Appariement[]
  // Tout le reste de ce qui ressemble à un appariement, avec la raison du doute. Présenté à
  // l'opérateur plutôt qu'écarté : c'est là que se trouve son travail.
  aArbitrer: AppariementDouteux[]
}

function jourDe(iso: string): number {
  // Comparaison de dates seules, en UTC : passer par l'heure locale ferait varier l'écart d'un jour
  // selon le fuseau de la machine qui ouvre l'écran.
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000
}

// L'égalité des montants au centime est le premier des trois signaux — sauf pour une pièce libellée
// en devise étrangère, où elle ne peut JAMAIS être vraie : la facture dit 24,00 USD, la banque débite
// 20,68 € à son propre cours, frais compris. Exiger l'égalité reviendrait à ne jamais rapprocher une
// facture étrangère, donc à ne jamais connaître son montant réel.
//
// Elle est alors remplacée — pas supprimée — par une borne de vraisemblance autour de la conversion
// provisoire (voir ECART_CHANGE_TOLERE). Trois signaux indépendants restent donc exigés, et c'est
// délibéré : sur le relevé réel du dossier, la facture OpenAI d'août (20,60 € convertis) tombe à
// 4,3 % d'un prélèvement d'assurance MACSF de 19,72 € daté de cinq jours plus tard. Montant
// plausible, date dans la tolérance — seul le libellé l'écarte. La borne ne confirme rien à elle
// seule, elle écarte l'absurde.
//
// Une pièce en devise qu'on n'a pas su convertir n'a pas d'ancre du tout : aucun montant ne peut
// alors être jugé plausible, et la paire n'est pas formée ici. Elle se rapproche à la main, ce qui
// est le bon niveau d'attention pour une pièce dont on ignore encore ce qu'elle vaut.
function montantCompatible(piece: Piece, ligne: LigneBancaire): boolean {
  // Une devise ÉTRANGÈRE EXPLICITE, jamais « tout ce qui n'est pas EUR » : une pièce dont le champ
  // manque — requête qui ne l'a pas sélectionné, ligne construite à la main — vaudrait sinon devise
  // étrangère, et TOUTES les pièces gagneraient silencieusement cinq pour cent de tolérance sur le
  // montant. La règle stricte est celle par défaut ; l'assouplissement doit être demandé.
  if (piece.devise && piece.devise !== DEVISE_PIVOT) {
    return montantPlausiblePourDevise(piece.montant_ttc!, ligne.montant)
  }
  return Math.abs(Math.abs(piece.montant_ttc!) - Math.abs(ligne.montant)) <= 0.01
}

function sensCoherent(piece: Piece, ligne: LigneBancaire): boolean {
  // Une pièce à montant négatif est un avoir : il revient sur le compte, donc en crédit pour un achat.
  const montantPiece = piece.montant_ttc ?? 0
  const attenduPositif = (piece.type_piece === 'vente') !== (montantPiece < 0)
  return attenduPositif ? ligne.montant > 0 : ligne.montant < 0
}

// Un montant qui n'apparaît nulle part dans le relevé importé, à AUCUNE date, est un signal plus
// grave qu'une simple absence de rapprochement : deux causes possibles, qu'aucune règle interne au
// document ne peut départager. Soit le relevé est incomplet (l'opération n'a jamais été déposée sur
// ce compte) — soit le montant lu sur la pièce est FAUX, l'extraction ayant pris le mauvais total
// d'un document qui en porte plusieurs (sous-total de ligne, solde antérieur, montant déjà réglé). Ces
// trois montants bouclent alors entre eux (HT + TVA = TTC) sans que rien à l'intérieur du document ne
// les contredise — `piecesTvaImpossible` ne voit rien. Seule une source EXTÉRIEURE au document, le
// relevé bancaire, peut lever le doute : d'où la dépendance de ce contrôle au rapprochement plutôt
// qu'à l'OCR.
//
// Ignore les pièces en devise étrangère : leur montant en euros est une conversion au taux du jour du
// dépôt (voir lib/tauxChange.ts), jamais le montant qui doit apparaître tel quel sur le relevé — c'est
// `montantCompatible` qui gère déjà leur cas avec une tolérance dédiée.
//
// Ne regarde que le MONTANT, sans tolérance de date ni de tiers : c'est délibéré. La question posée
// ici n'est pas « ce mouvement est-il celui de cette pièce » (le travail d'`analyserAppariements`),
// mais « ce montant existe-t-il quelque part dans ce qui a été importé ». Élargir la date la
// rendrait aveugle à un relevé qui ne couvre simplement pas la bonne période.
export function piecesMontantIntrouvableEnBanque(pieces: Piece[], lignes: LigneBancaire[]): Piece[] {
  return pieces.filter((piece) => {
    if (piece.montant_ttc == null) return false
    if (piece.devise && piece.devise !== DEVISE_PIVOT) return false
    return !lignes.some((ligne) => Math.abs(Math.abs(piece.montant_ttc!) - Math.abs(ligne.montant)) <= 0.01)
  })
}

export function analyserAppariements(
  pieces: Piece[],
  lignes: LigneBancaire[],
  joursTolerance = JOURS_TOLERANCE,
): AnalyseAppariements {
  const piecesUtiles = pieces.filter((p) => p.montant_ttc != null && p.date_piece)
  const lignesUtiles = lignes.filter((l) => l.statut === 'non_rapprochee')

  const paires: Appariement[] = []
  for (const piece of piecesUtiles) {
    for (const ligne of lignesUtiles) {
      if (!montantCompatible(piece, ligne)) continue
      const ecartJours = Math.abs(jourDe(piece.date_piece!) - jourDe(ligne.date))
      if (ecartJours > joursTolerance) continue
      paires.push({ piece, ligne, ecartJours })
    }
  }

  // Unicité mutuelle : une pièce qui pourrait aller sur deux mouvements, ou un mouvement que deux
  // pièces se disputent, n'est pas un cas certain — même si tout le reste concorde. C'est ce qui
  // arrive avec deux factures mensuelles identiques, ou une pièce déposée deux fois.
  const lignesParPiece = new Map<string, number>()
  const piecesParLigne = new Map<string, number>()
  for (const p of paires) {
    lignesParPiece.set(p.piece.id, (lignesParPiece.get(p.piece.id) ?? 0) + 1)
    piecesParLigne.set(p.ligne.id, (piecesParLigne.get(p.ligne.id) ?? 0) + 1)
  }

  const certains: Appariement[] = []
  const aArbitrer: AppariementDouteux[] = []

  for (const paire of paires) {
    const motif = motifDeDoute(paire, lignesParPiece, piecesParLigne)
    if (motif) aArbitrer.push({ ...paire, motif })
    else certains.push(paire)
  }

  // Le plus sûr d'abord : écart de date le plus faible, à égalité le montant le plus élevé (celui
  // dont une erreur coûterait le plus cher à laisser passer).
  const parCertitude = (a: Appariement, b: Appariement) =>
    a.ecartJours - b.ecartJours || Math.abs(b.ligne.montant) - Math.abs(a.ligne.montant)
  certains.sort(parCertitude)
  aArbitrer.sort(parCertitude)

  return { certains, aArbitrer }
}

function motifDeDoute(
  paire: Appariement,
  lignesParPiece: Map<string, number>,
  piecesParLigne: Map<string, number>,
): MotifArbitrage | null {
  if ((lignesParPiece.get(paire.piece.id) ?? 0) > 1) return 'plusieurs mouvements possibles'
  if ((piecesParLigne.get(paire.ligne.id) ?? 0) > 1) return 'plusieurs pièces possibles'
  if (!sensCoherent(paire.piece, paire.ligne)) return 'sens contraire au type de pièce'
  if (motsIdentifiants(paire.piece.tiers).length === 0) return 'aucun fournisseur lu sur la pièce'
  if (!tiersConfirmeParBanque(paire.piece.tiers, libelleExploitable(paire.ligne))) {
    return 'fournisseur non confirmé par le libellé bancaire'
  }
  return null
}

// ————————————————————————————————————————————————————————————————————————————————————————————————
// RAPPROCHEMENT ASSISTÉ DE L'ÉCRAN BANQUE — une politique DIFFÉRENTE de celle ci-dessus, et c'est
// voulu.
//
// `analyserAppariements` décide s'il faut VALIDER une pièce, acte professionnel : trois signaux, dont
// le fournisseur lu dans le libellé, et sept jours de tolérance. Ce qui suit décide s'il faut RELIER
// un mouvement à une pièce DÉJÀ validée par un humain : deux signaux (montant au centime, date à cinq
// jours), parce que la pièce a déjà été regardée. Les deux tolérances sont donc distinctes par
// construction et ne doivent pas être confondues — d'où deux constantes, deux noms.
//
// CE QUI N'EST PAS UNE POLITIQUE, EN REVANCHE, C'EST DE TRANCHER À PILE OU FACE. L'écran faisait
// `piecesValidees.find(...)` : quand deux pièces convenaient aussi bien l'une que l'autre, la
// première de la liste gagnait, en masse, sur un clic, sans que rien ne le dise. Or le commentaire
// de `motifDeDoute` ci-dessus nomme exactement ce cas — « deux factures mensuelles identiques, ou
// une pièce déposée deux fois » — et ce dossier en porte un : deux dépôts du même document
// Transmedical à 38,40 €, que ce fichier documente depuis longtemps. Le module refusait de trancher
// pendant que l'écran tranchait.
//
// Un faux négatif coûte un clic : la ligne reste dans la liste, avec son panneau qui montre TOUTES
// les candidates triées. Un faux positif attache le mauvais justificatif à un mouvement, laisse le
// vrai mouvement de l'autre mois sans pièce, et part en piste d'audit.
export const JOURS_TOLERANCE_RAPPROCHEMENT = 5

export interface CotisationRapprochable {
  id: string
  echeance: string
  montant_appele: number
  montant_verse: number | null
}

export interface RapprochementPropose {
  ligneId: string
  pieceId?: string
  cotisationId?: string
}

export interface PlanRapprochement {
  retenus: RapprochementPropose[]
  // Lignes qui ont des candidates mais dont aucune ne s'impose — laissées à l'opérateur. Comptées
  // plutôt que tues : un bouton qui annonce « 12 » en traitant 9 ne dit pas où sont passées les 3
  // autres, et c'est la règle du pack (« un livrable incomplet le dit »).
  ecartesPourAmbiguite: number
}

function montantEgal(a: number | null | undefined, b: number): boolean {
  return a != null && Math.abs(Math.abs(a) - Math.abs(b)) <= 0.01
}

/** Les pièces validées qui conviennent à ce mouvement — toutes, jamais la première. */
export function candidatsPieces(
  ligne: LigneBancaire,
  piecesValidees: Piece[],
  dejaRapprochees: ReadonlySet<string>,
  joursTolerance = JOURS_TOLERANCE_RAPPROCHEMENT,
): Piece[] {
  return piecesValidees.filter((p) =>
    !dejaRapprochees.has(p.id)
    && p.date_piece != null
    && montantEgal(p.montant_ttc, ligne.montant)
    && Math.abs(jourDe(p.date_piece) - jourDe(ligne.date)) <= joursTolerance)
}

/**
 * Les échéances de cotisation qui conviennent à ce mouvement.
 *
 * Comparées au montant réellement VERSÉ quand il est connu — un appel n'est pas toujours prélevé
 * pour son montant appelé exact (régularisation, paiement partiel) — sinon au montant appelé, seul
 * chiffre disponible avant paiement.
 */
export function candidatsCotisations(
  ligne: LigneBancaire,
  cotisations: CotisationRapprochable[],
  dejaRapprochees: ReadonlySet<string>,
  joursTolerance = JOURS_TOLERANCE_RAPPROCHEMENT,
): CotisationRapprochable[] {
  return cotisations.filter((c) =>
    !dejaRapprochees.has(c.id)
    && montantEgal(c.montant_verse ?? c.montant_appele, ligne.montant)
    && Math.abs(jourDe(c.echeance) - jourDe(ligne.date)) <= joursTolerance)
}

/**
 * Ce que « Tout rapprocher automatiquement » doit écrire, et ce qu'il doit laisser.
 *
 * UNICITÉ MUTUELLE, DANS LES DEUX SENS, comme `analyserAppariements` : une ligne que deux pièces se
 * disputent n'est pas rapprochable, et une pièce que deux lignes se disputent non plus. La version
 * précédente parcourait les lignes dans l'ordre en « consommant » les pièces au passage : le premier
 * mouvement rencontré emportait la pièce, ce qui n'est pas un choix mais un effet de l'ordre de tri.
 *
 * La précédence pièce > cotisation est CONSERVÉE telle quelle : ce n'est pas un arbitrage entre
 * égaux mais une règle de l'écran, et la changer serait une décision produit.
 */
export function planRapprochementAutomatique(
  lignesNonRapprochees: LigneBancaire[],
  piecesValidees: Piece[],
  cotisations: CotisationRapprochable[],
  dejaRapprochees: { pieces: ReadonlySet<string>; cotisations: ReadonlySet<string> },
  joursTolerance = JOURS_TOLERANCE_RAPPROCHEMENT,
): PlanRapprochement {
  const parLignePieces = new Map<string, Piece[]>()
  const parLigneCotisations = new Map<string, CotisationRapprochable[]>()
  const lignesParPiece = new Map<string, number>()
  const lignesParCotisation = new Map<string, number>()

  for (const ligne of lignesNonRapprochees) {
    const pieces = candidatsPieces(ligne, piecesValidees, dejaRapprochees.pieces, joursTolerance)
    const cotis = candidatsCotisations(ligne, cotisations, dejaRapprochees.cotisations, joursTolerance)
    parLignePieces.set(ligne.id, pieces)
    parLigneCotisations.set(ligne.id, cotis)
    for (const p of pieces) lignesParPiece.set(p.id, (lignesParPiece.get(p.id) ?? 0) + 1)
    for (const c of cotis) lignesParCotisation.set(c.id, (lignesParCotisation.get(c.id) ?? 0) + 1)
  }

  const retenus: RapprochementPropose[] = []
  let ecartesPourAmbiguite = 0

  for (const ligne of lignesNonRapprochees) {
    const pieces = parLignePieces.get(ligne.id) ?? []
    const cotis = parLigneCotisations.get(ligne.id) ?? []
    if (pieces.length === 0 && cotis.length === 0) continue

    if (pieces.length === 1 && (lignesParPiece.get(pieces[0].id) ?? 0) === 1) {
      retenus.push({ ligneId: ligne.id, pieceId: pieces[0].id })
      continue
    }
    if (pieces.length === 0 && cotis.length === 1 && (lignesParCotisation.get(cotis[0].id) ?? 0) === 1) {
      retenus.push({ ligneId: ligne.id, cotisationId: cotis[0].id })
      continue
    }
    ecartesPourAmbiguite++
  }

  return { retenus, ecartesPourAmbiguite }
}
