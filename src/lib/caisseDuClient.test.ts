import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { messagesSql } from '../test/raiseSql'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import { MOTS_DE_LA_CAISSE, STATUTS_DE_LA_SAISIE_DU_CLIENT } from './caisse'

// LE DROIT « CAISSE » D'UN ACCÈS CLIENT, EN BASE (ligne 26.6, étape C10 ; MVP-D2 ; CAISSE-Q1, (B) ; CAISSE2-Q2 et Q3, (B)).
// La migration `caisse_du_client` — préparée dans supabase/preparees/, dans l'export sous la version de sa ligne
// d'historique le jour de son application, texte inchangé — reprend cinq fonctions : `client_du_dossier`,
// `droits_sur_le_dossier` et `changer_droits_acces` (de `droits_des_acces_clients`), `qui_ecrit_la_caisse` (de `caisse`) et
// `enregistrer_operation_caisse` (de `paiement_par_la_caisse`, l'une des trois migrations préparées du jour de C8 qu'elle
// suit). Ce garde la confronte à leurs définitions d'hier au caractère près, ce qu'elle ajoute défait ; relit en chaîne les
// empreintes de sa garde de tête ; confronte `caisse_du_client` aux flux et à l'ensemble du jour que la base compte
// ailleurs ; le texte (ce qu'elle crée, ses droits, rien de retiré) ; son retour arrière (supabase/preparees/retour/) ; et
// les essais qui la jouent. Récit : HISTORIQUE.md, « LA CAISSE : LE DROIT « CAISSE », EN BASE (C10, LIGNE 26.6) (PRÉPARÉE,
// PAS APPLIQUÉE) ». Données FICTIVES.

const MIGRATION = /\/\d{14}_caisse_du_client\.sql$/
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const nomDuFichier = (chemin: string) => chemin.split('/').pop() as string
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')

const TROIS = 'p_membership_id uuid, p_ventes boolean, p_banque boolean'
const QUATRE = `${TROIS}, p_caisse boolean`

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application — jamais aux deux.
function laMigration(): { chemin: string; texte: string } {
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => MIGRATION.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), 'la migration caisse_du_client, préparée OU dans l’export').toHaveLength(1)
  return trouvees[0]
}

interface Definition { args: string; definition: string }

// Les définitions qu'un texte donne à une fonction, chacune de son « create » au « $$; » qui la ferme, avec ses arguments.
function definitionsDans(texte: string, fonction: string): Definition[] {
  return [...texte.matchAll(new RegExp(`create (?:or replace )?function public\\.${fonction}\\(`, 'g'))].map((m) => {
    const definition = texte.slice(m.index, texte.indexOf('$$;', m.index))
    return { args: definition.slice(definition.indexOf('(') + 1, definition.indexOf(')')), definition }
  })
}

// La seule définition qu'un texte donne à une fonction, à ces arguments.
function definitionDans(texte: string, fonction: string, args?: string): string {
  const trouvees = definitionsDans(texte, fonction).filter((d) => args === undefined || d.args === args)
  expect(trouvees, `${fonction}(${args ?? '…'})`).toHaveLength(1)
  return trouvees[0].definition
}

// La définition d'hier : la dernière que lui donnent l'export et les migrations préparées dont le nom précède celui de la
// migration, dans l'ordre de leurs noms — celle que la base exécute au jour de l'application, les trois migrations du jour
// de C8 appliquées avant elle.
function avantLaMigration(fonction: string, args?: string): { chemin: string; definition: string } {
  const nom = nomDuFichier(laMigration().chemin)
  const avant = [...fichiersDuSchema(), ...fichiersPrepares()]
    .filter((f) => nomDuFichier(f.chemin) < nom)
    .sort((a, b) => (nomDuFichier(a.chemin) < nomDuFichier(b.chemin) ? -1 : 1))
    .flatMap((f) => definitionsDans(f.texte, fonction).filter((d) => args === undefined || d.args === args)
      .map((d) => ({ chemin: f.chemin, definition: d.definition })))
  expect(avant.length, fonction).toBeGreaterThan(0)
  return avant[avant.length - 1]
}

