-- LES DEVIS CITENT LE CONTACT D'OÙ VIENT LEUR CLIENT, ÉPROUVÉ EN BASE — à rejouer par `execute_sql` après toute migration
-- qui touche `devis`, `contacts`, `enregistrer_devis`, `facturer_devis`, `facturer_acompte_devis`, `enregistrer_facture` ou
-- la garde des devis. La migration : supabase/preparees/20261106160000_devis_citent_un_contact.sql (PRÉPARÉE, PAS
-- APPLIQUÉE) ; le module qui la redit : src/lib/devis.ts (`REFUS_CONTACT_DU_DEVIS`, `DEVIS_CITENT_UN_CONTACT`) ; le récit :
-- HISTORIQUE.md, « LES DEVIS CITENT LEUR CONTACT, ET LES CLIENTS SANS ACTIVITÉ DEPUIS TROIS ANS ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : `devis.contact_id`, un uuid nullable SANS clé étrangère ; les trois policies des devis inchangées ; les
--     trois fonctions exécutables par les connectés, ni par l'anonyme ni par PUBLIC ;
--   - LE REFUS d'`enregistrer_devis` (16 bis, P0002, les mots du module) : un contact d'un autre dossier, inconnu, ou qui
--     n'est pas une chaîne ; à sa place dans l'ordre — après les montants, avant l'IBAN ; pour le cabinet et pour le client
--     « Ventes » ; un contact effacé du dossier se cite (comme la facture le juge) ;
--   - L'ÉCRITURE : dès le brouillon, réécrite avec lui (une clé absente vaut nul), figée à l'émission par la garde ;
--   - LA FACTURE TIRÉE : `facturer_devis` et `facturer_acompte_devis` reprennent le contact du devis, et aucun quand il n'est
--     plus un contact du dossier ;
--   - et que RIEN ne reste en base.
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, basculé, où le client de l'essai a un accès « Ventes » ;
-- B), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) ; chaque contrôle dans sa
-- sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`) ; les étapes « jeu » et « fait » restent jusqu'à l'annulation
-- finale, et une étape peut rendre une valeur que les suivantes citent (`{CLE}`). Un refus se juge à son code ET à son
-- message (`like`). Le fichier se joue d'un seul appel, ne crée aucun objet et ne porte AUCUNE instruction de retrait de
-- ligne ; il ne rend rien qui dépende d'une ligne hors de ses dossiers (l'écart seul). Sans la migration, le contrôle 0 se
-- dit EN ATTENTE et ceux qui la demandent sont en faute.

do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  jour date := (now() at time zone 'Europe/Paris')::date;
  cabinet uuid;
  ids jsonb;
  verdicts jsonb := '[]'::jsonb;
  en_base boolean;
  s record;
  k text;
  ordre text;
  attendu text;
  rendu text;
  code_recu text;
  message text;
  ok boolean;
  erreur text;
  avant text;
  apres text;
begin
  if to_regclass('public.devis') is null or to_regclass('public.contacts') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les devis ou les contacts ne sont pas en base';
  end if;
  en_base := exists (select 1 from pg_attribute where attrelid = 'public.devis'::regclass and attname = 'contact_id'
                      and not attisdropped);
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : le chef de l''essai ou le client d''essai (sans cabinet) manque';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'c0c70000-0000-4000-8000-0000000000a1', 'DB', 'c0c70000-0000-4000-8000-0000000000b1',
    'ACCES', 'c0c70000-0000-4000-8000-0000000000c1',
    'KA', 'c0c70000-0000-4000-8000-0000000000d1', 'KX', 'c0c70000-0000-4000-8000-0000000000d2',
    'KM', 'c0c70000-0000-4000-8000-0000000000d3', 'KB', 'c0c70000-0000-4000-8000-0000000000e1',
    'INCONNU', 'c0c70000-0000-4000-8000-0000000000f9',
    'JOUR', to_char(jour, 'YYYY-MM-DD'),
    'LIGNES', '[{"designation":"ESSAI CONTACT","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]');

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from contacts)),
    ((select count(*) from devis)), ((select count(*) from devis_factures)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from devis_numerotation))
  ) as x(n);

  verdicts := verdicts || jsonb_build_object('controle', '00. la migration devis_citent_un_contact est en base (son témoin : devis.contact_id)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu ══════════
      ('j1', 'jeu', 'dossiers jetables A (basculé) et B', 'proprietaire',
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures, forme_juridique,
             denomination_imprimee, siret, adresse, mode_comptable) values
          ('{DA}', 'ESSAI CONTACT A', '{CAB}', 'redevable', true, true, '5710', 'ESSAI CONTACT A SAS', '12345678200010', '1 rue de l''Essai, 75001 Paris', 'tresorerie'),
          ('{DB}', 'ESSAI CONTACT B', '{CAB}', 'redevable', true, false, '5710', 'ESSAI CONTACT B SAS', '12345678200028', '2 rue de l''Essai, 75001 Paris', 'tresorerie') returning id::text$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès « Ventes » du client d''essai au dossier A', 'proprietaire',
        $q$insert into memberships (id, user_id, dossier_id, role, email, droit_ventes) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-contact@exemple.invalid', true) returning id::text$q$, 'OK', null, null),
      ('j3', 'jeu', 'KA, KM (en cours) et KX (effacé) dans A ; KB dans B', 'proprietaire',
        $q$insert into contacts (id, dossier_id, genre, nom, type_client, adresse, efface_le, efface_par) values
          ('{KA}', '{DA}', 'client', 'ESSAI KA', 'assujetti', '1 rue KA', null, null), ('{KM}', '{DA}', 'client', 'ESSAI KM', 'assujetti', '1 rue KM', null, null),
          ('{KX}', '{DA}', 'client', 'Contact effacé le 01/01/2026', null, null, now(), '{CHEF}'), ('{KB}', '{DB}', 'client', 'ESSAI KB', 'assujetti', '1 rue KB', null, null) returning id::text$q$, 'OK', null, null),

      -- ══ 1. Le catalogue ══════════
      ('01', 'controle', 'devis.contact_id : un uuid nullable', 'proprietaire',
        $q$select data_type || ' ' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'devis' and column_name = 'contact_id'$q$, 'OK', 'uuid YES', null),
      ('02', 'controle', 'aucune clé étrangère ne part de devis.contact_id', 'proprietaire',
        $q$select count(*)::text from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) where c.conrelid = 'public.devis'::regclass and c.contype = 'f' and a.attname = 'contact_id'$q$, 'OK', '0', null),
      ('03', 'controle', 'les policies des devis : trois, inchangées', 'proprietaire',
        $q$select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' order by policyname) from pg_policies where schemaname = 'public' and tablename = 'devis'$q$, 'OK', 'devis_lecture:SELECT:authenticated devis_lecture_ventes:SELECT:authenticated devis_restauration:INSERT:authenticated', null),
      ('04', 'controle', 'les trois fonctions : aux connectés, ni à l''anonyme ni à PUBLIC', 'proprietaire',
        $q$select string_agg(f || ':' || has_function_privilege('authenticated', f, 'execute')::text || has_function_privilege('anon', f, 'execute')::text
             || coalesce((select bool_or(a.grantee = 0)::text from pg_proc p, aclexplode(p.proacl) a where p.oid = f::regprocedure), 'public'), ' ' order by f)
           from unnest(array['public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean)', 'public.facturer_acompte_devis(uuid, uuid, jsonb, date)', 'public.facturer_devis(uuid, uuid)']) f$q$, 'OK',
        'public.enregistrer_devis(uuid, uuid, jsonb, jsonb, boolean):truefalsefalse public.facturer_acompte_devis(uuid, uuid, jsonb, date):truefalsefalse public.facturer_devis(uuid, uuid):truefalsefalse', null),

      -- ══ 2. Le refus 16 bis ══════════
      ('11', 'controle', 'un brouillon cite KA, un contact du dossier', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}"}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '{KA}', null),
      ('12', 'controle', 'un brouillon de A cite KB, un contact de B', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KB}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),
      ('13', 'controle', 'un brouillon cite un identifiant qu''aucun contact ne porte', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{INCONNU}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),
      ('14', 'controle', 'un brouillon cite un contact qui n''est pas une chaîne', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":12}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),
      ('15', 'controle', 'un brouillon cite KX, effacé, du dossier : comme la facture, il se cite', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KX}"}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '{KX}', null),
      ('16', 'controle', 'un brouillon sans la clé, ou nulle : aucun contact', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":null}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '∅', null),
      ('17', 'controle', 'l''ordre : des montants faux l''emportent sur le contact (16 avant 16 bis)', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":1,"montant_tva":20,"montant_ttc":120,"contact_id":"{KB}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, '22023', 'Les montants du devis ne sont pas ceux de ses lignes%', null),
      ('18', 'controle', 'l''ordre : le contact l''emporte sur un IBAN dans l''objet (16 bis avant 17)', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","objet":"FR7630006000011234567890189","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KB}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),
      ('M18', 'mutation', 'le contrôle 18 rejoué avec KA : l''IBAN refuse alors', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","objet":"FR7630006000011234567890189","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, '22023', 'Un IBAN figure dans l''objet du devis%', null),
      ('19', 'controle', 'le client « Ventes » cite KA', 'client',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}"}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '{KA}', null),
      ('20', 'controle', 'le client « Ventes » cite KB, d''un autre dossier', 'client',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KB}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),

      -- ══ 3. Le brouillon réécrit, puis émis et figé ══════════
      ('f1', 'fait', 'DV1 : un brouillon de A qui cite KA', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","nature_operation":"services","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'OK', null, 'DV1'),
      ('31', 'controle', 'DV1 réécrit sans la clé : il ne cite plus aucun contact (le brouillon se réécrit en entier)', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '∅', null),
      ('32', 'controle', 'DV1 réécrit avec KM : il cite KM', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KM}"}'::jsonb, '{LIGNES}'::jsonb, false) e ;; select coalesce(contact_id::text, '∅') from devis where id = '{RENDU}'$q$, 'OK', '{KM}', null),
      ('33', 'controle', 'DV1 réécrit avec KB : refusé, et il garde KA', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KB}"}'::jsonb, '{LIGNES}'::jsonb, false) e$q$, 'P0002', 'Le contact d''où vient le client du devis est introuvable dans ce dossier.', null),
      ('M33', 'mutation', 'un brouillon change de contact par une écriture directe : la garde le laisse faire', 'proprietaire',
        $q$update devis set contact_id = '{KM}' where id = '{DV1}' returning contact_id::text$q$, 'OK', '{KM}', null),
      ('f2', 'fait', 'DV1 émis avec KA, puis accepté', 'chef',
        $q$select e.devis_id::text from enregistrer_devis('{DA}', '{DV1}', '{"tiers_nom":"ESSAI","nature_operation":"services","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KA}"}'::jsonb, '{LIGNES}'::jsonb, true) e ;; select left(decider_devis('{DA}', '{RENDU}'::uuid, 'acceptee', '{JOUR}'::date, false)::text, 0) || '{RENDU}'$q$, 'OK', null, null),
      ('34', 'controle', 'DV1 émis : son contact a été écrit à l''émission', 'chef',
        $q$select coalesce(contact_id::text, '∅') || '/' || statut from devis where id = '{DV1}'$q$, 'OK', '{KA}/emis', null),
      ('35', 'controle', 'DV1 émis : une écriture directe de son contact est refusée par la garde', 'proprietaire',
        $q$update devis set contact_id = '{KM}' where id = '{DV1}' returning id::text$q$, '23514', 'Le devis % est émis : il ne se modifie plus — il se duplique.', null),
      ('36', 'controle', 'DV1 émis : le contact effacé le même jour ne touche pas au devis', 'proprietaire',
        $q$with x as (update contacts set nom = 'Contact effacé le 06/11/2026', type_client = null, adresse = null, efface_le = now(), efface_par = '{CHEF}' where id = '{KA}' returning id) select coalesce(d.contact_id::text, '∅') from devis d, x where d.id = '{DV1}'$q$, 'OK', '{KA}', null),

      -- ══ 4. La facture tirée reprend le contact ══════════
      ('41', 'controle', 'la facture tirée de DV1 cite KA', 'chef',
        $q$select facturer_devis('{DA}', '{DV1}')::text ;; select coalesce(contact_id::text, '∅') from factures_emises where id = '{RENDU}'$q$, 'OK', '{KA}', null),
      ('f3', 'fait', 'DV2 : émis avec KM, accepté (des services)', 'chef',
        $q$select e.devis_id::text || left(decider_devis('{DA}', e.devis_id, 'acceptee', '{JOUR}'::date, false)::text, 0) from enregistrer_devis('{DA}', null, '{"tiers_nom":"ESSAI","nature_operation":"services","date_emission":"{JOUR}","date_validite":"{JOUR}","montant_ht":100,"montant_tva":20,"montant_ttc":120,"contact_id":"{KM}"}'::jsonb, '{LIGNES}'::jsonb, true) e$q$, 'OK', null, 'DV2'),
      ('42', 'controle', 'l''acompte de 10 % tiré de DV2 cite KM', 'chef',
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text ;; select coalesce(contact_id::text, '∅') from factures_emises where id = '{RENDU}'$q$, 'OK', '{KM}', null),
      ('f4', 'fait', 'KM passe au dossier B : il n''est plus un contact de A', 'proprietaire',
        $q$update contacts set dossier_id = '{DB}' where id = '{KM}' returning id::text$q$, 'OK', null, null),
      ('43', 'controle', 'la facture tirée de DV2, dont le contact a quitté le dossier : aucun contact, et elle se tire', 'chef',
        $q$select facturer_devis('{DA}', '{DV2}')::text ;; select coalesce(contact_id::text, '∅') from factures_emises where id = '{RENDU}'$q$, 'OK', '∅', null),
      ('44', 'controle', 'l''acompte de DV2, même contact parti : aucun contact, et il se tire', 'chef',
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text ;; select coalesce(contact_id::text, '∅') from factures_emises where id = '{RENDU}'$q$, 'OK', '∅', null)
    ) as x(num, genre, controle, qui, ordre, code, attendu, cle)
    loop
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) order by 1 desc loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      code_recu := null; message := null; rendu := null;
      begin
        if s.qui in ('client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        -- « A ;; B » : B lit ce que A vient d'écrire, dans une seconde instruction qui le voit ({RENDU}, ce que A a rendu).
        if position(' ;; ' in ordre) > 0 then
          execute split_part(ordre, ' ;; ', 1) into rendu;
          execute replace(split_part(ordre, ' ;; ', 2), '{RENDU}', coalesce(rendu, '')) into rendu;
        else
          execute ordre into rendu;
        end if;
        code_recu := 'OK';
        if s.genre in ('controle', 'mutation') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then
        if sqlerrm <> 'ANNULATION_ESSAI' then code_recu := sqlstate; message := sqlerrm; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if s.cle is not null and code_recu = 'OK' then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := code_recu = s.code and (attendu is null
        or (s.code = 'OK' and rendu is not distinct from attendu)
        or (s.code <> 'OK' and message like attendu));
      if s.genre in ('jeu', 'fait') and not ok then
        erreur := s.num || ' : ' || coalesce(code_recu || ' ' || message, code_recu);
        raise exception 'ANNULATION_ESSAI_GLOBALE';
      end if;
      if s.genre in ('controle', 'mutation') then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when ok then coalesce(rendu, code_recu) else coalesce(code_recu || ' ' || message, 'rendu « ' || coalesce(rendu, '—') || ' »') end, 'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from contacts)),
    ((select count(*) from devis)), ((select count(*) from devis_factures)), ((select count(*) from factures_emises)),
    ((select count(*) from facture_lignes)), ((select count(*) from devis_numerotation))
  ) as x(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg((a.n::bigint - b.n::bigint)::text, '/' order by a.r)
      from unnest(string_to_array(apres, '/')) with ordinality as a(n, r) join unnest(string_to_array(avant, '/')) with ordinality as b(n, r) using (r)),
    'ok', erreur is null and apres = avant);
  perform set_config('essai.devis_citent_un_contact', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.devis_citent_un_contact')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, v.controle collate "C";
