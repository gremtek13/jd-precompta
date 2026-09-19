import { parseMontantBancaire } from './csv'

// Lecture d'une BALANCE comptable venue d'un autre logiciel — la première pièce d'une reprise de
// dossier. Un cabinet qui bascule vers cette application arrive avec l'historique de son logiciel
// précédent, et c'est la balance qui le porte : un compte par ligne, avec son cumul débit et son
// cumul crédit.
//
// CE MODULE NE DEVINE PAS UNE MISE EN PAGE, il reconnaît une STRUCTURE. C'est la différence entre
// cette lecture et un pari : la colonne des comptes est celle dont les valeurs sont des numéros de
// compte du PCG (une classe de 1 à 8, au moins trois chiffres), ce qui est un invariant du plan
// comptable général et non une convention d'éditeur. Même démarche que `lignesDeSolde`, qui
// reconnaît une ligne de solde à sa largeur plutôt qu'à son libellé.
//
// TROIS RÈGLES DU PROJET S'APPLIQUENT ICI SANS DISCUSSION :
//   - **un montant n'est jamais analysé deux fois** : `parseMontantBancaire` est le seul analyseur,
//     jamais une expression régulière parallèle (voir csv.ts, et les 1,23 € pour « 1.234,56 ») ;
//   - **un livrable incomplet le dit** : une balance dont le débit ne boucle pas avec le crédit
//     n'est pas une balance, c'est un fichier amputé — et le cabinet doit l'apprendre AVANT d'y
//     adosser une comptabilité, exactement comme pour un relevé bancaire qui ne boucle pas ;
//   - **rien n'est jamais importé automatiquement** : ce module LIT et CONTRÔLE, il n'écrit rien.

/** Une ligne de balance telle qu'elle est lue, sans interprétation comptable. */
export interface LigneBalance {
  compte: string
  libelle: string
  debit: number
  credit: number
}

export interface ResultatLectureBalance {
  lignes: LigneBalance[]
  /** Index des colonnes retenues, pour que l'écran puisse montrer ce qui a été compris. */
  colonnes: { compte: number; libelle: number; debit: number; credit: number } | null
  /** Lignes écartées et pourquoi — jamais silencieusement : c'est ce qui permet de diagnostiquer. */
  ignorees: { ligne: string[]; motif: MotifIgnore }[]
}

export type MotifIgnore =
  // Pas de numéro de compte reconnaissable : en-tête, titre de section, ligne vide.
  | 'aucun numéro de compte'
  // Un numéro de compte, mais aucun des deux montants n'est lisible.
  | 'aucun montant lisible'

/** Un numéro de compte du PCG : classe 1 à 8, au moins trois chiffres, rien d'autre. */
const NUMERO_DE_COMPTE = /^[1-8]\d{2,}$/

function estNumeroDeCompte(valeur: string): boolean {
  return NUMERO_DE_COMPTE.test(valeur.trim())
}

// La colonne des comptes est celle qui porte le PLUS de numéros de compte — pas la première qui en
// porte un. Une colonne « numéro de pièce » peut contenir par hasard des valeurs qui en ont l'air ;
// elle n'en portera pas sur toutes les lignes.
function colonneDesComptes(lignes: string[][]): number {
  let meilleure = -1
  let meilleurCompte = 0
  const largeur = Math.max(0, ...lignes.map((l) => l.length))
  for (let c = 0; c < largeur; c++) {
    const n = lignes.filter((l) => estNumeroDeCompte(l[c] ?? '')).length
    if (n > meilleurCompte) {
      meilleurCompte = n
      meilleure = c
    }
  }
  return meilleurCompte > 0 ? meilleure : -1
}

// Les deux colonnes de montants sont les deux qui portent le plus de nombres lisibles, PARMI les
// lignes qui portent un numéro de compte — une balance a souvent un en-tête et un pied de totaux,
// et les compter fausserait le décompte.
//
// L'ORDRE EST DÉCIDÉ PAR LA POSITION, ET C'EST UN CHOIX. Débit avant crédit : c'est la convention
// de présentation de toute balance française, et aucun signal dans les données ne permettrait de
// les distinguer autrement — les deux colonnes portent des nombres positifs de même nature. Un
// en-tête reconnu tranche quand il existe (voir `colonnesParEntete`), la position sert de repli.
function colonnesDeMontants(lignesDeCompte: string[][], colonneCompte: number): [number, number] | null {
  const largeur = Math.max(0, ...lignesDeCompte.map((l) => l.length))
  const scores: { colonne: number; n: number }[] = []
  for (let c = 0; c < largeur; c++) {
    if (c === colonneCompte) continue
    const n = lignesDeCompte.filter((l) => parseMontantBancaire(l[c] ?? '') !== null).length
    if (n > 0) scores.push({ colonne: c, n })
  }
  // À égalité de densité, la colonne la plus à GAUCHE d'abord : c'est l'ordre de lecture, et c'est
  // ce qui donne débit puis crédit sur une balance normalement présentée.
  scores.sort((a, b) => b.n - a.n || a.colonne - b.colonne)
  if (scores.length < 2) return null
  const [a, b] = [scores[0].colonne, scores[1].colonne]
  return a < b ? [a, b] : [b, a]
}

const ENTETES_DEBIT = ['debit', 'debits', 'solde debiteur', 'debiteur']
const ENTETES_CREDIT = ['credit', 'credits', 'solde crediteur', 'crediteur']

