import { COMPTE_BANQUE, libelleCompteTenu } from './comptes'
import { COMPTES_DE_TIERS, compteDeTiers, lignesEngagementPourPiece, type ModeleComptable } from './engagement'
import { dateLocaleDe } from './format'
import { compteTvaDe, montantRetenu, tvaVentilee } from './montantRetenu'
import { rattachementsTresorerie, type PaiementDePiece, type PaiementsDesPieces } from './rattachement'
import type { AcquisitionDuBien } from './amortissements'
import type { ANouveau, Categorie, CompteNotesDeFrais, EcritureBrouillon, Piece } from './types'

// Suggestions de compte PCG / poste 2035 par catégorie de dépense — un point de départ à
// valider ou ajuster par le cabinet (voir "Comptes manquants" dans Écritures, "Postes manquants"
// dans Clôture), jamais enregistré tout seul : ça ne fait que pré-remplir le champ avant le clic
// explicite sur "Enregistrer". Indexé sur le "code" stable de la catégorie (pas le libellé,
// modifiable) — ne joue donc que pour les catégories globales par défaut (dossier_id null) ; une
// catégorie propre à un dossier reste à renseigner à la main, faute de correspondance connue.
export const SUGGESTIONS_COMPTE_PAR_CODE: Record<string, { compte: string; poste2035: string }> = {
  achats_fournisseurs: { compte: '606100', poste2035: 'Achats' },
  loyer: { compte: '613200', poste2035: 'Loyers et charges locatives' },
  assurance: { compte: '616100', poste2035: "Primes d'assurance" },
  carburant_deplacements: { compte: '625100', poste2035: 'Frais de déplacement' },
  notes_frais: { compte: '625700', poste2035: 'Frais de réception, de représentation' },
  honoraires: { compte: '622600', poste2035: 'Honoraires ne constituant pas des rétrocessions' },
  frais_bancaires: { compte: '627000', poste2035: 'Frais financiers' },
  ventes_prestations: { compte: '706000', poste2035: 'Recettes' },
}

// Une ligne d'écriture brouillon avant insertion (pas encore d'id) — le shape exact attendu par
// `ecritures_brouillon`, hors ligne_bancaire_id (uniquement pertinent pour la contrepartie banque).
export interface LigneAGenerer {
  dossier_id: string
  piece_id: string
  date: string
  libelle: string
  sens: 'debit' | 'credit'
  statut: 'proposee'
  compte: string
  montant: number
  // Le mouvement bancaire d'une ligne de BANQUE — la contrepartie d'un paiement en trésorerie, les deux
  // lignes d'un règlement en engagement (voir lib/engagement.ts) ; absent des lignes d'une facture et de
  // la charge. C'est lui qui range un règlement au journal de banque dans le FEC, et qui retire la ligne
  // quand le rapprochement est annulé.
  ligne_bancaire_id?: string
}

// OÙ UNE PIÈCE S'ÉCRIT : le compte de sa catégorie, ou — pour la facture d'un bien IMMOBILISÉ — le compte
// d'immobilisation de sa nature (lib/amortissements.ts, `acquisitionsDesBiens`). C'est l'écriture d'ACQUISITION
// (ligne 26.6, étape b) : sans elle, le FEC amortissait un bien qu'il n'avait jamais vu entrer, et le
// paiement de sa facture manquait à la banque. L'immobilisation décide aussi du compte de TVA (445620 au
// lieu de 445660) et, en engagement, du compte de tiers (404000 au lieu de 401000).
export interface CibleComptable {
  compte: string
  immobilisation: boolean
}

