import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE } from './contrePassationDesEcrituresLibres'
import {
  auGrapheDeLaContrePassation, auxVaguesDeLaContrePassation, LIENS_GARDES, ORDRE_RESTAURATION_PREVU, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, vaguesParLien,
  violationsOrdre,
} from './sauvegarde'
import { relationsDuSchema } from '../test/schema'

// LA CONTRE-PASSATION D'UNE ÉCRITURE LIBRE AU PLAN DE SAUVEGARDE (ligne 26.9, EL7). Sa migration,
// `contre_passation_des_ecritures_libres`, est préparée, pas appliquée : tant que la base ne la porte pas, le plan du jour ne dit
// RIEN de sa colonne — ni la relation de la table vers elle-même, ni sa vague —, et le plan PRÉVU est déjà juste, confronté à la
// clé de la migration, pour que la ranger dans supabase/schema/ et lever `CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE` suffisent
// le jour venu. La migration se lit là où elle est : préparée, ou rangée dans l'export — ce test passe dans les deux états.

const NOM = /^\d{14}_contre_passation_des_ecritures_libres\.sql$/
const ou = (dossier: string) => {
  const chemin = new URL(`../../supabase/${dossier}/`, import.meta.url).pathname
  const nom = readdirSync(chemin).find((n) => NOM.test(n))
  return nom ? chemin + nom : null
}
const PREPAREE = ou('preparees')
const RANGEE = ou('schema')
const MIGRATION = readFileSync((RANGEE ?? PREPAREE)!, 'utf8')
const LA_RELATION = { enfant: 'ecritures_libres', parent: 'ecritures_libres', colonne: 'contre_passe_id', aLaSuppression: 'bloque' } as const
const LA_VAGUE = { table: 'ecritures_libres', colonne: 'contre_passe_id' } as const

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; rangée dans l’export, le drapeau est levé ; préparée, il est baissé', () => {
    expect([PREPAREE, RANGEE].filter((c) => c !== null)).toHaveLength(1)
    expect(CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE).toBe(RANGEE !== null)
  })
})

describe('les filtres du plan, côté contre-passation', () => {
  it('la relation et la vague de la colonne n’y sont que le drapeau levé ; toute autre l’est toujours', () => {
    expect(auGrapheDeLaContrePassation(LA_RELATION, false)).toBe(false)
    expect(auGrapheDeLaContrePassation(LA_RELATION, true)).toBe(true)
    expect(auGrapheDeLaContrePassation({ enfant: 'ecritures_libres', colonne: 'piece_citee_id' }, false)).toBe(true)
    expect(auGrapheDeLaContrePassation({ enfant: 'ecritures_brouillon', colonne: 'contre_passe_id' }, false)).toBe(true)
    expect(auxVaguesDeLaContrePassation(LA_VAGUE, false)).toBe(false)
    expect(auxVaguesDeLaContrePassation(LA_VAGUE, true)).toBe(true)
    expect(auxVaguesDeLaContrePassation({ table: 'operations_caisse', colonne: 'remplace_id' }, false)).toBe(true)
  })

  it('le plan du jour suit le drapeau : la relation et la vague, ensemble', () => {
    expect(RELATIONS.some((r) => r.colonne === 'contre_passe_id')).toBe(CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE)
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES.some((a) => a.colonne === 'contre_passe_id')).toBe(CONTRE_PASSATION_DES_ECRITURES_LIBRES_PREVUE)
  })
})

describe('le plan prévu, contre-passation comprise', () => {
  it('sa relation est la clé étrangère de la migration, à son action : vers la même table, sans action', () => {
    const declarees = relationsDuSchema([{ chemin: 'migration.sql', texte: MIGRATION }])
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(declarees).toEqual(['ecritures_libres.contre_passe_id → ecritures_libres (bloque)'])
    expect(RELATIONS_PREVUES.filter((r) => r.colonne === 'contre_passe_id')).toEqual([LA_RELATION])
    expect(LIENS_GARDES.some((r) => r.colonne === 'contre_passe_id')).toBe(false)
  })

  it('elle part par vagues, jamais en deux passes : la vague, la dernière de la liste, comme le bloc de restauration.sql', () => {
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.at(-1)).toEqual(LA_VAGUE)
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.colonne === 'contre_passe_id')).toEqual([LA_VAGUE])
    expect(TABLES_AUTO_REFERENCEES.some((a) => a.table === 'ecritures_libres')).toBe(false)
    // Une auto-référence ne contraint pas l'ordre des tables : aucune violation, aucune table de plus.
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === 'ecritures_libres')).toHaveLength(1)
  })

  it('les vagues : l’écriture d’origine d’abord, sa contre-passation ensuite, celle d’une contre-passation après elle', () => {
    const lignes = [
      { id: 'c2', contre_passe_id: 'c1' }, { id: 'c1', contre_passe_id: 'e1' }, { id: 'e1', contre_passe_id: null }, { id: 'e2' },
    ]
    expect(vaguesParLien(lignes, LA_VAGUE.colonne).map((v) => v.map((l) => l.id))).toEqual([['e1', 'e2'], ['c1'], ['c2']])
  })
})
