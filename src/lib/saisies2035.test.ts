import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { arrondirPourFormulaire, CASES_2035, casesDu2035, DONT_DE_CL, incoherencesDesCases, valeursDesCases } from './cases2035'
import type { Declaration2035, LigneDeclaration } from './declaration2035'
import { ancragesDesCodes } from './gabarit2035'
import type { PageFormulaire } from './gabarit2035'
import {
  AUCUNE_SAISIE_2035, CASES_SAISIES_2035, centimesDeLaSaisie, changementsDesSaisies, DONT_DE_CL_RENDUS_AU_REVENU_BRUT_SOCIAL,
  lireSaisie2035, motifDesSaisies2035, parametresDeLEnregistrement, refusDesSaisies, SAISIES_2035_EXPORTEES, saisiesDeLExercice,
} from './saisies2035'
import type { CodeSaisie2035, Saisie2035, ValeurSaisie } from './saisies2035'

// LES SAISIES DU CABINET DE LA 2035 (étapes 2035S3 à S5) : le moteur qui les reçoit, le module qui les juge, et la
// migration qu'il redit (supabase/schema/20261107172059_saisies_2035.sql, en production depuis le 07/11/2026 ; l'essai : supabase/essais/saisies2035.sql).

const MIGRATION = readFileSync('supabase/schema/20261107172059_saisies_2035.sql', 'utf8')

const ligne = (o: Partial<LigneDeclaration>): LigneDeclaration =>
  ({ poste: 'Achats', nature: 'depense', montant: 100, nbPieces: 1, nbMouvements: 0, nbEncaissements: 0, ...o })

const declaration = (o: Partial<Declaration2035>): Declaration2035 => ({
  annee: 2025, recettes: [], depenses: [], totalRecettes: 0, totalDepenses: 0, resultat: 0,
  exclusions: {
    sansPoste: [], sansDate: [], sansMontant: [], mouvementsSansPoste: [], mouvementsHorsResultat: [], exemplairesDeFacturesSources: [],
    ventesFactureesEcartees: [], fraisSansPoste: [], recettesDeCaisseSansPoste: [], recettesDeCaisseSansProduit: [],
  },
  sansPaiementConnu: [], indemnitesKilometriques: null, contributions: [], ventesFactureesEnExcedent: [], ...o,
})

// Un exercice de praticien : 80 000 € de recettes, 9 000 € de cotisations personnelles, 1 500 € d'indemnités journalières
// en gains divers (et donc en DB par leur poste), 20 000 € d'achats.
const PRATICIEN = declaration({
  recettes: [ligne({ poste: 'Recettes', nature: 'recette', montant: 80_000 }), ligne({ poste: 'Indemnités journalières', nature: 'recette', montant: 1_500 })],
  depenses: [ligne({ poste: 'Achats', montant: 20_000 }), ligne({ poste: 'Charges sociales personnelles', montant: 9_000 })],
})

const s = (code: CodeSaisie2035, centimes: number, noteAnnexe: string | null = null): Saisie2035 => ({ code, centimes, noteAnnexe })

// Les codes du tableau des cases d'avant les saisies, recopiés : drapeau baissé, le tableau est celui-là, à la case près.
const CODES_D_HIER = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'BA', 'BB', 'BC', 'BD', 'JY', 'BS', 'BV', 'BF', 'BW', 'BG', 'BH',
  'BJ', 'BT', 'BZ', 'BU', 'BK', 'BY', 'BM', 'BN', 'BP', 'BR', 'CA', 'CB', 'CC', 'CD', 'CE', 'CF', 'CG', 'BE', 'CH', 'CK', 'CL',
  'CM', 'CN', 'CP', 'CR', 'DE', 'DB', 'DC', 'DD']

