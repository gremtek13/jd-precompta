-- L'ASSOCIATION DES PAIEMENTS DE L'ASSURANCE MALADIE : CE QU'UNE SUPPRESSION RENCONTRE (NOE5) — SUR UNE RÉPLIQUE SEULEMENT,
-- jamais en production (l'outil d'exécution y retient une suppression), en UNE transaction (`psql -1`), sous le propriétaire.
-- Le pendant de associationPaiementsAssuranceMaladie.sql. Chaque étape se joue dans sa sous-transaction et s'y annule.
--
-- Ce qui se prouve : une association ne se retire pas en direct, même par le rôle des Edge Functions ; un mouvement retiré
-- emporte son association ; la suppression d'un dossier passe, ses associations parties avec lui (la clé vers le paiement,
-- sans action à la suppression, se vérifie en fin d'instruction) ; un paiement associé ne part pas, même quand la garde de
-- NOE3 le laisserait partir (la clé le retient) ; un import associé ne se retire pas (le déclencheur, sous ses mots). Une
-- garde de tête refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la production).
do $essai$
declare
  d constant uuid := 'e5500000-0000-4000-8000-0000000000e1';
  l constant uuid := 'e5500000-0000-4000-8000-0000000001e1';
  i constant uuid := 'e5500000-0000-4000-8000-0000000002e1';
  p constant uuid := 'e5500000-0000-4000-8000-0000000003e1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_msg text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.paiements_assurance_maladie_mouvements') is null then
    perform set_config('essai.association_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration association_paiements_assurance_maladie', 'ok', true,
      'observe', 'absente : rien ne s''écrit'))::text, true);
    return;
  end if;
  for e in select * from (values
    (1, '1. le rôle des Edge Functions ne retire pas une association en direct (23514)', 'service',
      format('delete from paiements_assurance_maladie_mouvements where ligne_bancaire_id = %L', l), '23514',
      'Une association d''un paiement de l''assurance maladie ne se défait que par sa fonction, ou avec son mouvement ou son dossier.'),
    (2, '2. un mouvement retiré emporte son association', 'proprietaire',
      format('delete from lignes_bancaires where id = %L; select count(*)::text from paiements_assurance_maladie_mouvements where dossier_id = %L', l, d), 'OK', '0'),
    (3, '3. la suppression du dossier passe, ses associations parties avec lui', 'proprietaire',
      format('delete from dossiers where id = %L; select (select count(*) from paiements_assurance_maladie_mouvements where dossier_id = %L) + (select count(*) from paiements_assurance_maladie where dossier_id = %L)', d, d, d), 'OK', '0'),
    (4, '4. un paiement associé ne part pas, même laissé par la garde de NOE3 (la clé, 23503)', 'proprietaire',
      format('select set_config(''jd.paiements_assurance_maladie'', %L, true); delete from paiements_assurance_maladie where id = %L', i, p), '23503', null),
    (5, '5. un import associé ne se retire pas, même laissé par la garde de NOE3 (22023)', 'proprietaire',
      format('select set_config(''jd.paiements_assurance_maladie'', %L, true); delete from imports_assurance_maladie where id = %L', i, i), '22023',
      'Un paiement de cet import est associé à un crédit du relevé : le cabinet défait d''abord cette association.')
  ) as t(rang, etape, profil, requete, code, attendu) loop
    v_code := 'OK'; v_msg := null;
    begin
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
        values (d, 'ESSAI ASSOCIATION SUPPRESSION', cabinet, 'tresorerie', '455000', 'exonere');
      insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values (l, d, '2026-03-05', 'VIREMENT CPAM ESSAI', 50);
      perform set_config('jd.paiements_assurance_maladie', i::text, true);
      insert into imports_assurance_maladie (id, dossier_id, periode_du, periode_au, importe_par) values (i, d, '2026-03-03', '2026-03-03', gen_random_uuid());
      insert into paiements_assurance_maladie (id, dossier_id, import_id, date_journee_comptable, regime, caisse, part, montant_centimes, regularisations_centimes, nombre_de_factures)
        values (p, d, i, '2026-03-03', 1, 691, 'obligatoire', 5000, 0, 2);
      perform set_config('jd.paiements_assurance_maladie', '', true);
      perform set_config('jd.associations_assurance_maladie', d::text, true);
      insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values (d, p, l, gen_random_uuid());
      perform set_config('jd.associations_assurance_maladie', '', true);
      begin
        if e.profil = 'service' then
          execute 'set local role service_role';
          perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
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
    not exists (select 1 from dossiers where id = d) and not exists (select 1 from lignes_bancaires where id = l), 'observe', 'relu');
  perform set_config('essai.association_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.association_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
