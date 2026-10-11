import { calculerDeclaration2035, type Declaration2035 } from './declaration2035'
import { cotisationsComptees } from './cotisationRapprochee'
import type { ModeleComptable } from './engagement'
import { libelleCompteTenu, libelleDuPlanComptable } from './comptes'
import { formatMoney } from './format'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces } from './rattachement'
import {
  LIBELLE_DE_L_ETAT_DE_LA_LIGNE, LIBELLE_DU_TOTAL, type CauseARevoir, type CleDeLigne, type DonneesDeLaRevueAnalytique,
  type EtatDeLaLigne, type ExercicePourLaRevue, type ReperesAnnuels, type TotalDeLa2035,
} from './revueAnalytique'
import type {
  ANouveau, Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, LigneBancaire, Piece, ReglementGroupe,
  RevisionExplication, RevisionSeuil, SoldeReporte, VehiculeDossier, VentilationBancaire,
} from './types'

// CE QUE L'ÉCRAN DE LA REVUE ANALYTIQUE (ligne 41, étape R5, phase C) DONNE AU MODULE ET CE QU'IL EN MONTRE. Le calcul, les
// états et les refus sont ceux de `lib/revueAnalytique.ts` : rien ici ne les réécrit. Ce fichier est PUR (il ne lit rien
// en base) et ne fait que deux choses — assembler `DonneesDeLaRevueAnalytique` depuis ce que l'onglet Révision a lu, et
// dire en mots ce que le module rend.

// ── Ce que l'onglet a lu ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Les lectures de la Vue d'ensemble dont la 2035 et le relevé se tirent : tout le dossier, tous exercices. Déclarées ici
 * plutôt que prises à `DonneesDeLaChecklist` : ce module est PUR, et ce fichier-là importe une lecture de la base.
 */
export interface LecturesDuDossierPourLaRevue {
  piecesValidees: Piece[]
  categories: Categorie[]
  immobilisations: Immobilisation[]
  cotisations: CotisationDeclaree[]
  vehicules: VehiculeDossier[]
  lignes: LigneBancaire[]
  ventilations: VentilationBancaire[]
  reglements: ReglementGroupe[]
  declarationsTva: DeclarationTva[]
  ecritures: EcritureBrouillon[]
}

export interface SourcesDeLaRevueAnalytique {
  dossier: LecturesDuDossierPourLaRevue
  reprise: readonly ANouveau[]
  reportes: readonly SoldeReporte[]
  exercicesValides: readonly ExercicePourLaRevue[]
  reperes: ReperesAnnuels
  seuils: readonly RevisionSeuil[]
  explications: readonly RevisionExplication[]
}

/**
 * La 2035 de l'exercice TELLE QUE CLÔTURE LA CALCULE (`ClotureTab` : le relevé rapproché seul, les paiements des pièces,
 * les parts du relevé, les échéances de cotisation à leur paiement) — jamais une autre : la revue compare ce que le cabinet
 * voit déjà ailleurs. Nulle pour un dossier tenu en engagement : une 2035 déclare des bénéfices non commerciaux, tenus en
 * trésorerie, et la revue n'en invente pas.
 */
export function declarationPourLaRevue(
  annee: number,
  modele: ModeleComptable,
  assujettiTva: boolean,
  d: LecturesDuDossierPourLaRevue,
): Declaration2035 | null {
  if (modele.mode === 'engagement') return null
  const rapprochees = d.lignes.filter((l) => l.statut === 'rapprochee')
  const paiements = paiementsDesPieces(rapprochees, d.reglements)
  const parts = partsDuReleve(rapprochees, d.categories, d.ventilations, assujettiTva)
  const comptees = cotisationsComptees(d.cotisations, rapprochees, modele.mode)
  return calculerDeclaration2035(
    annee, d.piecesValidees, d.categories, d.immobilisations, comptees, d.vehicules, assujettiTva, paiements, parts, d.declarationsTva,
  )
}

/** Ce que le module demande, assemblé depuis ce que l'onglet a lu EN ENTIER. */
export function donneesDeLaRevueAnalytique(
  annee: number,
  anneeCourante: number,
  modele: ModeleComptable,
  assujettiTva: boolean,
  s: SourcesDeLaRevueAnalytique,
): DonneesDeLaRevueAnalytique {
  const rapprochees = s.dossier.lignes.filter((l) => l.statut === 'rapprochee')
  return {
    annee,
    anneeCourante,
    ecritures: s.dossier.ecritures,
    reprise: s.reprise,
    reportes: s.reportes,
    declaration: declarationPourLaRevue(annee, modele, assujettiTva, s.dossier),
    exercicesValides: s.exercicesValides,
    reperes: s.reperes,
    partsDuReleve: partsDuReleve(rapprochees, s.dossier.categories, s.dossier.ventilations, assujettiTva),
    seuils: s.seuils,
    explications: s.explications,
  }
}

// ── Ce qu'on tape ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Un montant tapé en euros, en CENTIMES : « 1 200,50 », « 1200.5 », « 600 ». Les espaces (dont les insécables) et le
 * symbole € s'ignorent, la virgule vaut le point. NaN pour tout ce qui n'est pas un montant AU CENTIME — un champ vide,
 * une lettre, un signe, trois décimales : le module refuse alors sous les mots de la base (« un montant positif, au
 * centime »), au lieu qu'un arrondi silencieux change ce que le cabinet a tapé.
 */