// Le corps tel que `pg_proc.prosrc` le garde : ce qui suit les dollars qui l'ouvrent, jusqu'à ceux qui le ferment.
const prosrc = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)

// Remplace un passage qui doit paraître une fois, exactement.
function uneFois(texte: string, de: string, vers: string): string {
  expect(texte.split(de).length - 1, de.slice(0, 80)).toBe(1)
  return texte.replace(de, () => vers)
}

const ouRemplace = (definition: string) => definition.replace(/^create function /, 'create or replace function ')

// Le retour arrière, dans supabase/preparees/retour/.
function leRetour(): string {
  const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
  expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
  const nom = readdirSync(dossier).find((n) => /^\d{14}_retour_caisse_du_client\.sql$/.test(n))
  expect(nom, 'le retour arrière de caisse_du_client').toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
}

// ── Ce que la migration ajoute à chaque fonction reprise, et qui, défait, rend celle d'hier ─────────────────────────

const DEFAIRE: { fonction: string; args?: string; migration: string; defaire: (posee: string) => string }[] = [
  {
    fonction: 'client_du_dossier', migration: 'droits_des_acces_clients',
    defaire: (posee) => uneFois(posee, "            when 'caisse' then m.droit_caisse\n", '').replace(/^create or replace function /, 'create function '),
  },
  {
    fonction: 'droits_sur_le_dossier', migration: 'droits_des_acces_clients',
    defaire: (posee) => uneFois(posee, "    'banque', public.gere_la_banque(p_dossier_id),\n    'caisse', public.gere_la_caisse(p_dossier_id)\n",
      "    'banque', public.gere_la_banque(p_dossier_id)\n").replace(/^create or replace function /, 'create function '),
  },
  {
    // La forme à QUATRE, défaite, est la forme à trois d'hier : le seul corps qui écrit `memberships`.
    fonction: 'changer_droits_acces', args: QUATRE, migration: 'droits_des_acces_clients',
    defaire: (posee) => {
      let t = uneFois(posee, `(${QUATRE})`, `(${TROIS})`)
      t = uneFois(t, `  if p_ventes is null and p_banque is null and p_caisse is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque » ou « Caisse ».' using errcode = '22023';`,
      `  if p_ventes is null and p_banque is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », ou les deux.' using errcode = '22023';`)
      return uneFois(t, `         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse)
`, `         droit_banque = coalesce(p_banque, m.droit_banque)
`)
    },
  },
  {
    fonction: 'qui_ecrit_la_caisse', migration: 'caisse',
    defaire: (posee) => {
      let t = uneFois(posee, 'as $$\ndeclare\n  v_statut text;\nbegin\n', 'as $$\nbegin\n')
      t = uneFois(t, `  if p_dossier_id is not null and public.client_du_dossier(p_dossier_id, 'caisse') then
    select d.statut_tva into v_statut from public.dossiers d where d.id = p_dossier_id for share;
    if v_statut in ('exonere', 'franchise') then
      return 'client';
    end if;
    raise exception 'La saisie des espèces depuis ton espace suppose un dossier exonéré de TVA ou en franchise en base : ton cabinet tient ta caisse.'
      using errcode = '23514';
  end if;
`, '')
      return t.replace(/^create or replace function /, 'create function ')
    },
  },
  {
    fonction: 'enregistrer_operation_caisse', migration: 'paiement_par_la_caisse',
    defaire: (posee) => {
      let t = uneFois(posee, '  v_categorie_du_client uuid;\n', '')
      t = uneFois(t, '  v_ecritures jsonb;\n', '')
      const debutNature = t.indexOf("  -- (C10) Pour le client, celle que le cabinet a fixée pour le dossier")
      const finNature = t.indexOf("  elsif p_genre = 'recette' then\n", debutNature)
      expect(debutNature).toBeGreaterThan(0)
      t = t.slice(0, debutNature) + "  if p_genre = 'recette' then\n" + t.slice(finNature + "  elsif p_genre = 'recette' then\n".length)
      t = uneFois(t, `      -- (C10) Au client, sans le numéro de la facture : caisse_du_client ne le lui rend pas.
      if v_origine = 'client' then
        raise exception 'Des espèces d''une facture de ce jour ont été enregistrées depuis ta lecture : relis ta caisse.'
          using errcode = '22023';
      end if;
`, '')
      t = uneFois(t, `        -- (C10) Au client, sans le numéro de la facture.
        if v_origine = 'client' then
          raise exception 'Des espèces d''une facture que ta lecture comptait ne sont pas dans la caisse de ce jour : relis ta caisse.'
            using errcode = '22023';
        end if;
`, '')
      const debutEcriture = t.indexOf("  -- (C10) Le client ne lit pas le plan du dossier")
      const finEcriture = t.indexOf("    v_ecritures := p_ecritures;\n  end if;\n", debutEcriture)
      expect(debutEcriture).toBeGreaterThan(0)
      t = t.slice(0, debutEcriture) + t.slice(finEcriture + "    v_ecritures := p_ecritures;\n  end if;\n".length)
      t = uneFois(t, 'v_id, p_dossier_id, p_genre, p_date, p_montant, v_categorie.id, p_taux_tva,',
        'v_id, p_dossier_id, p_genre, p_date, p_montant, p_categorie_id, p_taux_tva,')
      // `v_ecritures` partout où hier lisait `p_ecritures` : quatre lectures.
      expect(t.match(/v_ecritures/g)).toHaveLength(5)
      return t.replace(/v_ecritures/g, 'p_ecritures')
    },
  },
]

