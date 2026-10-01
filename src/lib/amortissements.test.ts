import { describe, expect, it } from 'vitest'
import {
  amortissementCumuleCentimes, compteAmortissement, dotationAEcrire, dotationConforme, dotationDeLExercice,
  dotationsDuRegistre, dotationsEnDefaut, dotationSurPeriode, ecritureDeLaDotation, FORMAT_COMPTE_IMMOBILISATION, miseEnService,
  planAmortissement, rang360, refusBien, REFUS_DOTATION_SANS_NATURE, refusDotation, refusNature, valeurSaisie,
} from './amortissements'
import { COMPTE_DOTATIONS_AMORTISSEMENTS, libelleCompteTenu } from './comptes'
import type { EcritureBrouillon, Immobilisation, NatureImmobilisation } from './types'
import { fichiersDuSchema } from '../test/schema'

// TYPÉ sans `as` : le compilateur confronte chaque champ à la table.
const bien = (o: Partial<Immobilisation> = {}): Immobilisation => ({
  id: 'i1', dossier_id: 'd1', piece_id: 'p1', nature_id: 'n-info', libelle: 'Ordinateur portable',
  valeur: 1200, date_acquisition: '2025-07-01', date_mise_en_service: null, duree_annees: 3,
  created_at: '2025-07-02T10:00:00Z', ...o,
})

const INFORMATIQUE: NatureImmobilisation = {
  id: 'n-info', dossier_id: null, libelle: 'Informatique (ordinateur, imprimante...)', duree_annees_defaut: 3,
  ordre: 2, compte_immobilisation: '218300',
}

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, immobilisation_id: 'i1', date: '2025-12-31',
  compte: COMPTE_DOTATIONS_AMORTISSEMENTS, libelle: 'Dotation 2025 — Ordinateur portable', montant: 200, sens: 'debit',
  statut: 'proposee', created_at: '2026-01-05T10:00:00Z', ...o,
})

// La dotation écrite d'un exercice, telle que la base la garde : le 681100 au débit, le 28 au crédit.
const dotationEcrite = (annee: number, montant: number, o: Partial<EcritureBrouillon> = {}): EcritureBrouillon[] => [
  ecriture({ id: `e-${annee}-d`, date: `${annee}-12-31`, montant, sens: 'debit', ...o }),
  ecriture({ id: `e-${annee}-c`, date: `${annee}-12-31`, montant, sens: 'credit', compte: '281830', ...o }),
]

describe('rang360 — le jour en mois de trente jours, comme `rang_360` en base', () => {
  it('compte un 31 comme un 30, et saute le 29 et le 30 février', () => {
    expect(rang360('2025-01-01')).toBe(2025 * 360)
    expect(rang360('2025-01-30')).toBe(2025 * 360 + 29)
    expect(rang360('2025-01-31')).toBe(2025 * 360 + 29)
    expect(rang360('2025-02-28')).toBe(2025 * 360 + 57)
    expect(rang360('2024-02-29')).toBe(2024 * 360 + 58)
    expect(rang360('2025-03-01')).toBe(2025 * 360 + 60)
    expect(rang360('2025-12-31')).toBe(2025 * 360 + 359)
    expect(rang360('2026-01-01') - rang360('2025-12-31')).toBe(1)
  })
})

