import {
  bilanDeLExercice, colonneDeLExercicePrecedent, regleDuCompte, RUBRIQUES_ACTIF, RUBRIQUES_PASSIF, type EntreesDuBilan,
  type IdRubriqueActif, type IdRubriquePassif,
} from './bilan'
import { formatDate } from './format'
import { compteDuResultat, compteQuiRecoit, etatDeLOuverture, ouvertureDeLExercice, soldesAReporter } from './reportDesSoldes'

// L'OUVERTURE D'UN EXERCICE CONFRONTÉE AU BILAN QUI LA PRÉCÈDE — ligne 33 de la feuille de route, troisième brique
// (11/10/2026).
//
// « Le bilan d'ouverture d'un exercice doit correspondre au bilan de clôture de l'exercice précédent » (code de
// commerce, art. L123-19, al. 3, en vigueur depuis le 1er janvier 2016) ; « le bilan d'ouverture d'un exercice
// correspond au bilan de clôture avant répartition de l'exercice précédent » (PCG, art. 112-2, règlement ANC
// n° 2014-03 ; textes relus sur Légifrance le 11/10/2026). L'onglet Bilan montrait N et N−1 sans dire si l'un s'ouvre
// bien par l'autre : ce module le JUGE, en centimes entiers, sans rien écrire.
//
// LES DEUX CÔTÉS NE SE LISENT PAS DANS LA MÊME SOURCE, et c'est ce qui donne un sens à la confrontation :
//   - l'OUVERTURE de N est ce que N lit — les soldes reportés à la validation de N−1 (`ouvertureDeLExercice`), tels que
//     la base les a écrits ;
//   - la CLÔTURE de N−1 est le MÊME bilan que la colonne N−1 de l'onglet (`colonneDeLExercicePrecedent`), calculé de
//     ses écritures et de sa propre ouverture ; jamais l'ouverture de N relue, qui ferait concorder à coup sûr.
//
// LE RAPPROCHEMENT SUIT LA RÈGLE DU REPORT, que ce module CITE au lieu de la récrire : la clôture de N−1 passe par
// `soldesAReporter` (lib/reportDesSoldes.ts), le jumeau de `soldes_a_reporter` en base — pour une entreprise
// individuelle, le compte de l'exploitant (108), le capital (101), les résultats antérieurs (12) et le résultat de
// l'exercice se réunissent au capital individuel, 101000 (PCG, art. 1211-10) ; une société garde son résultat avant
// répartition, au 120000 pour un bénéfice, au 129000 pour une perte (`compteDuResultat`, `compteQuiRecoit`). Le compte
// de l'ouverture qui réunit plusieurs comptes de la clôture le dit (`report`).
//
// COMPTE PAR COMPTE, PUIS RUBRIQUE PAR RUBRIQUE. Les rubriques de l'ouverture sont celles du bilan de N SANS ses
// écritures (le même calcul, les mêmes règles : une banque créditrice, un client qui a trop payé…) ; celles de la
// clôture, celles de N−1, son résultat versé dans la rubrique du compte qui le reçoit. Deux comptes d'une même
// rubrique peuvent s'écarter en sens contraire : le compte le dit quand la rubrique se tait.
//
// QUAND IL N'Y A RIEN À CONFRONTER, le motif le dit : l'ouverture de N attend la validation de N−1 ; N est le premier
// exercice du dossier ; N−1 précède la reprise (N s'ouvre par une balance reprise, que son import contrôle) ; N−1 ne
// s'établit pas. Sur une lecture partielle, rien ne se juge.

export type CodeSansObjet = 'ouverture-en-attente' | 'premier-exercice' | 'avant-la-reprise' | 'precedent-non-etabli'

export type CauseDeLEcart = 'absent-de-l-ouverture' | 'absent-de-la-cloture' | 'montants-differents'

