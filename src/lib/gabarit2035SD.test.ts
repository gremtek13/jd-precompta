import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  A_SAISIR, celluleADroite, decouperLesLignes, geometrieDuTableau, grilleDuSiret, planDeRemplissage2035SD, PAS_DU_TABLEAU,
} from './gabarit2035SD'
import type { Inscription2035SD, PageQuadrillee } from './gabarit2035SD'
import type { Declaration2035SD, LigneDesImmobilisations } from './declaration2035SD'
import { MODELES_2035_SD } from './modeles2035SD'

// LE GABARIT DE LA DÉCLARATION 2035-SD, SUR LE VRAI FORMULAIRE (millésime 2026, cerfa 11176*28). Les cases se repèrent par
// leurs libellés et leurs filets : ce test dit, millésime par millésime, que chacune est retrouvée là où le formulaire la
// trace — relevé le 17/11/2026 sur le fichier de la DGFiP (2035-sd_5382.pdf).

async function lirePages(chemin: string): Promise<PageQuadrillee[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`public${chemin}`)) }).promise
  const pages: PageQuadrillee[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const fragments = (await page.getTextContent()).items
      .filter((i) => 'str' in i)
      .map((i) => {
        const t = i as { str: string; transform: number[]; width: number; height: number }
        return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
      })
    const ops = await page.getOperatorList()
    const filets: PageQuadrillee['filets'] = []
    const horizontaux: PageQuadrillee['horizontaux'] = []
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue
      const boite = ops.argsArray[i][2] as number[] | undefined
      if (!boite) continue
      const [x0, y0, x1, y1] = boite
      if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
      else if (y1 - y0 <= 2 && x1 - x0 > 4) horizontaux.push({ y: (y0 + y1) / 2, x0, x1 })
    }
    pages.push({ fragments, filets, horizontaux })
  }
  return pages
}

const ligne = (o: Partial<LigneDesImmobilisations>): LigneDesImmobilisations => ({
  id: 'b', nature: 'Ordinateur', miseEnService: '2025-03-01', prixTtc: 1500, tvaDeduite: 0, base: 1500, mode: 'L 33,33 %',
  anterieurs: 0, annee: 417, ...o,
})

const declaration = (o: Partial<Declaration2035SD> = {}, lignes: LigneDesImmobilisations[] = [ligne({})]): Declaration2035SD => {
  const total = lignes.reduce((s, l) => s + l.annee, 0)
  return {
    annee: 2025, benefice: 54321, deficit: 0,
    immobilisations: { lignes, totalGeneral: total, vehiculesSousLeBareme: 0, dotationNette: total, ch: total, concorde: true },
    ...o,
  }
}

const ENTETE = { nom: 'Dupont Jeanne', activite: 'Activités des infirmiers', siret: '12345678900011', adresse: '3 rue des Lilas\n75011 Paris', debutDeLaProfession: '2019-09-01' }

const dans = (i: Inscription2035SD | undefined, gauche: number, droite: number) =>
  !!i && (i.alignement === 'droite' ? i.x > gauche && i.x <= droite : i.x >= gauche && i.x < droite)

let pages: PageQuadrillee[] = []
beforeAll(async () => {
  pages = await lirePages(MODELES_2035_SD.get(2026)!.chemin)
})