// LA TABLE DE PARITÉ, RELEVÉE EN BASE le 01/10/2026 par `dotation_amortissement(valeur, durée, mise en
// service, exercice)` : quinze biens choisis pour leurs bornes — un 29 février, un 31, un 1er janvier, un
// 31 décembre, un bien d'un centime de trop pour une division juste, un bien à 999 999,99 €, une durée de
// cinquante ans. La base REFUSE une écriture qui ne vaut pas sa dotation au centime : un écart ici, c'est
// une écriture juste refusée en production. (Les essais de la base en rejouent sept, voir
// supabase/essais/dotations.sql, contrôle 29.)
const TABLE_BASE: [number, number, string, [number, number][]][] = [
  [1233, 3, '2023-11-30', [[2022, 0], [2023, 35.39], [2024, 411], [2025, 411], [2026, 375.61]]],
  [1000, 4, '2024-02-29', [[2023, 0], [2024, 209.72], [2025, 250], [2026, 250], [2027, 250], [2028, 40.28]]],
  [679.84, 2, '2024-12-20', [[2023, 0], [2024, 10.39], [2025, 339.92], [2026, 329.53]]],
  [600, 1, '2025-01-01', [[2024, 0], [2025, 600]]],
  [5000, 5, '2025-01-01', [[2024, 0], [2025, 1000], [2026, 1000], [2027, 1000], [2028, 1000], [2029, 1000]]],
  [1000, 3, '2025-01-31', [[2024, 0], [2025, 306.48], [2026, 333.33], [2027, 333.34], [2028, 26.85]]],
  [1000, 1, '2025-02-28', [[2024, 0], [2025, 841.67], [2026, 158.33]]],
  [1234.56, 7, '2025-03-15', [[2024, 0], [2025, 140.11], [2026, 176.37], [2027, 176.36], [2028, 176.37], [2029, 176.37], [2030, 176.36], [2031, 176.37], [2032, 36.25]]],
  [333.33, 3, '2025-04-30', [[2024, 0], [2025, 74.38], [2026, 111.11], [2027, 111.11], [2028, 36.73]]],
  [999999.99, 10, '2025-05-17', [[2024, 0], [2025, 62222.22], [2026, 100000], [2027, 100000], [2028, 100000], [2029, 100000], [2030, 100000], [2031, 100000], [2032, 99999.99], [2033, 100000], [2034, 100000], [2035, 37777.78]]],
  [100000, 50, '2025-06-15', [[2024, 0], [2025, 1088.89], [2026, 2000], [2027, 2000], [2028, 2000], [2029, 2000], [2030, 2000], [2031, 2000], [2032, 2000], [2033, 2000], [2034, 2000], [2035, 2000], [2036, 2000]]],
  [1.01, 1, '2025-07-01', [[2024, 0], [2025, 0.51], [2026, 0.5]]],
  [2500, 3, '2025-08-31', [[2024, 0], [2025, 280.09], [2026, 833.34], [2027, 833.33], [2028, 553.24]]],
  [750, 2, '2025-12-31', [[2024, 0], [2025, 1.04], [2026, 375], [2027, 373.96]]],
  [12000, 5, '2026-07-01', [[2025, 0], [2026, 1200], [2027, 2400], [2028, 2400], [2029, 2400], [2030, 2400], [2031, 1200], [2032, 0]]],
]

describe('dotationDeLExercice — le calcul de la base, au centime', () => {
  it.each(TABLE_BASE)('%s € sur %s ans mis en service le %s', (valeur, duree, mise, attendues) => {
    const b = bien({ valeur, duree_annees: duree, date_acquisition: mise })
    for (const [annee, montant] of attendues) expect([annee, dotationDeLExercice(b, annee)]).toEqual([annee, montant])
  })

  it('fait la valeur EXACTE en somme, sans annuité de rattrapage', () => {
    for (const [valeur, duree, mise] of TABLE_BASE) {
      const plan = planAmortissement(bien({ valeur, duree_annees: duree, date_acquisition: mise }))
      expect(plan.reduce((s, a) => s + Math.round(a.dotation * 100), 0)).toBe(Math.round(valeur * 100))
      expect(plan[plan.length - 1].valeurNette).toBe(0)
    }
  })

  it('part de la mise en service quand elle est saisie, pas de l’acquisition', () => {
    const acquis = bien({ date_acquisition: '2025-03-10', date_mise_en_service: '2025-07-01' })
    expect(miseEnService(acquis)).toBe('2025-07-01')
    expect(dotationDeLExercice(acquis, 2025)).toBe(200)
    expect(miseEnService(bien({ date_acquisition: '2025-03-10' }))).toBe('2025-03-10')
    // Du 10 mars : 291 jours en service sur les 1 080 de la durée.
    expect(dotationDeLExercice(bien({ date_acquisition: '2025-03-10' }), 2025)).toBe(323.33)
  })

  it('ne dépend pas du fuseau : un calcul sur des chaînes, pas sur des `Date`', () => {
    const avant = process.env.TZ
    try {
      for (const tz of ['Pacific/Auckland', 'America/Martinique', 'UTC']) {
        process.env.TZ = tz
        expect(dotationDeLExercice(bien({ date_acquisition: '2025-01-01' }), 2025)).toBe(400)
      }
    } finally {
      process.env.TZ = avant
    }
  })

  it('rend l’amortissement cumulé en centimes entiers, plafonné à la valeur', () => {
    const b = bien()
    expect(amortissementCumuleCentimes(b, rang360('2025-06-30'))).toBe(0n)
    expect(amortissementCumuleCentimes(b, rang360('2025-07-01'))).toBe(111n)
    expect(amortissementCumuleCentimes(b, rang360('2028-12-31'))).toBe(120000n)
    expect(amortissementCumuleCentimes(b, rang360('2040-12-31'))).toBe(120000n)
  })
})