describe('le drapeau baissé : la 2035 d’hier, strictement', () => {
  it('le drapeau est baissé, et le tableau des cases est celui d’hier, à la case et à l’ordre près', () => {
    expect(SAISIES_2035_EXPORTEES).toBe(false)
    expect(casesDu2035(false).map((c) => c.code)).toEqual(CODES_D_HIER)
    expect(CASES_2035.map((c) => c.code)).toEqual(CODES_D_HIER)
  })

  it('sans saisie, les valeurs et le formulaire arrondi n’ont que les cases d’hier, et leurs montants', () => {
    const { valeurs } = valeursDesCases(PRATICIEN, AUCUNE_SAISIE_2035)
    expect([...valeurs.keys()]).toEqual(CODES_D_HIER)
    expect(Object.fromEntries([...valeurs].filter(([, v]) => v !== 0))).toEqual({
      AA: 80_000, AD: 80_000, AF: 1_500, AG: 81_500, BA: 20_000, BK: 9_000, BR: 29_000, CA: 52_500, CE: 52_500, CP: 52_500,
      DB: 1_500, DD: 60_000,
    })
    expect([...arrondirPourFormulaire(valeurs, 2025).keys()].sort()).toEqual([...CODES_D_HIER].sort())
  })

  it('un « dont » de CL saisi drapeau baissé lève : aucune case de ce formulaire ne le porte', () => {
    expect(() => valeursDesCases(PRATICIEN, [s('CS', 100)])).toThrow(/CS/)
  })
})

describe('le moteur reçoit les saisies (renvois 17, 21, 24 à 26)', () => {
  it('CC entre à la ligne 38 et au bénéfice, CL à la ligne 45 et le retranche ; DD les suit', () => {
    const { valeurs } = valeursDesCases(PRATICIEN, [s('CC', 120_000), s('CL', 50_000)])
    expect(valeurs.get('CC')).toBe(1_200)
    expect(valeurs.get('CE')).toBe(53_700)
    expect(valeurs.get('CL')).toBe(500)
    expect(valeurs.get('CN')).toBe(500)
    expect(valeurs.get('CP')).toBe(53_200)
    // CE − CN + BK + BV + DE − DB : 53 700 − 500 + 9 000 − 1 500. CL hors de ses « dont » ne revient pas au revenu brut social.
    expect(valeurs.get('DD')).toBe(60_700)
  })

  it('DE s’ajoute au revenu brut social ; DB s’ajoute aux indemnités journalières de leur poste, et le retranche', () => {
    const { valeurs } = valeursDesCases(PRATICIEN, [s('DE', 30_000), s('DB', 20_000)])
    expect(valeurs.get('DE')).toBe(300)
    expect(valeurs.get('DB')).toBe(1_700)
    expect(valeurs.get('CP')).toBe(52_500)
    expect(valeurs.get('DD')).toBe(60_000 + 300 - 200)
  })

  it('DE ou DB avant les revenus 2025 lève : le formulaire de ces années n’a pas de cadre 8', () => {
    expect(() => valeursDesCases({ ...PRATICIEN, annee: 2024 }, [s('DE', 100)])).toThrow(/DE/)
  })

  it('deux saisies d’une même case lèvent, comme une case que le moteur remplit (BK) ou des centimes négatifs', () => {
    expect(() => valeursDesCases(PRATICIEN, [s('CC', 100), s('CC', 200)])).toThrow(/CC/)
    expect(() => valeursDesCases(PRATICIEN, [{ code: 'BK' as CodeSaisie2035, centimes: 100, noteAnnexe: null }])).toThrow(/BK/)
    expect(() => valeursDesCases(PRATICIEN, [s('CC', -1)])).toThrow(/CC/)
  })
})

