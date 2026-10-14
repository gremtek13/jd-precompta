import { describe, expect, it } from 'vitest'
import { ARTICLES_EXPORTES } from './articles'
import {
  auPlanAujourdHui,
  auPlanDesArticles,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_DES_ARTICLES,
  TABLES_DES_DEVIS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES ARTICLES AU PLAN DE SAUVEGARDE (espace client, étape A1). Leur migration est appliquée et exportée, le drapeau levé :
// le plan effectif les compte. Rebaissé — le préalable de tout retour arrière —, il ne devrait plus RIEN dire d'eux — une
// sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU resterait juste pour le jour où on le relève. Les tests
// qui confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`) jugent
// l'état effectif ; celui-ci juge le plan prévu, et le lien des deux.

describe('le filtre du plan, côté articles', () => {
  it('la table des articles n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_ARTICLES).toEqual(['articles'])
    for (const table of TABLES_DES_ARTICLES) {
      expect(auPlanDesArticles(table, false), table).toBe(false)
      expect(auPlanDesArticles(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'factures_emises', 'facture_lignes', 'devis', 'article', 'exercices_valides']) {
      expect(auPlanDesArticles(table, false), table).toBe(true)
      expect(auPlanDesArticles(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau des articles', () => {
    expect(auPlanAujourdHui('articles')).toBe(ARTICLES_EXPORTES)
    expect(auPlanAujourdHui('dossiers')).toBe(true)
  })

  it('aucune table n’est à la fois des devis et des articles : chaque drapeau garde les siennes', () => {
    expect(TABLES_DES_ARTICLES.filter((t) => TABLES_DES_DEVIS.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les articles — drapeau levé, partout', () => {
    const nommees = new Set([...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER)])
    for (const table of TABLES_DES_ARTICLES) expect(nommees.has(table), table).toBe(ARTICLES_EXPORTES)
    // Leur clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain('articles')
    expect(Object.keys(CLES_PRIMAIRES)).not.toContain('articles')
    expect(clePrimaire('articles')).toEqual(['id'])
  })
})

describe('le plan prévu, articles compris', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe', () => {
    for (const table of TABLES_DES_ARTICLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(RELATIONS_PREVUES.some((r) => r.enfant === table), table).toBe(true)
    }
  })

  it('sa relation, telle que la migration articles la déclare : son dossier, en cascade, et rien d’autre', () => {
    const desArticles = RELATIONS_PREVUES.filter((r) => TABLES_DES_ARTICLES.includes(r.enfant) || TABLES_DES_ARTICLES.includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desArticles).toEqual(['articles.dossier_id → dossiers (cascade)'])
    // Aucune garde ne lit un article à l'insertion d'une autre ligne : il n'est pas un lien gardé.
    expect(LIENS_GARDES.some((r) => TABLES_DES_ARTICLES.includes(r.enfant) || TABLES_DES_ARTICLES.includes(r.parent))).toBe(false)
  })

  it('juste après `agent_conversations`, parmi ce qui ne dépend que du dossier — et avant les factures et leurs lignes (étape A7)', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('articles') - 1]).toBe('agent_conversations')
    expect(ORDRE_RESTAURATION_PREVU[rang('articles') + 1]).toBe('categories')
    expect(rang('articles')).toBeGreaterThan(rang('dossiers'))
    expect(rang('articles')).toBeGreaterThan(rang('plan_comptable_dossier'))
    expect(rang('articles')).toBeLessThan(rang('factures_emises'))
    expect(rang('articles')).toBeLessThan(rang('facture_lignes'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const plan = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const table of TABLES_DES_ARTICLES) expect(plan, table).toContain(table)
  })

  it('un défaut planté se voit : la table avant son dossier', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'articles')
    plante.splice(plante.indexOf('dossiers'), 0, 'articles')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('articles → dossiers')
  })
})
