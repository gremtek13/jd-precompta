import { paiementNet, seuilAlignement } from './alignementBanque'
import { dateLocaleDe } from './format'
import type { LigneBancaire, ModeComptable, Piece, ReglementGroupe } from './types'

// LA DATE À LAQUELLE UNE PIÈCE COMPTE, DANS UNE COMPTABILITÉ DE TRÉSORERIE (BNC, déclaration 2035).
//
// Le bénéfice non commercial se détermine sur les recettes EFFECTIVEMENT ENCAISSÉES et les dépenses
// EFFECTIVEMENT PAYÉES au cours de l'année (CGI, art. 93, 1). L'application rattachait pourtant chaque
// pièce à l'année de sa DATE DE FACTURE (`anneeDe(date_piece)`) : une facture de décembre réglée en
// janvier partait dans la déclaration de l'année d'avant — une dépense déduite un an trop tôt, une
// recette imposée un an trop tôt, sur un document signé. La correction a été demandée par le cabinet
// (28/09/2026) avant tout travail sur la comptabilité d'engagement.
//
// LA RÈGLE, en un seul endroit, pour la 2035, la situation intermédiaire, l'estimation et les
// écritures — qui doivent tous rendre la même année pour le même euro :
//   - une pièce compte à la date de son PAIEMENT quand le rapprochement bancaire la connaît ;
//   - sinon à sa DATE DE FACTURE : une note de frais, payée hors du compte professionnel, et une pièce
//     dont le paiement n'est pas encore rapproché. Pour la seconde, c'est une supposition, et les
//     écrans qui produisent un chiffre annuel la DISENT (source `sans_paiement`) ;
//   - une pièce qu'aucun paiement ni aucune date ne situe ne compte nulle part (date `null`), et les
//     écrans la rendent « sans date », comme avant.
//
// La part de chaque paiement vient de `partsDesPaiements`, la formule de l'onglet TVA : c'est la
// même question — quand cette pièce a-t-elle été réglée ? — et une règle écrite deux fois n'attend
// que de diverger.

// LES PAIEMENTS D'UNE PIÈCE, tels que tous les calculs les lisent : un paiement par le RELEVÉ — un mouvement RAPPROCHÉ de
// la pièce, la PART d'un mouvement qui règle plusieurs pièces (lib/reglementGroupe.ts, ligne 26 de la feuille de route),
// ou, depuis l'étape VF5h, l'ENCAISSEMENT d'une facture d'avant la bascule cité sur un mouvement classé par ses
// encaissements (le virement mixte, plus bas) —, ou, depuis l'étape C9a, un paiement par la CAISSE (une opération de
// genre `paiement` qui cite la pièce : CAISSE-Q4, (B)). Chacun est un paiement de sa pièce à SA date et de son montant :
// la 2035, la TVA et les écritures le lisent comme un rapprochement simple (CGI, art. 93, 1 : la recette encaissée, la
// dépense payée, quel que soit le moyen).
//
// UNE UNION DISCRIMINÉE PAR `origine`, et c'est voulu : seul un paiement par le relevé porte un `id` de MOUVEMENT. Le
// paiement par la caisse porte l'opération qui le fait (`operation_caisse_id`) et rien d'autre — chaque usage d'un
// paiement comme mouvement (la contrepartie banque, le règlement en engagement, l'alignement, la fiche d'un mouvement)
// cesse de compiler à son arrivée, et se juge (HISTORIQUE.md, « LA CAISSE : LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, DANS
// LES MOTEURS (C9A, LIGNE 26.6) »).
export type PaiementDePiece = PaiementParLeReleve | PaiementParLaCaisse

/** Un paiement de la pièce par la CAISSE du dossier (étape C9a) : l'opération de genre `paiement` qui la cite, à sa date
 *  (le jour où les espèces sont sorties, ou entrées pour une vente), d'un montant signé comme le relevé. AUCUN `id` de
 *  mouvement : ce n'en est pas un. */
export interface PaiementParLaCaisse {
  operation_caisse_id: string
  date: string
  montant: number
  origine: 'caisse'
}

/** Le paiement est-il par le relevé ? Ce qu'un usage du paiement comme MOUVEMENT exige (la banque, l'engagement). */
export function estParLeReleve(p: PaiementDePiece): p is PaiementParLeReleve {
  return p.origine !== 'caisse'
}