// Ligne(s) charge/produit (+ TVA séparée le cas échéant) pour une pièce donnée — extrait de
// EcrituresTab pour être appelé aussi bien en génération initiale (une pièce sans encore d'écriture)
// qu'en régénération (une pièce déjà passée en écritures, mais modifiée depuis — voir
// piecesDesynchronisees dans EcrituresTab). Ne couvre jamais la contrepartie banque, gérée séparément
// par synchroniserContrepartieBanque (voir lib/contrepartieBanque.ts).
//
// La TVA ne se ventile que pour un dossier ASSUJETTI. Un dossier exonéré ne la récupère pas : sa
// charge est le TTC, sur une seule ligne, et rien ne passe en 445660 — une TVA déductible qu'il ne
// déduira jamais serait un actif qui n'existe pas, et une charge amputée d'autant dans le FEC et la
// balance (voir lib/montantRetenu.ts). Sans valeur par défaut : un appelant qui l'oublie doit le
// découvrir à la compilation.
//
// L'ÉCRITURE EST DATÉE COMME LA 2035 COMPTE LA PIÈCE : au PAIEMENT quand le rapprochement le connaît,
// à la date de facture sinon (lib/rattachement.ts). Elle portait la date de facture en toutes
// circonstances, pendant que sa contrepartie banque portait celle du paiement : une facture de
// décembre réglée en janvier avait sa charge dans le FEC et la balance d'un exercice et sa 2035 dans
// l'autre — et une écriture à cheval sur deux FEC, déséquilibrée dans chacun. `paiements` : les
// mouvements rapprochés de CETTE pièce ; sans valeur par défaut, une liste vide datant tout à la
// facture.
//
// Une pièce réglée en partie reçoit une ligne par date — la part payée au paiement, le reste à la
// facture —, ses montants répartis au centime près, le dernier morceau prenant l'arrondi pour que la
// somme reste celle de la pièce. Une part que rien ne date (ni paiement, ni date de pièce) prend la
// date du DÉPÔT, le repli d'avant.
export function lignesChargeProduitPourPiece(
  dossierId: string, piece: Piece, cible: CibleComptable, assujettiTva: boolean,
  paiements: readonly Pick<PaiementDePiece, 'date' | 'montant'>[],
): LigneAGenerer[] {
  const sensPiece: 'debit' | 'credit' = piece.type_piece === 'vente' ? 'credit' : 'debit'
  const libelle = piece.tiers ?? piece.nom_fichier

  // Un montant de pièce négatif (avoir, remboursement — ça arrive, une pièce validée existante en a
  // un) inverse le sens réel de l'écriture : une "charge" négative est en réalité un crédit, jamais un
  // débit avec un montant négatif. `montant` reste toujours une grandeur positive, sinon le contrôle
  // débit = crédit (voir analyserEcritures) se fausse silencieusement — un solde qui semble équilibré
  // à zéro montant près pourrait en réalité être doublé dans le mauvais sens.
  function ligne(date: string, compte: string, montant: number): LigneAGenerer {
    const sens = montant >= 0 ? sensPiece : (sensPiece === 'debit' ? 'credit' : 'debit')
    return { dossier_id: dossierId, piece_id: piece.id, date, libelle, statut: 'proposee', compte, sens, montant: Math.abs(montant) }
  }

  const fractions = datesDEcriture(piece, paiements)
  const tva = tvaVentilee(piece, assujettiTva)
  const charge = tva ? montantRetenu(piece, assujettiTva)! : piece.montant_ttc!
  const charges = repartir(charge, fractions.map((f) => f.part))
  const tvas = tva ? repartir(tva, fractions.map((f) => f.part)) : []

  return fractions.flatMap((f, i) => {
    const lignes = [ligne(f.date, cible.compte, charges[i])]
    // Rien à ventiler : la charge est ce qui a été payé, face au mouvement bancaire. Une part de TVA
    // arrondie à zéro sur un paiement partiel ne fait pas de ligne vide.
    if (tva && tvas[i] !== 0) lignes.push(ligne(f.date, compteTvaDe(piece, cible.immobilisation), tvas[i]))
    return lignes
  })
}

// La contrepartie BANQUE d'un paiement, en trésorerie : la banque au montant de CE paiement — le mouvement
// entier d'un rapprochement, la part d'un règlement groupé —, à sa date, et dans le sens de son SIGNE,
// jamais du type de la pièce. Un compte banque est un compte d'actif : une entrée l'augmente au débit, une
// sortie le diminue au crédit, quel que soit le type de la pièce en face — c'est ce qui écrit juste un
// remboursement, ou l'avoir déduit d'un virement groupé. Un paiement de zéro euro n'en écrit aucune.
//
// Écrite ici, et non plus seulement au rapprochement (contrepartieBanque.ts) : une pièce payée en
// plusieurs fois — un acompte puis un virement groupé — n'en recevait qu'UNE, celle du premier paiement,
// et son écriture restait déséquilibrée sans que rien ne sache la compléter.
export function ligneContrepartieBanque(
  dossierId: string, piece: Pick<Piece, 'id' | 'tiers' | 'nom_fichier'>,
  paiement: Pick<PaiementDePiece, 'id' | 'date' | 'montant'>,
): LigneAGenerer | null {
  if (!paiement.montant) return null
  return {
    dossier_id: dossierId, piece_id: piece.id, ligne_bancaire_id: paiement.id, date: paiement.date,
    libelle: piece.tiers ?? piece.nom_fichier, statut: 'proposee', compte: COMPTE_BANQUE,
    montant: Math.abs(paiement.montant), sens: paiement.montant > 0 ? 'debit' : 'credit',
  }
}

// Ce qu'une pièce produit au brouillon selon le MODÈLE COMPTABLE du dossier — le seul point d'entrée de
// la génération et de la régénération (EcrituresTab). En trésorerie, la charge ou le produit datés comme
// la 2035 compte la pièce, et une contrepartie banque par paiement ; en engagement, l'écriture de la
// facture à sa date et un règlement par paiement (lib/engagement.ts). Dans les deux modèles, les lignes
// de banque se déduisent des paiements : les reprendre ne perd rien.
//
// `paiements` : ceux de CETTE pièce, tirés de `paiementsDesPieces` — le type refuse une ligne du relevé
// filtrée sur `piece_id`, qui oublierait les parts des virements groupés.
export function lignesPourPiece(
  dossierId: string, piece: Piece, cible: CibleComptable, assujettiTva: boolean,
  paiements: readonly PaiementDePiece[], modele: ModeleComptable,
): LigneAGenerer[] {
  if (modele.mode === 'engagement') {
    return lignesEngagementPourPiece(dossierId, piece, cible, assujettiTva, modele.compteNotesDeFrais, paiements)
  }
  return [
    ...lignesChargeProduitPourPiece(dossierId, piece, cible, assujettiTva, paiements),
    ...paiements.flatMap((p) => ligneContrepartieBanque(dossierId, piece, p) ?? []),
  ]
}

// Les dates d'écriture d'une pièce et la part de chacune : les rattachements de lib/rattachement.ts,
// la part sans date reportée à la date de DÉPÔT, et deux parts à la même date réunies en une.
function datesDEcriture(piece: Piece, paiements: readonly Pick<PaiementDePiece, 'date' | 'montant'>[]): { date: string; part: number }[] {
  const reunies: { date: string; part: number }[] = []
  for (const r of rattachementsTresorerie(piece, paiements)) {
    const date = r.date ?? dateLocaleDe(piece.created_at)
    const meme = reunies.find((x) => x.date === date)
    if (meme) meme.part += r.part
    else reunies.push({ date, part: r.part })
  }
  return reunies
}

