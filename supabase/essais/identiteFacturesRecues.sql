-- L'IDENTITÉ D'UNE FACTURE ÉLECTRONIQUE REÇUE, ÉPROUVÉE EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche les colonnes `identite_*` de `pieces`, leurs contraintes, leur garde `garder_identite_piece`, ou les policies
-- de `pieces` (ligne 28.6 de la feuille de route ; migration `identite_des_factures_recues`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI L'ÉCRIT : l'anonyme et un compte rattaché à rien n'écrivent ni ne modifient rien ; le client ne se dit pas
--     reçu d'une plateforme (sa policy), et son dépôt ne porte pas d'identité (la contrainte), mais son dépôt ordinaire
--     passe toujours ; le cabinet importe une pièce reçue avec son identité, le rôle des Edge Functions aussi ;
--   - QU'ELLE NE SE MODIFIE PAS, pour personne : chacune des quatre données seule, l'effacement, l'ajout après coup —
--     refusés par la garde, à son code ET à son message ; tout le reste de la pièce se modifie comme avant, l'identité
--     réécrite à l'identique comprise ;
--   - CE QUE LA TABLE REFUSE SEULE : chaque contrainte par son nom, à ses bornes (255 caractères, neuf chiffres) ;
--   - CE QUE LE CATALOGUE DIT : les colonnes, les contraintes, le déclencheur, la garde hors de portée en RPC, et les
--     policies de `pieces` inchangées (leur empreinte d'avant la migration) ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de la ligne 28.6) : une
-- suppression (la pièce, puis la cascade d'un dossier), et un membre du cabinet qui n'est pas super-administrateur.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), comme statutsFacturesRecus.sql. Aucune
-- instruction de suppression.
--
-- ÉPROUVÉ LE 09/10/2026, après la migration `identite_des_factures_recues` (version 20261009074808) : 37 contrôles sur
-- 37 en production, rien laissé en base (77 pièces avant, 77 après). Sur la réplique : les mêmes, ce qui ne se joue pas
-- ici (quatre contrôles, R1 à R4), et quarante-six mutations de la migration, qui mordent toutes (HISTORIQUE.md, entrée
-- de la ligne 28.6). REJOUÉ LE MÊME JOUR après `revision_des_soldes` (version 20261009091615), qui pose une troisième
-- garde sur `pieces` : le contrôle 34 ne juge plus que les deux gardes qu'il nomme ; 37 sur 37, rien laissé (77 -> 77) ;
-- le texte transmis — ce fichier, ce paragraphe retiré — rend 24 109 caractères, empreinte
-- 9700ce2526372c01b3cda6e6f43e08b6 (la ligne 0).
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  dossier_c uuid; chef_super boolean; p1 uuid := gen_random_uuid();
  obs text; vus int; n_maj int; code_i text; msg_i text; code_u text; msg_u text; fixture text; lu text;
  champ text; valeur text; nom text; accepte boolean; code_recu text; message_recu text;
  avant jsonb; apres jsonb;
  verdicts jsonb := '[]'::jsonb;
  garde constant text := 'L''identité de la facture électronique d''une pièce ne se modifie pas : c''est ce que son original dit, lu à l''import.';
begin
  -- Le dossier du client : son dépôt doit passer sa propre policy.
  select m.dossier_id into dossier_c from memberships m where m.user_id = client order by m.dossier_id limit 1;
  select exists (select 1 from super_admins s where s.user_id = chef) into chef_super;
  if dossier_c is null then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai n''est membre d''aucun dossier';
  end if;
  select jsonb_build_object('pieces', (select count(*) from pieces),
    'identites', (select count(*) from pieces where identite_numero is not null)) into avant;

  -- ══ 1 et 2. L'anonyme et le compte rattaché à rien n'écrivent ni ne modifient rien ══════════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien']) loop
    vus := null; n_maj := null; code_i := null; msg_i := null; fixture := null;
    begin
      insert into pieces (id, dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece,
        identite_numero, identite_siren_vendeur, identite_date, identite_nature)
        values (p1, dossier_c, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente',
        'F2026-0001', '123456789', '2026-03-14', 'facture');
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', inconnu, 'role', 'authenticated')::text, true);
      end if;
      select count(*) into vus from pieces where id = p1;
      update pieces set identite_numero = 'F2026-9999' where id = p1;
      get diagnostics n_maj = row_count;
      begin
        insert into pieces (dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece, identite_numero)
          values (dossier_c, 'plateforme', dossier_c || '/essai-2.xml', 'essai-2.xml', 'pa.exemple.fr', 'flux-essai-2', 'vente', 'F2026-0002');
        code_i := 'ACCEPTÉ';
      exception when others then code_i := sqlstate; msg_i := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucune identité',
      'observe', coalesce(fixture, 'vues ' || coalesce(vus::text, '?') || ', modifiées ' || coalesce(n_maj::text, '?')
        || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
      'ok', fixture is null and vus = 0 and n_maj = 0
        and code_i = '42501' and msg_i like 'new row violates row-level security policy%');
  end loop;

  -- ══ 3. Le client : pas de pièce reçue d'une plateforme, pas d'identité sur son dépôt, son dépôt ordinaire passe ══════════
  vus := null; n_maj := null; code_i := null; msg_i := null; code_u := null; msg_u := null; fixture := null; lu := null;
  begin
    insert into pieces (id, dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece, identite_numero)
      values (p1, dossier_c, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente', 'F2026-0001');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', client, 'role', 'authenticated')::text, true);
    update pieces set identite_numero = 'F2026-9999' where id = p1;
    get diagnostics n_maj = row_count;
    begin
      insert into pieces (dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece, identite_numero)
        values (dossier_c, 'plateforme', dossier_c || '/essai-2.xml', 'essai-2.xml', 'pa.exemple.fr', 'flux-essai-2', 'vente', 'F2026-0002');
      code_i := 'ACCEPTÉ';
    exception when others then code_i := sqlstate; msg_i := sqlerrm;
    end;
    begin
      insert into pieces (dossier_id, source, storage_path, nom_fichier, type_piece, uploaded_by, identite_numero)
        values (dossier_c, 'upload', dossier_c || '/essai-3.pdf', 'essai-3.pdf', 'vente', client, 'F2026-0003');
      code_u := 'ACCEPTÉ';
    exception when others then code_u := sqlstate; msg_u := sqlerrm;
    end;
    begin
      insert into pieces (dossier_id, source, storage_path, nom_fichier, type_piece, uploaded_by)
        values (dossier_c, 'upload', dossier_c || '/essai-4.pdf', 'essai-4.pdf', 'vente', client);
      lu := 'ACCEPTÉ';
    exception when others then lu := sqlstate || ' ' || sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '3. le client : ni pièce reçue, ni identité sur son dépôt ; son dépôt ordinaire passe',
    'observe', coalesce(fixture, 'modifiées ' || coalesce(n_maj::text, '?') || ' — reçue : ' || coalesce(code_i, '?') || ' '
      || coalesce(msg_i, '') || ' — dépôt avec identité : ' || coalesce(code_u, '?') || ' ' || coalesce(msg_u, '')
      || ' — dépôt ordinaire : ' || coalesce(lu, '?')),
    'ok', fixture is null and n_maj = 0
      and code_i = '42501' and msg_i like 'new row violates row-level security policy%'
      and code_u = '23514' and msg_u like '%"pieces_identite_lue"%'
      and lu = 'ACCEPTÉ');

  -- ══ 4. Le cabinet importe une pièce reçue avec son identité, et la relit telle quelle ══════════
  lu := null; fixture := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    insert into pieces (id, dossier_id, uploaded_by, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece, statut,
      identite_numero, identite_siren_vendeur, identite_date, identite_nature)
      values (p1, dossier_c, chef, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente',
      'a_valider', 'F2026-0001', '123456789', '2026-03-14', 'avoir');
    select p.identite_numero || ' ' || p.identite_siren_vendeur || ' ' || p.identite_date || ' ' || p.identite_nature
      into lu from pieces p where p.id = p1;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '4. le cabinet importe une pièce reçue avec son identité, relue telle quelle',
    'observe', coalesce(fixture, coalesce(lu, '?')),
    'ok', fixture is null and lu = 'F2026-0001 123456789 2026-03-14 avoir');

  -- ══ 5. Tout le reste de la pièce se modifie comme avant, l'identité réécrite à l'identique comprise ══════════
  n_maj := null; vus := null; fixture := null; lu := null;
  begin
    insert into pieces (id, dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece,
      identite_numero, identite_siren_vendeur, identite_date, identite_nature)
      values (p1, dossier_c, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente',
      'F2026-0001', '123456789', '2026-03-14', 'facture');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    update pieces set statut = 'validee', notes = 'essai', date_piece = '2026-03-15', tiers = 'Client d''essai',
      montant_ht = 100, montant_tva = 20, montant_ttc = 120, type_piece = 'autre' where id = p1;
    get diagnostics n_maj = row_count;
    update pieces set identite_numero = identite_numero, identite_siren_vendeur = identite_siren_vendeur,
      identite_date = identite_date, identite_nature = identite_nature, notes = 'essai bis' where id = p1;
    get diagnostics vus = row_count;
    select p.statut || ' ' || p.notes || ' ' || p.date_piece || ' ' || p.identite_numero || ' ' || p.identite_date
      into lu from pieces p where p.id = p1;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. le reste de la pièce se modifie ; l''identité réécrite à l''identique passe',
    'observe', coalesce(fixture, 'modifiées ' || coalesce(n_maj::text, '?') || ' puis ' || coalesce(vus::text, '?') || ' — ' || coalesce(lu, '?')),
    'ok', fixture is null and n_maj = 1 and vus = 1 and lu = 'validee essai bis 2026-03-15 F2026-0001 2026-03-14');

  -- ══ 6 à 11. L'identité ne se modifie pas : chaque donnée seule, l'effacement, l'ajout après coup ══════════
  for obs, champ, valeur in select * from (values
      ('6. le numéro', 'identite_numero = ''F2026-0002''', null),
      ('7. le SIREN du vendeur', 'identite_siren_vendeur = ''987654321''', null),
      ('8. la date d''émission', 'identite_date = ''2026-03-15''', null),
      ('9. la nature', 'identite_nature = ''avoir''', null),
      ('10. l''effacement', 'identite_numero = null, identite_siren_vendeur = null, identite_date = null, identite_nature = null', null),
      ('11. l''ajout après coup', 'identite_numero = ''F2026-0001''', 'sans')
    ) t(o, c, v)
  loop
    accepte := false; code_recu := null; message_recu := null; fixture := null;
    begin
      if valeur = 'sans' then
        insert into pieces (id, dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece)
          values (p1, dossier_c, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente');
      else
        insert into pieces (id, dossier_id, source, storage_path, nom_fichier, flux_hote, flux_id, type_piece,
          identite_numero, identite_siren_vendeur, identite_date, identite_nature)
          values (p1, dossier_c, 'plateforme', dossier_c || '/essai.xml', 'essai.xml', 'pa.exemple.fr', 'flux-essai-1', 'vente',
          'F2026-0001', '123456789', '2026-03-14', 'facture');
      end if;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        execute format('update pieces set %s where id = %L', champ, p1);
        accepte := true;
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé par la garde',
      'observe', coalesce(fixture, case when accepte then 'ACCEPTÉ' else coalesce(code_recu, '?') || ' ' || coalesce(message_recu, '') end),
      'ok', fixture is null and not accepte and code_recu = '23514' and message_recu = garde);
  end loop;

  -- ══ 12. Le rôle des Edge Functions écrit une pièce reçue de Super PDP avec son identité, et ne la modifie pas ══════════
  code_i := null; msg_i := null; code_u := null; msg_u := null; fixture := null;
  begin
    set local role service_role;
    begin
      insert into pieces (id, dossier_id, source, storage_path, nom_fichier, superpdp_invoice_id, type_piece,
        identite_numero, identite_date)
        values (p1, dossier_c, 'superpdp', dossier_c || '/superpdp-essai.txt', 'essai.txt', 990001, 'vente', 'F2026-0001', '2026-03-14');
      code_i := 'ACCEPTÉ';
    exception when others then code_i := sqlstate; msg_i := sqlerrm;
    end;
    begin
      update pieces set identite_date = '2026-03-15' where id = p1;
      code_u := 'ACCEPTÉ';
    exception when others then code_u := sqlstate; msg_u := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '12. le rôle des Edge Functions écrit une identité (Super PDP), ne la modifie pas',
    'observe', coalesce(fixture, 'insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '') || ' — modifier : '
      || coalesce(code_u, '?') || ' ' || coalesce(msg_u, '')),
    'ok', fixture is null and code_i = 'ACCEPTÉ' and code_u = '23514' and msg_u = garde);

  -- ══ 13 à 31. Ce que la table refuse seule, contrainte par contrainte, à ses bornes ══════════
  for obs, champ, nom in select * from (values
      ('13. un SIREN sans numéro', '''plateforme'', null, ''123456789'', null, null', 'pieces_identite_complete'),
      ('14. une date sans numéro', '''plateforme'', null, null, ''2026-03-14'', null', 'pieces_identite_complete'),
      ('15. une nature sans numéro', '''plateforme'', null, null, null, ''facture''', 'pieces_identite_complete'),
      ('16. un numéro vide', '''plateforme'', '''', null, null, null', 'pieces_identite_numero'),
      ('17. un numéro précédé d''une espace', '''plateforme'', '' F2026-0001'', null, null, null', 'pieces_identite_numero'),
      ('18. un numéro suivi d''une espace', '''plateforme'', ''F2026-0001 '', null, null, null', 'pieces_identite_numero'),
      ('19. un numéro de 256 caractères', '''plateforme'', repeat(''9'', 256), null, null, null', 'pieces_identite_numero'),
      ('20. un SIREN de huit chiffres', '''plateforme'', ''F2026-0001'', ''12345678'', null, null', 'pieces_identite_siren_vendeur'),
      ('21. un SIREN de dix chiffres', '''plateforme'', ''F2026-0001'', ''1234567890'', null, null', 'pieces_identite_siren_vendeur'),
      ('22. un SIREN qui porte une lettre', '''plateforme'', ''F2026-0001'', ''12345678A'', null, null', 'pieces_identite_siren_vendeur'),
      ('23. un SIREN précédé d''une espace', '''plateforme'', ''F2026-0001'', '' 23456789'', null, null', 'pieces_identite_siren_vendeur'),
      ('24. une autre nature', '''plateforme'', ''F2026-0001'', null, null, ''autre''', 'pieces_identite_nature'),
      ('25. une nature en capitale', '''plateforme'', ''F2026-0001'', null, null, ''Facture''', 'pieces_identite_nature'),
      ('26. une identité sur un dépôt', '''upload'', ''F2026-0001'', null, null, null', 'pieces_identite_lue'),
      ('27. une identité sur un e-mail', '''email'', ''F2026-0001'', null, null, null', 'pieces_identite_lue'),
      ('28. un numéro seul, le reste inconnu', '''plateforme'', ''F2026-0001'', null, null, null', null),
      ('29. un numéro de 255 caractères', '''plateforme'', repeat(''9'', 255), null, null, null', null),
      ('30. un numéro aux espaces intérieures', '''plateforme'', ''FA 2026 0001'', ''000000000'', ''2026-12-31'', ''avoir''', null),
      ('31. une identité reçue de Super PDP', '''superpdp'', ''F2026-0001'', ''123456789'', ''2026-03-14'', ''facture''', null)
    ) t(o, c, n)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      -- Le flux suit la source : une pièce reçue d'une plateforme en porte un, les autres non (pieces_flux_plateforme).
      execute format('insert into pieces (dossier_id, storage_path, nom_fichier, type_piece, flux_hote, flux_id, source, '
        || 'identite_numero, identite_siren_vendeur, identite_date, identite_nature) '
        || 'select %L::uuid, %L, %L, %L, case when s = ''plateforme'' then ''pa.exemple.fr'' end, '
        || 'case when s = ''plateforme'' then ''flux-essai-c'' end, s, n, r, d::date, a from (select %s) t(s, n, r, d, a)',
        dossier_c, dossier_c || '/essai.xml', 'essai.xml', 'vente', champ);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || case when nom is null then ' : accepté' else ' : refusé par ' || nom end,
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', case when nom is null then accepte and code_recu = 'P0001'
                 else not accepte and code_recu = '23514' and message_recu like '%"' || nom || '"%' end);
  end loop;

  -- ══ 32 à 36. Ce que le catalogue dit ══════════
  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text
           || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ', ' order by a.attname) into obs
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.pieces'::regclass and a.attname like 'identite\_%' and not a.attisdropped;
  verdicts := verdicts || jsonb_build_object('controle', '32. catalogue : quatre colonnes, facultatives, sans valeur par défaut',
    'observe', obs, 'ok', obs = 'identite_date date true -, identite_nature text true -, identite_numero text true -, '
      || 'identite_siren_vendeur text true -');

  select string_agg(c.conname || ' ' || pg_get_constraintdef(c.oid), ' | ' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.pieces'::regclass and c.conname like 'pieces\_identite\_%';
  verdicts := verdicts || jsonb_build_object('controle', '33. catalogue : les cinq contraintes de l''identité',
    'observe', obs, 'ok', obs = 'pieces_identite_complete CHECK (((identite_numero IS NOT NULL) OR ((identite_siren_vendeur IS NULL) AND (identite_date IS NULL) AND (identite_nature IS NULL))))'
      || ' | pieces_identite_lue CHECK (((identite_numero IS NULL) OR (source = ANY (ARRAY[''plateforme''::text, ''superpdp''::text]))))'
      || ' | pieces_identite_nature CHECK ((identite_nature = ANY (ARRAY[''facture''::text, ''avoir''::text])))'
      || ' | pieces_identite_numero CHECK ((((length(identite_numero) >= 1) AND (length(identite_numero) <= 255)) AND (identite_numero = btrim(identite_numero))))'
      || ' | pieces_identite_siren_vendeur CHECK ((identite_siren_vendeur ~ ''^[0-9]{9}$''::text))');

  -- Les deux gardes NOMMÉES, chacune à sa définition exacte : une autre migration peut poser sa propre garde sur
  -- `pieces` (`revision_des_soldes` l'a fait le même jour, sur `dossier_id` et la suppression), et ce contrôle ne la juge pas.
  select string_agg(pg_get_triggerdef(t.oid), ' | ' order by t.tgname) into obs
    from pg_trigger t where t.tgrelid = 'public.pieces'::regclass and not t.tgisinternal
     and t.tgname in ('pieces_figees_par_la_validation', 'pieces_identite_immuable');
  verdicts := verdicts || jsonb_build_object('controle', '34. catalogue : la garde veille sur la modification des quatre colonnes, à côté de celle des exercices validés',
    'observe', obs, 'ok', obs = 'CREATE TRIGGER pieces_figees_par_la_validation BEFORE DELETE OR UPDATE ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_piece_validee()'
      || ' | CREATE TRIGGER pieces_identite_immuable BEFORE UPDATE OF identite_numero, identite_siren_vendeur, identite_date, identite_nature ON public.pieces FOR EACH ROW EXECUTE FUNCTION garder_identite_piece()');

  select has_function_privilege('anon', p.oid, 'execute')::text || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text
      || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') into obs
    from pg_proc p where p.oid = 'public.garder_identite_piece()'::regprocedure;
  verdicts := verdicts || jsonb_build_object('controle', '35. catalogue : la garde hors de portée en RPC, aux droits de l''appelant, son search_path fixé',
    'observe', obs, 'ok', obs = 'false/false false search_path=public');

  select count(*) || ' ' || md5(string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-')
           || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.policyname)) into obs
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'pieces';
  verdicts := verdicts || jsonb_build_object('controle', '36. catalogue : les policies de pieces sont celles d''avant la migration',
    'observe', obs, 'ok', obs = '4 95217063cdf4065ac70bf19b67c62fda');

  -- ══ 37. Rien n'est resté ══════════
  select jsonb_build_object('pieces', (select count(*) from pieces),
    'identites', (select count(*) from pieces where identite_numero is not null)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '37. rien n''est resté en base',
    'observe', avant::text || ' -> ' || apres::text, 'ok', avant = apres);

  perform set_config('essai.identite', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui, le fichier entier sans son
-- dernier saut de ligne —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.identite')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
