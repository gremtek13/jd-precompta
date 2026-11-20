import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FACTURES_ASSURANCE_MALADIE_EN_BASE } from './importDuFactureAssuranceMaladie'
import {
  auPlanAujourdHui,
  auPlanDuFactureAssuranceMaladie,
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
  TABLES_DU_FACTURE_ASSURANCE_MALADIE,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LE FACTURÉ À L'ASSURANCE MALADIE AU PLAN DE SAUVEGARDE (conception 59, BOR3). Sa migration, `factures_assurance_maladie`,
// est en production depuis le 20/11/2026 (collée, 248 ; supabase/schema/20261120110200_factures_assurance_maladie.sql) et
// le drapeau de la BASE levé (`FACTURES_ASSURANCE_MALADIE_EN_BASE` ; celui de l'écran, BOR4, reste baissé) : le plan
// effectif porte les quatre tables. Son état d'avant — baissé, le plan ne disait RIEN d'elles, une sauvegarde aurait lu des
// tables absentes et échoué — se joue encore, avec l'autre (`vi.doMock`, plus bas). La clé et le registre n'ont aucune policy : leur lecture rend zéro
// ligne, et ni la sauvegarde ni la restauration n'en portent jamais rien.

const TABLES = ['cles_des_lots_teletransmission', 'imports_factures_assurance_maladie', 'factures_assurance_maladie',
  'lots_teletransmission_importes'] as const
const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/schema/20261120110200_factures_assurance_maladie.sql'), 'utf8')

describe('le filtre du plan, côté facturé à l’assurance maladie', () => {
  it('les tables ne sont au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DU_FACTURE_ASSURANCE_MALADIE).toEqual([...TABLES])
    for (const t of TABLES) {
      expect(auPlanDuFactureAssuranceMaladie(t, false)).toBe(false)
      expect(auPlanDuFactureAssuranceMaladie(t, true)).toBe(true)
      expect(auPlanAujourdHui(t)).toBe(FACTURES_ASSURANCE_MALADIE_EN_BASE)
    }
    expect(auPlanDuFactureAssuranceMaladie('memberships', false)).toBe(true)
  })

  it('le plan effectif nomme les tables selon le drapeau de la base (levé : la migration est en base) ; leur clé est la commune', () => {
    expect(FACTURES_ASSURANCE_MALADIE_EN_BASE).toBe(true)
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    for (const t of TABLES) {
      expect(nommees.has(t)).toBe(FACTURES_ASSURANCE_MALADIE_EN_BASE)
      expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(t)
      expect(clePrimaire(t)).toEqual(['id'])
    }
  })
})

describe('le plan prévu, facturé compris', () => {
  it('l’ordre (après les cotisations déclarées : la clé, l’import, ses totaux, ses empreintes), les chemins, aucune vague, et les six relations de la migration', () => {
    for (const t of TABLES) {
      expect(ORDRE_RESTAURATION_PREVU.filter((x) => x === t)).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[t]).toEqual({ acces: 'direct' })
      expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === t)).toBe(false)
    }
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('cotisations_declarees')
    expect(ORDRE_RESTAURATION_PREVU.slice(rang + 1, rang + 5)).toEqual([...TABLES])
    const declarees = RELATIONS_PREVUES.filter((r) => (TABLES as readonly string[]).includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(declarees).toEqual([
      'cles_des_lots_teletransmission.dossier_id → dossiers (cascade)',
      'imports_factures_assurance_maladie.dossier_id → dossiers (cascade)',
      'factures_assurance_maladie.dossier_id → dossiers (cascade)',
      'factures_assurance_maladie.import_id → imports_factures_assurance_maladie (cascade)',
      'lots_teletransmission_importes.dossier_id → dossiers (cascade)',
      'lots_teletransmission_importes.import_id → imports_factures_assurance_maladie (cascade)',
    ])
    // Les mêmes que les clés étrangères de la migration, lues dans son texte, dans les deux sens.
    const duTexte = [...MIGRATION.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/gi)].flatMap(([, enfant, corps]) =>
      [...corps.matchAll(/^\s+(\w+) uuid[^,\n]* references public\.(\w+) \(id\)( on delete cascade)?/gmi)]
        .map(([, colonne, parent, cascade]) => `${enfant}.${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`))
    expect([...duTexte].sort()).toEqual([...declarees].sort())
  })

  it('l’ordre prévu respecte toutes les dépendances, les chemins se suivent ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const exportees = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const t of TABLES) expect(exportees).toContain(t)
    // Les empreintes avant leur import : la relation de leur clé étrangère se voit.
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'lots_teletransmission_importes')
    plante.splice(plante.indexOf('imports_factures_assurance_maladie'), 0, 'lots_teletransmission_importes')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('lots_teletransmission_importes → imports_factures_assurance_maladie')
  })
})

describe('le facturé dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./importDuFactureAssuranceMaladie')
    vi.resetModules()
  })

  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./importDuFactureAssuranceMaladie', async (original) => ({
      ...(await original<typeof import('./importDuFactureAssuranceMaladie')>()), FACTURES_ASSURANCE_MALADIE_EN_BASE: drapeau,
    }))
    return import('./sauvegarde')
  }

  // Ce qu'une sauvegarde porte : l'import et ses totaux — jamais la clé ni une empreinte, que sa lecture rend vides.
  const contenu = {
    dossiers: [{ id: 'd1' }],
    imports_factures_assurance_maladie: [
      { id: 'i1', dossier_id: 'd1', premier_lot_le: '2026-11-02', dernier_lot_le: '2026-11-03', nombre_de_lots: 2,
        nombre_de_factures: 5, importe_par: 'u1', importe_le: '2026-11-19T08:00:00Z' },
    ],
    factures_assurance_maladie: [
      { id: 'f1', dossier_id: 'd1', import_id: 'i1', date_creation_lot: '2026-11-02', part: 'obligatoire', regime: 1, caisse: 691,
        organisme_complementaire: null, montant_centimes: 4550, nombre_de_lots: 1, nombre_de_factures: 2 },
    ],
    lots_teletransmission_importes: [],
    cles_des_lots_teletransmission: [],
  }

  it('levé : l’import puis ses totaux se réinsèrent après leur dossier, sans lien perdu ; ni clé ni empreinte', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    const rang = (t: string) => etapes.findIndex((e) => e.table === t)
    expect(rang('imports_factures_assurance_maladie')).toBeGreaterThan(rang('dossiers'))
    expect(rang('factures_assurance_maladie')).toBeGreaterThan(rang('imports_factures_assurance_maladie'))
    expect(etapes.find((e) => e.table === 'factures_assurance_maladie')?.lignes)
      .toEqual([expect.objectContaining({ import_id: 'i1', montant_centimes: 4550, nombre_de_lots: 1 })])
    for (const t of ['lots_teletransmission_importes', 'cles_des_lots_teletransmission']) {
      expect(etapes.filter((e) => e.table === t).flatMap((e) => e.lignes)).toEqual([])
    }
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
