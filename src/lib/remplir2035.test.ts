import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createHash } from 'node:crypto'
import { mentionDuPdf } from './modeles2035'
import { SAISIE_2035E_VIDE, annexe2035EAvecSaisie, mentionDeLAnnexe2035E } from './saisies2035E'
import { formaterMontant, texteCompatiblePdf } from './gabarit2035'

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

// LE PDF DE L'ANNEXE 2035-E DIT CE QUI RESTE À SAISIR (ligne 48 ; 11/11/2026, puis 48S-Q2 le 13/11/2026). Sur le vrai
// formulaire, relu par pdf.js : une ligne « à saisir » porte ces mots dans SA case, et les totaux qui en dépendent aussi
// (jamais 0, jamais le total qu'un zéro supposé donnerait) ; AH non dit, à côté de sa case ; la page 3 nomme en rouge les
// codes encore à dire. Drapeau baissé (`aSaisir` vide, `cadre` nul, valeurs sans `null`), le PDF est celui d'avant, à l'octet près.
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

interface Fragment { texte: string; x: number; y: number; largeur: number }

async function fragmentsDeLaPage(pdf: Uint8Array, numero: number): Promise<Fragment[]> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  const items = (await (await doc.getPage(numero)).getTextContent()).items
  return items.flatMap((i) => ('str' in i && i.str.trim() !== ''
    ? [{ texte: i.str.trim(), x: i.transform[4], y: i.transform[5], largeur: i.width }] : []))
}

