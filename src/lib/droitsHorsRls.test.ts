import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LES DROITS QUI NE PASSENT PAS PAR LA RLS (relecture de sécurité du 06/11/2026 ; migration `droits_hors_rls`, collée par
// le cabinet le 07/11/2026 sous la version 20261107122909, DHR-Q1 (A), et depuis dans l'export). Le relevé du
// 06/11/2026 : `anon` et `authenticated` portaient, sur les 85 tables de public et dans les droits par défaut du
// propriétaire, TRUNCATE, REFERENCES, TRIGGER et MAINTAIN — quatre droits que ni la
// RLS ni les déclencheurs de ligne ne gardent (MAINTAIN, qu'information_schema tait, compris). La migration les retire, et
// rien d'autre. Ce garde la confronte à la décision : ses deux instructions exactes entre ses deux gardes, les conditions
// qui la refusent sur une autre base que celle du relevé, l'empreinte du reste lue de la même façon partout ; son retour,
// l'inverse exact ; le bloc HR de supabase/essais/rls.sql (contrôles, mutations, EN ATTENTE) ; l'essai de réplique
// supabase/essais/droitsHorsRls.sql, qui tente chaque geste. Les essais se jouent sur la base ; la CI n'en a pas. Données
// FICTIVES.

const RACINE = resolve(process.cwd())
const lire = (chemin: string) => readFileSync(resolve(RACINE, chemin), 'utf8')

const MIGRATION = 'supabase/schema/20261107122909_droits_hors_rls.sql'
const RETOUR = 'supabase/preparees/retour/20261106180100_retour_droits_hors_rls.sql'
const ESSAI = 'supabase/essais/droitsHorsRls.sql'

const RETRAIT = 'revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;'
const DEFAUT_RETIRE = 'alter default privileges in schema public revoke truncate, trigger, references, maintain on tables from anon, authenticated;'
const RENDU = 'grant truncate, trigger, references, maintain on all tables in schema public to anon, authenticated;'
const DEFAUT_RENDU = 'alter default privileges in schema public grant truncate, trigger, references, maintain on tables to anon, authenticated;'

/** Le texte sans ses lignes de commentaire (une ligne entièrement en commentaire, jamais un `--` de fin de ligne). */
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Les blocs `do $garde$ … $garde$;` du texte, dans l'ordre, et ce qui reste hors d'eux. */
function gardes(texte: string): { blocs: string[]; dehors: string } {
  const trouves: string[] = []
  let dehors = ''
  let i = 0
  for (;;) {
    const debut = texte.indexOf('do $garde$', i)
    if (debut < 0) break
    const fin = texte.indexOf('$garde$;', debut + 'do $garde$'.length)
    dehors += texte.slice(i, debut)
    trouves.push(texte.slice(debut, fin + '$garde$;'.length))
    i = fin + '$garde$;'.length
  }
  return { blocs: trouves, dehors: dehors + texte.slice(i) }
}

/** Le texte sans ses littéraux entre apostrophes (les noms de privilèges, les messages) : ce que le code EXÉCUTE. */
const sansChaines = (texte: string) => texte.replace(/'(?:[^']|'')*'/g, "''")

/** Les instructions hors des gardes, chacune ramenée à une ligne. */
const instructions = (dehors: string) =>
  dehors.split(';').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).map((s) => `${s};`)

/** La lecture de l'empreinte du reste, telle qu'une garde l'écrit. */
function lectureDuReste(bloc: string): string {
  const debut = bloc.indexOf('select md5(coalesce(string_agg(l.s')
  const fin = bloc.indexOf(') l;', debut)
  return debut < 0 || fin < 0 ? '' : bloc.slice(debut, fin + ') l;'.length)
}

const texteMigration = lire(MIGRATION)
const texteRetour = lire(RETOUR)

