import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXEMPLAIRES_DES_FACTURES_EXPORTES } from './exemplairesDesFactures'
import {
  auGrapheDesExemplaires,
  COLONNES_GENEREES,
  liensPerdus,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  RELATIONS,
  RELATIONS_DES_EXEMPLAIRES,
  RELATIONS_PREVUES,
  sansColonnesGenerees,
  violationsOrdre,
} from './sauvegarde'

// L'EXEMPLAIRE D'UNE FACTURE AU PLAN DE SAUVEGARDE (chantier EC-Q3, étape VF1a). La migration `exemplaires_des_factures`,
// appliquée le 18/10/2026 : ni table, ni rang, ni chemin nouveaux — une colonne de plus sur `pieces`, et sa clé vers
// `factures_emises`, sans action à la suppression. La relation est déclarée au graphe PRÉVU ; le graphe du jour ne la porte
// que le drapeau `EXEMPLAIRES_DES_FACTURES_EXPORTES` levé (sauvegardeRelations.test.ts juge le graphe du jour contre
// l'export, qui porte la clé depuis la bascule). Ici : la relation telle que la migration la pose, le
// filtre dans ses deux états, l'ordre de restauration qu'elle exige, et ce que `liensPerdus` en dit — le module rechargé
// sous chaque état du drapeau, le graphe étant calculé au chargement.

const DESIGNATION = (r: { enfant: string; colonne: string }) => r.enfant === 'pieces' && r.colonne === 'facture_id'
const cle = (r: { enfant: string; colonne: string; parent: string; aLaSuppression: string }) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

describe('la relation de la désignation, au graphe prévu', () => {
  it('telle que la migration la pose : la pièce vers sa facture émise, sans action à la suppression, une fois', () => {
    expect(RELATIONS_DES_EXEMPLAIRES).toEqual([{ enfant: 'pieces', colonne: 'facture_id' }])
    expect(RELATIONS_PREVUES.filter(DESIGNATION).map(cle)).toEqual(['pieces.facture_id → factures_emises (bloque)'])
    // Bloquée, jamais « effaçable » : une restauration qui la perdrait ne passerait pas en silence (`liensPerdus`).
    const migration = readFileSync(new URL('../../supabase/essais/exemplairesDesFactures.sql', import.meta.url), 'utf8')
    expect(migration).toContain("'pieces_facture_id_fkey FOREIGN KEY (facture_id) REFERENCES factures_emises(id) aa false'")
  })

  it('le filtre : la désignation seulement le drapeau levé ; toute autre relation, toujours', () => {
    for (const r of RELATIONS_PREVUES) {
      expect(auGrapheDesExemplaires(r, true), cle(r)).toBe(true)
      expect(auGrapheDesExemplaires(r, false), cle(r)).toBe(!DESIGNATION(r))
    }
    expect(RELATIONS_PREVUES.filter((r) => !auGrapheDesExemplaires(r, false))).toHaveLength(1)
  })

  it('le graphe du jour suit le drapeau', () => {
    expect(RELATIONS.some(DESIGNATION)).toBe(EXEMPLAIRES_DES_FACTURES_EXPORTES)
  })
})

describe('l’ordre de restauration : la facture avant la pièce qui la désigne', () => {
  it('dans le plan prévu comme dans celui du jour, sans rien reclasser', () => {
    for (const ordre of [ORDRE_RESTAURATION_PREVU, ORDRE_RESTAURATION]) {
      expect(ordre.indexOf('factures_emises')).toBeGreaterThanOrEqual(0)
      expect(ordre.indexOf('factures_emises')).toBeLessThan(ordre.indexOf('pieces'))
      expect(violationsOrdre(ordre, RELATIONS_PREVUES.filter(DESIGNATION))).toEqual([])
    }
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, RELATIONS_PREVUES)).toEqual([])
  })

  it('planté — la pièce avant la facture —, le contrôle de l’ordre le voit', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'pieces')
    plante.splice(plante.indexOf('factures_emises'), 0, 'pieces')
    expect(violationsOrdre(plante, RELATIONS_PREVUES.filter(DESIGNATION)))
      .toEqual([{ enfant: 'pieces', parent: 'factures_emises', motif: 'parent_apres_enfant' }])
  })

  it('la désignation se réinsère telle quelle : ce n’est pas une colonne générée', () => {
    expect(COLONNES_GENEREES.pieces ?? []).not.toContain('facture_id')
    expect(sansColonnesGenerees('pieces', [{ id: 'p1', facture_id: 'f1' }])).toEqual([{ id: 'p1', facture_id: 'f1' }])
  })
})

