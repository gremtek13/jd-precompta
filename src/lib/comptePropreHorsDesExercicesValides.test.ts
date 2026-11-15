import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql } from '../test/schema'
import { REFUS_DES_EXERCICES_VALIDES, formuler, refusDesExercicesValides } from './comptesBancaires'
import { ORDRE_RESTAURATION_PREVU } from './sauvegarde'

// MCB6Q2-Q1 (ligne 26.6, réponse (A) du cabinet du 15/11/2026 : « un filet en base, collé avec MCB5g, la restauration
// exceptée ») : la migration `compte_propre_hors_des_exercices_valides`, PRÉPARÉE, redit en base la règle MCB6-Q2 que l'écran
// tient (lib/ficheDesComptesBancaires.ts) — un compte autre que le principal ne tient pas son propre 512 depuis un exercice
// validé, ni depuis une année antérieure ; une date déjà posée se garde. Ce garde confronte son refus au module
// (`REFUS_DES_EXERCICES_VALIDES`, `refusDesExercicesValides`), sa place parmi les déclencheurs, son verrou à `cle_validation`,
// l'exception de la restauration à l'ordre de la sauvegarde, sa voie (l'outil), son retour et son essai
// (supabase/essais/comptePropreHorsDesExercicesValides.sql, joué sur une réplique). Récit : HISTORIQUE.md, « 15/11/2026 —
// MCB6Q2-Q1 ». La migration se cherche où qu'elle soit, une fois.

const NOM = 'compte_propre_hors_des_exercices_valides'
const FONCTION = 'garder_compte_propre_hors_des_exercices_valides'
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

function leFichier(motif: RegExp, dossiers: readonly string[]): { chemin: string; texte: string } {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return { chemin: trouves[0], texte: readFileSync(trouves[0], 'utf8') }
}

const MIGRATION = leFichier(new RegExp(`^\\d{14}_${NOM}\\.sql$`), ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(new RegExp(`^\\d{14}_retour_${NOM}\\.sql$`), ['../../supabase/preparees/retour/']).texte
const ESSAI = readFileSync(new URL('../../supabase/essais/comptePropreHorsDesExercicesValides.sql', import.meta.url), 'utf8')

function definition(): string {
  const d = definitionsSql(FONCTION, [{ chemin: NOM, texte: MIGRATION.texte }])
  expect(d).toHaveLength(1)
  return d[0].definition
}
const corps = (def: string) => def.slice(def.indexOf('as $$') + 'as $$'.length)

/** Les refus d'un texte SQL, dans l'ordre : leurs mots (les apostrophes doublées rendues) et leur code. */
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))

describe('le filet redit le module, au mot et au code près', () => {
  it('un seul refus, celui de REFUS_DES_EXERCICES_VALIDES', () => {
    expect(refusSql(definition())).toEqual([{ code: REFUS_DES_EXERCICES_VALIDES.code, modele: REFUS_DES_EXERCICES_VALIDES.modele }])
  })

  it('ses deux valeurs : le plus petit exercice validé qui retient la date, puis l’année qui suit le dernier', () => {
    const f = definition()
    expect(f).toContain('select min(v.annee) filter (where v.annee >= extract(year from new.compte_propre_depuis)), max(v.annee) + 1')
    expect(f).toContain('v_validee, v_ouverte using errcode')
    expect(refusDesExercicesValides({ principal: false, compte_propre_depuis: '2024-01-01' }, null, [2025, 2026]))
      .toEqual(formuler(REFUS_DES_EXERCICES_VALIDES, '2025', '2027'))
  })

  it('ce qui ne se juge pas : le principal, une date nulle, une date inchangée — dans la base comme dans le module', () => {
    expect(definition()).toContain("if new.principal or new.compte_propre_depuis is null\n     or (tg_op = 'UPDATE' and new.compte_propre_depuis is not distinct from old.compte_propre_depuis) then\n    return new;")
    expect(refusDesExercicesValides({ principal: true, compte_propre_depuis: null }, null, [2025])).toBeNull()
    expect(refusDesExercicesValides({ principal: false, compte_propre_depuis: '2025-01-01' }, { compte_propre_depuis: '2025-01-01' }, [2025])).toBeNull()
    expect(refusDesExercicesValides({ principal: false, compte_propre_depuis: '2026-01-01' }, null, [2025])).toBeNull()
  })
})