describe('la migration caisse_du_client reprend cinq fonctions, et n’y ajoute que le client', () => {
  it('elle suit les trois migrations préparées du jour de C8, dans leur ordre', () => {
    const nom = nomDuFichier(laMigration().chemin)
    const tous = [...fichiersDuSchema(), ...fichiersPrepares()].map((f) => nomDuFichier(f.chemin))
    for (const avant of ['paiement_par_la_caisse', 'champs_bnc_du_fec', 'validation_des_paiements_par_la_caisse']) {
      const trouve = tous.filter((n) => new RegExp(`^\\d{14}_${avant}\\.sql$`).test(n))
      expect(trouve, avant).toHaveLength(1)
      expect(trouve[0] < nom, avant).toBe(true)
    }
  })

  it('chaque fonction reprise est celle d’hier au caractère près, ce que la migration ajoute défait', () => {
    const texte = laMigration().texte
    for (const r of DEFAIRE) {
      const hier = avantLaMigration(r.fonction, r.fonction === 'changer_droits_acces' ? TROIS : undefined)
      expect(hier.chemin, r.fonction).toMatch(new RegExp(`/\\d{14}_${r.migration}\\.sql$`))
      expect(r.defaire(definitionDans(texte, r.fonction, r.args)), r.fonction).toBe(hier.definition)
    }
  })

  it('la forme à trois de changer_droits_acces appelle celle à quatre, « Caisse » nul, et la précède dans le texte', () => {
    const texte = laMigration().texte
    const trois = definitionDans(texte, 'changer_droits_acces', TROIS)
    expect(prosrc(trois)).toBe('\nbegin\n  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean);\nend;\n')
    expect(texte.indexOf(trois)).toBeLessThan(texte.indexOf(definitionDans(texte, 'changer_droits_acces', QUATRE)))
    // Les deux rendent l'accès, aux droits du propriétaire, le chemin fixé.
    for (const d of [trois, definitionDans(texte, 'changer_droits_acces', QUATRE)]) {
      expect(d.replace(/\s+/g, ' ')).toContain(') returns public.memberships language plpgsql security definer set search_path = public as $$')
    }
  })

  it('sa garde de tête : une seconde application, les trois migrations du jour de C8, et vingt-deux corps à leur empreinte d’hier', () => {
    const texte = laMigration().texte
    const premiereDefinition = texte.indexOf('\ncreate ')
    const garde = texte.slice(texte.indexOf('do $garde$'), texte.indexOf('$garde$;'))
    expect(texte.indexOf('do $garde$')).toBeLessThan(premiereDefinition)
    expect(garde).toContain("'La migration caisse_du_client est déjà en base : elle ne s''applique pas deux fois.'")
    expect(garde).toContain("if to_regprocedure('public.regler_piece_par_la_caisse(uuid, uuid, date, numeric)') is null then")
    const epinglees = [...garde.matchAll(/\('(\w+)', 'public\.(\w+)\(([^)]*)\)', '([0-9a-f]{32})'\)/g)]
      .map((m) => ({ nom: m[1], fonction: m[2], types: m[3], empreinte: m[4] }))
    expect(epinglees).toHaveLength(22)
    for (const e of epinglees) {
      expect(e.fonction, e.nom).toBe(e.nom)
      const args = e.nom === 'changer_droits_acces' ? TROIS : undefined
      expect(md5(prosrc(avantLaMigration(e.nom, args).definition)), e.nom).toBe(e.empreinte)
    }
    // Les cinq qu'elle reprend, celles dont les branches « client » s'ouvrent, et la validation du jour (le filet) en sont.
    const noms = epinglees.map((e) => e.nom)
    for (const n of [...DEFAIRE.map((r) => r.fonction), 'retirer_operation_caisse', 'remplacer_operation_caisse',
      'enregistrer_operations_de_caisse', 'regler_piece_par_la_caisse', 'valider_exercice', 'premier_jour_negatif_de_la_caisse']) {
      expect(noms, n).toContain(n)
    }
    expect(garde).toContain("if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then")
    expect(garde).toContain("select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p")
    // Les statuts de TVA d'hier : exactement les trois, que les gardes et la saisie jugent.
    expect(garde).toContain("pg_get_constraintdef(c.oid) = 'CHECK ((statut_tva = ANY (ARRAY[''redevable''::text, ''franchise''::text, ''exonere''::text])))'")
  })

  it('le texte : onze définitions, deux colonnes, une policy, trois déclencheurs, ses droits, rien de retiré, ni barre oblique inverse ni retour chariot', () => {
    const texte = laMigration().texte
    const sansCommentaires = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect([...sansCommentaires.matchAll(/create (or replace )?function public\.(\w+)\(/g)].map((m) => `${m[1] ? 'r' : 'c'} ${m[2]}`)).toEqual([
      'r client_du_dossier', 'c gere_la_caisse', 'r droits_sur_le_dossier', 'r changer_droits_acces', 'c changer_droits_acces',
      'c garder_droit_caisse', 'c garder_statut_tva_de_la_caisse', 'c garder_categorie_recettes_client', 'r qui_ecrit_la_caisse',
      'r enregistrer_operation_caisse', 'c caisse_du_client',
    ])
    expect([...sansCommentaires.matchAll(/alter table public\.(\w+)\s+add column (\w+) ([^;]*);/g)].map((m) => `${m[1]}.${m[2]} ${m[3]}`))
      .toEqual(['memberships.droit_caisse boolean not null default false', 'dossiers.categorie_recettes_client uuid'])
    expect(sansCommentaires.match(/\balter table\b/gi)).toHaveLength(2)
    expect(sansCommentaires.replace(/\s+/g, ' ')).toContain("create policy operations_caisse_lecture_caisse on public.operations_caisse "
      + "for select to authenticated using (public.client_du_dossier(dossier_id, 'caisse'));")
    expect(sansCommentaires.match(/create policy/g)).toHaveLength(1)
    expect([...sansCommentaires.matchAll(/create trigger (\w+)\s+([^;]*);/g)].map((m) => `${m[1]} ${m[2].replace(/\s+/g, ' ')}`)).toEqual([
      'memberships_droit_caisse after insert or update of droit_caisse, dossier_id on public.memberships for each row execute function public.garder_droit_caisse()',
      'dossiers_statut_tva_de_la_caisse after update on public.dossiers for each row when (old.statut_tva is distinct from new.statut_tva) execute function public.garder_statut_tva_de_la_caisse()',
      'dossiers_categorie_recettes_client after insert or update of categorie_recettes_client on public.dossiers for each row execute function public.garder_categorie_recettes_client()',
    ])
    // Ses droits : les trois qu'un compte connecté appelle, ni PUBLIC ni l'anonyme ; les trois gardes, personne. Les
    // `revoke` ne retirent que ce que Postgres donne d'office aux six fonctions qu'elle crée.
    expect([...sansCommentaires.matchAll(/\b(grant|revoke) execute on function public\.([^;]*);/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'revoke gere_la_caisse(uuid) from public, anon', 'grant gere_la_caisse(uuid) to authenticated',
      'revoke changer_droits_acces(uuid, boolean, boolean, boolean) from public, anon',
      'grant changer_droits_acces(uuid, boolean, boolean, boolean) to authenticated',
      'revoke caisse_du_client(uuid, integer) from public, anon', 'grant caisse_du_client(uuid, integer) to authenticated',
      'revoke garder_droit_caisse() from public, anon, authenticated',
      'revoke garder_statut_tva_de_la_caisse() from public, anon, authenticated',
      'revoke garder_categorie_recettes_client() from public, anon, authenticated',
    ])
    expect(sansCommentaires.match(/\b(grant|revoke)\b/gi)).toHaveLength(9)
    expect(sansCommentaires).not.toMatch(/\b(drop|truncate)\b/i)
    expect(sansCommentaires).not.toMatch(/\bdelete\b/i)
    expect(sansCommentaires).not.toMatch(/\bupdate public\.(?!memberships m)/i)
    // Chaque fonction qu'elle crée : aux droits du propriétaire, le chemin fixé.
    for (const d of definitionsDans(texte, '\\w+')) {
      expect(d.definition.replace(/\s+/g, ' '), d.definition.slice(0, 60)).toMatch(/security definer set search_path = public as \$\$/)
    }
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })
})

// ── Les gardes et la lecture, relues dans le texte ───────────────────────────────────────────────────────────────────

describe('les trois gardes : APRÈS la ligne, aux droits du propriétaire, sous leurs mots', () => {
  const texte = () => laMigration().texte
  const code = (fonction: string) => prosrc(definitionDans(texte(), fonction)).split('\n')
    .map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'))

  it('« Caisse » qui arrive : le patron de `garder_droit_ventes`, le statut lu for share, les deux statuts exclus', () => {
    expect(code('garder_droit_caisse')).toEqual([
      'declare', 'v_statut text;', 'begin',
      'if not new.droit_caisse then', 'return null;', 'end if;',
      "if tg_op = 'UPDATE' and old.droit_caisse and new.dossier_id = old.dossier_id then", 'return null;', 'end if;',
      "if tg_op = 'INSERT' and public.is_super_admin() then", 'return null;', 'end if;',
      'select d.statut_tva into v_statut from public.dossiers d where d.id = new.dossier_id for share;',
      "if v_statut is distinct from 'exonere' and v_statut is distinct from 'franchise' then",
      "raise exception 'Le droit « Caisse » suppose un dossier exonéré de TVA ou en franchise en base, ce que le statut de ce dossier ne dit pas : sa caisse reste tenue par le cabinet.'",
      "using errcode = '23514';", 'end if;', 'return null;', 'end',
    ])
    // Le patron : la garde de « Ventes », au mot près hors du droit et de ce qu'elle lit.
    const ventes = prosrc(avantLaMigration('garder_droit_ventes').definition)
    expect(ventes).toContain("if tg_op = 'INSERT' and public.is_super_admin() then")
    expect(ventes).toContain('from public.dossiers d where d.id = new.dossier_id for share;')
  })

  it('le statut qui quitte les deux statuts exclus sous une case : APRÈS la mise à jour, quel que soit le chemin, sans verrou sur les accès', () => {
    expect(code('garder_statut_tva_de_la_caisse')).toEqual([
      'begin',
      "if old.statut_tva is distinct from 'exonere' and old.statut_tva is distinct from 'franchise' then", 'return null;', 'end if;',
      "if new.statut_tva is not distinct from 'exonere' or new.statut_tva is not distinct from 'franchise' then", 'return null;', 'end if;',
      'if exists (select 1 from public.memberships m where m.dossier_id = old.id and m.droit_caisse) then',
      "raise exception 'Un accès de ce dossier porte la case « Caisse », qui suppose un dossier exonéré de TVA ou en franchise en base : décoche-la d''abord.'",
      "using errcode = '23514';", 'end if;', 'return null;', 'end',
    ])
    // `deduire_assujetti_tva` change le statut quand seul le booléen change : la clause `when` juge le statut écrit.
    expect(prosrc(avantLaMigration('deduire_assujetti_tva').definition)).toMatch(/new\.statut_tva\s*:=/)
  })

  it('la nature des recettes du client : une catégorie de produit du dossier, ou commune, ou rien', () => {
    expect(messagesSql(definitionDans(texte(), 'garder_categorie_recettes_client'))).toEqual([MOTS_DE_LA_CAISSE.nature_hors_produit.gabarit])
    expect(code('garder_categorie_recettes_client')).toContain("if tg_op = 'INSERT' and public.is_super_admin() then")
  })

  it('les statuts du module sont ceux des trois corps qui les nomment', () => {
    expect(STATUTS_DE_LA_SAISIE_DU_CLIENT).toEqual(['exonere', 'franchise'])
    expect(prosrc(definitionDans(texte(), 'qui_ecrit_la_caisse'))).toContain("if v_statut in ('exonere', 'franchise') then")
    expect(messagesSql(definitionDans(texte(), 'qui_ecrit_la_caisse'))).toEqual([
      MOTS_DE_LA_CAISSE.acces_hors_statut.gabarit, MOTS_DE_LA_CAISSE.acces.gabarit,
    ])
  })
})

describe('caisse_du_client : la caisse que la base compte, jour par jour, sans un libellé ni un nom', () => {
  const definition = () => definitionDans(laMigration().texte, 'caisse_du_client')

  it('sa signature : des dates, des montants, des identifiants d’encaissements et le jour figé — aucun texte', () => {
    expect(definition().replace(/\s+/g, ' ')).toContain('create function public.caisse_du_client(p_dossier_id uuid, p_annee integer) '
      + 'returns table (jour date, report numeric, ouverture numeric, operations numeric, releve numeric, '
      + 'especes_des_factures numeric, encaissements_du_jour uuid[], solde numeric, fige boolean) '
      + 'language plpgsql stable security definer set search_path = public as $$')
  })

  it('l’accès d’abord — un dossier qui n’existe pas sous les mêmes mots —, puis l’année', () => {
    const corps = prosrc(definition())
    expect(messagesSql(corps)).toEqual(['Accès refusé à ce dossier.', 'L\'année d\'une caisse se lit de 2000 à 9999.'])
    expect(corps.indexOf('public.gere_la_caisse(p_dossier_id)')).toBeLessThan(corps.indexOf('raise exception'))
    expect(corps).toContain('if p_dossier_id is null or not exists (select 1 from public.dossiers d where d.id = p_dossier_id)')
  })

  it('ses flux sont ceux de `premier_jour_negatif_de_la_caisse`, bornés par l’ouverture du compte de la caisse', () => {
    const corps = prosrc(definition())
    const juge = prosrc(avantLaMigration('premier_jour_negatif_de_la_caisse').definition)
    for (const fragment of [
      "case when a.sens = 'debit' then a.montant else -a.montant end",
      "case when o.genre = 'prelevement' then -o.montant else o.montant end",
      'where o.dossier_id = p_dossier_id and o.retire_le is null',
      'where e.dossier_id = p_dossier_id and f.source_de_la_vente and e.retire_le is null and e.ligne_bancaire_id is null',
      "and case when e.annule_id is null then e.moyen = 'especes'",
      "else o.ligne_bancaire_id is null and o.moyen = 'especes' end",
      'left join public.encaissements_factures o on o.id = e.annule_id',
    ]) {
      expect(corps, fragment).toContain(fragment)
      expect(juge, fragment).toContain(fragment)
    }
    expect(juge).toContain('where l.dossier_id = p_dossier_id and l.compte_bilan = c.compte')
    expect(corps).toContain('where l.dossier_id = p_dossier_id and l.compte_bilan = v_caisse')
    expect(corps).toContain("v_caisse := public.compte_du_role(p_dossier_id, 'caisse');")
    expect(corps).toContain('select min(a.date) into v_premier from public.a_nouveaux a where a.dossier_id = p_dossier_id and a.compte = v_caisse;')
    expect(corps).toContain('where v_premier is null or x.le_jour >= v_premier')
  })

  it('son ensemble du jour est celui qu’`enregistrer_operation_caisse` lit : les espèces des factures sources, les paiements de pièces de vente', () => {
    const corps = prosrc(definition())
    const saisie = prosrc(definitionDans(laMigration().texte, 'enregistrer_operation_caisse'))
    expect(saisie).toContain('where e.dossier_id = p_dossier_id and e.date_encaissement = p_date and f.source_de_la_vente')
    expect(corps).toContain('where e.dossier_id = p_dossier_id and e.date_encaissement = p.le_jour and f.source_de_la_vente')
    for (const fragment of ['and e.retire_le is null and e.ligne_bancaire_id is null', 'join public.pieces']) {
      expect(saisie, fragment).toContain(fragment)
      expect(corps, fragment).toContain(fragment)
    }
    expect(saisie).toContain("where o.dossier_id = p_dossier_id and o.date = p_date and o.genre = 'paiement' and o.retire_le is null\n         and p.type_piece = 'vente'")
    expect(corps).toContain("where o.dossier_id = p_dossier_id and o.date = p.le_jour and o.genre = 'paiement' and o.retire_le is null\n                and q.type_piece = 'vente'")
  })

  it('elle ne lit aucune colonne de texte libre : ni libellé, ni nom, ni numéro', () => {
    const corps = prosrc(definition())
    expect(corps).not.toMatch(/\b(libelle|nom|numero|tiers|storage_path|nom_fichier|cree_par|email)\b/)
  })
})

// ── Le retour arrière ────────────────────────────────────────────────────────────────────────────────────────────────

describe('le retour arrière : les cinq corps d’hier, au caractère près, puis ce que la migration a créé, retiré', () => {
  it('il exige les onze corps que la migration a posés, refuse une case cochée ou une nature fixée, avant toute définition', () => {
    const retour = leRetour()
    const texte = laMigration().texte
    const premiereDefinition = retour.indexOf('\ncreate ')
    const posees = [
      ['client_du_dossier'], ['gere_la_caisse'], ['droits_sur_le_dossier'], ['changer_droits_acces', QUATRE], ['changer_droits_acces', TROIS],
      ['garder_droit_caisse'], ['garder_statut_tva_de_la_caisse'], ['garder_categorie_recettes_client'], ['qui_ecrit_la_caisse'],
      ['enregistrer_operation_caisse'], ['caisse_du_client'],
    ] as const
    for (const [fonction, args] of posees) {
      const empreinte = md5(prosrc(definitionDans(texte, fonction, args)))
      expect(retour.indexOf(`'${empreinte}')`), fonction).toBeGreaterThan(0)
      expect(retour.indexOf(`'${empreinte}')`), fonction).toBeLessThan(premiereDefinition)
    }
    // Une case cochée, une nature fixée : le retour se refuse, chacun sous ses mots, avant toute définition.
    for (const compte of ['select count(*) into v_n from public.memberships m where m.droit_caisse;\n  if v_n > 0 then\n    raise exception',
      'select count(*) into v_n from public.dossiers d where d.categorie_recettes_client is not null;\n  if v_n > 0 then\n    raise exception']) {
      expect(retour.indexOf(compte), compte).toBeGreaterThan(0)
      expect(retour.indexOf(compte), compte).toBeLessThan(premiereDefinition)
    }
  })

  it('il rend les cinq définitions d’hier et leurs commentaires', () => {
    const retour = leRetour()
    expect(definitionDans(retour, 'enregistrer_operation_caisse')).toBe(avantLaMigration('enregistrer_operation_caisse').definition)
    for (const [fonction, args] of [['qui_ecrit_la_caisse', undefined], ['changer_droits_acces', TROIS], ['droits_sur_le_dossier', undefined],
      ['client_du_dossier', undefined]] as const) {
      expect(definitionDans(retour, fonction, args), fonction).toBe(ouRemplace(avantLaMigration(fonction, args).definition))
    }
    expect(retour.match(/create (or replace )?function/g)).toHaveLength(5)
    // Les commentaires d'hier : ceux de `droits_des_acces_clients`, et aucun sur les deux fonctions de la caisse.
    const p1 = lire('supabase/schema/20261009224031_droits_des_acces_clients.sql')
    for (const signature of ['changer_droits_acces(uuid, boolean, boolean)', 'droits_sur_le_dossier(uuid)', 'client_du_dossier(uuid, text)']) {
      const i = p1.indexOf(`comment on function public.${signature} is`)
      expect(i, signature).toBeGreaterThan(0)
      expect(retour, signature).toContain(p1.slice(i, p1.indexOf("';\n", i) + 3))
    }
    expect(retour).toContain('comment on function public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) is null;')
    expect(retour).toContain('comment on function public.qui_ecrit_la_caisse(uuid) is null;')
  })

  it('il ne retire que ce que la migration a créé, après les définitions', () => {
    const retour = leRetour()
    const retraits = [...retour.matchAll(/^(drop [^;]*|alter table [^;]*);$/gm)].map((m) => m[1])
    expect(retraits).toEqual([
      'drop policy operations_caisse_lecture_caisse on public.operations_caisse',
      'drop trigger memberships_droit_caisse on public.memberships',
      'drop trigger dossiers_statut_tva_de_la_caisse on public.dossiers',
      'drop trigger dossiers_categorie_recettes_client on public.dossiers',
      'drop function public.caisse_du_client(uuid, integer)',
      'drop function public.garder_droit_caisse()',
      'drop function public.garder_statut_tva_de_la_caisse()',
      'drop function public.garder_categorie_recettes_client()',
      'drop function public.changer_droits_acces(uuid, boolean, boolean, boolean)',
      'drop function public.gere_la_caisse(uuid)',
      'alter table public.dossiers drop column categorie_recettes_client',
      'alter table public.memberships drop column droit_caisse',
    ])
    expect(retour.indexOf('drop policy')).toBeGreaterThan(retour.lastIndexOf('$$;'))
    expect(retour).not.toMatch(/\b(grant|revoke|truncate)\b/i)
    expect(retour).not.toMatch(/\bdelete from\b/i)
    expect(retour).not.toContain('\\')
    expect(retour).not.toContain('\r')
  })
})

// ── Les essais qui la jouent ─────────────────────────────────────────────────────────────────────────────────────────

describe('les essais jouent la migration, et attendent sans elle', () => {
  it('caisse.sql : les contrôles 240 à 267 sous le genre « …5 », 97c sous « …5h », la ligne EN ATTENTE', () => {
    const essai = lire('supabase/essais/caisse.sql')
    const etapes = [...essai.matchAll(/\n {4}array\['(\w+)', '(\d+)[a-z]*\. /g)].map((m) => ({ genre: m[1], numero: Number(m[2]) }))
    const neuves = etapes.filter((e) => e.numero >= 240 && e.numero <= 267)
    expect(neuves.length).toBeGreaterThanOrEqual(75)
    expect(neuves.every((e) => /5$/.test(e.genre)), neuves.filter((e) => !/5$/.test(e.genre)).map((e) => e.numero).join(',')).toBe(true)
    expect(new Set(neuves.map((e) => e.numero)).size).toBe(28)
    expect(essai).toContain("array['valeur5h', '97c. la RLS et les deux policies, au compte connecté'")
    expect(essai).toContain("c10 boolean := to_regprocedure('public.caisse_du_client(uuid, integer)') is not null;")
    expect(essai).toContain("'240. EN ATTENTE de la migration caisse_du_client (étape C10) : '")
    // Chaque refus neuf de la saisie du client y est attendu, sous son code, mots pour mots.
    for (const cle of ['acces_hors_statut', 'nature_choisie', 'nature_absente', 'nature_sans_produit', 'ensemble_manquant_client',
      'ensemble_en_trop_client', 'ecriture_du_client', 'nature_hors_produit'] as const) {
      const { code, gabarit } = MOTS_DE_LA_CAISSE[cle]
      expect(essai, cle).toContain(`'${code}', '${gabarit.replace(/'/g, "''")}'`)
    }
  })
})
