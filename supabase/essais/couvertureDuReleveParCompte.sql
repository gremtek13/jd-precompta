-- LA COUVERTURE DU RELEVÉ, COMPTE PAR COMPTE (ligne 26.6, lot MCB4 ; la migration `couverture_du_releve_par_compte`, en
-- production depuis le 12/11/2026, qui suit `comptes_bancaires` et `fin_d_identifiant_des_comptes_bancaires`). Le récit : HISTORIQUE.md,
-- « 11/11/2026 — LA SUITE DES SOLDES, LE 31 DÉCEMBRE, LA COUVERTURE ET LA VALIDATION PAR COMPTE BANCAIRE (MCB4) ». À rejouer
-- après toute migration qui touche `couverture_du_releve`, `comptes_bancaires` ou `lignes_bancaires`.
--
-- Ce qui se prouve ici : un dossier à un compte rend les mois de ses mouvements, comme hier ; à deux comptes, un mois n'est
-- couvert que si chaque compte qui l'attend y porte un mouvement — le principal toujours (sans date d'ouverture), un autre
-- compte depuis son premier mouvement, ou depuis son ouverture quand elle est dite, jusqu'à sa clôture ; le client sans
-- « Banque » reçoit la même couverture que le cabinet (des dates, rien d'autre) ; un inconnu se refuse (42501) ; le
-- catalogue (définisseur, `search_path`, exécution retirée à `anon`). Un dossier jetable du cabinet du dossier `test` (préfixe
-- `cb140000-0000-4000-8000`), dont l'accès du client d'essai ne porte AUCUNE case ; chaque étape s'annule
-- (`ANNULATION_ETAPE`), le jeu aussi (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Aucune instruction de
-- suppression ; rien ne se rend qui dépende d'une ligne hors du dossier jetable. Hors de l'outil d'exécution, en UNE
-- transaction (`psql -1`). Sans la migration, une ligne dit qu'il attend (EN ATTENTE).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  inconnu constant text := 'cb140000-0000-4000-8000-0000000000ff';
  da constant text := 'cb140000-0000-4000-8000-0000000000d1';
  acces_a constant text := 'cb140000-0000-4000-8000-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
  -- Les mouvements du principal, puis le second compte « B » et les siens : {M} est la liste des mois du principal, {B} le
  -- second compte (ses colonnes), {MB} ses mois. Le premier mouvement crée le principal (MCB1).
  principal constant text := $p$insert into lignes_bancaires (dossier_id, date, libelle, montant)
    select '{DA}', m::date, 'ESSAI MCB4 P', -10 from unnest('{M}'::date[]) m;$p$;
  second constant text := $p$insert into comptes_bancaires (id, dossier_id, libelle, principal, compte, compte_propre_depuis, ouvert_le, clos_le)
    values ('cb140000-0000-4000-8000-0000000000b1', '{DA}', 'ESSAI B', false, '512100', '2027-01-01', {B});
    insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant)
    select '{DA}', 'cb140000-0000-4000-8000-0000000000b1', m::date, 'ESSAI MCB4 B', -20 from unnest('{MB}'::date[]) m;$p$;
  couverture constant text := $q$select coalesce(array_to_string(couverture_du_releve('{DA}'), ','), '')$q$;
begin
  if not exists (select 1 from pg_proc where proname = 'couverture_du_releve' and prosrc like '%comptes_bancaires%') then
    perform set_config('essai.couverture_par_compte', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration couverture_du_releve_par_compte', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id) values (da::uuid, 'ESSAI MCB4 DA', cabinet);
    insert into memberships (id, user_id, dossier_id, role, email) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-mcb4-a@example.test');

    -- {rang, étape, profil, mois du principal, second compte (null : aucun), ses mois, après (sous le chef), code, rendu}.
    for e in select * from (values
      (1, '1. un seul compte : les mois de ses mouvements, comme hier', 'chef',
        '{2026-01-10,2026-03-05}', null, null, '', 'OK', '2026-01-01,2026-03-01'),
      (2, '2. un second compte sans date attend depuis son premier mouvement : janvier reste couvert', 'chef',
        '{2026-01-10,2026-02-10,2026-03-10}', 'null, null', '{2026-02-11,2026-03-11}', '', 'OK', '2026-01-01,2026-02-01,2026-03-01'),
      (3, '3. le trou du second compte (mars) n''est plus couvert par le principal', 'chef',
        '{2026-01-10,2026-02-10,2026-03-10,2026-04-10}', 'null, null', '{2026-02-11,2026-04-11}', '', 'OK', '2026-01-01,2026-02-01,2026-04-01'),
      (4, '4. le trou du principal (février) n''est plus couvert par le second', 'chef',
        '{2026-01-10,2026-03-10}', 'null, null', '{2026-01-11,2026-02-11,2026-03-11}', '', 'OK', '2026-01-01,2026-03-01'),
      (5, '5. un second compte ouvert le 15 janvier attend janvier et février, sans mouvement avant mars', 'chef',
        '{2026-01-10,2026-02-10,2026-03-10}', '''2026-01-15'', null', '{2026-03-11}', '', 'OK', '2026-03-01'),
      (6, '6. un second compte clos le 20 février n''attend plus mars ni avril', 'chef',
        '{2026-01-10,2026-02-10,2026-03-10,2026-04-10}', 'null, ''2026-02-20''', '{2026-01-11,2026-02-11}', '', 'OK',
        '2026-01-01,2026-02-01,2026-03-01,2026-04-01'),
      (7, '7. le principal clos le 28 février n''attend plus mars ni avril', 'chef',
        '{2026-01-10,2026-02-10}', 'null, null', '{2026-01-11,2026-02-11,2026-03-11,2026-04-11}',
        $a$update comptes_bancaires set clos_le = '2026-02-28' where dossier_id = '{DA}' and principal;$a$, 'OK',
        '2026-01-01,2026-02-01,2026-03-01,2026-04-01'),
      (8, '8. le principal ouvert le 1er mars n''attend pas février, sans mouvement du dossier : février reste manquant, comme hier', 'chef',
        '{2026-03-10,2026-04-10}', 'null, null', '{2026-01-11,2026-03-11,2026-04-11}',
        $a$update comptes_bancaires set ouvert_le = '2026-03-01' where dossier_id = '{DA}' and principal;$a$, 'OK',
        '2026-01-01,2026-03-01,2026-04-01'),
      (9, '9. le client sans aucune case reçoit la même couverture que le cabinet', 'client',
        '{2026-01-10,2026-02-10,2026-03-10,2026-04-10}', 'null, null', '{2026-02-11,2026-04-11}', '', 'OK', '2026-01-01,2026-02-01,2026-04-01'),
      (10, '10. un inconnu se refuse', 'inconnu',
        '{2026-01-10}', null, null, '', '42501', ''),
      (11, '11. un dossier sans mouvement : un tableau vide', 'chef',
        '{}', null, null, '', 'OK', '')
    ) as t(rang, etape, profil, mois_p, b, mois_b, apres, attendu, rend)
    loop
      v_code := 'OK'; v_obs := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute replace(replace(principal, '{DA}', da), '{M}', e.mois_p);
        if e.b is not null then
          execute replace(replace(replace(second, '{DA}', da), '{B}', e.b), '{MB}', e.mois_b);
        end if;
        if e.apres <> '' then
          execute replace(e.apres, '{DA}', da);
        end if;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case e.profil when 'client' then client when 'inconnu' then inconnu else chef end, 'role', 'authenticated')::text, true);
        begin
          execute replace(couverture, '{DA}', da) into v_obs;
        exception when others then
          v_code := sqlstate; v_obs := '';
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        perform set_config('request.jwt.claims', '', true);
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'PREPARATION ' || sqlstate; v_obs := sqlerrm;
        end if;
      end;
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.attendu and coalesce(v_obs, '') = e.rend, 'observe', v_code || ' ' || coalesce(v_obs, ''));
    end loop;

    verdicts := verdicts || jsonb_build_object('rang', 20,
      'etape', '20. le catalogue : définisseur, search_path fixé, stable, exécution à authenticated seul',
      'ok', (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
               and has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
             from pg_proc p where p.oid = 'public.couverture_du_releve(uuid)'::regprocedure),
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni l''accès, ni les comptes, ni les mouvements',
    'ok', not exists (select 1 from dossiers where id = da::uuid)
      and not exists (select 1 from memberships where id = acces_a::uuid)
      and not exists (select 1 from comptes_bancaires where dossier_id = da::uuid)
      and not exists (select 1 from lignes_bancaires where dossier_id = da::uuid),
    'observe', 'relu');
  perform set_config('essai.couverture_par_compte', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.couverture_par_compte')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
