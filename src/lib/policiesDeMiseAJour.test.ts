import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import { controleDeLaLigneProposee, policiesDuSchema, tablesRelues, vautPour, type ReleveDesPolicies } from '../test/policiesDuSchema'

// LA MISE À JOUR RELIT LA CIBLE COMME L'INSERTION (relecture de sécurité du 13/11/2026, SECU3-Q2). Une ligne rattachée à
// une autre — une table enfant à son parent, un texte lu à sa pièce, une note à son document — ne doit pas pouvoir être
// réécrite vers une cible que l'insertion aurait refusée. PostgreSQL juge la ligne PROPOSÉE d'une mise à jour par le WITH
// CHECK de la policy, à défaut par son USING (PostgreSQL 17, CREATE POLICY). La règle, pour chaque policy PERMISSIVE d'une
// table de public qui vaut pour la mise à jour (UPDATE, ou « pour tout ») : ce qu'elle juge sur la ligne proposée relit
//   - chaque table que relit son USING — le parent d'une table enfant, sans `dossier_id` propre, auquel elle remonte ;
//   - chaque table que relit la vérification de l'insertion de la même table (le WITH CHECK de ses policies d'insertion
//     ou « pour tout ») — la cible du rattachement ;
// hors des tables d'ACCÈS, qui disent qui appelle et non ce que la ligne désigne. « Relit » : la table paraît après un
// `from` ou un `join` d'une sous-requête de l'expression (src/test/policiesDuSchema.ts, `tablesRelues`) ; que la
// sous-requête soit corrélée à la ligne, les essais le jugent (rls.sql, le bloc TO), pas ce scanner.
//
// Il part de TOUT : chaque policy de l'export (supabase/schema, le socle compris), rejouée instruction par instruction, puis
// les migrations préparées (supabase/preparees). Deux états : l'export seul (la production), où la policy d'aujourd'hui qui
// manque à la règle est une EXCEPTION nommée, avec sa raison, et comptée — elle tombe le jour où la migration
// `texte_ocr_coherent_a_la_mise_a_jour` entre dans l'export ; l'export et les préparées (la base de demain), sans
// exception. Un plancher, et des défauts plantés. Récit : HISTORIQUE.md, « 13/11/2026 — SECU3-Q1 ET SECU3-Q2 ».

const RACINE = new URL('../../', import.meta.url).pathname
const lire = (chemin: string) => readFileSync(`${RACINE}${chemin}`, 'utf8')
const MIGRATION = 'supabase/preparees/20261113194000_texte_ocr_coherent_a_la_mise_a_jour.sql'
const RETOUR = 'supabase/preparees/retour/20261113194100_retour_texte_ocr_coherent_a_la_mise_a_jour.sql'

// Les tables qui disent QUI appelle (un accès client, un membre de l'équipe, une affectation, le super-administrateur),
// et non ce que la ligne désigne.
const ACCES = new Set(['public.memberships', 'public.cabinet_admins', 'public.dossier_assignations', 'public.super_admins'])

// Les policies d'aujourd'hui qui manquent à la règle, chacune avec sa raison. Elles tombent quand la migration préparée
// entre dans l'export.
const EXCEPTIONS: Record<string, string> = {
  'public.piece_textes_ocr.piece_textes_ocr_update': 'la réécriture du texte lu (texte_ocr_des_pieces, 16/09/2026) ne relit que le dossier annoncé, pas la pièce ni le document que l\'insertion relit : SECU3-Q2 la complète',
}

interface Faute { cle: string; manquent: string[] }

/** Les policies de mise à jour d'une table de public qui ne relisent pas, sur la ligne proposée, ce que la règle demande. */
function fautes(releve: ReleveDesPolicies): { fautes: Faute[]; jugees: number; exigeantes: number } {
  const policies = [...releve.policies.values()].filter((p) => p.table.startsWith('public.') && p.permissive)
  const resultat: Faute[] = []
  let jugees = 0
  let exigeantes = 0
  for (const p of policies.filter((x) => vautPour(x, 'update'))) {
    jugees++
    const cibles = new Set<string>()
    for (const i of policies.filter((x) => x.table === p.table && vautPour(x, 'insert'))) {
      for (const t of tablesRelues(controleDeLaLigneProposee(i), releve.tables)) cibles.add(t)
    }
    for (const t of tablesRelues(p.using, releve.tables)) cibles.add(t)
    for (const t of ACCES) cibles.delete(t)
    if (cibles.size > 0) exigeantes++
    const relues = tablesRelues(controleDeLaLigneProposee(p), releve.tables)
    const manquent = [...cibles].filter((t) => !relues.has(t)).sort()
    if (manquent.length > 0) resultat.push({ cle: `${p.table}.${p.nom}`, manquent })
  }
  return { fautes: resultat.sort((a, b) => (a.cle < b.cle ? -1 : 1)), jugees, exigeantes }
}

