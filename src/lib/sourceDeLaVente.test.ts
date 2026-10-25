import { describe, expect, it } from 'vitest'
import {
  REFUS_SOURCE_DE_LA_VENTE, REFUS_VALIDATION_SOURCE, FRONTIERE_NON_LUE_AU_CABINET, confirmationDeLaSource, jugementDeLaValidation, phraseDeLAvoirDAvant,
  phraseDuReglageIllisible, reglageDesVentes, refusDuReglage, refusValidationSource, sourceALaValidation,
  type ContexteDuReglage, type FacturePourReglage,
} from './sourceDeLaVente'
import { ANNEES_ILLISIBLES, FRONTIERE_JUGEE_PAR_LA_BASE } from './encaissementsFactures'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import type { FactureEmise } from './types'
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

// Chaque fonction, sa DERNIÈRE définition dans l'export, ses refus dans l'ordre de son texte, et la valeur de chaque « % ».
const FONCTIONS = [
  ['garder_ventes_par_les_factures', ['reglage_irreversible', 'reglage_reserve_au_chef', 'reglage_retenu_par_ventes'],
    ['v_numero', '', '']],
  ['fixer_source_de_la_vente', ['restauration_hors_bascule', 'source_posee', 'nature_absente', 'mixte', 'frontiere'],
    ['', '', '', '', 'public.exercice_fige(new.dossier_id, extract(year from new.date_emission)::integer)']],
  ['garder_ecriture_vente_facturee', ['ecriture_hors_fonction', 'ecriture_hors_fonction'], ['', '']],
] as const

// Les fichiers de l'export qui définissent chaque fonction : la migration `source_de_la_vente`, et, pour la garde du
// réglage, la migration `reglage_des_ventes` de l'étape VF8a (préparée, sous une version provisoire), qui la remplace.
const migration = (nom: string) => {
  const fichiers = fichiersDuSchema().filter((f) => new RegExp(`/\\d{14}_${nom}\\.sql$`).test(f.chemin))
  expect(fichiers, nom).toHaveLength(1)
  return fichiers[0]
}
const DEFINIE_DANS: Record<(typeof FONCTIONS)[number][0], readonly string[]> = {
  garder_ventes_par_les_factures: ['source_de_la_vente', 'reglage_des_ventes'],
  fixer_source_de_la_vente: ['source_de_la_vente'],
  garder_ecriture_vente_facturee: ['source_de_la_vente'],
}

// Les lignes de CODE d'un corps de fonction : sans ses commentaires, qui peuvent citer une condition sans la juger.
const lignesDeCode = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

