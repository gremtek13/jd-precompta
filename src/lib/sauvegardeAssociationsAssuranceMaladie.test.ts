import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES } from './rapprochementAssuranceMaladie'
import {
  auPlanAujourdHui,
  auPlanDeLAssociationAssuranceMaladie,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DE_L_ASSOCIATION_ASSURANCE_MALADIE,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE AU PLAN DE SAUVEGARDE (conception 53, NOE5 ; au plan par NOE8). Sa
// migration, `association_paiements_assurance_maladie`, est préparée
// (supabase/preparees/20261117160000_association_paiements_assurance_maladie.sql) et le drapeau baissé : le plan effectif ne
// dit RIEN de la table — une sauvegarde lirait une table absente et échouerait ; le plan PRÉVU la porte, et les deux états du
// drapeau se jouent (`vi.doMock`, plus bas). Les relations ne se filtrent pas (RELATIONS = RELATIONS_PREVUES, comme pour les
// tables de NOE3 et de BOR3) : seuls l'ordre, les chemins et les clés suivent le drapeau.

const TABLE = 'paiements_assurance_maladie_mouvements'
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/preparees/20261117160000_association_paiements_assurance_maladie.sql'), 'utf8')

describe('le filtre du plan, côté association des paiements de l’assurance maladie', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours ; le filtre du jour suit le drapeau', () => {
    expect(TABLES_DE_L_ASSOCIATION_ASSURANCE_MALADIE).toEqual([TABLE])
    expect(auPlanDeLAssociationAssuranceMaladie(TABLE, false)).toBe(false)
    expect(auPlanDeLAssociationAssuranceMaladie(TABLE, true)).toBe(true)
    expect(auPlanAujourdHui(TABLE)).toBe(ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES)
    expect(auPlanDeLAssociationAssuranceMaladie('paiements_assurance_maladie', false)).toBe(true)
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table ; sa clé est la commune', () => {
    const nommees = new Set([
      ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table), ...Object.keys(CLES_PRIMAIRES),
    ])
    expect(nommees.has(TABLE)).toBe(ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES)
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain(TABLE)
    expect(clePrimaire(TABLE)).toEqual(['id'])
  })
})

describe('le plan prévu, association comprise', () => {
  it('l’ordre (juste après le mouvement, après le paiement), le chemin, aucune vague, et les trois relations de la migration', () => {
    expect(ORDRE_RESTAURATION_PREVU.filter((x) => x === TABLE)).toHaveLength(1)
    expect(CHEMINS_DOSSIER_PREVUS[TABLE]).toEqual({ acces: 'direct' })
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === TABLE)).toBe(false)
    const rang = ORDRE_RESTAURATION_PREVU.indexOf('lignes_bancaires')
    expect(ORDRE_RESTAURATION_PREVU[rang + 1]).toBe(TABLE)
    expect(ORDRE_RESTAURATION_PREVU.indexOf('paiements_assurance_maladie')).toBeLessThan(rang)
    const declarees = RELATIONS_PREVUES.filter((r) => r.enfant === TABLE)
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(declarees).toEqual([
      `${TABLE}.dossier_id → dossiers (cascade)`,
      `${TABLE}.paiement_id → paiements_assurance_maladie (bloque)`,
      `${TABLE}.ligne_bancaire_id → lignes_bancaires (cascade)`,
    ])
    // Les mêmes que les clés étrangères de la migration, lues dans son texte, dans les deux sens.
    const duTexte = [...MIGRATION.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/gi)].flatMap(([, enfant, corps]) =>
      [...corps.matchAll(/^\s+(\w+) uuid[^,\n]* references public\.(\w+) \(id\)( on delete cascade)?/gmi)]
        .map(([, colonne, parent, cascade]) => `${enfant}.${colonne} → ${parent} (${cascade ? 'cascade' : 'bloque'})`))
    expect([...duTexte].sort()).toEqual([...declarees].sort())
  })

  it('l’ordre prévu respecte toutes les dépendances, le chemin se suit ; un défaut planté se voit', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    expect(planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)).toContain(TABLE)
    // L'association avant son mouvement, puis avant son paiement : chaque relation se voit.
    for (const parent of ['lignes_bancaires', 'paiements_assurance_maladie']) {
      const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== TABLE)
      plante.splice(plante.indexOf(parent), 0, TABLE)
      expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
        .toContain(`${TABLE} → ${parent}`)
    }
  })
})

describe('l’association dans les deux états du drapeau : la réinsertion', () => {
  afterEach(() => {
    vi.doUnmock('./rapprochementAssuranceMaladie')
    vi.doUnmock('./paiementsAssuranceMaladie')
    vi.resetModules()
  })

  // Les paiements de NOE3 levés dans les deux cas : la migration de l'association ne s'applique qu'après la leur.
  async function sauvegardeSous(associations: boolean) {
    vi.resetModules()
    vi.doMock('./rapprochementAssuranceMaladie', async (original) => ({
      ...(await original<typeof import('./rapprochementAssuranceMaladie')>()), ASSOCIATIONS_ASSURANCE_MALADIE_PREVUES: associations,
    }))
    vi.doMock('./paiementsAssuranceMaladie', async (original) => ({
      ...(await original<typeof import('./paiementsAssuranceMaladie')>()), PAIEMENTS_ASSURANCE_MALADIE_PREVUS: true,
    }))
    return import('./sauvegarde')
  }

  // Un crédit de 45,50 € porté par les deux parts d'une journée.
  const contenu = {
    dossiers: [{ id: 'd1' }],
    lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', date: '2026-11-04', montant: 45.5 }],
    imports_assurance_maladie: [{ id: 'i1', dossier_id: 'd1' }],
    paiements_assurance_maladie: [
      { id: 'p1', dossier_id: 'd1', import_id: 'i1', montant_centimes: 3000 },
      { id: 'p2', dossier_id: 'd1', import_id: 'i1', montant_centimes: 1550 },
    ],
    paiements_assurance_maladie_mouvements: [
      { id: 'a1', dossier_id: 'd1', paiement_id: 'p1', ligne_bancaire_id: 'l1', associe_par: 'u1', associe_le: '2026-11-19T08:00:00Z' },
      { id: 'a2', dossier_id: 'd1', paiement_id: 'p2', ligne_bancaire_id: 'l1', associe_par: 'u1', associe_le: '2026-11-19T08:00:00Z' },
    ],
  }

  it('levé : l’association se réinsère après son mouvement et ses paiements, telle quelle, sans lien perdu', async () => {
    const s = await sauvegardeSous(true)
    const etapes = s.planReinsertion(contenu).etapes
    const rang = (t: string) => etapes.findIndex((e) => e.table === t)
    expect(rang(TABLE)).toBeGreaterThan(rang('lignes_bancaires'))
    expect(rang(TABLE)).toBeGreaterThan(rang('paiements_assurance_maladie'))
    expect(etapes.filter((e) => e.table === TABLE).flatMap((e) => e.lignes)).toEqual(contenu.paiements_assurance_maladie_mouvements)
    expect(s.liensPerdus(contenu)).toEqual([])
  })

  it('baissé : rien n’en part, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.planReinsertion(contenu).etapes.some((e) => e.table === TABLE)).toBe(false)
    expect(s.ORDRE_RESTAURATION).not.toContain(TABLE)
    expect(Object.keys(s.CHEMINS_DOSSIER)).not.toContain(TABLE)
  })
})
