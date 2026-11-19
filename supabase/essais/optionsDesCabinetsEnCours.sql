-- L'EXTINCTION GARDÉE DE LA FACTURE ÉLECTRONIQUE ET DES PAIEMENTS DE L'ASSURANCE MALADIE, SUR UNE RÉPLIQUE SEULEMENT
-- (conception 56, lot OPT1 ; la migration `options_des_cabinets`, en production depuis le 19/11/2026, 244 :
-- supabase/schema/20261119140325_options_des_cabinets.sql). Elle pose, le temps d'une sous-transaction, des lignes
-- SANS LEURS GARDES (`session_replication_role = replica`, le super-utilisateur) : un envoi d'une facture ou d'une
-- déclaration d'encaissement resté sans issue connue, et l'association d'un paiement de l'assurance maladie à un crédit du
-- relevé, que les fonctions d'écriture ne posent qu'au bout d'un jeu que la production n'a pas. Le reste de la règle :
-- optionsDesCabinets.sql, joué en production.
--
-- Ce qui se prouve ici : la facture électronique ne se ferme pas tant qu'une facture ou une déclaration d'encaissement d'un
-- dossier du cabinet est partie sans issue connue (`etat = 'envoi'`), la phrase nommant le dossier ; déposée, acceptée,
-- rejetée ou en échec, elle ne retient plus rien ; l'assurance maladie ne se ferme pas tant qu'un paiement d'un dossier du
-- cabinet est associé à un crédit (la table de NOE5, si elle est en base — sinon une ligne EN ATTENTE) ; et rien n'est resté.
-- Le jeu : un cabinet et un dossier que l'essai crée et qu'il annule ; le super-administrateur d'essai. Sans la migration,
-- une ligne EN ATTENTE.
do $essai$
declare
  super constant uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  v_cab uuid := gen_random_uuid();
  v_dos uuid := gen_random_uuid();
  v_obs text;
  v_message text;
  verdicts jsonb := '[]'::jsonb;
