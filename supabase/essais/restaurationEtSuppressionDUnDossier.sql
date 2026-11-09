-- LES COMMENTAIRES D'UN DOSSIER SE RESTAURENT, ET UNE RÈGLE DU CABINET NE RETIENT PLUS LA SUPPRESSION D'UN DOSSIER
-- (RESTAU-Q1 et RESTAU-Q4, MVP-D3 ; la migration `restauration_et_suppression_d_un_dossier`, PRÉPARÉE le 09/11/2026,
-- supabase/preparees/). Le récit : HISTORIQUE.md, « 09/11/2026 — RESTAU-Q1 ET RESTAU-Q4 : LES COMMENTAIRES SE RESTAURENT,
-- UNE RÈGLE DU CABINET NE BLOQUE PLUS LA SUPPRESSION D'UN DOSSIER (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer par `execute_sql`
-- après toute migration qui touche `piece_commentaires`, ses policies, `is_super_admin` ou une clé qui cite `categories`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. le catalogue : la policy de la restauration (insertion, à authenticated seul, `is_super_admin()`, rien d'autre),
--      les trois policies d'hier à leur empreinte, aucune policy de mise à jour, la RLS active ;
--   2. le super-administrateur insère ce qu'une restauration réinsère : le commentaire d'un AUTRE auteur (le client, sous
--      l'origine « client », à sa date d'origine), et celui d'un compte supprimé depuis (auteur nul, origine « cabinet ») ;
--   3. le client n'insère toujours ni le commentaire d'un autre, ni le sien sous l'origine « cabinet » (42501) ; il insère
--      le sien (le contrôle positif d'hier) ; l'anonyme n'insère rien ;
--   4. personne ne réécrit un commentaire, pas même le super-administrateur : aucune ligne touchée, le texte relu ;
--   5. la clé `tiers_categories_cabinet_categorie_id_fkey` en cascade, sous son nom ; l'autre clé de la table, et les six
--      autres clés vers `categories`, telles qu'hier (sans action), chacune sur une table dont le `dossier_id` part en
--      cascade avec le dossier — elles ne retiennent donc pas sa suppression.
-- La suppression même d'un dossier dont une catégorie propre est visée par une règle du cabinet ne se joue pas ici
-- (l'outil d'exécution de la production retient une suppression) : elle s'est jouée sur une réplique (l'entrée ci-dessus).
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `e57a0000-0000-4000-8109`), une pièce, l'accès du client
-- d'essai. Tout se joue dans une sous-transaction ANNULÉE (`ANNULATION_ESSAI_GLOBALE`) ; les verdicts voyagent dans une
-- variable, puis dans un réglage LOCAL à la transaction (`essai.restauration_commentaires`), que la requête finale lit :
-- un seul appel, ni table ni fonction créée, aucune instruction de suppression, rien qui dépende d'une ligne hors de son
-- dossier. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`). Sans la migration, une ligne dit qu'il
-- attend (EN ATTENTE) et rien ne s'écrit.
do $essai$
declare
  chef constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  dr constant uuid := 'e57a0000-0000-4000-8109-0000000000d1';
  piece constant uuid := 'e57a0000-0000-4000-8109-0000000000f1';
  acces constant uuid := 'e57a0000-0000-4000-8109-0000000000a1';
  c_client constant uuid := 'e57a0000-0000-4000-8109-0000000000c1';
  c_efface constant uuid := 'e57a0000-0000-4000-8109-0000000000c2';
  c_autre constant uuid := 'e57a0000-0000-4000-8109-0000000000c3';
  c_signe constant uuid := 'e57a0000-0000-4000-8109-0000000000c4';
  c_sien constant uuid := 'e57a0000-0000-4000-8109-0000000000c5';
  c_anon constant uuid := 'e57a0000-0000-4000-8109-0000000000c6';
  date_d_origine constant timestamptz := '2026-03-14 09:30:00+01';
  verdicts jsonb := '[]'::jsonb;
  obs text; obs2 text; obs3 text; n bigint; n2 bigint;
begin
  if not exists (select 1 from pg_policy p
                  where p.polrelid = 'public.piece_commentaires'::regclass and p.polname = 'piece_commentaires_restauration') then
    perform set_config('essai.restauration_commentaires', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration restauration_et_suppression_d_un_dossier', 'ok', true,
      'observe', 'absente : il se juge dès que la migration y est'))::text, true);
    return;
  end if;
  if not exists (select 1 from super_admins where user_id = chef) or exists (select 1 from super_admins where user_id = client)
     or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from dossiers where id = dr) or exists (select 1 from piece_commentaires where dossier_id = dr) then
    raise exception 'ESSAI_IMPOSSIBLE : le chef n''est pas super-administrateur, le compte client l''est ou est du cabinet, ou l''identifiant d''essai est pris';
  end if;

  -- 1. Le catalogue : la policy neuve, les trois d'hier, aucune mise à jour, la RLS.
  select count(*) into n from pg_policy p
   where p.polrelid = 'public.piece_commentaires'::regclass and p.polname = 'piece_commentaires_restauration'
     and p.polcmd = 'a' and p.polpermissive and p.polroles = array['authenticated'::regrole]::oid[]
     and p.polqual is null and pg_get_expr(p.polwithcheck, p.polrelid) = 'is_super_admin()';
  select md5(string_agg(p.polname::text || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || p.polroles::text
           || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           '|' order by p.polname collate "C")) into obs
    from pg_policy p
   where p.polrelid = 'public.piece_commentaires'::regclass and p.polname <> 'piece_commentaires_restauration'
     and not (p.polname = 'deux_facteurs' and not p.polpermissive);
  select string_agg(p.polname::text || '=' || p.polcmd::text, ',' order by p.polname collate "C") into obs2
    from pg_policy p where p.polrelid = 'public.piece_commentaires'::regclass and not (p.polname = 'deux_facteurs' and not p.polpermissive);
  verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. la policy de la restauration (insertion, authenticated seul, is_super_admin()), les trois d''hier à leur empreinte, aucune mise à jour, la RLS active',
    'observe', n || ' | ' || obs || ' | ' || obs2 || ' | RLS ' || (select c.relrowsecurity::text from pg_class c where c.oid = 'public.piece_commentaires'::regclass),
    'ok', n = 1 and obs = '610103bdc75f7204a7ef3232e23b863d'
      and obs2 = 'piece_commentaires_delete=d,piece_commentaires_insert=a,piece_commentaires_restauration=a,piece_commentaires_select=r'
      and (select c.relrowsecurity from pg_class c where c.oid = 'public.piece_commentaires'::regclass));

  -- 5. Les clés vers `categories` : celle de la règle du cabinet en cascade, les autres telles qu'hier.
  select string_agg(c.conname::text || '=' || c.confdeltype::text || ' ' || md5(pg_get_constraintdef(c.oid)), ',' order by c.conname collate "C") into obs
    from pg_constraint c where c.conrelid = 'public.tiers_categories_cabinet'::regclass and c.contype = 'f';
  select string_agg(c.conrelid::regclass::text || '=' || c.confdeltype::text, ',' order by c.conrelid::regclass::text collate "C") into obs2
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.categories'::regclass and c.conrelid <> 'public.tiers_categories_cabinet'::regclass;
  select count(*) into n from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.dossiers'::regclass and c.confdeltype = 'c'
     and c.conrelid in (select k.conrelid from pg_constraint k where k.contype = 'f' and k.confrelid = 'public.categories'::regclass
                         and k.conrelid <> 'public.tiers_categories_cabinet'::regclass)
     and (select a.attname from pg_attribute a where a.attrelid = c.conrelid and a.attnum = c.conkey[1]) = 'dossier_id';
  verdicts := verdicts || jsonb_build_object('rang', 5, 'etape', '5. la clé de la règle du cabinet vers categories en cascade, sous son nom ; l''autre clé de la table et les six autres clés vers categories telles qu''hier, chacune sur une table dont le dossier_id part en cascade',
    'observe', obs || ' | ' || obs2 || ' | ' || n || ' dossier_id en cascade',
    'ok', obs = 'tiers_categories_cabinet_cabinet_id_fkey=a 85ee801df3fa04589745a3b48fcf3c19,tiers_categories_cabinet_categorie_id_fkey=c 4b363fe5d582b627b60fb7a64d1ad1a6'
      and obs2 = 'lignes_bancaires=a,operations_caisse=a,pieces=a,regles_affectation_bancaire=a,tiers_categories=a,ventilations_bancaires=a'
      and n = 6);

  begin
    -- ── Le jeu : un dossier jetable du cabinet du dossier `test`, une pièce, l'accès du client d'essai ──
    perform set_config('request.jwt.claims', '', true);
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
      select dr, 'ESSAI RESTAU-Q1', d.cabinet_id, 'tresorerie', '455000', 'exonere'
      from dossiers d where d.id = '001c7ed7-c23b-4590-901e-693489f8af24';
    insert into pieces (id, dossier_id, storage_path, nom_fichier) values (piece, dr, dr::text || '/essai-restau.pdf', 'essai-restau.pdf');
    insert into memberships (id, user_id, dossier_id, role, email) values (acces, client, dr, 'client', 'essai-restau@example.test');

    -- 2. Le super-administrateur réinsère le commentaire du client, à sa date d'origine, puis celui d'un compte supprimé.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte, created_at)
        values (c_client, dr, piece, client, 'client', 'Le ticket du 14 mars.', date_d_origine);
      obs := 'accepté';
    exception when others then obs := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_efface, dr, piece, null, 'cabinet', 'Une précision d''un compte retiré depuis.');
      obs2 := 'accepté';
    exception when others then obs2 := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select string_agg(coalesce(case k.auteur_id when client then 'le client' when chef then 'le chef' end, 'nul') || ' ' || k.origine
             || ' ' || (k.created_at = date_d_origine), ', ' order by k.id) into obs3
      from piece_commentaires k where k.dossier_id = dr;
    verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. le super-administrateur réinsère le commentaire d''un autre auteur (le client, à sa date d''origine) et celui d''un compte supprimé (auteur nul)',
      'observe', obs || ' | ' || obs2 || ' | ' || coalesce(obs3, 'rien'),
      'ok', obs = 'accepté' and obs2 = 'accepté' and obs3 = 'le client client true, nul cabinet false');

    -- 3. Le client : ni le commentaire d'un autre, ni le sien sous l'origine « cabinet » ; le sien, oui ; l'anonyme, rien.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_autre, dr, piece, chef, 'cabinet', 'Signé du cabinet par le client.');
      obs := 'ACCEPTÉ';
    exception when others then obs := sqlstate;
    end;
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_signe, dr, piece, client, 'cabinet', 'Le client sous l''origine du cabinet.');
      obs2 := 'ACCEPTÉ';
    exception when others then obs2 := sqlstate;
    end;
    begin
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_sien, dr, piece, client, 'client', 'Le mien.');
      obs3 := 'accepté';
    exception when others then obs3 := sqlstate || ' ' || sqlerrm;
    end;
    reset role;
    begin
      set local role anon;
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      insert into piece_commentaires (id, dossier_id, piece_id, auteur_id, origine, texte)
        values (c_anon, dr, piece, null, 'client', 'Sans session.');
      obs := obs || ' | anonyme ACCEPTÉ';
    exception when others then obs := obs || ' | anonyme ' || sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. le client n''insère ni le commentaire d''un autre ni le sien sous l''origine « cabinet » (42501) ; il insère le sien ; l''anonyme n''insère rien',
      'observe', 'un autre : ' || obs || ' | sous « cabinet » : ' || obs2 || ' | le sien : ' || obs3,
      'ok', obs = '42501 | anonyme 42501' and obs2 = '42501' and obs3 = 'accepté');

    -- 4. Personne ne réécrit un commentaire : le super-administrateur, puis le client sur le sien.
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    with t as (update piece_commentaires set texte = 'Réécrit.' where dossier_id = dr returning 1) select count(*) into n from t;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    with t as (update piece_commentaires set texte = 'Réécrit.' where id = c_sien returning 1) select count(*) into n2 from t;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    select string_agg(k.texte, ' / ' order by k.id) into obs from piece_commentaires k where k.dossier_id = dr;
    verdicts := verdicts || jsonb_build_object('rang', 4, 'etape', '4. personne ne réécrit un commentaire, pas même le super-administrateur : aucune ligne touchée, les textes relus',
      'observe', 'le super-administrateur : ' || n || ' | le client : ' || n2 || ' | ' || coalesce(obs, 'rien'),
      'ok', n = 0 and n2 = 0 and obs = 'Le ticket du 14 mars. / Une précision d''un compte retiré depuis. / Le mien.');

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('rang', 98, 'etape', '98. le jeu s''est déroulé jusqu''au bout', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni sa pièce, ni son accès, ni sa trace, ni ses commentaires',
    'ok', not exists (select 1 from dossiers where id = dr) and not exists (select 1 from pieces where id = piece)
      and not exists (select 1 from memberships where id = acces or dossier_id = dr)
      and not exists (select 1 from trace_des_droits where dossier_id = dr)
      and not exists (select 1 from piece_commentaires where dossier_id = dr or id in (c_client, c_efface, c_autre, c_signe, c_sien, c_anon)),
    'observe', 'relu');
  perform set_config('essai.restauration_commentaires', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.restauration_commentaires')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