function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Quand une ligne d'en-tête nomme les colonnes, elle fait foi : c'est la seule source qui distingue
// vraiment un débit d'un crédit. Cherchée dans les cinq premières lignes seulement — au-delà, ce
// n'est plus un en-tête mais du contenu qui y ressemble.
function colonnesParEntete(lignes: string[][]): { debit: number; credit: number } | null {
  for (const ligne of lignes.slice(0, 5)) {
    const debit = ligne.findIndex((v) => ENTETES_DEBIT.includes(sansAccents(v)))
    const credit = ligne.findIndex((v) => ENTETES_CREDIT.includes(sansAccents(v)))
    if (debit !== -1 && credit !== -1 && debit !== credit) return { debit, credit }
  }
  return null
}

// La colonne du libellé est celle qui porte le plus de texte non numérique, hors comptes et montants
// — même critère de DENSITÉ que pour le libellé d'un relevé bancaire, et pour la même raison : une
// moyenne de longueur ferait gagner une colonne presque toujours vide dès que ses rares valeurs sont
// longues (voir csv.ts).
function colonneDuLibelle(lignesDeCompte: string[][], exclues: number[]): number {
  const largeur = Math.max(0, ...lignesDeCompte.map((l) => l.length))
  let meilleure = -1
  let meilleurCompte = 0
  for (let c = 0; c < largeur; c++) {
    if (exclues.includes(c)) continue
    const n = lignesDeCompte.filter((l) => {
      const v = (l[c] ?? '').trim()
      return v.length > 0 && parseMontantBancaire(v) === null
    }).length
    if (n > meilleurCompte) {
      meilleurCompte = n
      meilleure = c
    }
  }
  return meilleure
}

export function lireBalance(rows: string[][]): ResultatLectureBalance {
  const vide: ResultatLectureBalance = { lignes: [], colonnes: null, ignorees: [] }
  const colonneCompte = colonneDesComptes(rows)
  if (colonneCompte === -1) {
    // Aucun numéro de compte nulle part : ce fichier n'est pas une balance. Le dire ainsi plutôt que
    // de rendre une liste vide, qui se lirait « balance vide » — ce n'est pas la même information.
    return { ...vide, ignorees: rows.map((ligne) => ({ ligne, motif: 'aucun numéro de compte' as const })) }
  }

  const lignesDeCompte = rows.filter((l) => estNumeroDeCompte(l[colonneCompte] ?? ''))
  const parEntete = colonnesParEntete(rows)
  const parPosition = colonnesDeMontants(lignesDeCompte, colonneCompte)
  const montants = parEntete ?? (parPosition ? { debit: parPosition[0], credit: parPosition[1] } : null)
  if (!montants) return { ...vide, ignorees: rows.map((ligne) => ({ ligne, motif: 'aucun montant lisible' as const })) }

  const libelle = colonneDuLibelle(lignesDeCompte, [colonneCompte, montants.debit, montants.credit])
  const colonnes = { compte: colonneCompte, libelle, debit: montants.debit, credit: montants.credit }

  const lignes: LigneBalance[] = []
  const ignorees: ResultatLectureBalance['ignorees'] = []
  for (const ligne of rows) {
    if (!estNumeroDeCompte(ligne[colonneCompte] ?? '')) {
      ignorees.push({ ligne, motif: 'aucun numéro de compte' })
      continue
    }
    const debit = parseMontantBancaire(ligne[montants.debit] ?? '')
    const credit = parseMontantBancaire(ligne[montants.credit] ?? '')
    if (debit === null && credit === null) {
      ignorees.push({ ligne, motif: 'aucun montant lisible' })
      continue
    }
    lignes.push({
      compte: (ligne[colonneCompte] ?? '').trim(),
      libelle: libelle === -1 ? '' : (ligne[libelle] ?? '').trim(),
      debit: debit ?? 0,
      credit: credit ?? 0,
    })
  }

  return { lignes, colonnes, ignorees }
}

export interface ControleBalance {
  totalDebit: number
  totalCredit: number
  /** Débit − crédit. Zéro sur une balance complète ; tout le reste est un fichier amputé. */
  ecart: number
  equilibree: boolean
}

// Une balance équilibrée est la définition même d'une balance : toute écriture ayant été passée en
// partie double, la somme des débits égale la somme des crédits. Un écart ne se discute donc pas —
// il dit que le fichier ne contient pas tout, et il faut le savoir AVANT d'adosser une comptabilité
// dessus. C'est mot pour mot le contrôle du relevé bancaire, sur un autre document.
//
// La tolérance d'un centime absorbe les arrondis de présentation de certains exports, jamais un vrai
// déséquilibre : deux lignes manquantes ne font pas un centime.
export function controlerBalance(lignes: LigneBalance[]): ControleBalance {
  const totalDebit = arrondir(lignes.reduce((s, l) => s + l.debit, 0))
  const totalCredit = arrondir(lignes.reduce((s, l) => s + l.credit, 0))
  const ecart = arrondir(totalDebit - totalCredit)
  return { totalDebit, totalCredit, ecart, equilibree: Math.abs(ecart) <= 0.01 }
}

// Les sommes de flottants dérivent (0,1 + 0,2 ≠ 0,3) : sur une balance de plusieurs centaines de
// lignes, l'écart affiché serait un artefact de représentation plutôt qu'un fait comptable.
function arrondir(n: number): number {
  return Math.round(n * 100) / 100
}

/** Classe du PCG (1 à 8) d'un numéro de compte — le premier chiffre, et rien d'autre. */
export function classeDuCompte(compte: string): number | null {
  const c = compte.trim()
  return NUMERO_DE_COMPTE.test(c) ? Number(c[0]) : null
}
