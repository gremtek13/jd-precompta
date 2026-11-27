import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MOTS_DE_LA_REGLE_DU_DOSSIER, sansLaRegleDuDossier } from '../test/essaiSql'
import { definitionsSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'

// NI UNE PIÈCE NI UN DOCUMENT NE CHANGE DE DOSSIER (SECU4-Q2 (B), décision du cabinet du 27/11/2026). La migration préparée
// (supabase/preparees/20261127230000_ni_piece_ni_document_ne_change_de_dossier.sql) confrontée à son texte : une garde qui ne
// lit rien, aux droits de l'appelant ; deux déclencheurs BEFORE UPDATE sans liste de colonnes, sous la condition que le dossier
// change ; leur rang, le DERNIER des déclencheurs BEFORE de leur table, dans l'export comme dans les migrations préparées ; son
// retour ; son essai ; et les essais d'hier dont le contrôle positif « une pièce que rien ne cite change de dossier » admet,
// la règle en base, son refus sous ses mots — et seulement eux.

const PREPAREE = readFileSync('supabase/preparees/20261127230000_ni_piece_ni_document_ne_change_de_dossier.sql', 'utf8')
const RETOUR = readFileSync('supabase/preparees/retour/20261127230100_retour_ni_piece_ni_document_ne_change_de_dossier.sql', 'utf8')
const ESSAI = readFileSync('supabase/essais/niPieceNiDocumentNeChangeDeDossier.sql', 'utf8')
const PIECE_RESTE = 'Une pièce reste dans le dossier où elle a été déposée : elle ne change pas de dossier.'
const DOCUMENT_RESTE = 'Un document reste dans le dossier où il a été déposé : il ne change pas de dossier.'
const NOMS = { pieces: 'pieces_vers_un_autre_dossier', documents_divers: 'documents_divers_vers_un_autre_dossier' } as const

describe('la garde du dossier d’une pièce ou d’un document, à son texte (SECU4-Q2)', () => {
  const [{ definition }] = definitionsSql('garder_dossier_de_depot', [{ chemin: 'la préparée', texte: PREPAREE }])

  it('elle ne lit rien et refuse sous les mots de sa table : aux droits de l’appelant, son chemin à vide', () => {
    expect(definition).toMatch(/^create function public\.garder_dossier_de_depot\(\) returns trigger\nlanguage plpgsql\nset search_path = ''\nas \$\$/i)
    expect(definition).not.toMatch(/security definer/i)
    expect(definition).not.toMatch(/\b(select|from|perform)\b/i)
    expect(definition).toContain(`raise exception '${PIECE_RESTE}' using errcode = '23514';`)
    expect(definition).toContain(`raise exception '${DOCUMENT_RESTE}' using errcode = '23514';`)
    expect(PREPAREE).toContain('revoke all on function public.garder_dossier_de_depot() from public, anon, authenticated, service_role;')
  })

  it('sa garde de fin et son retour attendent l’empreinte de son corps', () => {
    const ouverture = /\$(\w*)\$/.exec(definition) as RegExpExecArray
    const empreinte = createHash('md5').update(definition.slice(ouverture.index + ouverture[0].length)).digest('hex')
    expect(PREPAREE).toContain(`is distinct from '${empreinte}'`)
    expect(RETOUR).toContain(`is distinct from '${empreinte}'`)
  })

  it('ses deux déclencheurs : BEFORE UPDATE par ligne, SANS liste de colonnes, sous la condition que le dossier change', () => {
    for (const [table, nom] of Object.entries(NOMS)) {
      expect(PREPAREE, table).toMatch(new RegExp(`create trigger ${nom}\\n {2}before update on public\\.${table}\\n`
        + ' {2}for each row when \\(old\\.dossier_id is distinct from new\\.dossier_id\\)\\n {2}execute function public\\.garder_dossier_de_depot\\(\\);', 'i'))
    }
    expect(PREPAREE).not.toMatch(/before update of dossier_id on public\.(pieces|documents_divers)/i)
  })

  it('par l’outil : ni retrait, ni vidage, ni barre oblique inverse ; aucune fonction remplacée', () => {
    expect(PREPAREE).not.toMatch(/\b(drop|delete|truncate)\b/i)
    expect(PREPAREE).not.toContain('\\')
    expect(PREPAREE).not.toMatch(/create or replace/i)
  })
})

describe('le rang : le dernier des déclencheurs BEFORE de sa table, dans l’export et dans les migrations préparées', () => {
  // Tout déclencheur BEFORE posé sur `pieces` ou `documents_divers`, par une migration rangée ou préparée : son nom se range avant
  // celui de la garde du dossier (ils tirent dans l'ordre de leurs noms, octet par octet). Une garde relation par relation dit
  // ainsi ce qui cite la pièce, avant la règle générale ; et la condition de celle-ci juge la ligne telle qu'elle s'écrira.
  const poses = [...fichiersDuSchema(), ...fichiersPrepares()].flatMap(({ chemin, texte }) =>
    [...texte.matchAll(/create\s+(?:or\s+replace\s+)?trigger\s+(\w+)\s+before\s+[^;]*?\son\s+(?:public\.)?(\w+)\s/gi)]
      .map((m) => ({ chemin, nom: m[1], table: m[2] })))

  it('le plancher : les gardes d’hier se lisent (celles du sous-dossier, de la source citée, de l’écriture libre)', () => {
    const noms = poses.map((p) => p.nom)
    for (const n of ['pieces_au_sous_dossier_de_leur_dossier', 'pieces_citees_en_revision', 'documents_divers_cites_en_revision',
      'pieces_vente_d_un_dossier_bascule', 'pieces_justificatif_d_une_note_de_frais']) expect(noms, n).toContain(n)
    expect(poses.filter((p) => p.table === 'pieces').length).toBeGreaterThanOrEqual(15)
  })

  it('aucun ne se range après la garde du dossier', () => {
    const apres = poses.filter((p) => (p.table === 'pieces' || p.table === 'documents_divers')
      && p.nom !== NOMS[p.table] && p.nom > NOMS[p.table])
    expect(apres).toEqual([])
  })
})

describe('le retour et l’essai', () => {
  it('le retour retire les deux déclencheurs et la fonction, rien d’autre', () => {
    expect(RETOUR).toMatch(/drop trigger documents_divers_vers_un_autre_dossier on public\.documents_divers;/i)
    expect(RETOUR).toMatch(/drop trigger pieces_vers_un_autre_dossier on public\.pieces;/i)
    expect(RETOUR).toMatch(/drop function public\.garder_dossier_de_depot\(\);/i)
    expect(RETOUR.match(/^drop /gim)).toHaveLength(3)
  })

  it('l’essai : EN ATTENTE sans la migration, les deux refus, et aucune instruction de suppression', () => {
    expect(ESSAI).toContain("appliquee constant boolean := to_regprocedure('public.garder_dossier_de_depot()') is not null;")
    expect(ESSAI).toContain('EN ATTENTE de la migration ni_piece_ni_document_ne_change_de_dossier (SECU4-Q2)')
    expect(ESSAI).toContain(`'${PIECE_RESTE}'`)
    expect(ESSAI).toContain(`'${DOCUMENT_RESTE}'`)
    expect(ESSAI).not.toMatch(/delete from/i)
  })

  it('les essais d’hier : chaque contrôle positif qui change le dossier d’une pièce ou d’un document admet ses mots', () => {
    // Les fichiers et les mots qu'ils admettent, la règle en base : la garde de leur relation tire avant, et ses propres mots
    // les feraient virer au rouge dans les deux états.
    const essais: [string, string[]][] = [
      ['caisse', [PIECE_RESTE]], ['dossierPermanent', [PIECE_RESTE]], ['exemplairesDesFactures', [PIECE_RESTE]],
      ['pieceDUnPaiementDansSonDossier', [PIECE_RESTE]], ['pieceDUneEcritureLibreDansSonDossier', [PIECE_RESTE]],
      ['piecesHorsDeFrance', [PIECE_RESTE]], ['regimesEreporting', [PIECE_RESTE]], ['revisionSoldes', [PIECE_RESTE]],
      ['sousDossierDansSonDossier', [PIECE_RESTE, DOCUMENT_RESTE]],
    ]
    for (const [nom, mots] of essais) {
      const texte = readFileSync(`supabase/essais/${nom}.sql`, 'utf8')
      for (const m of mots) expect(texte, nom).toContain(m)
      expect(texte, nom).toMatch(/SECU4-Q2/)
    }
  })

  it('les huit blocs des moteurs d’étapes : chacun n’admet que les mots de la règle, et le rejeu en lit l’instruction seule', () => {
    expect(MOTS_DE_LA_REGLE_DU_DOSSIER).toEqual([PIECE_RESTE, DOCUMENT_RESTE])
    const blocs = (texte: string) => (texte.match(/do \$x\$ begin update (?:pieces|documents_divers) set dossier_id/g) ?? []).length
    const parEssai = Object.fromEntries(['caisse', 'dossierPermanent', 'exemplairesDesFactures', 'piecesHorsDeFrance', 'regimesEreporting',
      'revisionSoldes'].map((nom) => {
      const texte = readFileSync(`supabase/essais/${nom}.sql`, 'utf8')
      // Déballés, il n'en reste aucun : chacun a la forme que le rejeu sait lire, et n'admet que les mots de la règle.
      expect(blocs(sansLaRegleDuDossier(texte)), nom).toBe(0)
      return [nom, blocs(texte)]
    }))
    expect(parEssai).toEqual({ caisse: 1, dossierPermanent: 1, exemplairesDesFactures: 3, piecesHorsDeFrance: 1, regimesEreporting: 1, revisionSoldes: 1 })
    const bloc = (mots: string) => `do $x$ begin update pieces set dossier_id = '{A}' where id = '{P}';\n      exception when check_violation then\n`
      + `        if sqlerrm <> '${mots}' then raise; end if;\n      end $x$`
    expect(sansLaRegleDuDossier(`select 1; ${bloc(PIECE_RESTE)}`)).toBe("select 1; update pieces set dossier_id = '{A}' where id = '{P}'")
    expect(() => sansLaRegleDuDossier(bloc('Cette pièce est citée : elle ne change pas de dossier.'))).toThrow(/d'autres mots/)
  })
})