// Répartit un montant en centimes selon des parts : chaque morceau arrondi au centime, le dernier
// prenant le reste — la somme des morceaux est exactement le montant, signe compris.
function repartir(montant: number, parts: number[]): number[] {
  const total = Math.round(montant * 100)
  const morceaux = parts.map((part) => Math.round(total * part))
  morceaux[morceaux.length - 1] = total - morceaux.slice(0, -1).reduce((s, m) => s + m, 0)
  return morceaux.map((m) => m / 100)
}

// Les dates que les lignes d'une pièce DOIVENT porter, ou null quand l'une d'elles serait le repli sur
// la date de dépôt — un INSTANT lu dans le fuseau de qui génère, donc rien qu'on puisse opposer à une
// écriture générée ailleurs (voir analyserEcritures).
function datesAttendues(piece: Piece, paiements: readonly PaiementDePiece[]): Set<string> | null {
  const rattachements = rattachementsTresorerie(piece, paiements)
  if (rattachements.some((r) => r.date === null)) return null
  return new Set(rattachements.map((r) => r.date!))
}

// Solde d'un compte sur un ensemble d'écritures, dans le sens comptable normal de ce compte (débiteur
// pour une charge ou la TVA déductible, créditeur pour un produit ou la TVA collectée). Jamais une
// simple somme des montants (qui ignorerait le sens) : dès qu'une ligne au sens inverse apparaît — un
// avoir, un remboursement, voir lignesChargeProduitPourPiece — une somme aveugle additionnerait cette
// ligne au lieu de la soustraire, faussant silencieusement le total.
export function soldeCompte(ecritures: EcritureBrouillon[], compte: string, sensNormal: 'debit' | 'credit'): number {
  const lignes = ecritures.filter((e) => e.compte === compte)
  const debit = lignes.filter((e) => e.sens === 'debit').reduce((sum, e) => sum + e.montant, 0)
  const credit = lignes.filter((e) => e.sens === 'credit').reduce((sum, e) => sum + e.montant, 0)
  return sensNormal === 'debit' ? debit - credit : credit - debit
}

// Tolérance de 2 centimes pour l'arrondi flottant — un écart réel (frais bancaires, paiement
// partiel, pièce modifiée après génération...) est en général bien plus grand, donc quasiment jamais
// absorbé par cette marge.
const EPSILON_EQUILIBRE = 0.02

export interface GroupeDesequilibre {
  pieceId: string
  solde: number
}

export interface AnalyseEcritures {
  // Écriture encore à moitié générée (charge/produit sans sa contrepartie banque) — pas forcément un
  // défaut, la pièce n'est peut-être pas encore rapprochée dans Banque.
  nbSansContrepartie: number
  // Écriture complète (contrepartie présente) dont le total débit ne correspond pas au total crédit.
  groupesDesequilibres: GroupeDesequilibre[]
  // Pièce modifiée depuis que son écriture a été générée — montant TTC, VENTILATION DE LA TVA,
  // CATÉGORIE ou DATE. Les trois derniers ne déplacent AUCUN total, donc rien d'autre ne peut les
  // voir : la catégorie change le compte qui part en FEC, la date change l'EXERCICE, et la TVA
  // change la répartition entre charge et TVA déductible à somme constante.
  piecesDesynchronisees: Piece[]
}

// Il y avait ici `tvaNettePourPeriode`, la TVA nette du brouillon sur une période, que les écrans
// comparaient à la TVA déclarée. Retirée le 28/09/2026 : le brouillon date la TVA à la PIÈCE et ne
// porte aucune écriture pour un bien immobilisé, donc il ne peut pas dire ce qu'une CA3 déposée sur
// les encaissements devait contenir. Une déclaration se compare désormais au calcul de SA période,
// avec la règle d'exigibilité du dossier (lib/declarationTva.ts).

// Ce qu'une pièce validée DOIT produire au brouillon, et sur quel compte. La règle vivait en
// DOUBLE, écrite à l'identique dans EcrituresTab et ChecklistTab — une règle recopiée deux fois
// n'attend pas de diverger, elle attend un troisième appelant. Elle porte les trois portes de la
// chaîne comptable (catégorie, compte de la catégorie, montant) plus une quatrième que rien ne
// nommait : une pièce enregistrée en immobilisation est un ACTIF, pas une charge courante — elle
// s'amortit, elle ne se déduit pas d'un coup.
//
// ET DEPUIS LE 01/10/2026 ELLE S'ÉCRIT QUAND MÊME, sur son compte d'IMMOBILISATION : c'est l'écriture
// d'acquisition. Elle était écartée de tout, donc ni l'actif ni le paiement de sa facture n'entraient au
// brouillon — le FEC amortissait un bien qu'il n'avait jamais vu entrer, et la banque de l'application
// dépassait le relevé de tout ce que les biens avaient coûté. `acquisitions` : la pièce de chaque bien, et
// le compte de sa nature — ou rien, pour un bien sans nature, qui ne s'écrit pas tant qu'on ne l'a pas
// choisie, et pour un bien acquis avant l'ouverture d'un dossier repris, que les à-nouveaux portent déjà.
// Sans valeur par défaut : une liste vide écrirait chaque bien en charge, sur sa catégorie.
export interface PieceAComptabiliser extends CibleComptable {
  piece: Piece
}

