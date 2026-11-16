import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import { SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF } from './alignementBanque'
import { partsDesPaiements } from './rattachement'
import {
  DIVISEUR_DE_L_ECART, DRAPEAU_DU_PLANCHER_A_L_ECART, PLAFOND_DE_L_ECART_CENTIMES, REFUS_DU_MONTANT_DE_LA_PIECE_CITEE,
  plancherALEcartDAlignementPrevu, plancherDUnePiece, plancherSelon, refusDuMontantDeLaPieceCitee, type MontantDeLaPieceCitee,
} from './plancherALEcartDAlignement'

// A8Q5Q3Q2-Q3 : LE PLANCHER PREND LA PIÈCE ENTIÈRE SOUS L'ÉCART D'ALIGNEMENT. Le module redit la règle et les refus de la
// migration préparée `plancher_a_l_ecart_d_alignement`, confrontés à son texte ; la règle, à celle de la 2035 elle-même
// (`partsDesPaiements`) sur un balayage ; les trois sources du reçu, à celles de l'export ; le jugement de la garde du montant,
// à celui de la citation ; ses empreintes, son retour ; le drapeau suit l'export ; l'essai attend les mots du module.

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_plancher_a_l_ecart_d_alignement\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_plancher_a_l_ecart_d_alignement\.sql$/, ['../../supabase/preparees/retour/'])
// La garde des règlements (A8Q5Q3Q2-Q2), qu'elle suppose : préparée hier, en production le jour de son collage.
const REGLEMENTS = leFichier(/^\d{14}_reglements_de_la_piece_citee\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/plancherALEcartDAlignement.sql', import.meta.url), 'utf8')
const EXPORTEE = fichiersDuSchema().some((f) => /\d{14}_plancher_a_l_ecart_d_alignement\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

const definition = (texte: string, nom: string) => {
  const d = definitionsSql(nom, [{ chemin: 'f', texte }])
  expect(d.length, nom).toBeGreaterThan(0)
  return d[d.length - 1].definition
}
const corps = (d: string) => d.slice(d.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}
/** Les trois sources d'un reçu : de la première `select l.montant` à la parenthèse qui ferme le `lateral`, blancs réduits. */
const sources = (d: string) => {
  const debut = d.indexOf('select l.montant from public.lignes_bancaires l')
  return d.slice(debut, d.indexOf("o.retire_le is null)", debut) + "o.retire_le is null)".length).replace(/\s+/g, ' ')
}

afterEach(() => {
  DRAPEAU_DU_PLANCHER_A_L_ECART.PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU = false
})

describe('A8Q5Q3Q2-Q3 — la règle, celle de la 2035', () => {
  it('les deux bornes de l’écart sont celles de l’alignement : 2 % et 5 €, en entiers', () => {
    expect(DIVISEUR_DE_L_ECART * SEUIL_ALIGNEMENT_RELATIF).toBeCloseTo(1, 12)
    expect(PLAFOND_DE_L_ECART_CENTIMES).toBe(SEUIL_ALIGNEMENT_PLAFOND_EUR * 100)
    expect(definition(MIGRATION, 'recu_par_la_piece_au_montant'))
      .toContain(`select case when x.recu > 0 and x.recu < x.piece and (x.piece - x.recu) * ${DIVISEUR_DE_L_ECART} <= x.piece and x.piece - x.recu <= ${PLAFOND_DE_L_ECART_CENTIMES}\n              then x.piece else x.recu end`)
  })

  it('balayée contre `partsDesPaiements` : un reçu sous le montant compte la pièce entière exactement quand la 2035 la dit réglée', () => {
    const pieces = [1, 49, 50, 51, 99, 100, 101, 2500, 2501, 11760, 12000, 12037, 24999, 25000, 25001, 29999, 30000, 123456, 987654]
    let entieres = 0
    let comparees = 0
    for (const piece of pieces) {
      for (let recu = Math.max(1, piece - 700); recu <= piece + 50; recu++) {
        const regle = partsDesPaiements({ montant_ttc: piece / 100 }, [{ date: '2025-12-10', montant: recu / 100 }]).reste === 0
        const attendu = recu < piece && regle ? piece : recu
        expect(plancherDUnePiece(recu, piece / 100), `${piece} / ${recu}`).toBe(attendu)
        if (attendu === piece && recu < piece) entieres++
        comparees++
      }
    }
    // Le plancher : le balayage voit des pièces comptées entières, et bien plus de cas que de pièces.
    expect(entieres).toBeGreaterThan(1000)
    expect(comparees).toBeGreaterThan(9000)
  })

  it('les cas de l’essai : 118 € et 117,60 € d’une pièce de 120 € ; 117,59 € ; 295 € et 294,99 € de 300 € ; payée au-delà ; rien', () => {
    expect(plancherDUnePiece(11800, 120)).toBe(12000)
    expect(plancherDUnePiece(11760, 120)).toBe(12000)
    expect(plancherDUnePiece(11759, 120)).toBe(11759)
    expect(plancherDUnePiece(29500, 300)).toBe(30000)
    expect(plancherDUnePiece(29499, 300)).toBe(29499)
    expect(plancherDUnePiece(12500, 120)).toBe(12500)
    expect(plancherDUnePiece(0, 120)).toBe(0)
    expect(plancherDUnePiece(11800, null)).toBe(11800)
  })

  it('selon l’état de la base : baissé, ce que la pièce a reçu ; levé, la pièce entière', () => {
    expect(plancherSelon(false, 11800, 120)).toBe(11800)
    expect(plancherSelon(true, 11800, 120)).toBe(12000)
    DRAPEAU_DU_PLANCHER_A_L_ECART.PLANCHER_A_L_ECART_D_ALIGNEMENT_PREVU = true
    expect(plancherALEcartDAlignementPrevu()).toBe(true)
  })
})

describe('A8Q5Q3Q2-Q3 — la migration, son retour et le module', () => {
  it('ses trois sources du reçu sont celles de `recu_par_la_piece` dans l’export, au caractère près', () => {
    expect(sources(definition(MIGRATION, 'recu_par_la_piece_au_montant'))).toBe(sources(derniereDefinitionSql('recu_par_la_piece')))
    expect(sources(derniereDefinitionSql('recu_par_la_piece')).length).toBeGreaterThan(400)
    // `recu_par_la_piece` lit la neuve à SON montant.
    expect(corps(definition(MIGRATION, 'recu_par_la_piece')))
      .toContain('select public.recu_par_la_piece_au_montant(p_piece_id, (select p.montant_ttc from public.pieces p where p.id = p_piece_id))')
  })

  it('la garde du montant : ses deux refus, au code 23514, dans l’ordre du module ; ni nom, ni montant', () => {
    const sql = definition(MIGRATION, 'garder_plancher_d_une_piece_citee')
    expect(messagesSql(sql)).toEqual(REFUS_DU_MONTANT_DE_LA_PIECE_CITEE.map((r) => r.modele))
    expect(codesSql(sql)).toEqual(REFUS_DU_MONTANT_DE_LA_PIECE_CITEE.map((r) => r.code))
    for (const r of REFUS_DU_MONTANT_DE_LA_PIECE_CITEE) expect(r.modele, r.cle).not.toMatch(/%|€|«|»/)
  })

  it('elle juge comme la garde des règlements et la citation : le même 4 bis, le même net, les mêmes verrous dans le même ordre', () => {
    const sql = definition(MIGRATION, 'garder_plancher_d_une_piece_citee')
    const reglements = definition(REGLEMENTS, 'garder_recu_d_une_piece_citee')
    for (const ligne of ['if v_recu > v_avant * 100 and v_deja <> 0 then', 'if (select count(*) from public.montants_par_taux_du_document(v_facture)) > 1 then',
      'if v_deja * 100 + v_recu > v_net then']) {
      expect(sql, ligne).toContain(ligne)
      expect(reglements, ligne).toContain(ligne)
    }
    const net = (texte: string) => {
      const debut = texte.indexOf('select (f.montant_ttc * 100)::bigint')
      return texte.slice(debut, texte.indexOf(';', debut)).replace(/\s+/g, ' ')
    }
    expect(net(sql)).toBe(net(reglements))
    const piece = sql.indexOf('perform 1 from public.pieces p where p.id = new.id for key share;')
    const facture = sql.indexOf('perform 1 from public.factures_emises f where f.id = v_facture for no key update;')
    expect(piece).toBeGreaterThan(0)
    expect(facture).toBeGreaterThan(piece)
    // Ce qui ne monte pas ne se juge pas : l'ancien montant et le nouveau, sur le même reçu.
    expect(sql).toContain('if public.recu_par_la_piece_au_montant(new.id, new.montant_ttc)\n     <= public.recu_par_la_piece_au_montant(new.id, old.montant_ttc) then')
  })

  it('son déclencheur, différé, sur la mise à jour du montant ; son nom hors des cinq de la garde des règlements', () => {
    expect(MIGRATION).toContain('create constraint trigger pieces_plancher_d_une_piece_citee\n  after update of montant_ttc on public.pieces\n  deferrable initially deferred\n'
      + '  for each row when (old.montant_ttc is distinct from new.montant_ttc)\n  execute function public.garder_plancher_d_une_piece_citee();')
    expect('pieces_plancher_d_une_piece_citee').not.toMatch(/recu_d_une_piece_citee$/)
  })

  it('la garde de tête nomme le corps de production de `recu_par_la_piece` et celui de la garde des règlements', () => {
    const tete = bloc(MIGRATION, 'garde')
    expect(tete).toContain(`recu_par_la_piece=${md5(corps(derniereDefinitionSql('recu_par_la_piece')))}`)
    expect(tete).toContain(`garder_recu_d_une_piece_citee=${md5(corps(definition(REGLEMENTS, 'garder_recu_d_une_piece_citee')))}`)
    // Le relevé, sur le plancher neuf, après la pose de la fonction et avant celle de la garde.
    expect(MIGRATION.indexOf('do $releve$')).toBeGreaterThan(MIGRATION.indexOf('create or replace function public.recu_par_la_piece('))
    expect(MIGRATION.indexOf('do $releve$')).toBeLessThan(MIGRATION.indexOf('create function public.garder_plancher_d_une_piece_citee'))
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le retour rend le corps de production', () => {
    const empreintes = ['garder_plancher_d_une_piece_citee', 'recu_par_la_piece', 'recu_par_la_piece_au_montant']
      .map((nom) => `${nom}=${md5(corps(definition(MIGRATION, nom)))}`)
    for (const e of empreintes) {
      expect(bloc(MIGRATION, 'fin'), e).toContain(e)
      expect(bloc(RETOUR, 'garde'), e).toContain(e)
    }
    expect(md5(corps(definition(RETOUR, 'recu_par_la_piece')))).toBe(md5(corps(derniereDefinitionSql('recu_par_la_piece'))))
    expect(bloc(RETOUR, 'fin')).toContain(`'${md5(corps(derniereDefinitionSql('recu_par_la_piece')))}'`)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([
      'drop trigger pieces_plancher_d_une_piece_citee on public.pieces;',
      'drop function public.garder_plancher_d_une_piece_citee();',
      'drop function public.recu_par_la_piece_au_montant(uuid, numeric);',
    ])
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas', () => {
    expect(EXPORTEE).toBe(false)
    expect(plancherALEcartDAlignementPrevu()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module, et se dit EN ATTENTE sans la migration', () => {
    for (const r of REFUS_DU_MONTANT_DE_LA_PIECE_CITEE) expect(ESSAI, r.cle).toContain(`'${r.modele.replace(/'/g, "''")}'`)
    expect(ESSAI).toContain("to_regprocedure('public.recu_par_la_piece_au_montant(uuid, numeric)') is not null")
    expect(ESSAI).toContain('EN ATTENTE de la migration plancher_a_l_ecart_d_alignement')
    expect(ESSAI).not.toMatch(/delete from/i)
  })
})

// Le jugement, sur les cas de l'essai : la facture R-Q3-1 à un taux (120 € TTC) ou à deux (230 € TTC).
const cas = (m: Partial<MontantDeLaPieceCitee>): MontantDeLaPieceCitee => ({
  recuCentimes: 11800, ancienMontantTtc: 125, nouveauMontantTtc: 120, declareCentimes: 0, dejaCentimes: 200, netCentimes: 12000,
  nombreDeTaux: 1, ...m,
})

describe('A8Q5Q3Q2-Q3 — le jugement du montant, comme la base', () => {
  it('125 € → 120 € ou 119 €, 118 € reçus, 2 € au registre : refusé ; → 124 € ou 118 € : rien', () => {
    expect(refusDuMontantDeLaPieceCitee(cas({}))?.cle).toBe('montant_deux_fois')
    expect(refusDuMontantDeLaPieceCitee(cas({ nouveauMontantTtc: 119 }))?.cle).toBe('montant_deux_fois')
    expect(refusDuMontantDeLaPieceCitee(cas({ nouveauMontantTtc: 124 }))).toBeNull()
    expect(refusDuMontantDeLaPieceCitee(cas({ nouveauMontantTtc: 118 }))).toBeNull()
  })
  it('le registre vide : rien ; deux taux, le déclaré sous le plancher neuf : refusé plutôt que deviner', () => {
    expect(refusDuMontantDeLaPieceCitee(cas({ dejaCentimes: 0 }))).toBeNull()
    expect(refusDuMontantDeLaPieceCitee(cas({ recuCentimes: 22800, ancienMontantTtc: 240, nouveauMontantTtc: 230, declareCentimes: 22800,
      dejaCentimes: 100, netCentimes: 23000, nombreDeTaux: 2 }))?.cle).toBe('montant_plusieurs_taux')
  })
  it('ce qui fait baisser le plancher ne se refuse jamais, l’état restât-il fautif', () => {
    expect(refusDuMontantDeLaPieceCitee(cas({ recuCentimes: 10000, ancienMontantTtc: 101, nouveauMontantTtc: 100.5, dejaCentimes: 2000 }))).toBeNull()
  })
})