export function centimesDeLaSaisie(texte: string): number {
  const net = texte.replace(/[\s  €]/g, '')
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(net)
  if (m === null || (m[2] ?? '').length > 2) return Number.NaN
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

// ── Ce qu'on dit ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Qui a écrit : « par toi », ou l'identifiant court d'un autre compte — aucune table ne donne son nom au navigateur. */
export function parQui(auteur: string, utilisateur: string | null): string {
  return utilisateur !== null && auteur.toLowerCase() === utilisateur.toLowerCase()
    ? 'par toi'
    : `par un autre compte du cabinet (${auteur.slice(0, 8)})`
}

/** Un montant signé, pour une variation : le plus et le moins se lisent, comme le moins de `formatMoney`. */
function montantSigne(centimes: number): string {
  const euros = formatMoney(Math.abs(centimes) / 100)
  return centimes > 0 ? `+${euros}` : centimes < 0 ? `-${euros}` : euros
}

/** « +12,5 % », « -3 % », « 0 % » : des dixièmes de point, l'entier sans virgule inutile ; le signe moins est celui de `formatMoney`. */
export function pourcentageEnMots(dixiemes: number): string {
  const absolu = Math.abs(dixiemes)
  const entier = Math.floor(absolu / 10)
  const reste = absolu % 10
  const nombre = reste === 0 ? String(entier) : `${entier},${reste}`
  return `${dixiemes > 0 ? '+' : dixiemes < 0 ? '-' : ''}${nombre} %`
}

/**
 * La variation d'une ligne en mots : en euros, et en pourcentage du précédent. Rien (un tiret) sans comparaison ; sur un
 * précédent nul le pourcentage n'existe pas, et la ligne le dit plutôt que d'inventer l'infini. Aucun mot ne qualifie la
 * variation : ni « normale », ni « anormale ».
 */
export function variationEnMots(
  l: { variationCentimes: number | null; variationDixiemesDePourcent: number | null },
): { euros: string; pourcentage: string } {
  if (l.variationCentimes === null) return { euros: '—', pourcentage: '—' }
  return {
    euros: montantSigne(l.variationCentimes),
    pourcentage: l.variationDixiemesDePourcent === null ? 'précédent nul' : pourcentageEnMots(l.variationDixiemesDePourcent),
  }
}

/** L'état d'une ligne sous son libellé, avec la classe de sa pastille — l'attente ou l'absence ne s'alarme pas. */
export const PASTILLE_DE_L_ETAT_DE_LA_LIGNE: Readonly<Record<EtatDeLaLigne, { mot: string; classe: string }>> = {
  'en-attente': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['en-attente'], classe: 'badge-neutral' },
  'sans-comparaison': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['sans-comparaison'], classe: 'badge-neutral' },
  'sans-seuil': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['sans-seuil'], classe: 'badge-neutral' },
  'sous-le-seuil': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['sous-le-seuil'], classe: 'badge-neutral' },
  'a-expliquer': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['a-expliquer'], classe: 'badge-warning' },
  expliquee: { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE.expliquee, classe: 'badge-ok' },
  'a-revoir': { mot: LIBELLE_DE_L_ETAT_DE_LA_LIGNE['a-revoir'], classe: 'badge-warning' },
}

/** Ce qui fait qu'une explication est « à revoir », en mots. */
export const CAUSES_A_REVOIR_DE_LA_LIGNE: Readonly<Record<CauseARevoir, string>> = {
  'montant-change': 'le montant de l’exercice n’est plus celui qu’elle commente',
  'precedent-change': 'le montant de l’exercice précédent n’est plus celui qu’elle commente',
  'source-changee': 'la source de la comparaison n’est plus celle qu’elle commente',
  'chaine-illisible': 'les explications de cette ligne ne se relisent pas en chaîne',
}

const MOIS_EN_MOTS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
] as const

/** « juin 2026 » depuis `2026-06` : le calendrier civil, aucun fuseau. */
export function moisEnMots(mois: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(mois)
  const nom = m === null ? undefined : MOIS_EN_MOTS[Number(m[2]) - 1]
  return m === null || nom === undefined ? mois : `${nom} ${m[1]}`
}

/** Le titre d'une ligne : le poste avec sa nature, le total, le compte avec son nom quand le plan le connaît. */
export function titreDeLaLigne(cle: CleDeLigne): string {
  if (cle.objet_type === 'poste_2035') return `${cle.objet} (${cle.nature === 'recette' ? 'recette' : 'dépense'})`
  if (cle.objet_type === 'total_2035') return LIBELLE_DU_TOTAL[cle.objet as TotalDeLa2035] ?? cle.objet
  const nom = libelleCompteTenu(cle.objet) ?? libelleDuPlanComptable(cle.objet)
  return nom === null ? `Compte ${cle.objet}` : `Compte ${cle.objet} — ${nom}`
}

/** Deux lignes sont la même quand le type, l'objet et la nature (nulle hors d'un poste) le sont. */
export function memeCleDeLigne(a: CleDeLigne, b: CleDeLigne): boolean {
  return a.objet_type === b.objet_type && a.objet === b.objet && (a.nature ?? null) === (b.nature ?? null)
}

/** Une clé stable pour un `key` React ou un identifiant de panneau. */
export function identifiantDeLaLigne(cle: CleDeLigne): string {
  return `${cle.objet_type}|${cle.objet}|${cle.nature ?? ''}`
}
