import { describe, expect, it } from 'vitest'
import { PIECE_D_UNE_FACTURE_REPRISE_PREVUE, TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE } from './pieceDUneFactureReprise'
import {
  CHEMINS_DOSSIER, ORDRE_RESTAURATION, ORDRE_RESTAURATION_PREVU, RELATIONS_PREVUES, auPlanDeLaPieceDUneFactureReprise,
} from './sauvegarde'

// LA PIÈCE D'UNE FACTURE REPRISE AU PLAN DE SAUVEGARDE (ligne 51.5, A8-Q5) : sa table, derrière son drapeau, baissé tant que
// la migration `piece_d_une_facture_reprise` est préparée. Le plan prévu la restaure après tout ce que sa garde des
// règlements juge (les pièces, les mouvements, les parts, la caisse, les écritures) et après sa facture reprise, avant les
// exercices validés ; ses trois relations partent en cascade ; son chemin est direct. Le plan du jour ne la lit pas.

const TABLE = 'pieces_des_factures_reprises'

describe('la table des liens au plan de sauvegarde', () => {
  it('le plan prévu la restaure après ce qu’elle cite et ce que sa garde juge, avant les exercices validés', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(rang(TABLE)).toBeGreaterThan(0)
    for (const avant of ['dossiers', 'factures_emises', 'factures_importees', 'pieces', 'lignes_bancaires', 'reglements_groupes',
      'operations_caisse', 'ecritures_brouillon']) {
      expect(rang(avant), avant).toBeGreaterThanOrEqual(0)
      expect(rang(avant), avant).toBeLessThan(rang(TABLE))
    }
    expect(rang(TABLE)).toBe(rang('ecritures_brouillon') + 1)
    expect(rang(TABLE)).toBeLessThan(rang('exercices_valides'))
  })
  it('ses trois relations, en cascade, et son chemin direct', () => {
    expect(RELATIONS_PREVUES.filter((r) => r.enfant === TABLE).map((r) => `${r.parent}.${r.colonne}:${r.aLaSuppression}`).sort())
      .toEqual(['dossiers.dossier_id:cascade', 'factures_importees.facture_id:cascade', 'pieces.piece_id:cascade'])
  })
  it('le plan du jour suit le drapeau : baissé, la table n’est ni lue ni restaurée', () => {
    expect(TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE).toEqual([TABLE])
    expect(auPlanDeLaPieceDUneFactureReprise(TABLE, true)).toBe(true)
    expect(auPlanDeLaPieceDUneFactureReprise(TABLE, false)).toBe(false)
    expect(auPlanDeLaPieceDUneFactureReprise('pieces', false)).toBe(true)
    expect(ORDRE_RESTAURATION.includes(TABLE)).toBe(PIECE_D_UNE_FACTURE_REPRISE_PREVUE)
    expect(TABLE in CHEMINS_DOSSIER).toBe(PIECE_D_UNE_FACTURE_REPRISE_PREVUE)
  })
})
