import { ajouterJours, aujourdHuiSql, cleFournisseur, dateLocaleDe } from './format'
import type { Categorie, Immobilisation, LigneBancaire, Piece } from './types'
import { ecartAvecBanque, type EcartBanque } from './alignementBanque'

// Contrôles transverses partagés entre plusieurs onglets — extraits pour n'avoir qu'un seul endroit
// où ces règles vivent, utilisés à la fois là où ils bloquent une action (Écritures, Clôture) et dans
// la vue d'ensemble de la Checklist (voir ChecklistTab).

// Catégories utilisées par au moins une pièce validée mais sans compte comptable associé — impossible
// de générer l'écriture correspondante tant que ce n'est pas renseigné (voir EcrituresTab).
export function categoriesSansCompte(categories: Categorie[], pieces: Piece[]): Categorie[] {
  return categories.filter((c) => !c.compte_comptable && pieces.some((p) => p.categorie_id === c.id))
}

// Même logique côté poste de la 2035 (voir ClotureTab) — une pièce dont la catégorie n'a pas de poste
// associé n'est comptée dans aucun total de clôture.
export function categoriesSansPoste(categories: Categorie[], pieces: Piece[]): Categorie[] {
  return categories.filter((c) => !c.poste_2035 && pieces.some((p) => p.categorie_id === c.id))
}

// Pièces VALIDÉES sans aucune catégorie. C'est le trou que les deux contrôles ci-dessus ne voient
// pas : ils partent d'une catégorie et cherchent ce qui lui manque, donc une pièce dont
// `categorie_id` est nul leur est invisible — il n'y a pas de catégorie à inspecter. Le résultat est
// pourtant exactement le même : aucune écriture générée (`lignesChargeProduitPourPiece` exige un
// compte, donc une catégorie) et aucune ligne dans les totaux de Clôture ni dans la 2035.
//
// C'est la première des « trois portes » (voir CLAUDE.md) et la seule qui n'était pas gardée. Elle
// est aussi la plus coûteuse, parce que la pièce a l'air traitée : le cabinet a écrit « validée »
// dessus, donc plus personne ne la regarde. Constaté en production sur deux dossiers — 11 pièces
// validées sans catégorie, le travail fait et invisible.
//
// Seulement les validées, délibérément. Une pièce « à valider » sans catégorie est la situation
// NORMALE — c'est la corbeille d'arrivée — et la signaler noierait le vrai signal : le même dossier
// en portait 30 d'un coup.
export function piecesValideesSansCategorie(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => p.statut === 'validee' && !p.categorie_id)
}

// UN POINT DE CHECKLIST DOIT VÉRIFIER QUE SA CIBLE PEUT MONTRER CE QU'IL COMPTE — et la pièce SANS
// DATE est le cas que la règle avait manqué.
//
// Les points de la Checklist comptent sur le dossier ENTIER. `PiecesTab`, lui, écarte toute pièce
// dont `date_piece` est nul dès qu'un exercice précis est choisi — et il l'est toujours, `calculer-
// AnneeParDefaut` ne rendant « toutes » que sur un dossier vide. Une pièce sans date n'est donc pas
// seulement non marquée : elle est ABSENTE, et d'aucun exercice, pas seulement de celui qu'on
// regarde. C'est PIRE que la date impossible (déjà traitée) : celle-là se trouve en changeant
// d'année, celle-ci ne se trouve sous AUCUNE année.
//
// Le commentaire de `date-impossible` affirmait d'ailleurs être « le seul point dont le bouton ne
// suffit PAS à trouver la pièce ». C'était vrai des pièces DATÉES, et seulement d'elles.
//
// Rendu vide quand aucune pièce comptée n'est sans date, pour que le détail n'apparaisse QUE quand
// il apprend quelque chose : une mise en garde affichée en permanence cesse d'être lue, et le
// dossier vivant n'a aujourd'hui aucune pièce sans date (mesuré le 21/09/2026 — la campagne
// « Retrouver les dates manquantes » les a toutes comblées). L'état revient au premier dépôt dont
// l'OCR ne sait pas lire la date, donc le détail se CALCULE au lieu d'être écrit en dur.
export function detailPiecesSansDate(pieces: Piece[]): string | undefined {
  const sansDate = pieces.filter((p) => !p.date_piece).length
  if (sansDate === 0) return undefined
  const toutes = sansDate === pieces.length
  const sujet = toutes
    ? (sansDate > 1 ? 'Toutes sont sans date' : 'Elle est sans date')
    : `${sansDate} d'entre elles ${sansDate > 1 ? 'sont' : 'est'} sans date`
  return `${sujet} : l'onglet Justificatifs les masque tant qu'un exercice précis est choisi. Utiliser « toutes les années » dans l'en-tête du dossier, ou le filtre « Sans date ».`
}