describe('ce que `liensPerdus` dit d’une pièce désignée dont la facture manque, dans les deux états du drapeau', () => {
  afterEach(() => {
    vi.doUnmock('./exemplairesDesFactures')
    vi.resetModules()
  })

  // Le graphe est calculé au chargement du module : on le recharge sous l'état voulu.
  async function sauvegardeSous(drapeau: boolean) {
    vi.resetModules()
    vi.doMock('./exemplairesDesFactures', async (importOriginal) => ({
      ...(await importOriginal<typeof import('./exemplairesDesFactures')>()),
      EXEMPLAIRES_DES_FACTURES_EXPORTES: drapeau,
    }))
    return import('./sauvegarde')
  }

  const contenu = (factureDesignee: string) => ({
    factures_emises: [{ id: 'f1', dossier_id: 'd1', facture_origine_id: null }],
    pieces: [
      { id: 'p1', dossier_id: 'd1', categorie_id: null, sous_dossier_id: null, facture_id: factureDesignee },
      { id: 'p2', dossier_id: 'd1', categorie_id: null, sous_dossier_id: null, facture_id: null },
    ],
  })

  it('levé : la facture absente de la sauvegarde est un lien perdu, et jamais un lien qu’on efface', async () => {
    const s = await sauvegardeSous(true)
    expect(s.RELATIONS.some(DESIGNATION)).toBe(true)
    expect(s.liensPerdus(contenu('f9'))).toEqual([
      { table: 'pieces', colonne: 'facture_id', parent: 'factures_emises', valeur: 'f9', effacable: false },
    ])
    expect(s.liensPerdus(contenu('f1'))).toEqual([])
  })

  it('baissé : la relation n’est pas au graphe — l’export ne la porte pas —, et rien ne s’en dit', async () => {
    const s = await sauvegardeSous(false)
    expect(s.RELATIONS.some(DESIGNATION)).toBe(false)
    expect(s.liensPerdus(contenu('f9'))).toEqual([])
  })

  it('le module chargé normalement dit ce que dit son drapeau', () => {
    expect(liensPerdus(contenu('f9')).length).toBe(EXEMPLAIRES_DES_FACTURES_EXPORTES ? 1 : 0)
  })
})

describe('restauration.sql : le contrôle de la désignation', () => {
  const essai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')

  it('suit le verdict, conditionné à la colonne, et exige au moins une pièce désignée', () => {
    const debut = essai.indexOf("if exists (select 1 from pg_attribute where attrelid = 'public.pieces'::regclass and attname = 'facture_id'")
    expect(debut).toBeGreaterThan(essai.indexOf('-- ══ 3. Le verdict'))
    expect(debut).toBeLessThan(essai.indexOf('select controle, attendu, observe, observe = attendu as ok'))
    const bloc = essai.slice(debut, essai.indexOf('end $$;', debut))
    expect(bloc).toContain("'pieces.facture_id : chaque pièce désignée restaurée désignée à sa facture, la clé recopiée'")
    expect(bloc).toContain("'aucune pièce désignée dans le dossier : rien n''est prouvé'")
    expect(bloc).toContain("c.confrelid = 'essai_restauration.factures_emises'::regclass")
  })
})