export function piecesAComptabiliser(
  piecesValidees: Piece[],
  categories: Categorie[],
  acquisitions: ReadonlyMap<string, AcquisitionDuBien>,
): PieceAComptabiliser[] {
  return piecesValidees.flatMap((piece): PieceAComptabiliser[] => {
    if (piece.montant_ttc == null) return []
    const acquisition = acquisitions.get(piece.id)
    if (acquisition) return acquisition.compte ? [{ piece, compte: acquisition.compte, immobilisation: true }] : []
    const compte = categories.find((c) => c.id === piece.categorie_id)?.compte_comptable
    return compte ? [{ piece, compte, immobilisation: false }] : []
  })
}

// Pourquoi une pièce validée ne doit plus rien produire au brouillon. L'ordre compte : une pièce
// immobilisée se lit en premier, sa catégorie ne décidant plus de rien. Depuis que l'acquisition s'écrit,
// deux biens seulement ne produisent rien : le bien SANS NATURE, dont le compte n'est pas connu — donc
// « Régénérer » ne saurait pas où écrire, et une écriture déjà passée sur la catégorie compte une charge de
// trop — et le bien REPRIS, acquis avant l'ouverture : la balance reprise le porte, et toute écriture de sa
// facture le compte une seconde fois (ou compte en charge un bien qui s'amortit).
export type MotifSansObjet = 'bien_sans_nature' | 'bien_repris' | 'sans_categorie' | 'categorie_sans_compte' | 'sans_montant'

export interface EcritureSansObjet {
  piece: Piece
  motif: MotifSansObjet
  nbLignes: number
  // Débit − crédit des lignes hors banque : positif pour une charge, négatif pour un produit.
  // C'est exactement ce que le FEC, la balance et la 2035 comptent en trop.
  montant: number
}

function motifSansObjet(
  piece: Piece,
  categories: Categorie[],
  acquisitions: ReadonlyMap<string, AcquisitionDuBien>,
): MotifSansObjet | null {
  const acquisition = acquisitions.get(piece.id)
  if (acquisition) {
    if (acquisition.motif === 'repris') return 'bien_repris'
    if (acquisition.motif === 'sans_nature') return 'bien_sans_nature'
    return piece.montant_ttc == null ? 'sans_montant' : null
  }
  if (!piece.categorie_id) return 'sans_categorie'
  if (!categories.find((c) => c.id === piece.categorie_id)?.compte_comptable) return 'categorie_sans_compte'
  if (piece.montant_ttc == null) return 'sans_montant'
  return null
}

// QUATRIÈME CONTRÔLE, ET IL REGARDE LA PIÈCE DEPUIS L'ÉCRITURE. Les trois autres sont aveugles au
// même objet, en même temps, mais pas pour la même raison : les deux premiers ne jugent que la
// FORME du groupe (contrepartie présente, solde nul), or le groupe en question est parfaitement
// formé ; et le troisième juge bien la pièce, mais en partant de la liste éligible — dont celle-ci
// vient précisément de sortir. Rien ne supprime une écriture quand sa pièce est enregistrée en
// immobilisation — et c'est l'ordre naturel des gestes, puisqu'on découvre qu'un achat est un actif
// en ouvrant l'onglet Immobilisations, donc après avoir généré.
// CE QUE ÇA COÛTE EXACTEMENT, et la nuance vaut d'être écrite : la 2035 se calcule sur les PIÈCES et
// exclut déjà les immobilisées (voir declaration2035.ts) — elle est donc juste. Le FEC et la balance
// se calculent sur le BROUILLON et portent la charge entière. Les deux livrables décrivent alors
// deux résultats différents pour le même euro, et rien ne le dit : exactement l'incohérence que le
// cas `piece_id` nul a déjà coûtée une fois.
// C'est la même famille que `rupturesPisteAudit` (voir lib/pisteAudit.ts), appliquée à l'autre bout
// de la même relation.
export function ecrituresSansObjet(
  ecritures: EcritureBrouillon[],
  piecesValidees: Piece[],
  categories: Categorie[],
  acquisitions: ReadonlyMap<string, AcquisitionDuBien>,
): EcritureSansObjet[] {
  const parPiece = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    // `piece_id` nul est le domaine de rupturesPisteAudit, pas d'ici. Et un mouvement bancaire est
    // RÉEL : ni la contrepartie banque (trésorerie) ni l'écriture de règlement (engagement, les deux
    // lignes qui désignent leur mouvement) ne disparaissent parce que la pièce a changé de nature.
    if (!e.piece_id || e.compte === COMPTE_BANQUE || e.ligne_bancaire_id) continue
    // En engagement, la ligne de tiers de la facture (401, 411, compte de la note de frais) SOLDE la
    // charge dans son écriture : elle ne compte rien en trop, et la garder ferait rendre zéro à
    // `montant` — une facture immobilisée annoncée « 0,00 € compté au brouillon ». Aucune écriture de
    // pièce d'un dossier en trésorerie ne mouvemente ces comptes (celle d'un virement personnel, sans
    // pièce, est écartée plus haut).
    if (COMPTES_DE_TIERS.has(e.compte)) continue
    parPiece.set(e.piece_id, [...(parPiece.get(e.piece_id) ?? []), e])
  }
  const sansObjet: EcritureSansObjet[] = []
  for (const [pieceId, lignes] of parPiece) {
    const piece = piecesValidees.find((p) => p.id === pieceId)
    // Absente du jeu fourni : artefact de FILTRAGE, pas rupture — l'appelant ne charge que les
    // pièces validées, donc une pièce repassée « à valider » tomberait ici. La signaler ferait
    // crier au loup sur un choix de chargement, et un avertissement qui se trompe emporte dans son
    // discrédit les avertissements voisins qui, eux, disent vrai.
    if (!piece) continue
    const motif = motifSansObjet(piece, categories, acquisitions)
    if (!motif) continue
    sansObjet.push({
      piece,
      motif,
      nbLignes: lignes.length,
      montant: lignes.reduce((somme, e) => somme + (e.sens === 'debit' ? e.montant : -e.montant), 0),
    })
  }
  return sansObjet
}

