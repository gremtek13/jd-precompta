-- LA DATE DE VALEUR DES MOUVEMENTS DU RELEVÉ (EXP58-Q4 ; la migration préparée `date_de_valeur_des_mouvements`,
-- supabase/preparees/20261117170000_date_de_valeur_des_mouvements.sql). Le récit : HISTORIQUE.md, « 17/11/2026 — EXP58-Q4 :
-- LA DATE DE VALEUR GARDÉE À L'IMPORT (PRÉPARÉE, PAS APPLIQUÉE) ». À rejouer après toute migration qui touche
-- `lignes_bancaires_date_valeur_proche`, `garder_mouvement_valide`, le déclencheur `lignes_bancaires_figees_par_la_validation`
-- ou les contraintes de `lignes_bancaires`. SANS LA MIGRATION (la colonne absente du catalogue), il se dit EN ATTENTE.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   1. LE CATALOGUE : une date nullable sans défaut ; sa borne, telle que le module la redit (`ECART_MAXIMAL_DE_LA_DATE_DE_VALEUR`,
--      src/lib/dateDeValeur.ts) ; le déclencheur du figement, sur toute mise à jour, avec le corps qui compare la ligne entière ;
--   2. LA BORNE : le chef insère un mouvement dont la date de valeur suit ou précède la date d'opération, jusqu'à 92 jours
--      des deux côtés ; à 93 jours, la base refuse, sous le nom de la contrainte ; sans date de valeur, l'insertion d'hier
--      passe ; le chef pose une date de valeur sur un mouvement qui n'en a pas ; déplacer la date d'opération loin de la date
--      de valeur se refuse aussi ;
--   3. LE FIGEMENT : la date de valeur d'un mouvement daté d'un exercice validé ne se pose plus, ne se change plus et ne se
--      retire plus, au chef comme au propriétaire hors de la RLS — sous les mots du figement d'hier.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `da7e0000-0000-4000-8000`) : DA, nu, en trésorerie, et ses
-- mouvements LA (sans date de valeur), LV (avec) et LF (sans), datés d'un 10 mars de l'année d'avant. Chaque étape se joue
-- dans sa sous-transaction et s'y ANNULE (`ANNULATION_ETAPE`) : ce que le propriétaire pose d'abord (l'exercice validé est
-- posé à la main, comme dans compteBilan.sql : c'est le figement qu'on éprouve, pas la validation), puis le geste (du chef
-- sous la RLS, ou du propriétaire), puis la fin de la transaction simulée (`set constraints all immediate`), puis ce qu'on
-- relit ; le jeu s'annule à la fin (`ANNULATION_ESSAI_GLOBALE`), et « rien n'est resté » le relit. Les verdicts voyagent dans
-- un réglage LOCAL à la transaction (`essai.date_de_valeur_des_mouvements`) : le fichier se joue d'un seul appel, ne crée ni
-- table ni fonction, ne contient aucune instruction de suppression, et ne rend rien qui dépende d'une ligne hors de ses
-- dossiers. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  da constant text := 'da7e0000-0000-4000-8000-0000000000d1';
  la constant text := 'da7e0000-0000-4000-8000-0000000000a1';
  lv constant text := 'da7e0000-0000-4000-8000-0000000000a2';
  lf constant text := 'da7e0000-0000-4000-8000-0000000000a3';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  date_p constant date := make_date(extract(year from now() at time zone 'Europe/Paris')::integer - 1, 3, 10);
  appliquee constant boolean := exists (select 1 from pg_attribute a where a.attrelid = 'public.lignes_bancaires'::regclass
                                          and a.attname = 'date_valeur' and not a.attisdropped);
  hors_borne constant text := 'new row for relation "lignes_bancaires" violates check constraint "lignes_bancaires_date_valeur_proche"';
  fige constant text := '%: ce mouvement ne change plus.';
  valide constant text := $q$insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes,
    nb_ecritures, total_debit, total_credit, empreinte, declaration) values ('{DA}', extract(year from '{DP}'::date)::int, now(),
    '{CHEF}', 'tresorerie', 0, 0, 0, 0, repeat('0', 64), '{}'::jsonb);$q$;
  e record; v_code text; v_msg text; v_obs text; v_textes text[];
  verdicts jsonb := '[]'::jsonb;