describe('dotationSurPeriode — la charge d’une période, pour la situation intermédiaire', () => {
  const b = bien({ valeur: 12000, duree_annees: 5, date_acquisition: '2025-01-01' })

  it('vaut la dotation de l’exercice sur l’année civile entière', () => {
    expect(dotationSurPeriode(b, '2026-01-01', '2026-12-31')).toBe(dotationDeLExercice(b, 2026))
  })

  it('rapporte la dotation au mois de janvier, et au 28 février en mois de trente jours', () => {
    expect(dotationSurPeriode(b, '2026-01-01', '2026-01-31')).toBe(200)
    expect(dotationSurPeriode(b, '2026-01-01', '2026-02-28')).toBe(386.67)
  })

  it('compte une période à cheval sur deux exercices, sans rien supposer de l’année', () => {
    expect(dotationSurPeriode(b, '2025-07-01', '2026-06-30')).toBe(2400)
  })

  it('ne compte rien avant la mise en service, ni sur une période à l’envers', () => {
    const tardif = bien({ valeur: 12000, duree_annees: 5, date_acquisition: '2026-12-15' })
    expect(dotationSurPeriode(tardif, '2026-01-01', '2026-06-30')).toBe(0)
    expect(dotationSurPeriode(tardif, '2026-01-01', '2026-12-31')).toBe(106.67)
    expect(dotationSurPeriode(b, '2026-06-30', '2026-01-01')).toBe(0)
  })
})

describe('planAmortissement', () => {
  it('ajoute l’exercice du reliquat quand la mise en service n’est pas un 1er janvier', () => {
    expect(planAmortissement(bien())).toEqual([
      { annee: 2025, dotation: 200, cumul: 200, valeurNette: 1000 },
      { annee: 2026, dotation: 400, cumul: 600, valeurNette: 600 },
      { annee: 2027, dotation: 400, cumul: 1000, valeurNette: 200 },
      { annee: 2028, dotation: 200, cumul: 1200, valeurNette: 0 },
    ])
  })

  it('tient dans la durée exacte quand le bien est mis en service un 1er janvier', () => {
    expect(planAmortissement(bien({ date_acquisition: '2025-01-01' })).map((a) => a.annee)).toEqual([2025, 2026, 2027])
  })

  it('garde un exercice à dotation nulle au milieu du tableau', () => {
    const minuscule = bien({ valeur: 0.01, duree_annees: 5, date_acquisition: '2025-01-01' })
    expect(planAmortissement(minuscule).map((a) => [a.annee, a.dotation])).toEqual([[2025, 0], [2026, 0], [2027, 0.01]])
  })
})

