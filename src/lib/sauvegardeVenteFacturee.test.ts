import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema, relationsDuSchema } from '../test/schema'
import {
  COLONNES_GENEREES,
  liensPerdus,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  parentsHorsPlan,
  RELATIONS,
  RELATIONS_PREVUES,
  sansColonnesGenerees,
  violationsOrdre,
} from './sauvegarde'

// LA VENTE FACTURÉE AU PLAN DE SAUVEGARDE (chantier EC-Q3, étape VF2 ; migrations `source_de_la_vente` et
// `encaissements_de_la_vente_facturee`, en base et dans l'export). Ni table, ni rang, ni chemin nouveaux : des colonnes sur
// des tables au plan — le réglage du dossier, la source d'une facture, le mouvement classé par ses encaissements —, que la
// sauvegarde recopie avec leurs lignes entières (`select('*')`), et DEUX CLÉS des écritures, `encaissement_id` vers
// `encaissements_factures` et `facture_id` vers `factures_emises`, sans action à la suppression : un encaissement, une
// facture validée ne disparaissent qu'avec leur dossier. Ici : les deux relations telles que l'export les pose, au graphe du
// jour ; l'ordre de restauration qu'elles exigent ; ce que `liensPerdus` dit d'une écriture dont l'encaissement ou la
// facture manque.

const VENTE_FACTUREE = (r: { enfant: string; colonne: string }) =>
  r.enfant === 'ecritures_brouillon' && (r.colonne === 'encaissement_id' || r.colonne === 'facture_id')
const cle = (r: { enfant: string; colonne: string; parent: string; aLaSuppression: string }) =>
  `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`

describe('les deux clés des écritures d’une vente facturée, au graphe', () => {
  it('telles que l’export les pose : vers l’encaissement et vers la facture, sans action à la suppression', () => {
    const duSchema = relationsDuSchema(fichiersDuSchema()).filter(VENTE_FACTUREE)
    expect(duSchema.map((r) => `${r.nom} : ${cle(r)}`).sort()).toEqual([
      'ecritures_brouillon_encaissement_id_fkey : ecritures_brouillon.encaissement_id → encaissements_factures (bloque)',
      'ecritures_brouillon_facture_id_fkey : ecritures_brouillon.facture_id → factures_emises (bloque)',
    ])
    expect(RELATIONS_PREVUES.filter(VENTE_FACTUREE).map(cle).sort()).toEqual(duSchema.map(cle).sort())
  })

  it('au graphe du jour, sans condition : la migration est en base', () => {
    expect(RELATIONS.filter(VENTE_FACTUREE).map(cle).sort()).toEqual([
      'ecritures_brouillon.encaissement_id → encaissements_factures (bloque)',
      'ecritures_brouillon.facture_id → factures_emises (bloque)',
    ])
  })

  it('leurs parents sont au plan d’export d’un dossier : aucun parent hors du plan', () => {
    const horsPlan = parentsHorsPlan().map((p) => p.parent)
    expect(horsPlan).not.toContain('encaissements_factures')
    expect(horsPlan).not.toContain('factures_emises')
  })
})

