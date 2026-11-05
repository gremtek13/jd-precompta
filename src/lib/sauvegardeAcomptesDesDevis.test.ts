import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACOMPTES_PREVUS, ENVOI_DES_DEVIS_PREVU } from './devis'
import {
  auGrapheDesAcomptes,
  COLONNES_GENEREES,
  LIENS_GARDES,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_DES_ACOMPTES,
  RELATIONS_PREVUES,
  sansColonnesGenerees,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  violationsOrdre,
} from './sauvegarde'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// L'ACOMPTE D'UN DEVIS AU PLAN DE SAUVEGARDE (étape P5b2 ; migration `acomptes_des_devis`, préparée, PAS APPLIQUÉE). Ni
// table, ni chemin nouveaux : trois colonnes sans relation, recopiées avec leurs lignes, et la reprise d'une ligne de la
// facture finale, `facture_lignes.reprise_facture_id`, vers la facture d'acompte validée, SANS ACTION à la suppression. La
// relation est déclarée au graphe PRÉVU ; le graphe du jour ne la porte que le drapeau `ACOMPTES_PREVUS` levé. Ici : la
// relation telle que la migration la pose, le filtre dans ses deux états, ce que porte l'export, l'ordre de restauration
// (les factures avant leurs lignes, sans seconde passe), et le plan rechargé sous chaque état du drapeau.

const MIGRATION = [...fichiersDuSchema(), ...fichiersPrepares()].find((f) => /\d{14}_acomptes_des_devis\.sql$/.test(f.chemin))?.texte ?? ''
const REPRISE = (r: { enfant: string; colonne: string }) => r.enfant === 'facture_lignes' && r.colonne === 'reprise_facture_id'
const cle = (r: { enfant: string; colonne: string; parent: string; aLaSuppression: string }) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

describe('la reprise d’un acompte, au graphe prévu', () => {
  it('telle que la migration la pose : la ligne vers la facture d’acompte, sans action à la suppression, une fois', () => {
    expect(RELATIONS_DES_ACOMPTES).toEqual([{ enfant: 'facture_lignes', colonne: 'reprise_facture_id' }])
    const action = (texte: string) => /on delete cascade/.test(texte) ? 'cascade' : /on delete set null/.test(texte) ? 'met_a_null' : 'bloque'
    const deLaMigration = [...MIGRATION.matchAll(/alter table public\.(\w+)\s+add column (\w+) uuid references public\.(\w+) \(id\)([^;]*);/g)]
      .map((m) => `${m[1]}.${m[2]} → ${m[3]} (${action(m[4])})`)
    expect(deLaMigration).toEqual(['facture_lignes.reprise_facture_id → factures_emises (bloque)'])
    expect(RELATIONS_PREVUES.filter(REPRISE).map(cle)).toEqual(deLaMigration)
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === 'facture_lignes').map(cle).sort()).toEqual([
      'facture_lignes.article_id → articles (met_a_null)',
      'facture_lignes.facture_id → factures_emises (cascade)',
      'facture_lignes.reprise_facture_id → factures_emises (bloque)',
    ].filter((c) => RELATIONS_PREVUES.some((r) => cle(r) === c)))
    expect(LIENS_GARDES.some((r) => REPRISE(r))).toBe(false)
  })

  it('le filtre : la reprise seulement le drapeau levé ; toute autre relation, toujours', () => {
    for (const r of RELATIONS_PREVUES) {
      expect(auGrapheDesAcomptes(r, true), cle(r)).toBe(true)
      expect(auGrapheDesAcomptes(r, false), cle(r)).toBe(!REPRISE(r))
    }
    expect(RELATIONS_PREVUES.filter((r) => !auGrapheDesAcomptes(r, false))).toHaveLength(1)
  })

  it('le graphe du jour suit le drapeau', () => {
    expect(RELATIONS.some(REPRISE)).toBe(ACOMPTES_PREVUS)
  })

  it('le drapeau dit ce que porte l’export, et ne se lève qu’avec celui de l’envoi des devis', () => {
    expect(MIGRATION, 'la migration acomptes_des_devis, préparée ou dans l’export')
      .toContain('add column reprise_facture_id uuid references public.factures_emises (id);')
    const exportee = fichiersDuSchema().some((f) => /\d{14}_acomptes_des_devis\.sql$/.test(f.chemin))
    expect(ACOMPTES_PREVUS, 'ACOMPTES_PREVUS ne dit plus ce que porte l’export').toBe(exportee)
    expect(!ACOMPTES_PREVUS || ENVOI_DES_DEVIS_PREVU, 'la migration des acomptes suppose celle de l’envoi').toBe(true)
  })

  it('les colonnes neuves se réinsèrent telles quelles : aucune n’est générée', () => {
    expect(COLONNES_GENEREES.factures_emises ?? []).not.toContain('acompte')
    expect(COLONNES_GENEREES.facture_lignes ?? []).not.toContain('reprise_facture_id')
    expect(sansColonnesGenerees('facture_lignes', [{ id: 'l1', facture_id: 'f2', reprise_facture_id: 'f1' }]))
      .toEqual([{ id: 'l1', facture_id: 'f2', reprise_facture_id: 'f1' }])
  })

  it('les factures se restaurent avant leurs lignes : la reprise n’appelle aucune seconde passe', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang('factures_emises')).toBeLessThan(rang('facture_lignes'))
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === 'facture_lignes')).toBe(false)
  })

  it('planté — les lignes avant les factures —, le contrôle de l’ordre voit la reprise', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'facture_lignes')
    plante.splice(plante.indexOf('factures_emises'), 0, 'facture_lignes')
    expect(violationsOrdre(plante, RELATIONS_PREVUES.filter(REPRISE)))
      .toEqual([{ enfant: 'facture_lignes', parent: 'factures_emises', motif: 'parent_apres_enfant' }])
  })
})

