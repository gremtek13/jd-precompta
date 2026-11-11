import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCUMENTS_ET_DEMANDES_PREVUS, TABLES_DES_DOCUMENTS_ET_DEMANDES } from './documentsEtDemandes'
import {
  auPlanAujourdHui, auPlanDesDocumentsEtDemandes, CHEMINS_DOSSIER, CHEMINS_DOSSIER_PREVUS, CLES_PRIMAIRES, CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, planExportDossier, RELATIONS, RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES, TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES, tablesSansChemin, violationsOrdre,
} from './sauvegarde'

// LES DOCUMENTS ET LES DEMANDES DU CABINET AU PLAN DE SAUVEGARDE (ligne 51.5, B2). Leur migration, `documents_et_demandes`,
// est préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de ses cinq tables —
// une sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, confronté aux clés de la
// migration, pour que lever `DOCUMENTS_ET_DEMANDES_PREVUS` suffise le jour venu.

const TABLES: readonly string[] = TABLES_DES_DOCUMENTS_ET_DEMANDES
const dossier = new URL('../../supabase/preparees/', import.meta.url).pathname
const MIGRATION = readFileSync(dossier + readdirSync(dossier).find((n) => /^\d{14}_documents_et_demandes\.sql$/.test(n))!, 'utf8')

/** Les clés étrangères d'une table de la migration, à leur action : `colonne → parent (action)`. */
function clesDeLaMigration(table: string): string[] {
  const corps = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`, 'i').exec(MIGRATION)![1]
  return [...corps.matchAll(/^\s+([a-z_]+) uuid[^,\n]* references public\.([a-z_]+) \(id\)( on delete (cascade|set null))?/gm)]
    .map(([, colonne, parent, , action]) => `${colonne} → ${parent} (${action === 'cascade' ? 'cascade' : action === 'set null' ? 'met_a_null' : 'bloque'})`)
    .sort()
}

describe('le filtre du plan, côté documents et demandes', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES) {
      expect(auPlanDesDocumentsEtDemandes(table, false), table).toBe(false)
      expect(auPlanDesDocumentsEtDemandes(table, true), table).toBe(true)
      expect(auPlanAujourdHui(table), table).toBe(DOCUMENTS_ET_DEMANDES_PREVUS)
    }
    for (const table of ['dossiers', 'pieces', 'documents_divers', 'emails_envoyes', 'dossier_permanent']) {
      expect(auPlanDesDocumentsEtDemandes(table, false), table).toBe(true)
    }
  })

  it('drapeau baissé, le plan effectif ne nomme aucune des cinq tables — drapeau levé, toutes', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES) expect(nommees.has(table), table).toBe(DOCUMENTS_ET_DEMANDES_PREVUS)
  })
})

describe('le plan prévu, documents et demandes compris', () => {
  it('chaque table y entre une fois : l’ordre, le chemin direct ; ni vague ni clé à part', () => {
    for (const table of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === table), table).toEqual([])
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('leurs relations sont les clés étrangères de la migration, à leur action — le dépôt d’une réponse mis à nul (B2-Q3)', () => {
    for (const table of TABLES) {
      const siennes = RELATIONS_PREVUES.filter((r) => r.enfant === table).map((r) => `${r.colonne} → ${r.parent} (${r.aLaSuppression})`).sort()
      expect(siennes, table).toEqual(clesDeLaMigration(table))
      expect(LIENS_GARDES.some((r) => r.enfant === table), table).toBe(false)
    }
    expect(clesDeLaMigration('demandes_reponses')).toEqual([
      'demande_id → demandes_cabinet (cascade)', 'document_id → documents_divers (met_a_null)', 'dossier_id → dossiers (cascade)',
      'piece_id → pieces (met_a_null)',
    ])
    expect(clesDeLaMigration('relances_demandes')).toContain('email_id → emails_envoyes (bloque)')
  })

  it('juste après le dossier permanent, après les pièces, les documents et les e-mails ; l’ordre respecte toutes les dépendances', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang('dossier_permanent') + 1, rang('dossier_permanent') + 6)).toEqual([...TABLES])
    for (const parent of ['pieces', 'documents_divers', 'emails_envoyes']) expect(rang(parent), parent).toBeLessThan(rang(TABLES[0]))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toEqual(expect.arrayContaining([...TABLES]))
  })

  it('un défaut planté se voit : une réponse avant sa demande', () => {
    const deplace = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'demandes_reponses')
    deplace.splice(deplace.indexOf('demandes_cabinet'), 0, 'demandes_reponses')
    expect(violationsOrdre(deplace, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('demandes_reponses → demandes_cabinet')
  })
})

describe('les documents et les demandes dans les deux états du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./documentsEtDemandes')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./documentsEtDemandes', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./documentsEtDemandes')>()),
      DOCUMENTS_ET_DEMANDES_PREVUS: drapeau,
    }))
    return import('./sauvegarde')
  }

  it('levé, les cinq tables entrent au plan du jour, après le dossier permanent ; baissé, elles en sortent', async () => {
    const leve = await sauvegardeSous(true)
    const rang = leve.ORDRE_RESTAURATION.indexOf('dossier_permanent')
    expect(leve.ORDRE_RESTAURATION.slice(rang + 1, rang + 6)).toEqual([...TABLES])
    expect(leve.RELATIONS.some((r) => r.enfant === 'demandes_reponses' && r.parent === 'pieces' && r.aLaSuppression === 'met_a_null')).toBe(true)
    const baisse = await sauvegardeSous(false)
    for (const table of TABLES) expect(baisse.ORDRE_RESTAURATION, table).not.toContain(table)
    expect(baisse.RELATIONS.some((r) => TABLES.includes(r.enfant))).toBe(false)
  })
})