describe('l’ordre de restauration : l’encaissement et la facture avant l’écriture qui les porte', () => {
  it('dans le plan prévu comme dans celui du jour, sans rien reclasser', () => {
    for (const ordre of [ORDRE_RESTAURATION_PREVU, ORDRE_RESTAURATION]) {
      expect(ordre.indexOf('encaissements_factures')).toBeGreaterThanOrEqual(0)
      expect(ordre.indexOf('factures_emises')).toBeGreaterThanOrEqual(0)
      expect(ordre.indexOf('encaissements_factures')).toBeLessThan(ordre.indexOf('ecritures_brouillon'))
      expect(ordre.indexOf('factures_emises')).toBeLessThan(ordre.indexOf('ecritures_brouillon'))
      expect(violationsOrdre(ordre, RELATIONS.filter(VENTE_FACTUREE))).toEqual([])
    }
    expect(violationsOrdre(ORDRE_RESTAURATION, RELATIONS)).toEqual([])
  })

  it('planté — l’écriture avant l’encaissement —, le contrôle de l’ordre le voit', () => {
    const plante = ORDRE_RESTAURATION.filter((t) => t !== 'ecritures_brouillon')
    plante.splice(plante.indexOf('encaissements_factures'), 0, 'ecritures_brouillon')
    expect(violationsOrdre(plante, RELATIONS.filter(VENTE_FACTUREE)))
      .toEqual([{ enfant: 'ecritures_brouillon', parent: 'encaissements_factures', motif: 'parent_apres_enfant' }])
  })

  it('les colonnes de VF2 se réinsèrent telles quelles : aucune n’est générée', () => {
    for (const [table, colonnes] of [
      ['ecritures_brouillon', ['encaissement_id', 'facture_id']], ['dossiers', ['ventes_par_les_factures']],
      ['factures_emises', ['source_de_la_vente']], ['lignes_bancaires', ['encaissements_de_factures']],
    ] as const) {
      for (const colonne of colonnes) expect(COLONNES_GENEREES[table] ?? [], `${table}.${colonne}`).not.toContain(colonne)
    }
    expect(sansColonnesGenerees('ecritures_brouillon', [{ id: 'e1', encaissement_id: 'enc1', facture_id: 'f1' }]))
      .toEqual([{ id: 'e1', encaissement_id: 'enc1', facture_id: 'f1' }])
  })
})

describe('ce que `liensPerdus` dit d’une écriture dont l’encaissement ou la facture manque', () => {
  const contenu = (encaissement: string | null, facture: string | null) => ({
    factures_emises: [{ id: 'f1', dossier_id: 'd1', facture_origine_id: null }],
    encaissements_factures: [{ id: 'enc1', dossier_id: 'd1', facture_id: 'f1', annule_id: null, ligne_bancaire_id: null }],
    ecritures_brouillon: [
      {
        id: 'e1', dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
        declaration_tva_id: null, cotisation_id: null, encaissement_id: encaissement, facture_id: facture,
      },
    ],
  })

  it('présents dans la sauvegarde, ou nuls : rien n’est perdu', () => {
    expect(liensPerdus(contenu('enc1', 'f1'))).toEqual([])
    expect(liensPerdus(contenu(null, null))).toEqual([])
  })

  it('absents : un lien perdu chacun, jamais un lien qu’on efface', () => {
    expect(liensPerdus(contenu('enc9', null))).toEqual([
      { table: 'ecritures_brouillon', colonne: 'encaissement_id', parent: 'encaissements_factures', valeur: 'enc9', effacable: false },
    ])
    expect(liensPerdus(contenu(null, 'f9'))).toEqual([
      { table: 'ecritures_brouillon', colonne: 'facture_id', parent: 'factures_emises', valeur: 'f9', effacable: false },
    ])
    expect(liensPerdus(contenu('enc9', 'f9')).map((l) => l.colonne).sort()).toEqual(['encaissement_id', 'facture_id'])
  })
})

