-- LE SENS DES RÈGLES « TOUJOURS IGNORER », ET LA COTISATION D'UN MOUVEMENT IGNORÉ (REGLES-Q1 ; la migration
-- `sens_des_regles_ignorees`, PRÉPARÉE le 02/11/2026, supabase/preparees/). Le récit : HISTORIQUE.md, « 02/11/2026 — LE SENS
-- DES RÈGLES « TOUJOURS IGNORER » ET LA COTISATION D'UN MOUVEMENT IGNORÉ, EN BASE (REGLES-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
-- À rejouer par `execute_sql` après toute migration qui touche `regles_bancaires_ignorees`, `rapprocher_cotisation` ou les
-- contraintes de `lignes_bancaires`.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - la règle retient son sens : « decaissement », « encaissement », ou nul (les deux sens, une règle d'avant) — une règle
--     insérée sans sens est nulle ; une règle par motif ET par sens, deux nulles du même motif se heurtant (la clé
--     `regles_bancaires_ignorees_unique`, nulls not distinct) ; un sens hors des deux mots se refuse
--     (`regles_bancaires_ignorees_sens`) ; la policy d'hier refuse le client d'essai, qui n'a pas ce dossier ;
--   - `rapprocher_cotisation` refuse un mouvement ignoré (22023), sous ses mots, et n'en change rien ; l'ordre : un virement
--     personnel (ignoré lui aussi) garde le refus d'hier d'un mouvement classé, un mouvement ignoré de zéro euro reçoit
--     celui-ci avant celui du zéro ; remis à traiter, le même mouvement se rapproche, son écriture écrite ;
--   - le catalogue : la colonne (texte, nulle, sans valeur par défaut), les deux contraintes de la table, la clé d'hier
--     retirée ; la fonction aux droits de l'appelant, son chemin, exécutable par un compte connecté, ni par l'anonyme, son
--     corps à son empreinte, le refus dit par elle seule.
--
-- Un dossier jetable du cabinet du dossier `test` (préfixe `5e115000-0000-4000-8021`), sous le profil de son chef, au sein
-- d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) : rien ne reste. Chaque étape se joue dans sa
-- propre sous-transaction ; celle qui passe garde ce qu'elle écrit jusqu'à l'annulation finale (la suite en a besoin), celle
-- qui se refuse n'écrit rien. Les verdicts voyagent dans un réglage LOCAL à la transaction (`essai.regles`), que la requête
-- finale lit : le fichier se joue d'un seul appel, ne crée ni table ni fonction et ne contient aucune instruction de
-- suppression ; toute mise à jour porte son `where`. Hors de l'outil d'exécution, il se joue en UNE transaction (`psql -1`).
-- Sans la migration, une ligne dit qu'il attend (EN ATTENTE) et rien ne s'écrit.
--
-- ÉPROUVÉ LE 02/11/2026 sur la réplique de l'étape (la production du jour, 168 migrations, ses neuf familles égales),
-- munie de la migration comme l'outil : 20 verdicts sur 20 ; sans elle, EN ATTENTE, rien d'écrit. Ses mutations (le refus
-- retiré, placé avant le classement ou après le zéro, sous un autre code ; la clé sans `nulls not distinct`, absente, ou
-- l'ancienne gardée ; le sens libre ; un sens par défaut) font chacune virer au moins un verdict au rouge.
do $essai$
declare
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  client constant text := '797fe440-df8d-4b8e-828b-d148927bfd60';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  verdicts jsonb := '[]'::jsonb;
  e record;
  v_obs text;
  v_code text;
  v_msg text;
begin
  -- La colonne seule dit la migration : elle la pose dans la même transaction que le refus. Le refus absent sous la
  -- colonne n'est pas une attente, c'est une faute — l'essai se joue, et ses étapes 9 et 10b la disent.
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = 'public.regles_bancaires_ignorees'::regclass and a.attname = 'sens' and not a.attisdropped) then
    perform set_config('essai.regles', jsonb_build_array(jsonb_build_object('rang', 1,
      'etape', '0. EN ATTENTE de la migration sens_des_regles_ignorees', 'ok', true,
      'observe', 'la colonne sens absente : rien ne s''écrit'))::text, true);
    return;
  end if;

  begin
    -- Un dossier jetable, en trésorerie ; quatre mouvements : M1 un prélèvement ignoré, M2 un virement personnel (ignoré et
    -- classé), M3 un mouvement ignoré de zéro euro, M4 un prélèvement à traiter ; deux échéances d'appel, sans CSG-CRDS.
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva, ventes_par_les_factures) values
      ('5e115000-0000-4000-8021-000000000001', 'ESSAI SENS DES REGLES', cabinet, 'tresorerie', '455000', 'exonere', false);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, prelevement_personnel) values
      ('5e115000-0000-4000-8021-000000000011', '5e115000-0000-4000-8021-000000000001', '2026-03-05', 'PRLV URSSAF ESSAI', -100, 'ignoree', false),
      ('5e115000-0000-4000-8021-000000000012', '5e115000-0000-4000-8021-000000000001', '2026-03-06', 'VIR COMPTE PERSO ESSAI', -100, 'ignoree', true),
      ('5e115000-0000-4000-8021-000000000013', '5e115000-0000-4000-8021-000000000001', '2026-03-07', 'URSSAF REGUL ESSAI', 0, 'ignoree', false),
      ('5e115000-0000-4000-8021-000000000014', '5e115000-0000-4000-8021-000000000001', '2026-03-08', 'PRLV URSSAF ESSAI', -100, 'non_rapprochee', false);
    insert into cotisations_declarees (id, dossier_id, echeance, montant_appele) values
      ('5e115000-0000-4000-8021-000000000021', '5e115000-0000-4000-8021-000000000001', '2026-03-05', 100),
      ('5e115000-0000-4000-8021-000000000022', '5e115000-0000-4000-8021-000000000001', '2026-03-08', 100);

    -- Une étape : {rang, sous le chef du cabinet du dossier `test` (`chef`), sous le client d'essai (`client`) ou le
    -- propriétaire (`proprietaire`), étape, requête, code attendu (`OK` : acceptée, et sa valeur rendue), motif LIKE}.
    for e in select * from (values
      (1, 'chef', '1. une règle née d''un débit : « decaissement »', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'alpha', 'decaissement') returning sens$q$, 'OK', 'decaissement'),
      (2, 'chef', '2. la même, née d''un crédit : « encaissement » (la clé d''hier, sur le motif seul, la refusait)', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'alpha', 'encaissement') returning sens$q$, 'OK', 'encaissement'),
      (3, 'chef', '3. une règle insérée sans sens, comme hier : nulle (les deux sens)', $q$insert into regles_bancaires_ignorees (dossier_id, motif)
  values ('5e115000-0000-4000-8021-000000000001', 'alpha') returning coalesce(sens, 'nul')$q$, 'OK', 'nul'),
      (4, 'chef', '4. la même règle, le même sens : la clé la refuse', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'alpha', 'decaissement') returning sens$q$, '23505', '%regles_bancaires_ignorees_unique%'),
      (5, 'chef', '5. deux règles nulles du même motif se heurtent (nulls not distinct)', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'alpha', null) returning coalesce(sens, 'nul')$q$, '23505', '%regles_bancaires_ignorees_unique%'),
      (6, 'chef', '6. un sens hors des deux mots se refuse', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'beta', 'debit') returning sens$q$, '23514', '%regles_bancaires_ignorees_sens%'),
      (7, 'chef', '6b. … un sens vide aussi', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'beta', '') returning sens$q$, '23514', '%regles_bancaires_ignorees_sens%'),
      (8, 'chef', '7. les trois règles du motif, relues', $q$select string_agg(coalesce(sens, 'nul'), ',' order by coalesce(sens, 'nul'))
  from regles_bancaires_ignorees where dossier_id = '5e115000-0000-4000-8021-000000000001' and motif = 'alpha'$q$, 'OK', 'decaissement,encaissement,nul'),
      (9, 'client', '8. le client d''essai, qui n''a pas ce dossier : la policy d''hier le refuse', $q$insert into regles_bancaires_ignorees (dossier_id, motif, sens)
  values ('5e115000-0000-4000-8021-000000000001', 'gamma', 'decaissement') returning sens$q$, '42501', '%row-level security%'),
      (10, 'chef', '9. une échéance sur un mouvement ignoré : refusé, sous ses mots', $q$select rapprocher_cotisation('5e115000-0000-4000-8021-000000000011',
  '5e115000-0000-4000-8021-000000000021', '[{"compte":"512000","sens":"credit","montant":100},{"compte":"646000","sens":"debit","montant":100}]')::text$q$,
        '22023', 'Ce mouvement est ignoré : remets-le d''abord à traiter.'),
      (11, 'chef', '9b. … et rien n''en change : ignoré, sans échéance, sans écriture', $q$select l.statut || '|' || coalesce(l.cotisation_id::text, '-') || '|'
  || (select count(*) from ecritures_brouillon b where b.ligne_bancaire_id = l.id) from lignes_bancaires l where l.id = '5e115000-0000-4000-8021-000000000011'$q$,
        'OK', 'ignoree|-|0'),
      (12, 'chef', '10. l''ordre : un virement personnel, ignoré lui aussi, garde le refus d''hier d''un mouvement classé', $q$select rapprocher_cotisation('5e115000-0000-4000-8021-000000000012',
  '5e115000-0000-4000-8021-000000000021', '[{"compte":"512000","sens":"credit","montant":100},{"compte":"646000","sens":"debit","montant":100}]')::text$q$,
        '22023', 'Ce mouvement est rapproché d''une pièce ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'),
      (13, 'chef', '10b. … un mouvement ignoré de zéro euro reçoit celui-ci, avant celui du zéro', $q$select rapprocher_cotisation('5e115000-0000-4000-8021-000000000013',
  '5e115000-0000-4000-8021-000000000021', '[]')::text$q$, '22023', 'Ce mouvement est ignoré : remets-le d''abord à traiter.'),
      (14, 'chef', '11. un mouvement à traiter se rapproche, comme hier : deux lignes écrites', $q$select rapprocher_cotisation('5e115000-0000-4000-8021-000000000014',
  '5e115000-0000-4000-8021-000000000022', '[{"compte":"512000","sens":"credit","montant":100},{"compte":"646000","sens":"debit","montant":100}]')::text$q$,
        'OK', '2'),
      (15, 'chef', '12. M1 remis à traiter, puis rapproché : le refus ne tenait qu''à son statut', $q$update lignes_bancaires set statut = 'non_rapprochee'
  where id = '5e115000-0000-4000-8021-000000000011' and statut = 'ignoree';
  select rapprocher_cotisation('5e115000-0000-4000-8021-000000000011', '5e115000-0000-4000-8021-000000000021',
  '[{"compte":"512000","sens":"credit","montant":100},{"compte":"646000","sens":"debit","montant":100}]')::text$q$, 'OK', '2'),
      (16, 'proprietaire', '13. le catalogue : la colonne, texte, nulle, sans valeur par défaut', $q$select format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':'
  || coalesce(pg_get_expr(d.adbin, d.adrelid), '-') from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.regles_bancaires_ignorees'::regclass and a.attname = 'sens' and not a.attisdropped$q$, 'OK', 'text:false:-'),
      (17, 'proprietaire', '13b. … les deux contraintes de la table, et la clé d''hier retirée', $q$select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' ; ' order by c.conname)
  from pg_constraint c where c.conrelid = 'public.regles_bancaires_ignorees'::regclass and c.contype in ('u', 'c')$q$, 'OK',
        'regles_bancaires_ignorees_sens CHECK (((sens IS NULL) OR (sens = ANY (ARRAY[''encaissement''::text, ''decaissement''::text])))) ; regles_bancaires_ignorees_unique UNIQUE NULLS NOT DISTINCT (dossier_id, motif, sens)'),
      (18, 'proprietaire', '14. la fonction : aux droits de l''appelant, son chemin, exécutable par un compte connecté, ni par l''anonyme', $q$select p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':'
  || has_function_privilege('anon', p.oid, 'execute') || ':' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p where p.oid = to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)')$q$, 'OK', 'false:search_path=public:false:true'),
      (19, 'proprietaire', '14b. … son corps à son empreinte (retours chariot écartés)', $q$select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
  where p.oid = to_regprocedure('public.rapprocher_cotisation(uuid, uuid, jsonb)')$q$, 'OK',
        -- La jambe de banque par compte (MCB5, `jambe_de_banque_par_compte`) remplace son corps : la banque du mouvement.
        case when exists (select 1 from supabase_migrations.schema_migrations where version = '20261111200000')
             then '2559833009639c117795ad40d74dc31f' else 'bf920662bc500bc4fcf23aba0ce829e3' end),
      (20, 'proprietaire', '14c. … le refus dit par elle seule', $q$select string_agg(p.proname, ',' order by p.proname) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prosrc like '%Ce mouvement est ignoré : remets-le%'$q$, 'OK', 'rapprocher_cotisation')
    ) as t(rang, profil, etape, requete, code, attendu) order by rang loop
      v_obs := null;
      v_code := 'OK';
      v_msg := '';
      begin
        if e.profil <> 'proprietaire' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims',
            json_build_object('sub', case e.profil when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_obs;
        set constraints all immediate;
        set constraints all deferred;
        reset role;
        v_msg := coalesce(v_obs, '');
      exception when others then
        reset role;
        v_code := sqlstate;
        v_msg := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
        'ok', v_code = e.code and (e.attendu = '' or v_msg like e.attendu), 'observe', v_code || ' ' || v_msg);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  perform set_config('essai.regles', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.regles')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