const EXPORT = () => policiesDuSchema(fichiersDuSchema())
const DEMAIN = () => policiesDuSchema([...fichiersDuSchema(), ...fichiersPrepares()])
const planter = (sql: string) => policiesDuSchema([...fichiersDuSchema(), { chemin: 'supabase/preparees/99999999999999_plante.sql', texte: sql }])

describe('la mise à jour relit la cible comme l’insertion', () => {
  it('dans l’export (la production), la seule policy qui manque à la règle est l’exception nommée, et comptée', () => {
    expect(Object.keys(EXCEPTIONS)).toHaveLength(1)
    for (const raison of Object.values(EXCEPTIONS)) expect(raison.length).toBeGreaterThan(40)
    expect(fautes(EXPORT()).fautes).toEqual([{ cle: 'public.piece_textes_ocr.piece_textes_ocr_update', manquent: ['public.documents_divers', 'public.pieces'] }])
    expect(fautes(EXPORT()).fautes.map((f) => f.cle)).toEqual(Object.keys(EXCEPTIONS).sort())
  })

  it('avec les migrations préparées (la base de demain), aucune', () => {
    expect(fautes(DEMAIN()).fautes).toEqual([])
  })

  it('le plancher : il juge toutes les policies de mise à jour du schéma public, et celles qui ont une cible', () => {
    // Relevés le 13/11/2026, export à 218 migrations : 48 policies permissives de mise à jour ou « pour tout » sur les
    // tables de public (le catalogue de la réplique en compte 48) ; neuf ont une cible ou un parent à relire (la note interne, le
    // texte lu, le lettrage, le règlement groupé, la règle d'affectation, la ventilation ; la ligne de facture, le mouvement
    // d'un compte courant et l'affectation d'un membre, qui remontent à leur parent).
    const { jugees, exigeantes } = fautes(EXPORT())
    expect(jugees).toBeGreaterThanOrEqual(48)
    expect(exigeantes).toBeGreaterThanOrEqual(9)
    expect(fautes(DEMAIN()).jugees).toBeGreaterThanOrEqual(jugees)
  })

  it('un défaut planté se voit : une cible de l’insertion que la mise à jour ne relit pas ; un parent que le WITH CHECK oublie', () => {
    const base = fautes(EXPORT()).fautes
    // Une table à cible : l'insertion relit la pièce, la mise à jour non.
    const cible = planter(`create table public.essai_cible (id uuid primary key, dossier_id uuid not null, piece_id uuid);
      create policy essai_cible_insert on public.essai_cible for insert to authenticated
        with check (admin_du_dossier(dossier_id) and exists (select 1 from public.pieces p where p.id = essai_cible.piece_id and p.dossier_id = essai_cible.dossier_id));
      create policy essai_cible_update on public.essai_cible for update to authenticated using (admin_du_dossier(dossier_id));`)
    expect(fautes(cible).fautes).toEqual([...base, { cle: 'public.essai_cible.essai_cible_update', manquent: ['public.pieces'] }]
      .sort((a, b) => (a.cle < b.cle ? -1 : 1)))
    // Une table enfant : l'USING remonte au parent ; un WITH CHECK qui l'oublie est une faute, son absence (l'USING
    // rejoué sur la ligne proposée) ne l'est pas.
    const enfant = (check: string) => planter(`create table public.essai_enfant (id uuid primary key, facture_id uuid not null);
      create policy essai_enfant_maj on public.essai_enfant for update to authenticated
        using (exists (select 1 from public.factures_emises f where f.id = essai_enfant.facture_id and admin_du_dossier(f.dossier_id))) ${check};`)
    expect(fautes(enfant('with check (true)')).fautes.map((f) => f.cle)).toContain('public.essai_enfant.essai_enfant_maj')
    expect(fautes(enfant('')).fautes).toEqual(base)
    // Une table d'accès ne compte pas comme cible : relire `memberships` à l'insertion n'exige rien de la mise à jour.
    const acces = planter(`create table public.essai_acces (id uuid primary key, dossier_id uuid not null);
      create policy essai_acces_insert on public.essai_acces for insert to authenticated
        with check (exists (select 1 from public.memberships m where m.dossier_id = essai_acces.dossier_id and m.user_id = auth.uid()));
      create policy essai_acces_update on public.essai_acces for update to authenticated using (admin_du_dossier(dossier_id));`)
    expect(fautes(acces).fautes).toEqual(base)
    // La règle corrigée par un alter policy : la faute du texte lu tombe.
    const corrigee = planter(`alter policy piece_textes_ocr_update on public.piece_textes_ocr with check (admin_du_dossier(dossier_id)
      and ((piece_id is not null and exists (select 1 from pieces p where p.id = piece_textes_ocr.piece_id))
        or (document_id is not null and exists (select 1 from documents_divers d where d.id = piece_textes_ocr.document_id))));`)
    expect(fautes(corrigee).fautes).toEqual([])
  })
})

