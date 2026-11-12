import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROLES_COMPTABLES } from './planComptable'
import { ROLES_DU_CHANGE } from './rolesDuChange'
import {
  argumentsDeLaBase, composerLeStock, controleDesStocks, ouvertureDuCompte, REFUS_DES_STOCKS, ROLES_DES_STOCKS,
  rolesDuCompteDeStock, STOCKS_PREVUS, TABLES_DES_STOCKS,
  type ComptesDesStocks, type EntreesDuStock, type LigneDuStock, type SaisieDuStock,
} from './stocks'

// LES STOCKS DE CLÔTURE (ligne 36, LIA2) : la composition que la base recompose, ses refus aux mots de la migration, les
// rôles du catalogue tels que la migration les insère, et le contrôle 2 de la liasse.

const MIGRATION = readFileSync(
  new URL('../../supabase/preparees/20261112200000_stocks_de_cloture.sql', import.meta.url), 'utf8')

const DEFAUTS: ComptesDesStocks = Object.freeze(Object.fromEntries(
  ROLES_DES_STOCKS.map((r) => [r.role, r.compteDefaut]))) as ComptesDesStocks
// Un plan où chaque rôle se tient sur un autre sous-compte que son défaut : une constante oubliée s'y verrait.
const DECALE: ComptesDesStocks = Object.freeze({
  stocks_matieres: '311000', stocks_autres_approvisionnements: '321000', en_cours_biens: '331000', en_cours_services: '341000',
  stocks_produits: '355100', stocks_marchandises: '371000', variation_stocks_matieres: '603110',
  variation_stocks_approvisionnements: '603210', variation_stocks_marchandises: '603710', production_stockee: '713500',
})

const saisie = (o: Partial<SaisieDuStock> = {}): SaisieDuStock => ({
  exercice: 2026, compteStock: '370000', montantCentimes: 1_234_500, methode: 'cmup',
  objet: 'Inventaire physique du 31/12 — magasin', pieceCiteeId: null, ...o,
})
const entrees = (o: Partial<EntreesDuStock> = {}): EntreesDuStock => ({
  mode: 'engagement', saisie: saisie(), ouvertureCentimes: 1_000_000, comptes: DEFAUTS, derniereValidee: 2025,
  anneeEnCours: 2026, ...o,
})
const lignes = (e: EntreesDuStock): LigneDuStock[] => {
  const c = composerLeStock(e)
  if (!c.ok) throw new Error(c.refus)
  return c.lignes
}
const refus = (e: EntreesDuStock) => {
  const c = composerLeStock(e)
  return c.ok ? null : c.refus
}
const soldeDe = (ls: readonly LigneDuStock[], compte: string) =>
  ls.filter((l) => l.compte === compte).reduce((t, l) => t + (l.sens === 'debit' ? l.centimes : -l.centimes), 0)