begin
  if not appliquee then
    perform set_config('essai.date_de_valeur_des_mouvements', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration date_de_valeur_des_mouvements (EXP58-Q4)', 'ok', true,
      'observe', 'absente : la date de valeur d''un relevé ne se garde pas encore ; l''essai se joue dès qu''elle y est'))::text, true);
    return;
  end if;
  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais) values
      (da::uuid, 'ESSAI EXP58Q4 DA', cabinet, 'tresorerie', '455000');
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, date_valeur) values
      (la::uuid, da::uuid, date_p, 'ESSAI EXP58Q4 SANS VALEUR', -50, 'non_rapprochee', null),
      (lv::uuid, da::uuid, date_p, 'ESSAI EXP58Q4 AVEC VALEUR', 120, 'non_rapprochee', date_p + 2),
      (lf::uuid, da::uuid, date_p, 'ESSAI EXP58Q4 FIGE', -30, 'non_rapprochee', null);

    -- Une étape : {rang, étape, ce que le PROPRIÉTAIRE pose d'abord, qui fait le geste (`chef` sous la RLS, `proprio` hors
    -- d'elle), le geste, ce qu'on relit, le code attendu (`OK` : accepté) et ce qu'on relit, ou les mots du refus (un `%`
    -- s'y lit comme dans LIKE)}.
    for e in select * from (values
      (1, '1. le catalogue : une date nullable sans défaut ; sa borne de 92 jours des deux côtés ; le figement sur toute mise à jour, avec le corps qui compare la ligne entière',
        null, 'proprio', null,
        $q$(select format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull::text || ' ' || a.atthasdef::text from pg_attribute a
             where a.attrelid = 'public.lignes_bancaires'::regclass and a.attname = 'date_valeur')
           || ' | ' || (select pg_get_constraintdef(c.oid) from pg_constraint c
                         where c.conrelid = 'public.lignes_bancaires'::regclass and c.conname = 'lignes_bancaires_date_valeur_proche')
           || ' | ' || (select t.tgtype::text || ' ' || coalesce(nullif(t.tgattr::text, ''), 'toute') || ' ' || t.tgenabled::text
                         from pg_trigger t where t.tgrelid = 'public.lignes_bancaires'::regclass
                          and t.tgname = 'lignes_bancaires_figees_par_la_validation')
           || ' | ' || (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p where p.oid = 'public.garder_mouvement_valide()'::regprocedure)$q$,
        'OK', 'date false false | CHECK (((date_valeur IS NULL) OR ((date_valeur >= (date - 92)) AND (date_valeur <= (date + 92))))) | 31 toute O | f10207e741e52cd7684e2b9e5ccd5328'),
      (2, '2. le chef insère un mouvement dont la date de valeur suit de deux jours la date d''opération : accepté',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date + 2);$q$,
        $q$(select string_agg((date_valeur - date)::text, ',') from lignes_bancaires where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q4 INSERE')$q$, 'OK', '2'),
      (3, '2b. … qui la précède de trois jours (une banque date la valeur d''un débit avant l''opération) : accepté',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', -75, 'non_rapprochee', '{DP}'::date - 3);$q$,
        $q$(select string_agg((date_valeur - date)::text, ',') from lignes_bancaires where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q4 INSERE')$q$, 'OK', '-3'),
      (4, '2c. … à 92 jours après, la borne : accepté',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date + 92);$q$,
        $q$(select string_agg((date_valeur - date)::text, ',') from lignes_bancaires where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q4 INSERE')$q$, 'OK', '92'),
      (5, '2d. … à 92 jours avant, la borne : accepté',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date - 92);$q$,
        $q$(select string_agg((date_valeur - date)::text, ',') from lignes_bancaires where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q4 INSERE')$q$, 'OK', '-92'),
      (6, '2e. … à 93 jours après : refusé, sous le nom de la contrainte',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date + 93);$q$,
        null, '23514', hors_borne),
      (7, '2f. … à 93 jours avant : refusé de même',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date - 93);$q$,
        null, '23514', hors_borne),
      (8, '2g. le propriétaire, hors de la RLS : refusé de même',
        null, 'proprio', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut, date_valeur) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee', '{DP}'::date + 200);$q$,
        null, '23514', hors_borne),
      (9, '2h. l''insertion d''hier, sans date de valeur : acceptée, la date de valeur nulle',
        null, 'chef', $q$insert into lignes_bancaires (dossier_id, date, libelle, montant, statut) values ('{DA}', '{DP}', 'ESSAI EXP58Q4 INSERE', 75, 'non_rapprochee');$q$,
        $q$(select string_agg(coalesce(date_valeur::text, 'nul'), ',') from lignes_bancaires where dossier_id = '{DA}' and libelle = 'ESSAI EXP58Q4 INSERE')$q$, 'OK', 'nul'),
      (10, '2i. le chef pose une date de valeur sur un mouvement qui n''en a pas : acceptée',
        null, 'chef', $q$update lignes_bancaires set date_valeur = date + 1 where id = '{LA}';$q$,
        $q$(select (date_valeur - date)::text from lignes_bancaires where id = '{LA}')$q$, 'OK', '1'),
      (11, '2j. déplacer la date d''opération d''un mouvement à plus de 92 jours de sa date de valeur : refusé',
        null, 'chef', $q$update lignes_bancaires set date = date + 100 where id = '{LV}';$q$,
        null, '23514', hors_borne),
      (12, '3. un exercice validé couvre LF : le chef n''y pose plus de date de valeur',
        valide, 'chef', $q$update lignes_bancaires set date_valeur = date + 1 where id = '{LF}';$q$,
        null, '23514', fige),
      (13, '3b. … ni le propriétaire, hors de la RLS',
        valide, 'proprio', $q$update lignes_bancaires set date_valeur = date + 1 where id = '{LF}';$q$,
        null, '23514', fige),
      (14, '3c. un exercice validé couvre LV : sa date de valeur ne change plus',
        valide, 'chef', $q$update lignes_bancaires set date_valeur = date + 3 where id = '{LV}';$q$,
        null, '23514', fige),
      (15, '3d. … et ne se retire plus',
        valide, 'chef', $q$update lignes_bancaires set date_valeur = null where id = '{LV}';$q$,
        null, '23514', fige),
      (16, '3e. le contrôle positif : sans exercice validé, la date de valeur de LV change',
        null, 'chef', $q$update lignes_bancaires set date_valeur = date + 3 where id = '{LV}';$q$,
        $q$(select (date_valeur - date)::text from lignes_bancaires where id = '{LV}')$q$, 'OK', '3')
    ) as v(rang, etape, pose, qui, geste, relu, code, attendu) order by rang
    loop
      v_code := 'OK';
      v_msg := null;
      v_obs := null;
      begin
        v_textes := array[e.pose, e.geste, e.relu, e.attendu];
        for i in 1 .. 4 loop
          if v_textes[i] is null then continue; end if;
          v_textes[i] := replace(replace(replace(replace(v_textes[i], '{DA}', da), '{LA}', la), '{LV}', lv), '{LF}', lf);
          v_textes[i] := replace(replace(v_textes[i], '{DP}', date_p::text), '{CHEF}', chef);
        end loop;
        if v_textes[1] is not null then
          execute v_textes[1];
        end if;
        begin
          if v_textes[2] is not null then
            if e.qui = 'chef' then
              execute 'set local role authenticated';
              perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
            end if;
            execute v_textes[2];
            reset role;
            perform set_config('request.jwt.claims', '', true);
          end if;
          -- La fin de la transaction, simulée : les déclencheurs différés jugent ce que le geste a laissé.
          set constraints all immediate;
          set constraints all deferred;
          if v_textes[3] is not null then
            execute 'select (' || v_textes[3] || ')::text' into v_obs;
          end if;
          v_msg := coalesce(v_obs, '');
        exception when others then
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
        'ok', v_code = e.code and v_msg like v_textes[4], 'observe', v_code || ' ' || coalesce(v_msg, '-'));
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;

  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le dossier jetable, ni ses mouvements, ni son exercice validé',
    'ok', not exists (select 1 from dossiers where id = da::uuid)
      and not exists (select 1 from lignes_bancaires where id in (la::uuid, lv::uuid, lf::uuid) or dossier_id = da::uuid)
      and not exists (select 1 from exercices_valides where dossier_id = da::uuid),
    'observe', 'relu');
  perform set_config('essai.date_de_valeur_des_mouvements', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.date_de_valeur_des_mouvements')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
