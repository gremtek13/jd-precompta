import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ECRITURES_LIBRES_PREVUES, TABLES_DES_ECRITURES_LIBRES } from './ecritureLibre'
import {
  auGrapheDesEcrituresLibres, auPlanAujourdHui, auPlanDesEcrituresLibres, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES, LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS,
  RELATIONS_PREVUES, TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES ÉCRITURES LIBRES AU PLAN DE SAUVEGARDE (ligne 26.9, lot EL8). Leur migration, `ecritures_libres` (EL2), est préparée, pas
// appliquée : tant que la base ne la porte pas, le plan effectif ne dit RIEN de sa table ni de la colonne du brouillon qui la
// cite — une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU est déjà juste, confronté aux clés de la
// migration, pour que la ranger dans supabase/schema/ et lever `ECRITURES_LIBRES_PREVUES` suffisent le jour venu. La migration
// se lit là où elle est : préparée, ou rangée dans l'export — ce test passe dans les deux états, et la simulation du drapeau
// levé (EL8, 22/11/2026) l'a joué ainsi.

const TABLES: readonly string[] = TABLES_DES_ECRITURES_LIBRES
const NOM = /^\d{14}_ecritures_libres\.sql$/
const ou = (dossier: string) => {
  const chemin = new URL(`../../supabase/${dossier}/`, import.meta.url).pathname
  const nom = readdirSync(chemin).find((n) => NOM.test(n))
  return nom ? chemin + nom : null
}
const PREPAREE = ou('preparees')
const RANGEE = ou('schema')
const MIGRATION = readFileSync((RANGEE ?? PREPAREE)!, 'utf8')

/** Les clés étrangères de la table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaTable(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) ?\(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('la migration, préparée ou rangée, et le drapeau', () => {
  it('elle est à un seul endroit ; rangée dans l’export, le drapeau est levé ; préparée, il est baissé', () => {
    expect([PREPAREE, RANGEE].filter((c) => c !== null)).toHaveLength(1)
    expect(ECRITURES_LIBRES_PREVUES).toBe(RANGEE !== null)
  })
})

describe('le filtre du plan, côté écritures libres', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesEcrituresLibres(table, false), table).toBe(false)
      expect(auPlanDesEcrituresLibres(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(ECRITURES_LIBRES_PREVUES)
    }
    for (const table of ['dossiers', 'pieces', 'ecritures_brouillon', 'exercices_valides']) {
      expect(auPlanDesEcrituresLibres(table, false), table).toBe(true)
    }
  })

  it('le plan effectif ne nomme la table ni la colonne du brouillon qui la cite que le drapeau levé', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(ECRITURES_LIBRES_PREVUES)
    expect(RELATIONS.some((r) => r.colonne === 'ecriture_libre_id')).toBe(ECRITURES_LIBRES_PREVUES)
    const brouillon = { enfant: 'ecritures_brouillon', parent: 'ecritures_libres' }
    expect(auGrapheDesEcrituresLibres(brouillon, false)).toBe(false)
    expect(auGrapheDesEcrituresLibres(brouillon, true)).toBe(true)
    expect(auGrapheDesEcrituresLibres({ enfant: 'ecritures_libres', parent: 'pieces' }, false)).toBe(false)
    expect(auGrapheDesEcrituresLibres({ enfant: 'ecritures_brouillon', parent: 'pieces' }, false)).toBe(true)
  })
})

describe('le plan prévu, écritures libres comprises', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni seconde passe, ni clé à part ; une seule vague, celle d’EL7', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      // La contre-passation (EL7, sa migration préparée, sauvegardeContrePassation.test.ts) : sa colonne part par vagues.
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table)
        .toEqual([{ table: 'ecritures_libres', colonne: 'contre_passe_id' }])
      expect(TABLES_AUTO_REFERENCEES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
    // Aucune auto-référence dans la migration EL2 : `contre_passe_id` entre par celle d'EL7 (conception 54, § 3.9).
    expect(MIGRATION).not.toMatch(/contre_passe_id\s+uuid/)
  })

  it('ses relations sont les clés étrangères de la migration, à leur action, et celle de la colonne du brouillon', () => {
    // La relation de la contre-passation (EL7) vient de SA migration : sauvegardeContrePassation.test.ts la juge.
    const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === 'ecritures_libres' && r.colonne !== 'contre_passe_id')
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    expect(siennes).toEqual(clesDeLaTable('ecritures_libres'))
    expect(siennes).toEqual(['dossier_id → dossiers (cascade)', 'piece_citee_id → pieces (bloque)'])
    expect(MIGRATION.replace(/\s+/g, ' ')).toContain('alter table public.ecritures_brouillon add column ecriture_libre_id uuid '
      + 'constraint ecritures_brouillon_ecriture_libre_id_fkey references public.ecritures_libres(id);')
    expect(RELATIONS_PREVUES.filter((r) => r.colonne === 'ecriture_libre_id')).toEqual([
      { enfant: 'ecritures_brouillon', parent: 'ecritures_libres', colonne: 'ecriture_libre_id', aLaSuppression: 'bloque' }])
    expect(LIENS_GARDES.some((r) => r.enfant === 'ecritures_libres' || r.parent === 'ecritures_libres')).toBe(false)
  })

  it('juste après les textes lus des pièces : après la pièce citée, avant le brouillon et les exercices validés, hors du bloc de la caisse', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('ecritures_libres') - 1]).toBe('piece_textes_ocr')
    expect(rang('pieces')).toBeLessThan(rang('ecritures_libres'))
    expect(rang('ecritures_libres')).toBeLessThan(rang('ecritures_brouillon'))
    expect(rang('ecritures_libres')).toBeLessThan(rang('exercices_valides'))
    // Le bloc des pièces hors de France, de la caisse et du brouillon reste d'un seul tenant (sauvegardeCaisse.test.ts).
    expect(ORDRE_RESTAURATION_PREVU.slice(rang('pieces_hors_de_france'), rang('ecritures_brouillon') + 1))
      .toEqual(['pieces_hors_de_france', 'pieces_hors_de_france_taux', 'operations_caisse', 'ecritures_brouillon'])
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('l’ordre du jour est le plan prévu filtré par le drapeau', () => {
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
    expect(ORDRE_RESTAURATION.includes('ecritures_libres')).toBe(ECRITURES_LIBRES_PREVUES)
  })

  it('un défaut planté se voit : l’écriture après le brouillon qui la cite, ou avant la pièce qu’elle cite', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'ecritures_libres')
    const apres = [...sans]
    apres.splice(apres.indexOf('ecritures_brouillon') + 1, 0, 'ecritures_libres')
    expect(violationsOrdre(apres, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('ecritures_brouillon → ecritures_libres')
    const avant = [...sans]
    avant.splice(avant.indexOf('pieces'), 0, 'ecritures_libres')
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('ecritures_libres → pieces')
  })
})