// Sur un dossier assujetti, une pièce validée sans TVA renseignée est plus probablement un oubli de
// saisie qu'une vraie absence de TVA — signalé pour vérification, jamais corrigé tout seul.
export function piecesSansTva(pieces: Piece[], assujettiTva: boolean): Piece[] {
  if (!assujettiTva) return []
  return pieces.filter((p) => p.montant_ttc != null && !p.montant_tva)
}

// Le taux normal français, plafond de tout taux légal (2,1 / 5,5 / 10 / 20).
const TAUX_TVA_MAXIMAL = 0.2
// Les montants sont arrondis au centime : sans cette marge, un arrondi légitime passerait pour une
// erreur. Elle ne masque rien — les écarts constatés se comptent en euros, pas en centimes.
const TOLERANCE_CENTIME = 0.01

export type MotifTvaImpossible = 'arithmetique' | 'taux' | 'signe'

export interface PieceTvaImpossible {
  piece: Piece
  motif: MotifTvaImpossible
}

// Dit CE QUI est démontré faux, pas « anomalie détectée » : le cabinet doit pouvoir trancher sans
// refaire le calcul de tête. Partagé entre les écrans plutôt que réécrit dans chacun.
export const LIBELLE_MOTIF_TVA: Record<MotifTvaImpossible, string> = {
  arithmetique: 'HT + TVA ne fait pas le TTC',
  taux: 'taux supérieur à 20 %, le maximum légal',
  signe: 'TVA de sens contraire au HT',
}

// Une TVA qui ne peut PAS être celle du document, démontrée par le calcul — pas devinée.
//
// `piecesSansTva` ci-dessus vérifie la PRÉSENCE de la TVA, jamais sa valeur. Une TVA absente se voit
// (la case est vide) ; une TVA fausse a l'air remplie, et c'est celle-là qui part en déclaration.
// Constaté en production sur les trois dossiers : « HT 20,00 / TVA 20,60 / TTC 24,00 » (la vraie est
// 4,00), « HT 21,08 / TVA 24,22 » (4,22 avec un chiffre collé devant), une TVA de 188,81 € sur une
// base de 0,00 €, une assurance — exonérée de TVA — lue avec 943,89 € de TVA. Toutes en confiance
// « haute » : l'extraction affirme, et se trompe.
//
// Les trois règles sont des IMPOSSIBILITÉS arithmétiques, pas des heuristiques de vraisemblance.
// C'est la condition pour qu'un contrôle mérite d'interrompre quelqu'un : aucune facture réelle ne
// peut les enfreindre, donc aucun faux positif à trier.
//
//  1. `arithmetique` — HT + TVA ≠ TTC. Identité vraie sur tout document, quels que soient les taux.
//  2. `taux` — |TVA| > 20 % de |HT|. Aucun taux français ne dépasse 20 %, et une facture à plusieurs
//     taux porte la MOYENNE PONDÉRÉE de taux tous ≤ 20 % : elle ne peut pas dépasser 20 % non plus.
//     Couvre au passage la TVA posée sur une base nulle. Quand le HT n'a pas été lu du tout, la même
//     borne s'écrit sur le TTC — TVA ≤ 20 % du HT équivaut à TVA ≤ un sixième du TTC — pour qu'une
//     pièce sans HT ne devienne pas un angle mort.
//  3. `signe` — TVA et HT de sens contraires. Un avoir porte les deux en négatif, jamais l'un contre
//     l'autre. Aucun cas en production : ajoutée parce qu'elle est démontrable, pas parce qu'elle a
//     mordu.
//
// Ce qui est délibérément LAISSÉ PASSER, et qui est le cœur de la règle : un taux implicite compris
// entre 0 et 20 % mais qui n'est aucun taux légal — 13,31 %, 11,96 %, 2,75 € constatés. Un ticket à
// plusieurs taux (restauration, pharmacie) en produit légitimement, et il y en a plus dans un vrai
// dossier que d'erreurs. Le signaler ferait crier au loup, et un contrôle qui crie au loup finit
// ignoré — y compris le jour où il a raison. Ces pièces-là restent invisibles à ce contrôle, et c'est
// assumé : il ne prétend pas trouver toutes les TVA fausses, seulement celles qu'il peut PROUVER.
//
// Toutes les comparaisons se font en valeur absolue. Sur un avoir (montants négatifs), comparer
// directement inverserait les inégalités et signalerait chaque avoir correct.
//
// Ne filtre pas sur le statut, contrairement à `piecesValideesSansCategorie` : une pièce « à valider »
// sans catégorie est la situation normale, une TVA impossible ne l'est à aucun stade. C'est même
// AVANT la validation qu'elle doit se voir — après, le chiffre est figé dans l'écriture.
//
// Une pièce n'apparaît qu'une fois, sous le premier motif rencontré : elle en cumule souvent
// plusieurs (une TVA lue « 239,52 » au lieu de « 79,84 » casse à la fois l'addition et le taux) et la
// lister trois fois ferait passer une erreur pour trois.
export function piecesTvaImpossible(pieces: Piece[]): PieceTvaImpossible[] {
  const anomalies: PieceTvaImpossible[] = []
  for (const piece of pieces) {
    const { montant_ht: ht, montant_tva: tva, montant_ttc: ttc } = piece
    if (tva == null || tva === 0) continue
    if (ht != null && ttc != null && Math.abs(ht + tva - ttc) > TOLERANCE_CENTIME) {
      anomalies.push({ piece, motif: 'arithmetique' })
      continue
    }
    if (ht != null && ht !== 0 && Math.sign(tva) !== Math.sign(ht)) {
      anomalies.push({ piece, motif: 'signe' })
      continue
    }
    const plafond = ht != null
      ? Math.abs(ht) * TAUX_TVA_MAXIMAL
      : ttc != null
        ? Math.abs(ttc) * TAUX_TVA_MAXIMAL / (1 + TAUX_TVA_MAXIMAL)
        : null
    if (plafond != null && Math.abs(tva) > plafond + TOLERANCE_CENTIME) {
      anomalies.push({ piece, motif: 'taux' })
    }
  }
  return anomalies
}

