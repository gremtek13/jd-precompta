import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORIES_DU_DOSSIER_PREVUES, CLASSES_DES_CATEGORIES_COMMUNES_PREVUES, CLASSES_DES_CATEGORIES_PREVUES, COMPTE_ET_POSTE_FIGES,
  codeDUneCategorieDuDossier, compteDeCategorie, estEmployee, estUnCompteDeChargeOuDeProduit, jugerLaCategorie, memeCompteQue,
  phraseDesEmplois, postesDeLaClasse, refusDeLaClasse, refusDeLaClasseCommune, refusDeLaNatureDesRecettes, refusDuBareme,
  refusDuCompteDUneCategorie,
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

// ── PC7-Q2 : LA CLASSE DU COMPTE, EN BASE (la migration PRÉPARÉE `classes_des_categories`) ─────────────────────────────────
// Elle remplace le corps de la garde de PC7 (`categories_du_dossier`) par le même, plus le refus (e). Chaque migration se lit
// dans l'export sous la version que la production lui a donnée, sinon dans supabase/preparees/.
const EXPORT = join(__dirname, '../../supabase/schema')
const PREPAREES = join(__dirname, '../../supabase/preparees')
const versionExportee = (nom: string) => readdirSync(EXPORT).find((f) => new RegExp(`^\\d{14}_${nom}\\.sql$`).test(f))
const texteDe = (nom: string) => {
  const exportee = versionExportee(nom)
  const preparee = readdirSync(PREPAREES).find((f) => new RegExp(`^\\d{14}_${nom}\\.sql$`).test(f))
  expect(exportee ?? preparee, nom).toBeDefined()
  return readFileSync(exportee ? join(EXPORT, exportee) : join(PREPAREES, preparee!), 'utf8')
}
const RETOUR_DE_LA_CLASSE = join(PREPAREES, 'retour/20261112234100_retour_classes_des_categories.sql')
/** Le corps de la garde entre ses dollars : ce que `prosrc` garde, et que l'empreinte de la garde de tête lit. */
const corpsDeLaGarde = (sql: string) => {
  const m = sql.match(/as \$fonction\$([\s\S]*?)\$fonction\$;/)
  expect(m).not.toBeNull()
  return m![1]
}
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const lignesDeCode = (corps: string) => corps.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'))

