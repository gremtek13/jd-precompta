-- LA TRACE DES PAIEMENTS DE L'ASSURANCE MALADIE REMPLACÉS : CE QU'UNE SUPPRESSION RENCONTRE (NOE4R-Q2) — SUR UNE RÉPLIQUE
-- SEULEMENT, jamais en production (l'outil d'exécution y retient une suppression), en UNE transaction (`psql -1`), sous le
-- propriétaire. Le pendant de remplacementDesJourneesAssuranceMaladie.sql. Chaque étape se joue dans sa sous-transaction et s'y
-- annule.
--
-- Ce qui se prouve : une trace ne se retire pas en direct, ni par le rôle des Edge Functions, ni par le propriétaire des tables
-- (la garde, sous ses mots) ; le super-administrateur connecté n'en retire aucune (aucune policy de suppression) ; la
-- suppression d'un dossier passe, sa trace partie avec lui ; le retrait d'un des deux imports qu'elle nomme la laisse (sans clé
-- étrangère vers eux). Une garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire`
-- manque à la production).
do $essai$
declare
  d constant uuid := 'e5330000-0000-4000-8000-0000000000e1';
  i_ancien constant uuid := 'e5330000-0000-4000-8000-0000000001e1';
  i_nouveau constant uuid := 'e5330000-0000-4000-8000-0000000002e1';
  chef constant text := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_msg text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.remplacements_assurance_maladie') is null then
    perform set_config('essai.remplacement_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration remplacement_des_journees_assurance_maladie', 'ok', true,
      'observe', 'absente : rien ne s''écrit'))::text, true);
    return;
  end if;
  for e in select * from (values
    (1, '1. le rôle des Edge Functions ne retire pas une trace en direct (23514)', 'service',
      format('delete from remplacements_assurance_maladie where dossier_id = %L', d), '23514',
      'La trace d''un paiement de l''assurance maladie remplacé ne part qu''avec son dossier.'),
    (2, '2. le propriétaire des tables non plus (la garde, 23514)', 'proprietaire',
      format('delete from remplacements_assurance_maladie where dossier_id = %L', d), '23514',
      'La trace d''un paiement de l''assurance maladie remplacé ne part qu''avec son dossier.'),
    (3, '3. le super-administrateur connecté n''en retire aucune : aucune policy de suppression', 'chef',
      format('with t as (delete from remplacements_assurance_maladie where dossier_id = %L returning 1) select count(*)::text from t', d), 'OK', '0'),
    (4, '4. la suppression du dossier passe, sa trace partie avec lui', 'proprietaire',
      format('delete from dossiers where id = %L; select count(*)::text from remplacements_assurance_maladie where dossier_id = %L', d, d), 'OK', '0'),
    (5, '5. le retrait de l''import qui a remplacé laisse la trace', 'proprietaire',
      format('select set_config(''jd.paiements_assurance_maladie'', %L, true); delete from imports_assurance_maladie where id = %L; select count(*)::text from remplacements_assurance_maladie where dossier_id = %L', i_nouveau, i_nouveau, d), 'OK', '1'),
    (6, '6. … celui de l''import qui avait apporté le paiement remplacé aussi', 'proprietaire',
      format('select set_config(''jd.paiements_assurance_maladie'', %L, true); delete from imports_assurance_maladie where id = %L; select count(*)::text from remplacements_assurance_maladie where dossier_id = %L', i_ancien, i_ancien, d), 'OK', '1')
  ) as t(rang, etape, profil, requete, code, attendu) loop
    v_code := 'OK'; v_msg := null;
    begin
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
        values (d, 'ESSAI REMPLACEMENT SUPPRESSION', cabinet, 'tresorerie', '455000', 'exonere');
      perform set_config('jd.paiements_assurance_maladie', i_ancien::text, true);
      insert into imports_assurance_maladie (id, dossier_id, periode_du, periode_au, importe_par) values (i_ancien, d, '2026-03-03', '2026-03-03', gen_random_uuid());
      perform set_config('jd.paiements_assurance_maladie', i_nouveau::text, true);
      insert into imports_assurance_maladie (id, dossier_id, periode_du, periode_au, importe_par) values (i_nouveau, d, '2026-03-03', '2026-03-03', gen_random_uuid());
      insert into paiements_assurance_maladie (dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures)
        values (d, i_nouveau, '2026-03-03', 1, 691, 'obligatoire', 6000, 0, 3);
      perform set_config('jd.paiements_assurance_maladie', '', true);
      perform set_config('jd.remplacements_assurance_maladie', d::text, true);
      insert into remplacements_assurance_maladie (dossier_id, import_id, ancien_import_id, date_journee_comptable, regime, caisse, part,
        ancien_montant_centimes, ancien_regularisations_centimes, ancien_nombre_de_factures, nouveau_montant_centimes,
        nouveau_regularisations_centimes, nouveau_nombre_de_factures, remplace_par)
        values (d, i_nouveau, i_ancien, '2026-03-03', 1, 691, 'obligatoire', 5000, 0, 2, 6000, 0, 3, gen_random_uuid());
      perform set_config('jd.remplacements_assurance_maladie', '', true);
      begin
        if e.profil = 'service' then
          execute 'set local role service_role';
          perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
        elsif e.profil = 'chef' then
          execute 'set local role authenticated';
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        end if;
        execute e.requete into v_msg;
        reset role;
        v_msg := coalesce(v_msg, '');
      exception when others then
        reset role;
        v_code := sqlstate;
        v_msg := sqlerrm;
      end;
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
      'ok', v_code = e.code and (e.attendu is null or v_msg = e.attendu), 'observe', v_code || ' ' || coalesce(v_msg, '-'));
  end loop;
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté', 'ok',
    not exists (select 1 from dossiers where id = d) and not exists (select 1 from remplacements_assurance_maladie where dossier_id = d),
    'observe', 'relu');
  perform set_config('essai.remplacement_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.remplacement_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