describe('remplir2035 — l’annexe 2035-E et ce qui reste à saisir', () => {
  let sansAvertissement: Uint8Array
  let pageSansSaisie: Fragment[] = []
  let pageComplete: Fragment[] = []
  let pageVierge: Fragment[] = []
  let pageCadreADire: Fragment[] = []
  let pageCadreCoche: Fragment[] = []
  const complete = annexe2035EAvecSaisie(ENTREE_ANNEXE, SAISIE_COMPLETE)
  const incomplete = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, plusValues: null, moinsValues: null, loyersDeductibles: null })
  const cadreADire = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, monoEtablissement: null })
  const cadreCoche = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, monoEtablissement: true, effectif: 3 })
  const textes = (page: Fragment[]) => page.map((f) => f.texte)
  const remplirAnnexe = async (a: typeof complete) => fragmentsDeLaPage((await remplir2035(
    new Map([['BA', 1000]]), ENTETE, { valeurs: a.lignes, aSaisir: a.aSaisir, cadre: a.cadre, entete: ENTETE_ANNEXE }, 2025,
  )).pdf, 3)

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (chemin: string) => {
      const octets = readFileSync(`public${chemin}`)
      return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(INSTANT)
    try {
      const valeurs = new Map(complete.annexe.lignes)
      // Drapeau baissé : les lignes à l'euro du moteur, sans `null`, aucune ligne à saisir, aucun cadre.
      sansAvertissement = (await remplir2035(new Map([['BA', 1000]]), ENTETE, { valeurs, aSaisir: [], cadre: null, entete: ENTETE_ANNEXE }, 2025)).pdf
      pageComplete = await fragmentsDeLaPage(sansAvertissement, 3)
      pageVierge = await fragmentsDeLaPage((await remplir2035(
        new Map([['BA', 1000]]), ENTETE, { valeurs: new Map(), aSaisir: [], cadre: null, entete: ENTETE_ANNEXE }, 2025,
      )).pdf, 3)
      pageSansSaisie = await remplirAnnexe(incomplete)
      pageCadreADire = await remplirAnnexe(cadreADire)
      pageCadreCoche = await remplirAnnexe(cadreCoche)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('drapeau baissé : le PDF est celui d’avant, à l’octet près', () => {
    // Le haché relevé sur le code d'AVANT ce changement (mêmes lignes, même instant, dates figées) : toute dérive du dessin le fait rougir.
    expect(createHash('sha256').update(sansAvertissement).digest('hex')).toBe('2ccaa861bfd7671e9e469663fea5b7c2f09b83e62c7ed81c5424934939ccaf5b')
  })

  it('une ligne à saisir porte « à saisir » dans sa case, et les totaux qui en dépendent aussi : ni 0, ni un total supposé', () => {
    expect(incomplete.lignes.get('EN')).toBeNull()
    expect(incomplete.lignes.get('EI')).toBeNull()
    expect(incomplete.lignes.get('EW')).toBeNull()
    // Avec la saisie, EN et le total 1 s'impriment ; sans, aucun des deux, ni le total qu'un zéro supposé aurait donné.
    expect(textes(pageComplete)).toContain(formaterMontant(7777))
    expect(textes(pageComplete)).toContain(formaterMontant(complete.annexe.lignes.get('EI') ?? NaN))
    expect(textes(pageSansSaisie)).not.toContain(formaterMontant(7777))
    const totalSupposeAZero = annexe2035EAvecSaisie(ENTREE_ANNEXE, { ...SAISIE_COMPLETE, plusValues: 0 }).annexe.lignes.get('EI')
    expect(textes(pageSansSaisie)).not.toContain(formaterMontant(totalSupposeAZero ?? NaN))
    expect(textes(pageSansSaisie)).not.toContain(formaterMontant(complete.annexe.lignes.get('EI') ?? NaN))
    // Les lignes qu'aucune saisie n'alimente restent écrites.
    expect(textes(pageSansSaisie)).toContain(formaterMontant(complete.annexe.lignes.get('EF') ?? NaN))
    // Aucun zéro écrit : la page sans aucune ligne (même en-tête, le SIRET porte un 0) en compte autant.
    const zeros = (t: Fragment[]) => t.filter((x) => x.texte === '0').length
    expect(zeros(pageSansSaisie)).toBe(zeros(pageVierge))
    // « à saisir » dans les cases de EN, EM, EV et des quatre totaux (EI, EW, EX, JU) : sept, chacune à la hauteur de son
    // code imprimé (lu sur la page vierge), le mot fini au bord droit de la colonne des montants (566,3 − 4).
    const marques = pageSansSaisie.filter((f) => f.texte === 'à saisir')
    expect(marques).toHaveLength(7)
    const hauteur = (code: string) => pageVierge.find((f) => f.texte === code && f.x > 400 && f.x < 420)!.y
    for (const code of ['EN', 'EI', 'EM', 'EV', 'EW', 'EX', 'JU']) {
      const marque = marques.find((m) => Math.abs(m.y - hauteur(code)) < 1)
      expect(marque, code).toBeDefined()
      expect(marque!.x + marque!.largeur, code).toBeCloseTo(566.3 - 4, 0)
    }
    expect(textes(pageComplete)).not.toContain('à saisir')
  })

  it('la page de l’annexe nomme les lignes encore à saisir, et seulement elle', () => {
    expect(incomplete.aSaisir).toEqual(['EN', 'EM', 'EV'])
    const texte = textes(pageSansSaisie).join(' ').replace(/\s+/g, ' ')
    for (const ligne of mentionDeLAnnexe2035E(['EN', 'EM', 'EV'], false)) expect(texte).toContain(ligne)
    expect(texte).toContain('EN, EM, EV')
    expect(textes(pageComplete).join(' ')).not.toContain('ATTENTION')
  })

  it('le cadre non dit : « à saisir » à droite de la case AH, et AH nommé en tête', () => {
    expect(cadreADire.aSaisir).toEqual(['AH'])
    const marques = pageCadreADire.filter((f) => f.texte === 'à saisir')
    expect(marques).toHaveLength(1)
    expect(marques[0].x).toBeCloseTo(276.6 + 4, 0)
    expect(marques[0].y).toBeCloseTo(211.2, 0)
    const texte = textes(pageCadreADire).join(' ')
    expect(texte).toContain('lignes encore à saisir par le cabinet : AH.')
    expect(texte).not.toContain('Cadre des mono-établissements coché')
  })

  it('le cadre coché et complet : rien n’est marqué, la tête dit qu’il est à reporter à la main', () => {
    expect(cadreCoche.aSaisir).toEqual([])
    expect(textes(pageCadreCoche)).not.toContain('à saisir')
    const texte = textes(pageCadreCoche).join(' ')
    for (const ligne of mentionDeLAnnexe2035E([], true)) expect(texte).toContain(ligne)
    expect(texte).not.toContain('ATTENTION')
    // Le cadre ne s'imprime toujours pas : entre les ordonnées 120 et 215, rien de plus que ce que la page vierge y porte.
    const cadre = (p: Fragment[]) => p.filter((f) => f.y > 120 && f.y < 215).map((f) => f.texte)
    expect(cadre(pageCadreCoche)).toEqual(cadre(pageVierge))
  })

  it('les mentions : rien quand il ne reste rien, une ligne pour le cadre coché, des caractères que le PDF sait écrire', () => {
    expect(mentionDeLAnnexe2035E([], false)).toEqual([])
    expect(mentionDeLAnnexe2035E([], true)).toHaveLength(1)
    expect(mentionDeLAnnexe2035E(['EN'], true)).toHaveLength(3)
    for (const ligne of mentionDeLAnnexe2035E(['EN', 'AH'], true)) expect(texteCompatiblePdf(ligne)).toBe(ligne)
    expect(annexe2035EAvecSaisie(ENTREE_ANNEXE, SAISIE_2035E_VIDE).aSaisir).toEqual(['EN', 'EK', 'EM', 'ER', 'EU', 'EV', 'AH'])
  })
})