describe('compteAmortissement — 28 suivi du compte sans son 2, comme `compte_amortissement` en base', () => {
  it('rend le compte du plan comptable', () => {
    expect(compteAmortissement('218300')).toBe('281830')
    expect(compteAmortissement('205000')).toBe('280500')
    expect(compteAmortissement('215400')).toBe('281540')
    expect(compteAmortissement('218000')).toBe('281800')
  })

  it('porte un libellé, que la balance et le FEC reprennent', () => {
    expect(libelleCompteTenu(COMPTE_DOTATIONS_AMORTISSEMENTS)).toBe('Dotations aux amortissements des immobilisations')
    expect(libelleCompteTenu('281830')).toBe('Amortissements du matériel de bureau et matériel informatique')
    expect(libelleCompteTenu('281700')).toBe('Amortissements des immobilisations corporelles')
    expect(libelleCompteTenu('280700')).toBe('Amortissements des immobilisations incorporelles')
    // Un compte de catégorie n'en a pas ici : c'est la catégorie qui le nomme.
    expect(libelleCompteTenu('606100')).toBeNull()
  })
})

describe('ecritureDeLaDotation', () => {
  it('débite le 681100 et crédite le compte d’amortissement du bien, au montant de la dotation', () => {
    expect(ecritureDeLaDotation(bien(), '218300', 2025, null)).toEqual([
      { compte: '681100', sens: 'debit', montant: 200, libelle: 'Dotation 2025 — Ordinateur portable' },
      { compte: '281830', sens: 'credit', montant: 200, libelle: 'Dotation 2025 — Ordinateur portable' },
    ])
  })

  it('n’écrit rien quand la dotation est nulle — avant la mise en service, après la durée', () => {
    expect(ecritureDeLaDotation(bien(), '218300', 2024, null)).toEqual([])
    expect(ecritureDeLaDotation(bien(), '218300', 2029, null)).toEqual([])
  })

  it('n’écrit rien pour un exercice que l’ouverture du dossier a déjà repris', () => {
    expect(dotationAEcrire(bien(), 2025, '2026-01-01')).toBe(0)
    expect(ecritureDeLaDotation(bien(), '218300', 2025, '2026-01-01')).toEqual([])
    expect(dotationAEcrire(bien(), 2026, '2026-01-01')).toBe(400)
  })
})

describe('refusDotation — les refus de la base, dits avant le clic, dans son ordre', () => {
  it('refuse un exercice à venir', () => {
    expect(refusDotation(bien(), 2027, 2026, [], INFORMATIQUE, null)).toBe('La dotation d’un exercice à venir ne s’écrit pas encore.')
  })

  it('refuse de remplacer une dotation validée', () => {
    expect(refusDotation(bien(), 2025, 2026, [{ statut: 'validee' }], INFORMATIQUE, null))
      .toBe('La dotation 2025 de ce bien est validée : elle ne se remplace plus.')
  })

  it('demande la nature d’un bien qui doit une dotation, et pas d’un bien qui n’en doit pas', () => {
    expect(refusDotation(bien({ nature_id: null }), 2025, 2026, [], undefined, null)).toBe(REFUS_DOTATION_SANS_NATURE)
    expect(refusDotation(bien({ nature_id: null }), 2024, 2026, [{ statut: 'proposee' }], undefined, null)).toBeNull()
  })

  it('ne compose pas d’écriture sur une nature qu’il n’a pas lue', () => {
    expect(refusDotation(bien(), 2025, 2026, [], undefined, null)).toBe('La nature de ce bien est introuvable.')
  })

  it('laisse passer la dotation d’un bien qui a sa nature', () => {
    expect(refusDotation(bien(), 2026, 2026, [{ statut: 'proposee' }], INFORMATIQUE, null)).toBeNull()
  })

  // Une apostrophe se double en SQL, se courbe à l'écran : comparées, elles sont la même.
  const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")
  it('dit les phrases que la fonction SQL exportée lève', () => {
    const sql = sansApostrophes(fichiersDuSchema().find((f) => f.texte.includes('function public.ecrire_dotation_amortissement('))!.texte)
    for (const phrase of [
      'La dotation d’un exercice à venir ne s’écrit pas encore.', REFUS_DOTATION_SANS_NATURE,
      'La nature de ce bien est introuvable.', 'de ce bien est validée : elle ne se remplace plus.',
    ]) expect(sql).toContain(sansApostrophes(phrase))
    expect(sql).toContain(`('${COMPTE_DOTATIONS_AMORTISSEMENTS}', 'debit', v_montant)`)
    expect(sql).toContain("select '28' || substr(p_compte, 2, 4)")
  })
})