describe('la migration droits_hors_rls', () => {
  it('est dans l’export, une fois, sous la version de sa ligne d’historique (collée le 07/11/2026), et plus dans les préparées', () => {
    expect(fichiersDuSchema().map((f) => f.chemin).filter((c) => /_droits_hors_rls\.sql$/.test(c))).toEqual([MIGRATION])
    expect(fichiersPrepares().map((f) => f.chemin).filter((c) => /_droits_hors_rls\.sql$/.test(c))).toEqual([])
  })

  it('n’exécute que ses deux instructions, entre ses deux gardes', () => {
    const code = sansCommentaires(texteMigration)
    const { blocs, dehors } = gardes(code)
    expect(instructions(dehors)).toEqual([RETRAIT, DEFAUT_RETIRE])
    expect(blocs).toHaveLength(2)
    expect(code.indexOf(blocs[0])).toBeLessThan(code.indexOf(RETRAIT))
    expect(code.indexOf(blocs[1])).toBeGreaterThan(code.indexOf(DEFAUT_RETIRE))
  })

  it('sa garde de tête exige le propriétaire, aucun autre chemin, l’état relevé uniforme, et pose l’empreinte du reste', () => {
    const [tete] = gardes(sansCommentaires(texteMigration)).blocs
    for (const condition of [
      // (a) Toute relation de public au rôle courant, et au moins une.
      "v_moi oid := (select r.oid from pg_roles r where r.rolname = current_user);",
      'filter (where c.relowner <> v_moi)',
      'if v_relations = 0 then',
      // (b) Aucune appartenance, rien à PUBLIC (tables et colonnes).
      "where m.member in (to_regrole('anon'), to_regrole('authenticated'));",
      "(exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)",
      'where att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped and a.grantee = 0));',
      // (c) Chacun des quatre, à chacun des deux, de la main du propriétaire, non transmissible ; aucun autre donneur.
      "cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) p(p)",
      'and a.grantor = c.relowner and not a.is_grantable);',
      'and (a.grantor <> c.relowner or a.is_grantable);',
      // (d) Aucun REFERENCES par colonne.
      "and a.grantee in (to_regrole('anon'), to_regrole('authenticated')) and a.privilege_type = 'REFERENCES';",
      // (e) Le défaut du rôle courant dans public les donne ; aucune entrée globale hors du DML.
      "where d.defaclrole = v_moi and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'",
      "where d.defaclrole = v_moi and d.defaclnamespace = 0 and d.defaclobjtype = 'r'",
      // (f) L'empreinte du reste, passée à la garde de fin par un réglage local à la transaction.
      "perform set_config('droits_hors_rls.reste', v_reste, true);",
    ]) expect(tete, condition).toContain(condition)
    expect(tete.match(/raise exception/g)).toHaveLength(10)
  })

  it('sa garde de fin : plus rien hors du DML, à l’ACL comme par tout chemin, aux colonnes, au défaut, et le reste intact', () => {
    const [, fin] = gardes(sansCommentaires(texteMigration)).blocs
    for (const condition of [
      // La liste des privilèges d'une relation, lue au serveur, et qui compte au moins les quatre.
      "from aclexplode(acldefault('r', to_regrole('anon'))) d",
      // La liste BLANCHE des relations, tout donneur, PUBLIC compris.
      "and (a.grantee = 0 or a.grantee in (to_regrole('anon'), to_regrole('authenticated')))\n     and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');",
      // Tout chemin.
      'and has_table_privilege(r.n, c.oid, p.privilege_type);',
      "and has_any_column_privilege(r.n, c.oid, 'REFERENCES');",
      // Les colonnes.
      "and a.privilege_type not in ('SELECT', 'INSERT', 'UPDATE');",
      // Le défaut : le DML seul, et le DML toujours.
      "where d.defaclrole = v_moi and d.defaclnamespace in (0, 'public'::regnamespace) and d.defaclobjtype = 'r'",
      "cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(p)",
      // Le reste.
      "if v_reste is distinct from current_setting('droits_hors_rls.reste', true) then",
    ]) expect(fin, condition).toContain(condition)
    expect(fin.match(/raise exception/g)).toHaveLength(8)
  })

  it('l’empreinte du reste se lit de la même façon aux quatre gardes, et n’écarte que les quatre droits d’anon et d’authenticated', () => {
    const lectures = [...gardes(sansCommentaires(texteMigration)).blocs, ...gardes(sansCommentaires(texteRetour)).blocs]
      .map(lectureDuReste)
    expect(lectures).toHaveLength(4)
    expect(lectures[0]).not.toBe('')
    expect(new Set(lectures).size).toBe(1)
    // Ce qu'elle écarte : les quatre droits des deux rôles sur les relations, et dans l'entrée du rôle courant pour les tables
    // de public — deux fois la même exclusion, rien d'autre.
    expect(lectures[0].match(/and not \(/g)).toHaveLength(2)
    expect(lectures[0].match(/and a\.privilege_type in \('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'\)\)/g)).toHaveLength(2)
    expect(lectures[0]).toContain("where d.defaclnamespace in (0, 'public'::regnamespace)")
  })

  it('ne nomme aucun rôle en dur, ne crée rien, et passe par le collage du cabinet', () => {
    const code = sansCommentaires(texteMigration)
    expect(code).not.toMatch(/\bfor role\b/i)
    expect(code).not.toContain("'postgres'")
    const execute = sansChaines(code)
    for (const motif of [/\bcreate\b/i, /\btemp(orary)?\b/i, /\binsert\b/i, /\bupdate\s+\w+(\.\w+)?\s+set\b/i, /\bpolicy\b/i]) {
      expect(execute, String(motif)).not.toMatch(motif)
    }
    expect(execute.match(/\b(grant|revoke)\b/gi)).toHaveLength(2)
    expect(texteMigration).toContain('Le cabinet la colle donc dans l\'éditeur SQL de Supabase, dans une transaction, avec sa ligne d\'historique')
    for (const texte of [texteMigration, texteRetour]) {
      expect(texte).not.toContain('\\')
      expect(texte).not.toContain('\r')
    }
  })
})

