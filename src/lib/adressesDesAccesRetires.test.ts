import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADRESSES_DES_ACCES_RETIRES_PREVUES, TABLES_DES_ADRESSES_DES_ACCES_RETIRES, adressesDeLaLecture,
} from './adressesDesAccesRetires'
import type { AdresseDUnAccesRetire } from './types'
import { fichiersDuSchema, fichiersPrepares, indiceSql } from '../test/schema'

// L'ADRESSE D'UN ACCÈS RETIRÉ, CONFRONTÉE À SA MIGRATION (P1T-E2). Trois juges : le TEXTE de la migration
// `adresse_des_acces_retires`, où qu'elle soit (préparée, puis dans l'export) — ce qu'elle retire, son déclencheur rangé
// après celui de la trace, ses refus ; ses ESSAIS et son RETOUR, qui épinglent les mêmes empreintes et les mêmes mots ; et
// le DRAPEAU, qui suit le fichier. Puis la règle pure qui juge une lecture.

const nomDe = (chemin: string) => chemin.split('/').pop()!
const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()].filter((f) => /^\d{14}_/.test(nomDe(f.chemin)))
const MIGRATION = MIGRATIONS.find((f) => /\d{14}_adresse_des_acces_retires\.sql$/.test(f.chemin))!
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const ESSAI = lire('supabase/essais/adresseDesAccesRetires.sql')
const SUPPRESSION = lire('supabase/essais/adresseDesAccesRetiresSuppression.sql')
const RETOUR = lire('supabase/preparees/retour/20261111173100_retour_adresse_des_acces_retires.sql')
const RLS = lire('supabase/essais/rls.sql')
const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
const sansCommentaires = (texte: string) => texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Le corps (`prosrc`) d'une fonction dans un texte : entre `as $$` et `$$;`, sauts de ligne compris. */
function corps(texte: string, nom: string): string {
  const debut = texte.indexOf('as $$', indiceSql(texte, `create function public.${nom}(`)) + 'as $$'.length
  return texte.slice(debut, texte.indexOf('\n$$;', debut) + 1)
}

const REFUS_ECRITURE = 'L\'\'adresse d\'\'un accès retiré ne s\'\'écrit que par le retrait de l\'\'accès.'
const REFUS_REECRITURE = 'L\'\'adresse d\'\'un accès retiré ne se réécrit pas : elle ne part qu\'\'avec son dossier.'

describe('la migration, où qu’elle soit', () => {
  it('est là une fois, préparée ou dans l’export, et le drapeau suit son fichier', () => {
    expect(MIGRATION).toBeDefined()
    expect(MIGRATIONS.filter((f) => /_adresse_des_acces_retires\.sql$/.test(f.chemin))).toHaveLength(1)
    expect(ADRESSES_DES_ACCES_RETIRES_PREVUES).toBe(fichiersDuSchema().some((f) => /\d{14}_adresse_des_acces_retires\.sql$/.test(f.chemin)))
    expect(TABLES_DES_ADRESSES_DES_ACCES_RETIRES).toEqual(['adresses_des_acces_retires'])
  })

  it('ne retire rien : ni barre oblique inverse, ni retour chariot, ni drop, ni truncate, ni suppression hors des événements et de la clé', () => {
    expect(MIGRATION.texte).not.toMatch(/[\\\r]/)
    const sql = sansCommentaires(MIGRATION.texte)
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\bdelete\s+from\b/i)
    // Le mot n'y paraît que dans la clé du dossier, les événements des deux déclencheurs et `tg_op` (une fois).
    expect(sql.match(/\bdelete\b/gi)).toHaveLength(4)
    expect(sql.match(/tg_op = 'DELETE'/g)).toHaveLength(1)
    expect(sql).toContain('references public.dossiers (id) on delete cascade')
  })

  it('se range après la trace des droits, qu’elle exige, et ne retient que le départ d’un accès que la trace nomme, son dossier encore là', () => {
    expect(MIGRATION.texte).toContain('create trigger memberships_trace_des_droits_adresse\n  after update of dossier_id, id or delete on public.memberships')
    // L'ordre des noms des déclencheurs APRÈS d'un même événement : celui de la trace d'abord.
    expect(['memberships_trace_des_droits_adresse', 'memberships_trace_des_droits'].sort()[0]).toBe('memberships_trace_des_droits')
    const retenir = corps(MIGRATION.texte, 'retenir_l_adresse_d_un_acces_retire')
    expect(retenir).toContain('if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then\n    return null;')
    expect(retenir).toContain("if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id then\n    return null;")
    expect(retenir).toContain('select 1 from public.trace_des_droits t where t.dossier_id = old.dossier_id and t.acces_id = old.id')
    // Le déclencheur n'écrit jamais ce que la contrainte refuserait : un départ ne se refuse pas pour son adresse.
    expect(retenir).toContain("old.email is null or btrim(old.email) = ''")
    expect(MIGRATION.texte).toContain("constraint adresses_des_acces_retires_adresse check (btrim(adresse) <> '')")
    expect(retenir.trimEnd().endsWith("perform set_config('jd.adresse_d_un_acces_retire', '', true);\n  return null;\nend")).toBe(true)
  })

  it('la lecture du cabinet du dossier, l’insertion du super-administrateur, et rien d’autre ; la double authentification posée si elle est en base', () => {
    expect(MIGRATION.texte).toContain('for select to authenticated using (public.admin_du_dossier(dossier_id));')
    expect(MIGRATION.texte).toContain('for insert to authenticated with check (public.is_super_admin());')
    expect(sansCommentaires(MIGRATION.texte).match(/create policy /gi)).toHaveLength(3)
    expect(MIGRATION.texte).toContain("if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then")
  })
})

