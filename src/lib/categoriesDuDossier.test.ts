import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORIES_DU_DOSSIER_PREVUES, COMPTE_ET_POSTE_FIGES, codeDUneCategorieDuDossier, compteDeCategorie, estEmployee,
  jugerLaCategorie, memeCompteQue, phraseDesEmplois, postesDeLaClasse, refusDeLaNatureDesRecettes, refusDuBareme,
  type EmploisDUneCategorie,
} from './categoriesDuDossier'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { Categorie } from './types'

const MIGRATION = join(__dirname, '../../supabase/schema/20261112134532_categories_du_dossier.sql')
const texteDeLaMigration = () => readFileSync(MIGRATION, 'utf8')

const categorie = (c: Partial<Categorie>): Categorie => ({
  id: 'k', dossier_id: 'd1', code: 'dossier_606400', libelle: 'Fournitures', ordre: 0, compte_comptable: '606400', poste_2035: 'Achats', ...c,
})
const RIEN: EmploisDUneCategorie = { pieces: 0, mouvements: 0, ventilations: 0, operationsDeCaisse: 0, regles: 0, reglesDesTiers: 0, natureDesRecettes: false }
const COMMUNES = [
  categorie({ id: 'c1', dossier_id: null, code: 'loyer', libelle: 'Loyer', compte_comptable: '613200', poste_2035: 'Loyers et charges locatives' }),
  categorie({ id: 'c2', dossier_id: null, code: 'carburant_deplacements', libelle: 'Carburant / déplacements', compte_comptable: '625100', poste_2035: 'Frais de déplacement' }),
]

describe('le compte d’une catégorie du dossier', () => {
  it('six chiffres, classe 6 ou 7, à des zéros près', () => {
    expect(compteDeCategorie('606400')).toEqual({ compte: '606400', classe: 6 })
    expect(compteDeCategorie(' 6064 ')).toEqual({ compte: '606400', classe: 6 })
    expect(compteDeCategorie('7060000')).toEqual({ compte: '706000', classe: 7 })
    expect(compteDeCategorie('601000')).toEqual({ compte: '601000', classe: 6 })
  })
  it('refuse un compte de bilan, un regroupement, plus de six chiffres significatifs, des lettres', () => {
    expect(compteDeCategorie('512000')).toHaveProperty('refus')
    expect(compteDeCategorie('610000')).toHaveProperty('refus')
    expect(compteDeCategorie('7')).toHaveProperty('refus')
    expect(compteDeCategorie('6064001')).toHaveProperty('refus')
    expect(compteDeCategorie('606A')).toHaveProperty('refus')
  })
})

describe('les postes de la 2035 d’une classe', () => {
  it('le sens de la classe, dans la liste fermée, sans ce que le moteur calcule', () => {
    expect(postesDeLaClasse(6)).toContain('Achats')
    expect(postesDeLaClasse(6)).not.toContain('Recettes')
    expect(postesDeLaClasse(7)).toContain('Recettes')
    expect(postesDeLaClasse(7)).not.toContain('Achats')
    expect(postesDeLaClasse(6)).not.toContain('Dotation aux amortissements')
  })
})