describe('les douze « dont » de CL, le drapeau levé', () => {
  const cases = casesDu2035(true)

  it('entrent juste avant CL, comme toute case « dont », sans rien changer aux autres', () => {
    const codes = cases.map((c) => c.code)
    expect(codes.filter((c) => !DONT_DE_CL.some((d) => d.code === c))).toEqual(CODES_D_HIER)
    expect(codes.slice(codes.indexOf('CK') + 1, codes.indexOf('CL'))).toEqual(['CS', 'CT', 'AW', 'CO', 'CU', 'CQ', 'DF', 'DG', 'CI', 'CJ', 'AX', 'DH'])
    for (const d of DONT_DE_CL) expect(d).toMatchObject({ sousCaseDe: 'CL', saisieCabinet: true, cadre: 'resultat', ligne: '43' })
  })

  it('les huit que le renvoi (26) nomme reviennent au revenu brut social, pas DF, CT, CQ ni AX', () => {
    expect([...DONT_DE_CL_RENDUS_AU_REVENU_BRUT_SOCIAL].sort()).toEqual(['AW', 'CI', 'CJ', 'CO', 'CS', 'CU', 'DG', 'DH'])
  })

  it('le PDF les place toutes : chacune a son ancre sur la seconde page du modèle 2026, dans la colonne des « dont »', async () => {
    const donnees = new Uint8Array(readFileSync('public/formulaires/2035-sd-2026.pdf'))
    const doc = await pdfjs.getDocument({ data: donnees }).promise
    const pages: PageFormulaire[] = []
    for (let n = 1; n <= 2; n++) {
      const page = await doc.getPage(n)
      const fragments = (await page.getTextContent()).items.filter((i) => 'str' in i).map((i) => {
        const t = i as { str: string; transform: number[]; width: number; height: number }
        return { texte: t.str, x: t.transform[4], y: t.transform[5], largeur: t.width, hauteur: t.height }
      })
      const ops = await page.getOperatorList()
      const filets = []
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.constructPath) continue
        const boite = ops.argsArray[i][2] as number[] | undefined
        if (!boite) continue
        const [x0, y0, x1, y1] = boite
        if (x1 - x0 <= 2 && y1 - y0 > 4) filets.push({ x: (x0 + x1) / 2, y0, y1 })
      }
      pages.push({ fragments, filets })
    }
    const ancrages = ancragesDesCodes(pages, new Set(cases.map((c) => c.code)))
    const cl = ancrages.get('CL')!
    for (const d of DONT_DE_CL) {
      const a = ancrages.get(d.code)
      expect(a, d.code).toBeDefined()
      expect(a!.page, d.code).toBe(2)
      expect(a!.xDroite, d.code).toBeLessThan(cl.xDroite)
    }
  })
})

