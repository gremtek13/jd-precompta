import { describe, expect, it } from 'vitest'
import {
  REFUS_SOURCE_DE_LA_VENTE, REFUS_VALIDATION_SOURCE, refusDuReglage, refusValidationSource, sourceALaValidation,
  type FacturePourReglage,
} from './sourceDeLaVente'
import { correspondAuModele, etapesDeLEssai, refusExigesParLEssai } from '../test/essaiVentesFacturees'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LA SOURCE DE LA VENTE (chantier EC-Q3, étape VF2 ; migration `source_de_la_vente`, en base et dans l'export depuis le
// 18/10/2026), CONFRONTÉE AU TEXTE DE SES TROIS FONCTIONS : chaque refus du module est celui de la base — même message,
// même rang, même code, mêmes valeurs —, et chaque fonction pure joue la règle que le texte écrit. Ce que la base répond en
// vrai, supabase/essais/ventesFacturees.sql le prouve.

// Les messages des `raise exception` d'une fonction, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple.
const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
// Le code de chacun, dans le même ordre.
const codesSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1])
// Ce qui remplit ses « % » : le texte entre le message et `using errcode`, sans sa virgule de tête.
const valeursSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '').trim())

const REGLAGE = REFUS_SOURCE_DE_LA_VENTE.find((r) => r.cle === 'reglage_irreversible')
const parCle = (cle: string) => [...REFUS_SOURCE_DE_LA_VENTE, ...REFUS_VALIDATION_SOURCE].find((r) => r.cle === cle) as
  { cle: string; modele: string; code: string }

// Chaque fonction de la migration, ses refus dans l'ordre de son texte, et la valeur de chaque « % ».
const FONCTIONS = [
  ['garder_ventes_par_les_factures', ['reglage_irreversible'], ['v_numero']],
  ['fixer_source_de_la_vente', ['restauration_hors_bascule', 'source_posee', 'nature_absente', 'mixte', 'frontiere'],
    ['', '', '', '', 'public.exercice_fige(new.dossier_id, extract(year from new.date_emission)::integer)']],
  ['garder_ecriture_vente_facturee', ['ecriture_hors_fonction', 'ecriture_hors_fonction'], ['', '']],
] as const

