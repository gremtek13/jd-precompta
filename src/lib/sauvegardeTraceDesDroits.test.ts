import { afterEach, describe, expect, it, vi } from 'vitest'
import { TRACE_DES_DROITS_PREVUE } from './traceDesDroits'
import {
  auPlanAujourdHui,
  auPlanDeLaTraceDesDroits,
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
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LA TRACE DES DROITS AU PLAN DE SAUVEGARDE (espace client, étape P1-trace). Sa migration, `trace_des_droits`, est en
// production depuis le 07/11/2026 et le drapeau levé : la table est au plan effectif. Avant, le plan effectif ne devait RIEN
// dire de la table — une sauvegarde aurait lu une table absente et échoué —, et cet état d'avant reste éprouvé tant que son
// code existe (le drapeau rebaissé par `vi.doMock`, plus bas). Les tests qui confrontent le plan au schéma exporté jugent
// l'état effectif ; celui-ci juge le plan prévu, le plan du jour dans les deux états du drapeau, et leur lien.

const TABLE = 'trace_des_droits'

describe('le filtre du plan, côté trace des droits', () => {
  it('la table de la trace n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DE_LA_TRACE_DES_DROITS).toEqual([TABLE])
    expect(auPlanDeLaTraceDesDroits(TABLE, false)).toBe(false)
    expect(auPlanDeLaTraceDesDroits(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'memberships', 'designations_des_pieces', 'operations_caisse']) {
      expect(auPlanDeLaTraceDesDroits(table, false), table).toBe(true)
      expect(auPlanDeLaTraceDesDroits(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau de la trace', () => {
    expect(auPlanAujourdHui(TABLE)).toBe(TRACE_DES_DROITS_PREVUE)
    expect(auPlanAujourdHui('memberships')).toBe(true)
  })

  it('aucune table n’est à la fois de la trace et d’un autre drapeau', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE]
    expect(TABLES_DE_LA_TRACE_DES_DROITS.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas la trace — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(TRACE_DES_DROITS_PREVUE)
    // Sa clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, trace comprise', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe — et aucune vague', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('sa seule relation, telle que la migration la déclare : le dossier en cascade — ni l’accès ni un compte, et aucune table ne la pointe', () => {
    const deLaTrace = RELATIONS_PREVUES
      .filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(deLaTrace).toEqual(['trace_des_droits.dossier_id → dossiers (cascade)'])
    expect(LIENS_GARDES.some((r) => r.enfant === TABLE || r.parent === TABLE)).toBe(false)
  })

  it('juste après les accès : la restauration réinsère l’accès (rien de tracé), puis sa trace', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    // Depuis l'étape C4a, les situations publiées s'intercalent : la trace reste après les accès, à un rang près.
    expect(ORDRE_RESTAURATION_PREVU.slice(rang(TABLE) - 2, rang(TABLE))).toEqual(['memberships', 'situations_publiees'])
    expect(rang(TABLE)).toBeGreaterThan(rang('dossiers'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
  })

  it('un défaut planté se voit : la trace avant son dossier', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('dossiers'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('trace_des_droits → dossiers')
  })
})

describe('la trace dans les deux états du drapeau : la réinsertion et les liens perdus', () => {
  afterEach(() => {
    vi.doUnmock('./traceDesDroits')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./traceDesDroits', () => ({ TRACE_DES_DROITS_PREVUE: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = (dossierDeLaTrace: string) => ({
    dossiers: [{ id: 'd1' }],
    memberships: [{ id: 'm1', dossier_id: 'd1', user_id: 'u2', droit_banque: true }],
    trace_des_droits: [
      { id: 't1', dossier_id: dossierDeLaTrace, acces_id: 'm1', client_id: 'u2', droit: 'banque', coche: true,
        geste: 'changement', auteur_id: 'u1', fait_le: '2026-11-05T08:00:00Z' },
      // L'accès d'une ligne retirée n'est plus là : la trace survit à son accès, sans lien à juger.
      { id: 't2', dossier_id: dossierDeLaTrace, acces_id: 'm9', client_id: 'u3', droit: 'ventes', coche: false,
        geste: 'retrait', auteur_id: null, fait_le: '2026-11-05T08:05:00Z' },
    ],
  })

  it('levé : une étape, toutes les lignes, après les accès ; un dossier absent est un lien perdu, jamais effaçable ; un accès absent n’en est pas un', async () => {
    const s = await sauvegardeSous(true)
    const plan = s.planReinsertion(contenu('d1'))
    const tables = plan.etapes.map((e) => e.table)
    expect(plan.etapes.filter((e) => e.table === TABLE).map((e) => e.lignes.map((l) => l.id))).toEqual([['t1', 't2']])
    expect(tables.indexOf(TABLE)).toBeGreaterThan(tables.indexOf('memberships'))
    expect(s.liensPerdus(contenu('d1'))).toEqual([])
    expect(s.liensPerdus(contenu('d9')).map((l) => `${l.table}.${l.colonne}:${l.valeur}:${String(l.effacable)}`))
      .toEqual(['trace_des_droits.dossier_id:d9:false', 'trace_des_droits.dossier_id:d9:false'])
  })

  it('baissé : rien n’en part, et rien ne s’en dit — l’export ne porte pas la table', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu('d1')).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.liensPerdus(contenu('d9'))).toEqual([])
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })

  it('le module chargé normalement dit ce que dit son drapeau', async () => {
    const s = await import('./sauvegarde')
    expect(s.ORDRE_RESTAURATION.includes(TABLE)).toBe(TRACE_DES_DROITS_PREVUE)
  })
})