// Trois contrôles d'intégrité sur le brouillon d'écritures, partagés entre EcrituresTab (où ils
// bloquent/alertent dans le détail) et ChecklistTab (vue d'ensemble du dossier) — un seul endroit où
// ces règles vivent. `aComptabiliser` : ce que chaque pièce validée doit produire, et sur quel
// compte (voir piecesAComptabiliser). Le quatrième, `ecrituresSansObjet`, est à part parce qu'il
// part de l'écriture et non de la pièce.
export function analyserEcritures(
  ecritures: EcritureBrouillon[], aComptabiliser: PieceAComptabiliser[], assujettiTva: boolean,
  // Les paiements de chaque pièce, parts de virements groupés comprises (`paiementsDesPieces`), qui
  // décident de la DATE qu'une écriture doit porter en trésorerie, et des lignes de BANQUE qu'une pièce
  // doit porter dans les deux modèles. Sans valeur par défaut : une liste vide ferait attendre la date de
  // facture partout, et signaler « à régénérer » toute écriture justement datée à son paiement.
  paiements: PaiementsDesPieces,
  // Le modèle comptable du dossier (lib/engagement.ts), qui décide de ce qu'une écriture DOIT
  // contenir. Sans valeur par défaut non plus : lu en trésorerie, le brouillon d'un dossier en
  // engagement ferait signaler « à régénérer » chacune de ses écritures justes.
  modele: ModeleComptable,
): AnalyseEcritures {
  const piecesParGroupe = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (!e.piece_id) continue
    piecesParGroupe.set(e.piece_id, [...(piecesParGroupe.get(e.piece_id) ?? []), e])
  }
  // Une pièce dont aucune ligne ne touche la banque ET qu'aucun paiement ne règle : en trésorerie, la
  // charge sans sa contrepartie ; en engagement, la facture sans règlement. Un paiement que le
  // rapprochement ne connaît pas encore. Une pièce PAYÉE sans ligne de banque n'est pas « en attente de
  // rapprochement » — elle l'est déjà : son écriture est à régénérer, et c'est `piecesDesynchronisees`
  // qui la dit.
  const nbSansContrepartie = [...piecesParGroupe.entries()]
    .filter(([pieceId, rows]) => !rows.some((r) => r.compte === COMPTE_BANQUE) && !paiements.has(pieceId)).length

  const groupesDesequilibres = modele.mode === 'engagement'
    ? desequilibresEngagement(piecesParGroupe)
    : [...piecesParGroupe.entries()]
      .filter(([, rows]) => rows.some((r) => r.compte === COMPTE_BANQUE))
      .map(([pieceId, rows]) => ({
        pieceId,
        solde: rows.reduce((sum, r) => sum + (r.sens === 'debit' ? r.montant : -r.montant), 0),
      }))
      .filter((g) => Math.abs(g.solde) > EPSILON_EQUILIBRE)

  const piecesDesynchronisees = aComptabiliser.filter(({ piece, ...cible }) => {
    const groupe = piecesParGroupe.get(piece.id) ?? []
    const paiementsPiece = paiements.get(piece.id) ?? []
    return modele.mode === 'engagement'
      ? engagementDesynchronise(piece, cible, groupe, assujettiTva, paiementsPiece, modele.compteNotesDeFrais)
      : tresorerieDesynchronisee(piece, cible, groupe, assujettiTva, paiementsPiece)
  }).map(({ piece }) => piece)

  return { nbSansContrepartie, groupesDesequilibres, piecesDesynchronisees }
}

// Les lignes de BANQUE d'une pièce suivent-elles exactement ses paiements ? Une contrepartie par paiement
// non nul — ni une de moins, ni une de plus —, désignée par son mouvement, à sa date et à son montant
// signé (un débit est une entrée). C'est la même question dans les deux modèles : la contrepartie d'un
// paiement en trésorerie, la ligne de banque d'un règlement en engagement.
//
// LE MONTANT AUTANT QUE LE MOUVEMENT, et c'est la part d'un virement groupé qui l'impose : la régler de
// nouveau avec d'autres montants laisse le même mouvement en face de la même pièce, et une comparaison des
// seuls identifiants déclarerait juste une banque restée sur l'ancienne part. Une ligne de banque qui ne
// désigne plus aucun mouvement (le mouvement supprimé, la clé mise à nul) n'est la contrepartie de rien.
function banqueSuitLesPaiements(lignesBanque: readonly EcritureBrouillon[], paiements: readonly PaiementDePiece[]): boolean {
  const attendus = new Map(paiements.filter((m) => m.montant !== 0).map((m) => [m.id, m]))
  const presents = new Map<string, { montant: number; dates: Set<string> }>()
  for (const e of lignesBanque) {
    if (!e.ligne_bancaire_id) return false
    const present = presents.get(e.ligne_bancaire_id) ?? { montant: 0, dates: new Set<string>() }
    present.montant += e.sens === 'debit' ? e.montant : -e.montant
    present.dates.add(e.date)
    presents.set(e.ligne_bancaire_id, present)
  }
  if (attendus.size !== presents.size) return false
  for (const [id, paiement] of attendus) {
    const present = presents.get(id)
    if (!present || Math.abs(present.montant - paiement.montant) > EPSILON_EQUILIBRE) return false
    if (present.dates.size !== 1 || !present.dates.has(paiement.date)) return false
  }
  return true
}