begin
  if to_regclass('public.options_des_cabinets') is null then
    perform set_config('essai.options_en_cours', jsonb_build_array(jsonb_build_object('rang', 0,
      'etape', 'OE. EN ATTENTE de la migration options_des_cabinets', 'ok', true, 'observe', 'table absente'))::text, true);
    return;
  end if;
  begin
    perform set_config('request.jwt.claims', '', true);
    insert into cabinets (id, nom) values (v_cab, 'Cabinet d''essai des options en cours');
    insert into dossiers (id, nom, cabinet_id) values (v_dos, 'Dossier d''essai des envois', v_cab);
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', super, 'role', 'authenticated')::text, true);
    perform regler_option_du_cabinet(v_cab, 'facture_electronique', true);
    perform regler_option_du_cabinet(v_cab, 'assurance_maladie', true);
    reset role;

    -- 1. Une facture partie sans issue connue retient la facture électronique ; déposée, plus rien.
    begin
      set local session_replication_role = replica;
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat)
        values (v_dos, gen_random_uuid(), 'superpdp', 'api.superpdp.tech', repeat('ab', 32), 'envoi');
      set local session_replication_role = origin;
      set local role authenticated;
      begin
        perform regler_option_du_cabinet(v_cab, 'facture_electronique', false);
        v_obs := 'ACCEPTÉ';
      exception when others then v_obs := sqlstate || ' ' || sqlerrm;
      end;
      reset role;
      set local session_replication_role = replica;
      update transmissions_factures set etat = 'depose', flux_id = 'flux-essai' where dossier_id = v_dos;
      set local session_replication_role = origin;
      set local role authenticated;
      v_obs := v_obs || ' | ' || regler_option_du_cabinet(v_cab, 'facture_electronique', false)::text;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. une facture partie sans issue connue retient la facture électronique, le dossier nommé ; déposée, elle ne retient plus rien',
        'ok', v_obs = 'P0001 Le module « Facture électronique » ne se ferme pas : une facture ou une déclaration d''encaissement de ces dossiers est partie vers une plateforme sans issue connue : « Dossier d''essai des envois ». | {assurance_maladie}',
        'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 1, 'etape', '1. une facture sans issue connue', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 2. La déclaration d'un encaissement partie sans issue connue la retient aussi ; en échec, plus rien.
    begin
      set local session_replication_role = replica;
      insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat)
        values (v_dos, gen_random_uuid(), gen_random_uuid(), 'superpdp', 'api.superpdp.tech', repeat('cd', 32), 'envoi');
      set local session_replication_role = origin;
      set local role authenticated;
      begin
        perform regler_option_du_cabinet(v_cab, 'facture_electronique', false);
        v_obs := 'ACCEPTÉ';
      exception when others then v_obs := sqlstate;
      end;
      reset role;
      set local session_replication_role = replica;
      update transmissions_encaissements set etat = 'echec' where dossier_id = v_dos;
      set local session_replication_role = origin;
      set local role authenticated;
      v_obs := v_obs || ' | ' || regler_option_du_cabinet(v_cab, 'facture_electronique', false)::text;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. la déclaration d''un encaissement partie sans issue connue la retient aussi ; en échec, plus rien',
        'ok', v_obs = 'P0001 | {assurance_maladie}', 'observe', v_obs);
      raise exception 'ANNULATION_ETAPE';
    exception when others then
      reset role;
      if sqlerrm <> 'ANNULATION_ETAPE' then
        verdicts := verdicts || jsonb_build_object('rang', 2, 'etape', '2. une déclaration sans issue connue', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
      end if;
    end;

    -- 3. Un paiement de l'assurance maladie associé à un crédit retient le module (NOE5) ; sans la table, rien ne retient.
    if to_regclass('public.paiements_assurance_maladie_mouvements') is null then
      set local role authenticated;
      v_obs := regler_option_du_cabinet(v_cab, 'assurance_maladie', false)::text;
      reset role;
      verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. EN ATTENTE de la migration association_paiements_assurance_maladie (NOE5) : sans sa table, l''assurance maladie se ferme',
        'ok', v_obs = '{facture_electronique}', 'observe', v_obs);
    else
      begin
        set local session_replication_role = replica;
        execute 'insert into paiements_assurance_maladie_mouvements (dossier_id, paiement_id, ligne_bancaire_id, associe_par) values ($1, $2, $3, $4)'
          using v_dos, gen_random_uuid(), gen_random_uuid(), super;
        set local session_replication_role = origin;
        set local role authenticated;
        begin
          perform regler_option_du_cabinet(v_cab, 'assurance_maladie', false);
          v_message := 'ACCEPTÉ';
        exception when others then v_message := sqlstate || ' ' || sqlerrm;
        end;
        reset role;
        verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. un paiement de l''assurance maladie associé à un crédit retient le module, le dossier nommé',
          'ok', v_message = 'P0001 Le module « Paiements de l''assurance maladie » ne se ferme pas : un paiement de l''assurance maladie de ces dossiers est associé à un crédit du relevé : « Dossier d''essai des envois ».',
          'observe', v_message);
        raise exception 'ANNULATION_ETAPE';
      exception when others then
        reset role;
        if sqlerrm <> 'ANNULATION_ETAPE' then
          verdicts := verdicts || jsonb_build_object('rang', 3, 'etape', '3. un paiement associé', 'ok', false, 'observe', sqlstate || ' ' || sqlerrm);
        end if;
      end;
    end if;

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    reset role;
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      raise;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  verdicts := verdicts || jsonb_build_object('rang', 99, 'etape', '99. rien n''est resté : ni le cabinet d''essai, ni une ligne posée sans sa garde',
    'ok', not exists (select 1 from cabinets where id = v_cab)
      and not exists (select 1 from transmissions_factures where dossier_id = v_dos)
      and not exists (select 1 from transmissions_encaissements where dossier_id = v_dos),
    'observe', 'relu');
  perform set_config('essai.options_en_cours', verdicts::text, true);
end
$essai$;

-- Un verdict nul est une faute.
select v.rang, v.etape, coalesce(v.ok, false) as ok, coalesce(v.observe, 'nul') as observe
from jsonb_to_recordset(current_setting('essai.options_en_cours')::jsonb) as v(rang integer, etape text, ok boolean, observe text)
order by v.rang;