describe('dotationConforme — au centime, sans tolérance', () => {
  const attendues = ecritureDeLaDotation(bien(), '218300', 2025, null)

  it('reconnaît l’écriture de la base, dans n’importe quel ordre', () => {
    expect(dotationConforme(dotationEcrite(2025, 200), attendues, 2025)).toBe(true)
    expect(dotationConforme([...dotationEcrite(2025, 200)].reverse(), attendues, 2025)).toBe(true)
  })

  it('refuse un centime d’écart, un autre compte, un autre sens, une autre date, une ligne de trop', () => {
    expect(dotationConforme(dotationEcrite(2025, 200.01), attendues, 2025)).toBe(false)
    expect(dotationConforme([dotationEcrite(2025, 200)[0], ecriture({ compte: '281800', sens: 'credit' })], attendues, 2025)).toBe(false)
    expect(dotationConforme(dotationEcrite(2025, 200).map((e) => ({ ...e, sens: e.sens === 'debit' ? 'credit' as const : 'debit' as const })), attendues, 2025)).toBe(false)
    expect(dotationConforme(dotationEcrite(2025, 200, { date: '2025-12-30' }), attendues, 2025)).toBe(false)
    expect(dotationConforme([...dotationEcrite(2025, 200), ecriture({ id: 'trop', montant: 0.01 })], attendues, 2025)).toBe(false)
  })
})

describe('dotationsDuRegistre — chaque exercice du registre comparé au brouillon', () => {
  const etats = (r: ReturnType<typeof dotationsDuRegistre>) => r.map((d) => [d.annee, d.etat, d.montant])

  it('rend chaque exercice de la mise en service à l’exercice en cours, à écrire tant que rien n’est écrit', () => {
    expect(etats(dotationsDuRegistre([bien()], [INFORMATIQUE], [], null, 2026))).toEqual([
      [2025, 'a_ecrire', 200], [2026, 'a_ecrire', 400],
    ])
  })

  it('reconnaît une dotation écrite', () => {
    const r = dotationsDuRegistre([bien()], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2026)
    expect(etats(r)).toEqual([[2025, 'ecrite', 200], [2026, 'a_ecrire', 400]])
    expect(r[0].presentes).toHaveLength(2)
  })

  it('dit à réécrire une dotation que le registre a changée depuis — la valeur, la mise en service', () => {
    expect(etats(dotationsDuRegistre([bien({ valeur: 1500 })], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2025)))
      .toEqual([[2025, 'a_reecrire', 250]])
    expect(etats(dotationsDuRegistre([bien({ date_mise_en_service: '2025-10-01' })], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2025)))
      .toEqual([[2025, 'a_reecrire', 100]])
  })

  it('dit à réécrire une dotation sur le compte d’une autre nature', () => {
    const mobilier: NatureImmobilisation = { ...INFORMATIQUE, id: 'n-mob', compte_immobilisation: '218400' }
    expect(etats(dotationsDuRegistre([bien({ nature_id: 'n-mob' })], [INFORMATIQUE, mobilier], dotationEcrite(2025, 200), null, 2025)))
      .toEqual([[2025, 'a_reecrire', 200]])
  })

  it('dit à retirer une dotation que le calcul ne donne plus, même hors de la plage du registre', () => {
    // La mise en service repoussée en 2026 : la dotation 2025 n'a plus lieu d'être.
    const r = dotationsDuRegistre([bien({ date_mise_en_service: '2026-01-01' })], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2026)
    expect(etats(r)).toEqual([[2025, 'a_retirer', 0], [2026, 'a_ecrire', 400]])
    expect(r[0].attendues).toEqual([])
  })

  it('dit à retirer une dotation écrite pour un exercice que l’ouverture du dossier a repris', () => {
    expect(etats(dotationsDuRegistre([bien()], [INFORMATIQUE], dotationEcrite(2025, 200), '2026-01-01', 2026)))
      .toEqual([[2025, 'a_retirer', 0], [2026, 'a_ecrire', 400]])
  })

  it('ne rend rien avant l’ouverture quand rien n’y est écrit', () => {
    expect(etats(dotationsDuRegistre([bien()], [INFORMATIQUE], [], '2026-01-01', 2026))).toEqual([[2026, 'a_ecrire', 400]])
  })

  it('distingue une dotation VALIDÉE qui ne suit plus le registre', () => {
    const r = dotationsDuRegistre([bien({ valeur: 1500 })], [INFORMATIQUE], dotationEcrite(2025, 200, { statut: 'validee' }), null, 2025)
    expect(etats(r)).toEqual([[2025, 'validee', 250]])
    expect(r[0].refus).toBe('La dotation 2025 de ce bien est validée : elle ne se remplace plus.')
  })

  it('ne compose pas l’écriture d’un bien sans nature, et dit pourquoi', () => {
    const r = dotationsDuRegistre([bien({ nature_id: null })], [INFORMATIQUE], [], null, 2025)
    expect(etats(r)).toEqual([[2025, 'a_ecrire', 200]])
    expect(r[0].attendues).toBeNull()
    expect(r[0].refus).toBe(REFUS_DOTATION_SANS_NATURE)
  })

  it('ne rend rien d’un bien mis en service après l’exercice en cours', () => {
    expect(dotationsDuRegistre([bien({ date_acquisition: '2027-02-01' })], [INFORMATIQUE], [], null, 2026)).toEqual([])
  })

  it('ne mêle pas les dotations de deux biens', () => {
    const autre = bien({ id: 'i2', libelle: 'Bureau', date_acquisition: '2025-01-01' })
    const r = dotationsDuRegistre([bien(), autre], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2025)
    expect(r.map((d) => [d.immobilisation.id, d.etat])).toEqual([['i1', 'ecrite'], ['i2', 'a_ecrire']])
  })
})

