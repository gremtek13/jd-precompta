-- PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER : CE QU'UNE SUPPRESSION RENCONTRE (ligne 26.6, lot MCB1 ; la migration
-- `comptes_bancaires`, en production depuis le 12/11/2026). SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet
-- toute suppression à une confirmation qui n'arrive pas. Le reste de la migration se prouve par
-- supabase/essais/comptesBancaires.sql, dont ce fichier reprend le jeu, le moteur et les profils.
--
-- Ce qui se prouve ici : un compte sans mouvement ni relevé se retire ; un compte qui porte un mouvement, ou un relevé, ne
-- se retire pas (la garde le dit avant la clé) ; le principal d'un dossier qui tient un autre compte ne se retire pas, ce
-- qui se juge à la fin de la transaction, et le principal et l'autre compte partent ensemble ; le dossier part avec ses
-- comptes, leurs mouvements et leurs contrôles, sans qu'aucune garde le retienne.
-- Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la
-- production). Joué en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  da constant text := 'cb110000-0000-4000-8000-0000000000d1';
  db constant text := 'cb110000-0000-4000-8000-0000000000d2';
  acces_a constant text := 'cb110000-0000-4000-8000-0000000000a1';
  acces_b constant text := 'cb110000-0000-4000-8000-0000000000a2';
  sec_id constant text := 'cb110000-0000-4000-8000-0000000000e1';
  -- Un compte connecté qu'aucun accès ni aucun cabinet ne nomme (le profil `inconnu`).
  inconnu constant text := 'cb110000-0000-4000-8000-0000000000f1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  m1 constant text := $q$insert into lignes_bancaires (dossier_id, date, libelle, montant) values ('{DA}', '2025-06-10', 'ESSAI MCB1 FRAIS', -12);$q$;
  sec constant text := $q$insert into comptes_bancaires (id, dossier_id, libelle, compte, compte_propre_depuis) values ('{S}', '{DA}', 'ESSAI MCB1 SECOND', '512100', '2026-01-01');$q$;
  principal_de_da constant text := $q$(select c.id from comptes_bancaires c where c.dossier_id = '{DA}' and c.principal)$q$;
  e record; v_code text; v_msg text; v_req text; v_pose text; v_obs text; v_texte text; v_f record;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La garde de tête (le patron d'AUDIT-Q1) : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.comptes_bancaires') is null then
    perform set_config('essai.comptes_bancaires_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration comptes_bancaires', 'ok', true,
      'observe', 'absente : l''essai se joue dès que la migration y est'))::text, true);
    return;
  end if;
  begin
    -- Le jeu : les deux dossiers jetables et les accès du client d'essai, insérés par le propriétaire comme
    -- `create-client-access` les insère.
    insert into dossiers (id, nom, cabinet_id) values
      (da::uuid, 'ESSAI MCB1 DA', cabinet), (db::uuid, 'ESSAI MCB1 DB', cabinet);
    insert into memberships (id, user_id, dossier_id, role, email, droit_banque) values
      (acces_a::uuid, client::uuid, da::uuid, 'client', 'essai-mcb1-a@example.test', true),
      (acces_b::uuid, client::uuid, db::uuid, 'client', 'essai-mcb1-b@example.test', false);

    -- Une étape : {rang, étape, ce que le CHEF pose d'abord (sous sa session), le profil — `chef`, `chef_simple` (un chef du
    -- cabinet qui n'est pas super-administrateur : le compte client rattaché au cabinet le temps de la sous-transaction),
    -- `client`, `inconnu`, `proprietaire` (le propriétaire sans session) —, sa requête, le code attendu (`OK` : acceptée)
    -- et ce qu'elle rend, ou les mots du refus}.
    for e in select * from (values
      (1, '1. un compte sans mouvement ni relevé se retire', '{M1} {SEC}', 'chef',
        $q$with d as (delete from comptes_bancaires where id = '{S}' returning 1) select count(*)::text from d$q$,
        'OK', '1'),
      (2, '2. un compte qui porte un mouvement ne se retire pas (23503)', '{M1}', 'chef',
        $q$with d as (delete from comptes_bancaires where id = {PDA} returning 1) select count(*)::text from d$q$,
        '23503', 'Le compte bancaire « Compte principal » porte des mouvements ou des relevés : il ne se retire pas.'),
      (3, '3. ni un compte qui porte un relevé (23503)',
        $p${M1} {SEC} insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
           values ('{DA}', '{S}', 'essai-mcb1.csv', 0, 0, 0, 0, true);$p$, 'chef',
        $q$with d as (delete from comptes_bancaires where id = '{S}' returning 1) select count(*)::text from d$q$,
        '23503', 'Le compte bancaire « ESSAI MCB1 SECOND » porte des mouvements ou des relevés : il ne se retire pas.'),
      (4, '4. le principal d''un dossier qui tient un autre compte ne se retire pas : jugé à la fin de la transaction (23514)',
        $p$insert into comptes_bancaires (dossier_id, libelle, principal) values ('{DB}', 'ESSAI MCB1 PRINCIPAL DB', true);
           insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DB}', 'ESSAI MCB1 SECOND DB', '512100', '2026-01-01');
           delete from comptes_bancaires where dossier_id = '{DB}' and principal;$p$, 'chef',
        $q$set constraints comptes_bancaires_principal_present immediate$q$,
        '23514', 'Un dossier qui tient un compte bancaire tient son compte principal : le premier créé, qui suit le compte de banque du plan.'),
      (5, '5. le principal et l''autre compte partent ensemble',
        $p$insert into comptes_bancaires (dossier_id, libelle, principal) values ('{DB}', 'ESSAI MCB1 PRINCIPAL DB', true);
           insert into comptes_bancaires (dossier_id, libelle, compte, compte_propre_depuis) values ('{DB}', 'ESSAI MCB1 SECOND DB', '512100', '2026-01-01');
           delete from comptes_bancaires where dossier_id = '{DB}';
           set constraints comptes_bancaires_principal_present immediate;$p$, 'chef',
        $q$select count(*)::text from comptes_bancaires where dossier_id = '{DB}'$q$,
        'OK', '0'),
      (6, '6. le dossier part avec ses deux comptes, leurs mouvements et leurs contrôles',
        $p${M1} {SEC} insert into lignes_bancaires (dossier_id, compte_bancaire_id, date, libelle, montant, source_fichier) values ('{DA}', '{S}', '2026-01-02', 'ESSAI MCB1', -3, 'essai-mcb1.csv');
           insert into controles_releves_bancaires (dossier_id, compte_bancaire_id, source_fichier, solde_initial, solde_final, somme_mouvements, ecart, coherent)
             values ('{DA}', '{S}', 'essai-mcb1.csv', 0, -3, -3, 0, true);
           delete from dossiers where id = '{DA}';
           set constraints all immediate;$p$, 'proprietaire',
        $q$select (select count(*) from comptes_bancaires where dossier_id = '{DA}') || ':' || (select count(*) from lignes_bancaires where dossier_id = '{DA}')
                  || ':' || (select count(*) from controles_releves_bancaires where dossier_id = '{DA}')$q$,
        'OK', '0:0:0')
    ) as t(rang, etape, pose, profil, requete, code, attendu) loop
      v_code := 'OK'; v_msg := null; v_obs := null; v_pose := null; v_req := null;
      begin
        for v_f in select x.rang, x.texte from (values (1, e.pose), (2, e.requete)) as x(rang, texte) where x.texte is not null loop
          v_texte := replace(replace(replace(v_f.texte, '{M1}', m1), '{SEC}', sec), '{PDA}', principal_de_da);
          v_texte := replace(replace(replace(v_texte, '{DA}', da), '{DB}', db), '{S}', sec_id);
          if v_f.rang = 1 then
            v_pose := v_texte;
          else
            v_req := v_texte;
          end if;
        end loop;
        if v_pose is not null then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute v_pose;
          reset role;
          perform set_config('request.jwt.claims', '', true);
        end if;
        if e.profil = 'chef_simple' then
          insert into cabinet_admins (user_id, cabinet_id, role) values (client::uuid, cabinet, 'comptable_en_chef');
        end if;
        begin
          if e.profil <> 'proprietaire' then
            execute 'set local role authenticated';
            perform set_config('request.jwt.claims',
              json_build_object('sub', case when e.profil = 'inconnu' then inconnu
                                            when e.profil in ('client', 'chef_simple') then client else chef end,
                                'role', 'authenticated')::text, true);
          end if;
          execute v_req into v_obs;
          reset role;
          v_msg := coalesce(v_obs, '');
        exception when others then
          reset role;
          v_code := sqlstate;
          v_msg := sqlerrm;
        end;
        reset role;
        perform set_config('request.jwt.claims', '', true);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        if sqlerrm <> 'ANNULATION_ETAPE' then
          v_code := 'ESSAI';
          v_msg := sqlstate || ' ' || sqlerrm;
        end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and v_msg = e.attendu, 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  -- Rien n'est resté : ni les dossiers jetables, ni les accès, ni les comptes, ni les mouvements, ni les contrôles.
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni les dossiers jetables, ni les accès, ni les comptes, les mouvements, les contrôles',
    'ok', not exists (select 1 from dossiers where id in (da::uuid, db::uuid))
      and not exists (select 1 from memberships where id in (acces_a::uuid, acces_b::uuid))
      and not exists (select 1 from comptes_bancaires where dossier_id in (da::uuid, db::uuid) or id = sec_id::uuid)
      and not exists (select 1 from lignes_bancaires where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from controles_releves_bancaires where dossier_id in (da::uuid, db::uuid))
      and not exists (select 1 from cabinet_admins where user_id = client::uuid),
    'observe', 'relu');
  perform set_config('essai.comptes_bancaires_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.comptes_bancaires_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