// En TRÉSORERIE, ce qui rend l'écriture d'une pièce périmée : son compte, sa TVA, ses dates ou son
// total ne sont plus ceux que la pièce produirait aujourd'hui, ou ses contreparties banque ne sont plus
// ses paiements.
function tresorerieDesynchronisee(
  p: Piece, cible: CibleComptable, groupe: readonly EcritureBrouillon[], assujettiTva: boolean,
  paiementsPiece: readonly PaiementDePiece[],
): boolean {
  const lignes = groupe.filter((e) => e.compte !== COMPTE_BANQUE)
  // Pas encore générée — pas une désynchronisation. Des contreparties SANS leur charge, en revanche, en
  // sont une : la génération ne les produit jamais ainsi, et « Régénérer » reconstruit les deux.
  if (lignes.length === 0) return groupe.length > 0
  // Signé par rapport au sens naturel de la pièce (achat = débit, vente = crédit) : une simple somme
  // des montants (toujours positifs) donnerait un faux "désynchronisée" sur une pièce à montant
  // négatif (avoir, remboursement), dont les lignes sont correctement enregistrées au sens inverse
  // par lignesChargeProduitPourPiece — pas en écart, juste du signe attendu pour ce cas-là.
  const sensPiece: 'debit' | 'credit' = p.type_piece === 'vente' ? 'credit' : 'debit'
  // LE COMPTE AUTANT QUE LE MONTANT. Recatégoriser une pièce déjà validée est un geste courant,
  // et rien ne réécrit l'écriture : elle reste sur l'ANCIEN compte. Or le total, lui, ne bouge pas
  // d'un centime — un contrôle qui ne regarde que le montant déclare donc « synchronisée » une
  // écriture qui partira en FEC sur un compte que la pièce ne désigne plus, pendant que Clôture et
  // la 2035 lisent le poste 2035 de la catégorie ACTUELLE. Deux livrables, deux réponses, aucun
  // signal — c'est mot pour mot l'incohérence que rupturesPisteAudit a déjà coûté une fois.
  //
  // Et le compte de TVA est celui que la génération écrit (`compteTvaDe`) : la facture d'un bien passe en
  // 445620, celle d'une charge en 445660 — une pièce immobilisée après coup change de compte de TVA autant
  // que de compte de charge.
  const compteTva = compteTvaDe(p, cible.immobilisation)
  const surUnAutreCompte = lignes.some((e) => e.compte !== cible.compte && e.compte !== compteTva)
  if (surUnAutreCompte) return true
  // ET LA VENTILATION DE LA TVA, QUE LE TOTAL NE PEUT PAS VOIR — le panneau annonçait pourtant
  // « montant, TVA » depuis toujours. Corriger `montant_tva` en gardant le TTC laisse le total du
  // groupe RIGOUREUSEMENT INCHANGÉ (les deux lignes se compensent) et les comptes identiques : ni
  // la comparaison de montant ni celle de compte ne peut en dire un mot. Même silence quand la TVA
  // est ajoutée ou effacée après coup, le nombre de lignes changeant sans que leur somme bouge.
  // Ce que ça coûte : la charge et la TVA déductible partent FAUSSES en FEC et en balance, à somme
  // juste — pendant que la 2035, calculée sur les pièces, dit autre chose. Encore deux livrables
  // pour un seul euro.
  // On compare la TVA ENREGISTRÉE à celle que la pièce annonce (0 quand elle n'en porte pas, ce
  // qui couvre d'un coup l'ajout et l'effacement) ; signée comme le total, sinon un avoir passerait
  // pour un écart. Démontré sur une pièce réelle du schéma : 57,00 € portés en charge entière alors
  // que la pièce annonce 50,91 + 6,09 de TVA, total juste, compte juste, contrôle muet.
  // La TVA ATTENDUE est celle que la génération ventile, donc zéro pour un dossier exonéré : sans
  // quoi une écriture juste, au TTC sur une seule ligne, serait signalée « à régénérer » à jamais,
  // et une écriture qui ventile encore sa TVA en 445660 ne le serait pas.
  const tvaEnregistree = lignes
    .filter((e) => e.compte === compteTva)
    .reduce((sum, e) => sum + (e.sens === sensPiece ? e.montant : -e.montant), 0)
  if (Math.abs(tvaEnregistree - tvaVentilee(p, assujettiTva)) > EPSILON_EQUILIBRE) return true
  // LA DATE AUTANT QUE LE COMPTE, ET ELLE COÛTE PLUS CHER QUE LUI. Une pièce validée sans date
  // reçoit une écriture datée de son DÉPÔT (le repli de lignesChargeProduitPourPiece) ; « Retrouver
  // les dates manquantes » écrit ensuite `date_piece` sans toucher à l'écriture — par conception,
  // c'est ce qui la rend sûre à lancer sur un dossier déjà relu à la main. Rien ne réconcilie les
  // deux, et corriger à la main la date d'une pièce déjà générée fait exactement pareil.
  // Le compte, lui, gardait au moins la bonne année. Ici non : sur les pièces réelles du projet, le
  // dépôt suit la date de la pièce de 549 jours en MÉDIANE (1 336 au maximum) et 68 pièces tombent
  // dans une autre année civile. L'écriture part donc dans le mauvais EXERCICE — le filtre
  // d'exercice et le FEC lisent `e.date`, pendant que Clôture et la 2035 lisent `date_piece`. Le
  // FEC embarque même la contradiction sur UNE SEULE LIGNE, sa colonne PieceDate venant de la
  // pièce et EcritureDate de l'écriture.
  // On ne compare QUE si la pièce porte une date : sans date elle ne prétend à aucun exercice, donc
  // il n'y a rien à contredire — et comparer au repli ferait crier au loup dès qu'une écriture a
  // été générée dans un autre fuseau que celui qui la relit, `dateLocaleDe` lisant un INSTANT.
  //
  // ET LA DATE ATTENDUE EST CELLE DU PAIEMENT QUAND LE RAPPROCHEMENT LA CONNAÎT (lib/rattachement.ts,
  // la règle de la 2035) : une écriture générée avant son rapprochement, restée à la date de
  // facture, compterait dans l'exercice de la facture pendant que la 2035 la compte dans celui du
  // paiement. Les dates présentes doivent être EXACTEMENT celles attendues — une par part de la
  // pièce, et aucune autre.
  const attendues = datesAttendues(p, paiementsPiece)
  if (attendues) {
    const presentes = new Set(lignes.map((e) => e.date))
    if (presentes.size !== attendues.size || [...attendues].some((d) => !presentes.has(d))) return true
  }
  const total = lignes.reduce((sum, e) => sum + (e.sens === sensPiece ? e.montant : -e.montant), 0)
  if (Math.abs(total - p.montant_ttc!) > EPSILON_EQUILIBRE) return true
  // ET UNE CONTREPARTIE BANQUE PAR PAIEMENT. Le rapprochement n'en écrivait qu'une par pièce — celle du
  // premier paiement —, donc une pièce payée en deux fois, ou réglée en partie par un virement groupé,
  // gardait une écriture déséquilibrée que rien ne savait compléter. « Régénérer » réécrit désormais la
  // banque avec la charge, depuis les paiements.
  return !banqueSuitLesPaiements(groupe.filter((e) => e.compte === COMPTE_BANQUE), paiementsPiece)
}