describe('le formulaire 2035-SD 2026, relu', () => {
  it('a ses quatre pages, et ne porte aucun code de case : tout se repère par libellé', () => {
    expect(pages).toHaveLength(4)
    const codes = pages[0].fragments.filter((f) => /^(AA|CP|CR|CH)$/.test(f.texte.trim()))
    expect(codes).toEqual([])
  })

  it('la ligne 1 : « Bénéfice » et « Déficit » ont chacun leur case à droite, sur la même ligne', () => {
    const benefice = celluleADroite(pages[0], (t) => t === 'Bénéfice')
    const deficit = celluleADroite(pages[0], (t) => t === 'Déficit')
    expect(benefice).toMatchObject({ gauche: 337, droite: 399.1 })
    expect(deficit).toMatchObject({ gauche: 463.3, droite: 580.5 })
    expect(benefice!.y).toBe(deficit!.y)
  })

  it('le SIRET : une case en page 1, une grille de quatorze en pages 3 et 4 (d’un pas irrégulier sur la 4)', () => {
    expect(grilleDuSiret(pages[0])).toBeNull()
    expect(celluleADroite(pages[0], (t) => t === 'N° SIRET')).toMatchObject({ gauche: 89.9, droite: 305.1 })
    for (const p of [pages[2], pages[3]]) {
      const grille = grilleDuSiret(p)
      expect(grille?.centres).toHaveLength(14)
    }
    const pas = grilleDuSiret(pages[3])!.centres.slice(1).map((x, i) => x - grilleDuSiret(pages[3])!.centres[i])
    expect(Math.max(...pas) - Math.min(...pas)).toBeGreaterThan(5)
  })

  it('le tableau I : ses huit colonnes, son corps de vingt lignes, ses totaux, (A), (B) et la dotation nette', () => {
    const g = geometrieDuTableau(pages[2])!
    expect(g).not.toBeNull()
    expect(g.colonnes).toEqual({
      nature: { gauche: 27.8, droite: 103.8 }, date: { gauche: 103.8, droite: 160.8 }, prixTtc: { gauche: 160.8, droite: 217.7 },
      tvaDeduite: { gauche: 217.7, droite: 274.7 }, base: { gauche: 274.7, droite: 331.7 }, mode: { gauche: 331.7, droite: 388.7 },
      anterieurs: { gauche: 388.7, droite: 468.5 }, annee: { gauche: 468.5, droite: 546.2 },
    })
    expect(g.capacite).toBe(20)
    // La dernière ligne du corps reste au-dessus de la ligne « Fraction d'amortissement … société civile de moyens ».
    expect(g.premiereLigne - (g.capacite - 1) * PAS_DU_TABLEAU).toBeGreaterThan(359)
    expect(g.premiereLigne).toBeLessThan(563.6)
    for (const c of [g.a, g.b, g.nette]) expect(c).toMatchObject({ gauche: 468.5, droite: 546.2 })
    expect(g.total).toBeGreaterThan(g.report)
    expect(g.a.y).toBeGreaterThan(g.b.y)
    expect(g.b.y).toBeGreaterThan(g.nette.y)
  })

  it('ces repères ne valent que pour leur page : la page 4 n’a pas de tableau I', () => {
    expect(geometrieDuTableau(pages[3])).toBeNull()
  })
})

