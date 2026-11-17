import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createHash } from 'node:crypto'
import { mentionDuPdf } from './modeles2035'
import { SAISIE_2035E_VIDE, annexe2035EAvecSaisie, mentionDeLAnnexe2035E } from './saisies2035E'
import { formaterMontant, texteCompatiblePdf } from './gabarit2035'
import { geometrieDuCadre7 } from './gabaritCadre7'
import type { GeometrieDuCadre7 } from './gabaritCadre7'
import { cadre7DeLExercice } from './cadre7'
import { indemniteKilometriqueCentimes, vehiculeDuDossier } from './baremeKilometrique'
import type { VehiculeDossier } from './types'

// REMPLIR2035 SUR LE VRAI FORMULAIRE (2035S-Q5, (B), 02/11/2026). Le pdf.js du navigateur touche au DOM dès l'import : il est
// remplacé ici par sa version « legacy », celle que gabarit2035.test.ts lit déjà, et le fichier est servi depuis public/.
vi.mock('pdfjs-dist', async () => await import('pdfjs-dist/legacy/build/pdf.mjs'))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', async () => {
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  return { default: pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href }
})

const { lirePage, remplir2035 } = await import('./remplir2035')

const ENTETE = { nom: 'DUPONT', prenom: 'Jean', siret: '12345678900011' } as unknown as Parameters<typeof remplir2035>[1]