// Pièces libellées en devise étrangère dont la conversion en euros n'a pas pu se faire — BCE
// injoignable au moment du dépôt, ou devise qu'elle ne cote pas.
//
// Le pendant de `piecesTvaImpossible` pour la devise : là aussi, le danger n'est pas le montant
// absent mais le montant qui a l'air juste. Une facture de 24,00 USD enregistrée « 24,00 » sans
// mention de devise passe pour 24,00 € et fausse la charge de 15 % sans que rien ne dépasse.
// C'est pour éviter cela que le dépôt laisse les montants en euros NULS plutôt que d'y écrire des
// dollars (voir lib/tauxChange.ts) — et ce contrôle est ce qui rend cette absence visible.
export function piecesDeviseNonConvertie(pieces: Piece[]): Piece[] {
  return pieces.filter((p) => p.devise !== 'EUR' && p.taux_change == null)
}

/** Une pièce dont la date lue ne peut pas être vraie. */
export interface PieceDateImpossible {
  piece: Piece
  /** La date portée par la pièce. */
  date: string
  /** Le jour du dépôt : la borne qu'une date de pièce ne peut pas dépasser. */
  borne: string
}

// Une pièce datée APRÈS le jour où elle a été déposée. On ne photographie pas une facture qui
// n'existe pas encore : ce qui a été lu est autre chose — une date de validité, une échéance, une
// fin de droits, ou un chiffre mal reconnu.
//
// Pourquoi ce contrôle existe alors qu'`extract-piece` refuse déjà les dates futures (`toIsoDate`) :
// **ce garde-fou ne garde que la porte d'entrée**. Il ne couvre ni la saisie manuelle dans la fiche
// pièce, ni les corrections faites à la main, ni — surtout — ce qui est DÉJÀ en base, entré avant sa
// pose. Constaté en production : une pièce datée du 27/09/2028, déposée le 16/09/2026, sans tiers ni
// montant, confiance « basse ». Un contrôle posé à l'entrée ne dit jamais rien de ce qui est entré
// avant lui.
//
// Ce que ça coûte quand personne ne le voit : la pièce part dans un exercice qui n'existe pas encore.
// Elle disparaît de tous les totaux de l'année en cours — Clôture, 2035, Balance — sans qu'aucun
// écran ne la compte comme manquante. Elle n'est pas « en attente », elle est ailleurs.
//
// La borne est le jour du DÉPÔT, pas « aujourd'hui », et c'est plus strict : une pièce déposée en
// septembre et datée de décembre est tout aussi impossible, alors qu'« après aujourd'hui » cesserait
// de la voir en décembre. `created_at` est un instant, donc lu dans le fuseau de qui regarde
// (`dateLocaleDe`), avec un jour de marge — la même que `toIsoDate`, et pour la même raison : à
// l'ouest de Paris, le jour local du dépôt peut apparaître une journée plus tôt que celui où la
// pièce a réellement été reçue.
export function piecesADateImpossible(pieces: Piece[]): PieceDateImpossible[] {
  const impossibles: PieceDateImpossible[] = []
  for (const piece of pieces) {
    // Ce garde a l'air redondant — `null > '2026-09-17'` est déjà faux en JavaScript, donc une pièce
    // sans date ne serait pas signalée de toute façon. Il ne l'est pas : sans lui, `date` ci-dessous
    // vaut `string | null` et `tsc -b` refuse. Le retirer est la seule mutation de ce contrôle
    // qu'aucun test ne tue ; c'est le compilateur qui s'en charge, et il faut le savoir avant de
    // « simplifier ».
    if (!piece.date_piece) continue
    // Sans horodatage de dépôt, la seule borne défendable reste le jour même : une pièce ne peut pas
    // être datée de demain, quelle que soit la date à laquelle elle est arrivée.
    const borne = piece.created_at ? dateLocaleDe(piece.created_at) : aujourdHuiSql()
    if (piece.date_piece > ajouterJours(borne, 1)) {
      impossibles.push({ piece, date: piece.date_piece, borne })
    }
  }
  return impossibles
}