// En ENGAGEMENT (lib/engagement.ts), ce qu'une pièce doit porter au brouillon : l'écriture de sa
// FACTURE — sa charge ou son produit, sa TVA, et le compte de tiers qui porte le TTC, toutes à la date
// de facture — et un RÈGLEMENT par mouvement rapproché, sur ce même compte de tiers. Les questions de la
// trésorerie (compte, TVA, date, montant), plus deux qu'elle n'a pas : le compte de tiers suit le TYPE
// de la pièce — un achat devenu note de frais quitte le 401 —, et les règlements suivent les
// RAPPROCHEMENTS — un mouvement rapproché sans règlement laisserait au 401 une dette déjà payée, et un
// règlement que plus rien ne rapproche en solderait une qui court encore.
function engagementDesynchronise(
  p: Piece, cible: CibleComptable, groupe: readonly EcritureBrouillon[], assujettiTva: boolean,
  paiementsPiece: readonly PaiementDePiece[], compteNotesDeFrais: CompteNotesDeFrais,
): boolean {
  const facture = groupe.filter((e) => !e.ligne_bancaire_id && e.compte !== COMPTE_BANQUE)
  const reglements = groupe.filter((e) => e.ligne_bancaire_id)
  // Pas encore générée — pas une désynchronisation. Des règlements SANS leur facture, en revanche, en
  // sont une : la génération ne les produit jamais ainsi, et « Régénérer » reconstruit les deux.
  if (facture.length === 0) return reglements.length > 0
  const tiers = compteDeTiers(p, compteNotesDeFrais, cible.immobilisation)
  const sensPiece: 'debit' | 'credit' = p.type_piece === 'vente' ? 'credit' : 'debit'
  const sensTiers: 'debit' | 'credit' = sensPiece === 'debit' ? 'credit' : 'debit'
  const signe = (e: EcritureBrouillon, sens: 'debit' | 'credit') => (e.sens === sens ? e.montant : -e.montant)
  const compteTva = compteTvaDe(p, cible.immobilisation)
  const estTva = (e: EcritureBrouillon) => e.compte === compteTva

  if (facture.some((e) => e.compte !== cible.compte && e.compte !== tiers && !estTva(e))) return true
  const tvaEnregistree = facture.filter(estTva).reduce((sum, e) => sum + signe(e, sensPiece), 0)
  if (Math.abs(tvaEnregistree - tvaVentilee(p, assujettiTva)) > EPSILON_EQUILIBRE) return true
  // La date de la FACTURE, sur toutes ses lignes. Sans date de pièce, le repli sur la date de dépôt est
  // un instant lu dans le fuseau de qui génère : rien qu'on puisse opposer à une écriture (voir la même
  // règle en trésorerie).
  if (p.date_piece && facture.some((e) => e.date !== p.date_piece)) return true
  const totalPiece = facture.filter((e) => e.compte !== tiers).reduce((sum, e) => sum + signe(e, sensPiece), 0)
  if (Math.abs(totalPiece - p.montant_ttc!) > EPSILON_EQUILIBRE) return true
  const totalTiers = facture.filter((e) => e.compte === tiers).reduce((sum, e) => sum + signe(e, sensTiers), 0)
  if (Math.abs(totalTiers - p.montant_ttc!) > EPSILON_EQUILIBRE) return true

  // Exactement les paiements de la pièce — ni un de moins, ni un de plus —, sur son compte de tiers
  // ACTUEL, et chacun à son montant : un paiement de zéro euro n'écrit aucun règlement.
  const attendus = new Set(paiementsPiece.filter((m) => m.montant !== 0).map((m) => m.id))
  const presents = new Set(reglements.map((e) => e.ligne_bancaire_id!))
  if (attendus.size !== presents.size || [...attendus].some((id) => !presents.has(id))) return true
  if (reglements.some((e) => e.compte !== COMPTE_BANQUE && e.compte !== tiers)) return true
  return !banqueSuitLesPaiements(reglements.filter((e) => e.compte === COMPTE_BANQUE), paiementsPiece)
}

