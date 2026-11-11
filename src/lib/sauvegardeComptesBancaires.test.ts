import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPTES_BANCAIRES_PREVUS, TABLES_DES_COMPTES_BANCAIRES } from './comptesBancaires'
import { fichiersPrepares, relationsDuSchema } from '../test/schema'
import {
  auGrapheDesComptesBancaires,
  auPlanAujourdHui,
  auPlanDesComptesBancaires,
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

// LES COMPTES BANCAIRES D'UN DOSSIER AU PLAN DE SAUVEGARDE (ligne 26.6, lot MCB1). Leur migration, `comptes_bancaires`, est
// préparée, pas appliquée : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de la table — ni elle, ni
// les clés des mouvements et des contrôles vers elle : une sauvegarde lirait une table absente et échouerait —, et le plan
// PRÉVU doit déjà être juste, pour que lever `COMPTES_BANCAIRES_PREVUS` suffise le jour venu.

const TABLE = 'comptes_bancaires'
const versLeCompte = (r: { enfant: string; parent: string; colonne: string }) =>
  r.parent === TABLE && r.colonne === 'compte_bancaire_id'

describe('le filtre du plan, côté comptes bancaires', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_COMPTES_BANCAIRES).toEqual([TABLE])
    expect(auPlanDesComptesBancaires(TABLE, false)).toBe(false)
    expect(auPlanDesComptesBancaires(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'lignes_bancaires', 'controles_releves_bancaires', 'connexions_bancaires']) {
      expect(auPlanDesComptesBancaires(table, false), table).toBe(true)
    }
    expect(auPlanAujourdHui(TABLE)).toBe(COMPTES_BANCAIRES_PREVUS)
  })

  it('le graphe : les relations qui la nomment, enfant ou parent, ne sont du jour que le drapeau levé', () => {
    const lignes = RELATIONS_PREVUES.find((r) => r.enfant === 'lignes_bancaires' && versLeCompte(r))
    expect(lignes).toBeDefined()
    expect(auGrapheDesComptesBancaires(lignes!, false)).toBe(false)
    expect(auGrapheDesComptesBancaires(lignes!, true)).toBe(true)
    const autre = RELATIONS_PREVUES.find((r) => r.enfant === 'lignes_bancaires' && r.parent === 'dossiers')
    expect(auGrapheDesComptesBancaires(autre!, false)).toBe(true)
  })

  it('aucune table n’est à la fois des comptes bancaires et d’un autre drapeau', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION, ...TABLES_DU_JOURNAL_DES_DESIGNATIONS, ...TABLES_DE_LA_CAISSE,
      ...TABLES_DE_LA_TRACE_DES_DROITS, ...TABLES_DES_SITUATIONS_PUBLIEES, ...TABLES_DES_FACTURES_IMPORTEES]
    expect(TABLES_DES_COMPTES_BANCAIRES.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme ni la table ni les clés vers elle — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(COMPTES_BANCAIRES_PREVUS)
    expect(RELATIONS.filter(versLeCompte).length > 0).toBe(COMPTES_BANCAIRES_PREVUS)
  })
})

describe('le plan prévu, comptes bancaires compris', () => {
  it('la table y entre : l’ordre, son chemin direct, la clé commune — et aucune vague', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
  })

  it('ses relations, telles que les migrations les déclarent : le dossier en cascade, les mouvements, les contrôles et l’ouverture éclatée sans action', () => {
    const desComptes = RELATIONS_PREVUES
      .filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desComptes).toEqual([
      'comptes_bancaires.dossier_id → dossiers (cascade)',
      'controles_releves_bancaires.compte_bancaire_id → comptes_bancaires (bloque)',
      // MCB5g : la source d'une écriture qui éclate l'ouverture (migration `ouverture_eclatee_par_compte`).
      'ecritures_brouillon.ouverture_compte_bancaire_id → comptes_bancaires (bloque)',
      'lignes_bancaires.compte_bancaire_id → comptes_bancaires (bloque)',
    ])
    // Chacune est une clé que la migration préparée déclare, vers cette table.
    const declarees = relationsDuSchema(fichiersPrepares()).filter((r) => r.parent === TABLE).map((r) => `${r.enfant}.${r.colonne}`)
    expect(declarees).toContain('ecritures_brouillon.ouverture_compte_bancaire_id')
    expect(LIENS_GARDES.some((r) => r.enfant === TABLE || r.parent === TABLE)).toBe(false)
  })

  it('après le plan du dossier, que sa garde lit ; avant les contrôles et les mouvements, qui la citent', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang(TABLE)).toBeGreaterThan(rang('plan_comptable_dossier'))
    expect(rang(TABLE)).toBeLessThan(rang('controles_releves_bancaires'))
    expect(rang(TABLE)).toBeLessThan(rang('lignes_bancaires'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
  })

  it('un défaut planté se voit : les mouvements avant leur compte', () => {
    const ordre = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    ordre.splice(ordre.indexOf('lignes_bancaires') + 1, 0, TABLE)
    expect(violationsOrdre(ordre, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('lignes_bancaires → comptes_bancaires')
  })
})

