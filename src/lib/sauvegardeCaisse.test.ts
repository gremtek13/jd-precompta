import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAISSE_EXPORTEE } from './caisse'
import {
  auGrapheDeLaCaisse,
  auPlanAujourdHui,
  auPlanDeLaCaisse,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  COLONNES_GENEREES,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  planReinsertion,
  RELATIONS,
  RELATIONS_DE_LA_CAISSE,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DE_LA_CAISSE,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA CAISSE AU PLAN DE SAUVEGARDE (ligne 26.6, étape C2). Ses migrations sont PRÉPARÉES, pas appliquées : le drapeau
// `CAISSE_EXPORTEE` est baissé, et le plan effectif ne nomme ni la table ni la colonne d'`ecritures_brouillon` — une
// sauvegarde lirait une table absente et échouerait. Le plan PRÉVU est celui du jour de l'application. Les tests qui
// confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`,
// `sauvegarde`) jugent l'état effectif ; celui-ci juge le plan prévu contre le texte de la migration préparée, le lien des
// deux, et le plan rechargé sous chaque état du drapeau — le graphe, l'ordre et les vagues se calculent au chargement.

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application.
const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_caisse\.sql$/.test(f.chemin))?.texte ?? ''
const cle = (r: { enfant: string; colonne: string; parent: string; aLaSuppression: string }) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

describe('le filtre du plan, côté caisse', () => {
  it('la table de la caisse n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DE_LA_CAISSE).toEqual(['operations_caisse'])
    for (const table of TABLES_DE_LA_CAISSE) {
      expect(auPlanDeLaCaisse(table, false), table).toBe(false)
      expect(auPlanDeLaCaisse(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'ecritures_brouillon', 'contacts', 'devis', 'operations', 'exercices_valides']) {
      expect(auPlanDeLaCaisse(table, false), table).toBe(true)
      expect(auPlanDeLaCaisse(table, true), table).toBe(true)
    }
  })

  it('la source d’une écriture de la caisse n’est au graphe que le drapeau levé ; toute autre relation, toujours', () => {
    expect(RELATIONS_DE_LA_CAISSE).toEqual([{ enfant: 'ecritures_brouillon', colonne: 'operation_caisse_id' }])
    expect(auGrapheDeLaCaisse({ enfant: 'ecritures_brouillon', colonne: 'operation_caisse_id' }, false)).toBe(false)
    expect(auGrapheDeLaCaisse({ enfant: 'ecritures_brouillon', colonne: 'operation_caisse_id' }, true)).toBe(true)
    for (const r of [{ enfant: 'ecritures_brouillon', colonne: 'piece_id' }, { enfant: 'operations_caisse', colonne: 'dossier_id' }]) {
      expect(auGrapheDeLaCaisse(r, false), r.colonne).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau de la caisse', () => {
    expect(auPlanAujourdHui('operations_caisse')).toBe(CAISSE_EXPORTEE)
    expect(auPlanAujourdHui('ecritures_brouillon')).toBe(true)
  })

  it('aucune table n’est à la fois de la caisse et d’un autre drapeau : chaque drapeau garde les siennes', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS]
    expect(TABLES_DE_LA_CAISSE.filter((t) => autres.includes(t))).toEqual([])
  })

  it('le plan effectif ne nomme la caisse — sa table, sa vague, la colonne du brouillon — que le drapeau levé', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table),
    ])
    for (const table of TABLES_DE_LA_CAISSE) expect(nommees.has(table), table).toBe(CAISSE_EXPORTEE)
    expect(RELATIONS.some((r) => r.colonne === 'operation_caisse_id')).toBe(CAISSE_EXPORTEE)
    // Sa clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain('operations_caisse')
    expect(Object.keys(CLES_PRIMAIRES)).not.toContain('operations_caisse')
    expect(clePrimaire('operations_caisse')).toEqual(['id'])
  })
})

