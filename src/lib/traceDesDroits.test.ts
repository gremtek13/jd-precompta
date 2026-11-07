import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TRACE_DES_DROITS_PREVUE } from './traceDesDroits'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LA TRACE DES DROITS D'UN ACCÈS, CONFRONTÉE À LA BASE (étape P1-trace). Trois juges : le TEXTE de la migration
// `trace_des_droits`, où qu'elle soit (préparée aujourd'hui, dans l'export le jour de son application) — ce qu'elle retire,
// ses empreintes, son déclencheur et ses deux policies ; ses ESSAIS (supabase/essais/traceDesDroits.sql et
// traceDesDroitsSuppression.sql), ce que la base a répondu sur la réplique, et son RETOUR ARRIÈRE ; et le DRAPEAU, qui suit
// le fichier.

const nomDe = (chemin: string) => chemin.split('/').pop()!
const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()].filter((f) => /^\d{14}_/.test(nomDe(f.chemin)))
const MIGRATION = MIGRATIONS.find((f) => /\d{14}_trace_des_droits\.sql$/.test(f.chemin))!
const ESSAI = readFileSync(new URL('../../supabase/essais/traceDesDroits.sql', import.meta.url), 'utf8')
const SUPPRESSION = readFileSync(new URL('../../supabase/essais/traceDesDroitsSuppression.sql', import.meta.url), 'utf8')
const RETOUR = readFileSync(new URL('../../supabase/preparees/retour/20261105120100_retour_trace_des_droits.sql', import.meta.url), 'utf8')
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Le corps (`prosrc`) d'une fonction dans un texte : entre `as $$` et `$$;`, sauts de ligne compris. */
function corps(texte: string, nom: string): string {
  const debut = texte.indexOf('as $$', texte.indexOf(`create function public.${nom}(`)) + 'as $$'.length
  return texte.slice(debut, texte.indexOf('\n$$;', debut) + 1)
}

/** Le corps de la DERNIÈRE définition d'une fonction dans un texte, `create` ou `create or replace`. */
function dernierCorps(texte: string, nom: string): string {
  const debuts = [...texte.matchAll(new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'g'))]
  const debut = texte.indexOf('as $$', debuts[debuts.length - 1].index) + 'as $$'.length
  return texte.slice(debut, texte.indexOf('\n$$;', debut) + 1)
}

/** La dernière définition d'une fonction dans l'export : celle que la migration appelle. */
function corpsDansLExport(nom: string): string {
  const avec = fichiersDuSchema().filter((f) => new RegExp(`create (?:or replace )?function public\\.${nom}\\(`).test(f.texte))
  return dernierCorps(avec[avec.length - 1].texte, nom)
}

// Les deux migrations qui, après P1-trace, redéfinissent la fonction et le déclencheur de la trace (`create or replace`) :
// C4a (« Comptes »), puis B1 (« Achats », « Notes de frais », « Documents »), où qu'elles soient.
const C4A = MIGRATIONS.find((f) => /\d{14}_situations_publiees\.sql$/.test(f.chemin))
const B1 = MIGRATIONS.find((f) => /\d{14}_trois_cases_de_l_acces\.sql$/.test(f.chemin))

