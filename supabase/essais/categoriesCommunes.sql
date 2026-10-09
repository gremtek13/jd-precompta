-- LES CATÉGORIES ET LES NATURES COMMUNES À TOUS LES CABINETS, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après
-- toute migration qui touche les policies de `categories` ou de `natures_immobilisation`, `is_super_admin` ou
-- `admin_du_dossier`.
--
-- Une catégorie ou une nature dont `dossier_id` est nul n'appartient à aucun cabinet : les deux tables n'ont pas de
-- `cabinet_id`, et ces lignes sont communes à l'application entière. Leurs policies d'écriture ne laissent passer que
-- le super-administrateur (`dossier_id is null and is_super_admin()`). Ce qui se prouve ici, et que la conception du
-- plan comptable personnalisable n'avait que DÉDUIT des policies (HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE :
-- LA CONCEPTION », §8 point 9) :
--   - un CHEF DE CABINET qui n'est pas super-administrateur qui écrit le compte ou le poste d'une catégorie commune,
--     ou le compte d'une nature commune, ne modifie AUCUNE ligne, et la base ne lève RIEN : PostgREST rend alors un
--     succès, et l'écran qui ne lit que `{ error }` (« Comptes manquants », « Postes manquants », « Postes sans case »)
--     perdait l'enregistrement sans un mot. Lue avec la ligne modifiée (`returning`, ce que fait `.select('id')`), la
--     même écriture rend ZÉRO ligne : c'est ainsi que l'écran le sait désormais ;
--   - le même chef écrit bien une catégorie de SON dossier (le contrôle POSITIF : sans lui, les zéros seraient
--     satisfaits par un harnais qui ne laisse rien écrire), et le super-administrateur écrit bien la catégorie commune ;
--   - et que RIEN ne reste en base.
--
-- LE CHEF D'ESSAI est le compte client du jeu, rattaché au cabinet comme chef le temps d'un bloc qui s'annule : la base
-- n'a qu'un chef, qui est aussi super-administrateur. Rien n'élargit un droit hors de ce bloc. Chaque contrôle s'annule
-- dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict étant posé dans une VARIABLE avant le `raise` — le
-- mécanisme de rls.sql. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.categories_communes`), que
-- la requête finale lit : le fichier se joue d'un seul appel, et ne crée aucune table. Il ne porte aucune instruction de
-- suppression.
--
-- ÉPROUVÉ LE 09/10/2026 en production : 9 contrôles sur 9 ; le texte reçu par la base (ligne 0 : 9 216 caractères,
-- empreinte 1c69bbeeec09dc81819609a3e1cfad0b) est ce fichier sans ses lignes de commentaire, caractère pour caractère.
-- Et l'essai sait échouer : sans le passage au rôle `authenticated` (la mise à jour jouée par le propriétaire des
-- tables, qui passe la RLS), les contrôles 2 à 5 virent au rouge, une ligne modifiée chacun.
do $$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';

  dossier_client uuid; cabinet uuid; categorie_commune uuid; nature_commune uuid; categorie_dossier uuid;
  compte_avant text; poste_avant text; nature_avant text; admins_avant int; categories_avant int; natures_avant int;
  code_recu text; message text; obs text; n int; rendue uuid; est_chef boolean; est_super boolean;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_client;
  select id, compte_comptable, poste_2035 into categorie_commune, compte_avant, poste_avant
    from categories where dossier_id is null order by ordre, id limit 1;
  select id, compte_immobilisation into nature_commune, nature_avant
    from natures_immobilisation where dossier_id is null order by ordre, id limit 1;
  if dossier_client is null or cabinet is null or categorie_commune is null or nature_commune is null
     or exists (select 1 from cabinet_admins where user_id = client) or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou compte client déjà rattaché au cabinet';
  end if;
  select count(*) into admins_avant from cabinet_admins;
  select count(*) into categories_avant from categories;
  select count(*) into natures_avant from natures_immobilisation;

  -- ══ 1. Le chef d'essai est un chef du cabinet, et n'est pas super-administrateur ═══════════════════════════
  begin
    code_recu := null; message := null; obs := null;
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    est_chef := est_chef_du_cabinet(cabinet);
    est_super := is_super_admin();
    obs := 'chef ' || est_chef || ', super-administrateur ' || est_super || ', son dossier ' || admin_du_dossier(dossier_client);
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '1. le chef d''essai est chef du cabinet, pas super-administrateur',
    'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
    'ok', coalesce(code_recu = 'P0001' and obs = 'chef true, super-administrateur false, son dossier true', false));

  -- ══ 2 à 4. Ce chef écrit une ligne commune : aucune ligne modifiée, et aucune erreur ═══════════════════════
  for obs in select unnest(array['2. le compte d''une catégorie commune', '3. le poste d''une catégorie commune',
                                 '4. le compte d''une nature commune']) loop
    code_recu := null; message := null; n := null;
    begin
      insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
      case substring(obs from '^(\d+)')
        when '2' then update categories set compte_comptable = '606199' where id = categorie_commune;
        when '3' then update categories set poste_2035 = 'Poste d''essai' where id = categorie_commune;
        else update natures_immobilisation set compte_immobilisation = '218399' where id = nature_commune;
      end case;
      get diagnostics n = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : aucune ligne modifiée, aucune erreur',
      'observe', coalesce(n || ' ligne(s), ', '') || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(n = 0 and code_recu = 'P0001' and message = 'ANNULATION_ESSAI', false));
  end loop;

  -- ══ 5. Lue avec sa ligne (`returning`, ce que fait `.select('id')`), la même écriture n'en rend aucune ═════
  code_recu := null; message := null; rendue := null; n := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update categories set compte_comptable = '606199' where id = categorie_commune returning id into rendue;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. lue avec sa ligne, l''écriture d''une catégorie commune n''en rend aucune',
    'observe', coalesce(n || ' ligne(s) rendue(s), ', '') || coalesce(rendue::text, 'aucun identifiant') || ', ' || coalesce(code_recu, '?'),
    'ok', coalesce(n = 0 and rendue is null and code_recu = 'P0001', false));

  -- ══ 6. Le contrôle POSITIF : le même chef écrit une catégorie de SON dossier ═══════════════════════════════
  code_recu := null; message := null; rendue := null; n := null;
  begin
    insert into cabinet_admins (user_id, cabinet_id, role) values (client, cabinet, 'comptable_en_chef');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    insert into categories (dossier_id, code, libelle, ordre) values (dossier_client, 'essai_communes', 'Catégorie d''essai', 999)
      returning id into categorie_dossier;
    update categories set compte_comptable = '606199' where id = categorie_dossier returning id into rendue;
    get diagnostics n = row_count;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '6. le même chef écrit une catégorie de son dossier',
    'observe', coalesce(n || ' ligne(s) rendue(s), ', '') || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
    'ok', coalesce(n = 1 and rendue = categorie_dossier and code_recu = 'P0001', false));

  -- ══ 7 et 8. Le super-administrateur, lui, écrit la catégorie et la nature communes ═════════════════════════
  for obs in select unnest(array['7. le super-administrateur écrit le compte d''une catégorie commune',
                                 '8. le super-administrateur écrit le compte d''une nature commune']) loop
    code_recu := null; message := null; n := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      if obs like '7.%' then
        update categories set compte_comptable = '606199' where id = categorie_commune;
      else
        update natures_immobilisation set compte_immobilisation = '218399' where id = nature_commune;
      end if;
      get diagnostics n = row_count;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs,
      'observe', coalesce(n || ' ligne(s), ', '') || coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(n = 1 and code_recu = 'P0001' and message = 'ANNULATION_ESSAI', false));
  end loop;

  -- ══ 9. Rien n'est resté ════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '9. rien n''est resté en base',
    'observe', 'chefs ' || admins_avant || ' -> ' || (select count(*) from cabinet_admins)
      || ', catégories ' || categories_avant || ' -> ' || (select count(*) from categories)
      || ', natures ' || natures_avant || ' -> ' || (select count(*) from natures_immobilisation)
      || ', ligne commune intacte ' || (select (compte_comptable is not distinct from compte_avant and poste_2035 is not distinct from poste_avant)::text
                                        from categories where id = categorie_commune)
      || ', nature commune intacte ' || (select (compte_immobilisation = nature_avant)::text from natures_immobilisation where id = nature_commune),
    'ok', coalesce(admins_avant = (select count(*) from cabinet_admins)
      and categories_avant = (select count(*) from categories)
      and natures_avant = (select count(*) from natures_immobilisation)
      and not exists (select 1 from cabinet_admins where user_id = client)
      and (select compte_comptable is not distinct from compte_avant and poste_2035 is not distinct from poste_avant
           from categories where id = categorie_commune)
      and (select compte_immobilisation = nature_avant from natures_immobilisation where id = nature_commune), false));

  perform set_config('essai.categories_communes', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer est une faute, pas un silence. La ligne 0 dit le texte que la base a reçu — par
-- l'outil MCP, qui ajoute sa signature après lui —, pour le comparer au fichier sans ses lignes de commentaire
-- (`grep -v '^\s*--'`) par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.categories_communes')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