// LE RÉGLAGE GARDÉ (étape VF8a ; migration `reglage_des_ventes`, appliquée) : la date de la bascule, une colonne de
// `dossiers`, que la sauvegarde recopie avec la ligne et que la restauration envoie telle ; la garde du réglage la laisse au
// super-administrateur qui restaure, et la pose à toute autre insertion.
describe('la date de la bascule (étape VF8a), réinsérée telle', () => {
  const migration = fichiersDuSchema().filter((f) => /\/\d{14}_reglage_des_ventes\.sql$/.test(f.chemin))

  it('une colonne ordinaire de `dossiers` dans l’export : ni générée, ni retirée de la ligne envoyée', () => {
    expect(migration).toHaveLength(1)
    expect(migration[0].texte).toContain('alter table public.dossiers add column ventes_par_les_factures_depuis timestamptz;')
    expect(COLONNES_GENEREES.dossiers ?? []).not.toContain('ventes_par_les_factures_depuis')
    const ligne = { id: 'd1', ventes_par_les_factures: true, ventes_par_les_factures_depuis: '2026-01-02T03:04:05+00:00' }
    expect(sansColonnesGenerees('dossiers', [ligne])).toEqual([ligne])
  })

  it('la garde laisse l’insertion du super-administrateur telle, et pose la date de toute autre insertion', () => {
    const garde = derniereDefinitionSql('garder_ventes_par_les_factures')
    expect(garde).toMatch(new RegExp(
      "if tg_op = 'INSERT' then\\n(\\s*--[^\\n]*\\n)*\\s*if not public\\.is_super_admin\\(\\) then\\n"
      + '\\s*new\\.ventes_par_les_factures_depuis := case when new\\.ventes_par_les_factures then now\\(\\) end;\\n'
      + '\\s*end if;\\n\\s*return new;\\n'))
  })

  it('le dossier précède ses accès, dans le plan prévu comme dans celui du jour', () => {
    for (const ordre of [ORDRE_RESTAURATION_PREVU, ORDRE_RESTAURATION]) {
      expect(ordre.indexOf('dossiers')).toBeGreaterThanOrEqual(0)
      expect(ordre.indexOf('dossiers')).toBeLessThan(ordre.indexOf('memberships'))
    }
  })

  it('l’essai de restauration contrôle la date du dossier restauré, et attend la migration sans elle', () => {
    const essai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')
    const bloc = essai.slice(essai.indexOf('-- LA DATE DE LA BASCULE (chantier EC-Q3, étape VF8a'), essai.indexOf('select controle, attendu, observe'))
    expect(bloc.length).toBeGreaterThan(0)
    expect(bloc).toContain("attname = 'ventes_par_les_factures_depuis'")
    expect(bloc).toContain('EN ATTENTE de la migration reglage_des_ventes')
    expect(bloc).toContain('e.ventes_par_les_factures_depuis = s.ventes_par_les_factures_depuis')
  })
})

// L'essai de restauration (supabase/essais/restauration.sql), qui rejoue l'ordre et les clés dans Postgres, porte un
// contrôle par valeur de la vente facturée : chaque clé du plan y est nommée avec son parent, et chaque colonne qui la
// marque, pour qu'une écriture restaurée sans son encaissement ou sa facture, ou une facture qui perdrait sa source, s'y
// voie.
describe('l’essai de restauration contrôle la vente facturée', () => {
  const essai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')
  const bloc = essai.slice(essai.indexOf('-- LA VENTE FACTURÉE (chantier EC-Q3, étape VF2)'), essai.indexOf('select controle, attendu, observe'))

  it('chaque clé des écritures, avec son parent, et les trois colonnes qui marquent la vente facturée', () => {
    expect(bloc.length).toBeGreaterThan(0)
    for (const r of RELATIONS.filter(VENTE_FACTUREE)) expect(bloc, cle(r)).toContain(`('${r.colonne}', '${r.parent}')`)
    for (const [table, colonne] of [
      ['dossiers', 'ventes_par_les_factures'], ['factures_emises', 'source_de_la_vente'], ['lignes_bancaires', 'encaissements_de_factures'],
    ]) expect(bloc, `${table}.${colonne}`).toContain(`('${table}', '${colonne}'`)
  })

  it('dans son ordre recopié, l’encaissement et la facture avant l’écriture', () => {
    const rang = (t: string) => Number(new RegExp(`\\((\\d+),'${t}'\\)`).exec(essai)?.[1])
    expect(rang('factures_emises')).toBeLessThan(rang('ecritures_brouillon'))
    expect(rang('encaissements_factures')).toBeLessThan(rang('ecritures_brouillon'))
  })
})