describe('la migration, où qu’elle soit', () => {
  it('est là une fois, préparée ou dans l’export, et le drapeau suit son fichier', () => {
    expect(MIGRATION).toBeDefined()
    expect(MIGRATIONS.filter((f) => /_trace_des_droits\.sql$/.test(f.chemin))).toHaveLength(1)
    expect(TRACE_DES_DROITS_PREVUE).toBe(fichiersDuSchema().some((f) => /\d{14}_trace_des_droits\.sql$/.test(f.chemin)))
  })

  it('ne retire rien : ni barre oblique inverse, ni retour chariot, ni drop, ni truncate, ni suppression hors des événements et de la clé', () => {
    expect(MIGRATION.texte).not.toMatch(/[\\\r]/)
    const sql = sansCommentaires(MIGRATION.texte)
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b/i)
    // Le mot n'y paraît que dans la clé du dossier, les événements des deux déclencheurs et `tg_op` (quatre fois).
    expect(sql.match(/\bdelete\b/gi)).toHaveLength(7)
    expect(sql.match(/tg_op (?:=|<>) 'DELETE'/g)).toHaveLength(4)
    expect(sql).toContain('references public.dossiers (id) on delete cascade')
  })

  it('la garde de tête relit les deux fonctions qu’elle appelle à leur empreinte dans l’export', () => {
    for (const [nom, empreinte] of [['is_super_admin', 'a9159138778422a43ba8d8c21240c9bb'], ['admin_du_dossier', '30e9b7246cb939741fe58f4ffc27adf4']]) {
      expect(MIGRATION.texte, nom).toContain(`('${nom}', 'public.${nom}(`)
      expect(MIGRATION.texte, nom).toContain(`'${empreinte}')`)
      expect(md5(corpsDansLExport(nom)), nom).toBe(empreinte)
    }
  })

  it('le déclencheur prend tout chemin, après les deux gardes de memberships, et ne trace ni la restauration ni la cascade', () => {
    expect(MIGRATION.texte).toContain('create trigger memberships_trace_des_droits\n  after insert or update of droit_ventes, droit_banque, droit_caisse, dossier_id, user_id, id or delete on public.memberships')
    // L'ordre des noms : les gardes `memberships_droit_*` d'abord.
    expect(['memberships_droit_caisse', 'memberships_droit_ventes', 'memberships_trace_des_droits'].slice().sort())
      .toEqual(['memberships_droit_caisse', 'memberships_droit_ventes', 'memberships_trace_des_droits'])
    const trace = corps(MIGRATION.texte, 'tracer_les_droits')
    expect(trace).toContain("if tg_op = 'INSERT' and public.is_super_admin() then\n    return null;")
    expect(trace).toContain("if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then\n    return null;")
    expect(trace).toContain('v_auteur uuid := auth.uid();')
    expect(trace.trimEnd().endsWith("perform set_config('jd.trace_des_droits', '', true);\n  return null;\nend")).toBe(true)
  })

  it('deux policies, à authenticated seul : la lecture du cabinet du dossier, l’insertion du super-administrateur — aucune autre', () => {
    const policies = [...MIGRATION.texte.matchAll(/create policy (\w+) on public\.trace_des_droits\n\s+(for \w+ to \w+ (?:using|with check) \(.*\));/g)]
      .map((m) => `${m[1]} ${m[2]}`)
    expect(policies).toEqual([
      'trace_des_droits_lecture for select to authenticated using (public.admin_du_dossier(dossier_id))',
      'trace_des_droits_restauration for insert to authenticated with check (public.is_super_admin())',
    ])
    expect(MIGRATION.texte.match(/create policy/g)).toHaveLength(2)
  })
})

