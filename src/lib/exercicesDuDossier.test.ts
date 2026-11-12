import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CHOIX_RECOMMANDES, EXERCICES_DECALES_PREVUS, type ExerciceDeclare, refusDesExercices, refusDUnExercice, TABLES_DES_EXERCICES,
} from './exercices'

// LES EXERCICES DU DOSSIER, EN BASE (ligne 42, EXD2) : la migration PRÉPARÉE confrontée à son jumeau, src/lib/exercices.ts —
// les refus aux mêmes mots et dans le même ordre (la garde AVANT chaque ligne, la suite APRÈS, donc à la fin de
// l'instruction), puis les messages exacts que l'essai de la réplique attend, recalculés par le module sur les mêmes
// exercices. L'essai (supabase/essais/exercicesDuDossier.sql) prouve la base ; ce test prouve que la base et le module
// parlent pareil.

const RACINE = new URL('../../', import.meta.url)
const PREPAREES = new URL('supabase/preparees/', RACINE)
const NOM = readdirSync(PREPAREES).find((n) => /^\d{14}_exercices_du_dossier\.sql$/.test(n))!
const MIGRATION = readFileSync(new URL(NOM, PREPAREES), 'utf8')
const RETOUR = readFileSync(new URL('retour/20261112210100_retour_exercices_du_dossier.sql', PREPAREES), 'utf8')
const ESSAI = readFileSync(new URL('supabase/essais/exercicesDuDossier.sql', RACINE), 'utf8')