describe('ses essais, son retour et le bloc AR de rls.sql disent la même chose', () => {
  const empreintes = {
    garder_adresses_des_acces_retires: md5(corps(MIGRATION.texte, 'garder_adresses_des_acces_retires')),
    retenir_l_adresse_d_un_acces_retire: md5(corps(MIGRATION.texte, 'retenir_l_adresse_d_un_acces_retire')),
  }

  it('l’essai et le retour épinglent les corps des deux fonctions à leur empreinte dans la migration', () => {
    for (const [nom, empreinte] of Object.entries(empreintes)) {
      expect(ESSAI, nom).toContain(`${nom} ${nom === 'garder_adresses_des_acces_retires' ? 'false' : 'true'} search_path=public false false false ${empreinte}`)
      expect(RETOUR, nom).toContain(`'${empreinte}'`)
    }
  })

  it('les refus de la garde sont ceux que les essais et rls.sql attendent', () => {
    expect(MIGRATION.texte).toContain(`'${REFUS_ECRITURE}' using errcode = '42501'`)
    expect(MIGRATION.texte).toContain(`'${REFUS_REECRITURE}' using errcode = '23514'`)
    expect(ESSAI).toContain(`refus_garde constant text := '${REFUS_ECRITURE}'`)
    expect(ESSAI).toContain(`refus_reecriture constant text := '${REFUS_REECRITURE}'`)
    expect(SUPPRESSION).toContain(`refus_reecriture constant text := '${REFUS_REECRITURE}'`)
    expect(RLS).toContain(`ecrite = '42501 ${REFUS_ECRITURE}'`)
  })

  it('les essais attendent sans la migration, la suppression ne se joue que sur une réplique, et le retour se refuse sous une ligne', () => {
    for (const essai of [ESSAI, SUPPRESSION]) expect(essai).toContain("if to_regclass('public.adresses_des_acces_retires') is null then")
    expect(SUPPRESSION).toContain("if not exists (select 1 from pg_roles where rolname = 'proprietaire') then")
    expect(ESSAI).not.toMatch(/\bdelete\s+from\b/i)
    expect(RETOUR).toContain('if v_lignes > 0 then')
    expect(RLS).toContain("insert into rls_verdict values ('AR. l''adresse d''un accès retiré : EN ATTENTE de la migration adresse_des_acces_retires',")
  })
})

describe('adressesDeLaLecture — la lecture jugée', () => {
  const ligne = (p: Partial<AdresseDUnAccesRetire>): AdresseDUnAccesRetire => ({
    id: 'r1', dossier_id: 'd1', acces_id: 'm1', adresse: 'client@exemple.fr', retire_le: '2026-11-10T08:30:00Z', ...p,
  })

  it('garde, par accès, le départ le plus récent', () => {
    const lues = adressesDeLaLecture({ complete: true, motif: null, lignes: [
      ligne({ id: 'r1', adresse: 'ancien@exemple.fr', retire_le: '2026-11-01T08:00:00Z' }),
      ligne({ id: 'r2', adresse: 'recent@exemple.fr', retire_le: '2026-11-09T08:00:00Z' }),
      ligne({ id: 'r3', acces_id: 'm2', adresse: 'autre@exemple.fr' }),
    ] })
    expect(lues.motif).toBeNull()
    expect([...lues.parAcces.entries()]).toEqual([
      ['m1', { adresse: 'recent@exemple.fr', retireLe: '2026-11-09T08:00:00Z' }],
      ['m2', { adresse: 'autre@exemple.fr', retireLe: '2026-11-10T08:30:00Z' }],
    ])
  })

  it('une lecture partielle ou une ligne illisible se disent, les adresses lues restant vraies', () => {
    const partielle = adressesDeLaLecture({ complete: false, motif: '1 ligne sur 2', lignes: [ligne({})] })
    expect(partielle.motif).toBe('1 ligne sur 2')
    expect(partielle.parAcces.get('m1')?.adresse).toBe('client@exemple.fr')
    const illisibles = adressesDeLaLecture({ complete: true, motif: null, lignes: [
      ligne({ id: 'a', adresse: '  ' }), ligne({ id: 'b', retire_le: 'hier' }), ligne({ id: 'c', acces_id: '' }), ligne({ id: 'd', acces_id: 'm9' }),
    ] })
    expect(illisibles.motif).toBe('3 ligne(s) portent une adresse ou une date que cet écran ne lit pas')
    expect([...illisibles.parAcces.keys()]).toEqual(['m9'])
  })
})
