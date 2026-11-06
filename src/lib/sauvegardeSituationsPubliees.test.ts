import { afterEach, describe, expect, it, vi } from 'vitest'
import { SITUATIONS_PUBLIEES_EXPORTEES } from './situationsPubliees'
import {
  auPlanAujourdHui,
  auPlanDesSituationsPubliees,
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
  TABLES_DE_LA_CAISSE,
  TABLES_DE_LA_TRACE_DES_DROITS,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DES_SITUATIONS_PUBLIEES,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES SITUATIONS PUBLIÉES AU PLAN DE SAUVEGARDE (espace client, étape C4a). Leur migration, `situations_publiees`, est
// préparée, pas appliquée : drapeau baissé, le plan effectif ne dit RIEN de la table — une sauvegarde lirait une table absente
// et échouerait —, et le plan PRÉVU est déjà juste, pour que lever `SITUATIONS_PUBLIEES_EXPORTEES` suffise le jour venu.

const TABLE = 'situations_publiees'

describe('le filtre du plan, côté situations publiées', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DES_SITUATIONS_PUBLIEES).toEqual([TABLE])
    expect(auPlanDesSituationsPubliees(TABLE, false)).toBe(false)
    expect(auPlanDesSituationsPubliees(TABLE, true)).toBe(true)
    expect(auPlanDesSituationsPubliees('memberships', false)).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(SITUATIONS_PUBLIEES_EXPORTEES)
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE, ...TABLES_DE_LA_TRACE_DES_DROITS]
    expect(TABLES_DES_SITUATIONS_PUBLIEES.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table ; sa clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(SITUATIONS_PUBLIEES_EXPORTEES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, situations comprises', () => {
  it('l’ordre, le chemin, la vague de `remplace_id`, et les deux relations de la migration', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === TABLE)).toEqual([{ table: TABLE, colonne: 'remplace_id' }])
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual([
      'situations_publiees.dossier_id → dossiers (cascade)',
      'situations_publiees.remplace_id → situations_publiees (bloque)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('dossiers'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('situations_publiees → dossiers')
  })
})

describe('les situations dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./situationsPubliees')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./situationsPubliees', () => ({ SITUATIONS_PUBLIEES_EXPORTEES: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    situations_publiees: [
      // Le retrait d'abord dans la sauvegarde : la vague le remet après la publication qu'il cite.
      { id: 'r1', dossier_id: 'd1', annee: 2025, geste: 'retrait', arretee_au: '2025-06-30', statut: null, contenu: null,
        remplace_id: 's1', auteur: 'u1', publiee_le: '2025-07-02T08:00:00Z' },
      { id: 's1', dossier_id: 'd1', annee: 2025, geste: 'publication', arretee_au: '2025-06-30', statut: 'provisoire',
        contenu: { version: 1 }, remplace_id: null, auteur: 'u1', publiee_le: '2025-07-01T08:00:00Z' },
    ],
  }

  it('levé : deux vagues, la publication puis son retrait', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes.filter((e) => e.table === TABLE)
    expect(etapes.map((e) => e.lignes.map((l) => l.id))).toEqual([['s1'], ['r1']])
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })
})
