import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import {
  DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE, REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE, refusDuReglementDeLaPieceCitee,
  refusDuReglementSelon, reglementsDeLaPieceCiteePrevus, type PaiementDeLaPieceCitee,
} from './reglementsDeLaPieceCitee'
import { REFUS_DU_REGLEMENT } from './pieceDUneFactureReprise'

// A8Q5Q3Q2-Q2 : LA GARDE DES RÈGLEMENTS JUGE CE QUE LA PIÈCE CITÉE A REÇU. Le module redit les refus de la migration préparée
// `reglements_de_la_piece_citee`, confrontés à son texte ; elle redit les règles de la citation (A8Q5Q3-Q2) et les sources
// de `recu_par_la_piece` telles que l'export les porte ; ses empreintes et celles de son retour se tiennent ; ses trois
// déclencheurs sont différés ; le drapeau suit l'export ; l'essai attend les mots du module. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_reglements_de_la_piece_citee\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_reglements_de_la_piece_citee\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/reglementsDeLaPieceCitee.sql', import.meta.url), 'utf8')
const EXPORTEE = fichiersDuSchema().some((f) => /\d{14}_reglements_de_la_piece_citee\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
// Les corps que la garde de tête suppose sont ceux de la production le jour de son collage : les migrations de l'export
// d'AVANT elle (plancher_a_l_ecart_d_alignement, appliquée le même jour après elle, redéfinit `recu_par_la_piece`).
const VERSION = /\/(\d{14})_reglements_de_la_piece_citee\.sql$/.exec(fichiersDuSchema().find((f) => /\d{14}_reglements_de_la_piece_citee\.sql$/.test(f.chemin))?.chemin ?? '')?.[1] ?? '99999999999999'
const AVANT_ELLE = (f: { chemin: string }) => (/\/(\d{14})_[^/]*$/.exec(f.chemin)?.[1] ?? '') < VERSION

/** La définition de la garde dans la migration : de son `create` au délimiteur fermant, exclu. */
function garde(): string {
  const definitions = definitionsSql('garder_recu_d_une_piece_citee', [{ chemin: 'migration', texte: MIGRATION }])
  expect(definitions).toHaveLength(1)
  return definitions[0].definition
}
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}

// L'état du drapeau au chargement (levé depuis l'application du 16/11/2026) : chaque test qui le force le rend.
const DRAPEAU_AU_CHARGEMENT = DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE.REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS
afterEach(() => {
  DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE.REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS = DRAPEAU_AU_CHARGEMENT
})