describe('le plan rechargé sous chaque état du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./devis')
    vi.resetModules()
  })

  async function sauvegardeSous(acomptes: boolean) {
    vi.resetModules()
    vi.doMock('./devis', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./devis')>()),
      ACOMPTES_PREVUS: acomptes,
    }))
    return import('./sauvegarde')
  }

  // Une facture d'acompte validée, et la facture finale qui la reprend.
  const contenu = () => ({
    dossiers: [{ id: 'd' }],
    factures_emises: [
      { id: 'f1', dossier_id: 'd', type: 'facture', acompte: true, facture_origine_id: null },
      { id: 'f2', dossier_id: 'd', type: 'facture', acompte: false, facture_origine_id: null },
    ],
    facture_lignes: [
      { id: 'l1', facture_id: 'f1', reprise_facture_id: null },
      { id: 'l2', facture_id: 'f2', reprise_facture_id: 'f1' },
    ],
  })

  it('levé : la relation au graphe, et un acompte absent de la sauvegarde laisse un lien qui ne s’efface pas', async () => {
    const s = await sauvegardeSous(true)
    expect(s.RELATIONS.some(REPRISE)).toBe(true)
    expect(s.violationsOrdre(s.ORDRE_RESTAURATION, s.RELATIONS)).toEqual([])
    expect(s.liensPerdus(contenu())).toEqual([])
    expect(s.liensPerdus({ ...contenu(), factures_emises: [contenu().factures_emises[1]] })).toContainEqual(
      { table: 'facture_lignes', colonne: 'reprise_facture_id', parent: 'factures_emises', valeur: 'f1', effacable: false },
    )
  })

  it('baissé — l’état du jour — : la colonne n’est pas au graphe, un acompte absent ne dit rien d’elle', async () => {
    const s = await sauvegardeSous(false)
    expect(s.RELATIONS.some(REPRISE)).toBe(false)
    expect(s.liensPerdus({ ...contenu(), factures_emises: [contenu().factures_emises[1]] })
      .some((l) => l.colonne === 'reprise_facture_id')).toBe(false)
  })

  it('le module chargé normalement dit ce que dit son drapeau', () => {
    expect(RELATIONS.some(REPRISE)).toBe(ACOMPTES_PREVUS)
  })
})
