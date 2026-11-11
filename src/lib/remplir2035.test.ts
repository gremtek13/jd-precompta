import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createHash } from 'node:crypto'
import { mentionDuPdf } from './modeles2035'
import { SAISIE_2035E_VIDE, annexe2035EAvecSaisie, mentionDeLAnnexe2035E, lignesDuPdfASaisir } from './saisies2035E'
import { formaterMontant } from './gabarit2035'

// REMPLIR2035 SUR LE VRAI FORMULAIRE (2035S-Q5, (B), 02/11/2026). Le pdf.js du navigateur touche au DOM dès l'import : il est
// remplacé ici par sa version « legacy », celle que gabarit2035.test.ts lit déjà, et le fichier est servi depuis public/.
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  return { default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href }
})

const { remplir2035 } = await import('./remplir2035')

const ENTETE = { nom: 'DUPONT', prenom: 'Jean', siret: '12345678900011' } as unknown as Parameters<typeof remplir2035>[1]

async function texteDeLaPage(pdf: Uint8Array, numero: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  return (await (await doc.getPage(numero)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

async function remplir(annee: number) {
  return remplir2035(new Map([['BA', 1000]]), ENTETE, null, annee)
}

// Le remplissage et la lecture des deux PDF se paient une fois, dans un `beforeAll` : dans un test, sous la charge de la
// suite entière, le premier chargement de pdf-lib et de pdf.js dépassait les 5 s d'un test (barrière du 04/11/2026). Le
// `fetch` simulé sert le formulaire depuis public/, puis se retire, réussite ou non.
let pageDe2026 = ''
let pageDe2025 = ''
beforeAll(async () => {
  vi.stubGlobal('fetch', async (chemin: string) => {
    const octets = readFileSync(`public${chemin}`)
    return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
  })
  try {
    pageDe2026 = await texteDeLaPage((await remplir(2026)).pdf, 1)
    pageDe2025 = await texteDeLaPage((await remplir(2025)).pdf, 1)
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('remplir2035 — la mention d’un millésime absent', () => {
  it('écrit la mention en tête de la page remplie quand le formulaire de l’exercice n’est pas livré', () => {
    const texte = pageDe2026.replace(/\s+/g, ' ')
    for (const ligne of mentionDuPdf(2026)) expect(texte).toContain(ligne)
  })

  it('n’écrit rien sur le bon millésime', () => {
    expect(pageDe2025).not.toContain('ATTENTION')
  })
})

// LE PDF DE L'ANNEXE 2035-E DIT CE QUI RESTE À SAISIR (ligne 48, 11/11/2026). Sur le vrai formulaire, relu par pdf.js : une
// ligne « à saisir » reste VIDE (jamais 0, jamais le total qu'un zéro supposé donnerait), et la page 3 porte, en rouge, les
// codes des lignes encore à dire. Drapeau baissé (`aSaisir` vide, valeurs sans `null`), le PDF est celui d'avant, à l'octet près.
const ENTREE_ANNEXE = {
  annee: 2025,
  cases: new Map([['AD', 200000], ['AF', 1000], ['BA', 20000], ['BH', 12000], ['BJ', 3000], ['BM', 2000]]),
  formulaire: new Map([['AD', 200000], ['AF', 1000], ['BA', 20000], ['BH', 12000], ['BJ', 3000], ['BM', 2000]]),
  forfaitKilometrique: 0,
}
const ENTETE_ANNEXE = { nom: 'Cabinet Test', siret: '12345678901234', adresse: null, annee: 2025 }
const SAISIE_COMPLETE = {
  loyersDeductibles: 0, plusValues: 7777, variationDeStock: 0, taxesSurLeChiffreDAffaires: 0,
  dotationsBiensMisADisposition: 0, moinsValues: 0, monoEtablissement: false, effectif: null,
}
// La date de modification que pdf-lib inscrit à chaque chargement : figée, pour que deux PDF identiques le soient à l'octet.
const INSTANT = new Date('2026-11-11T10:00:00Z')

async function texteEtPositions(pdf: Uint8Array, numero: number) {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  const items = (await (await doc.getPage(numero)).getTextContent()).items
  return items.flatMap((i) => ('str' in i && i.str.trim() !== '' ? [i.str.trim()] : []))
}

describe('remplir2035 — l’annexe 2035-E et ce qui reste à saisir', () => {
  let sansAvertissement: Uint8Array
  let pageSansSaisie: string[] = []
  let pageComplete: string[] = []
  let pageVierge: string[] = []
  const complete = annexe2035EAvecSaisie(ENTREE_ANNEXE, SAISIE_COMPLETE)
  const incomplete = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, plusValues: null, moinsValues: null, loyersDeductibles: null })

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (chemin: string) => {
      const octets = readFileSync(`public${chemin}`)
      return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(INSTANT)
    try {
      const valeurs = new Map(complete.annexe.lignes)
      // Drapeau baissé : les lignes à l'euro du moteur, sans `null`, et aucune ligne à saisir.
      sansAvertissement = (await remplir2035(new Map([['BA', 1000]]), ENTETE, { valeurs, aSaisir: [], entete: ENTETE_ANNEXE }, 2025)).pdf
      pageComplete = await texteEtPositions(sansAvertissement, 3)
      pageVierge = await texteEtPositions((await remplir2035(new Map([['BA', 1000]]), ENTETE, { valeurs: new Map(), aSaisir: [], entete: ENTETE_ANNEXE }, 2025)).pdf, 3)
      const r = await remplir2035(
        new Map([['BA', 1000]]), ENTETE,
        { valeurs: incomplete.lignes, aSaisir: lignesDuPdfASaisir(incomplete), entete: ENTETE_ANNEXE }, 2025,
      )
      pageSansSaisie = await texteEtPositions(r.pdf, 3)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('drapeau baissé : le PDF est celui d’avant, à l’octet près', () => {
    // Le haché relevé sur le code d'AVANT ce changement (mêmes lignes, même instant, dates figées) : toute dérive du dessin le fait rougir.
    expect(createHash('sha256').update(sansAvertissement).digest('hex')).toBe('2ccaa861bfd7671e9e469663fea5b7c2f09b83e62c7ed81c5424934939ccaf5b')
  })

  it('une ligne à saisir reste vide, et les totaux qui en dépendent aussi : ni 0, ni un total supposé', () => {
    expect(incomplete.lignes.get('EN')).toBeNull()
    expect(incomplete.lignes.get('EI')).toBeNull()
    expect(incomplete.lignes.get('EW')).toBeNull()
    // Avec la saisie, EN et le total 1 s'impriment ; sans, aucun des deux, ni le total qu'un zéro supposé aurait donné.
    expect(pageComplete).toContain(formaterMontant(7777))
    expect(pageComplete).toContain(formaterMontant(complete.annexe.lignes.get('EI') ?? NaN))
    expect(pageSansSaisie).not.toContain(formaterMontant(7777))
    const totalSupposeAZero = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, plusValues: 0 }).annexe.lignes.get('EI')
    expect(pageSansSaisie).not.toContain(formaterMontant(totalSupposeAZero ?? NaN))
    expect(pageSansSaisie).not.toContain(formaterMontant(complete.annexe.lignes.get('EI') ?? NaN))
    // Les lignes qu'aucune saisie n'alimente restent écrites.
    expect(pageSansSaisie).toContain(formaterMontant(complete.annexe.lignes.get('EF') ?? NaN))
    // Aucun zéro écrit : la page sans aucune ligne (même en-tête, le SIRET porte un 0) en compte autant.
    const zeros = (t: string[]) => t.filter((x) => x === '0').length
    expect(zeros(pageSansSaisie)).toBe(zeros(pageVierge))
  })

  it('la page de l’annexe nomme les lignes encore à saisir, et seulement elle', () => {
    expect(incomplete.aSaisir).toEqual(['EN', 'EM', 'EV'])
    const texte = pageSansSaisie.join(' ').replace(/\s+/g, ' ')
    for (const ligne of mentionDeLAnnexe2035E(['EN', 'EM', 'EV'])) expect(texte).toContain(ligne)
    expect(texte).toContain('EN, EM, EV')
    expect(pageComplete.join(' ')).not.toContain('ATTENTION')
  })

  it('une saisie complète n’avertit de rien ; le cadre (AH, BK), qui ne s’imprime pas, n’y est pas nommé', async () => {
    const seulCadre = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, monoEtablissement: null })
    expect(seulCadre.aSaisir).toEqual(['AH'])
    expect(lignesDuPdfASaisir(seulCadre)).toEqual([])
    expect(mentionDeLAnnexe2035E([])).toEqual([])
    expect(lignesDuPdfASaisir(annexe2035EAvecSaisie(ENTREE_ANNEXE, SAISIE_2035E_VIDE))).toEqual(['EN', 'EK', 'EM', 'ER', 'EU', 'EV'])
  })
})