/** La clé d'un paiement, d'un moyen ou de l'autre : le mouvement, ou l'opération de la caisse. */
export function cleDuPaiement(p: PaiementDePiece): string {
  return p.origine === 'caisse' ? `caisse:${p.operation_caisse_id}` : p.id
}

export interface PaiementParLeReleve {
  /** Le mouvement bancaire : en engagement il désigne le règlement de la pièce, en trésorerie sa
   *  contrepartie banque. Deux parts d'un même mouvement portent le même, sur deux pièces différentes. */
  id: string
  date: string
  /** Ce que CE mouvement paie de CETTE pièce, signé comme le relevé : tout le mouvement pour un
   *  rapprochement, sa part pour un règlement groupé. */
  montant: number
  /** `groupe` : la part d'un règlement groupé ; `encaissements` : l'encaissement d'une facture d'avant la
   *  bascule, cité sur un mouvement classé par ses encaissements (le virement mixte, étape VF5h). Le champ
   *  sert aussi de garde : une ligne du relevé ne le porte pas, donc ne peut pas passer à la compilation pour
   *  les paiements d'une pièce — un filtre sur `piece_id` oublierait toutes les pièces réglées par un virement
   *  groupé, et celles qu'un virement mixte paie. */
  origine: 'rapprochement' | 'groupe' | 'encaissements'
}

/** Les paiements de chaque pièce, par identifiant de pièce. Ne se construit que par `paiementsDesPieces`,
 *  qui exige les parts des règlements groupés, celles des virements mixtes et les paiements par la caisse. */
export type PaiementsDesPieces = ReadonlyMap<string, readonly PaiementDePiece[]>

/** Ce que `paiementsDesPieces` lit d'une ligne du relevé. */
export type LignePayante = Pick<LigneBancaire,
  'id' | 'piece_id' | 'date' | 'montant' | 'statut' | 'reglement_groupe' | 'encaissements_de_factures'>

/** Ce qu'il lit d'une part de règlement groupé. */
export type PartReglee = Pick<ReglementGroupe, 'ligne_bancaire_id' | 'piece_id' | 'montant'>

/**
 * Ce qu'il lit d'un VIREMENT MIXTE (étape VF5h) : l'encaissement d'une facture qui n'est pas source de sa vente, cité
 * sur un mouvement — le mouvement, la pièce que cet encaissement paie, l'exemplaire unique et validé de la facture
 * (étape VF1), et son montant, signé comme le relevé. Ne se construit que par `partsEncaissees`
 * (lib/encaissementsFactures.ts), qui juge l'encaissement comme `classer_mouvement_par_encaissements` le compte.
 */
export interface PartEncaissee {
  ligne_bancaire_id: string
  piece_id: string
  montant: number
}

/**
 * Ce qu'il lit d'un PAIEMENT PAR LA CAISSE (étape C9a) : l'opération de genre `paiement`, la pièce qu'elle cite, sa date et
 * son montant, signé comme le relevé. Ne se construit que par `paiementsParLaCaisse` (lib/paiementParLaCaisse.ts), qui ne
 * garde que les paiements vivants — ni retirés, ni remplacés — et n'en rend AUCUN tant que la migration n'est pas en base
 * (`PAIEMENT_PAR_LA_CAISSE_EXPORTE` baissé).
 */
export interface PartPayeeParLaCaisse {
  operation_caisse_id: string
  piece_id: string
  date: string
  montant: number
}

/** Aucun paiement par la caisse : ce que passe un appelant qui, de son propre jugement, n'en compte pas — l'espace client,
 *  qui ne lit pas la caisse ; le badge « Rapprochée » d'une pièce, qui dit un mouvement bancaire. Écrit en toutes lettres,
 *  jamais une valeur par défaut. */
export const AUCUN_PAIEMENT_PAR_LA_CAISSE: readonly PartPayeeParLaCaisse[] = Object.freeze([])