/** Un compte dont l'ouverture de N ne reprend pas la clôture de N−1. Montants en centimes, débit − crédit. */
export interface EcartDeCompte {
  compte: string
  libelle: string
  ouverture: number
  cloture: number
  /** Ouverture − clôture. */
  difference: number
  cause: CauseDeLEcart
  /**
   * Ce que le report réunit dans ce compte, quand ce n'est pas lui seul : les comptes de la clôture qu'il y verse, et le
   * résultat de N−1 (en centimes, positif un bénéfice) s'il le reçoit. Nul quand le compte ne reçoit que lui-même.
   */
  report: { comptes: string[]; resultat: number | null } | null
}

/** Une rubrique du 2033-A dont l'ouverture ne reprend pas la clôture : à l'actif le net, au passif le montant. */
export interface EcartDeRubrique {
  cote: 'actif' | 'passif'
  id: IdRubriqueActif | IdRubriquePassif
  libelle: string
  ouverture: number
  cloture: number
  difference: number
  /** Les comptes en écart qui y figurent, d'un côté ou de l'autre, dans l'ordre des numéros. */
  comptes: string[]
}

export type ConfrontationDeLOuverture =
  | { etat: 'illisible'; exercice: number; texte: string }
  | { etat: 'sans-objet'; exercice: number; code: CodeSansObjet; texte: string }
  | { etat: 'concordante'; exercice: number; precedent: number; comptes: number; regle: string; texte: string }
  | {
    etat: 'ecarts'
    exercice: number
    precedent: number
    comptes: EcartDeCompte[]
    rubriques: EcartDeRubrique[]
    regle: string
    texte: string
  }

const parNumero = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const pluriel = (n: number, singulier: string, plurielForme: string) => (n > 1 ? plurielForme : singulier)
const centimes = (sens: 'debit' | 'credit', montant: number) => (sens === 'debit' ? 1 : -1) * Math.round(montant * 100)

const sansObjet = (exercice: number, code: CodeSansObjet, texte: string): ConfrontationDeLOuverture =>
  ({ etat: 'sans-objet', exercice, code, texte })

/**
 * L'ouverture de `d.exercice` confrontée à la clôture de l'exercice qui le précède. `lecture` dit si toutes les
 * lectures de l'écran sont revenues entières : sur une lecture partielle, rien ne se juge.
 */
