import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { EXONERATIONS, MENTION_FRANCHISE, VATEX_FRANCHISE, motifExoneration, refusTauxPositif } from './statutTva'
import type { ArticleExoneration, StatutTva } from './types'

// LE MOTIF D'EXONÉRATION QUE SUPERPDP-EMIT TRANSMET SUIT LE STATUT DE TVA DU DOSSIER (ligne 28.5, étape a).
//
// Une ligne à 0 % partait vers la plateforme avec le motif de la franchise en base (« TVA non applicable, art. 293 B
// du CGI ») QUEL QUE SOIT le dossier : un dossier de soins exonérés transmettait donc une franchise qu'il n'a pas, dans
// une facture que l'administration reçoit et qui ne se corrige que par un avoir. `superpdp-emit` est auto-portée : elle
// recopie entre les bornes `── DÉBUT/FIN STATUT TVA` les exonérations, `motifExoneration` et `refusTauxPositif` de
// src/lib/statutTva.ts, et ce test les compare à l'original sur chaque statut, chaque article et chaque taux — la forme
// de garde des autres blocs : extraire, transpiler, exécuter, comparer à une référence EXTÉRIEURE à la copie, et
// planter des dérives dans la vraie source pour prouver qu'il sait encore échouer.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/superpdp-emit/index.ts', import.meta.url), 'utf8')
}

type Resultat = { motif: { categorie: 'E'; code: string; texte: string } | null; refus: string | null }
interface Copie {
  motifExoneration: (statut: StatutTva | null, article: ArticleExoneration | null) => Resultat
  refusTauxPositif: (statut: StatutTva | null, taux: number) => string | null
  motifDeLaFacture: (statut: StatutTva | null, article: ArticleExoneration | null, taux: readonly number[]) => Resultat
  EXONERATIONS: readonly { code: ArticleExoneration; mention: string; vatex: string }[]
}