describe('les essais et le retour arrière redisent la migration', () => {
  it('l’essai épingle les corps des deux fonctions à leur empreinte, état par état, et ne supprime rien (il se joue en production)', () => {
    expect(ESSAI).toContain(`garder_trace_des_droits false search_path=public false false false ${md5(corps(MIGRATION.texte, 'garder_trace_des_droits'))}`)
    // Le déclencheur de la trace : le rang 38 lit l'empreinte que l'état de la base désigne — chacune celle du texte qui
    // l'écrit en dernier —, l'état se reconnaissant à la colonne que C4a, puis B1, ajoutent à memberships.
    expect(C4A, 'la migration situations_publiees').toBeDefined()
    expect(B1, 'la migration trois_cases_de_l_acces').toBeDefined()
    expect(ESSAI).toContain("tracer_les_droits true search_path=public false false false ' || tracer_attendu || ' | -'")
    expect(ESSAI).toContain(`tracer_attendu constant text := case etat when 'b1' then '${md5(dernierCorps(B1!.texte, 'tracer_les_droits'))}'`
      + ` when 'c4a' then '${md5(dernierCorps(C4A!.texte, 'tracer_les_droits'))}'\n    else '${md5(corps(MIGRATION.texte, 'tracer_les_droits'))}' end;`)
    expect(ESSAI).toContain("a.attname = 'droit_documents' and not a.attisdropped) then 'b1'")
    expect(ESSAI).toContain("a.attname = 'droit_comptes' and not a.attisdropped) then 'c4a'")
    expect(B1!.texte).toContain('add column droit_documents boolean not null default false;')
    expect(C4A!.texte).toContain('add column droit_comptes boolean not null default false;')
    // Le rang 39, de même : les cases que le déclencheur nomme, dans l'ordre du texte de chaque état.
    const colonnes = {
      b1: 'droit_ventes, droit_banque, droit_caisse, droit_comptes, droit_achats, droit_frais, droit_documents',
      c4a: 'droit_ventes, droit_banque, droit_caisse, droit_comptes',
      p1: 'droit_ventes, droit_banque, droit_caisse',
    }
    expect(ESSAI).toContain(`colonnes_tracees constant text := case etat when 'b1' then '${colonnes.b1}'\n    when 'c4a' then '${colonnes.c4a}' else '${colonnes.p1}' end;`)
    expect(ESSAI).toContain("'CREATE TRIGGER memberships_trace_des_droits AFTER INSERT OR DELETE OR UPDATE OF ' || colonnes_tracees || ', dossier_id, user_id, id ON public.memberships")
    for (const [texte, liste] of [[B1!.texte, colonnes.b1], [C4A!.texte, colonnes.c4a], [MIGRATION.texte, colonnes.p1]]) {
      const declencheurs = [...texte.replace(/\s+/g, ' ').matchAll(/trigger memberships_trace_des_droits after insert or update of ([^;]*?), dossier_id, user_id, id or delete on public\.memberships/g)]
      expect(declencheurs.map((m) => m[1]), liste).toEqual([liste])
    }
    expect(sansCommentaires(ESSAI)).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\b/i)
    expect(ESSAI).toContain("'0. EN ATTENTE de la migration trace_des_droits'")
  })

  it('les refus que les essais attendent sont ceux de la garde, au mot près', () => {
    const garde = corps(MIGRATION.texte, 'garder_trace_des_droits')
    for (const mots of ["La trace des droits ne s''écrit que par l''écriture des droits d''un accès.",
      "La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier."]) {
      expect(garde, mots).toContain(`'${mots}'`)
      expect(ESSAI, mots).toContain(`'${mots}'`)
    }
    expect(SUPPRESSION).toContain("'La trace des droits ne se réécrit pas : une ligne ne part qu''avec son dossier.'")
  })

  it('l’essai des suppressions ne se joue que sur une réplique : son en-tête, et sa garde de tête', () => {
    expect(SUPPRESSION.split('\n').slice(0, 3).join(' ')).toMatch(/SUR UNE\s+(?:-- )?RÉPLIQUE SEULEMENT/)
    expect(SUPPRESSION).toContain("if not exists (select 1 from pg_roles where rolname = 'proprietaire') then\n    raise exception 'ESSAI_HORS_REPLIQUE")
  })

  it('le retour arrière épingle les mêmes corps, se refuse sous une ligne de trace, et retire ce que la migration pose', () => {
    expect(RETOUR).toContain(`is distinct from '${md5(corps(MIGRATION.texte, 'tracer_les_droits'))}'`)
    expect(RETOUR).toContain(`is distinct from '${md5(corps(MIGRATION.texte, 'garder_trace_des_droits'))}'`)
    expect(RETOUR).toContain('if v_lignes > 0 then')
    expect(sansCommentaires(RETOUR).match(/^drop .*;$/gm)).toEqual([
      'drop trigger memberships_trace_des_droits on public.memberships;',
      'drop table public.trace_des_droits;',
      'drop function public.tracer_les_droits();',
      'drop function public.garder_trace_des_droits();',
    ])
    expect(RETOUR).not.toMatch(/[\\\r]/)
  })
})
