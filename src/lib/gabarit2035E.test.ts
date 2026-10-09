import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { CODES_2035E } from './declaration2035E'
import { ancragesDesCases, ancragesDesCodes } from './gabarit2035'
import type { FiletVertical, FragmentTexte, PageFormulaire } from './gabarit2035'
import { decouperAdresse, planDeRemplissage2035E } from './gabarit2035E'
import type { EnteteAnnexe2035E } from './gabarit2035E'

const ENTETE: EnteteAnnexe2035E = { nom: 'Cabinet Test', siret: '12345678901234', adresse: '12 rue des Lilas\n75011 Paris', annee: 2025 }

describe('decouperAdresse — l’adresse se lit à sa forme', () => {
  it('range code postal et commune dans leurs cases quand la dernière ligne les porte', () => {
    expect(decouperAdresse('12 rue des Lilas\n75011 Paris')).toEqual({ voie: '12 rue des Lilas', codePostal: '75011', ville: 'Paris' })
    expect(decouperAdresse('Bâtiment A\r\n12 rue des Lilas\n97400 Saint-Denis'))
      .toEqual({ voie: 'Bâtiment A, 12 rue des Lilas', codePostal: '97400', ville: 'Saint-Denis' })
  })

  it('ramène les blancs multiples à une espace', () => {
    expect(decouperAdresse('  12  rue des Lilas \n 75011   Paris ')).toEqual({ voie: '12 rue des Lilas', codePostal: '75011', ville: 'Paris' })
  })

  it('laisse tout sur la ligne de l’adresse quand la forme n’y est pas', () => {
    // Une seule ligne, un code postal à quatre chiffres, une commune absente : rien n'est découpé au hasard.
    expect(decouperAdresse('12 rue des Lilas 75011 Paris')).toEqual({ voie: '12 rue des Lilas 75011 Paris', codePostal: null, ville: null })
    // Une adresse d'une seule ligne ne se découpe jamais, même quand elle commence par cinq chiffres : rien n'y dit où
    // finit la commune (« 75011 Paris 12 rue des Lilas » rangerait la voie dans la case de la ville).
    expect(decouperAdresse('75011 Paris')).toEqual({ voie: '75011 Paris', codePostal: null, ville: null })
    expect(decouperAdresse('75011 Paris 12 rue des Lilas')).toEqual({ voie: '75011 Paris 12 rue des Lilas', codePostal: null, ville: null })
    expect(decouperAdresse('12 rue des Lilas\n7501 Paris')).toEqual({ voie: '12 rue des Lilas, 7501 Paris', codePostal: null, ville: null })
    expect(decouperAdresse('12 rue des Lilas\n75011')).toEqual({ voie: '12 rue des Lilas, 75011', codePostal: null, ville: null })
  })

  it('ne rend rien d’une adresse absente ou blanche', () => {
    expect(decouperAdresse(null)).toBeNull()
    expect(decouperAdresse(' \n  ')).toBeNull()
  })
})

// LE FORMULAIRE OFFICIEL LIVRÉ DANS LE DÉPÔT, LU POUR DE BON : la page 3 de la liasse BNC 2026 (empreinte identique à
// celle que publie impots.gouv.fr, 2035-sd_5384.pdf). Ce que les données synthétiques ne verraient pas : une case qui
// n'a pas l'ancre attendue, un libellé d'en-tête qui a changé de mots.
async function lirePage(numero: number): Promise<PageFormulaire> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf')) }).promise
  const page = await doc.getPage(numero)
  const fragments: FragmentTexte[] = (await page.getTextContent()).items
    .filter((i) => 'str' in i)
    .map((i) => {
      const t = i as { str: string; transform: number[]; width: number; height: number }
      return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
    })
  const ops = await page.getOperatorList()
  const filets: FiletVertical[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue
    const boite = ops.argsArray[i][2] as number[] | undefined
    if (!boite) continue
    const [x0, y0, x1, y1] = boite
    if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
  }
  return { fragments, filets }
}