function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT STATUT TVA')
  const fin = source.indexOf('// ── FIN STATUT TVA')
  expect(debut, 'bornes du bloc STATUT TVA introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const js = ts.transpileModule(source.slice(debut, fin), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { motifExoneration, refusTauxPositif, motifDeLaFacture, EXONERATIONS }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const STATUTS: readonly (StatutTva | null)[] = [null, 'redevable', 'franchise', 'exonere']
const ARTICLES: readonly (ArticleExoneration | null)[] = [null, ...EXONERATIONS.map((e) => e.code)]
// Les taux d'une ligne de facture : zéro, les taux français, un taux qui porte une virgule, et un négatif défensif.
const TAUX = [0, 2.1, 5.5, 8.5, 10, 20, -1]

// Ce que l'original rend, pour comparer : une référence EXTÉRIEURE à la copie. Comparer la copie à elle-même serait
// une tautologie (voir agentComptableAnalyse.test.ts).
function attenduDeLaFacture(statut: StatutTva | null, article: ArticleExoneration | null, taux: readonly number[]): Resultat {
  if (statut == null) return motifExoneration(null, article)
  const taxe = taux.map((t) => refusTauxPositif(statut, t)).find((r) => r != null)
  if (taxe) return { motif: null, refus: taxe }
  if (!taux.some((t) => t === 0)) return { motif: null, refus: null }
  return motifExoneration(statut, article)
}

function comparer(copie: Copie) {
  for (const statut of STATUTS) {
    for (const article of ARTICLES) {
      expect(copie.motifExoneration(statut, article), `motif — ${statut} / ${article}`).toEqual(motifExoneration(statut, article))
      for (const taux of TAUX) {
        expect(copie.refusTauxPositif(statut, taux), `refus — ${statut} / ${taux}`).toBe(refusTauxPositif(statut, taux))
      }
      for (const lignes of [[0], [20], [0, 20], [5.5, 10], [0, 0], [2.1]]) {
        expect(copie.motifDeLaFacture(statut, article, lignes), `facture — ${statut} / ${article} / ${lignes}`)
          .toEqual(attenduDeLaFacture(statut, article, lignes))
      }
    }
  }
}

// Une dérive se voit par une ASSERTION, jamais par une erreur d'exécution, qui passerait pour une prise.
function echoue(source: string): boolean {
  try {
    comparer(extraire(source))
    return false
  } catch (e) {
    return (e as Error).name === 'AssertionError'
  }
}

function plantee(avant: string, apres: string): string {
  const source = sourceDeployee()
  expect(source.split(avant).length - 1, `motif à planter introuvable : ${avant}`).toBe(1)
  return source.replace(avant, apres)
}

describe('superpdp-emit — le motif d’exonération suit le statut de TVA du dossier', () => {
  it('la copie rend ce que src/lib/statutTva.ts rend, sur chaque statut, article et taux', () => {
    comparer(deployee)
  })

  it('porte toute la liste fermée des exonérations, mention et code VATEX compris', () => {
    expect(deployee.EXONERATIONS).toEqual(EXONERATIONS.map((e) => ({ code: e.code, mention: e.mention, vatex: e.vatex })))
  })

  it('un dossier de soins exonérés transmet son article, jamais la franchise', () => {
    const r = deployee.motifDeLaFacture('exonere', 'cgi_261_4_1', [0])
    expect(r.motif?.texte).toBe('Exonération de TVA, art. 261, 4, 1° du CGI.')
    expect(r.motif?.texte).not.toBe(MENTION_FRANCHISE)
    expect(deployee.motifDeLaFacture('franchise', null, [0]).motif).toEqual({ categorie: 'E', code: VATEX_FRANCHISE, texte: MENTION_FRANCHISE })
  })

  it('refuse avant toute transmission : statut à préciser, ligne taxée hors redevable, ligne à 0 % sans article', () => {
    expect(deployee.motifDeLaFacture(null, null, [20]).refus).toMatch(/^Le statut de TVA du dossier est à préciser/)
    expect(deployee.motifDeLaFacture('franchise', null, [0, 20]).refus).toMatch(/^Un dossier en franchise en base ne facture pas de TVA/)
    expect(deployee.motifDeLaFacture('exonere', null, [0]).refus).toMatch(/^Le dossier est exonéré sans article/)
    expect(deployee.motifDeLaFacture('redevable', null, [20, 0]).refus).toMatch(/^Une ligne à 0 % d’un dossier redevable/)
    // GARDE SYMÉTRIQUE : un redevable qui ne facture que des lignes taxées n'a ni motif ni refus.
    expect(deployee.motifDeLaFacture('redevable', null, [20, 10])).toEqual({ motif: null, refus: null })
  })

  it('attrape une dérive plantée dans la vraie source', () => {
    expect(echoue(plantee(
      'if (statut === "franchise") {\n    return { motif: { categorie: "E", code: VATEX_FRANCHISE',
      'if (statut === "franchise" || statut === "exonere") {\n    return { motif: { categorie: "E", code: VATEX_FRANCHISE',
    )), 'exonéré transmis en franchise (le défaut d’origine)').toBe(true)
    expect(echoue(plantee('{ code: "cgi_261_c_2", mention: "Exonération de TVA, art. 261 C, 2° du CGI.", vatex: "VATEX-FR-CGI261C-2" }',
      '{ code: "cgi_261_c_2", mention: "Exonération de TVA, art. 261 C, 2° du CGI.", vatex: "VATEX-FR-CGI261-4" }')), 'code VATEX de l’assurance faux').toBe(true)
    expect(echoue(plantee('  if (taux <= 0) return null', '  if (taux < 0) return null')), 'ligne à 0 % refusée').toBe(true)
    expect(echoue(plantee('  if (statut == null) return motifExoneration(null, article)\n', '')), 'statut à préciser transmis').toBe(true)
    expect(echoue(plantee('  if (!taux.some((t) => t === 0)) return { motif: null, refus: null }\n', '')), 'motif exigé sans ligne à 0 %').toBe(true)
    expect(echoue(plantee('  if (taxe) return { motif: null, refus: taxe }\n', '')), 'ligne taxée d’un exonéré transmise').toBe(true)
  })
})

// LE CÂBLAGE, GARDÉ À PART DE LA FORME : le bloc peut rester juste pendant que le gestionnaire cesse de l'appeler, ou
// l'appelle après avoir déjà transmis. Il n'y a pas d'écran ici, donc c'est la source qui répond.
describe('superpdp-emit — le statut de TVA est lu et jugé avant tout envoi', () => {
  const source = sourceDeployee()
  const gestionnaire = source.slice(source.indexOf('Deno.serve('))

  it('lit le statut du dossier et refuse avant la conversion, la validation et l’envoi', () => {
    const lecture = gestionnaire.indexOf('.select("statut_tva, article_exoneration")')
    const verdict = gestionnaire.indexOf('motifDeLaFacture(')
    const refus = gestionnaire.indexOf('if (verdict.refus) {')
    const conversion = gestionnaire.indexOf('/v1.beta/invoices/convert')
    expect(lecture, 'lecture du statut introuvable').toBeGreaterThan(-1)
    expect(verdict).toBeGreaterThan(lecture)
    expect(refus).toBeGreaterThan(verdict)
    expect(conversion).toBeGreaterThan(refus)
    expect(gestionnaire).toContain('construireEnInvoice(facture, lignes, verdict.motif)')
  })

  it('le motif d’une ligne à 0 % vient du statut — plus jamais la franchise écrite en dur', () => {
    expect(source).toContain('vat_exemption_reason: motif.texte')
    expect(source).not.toContain('Franchise en base de TVA, art. 293 B du CGI.')
  })
})