describe('dotationsEnDefaut — ce que la Checklist réclame', () => {
  it('ne réclame la dotation à écrire que d’un exercice révolu, et toute dotation fausse', () => {
    const r = dotationsDuRegistre(
      [bien(), bien({ id: 'i2', valeur: 1500, date_acquisition: '2026-01-01' })], [INFORMATIQUE],
      dotationEcrite(2026, 999, { immobilisation_id: 'i2' }), null, 2026,
    )
    expect(dotationsEnDefaut(r, 2026).map((d) => [d.immobilisation.id, d.annee, d.etat])).toEqual([
      ['i1', 2025, 'a_ecrire'],
      ['i2', 2026, 'a_reecrire'],
    ])
  })

  // Une dotation écrite qui suit le registre ne se réclame pas, même d'un exercice révolu : c'est l'état
  // qu'on attend de toutes.
  it('ne réclame pas une dotation écrite qui suit le registre', () => {
    const r = dotationsDuRegistre([bien()], [INFORMATIQUE], dotationEcrite(2025, 200), null, 2026)
    expect(r.map((d) => [d.annee, d.etat])).toEqual([[2025, 'ecrite'], [2026, 'a_ecrire']])
    expect(dotationsEnDefaut(r, 2026)).toEqual([])
  })
})

describe('valeurSaisie — la valeur d’un bien telle que le formulaire la donne', () => {
  it('lit la virgule française comme le point', () => {
    expect(valeurSaisie('12000,50')).toBe(12000.5)
    expect(valeurSaisie(' 1200.25 ')).toBe(1200.25)
  })

  // Un champ vide n'est pas une valeur nulle : Number('') vaut 0, et ce zéro passerait pour une saisie.
  it.each(['', '   ', 'abc'])('rend NaN sur « %s », jamais un nombre', (texte) => {
    expect(valeurSaisie(texte)).toBeNaN()
  })
})