describe('son retour', () => {
  it('rend les quatre droits et le défaut, entre ses deux gardes : l’inverse exact', () => {
    const code = sansCommentaires(texteRetour)
    const { blocs, dehors } = gardes(code)
    expect(instructions(dehors)).toEqual([RENDU, DEFAUT_RENDU])
    expect(RENDU).toBe(RETRAIT.replace('revoke', 'grant').replace(' from ', ' to '))
    expect(DEFAUT_RENDU).toBe(DEFAUT_RETIRE.replace('revoke', 'grant').replace(' from ', ' to '))
    expect(blocs).toHaveLength(2)
    expect(code.indexOf(blocs[0])).toBeLessThan(code.indexOf(RENDU))
    expect(code.indexOf(blocs[1])).toBeGreaterThan(code.indexOf(DEFAUT_RENDU))
  })

  it('exige l’état d’après la migration, puis rend l’état relevé, uniforme, le reste intact', () => {
    const [tete, fin] = gardes(sansCommentaires(texteRetour)).blocs
    expect(tete).toContain("or has_table_privilege(r.n, c.oid, 'TRIGGER') or has_table_privilege(r.n, c.oid, 'MAINTAIN')")
    expect(tete).toContain("n''est pas en base, ou ce retour est déjà fait")
    expect(tete).toContain("perform set_config('retour_droits_hors_rls.reste', v_reste, true);")
    expect(fin).toContain('and a.grantor = c.relowner and not a.is_grantable);')
    expect(fin).toContain("if v_reste is distinct from current_setting('retour_droits_hors_rls.reste', true) then")
    // Ce qu'il dit d'une table créée après la migration, et de ce qu'il demande au cabinet.
    expect(texteRetour).toContain('Une table créée APRÈS la migration les reçoit aussi')
    expect(texteRetour).toContain('UN ÉLARGISSEMENT, À ACCORDER PAR LE CABINET')
  })
})

// ── L'essai des policies (rls.sql, bloc HR) ─────────────────────────────────────────────────────────────────────────

const RLS = lire('supabase/essais/rls.sql')
const BLOC_HR = (() => {
  const debut = RLS.indexOf('-- ══ HR. Les droits hors de la RLS')
  return debut < 0 ? '' : RLS.slice(debut, RLS.indexOf('end $$;', debut) + 'end $$;'.length)
})()

