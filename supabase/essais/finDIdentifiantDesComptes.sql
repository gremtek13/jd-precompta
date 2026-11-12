-- LA FIN DE L'IDENTIFIANT D'UN COMPTE BANCAIRE (ligne 26.6, lot MCB2 ; la migration `fin_d_identifiant_des_comptes_bancaires`,
-- en production depuis le 12/11/2026, qui suit `comptes_bancaires`). Le récit : HISTORIQUE.md, « 11/11/2026 — L'IMPORT D'UN RELEVÉ PAR
-- COMPTE BANCAIRE (MCB2) ». À rejouer après toute migration qui touche `comptes_bancaires`.
--
-- Ce qui se prouve ici : la colonne naît nulle sur le compte que le premier mouvement crée ; le chef du cabinet la pose
-- sous sa session, sur quatre chiffres ou capitales, puis la change ; tout autre forme se refuse (23514) — trois
-- caractères, cinq, une minuscule, une espace, un numéro entier ; le client « Banque » la lit et ne l'écrit pas (la policy
-- de MCB1 : zéro ligne) ; le catalogue. Un dossier jetable du cabinet du dossier `test` (préfixe `cb120000-0000-4000-8000`),
-- dont l'accès du client d'essai porte « Banque » ; chaque étape s'annule (`ANNULATION_ETAPE`), le jeu aussi
-- (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Aucune instruction de suppression ; rien ne se rend qui
-- dépende d'une ligne hors du dossier jetable. Hors de l'outil d'exécution, en UNE transaction (`psql -1`). Sans la
-- migration, une ligne dit qu'il attend (EN ATTENTE).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'cb120000-0000-4000-8000-0000000000d1';
  acces_a constant text := 'cb120000-0000-4000-8000-0000000000a1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_obs text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'comptes_bancaires' and column_name = 'fin_d_identifiant') then
    perform set_config('essai.fin_d_identifiant', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration fin_d_identifiant_des_comptes_bancaires', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id) values (da::uuid, 'ESSAI MCB2 DA', cabinet);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-mcb2-a@example.test', true);

    -- {rang, étape, profil, requête (après le premier mouvement, posé par le chef), code attendu, ce qu'elle rend}.
    for e in select * from (values
      (1, '1. le compte que le premier mouvement crée naît sans fin d''identifiant', 'chef',
        $q$select coalesce(fin_d_identifiant, 'nulle') from comptes_bancaires where dossier_id = '{DA}'$q$, 'OK', 'nulle'),
      (2, '2. le chef la pose : quatre chiffres', 'chef',
        $q$with m as (update comptes_bancaires set fin_d_identifiant = '4567' where dossier_id = '{DA}' returning fin_d_identifiant)
           select string_agg(fin_d_identifiant, ',') from m$q$, 'OK', '4567'),
      (3, '3. et la change : chiffres et capitales', 'chef',
        $q$with m as (update comptes_bancaires set fin_d_identifiant = 'AB12' where dossier_id = '{DA}' returning fin_d_identifiant)
           select string_agg(fin_d_identifiant, ',') from m$q$, 'OK', 'AB12'),
      (4, '4. trois caractères se refusent', 'chef',
        $q$update comptes_bancaires set fin_d_identifiant = '456' where dossier_id = '{DA}'$q$, '23514', ''),
      (5, '5. cinq caractères se refusent', 'chef',
        $q$update comptes_bancaires set fin_d_identifiant = '34567' where dossier_id = '{DA}'$q$, '23514', ''),
      (6, '6. une minuscule se refuse', 'chef',
        $q$update comptes_bancaires set fin_d_identifiant = 'ab12' where dossier_id = '{DA}'$q$, '23514', ''),
      (7, '7. une espace se refuse', 'chef',
        $q$update comptes_bancaires set fin_d_identifiant = '45 7' where dossier_id = '{DA}'$q$, '23514', ''),
      (8, '8. un numéro entier se refuse', 'chef',
        $q$update comptes_bancaires set fin_d_identifiant = '00012345678' where dossier_id = '{DA}'$q$, '23514', ''),
      (9, '9. le client « Banque » la lit', 'client_pose',
        $q$select coalesce(fin_d_identifiant, 'nulle') from comptes_bancaires where dossier_id = '{DA}'$q$, 'OK', '4567'),
      (10, '10. et ne l''écrit pas : zéro ligne', 'client_pose',
        $q$with m as (update comptes_bancaires set fin_d_identifiant = '9999' where dossier_id = '{DA}' returning 1)
           select count(*)::text from m$q$, 'OK', '0')
    ) as t(rang, etape, profil, requete, attendu, rend)
    loop
      v_code := 'OK'; v_obs := null;
      begin
        execute 'set local role authenticated';
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        insert into lignes_bancaires (dossier_id, date, libelle, montant) values (da::uuid, '2026-06-10', 'ESSAI MCB2 FRAIS', -12);
        if e.profil = 'client_pose' then
          update comptes_bancaires set fin_d_identifiant = '4567' where dossier_id = da::uuid;
          perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
        end if;
        begin
          execute replace(e.requete, '{DA}', da) into v_obs;
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

    verdicts := verdicts || jsonb_build_object('rang', 20, 'etape', '20. le catalogue : la colonne et sa contrainte',
      'ok', (select pg_get_constraintdef(oid) from pg_constraint
              where conrelid = 'public.comptes_bancaires'::regclass and conname = 'comptes_bancaires_fin_d_identifiant')
            = 'CHECK ((fin_d_identifiant ~ ''^[0-9A-Z]{4}$''::text))',
      'observe', 'relu au catalogue');
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni l''accès, ni le compte, ni le mouvement',
    'ok', not exists (select 1 from dossiers where id = da::uuid)
      and not exists (select 1 from memberships where id = acces_a::uuid)
      and not exists (select 1 from comptes_bancaires where dossier_id = da::uuid)
      and not exists (select 1 from lignes_bancaires where dossier_id = da::uuid),
    'observe', 'relu');
  perform set_config('essai.fin_d_identifiant', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.fin_d_identifiant')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
