import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contientSql, derniereDefinitionSql, fichiersDuSchema, fichiersPrepares, indiceSql } from '../test/schema'

// LA LIGNE 28.66 : les deux gardes par ligne du brouillon, écartées de la seule modification où elles ne refusent rien
// (`supabase/schema/20261112134639_gardes_de_la_validation_allegees.sql`, en production depuis le 12/11/2026). La migration ne touche aucune fonction : ce garde-ci tient sa preuve d'équivalence au texte exporté —
// la condition du jumeau de G5 est la négation, au caractère près, de la comparaison de la DERNIÈRE définition de G5 ;
// les deux fonctions sont celles dont la garde de la migration exige l'empreinte ; seule `valider_exercice` pose le
// réglage de la validation, après son verrou exclusif ; les jumeaux prennent la place de leur garde dans l'ordre des
// noms ; le retour rend les déclencheurs d'hier. L'essai : supabase/essais/gardesDeLaValidation.sql.

const NOM = /\/\d{14}_gardes_de_la_validation_allegees\.sql$/
const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => NOM.test(`/${f.chemin}`))?.texte ?? ''
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261112170100_retour_gardes_de_la_validation_allegees.sql', import.meta.url), 'utf8')

const espaces = (texte: string) => texte.replace(/\s+/g, ' ').trim()

/** Le corps d'une définition (après `as $…$`), tel que la base le garde dans `prosrc`. */
function corps(definition: string): string {
  const ouverture = /\bas\s+(\$[a-z_]*\$)/i.exec(definition)
  if (!ouverture) throw new Error('Corps introuvable.')
  return definition.slice(ouverture.index + ouverture[0].length)
}

