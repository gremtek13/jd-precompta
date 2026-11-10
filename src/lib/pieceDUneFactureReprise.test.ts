import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PIECE_D_UNE_FACTURE_REPRISE_PREVUE, REFUS_CITER, REFUS_DE_LA_PIECE, REFUS_DU_LIEN, REFUS_DU_REGLEMENT, REFUS_RETIRER,
  TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE, jourDit, refusDuReglement, reglementRefuse, remplir,
} from './pieceDUneFactureReprise'

// LA PIÈCE D'UNE FACTURE REPRISE (ligne 51.5, A8-Q5) : le module redit les refus de la migration `piece_d_une_facture_reprise`
// — préparée le 10/11/2026, dans l'export le jour de son application — fonction par fonction, dans l'ordre, au code près ; son
// retour retire tout ce qu'elle pose ; son essai attend les mots du module. La migration se cherche où qu'elle soit, une fois.

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

const MIGRATION = leFichier(/^\d{14}_piece_d_une_facture_reprise\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_piece_d_une_facture_reprise\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/pieceDUneFactureReprise.sql', import.meta.url), 'utf8')

/** Une fonction de la migration : de son `create function public.<nom>(` au `$$;` qui la ferme, exclu. */
function fonction(nom: string): string {
  const m = new RegExp(`create (or replace )?function public\\.${nom}\\(`).exec(MIGRATION)
  expect(m, nom).not.toBeNull()
  const debut = (m as RegExpExecArray).index
  return MIGRATION.slice(debut, MIGRATION.indexOf('$$;', debut))
}

/** Les refus d'un texte SQL, dans l'ordre : leurs mots (les apostrophes doublées rendues) et leur code. */
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)]
    .map((m) => ({ code: m[2], modele: m[1].replace(/''/g, "'") }))
const duModule = (liste: readonly { code: string; modele: string }[]) => liste.map((r) => ({ code: r.code, modele: r.modele }))

describe('les refus de la migration, aux mots et au code de la base', () => {
  it('citer_piece_de_facture_reprise', () => {
    expect(refusSql(fonction('citer_piece_de_facture_reprise'))).toEqual(duModule(REFUS_CITER))
  })
  it('retirer_piece_de_facture_reprise', () => {
    expect(refusSql(fonction('retirer_piece_de_facture_reprise'))).toEqual(duModule(REFUS_RETIRER))
  })
  it('la garde des règlements, la garde du lien, la garde de la pièce citée', () => {
    expect(refusSql(fonction('garder_reglement_d_une_piece_reprise'))).toEqual(duModule([REFUS_DU_REGLEMENT]))
    expect(refusSql(fonction('garder_pieces_des_factures_reprises'))).toEqual(duModule(REFUS_DU_LIEN))
    expect(refusSql(fonction('garder_piece_d_une_facture_reprise'))).toEqual(duModule(REFUS_DE_LA_PIECE))
  })
  it('la garde des règlements juge les quatre tables, à la date de reprise ou après', () => {
    const garde = fonction('garder_reglement_d_une_piece_reprise')
    expect(garde).toContain('if v_date >= v_reprise then')
    for (const table of ['lignes_bancaires', 'reglements_groupes', 'operations_caisse', 'ecritures_brouillon']) {
      expect(MIGRATION).toMatch(new RegExp(`create trigger ${table}_piece_d_une_facture_reprise\\n  before insert or update of [a-z_, ]+ on public\\.${table}\\n  for each row execute function public\\.garder_reglement_d_une_piece_reprise\\(\\);`))
    }
  })
})

describe('la migration se tient', () => {
  it('additive : aucune instruction de suppression, aucune fonction remplacée', () => {
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(MIGRATION).not.toMatch(/create or replace/i)
  })
  it('son retour retire chaque objet qu’elle crée, et se refuse tant qu’un lien vit', () => {
    const crees = [...MIGRATION.matchAll(/^create (function|table|trigger) public\.(\w+)|^create trigger (\w+)/gm)].map((m) => m[2] ?? m[3])
    expect(crees).toHaveLength(12)
    // La garde de la table part avec elle (`drop table`) ; tout autre objet a son `drop`.
    for (const nom of crees.filter((n) => n !== 'pieces_des_factures_reprises_garde')) expect(RETOUR, nom).toMatch(new RegExp(`drop (function|table|trigger) (public\\.)?${nom}\\b`))
    expect(RETOUR).toContain('if exists (select 1 from public.pieces_des_factures_reprises) then')
  })
  it('les fonctions du cabinet : aux droits du propriétaire, leur chemin fixé, aux connectés seuls ; les gardes à personne', () => {
    for (const nom of ['citer_piece_de_facture_reprise', 'retirer_piece_de_facture_reprise']) {
      expect(fonction(nom)).toMatch(/security definer\nset search_path = public\n/)
      expect(MIGRATION).toMatch(new RegExp(`revoke all on function public\\.${nom}\\([a-z, ]+\\) from public, anon, service_role;`))
      expect(MIGRATION).toMatch(new RegExp(`grant execute on function public\\.${nom}\\([a-z, ]+\\) to authenticated;`))
    }
    for (const nom of ['garder_pieces_des_factures_reprises', 'garder_reglement_d_une_piece_reprise', 'garder_piece_d_une_facture_reprise']) {
      expect(MIGRATION).toContain(`revoke all on function public.${nom}() from public, anon, authenticated, service_role;`)
    }
  })
  it('le drapeau est baissé tant que la migration est préparée, et nomme sa table', () => {
    expect(PIECE_D_UNE_FACTURE_REPRISE_PREVUE).toBe(false)
    expect(TABLES_DE_LA_PIECE_D_UNE_FACTURE_REPRISE).toEqual(['pieces_des_factures_reprises'])
    expect(MIGRATION).toContain('create table public.pieces_des_factures_reprises (')
  })
})

describe('le jugement d’une date et les mots remplis', () => {
  it('un règlement se refuse à la date de reprise ou après, passe la veille', () => {
    expect(reglementRefuse('2026-11-01', '2026-11-01')).toBe(true)
    expect(reglementRefuse('2026-12-31', '2026-11-01')).toBe(true)
    expect(reglementRefuse('2026-10-31', '2026-11-01')).toBe(false)
    expect(() => reglementRefuse('01/11/2026', '2026-11-01')).toThrow()
  })
  it('les mots remplis comme la base les remplit, et comme l’essai les attend', () => {
    expect(jourDit('2026-11-01')).toBe('01/11/2026')
    expect(remplir('À % %%, reste %.', 20, '3,00 €')).toBe('À 20 %, reste 3,00 €.')
    expect(refusDuReglement('a.pdf', 'R-1', '2026-11-01', '2026-11-03')).toBe(
      "La pièce « a.pdf » est l'original de la facture reprise R-1 : ses règlements datés de la reprise des factures (le 01/11/2026) ou d'après passent par le registre de la facture, et le règlement du 03/11/2026 ne la cite pas.",
    )
    // L'essai attend chaque refus de la base à ses mots : ceux qui n'ont rien à remplir y sont tels quels.
    for (const r of [...REFUS_CITER, ...REFUS_RETIRER, ...REFUS_DU_LIEN]) {
      if (!r.modele.includes('%')) expect(ESSAI, r.cle).toContain(r.modele.replace(/'/g, "''"))
    }
  })
})