describe('la migration texte_ocr_coherent_a_la_mise_a_jour, son retour et ce qui la redit', () => {
  const avant = EXPORT().policies
  const insertion = avant.get('public.piece_textes_ocr.piece_textes_ocr_insert')!
  const maj = avant.get('public.piece_textes_ocr.piece_textes_ocr_update')!
  const normal = (expression: string | null) => (expression ?? '').replace(/\bpublic\./g, '').replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').toLowerCase()
  // La cible de l'insertion : ce qui suit le contrôle d'accès, « and ( … ) ».
  const cibleDe = (expression: string | null) => normal(expression).slice(normal(expression).lastIndexOf(') and (') + ') and '.length)

  it('elle pose le dossier administré puis la cible de l’insertion, mot pour mot, à authenticated ; l’USING ne change pas', () => {
    const apres = policiesDuSchema([...fichiersDuSchema(), { chemin: MIGRATION, texte: lire(MIGRATION) }]).policies
    const p = apres.get('public.piece_textes_ocr.piece_textes_ocr_update')!
    expect([p.permissive, p.commande, p.roles]).toEqual([true, 'update', ['authenticated']])
    expect(p.using).toBe(maj.using)
    expect(normal(p.withCheck).startsWith('admin_du_dossier(dossier_id) and (')).toBe(true)
    expect(cibleDe(p.withCheck)).toBe(cibleDe(insertion.withCheck))
    expect(cibleDe(insertion.withCheck)).toMatch(/^\(\(piece_id is not null and exists \(select 1 from pieces p/)
    // Rien d'autre ne change dans la table.
    for (const nom of ['piece_textes_ocr_select', 'piece_textes_ocr_insert', 'piece_textes_ocr_delete']) {
      expect(apres.get(`public.piece_textes_ocr.${nom}`), nom).toEqual(avant.get(`public.piece_textes_ocr.${nom}`))
    }
  })

  it('son retour rend le WITH CHECK et le rôle d’hier', () => {
    const rendue = policiesDuSchema([...fichiersDuSchema(), { chemin: MIGRATION, texte: lire(MIGRATION) }, { chemin: RETOUR, texte: lire(RETOUR) }])
      .policies.get('public.piece_textes_ocr.piece_textes_ocr_update')!
    expect([rendue.roles, normal(rendue.using), normal(rendue.withCheck)]).toEqual([maj.roles, normal(maj.using), normal(maj.withCheck)])
  })

  it('la voie : par l’outil — aucun mot de retrait, aucune barre oblique inverse ; le retour aussi', () => {
    for (const chemin of [MIGRATION, RETOUR]) {
      expect(lire(chemin), chemin).not.toMatch(/\b(drop|truncate|delete)\b/i)
      expect(lire(chemin), chemin).not.toMatch(/[\r\\]/)
    }
    expect(lire(MIGRATION)).toMatch(/Par l'outil \(`apply_migration`\)/)
  })

  it('la garde de fin, le bloc TO de rls.sql et la migration attendent le même rendu de la cible', () => {
    const constante = (texte: string, nom: string) => {
      const m = new RegExp(String.raw`${nom} constant text := ((?:'(?:[^']|'')*'|\s*\|\|\s*chr\(10\)\s*\|\|\s*|\s+)+);`).exec(texte)
      return m?.[1].replace(/\s+/g, ' ')
    }
    const migration = lire(MIGRATION)
    const rls = lire('supabase/essais/rls.sql')
    const bloc = rls.slice(rls.indexOf('do $to$'), rls.indexOf('end $to$;'))
    expect(constante(migration, 'v_cible')).toBeDefined()
    expect(constante(bloc, 'cible')).toBe(constante(migration, 'v_cible'))
  })
})
