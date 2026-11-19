-- LE FACTURÉ À L'ASSURANCE MALADIE : CE QU'UNE SUPPRESSION RENCONTRE (BOR3) — SUR UNE RÉPLIQUE SEULEMENT, jamais en
-- production (l'outil d'exécution y retient une suppression), en UNE transaction (`psql -1`), sous le propriétaire. Le pendant
-- de facturesAssuranceMaladie.sql. Chaque étape se joue dans sa sous-transaction et s'y annule.
--
-- Ce qui se prouve : ni un import, ni un total, ni une empreinte, ni la clé ne se retirent en direct, même par le rôle des
-- Edge Functions ou par le propriétaire hors de l'import ; le retrait d'un import (le réglage de sa fonction) emporte ses
-- totaux et ses empreintes, la clé restant ; la suppression d'un dossier passe, tout parti avec lui, sa clé comprise ; la clé
-- ne se pose pas hors de l'import, même par le propriétaire. Une garde de tête refuse de le jouer hors d'une réplique
-- (ESSAI_HORS_REPLIQUE : le rôle `proprietaire` manque à la production).
do $essai$
declare
  d constant uuid := 'e5900000-0000-4000-8000-0000000000e1';
  i constant uuid := 'e5900000-0000-4000-8000-0000000002e1';
  cabinet uuid := (select cabinet_id from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24');
  e record; v_code text; v_msg text;
  verdicts jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.factures_assurance_maladie') is null then
    perform set_config('essai.factures_suppression', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', '0. EN ATTENTE de la migration factures_assurance_maladie', 'ok', true,
      'observe', 'absente : rien ne s''écrit'))::text, true);
    return;
  end if;
  for e in select * from (values
    (1, '1. le rôle des Edge Functions ne retire pas la clé d''un dossier en direct (23514)', 'service',
      format('delete from cles_des_lots_teletransmission where dossier_id = %L', d), '23514',
      'La clé des lots d''un dossier ne part qu''avec son dossier.'),
    (2, '2. … ni une empreinte du registre (23514)', 'service',
      format('delete from lots_teletransmission_importes where dossier_id = %L', d), '23514',
      'Le facturé à l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'),
    (3, '3. … ni un total (23514)', 'service',
      format('delete from factures_assurance_maladie where dossier_id = %L', d), '23514',
      'Le facturé à l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'),
    (4, '4. … ni un import (23514)', 'service',
      format('delete from imports_factures_assurance_maladie where id = %L', i), '23514',
      'Le facturé à l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'),
    (5, '5. le propriétaire, hors de l''import, ne retire pas un import non plus (23514)', 'proprietaire',
      format('delete from imports_factures_assurance_maladie where id = %L', i), '23514',
      'Le facturé à l''assurance maladie ne part qu''avec son import, par son retrait, ou avec son dossier.'),
    (6, '6. le retrait de l''import (le réglage de sa fonction) emporte ses totaux et ses empreintes ; la clé reste', 'proprietaire',
      format('select set_config(''jd.factures_assurance_maladie'', %L, true); delete from imports_factures_assurance_maladie where id = %L; '
        || 'select (select count(*) from imports_factures_assurance_maladie where dossier_id = %L) || '' '' || (select count(*) from factures_assurance_maladie where dossier_id = %L) || '' '' || (select count(*) from lots_teletransmission_importes where dossier_id = %L) || '' '' || (select count(*) from cles_des_lots_teletransmission where dossier_id = %L)',
        i, i, d, d, d, d), 'OK', '0 0 0 1'),
    (7, '7. la suppression du dossier passe : son import, ses totaux, ses empreintes et sa clé partent avec lui', 'proprietaire',
      format('delete from dossiers where id = %L; select (select count(*) from imports_factures_assurance_maladie where dossier_id = %L) || '' '' || (select count(*) from factures_assurance_maladie where dossier_id = %L) || '' '' || (select count(*) from lots_teletransmission_importes where dossier_id = %L) || '' '' || (select count(*) from cles_des_lots_teletransmission where dossier_id = %L)',
        d, d, d, d, d), 'OK', '0 0 0 0'),
    (8, '8. le propriétaire ne pose pas une seconde clé hors de l''import (42501)', 'proprietaire',
      format('insert into cles_des_lots_teletransmission (dossier_id, cle) values (%L, decode(repeat(''12'', 32), ''hex''))', d), '42501',
      'La clé des lots d''un dossier ne s''écrit que par l''import du facturé.')
  ) as t(rang, etape, profil, requete, code, attendu) loop
    v_code := 'OK'; v_msg := null;
    begin
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, statut_tva)
        values (d, 'ESSAI FACTURE SUPPRESSION', cabinet, 'tresorerie', '455000', 'exonere');
      perform set_config('jd.cle_des_lots_teletransmission', d::text, true);
      insert into cles_des_lots_teletransmission (dossier_id, cle) values (d, decode(repeat('5a', 32), 'hex'));
      perform set_config('jd.cle_des_lots_teletransmission', '', true);
      perform set_config('jd.factures_assurance_maladie', i::text, true);
      insert into imports_factures_assurance_maladie (id, dossier_id, premier_lot_le, dernier_lot_le, nombre_de_lots, nombre_de_factures, importe_par)
        values (i, d, '2026-03-03', '2026-03-03', 1, 2, gen_random_uuid());
      insert into factures_assurance_maladie (dossier_id, import_id, date_creation_lot, part, regime, caisse, organisme_complementaire, montant_centimes, nombre_de_lots, nombre_de_factures)
        values (d, i, '2026-03-03', 'obligatoire', 1, 691, null, 5000, 1, 2);
      insert into lots_teletransmission_importes (dossier_id, import_id, empreinte) values (d, i, decode(repeat('6b', 32), 'hex'));
      perform set_config('jd.factures_assurance_maladie', '', true);
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
    perform set_config('jd.factures_assurance_maladie', '', true);
    verdicts := verdicts || jsonb_build_object('rang', e.rang, 'etape', e.etape,
      'ok', v_code = e.code and (e.attendu is null or v_msg = e.attendu), 'observe', v_code || ' ' || coalesce(v_msg, '-'));
  end loop;
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté', 'ok',
    not exists (select 1 from dossiers where id = d) and not exists (select 1 from imports_factures_assurance_maladie where id = i)
    and not exists (select 1 from cles_des_lots_teletransmission where dossier_id = d), 'observe', 'relu');
  perform set_config('essai.factures_suppression', verdicts::text, true);
end
$essai$;

select v.rang, v.etape, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.factures_suppression')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