describe('A8Q5Q3Q2-Q2 — la migration, son retour et le module', () => {
  it('la garde : ses deux refus, au code 23514, dans l’ordre du module', () => {
    const sql = garde()
    expect(messagesSql(sql)).toEqual(REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE.map((r) => r.modele))
    expect(codesSql(sql)).toEqual(REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE.map((r) => r.code))
  })

  it('ce que le client « Caisse » lit d’un refus : ni nom de fichier, ni montant, ni numéro de facture', () => {
    for (const r of REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE) {
      expect(r.modele, r.cle).not.toMatch(/%|€|«|»|\d/)
      expect(r.modele, r.cle).toContain('Le cabinet ')
    }
    // La garde de la date, elle, nomme la pièce : un geste qu'elle refuse à l'écriture, avant celle-ci (son rang intact).
    expect(REFUS_DU_REGLEMENT.modele).toContain('« % »')
  })

  it('la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session', () => {
    expect(garde()).toMatch(/returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\n/)
    expect(MIGRATION).toContain('revoke all on function public.garder_recu_d_une_piece_citee() from public, anon, authenticated, service_role;')
  })

  it('cinq déclencheurs de contrainte, différés jusqu’à la fin de la transaction, sur les trois sources du reçu', () => {
    const declencheurs = [...MIGRATION.matchAll(/create constraint trigger (\w+)\n {2}after ([^\n]+) on public\.(\w+)\n {2}deferrable initially deferred\n {2}for each row when \(([^\n]+)\)\n {2}execute function public\.garder_recu_d_une_piece_citee\(\);/gi)]
      .map((m) => ({ nom: m[1], evenements: m[2], table: m[3], quand: m[4] }))
    expect(declencheurs).toEqual([
      { nom: 'lignes_bancaires_recu_d_une_piece_citee', evenements: 'insert or update of piece_id, statut, montant, reglement_groupe, dossier_id',
        table: 'lignes_bancaires', quand: 'new.piece_id is not null or new.reglement_groupe' },
      { nom: 'lignes_bancaires_depart_recu_d_une_piece_citee', evenements: 'update of piece_id, statut, montant, reglement_groupe, dossier_id or delete',
        table: 'lignes_bancaires', quand: 'old.piece_id is not null or old.reglement_groupe' },
      { nom: 'reglements_groupes_recu_d_une_piece_citee', evenements: 'insert or update of piece_id, ligne_bancaire_id, montant',
        table: 'reglements_groupes', quand: 'new.piece_id is not null and new.montant > 0' },
      { nom: 'reglements_groupes_depart_recu_d_une_piece_citee', evenements: 'update of piece_id, ligne_bancaire_id, montant or delete',
        table: 'reglements_groupes', quand: 'old.piece_id is not null and old.montant < 0' },
      { nom: 'operations_caisse_recu_d_une_piece_citee', evenements: 'insert', table: 'operations_caisse',
        quand: "new.piece_id is not null and new.genre = 'paiement' and new.retire_le is null and new.montant > 0" },
    ])
    // La garde de fin relit ces cinq définitions, telles que la base les rend.
    for (const d of declencheurs) expect(bloc(MIGRATION, 'fin'), d.nom).toContain(`CREATE CONSTRAINT TRIGGER ${d.nom} AFTER `)
  })

  it('l’image d’avant : une ligne qui défaisait ce que la pièce a reçu, et ne le défait plus, se juge (relecture adverse du 15/11/2026)', () => {
    const sql = garde()
    // Chaque déclencheur de l'image d'avant a sa branche, nommée : sans elle, la garde jugerait la ligne comme une ligne
    // d'après, et la pièce quittée échapperait de nouveau.
    expect(sql).toContain("elsif tg_name = 'lignes_bancaires_depart_recu_d_une_piece_citee' then")
    expect(sql).toContain("elsif tg_name = 'reglements_groupes_depart_recu_d_une_piece_citee' then")
    // La pièce quittée par un rejet (une ligne négative rapprochée de son dossier) : annulé, ignoré, supprimé, déplacé.
    expect(sql).toContain("if old.piece_id is not null and old.statut = 'rapprochee' and old.montant < 0\n       and (tg_op = 'DELETE' or new.piece_id is distinct from old.piece_id) then")
    // Les parts négatives d'un mouvement qui cesse de les faire compter.
    expect(sql).toContain('where g.ligne_bancaire_id = old.id and g.montant < 0 and old.dossier_id = p.dossier_id')
    // La part d'un mouvement supprimé avec elle est supposée compter.
    expect(sql).toContain('    else\n      v_avant_ligne := old.montant;\n    end if;')
    // L'essai les éprouve, sans aucune suppression (la suppression d'un rejet s'éprouve sur une réplique).
    expect(ESSAI).toContain("17. un paiement de 50 € et son rejet, rapprochés de la pièce avant la reprise")
    expect(ESSAI).toContain("18b. … le virement groupé remis à traiter, ses parts laissées")
    expect(ESSAI).not.toMatch(/delete from/i)
  })

  it('elle juge ce que la pièce reçoit des trois sources de `recu_par_la_piece`, de son dossier, comme l’export les porte', () => {
    const recu = derniereDefinitionSql('recu_par_la_piece', AVANT_ELLE)
    expect(recu).toContain("where l.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee'")
    expect(recu).toContain("where g.piece_id = p.id and l.dossier_id = p.dossier_id and l.statut = 'rapprochee' and l.reglement_groupe")
    expect(recu).toContain("where o.piece_id = p.id and o.dossier_id = p.dossier_id and o.genre = 'paiement' and o.retire_le is null")
    const sql = garde()
    expect(sql).toContain("v_apres_ligne := case when new.statut = 'rapprochee' and new.dossier_id = v_dossier then new.montant else 0 end;")
    expect(sql).toContain("where l.id = new.ligne_bancaire_id and l.statut = 'rapprochee' and l.reglement_groupe and l.dossier_id = p.dossier_id;")
    expect(sql).toContain('and new.statut = \'rapprochee\' and new.dossier_id = p.dossier_id')
    expect(sql).toContain('v_recu := public.recu_par_la_piece(v_piece);')
    // La garde de tête lit les quatre corps qu'elle suppose à leur empreinte dans l'export.
    const attendu = ['citer_piece_de_facture_reprise', 'enregistrer_encaissement', 'garder_reglement_d_une_piece_reprise', 'recu_par_la_piece']
      .map((nom) => `${nom}=${md5(corps(derniereDefinitionSql(nom, AVANT_ELLE)))}`).join(',')
    const lus = [...bloc(MIGRATION, 'garde').matchAll(/'(\w+)=([0-9a-f]{32})/g)].map((m) => `${m[1]}=${m[2]}`).join(',')
    expect(lus).toBe(attendu)
  })

  it('elle refuse ce que la citation refuse (son 4 bis), sur la même facture verrouillée de la même façon', () => {
    const citer = derniereDefinitionSql('citer_piece_de_facture_reprise')
    const sql = garde()
    expect(citer).toContain('if v_recu > v_avant * 100 and v_deja <> 0 then')
    expect(sql).toContain('if v_recu > v_avant * 100 and v_deja <> 0 then')
    expect(citer).toContain('if (select count(*) from public.montants_par_taux_du_document(p_facture_id)) > 1 then')
    expect(sql).toContain('if (select count(*) from public.montants_par_taux_du_document(v_facture)) > 1 then')
    // Le TTC net de ses avoirs, compté comme la citation le compte.
    const net = (texte: string, facture: string) => {
      const debut = texte.indexOf('select (f.montant_ttc * 100)::bigint')
      return texte.slice(debut, texte.indexOf(';', debut)).replaceAll(facture, 'F').replace(/\s+/g, ' ')
    }
    expect(net(sql, 'v_facture')).toBe(net(citer, 'p_facture_id'))
    expect(citer).toContain('if v_deja * 100 + v_recu > v_net then')
    expect(sql).toContain('if v_deja * 100 + v_recu > v_net then')
    // La facture, verrouillée comme la citation et le registre la verrouillent ; la pièce d'abord, jamais l'ordre inverse.
    expect(citer).toContain('perform 1 from public.factures_emises f where f.id = p_facture_id for no key update;')
    expect(derniereDefinitionSql('enregistrer_encaissement')).toContain('   for no key update;')
    const piece = sql.indexOf('perform 1 from public.pieces p where p.id = v_piece for key share;')
    const facture = sql.indexOf('perform 1 from public.factures_emises f where f.id = v_facture for no key update;')
    expect(piece).toBeGreaterThan(0)
    expect(facture).toBeGreaterThan(piece)
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le retour ne retire que ce qu’elle pose', () => {
    const empreinte = md5(corps(garde()))
    expect(bloc(MIGRATION, 'fin')).toContain(`is distinct from '${empreinte}'`)
    expect(bloc(RETOUR, 'garde')).toContain(`is distinct from '${empreinte}'`)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toMatch(/create or replace/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([
      'drop trigger lignes_bancaires_recu_d_une_piece_citee on public.lignes_bancaires;',
      'drop trigger lignes_bancaires_depart_recu_d_une_piece_citee on public.lignes_bancaires;',
      'drop trigger reglements_groupes_recu_d_une_piece_citee on public.reglements_groupes;',
      'drop trigger reglements_groupes_depart_recu_d_une_piece_citee on public.reglements_groupes;',
      'drop trigger operations_caisse_recu_d_une_piece_citee on public.operations_caisse;',
      'drop function public.garder_recu_d_une_piece_citee();',
    ])
  })

  it('le drapeau suit l’export : levé depuis que la migration y est (appliquée le 16/11/2026)', () => {
    expect(EXPORTEE).toBe(true)
    expect(DRAPEAU_AU_CHARGEMENT).toBe(EXPORTEE)
    expect(reglementsDeLaPieceCiteePrevus()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module', () => {
    for (const r of REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE) expect(ESSAI, r.cle).toContain(`'${r.modele.replace(/'/g, "''")}'`)
    expect(ESSAI).toContain("to_regprocedure('public.garder_recu_d_une_piece_citee()') is not null")
  })
})

// Le jugement, sur les cas de l'essai : la facture R-Q2Q2-1 à un taux (120 € TTC) ou à deux (230 € TTC).
const cas = (p: Partial<PaiementDeLaPieceCitee>): PaiementDeLaPieceCitee => ({
  hausse: true, recuApresCentimes: 0, declareCentimes: 0, dejaCentimes: 10000, netCentimes: 12000, nombreDeTaux: 1, ...p,
})

describe('A8Q5Q3Q2-Q2 — le jugement, comme la base', () => {
  it('un taux, le registre a reçu 100 € : 20 € passent, 21 € non', () => {
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 2000 }))).toBeNull()
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 2100 }))?.cle).toBe('reglement_deja_encaisse')
  })
  it('deux taux : refusé dès que le reçu dépasse le déclaré et que le registre a reçu ; le registre vide ou le déclaré qui couvre, non', () => {
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 3000, dejaCentimes: 1000, netCentimes: 23000, nombreDeTaux: 2 }))?.cle)
      .toBe('reglement_plusieurs_taux')
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 3000, dejaCentimes: 0, netCentimes: 23000, nombreDeTaux: 2 }))).toBeNull()
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 3000, declareCentimes: 10000, dejaCentimes: 1000, netCentimes: 23000, nombreDeTaux: 2 })))
      .toBeNull()
  })
  it('le déclaré (80 €) et 30 € au registre : 90 € passent, 91 € non', () => {
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 9000, declareCentimes: 8000, dejaCentimes: 3000 }))).toBeNull()
    expect(refusDuReglementDeLaPieceCitee(cas({ recuApresCentimes: 9100, declareCentimes: 8000, dejaCentimes: 3000 }))?.cle)
      .toBe('reglement_deja_encaisse')
  })
  it('ce qui fait baisser le reçu ne se refuse jamais, même sur un état déjà fautif', () => {
    expect(refusDuReglementDeLaPieceCitee(cas({ hausse: false, recuApresCentimes: 4000 }))).toBeNull()
  })
  it('selon l’état de la base : baissé, rien ; levé, le refus', () => {
    const fautif = cas({ recuApresCentimes: 2100 })
    expect(refusDuReglementSelon(false, fautif)).toBeNull()
    expect(refusDuReglementSelon(true, fautif)?.message).toBe(REFUS_DU_REGLEMENT_DE_LA_PIECE_CITEE[1].modele)
    DRAPEAU_DES_REGLEMENTS_DE_LA_PIECE_CITEE.REGLEMENTS_DE_LA_PIECE_CITEE_PREVUS = true
    expect(reglementsDeLaPieceCiteePrevus()).toBe(true)
  })
})
