import { describe, expect, it } from 'vitest'
import { DEVIS_EXPORTES } from './devis'
import {
  auPlan,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_DES_DEVIS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES DEVIS AU PLAN DE SAUVEGARDE (espace client, étape P5). Leurs migrations attendent l'accord du cabinet : tant que
// l'export ne les porte pas, le plan effectif ne doit RIEN dire d'eux — une sauvegarde lirait une table absente et
// échouerait —, et le plan PRÉVU doit déjà être juste, pour que lever `DEVIS_EXPORTES` suffise le jour venu. Les tests qui
// confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`) jugent
// l'état effectif ; celui-ci juge les deux, et leur lien.

describe('le filtre du plan', () => {
  it('une table des devis n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    for (const table of TABLES_DES_DEVIS) {
      expect(auPlan(table, false), table).toBe(false)
      expect(auPlan(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'factures_emises', 'devis_inconnu', 'exercices_valides']) {
      expect(auPlan(table, false), table).toBe(true)
      expect(auPlan(table, true), table).toBe(true)
    }
  })

  it('le plan effectif est le plan prévu filtré par le drapeau, liste par liste', () => {
    expect(RELATIONS).toEqual(RELATIONS_PREVUES.filter((r) => auPlan(r.enfant, DEVIS_EXPORTES)))
    expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlan(t, DEVIS_EXPORTES)))
    expect(Object.keys(CHEMINS_DOSSIER)).toEqual(Object.keys(CHEMINS_DOSSIER_PREVUS).filter((t) => auPlan(t, DEVIS_EXPORTES)))
    expect(Object.keys(CLES_PRIMAIRES)).toEqual(Object.keys(CLES_PRIMAIRES_PREVUES).filter((t) => auPlan(t, DEVIS_EXPORTES)))
  })

  it('drapeau baissé, le plan effectif ne nomme aucune table des devis — drapeau levé, toutes', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const table of TABLES_DES_DEVIS) expect(nommees.has(table), table).toBe(DEVIS_EXPORTES)
  })
})

describe('le plan prévu, tables des devis comprises', () => {
  it('les trois tables y entrent ensemble : l’ordre, les chemins, le graphe ; la série, sa clé', () => {
    for (const table of TABLES_DES_DEVIS) {
      expect(ORDRE_RESTAURATION_PREVU, table).toContain(table)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(RELATIONS_PREVUES.some((r) => r.enfant === table), table).toBe(true)
    }
    expect(CLES_PRIMAIRES_PREVUES.devis_numerotation).toEqual(['dossier_id', 'annee'])
  })

  it('leurs relations, telles que la migration devis_du_client les déclare', () => {
    const desDevis = RELATIONS_PREVUES.filter((r) => TABLES_DES_DEVIS.includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desDevis.sort()).toEqual([
      'devis.dossier_id → dossiers (cascade)',
      'devis_factures.devis_id → devis (cascade)',
      'devis_factures.dossier_id → dossiers (cascade)',
      'devis_factures.facture_id → factures_emises (cascade)',
      'devis_numerotation.dossier_id → dossiers (cascade)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const plan = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const table of TABLES_DES_DEVIS) expect(plan, table).toContain(table)
  })

  it('juste avant `exercices_valides`, qui ferme la marche : la série, les devis, puis leurs liens', () => {
    const fin = ORDRE_RESTAURATION_PREVU.slice(-4)
    expect(fin).toEqual(['devis_numerotation', 'devis', 'devis_factures', 'exercices_valides'])
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('devis_factures')).toBeGreaterThan(rang('factures_emises'))
    expect(rang('devis')).toBeGreaterThan(rang('dossiers'))
  })

  it('un défaut planté se voit : le lien avant son devis', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'devis_factures')
    plante.splice(plante.indexOf('devis'), 0, 'devis_factures')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('devis_factures → devis')
  })
})