// Les paiements de chaque pièce. Seul un mouvement RAPPROCHÉ paie une pièce : le statut est relu ici
// plutôt que supposé du côté de l'appelant, un `piece_id` sur une ligne remise à traiter étant exactement
// le lien qui ne doit plus rien dater. Une part ne compte que si son mouvement est lu, rapproché et réglé
// en groupe — une part que rien ne rattache à un tel mouvement, ou dont la pièce a été supprimée, ne paie
// rien, et `reglementsGroupesIncoherents` le dit.
//
// LES PARTS SONT OBLIGATOIRES, sans valeur par défaut : oubliées, toutes les pièces d'un virement groupé
// retomberaient sans paiement — comptées à leur date de facture dans la 2035, dans AUCUNE déclaration de
// TVA, et « à rapprocher » partout.
//
// LE VIREMENT MIXTE (chantier EC-Q3, étape VF5h ; VF2-Q2, selon VF5-Q2 : la manière A, « le registre DATE la
// pièce »). Un crédit qui paie une facture SOURCE de sa vente et une facture d'avant la bascule se classe par
// ses encaissements (`classer_mouvement_par_encaissements`, migration virement_mixte) ; la vente d'avant reste
// comptée par sa pièce, l'exemplaire désigné de sa facture, et l'encaissement cité sur ce mouvement en est un
// PAIEMENT, à la date du mouvement et de son montant, comme la part d'un règlement groupé : la 2035, la CA3, la
// situation et l'estimation la datent par la machinerie d'aujourd'hui (CGI, art. 93, 1), et une pièce compte
// une fois — ses paiements ne font que la dater ; une pièce payée en partie par un autre mouvement additionne
// ses paiements. Le mouvement est relu ici : lu, rapproché et CLASSÉ PAR SES ENCAISSEMENTS — un mouvement
// seulement réservé, ou dont le classement est retiré, ne date rien, et l'encaissement d'une facture d'avant cité
// sur un mouvement rapproché de sa pièce n'y ajoute rien : c'est le rapprochement qui la paie. Ces parts sont
// OBLIGATOIRES elles aussi, pour la même raison : oubliées, la pièce d'un virement mixte retomberait sans
// paiement, à sa date de facture.
//
// LE PAIEMENT PAR LA CAISSE (étape C9a ; CAISSE-Q4, (B)). Une pièce payée en espèces de la caisse du dossier — une
// opération de genre `paiement` qui la cite (`regler_piece_par_la_caisse`, migration `paiement_par_la_caisse`) — est
// payée à la date de cette opération et de son montant, comme par un mouvement : la 2035 la compte ce jour-là (CGI, art.
// 93, 1 ; BOI-BNC-BASE-20-10-10, § 10), la CA3 rend sa TVA exigible ou déductible à cette date selon le régime figé, et
// une pièce payée en partie par la banque et en partie par la caisse additionne ses paiements (`partsDesPaiements`).
// Aucune règle neuve : un paiement est un paiement. Ces paiements sont OBLIGATOIRES eux aussi, pour la même raison que les
// parts : oubliés, une pièce payée en espèces retomberait à sa date de facture, « sans paiement ». Ils arrivent filtrés
// (`paiementsParLaCaisse`) : ni retirés, ni remplacés, et AUCUN tant que la migration n'est pas en base — la liste vide
// rend alors, au caractère près, ce que la fonction rendait avant eux (`paiementParLaCaisse.test.ts`).
//
// Chaque liste est triée par date, puis le relevé avant la caisse, puis par mouvement ou par opération, pour que deux
// lectures rendent la même chose quel que soit l'ordre de la requête — la répartition des centimes d'une écriture en
// dépend. Une liste sans paiement par la caisse se trie comme avant (par date puis par mouvement).
export function paiementsDesPieces(
  lignes: readonly LignePayante[],
  reglements: readonly PartReglee[],
  encaissees: readonly PartEncaissee[],
  caisse: readonly PartPayeeParLaCaisse[],
): PaiementsDesPieces {
  const mouvements = new Map(lignes.map((l) => [l.id, l]))
  const parPiece = new Map<string, PaiementDePiece[]>()
  const ajouter = (pieceId: string, paiement: PaiementDePiece) => {
    const liste = parPiece.get(pieceId) ?? []
    liste.push(paiement)
    parPiece.set(pieceId, liste)
  }
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.piece_id) continue
    ajouter(ligne.piece_id, { id: ligne.id, date: ligne.date, montant: ligne.montant, origine: 'rapprochement' })
  }
  for (const part of reglements) {
    if (!part.piece_id) continue
    const mouvement = mouvements.get(part.ligne_bancaire_id)
    if (!mouvement || mouvement.statut !== 'rapprochee' || !mouvement.reglement_groupe) continue
    ajouter(part.piece_id, { id: mouvement.id, date: mouvement.date, montant: part.montant, origine: 'groupe' })
  }
  for (const part of encaissees) {
    const mouvement = mouvements.get(part.ligne_bancaire_id)
    if (!mouvement || mouvement.statut !== 'rapprochee' || !mouvement.encaissements_de_factures) continue
    ajouter(part.piece_id, { id: mouvement.id, date: mouvement.date, montant: part.montant, origine: 'encaissements' })
  }
  for (const part of caisse) {
    ajouter(part.piece_id, { operation_caisse_id: part.operation_caisse_id, date: part.date, montant: part.montant, origine: 'caisse' })
  }
  const rang = (p: PaiementDePiece) => (p.origine === 'caisse' ? 1 : 0)
  for (const liste of parPiece.values()) {
    liste.sort((a, b) => a.date.localeCompare(b.date) || rang(a) - rang(b) || cleDuPaiement(a).localeCompare(cleDuPaiement(b)))
  }
  return parPiece
}