/** Un mois qui porte deux échéances d'un même abonnement, alors qu'un mois voisin n'en porte aucune. */
export interface MoisEnDoubleSurAbonnement {
  /** Le fournisseur, tel qu'il est écrit sur la première pièce du groupe — c'est ce que l'écran montre. */
  tiers: string
  /** Le montant qui se répète, en euros. */
  montant: number
  /** Le mois (AAAA-MM) qui en porte plusieurs. */
  mois: string
  /** Les pièces rangées dans ce mois-là. L'une d'elles est mal datée ; laquelle est un arbitrage. */
  pieces: Piece[]
  /** Le mois voisin resté vide, où l'une de ces pièces a presque sûrement sa place. */
  moisProbable: string
}

// Nombre de mois distincts en dessous duquel on ne parle pas d'abonnement. À deux mois, deux factures
// du même montant sont une coïncidence banale ; à trois, c'est une série, et un trou dans une série
// se voit.
const MOIS_MINIMUM_ABONNEMENT = 3

// Un abonnement mensuel facture une fois par mois. Deux échéances dans le même mois avec un mois
// voisin VIDE n'est donc pas « deux factures » : c'est une anomalie démontrée. Deux causes possibles,
// et ce contrôle ne sait PAS les distinguer — une date mal lue, ou une pièce déposée deux fois pendant
// que celle du mois vide manque. Sur le seul cas réel c'était la seconde (voir `doublonsDeTexte`), et
// l'hypothèse « date mal lue » avait d'abord été écrite comme la conclusion. Ce contrôle dit donc le
// mois vide, jamais la cause.
//
// CE QUE ÇA COÛTE, mesuré sur le dossier `test` le 19/09/2026. `mai.pdf` et `juin.pdf` (Transmedical,
// 38,40 €) portent tous deux la date du 01/06/2025 : juin en compte deux, mai zéro. Trois conséquences
// en cascade, et aucun écran ne les reliait :
//   - une échéance de plus part dans l'exercice de juin — sur un exercice à cheval, la mauvaise année ;
//   - le prélèvement bancaire réel du 05/05 ne trouve plus de pièce en face et reste non rapproché ;
//   - les DEUX pièces de juin se disputent le prélèvement du 05/06, donc `analyserAppariements` rend
//     « plusieurs pièces possibles » et refuse un appariement qui était certain. Le rapprochement
//     annonce un doute là où il y a une erreur de date : le symptôme, jamais la cause.
//
// POURQUOI LE MOIS VIDE EST EXIGÉ, et pas seulement le doublon. Un fournisseur peut légitimement
// facturer deux fois dans le mois. C'est le TROU voisin qui rend la lecture certaine — sans lui, le
// contrôle crierait au loup sur des séries parfaitement normales, et un avertissement qui se trompe
// souvent finit par ne plus être lu. Sur les 41 pièces réelles du dossier : une trouvaille, zéro
// fausse alerte.
//
// Le voisin doit tomber DANS la plage observée de la série : sinon le premier mois d'un abonnement
// signalerait toujours le mois d'avant, où il n'y avait simplement encore rien.
//
// **Il ne corrige jamais rien.** Il dit quel mois est vide ; choisir laquelle des deux pièces y
// appartient demande de regarder les documents, et c'est l'arbitrage du cabinet.
export function moisEnDoubleSurAbonnement(pieces: Piece[]): MoisEnDoubleSurAbonnement[] {
  const groupes = new Map<string, Piece[]>()
  for (const piece of pieces) {
    if (!piece.date_piece || piece.montant_ttc == null) continue
    // La clé d'identité et non le nom exact : l'OCR recopie du bruit autour du nom, et « Transmedical »
    // / « Transmedical / et redevient » sont le même abonnement (voir cleFournisseur). Sans clé
    // identifiable, la pièce est traitée isolément — regrouper sur le seul montant confondrait des
    // fournisseurs sans rapport.
    const cle = cleFournisseur(piece.tiers)
    if (!cle) continue
    const cleGroupe = `${cle}|${piece.montant_ttc}`
    const groupe = groupes.get(cleGroupe)
    if (groupe) groupe.push(piece)
    else groupes.set(cleGroupe, [piece])
  }

  const trouves: MoisEnDoubleSurAbonnement[] = []
  for (const groupe of groupes.values()) {
    // Index de mois absolu (année × 12 + mois) : toute l'arithmétique reste sur le calendrier civil,
    // sans jamais passer par un Date, donc insensible au fuseau de qui regarde.
    const parMois = new Map<number, Piece[]>()
    for (const piece of groupe) {
      const index = indexMois(piece.date_piece!)
      const mois = parMois.get(index)
      if (mois) mois.push(piece)
      else parMois.set(index, [piece])
    }
    if (parMois.size < MOIS_MINIMUM_ABONNEMENT) continue

    const indexes = [...parMois.keys()]
    const premier = Math.min(...indexes)
    const dernier = Math.max(...indexes)

    for (const [index, piecesDuMois] of parMois) {
      if (piecesDuMois.length < 2) continue
      // Le mois PRÉCÉDENT d'abord : quand une date est mal lue, ce qui a été pris pour elle est
      // presque toujours postérieur — une échéance, une fin de période, une date de règlement. Le
      // mois manquant est donc plus souvent celui d'avant.
      const vide = [index - 1, index + 1].find(
        (voisin) => voisin >= premier && voisin <= dernier && !parMois.has(voisin),
      )
      if (vide === undefined) continue
      trouves.push({
        tiers: piecesDuMois[0].tiers ?? '',
        montant: piecesDuMois[0].montant_ttc!,
        mois: moisDeIndex(index),
        pieces: piecesDuMois,
        moisProbable: moisDeIndex(vide),
      })
    }
  }

  return trouves.sort((a, b) => a.mois.localeCompare(b.mois) || a.tiers.localeCompare(b.tiers))
}

