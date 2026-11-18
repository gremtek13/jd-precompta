import { afterEach, describe, expect, it, vi } from 'vitest'
import { PREVISIONS_PUBLIEES_PREVUES } from './previsionsPubliees'
import {
  auPlanAujourdHui,
  auPlanDesPrevisionsPubliees,
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
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DES_PREVISIONS_PUBLIEES,
  TABLES_DES_SITUATIONS_PUBLIEES,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LA PRÉVISION DE TRÉSORERIE PUBLIÉE AU PLAN DE SAUVEGARDE (espace client, C8-Q2). Sa migration, `previsions_publiees`, est
// en production depuis le 18/11/2026 (supabase/schema/20261118154124_previsions_publiees.sql) et le drapeau levé : le plan
// effectif porte la table ; drapeau baissé, il n'en disait RIEN — une sauvegarde aurait lu une table absente —, et les deux
// états du drapeau se jouent (`vi.doMock`, plus bas).

const TABLE = 'previsions_publiees'

describe('le filtre du plan, côté prévisions publiées', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DES_PREVISIONS_PUBLIEES).toEqual([TABLE])
    expect(auPlanDesPrevisionsPubliees(TABLE, false)).toBe(false)
    expect(auPlanDesPrevisionsPubliees(TABLE, true)).toBe(true)
    expect(auPlanDesPrevisionsPubliees('memberships', false)).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(PREVISIONS_PUBLIEES_PREVUES)
    expect(TABLES_DES_PREVISIONS_PUBLIEES.filter((t) => TABLES_DES_SITUATIONS_PUBLIEES.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table ; sa clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(PREVISIONS_PUBLIEES_PREVUES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, prévisions comprises', () => {
  it('l’ordre (après le prévisionnel bancaire), le chemin, la vague de `remplace_id` (après celle des situations), et les deux relations de la migration', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf(TABLE) - 1]).toBe('previsionnels_bancaires')
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    const vagues = TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.map((a) => `${a.table}.${a.colonne}`)
    expect(vagues.filter((v) => v.startsWith(`${TABLE}.`))).toEqual([`${TABLE}.remplace_id`])
    expect(vagues[vagues.indexOf(`${TABLE}.remplace_id`) - 1]).toBe('situations_publiees.remplace_id')
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual([
      'previsions_publiees.dossier_id → dossiers (cascade)',
      'previsions_publiees.remplace_id → previsions_publiees (bloque)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('dossiers'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('previsions_publiees → dossiers')
  })
})

describe('les prévisions dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./previsionsPubliees')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./previsionsPubliees', () => ({ PREVISIONS_PUBLIEES_PREVUES: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    previsions_publiees: [
      // Le retrait d'abord, puis la remplaçante : les vagues les remettent après la publication qu'ils citent.
      { id: 'r1', dossier_id: 'd1', geste: 'retrait', contenu: null, remplace_id: 'p2', auteur: 'u1', publiee_le: '2026-11-20T08:00:00Z' },
      { id: 'p2', dossier_id: 'd1', geste: 'publication', contenu: { version: 1 }, remplace_id: 'p1', auteur: 'u1', publiee_le: '2026-11-16T08:00:00Z' },
      { id: 'p1', dossier_id: 'd1', geste: 'publication', contenu: { version: 1 }, remplace_id: null, auteur: 'u1', publiee_le: '2026-11-15T08:00:00Z' },
    ],
  }

  it('levé : trois vagues, la première publication, sa remplaçante, puis le retrait', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes.filter((e) => e.table === TABLE)
    expect(etapes.map((e) => e.lignes.map((l) => l.id))).toEqual([['p1'], ['p2'], ['r1']])
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })
})