describe('les refus de la source de la vente, confrontés au texte de leurs fonctions', () => {
  it('la migration est dans l’export, et ses trois fonctions n’y ont qu’une définition', () => {
    const fichiers = fichiersDuSchema().filter((f) => /\/\d{14}_source_de_la_vente\.sql$/.test(f.chemin))
    expect(fichiers).toHaveLength(1)
    for (const [nom] of FONCTIONS) {
      const definitions = fichiersDuSchema().filter((f) => new RegExp(`create (or replace )?function public\\.${nom}\\(`).test(f.texte))
      expect(definitions.map((f) => f.chemin), nom).toEqual([fichiers[0].chemin])
    }
  })

  it('les mêmes messages, dans le même ordre, sous les mêmes codes, avec les mêmes valeurs', () => {
    for (const [nom, cles, valeurs] of FONCTIONS) {
      const sql = derniereDefinitionSql(nom)
      expect(messagesSql(sql), nom).toEqual(cles.map((c) => parCle(c).modele))
      expect(codesSql(sql), nom).toEqual(cles.map((c) => parCle(c).code))
      expect(valeursSql(sql), nom).toEqual([...valeurs])
      cles.forEach((c, i) => expect(parCle(c).modele.split('%').length - 1, `${nom} ${c}`).toBe(valeurs[i] ? 1 : 0))
    }
  })

  it('chaque refus du module appartient à une fonction, et les deux listes n’en oublient aucun', () => {
    const cles = new Set(FONCTIONS.flatMap(([, c]) => c))
    expect([...REFUS_SOURCE_DE_LA_VENTE, ...REFUS_VALIDATION_SOURCE].map((r) => r.cle).sort()).toEqual([...cles].sort())
    // Les refus de la validation sont les trois derniers de `fixer_source_de_la_vente`, dans son ordre.
    expect(REFUS_VALIDATION_SOURCE.map((r) => r.cle)).toEqual(FONCTIONS[1][1].slice(2))
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien.
  it('vire au rouge sur une dérive plantée : un mot, deux refus permutés, un refus ajouté, un code changé', () => {
    const sql = derniereDefinitionSql('fixer_source_de_la_vente')
    const attendu = FONCTIONS[1][1].map((c) => parCle(c).modele)
    expect(messagesSql(sql)).toEqual(attendu)
    const raise = (c: string) => `raise exception '${parCle(c).modele.replace(/'/g, "''")}'`
    const [nature, mixte] = [raise('nature_absente'), raise('mixte')]
    expect(sql).toContain(nature)
    expect(sql).toContain(mixte)
    expect(messagesSql(sql.replace(nature, `${nature.slice(0, -1)} !'`))).not.toEqual(attendu)
    expect(messagesSql(sql.replace(nature, '§').replace(mixte, nature).replace('§', mixte))).not.toEqual(attendu)
    expect(messagesSql(sql.replace(mixte, `raise exception 'Un refus de plus.' using errcode = '23514'; ${mixte}`))).not.toEqual(attendu)
    const code = "using errcode = '42501'"
    expect(codesSql(sql.replace(code, "using errcode = '23514'"))).not.toEqual(FONCTIONS[1][1].map((c) => parCle(c).code))
    const reglage = derniereDefinitionSql('garder_ventes_par_les_factures')
    expect(valeursSql(reglage.replace('v_numero\n', 'v_id\n'))).not.toEqual(['v_numero'])
  })

  it('la garde du réglage nomme la première facture source dans l’ordre que le module rejoue', () => {
    const sql = derniereDefinitionSql('garder_ventes_par_les_factures')
    expect(sql).toContain("order by f.validated_at, f.type = 'avoir', f.numero collate \"C\", f.id")
    expect(sql).toContain('where f.dossier_id = old.id and f.source_de_la_vente')
    expect(sql).toContain('if old.ventes_par_les_factures and not new.ventes_par_les_factures then')
  })

  it('la validation lit le réglage pour une facture, la source de sa facture pour un avoir, puis juge dans cet ordre', () => {
    const sql = derniereDefinitionSql('fixer_source_de_la_vente')
    const ordre = [
      "if new.type = 'avoir' then",
      'select f.source_de_la_vente into v_source from public.factures_emises f where f.id = new.facture_origine_id;',
      'select d.ventes_par_les_factures into v_source from public.dossiers d where d.id = new.dossier_id for share;',
      'new.source_de_la_vente := coalesce(v_source, false);',
      'if new.nature_operation is null then',
      "if new.nature_operation = 'mixte' then",
      'v_frontiere := public.frontiere_validation(new.dossier_id);',
      'if v_frontiere is not null and new.date_emission <= v_frontiere then',
    ]
    const positions = ordre.map((t) => sql.indexOf(t))
    positions.forEach((p, i) => expect(p, ordre[i]).toBeGreaterThan(0))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})

describe('sourceALaValidation — la source qu’une facture prend à sa validation', () => {
  it('une facture prend le réglage de son dossier', () => {
    expect(sourceALaValidation({ type: 'facture' }, true, null)).toBe(true)
    expect(sourceALaValidation({ type: 'facture' }, false, null)).toBe(false)
    // L'origine ne compte pas pour une facture.
    expect(sourceALaValidation({ type: 'facture' }, false, { source_de_la_vente: true })).toBe(false)
  })

  it('un avoir prend la source de la facture qu’il corrige, quel que soit le réglage', () => {
    expect(sourceALaValidation({ type: 'avoir' }, true, { source_de_la_vente: true })).toBe(true)
    // Un avoir d'une facture validée avant la bascule n'est pas source, même dans un dossier qui a basculé.
    expect(sourceALaValidation({ type: 'avoir' }, true, { source_de_la_vente: false })).toBe(false)
    // Le réglage baissé ne change rien à l'avoir d'une facture source (le réglage ne se baisse plus, mais la règle est
    // celle-là).
    expect(sourceALaValidation({ type: 'avoir' }, false, { source_de_la_vente: true })).toBe(true)
    // Sans sa facture, un avoir n'est pas source : la base ne la trouverait pas.
    expect(sourceALaValidation({ type: 'avoir' }, true, null)).toBe(false)
  })
})

describe('refusValidationSource — ce que la validation d’une facture source refuse de plus', () => {
  const VALIDES = [2024, 2025]
  const f = (nature_operation: 'biens' | 'services' | 'mixte' | null, date_emission = '2026-03-01') => ({ nature_operation, date_emission })

  it('une facture qui n’est pas source se valide comme hier : sans nature, mixte, dans un exercice validé', () => {
    for (const facture of [f(null), f('mixte'), f('services', '2025-06-30'), f(null, '2024-01-01')]) {
      expect(refusValidationSource(facture, false, VALIDES)).toBeNull()
    }
  })

  it('une facture source : la nature absente, puis la facture mixte, puis la frontière — chacun avant le suivant', () => {
    expect(refusValidationSource(f(null, '2025-06-30'), true, VALIDES)).toEqual({ cle: 'nature_absente', message: REFUS_VALIDATION_SOURCE[0].modele })
    expect(refusValidationSource(f('mixte', '2025-06-30'), true, VALIDES)).toEqual({ cle: 'mixte', message: REFUS_VALIDATION_SOURCE[1].modele })
    expect(refusValidationSource(f('services', '2025-06-30'), true, VALIDES)?.cle).toBe('frontiere')
    expect(refusValidationSource(f('biens'), true, VALIDES)).toBeNull()
    expect(refusValidationSource(f('services'), true, VALIDES)).toBeNull()
  })

  it('la frontière, sous les deux phrases d’`exercice_fige`, jusqu’au 31 décembre du dernier exercice validé', () => {
    expect(refusValidationSource(f('services', '2025-12-31'), true, VALIDES)?.message)
      .toBe("L'exercice 2025 est validé : une facture source de sa vente, ou son avoir, ne s'y valide plus.")
    expect(refusValidationSource(f('biens', '2023-05-02'), true, [2025])?.message)
      .toBe("L'exercice 2023 est figé par la validation de l'exercice 2025 : une facture source de sa vente, ou son avoir, ne s'y valide plus.")
    expect(refusValidationSource(f('biens', '2026-01-01'), true, VALIDES)).toBeNull()
    // Aucun exercice validé : aucune frontière.
    expect(refusValidationSource(f('biens', '2001-01-01'), true, [])).toBeNull()
  })
})

describe('refusDuReglage — le réglage ne se baisse plus dès qu’une facture source existe', () => {
  const facture = (o: Partial<FacturePourReglage>): FacturePourReglage => ({
    id: '00000000-0000-4000-8000-000000000001', numero: 'F2026-0001', type: 'facture',
    validated_at: '2026-10-19T08:00:00+00:00', source_de_la_vente: true, ...o,
  })
  const nomme = (numero: string) => ({ cle: 'reglage_irreversible', message: `Les factures de ce dossier sont la source de leurs ventes depuis la facture ${numero} : ce réglage ne se défait pas.` })

  it('poser le réglage, le laisser, ou le baisser avant toute facture source : rien', () => {
    expect(refusDuReglage(false, true, [facture({})])).toBeNull()
    expect(refusDuReglage(true, true, [facture({})])).toBeNull()
    expect(refusDuReglage(false, false, [facture({})])).toBeNull()
    expect(refusDuReglage(true, false, [])).toBeNull()
    expect(refusDuReglage(true, false, [facture({ source_de_la_vente: false })])).toBeNull()
  })

  it('le baisser après : refusé, sous le numéro de la première facture source validée', () => {
    expect(refusDuReglage(true, false, [facture({})])).toEqual(nomme('F2026-0001'))
    expect(REGLAGE?.code).toBe('23514')
    const avant = facture({ id: 'b', numero: 'F2026-0009', validated_at: '2026-10-19T07:59:59.999999+00:00' })
    expect(refusDuReglage(true, false, [facture({}), avant])).toEqual(nomme('F2026-0009'))
    // Une facture qui n'est pas source ne se nomme jamais, même validée avant.
    expect(refusDuReglage(true, false, [facture({}), { ...avant, source_de_la_vente: false }])).toEqual(nomme('F2026-0001'))
  })

  it('au même instant, la facture avant son avoir, puis le numéro, octet par octet', () => {
    const instant = '2026-10-19T08:00:00.5+00:00'
    const avoir = facture({ id: 'a', numero: 'A2026-0001', type: 'avoir', validated_at: instant })
    const fact = facture({ id: 'z', numero: 'F2026-0002', validated_at: instant })
    expect(refusDuReglage(true, false, [avoir, fact])).toEqual(nomme('F2026-0002'))
    // Sous `collate "C"`, la majuscule passe avant la minuscule — `localeCompare` dirait l'inverse.
    const minuscule = facture({ id: 'c', numero: 'f2026-0001', validated_at: instant })
    const majuscule = facture({ id: 'd', numero: 'F2026-0003', validated_at: instant })
    expect(refusDuReglage(true, false, [minuscule, majuscule])).toEqual(nomme('F2026-0003'))
  })

  it('un instant écrit avec moins de décimales se range à sa place, et un instant nul en dernier', () => {
    const t0 = facture({ id: '1', numero: 'F-SANS-DECIMALE', validated_at: '2026-10-19T08:00:00+00:00' })
    const t1 = facture({ id: '2', numero: 'F-DEMI-SECONDE', validated_at: '2026-10-19T08:00:00.5+00:00' })
    const t2 = facture({ id: '3', numero: 'F-PLUS-TARD', validated_at: '2026-10-19T08:00:00.45+00:00' })
    expect(refusDuReglage(true, false, [t1, t2, t0])).toEqual(nomme('F-SANS-DECIMALE'))
    expect(refusDuReglage(true, false, [t1, t2])).toEqual(nomme('F-PLUS-TARD'))
    const nul = facture({ id: '0', numero: 'F-NUL', validated_at: null })
    expect(refusDuReglage(true, false, [nul, t1])).toEqual(nomme('F-DEMI-SECONDE'))
    expect(refusDuReglage(true, false, [t1, nul])).toEqual(nomme('F-DEMI-SECONDE'))
    expect(refusDuReglage(true, false, [nul])).toEqual(nomme('F-NUL'))
  })
})

// supabase/essais/ventesFacturees.sql exige de la base chaque refus de la migration sous ses mots et son code ; ses cas
// de la validation et du réglage, rejoués par le module, rendent ce que la base y a rendu.
describe('l’essai de la vente facturée, rejoué par le module', () => {
  const refus = refusExigesParLEssai()
  const etape = (numero: string) => {
    const e = etapesDeLEssai().find((x) => x.controle.startsWith(`${numero}. `))
    expect(e, numero).toBeDefined()
    return e as NonNullable<typeof e>
  }

  it('chaque refus du module y est exigé, sous ses mots et son code', () => {
    for (const r of [...REFUS_SOURCE_DE_LA_VENTE, ...REFUS_VALIDATION_SOURCE]) {
      expect(refus.some((e) => e.code === r.code && correspondAuModele(r.modele, e.attendu)), r.cle).toBe(true)
    }
  })

  it('la validation dans le dossier qui a basculé (exercice 2025 validé) : les cas 11 à 17, et ceux du dossier qui n’a pas basculé', () => {
    const VALIDES = [2025]
    const cas = [
      ['11', { nature_operation: null, date_emission: '2026-03-20' }, true],
      ['12', { nature_operation: 'mixte', date_emission: '2026-03-20' }, true],
      ['13', { nature_operation: 'biens', date_emission: '2025-07-01' }, true],
      ['14', { nature_operation: 'services', date_emission: '2024-07-01' }, true],
      ['16', { nature_operation: null, date_emission: '2025-07-01' }, true],
      ['17', { nature_operation: 'mixte', date_emission: '2025-07-01' }, true],
      ['18b', { nature_operation: 'mixte', date_emission: '2025-07-01' }, false],
    ] as const
    for (const [numero, facture, source] of cas) {
      const e = etape(numero)
      const r = refusValidationSource(facture, source, VALIDES)
      if (e.code === 'OK') expect(r, numero).toBeNull()
      else expect(correspondAuModele(e.attendu, (r as NonNullable<typeof r>).message) || correspondAuModele((r as NonNullable<typeof r>).message, e.attendu), numero).toBe(true)
    }
    // L'avoir d'une facture source prend sa source, et la frontière le refuse comme elle (15).
    expect(sourceALaValidation({ type: 'avoir' }, true, { source_de_la_vente: true })).toBe(true)
    expect(refusValidationSource({ nature_operation: 'services', date_emission: '2025-12-31' }, true, VALIDES)?.message).toBe(etape('15').attendu)
  })

  it('le réglage baissé (3) : la facture validée la première, au même instant, par son numéro', () => {
    const instant = '2026-10-19T08:00:00+00:00'
    const facture = (numero: string, type: 'facture' | 'avoir'): FacturePourReglage =>
      ({ id: numero, numero, type, validated_at: instant, source_de_la_vente: true })
    const sources = [facture('F2026-0002', 'facture'), facture('A2026-0001', 'avoir'), facture('F2025-0001', 'facture')]
    expect(refusDuReglage(true, false, sources)?.message).toBe(etape('3').attendu)
    expect(etape('3').code).toBe(REFUS_SOURCE_DE_LA_VENTE[0].code)
  })
})
