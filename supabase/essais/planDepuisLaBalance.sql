-- LA REPRISE RANGÉE SUR LE PLAN DU DOSSIER (ligne 43, étape PC6 ; la migration `plan_depuis_la_balance`, PRÉPARÉE le
-- 11/11/2026). Le récit : HISTORIQUE.md, « 11/11/2026 — PC6 : LA REPRISE PROPOSE LE PLAN (PRÉPARÉE, PAS APPLIQUÉE) ». À
-- rejouer après toute migration qui touche `enregistrer_a_nouveaux`, `a_nouveaux`, le plan des dossiers ou `compte_du_role`.
--
-- Ce qui se prouve ici : sous le plan par défaut puis sous un plan réglé (`regler_plan_du_dossier`), le chef du cabinet
-- enregistre des à-nouveaux rangés sur le plan, et `enregistrer_a_nouveaux` refuse (23514), à ses mots, un 512… hors de la
-- banque du plan, un 53… hors de sa caisse, un compte égal à des zéros près au compte d'un rôle sans lui être égal — la
-- banque d'abord, la première ligne fautive de la liste, le plan avant l'équilibre ; un autre sous-compte passe ; une
-- ligne hors du bilan reste à la contrainte de la table ; le client n'enregistre rien ; avec plusieurs comptes bancaires
-- (MCB1 en base ; sans elle, les deux étapes se disent justes sans se jouer), le 512 propre d'un second compte se refuse
-- comme toute autre banque. Un dossier jetable du cabinet du dossier `test` (préfixe `c6000000-0000-4000-8000`) ; chaque
-- étape s'annule (`ANNULATION_ETAPE`), le jeu aussi (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Aucune
-- instruction de suppression écrite ici (celle du corps de la fonction ne voit que le dossier jetable) ; rien ne se rend
-- qui dépende d'une ligne hors de lui. Hors de l'outil d'exécution, en UNE transaction (`psql -1`). Sans la migration, une
-- ligne dit qu'il attend (EN ATTENTE). La course de deux sessions (un réglage du plan contre un enregistrement) se joue à
-- part, sur une réplique : HISTORIQUE.md, même entrée.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'c6000000-0000-4000-8000-0000000000d1';
  acces_a constant text := 'c6000000-0000-4000-8000-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb)')
                    and position('sans être celle du plan de ce dossier' in p.prosrc) > 0) then
    perform set_config('essai.plan_depuis_la_balance', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration plan_depuis_la_balance', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id) values (da::uuid, 'ESSAI PC6 DA', cabinet);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-pc6-a@example.test');

    -- {rang, étape, profil, plan réglé d'abord (ou nul), un second compte bancaire d'abord, requête, code attendu, ce
    -- qu'elle rend (« ~ » : le message le contient)}.
    for e in select * from (values
      (1, '1. plan par défaut : la banque et le capital du plan passent', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (2, '2. un 512100 n''est pas la banque du plan (512000)', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512100", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 512100 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512000 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (3, '3. un 5120, banque écrite sur quatre chiffres, non plus', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "5120", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 5120 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512000 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (4, '4. le 4455100 est le 445510 de la TVA à décaisser, à des zéros près', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "4455100", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 4455100 » de ces à-nouveaux est, à des zéros près, le compte « 445510 » du rôle « tva_a_decaisser » dans le plan de ce dossier : il s''ouvre sous ce numéro.'),
      (5, '5. le 445510 lui-même passe', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "445510", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (6, '6. le 1640000 est le 164000 de l''emprunt', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "1640000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 1640000 » de ces à-nouveaux est, à des zéros près, le compte « 164000 » du rôle « emprunt » dans le plan de ce dossier : il s''ouvre sous ce numéro.'),
      (7, '7. un autre sous-compte sous la racine d''un rôle (4011) s''ouvre tel quel', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "4011", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (8, '8. un 531000 n''est pas la caisse du plan (530000)', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "531000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 531000 » de ces à-nouveaux est une caisse (53…) sans être celle du plan de ce dossier (« 530000 ») : toute caisse de la balance s''ouvre sur la caisse du plan, réunie.'),
      (9, '9. le 530000 passe', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "530000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (10, '10. l''ordre des refus : la banque avant l''équivalent, quel que soit l''ordre des lignes', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "4455100", "sens": "credit", "montant": 100}, {"compte": "512100", "sens": "debit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 512100 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512000 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (11, '11. dans un refus, la première ligne fautive de la liste', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512300", "sens": "debit", "montant": 50}, {"compte": "512100", "sens": "debit", "montant": 50}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 512300 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512000 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (12, '12. une ligne hors du bilan (6611, le 661100 des intérêts à des zéros près) reste refusée par la contrainte de la table, pas par le plan', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "6611", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', '~a_nouveaux_compte_check'),
      (13, '13. l''équilibre se juge encore', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 90}]'::jsonb)::text$q$, '23514', '~À-nouveaux déséquilibrés'),
      (14, '14. le plan se juge avant l''équilibre', 'chef', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "4455100", "sens": "credit", "montant": 90}]'::jsonb)::text$q$, '23514', 'Le compte « 4455100 » de ces à-nouveaux est, à des zéros près, le compte « 445510 » du rôle « tva_a_decaisser » dans le plan de ce dossier : il s''ouvre sous ce numéro.'),
      (15, '15. le client n''enregistre rien', 'client', null, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '42501', 'Accès refusé à ce dossier.'),
      (16, '16. plan réglé : sa banque 512100 passe', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512100", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (17, '17. plan réglé : le 512000 du catalogue n''est plus la banque', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 512000 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512100 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (18, '18. plan réglé : le 4011 est le 401100 des fournisseurs, à des zéros près', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512100", "sens": "debit", "montant": 100}, {"compte": "4011", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 4011 » de ces à-nouveaux est, à des zéros près, le compte « 401100 » du rôle « fournisseurs » dans le plan de ce dossier : il s''ouvre sous ce numéro.'),
      (19, '19. plan réglé : le 401100 passe', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512100", "sens": "debit", "montant": 100}, {"compte": "401100", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (20, '20. plan réglé : le 401000 n''est qu''un autre sous-compte, il passe', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512100", "sens": "debit", "montant": 100}, {"compte": "401000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (21, '21. plan réglé : sa caisse 531000 passe', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "531000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2'),
      (22, '22. plan réglé : le 530000 n''est plus la caisse', 'chef', $p$[{"role":"banque","compte":"512100"},{"role":"fournisseurs","compte":"401100"},{"role":"caisse","compte":"531000"}]$p$, false,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "530000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 530000 » de ces à-nouveaux est une caisse (53…) sans être celle du plan de ce dossier (« 531000 ») : toute caisse de la balance s''ouvre sur la caisse du plan, réunie.'),
      (23, '23. plusieurs comptes bancaires : le 512 propre d''un second compte ne s''ouvre pas en à-nouveau (l''éclatement l''ouvre)', 'chef', null, true,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512200", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, '23514', 'Le compte « 512200 » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« 512000 ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.'),
      (24, '24. plusieurs comptes bancaires : la banque du rôle, celle du principal, passe', 'chef', null, true,
        $q$select enregistrer_a_nouveaux('{DA}', '2026-01-01', 'essai.csv', repeat('a', 64), '[{"compte": "512000", "sens": "debit", "montant": 100}, {"compte": "101000", "sens": "credit", "montant": 100}]'::jsonb)::text$q$, 'OK', '2')
    ) as t(rang, etape, profil, plan, mcb, requete, attendu, rend)
    loop
      v_code := 'OK'; v_obs := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        if e.plan is not null then
          perform regler_plan_du_dossier(da::uuid, e.plan::jsonb);
        end if;
        if e.mcb then
          if to_regclass('public.comptes_bancaires') is null then
            raise exception 'SANS_COMPTES_BANCAIRES';
          end if;
          execute format('insert into comptes_bancaires (dossier_id, libelle, principal) values (%L, %L, true)', da, 'Compte courant');
          execute format('insert into comptes_bancaires (dossier_id, libelle, principal, compte, compte_propre_depuis) values (%L, %L, false, %L, %L)',
            da, 'Livret', '512200', '2026-01-01');
        end if;
        if e.profil = 'client' then
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        end if;
        begin
          execute replace(e.requete, '{DA}', da) into v_obs;
        exception when others then
          v_code := sqlstate; v_obs := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if sqlerrm = 'SANS_COMPTES_BANCAIRES' then
          v_code := e.attendu; v_obs := e.rend;
        elsif sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'PREPARATION ' || sqlstate; v_obs := sqlerrm;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.attendu and case when left(e.rend, 1) = '~' then position(substr(e.rend, 2) in coalesce(v_obs, '')) > 0
                                          else coalesce(v_obs, '') = e.rend end,
        'observe', v_code || ' ' || coalesce(v_obs, ''));
    end loop;

    verdicts := verdicts || jsonb_build_object('rang', 30, 'etape', '30. le catalogue : aux droits de l''appelant, chemin public, exécutable par authenticated seul',
      'ok', (select not p.prosecdef and p.proconfig = array['search_path=public']
                    and has_function_privilege('authenticated', p.oid, 'execute')
                    and not has_function_privilege('anon', p.oid, 'execute')
               from pg_proc p where p.oid = 'public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb)'::regprocedure),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni l''accès, ni ses à-nouveaux, ni son plan',
    'ok', not exists (select 1 from dossiers where id = da::uuid)
      and not exists (select 1 from memberships where id = acces_a::uuid)
      and not exists (select 1 from a_nouveaux where dossier_id = da::uuid)
      and not exists (select 1 from plan_comptable_dossier where dossier_id = da::uuid),
    'observe', 'relu');
  perform set_config('essai.plan_depuis_la_balance', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.plan_depuis_la_balance')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
