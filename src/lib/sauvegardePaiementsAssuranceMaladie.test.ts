import { afterEach, describe, expect, it, vi } from 'vitest'
import { PAIEMENTS_ASSURANCE_MALADIE_PREVUS } from './paiementsAssuranceMaladie'
import {
  auPlanAujourdHui,
  auPlanDesPaiementsAssuranceMaladie,
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
  TABLES_DES_PAIEMENTS_ASSURANCE_MALADIE,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES PAIEMENTS DE L'ASSURANCE MALADIE AU PLAN DE SAUVEGARDE (conception 53, NOE3). Leur migration,
// `paiements_assurance_maladie`, est préparée (supabase/preparees/20261116191000_paiements_assurance_maladie.sql) et le
// drapeau baissé : le plan effectif ne dit RIEN des deux tables — une sauvegarde lirait des tables absentes et échouerait ; le
// plan PRÉVU les porte, et les deux états du drapeau se jouent (`vi.doMock`, plus bas).

const TABLES = ['imports_assurance_maladie', 'paiements_assurance_maladie'] as const

describe('le filtre du plan, côté paiements de l’assurance maladie', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DES_PAIEMENTS_ASSURANCE_MALADIE).toEqual([...TABLES])
    for (const t of TABLES) {
      expect(auPlanDesPaiementsAssuranceMaladie(t, false)).toBe(false)
      expect(auPlanDesPaiementsAssuranceMaladie(t, true)).toBe(true)
      expect(auPlanAujourdHui(t)).toBe(PAIEMENTS_ASSURANCE_MALADIE_PREVUS)
    }
    expect(auPlanDesPaiementsAssuranceMaladie('memberships', false)).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme pas les tables ; leur clé est la commune', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const t of TABLES) {
      expect(nommees.has(t)).toBe(PAIEMENTS_ASSURANCE_MALADIE_PREVUS)
      expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(t)
      expect(clePrimaire(t)).toEqual(['id'])
    }
  })
})

describe('le plan prévu, paiements compris', () => {
  it('l’ordre (après les contrôles du relevé, l’import avant ses paiements), les chemins, aucune vague, et les trois relations de la migration', () => {
    for (const t of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((x) => x === t)).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[t]).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === t)).toBe(false)
    }
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('controles_releves_bancaires')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 3)).toEqual([...TABLES])
    expect(RELATIONS_PREVUES.filter((r) => (TABLES as readonly string[]).includes(r.enfant) || (TABLES as readonly string[]).includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)).toEqual([
      'imports_assurance_maladie.dossier_id → dossiers (cascade)',
      'paiements_assurance_maladie.dossier_id → dossiers (cascade)',
      'paiements_assurance_maladie.import_id → imports_assurance_maladie (cascade)',
      // La clé entrante de l'association (NOE5, au plan par NOE8) : sans action, elle retient le retrait d'un import associé.
      'paiements_assurance_maladie_mouvements.paiement_id → paiements_assurance_maladie (bloque)',
    ])
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const exportees = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const t of TABLES) expect(exportees).toContain(t)
    // Les paiements avant leur import : la relation de leur clé étrangère se voit.
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'paiements_assurance_maladie')
    plante.splice(plante.indexOf('imports_assurance_maladie'), 0, 'paiements_assurance_maladie')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('paiements_assurance_maladie → imports_assurance_maladie')
  })
})

describe('les paiements dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./paiementsAssuranceMaladie')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./paiementsAssuranceMaladie', async (original) => ({
      ...(await original<typeof import('./paiementsAssuranceMaladie')>()), PAIEMENTS_ASSURANCE_MALADIE_PREVUS: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = {
    dossiers: [{ id: 'd1' }],
    imports_assurance_maladie: [
      { id: 'i1', dossier_id: 'd1', periode_du: '2026-11-02', periode_au: '2026-11-03', nombre_de_rejets: 2,
        montant_rejete_centimes: 1500, importe_par: 'u1', importe_le: '2026-11-16T08:00:00Z' },
    ],
    paiements_assurance_maladie: [
      { id: 'p1', dossier_id: 'd1', import_id: 'i1', date_journee_comptable: '2026-11-02', regime: 1, caisse: 691,
        organisme_complementaire: null, part: 'obligatoire', montant_centimes: 4550, regularisations_centimes: 0, nombre_de_factures: 2 },
    ],
  }

  it('levé : l’import puis ses paiements se réinsèrent après leur dossier, sans lien perdu', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    const rang = (t: string) => etapes.findIndex((e) => e.table === t)
    expect(rang('imports_assurance_maladie')).toBeGreaterThan(rang('dossiers'))
    expect(rang('paiements_assurance_maladie')).toBeGreaterThan(rang('imports_assurance_maladie'))
    expect(etapes.find((e) => e.table === 'paiements_assurance_maladie')?.lignes)
      .toEqual([expect.objectContaining({ import_id: 'i1', montant_centimes: 4550, nombre_de_factures: 2 })])
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    for (const t of TABLES) {
      expect(s.planReinsertion(contenu).etapes.some((e) => e.table === t)).toBe(false)
      expect(s.ORDRE_RESTAURATION).not.toContain(t)
    }
  })
})