describe('l’essai des policies (rls.sql, bloc HR)', () => {
  it('se dit dans l’en-tête et vient avant le verdict', () => {
    expect(RLS).toContain('--   7. Les droits qui ne passent pas par la RLS (bloc HR, migration `droits_hors_rls`)')
    expect(BLOC_HR).not.toBe('')
    expect(RLS.indexOf(BLOC_HR)).toBeLessThan(RLS.indexOf("select 'INVARIANTS' as tableau"))
  })

  it('attend la migration tant que l’historique ne la porte pas ET que l’état est celui d’avant', () => {
    expect(BLOC_HR).toContain("select max(version) filter (where name = 'droits_hors_rls'), max(version) filter (where name = 'retour_droits_hors_rls')")
    expect(BLOC_HR).toContain('if (applique is null or (retour is not null and retour > applique))')
    expect(BLOC_HR).toContain('and not has_table_privilege(r.n, c.oid, p.privilege_type)) then')
    expect(BLOC_HR).toContain("'HR. les droits hors de la RLS : EN ATTENTE de la migration droits_hors_rls'")
  })

  it('juge les tables, les colonnes, les défauts, les appartenances et le contrôle positif, sous un plancher', () => {
    for (const controle of ['HR1. ', 'HR2. ', 'HR3. ', 'HR4. ', 'HR5. ']) expect(BLOC_HR).toContain(`insert into rls_verdict values ('${controle}`)
    // La boucle part du catalogue : une relation créée demain y entre d'elle-même.
    expect(BLOC_HR).toContain("where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')\n              order by c.relname collate \"C\" loop")
    expect(BLOC_HR).toContain("case when examinees >= 85 then 'plancher atteint' else 'sous le plancher' end, examinees >= 85);")
    expect(BLOC_HR).toContain('where has_table_privilege(r.n, $1, p.privilege_type)) l$q$;')
    expect(BLOC_HR).toContain("where has_any_column_privilege(r.n, $1, 'REFERENCES')) l$q$;")
    expect(BLOC_HR).toContain("where not has_any_column_privilege(r.n, $1, 'UPDATE')")
  })

  it('six mutations, chacune un GRANT ou un REVOKE annulé, ou une lecture rejouée sur un rôle membre', () => {
    for (const mutation of ['M-HR1', 'M-HR2', 'M-HR3', 'M-HR4', 'M-HR5', 'M-HR6']) {
      expect(BLOC_HR).toContain(`jsonb_build_object('mutation', '${mutation} — `)
    }
    for (const geste of [
      'grant maintain on table public.cabinet_admins to authenticated;',
      'grant trigger on table public.cabinet_admins to public;',
      'grant references (user_id) on table public.cabinet_admins to anon;',
      "execute format('alter default privileges for role %I in schema public grant trigger on tables to anon', pg_get_userbyid(proprietaire));",
      'revoke select on table public.cabinet_admins from authenticated;',
      "execute q_membres into obs using array['pg_monitor'];",
    ]) expect(BLOC_HR).toContain(geste)
    expect(BLOC_HR.match(/raise exception 'ANNULATION_ESSAI';/g)).toHaveLength(5)
  })

  it('rls.sql, joué en production, ne porte aucune instruction qui vide une table', () => {
    expect(sansCommentaires(RLS)).not.toMatch(/\btruncate\b/i)
  })
})

// ── L'essai de réplique : la preuve par le geste ─────────────────────────────────────────────────────────────────────

const ESSAI_TEXTE = lire(ESSAI)

describe('l’essai de réplique droitsHorsRls.sql', () => {
  it('se dit de réplique seulement dans le premier paragraphe de son en-tête, et s’y garde', () => {
    const premier: string[] = []
    for (const ligne of ESSAI_TEXTE.split('\n')) {
      const s = ligne.trim()
      if (!s.startsWith('--') || !s.slice(2).trim()) break
      premier.push(s.slice(2).trim())
    }
    expect(premier.join(' ')).toContain('SUR UNE RÉPLIQUE SEULEMENT')
    expect(ESSAI_TEXTE).toContain("if not exists (select 1 from pg_roles where rolname = 'proprietaire') then\n    raise exception 'ESSAI_HORS_REPLIQUE")
    expect(ESSAI_TEXTE).toContain("raise exception 'ESSAI_IMPOSSIBLE")
  })

  it('tente les quatre gestes, sous anon et authenticated (refusés à leur raison) et sous service_role et le propriétaire', () => {
    for (const geste of [
      "'vider', format('truncate table public.%I', rel.nom)",
      "'declencheur', format('create trigger essai_droits_hors_rls before insert on public.%I for each row execute function %I.declencheur()', rel.nom, decor)",
      "format('create table %I.reference (%s, foreign key (%s) references public.%I (%s))', decor, colonnes, cles, rel.nom, visees)",
      "'maintenance', format('reindex table public.%I', rel.nom)",
    ]) expect(ESSAI_TEXTE).toContain(geste)
    expect(ESSAI_TEXTE).toContain("ok := not accepte and code = '42501' and message = 'permission denied for table ' || rel.nom;")
    expect(ESSAI_TEXTE).toContain("ok := accepte or (g = 'vider' and code = '0A000');")
    for (const profil of ["'anon', '{\"role\":\"anon\"}', true", "'authenticated',\n", "'service_role', '{\"role\":\"service_role\"}', false", "null, '', false"]) {
      expect(ESSAI_TEXTE).toContain(profil)
    }
    // La mutation qui mord après la migration, et rien qui reste.
    expect(ESSAI_TEXTE).toContain('grant truncate, trigger, references, maintain on table public.cabinet_admins to anon;')
    expect(ESSAI_TEXTE).toContain("raise exception 'ANNULATION_ESSAI_GLOBALE';")
    expect(ESSAI_TEXTE).toContain('and apres = avant,')
  })
})