describe('les gardes de la validation allégées (ligne 28.66)', () => {
  it('la migration existe, ne définit aucune fonction ni policy, et ne retire rien', () => {
    expect(MIGRATION.length).toBeGreaterThan(1000)
    expect(contientSql(MIGRATION, 'create or replace function')).toBe(false)
    expect(contientSql(MIGRATION, 'create function')).toBe(false)
    expect(MIGRATION).not.toMatch(/\b(?:create|alter)\s+policy\b/i)
    expect(MIGRATION).not.toMatch(/\bdrop\b|\bdelete\s+from\b|\btruncate\b/i)
    expect(MIGRATION).not.toMatch(/[\\\r]/)
  })

  it('G5 : la condition du jumeau est la négation, au caractère près, de la comparaison de la dernière définition', () => {
    const g5 = derniereDefinitionSql('garder_lignes_de_la_vente_facturee')
    const comparaison = /if \((to_jsonb\(new\) - array\[[^\]]*\])\)\s+is not distinct from \((to_jsonb\(old\) - array\[[^\]]*\])\) then\s+return new;/i.exec(g5)
    expect(comparaison).not.toBeNull()
    const jumeau = new RegExp(
      'create trigger ecritures_brouillon_vente_facturee_lignes_modification\\s+before update on public\\.ecritures_brouillon\\s+for each row\\s+'
      + 'when \\(\\((to_jsonb\\(new\\) - array\\[[^\\]]*\\])\\)\\s+is distinct from \\((to_jsonb\\(old\\) - array\\[[^\\]]*\\])\\)\\)\\s+'
      + 'execute function public\\.garder_lignes_de_la_vente_facturee\\(\\);', 'i').exec(MIGRATION)
    expect(jumeau).not.toBeNull()
    expect(espaces(jumeau![1])).toBe(espaces(comparaison![1]))
    expect(espaces(jumeau![2])).toBe(espaces(comparaison![2]))
    // Ce qui précède la comparaison ne refuse aucune modification : ses deux refus sont ceux de l'insertion et de la
    // suppression, chacun dans sa branche ; celui de la modification la suit.
    const avant = g5.slice(0, comparaison!.index)
    expect(avant.match(/raise exception/gi)?.length).toBe(2)
    expect(indiceSql(avant, "if tg_op = 'INSERT' then")).toBeLessThan(indiceSql(avant, 'mouvement classé par ses encaissements'))
    expect(indiceSql(avant, "if tg_op = 'DELETE' then")).toBeLessThan(indiceSql(avant, 'ne se retire que par la fonction'))
    expect(contientSql(avant, 'ne se modifie que')).toBe(false)
    expect(contientSql(g5.slice(comparaison!.index), 'ne se modifie que par la fonction')).toBe(true)
  })

  it('la garde des écritures validées : son jumeau n’écarte que la ligne que la validation numérote', () => {
    expect(espaces(MIGRATION)).toContain(espaces(`create trigger ecritures_brouillon_intangibles_modification
      before update on public.ecritures_brouillon for each row
      when (old.statut is not distinct from 'validee' or new.statut is distinct from 'validee'
            or old.dossier_id is distinct from new.dossier_id
            or current_setting('jd.validation_exercice', true) is distinct from new.dossier_id::text)
      execute function public.garder_ecritures_validees();`))
  })

  it('les deux fonctions sont celles dont la garde de la migration exige l’empreinte', () => {
    for (const nom of ['garder_ecritures_validees', 'garder_lignes_de_la_vente_facturee']) {
      const empreinte = new RegExp(`\\('${nom}', '([0-9a-f]{32})'\\)`).exec(MIGRATION)?.[1]
      expect(empreinte, nom).toMatch(/^[0-9a-f]{32}$/)
      const texte = corps(derniereDefinitionSql(nom)).replace(/\r\n/g, '\n')
      expect(createHash('md5').update(texte, 'utf8').digest('hex'), nom).toBe(empreinte)
    }
  })

  it('seule valider_exercice pose le réglage de la validation, après son verrou exclusif', () => {
    const pose = "set_config('jd.validation_exercice'"
    const noms = new Set<string>()
    for (const { texte } of fichiersDuSchema()) {
      for (let i = indiceSql(texte, pose); i >= 0; i = indiceSql(texte, pose, i + 1)) {
        const avant = texte.slice(0, i)
        const tetes = [...avant.matchAll(/create (?:or replace )?function public\.(\w+)\(/gi)]
        if (tetes.length > 0) noms.add(tetes[tetes.length - 1][1])
      }
    }
    expect(noms.has('valider_exercice')).toBe(true)
    const poseurs = [...noms].filter((nom) => contientSql(derniereDefinitionSql(nom), pose))
    expect(poseurs).toEqual(['valider_exercice'])
    const valider = derniereDefinitionSql('valider_exercice')
    const verrou = indiceSql(valider, 'perform pg_advisory_xact_lock(public.cle_validation(p_dossier_id));')
    expect(verrou).toBeGreaterThan(0)
    expect(verrou).toBeLessThan(indiceSql(valider, pose))
  })

  it('les jumeaux prennent la place de leur garde dans l’ordre des noms', () => {
    const noms = new Set<string>()
    for (const { texte } of [...fichiersDuSchema(), ...fichiersPrepares()]) {
      for (const m of texte.matchAll(/create (?:or replace )?(?:constraint )?trigger (\w+)\s[^;]*?\bon public\.ecritures_brouillon\b/gi)) noms.add(m[1])
    }
    for (const [garde, jumeau] of [['ecritures_brouillon_intangibles', 'ecritures_brouillon_intangibles_modification'],
      ['ecritures_brouillon_vente_facturee_lignes', 'ecritures_brouillon_vente_facturee_lignes_modification']]) {
      expect(noms.has(garde), garde).toBe(true)
      expect(noms.has(jumeau), jumeau).toBe(true)
      expect([...noms].filter((n) => n > garde && n < jumeau)).toEqual([])
    }
    // G5 reste la dernière garde de la modification.
    expect([...noms].filter((n) => n > 'ecritures_brouillon_vente_facturee_lignes_modification')).toEqual([])
  })

  it('le retour rend les deux déclencheurs d’hier et retire les jumeaux, rien d’autre', () => {
    for (const [nom, fonction] of [['ecritures_brouillon_intangibles', 'garder_ecritures_validees'],
      ['ecritures_brouillon_vente_facturee_lignes', 'garder_lignes_de_la_vente_facturee']]) {
      expect(espaces(RETOUR)).toContain(espaces(`create or replace trigger ${nom}
        before insert or delete or update on public.ecritures_brouillon
        for each row execute function public.${fonction}();
      drop trigger ${nom}_modification on public.ecritures_brouillon;`))
    }
    expect(RETOUR.match(/^drop /gim)?.length).toBe(2)
    expect(contientSql(RETOUR, 'function public.garder_ecritures_validees() returns')).toBe(false)
  })
})