describe('les refus de la source de la vente, confrontés au texte de leurs fonctions', () => {
  it('les deux migrations sont dans l’export, et chaque fonction n’y a que les définitions qu’elles posent', () => {
    for (const [nom] of FONCTIONS) {
      const definitions = fichiersDuSchema().filter((f) => new RegExp(`create (or replace )?function public\\.${nom}\\(`).test(f.texte))
      expect(definitions.map((f) => f.chemin), nom).toEqual(DEFINIE_DANS[nom].map((m) => migration(m).chemin))
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
    // Les refus de la validation sont les trois derniers de `fixer_source_de_la_vente`, dans son ordre ; les autres suivent
    // l'ordre du texte : les trois de la garde du réglage, puis les deux premiers de la validation, puis celui des écritures.
    expect(REFUS_VALIDATION_SOURCE.map((r) => r.cle)).toEqual(FONCTIONS[1][1].slice(2))
    expect(REFUS_SOURCE_DE_LA_VENTE.map((r) => r.cle)).toEqual([...FONCTIONS[0][1], ...FONCTIONS[1][1].slice(0, 2), FONCTIONS[2][1][0]])
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

  // L'étape VF8a : la garde remplacée juge dans l'ordre que `refusDuReglage` rejoue, et date la bascule.
  const ORDRE_DE_LA_GARDE = [
    "if tg_op = 'INSERT' then",
    'if not public.is_super_admin() then',
    'new.ventes_par_les_factures_depuis := case when new.ventes_par_les_factures then now() end;',
    'return new;',
    'if old.ventes_par_les_factures and not new.ventes_par_les_factures then',
    "raise exception 'Les factures de ce dossier sont la source de leurs ventes depuis la facture %",
    'if new.ventes_par_les_factures is distinct from old.ventes_par_les_factures then',
    'if auth.uid() is not null and not public.est_chef_du_cabinet(old.cabinet_id) then',
    "raise exception 'Seul le chef du cabinet",
    'if old.ventes_par_les_factures',
    'and exists (select 1 from public.memberships m where m.dossier_id = old.id and m.droit_ventes) then',
    "raise exception 'Un accès client de ce dossier porte le droit « Ventes »",
    'new.ventes_par_les_factures_depuis := case when new.ventes_par_les_factures then now() end;',
    'else',
    'new.ventes_par_les_factures_depuis := old.ventes_par_les_factures_depuis;',
  ]
  const positionsDansLOrdre = (sql: string) => {
    let depuis = 0
    return ORDRE_DE_LA_GARDE.map((t) => {
      const p = sql.indexOf(t, depuis)
      if (p >= 0) depuis = p + t.length
      return p
    })
  }

  it('la garde du réglage (étape VF8a) : l’insertion, puis la facture source, la personne, le droit « Ventes », la date', () => {
    const code = lignesDeCode(derniereDefinitionSql('garder_ventes_par_les_factures'))
    const positions = positionsDansLOrdre(code)
    positions.forEach((p, i) => expect(p, ORDRE_DE_LA_GARDE[i]).toBeGreaterThan(0))
    // Une seule date posée par mise à jour : l'insertion la pose à part, avant son `return`.
    expect(code.split('new.ventes_par_les_factures_depuis := case when new.ventes_par_les_factures then now() end;')).toHaveLength(3)
  })

  it('LA CONDITION QUI PORTE VF8-Q1 : la personne se juge une fois, par le chef du cabinet du dossier, depuis une session', () => {
    const code = lignesDeCode(derniereDefinitionSql('garder_ventes_par_les_factures'))
    expect(code.split('est_chef_du_cabinet(')).toHaveLength(2)
    expect(code).toContain('if auth.uid() is not null and not public.est_chef_du_cabinet(old.cabinet_id) then')
    // Rien d'autre ne juge la personne : ni le membre assigné (ce que VF8-Q1 écarte), ni une autre lecture de la session.
    expect(code).not.toContain('admin_du_dossier(')
    expect(code.split('auth.uid()')).toHaveLength(2)
    // Le super-administrateur ne se lit qu'à l'insertion : la restauration réinsère la date telle.
    expect(code.split('is_super_admin()')).toHaveLength(2)
    expect(code.indexOf('is_super_admin()')).toBeLessThan(code.indexOf('if old.ventes_par_les_factures and not new.ventes_par_les_factures then'))
  })

  it('le déclencheur de la garde, étendu à l’insertion et à la colonne de la date', () => {
    const texte = migration('reglage_des_ventes').texte
    expect(texte).toContain('create or replace trigger dossiers_ventes_par_les_factures\n'
      + '  before insert or update of ventes_par_les_factures, ventes_par_les_factures_depuis on public.dossiers\n'
      + '  for each row execute function public.garder_ventes_par_les_factures();')
    expect(texte).toContain('alter table public.dossiers add column ventes_par_les_factures_depuis timestamptz;')
    // Elle vérifie d'abord le corps qu'elle remplace : celui de la migration `source_de_la_vente`, et de la production.
    expect(texte).toContain("chr(13), '')) <> '6d9776e437d00c6d0d68bbfa1f1dda50' then")
    // Rien ne se retire : ni la colonne, ni la garde, ni le déclencheur.
    expect(texte).not.toMatch(/\b(drop|delete|truncate)\b/i)
  })

  it('vire au rouge sur une dérive plantée de la garde : deux refus permutés, un code changé, la personne jugée ailleurs', () => {
    const sql = derniereDefinitionSql('garder_ventes_par_les_factures')
    const attendu = FONCTIONS[0][1].map((c) => parCle(c).modele)
    expect(messagesSql(sql)).toEqual(attendu)
    const bloc = (debut: string, fin: string) => sql.slice(sql.indexOf(debut), sql.indexOf(fin, sql.indexOf(debut)) + fin.length)
    const personne = bloc('    if auth.uid() is not null', "errcode = '42501';\n    end if;\n")
    const ventes = bloc('    if old.ventes_par_les_factures\n', "errcode = '23514';\n    end if;\n")
    expect(personne.length).toBeGreaterThan(0)
    expect(ventes.length).toBeGreaterThan(0)
    const permutee = sql.replace(personne, '§').replace(ventes, personne).replace('§', ventes)
    expect(messagesSql(permutee)).not.toEqual(attendu)
    expect(positionsDansLOrdre(lignesDeCode(permutee)).some((p) => p < 0)).toBe(true)
    expect(codesSql(sql.replace("using errcode = '42501'", "using errcode = '23514'"))).not.toEqual(FONCTIONS[0][1].map((c) => parCle(c).code))
    const ailleurs = sql.replace('public.est_chef_du_cabinet(old.cabinet_id)', 'public.admin_du_dossier(old.id)')
    expect(lignesDeCode(ailleurs)).toContain('admin_du_dossier(')
    expect(lignesDeCode(ailleurs).split('est_chef_du_cabinet(')).toHaveLength(1)
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

// Le chef du cabinet, sans accès client : seule la facture source le retient (le cas d'hier).
const CHEF: ContexteDuReglage = { chefDuCabinet: true, acces: [] }
const MEMBRE: ContexteDuReglage = { chefDuCabinet: false, acces: [] }
const VENTES = { droit_ventes: true }
const SANS_VENTES = { droit_ventes: false }

describe('refusDuReglage — le réglage ne se baisse plus dès qu’une facture source existe', () => {
  const facture = (o: Partial<FacturePourReglage>): FacturePourReglage => ({
    id: '00000000-0000-4000-8000-000000000001', numero: 'F2026-0001', type: 'facture',
    validated_at: '2026-10-19T08:00:00+00:00', source_de_la_vente: true, ...o,
  })
  const nomme = (numero: string) => ({ cle: 'reglage_irreversible', message: `Les factures de ce dossier sont la source de leurs ventes depuis la facture ${numero} : ce réglage ne se défait pas.` })

  it('poser le réglage, le laisser, ou le baisser avant toute facture source : rien', () => {
    expect(refusDuReglage(false, true, [facture({})], CHEF)).toBeNull()
    expect(refusDuReglage(true, true, [facture({})], CHEF)).toBeNull()
    expect(refusDuReglage(false, false, [facture({})], CHEF)).toBeNull()
    expect(refusDuReglage(true, false, [], CHEF)).toBeNull()
    expect(refusDuReglage(true, false, [facture({ source_de_la_vente: false })], CHEF)).toBeNull()
  })

  it('le baisser après : refusé, sous le numéro de la première facture source validée', () => {
    expect(refusDuReglage(true, false, [facture({})], CHEF)).toEqual(nomme('F2026-0001'))
    expect(REGLAGE?.code).toBe('23514')
    const avant = facture({ id: 'b', numero: 'F2026-0009', validated_at: '2026-10-19T07:59:59.999999+00:00' })
    expect(refusDuReglage(true, false, [facture({}), avant], CHEF)).toEqual(nomme('F2026-0009'))
    // Une facture qui n'est pas source ne se nomme jamais, même validée avant.
    expect(refusDuReglage(true, false, [facture({}), { ...avant, source_de_la_vente: false }], CHEF)).toEqual(nomme('F2026-0001'))
  })

  it('au même instant, la facture avant son avoir, puis le numéro, octet par octet', () => {
    const instant = '2026-10-19T08:00:00.5+00:00'
    const avoir = facture({ id: 'a', numero: 'A2026-0001', type: 'avoir', validated_at: instant })
    const fact = facture({ id: 'z', numero: 'F2026-0002', validated_at: instant })
    expect(refusDuReglage(true, false, [avoir, fact], CHEF)).toEqual(nomme('F2026-0002'))
    // Sous `collate "C"`, la majuscule passe avant la minuscule — `localeCompare` dirait l'inverse.
    const minuscule = facture({ id: 'c', numero: 'f2026-0001', validated_at: instant })
    const majuscule = facture({ id: 'd', numero: 'F2026-0003', validated_at: instant })
    expect(refusDuReglage(true, false, [minuscule, majuscule], CHEF)).toEqual(nomme('F2026-0003'))
  })

  it('un instant écrit avec moins de décimales se range à sa place, et un instant nul en dernier', () => {
    const t0 = facture({ id: '1', numero: 'F-SANS-DECIMALE', validated_at: '2026-10-19T08:00:00+00:00' })
    const t1 = facture({ id: '2', numero: 'F-DEMI-SECONDE', validated_at: '2026-10-19T08:00:00.5+00:00' })
    const t2 = facture({ id: '3', numero: 'F-PLUS-TARD', validated_at: '2026-10-19T08:00:00.45+00:00' })
    expect(refusDuReglage(true, false, [t1, t2, t0], CHEF)).toEqual(nomme('F-SANS-DECIMALE'))
    expect(refusDuReglage(true, false, [t1, t2], CHEF)).toEqual(nomme('F-PLUS-TARD'))
    const nul = facture({ id: '0', numero: 'F-NUL', validated_at: null })
    expect(refusDuReglage(true, false, [nul, t1], CHEF)).toEqual(nomme('F-DEMI-SECONDE'))
    expect(refusDuReglage(true, false, [t1, nul], CHEF)).toEqual(nomme('F-DEMI-SECONDE'))
    expect(refusDuReglage(true, false, [nul], CHEF)).toEqual(nomme('F-NUL'))
  })
})

describe('refusDuReglage — le réglage gardé (étape VF8a) : qui le change, ce qui le retient', () => {
  const source: FacturePourReglage = {
    id: '00000000-0000-4000-8000-000000000001', numero: 'F2025-0001', type: 'facture',
    validated_at: '2026-10-19T08:00:00+00:00', source_de_la_vente: true,
  }
  const pasSource: FacturePourReglage = { ...source, id: '00000000-0000-4000-8000-000000000002', numero: 'F2026-0001', source_de_la_vente: false }
  const PERSONNE = { cle: 'reglage_reserve_au_chef', message: "Seul le chef du cabinet change la source des ventes d'un dossier." }
  const RETENU = {
    cle: 'reglage_retenu_par_ventes',
    message: "Un accès client de ce dossier porte le droit « Ventes », qui suppose que ses factures soient la source de leurs ventes : retirer d'abord ce droit.",
  }

  it('un membre de l’équipe ne le pose ni ne le baisse (VF8-Q1) ; le chef, si', () => {
    expect(refusDuReglage(false, true, [], MEMBRE)).toEqual(PERSONNE)
    expect(refusDuReglage(true, false, [pasSource], MEMBRE)).toEqual(PERSONNE)
    expect(refusDuReglage(false, true, [pasSource], CHEF)).toBeNull()
    expect(refusDuReglage(true, false, [pasSource], CHEF)).toBeNull()
    expect(parCle('reglage_reserve_au_chef').code).toBe('42501')
  })

  it('un réglage qui ne change pas ne se juge pas, même d’un membre, même sous un accès « Ventes »', () => {
    for (const valeur of [false, true]) {
      expect(refusDuReglage(valeur, valeur, [source], { chefDuCabinet: false, acces: [VENTES] })).toBeNull()
    }
  })

  it('le droit « Ventes » d’un accès retient la baisse ; « Banque » seul, ou aucun accès, rien ; pour le poser, rien', () => {
    expect(refusDuReglage(true, false, [], { chefDuCabinet: true, acces: [SANS_VENTES, VENTES] })).toEqual(RETENU)
    expect(parCle('reglage_retenu_par_ventes').code).toBe('23514')
    expect(refusDuReglage(true, false, [], { chefDuCabinet: true, acces: [SANS_VENTES] })).toBeNull()
    expect(refusDuReglage(false, true, [], { chefDuCabinet: true, acces: [VENTES] })).toBeNull()
  })

  it('l’ordre de la garde : la facture source, puis la personne, puis le droit « Ventes »', () => {
    const tout: ContexteDuReglage = { chefDuCabinet: false, acces: [VENTES] }
    expect(refusDuReglage(true, false, [source], tout)?.cle).toBe('reglage_irreversible')
    expect(refusDuReglage(true, false, [pasSource], tout)?.cle).toBe('reglage_reserve_au_chef')
    expect(refusDuReglage(true, false, [pasSource], { ...tout, chefDuCabinet: true })?.cle).toBe('reglage_retenu_par_ventes')
    // Le membre qui pose : la personne seule (ni facture source ni « Ventes » ne retiennent une bascule).
    expect(refusDuReglage(false, true, [source], tout)?.cle).toBe('reglage_reserve_au_chef')
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
    expect(refusDuReglage(true, false, sources, CHEF)?.message).toBe(etape('3').attendu)
    expect(etape('3').code).toBe(REFUS_SOURCE_DE_LA_VENTE[0].code)
  })

  // Le réglage gardé (étape VF8a) : chaque contrôle de l'essai qui change le réglage, rejoué par le module sur ce que la base
  // y a lu — T a basculé et porte des factures sources (la première, F2025-0001) ; R a basculé sans facture ; A n'a pas
  // basculé, et ses factures ne sont pas sources. Le propriétaire et le chef simple passent la garde de la personne comme
  // le chef ; le membre affecté, non. `acces` : les accès du dossier que le contrôle pose.
  it('le réglage gardé (6 à 6g, 8 à 8f, 189 et 190) : le refus, ses mots et son code, ou rien, comme la base', () => {
    const instant = '2026-10-19T08:00:00+00:00'
    const SOURCES_DE_T: FacturePourReglage[] = [
      { id: 'f25', numero: 'F2025-0001', type: 'facture', validated_at: instant, source_de_la_vente: true },
      { id: 'f26', numero: 'F2026-0002', type: 'facture', validated_at: '2026-10-19T08:00:01+00:00', source_de_la_vente: true },
    ]
    const FACTURE_DE_A: FacturePourReglage[] = [{ id: 'fa', numero: 'F2026-0001', type: 'facture', validated_at: instant, source_de_la_vente: false }]
    const dossier = { T: { avant: true, factures: SOURCES_DE_T }, R: { avant: true, factures: [] }, A: { avant: false, factures: FACTURE_DE_A } }
    const cas: [string, keyof typeof dossier, boolean, ContexteDuReglage][] = [
      ['6', 'A', true, MEMBRE],
      ['6b', 'R', false, MEMBRE],
      ['6c', 'T', false, MEMBRE],
      ['6g', 'R', false, { chefDuCabinet: false, acces: [VENTES] }],
      ['8', 'R', false, { chefDuCabinet: true, acces: [VENTES] }],
      ['8b', 'R', false, { chefDuCabinet: true, acces: [VENTES] }],
      ['8c', 'T', false, { chefDuCabinet: true, acces: [VENTES] }],
      ['8d', 'R', false, { chefDuCabinet: true, acces: [{ droit_ventes: false }] }],
      ['8e', 'R', false, CHEF],
      ['8f', 'A', true, { chefDuCabinet: true, acces: [VENTES] }],
      ['189', 'A', true, CHEF],
      ['190', 'R', false, { chefDuCabinet: true, acces: [{ droit_ventes: false }] }],
    ]
    for (const [numero, d, apres, contexte] of cas) {
      const e = etape(numero)
      const r = refusDuReglage(dossier[d].avant, apres, dossier[d].factures, contexte)
      if (e.code === 'OK') expect(r, numero).toBeNull()
      else {
        expect(r?.message, numero).toBe(e.attendu)
        expect(parCle((r as NonNullable<typeof r>).cle).code, numero).toBe(e.code)
      }
    }
    // Le profil de chaque contrôle rejoué : le membre affecté pour 6 à 6g, un chef ou le propriétaire pour les autres.
    expect(cas.map(([n]) => etape(n).profil)).toEqual(
      ['membre', 'membre', 'membre', 'membre', 'chef', 'postgres', 'chef', 'chef', 'chef', 'chef', 'chef_simple', 'chef'])
  })
})

// LA FACTURE D'UN DOSSIER BASCULÉ, À L'ÉCRAN (étape VF8c) : le réglage lu, et ce que la validation d'une facture ou d'un avoir
// rencontre de plus — chaque refus par `refusValidationSource` elle-même, sous les mots de chaque espace.
describe('reglageDesVentes — le réglage tel que l’écran d’une facture l’a lu', () => {
  it('pas basculé : rien d’autre n’est exigé, ni le modèle comptable, ni les exercices validés', () => {
    expect(reglageDesVentes({ ventes_par_les_factures: false }, null)).toEqual({ etat: 'non_bascule', anneesValidees: ANNEES_ILLISIBLES })
    expect(reglageDesVentes({ ventes_par_les_factures: false, mode_comptable: 'x' }, [2025]))
      .toEqual({ etat: 'non_bascule', anneesValidees: [2025] })
  })

  it('basculé : le modèle comptable et les exercices validés, ou les exercices illisibles du client', () => {
    expect(reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'engagement' }, [2024]))
      .toEqual({ etat: 'bascule', modeComptable: 'engagement', anneesValidees: [2024] })
    expect(reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, ANNEES_ILLISIBLES))
      .toEqual({ etat: 'bascule', modeComptable: 'tresorerie', anneesValidees: ANNEES_ILLISIBLES })
  })

  it('une colonne absente n’est pas nulle : rien de lu, un réglage, un modèle ou des exercices illisibles', () => {
    expect(reglageDesVentes(null, []).etat).toBe('illisible')
    // Le modèle comptable lisible : seul le réglage est en cause.
    for (const v of [undefined, null, 'true', 1, 0, '']) {
      expect(reglageDesVentes({ ventes_par_les_factures: v, mode_comptable: 'tresorerie' }, []).etat, String(v)).toBe('illisible')
    }
    for (const m of [undefined, null, 'mixte']) {
      expect(reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: m }, []).etat, String(m)).toBe('illisible')
    }
    expect(reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, null))
      .toEqual({ etat: 'illisible', motif: 'les exercices validés n’ont pas été lus' })
  })
})

describe('jugementDeLaValidation — ce que la validation d’une facture rencontre de plus, dans chaque espace', () => {
  const NON_BASCULE = reglageDesVentes({ ventes_par_les_factures: false }, [2025])
  const BASCULE = reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, [2025])
  const BASCULE_ENGAGEMENT = reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'engagement' }, [2025])
  const BASCULE_CLIENT = reglageDesVentes({ ventes_par_les_factures: true, mode_comptable: 'tresorerie' }, ANNEES_ILLISIBLES)
  const facture = (f: Partial<Pick<FactureEmise, 'type' | 'nature_operation' | 'date_emission'>> = {}) =>
    ({ type: 'facture' as const, nature_operation: 'services' as const, date_emission: '2026-03-01', ...f })
  const ESPACES = ['cabinet', 'client'] as const
  const message = (cle: string, ...valeurs: string[]) => {
    const r = REFUS_VALIDATION_SOURCE.find((x) => x.cle === cle) as { modele: string }
    return valeurs.reduce((m, v) => m.replace('%', v), r.modele)
  }

  it('un dossier qui n’a pas basculé : rien de plus, dans les deux espaces, quelle que soit la saisie', () => {
    for (const espace of ESPACES) {
      for (const f of [facture(), facture({ nature_operation: null }), facture({ nature_operation: 'mixte', date_emission: '2025-06-01' })]) {
        expect(jugementDeLaValidation(espace, f, NON_BASCULE, null)).toEqual({ source: false, refus: null, avis: null, confirmation: null })
      }
      // L'avoir d'une facture qui n'est pas source, dans un dossier qui n'a pas basculé : aucun avis, comme hier.
      expect(jugementDeLaValidation(espace, facture({ type: 'avoir' }), NON_BASCULE, { source_de_la_vente: false }))
        .toEqual({ source: false, refus: null, avis: null, confirmation: null })
    }
  })

  it('basculé, la nature absente, puis la facture mixte, au cabinet sous les mots de la base', () => {
    expect(jugementDeLaValidation('cabinet', facture({ nature_operation: null }), BASCULE, null).refus).toBe(message('nature_absente'))
    expect(jugementDeLaValidation('cabinet', facture({ nature_operation: 'mixte' }), BASCULE, null).refus).toBe(message('mixte'))
    expect(jugementDeLaValidation('cabinet', facture({ nature_operation: null, date_emission: '2025-01-01' }), BASCULE, null).refus)
      .toBe(message('nature_absente'))
  })

  it('basculé, la frontière d’un exercice validé, au cabinet : le 31 décembre refusé, le 1er janvier non', () => {
    expect(jugementDeLaValidation('cabinet', facture({ date_emission: '2025-12-31' }), BASCULE, null).refus)
      .toBe(message('frontiere', 'L\'exercice 2025 est validé'))
    expect(jugementDeLaValidation('cabinet', facture({ date_emission: '2026-01-01' }), BASCULE, null).refus).toBeNull()
  })

  it('chez le client, les mêmes refus réécrits, tutoyés, sans onglet ; la frontière jugée par la base, et dite', () => {
    const nature = jugementDeLaValidation('client', facture({ nature_operation: null }), BASCULE_CLIENT, null)
    expect(nature.refus).toBe(pourLEspace('client', message('nature_absente')))
    expect(nature.refus).not.toBe(message('nature_absente'))
    const mixte = jugementDeLaValidation('client', facture({ nature_operation: 'mixte' }), BASCULE_CLIENT, null)
    expect(mixte.refus).toBe(pourLEspace('client', message('mixte')))
    expect(mixte.refus).not.toBe(message('mixte'))
    const frontiere = jugementDeLaValidation('client', facture({ date_emission: '2020-01-01' }), BASCULE_CLIENT, null)
    expect(frontiere.refus).toBeNull()
    expect(frontiere.avis).toBe(FRONTIERE_JUGEE_PAR_LA_BASE)
    for (const j of [nature, mixte, frontiere]) {
      for (const texte of [j.refus, j.avis, j.confirmation]) if (texte) expect(motsDuCabinet(texte), texte).toEqual([])
    }
  })

  it('la confirmation d’une facture source : à ses encaissements en trésorerie, à sa date en engagement', () => {
    const tresorerie = jugementDeLaValidation('cabinet', facture(), BASCULE, null)
    expect(tresorerie).toMatchObject({ source: true, refus: null, avis: null })
    expect(tresorerie.confirmation).toBe(confirmationDeLaSource('cabinet', 'facture', 'tresorerie'))
    expect(tresorerie.confirmation).toContain('à ses encaissements')
    expect(jugementDeLaValidation('cabinet', facture(), BASCULE_ENGAGEMENT, null).confirmation).toContain('à sa date,')
    const client = jugementDeLaValidation('client', facture(), BASCULE_CLIENT, null).confirmation as string
    expect(client).toContain('ta comptabilité à ses encaissements')
    expect(motsDuCabinet(client)).toEqual([])
  })

  it('l’avoir d’une facture d’avant la bascule : pas source, rien de refusé, même mixte ou au-delà de la frontière ; un avis', () => {
    for (const espace of ESPACES) {
      const reglage = espace === 'client' ? BASCULE_CLIENT : BASCULE
      const j = jugementDeLaValidation(espace, facture({ type: 'avoir', nature_operation: 'mixte', date_emission: '2025-06-01' }), reglage, { source_de_la_vente: false })
      expect(j).toEqual({ source: false, refus: null, avis: phraseDeLAvoirDAvant(espace), confirmation: null })
      // Sans la facture lue, comme la base qui ne la trouverait pas : pas source.
      expect(jugementDeLaValidation(espace, facture({ type: 'avoir' }), reglage, null).source).toBe(false)
    }
    expect(motsDuCabinet(phraseDeLAvoirDAvant('client'))).toEqual([])
  })

  it('l’avoir d’une facture source : la frontière seule, au cabinet ; sa confirmation dans chaque espace', () => {
    const origine = { source_de_la_vente: true }
    expect(jugementDeLaValidation('cabinet', facture({ type: 'avoir', date_emission: '2025-12-31' }), BASCULE, origine).refus)
      .toBe(message('frontiere', 'L\'exercice 2025 est validé'))
    const j = jugementDeLaValidation('cabinet', facture({ type: 'avoir', date_emission: '2026-02-01' }), BASCULE, origine)
    expect(j).toEqual({ source: true, refus: null, avis: null, confirmation: confirmationDeLaSource('cabinet', 'avoir', null) })
    const c = jugementDeLaValidation('client', facture({ type: 'avoir', date_emission: '2020-02-01' }), BASCULE_CLIENT, origine)
    expect(c).toEqual({ source: true, refus: null, avis: FRONTIERE_JUGEE_PAR_LA_BASE, confirmation: confirmationDeLaSource('client', 'avoir', null) })
    // Au cabinet, des exercices qui ne lui seraient pas parvenus : la même réserve, vouvoyée.
    const sansExercices = reglageDesVentes({ ventes_par_les_factures: false }, null)
    expect(jugementDeLaValidation('cabinet', facture({ type: 'avoir' }), sansExercices, origine).avis).toBe(FRONTIERE_NON_LUE_AU_CABINET)
  })

  it('le réglage illisible : la validation retenue, la phrase de chaque espace, son motif dit', () => {
    const illisible = reglageDesVentes({ ventes_par_les_factures: undefined }, [])
    for (const espace of ESPACES) {
      for (const f of [facture(), facture({ type: 'avoir' })]) {
        const j = jugementDeLaValidation(espace, f, illisible, { source_de_la_vente: false })
        expect(j).toEqual({ source: null, refus: phraseDuReglageIllisible(espace, 'le réglage n’est pas lisible'), avis: null, confirmation: null })
        expect(j.refus).toContain('le réglage n’est pas lisible')
      }
    }
    expect(motsDuCabinet(phraseDuReglageIllisible('client', 'x'))).toEqual([])
  })
})
