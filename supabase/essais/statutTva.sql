-- LE STATUT DE TVA D'UN DOSSIER, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `dossiers.statut_tva`, `dossiers.article_exoneration`, `dossiers.assujetti_tva` ou le déclencheur
-- `dossiers_deduire_assujetti_tva` (ligne 28.5 de la feuille de route, étape a : redevable, franchise en base,
-- exonéré).
--
-- Le statut fait foi et `assujetti_tva` en est déduit. Ce qui se prouve ici, et ne se relit pas :
--   - QUI peut le changer : ni un anonyme, ni un compte rattaché à rien, ni un client — sur le dossier d'un
--     autre comme sur le SIEN —, et le chef du cabinet, si (le contrôle POSITIF) ;
--   - CE QUE LE DÉCLENCHEUR DÉDUIT : le booléen depuis le statut, dans les trois statuts et à la création ; et,
--     pour les écrivains qui ne connaissent que le booléen (une création sans statut, une sauvegarde d'avant le
--     statut, une fenêtre ouverte avant lui), le statut qu'il implique — redevable, ou à préciser, jamais
--     franchise ni exonéré, qu'on ne devine pas ;
--   - CE QUE LES CONTRAINTES REFUSENT SEULES : un statut ou un article hors de la liste, un article sur un statut
--     qui ne le permet pas — jamais effacé en silence quand c'est le statut qu'on change ;
--   - que les dossiers EXISTANTS sont cohérents : tout dossier assujetti est redevable, et seul lui ;
--   - CE QUE LE CATALOGUE DIT : la fonction du déclencheur n'est appelable par personne ;
--   - et que RIEN ne reste en base après l'essai.
--
-- LE JEU est un dossier JETABLE dans le cabinet du chef. Il vit dans un bloc qui s'annule en entier à la fin
-- (`ANNULATION_JEU`), et chaque contrôle s'annule à son tour dans sa sous-transaction (`ANNULATION_ESSAI`, P0001),
-- le verdict étant posé dans une VARIABLE avant le `raise` — le mécanisme de rls.sql. Un refus se juge à son code
-- ET au nom de la contrainte. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.statut_tva`),
-- que la requête finale lit : le fichier se joue d'un seul appel, et ne crée aucune table.
--
-- CHAQUE VERDICT PASSE PAR `coalesce(…, false)`, et ce n'est pas du zèle : un contrôle qui lève laisse son
-- observation nulle, une comparaison avec NULL rend NULL, et un verdict NULL n'est ni vert ni rouge — la requête
-- finale l'afficherait vide. Trois mutations de la migration passaient ainsi inaperçues au premier jet.
--
-- ÉPROUVÉ LE 07/10/2026 : 17 contrôles sur 17 en production (dossiers 4 → 4), le texte transmis identique au
-- fichier, et 17 sur 17 sur une réplique locale du schéma, où les NEUF mutations de la migration mordent : le
-- passage au rôle anonyme retiré (de l'essai), le booléen non déduit d'un statut changé, puis d'une création qui
-- porte un statut, le statut non déduit de l'ancien booléen, puis d'une création assujettie, l'article non
-- effacé avec le statut, l'article admis sur un statut nul (sans `coalesce`), un statut inconnu admis, et la
-- fonction du déclencheur laissée appelable. Il ne porte aucune instruction de suppression.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_test uuid := '001c7ed7-c23b-4590-901e-693489f8af24';

  dossier_client uuid; cabinet uuid; dossier_e uuid; dossier_n uuid;
  accepte boolean; code_recu text; message text; obs text; n int;
  dossiers_avant int; incoherents int;
  verdicts jsonb := '[]'::jsonb;
begin
  select m.dossier_id into dossier_client from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select cabinet_id into cabinet from dossiers where id = dossier_test;
  if dossier_client is null or cabinet is null or dossier_client = dossier_test then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select count(*) into dossiers_avant from dossiers;

  -- ══ 1. Les dossiers existants ════════════════════════════════════════════════════════════════════════════
  select count(*) into incoherents from dossiers
   where assujetti_tva <> coalesce(statut_tva = 'redevable', false)
      or (article_exoneration is not null and coalesce(statut_tva, '') not in ('exonere', 'redevable'));
  verdicts := verdicts || jsonb_build_object('controle', '1. les dossiers existants sont cohérents',
    'observe', incoherents || ' incohérent(s)', 'ok', coalesce(incoherents = 0, false));

  begin
    -- ══ Le jeu ════════════════════════════════════════════════════════════════════════════════════════════
    insert into dossiers (nom, cabinet_id, code_email) values ('ESSAI STATUT TVA', cabinet, 'essai-statut-' || substr(md5(random()::text), 1, 10))
      returning id into dossier_e;

    -- ══ 2 à 4. Qui ne peut pas le changer ══════════════════════════════════════════════════════════════════
    begin
      accepte := false; code_recu := null; message := null;
      set local role anon;
      perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
      update dossiers set statut_tva = 'franchise' where id = dossier_e;
      get diagnostics n = row_count;
      accepte := n > 0;
      obs := n || ' ligne(s) modifiée(s)';
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '2. un anonyme ne change rien',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', coalesce(not accepte and (obs = '0 ligne(s) modifiée(s)' or code_recu = '42501'), false));

    for obs in select unnest(array['3. un compte rattaché à rien ne change rien', '4. un client ne change rien, même sur son dossier']) loop
      begin
        accepte := false; code_recu := null; message := null;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', case when obs like '3.%' then inconnu else client end,
          'role','authenticated')::text, true);
        update dossiers set statut_tva = 'franchise' where id in (dossier_e, dossier_client);
        get diagnostics n = row_count;
        accepte := n > 0;
        message := n || ' ligne(s) modifiée(s)';
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(message, code_recu),
        'ok', coalesce(not accepte and message = '0 ligne(s) modifiée(s)', false));
    end loop;

    -- ══ 5 à 7. Le chef change le statut, le booléen suit ═══════════════════════════════════════════════════
    begin
      code_recu := null; message := null; obs := null;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      update dossiers set statut_tva = 'exonere', article_exoneration = 'cgi_261_4_1' where id = dossier_e;
      select concat_ws(' ', statut_tva, article_exoneration, assujetti_tva::text) into obs from dossiers where id = dossier_e;
      update dossiers set statut_tva = 'redevable' where id = dossier_e;
      select obs || ' | ' || concat_ws(' ', statut_tva, article_exoneration, assujetti_tva::text) into obs from dossiers where id = dossier_e;
      update dossiers set statut_tva = 'franchise', article_exoneration = null where id = dossier_e;
      select obs || ' | ' || concat_ws(' ', statut_tva, coalesce(article_exoneration, '-'), assujetti_tva::text) into obs from dossiers where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '5. le chef choisit exonéré, puis redevable, puis franchise',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')),
      'ok', coalesce(obs = 'exonere cgi_261_4_1 false | redevable cgi_261_4_1 true | franchise - false', false));

    begin
      code_recu := null; message := null; obs := null;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role','authenticated')::text, true);
      update dossiers set statut_tva = 'franchise', assujetti_tva = true where id = dossier_e;
      select concat_ws(' ', statut_tva, assujetti_tva::text) into obs from dossiers where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '6. un booléen envoyé en désaccord est recalculé depuis le statut',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'franchise false', false));

    -- ══ 7 à 9. Ce que les contraintes refusent seules ══════════════════════════════════════════════════════
    begin
      code_recu := null; message := null;
      update dossiers set statut_tva = 'exonere', article_exoneration = 'cgi_261_4_1' where id = dossier_e;
      update dossiers set statut_tva = 'franchise' where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '7. passer en franchise sans retirer l''article est refusé, jamais effacé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = '23514' and message like '%dossiers_article_exoneration_coherent%', false));

    begin
      code_recu := null; message := null;
      update dossiers set statut_tva = 'autre' where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '8. un statut hors de la liste est refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = '23514' and message like '%dossiers_statut_tva_check%', false));

    begin
      code_recu := null; message := null;
      update dossiers set statut_tva = 'exonere', article_exoneration = 'cgi_999' where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '9. un article hors de la liste est refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = '23514' and message like '%dossiers_article_exoneration_check%', false));

    -- ══ 10 et 11. Une fenêtre d'avant le statut, qui ne bascule que le booléen ═════════════════════════════
    begin
      code_recu := null; message := null; obs := null;
      update dossiers set statut_tva = 'exonere', article_exoneration = 'cgi_261_4_1' where id = dossier_e;
      update dossiers set assujetti_tva = true where id = dossier_e;
      select concat_ws(' ', statut_tva, coalesce(article_exoneration, '-'), assujetti_tva::text) into obs from dossiers where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '10. l''ancien booléen à vrai rend le dossier redevable, article gardé',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'redevable cgi_261_4_1 true', false));

    begin
      code_recu := null; message := null; obs := null;
      update dossiers set statut_tva = 'redevable', article_exoneration = 'cgi_261_4_1' where id = dossier_e;
      update dossiers set assujetti_tva = false where id = dossier_e;
      select concat_ws(' ', coalesce(statut_tva, 'à préciser'), coalesce(article_exoneration, '-'), assujetti_tva::text) into obs
        from dossiers where id = dossier_e;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '11. l''ancien booléen à faux laisse le statut à préciser, sans deviner',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'à préciser - false', false));

    -- ══ 12 à 15. À la création ═════════════════════════════════════════════════════════════════════════════
    begin
      code_recu := null; message := null; obs := null;
      insert into dossiers (nom, cabinet_id, code_email) values ('ESSAI STATUT TVA', cabinet, 'essai-statut-' || substr(md5(random()::text), 1, 10))
        returning concat_ws(' ', coalesce(statut_tva, 'à préciser'), assujetti_tva::text) into obs;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '12. une création sans statut est à préciser',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'à préciser false', false));

    begin
      code_recu := null; message := null; obs := null;
      insert into dossiers (nom, cabinet_id, code_email, assujetti_tva) values ('ESSAI STATUT TVA', cabinet, 'essai-statut-' || substr(md5(random()::text), 1, 10), true)
        returning concat_ws(' ', coalesce(statut_tva, 'à préciser'), assujetti_tva::text) into obs;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '13. un dossier assujetti d''avant le statut (sauvegarde) devient redevable',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'redevable true', false));

    begin
      code_recu := null; message := null; obs := null;
      insert into dossiers (nom, cabinet_id, code_email, assujetti_tva, statut_tva, article_exoneration)
        values ('ESSAI STATUT TVA', cabinet, 'essai-statut-' || substr(md5(random()::text), 1, 10), true, 'exonere', 'cgi_261_4_1')
        returning concat_ws(' ', statut_tva, article_exoneration, assujetti_tva::text) into obs;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '14. à la création aussi, le statut fait foi',
      'observe', coalesce(obs, coalesce(code_recu, '?') || ' ' || coalesce(message, '')), 'ok', coalesce(obs = 'exonere cgi_261_4_1 false', false));

    begin
      code_recu := null; message := null;
      insert into dossiers (nom, cabinet_id, code_email, article_exoneration)
        values ('ESSAI STATUT TVA', cabinet, 'essai-statut-' || substr(md5(random()::text), 1, 10), 'cgi_261_4_1')
        returning id into dossier_n;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message := sqlerrm;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '15. un article sans statut est refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message, ''),
      'ok', coalesce(code_recu = '23514' and message like '%dossiers_article_exoneration_coherent%', false));

    raise exception 'ANNULATION_JEU';
  exception when others then
    if sqlerrm <> 'ANNULATION_JEU' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le jeu a échoué', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;

  -- ══ 16. Ce que le catalogue dit ═══════════════════════════════════════════════════════════════════════════
  select concat_ws(', ', case when p.prosecdef then 'security definer' else 'security invoker' end,
      'anon ' || has_function_privilege('anon', p.oid, 'execute'),
      'authenticated ' || has_function_privilege('authenticated', p.oid, 'execute'))
    into obs from pg_proc p where p.oid = 'public.deduire_assujetti_tva()'::regprocedure;
  verdicts := verdicts || jsonb_build_object('controle', '16. catalogue : la fonction du déclencheur, appelable par personne',
    'observe', obs, 'ok', coalesce(obs = 'security invoker, anon false, authenticated false', false));

  -- ══ 17. Rien n'est resté ═══════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '17. rien n''est resté en base',
    'observe', 'dossiers ' || dossiers_avant || ' -> ' || (select count(*) from dossiers),
    'ok', coalesce(dossiers_avant = (select count(*) from dossiers) and not exists (select 1 from dossiers where nom = 'ESSAI STATUT TVA'), false));

  perform set_config('essai.statut_tva', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.statut_tva')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