describe('sur la page 3 du formulaire officiel', () => {
  it('ancre chacune des dix-huit lignes de montant au bord droit de la colonne des montants, dans l’ordre imprimé', async () => {
    const ancrages = ancragesDesCodes([await lirePage(3)], new Set(CODES_2035E))
    expect(CODES_2035E.filter((code) => !ancrages.has(code))).toEqual([])
    for (const code of CODES_2035E) expect(ancrages.get(code)!.xDroite, code).toBeCloseTo(566.3, 0)
    // De haut en bas : chaque ligne sous la précédente.
    const hauteurs = CODES_2035E.map((code) => ancrages.get(code)!.y)
    for (let i = 1; i < hauteurs.length; i++) expect(hauteurs[i], CODES_2035E[i]).toBeLessThan(hauteurs[i - 1])
  })

  it('ne prend jamais la case des effectifs pour la ligne 25 de la 2035-A', async () => {
    // « BK » est imprimé sur les deux pages. Lu avec les codes de la 2035, la page 3 n'apporte rien que la page 1 n'ait déjà
    // ancré ; lu avec ceux de la 2035-E, il n'est pas reconnu du tout.
    const page1 = await lirePage(1)
    const page3 = await lirePage(3)
    expect(ancragesDesCases([page1, page3]).get('BK')?.page).toBe(1)
    expect(ancragesDesCodes([page3], new Set(CODES_2035E)).has('BK')).toBe(false)
  })

  it('remplit les montants sur la page 3, sans écrire une ligne à zéro, une valeur ajoutée négative avec son signe', async () => {
    const valeurs = new Map([['EF', 178_000], ['EG', 1_200], ['EH', 0], ['EI', 179_200], ['EX', -40_000], ['JU', 0]])
    const { inscriptions, codesSansAncrage } = planDeRemplissage2035E(await lirePage(3), 3, valeurs, { ...ENTETE, nom: null, siret: null, adresse: null })
    expect(codesSansAncrage).toEqual([])
    const montants = inscriptions.filter((i) => i.alignement === 'droite')
    expect(montants.map((i) => i.texte)).toEqual(['178 000', '1 200', '179 200', '-40 000'])
    for (const i of inscriptions) expect(i.page).toBe(3)
  })

  it('porte le SIRET dans sa grille de quatorze cases, le nom et l’adresse dans leurs zones', async () => {
    const page = await lirePage(3)
    const { inscriptions } = planDeRemplissage2035E(page, 3, new Map(), ENTETE)
    const chiffres = inscriptions.filter((i) => i.alignement === 'centre')
    expect(chiffres.map((i) => i.texte).join('')).toBe('12345678901234')
    // Grille de 20,7 points de pas, de 276,6 à 566,3 : le premier chiffre au centre de la première case.
    expect(chiffres[0].x).toBeCloseTo((276.6 + 297.3) / 2, 0)
    const texte = (t: string) => inscriptions.find((i) => i.texte === t)!
    // Chacun s'ouvre après le filet qui suit son libellé : 214,6 pour le nom, 131,8 pour l'adresse, 111,1 pour le code
    // postal, 255,9 pour la commune — jamais sur le libellé ni sur ses deux-points.
    expect(texte('Cabinet Test').x).toBeCloseTo(214.6 + 3, 0)
    expect(texte('12 rue des Lilas').x).toBeCloseTo(131.8 + 3, 0)
    expect(texte('75011').x).toBeCloseTo(111.1 + 3, 0)
    expect(texte('Paris').x).toBeCloseTo(255.9 + 3, 0)
  })

  it('complète l’année après le « 20 » imprimé de la ligne des renseignements', async () => {
    const { inscriptions } = planDeRemplissage2035E(await lirePage(3), 3, new Map(), { ...ENTETE, nom: null, siret: null, adresse: null })
    expect(inscriptions).toHaveLength(1)
    expect(inscriptions[0].texte).toBe('25')
    // « 20 » est imprimé à x = 194,9, large de 9 points.
    expect(inscriptions[0].x).toBeCloseTo(194.9 + 9 + 1, 0)
    expect(inscriptions[0].y).toBeCloseTo(663, 0)
  })

  it('n’écrit rien dans le cadre réservé aux mono-établissements', async () => {
    // Même avec toutes les lignes remplies, et même quand les valeurs reçues portent ce que le cadre recevrait (AJ, le
    // chiffre d'affaires de référence de `cadreMonoEtablissement`) : AJ, BO, BK, KA, LA, MA et la case AH restent vides —
    // leurs ordonnées (de 125 à 212) ne reçoivent aucune inscription —, et AJ n'est pas une ligne qu'on aurait dû placer.
    const valeurs = new Map([...CODES_2035E.map((code): [string, number] => [code, 1_000]), ['AJ', 179_200]])
    const { inscriptions, codesSansAncrage } = planDeRemplissage2035E(await lirePage(3), 3, valeurs, ENTETE)
    expect(inscriptions.filter((i) => i.y > 120 && i.y < 215)).toEqual([])
    expect(codesSansAncrage).toEqual([])
    expect(inscriptions.filter((i) => i.alignement === 'droite')).toHaveLength(CODES_2035E.length)
  })
})

describe('planDeRemplissage2035E sur une page sans ancre', () => {
  it('remonte les lignes sans ancre au lieu de les dessiner au jugé', () => {
    const vide: PageFormulaire = { fragments: [], filets: [] }
    const { inscriptions, codesSansAncrage } = planDeRemplissage2035E(vide, 3, new Map([['EF', 160_000], ['JU', 128_000]]), ENTETE)
    expect(inscriptions).toEqual([])
    expect(codesSansAncrage).toEqual(['EF', 'JU'])
  })
})