describe('refusBien — ce qu’on ne laisse pas enregistrer d’un bien', () => {
  const saisie = (o: Partial<Parameters<typeof refusBien>[0]> = {}) => ({
    libelle: 'Ordinateur', valeur: '1200', dateAcquisition: '2025-07-01', dateMiseEnService: '', duree: '3', ...o,
  })

  it('laisse passer un bien complet, mise en service vide ou postérieure', () => {
    expect(refusBien(saisie({ valeur: '1200' }))).toBeNull()
    expect(refusBien(saisie({ valeur: '1200,50', dateMiseEnService: '2025-09-01' }))).toBeNull()
    // Le jour même de l'acquisition : c'est le cas courant, pas une antériorité.
    expect(refusBien(saisie({ valeur: '1200', dateMiseEnService: '2025-07-01' }))).toBeNull()
  })

  it('refuse un libellé vide', () => {
    expect(refusBien(saisie({ libelle: '  ', valeur: '1200' }))).toBe('Donnez un libellé au bien.')
  })

  // La valeur arrive d'un champ numérique : vide quand le navigateur ne sait pas la lire.
  it.each(['', '0', '-5', 'abc'])('refuse la valeur « %s »', (valeur) => {
    expect(refusBien(saisie({ valeur }))).toBe('La valeur du bien doit être un montant positif.')
  })

  it('refuse une valeur au millième : la base l’exige au centime', () => {
    expect(refusBien(saisie({ valeur: '1200,005' }))).toBe('La valeur du bien se saisit au centime.')
  })

  it.each(['', '0', '2,5', '-1'])('refuse la durée « %s »', (duree) => {
    expect(refusBien(saisie({ valeur: '1200', duree }))).toBe('La durée d’amortissement est un nombre entier d’années, au moins un.')
  })

  it('refuse une date d’acquisition absente', () => {
    expect(refusBien(saisie({ valeur: '1200', dateAcquisition: '' }))).toBe('Donnez la date d’acquisition du bien.')
  })

  it('refuse une mise en service antérieure à l’acquisition', () => {
    expect(refusBien(saisie({ valeur: '1200', dateMiseEnService: '2025-06-30' })))
      .toBe('La mise en service ne précède pas l’acquisition : le bien serait amorti avant d’exister.')
  })
})

describe('refusNature — le compte d’une nature est un compte d’immobilisation', () => {
  const saisie = (o: Partial<Parameters<typeof refusNature>[0]> = {}) => ({ libelle: 'Matériel médical', duree: '7', compte: '215400', ...o })

  it.each(['215400', '205000', ' 218300 '])('laisse passer le compte « %s »', (compte) => {
    expect(refusNature(saisie({ compte }))).toBeNull()
  })

  // Un compte de charge, un compte d'immobilisation financière (27), un compte de cinq chiffres : aucun ne
  // donnerait un compte d'amortissement — et la base refuserait la nature.
  it.each(['606000', '271000', '21540', '2154000', '22000O'])('refuse le compte « %s »', (compte) => {
    expect(refusNature(saisie({ compte }))).toMatch(/^Le compte d’une nature est un compte d’immobilisation de six chiffres/)
  })

  it('suit la contrainte de la base, au caractère près', () => {
    const contrainte = fichiersDuSchema().map((f) => f.texte).join('\n')
      .match(/natures_immobilisation_compte_immobilisation_format CHECK \(\(compte_immobilisation ~ '([^']+)'::text\)\)/)
    expect(contrainte?.[1]).toBe('^2[01][0-9]{4}$')
    expect(FORMAT_COMPTE_IMMOBILISATION.source).toBe('^2[01]\\d{4}$')
  })

  it('refuse un nom vide et une durée qui n’est pas un entier d’au moins un an', () => {
    expect(refusNature(saisie({ libelle: '' }))).toBe('Donnez un nom à la nature.')
    expect(refusNature(saisie({ duree: '0' }))).toBe('La durée usuelle est un nombre entier d’années, au moins un.')
  })
})
