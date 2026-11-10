import { afterEach, describe, expect, it, vi } from 'vitest'
import { FACTURES_IMPORTEES_PREVUES } from './facturesImportees'
import {
  auPlanAujourdHui,
  auPlanDesFacturesImportees,
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
  TABLES_DES_FACTURES_IMPORTEES,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DES_SITUATIONS_PUBLIEES,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES FACTURES REPRISES AU PLAN DE SAUVEGARDE (ligne 51.5, étape A8a). Leur migration, `factures_importees`, est préparée, pas
// appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de ses deux tables — une sauvegarde lirait
// une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, pour que lever `FACTURES_IMPORTEES_PREVUES`
// suffise le jour venu. Les tests qui confrontent le plan au schéma exporté jugent l'état effectif ; celui-ci juge le plan
// prévu, le plan du jour dans les deux états du drapeau, et leur lien.

const LOT = 'imports_factures'
const REPRISES = 'factures_importees'

describe('le filtre du plan, côté factures reprises', () => {
  it('les deux tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_FACTURES_IMPORTEES).toEqual([LOT, REPRISES])
    for (const table of TABLES_DES_FACTURES_IMPORTEES) {
      expect(auPlanDesFacturesImportees(table, false), table).toBe(false)
      expect(auPlanDesFacturesImportees(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'factures_emises', 'facture_lignes', 'encaissements_factures']) {
      expect(auPlanDesFacturesImportees(table, false), table).toBe(true)
      expect(auPlanDesFacturesImportees(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau des factures reprises', () => {
    expect(auPlanAujourdHui(LOT)).toBe(FACTURES_IMPORTEES_PREVUES)
    expect(auPlanAujourdHui(REPRISES)).toBe(FACTURES_IMPORTEES_PREVUES)
    expect(auPlanAujourdHui('factures_emises')).toBe(true)
  })

  it('aucune table n’est à la fois des factures reprises et d’un autre drapeau', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE,
      ...TABLES_DE_LA_TRACE_DES_DROITS, ...TABLES_DES_SITUATIONS_PUBLIEES]
    expect(TABLES_DES_FACTURES_IMPORTEES.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les deux tables — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(LOT)).toBe(FACTURES_IMPORTEES_PREVUES)
    expect(nommees.has(REPRISES)).toBe(FACTURES_IMPORTEES_PREVUES)
  })
})

describe('le plan prévu, factures reprises comprises', () => {
  it('les deux tables y entrent partout : l’ordre, les chemins, la clé de la reprise — et aucune vague', () => {
    for (const table of TABLES_DES_FACTURES_IMPORTEES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === table), table).toBe(false)
    }
    // Le lot a la clé commune ; une facture reprise a pour clé sa facture, comme la migration la déclare.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(LOT)
    expect(CLES_PRIMAIRES_PREVUES[REPRISES]).toEqual(['facture_id'])
  })

  it('leurs relations, telles que la migration les déclare : le dossier et la facture en cascade, le lot et l’origine d’un avoir sans action', () => {
    const desReprises = RELATIONS_PREVUES
      .filter((r) => TABLES_DES_FACTURES_IMPORTEES.includes(r.enfant)
        || (TABLES_DES_FACTURES_IMPORTEES.includes(r.parent) && r.enfant !== 'pieces_des_factures_reprises'))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desReprises).toEqual([
      'imports_factures.dossier_id → dossiers (cascade)',
      'factures_importees.dossier_id → dossiers (cascade)',
      'factures_importees.facture_id → factures_emises (cascade)',
      'factures_importees.import_id → imports_factures (bloque)',
      'factures_importees.origine_id → factures_emises (bloque)',
    ])
    expect(LIENS_GARDES.some((r) => TABLES_DES_FACTURES_IMPORTEES.includes(r.enfant)
      || TABLES_DES_FACTURES_IMPORTEES.includes(r.parent))).toBe(false)
  })

  it('juste après les factures : le lot, puis ses factures reprises', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang('factures_emises'), rang('factures_emises') + 3))
      .toEqual(['factures_emises', LOT, REPRISES])
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const exportees = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    expect(exportees).toContain(LOT)
    expect(exportees).toContain(REPRISES)
  })

  it('un défaut planté se voit : la facture reprise avant son lot, le lot avant son dossier', () => {
    const sansReprise = ORDRE_RESTAURATION_PREVU.filter((t) => t !== REPRISES)
    sansReprise.splice(sansReprise.indexOf(LOT), 0, REPRISES)
    expect(violationsOrdre(sansReprise, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('factures_importees → imports_factures')
    const sansLot = ORDRE_RESTAURATION_PREVU.filter((t) => t !== LOT)
    sansLot.splice(sansLot.indexOf('dossiers'), 0, LOT)
    expect(violationsOrdre(sansLot, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('imports_factures → dossiers')
  })
})

describe('les factures reprises dans les deux états du drapeau : la réinsertion et les liens perdus', () => {
  afterEach(() => {
    vi.doUnmock('./facturesImportees')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./facturesImportees', () => ({ FACTURES_IMPORTEES_PREVUES: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = () => ({
    dossiers: [{ id: 'd1' }],
    factures_emises: [
      { id: 'f1', dossier_id: 'd1', numero: 'FAC-118', statut: 'importee', type: 'facture', facture_origine_id: null },
      { id: 'f2', dossier_id: 'd1', numero: 'AV 3', statut: 'importee', type: 'avoir', facture_origine_id: null },
    ],
    imports_factures: [{ id: 'l1', dossier_id: 'd1', format: 'csv', nombre_factures: 2 }],
    factures_importees: [
      { facture_id: 'f1', dossier_id: 'd1', import_id: 'l1', rang: 1, origine_id: null },
      { facture_id: 'f2', dossier_id: 'd1', import_id: 'l1', rang: 2, origine_id: 'f1' },
    ],
  })

  it('levé : le lot puis ses factures reprises, après les factures, chacun en une étape ; rien de perdu', async () => {
    const s = await sauvegardeSous(true)
    const plan = s.planReinsertion(contenu())
    const tables = plan.etapes.map((e) => e.table)
    expect(plan.etapes.filter((e) => e.table === LOT).map((e) => e.lignes.length)).toEqual([1])
    expect(plan.etapes.filter((e) => e.table === REPRISES).map((e) => e.lignes.length)).toEqual([2])
    expect(tables.indexOf(LOT)).toBeGreaterThan(tables.indexOf('factures_emises'))
    expect(tables.indexOf(REPRISES)).toBeGreaterThan(tables.indexOf(LOT))
    expect(s.liensPerdus(contenu())).toEqual([])
  })

  it('levé : une facture reprise dont la facture ou le lot manque est un lien perdu', async () => {
    const s = await sauvegardeSous(true)
    const sansLot = { ...contenu(), imports_factures: [] }
    expect(s.liensPerdus(sansLot).map((l) => `${l.table}.${l.colonne}`)).toContain('factures_importees.import_id')
  })

  it('baissé : ni le lot ni les factures reprises n’entrent au plan, même présents dans une sauvegarde', async () => {
    const s = await sauvegardeSous(false)
    const plan = s.planReinsertion(contenu())
    const tables = plan.etapes.map((e) => e.table)
    expect(tables).not.toContain(LOT)
    expect(tables).not.toContain(REPRISES)
  })

  it('la clé d’une facture reprise est sa facture, drapeau levé seulement', async () => {
    expect(clePrimaire(REPRISES)).toEqual(FACTURES_IMPORTEES_PREVUES ? ['facture_id'] : ['id'])
    const leve = await sauvegardeSous(true)
    expect(leve.clePrimaire(REPRISES)).toEqual(['facture_id'])
  })
})