async function texteDeLaPage(pdf: Uint8Array, numero: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(0) }).promise
  return (await (await doc.getPage(numero)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
}

async function remplir(annee: number) {
  return remplir2035(new Map([['BA', 1000]]), ENTETE, null, annee, null)
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
    new Map([['BA', 1000]]), ENTETE, { valeurs: a.lignes, aSaisir: a.aSaisir, cadre: a.cadre, entete: ENTETE_ANNEXE }, 2025, null,
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
      sansAvertissement = (await remplir2035(new Map([['BA', 1000]]), ENTETE, { valeurs, aSaisir: [], cadre: null, entete: ENTETE_ANNEXE }, 2025, null)).pdf
      pageComplete = await fragmentsDeLaPage(sansAvertissement, 3)
      pageVierge = await fragmentsDeLaPage((await remplir2035(
        new Map([['BA', 1000]]), ENTETE, { valeurs: new Map(), aSaisir: [], cadre: null, entete: ENTETE_ANNEXE }, 2025, null,
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
    // Relevé de nouveau le 17/11/2026 : la page 2 porte désormais le nom et le SIRET du déclarant (2ccaa861… avant) ; les
    // pages 1 et 3 sont restées identiques (relues par pdftotext -bbox, et par le dernier bloc de ce fichier pour la page 1).
    expect(createHash('sha256').update(sansAvertissement).digest('hex')).toBe('5691320782bb8d2bd2deb369e949b0469fa661f17d00eedf9c05f59dfda131c8')
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

  it('le cadre coché et complet (48S-Q3 (A)) : la croix, AJ, BK et l’année civile imprimés, la tête demande de corriger la période', () => {
    expect(cadreCoche.aSaisir).toEqual([])
    expect(textes(pageCadreCoche)).not.toContain('à saisir')
    const texte = textes(pageCadreCoche).join(' ')
    for (const ligne of mentionDeLAnnexe2035E([], true)) expect(texte).toContain(ligne)
    expect(texte).not.toContain('ATTENTION')
    // Entre les ordonnées 120 et 215, le cadre : ce que la page vierge y porte, plus ce qui y est imprimé, relu sur le PDF.
    const cadre = (p: Fragment[]) => p.filter((f) => f.y > 120 && f.y < 215)
    const vierge = cadre(pageVierge).map((f) => f.texte)
    const ajoute = cadre(pageCadreCoche).filter((f) => {
      const k = vierge.indexOf(f.texte)
      if (k < 0) return true
      vierge.splice(k, 1)
      return false
    })
    expect(vierge).toEqual([])
    const sur = (y: number) => ajoute.filter((f) => Math.abs(f.y - y) < 1).sort((a, b) => a.x - b.x).map((f) => f.texte)
    expect(sur(211.2)).toEqual(['X'])
    expect(sur(198.4)).toEqual([formaterMontant(cadreCoche.cadre.etat === 'coche' ? cadreCoche.cadre.chiffreDeReference : NaN)])
    expect(sur(165.4)).toEqual(['3'])
    expect(sur(138.5).join('')).toBe('0101202531122025')
    expect(sur(181.9)).toEqual([])
    expect(sur(125.7)).toEqual([])
    // La croix au centre de sa case (255,9 à 276,6), relue où pdf.js la place.
    const croix = ajoute.find((f) => f.texte === 'X')!
    expect(croix.x + croix.largeur / 2).toBeCloseTo((255.9 + 276.6) / 2, 0)
  })

  it('les mentions : rien quand il ne reste rien, deux lignes pour le cadre coché, des caractères que le PDF sait écrire', () => {
    expect(mentionDeLAnnexe2035E([], false)).toEqual([])
    expect(mentionDeLAnnexe2035E([], true)).toHaveLength(2)
    expect(mentionDeLAnnexe2035E([], true).join(' ')).toMatch(/année civile.*cessée en cours d'année : corriger KA ou LA.*\(MA\)/)
    expect(mentionDeLAnnexe2035E(['EN'], true)).toHaveLength(4)
    for (const ligne of mentionDeLAnnexe2035E(['EN', 'AH'], true)) expect(texteCompatiblePdf(ligne)).toBe(ligne)
    expect(annexe2035EAvecSaisie(ENTREE_ANNEXE, SAISIE_2035E_VIDE).aSaisir).toEqual(['EN', 'EK', 'EM', 'ER', 'EU', 'EV', 'AH'])
  })
})

// LA PAGE 2 (2035-B-SD) RELUE SUR LE PDF PRODUIT (signalé par le cabinet le 17/11/2026). Le nom et le SIRET n'y étaient pas :
// la boucle des en-têtes s'arrêtait à la page 1, et la grille du SIRET de la page 2, tracée de travers, ne se reconnaissait
// pas (gabarit2035.ts, `grilleDeSaisie`). Relus ici par pdf.js : le nom passé le filet de sa cellule, chaque chiffre dans
// SA case, et les lignes 34 à 47 — l'excédent, les deux totaux, la dotation, le bénéfice — à leur ligne. La page 1 reste
// celle d'avant : le nom 8 points après son libellé, les chiffres aux centres de sa grille régulière.
describe('remplir2035 — la page 2 porte le déclarant et les lignes 34 à 47', () => {
  const ENTETE_COMPLET = { nom: 'Cabinet Dupont-Lefèvre', activite: 'Infirmier libéral', siret: '12345678900011' }
  // Ce que `arrondirPourFormulaire` rend pour 80 000 € de recettes, 10 000 d'achats, 9 000 de cotisations et 3 000 de dotation.
  const CASES = new Map([
    ['AA', 80000], ['AD', 80000], ['AG', 80000], ['BA', 10000], ['BK', 9000], ['BR', 19000],
    ['CA', 61000], ['CE', 61000], ['CH', 3000], ['CN', 3000], ['CP', 58000], ['DD', 67000],
  ])
  let page1: Fragment[] = []
  let page2: Fragment[] = []
  let vierge2: Fragment[] = []
  let sansAncrage: string[] = ['non lu']

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (chemin: string) => {
      const octets = readFileSync(`public${chemin}`)
      return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
    })
    try {
      const r = await remplir2035(CASES, ENTETE_COMPLET, null, 2025, null)
      sansAncrage = r.codesSansAncrage
      page1 = await fragmentsDeLaPage(r.pdf, 1)
      page2 = await fragmentsDeLaPage(r.pdf, 2)
      vierge2 = await fragmentsDeLaPage(new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf')), 2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // Ce que l'application a ajouté à une page : ses fragments moins ceux du formulaire vierge.
  const ajoutes = (page: Fragment[], vierge: Fragment[]) => {
    const reste = vierge.map((f) => `${f.texte}@${Math.round(f.x)},${Math.round(f.y)}`)
    return page.filter((f) => {
      const k = reste.indexOf(`${f.texte}@${Math.round(f.x)},${Math.round(f.y)}`)
      if (k < 0) return true
      reste.splice(k, 1)
      return false
    })
  }

  it('toutes les cases ont trouvé leur place', () => {
    expect(sansAncrage).toEqual([])
  })

  it('porte la dénomination dans la zone qui suit son libellé, passé le filet (x ≈ 236)', () => {
    const nom = page2.find((f) => f.texte.startsWith('Cabinet'))
    expect(nom).toBeDefined()
    expect(nom!.y).toBeCloseTo(735.9, 0)
    expect(nom!.x).toBeGreaterThan(236 + 5)
  })

  it('porte le SIRET chiffre par chiffre, chacun dans sa case de la grille irrégulière', () => {
    const cases = [70.3, 91.2, 112.2, 133.2, 151.2, 176, 218.5, 236, 257, 278, 286.2, 307.2, 333.4, 354.4, 375.3]
    const chiffres = ajoutes(page2, vierge2).filter((f) => Math.abs(f.y - 723.2) < 1).sort((a, b) => a.x - b.x)
    expect(chiffres.map((f) => f.texte).join('')).toBe('12345678900011')
    chiffres.forEach((f, i) => {
      // Le glyphe entier entre les deux filets de sa case, et centré sur elle.
      expect(f.x, `chiffre ${i + 1}`).toBeGreaterThan(cases[i])
      expect(f.x + f.largeur, `chiffre ${i + 1}`).toBeLessThan(cases[i + 1])
      expect(f.x + f.largeur / 2, `chiffre ${i + 1}`).toBeCloseTo((cases[i] + cases[i + 1]) / 2, 0)
    })
  })

  it('porte l’excédent, les totaux, la dotation et le bénéfice à la hauteur de leur code', () => {
    const hauteur = (code: string) => vierge2.find((f) => f.texte === code && f.x > 470 && f.x < 500)!.y
    const montant = (code: string) => page2.find((f) => Math.abs(f.y - hauteur(code)) < 1 && f.x > 500)?.texte
    expect(montant('CA')).toBe(formaterMontant(61000))
    expect(montant('CE')).toBe(formaterMontant(61000))
    expect(montant('CH')).toBe(formaterMontant(3000))
    expect(montant('CN')).toBe(formaterMontant(3000))
    expect(montant('CP')).toBe(formaterMontant(58000))
    expect(montant('CR')).toBeUndefined()
  })

  it('la page 1 est celle d’avant : le nom 8 points après son libellé, les chiffres aux centres de sa grille', () => {
    const nom = page1.find((f) => f.texte.startsWith('Cabinet'))!
    expect(nom.x).toBeCloseTo(50 + 157.8 + 8, 0)
    expect(nom.y).toBeCloseTo(723.5, 0)
    const grille = [69.7, 89.5, 109.4, 129.2, 149.1, 168.9, 188.8, 209.6, 229.5, 249.2, 269, 288.9, 308.7, 328.5, 348.4]
    const chiffres = page1.filter((f) => Math.abs(f.y - 689.6) < 1 && /^\d$/.test(f.texte) && f.x > 69).sort((a, b) => a.x - b.x)
    expect(chiffres.map((f) => f.texte).join('')).toBe('12345678900011')
    chiffres.forEach((f, i) => expect(f.x + f.largeur / 2, `chiffre ${i + 1}`).toBeCloseTo((grille[i] + grille[i + 1]) / 2, 0))
    expect(page1.find((f) => f.texte === 'Infirmier libéral')!.x).toBeCloseTo(29.3 + 85.6 + 8, 0)
  })
})

// LE CADRE 7 DE LA 2035-B SUR LE PDF PRODUIT (signalement du cabinet du 17/11/2026 : « sur le B il n'y a pas Total A ou B de
// rempli »). Trois véhicules au barème pour deux lignes : les deux premiers dans leurs colonnes, le troisième dit ; le total A
// dans la case qui suit la lettre A, égal à BJ ; « à saisir » au total B, un bien du matériel de transport étant amorti.
describe('remplir2035 — le cadre 7 de la 2035-B', () => {
  const vehicule = (i: number, o: Partial<VehiculeDossier>): VehiculeDossier => ({
    id: `v${i}`, dossier_id: 'd1', annee: 2025, modele: null, type: 'voiture', puissance_fiscale: 5, bareme: 'bnc',
    motorisation: 'thermique', carburant: 'diesel', km_professionnel: 0, inscrit_immobilisations: false,
    amortissements_a_reintegrer: null, created_at: `2025-01-0${i + 1}T00:00:00Z`, updated_at: '2025-01-01T00:00:00Z', ...o,
  })
  const VEHICULES = [
    vehicule(0, { modele: 'Peugeot 308 SW', km_professionnel: 8000 }),
    vehicule(1, { type: 'moto', puissance_fiscale: 3, motorisation: 'electrique', carburant: null, bareme: 'bic', km_professionnel: 2500 }),
    vehicule(2, { modele: 'Kangoo', km_professionnel: 1200 }),
  ]
  const attendu = VEHICULES.reduce((s, v) => s + Number(indemniteKilometriqueCentimes(vehiculeDuDossier(v), 2025)), 0)
  const { cadre } = cadre7DeLExercice(VEHICULES, 2025, attendu, true)
  let page2: Fragment[] = []
  let sansBareme: Fragment[] = []
  let vierge2: Fragment[] = []
  let geometrie: GeometrieDuCadre7
  let sansLigne: string[] = []
  let repere = false

  beforeAll(async () => {
    vi.stubGlobal('fetch', async (chemin: string) => {
      const octets = readFileSync(`public${chemin}`)
      return { ok: true, status: 200, arrayBuffer: async () => octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) }
    })
    try {
      const cases = new Map([['AA', 60000], ['BJ', cadre!.totalA as number], ['BR', cadre!.totalA as number]])
      const r = await remplir2035(cases, { nom: 'Dupont', activite: null, siret: null }, null, 2025, cadre)
      sansLigne = r.vehiculesSansLigne
      repere = r.cadre7Repere
      page2 = await fragmentsDeLaPage(r.pdf, 2)
      sansBareme = await fragmentsDeLaPage((await remplir2035(cases, { nom: 'Dupont', activite: null, siret: null }, null, 2025, null)).pdf, 2)
      const vierge = new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf'))
      vierge2 = await fragmentsDeLaPage(vierge, 2)
      geometrie = geometrieDuCadre7(await lirePage(await pdfjs.getDocument({ data: vierge }).promise, 2))!
    } finally {
      vi.unstubAllGlobals()
    }
  })

  const ajoutes = (page: Fragment[]) => {
    const reste = vierge2.map((f) => `${f.texte}@${Math.round(f.x)},${Math.round(f.y)}`)
    return page.filter((f) => {
      const k = reste.indexOf(`${f.texte}@${Math.round(f.x)},${Math.round(f.y)}`)
      if (k < 0) return true
      reste.splice(k, 1)
      return false
    })
  }
  const dansLeCadre = (f: Fragment) => f.y > 100 && f.y < 210

  it('la valeur de chaque cellule, entière entre les filets de sa colonne et de sa ligne', () => {
    expect(repere).toBe(true)
    const attendus: [string, keyof GeometrieDuCadre7['colonnes'], number][] = [
      ['Peugeot 308 SW', 'modele', 0], ['T', 'type', 0], ['5 CV', 'puissance', 0], ['X', 'bnc', 0], ['Thermique', 'motorisation', 0],
      ['Diesel', 'carburant', 0], ['8 000', 'kilometres', 0], [formaterMontant(cadre!.lignes[0].indemnite as number), 'indemnites', 0],
      ['M', 'type', 1], ['3 CV', 'puissance', 1], ['X', 'bic', 1], ['Électrique', 'motorisation', 1], ['2 500', 'kilometres', 1],
      [formaterMontant(cadre!.lignes[1].indemnite as number), 'indemnites', 1],
    ]
    const ecrits = ajoutes(page2).filter((f) => dansLeCadre(f) && f.y > geometrie.lignes[1].bas)
    expect(ecrits).toHaveLength(attendus.length)
    for (const [texte, colonne, rang] of attendus) {
      const f = ecrits.find((e) => e.texte === texte && e.y > geometrie.lignes[rang].bas && e.y < geometrie.lignes[rang].haut)
      expect(f, `${texte} en ligne ${rang + 1}`).toBeDefined()
      expect(f!.x, texte).toBeGreaterThan(geometrie.colonnes[colonne].gauche + 1)
      expect(f!.x + f!.largeur, texte).toBeLessThan(geometrie.colonnes[colonne].droite - 1)
    }
  })

  it('le troisième véhicule n’a pas de ligne : rien ne se tasse, et il est rendu pour être dit', () => {
    expect(sansLigne).toEqual(['Kangoo'])
    expect(page2.some((f) => f.texte === 'Kangoo')).toBe(false)
  })

  it('le total A, égal à BJ et à la somme des trois indemnités, dans la case de la lettre A ; « à saisir » au total B', () => {
    const totalA = cadre!.totalA as number
    expect(totalA * 100).toBeGreaterThanOrEqual(attendu - 50)
    expect(totalA * 100).toBeLessThan(attendu + 50)
    const ecrits = ajoutes(page2).filter((f) => dansLeCadre(f) && f.y < geometrie.lignes[1].bas)
    const a = ecrits.find((f) => Math.abs(f.y - geometrie.totalA.y) < 1 && f.x > geometrie.totalA.gauche && f.x < geometrie.totalA.droite)!
    expect(a.texte).toBe(formaterMontant(totalA))
    expect(a.x + a.largeur).toBeLessThan(geometrie.totalA.droite)
    const b = ecrits.find((f) => Math.abs(f.y - geometrie.totalB.y) < 1 && f.x > geometrie.totalB.gauche)!
    expect(b.texte).toBe('à saisir')
    expect(b.x + b.largeur).toBeLessThan(geometrie.totalB.droite)
    // Et rien d'autre sous les lignes de véhicules : la ligne des frais réels reste vide.
    expect(ecrits).toHaveLength(2)
  })

  it('un dossier sans barème n’imprime rien dans le cadre', () => {
    expect(ajoutes(sansBareme).filter(dansLeCadre)).toEqual([])
  })
})