// Les pièces qu'au moins un paiement règle, en tout ou en partie : ce que les écrans excluent des
// candidates à un rapprochement, et ce qu'ils disent « rapprochée ».
export function piecesPayees(paiements: PaiementsDesPieces): ReadonlySet<string> {
  return new Set(paiements.keys())
}

export interface PartsReglees {
  /** La part de la pièce que chaque paiement règle, à la date du paiement. */
  parts: { date: string; part: number }[]
  /** Ce qu'aucun paiement connu ne règle : 1 sans paiement, 0 pour une pièce réglée. */
  reste: number
}

// La part de la pièce que chaque paiement règle.
//
// Réglée quand les paiements couvrent le montant de la pièce À L'ÉCART D'ALIGNEMENT PRÈS (le seuil de
// `alignementBanque.ts`, décision du cabinet du 23/09/2026) : un frais bancaire ou un arrondi ne
// laisse pas un reste de quelques centimes à dater ailleurs. Chaque paiement porte alors sa part du
// total payé, et des frais qui font payer plus que la pièce ne la font pas compter plus d'une fois.
//
// Au-delà du seuil, c'est un PAIEMENT PARTIEL : chaque paiement porte sa part du montant de la pièce,
// et le reste n'est réglé par rien de connu. L'onglet TVA n'en fait rien (un acompte ne rend exigible
// que ce qu'il paie) ; `rattachementsTresorerie` le date à la facture, et le dit.
//
// LE TOTAL PAYÉ EST LA SOMME SIGNÉE DES PAIEMENTS (`paiementNet`, lib/alignementBanque.ts ; relecture du 31/10/2026), et
// chaque paiement y compte pour son montant RAPPORTÉ AU SENS de cette somme. Tous dans le même sens, rien ne change :
// chacun porte sa valeur absolue, comme avant. Un mouvement de sens contraire — le rejet d'un prélèvement, le
// remboursement d'un paiement fait en double — porte une part NÉGATIVE, à sa date : il défait, dans l'exercice où il
// passe au relevé, ce que le paiement qu'il annule avait compté. La prime de 1 200 € prélevée le 20/12/2025, rejetée le
// 28/12 et reprise le 05/01/2026 compte +1 et −1 en 2025, +1 en 2026 : rien en 2025, 1 200 € en 2026 — là où la valeur
// absolue en mettait 800 € en 2025. Et chaque date porte ce que la banque y porte : la charge de la pièce, écrite date
// par date (`centimesParDate`), fait face à la contrepartie banque de chaque mouvement, et l'écriture s'équilibre dans
// chaque exercice ; la part négative s'écrit dans l'autre sens, comme un avoir (`lignesChargeProduitPourPiece`). Une date
// où un paiement et son rejet s'annulent porte une part nulle : aucune charge, et ses deux lignes de banque se soldent
// entre elles.
//
// Une somme NULLE — un prélèvement rejeté et pas encore repris — ne paie rien : la pièce n'a pas de paiement net, et
// compte à sa date de facture comme une pièce sans paiement connu, ce que la 2035 dit (`sans_paiement`).
export function partsDesPaiements(
  piece: Pick<Piece, 'montant_ttc'>,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
): PartsReglees {
  const { centimes, sens } = paiementNet(paiements)
  if (centimes === 0) return { parts: [], reste: 1 }
  // Ce que chaque paiement règle, dans le sens de la somme : sa valeur absolue quand tous vont dans ce sens. Le total
  // s'additionne en euros, dans l'ordre des paiements, comme avant : des paiements de même sens rendent ainsi les mêmes
  // parts AU BIT PRÈS, et une écriture déjà générée ne se découvre pas « à régénérer » pour un arrondi.
  const regle = (m: Pick<LigneBancaire, 'montant'>) => m.montant * sens
  const paye = paiements.reduce((s, m) => s + regle(m), 0)
  const montantPiece = Math.abs(piece.montant_ttc ?? 0)
  // Au centime, comme l'écart que mesure `ecartAvecBanque` : sans cet arrondi, 100,10 − 98,10 vaut
  // 2,0000000000000004 et un écart pile au seuil passerait pour un paiement partiel.
  // SOUS LE SEUIL, LA PIÈCE EST RÉGLÉE parce que la banque l'aligne sur le total de ses paiements, la caisse comprise
  // (lib/reglementBanque.ts) : son écriture s'équilibre alors au centime. Un paiement en espèces ne laisse jamais de reste
  // dans cette zone — il s'y refuse, avant le clic et en base (`resteAuCentime`, la relecture du 01/11/2026) — ; un montant
  // de pièce changé après lui l'y ramènerait, et la Vue d'ensemble le dit (`caisse-paiements-a-retirer`).
  const reste = Math.round((montantPiece - paye) * 100) / 100
  if (reste <= seuilAlignement(montantPiece)) {
    return { parts: paiements.map((m) => ({ date: m.date, part: regle(m) / paye })), reste: 0 }
  }
  return {
    parts: paiements.map((m) => ({ date: m.date, part: regle(m) / montantPiece })),
    reste: reste / montantPiece,
  }
}

