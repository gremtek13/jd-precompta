import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Une migration à COLLER garde la version de son nom de fichier : la ligne d'historique que le cabinet colle la porte
// (`supabase_migrations.schema_migrations`, dont c'est la clé). Deux préparées de même version se heurteraient donc le
// jour où l'une est collée après l'autre, et une préparée qui reprendrait la version d'une migration déjà appliquée
// aussi. Le 12/11/2026, `classes_des_categories` (PC7-Q2) était née sous la version d'`affectation_du_resultat` (AFF2).
const PREPAREES = join(__dirname, '../../supabase/preparees')
const EXPORT = join(__dirname, '../../supabase/schema')
const versions = (dossier: string) =>
  readdirSync(dossier).filter((f) => f.endsWith('.sql')).map((f) => {
    const m = f.match(/^(\d{14})_[a-z0-9_]+\.sql$/)
    expect(m, `${f} : un nom de migration est une version à quatorze chiffres, puis son nom`).not.toBeNull()
    return m![1]
  })

describe('les versions des migrations préparées', () => {
  it('sont toutes distinctes', () => {
    const vues = versions(PREPAREES)
    expect(vues.length).toBeGreaterThan(0)
    const doubles = vues.filter((v, i) => vues.indexOf(v) !== i)
    expect(doubles, 'deux migrations préparées portent la même version').toEqual([])
  })

  it('ne reprennent la version d’aucune migration de l’export', () => {
    const exportees = new Set(versions(EXPORT))
    expect(exportees.size).toBeGreaterThan(200)
    expect(versions(PREPAREES).filter((v) => exportees.has(v))).toEqual([])
  })
})