describe('le module, au plus près de la base', () => {
  it('la liste des codes est celle de la contrainte de la table, dans le même ordre', () => {
    const contrainte = /constraint saisies_2035_code check \(code in \(([^)]*)\)\)/.exec(MIGRATION)?.[1] ?? ''
    expect([...contrainte.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual(CASES_SAISIES_2035.map((c) => c.code))
    expect(MIGRATION).toContain("code in ('CC', 'CL') and centimes > 0 and char_length(note_annexe) between 1 and 2000")
    expect(MIGRATION).toContain("constraint saisies_2035_cadre_8_depuis_2025 check (code not in ('DE', 'DB') or annee >= 2025)")
    expect(MIGRATION).toContain('constraint saisies_2035_centimes check (centimes >= 0 and centimes <= 999999999999)')
    expect(CASES_SAISIES_2035.filter((c) => c.noteAnnexe).map((c) => c.code)).toEqual(['CC', 'CL'])
    for (const c of CASES_SAISIES_2035) expect(c.phrase.length, c.code).toBeGreaterThan(40)
  })

  it('une ligne lue n’est crue qu’entière : code connu, centimes entiers positifs ou nuls, note texte ou nulle', () => {
    expect(lireSaisie2035({ annee: 2025, code: 'CC', centimes: 120000, note_annexe: 'x' })).toEqual({ annee: 2025, code: 'CC', centimes: 120000, noteAnnexe: 'x' })
    expect(lireSaisie2035({ annee: 2025, code: 'CC', centimes: '120000', note_annexe: null })?.centimes).toBe(120000)
    for (const l of [{ annee: 2025, code: 'BK', centimes: 1, note_annexe: null }, { annee: 2025, code: 'CC', centimes: 1.5, note_annexe: null },
      { annee: 2025, code: 'CC', centimes: -1, note_annexe: null }, { annee: 2025, code: 'CC', centimes: 1, note_annexe: 3 },
      { annee: '2025', code: 'CC', centimes: 1, note_annexe: null }, null]) expect(lireSaisie2035(l)).toBeNull()
  })

  it('un montant tapé se lit au centime exact, vide vaut zéro ; trois décimales, un signe ou une lettre se refusent', () => {
    expect(centimesDeLaSaisie('1 200,50')).toBe(120050)
    expect(centimesDeLaSaisie('0,1')).toBe(10)
    expect(centimesDeLaSaisie('600')).toBe(60000)
    expect(centimesDeLaSaisie('')).toBe(0)
    for (const t of ['12,345', '-5', '12a', '1.200,00']) expect(centimesDeLaSaisie(t), t).toBeNull()
  })

  it('les changements ne nomment que ce qui diffère de la valeur lue, et partent avec elle', () => {
    const lues = [s('CC', 120000, 'Loyer'), s('CL', 50000)]
    const saisies = new Map<CodeSaisie2035, ValeurSaisie>([['CC', { centimes: 120000, noteAnnexe: 'Loyer' }],
      ['CL', { centimes: 0, noteAnnexe: null }], ['DE', { centimes: 30000, noteAnnexe: null }], ['DB', { centimes: 0, noteAnnexe: null }]])
    const changements = changementsDesSaisies(lues, saisies)
    expect(changements.map((c) => c.code)).toEqual(['CL', 'DE'])
    expect(parametresDeLEnregistrement('d1', 2025, changements)).toEqual({
      p_dossier_id: 'd1', p_annee: 2025,
      p_lues: { CL: { centimes: 50000, note_annexe: null }, DE: { centimes: 0, note_annexe: null } },
      p_saisies: { CL: { centimes: 0, note_annexe: null }, DE: { centimes: 30000, note_annexe: null } },
    })
  })

  it('les refus de la base se disent avant le clic, sur la saisie telle qu’elle part', () => {
    const ch = (code: CodeSaisie2035, apres: ValeurSaisie) => [{ code, avant: { centimes: 0, noteAnnexe: null }, apres }]
    expect(refusDesSaisies(2025, true, [])).toMatch(/validé/)
    expect(refusDesSaisies(2024, false, ch('DE', { centimes: 1, noteAnnexe: null }))).toMatch(/2025/)
    expect(refusDesSaisies(2025, false, ch('DE', { centimes: 1, noteAnnexe: 'x' }))).toMatch(/CC et CL/)
    expect(refusDesSaisies(2025, false, ch('CC', { centimes: 0, noteAnnexe: 'x' }))).toMatch(/vidée/)
    expect(refusDesSaisies(2025, false, ch('CC', { centimes: 1, noteAnnexe: ' x' }))).toMatch(/espace/)
    expect(refusDesSaisies(2025, false, ch('CC', { centimes: 1, noteAnnexe: 'x'.repeat(2001) }))).toMatch(/2000/)
    expect(refusDesSaisies(2025, false, ch('CC', { centimes: 1, noteAnnexe: 'Loyer' }))).toBeNull()
  })

  it('la lecture : absentes, la 2035 d’hier ; incomplètes, aucun calcul et un motif ; lues, celles de l’exercice', () => {
    expect(saisiesDeLExercice({ dossierId: 'd', etat: 'absentes' }, 2025)).toBe(AUCUNE_SAISIE_2035)
    expect(motifDesSaisies2035({ dossierId: 'd', etat: 'absentes' })).toBeNull()
    expect(saisiesDeLExercice(null, 2025)).toBeNull()
    expect(motifDesSaisies2035(null)).toMatch(/pas encore lues/)
    expect(saisiesDeLExercice({ dossierId: 'd', etat: 'incompletes', motif: 'coupée' }, 2025)).toBeNull()
    expect(motifDesSaisies2035({ dossierId: 'd', etat: 'incompletes', motif: 'coupée' })).toMatch(/coupée/)
    expect(saisiesDeLExercice({ dossierId: 'd', etat: 'lues', saisies: [{ ...s('CC', 1), annee: 2025 }, { ...s('CC', 2), annee: 2026 }] }, 2025))
      .toEqual([s('CC', 1)])
  })

  it('un « dont » de CL plus fort que CL se dit incohérent, comme toute case « dont » (la validation le retient)', () => {
    // Le calcul de l'incohérence parcourt le tableau des cases : drapeau baissé, les « dont » de CL n'y sont pas.
    const valeurs = new Map([['CL', 100], ['CS', 150]])
    expect(incoherencesDesCases(valeurs).map((i) => i.porteuse.code)).toEqual(SAISIES_2035_EXPORTEES ? ['CL'] : [])
  })
})