describe('planDeRemplissage2035SD', () => {
  it('écrit l’identité, la ligne 1 et le tableau, chaque valeur dans sa case, sans rien laisser sans ancre', () => {
    const plan = planDeRemplissage2035SD(pages, declaration(), ENTETE, [])
    expect(plan.libellesSansAncrage).toEqual([])
    expect(plan.etatsAnnexes).toBe(0)
    const sur = (page: number, texte: string) => plan.inscriptions.find((i) => i.page === page && i.texte === texte)
    expect(dans(sur(1, '54 321'), 337, 399.1)).toBe(true)
    expect(sur(1, 'Dupont Jeanne')).toBeDefined()
    // L'adresse sur une ligne ; le SIRET en clair dans sa case en page 1, chiffre par chiffre en pages 3 et 4.
    expect(sur(1, '3 rue des Lilas, 75011 Paris')).toBeDefined()
    expect(dans(sur(1, '12345678900011'), 89.9, 305.1)).toBe(true)
    for (const page of [3, 4]) expect(plan.inscriptions.filter((i) => i.page === page && /^\d$/.test(i.texte))).toHaveLength(14)
    expect(sur(3, 'Dupont Jeanne')).toBeDefined()
    expect(sur(4, 'Dupont Jeanne')).toBeDefined()
    expect(sur(1, 'Activités des infirmiers')?.largeurMax).toBeLessThan(230)
    // 2035SD-Q1 (A) : la date de début de la profession dans la case tracée à droite de son libellé (x ≈ 440,4 à 580,5),
    // entre les deux lignes de base du libellé (446,9 et 438,0).
    const debut = sur(1, '01/09/2019')!
    expect(dans(debut, 440.4, 580.5)).toBe(true)
    expect(debut.y).toBeCloseTo(442.45, 1)
    // Le tableau : la nature, la date, les montants et le mode dans leurs colonnes ; le total, (A) et la dotation nette.
    const g = geometrieDuTableau(pages[2])!
    expect(dans(sur(3, 'Ordinateur'), 27.8, 103.8)).toBe(true)
    expect(sur(3, '01/03/2025')).toBeDefined()
    expect(sur(3, 'L 33,33 %')).toBeDefined()
    const quatreCentDixSept = plan.inscriptions.filter((i) => i.page === 3 && i.texte === '417')
    // La ligne, le total du tableau, (A) et la dotation nette.
    expect(quatreCentDixSept.map((i) => i.y).sort((a, b) => b - a)).toEqual([g.premiereLigne, g.total, g.a.y, g.nette.y])
    expect(quatreCentDixSept.every((i) => dans(i, 468.5, 546.2))).toBe(true)
    // Rien de nul ne s'imprime : ni la TVA déduite, ni les antérieurs, ni (B), ni le déficit.
    expect(plan.inscriptions.some((i) => i.alignement === 'droite' && i.texte === '0')).toBe(false)
    expect(plan.aSaisir).toEqual([])
    // Les mentions de l'application : page 1 toujours, page 3 seulement avec des avis.
    expect(plan.mentionsDeBasDePage.get(1)?.length).toBe(2)
    expect(plan.mentionsDeBasDePage.has(3)).toBe(false)
  })

  it('« à saisir » en rouge dans la case qui l’attend, jamais 0 : colonnes 2 et 3 d’un redevable, (B) et la dotation nette', () => {
    const l = ligne({ prixTtc: 'a_saisir', tvaDeduite: 'a_saisir' })
    const d = declaration({}, [l])
    d.immobilisations = { ...d.immobilisations, vehiculesSousLeBareme: 'a_saisir', dotationNette: 'a_saisir' }
    const plan = planDeRemplissage2035SD(pages, d, ENTETE, ['avis du tableau'])
    expect(plan.aSaisir.every((i) => i.texte === A_SAISIR)).toBe(true)
    const g = geometrieDuTableau(pages[2])!
    expect(plan.aSaisir.filter((i) => dans(i, 160.8, 217.7))).toHaveLength(2)
    expect(plan.aSaisir.filter((i) => dans(i, 217.7, 274.7))).toHaveLength(2)
    expect(plan.aSaisir.filter((i) => i.y === g.b.y || i.y === g.nette.y)).toHaveLength(2)
    expect(plan.mentionsDeBasDePage.get(3)).toEqual(['avis du tableau'])
  })

  it('au-delà de vingt biens, un état annexe : la page 3 reporte son total, l’annexe porte le reste', () => {
    const lignes = Array.from({ length: 23 }, (_, k) => ligne({ id: `b${k}`, nature: `Bien ${k}`, annee: 10, base: 100, prixTtc: 100 }))
    const plan = planDeRemplissage2035SD(pages, declaration({}, lignes), ENTETE, [])
    expect(plan.etatsAnnexes).toBe(1)
    const g = geometrieDuTableau(pages[2])!
    expect(plan.inscriptions.filter((i) => i.page === 3 && /^Bien /.test(i.texte))).toHaveLength(20)
    expect(plan.inscriptions.filter((i) => i.page === 5 && /^Bien /.test(i.texte))).toHaveLength(3)
    const enColonne7 = (page: number, y: number) => plan.inscriptions.find((i) => i.page === page && i.y === y && dans(i, 468.5, 546.2))?.texte
    expect(enColonne7(3, g.total)).toBe('200')
    expect(enColonne7(3, g.report)).toBe('30')
    expect(enColonne7(3, g.a.y)).toBe('230')
    expect(enColonne7(5, g.total)).toBe('30')
    expect(enColonne7(5, g.report)).toBeUndefined()
    expect(enColonne7(5, g.a.y)).toBeUndefined()
    expect(plan.mentionsDeBasDePage.get(5)?.[0]).toMatch(/État annexe n° 1/)
    // L'état annexe dit son déclarant.
    expect(plan.inscriptions.filter((i) => i.page === 5 && /^\d$/.test(i.texte))).toHaveLength(14)
  })

  it('une page dont le tableau ne se retrouve pas : rien n’est dessiné au jugé, et c’est dit', () => {
    const sansTableau = [pages[0], pages[1], { fragments: [], filets: [], horizontaux: [] }, pages[3]]
    const plan = planDeRemplissage2035SD(sansTableau, declaration(), ENTETE, [])
    expect(plan.libellesSansAncrage).toContain('tableau I des immobilisations')
    expect(plan.inscriptions.some((i) => i.page === 3)).toBe(false)
  })

  it('sans SIRET lisible ni nom, rien ne s’écrit à leur place', () => {
    const plan = planDeRemplissage2035SD(pages, declaration(), { nom: null, activite: null, siret: '123', adresse: null, debutDeLaProfession: null }, [])
    // Sans début d'activité saisi, la case de la date reste vide.
    expect(plan.inscriptions.some((i) => i.page === 1 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.texte))).toBe(false)
    expect(plan.inscriptions.some((i) => /^\d$/.test(i.texte))).toBe(false)
    expect(plan.libellesSansAncrage).toEqual([])
  })
})

describe('decouperLesLignes', () => {
  it('rend une page vide pour un registre vide, et des morceaux de la capacité sinon', () => {
    expect(decouperLesLignes([], 20)).toEqual([[]])
    expect(decouperLesLignes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