describe('sa place, ses droits, son verrou', () => {
  it('un déclencheur à part, sur l’insertion et la seule date, qui tire après la garde d’hier (l’ordre des noms)', () => {
    expect(MIGRATION.texte).toContain(`create trigger comptes_bancaires_garde_des_exercices_valides
  before insert or update of compte_propre_depuis on public.comptes_bancaires
  for each row execute function public.${FONCTION}();`)
    expect('comptes_bancaires_garde' < 'comptes_bancaires_garde_des_exercices_valides').toBe(true)
    // La garde d'hier n'est pas réécrite : sa dernière définition est celle de l'export.
    expect(definitionsSql('garder_comptes_bancaires', [{ chemin: NOM, texte: MIGRATION.texte }])).toEqual([])
  })

  it('aux droits de l’appelant (ni porte ni lecture hors de la RLS), son chemin fixé, fermée à l’API', () => {
    const f = definition()
    const entete = f.slice(0, f.indexOf('as $$'))
    expect(entete).not.toMatch(/security\s+definer/i)
    expect(entete).toContain('set search_path = public')
    expect(MIGRATION.texte).toContain(`revoke all on function public.${FONCTION}() from public, anon, authenticated;`)
  })

  it('le verrou partagé de la validation, sous la clé de cle_validation, avant la lecture des exercices validés', () => {
    const f = definition()
    const cle = corps(derniereDefinitionSql('cle_validation')).trim()
    expect(cle).toBe("select hashtextextended('jd.validation_exercice:' || p_dossier_id::text, 0)")
    const verrou = `perform pg_advisory_xact_lock_shared(${cle.replace(/^select /, '').replace('p_dossier_id', 'new.dossier_id')});`
    expect(f).toContain(verrou)
    expect(f.indexOf(verrou)).toBeLessThan(f.indexOf('from public.exercices_valides'))
    // La garde de tête exige le corps de cle_validation dont elle recopie la clé.
    expect(MIGRATION.texte).toContain(`is distinct from '${md5(corps(derniereDefinitionSql('cle_validation')))}'`)
  })

  it('la restauration exceptée par son ordre : les comptes bien avant les exercices validés ; le super-administrateur n’est pas exempté', () => {
    expect(definition()).not.toMatch(/is_super_admin/)
    const comptes = ORDRE_RESTAURATION_PREVU.indexOf('comptes_bancaires')
    const exercices = ORDRE_RESTAURATION_PREVU.indexOf('exercices_valides')
    expect(comptes).toBeGreaterThan(-1)
    expect(comptes).toBeLessThan(exercices)
    // Après les exercices validés, seules les tables du départ d'un client (INAL5), qui ne posent aucun compte.
    expect(ORDRE_RESTAURATION_PREVU.slice(exercices + 1)).toEqual(['paquets_d_archive_telecharges', 'conservations_des_dossiers'])
  })
})

describe('la voie, le retour et l’essai', () => {
  it('la migration passe par l’outil : aucun retrait, aucune barre oblique inverse, aucun retour chariot ; elle le dit', () => {
    expect(MIGRATION.texte).not.toMatch(/\b(delete|drop|truncate)\b/i)
    expect(MIGRATION.texte).not.toMatch(/[\r\\]/)
    expect(MIGRATION.texte).toContain('PAR L\'OUTIL (`apply_migration`)')
  })

  it('le retour retire le déclencheur et la fonction, gardé par l’empreinte du corps posé, et se colle', () => {
    expect(RETOUR).toContain(`drop trigger comptes_bancaires_garde_des_exercices_valides on public.comptes_bancaires;`)
    expect(RETOUR).toContain(`drop function public.${FONCTION}();`)
    expect(RETOUR).toContain(`is distinct from '${md5(corps(definition()))}'`)
    expect(RETOUR).toMatch(/À COLLER/)
    expect(RETOUR).not.toMatch(/[\r\\]/)
  })

  it('l’essai cite le module, dit ses mots tels qu’il les compose, et se joue sur une réplique seulement', () => {
    expect(ESSAI).toContain('src/lib/comptesBancaires.ts')
    expect(ESSAI).toMatch(/SUR UNE RÉPLIQUE SEULEMENT/)
    const format = /select format\('((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)', p_validee, p_ouverte\)/.exec(ESSAI)
    expect(format).not.toBeNull()
    expect((format![1] + format![2]).replace(/''/g, "'").replace(/%s/g, '%')).toBe(REFUS_DES_EXERCICES_VALIDES.modele)
    for (const m of ['M-CP1', 'M-CP2', 'M-CP3', 'M-CP4', 'M-CP5', 'M-CP6', 'M-CP7']) expect(ESSAI).toContain(m)
  })
})