/** Le corps d'une fonction de la migration, de son `create function` à la fin de son corps. */
function corps(nom: string): string {
  const debut = new RegExp(`create function public\\.${nom}\\(`, 'i').exec(MIGRATION)?.index ?? -1
  expect(debut, nom).toBeGreaterThanOrEqual(0)
  return MIGRATION.slice(debut, MIGRATION.indexOf('\n$$;', debut))
}
/** Un message tel que la migration l'écrit : l'apostrophe doublée. */
const enSql = (m: string) => m.replace(/'/g, "''")
/** Le gabarit d'un message du module : ses dates, et les valeurs nommées, deviennent les `%` d'un `raise`. */
function gabarit(message: string, valeurs: string[] = []): string {
  let g = message.replace(/\d{2}\/\d{2}\/\d{4}/g, '%')
  for (const v of valeurs) g = g.replace(v, '%')
  return g
}

const ex = (e: Partial<ExerciceDeclare> & Pick<ExerciceDeclare, 'debut' | 'fin'>): ExerciceDeclare => ({
  nature: 'ordinaire', decision: null, decision_le: null, ...e,
})
const premier = (debut: string, fin: string) => ex({ debut, fin, nature: 'premier' })
const transition = (debut: string, fin: string, decision: string | null = 'AGE', decisionLe: string | null = '2026-01-01') =>
  ex({ debut, fin, nature: 'transition', decision, decision_le: decisionLe })
/** Le premier refus du module : celui que la base lève. */
const premierRefus = (exercices: ExerciceDeclare[], mode: 'engagement' | 'tresorerie' = 'engagement') =>
  refusDesExercices(mode, exercices, CHOIX_RECOMMANDES)[0]?.message

// Les gabarits, dans l'ordre du module : la garde (avant chaque ligne), puis la suite (après).
const GARDE = [
  gabarit(premierRefus([ex({ debut: '2026-01-01', fin: '2026-12-31' })], 'tresorerie'), ['2026']),
  gabarit(premierRefus([ex({ debut: '2026-07-01', fin: '2027-06-30' })], 'tresorerie')),
  gabarit(refusDUnExercice(premier('0999-12-31', '2026-12-31'), CHOIX_RECOMMANDES)[0].message, ['0999-12-31']),
  gabarit(refusDUnExercice(premier('2026-01-01', '10000-01-01'), CHOIX_RECOMMANDES)[0].message, ['10000-01-01']),
  gabarit(premierRefus([premier('2026-03-15', '2026-03-14')])),
  gabarit(premierRefus([ex({ debut: '2026-03-15', fin: '2026-12-31', nature: 'courant' as ExerciceDeclare['nature'] })]), ['courant']),
  gabarit(premierRefus([premier('2026-03-15', '2028-01-31')])),
  gabarit(premierRefus([ex({ debut: '2026-03-15', fin: '2027-03-15' })])),
  gabarit(premierRefus([transition('2026-03-15', '2028-02-15')])),
  premierRefus([transition('2026-03-15', '2026-12-31', '   ')]),
  premierRefus([premier('2026-03-15', '2026-12-31')].map((e) => ({ ...e, decision: 'AGE' }))),
]
const SUITE = [
  gabarit(premierRefus([ex({ debut: '2027-07-01', fin: '2028-06-30' }), premier('2028-07-01', '2029-06-30')])),
  gabarit(premierRefus([ex({ debut: '2027-07-01', fin: '2028-06-30' }), ex({ debut: '2028-01-01', fin: '2028-12-31' })])),
  gabarit(premierRefus([ex({ debut: '2027-07-01', fin: '2028-06-30' }), ex({ debut: '2028-08-01', fin: '2029-07-31' })])),
  gabarit(premierRefus([ex({ debut: '2027-07-01', fin: '2028-06-30' }), transition('2028-07-01', '2028-12-31')]), ['2', '2028'])
    .replace('(du % au % ; du % au %)', '(%)'),
]

describe('le drapeau et la migration préparée', () => {
  it('le drapeau est baissé tant que la migration n’est pas dans l’export', () => {
    const exportee = readdirSync(new URL('supabase/schema/', RACINE)).some((n) => /^\d{14}_exercices_du_dossier\.sql$/.test(n))
    expect(EXERCICES_DECALES_PREVUS).toBe(exportee)
    expect(EXERCICES_DECALES_PREVUS).toBe(false)
  })

  it('la migration crée la table du module, ni drop ni truncate ni suppression de ligne, sans barre oblique inverse ni retour chariot', () => {
    for (const t of TABLES_DES_EXERCICES) expect(MIGRATION).toContain(`create table public.${t} (`)
    const code = MIGRATION.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
    expect(code).not.toMatch(/\b(drop|truncate)\b/i)
    expect(code).not.toMatch(/delete\s+from/i)
    expect(MIGRATION).not.toMatch(/[\\\r]/)
    // Le retour, lui, détruit la table et ses fonctions : à coller, et seulement sans exercice déclaré.
    expect(RETOUR).toMatch(/drop table public\.exercices;/i)
    expect(RETOUR).toContain('if exists (select 1 from public.exercices) then')
    expect(RETOUR).not.toMatch(/drop extension/i)
  })

  it('la nature, la policy, les gardes, les droits, la double authentification', () => {
    expect(MIGRATION).toContain("constraint exercices_nature check (nature in ('premier', 'ordinaire', 'transition'))")
    expect(MIGRATION).toMatch(/create policy exercices_cabinet on public\.exercices\s+for all to authenticated\s+using \(public\.admin_du_dossier\(dossier_id\)\)\s+with check \(public\.admin_du_dossier\(dossier_id\)\);/i)
    expect(MIGRATION.match(/^create policy /gmi)).toHaveLength(1) // la seconde, `deux_facteurs`, ne naît que sous sa migration
    expect(MIGRATION).not.toMatch(/client_du_dossier/)
    expect(MIGRATION).toMatch(/create trigger exercices_garde\s+before insert or update or delete on public\.exercices\s+for each row execute function public\.garder_exercices\(\);/i)
    expect(MIGRATION).toMatch(/create trigger exercices_suite\s+after insert or update or delete on public\.exercices\s+for each row execute function public\.verifier_la_suite_des_exercices\(\);/i)
    for (const f of ['declarer_exercice(uuid, date, date, text, text, date)', 'changer_date_de_cloture(uuid, date, date, text, date)',
      'bornes_de_l_exercice(uuid, integer)', 'exercice_de_la_date(uuid, date)']) {
      expect(MIGRATION, f).toContain(`revoke execute on function public.${f} from public, anon;`)
      expect(MIGRATION, f).toContain(`grant execute on function public.${f} to authenticated;`)
    }
    for (const f of ['garder_exercices()', 'verifier_la_suite_des_exercices()', 'garder_l_engagement_des_exercices()']) {
      expect(MIGRATION, f).toContain(`revoke execute on function public.${f} from public, anon, authenticated;`)
    }
    for (const nom of ['garder_exercices', 'verifier_la_suite_des_exercices', 'declarer_exercice', 'changer_date_de_cloture',
      'bornes_de_l_exercice', 'exercice_de_la_date', 'garder_l_engagement_des_exercices']) {
      expect(corps(nom), nom).toMatch(/security definer\s+set search_path = public/)
    }
    expect(MIGRATION).toContain("if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then")
    expect(MIGRATION).toContain("execute 'create policy deux_facteurs on public.exercices as restrictive for all to authenticated '")
  })

  it('les fonctions de déclaration contrôlent l’accès avant toute lecture, puis prennent le verrou de la validation', () => {
    for (const nom of ['declarer_exercice', 'changer_date_de_cloture']) {
      const texte = corps(nom)
      const acces = texte.indexOf('not coalesce(public.admin_du_dossier(p_dossier_id), false)')
      expect(acces, nom).toBeGreaterThan(0)
      expect(texte.slice(texte.indexOf('begin'), acces), nom).not.toMatch(/public\.(exercices|dossiers)\b|from /)
      expect(texte.indexOf('pg_advisory_xact_lock(public.cle_validation(p_dossier_id))'), nom).toBeGreaterThan(acces)
    }
    for (const nom of ['bornes_de_l_exercice', 'exercice_de_la_date']) expect(corps(nom), nom).toContain('public.admin_du_dossier(d')
  })
})

describe('les refus, aux mots du module et dans son ordre', () => {
  it('chaque refus du module est dans la garde ou la suite, au caractère près', () => {
    for (const g of GARDE) expect(corps('garder_exercices').includes(enSql(g)), g).toBe(true)
    for (const g of SUITE) expect(corps('verifier_la_suite_des_exercices').includes(enSql(g)), g).toBe(true)
  })

  it('la garde lève dans l’ordre du module, puis la suite', () => {
    for (const [nom, gabarits] of [['garder_exercices', GARDE], ['verifier_la_suite_des_exercices', SUITE]] as const) {
      const texte = corps(nom)
      const rangs = gabarits.map((g) => texte.indexOf(enSql(g)))
      for (const [i, r] of rangs.entries()) expect(r, gabarits[i]).toBeGreaterThanOrEqual(0)
      expect([...rangs].sort((a, b) => a - b), nom).toEqual(rangs)
    }
  })

  it('un défaut planté se voit : deux refus échangés', () => {
    const texte = corps('garder_exercices')
    const echange = [GARDE[5], GARDE[4], ...GARDE.slice(6)].map((g) => texte.indexOf(enSql(g)))
    expect([...echange].sort((a, b) => a - b)).not.toEqual(echange)
  })
})

describe('les messages que l’essai de la réplique attend, recalculés par le module', () => {
  // Les étapes de l'essai : rang → message attendu (l'apostrophe dédoublée).
  const ATTENDUS = new Map([...ESSAI.matchAll(/\((\d+), '\w+', '(?:[^']|'')*', \$q\$(?:(?!\$q\$)[\s\S])*\$q\$,\s*'23514', '((?:[^']|'')*)'\)/g)]
    .map(([, rang, message]) => [Number(rang), message.replace(/''/g, "'")]))
  const DE = [premier('2026-03-15', '2027-06-30'), ex({ debut: '2027-07-01', fin: '2028-06-30' })]
  const VALIDE_2025 = ex({ debut: '2025-01-01', fin: '2025-12-31' }) // l'année civile validée, qui précède la liste
  const CAS: [number, string | undefined][] = [
    [20, premierRefus([ex({ debut: '2026-01-01', fin: '2026-12-31' })], 'tresorerie')],
    [21, premierRefus([ex({ debut: '2026-07-01', fin: '2027-06-30' })], 'tresorerie')],
    [22, premierRefus([transition('2026-01-01', '2027-06-30')], 'tresorerie')],
    [30, premierRefus([premier('2026-03-15', '2026-03-14')])],
    [31, premierRefus([ex({ debut: '2026-03-15', fin: '2026-12-31', nature: 'courant' as ExerciceDeclare['nature'] })])],
    [32, premierRefus([premier('2026-03-15', '2028-01-31')])],
    [33, premierRefus([ex({ debut: '2026-03-15', fin: '2027-03-15' })])],
    [34, premierRefus([transition('2026-03-15', '2028-02-15')])],
    [35, premierRefus([transition('2026-03-15', '2026-12-31', '   ')])],
    [36, premierRefus([{ ...premier('2026-03-15', '2026-12-31'), decision: 'AGE' }])],
    [37, premierRefus([premier('0999-12-31', '2026-12-31')])],
    [50, premierRefus([...DE, premier('2028-07-01', '2029-06-30')])],
    [51, premierRefus([...DE, ex({ debut: '2028-01-01', fin: '2028-12-31' })])],
    [52, premierRefus([...DE, ex({ debut: '2028-08-01', fin: '2029-07-31' })])],
    [53, premierRefus([...DE, transition('2028-07-01', '2028-12-31')])],
    [54, premierRefus([...DE, transition('2028-08-01', '2028-12-31')])],
    [63, premierRefus([DE[0], transition('2027-07-01', '2027-12-31')])],
    [64, premierRefus([DE[0], transition('2027-07-01', '2028-12-31', null, null)])],
    [65, premierRefus([DE[0], transition('2027-07-01', '2029-06-30')])],
    [70, premierRefus([ex({ debut: '2029-01-01', fin: '2029-11-30' })])],
    [71, premierRefus([DE[0], transition('2027-07-01', '2028-12-31'), transition('2030-01-01', '2030-01-01')])],
    [81, premierRefus([VALIDE_2025, premier('2026-01-01', '2026-12-31')])],
    [82, premierRefus([VALIDE_2025, transition('2026-03-01', '2026-12-31')])],
    [96, premierRefus([premier('2026-01-01', '2026-12-31'), ex({ debut: '2027-01-01', fin: '2027-12-31' }),
      ex({ debut: '2028-01-01', fin: '2028-12-31' }), ex({ debut: '2030-01-01', fin: '2030-12-31' })])],
  ]

  it('l’essai attend, pour chaque refus que le module connaît, le premier refus du module', () => {
    expect(ATTENDUS.size).toBeGreaterThanOrEqual(CAS.length)
    for (const [rang, message] of CAS) expect(ATTENDUS.get(rang), `étape ${rang}`).toBe(message)
  })

  it('l’essai se dit de réplique seulement, et le prouve avant toute écriture', () => {
    expect(ESSAI.split('\n').slice(0, 8).join(' ')).toContain('SUR UNE RÉPLIQUE SEULEMENT')
    expect(ESSAI.indexOf('ESSAI_HORS_REPLIQUE')).toBeLessThan(ESSAI.indexOf('insert into dossiers'))
  })
})