// `facture` : la date de la facture en ENGAGEMENT, où elle fait foi par définition — ce n'est pas la
// supposition de `sans_paiement`, qu'un rapprochement viendrait corriger.
export type SourceRattachement = 'paiement' | 'note_de_frais' | 'sans_paiement' | 'facture'

export interface Rattachement {
  /** Null pour une part que rien ne date : ni paiement connu, ni date de pièce. */
  date: string | null
  part: number
  source: SourceRattachement
}

const ORDRE_SOURCE: Record<SourceRattachement, number> = { paiement: 0, note_de_frais: 1, sans_paiement: 2, facture: 3 }

// Où une pièce compte, et pour quelle part. Les parts somment à 1 ; celles d'une même date et d'une
// même source sont réunies (deux paiements le même jour ne font qu'une date), et l'ordre est fixe —
// par date, la part sans date en dernier — pour que deux appels sur la même pièce rendent la même
// chose, ce dont dépend la répartition des centimes d'une écriture.
export function rattachementsTresorerie(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece'>,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
): Rattachement[] {
  const { parts, reste } = partsDesPaiements(piece, paiements)
  const fractions: Rattachement[] = parts.map((p) => ({ date: p.date, part: p.part, source: 'paiement' }))
  if (reste > 0) {
    fractions.push({
      date: piece.date_piece,
      part: reste,
      source: piece.type_piece === 'note_frais' ? 'note_de_frais' : 'sans_paiement',
    })
  }

  const reunies: Rattachement[] = []
  for (const f of fractions) {
    const meme = reunies.find((r) => r.date === f.date && r.source === f.source)
    if (meme) meme.part += f.part
    else reunies.push({ ...f })
  }
  return reunies.sort((a, b) => {
    if (a.date !== b.date) {
      if (a.date === null) return 1
      if (b.date === null) return -1
      return a.date.localeCompare(b.date)
    }
    return ORDRE_SOURCE[a.source] - ORDRE_SOURCE[b.source]
  })
}

// Où une pièce compte, selon le MODÈLE COMPTABLE du dossier. En trésorerie, la règle ci-dessus. En
// ENGAGEMENT (lib/engagement.ts), à la date de sa FACTURE et en entier : c'est la facture qui crée la
// charge ou le produit, le paiement ne fait que solder la dette — il ne date donc rien, pas même une
// partie. Une pièce sans date n'y compte nulle part, comme en trésorerie, et les écrans la disent
// « sans date ». Sans valeur par défaut pour le modèle : un appelant qui l'oublie doit le découvrir à la
// compilation, pas en lisant une situation intermédiaire datée au paiement dans une société à l'IS.
//
// `paiements` : ceux de CETTE pièce, tirés de `paiementsDesPieces` — le type refuse une ligne du relevé
// filtrée sur `piece_id`, qui ne porterait pas les parts d'un règlement groupé.
export function rattachements(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece'>,
  paiements: readonly PaiementDePiece[],
  mode: ModeComptable,
): Rattachement[] {
  if (mode === 'engagement') return [{ date: piece.date_piece, part: 1, source: 'facture' }]
  return rattachementsTresorerie(piece, paiements)
}