// UN MOUVEMENT BANCAIRE QUI SE DIT RAPPROCHÉ ET NE DÉSIGNE RIEN. Cinquième frappe de « un contrôle
// qui part d'un côté d'une relation ne voit pas ce qui manque de l'autre » (voir CLAUDE.md), et la
// première qui parte du MOUVEMENT : les quatre précédentes partaient de la pièce, de l'écriture ou
// de la catégorie. Le côté banque a pourtant ses deux clés à lui, et elles sont TOUTES DEUX en
// `ON DELETE SET NULL` — mesuré : les 5 clés étrangères entrantes de `pieces` et les 2 de
// `cotisations_declarees` sont en SET NULL ou CASCADE, aucune en NO ACTION. Supprimer une pièce ou
// une échéance de cotisation ne bloque donc JAMAIS : Postgres défait le lien sans un mot, et
// `statut` reste `'rapprochee'`.
//
// CE QUE ÇA COÛTE, et c'est la forme la plus chère de cette famille — le vide est une AFFIRMATION :
//   - la Checklist ne compte que les `non_rapprochee`, donc elle se TAIT sur ce mouvement, sur
//     l'écran dont le métier est de dire ce qui manque ;
//   - l'onglet Banque affiche une pastille VERTE « Rapproché » — et elle est indiscernable d'un vrai
//     rapprochement, une pièce sans tiers rendant exactement le même libellé nu ;
//   - la piste d'audit part de l'écriture et du justificatif, jamais du mouvement : une cotisation
//     ne produit aucune écriture, donc rien nulle part ne le mentionne.
// Le rapprochement était la seule chose qui rattachait cet euro à un justificatif ; une fois le lien
// nul, plus aucun écran ne peut le retrouver.
//
// SEUL LE LIEN NUL EST RETENU, jamais « désigne une pièce absente du jeu chargé » — c'est la règle
// déjà posée pour `rupturesPisteAudit` : ce signal-là ne dépend d'aucun jeu de données à côté, donc
// il ne peut pas crier au loup sur un artefact de filtrage.
//
// `prelevement_personnel` n'est PAS écarté du prédicat, délibérément : un virement personnel est
// classé `'ignoree'` (voir BanqueTab), donc il n'y entre pas de toute façon, et l'écarter laisserait
// croire qu'un virement personnel « rapproché » serait légitime. Il ne l'est pas davantage.
//
// LATENT, et mesuré le 23/09/2026 : 26 lignes rapprochées en base, 12 sur une pièce et 14 sur une
// cotisation, ZÉRO orpheline. Ce qui le rend digne d'être corrigé n'est pas un préjudice constaté
// mais qu'il ne PEUT pas se voir une fois arrivé — et que deux gestes de l'interface le produisent.
//
// Le prédicat est exporté À L'UNITÉ parce que l'onglet Banque en a besoin LIGNE PAR LIGNE, pour sa
// pastille : le réécrire là-bas serait une règle recopiée deux fois, qui n'attend pas de diverger.
export function mouvementRapprocheSansObjet(ligne: LigneBancaire): boolean {
  return ligne.statut === 'rapprochee' && !ligne.piece_id && !ligne.cotisation_id
}