describe('le plan prévu, caisse comprise', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe, sa vague', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === 'operations_caisse')).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS.operations_caisse).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === 'operations_caisse'))
      .toEqual([{ table: 'operations_caisse', colonne: 'remplace_id' }])
    expect(TABLES_AUTO_REFERENCEES.some((a) => a.table === 'operations_caisse')).toBe(false)
    expect(COLONNES_GENEREES.operations_caisse).toBeUndefined()
  })

  it('ses relations sont exactement les clés que la migration préparée déclare, action à la suppression comprise', () => {
    expect(MIGRATION).toContain('create table public.operations_caisse (')
    // Les clés de la table, lues dans son `create table`, et celle de la colonne du brouillon, dans son `alter table`.
    const corps = MIGRATION.slice(MIGRATION.indexOf('create table public.operations_caisse ('), MIGRATION.indexOf('\n);', MIGRATION.indexOf('create table public.operations_caisse (')))
    const action = (texte: string) => /on delete cascade/.test(texte) ? 'cascade' : /on delete set null/.test(texte) ? 'met_a_null' : 'bloque'
    const deLaMigration = [
      ...[...corps.matchAll(/^\s+(\w+) uuid (?:not null )?references public\.(\w+)\(id\)([^,\n]*)/gm)]
        .map((m) => `operations_caisse.${m[1]} → ${m[2]} (${action(m[3])})`),
      ...[...MIGRATION.matchAll(/alter table public\.ecritures_brouillon\s+add column (\w+) uuid references public\.(\w+)\(id\)([^;]*);/g)]
        .map((m) => `ecritures_brouillon.${m[1]} → ${m[2]} (${action(m[3])})`),
    ].sort()
    expect(deLaMigration).toHaveLength(5)
    const prevues = RELATIONS_PREVUES
      .filter((r) => r.enfant === 'operations_caisse' || r.parent === 'operations_caisse').map(cle).sort()
    expect(prevues).toEqual(deLaMigration)
    expect(LIENS_GARDES.some((r) => r.enfant === 'operations_caisse' || r.parent === 'operations_caisse')).toBe(false)
  })

  it('après les pièces et les catégories qu’elle cite, juste avant le brouillon qui la cite — avant `exercices_valides`', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('operations_caisse') + 1]).toBe('ecritures_brouillon')
    expect(rang('operations_caisse')).toBeGreaterThan(rang('pieces'))
    expect(rang('operations_caisse')).toBeGreaterThan(rang('categories'))
    expect(rang('operations_caisse')).toBeLessThan(rang('exercices_valides'))
    // L'ordre du jour, drapeau baissé, est celui d'hier : la caisse n'y déplace rien.
    if (!CAISSE_EXPORTEE) expect(ORDRE_RESTAURATION).toEqual(ORDRE_RESTAURATION_PREVU.filter((t) => auPlanAujourdHui(t)))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain('operations_caisse')
  })

  it('un défaut planté se voit : la caisse après le brouillon qui la cite, ou avant sa pièce', () => {
    const sans = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'operations_caisse')
    const apres = [...sans]
    apres.splice(apres.indexOf('ecritures_brouillon') + 1, 0, 'operations_caisse')
    expect(violationsOrdre(apres, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('ecritures_brouillon → operations_caisse')
    const avant = [...sans]
    avant.splice(avant.indexOf('pieces'), 0, 'operations_caisse')
    expect(violationsOrdre(avant, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('operations_caisse → pieces')
  })
})

describe('le plan rechargé sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./caisse')
    vi.resetModules()
  })

  // Le graphe, l'ordre et les vagues sont calculés au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./caisse', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./caisse')>()),
      CAISSE_EXPORTEE: drapeau,
    }))
    return import('./sauvegarde')
  }

  // Une caisse réaliste : un apport, une recette retirée puis remplacée deux fois (la chaîne lue dans le désordre),
  // un prélèvement, et leurs écritures.
  const contenu = () => ({
    dossiers: [{ id: 'd' }],
    pieces: [{ id: 'p1', dossier_id: 'd', categorie_id: null, sous_dossier_id: null, facture_id: null }],
    operations_caisse: [
      { id: 'o3', dossier_id: 'd', genre: 'recette', remplace_id: 'o2', categorie_id: null, piece_id: null, retire_le: null },
      { id: 'o1', dossier_id: 'd', genre: 'recette', remplace_id: null, categorie_id: null, piece_id: null, retire_le: '2026-03-03T09:00:00Z' },
      { id: 'o0', dossier_id: 'd', genre: 'apport', remplace_id: null, categorie_id: null, piece_id: null, retire_le: null },
      { id: 'o2', dossier_id: 'd', genre: 'recette', remplace_id: 'o1', categorie_id: null, piece_id: null, retire_le: '2026-03-04T09:00:00Z' },
    ],
    ecritures_brouillon: [
      { id: 'e1', dossier_id: 'd', operation_caisse_id: 'o0', piece_id: null, ligne_bancaire_id: null },
      { id: 'e2', dossier_id: 'd', operation_caisse_id: 'o3', piece_id: null, ligne_bancaire_id: null },
    ],
  })

  it('levé : la table, sa relation et sa vague ; la chaîne part maillon par maillon, et une écriture ne perd pas son opération', async () => {
    const s = await sauvegardeSous(true)
    expect(s.ORDRE_RESTAURATION).toContain('operations_caisse')
    expect(s.RELATIONS.some((r) => r.enfant === 'ecritures_brouillon' && r.colonne === 'operation_caisse_id')).toBe(true)
    expect(s.TABLES_AUTO_REFERENCEES_PAR_VAGUES).toContainEqual({ table: 'operations_caisse', colonne: 'remplace_id' })
    const plan = s.planReinsertion(contenu())
    expect(plan.etapes.filter((e) => e.table === 'operations_caisse').map((e) => e.lignes.map((l) => l.id)))
      .toEqual([['o1', 'o0'], ['o2'], ['o3']])
    expect(plan.tablesIgnorees).toEqual([])
    expect(plan.secondePasse).toEqual([])
    const tables = plan.etapes.map((e) => e.table)
    expect(tables.lastIndexOf('operations_caisse')).toBeLessThan(tables.indexOf('ecritures_brouillon'))
    // Une écriture dont l'opération manque à la sauvegarde est un lien perdu, et jamais un lien qu'on efface.
    const sansO3 = { ...contenu(), operations_caisse: contenu().operations_caisse.filter((o) => o.id !== 'o3') }
    expect(s.liensPerdus(sansO3)).toEqual([
      { table: 'ecritures_brouillon', colonne: 'operation_caisse_id', parent: 'operations_caisse', valeur: 'o3', effacable: false },
    ])
    expect(s.liensPerdus(contenu())).toEqual([])
  })

  it('baissé : rien de la caisse n’est au plan — sa table serait une table ignorée, que la restauration refuse', async () => {
    const s = await sauvegardeSous(false)
    expect(s.ORDRE_RESTAURATION).not.toContain('operations_caisse')
    expect(s.RELATIONS.some((r) => r.enfant === 'operations_caisse' || r.colonne === 'operation_caisse_id')).toBe(false)
    expect(s.TABLES_AUTO_REFERENCEES_PAR_VAGUES.some((a) => a.table === 'operations_caisse')).toBe(false)
    expect(s.planReinsertion(contenu()).tablesIgnorees).toEqual(['operations_caisse'])
    expect(s.liensPerdus({ ...contenu(), operations_caisse: [] })).toEqual([])
  })

  it('le module chargé normalement dit ce que dit son drapeau', () => {
    expect(planReinsertion(contenu()).tablesIgnorees).toEqual(CAISSE_EXPORTEE ? [] : ['operations_caisse'])
  })
})