describe('les comptes bancaires dans les deux états du drapeau : la réinsertion et les liens perdus', () => {
  afterEach(() => {
    vi.doUnmock('./comptesBancaires')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./comptesBancaires', async (original) => ({
      ...(await original<typeof import('./comptesBancaires')>()), COMPTES_BANCAIRES_PREVUS: drapeau }))
    return import('./sauvegarde')
  }

  const contenu = () => ({
    dossiers: [{ id: 'd1' }],
    comptes_bancaires: [
      { id: 's1', dossier_id: 'd1', libelle: 'Second', principal: false, compte: '512100', compte_propre_depuis: '2026-01-01' },
      { id: 'p1', dossier_id: 'd1', libelle: 'Compte principal', principal: true, compte: null, compte_propre_depuis: null },
    ],
    controles_releves_bancaires: [{ id: 'r1', dossier_id: 'd1', compte_bancaire_id: 's1', source_fichier: 'releve.csv' }],
    lignes_bancaires: [
      { id: 'l1', dossier_id: 'd1', compte_bancaire_id: 'p1', date: '2026-01-02', libelle: 'FRAIS', montant: -1 },
      { id: 'l2', dossier_id: 'd1', compte_bancaire_id: 's1', date: '2026-01-03', libelle: 'FRAIS', montant: -1 },
    ],
  })

  it('levé : les comptes d’un dossier en une étape, avant les contrôles et les mouvements ; rien de perdu', async () => {
    const s = await sauvegardeSous(true)
    const plan = s.planReinsertion(contenu())
    const tables = plan.etapes.map((e) => e.table)
    expect(plan.etapes.filter((e) => e.table === TABLE).map((e) => e.lignes.length)).toEqual([2])
    expect(tables.indexOf(TABLE)).toBeLessThan(tables.indexOf('controles_releves_bancaires'))
    expect(tables.indexOf(TABLE)).toBeLessThan(tables.indexOf('lignes_bancaires'))
    expect(s.liensPerdus(contenu())).toEqual([])
  })

  it('levé : un mouvement dont le compte manque est un lien perdu', async () => {
    const s = await sauvegardeSous(true)
    const sansSecond = { ...contenu(), comptes_bancaires: contenu().comptes_bancaires.filter((c) => c.id !== 's1') }
    expect(s.liensPerdus(sansSecond).map((l) => `${l.table}.${l.colonne}`)).toContain('lignes_bancaires.compte_bancaire_id')
  })

  // MCB5g : l'écriture qui éclate l'ouverture cite le compte bancaire dont elle ouvre le 512.
  const avecLOuverture = () => ({
    ...contenu(),
    ecritures_brouillon: [
      { id: 'o1', dossier_id: 'd1', date: '2026-01-01', compte: '512100', sens: 'debit', montant: 250, ouverture_compte_bancaire_id: 's1' },
      { id: 'o2', dossier_id: 'd1', date: '2026-01-01', compte: '512000', sens: 'credit', montant: 250, ouverture_compte_bancaire_id: 's1' },
    ],
  })

  it('levé : l’écriture de l’ouverture éclatée après son compte ; sans lui, un lien perdu qui ne s’efface pas', async () => {
    const s = await sauvegardeSous(true)
    const tables = s.planReinsertion(avecLOuverture()).etapes.map((e) => e.table)
    expect(tables.indexOf(TABLE)).toBeLessThan(tables.indexOf('ecritures_brouillon'))
    expect(s.liensPerdus(avecLOuverture())).toEqual([])
    const sansSecond = { ...avecLOuverture(), comptes_bancaires: contenu().comptes_bancaires.filter((c) => c.id !== 's1'), lignes_bancaires: [], controles_releves_bancaires: [] }
    expect(s.liensPerdus(sansSecond).map((l) => [`${l.table}.${l.colonne}`, l.effacable]))
      .toEqual([['ecritures_brouillon.ouverture_compte_bancaire_id', false], ['ecritures_brouillon.ouverture_compte_bancaire_id', false]])
  })

  it('baissé : la table n’entre pas au plan, même présente dans une sauvegarde, et aucun lien vers elle ne se juge', async () => {
    const s = await sauvegardeSous(false)
    const plan = s.planReinsertion(contenu())
    expect(plan.etapes.map((e) => e.table)).not.toContain(TABLE)
    expect(s.liensPerdus({ ...contenu(), comptes_bancaires: [] })).toEqual([])
    expect(s.liensPerdus({ ...avecLOuverture(), comptes_bancaires: [] })).toEqual([])
  })
})