describe('PC7-Q2 : la classe du compte d’une catégorie du dossier, en base', () => {
  const sql = texteDe('classes_des_categories')
  const retour = readFileSync(RETOUR_DE_LA_CLASSE, 'utf8')
  const corps = corpsDeLaGarde(sql)
  const corpsDHier = corpsDeLaGarde(texteDe('categories_du_dossier'))

  it('le refus (e) est celui que l’écran redit, sous son code', () => {
    const m = corps.match(/raise exception '(Le compte « % » n''est pas un compte de charge[^\n]*?)', new\.compte_comptable\n\s+using errcode = '23514';/)
    expect(m).not.toBeNull()
    expect(m![1].replace(/''/g, "'").replace('%', '401000')).toBe(refusDeLaClasse('401000'))
  })

  it('le prédicat est celui des fonctions du relevé, en base comme dans le module', () => {
    expect(corps).toContain("and new.compte_comptable !~ '^[67][0-9]{2}' then")
    for (const compte of ['606400', '706000', '699', '7060000', '6064ab']) expect(estUnCompteDeChargeOuDeProduit(compte), compte).toBe(true)
    for (const compte of ['401000', '512000', '108000', '471000', '6A1000', '60', '7', '', ' 606400']) {
      expect(estUnCompteDeChargeOuDeProduit(compte), compte).toBe(false)
    }
  })

  it('(e) vient après (a) et le retour des communes, avant la porte de la restauration, (b) et (c) ; un compte qui ne change pas ne se rejuge pas', () => {
    const rang = (repere: string) => {
      const i = corps.indexOf(repere)
      expect(i, repere).toBeGreaterThan(-1)
      return i
    }
    const reperes = ['-- a. Une catégorie ne change pas de dossier.', 'if new.dossier_id is null then\n    return new;', '-- e. Le compte',
      "if tg_op = 'INSERT' and public.is_super_admin() then", '-- b. Le code', '-- c. Le compte du barème'].map(rang)
    expect(reperes).toEqual([...reperes].sort((x, y) => x - y))
    const e = corps.slice(rang('-- e. Le compte'), rang('-- La restauration'))
    expect(e).toContain("if new.compte_comptable is not null\n     and (tg_op = 'INSERT' or new.compte_comptable is distinct from old.compte_comptable)")
  })

  it('les refus d’hier gardent leurs mots et leur ordre : le corps d’hier, plus les six lignes de (e)', () => {
    const hier = lignesDeCode(corpsDHier)
    const neuf = lignesDeCode(corps)
    let k = 0
    for (const ligne of neuf) if (k < hier.length && ligne === hier[k]) k++
    expect(k).toBe(hier.length)
    expect(neuf.length - hier.length).toBe(6)
  })

  it('la garde de tête : le corps d’hier à son empreinte, son déclencheur, aucune catégorie du dossier hors des classes 6 et 7', () => {
    expect(md5(corpsDHier)).toBe('0e1ee2d3f53ba1dca8adecd31843edeb')
    expect(sql).toContain(`if v_empreinte is distinct from '${md5(corpsDHier)}' then`)
    expect(sql).toContain("t.tgname = 'categories_du_dossier'")
    expect(sql).toContain("where c.dossier_id is not null and c.compte_comptable is not null and c.compte_comptable !~ '^[67][0-9]{2}';")
    expect(sql.indexOf('do $garde$')).toBeLessThan(sql.search(/create\s+or\s+replace\s+function\s+public\.garder_categorie_du_dossier\(\)/i))
    expect(sql).toContain("security definer\nset search_path = ''\nas $fonction$")
    expect(sql).toContain('revoke all on function public.garder_categorie_du_dossier() from public, anon, authenticated;')
  })

  it('le retour rend le corps d’hier à l’octet près, sous la garde du corps posé', () => {
    expect(corpsDeLaGarde(retour)).toBe(corpsDHier)
    expect(retour).toContain(`if v_empreinte is distinct from '${md5(corps)}' then`)
    expect(retour.indexOf('do $garde$')).toBeLessThan(retour.search(/create\s+or\s+replace\s+function\s+public\.garder_categorie_du_dossier\(\)/i))
  })

  it('les deux passent par l’outil : ni barre oblique inverse, ni mot de suppression hors de tg_op', () => {
    for (const texte of [sql, retour]) {
      expect(texte).not.toContain('\\')
      expect(texte.replace(/tg_op = 'DELETE'/g, '')).not.toMatch(/\b(delete|drop|truncate)\b/i)
    }
  })

  it('le module dit le refus de la base pour une catégorie du dossier, rien pour une commune ni pour une charge', () => {
    // PC7-Q2 en base, PC7Q2-Q1 pas encore.
    const pc7q2 = { duDossier: true, communes: false }
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '401000', pc7q2)).toBe(refusDeLaClasse('401000'))
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '6A1000', pc7q2)).toBe(refusDeLaClasse('6A1000'))
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '606400', pc7q2)).toBeNull()
    expect(refusDuCompteDUneCategorie({ dossier_id: null }, '401000', pc7q2)).toBeNull()
    // Sans aucune garde en base, rien ne se dit : l'écran écrit comme hier.
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '401000', { duDossier: false, communes: false })).toBeNull()
  })

  it('l’écran des catégories du dossier dit la classe aux mots de la base, et l’essai attend les mêmes', () => {
    expect(compteDeCategorie('512000')).toEqual({ refus: refusDeLaClasse('512000') })
    expect(jugerLaCategorie({ libelle: 'Tiers', compte: '401000', poste: 'Achats' }, { plan: PLAN_PAR_DEFAUT, categories: COMMUNES, modifiee: null }))
      .toEqual({ refus: refusDeLaClasse('401000') })
    const essai = readFileSync(join(__dirname, '../../supabase/essais/categoriesDuDossier.sql'), 'utf8')
    expect(essai).toContain(refusDeLaClasse('401000').replace(/'/g, "''"))
  })

  it('le drapeau suit la migration : baissé tant qu’elle n’est que préparée, levé quand elle entre dans l’export', () => {
    expect(CLASSES_DES_CATEGORIES_PREVUES).toBe(versionExportee('classes_des_categories') !== undefined)
  })
})

