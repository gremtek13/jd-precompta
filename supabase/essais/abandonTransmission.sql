-- L'ABANDON D'UNE TRANSMISSION DONT L'ISSUE EST RESTÉE INCONNUE, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après
-- toute migration qui touche `abandonner_transmission`, `transmissions_factures` ou son déclencheur (ligne 28.5,
-- étape c, quatrième temps ; migration `abandon_d_une_transmission`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI PEUT ABANDONNER : un anonyme n'exécute pas la fonction ; un compte rattaché à rien et un client se font
--     refuser l'accès au dossier, nommément ; le chef du cabinet abandonne (le contrôle POSITIF), et la transmission
--     passe en échec avec son détail ;
--   - CE QUI NE S'ABANDONNE PAS : une transmission déposée, acceptée, rejetée ou déjà en échec ; un envoi de moins
--     d'un quart d'heure ; une transmission qui n'existe pas ;
--   - CE QUE L'ABANDON REND POSSIBLE : une nouvelle transmission de la même facture ;
--   - CE QUE LE CATALOGUE DIT : la fonction est `security definer` à `search_path` fixé, l'anonyme ne l'exécute pas,
--     le compte authentifié si ;
--   - et que RIEN ne reste en base après l'essai.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant le `raise`, comme rls.sql et transmissionsFactures.sql. Un refus se juge à son code ET à son message. Les
-- transmissions d'essai s'insèrent sous le rôle des Edge Functions (`service_role`), seules à en écrire.
--
-- ÉPROUVÉ LE 08/10/2026 : 13 contrôles sur 13 en production, rien laissé en base.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  empreinte text := repeat('ab', 32);

  facture_v uuid; dossier_f uuid; ident uuid;
  accepte boolean; code_recu text; message_recu text; obs text; motif text; code_attendu text; etat_depart text;
  anciennete interval; transmissions_avant int;
  verdicts jsonb := '[]'::jsonb;
begin
  select f.id, f.dossier_id into facture_v, dossier_f from factures_emises f where f.statut = 'validee' order by f.id limit 1;
  if facture_v is null then
    raise exception 'ESSAI_IMPOSSIBLE : il faut une facture validée';
  end if;
  if exists (select 1 from transmissions_factures where facture_id = facture_v) then
    raise exception 'ESSAI_IMPOSSIBLE : la facture d''essai porte déjà une transmission';
  end if;
  select count(*) into transmissions_avant from transmissions_factures;

  -- ══ 1 à 3. L'anonyme n'exécute pas la fonction ; le compte rattaché à rien et le client n'atteignent pas le dossier ═
  for obs, code_attendu, motif in
    select * from (values
      ('1. anonyme', '42501', 'permission denied for function abandonner_transmission'),
      ('2. rattaché à rien', '42501', 'Accès refusé à ce dossier.'),
      ('3. client', '42501', 'Accès refusé à ce dossier.')
    ) t(o, c, m)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, cree_le)
        values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, now() - interval '20 minutes')
        returning id into ident;
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu else client end, 'role', 'authenticated')::text, true);
      end if;
      perform abandonner_transmission(ident);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : n''abandonne pas',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and code_recu = code_attendu and message_recu = motif);
  end loop;

  -- ══ 4. Le chef abandonne un envoi de plus d'un quart d'heure : il passe en échec, avec son détail ═══════════════
  accepte := false; code_recu := null; message_recu := null; obs := null;
  begin
    set local role service_role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, cree_le)
      values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, now() - interval '20 minutes')
      returning id into ident;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select a.etat || ' : ' || a.detail into obs from abandonner_transmission(ident) a;
    reset role;
    select obs || ' | relu : ' || t.etat into obs from transmissions_factures t where t.id = ident;
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '4. le chef abandonne un envoi de plus d''un quart d''heure',
    'observe', coalesce(obs, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', accepte and code_recu = 'P0001'
      and obs = 'echec : Abandonnée par le cabinet, qui a vérifié que la plateforme ne l''a pas reçue : la facture peut repartir. | relu : echec');

  -- ══ 5 à 9. Ce qui ne s'abandonne pas ═════════════════════════════════════════════════════════════════════════
  for obs, etat_depart, anciennete, code_attendu, motif in
    select * from (values
      ('5. un envoi de cinq minutes', 'envoi', interval '5 minutes', '22023', 'Une transmission ne s''abandonne qu''un quart d''heure après son départ%'),
      ('6. une transmission déposée', 'depose', interval '1 hour', '22023', 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « depose »)%'),
      ('7. une transmission acceptée', 'accepte', interval '1 hour', '22023', 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « accepte »)%'),
      ('8. une transmission rejetée', 'rejete', interval '1 hour', '22023', 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « rejete »)%'),
      ('9. une transmission déjà en échec', 'echec', interval '1 hour', '22023', 'Seule une transmission dont l''issue est inconnue s''abandonne (celle-ci est « echec »)%')
    ) t(o, e, a, c, m)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id, cree_le)
        values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte, etat_depart,
                case when etat_depart in ('depose', 'accepte', 'rejete') then 'flux-1' end, now() - anciennete)
        returning id into ident;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform abandonner_transmission(ident);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne s''abandonne pas',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and code_recu = code_attendu and message_recu like motif);
  end loop;

  -- ══ 10. Une transmission qui n'existe pas ══════════════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message_recu := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform abandonner_transmission(gen_random_uuid());
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '10. une transmission qui n''existe pas',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', not accepte and code_recu = 'P0002' and message_recu = 'Transmission introuvable.');

  -- ══ 11. Abandonnée, la facture peut repartir ═══════════════════════════════════════════════════════════════════
  accepte := false; code_recu := null; message_recu := null;
  begin
    set local role service_role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, cree_le)
      values (dossier_f, facture_v, 'superpdp', 'api.superpdp.tech', empreinte, now() - interval '20 minutes')
      returning id into ident;
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    perform abandonner_transmission(ident);
    set local role service_role;
    insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256)
      values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', empreinte);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '11. abandonnée, la facture peut repartir',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
    'ok', accepte and code_recu = 'P0001');

  -- ══ 12. Ce que le catalogue dit ════════════════════════════════════════════════════════════════════════════════
  select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
      || has_function_privilege('anon', p.oid, 'execute')::text || ' '
      || has_function_privilege('authenticated', p.oid, 'execute')::text into obs
    from pg_proc p where p.oid = 'public.abandonner_transmission(uuid)'::regprocedure;
  verdicts := verdicts || jsonb_build_object('controle', '12. catalogue : security definer, search_path fixé, anonyme exclu',
    'observe', obs, 'ok', obs = 'true search_path=public false true');

  -- ══ 13. Rien n'est resté ══════════════════════════════════════════════════════════════════════════════════════
  verdicts := verdicts || jsonb_build_object('controle', '13. rien n''est resté en base',
    'observe', 'transmissions ' || transmissions_avant || ' -> ' || (select count(*) from transmissions_factures),
    'ok', transmissions_avant = (select count(*) from transmissions_factures));

  perform set_config('essai.abandon', verdicts::text, true);
end $$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.abandon')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