describe('jugerLaCategorie', () => {
  const contexte = { plan: PLAN_PAR_DEFAUT, categories: COMMUNES, modifiee: null }
  it('rend la catégorie telle qu’elle part', () => {
    expect(jugerLaCategorie({ libelle: ' Petit matériel ', compte: '6063', poste: 'Achats' }, contexte))
      .toEqual({ libelle: 'Petit matériel', compte: '606300', poste: 'Achats' })
  })
  it('redit le refus du barème aux mots de la base, à des zéros près', () => {
    expect(jugerLaCategorie({ libelle: 'Kilomètres', compte: '62511', poste: 'Frais de déplacement' }, contexte))
      .toEqual({ refus: refusDuBareme('625110', '625110') })
    expect(jugerLaCategorie({ libelle: 'Frais réels', compte: '625100', poste: 'Frais de déplacement' }, contexte)).not.toHaveProperty('refus')
  })
  it('refuse un poste vide, un poste de l’autre sens, un homonyme (casse et accents près)', () => {
    expect(jugerLaCategorie({ libelle: 'X', compte: '606400', poste: '' }, contexte)).toHaveProperty('refus')
    expect(jugerLaCategorie({ libelle: 'X', compte: '706000', poste: 'Achats' }, contexte)).toHaveProperty('refus')
    expect(jugerLaCategorie({ libelle: 'carburant / DEPLACEMENTS', compte: '606400', poste: 'Achats' }, contexte)).toHaveProperty('refus')
  })
  it('PC7-Q1 : employée, son compte et son poste restent ; son libellé change', () => {
    const lue = categorie({ id: 'k1' })
    const employee = { ...contexte, categories: [...COMMUNES, lue], modifiee: { categorie: lue, emplois: { ...RIEN, pieces: 2 } } }
    expect(jugerLaCategorie({ libelle: 'Fournitures', compte: '606300', poste: 'Achats' }, employee)).toEqual({ refus: COMPTE_ET_POSTE_FIGES })
    expect(jugerLaCategorie({ libelle: 'Fournitures', compte: '606400', poste: 'Fournitures de bureau' }, employee)).toEqual({ refus: COMPTE_ET_POSTE_FIGES })
    expect(jugerLaCategorie({ libelle: 'Papeterie', compte: '606400', poste: 'Achats' }, employee)).toEqual({ libelle: 'Papeterie', compte: '606400', poste: 'Achats' })
    const libre = { ...employee, modifiee: { categorie: lue, emplois: RIEN } }
    expect(jugerLaCategorie({ libelle: 'Fournitures', compte: '606300', poste: 'Achats' }, libre)).not.toHaveProperty('refus')
  })
})

describe('les emplois, le code, le même compte', () => {
  it('dit les emplois et la nature des recettes', () => {
    expect(phraseDesEmplois(RIEN)).toBe('Employée par rien.')
    expect(estEmployee(RIEN)).toBe(false)
    expect(phraseDesEmplois({ ...RIEN, pieces: 3, mouvements: 1 })).toBe('Employée par 3 pièces et 1 mouvement du relevé.')
    expect(estEmployee({ ...RIEN, natureDesRecettes: true })).toBe(true)
  })
  it('un code stable, jamais pris', () => {
    expect(codeDUneCategorieDuDossier('606400', new Set(['loyer']))).toBe('dossier_606400')
    expect(codeDUneCategorieDuDossier('606400', new Set(['dossier_606400', 'dossier_606400_2']))).toBe('dossier_606400_3')
  })
  it('une autre catégorie sur le même compte, à des zéros près', () => {
    expect(memeCompteQue('6251', COMMUNES, null)?.code).toBe('carburant_deplacements')
    expect(memeCompteQue('625100', COMMUNES, 'c2')).toBeNull()
  })
})

describe('la garde de la base, confrontée à son texte', () => {
  const sql = texteDeLaMigration()
  const message = (debut: string) => {
    const m = sql.match(new RegExp(`raise exception '(${debut}[^\\n]*?)'(?:,|\\s+using)`))
    expect(m, debut).not.toBeNull()
    return m![1].replace(/''/g, "'")
  }
  const remplir = (gabarit: string, ...valeurs: string[]) => valeurs.reduce((t, v) => t.replace('%', v), gabarit)
  it('le refus du barème est celui que l’écran redit', () => {
    expect(remplir(message('Le compte « % » est celui des indemnités'), '625110', '625120')).toBe(refusDuBareme('625110', '625120'))
  })
  it('le refus de la nature des recettes aussi', () => {
    expect(remplir(message('La catégorie « % » est la nature'), 'Honoraires')).toBe(refusDeLaNatureDesRecettes('Honoraires'))
  })
  it('compare à des zéros près, sous le verrou de la validation, et laisse la restauration insérer', () => {
    expect(sql).toContain("if rtrim(new.compte_comptable, '0') = rtrim(v_bareme, '0') then")
    expect(sql).toContain('perform pg_advisory_xact_lock_shared(public.cle_validation(new.dossier_id));')
    expect(sql).toContain("if tg_op = 'INSERT' and public.is_super_admin() then")
  })
  it('le drapeau est levé depuis la migration en production (12/11/2026)', () => {
    expect(CATEGORIES_DU_DOSSIER_PREVUES).toBe(true)
  })
})