describe('le drapeau et la table', () => {
  it('baissé, une table', () => {
    expect(STOCKS_PREVUS).toBe(false)
    expect(TABLES_DES_STOCKS).toEqual(['stocks_de_cloture'])
    expect(MIGRATION).toMatch(/^create table public\.stocks_de_cloture \(/mi)
  })
})

describe('les rôles du catalogue', () => {
  it('sont ceux que la migration insère, au caractère près', () => {
    const insertion = /insert into public\.roles_comptables[^;]*;/.exec(MIGRATION)![0]
    const lus = [...insertion.matchAll(/\('([a-z_]+)', array\['([0-9]+)'\], '([0-9]{6})', '((?:[^']|'')+)', null, ([0-9]+)\)/g)]
      .map(([, role, racine, compte, libelle, ordre]) => ({
        role, racines: [racine], compteDefaut: compte, libelleDefaut: libelle.replaceAll("''", "'"),
        prefixeAuxiliaireDefaut: null, ordre: Number(ordre),
      }))
    expect(lus).toEqual(ROLES_DES_STOCKS.map((r) => ({ ...r, racines: [...r.racines] })))
  })

  it('aucune racine n’en commence une autre du catalogue, ni l’inverse (art. 1131-2) ; leurs rangs sont libres', () => {
    const autres = [...ROLES_COMPTABLES, ...ROLES_DU_CHANGE]
    for (const r of ROLES_DES_STOCKS) {
      for (const racine of r.racines) {
        for (const a of autres) {
          for (const autre of a.racines) {
            expect(racine.startsWith(autre) || autre.startsWith(racine), `${r.role} ${racine} / ${a.role} ${autre}`).toBe(false)
          }
        }
      }
      expect(autres.some((a) => (a.ordre as number) === r.ordre), r.role).toBe(false)
      expect(r.racines.some((racine) => r.compteDefaut.startsWith(racine)), r.role).toBe(true)
    }
  })

  it('chaque compte de stock a son rôle et sa variation (6031, 6032, 6037, 713 pour 33 à 35)', () => {
    expect(rolesDuCompteDeStock('310000')).toEqual({ stock: 'stocks_matieres', variation: 'variation_stocks_matieres' })
    expect(rolesDuCompteDeStock('321000')).toEqual({ stock: 'stocks_autres_approvisionnements', variation: 'variation_stocks_approvisionnements' })
    expect(rolesDuCompteDeStock('331000')?.variation).toBe('production_stockee')
    expect(rolesDuCompteDeStock('345000')?.variation).toBe('production_stockee')
    expect(rolesDuCompteDeStock('355000')?.variation).toBe('production_stockee')
    expect(rolesDuCompteDeStock('370000')).toEqual({ stock: 'stocks_marchandises', variation: 'variation_stocks_marchandises' })
    for (const hors of ['360000', '380000', '391000', '37000', '3700000', '470000', '']) expect(rolesDuCompteDeStock(hors), hors).toBeNull()
  })
})

describe('la composition de l’écriture de clôture (LIA-Q2, (A))', () => {
  it('annule le stock initial et constate le stock final : quatre lignes équilibrées, au 6037 net de la variation', () => {
    const ls = lignes(entrees())
    expect(ls.map((l) => [l.compte, l.sens, l.centimes])).toEqual([
      ['603700', 'debit', 1_000_000], ['370000', 'credit', 1_000_000],
      ['370000', 'debit', 1_234_500], ['603700', 'credit', 1_234_500],
    ])
    expect(soldeDe(ls, '370000')).toBe(234_500)
    // Le 603 est débité du stock initial et crédité du stock final : son solde est initial − final (PCG, art. 946-60).
    expect(soldeDe(ls, '603700')).toBe(1_000_000 - 1_234_500)
    expect(ls.every((l) => l.libelle.length >= 1 && l.libelle.length <= 200 && l.libelle === l.libelle.trim())).toBe(true)
  })

  it('suit le plan du dossier, jamais un défaut', () => {
    const ls = lignes(entrees({ comptes: DECALE, saisie: saisie({ compteStock: '371000' }) }))
    expect(new Set(ls.map((l) => l.compte))).toEqual(new Set(['371000', '603710']))
    expect(lignes(entrees({ comptes: DECALE, saisie: saisie({ compteStock: '341000' }) })).map((l) => l.compte))
      .toEqual(['713500', '341000', '341000', '713500'])
  })

  it('« néant » : l’annulation seule ; sans stock initial non plus, aucune ligne ; sans ouverture, la constatation seule', () => {
    expect(lignes(entrees({ saisie: saisie({ montantCentimes: 0 }) })).map((l) => [l.compte, l.sens])).toEqual([
      ['603700', 'debit'], ['370000', 'credit']])
    expect(lignes(entrees({ saisie: saisie({ montantCentimes: 0 }), ouvertureCentimes: 0 }))).toEqual([])
    expect(lignes(entrees({ ouvertureCentimes: 0 })).map((l) => [l.compte, l.sens])).toEqual([['370000', 'debit'], ['603700', 'credit']])
  })

  it('les refus, dans l’ordre de la base', () => {
    expect(refus(entrees({ mode: 'tresorerie', saisie: saisie({ compteStock: 'x' }) }))).toBe(REFUS_DES_STOCKS.tresorerie)
    expect(refus(entrees({ saisie: saisie({ exercice: 1999 }) }))).toBe(REFUS_DES_STOCKS.exercice)
    expect(refus(entrees({ saisie: saisie({ exercice: 2026.5 }) }))).toBe(REFUS_DES_STOCKS.exercice)
    for (const compte of ['360000', '390000', '37000', '6037000']) {
      expect(refus(entrees({ saisie: saisie({ compteStock: compte }) })), compte).toBe(REFUS_DES_STOCKS.compte)
    }
    for (const m of [-1, 0.5, 1_000_000_000_000, Number.NaN]) {
      expect(refus(entrees({ saisie: saisie({ montantCentimes: m }) })), String(m)).toBe(REFUS_DES_STOCKS.montant)
    }
    expect(refus(entrees({ saisie: saisie({ methode: 'lifo' as never }) }))).toBe(REFUS_DES_STOCKS.methode)
    for (const objet of ['', ' Inventaire', 'Inventaire ', 'é'.repeat(201)]) {
      expect(refus(entrees({ saisie: saisie({ objet }) })), objet.slice(0, 12)).toBe(REFUS_DES_STOCKS.objet)
    }
    expect(refus(entrees({ saisie: saisie({ objet: 'é'.repeat(200) }) }))).toBeNull()
    expect(refus(entrees({ derniereValidee: 2026 }))).toBe('L’exercice 2026 est validé : son stock de clôture ne change plus.')
    expect(refus(entrees({ derniereValidee: null }))).toBeNull()
    expect(refus(entrees({ saisie: saisie({ exercice: 2027 }) })))
      .toBe('L’exercice 2027 n’est pas commencé : son stock de clôture ne se saisit pas encore.')
    expect(refus(entrees({ comptes: DECALE })))
      .toBe('Le compte 370000 n’est pas le compte de ce stock au plan du dossier (371000).')
    expect(refus(entrees({ ouvertureCentimes: -500 })))
      .toBe('Le compte 370000 s’ouvre au crédit (500 centimes) : un stock ne s’ouvre pas au crédit — relire la balance reprise ou les soldes reportés.')
    expect(refus(entrees({ ouvertureCentimes: 10.5 }))).toBe(REFUS_DES_STOCKS.ouverture)
  })

  it('les mots des refus sont ceux de la migration', () => {
    const enSql = (texte: string) => texte.replaceAll('’', "''")
    for (const [cle, texte] of Object.entries(REFUS_DES_STOCKS)) {
      if (cle === 'ouverture') continue // la base lit l'ouverture elle-même
      expect(MIGRATION, cle).toContain(enSql(texte))
    }
    for (const fragment of [
      "n''est pas commencé : son stock de clôture ne se saisit pas encore.",
      "n''est pas le compte de ce stock au plan du dossier",
      "s''ouvre au crédit (% centimes) : un stock ne s''ouvre pas au crédit — relire la balance reprise ou les soldes reportés.",
      ': son stock de clôture ne change plus.',
    ]) expect(MIGRATION, fragment).toContain(fragment)
  })

  it('les arguments de la base portent la saisie et les lignes, sans rien d’autre', () => {
    const s = saisie({ pieceCiteeId: '6f1c2b8e-0d3a-4c5b-9e7f-1a2b3c4d5e6f' })
    const a = argumentsDeLaBase(s, lignes(entrees({ saisie: s })))
    expect(a.p_stock).toEqual({
      exercice: 2026, compte_stock: '370000', montant_centimes: 1_234_500, methode: 'cmup',
      objet: 'Inventaire physique du 31/12 — magasin', piece_citee_id: '6f1c2b8e-0d3a-4c5b-9e7f-1a2b3c4d5e6f',
    })
    expect(a.p_ecritures.every((l) => Object.keys(l).sort().join() === 'centimes,compte,libelle,sens')).toBe(true)
  })
})

describe('le solde d’ouverture, lu comme la base le lit', () => {
  it('les à-nouveaux de l’exercice et les soldes reportés à son 1er janvier, en centimes exacts', () => {
    const an = [
      { date: '2026-01-01', compte: '370000', sens: 'debit' as const, montant: 0.1 },
      { date: '2026-01-01', compte: '370000', sens: 'debit' as const, montant: 0.2 },
      { date: '2025-01-01', compte: '370000', sens: 'debit' as const, montant: 999 },
      { date: '2026-01-01', compte: '371000', sens: 'debit' as const, montant: 999 },
    ]
    const sr = [
      { date: '2026-01-01', compte: '370000', sens: 'debit' as const, montant: 10_000 },
      { date: '2026-01-01', compte: '370000', sens: 'credit' as const, montant: 0.05 },
      { date: '2026-01-02', compte: '370000', sens: 'debit' as const, montant: 999 },
    ]
    expect(ouvertureDuCompte(an, sr, '370000', 2026)).toBe(30 + 1_000_000 - 5)
    expect(ouvertureDuCompte([], [], '370000', 2026)).toBe(0)
  })
})

describe('le contrôle 2 de la liasse : les stocks du 2033-A contre les stocks saisis', () => {
  it('égaux compte par compte : aucun échec ; la dépréciation (39) hors du contrôle', () => {
    expect(controleDesStocks(
      [{ compte: '370000', centimes: 1_234_500 }, { compte: '391000', centimes: -50_000 }, { compte: '512000', centimes: 7 }],
      [{ compte_stock: '370000', montant_centimes: 1_234_500 }],
    )).toEqual([])
    expect(controleDesStocks([], [{ compte_stock: '370000', montant_centimes: 0 }])).toEqual([])
  })

  it('un compte de stock soldé sans saisie, une saisie que le bilan ne porte pas, une valeur qui diffère', () => {
    const echecs = controleDesStocks(
      [{ compte: '310000', centimes: 20_000 }, { compte: '370000', centimes: 100 }, { compte: '380000', centimes: 5 }],
      [{ compte_stock: '370000', montant_centimes: 300 }, { compte_stock: '355000', montant_centimes: 40 }],
    )
    expect(echecs.map((e) => [e.code, e.numero, e.ecart])).toEqual([
      ['stocks-au-bilan', 2, 20_000], ['stocks-au-bilan', 2, -40], ['stocks-au-bilan', 2, -200], ['stocks-au-bilan', 2, 5],
    ])
    expect(echecs[0].texte).toMatch(/^Le compte 310000 porte .* au bilan, et aucun stock de clôture n’y est saisi\.$/)
  })
})

describe('les dix rôles des stocks, jugés à part par planComptable.sql', () => {
  it('leur empreinte est celle que l’essai exige quand la migration est en base', () => {
    const ESSAI_DU_PLAN = readFileSync(new URL('../../supabase/essais/planComptable.sql', import.meta.url), 'utf8')
    const texte = ROLES_DES_STOCKS.map((r) => [r.role, r.racines.join(','), r.compteDefaut, r.libelleDefaut ?? '',
      r.prefixeAuxiliaireDefaut ?? '', String(r.ordre)].join('|')).join('\n')
    const epinglee = /empreinte_roles_stocks constant text := '([0-9a-f]{32})'/.exec(ESSAI_DU_PLAN)?.[1]
    expect(createHash('md5').update(texte, 'utf8').digest('hex')).toBe(epinglee)
    expect(ESSAI_DU_PLAN).toContain("m.name = 'stocks_de_cloture'")
    for (const r of ROLES_DES_STOCKS) expect(ESSAI_DU_PLAN, r.role).toContain(`'${r.role}'`)
  })
})

// LES TROIS SOURCES NEUVES DU BROUILLON (INV2, LIA2, MCB5g) : chaque paire a UNE contrainte, au même nom et au même texte
// dans les deux migrations de la paire, posée par la seconde à se coller ; chaque garde de tête accepte les deux autres
// colonnes, présentes ou non, et rien d'autre. Les trois se collent ainsi dans n'importe quel ordre et laissent la même base.
describe('les sources neuves du brouillon, dans n’importe quel ordre', () => {
  const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
  const MIGRATIONS = {
    operation_inventaire_id: lire('supabase/preparees/20261112190000_operations_d_inventaire.sql'),
    stock_de_cloture_id: MIGRATION,
    ouverture_compte_bancaire_id: lire('supabase/preparees/20261111235000_ouverture_eclatee_par_compte.sql'),
  }
  const RETOURS = {
    operation_inventaire_id: lire('supabase/preparees/retour/20261112190100_retour_operations_d_inventaire.sql'),
    stock_de_cloture_id: lire('supabase/preparees/retour/20261112200100_retour_stocks_de_cloture.sql'),
    ouverture_compte_bancaire_id: lire('supabase/preparees/retour/20261111235100_retour_ouverture_eclatee_par_compte.sql'),
  }
  const PAIRES = [
    ['ecritures_brouillon_inventaire_hors_des_stocks', 'operation_inventaire_id', 'stock_de_cloture_id'],
    ['ecritures_brouillon_inventaire_hors_de_l_ouverture', 'operation_inventaire_id', 'ouverture_compte_bancaire_id'],
    ['ecritures_brouillon_stock_hors_de_l_ouverture', 'stock_de_cloture_id', 'ouverture_compte_bancaire_id'],
  ] as const
  const SOURCES_D_HIER =
    'cotisation_id,declaration_tva_id,dossier_id,encaissement_id,facture_id,immobilisation_id,ligne_bancaire_id,operation_caisse_id,piece_id,vehicule_id'

  it('chaque paire : la même contrainte dans ses deux migrations, posée si l’autre colonne est en base, nommée par les deux retours', () => {
    for (const [nom, a, b] of PAIRES) {
      const pose = `execute 'alter table public.ecritures_brouillon add constraint ${nom} '\n      || 'check (${a} is null or ${b} is null)';`
      for (const [colonne, autre] of [[a, b], [b, a]] as const) {
        const texte = MIGRATIONS[colonne]
        expect(texte.split(pose).length - 1, `${nom} dans la migration de ${colonne}`).toBe(1)
        const garde = `and a.attname = '${autre}' and not a.attisdropped) then\n    ${pose}`
        expect(texte, `${nom} : posée si ${autre} est en base`).toContain(garde)
        expect(RETOURS[colonne], `${nom} au retour de ${colonne}`)
          .toContain(`alter table public.ecritures_brouillon drop constraint if exists ${nom};`)
      }
    }
    // Aucune autre contrainte d'exclusion entre elles : trois paires, six poses.
    const poses = Object.values(MIGRATIONS).join('\n').match(/add constraint ecritures_brouillon_\w+_hors_d\w+ '/g)
    expect(poses).toHaveLength(6)
  })

  it('chaque garde de tête accepte les deux autres colonnes, présentes ou non, et exige les sources d’hier, rien de plus', () => {
    for (const [colonne, texte] of Object.entries(MIGRATIONS)) {
      const autres = Object.keys(MIGRATIONS).filter((c) => c !== colonne)
      expect(texte, colonne).toMatch(new RegExp(`c\\.contype = 'f'\\n\\s+and a\\.attname not in \\('(${autres.join('|')})', '(${autres.join('|')})'\\);`))
      expect(texte, colonne).toContain(`if v_sources is distinct from\n     '${SOURCES_D_HIER}' then`)
      expect(texte, colonne).not.toMatch(new RegExp(`not in \\([^)]*'${colonne}'`))
    }
  })
})