// ── PC7Q2-Q1 : LA CLASSE DU COMPTE D'UNE COMMUNE, EN BASE (la migration PRÉPARÉE `classes_des_categories_communes`) ─────────
// Elle remplace le corps de PC7-Q2 (`classes_des_categories`) par le même, plus le refus (f), et s'applique APRÈS lui.
const RETOUR_DES_COMMUNES = join(PREPAREES, 'retour/20261113110100_retour_classes_des_categories_communes.sql')
const versionDe = (nom: string) => {
  const fichier = versionExportee(nom) ?? readdirSync(PREPAREES).find((f) => new RegExp(`^\\d{14}_${nom}\\.sql$`).test(f))
  expect(fichier, nom).toBeDefined()
  return fichier!.slice(0, 14)
}

describe('PC7Q2-Q1 : la classe du compte d’une catégorie commune, en base', () => {
  const sql = texteDe('classes_des_categories_communes')
  const retour = readFileSync(RETOUR_DES_COMMUNES, 'utf8')
  const corps = corpsDeLaGarde(sql)
  const corpsDeLaClasse = corpsDeLaGarde(texteDe('classes_des_categories'))
  const COMMUNES = 'if new.dossier_id is null then\n    return new;'

  it('le refus (f) est celui que l’écran redit, sous son code, et se distingue de (e)', () => {
    const m = corps.match(/raise exception '(Le compte « % » n''est pas un compte de charge[^\n]*?une catégorie commune[^\n]*?)', new\.compte_comptable\n\s+using errcode = '23514';/)
    expect(m).not.toBeNull()
    expect(m![1].replace(/''/g, "'").replace('%', '401000')).toBe(refusDeLaClasseCommune('401000'))
    expect(refusDeLaClasseCommune('401000')).not.toBe(refusDeLaClasse('401000'))
  })

  it('(f) ne juge qu’une commune, sous le prédicat de (e), à l’insertion ou quand son compte change, un compte nul passant', () => {
    const f = corps.slice(corps.indexOf('-- f. Le compte'), corps.indexOf(COMMUNES))
    expect(f).toContain("if new.dossier_id is null\n     and new.compte_comptable is not null\n"
      + "     and (tg_op = 'INSERT' or new.compte_comptable is distinct from old.compte_comptable)\n"
      + "     and new.compte_comptable !~ '^[67][0-9]{2}' then")
  })

  it('(f) vient après (a) et avant le retour des communes ; (e), la porte de la restauration, (b) et (c) gardent leur ordre', () => {
    const rang = (repere: string) => {
      const i = corps.indexOf(repere)
      expect(i, repere).toBeGreaterThan(-1)
      return i
    }
    const reperes = ['-- a. Une catégorie ne change pas de dossier.', '-- f. Le compte', COMMUNES, '-- e. Le compte',
      "if tg_op = 'INSERT' and public.is_super_admin() then", '-- b. Le code', '-- c. Le compte du barème'].map(rang)
    expect(reperes).toEqual([...reperes].sort((x, y) => x - y))
  })

  it('les refus d’hier gardent leurs mots et leur ordre : le corps de PC7-Q2, plus les sept lignes de (f)', () => {
    const hier = lignesDeCode(corpsDeLaClasse)
    const neuf = lignesDeCode(corps)
    let k = 0
    for (const ligne of neuf) if (k < hier.length && ligne === hier[k]) k++
    expect(k).toBe(hier.length)
    expect(neuf.length - hier.length).toBe(7)
  })

  it('la garde de tête : le corps de PC7-Q2 à son empreinte, son déclencheur, aucune commune hors des classes 6 et 7', () => {
    expect(md5(corpsDeLaClasse)).toBe('dadd05a400c277832ce0261c8eb15544')
    expect(sql).toContain(`if v_empreinte is distinct from '${md5(corpsDeLaClasse)}' then`)
    expect(sql).toContain("t.tgname = 'categories_du_dossier'")
    expect(sql).toContain("where c.dossier_id is null and c.compte_comptable is not null and c.compte_comptable !~ '^[67][0-9]{2}';")
    expect(sql.indexOf('do $garde$')).toBeLessThan(sql.search(/create\s+or\s+replace\s+function\s+public\.garder_categorie_du_dossier\(\)/i))
    expect(sql).toContain("security definer\nset search_path = ''\nas $fonction$")
    expect(sql).toContain('revoke all on function public.garder_categorie_du_dossier() from public, anon, authenticated;')
  })

  it('le retour rend le corps de PC7-Q2 à l’octet près, sous la garde du corps posé ; celui de PC7-Q2 le suit', () => {
    expect(corpsDeLaGarde(retour)).toBe(corpsDeLaClasse)
    expect(retour).toContain(`if v_empreinte is distinct from '${md5(corps)}' then`)
    expect(retour.indexOf('do $garde$')).toBeLessThan(retour.search(/create\s+or\s+replace\s+function\s+public\.garder_categorie_du_dossier\(\)/i))
    expect(readFileSync(RETOUR_DE_LA_CLASSE, 'utf8')).toContain(`if v_empreinte is distinct from '${md5(corpsDeLaClasse)}' then`)
  })

  it('les deux passent par l’outil : ni barre oblique inverse, ni mot de suppression hors de tg_op', () => {
    for (const texte of [sql, retour]) {
      expect(texte).not.toContain('\\')
      expect(texte.replace(/tg_op = 'DELETE'/g, '')).not.toMatch(/\b(delete|drop|truncate)\b/i)
    }
  })

  it('elle suit PC7-Q2 : sa version vient après la sienne, et après la dernière préparée du 12/11/2026', () => {
    expect(versionDe('classes_des_categories_communes') > versionDe('classes_des_categories')).toBe(true)
    expect(versionDe('classes_des_categories_communes') > '20261112235100').toBe(true)
  })

  it('le module dit (f) pour une commune, (e) pour une catégorie du dossier, chacun sous sa garde', () => {
    const toutes = { duDossier: true, communes: true }
    expect(refusDuCompteDUneCategorie({ dossier_id: null }, '401000', toutes)).toBe(refusDeLaClasseCommune('401000'))
    expect(refusDuCompteDUneCategorie({ dossier_id: null }, '6A1000', toutes)).toBe(refusDeLaClasseCommune('6A1000'))
    expect(refusDuCompteDUneCategorie({ dossier_id: null }, '706000', toutes)).toBeNull()
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '401000', toutes)).toBe(refusDeLaClasse('401000'))
    // Chaque garde sous son drapeau : celle des communes seule ne dit rien d'une catégorie du dossier, ni l'inverse.
    expect(refusDuCompteDUneCategorie({ dossier_id: 'd1' }, '401000', { duDossier: false, communes: true })).toBeNull()
    expect(refusDuCompteDUneCategorie({ dossier_id: null }, '401000', { duDossier: true, communes: false })).toBeNull()
  })

  it('l’essai attend les mots de la base', () => {
    const essai = readFileSync(join(__dirname, '../../supabase/essais/categoriesDuDossier.sql'), 'utf8')
    expect(essai).toContain(refusDeLaClasseCommune('401000').replace(/'/g, "''"))
    expect(essai).toContain(refusDeLaClasseCommune('512000').replace(/'/g, "''"))
  })

  it('le drapeau suit la migration : baissé tant qu’elle n’est que préparée, levé quand elle entre dans l’export', () => {
    expect(CLASSES_DES_CATEGORIES_COMMUNES_PREVUES).toBe(versionExportee('classes_des_categories_communes') !== undefined)
  })
})