// La part d'une pièce qui tombe dans une période, bornes comprises, en dates `AAAA-MM-JJ`. Une part
// sans date n'appartient à aucune période.
export function partDansLaPeriode(rattachements: readonly Rattachement[], debut: string, fin: string): number {
  return rattachements.reduce((s, r) => (r.date !== null && r.date >= debut && r.date <= fin ? s + r.part : s), 0)
}

// La part d'une pièce qui tombe dans un exercice civil.
export function partDeLAnnee(rattachements: readonly Rattachement[], annee: number): number {
  return partDansLaPeriode(rattachements, `${annee}-01-01`, `${annee}-12-31`)
}

// Les exercices où une pièce compte au moins en partie — ce qui fait apparaître une année dans un
// sélecteur d'exercice.
export function anneesDesRattachements(rattachements: readonly Rattachement[]): number[] {
  return [...new Set(rattachements.flatMap((r) => (r.date ? [Number(r.date.slice(0, 4))] : [])))]
}

// UNE PIÈCE AU CENTIME, DATE PAR DATE, TELLE QUE SON ÉCRITURE LA PORTE. Les rattachements ci-dessus, réunis
// par date — la part que rien ne date reportée à la date du DÉPÔT, le repli de l'écriture —, puis le
// montant réparti au centime selon leurs parts, le dernier morceau prenant l'arrondi pour que la somme
// reste celle de la pièce, signe compris.
//
// UN SEUL CALCUL POUR L'ÉCRITURE ET POUR LA 2035 (lib/ecritures.ts, lib/declaration2035.ts). La 2035
// additionnait `montant × part` sans arrondir, l'écriture des centimes répartis : sur une pièce payée sur
// deux exercices, les deux pouvaient différer d'un centime dans chacun, et la concordance de la 2035 avec
// les écritures (lib/concordance2035.ts) aurait signalé un écart que personne ne peut corriger.
//
// `centimesSansDate` : ce que l'écriture porte à la date du dépôt faute de mieux — ni paiement ni date de
// pièce. La 2035 ne le compte dans aucun exercice (`exclusions.sansDate`). Une part datée qui tombe le jour
// même du dépôt partage sa fraction avec lui ; la part sans date en est alors tirée au prorata.
export interface MontantDate {
  date: string
  centimes: number
  centimesSansDate: number
}

export function centimesParDate(
  piece: Pick<Piece, 'date_piece' | 'montant_ttc' | 'type_piece' | 'created_at'>,
  montant: number,
  paiements: readonly Pick<LigneBancaire, 'date' | 'montant'>[],
): MontantDate[] {
  const reunies: { date: string; part: number; partSansDate: number }[] = []
  for (const r of rattachementsTresorerie(piece, paiements)) {
    const date = r.date ?? dateLocaleDe(piece.created_at)
    const partSansDate = r.date === null ? r.part : 0
    const meme = reunies.find((x) => x.date === date)
    if (meme) {
      meme.part += r.part
      meme.partSansDate += partSansDate
    } else reunies.push({ date, part: r.part, partSansDate })
  }
  const total = Math.round(montant * 100)
  const morceaux = reunies.map((f) => Math.round(total * f.part))
  morceaux[morceaux.length - 1] = total - morceaux.slice(0, -1).reduce((s, m) => s + m, 0)
  // Une date dont la part nette est NULLE — un paiement et son rejet le même jour, ou le rejet d'un paiement partiel qui
  // tombe le jour du dépôt d'une pièce sans date — ne se divise pas : sa part sans date se prend alors sur le total de la
  // pièce, et la 2035, qui ôte ce que rien ne date, y compte le paiement seul.
  return reunies.map((f, i) => ({
    date: f.date,
    centimes: morceaux[i],
    centimesSansDate: f.partSansDate === 0 ? 0
      : f.partSansDate === f.part ? morceaux[i]
      : Math.abs(f.part) < 1e-12 ? Math.round(total * f.partSansDate)
      : Math.round(morceaux[i] * (f.partSansDate / f.part)),
  }))
}
