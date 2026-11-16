import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { definitionsSql, fichiersDuSchema, indiceSql } from '../test/schema'
import { codesSql, messagesSql } from '../test/raiseSql'
import { sansCommentaires } from '../test/blocsSql'
import {
  DRAPEAU_DE_LA_PIECE_D_UN_PAIEMENT, REFUS_DE_LA_PIECE_D_UN_PAIEMENT, pieceDUnPaiementDansSonDossierPrevue, refusDeLaPart,
  refusDuMouvement, refusDuMouvementSelon,
} from './pieceDUnPaiementDansSonDossier'

// A8Q5-Q4 : LA PIÈCE D'UN PAIEMENT, TENUE DANS SON DOSSIER. Le module redit les refus de la migration préparée
// `piece_d_un_paiement_dans_son_dossier`, confrontés à son texte ; ses trois déclencheurs tirent juste après la porte d'accès
// et avant toute garde BEFORE que l'export pose sur ces tables ; ses empreintes et celles de son retour se tiennent ; le
// drapeau suit l'export ; l'essai attend les mots du module. Données FICTIVES.

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

const MIGRATION = leFichier(/^\d{14}_piece_d_un_paiement_dans_son_dossier\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_piece_d_un_paiement_dans_son_dossier\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/pieceDUnPaiementDansSonDossier.sql', import.meta.url), 'utf8')
const SCHEMA = fichiersDuSchema()
const EXPORTEE = SCHEMA.some((f) => /\d{14}_piece_d_un_paiement_dans_son_dossier\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

function garde(): string {
  const definitions = definitionsSql('garder_piece_dans_son_dossier', [{ chemin: 'migration', texte: MIGRATION }])
  expect(definitions).toHaveLength(1)
  return definitions[0].definition
}
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const bloc = (texte: string, etiquette: string) => {
  const debut = texte.indexOf(`do $${etiquette}$`)
  return texte.slice(debut, texte.indexOf(`$${etiquette}$;`, debut))
}

/** Les déclencheurs BEFORE que l'export pose, par table : leurs noms, sans ceux qu'un fichier retire ensuite. */
function declencheursBeforeDeLExport(table: string): string[] {
  const noms = new Set<string>()
  for (const f of SCHEMA) {
    const texte = sansCommentaires(f.texte)
    for (const m of texte.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\s+before\s+[^;]*?\son\s+(?:public\.)?(\w+)\s/gi)) {
      if (m[2].toLowerCase() === table) noms.add(m[1].toLowerCase())
    }
    for (const m of texte.matchAll(/drop\s+trigger\s+(?:if\s+exists\s+)?(\w+)\s+on\s+(?:public\.)?(\w+)/gi)) {
      if (m[2].toLowerCase() === table) noms.delete(m[1].toLowerCase())
    }
  }
  return [...noms].sort()
}

/** Comparaison octet par octet, comme PostgreSQL range les noms des déclencheurs d'un même évènement. */
const avant = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0

afterEach(() => {
  DRAPEAU_DE_LA_PIECE_D_UN_PAIEMENT.PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE = false
})

describe('A8Q5-Q4 — la migration, son retour et le module', () => {
  it('la garde : ses quatre refus, au code 23514, dans l’ordre du module', () => {
    const sql = garde()
    expect(messagesSql(sql)).toEqual(REFUS_DE_LA_PIECE_D_UN_PAIEMENT.map((r) => r.modele))
    expect(codesSql(sql)).toEqual(REFUS_DE_LA_PIECE_D_UN_PAIEMENT.map((r) => r.code))
  })

  it('un refus ne dit rien de la pièce : ni nom, ni dossier, ni montant', () => {
    for (const r of REFUS_DE_LA_PIECE_D_UN_PAIEMENT) expect(r.modele, r.cle).not.toMatch(/%|€|«|»|\d/)
  })

  it('la garde aux droits de son propriétaire, son chemin fixé, exécutable par aucun rôle de session', () => {
    expect(garde()).toMatch(/returns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = public\n/)
    expect(MIGRATION).toContain('revoke all on function public.garder_piece_dans_son_dossier() from public, anon, authenticated, service_role;')
  })

  it('ses trois déclencheurs BEFORE, sur la pièce et le dossier de la ligne', () => {
    const declencheurs = [...MIGRATION.matchAll(/create trigger (\w+)\n {2}before ([^\n]+) on public\.(\w+)\n/gi)]
      .map((m) => ({ nom: m[1], evenements: m[2], table: m[3] }))
    expect(declencheurs).toEqual([
      { nom: 'lignes_bancaires_dans_son_dossier', evenements: 'insert or update of piece_id, dossier_id', table: 'lignes_bancaires' },
      { nom: 'reglements_groupes_dans_son_dossier', evenements: 'insert or update of piece_id, dossier_id, ligne_bancaire_id', table: 'reglements_groupes' },
      { nom: 'pieces_reglees_dans_leur_dossier', evenements: 'update of dossier_id', table: 'pieces' },
    ])
    expect(MIGRATION).toContain('  for each row when (old.dossier_id is distinct from new.dossier_id)\n  execute function public.garder_piece_dans_son_dossier();')
    for (const d of declencheurs) expect(bloc(MIGRATION, 'fin'), d.nom).toContain(`CREATE TRIGGER ${d.nom} BEFORE `)
  })

  it('leur rang : juste après la porte d’accès, avant toute garde BEFORE que l’export pose sur les deux tables des paiements', () => {
    for (const [table, nom] of [['lignes_bancaires', 'lignes_bancaires_dans_son_dossier'], ['reglements_groupes', 'reglements_groupes_dans_son_dossier']]) {
      const autres = declencheursBeforeDeLExport(table)
      expect(autres, table).toContain('_acces_avant_les_gardes')
      // Le plancher : les gardes qui lisent la pièce citée, que la neuve devance.
      expect(autres, table).toContain(`${table}_piece_d_une_facture_reprise`)
      expect(autres, table).toContain(`${table}_sans_exemplaire_d_une_source`)
      for (const autre of autres) {
        if (autre === '_acces_avant_les_gardes') expect(avant(autre, nom), autre).toBe(true)
        else expect(avant(nom, autre), `${nom} avant ${autre}`).toBe(true)
      }
    }
  })

  it('le relevé de zéro ligne fautive porte sur les trois tables des paiements, avant toute pose', () => {
    const tete = bloc(MIGRATION, 'garde')
    expect(tete).toContain('from public.lignes_bancaires l join public.pieces p on p.id = l.piece_id')
    expect(tete).toContain('where p.dossier_id is distinct from g.dossier_id or l.dossier_id is distinct from g.dossier_id')
    expect(tete).toContain('from public.operations_caisse o join public.pieces p on p.id = o.piece_id')
    expect(MIGRATION.indexOf('do $garde$')).toBeLessThan(indiceSql(MIGRATION, 'create function public.garder_piece_dans_son_dossier'))
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le retour ne retire que ce qu’elle pose', () => {
    const empreinte = md5(corps(garde()))
    expect(bloc(MIGRATION, 'fin')).toContain(`is distinct from '${empreinte}'`)
    expect(bloc(RETOUR, 'garde')).toContain(`is distinct from '${empreinte}'`)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toMatch(/create or replace/i)
    expect(MIGRATION).not.toContain('\\')
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual([
      'drop trigger lignes_bancaires_dans_son_dossier on public.lignes_bancaires;',
      'drop trigger reglements_groupes_dans_son_dossier on public.reglements_groupes;',
      'drop trigger pieces_reglees_dans_leur_dossier on public.pieces;',
      'drop function public.garder_piece_dans_son_dossier();',
    ])
  })

  it('la caisse la tenait déjà : la garde de la table (dans l’export) le dit sous ses mots, que l’essai attend', () => {
    const tableDeLaCaisse = definitionsSql('garder_operation_caisse', SCHEMA)
    expect(tableDeLaCaisse.at(-1)?.definition).toContain("raise exception 'La pièce d''un paiement par la caisse est une pièce de son dossier.' using errcode = '23514';")
    expect(ESSAI).toContain("'La pièce d''un paiement par la caisse est une pièce de son dossier.'")
  })

  it('le drapeau suit l’export : baissé tant que la migration n’y est pas', () => {
    expect(EXPORTEE).toBe(false)
    expect(pieceDUnPaiementDansSonDossierPrevue()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module, et se dit EN ATTENTE sans la migration', () => {
    for (const r of REFUS_DE_LA_PIECE_D_UN_PAIEMENT) expect(ESSAI, r.cle).toContain(`'${r.modele.replace(/'/g, "''")}'`)
    expect(ESSAI).toContain("to_regprocedure('public.garder_piece_dans_son_dossier()') is not null")
    expect(ESSAI).toContain('EN ATTENTE de la migration piece_d_un_paiement_dans_son_dossier')
    expect(ESSAI).not.toMatch(/delete from/i)
  })
})

const DA = 'a8560000-0000-4000-8000-0000000000d1'
const DB = 'a8560000-0000-4000-8000-0000000000d2'

describe('A8Q5-Q4 — le jugement, comme la base', () => {
  it('le mouvement : une pièce de son dossier passe ; d’un autre dossier, ou inconnue, non ; sans pièce, rien', () => {
    expect(refusDuMouvement({ dossierId: DA, pieceId: 'p', dossierDeLaPiece: DA })).toBeNull()
    expect(refusDuMouvement({ dossierId: DA, pieceId: 'p', dossierDeLaPiece: DB })?.cle).toBe('mouvement_hors_du_dossier')
    expect(refusDuMouvement({ dossierId: DA, pieceId: 'p', dossierDeLaPiece: null })?.cle).toBe('mouvement_hors_du_dossier')
    expect(refusDuMouvement({ dossierId: DA, pieceId: null, dossierDeLaPiece: null })).toBeNull()
  })
  it('la part : sa pièce du dossier de la part et de celui de son mouvement', () => {
    expect(refusDeLaPart({ dossierId: DA, dossierDuMouvement: DA, pieceId: 'p', dossierDeLaPiece: DA })).toBeNull()
    expect(refusDeLaPart({ dossierId: DA, dossierDuMouvement: DA, pieceId: 'p', dossierDeLaPiece: DB })?.cle).toBe('part_hors_du_dossier')
    expect(refusDeLaPart({ dossierId: DB, dossierDuMouvement: DA, pieceId: 'p', dossierDeLaPiece: DB })?.cle).toBe('part_hors_du_dossier')
    expect(refusDeLaPart({ dossierId: DA, dossierDuMouvement: DB, pieceId: null, dossierDeLaPiece: null })).toBeNull()
  })
  it('selon l’état de la base : baissé, rien ; levé, le refus', () => {
    const fautif = { dossierId: DA, pieceId: 'p', dossierDeLaPiece: DB }
    expect(refusDuMouvementSelon(false, fautif)).toBeNull()
    expect(refusDuMouvementSelon(true, fautif)?.message).toBe(REFUS_DE_LA_PIECE_D_UN_PAIEMENT[2].modele)
    DRAPEAU_DE_LA_PIECE_D_UN_PAIEMENT.PIECE_D_UN_PAIEMENT_DANS_SON_DOSSIER_PREVUE = true
    expect(pieceDUnPaiementDansSonDossierPrevue()).toBe(true)
  })
})
