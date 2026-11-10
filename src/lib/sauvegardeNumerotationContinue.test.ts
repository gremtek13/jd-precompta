import { afterEach, describe, expect, it, vi } from 'vitest'
import { NUMEROTATION_CONTINUE_PREVUE } from './numerotationContinue'
import {
  auPlanAujourdHui,
  auPlanDeLaNumerotationContinue,
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
  TABLES_DE_LA_NUMEROTATION_CONTINUE,
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

// LA NUMÉROTATION QUI CONTINUE AU PLAN DE SAUVEGARDE (ligne 51.5, étape A9a). Sa migration, `numerotation_continue`, est
// préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de ses deux tables — une
// sauvegarde lirait une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, pour que lever
// `NUMEROTATION_CONTINUE_PREVUE` suffise le jour venu. Les tests qui confrontent le plan au schéma exporté jugent l'état
// effectif ; celui-ci juge le plan prévu, le plan du jour dans les deux états du drapeau, et leur lien.

const MODELES = 'modeles_numerotation'
const CONTINUITE = 'continuite_des_series'

describe('le filtre du plan, côté numérotation qui continue', () => {
  it('les deux tables ne sont au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DE_LA_NUMEROTATION_CONTINUE).toEqual([MODELES, CONTINUITE])
    for (const table of TABLES_DE_LA_NUMEROTATION_CONTINUE) {
      expect(auPlanDeLaNumerotationContinue(table, false), table).toBe(false)
      expect(auPlanDeLaNumerotationContinue(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'factures_emises', 'facture_numerotation', 'factures_importees']) {
      expect(auPlanDeLaNumerotationContinue(table, false), table).toBe(true)
      expect(auPlanDeLaNumerotationContinue(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau de la numérotation', () => {
    expect(auPlanAujourdHui(MODELES)).toBe(NUMEROTATION_CONTINUE_PREVUE)
    expect(auPlanAujourdHui(CONTINUITE)).toBe(NUMEROTATION_CONTINUE_PREVUE)
    expect(auPlanAujourdHui('factures_emises')).toBe(true)
  })

  it('aucune table n’est à la fois de la numérotation et d’un autre drapeau', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE,
      ...TABLES_DE_LA_TRACE_DES_DROITS, ...TABLES_DES_SITUATIONS_PUBLIEES, ...TABLES_DES_FACTURES_IMPORTEES]
    expect(TABLES_DE_LA_NUMEROTATION_CONTINUE.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les deux tables — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(MODELES)).toBe(NUMEROTATION_CONTINUE_PREVUE)
    expect(nommees.has(CONTINUITE)).toBe(NUMEROTATION_CONTINUE_PREVUE)
  })
})

describe('le plan prévu, numérotation qui continue comprise', () => {
  it('les deux tables y entrent partout : l’ordre, les chemins — leur clé est la commune, et aucune vague', () => {
    for (const table of TABLES_DE_LA_NUMEROTATION_CONTINUE) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === table), table).toBe(false)
      expect(Object.keys(CLES_PRIMAIRES_PREVUES), table).not.toContain(table)
    }
  })

  it('leurs relations, telles que la migration les déclare : le dossier, en cascade', () => {
    const desSiennes = RELATIONS_PREVUES
      .filter((r) => TABLES_DE_LA_NUMEROTATION_CONTINUE.includes(r.enfant) || TABLES_DE_LA_NUMEROTATION_CONTINUE.includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desSiennes).toEqual([
      'modeles_numerotation.dossier_id → dossiers (cascade)',
      'continuite_des_series.dossier_id → dossiers (cascade)',
    ])
    expect(LIENS_GARDES.some((r) => TABLES_DE_LA_NUMEROTATION_CONTINUE.includes(r.enfant)
      || TABLES_DE_LA_NUMEROTATION_CONTINUE.includes(r.parent))).toBe(false)
  })

  it('juste après les factures reprises : les modèles, puis les paroles du cabinet sur la suite reprise', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU.slice(rang('factures_importees'), rang('factures_importees') + 3))
      .toEqual(['factures_importees', MODELES, CONTINUITE])
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const exportees = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    expect(exportees).toContain(MODELES)
    expect(exportees).toContain(CONTINUITE)
  })

  it('un défaut planté se voit : un modèle avant son dossier', () => {
    const deplace = ORDRE_RESTAURATION_PREVU.filter((t) => t !== MODELES)
    deplace.splice(deplace.indexOf('dossiers'), 0, MODELES)
    expect(violationsOrdre(deplace, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('modeles_numerotation → dossiers')
  })
})

describe('la numérotation dans les deux états du drapeau : la réinsertion et les liens perdus', () => {
  afterEach(() => {
    vi.doUnmock('./numerotationContinue')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./numerotationContinue', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./numerotationContinue')>()),
      NUMEROTATION_CONTINUE_PREVUE: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = () => ({
    dossiers: [{ id: 'd1' }],
    modeles_numerotation: [
      { id: 'm1', dossier_id: 'd1', nature: 'facture', emetteur: 'client', modele: 'FA-{AAAA}-{N:5}', annuel: true, depuis: 2026, premier_numero: 1 },
    ],
    continuite_des_series: [
      { id: 'c1', dossier_id: 'd1', modele: 'FA-{AAAA}-{N:5}', annuel: true, annee: 2026, geste: 'fin', premier: 5, dernier: 5, motif: 'Essai' },
    ],
  })

  it('levé : les modèles puis les paroles du cabinet, chacun en une étape ; rien de perdu', async () => {
    const s = await sauvegardeSous(true)
    const plan = s.planReinsertion(contenu())
    const tables = plan.etapes.map((e) => e.table)
    expect(plan.etapes.filter((e) => e.table === MODELES).map((e) => e.lignes.length)).toEqual([1])
    expect(plan.etapes.filter((e) => e.table === CONTINUITE).map((e) => e.lignes.length)).toEqual([1])
    expect(tables.indexOf(CONTINUITE)).toBeGreaterThan(tables.indexOf(MODELES))
    expect(s.liensPerdus(contenu())).toEqual([])
  })

  it('baissé : ni les modèles ni les paroles du cabinet n’entrent au plan, même présents dans une sauvegarde', async () => {
    const s = await sauvegardeSous(false)
    const tables = s.planReinsertion(contenu()).etapes.map((e) => e.table)
    expect(tables).not.toContain(MODELES)
    expect(tables).not.toContain(CONTINUITE)
  })

  it('leur clé est la commune, dans les deux états', async () => {
    expect(clePrimaire(MODELES)).toEqual(['id'])
    const leve = await sauvegardeSous(true)
    expect(leve.clePrimaire(MODELES)).toEqual(['id'])
    expect(leve.clePrimaire(CONTINUITE)).toEqual(['id'])
  })
})
