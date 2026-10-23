import { afterEach, describe, expect, it, vi } from 'vitest'
import { JUMELLE_INVERSEE_EXPORTEE } from './exemplairesDesFactures'
import {
  auPlanAujourdHui,
  auPlanDuJournalDesDesignations,
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
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_FACTURATION,
  TABLES_DU_JOURNAL_DES_DESIGNATIONS,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LE JOURNAL DES DÉSIGNATIONS AU PLAN DE SAUVEGARDE (chantier EC-Q3, étape VF6b). Sa migration, `jumelle_inversee`, attend
// l'accord du cabinet : tant que l'export ne la porte pas, le plan effectif ne doit RIEN dire de la table — une sauvegarde
// lirait une table absente et échouerait —, et le plan PRÉVU doit déjà être juste, pour que lever
// `JUMELLE_INVERSEE_EXPORTEE` suffise le jour venu. Les tests qui confrontent le plan au schéma exporté
// (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`, `sauvegarde`) jugent l'état effectif ; celui-ci juge
// le plan prévu, le plan du jour dans les deux états du drapeau, et leur lien.

const TABLE = 'designations_des_pieces'

describe('le filtre du plan, côté journal des désignations', () => {
  it('la table du journal n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DU_JOURNAL_DES_DESIGNATIONS).toEqual([TABLE])
    expect(auPlanDuJournalDesDesignations(TABLE, false)).toBe(false)
    expect(auPlanDuJournalDesDesignations(TABLE, true)).toBe(true)
    for (const table of ['dossiers', 'pieces', 'factures_emises', 'designations', 'exercices_valides']) {
      expect(auPlanDuJournalDesDesignations(table, false), table).toBe(true)
      expect(auPlanDuJournalDesDesignations(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau de la jumelle inversée', () => {
    expect(auPlanAujourdHui(TABLE)).toBe(JUMELLE_INVERSEE_EXPORTEE)
    expect(auPlanAujourdHui('pieces')).toBe(true)
  })

  it('aucune table n’est à la fois du journal et d’un autre drapeau : chaque drapeau garde les siennes', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS,
      ...TABLES_DES_PARAMETRES_FACTURATION]
    expect(TABLES_DU_JOURNAL_DES_DESIGNATIONS.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas le journal — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(JUMELLE_INVERSEE_EXPORTEE)
    // Sa clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, journal compris', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe — et aucune vague, une ligne n’en pointe aucune autre', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
    expect(TABLES_AUTO_REFERENCEES.some((a) => a.table === TABLE)).toBe(false)
  })

  it('ses relations, telles que la migration les déclare : le dossier et la pièce en cascade, la facture sans action — et aucune table ne le pointe', () => {
    const duJournal = RELATIONS_PREVUES
      .filter((r) => r.enfant === TABLE || r.parent === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
      .sort()
    expect(duJournal).toEqual([
      'designations_des_pieces.dossier_id → dossiers (cascade)',
      'designations_des_pieces.facture_id → factures_emises (bloque)',
      'designations_des_pieces.piece_id → pieces (cascade)',
    ])
    // Sa garde lit la pièce et la facture à l'insertion : ce sont des clés, pas des liens tenus par une garde.
    expect(LIENS_GARDES.some((r) => r.enfant === TABLE || r.parent === TABLE)).toBe(false)
  })

  it('après les paramètres de facturation, à la fin de ce que la marque d’une pièce suppose — avant les devis et `exercices_valides`', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang(TABLE) - 1]).toBe('parametres_facturation')
    expect(ORDRE_RESTAURATION_PREVU[rang(TABLE) + 1]).toBe('devis_numerotation')
    for (const parent of ['dossiers', 'factures_emises', 'pieces']) expect(rang(TABLE), parent).toBeGreaterThan(rang(parent))
    expect(rang(TABLE)).toBeLessThan(rang('exercices_valides'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
  })

  it('un défaut planté se voit : le journal avant ses pièces', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
    plante.splice(plante.indexOf('pieces'), 0, TABLE)
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('designations_des_pieces → pieces')
  })
})

describe('le journal dans les deux états du drapeau : la réinsertion et les liens perdus', () => {
  afterEach(() => {
    vi.doUnmock('./exemplairesDesFactures')
    vi.resetModules()
  })

  // Le plan du jour est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./exemplairesDesFactures', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./exemplairesDesFactures')>()),
      JUMELLE_INVERSEE_EXPORTEE: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = (factureDuJournal: string, pieceDuJournal = 'p1') => ({
    dossiers: [{ id: 'd1' }],
    factures_emises: [{ id: 'f1', dossier_id: 'd1', facture_origine_id: null }],
    pieces: [{ id: 'p1', dossier_id: 'd1', categorie_id: null, sous_dossier_id: null, facture_id: null }],
    designations_des_pieces: [
      { id: 'j1', dossier_id: 'd1', piece_id: pieceDuJournal, geste: 'designation', facture_id: factureDuJournal,
        auteur_id: 'u1', fait_le: '2026-10-23T08:00:00Z' },
      { id: 'j2', dossier_id: 'd1', piece_id: pieceDuJournal, geste: 'retrait_designation', facture_id: factureDuJournal,
        auteur_id: 'u1', fait_le: '2026-10-23T08:05:00Z' },
      { id: 'j3', dossier_id: 'd1', piece_id: pieceDuJournal, geste: 'declaration', facture_id: null,
        auteur_id: 'u1', fait_le: '2026-10-23T08:05:00Z' },
    ],
  })

  it('levé : une étape, toutes les lignes, après les pièces ; une facture ou une pièce absente est un lien perdu, jamais effaçable', async () => {
    const s = await sauvegardeSous(true)
    const plan = s.planReinsertion(contenu('f1'))
    const tables = plan.etapes.map((e) => e.table)
    expect(plan.etapes.filter((e) => e.table === TABLE).map((e) => e.lignes.map((l) => l.id))).toEqual([['j1', 'j2', 'j3']])
    expect(tables.indexOf(TABLE)).toBeGreaterThan(tables.indexOf('pieces'))
    expect(s.liensPerdus(contenu('f1'))).toEqual([])
    expect(s.liensPerdus(contenu('f9'))).toEqual([
      { table: TABLE, colonne: 'facture_id', parent: 'factures_emises', valeur: 'f9', effacable: false },
      { table: TABLE, colonne: 'facture_id', parent: 'factures_emises', valeur: 'f9', effacable: false },
    ])
    expect(s.liensPerdus(contenu('f1', 'p9')).map((l) => `${l.colonne}:${l.valeur}:${String(l.effacable)}`))
      .toEqual(['piece_id:p9:false', 'piece_id:p9:false', 'piece_id:p9:false'])
  })

  it('baissé : rien n’en part, et rien ne s’en dit — l’export ne porte pas la table', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu('f1')).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.liensPerdus(contenu('f9'))).toEqual([])
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
  })

  it('le module chargé normalement dit ce que dit son drapeau', async () => {
    const s = await import('./sauvegarde')
    expect(s.ORDRE_RESTAURATION.includes(TABLE)).toBe(JUMELLE_INVERSEE_EXPORTEE)
  })
})