export function confronterLOuverture(d: EntreesDuBilan, lecture: 'complete' | 'partielle'): ConfrontationDeLOuverture {
  const n = d.exercice
  const p = n - 1
  if (lecture === 'partielle') {
    return {
      etat: 'illisible', exercice: n,
      texte: 'L’ouverture ne se confronte pas sur une lecture incomplète : un écart y serait celui de la lecture.',
    }
  }
  const lues = { reprise: d.reprise, reportes: d.reportes, anneesValidees: d.anneesValidees, ecritures: d.ecritures }
  const etatDeN = etatDeLOuverture(n, lues)
  const dateReprise = d.reprise.length > 0 ? d.reprise.map((a) => a.date).sort(parNumero)[0] : null
  switch (etatDeN.type) {
    case 'en-attente':
      return sansObjet(n, 'ouverture-en-attente', `L’exercice ${n} n’a pas encore d’ouverture : elle s’écrira à la `
        + `validation de l’exercice ${p} (Clôture), et se confrontera alors à son bilan.`)
    case 'reprise':
      return sansObjet(n, 'avant-la-reprise', `L’exercice ${n} s’ouvre par la balance reprise le ${formatDate(etatDeN.date)} : `
        + `l’exercice ${p} est tenu dans le logiciel précédent, pas dans l’application. La balance reprise s’est contrôlée à `
        + 'son import (débit = crédit, au centime).')
    case 'sans-objet':
      // Un exercice sans ouverture : il précède la reprise du dossier, ou rien ne le précède.
      return dateReprise !== null && `${n}-01-01` < dateReprise
        ? sansObjet(n, 'avant-la-reprise', `L’exercice ${n} précède la reprise du dossier, ouvert le ${formatDate(dateReprise)} : `
          + 'ses comptes sont ceux du logiciel précédent, et son ouverture aussi.')
        : sansObjet(n, 'premier-exercice', `L’exercice ${n} est le premier du dossier : il s’ouvre sans solde, et aucun `
          + 'exercice précédent n’est tenu dans l’application.')
    case 'report':
      break
  }

  const colonne = colonneDeLExercicePrecedent(d)
  if (colonne.etat === 'non-etablie') {
    // Défensif : N s'ouvre par le report de N−1, qui est donc validé et a son bilan. Un motif qui dirait le contraire
    // se rend tel quel, sans rien juger.
    const code: CodeSansObjet = colonne.motif.code === 'ouverture-en-attente' ? 'precedent-non-etabli' : colonne.motif.code
    return sansObjet(n, code, `Le bilan de l’exercice ${p} ne s’établit pas : ${colonne.motif.texte}`)
  }
  // Le bilan d'ouverture de N : le bilan de N sans ses écritures — son ouverture seule, sous les mêmes règles.
  const debut = `${n}-01-01`
  const deLOuverture = bilanDeLExercice({ ...d, ecritures: d.ecritures.filter((e) => e.date < debut) })
  if (deLOuverture.etat !== 'etabli') {
    // Défensif de même : l'état de l'ouverture de N ne lit pas les écritures de N.
    return sansObjet(n, deLOuverture.motif.code === 'avant-la-reprise' ? 'avant-la-reprise' : 'ouverture-en-attente',
      deLOuverture.motif.texte)
  }
  const cloture = colonne.bilan
  const individuel = cloture.individuel

  // ── Compte par compte ──
  // La clôture de N−1 telle que le report la verse : le jumeau de la base, sur les soldes du bilan de N−1.
  const report = soldesAReporter(
    cloture.soldes.map((s) => ({
      compte: s.compte, compteLib: s.libelle, sens: s.centimes > 0 ? 'debit' as const : 'credit' as const,
      montant: Math.abs(s.centimes) / 100,
    })),
    d.modele, p,
  )
  // Le résultat de N−1 se lit sur son bilan (positif, un bénéfice) ; `compteDuResultat` attend débit − crédit.
  const versLeResultat = compteDuResultat(individuel, -cloture.resultat)
  const aLaCloture = new Map<string, { centimes: number; libelle: string }>()
  for (const s of report.soldes) aLaCloture.set(s.compte, { centimes: centimes(s.sens, s.montant), libelle: s.libelle })
  const aLOuverture = new Map<string, { centimes: number; libelle: string }>()
  for (const a of ouvertureDeLExercice(d.reprise, d.reportes, n)) {
    const o = aLOuverture.get(a.compte) ?? { centimes: 0, libelle: a.libelle }
    o.centimes += centimes(a.sens, a.montant)
    aLOuverture.set(a.compte, o)
  }
  const tousLesComptes = [...new Set([...aLaCloture.keys(), ...aLOuverture.keys()])].sort(parNumero)
  const ecartsDeCompte: EcartDeCompte[] = []
  for (const compte of tousLesComptes) {
    const o = aLOuverture.get(compte)?.centimes ?? 0
    const c = aLaCloture.get(compte)?.centimes ?? 0
    if (o === c) continue
    const reunis = cloture.soldes
      .filter((s) => s.centimes !== 0 && !/^[67]/.test(s.compte) && s.compte !== compte
        && compteQuiRecoit(s.compte, individuel, versLeResultat) === compte)
      .map((s) => s.compte)
    const resultat = compte === versLeResultat && cloture.resultat !== 0 ? cloture.resultat : null
    ecartsDeCompte.push({
      compte,
      libelle: aLOuverture.get(compte)?.libelle ?? aLaCloture.get(compte)?.libelle ?? compte,
      ouverture: o, cloture: c, difference: o - c,
      cause: o === 0 ? 'absent-de-l-ouverture' : c === 0 ? 'absent-de-la-cloture' : 'montants-differents',
      report: reunis.length > 0 || resultat !== null ? { comptes: reunis, resultat } : null,
    })
  }
  const enEcart = new Set(ecartsDeCompte.map((e) => e.compte))

  // ── Rubrique par rubrique ──
  // Le résultat de N−1 quitte sa rubrique pour celle du compte qui le reçoit : le capital d'une entreprise
  // individuelle, les résultats en attente d'affectation d'une société (`regleDuCompte`, la table du bilan).
  const destination = regleDuCompte(versLeResultat, individuel).crediteur
  const rubriqueDuResultat: IdRubriquePassif = destination.cote === 'passif' ? destination.rubrique : 'a-classer-passif'
  const comptesDe = (ouverture: { compte: string }[], aClore: { compte: string }[], recoitLeResultat: boolean) => {
    const comptes = new Set<string>()
    for (const c of ouverture) if (enEcart.has(c.compte)) comptes.add(c.compte)
    for (const c of aClore) {
      const vers = compteQuiRecoit(c.compte, individuel, versLeResultat)
      if (enEcart.has(vers)) comptes.add(vers)
    }
    if (recoitLeResultat && enEcart.has(versLeResultat)) comptes.add(versLeResultat)
    return [...comptes].sort(parNumero)
  }
  const ecartsDeRubrique: EcartDeRubrique[] = []
  RUBRIQUES_ACTIF.forEach((r, i) => {
    const o = deLOuverture.actif[i]
    const c = cloture.actif[i]
    if (o.net === c.net) return
    ecartsDeRubrique.push({
      cote: 'actif', id: r.id, libelle: r.libelle, ouverture: o.net, cloture: c.net, difference: o.net - c.net,
      comptes: comptesDe(o.contributions, c.contributions, false),
    })
  })
  RUBRIQUES_PASSIF.forEach((r, i) => {
    const o = deLOuverture.passif[i]
    const c = cloture.passif[i]
    const aClore = r.id === 'resultat' ? 0 : c.montant + (r.id === rubriqueDuResultat ? cloture.resultat : 0)
    if (o.montant === aClore) return
    ecartsDeRubrique.push({
      cote: 'passif', id: r.id, libelle: r.libelle, ouverture: o.montant, cloture: aClore, difference: o.montant - aClore,
      comptes: comptesDe(o.contributions, c.contributions, r.id === rubriqueDuResultat),
    })
  })

  const regle = individuel
    ? `Le report réunit le compte de l’exploitant (108), le capital (101), les résultats antérieurs (12) et le résultat de `
      + `l’exercice ${p} au capital individuel, 101000 (PCG, art. 1211-10).`
    : `Le report garde le résultat de l’exercice ${p} avant répartition, au 120000 pour un bénéfice, au 129000 pour une `
      + 'perte (PCG, art. 112-2) : son affectation ne s’écrit pas encore dans l’application.'
  if (ecartsDeCompte.length === 0 && ecartsDeRubrique.length === 0) {
    return {
      etat: 'concordante', exercice: n, precedent: p, comptes: tousLesComptes.length, regle,
      texte: `L’ouverture de ${n} reprend la clôture de ${p}, compte par compte et rubrique par rubrique, au centime `
        + '(code de commerce, art. L123-19 ; PCG, art. 112-2).',
    }
  }
  const k = ecartsDeCompte.length
  const r = ecartsDeRubrique.length
  const combien = [
    k > 0 ? `${k} ${pluriel(k, 'compte', 'comptes')}` : null,
    r > 0 ? `${r} ${pluriel(r, 'rubrique', 'rubriques')} du bilan` : null,
  ].filter(Boolean).join(' et ')
  return {
    etat: 'ecarts', exercice: n, precedent: p, comptes: ecartsDeCompte, rubriques: ecartsDeRubrique, regle,
    texte: `L’ouverture de ${n} ne reprend pas la clôture de ${p} : ${combien} en écart. Le bilan d’ouverture doit `
      + 'correspondre au bilan de clôture de l’exercice précédent (code de commerce, art. L123-19 ; PCG, art. 112-2). '
      + `L’ouverture de ${n} est faite des soldes reportés à la validation de ${p} ; la clôture de ${p} se calcule ici de `
      + `ses écritures et de sa propre ouverture. Un exercice validé est figé en base avec ses soldes reportés : l’écart ne `
      + 'vient pas d’une saisie, et rien ne se corrige d’ici.',
  }
}
