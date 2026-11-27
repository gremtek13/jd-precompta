import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { REMPLACEMENT_DES_JOURNEES_PREVU, TABLES_DES_REMPLACEMENTS_ASSURANCE_MALADIE } from './remplacementDesJourneesAssuranceMaladie'
import {
  auPlanAujourdHui, auPlanDesRemplacementsAssuranceMaladie, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES, LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS,
  RELATIONS_PREVUES, TABLES_AUTO_REFERENCEES, TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LA TRACE DES PAIEMENTS DE L'ASSURANCE MALADIE REMPLACÉS AU PLAN DE SAUVEGARDE (NOE4R-Q2). Sa migration,
// `remplacement_des_journees_assurance_maladie`, est préparée, pas appliquée : tant que la base ne la porte pas, le plan effectif ne
// dit RIEN de sa table — une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU est déjà juste, confronté aux
// clés de la migration, pour que la ranger dans supabase/schema/ et lever `REMPLACEMENT_DES_JOURNEES_PREVU` suffisent le jour
// venu. La migration se lit là où elle est : préparée, ou rangée dans l'export — ce test passe dans les deux états.

const TABLES: readonly string[] = TABLES_DES_REMPLACEMENTS_ASSURANCE_MALADIE
const NOM = /^\d{14}_remplacement_des_journees_assurance_maladie\.sql$/
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
    expect(REMPLACEMENT_DES_JOURNEES_PREVU).toBe(RANGEE !== null)
  })

  it('elle crée la seule table que le plan déclare ; les deux imports qu’elle nomme le sont sans clé étrangère', () => {
    expect([...MIGRATION.matchAll(/^create\s+table\s+public\.([a-z_]+)\s*\(/gim)].map((m) => m[1])).toEqual([...TABLES])
    expect(MIGRATION).toMatch(/^\s+import_id uuid not null,$/m)
    expect(MIGRATION).toMatch(/^\s+ancien_import_id uuid not null,$/m)
  })
})

describe('le filtre du plan, côté trace des remplacements', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesRemplacementsAssuranceMaladie(table, false), table).toBe(false)
      expect(auPlanDesRemplacementsAssuranceMaladie(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(REMPLACEMENT_DES_JOURNEES_PREVU)
    }
    for (const table of ['dossiers', 'imports_assurance_maladie', 'paiements_assurance_maladie']) {
      expect(auPlanDesRemplacementsAssuranceMaladie(table, false), table).toBe(true)
    }
  })

  it('le plan effectif ne nomme la table que le drapeau levé', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(REMPLACEMENT_DES_JOURNEES_PREVU)
  })
})

describe('le plan prévu, trace des remplacements comprise', () => {
  it('la table y entre une fois : l’ordre, le chemin direct ; ni vague, ni seconde passe, ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(TABLES_AUTO_REFERENCEES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('ses relations sont les clés étrangères de la migration, à leur action : le dossier seul', () => {
    const siennes = RELATIONS_PREVUES.filter((r) => TABLES.includes(r.enfant))
      .map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
    expect(siennes).toEqual(clesDeLaTable('remplacements_assurance_maladie'))
    expect(siennes).toEqual(['dossier_id → dossiers (cascade)'])
    expect(RELATIONS_PREVUES.some((r) => TABLES.includes(r.parent))).toBe(false)
    expect(LIENS_GARDES.some((r) => TABLES.includes(r.enfant) || TABLES.includes(r.parent))).toBe(false)
  })

  it('juste après les paiements de l’assurance maladie, après le dossier', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('remplacements_assurance_maladie') - 1]).toBe('paiements_assurance_maladie')
    expect(rang('dossiers')).toBeLessThan(rang('remplacements_assurance_maladie'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('l’ordre du jour est le plan prévu filtré par le drapeau', () => {
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
    expect(ORDRE_RESTAURATION.includes('remplacements_assurance_maladie')).toBe(REMPLACEMENT_DES_JOURNEES_PREVU)
  })

  it('un défaut planté se voit : la table avant son dossier', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'remplacements_assurance_maladie')
    const avant = ['remplacements_assurance_maladie', ...sans]
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('remplacements_assurance_maladie → dossiers')
  })
})

describe('la trace dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./remplacementDesJourneesAssuranceMaladie')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./remplacementDesJourneesAssuranceMaladie', async (original) => ({
      ...(await original<typeof import('./remplacementDesJourneesAssuranceMaladie')>()), REMPLACEMENT_DES_JOURNEES_PREVU: drapeau,
    }))
    return import('./sauvegarde')
  }

  // Une trace qui nomme deux imports que la sauvegarde ne porte pas (retirés depuis) : sans clé vers eux, rien ne se perd.
  const contenu = {
    dossiers: [{ id: 'd1' }],
    remplacements_assurance_maladie: [
      { id: 't1', dossier_id: 'd1', import_id: 'i-retire', ancien_import_id: 'i-ancien', date_journee_comptable: '2026-11-02', regime: 1,
        caisse: 691, organisme_complementaire: null, part: 'obligatoire', ancien_montant_centimes: 12345, ancien_regularisations_centimes: 0,
        ancien_nombre_de_factures: 7, nouveau_montant_centimes: 13000, nouveau_regularisations_centimes: 0, nouveau_nombre_de_factures: 8,
        remplace_par: 'u1', remplace_le: '2026-11-27T10:00:00Z' },
    ],
  }

  it('levé : la trace se réinsère après son dossier, sans lien perdu, même ses imports absents', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    const rang = (t: string) => etapes.findIndex((e) => e.table === t)
    expect(rang('remplacements_assurance_maladie')).toBeGreaterThan(rang('dossiers'))
    expect(etapes.find((e) => e.table === 'remplacements_assurance_maladie')?.lignes)
      .toEqual([expect.objectContaining({ import_id: 'i-retire', ancien_montant_centimes: 12345, nouveau_montant_centimes: 13000 })])
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    for (const t of TABLES) {
      expect(s.planReinsertion(contenu).etapes.some((e) => e.table === t)).toBe(false)
      expect(s.ORDRE_RESTAURATION).not.toContain(t)
    }
  })
})