// Ce que TOUTE suppression d'une pièce ou d'une échéance de cotisation fait au rapprochement qui
// la désignait, dit à l'opérateur AVANT qu'il confirme — la règle du projet est qu'une confirmation
// nomme ce qu'on perd. Ici, elle vit à côté du contrôle qui la rend vraie plutôt que recopiée dans
// les trois écrans qui l'affichent : la même phrase écrite trois fois n'attend pas de diverger.
export const AVERTISSEMENT_RAPPROCHEMENT_DEFAIT =
  'Si un mouvement bancaire est rapproché dessus, le lien est défait sans que le mouvement '
  + 'redevienne à traiter : il restera marqué rapproché sans justificatif, et signalé comme tel '
  + 'dans Banque et dans la Checklist.'

export function mouvementsRapprochesSansObjet(lignes: LigneBancaire[]): LigneBancaire[] {
  return lignes.filter(mouvementRapprocheSansObjet)
}

// UNE PIÈCE RAPPROCHÉE D'UN MOUVEMENT D'UN AUTRE MONTANT — le reste de la décision « la banque
// fait foi » (23/09/2026, choix du cabinet). Sous le seuil, `reglementBanque` ALIGNE la pièce et il
// n'y a plus d'écart à signaler ; au-dessus, on ne touche à rien et c'est ici que ça se dit.
//
// CE QUE ÇA COÛTE, ET POURQUOI ALIGNER SERAIT PIRE QUE SE TAIRE : un écart large est presque
// toujours un paiement PARTIEL ou un règlement GROUPÉ. Écraser la pièce enregistrerait alors une
// facture de 1 000 € comme une dépense de 500 €, sur une pièce déjà validée, et le montant d'origine
// serait perdu. On signale, on ne corrige pas — le parti pris de `doublonFraisVehicules` et de
// `dotationsNonProratisees`.
//
// ET L'ÉCART NE SE VOIT NULLE PART AILLEURS TANT QUE LES ÉCRITURES N'ONT PAS ÉTÉ GÉNÉRÉES :
// `synchroniserContrepartieBanque` écrit la contrepartie sur `Math.abs(ligne.montant)` et la charge
// sur le TTC de la pièce, donc le groupe cesse d'être équilibré et `groupesDesequilibres` finit par
// le dire. Mais elle sort AVANT d'écrire quoi que ce soit tant que la pièce n'a pas sa ligne de
// charge (catégorie sans compte, « Générer les écritures » pas encore lancé) — et le menu
// « Associer à… » de Banque est un SCORE, pas un filtre : rien n'empêche de relier une pièce de
// 1 000 € à un mouvement de 500 €.
//
// Seules les pièces FOURNIES sont examinées : une pièce hors du jeu chargé n'est pas une anomalie
// mais un artefact de filtrage, exactement la règle posée pour `rupturesPisteAudit`.
export interface EcartRapprochement {
  ligne: LigneBancaire
  piece: Piece
  ecart: EcartBanque
}