// En engagement, CHAQUE écriture s'équilibre seule — la facture comme chaque règlement
// (lib/engagement.ts) — et chacune partira sous son propre numéro dans le FEC, où une écriture
// déséquilibrée fait rejeter le fichier : on les juge donc une par une, et non le groupe de la pièce,
// dont la somme pourrait masquer deux écarts qui se compensent. Le solde rendu est celui de la
// première qui ne s'équilibre pas, la facture d'abord.
function desequilibresEngagement(groupes: ReadonlyMap<string, readonly EcritureBrouillon[]>): GroupeDesequilibre[] {
  const desequilibres: GroupeDesequilibre[] = []
  for (const [pieceId, lignes] of groupes) {
    const soldes = new Map<string, number>()
    for (const e of lignes) {
      const ecriture = e.ligne_bancaire_id ?? ''
      soldes.set(ecriture, (soldes.get(ecriture) ?? 0) + (e.sens === 'debit' ? e.montant : -e.montant))
    }
    const ordre = [...soldes.keys()].sort()
    const premier = ordre.find((cle) => Math.abs(soldes.get(cle)!) > EPSILON_EQUILIBRE)
    if (premier !== undefined) desequilibres.push({ pieceId, solde: soldes.get(premier)! })
  }
  return desequilibres
}

export interface LigneBalance {
  compte: string
  libelle: string
  nbEcritures: number
  totalDebit: number
  totalCredit: number
  // Positif = solde débiteur, négatif = solde créditeur — jamais réparti sur deux colonnes ici
  // (contrairement à soldeCompte, qui a besoin de connaître le sens normal du compte pour ça) : une
  // balance générale regroupe tous les comptes, charges et produits confondus, sans a priori sur leur
  // sens habituel.
  solde: number
}

// Balance des comptes (onglet Statistiques) — un compte par ligne, tous confondus (charge, produit,
// TVA, banque), avec son nombre d'écritures et ses totaux débit/crédit. Sert à repérer d'un coup d'œil
// un compte au solde anormal (une charge créditrice, par exemple) sans avoir à parcourir le journal
// ligne à ligne comme dans EcrituresTab. Le libellé est celui d'un compte que l'application tient
// elle-même (`libelleCompteTenu` : banque, TVA, tiers, dotations et amortissements), sinon celui de la
// catégorie associée à ce compte (compte_comptable), sinon celui de la balance reprise, sinon "—"
// (compte entré à la main sur une catégorie propre à un dossier, jamais recroisé ici avec son libellé).
//
// Les À-NOUVEAUX y entrent comme les écritures de l'exercice qu'ils ouvrent — l'appelant les filtre
// sur l'exercice affiché, comme il filtre le brouillon (voir lib/aNouveaux.ts). Une balance de
// l'exercice repris qui les omettrait donnerait à la banque le solde de ses seuls mouvements, et aux
// comptes que l'application ne mouvemente jamais (une immobilisation, un emprunt) aucune ligne du tout.
export function calculerBalance(
  ecritures: EcritureBrouillon[], categories: Categorie[], aNouveaux: readonly ANouveau[],
): LigneBalance[] {
  const libelleParCompte = new Map<string, string>()
  for (const c of categories) {
    if (c.compte_comptable) libelleParCompte.set(c.compte_comptable, c.libelle)
  }
  // Le nom qu'une balance reprise donne à un compte que l'application ne nomme pas : sans lui, un
  // emprunt ou une immobilisation s'afficheraient « — ».
  for (const a of aNouveaux) {
    if (a.libelle && !libelleParCompte.has(a.compte)) libelleParCompte.set(a.compte, a.libelle)
  }

  const lignesParCompte = new Map<string, { sens: EcritureBrouillon['sens']; montant: number }[]>()
  for (const e of [...ecritures, ...aNouveaux]) {
    lignesParCompte.set(e.compte, [...(lignesParCompte.get(e.compte) ?? []), e])
  }

  return [...lignesParCompte.entries()]
    .map(([compte, lignes]) => {
      const totalDebit = lignes.filter((l) => l.sens === 'debit').reduce((sum, l) => sum + l.montant, 0)
      const totalCredit = lignes.filter((l) => l.sens === 'credit').reduce((sum, l) => sum + l.montant, 0)
      return {
        compte,
        libelle: libelleCompteTenu(compte) ?? libelleParCompte.get(compte) ?? '—',
        nbEcritures: lignes.length,
        totalDebit,
        totalCredit,
        solde: totalDebit - totalCredit,
      }
    })
    .sort((a, b) => a.compte.localeCompare(b.compte))
}