export function rapprochementsEcartImportant(lignes: LigneBancaire[], pieces: Piece[]): EcartRapprochement[] {
  const parId = new Map(pieces.map((p) => [p.id, p]))
  const resultats: EcartRapprochement[] = []
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.piece_id) continue
    const piece = parId.get(ligne.piece_id)
    if (!piece) continue
    const ecart = ecartAvecBanque(piece, ligne)
    if (!ecart || ecart.ecart === 0 || ecart.alignable) continue
    resultats.push({ ligne, piece, ecart })
  }
  return resultats
}

// UNE IMMOBILISATION DONT LE JUSTIFICATIF A ÉTÉ SUPPRIMÉ CONTINUE D'AMORTIR — la TROISIÈME clé en
// `ON DELETE SET NULL` de `pieces`, trouvée en appliquant à `mouvementsRapprochesSansObjet` la règle
// qu'il invoquait : chercher toutes les copies. Les trois sont `ecritures_brouillon.piece_id` (déjà
// gardée par `rupturesPisteAudit`), `lignes_bancaires.piece_id` (ci-dessus) et celle-ci.
//
// `piece_id` nul N'EST PAS UN ÉTAT LÉGITIME ICI, et c'est ce qui rend le contrôle sans ambiguïté :
// `ImmobilisationsTab` n'a qu'UN chemin de création, et il pose toujours `piece_id: piece.id` — une
// immobilisation naît d'une pièce validée, jamais d'une saisie libre. Un `piece_id` nul ne peut donc
// venir que de la suppression de cette pièce.
//
// CE QUE ÇA COÛTE : `calculerDeclaration2035` totalise `dotationPourAnnee` sur TOUTES les
// immobilisations sans regarder ce lien, donc la dotation part en case CH d'une 2035 **signée** alors
// que le justificatif n'existe plus — et son fichier non plus. La piste d'audit ne peut rien en dire :
// elle part de l'écriture et du justificatif, et une immobilisation n'y a aucune ligne. L'écran du
// registre, lui, affichait la dotation sans un mot sur le lien manquant.
//
// ANNÉE-LIBRE, délibérément : une immobilisation sans justificatif l'est quelle que soit l'année. La
// CONSÉQUENCE, elle, est datée (la dotation ne tombe que dans les années de la durée) — c'est donc à
// Clôture de cadrer sur son exercice, comme la Balance des comptes cadre ses propres chiffres.
//
// LATENT, et mesuré le 23/09/2026 : 2 immobilisations en base, toutes deux rattachées à leur pièce.
export function immobilisationSansJustificatif(immo: Immobilisation): boolean {
  return immo.piece_id == null
}

export function immobilisationsSansJustificatif(immobilisations: Immobilisation[]): Immobilisation[] {
  return immobilisations.filter(immobilisationSansJustificatif)
}

function indexMois(dateSql: string): number {
  return Number(dateSql.slice(0, 4)) * 12 + Number(dateSql.slice(5, 7)) - 1
}

function moisDeIndex(index: number): string {
  const annee = Math.floor(index / 12)
  const mois = (index % 12) + 1
  return `${annee}-${String(mois).padStart(2, '0')}`
}
