-- LES DÉCLARATIONS D'UN ENCAISSEMENT, ÉPROUVÉES EN BASE — à rejouer par `execute_sql` après toute migration qui touche
-- `transmissions_encaissements`, son déclencheur `garder_transmission_encaissement` ou ses policies, les fonctions
-- `declarer_encaissement_hors_application`, `annuler_encaissement` et `encaissement_declare`, ou ce qu'elles lisent
-- (`encaissements_factures`, `transmissions_factures`, `facture_superpdp_events`) (ligne 28.5, étape d4 ; migration
-- `transmissions_des_encaissements`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT : une déclaration EXISTE, et l'anonyme, un compte rattaché à rien et le client ne la voient
--     pas, ne la modifient pas, ne l'écrivent pas et n'appellent aucune des deux fonctions (l'anonyme n'a pas le droit
--     de les exécuter, les deux autres se font refuser l'accès au dossier) ; le chef du cabinet déclare hors application,
--     voit sa déclaration, ne la modifie pas, ne retire plus l'encaissement déclaré, le contre-passe et déclare la
--     contre-passation (les contrôles POSITIFS) ; super-administrateur, il insère une déclaration (la restauration) ; le
--     rôle des Edge Functions écrit une déclaration à la main et une par une API, et fait avancer celle-ci ;
--   - LES REFUS des deux fonctions, chacun jugé à son code ET à son message, dans l'ordre de la fonction — celui que le
--     module et l'écran reprendront — ; et ce qu'elles acceptent, chacun jugé à ce qu'il a écrit ;
--   - LE RETRAIT, désormais pour de vrai : un encaissement déclaré ne se retire ni par la fonction ni en direct ; un
--     encaissement dont la déclaration a échoué ou a été rejetée se retire ; une contre-passation jamais déclarée se
--     retire, et l'encaissement s'annule de nouveau ;
--   - CE QUE LA TABLE ET SA GARDE REFUSENT SEULES, à une écriture directe : chaque contrainte par son nom, chaque règle du
--     déclencheur par son message, l'unicité de la déclaration active, l'immuabilité, la marche avant des états, et ce
--     qu'une restauration rejoue (ce qui empêche ne compte que s'il était connu AVANT la déclaration) ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les policies, les clés et leur action à la suppression,
--     la garde de suppression, les droits d'exécution ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape d4) : une
-- suppression (refusée en direct, permise par la cascade d'un dossier), deux sessions qui déclarent le même encaissement
-- en même temps, un retrait et une déclaration en même temps (par la fonction, et par une écriture directe que seule la
-- garde verrouille), et un membre du cabinet qui n'est pas super-administrateur (aucun n'existe sur ce projet).
--
-- QUI REFUSE L'ÉCRITURE DIRECTE, ET POURQUOI CE N'EST PAS TOUJOURS LA RLS : la garde lit l'encaissement avec les droits
-- de l'appelant et passe AVANT la RLS ; qui ne le voit pas est refusé par elle (23514), sans apprendre s'il existe.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant le `raise`, comme encaissementsFactures.sql ; les factures d'essai naissent dans un bloc qui s'annule lui-même
-- à la fin (leurs numéros consommés sont rendus). Les verdicts voyagent dans un réglage LOCAL à la transaction
-- (`essai.declarations`), que la requête finale lit. Aucune instruction de suppression.
--
-- ÉPROUVÉ LE 08/10/2026, après la migration `transmissions_des_encaissements` (version 20261008221156) : 128 contrôles
-- sur 128 en production, le texte transmis identique à ce fichier (la ligne 0 en rend l'empreinte), rien laissé en
-- base. Sur la réplique : les mêmes 128, ce qui ne se joue pas ici (neuf contrôles, R1 à R7b), six scénarios de deux
-- sessions concurrentes, et cent trente-sept mutations de la migration, dont cent trente-trois mordent — les quatre
-- survivantes sont équivalentes (HISTORIQUE.md, entrée de l'étape d4).
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  jour date := (now() at time zone 'Europe/Paris')::date - 1;
  sha text := repeat('ab', 32);
  -- Les identifiants des lignes d'essai, tirés une fois : chaque contrôle les recrée dans sa sous-transaction.
  t1 uuid := gen_random_uuid(); e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); a1 uuid := gen_random_uuid();
  d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); m1 uuid := gen_random_uuid();

  facture_v uuid; dossier_f uuid; autre_dossier uuid; chef_super boolean; fm uuid; f2 uuid;
  p_acc text; p_dep text; p_spdp text; p_e1 text; p_e1_retire text; p_e2 text; p_d1 text; p_a1 text; p_d1_api_envoi text;
  accepte boolean; code_recu text; message_recu text; obs text; motif text; code_attendu text; prep text; appel text;
  qui text; verif text; verif_attendue text; verif_lue text; requete text; attendu boolean;
  vus int; n_maj int; detail text; trace text; fixture text; ident uuid; ident2 uuid;
  code_d text; msg_d text; code_a text; msg_a text; code_i text; msg_i text; code_r text; msg_r text;
  avant jsonb; apres jsonb;
  verdicts jsonb := '[]'::jsonb;
begin
  select f.id, f.dossier_id into facture_v, dossier_f from factures_emises f
   where f.statut = 'validee' and f.type = 'facture' order by f.id limit 1;
  select d.id into autre_dossier from dossiers d where d.id <> dossier_f order by d.id limit 1;
  select exists (select 1 from super_admins s where s.user_id = chef) into chef_super;
  if facture_v is null or autre_dossier is null then
    raise exception 'ESSAI_IMPOSSIBLE : il faut une facture validée et un second dossier';
  end if;
  if exists (select 1 from transmissions_factures where facture_id = facture_v)
     or exists (select 1 from encaissements_factures where facture_id = facture_v) then
    raise exception 'ESSAI_IMPOSSIBLE : la facture d''essai porte déjà une transmission ou un encaissement';
  end if;
  select jsonb_build_object('declarations', (select count(*) from transmissions_encaissements),
    'encaissements', (select count(*) from encaissements_factures), 'parts', (select count(*) from encaissements_factures_taux),
    'factures', (select count(*) from factures_emises), 'lignes', (select count(*) from facture_lignes),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'mouvements', (select count(*) from lignes_bancaires),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into avant;

  -- ══ 1 à 3. Une déclaration EXISTE, et l'anonyme, le compte rattaché à rien et le client ne l'atteignent pas ══════════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client']) loop
    vus := null; n_maj := null; code_d := null; msg_d := null; code_a := null; msg_a := null; code_i := null; msg_i := null;
    fixture := null;
    begin
      insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
        values (dossier_f, facture_v, 'plateforme', 'pa.exemple.fr', sha, 'accepte', 'flux-f');
      insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen)
        values (e1, dossier_f, facture_v, jour, 1, 'virement');
      insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat)
        values (dossier_f, e1, facture_v, 'manuel', 'pa.exemple.fr', 'depose');
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu else client end, 'role', 'authenticated')::text, true);
      end if;
      select count(*) into vus from transmissions_encaissements;
      update transmissions_encaissements set etat = 'accepte' where encaissement_id = e1;
      get diagnostics n_maj = row_count;
      begin
        perform declarer_encaissement_hors_application(dossier_f, e1, null);
        code_d := 'ACCEPTÉ';
      exception when others then code_d := sqlstate; msg_d := sqlerrm;
      end;
      begin
        perform annuler_encaissement(dossier_f, e1, jour, 'essai');
        code_a := 'ACCEPTÉ';
      exception when others then code_a := sqlstate; msg_a := sqlerrm;
      end;
      begin
        insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat)
          values (dossier_f, e1, facture_v, 'manuel', 'pa.exemple.fr', 'rejete');
        code_i := 'ACCEPTÉ';
      exception when others then code_i := sqlstate; msg_i := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucune déclaration, n''appelle aucune des deux fonctions',
      'observe', coalesce(fixture, 'vues ' || coalesce(vus::text, '?') || ', modifiées ' || coalesce(n_maj::text, '?')
        || ' — déclarer : ' || coalesce(code_d, '?') || ' ' || coalesce(msg_d, '') || ' — contre-passer : ' || coalesce(code_a, '?')
        || ' ' || coalesce(msg_a, '') || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
      'ok', fixture is null and vus = 0 and n_maj = 0
        and case when obs like '1.%'
              then code_d = '42501' and msg_d = 'permission denied for function declarer_encaissement_hors_application'
               and code_a = '42501' and msg_a = 'permission denied for function annuler_encaissement'
              else code_d = '42501' and msg_d = 'Accès refusé à ce dossier.' and code_a = '42501' and msg_a = 'Accès refusé à ce dossier.' end
        and (code_i = '42501' and msg_i like 'new row violates row-level security policy%'
             or code_i = '23514' and msg_i = 'Une déclaration désigne un encaissement de sa facture et de son dossier.'));
  end loop;

  -- ══ Les factures d'essai : nées ici, annulées à la fin du bloc ══════════
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    -- Trois taux : 1 200,00 € à 20 %, 105,50 € à 5,5 %, 50,00 € à 0 % — 1 355,50 € TTC ; et 120,00 € à un seul taux.
    select r.facture_id into fm from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 1150, 'montant_tva', 205.5, 'montant_ttc', 1355.5),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":1000,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":100,"taux_tva":5.5},{"designation":"c","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb,
      true) r;
    select r.facture_id into f2 from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) r;
    reset role;

    -- Les morceaux dont les contrôles se composent, écrits en direct par le propriétaire de la base : une transmission
    -- acceptée de fm (la plateforme du client, pa.exemple.fr), une déposée sans accusé, une déposée chez Super PDP ;
    -- un encaissement e1 de 10 € à 20 %, le même retiré, un second e2 de 5 € ; la déclaration manuelle d1 de e1 ; la
    -- contre-passation a1 de e1 ; une déclaration de e1 par l'API, partie sans issue connue.
    p_acc := format('insert into transmissions_factures (id, dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''accepte'', ''flux-f'')', t1, dossier_f, fm, sha);
    p_dep := format('insert into transmissions_factures (id, dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''depose'', ''flux-f'')', t1, dossier_f, fm, sha);
    p_spdp := format('insert into transmissions_factures (id, dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''depose'', ''4242'')', t1, dossier_f, fm, sha);
    p_e1 := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, %L, 10, ''cheque''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 10)', e1, dossier_f, fm, jour, e1, dossier_f);
    p_e1_retire := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, retire_le) values (%L, %L, %L, %L, 10, ''cheque'', now())', e1, dossier_f, fm, jour);
    p_e2 := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, %L, 5, ''virement''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 0, 5)', e2, dossier_f, fm, jour, e2, dossier_f);
    p_d1 := format('insert into transmissions_encaissements (id, dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', d1, dossier_f, e1, fm);
    p_a1 := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, %L, -10, ''cheque'', %L, ''essai''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, -10)', a1, dossier_f, fm, jour, e1, a1, dossier_f);
    p_d1_api_envoi := format('insert into transmissions_encaissements (id, dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''envoi'')', d1, dossier_f, e1, fm, sha);

    -- ══ 4. Le chef déclare hors application, voit, ne modifie pas, ne retire plus, contre-passe et déclare la
    -- contre-passation ; super-administrateur, il insère (restauration) ══════════
    vus := null; n_maj := null; trace := null; code_r := null; msg_r := null; code_i := null; msg_i := null; fixture := null;
    begin
      execute p_acc;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select e.id into ident from enregistrer_encaissement(dossier_f, fm, jour, 500, 'virement', null,
        '[{"taux": 20, "montant": 442.64}, {"taux": 5.5, "montant": 38.92}, {"taux": 0, "montant": 18.44}]') e;
      select d.canal || ' ' || d.hote || ' ' || d.etat || ' ' || coalesce(d.note, '-') || ' ' || (d.cree_par = chef)
          || ' ' || (d.flux_id is null) || ' ' || (d.sha256 is null) || ' ' || (d.facture_id = fm)
        into trace from declarer_encaissement_hors_application(dossier_f, ident, 'Saisi par le client le 07/10.') d;
      select count(*) into vus from transmissions_encaissements where encaissement_id = ident;
      update transmissions_encaissements set note = 'autre' where encaissement_id = ident;
      get diagnostics n_maj = row_count;
      begin
        perform retirer_encaissement(dossier_f, ident);
        code_r := 'ACCEPTÉ';
      exception when others then code_r := sqlstate; msg_r := sqlerrm;
      end;
      -- Chaque lecture de ce qu'une fonction a écrit se fait dans une instruction à part : l'instruction qui appelle la
      -- fonction lit la base telle qu'elle était à son début.
      select trace || ' | contre-passée : ' || a.montant || ' ' || a.moyen || ' ' || a.date_encaissement || ' ' || a.motif
          || ' ' || (a.annule_id = ident) || ' ' || (a.cree_par = chef) || ' ' || (a.retire_le is null), a.id
        into trace, ident2 from annuler_encaissement(dossier_f, ident, aujourd_hui, 'Chèque revenu impayé') a;
      select trace || ' parts ' || string_agg(trim_scale(t.taux)::text || ':' || t.montant, ',' order by t.taux desc)
        into trace from encaissements_factures_taux t where t.encaissement_id = ident2;
      select trace || ' | déclarée : ' || d.canal || ' ' || d.hote || ' ' || d.etat || ' ' || coalesce(d.note, 'sans note')
        into trace from declarer_encaissement_hors_application(dossier_f, ident2, '   ') d;
      reset role;
      select trace || ' | déclarés : ' || encaissement_declare(ident) || '/' || encaissement_declare(ident2) into trace;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat)
          values (dossier_f, ident, fm, 'manuel', 'pa.exemple.fr', 'rejete');
        code_i := 'ACCEPTÉ';
      exception when others then code_i := sqlstate; msg_i := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '4. le chef déclare hors application, voit, ne modifie pas, ne retire plus, contre-passe et déclare la contre-passation ; super-administrateur, il insère (restauration)',
      'observe', coalesce(fixture, 'super-administrateur : ' || chef_super || ', vues ' || coalesce(vus::text, '?') || ', modifiées '
        || coalesce(n_maj::text, '?') || ' — ' || coalesce(trace, '?') || ' — retirer : ' || coalesce(code_r, '?') || ' '
        || coalesce(msg_r, '') || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
      'ok', fixture is null and vus = 1 and n_maj = 0
        and trace = 'manuel pa.exemple.fr depose Saisi par le client le 07/10. true true true true'
          || ' | contre-passée : -500 virement ' || aujourd_hui || ' Chèque revenu impayé true true true parts 20:-442.64,5.5:-38.92,0:-18.44'
          || ' | déclarée : manuel pa.exemple.fr depose sans note | déclarés : true/true'
        and code_r = '22023'
        and msg_r = 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'
        and case when chef_super then code_i = 'ACCEPTÉ' else code_i = '42501' end);

    -- ══ 5. Le rôle des Edge Functions écrit une déclaration à la main, une par une API, et fait avancer celle-ci ══════════
    detail := null; fixture := null;
    begin
      execute p_acc || '; ' || p_e1 || '; ' || p_e2;
      set local role service_role;
      insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, note)
        values (dossier_f, e1, fm, 'manuel', 'pa.exemple.fr', 'depose', 'essai');
      insert into transmissions_encaissements (id, dossier_id, encaissement_id, facture_id, canal, hote, sha256)
        values (d2, dossier_f, e2, fm, 'plateforme', 'pa.exemple.fr', sha);
      update transmissions_encaissements set etat = 'depose', flux_id = 'flux-e2', maj_le = '2000-01-01' where id = d2;
      update transmissions_encaissements set etat = 'accepte', detail = 'Acceptée par la plateforme.' where id = d2;
      reset role;
      select d.etat || ' ' || d.flux_id || ' ' || d.detail || ' ' || (d.maj_le = now()) || ' ' || (d.cree_le = now())
        into detail from transmissions_encaissements d where d.id = d2;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '5. le rôle des Edge Functions écrit une déclaration à la main et une par une API, qui avance (envoi, déposée, acceptée) ; la garde date chaque changement',
      'observe', coalesce(fixture, detail), 'ok', fixture is null and detail = 'accepte flux-e2 Acceptée par la plateforme. true true');

    -- ══ 6 à 24. Les refus de declarer_encaissement_hors_application, dans son ordre ══════════
    for obs, prep, appel, code_attendu, motif in
      select * from (values
        ('6. un encaissement d''un autre dossier', p_acc || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', autre_dossier, e1),
          'P0002', 'Encaissement introuvable dans ce dossier.'),
        ('7. un encaissement qui n''existe pas', p_acc,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, gen_random_uuid()),
          'P0002', 'Encaissement introuvable dans ce dossier.'),
        ('8. un encaissement retiré', p_acc || '; ' || p_e1_retire,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est retiré : il n''a jamais été déclaré, et ne se déclare plus.'),
        ('9. un encaissement déjà déclaré à la main', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est déjà déclaré : une déclaration ne se fait qu''une fois.'),
        ('10. un encaissement dont la déclaration par une API est partie sans issue connue', p_acc || '; ' || p_e1 || '; ' || p_d1_api_envoi,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est déjà déclaré : une déclaration ne se fait qu''une fois.'),
        ('11. une contre-passation dont l''encaissement n''est pas déclaré', p_acc || '; ' || p_e1 || '; ' || p_a1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, a1),
          '22023', 'L''encaissement que cette contre-passation annule n''est pas déclaré : elle ne se déclare pas.'),
        ('12. une contre-passation dont l''encaissement n''a qu''une déclaration rejetée', p_acc || '; ' || p_e1 || '; ' || p_a1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''rejete'')', dossier_f, e1, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, a1),
          '22023', 'L''encaissement que cette contre-passation annule n''est pas déclaré : elle ne se déclare pas.'),
        ('13. une facture rejetée par une plateforme',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''rejete'', ''flux-f'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun statut « Encaissée » ne la suit.'),
        ('14. une facture acceptée puis refusée par l''acheteur chez Super PDP (210)', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('15. une facture rejetée chez Super PDP (213)', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:213'', ''essai'', now())', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('16. une facture jamais transmise par l''application', p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée par une plateforme : son statut « Encaissée » ne se déclare d''ici qu''après.'),
        ('17. une facture dont la seule transmission a échoué',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée%'),
        ('18. une facture partie sans issue connue',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''envoi'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée%'),
        ('19. une facture déposée chez la plateforme du client, sans accusé', p_dep || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée%'),
        ('20. une facture déposée chez Super PDP sans le statut 200 « Déposée »', p_spdp || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:201'', ''essai'', now())', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée%'),
        ('21. une facture partie par l''ancien chemin de Super PDP, sans transmission',
          format('update factures_emises set superpdp_invoice_id = 4242 where id = %L', fm) || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:200'', ''essai'', now())', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Aucune transmission de cette facture par l''application n''a été acceptée%'),
        ('22. une note de 2 001 caractères', p_acc || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, %L)', dossier_f, e1, repeat('n', 2001)),
          '22023', 'La note de la déclaration dépasse 2 000 caractères.'),
        ('23. une note de 2 001 caractères qui ne compte que des espaces autour d''un mot', p_acc || '; ' || p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, %L)', dossier_f, e1, ' ' || repeat('n', 1999) || ' '),
          '22023', 'La note de la déclaration dépasse 2 000 caractères.'),
        ('24. un encaissement retiré, que l''ordre juge avant une facture jamais transmise', p_e1_retire,
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est retiré%'),
        ('24b. un encaissement déclaré d''une facture refusée depuis : déjà déclaré, que l''ordre juge avant le refus',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est déjà déclaré%'),
        ('24c. une contre-passation dont l''encaissement n''est pas déclaré, et une note trop longue : la déclaration d''abord',
          p_acc || '; ' || p_e1 || '; ' || p_a1,
          format('select declarer_encaissement_hors_application(%L, %L, %L)', dossier_f, a1, repeat('n', 2001)),
          '22023', 'L''encaissement que cette contre-passation annule n''est pas déclaré%'),
        ('24d. une facture jamais transmise, et une note trop longue : la facture d''abord', p_e1,
          format('select declarer_encaissement_hors_application(%L, %L, %L)', dossier_f, e1, repeat('n', 2001)),
          '22023', 'Aucune transmission de cette facture par l''application%')
      ) t(o, p, a, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute appel;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé',
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', not accepte and code_recu = code_attendu and message_recu like motif);
    end loop;

    -- ══ 25 à 31. Ce que la déclaration accepte, jugé à ce qu'elle rend et, dans une instruction à part — celle qui
    -- appelle la fonction lit la base telle qu'elle était à son début —, à ce qu'elle a écrit ══════════
    for obs, prep, appel, verif, verif_attendue in
      select * from (values
        ('25. une facture déposée chez Super PDP, le statut 200 « Déposée » dans son historique : sur Super PDP', p_spdp || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:200'', ''essai'', now())', dossier_f, fm),
          format('select d.canal || '' '' || d.hote || '' '' || d.etat || '' '' || coalesce(d.note, ''-'') from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, e1),
          null::text, 'manuel api.superpdp.tech depose -'),
        ('26. une facture acceptée par Super PDP (reçue par la plateforme de l''acheteur)',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''accepte'', ''4242'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('select d.canal || '' '' || d.hote || '' '' || d.etat || '' '' || coalesce(d.note, ''-'') from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, e1),
          null, 'manuel api.superpdp.tech depose -'),
        ('27. une note faite d''espaces n''est pas une note', p_acc || '; ' || p_e1,
          format('select coalesce(d.note, ''sans note'') from declarer_encaissement_hors_application(%L, %L, ''   '') d', dossier_f, e1),
          null, 'sans note'),
        ('28. une note de 2 000 caractères, gardée telle quelle', p_acc || '; ' || p_e1,
          format('select length(d.note)::text || '' '' || (d.note = %L) from declarer_encaissement_hors_application(%L, %L, %L) d', ' ' || repeat('n', 1998) || ' ', dossier_f, e1, ' ' || repeat('n', 1998) || ' '),
          null, '2000 true'),
        ('29. un encaissement dont la seule déclaration a été rejetée se déclare de nouveau', p_acc || '; ' || p_e1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''rejete'')', dossier_f, e1, fm),
          format('select d.etat from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, e1),
          format('select count(*)::text || '' '' || encaissement_declare(%L) from transmissions_encaissements x where x.encaissement_id = %L', e1, e1),
          'depose | 2 true'),
        ('30. une contre-passation se déclare sur la plateforme de son encaissement, la facture refusée depuis (210)',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('select d.hote || '' '' || d.etat from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, a1),
          format('select encaissement_declare(%L)::text', a1),
          'pa.exemple.fr depose | true'),
        ('31. une facture acceptée par la plateforme du client, deux encaissements déclarés l''un après l''autre',
          p_acc || '; ' || p_e1 || '; ' || p_e2,
          format('select d.etat from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, e1),
          format('select d.etat from declarer_encaissement_hors_application(%L, %L, null) d', dossier_f, e2),
          'depose | depose')
      ) t(o, p, a, v, x)
    loop
      accepte := false; code_recu := null; message_recu := null; verif_lue := null;
      begin
        if prep is not null then execute prep; end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute appel into verif_lue;
        reset role;
        if verif is not null then
          execute verif into detail;
          verif_lue := verif_lue || ' | ' || detail;
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : accepté',
        'observe', coalesce(verif_lue, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', accepte and code_recu = 'P0001' and verif_lue = verif_attendue);
    end loop;

    -- ══ 32 à 48. Les refus d'annuler_encaissement, dans son ordre ══════════
    for obs, prep, appel, code_attendu, motif in
      select * from (values
        ('32. un encaissement d''un autre dossier', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', autre_dossier, e1, jour),
          'P0002', 'Encaissement introuvable dans ce dossier.'),
        ('33. un encaissement qui n''existe pas', null,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, gen_random_uuid(), jour),
          'P0002', 'Encaissement introuvable dans ce dossier.'),
        ('34. une contre-passation', p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, a1, jour),
          '22023', 'Une annulation ne se contre-passe pas : l''encaissement qu''elle annulait se saisit de nouveau.'),
        ('35. un encaissement retiré', p_e1_retire,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.'),
        ('36. un encaissement que rien n''a déclaré', p_acc || '; ' || p_e1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'Cet encaissement n''est pas déclaré : il se retire, sans contre-passation.'),
        ('37. un encaissement dont la déclaration a échoué', p_acc || '; ' || p_e1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec'')', dossier_f, e1, fm, sha),
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'Cet encaissement n''est pas déclaré%'),
        ('38. un encaissement dont la déclaration a été rejetée', p_acc || '; ' || p_e1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''rejete'')', dossier_f, e1, fm),
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'Cet encaissement n''est pas déclaré%'),
        ('39. un encaissement dont la déclaration par une API est partie sans issue connue', p_acc || '; ' || p_e1 || '; ' || p_d1_api_envoi,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'La déclaration de cet encaissement a une issue inconnue : il ne s''annule pas tant qu''elle n''est pas tranchée.'),
        ('40. un encaissement déjà annulé par une contre-passation vivante', p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'Cet encaissement est déjà annulé par une contre-passation.'),
        ('41. une date absente', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, null, ''essai'')', dossier_f, e1),
          '22023', 'La date de la contre-passation est à renseigner.'),
        ('42. une date d''avant l''encaissement', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour - 1),
          '22023', 'Une contre-passation ne se date pas avant l''encaissement qu''elle annule, du ' || to_char(jour, 'DD/MM/YYYY') || '.'),
        ('43. une date de demain, à Paris', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, aujourd_hui + 1),
          '22023', 'Une contre-passation ne se date pas dans l''avenir : nous sommes le ' || to_char(aujourd_hui, 'DD/MM/YYYY') || '.'),
        ('44. un motif absent', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, null)', dossier_f, e1, jour),
          '22023', 'Le motif de la contre-passation est à renseigner.'),
        ('45. un motif fait d''espaces', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, ''   '')', dossier_f, e1, jour),
          '22023', 'Le motif de la contre-passation est à renseigner.'),
        ('46. un motif de 2 001 caractères', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, %L, %L)', dossier_f, e1, jour, repeat('m', 2001)),
          '22023', 'Le motif de la contre-passation dépasse 2 000 caractères.'),
        ('47. une date absente, que l''ordre juge avant un motif absent', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select annuler_encaissement(%L, %L, null, null)', dossier_f, e1),
          '22023', 'La date de la contre-passation est à renseigner.'),
        ('48. un encaissement que rien n''a déclaré, que l''ordre juge avant une date absente', p_acc || '; ' || p_e1,
          format('select annuler_encaissement(%L, %L, null, null)', dossier_f, e1),
          '22023', 'Cet encaissement n''est pas déclaré%'),
        ('48b. une déclaration sans issue connue et une contre-passation vivante : l''issue d''abord',
          p_acc || '; ' || p_e1 || '; ' || p_d1_api_envoi || '; ' || p_a1,
          format('select annuler_encaissement(%L, %L, %L, ''essai'')', dossier_f, e1, jour),
          '22023', 'La déclaration de cet encaissement a une issue inconnue%'),
        ('48c. un encaissement déjà annulé, et une date absente : l''annulation d''abord', p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1,
          format('select annuler_encaissement(%L, %L, null, null)', dossier_f, e1),
          '22023', 'Cet encaissement est déjà annulé par une contre-passation.')
      ) t(o, p, a, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute appel;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé',
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', not accepte and code_recu = code_attendu and message_recu like motif);
    end loop;

    -- ══ 49 à 51. Ce que la contre-passation accepte, et ce qu'elle libère ══════════
    for obs, prep, appel, verif, verif_attendue in
      select * from (values
        ('49. datée du jour de l''encaissement, motif de 2 000 caractères : montant, moyen et part opposés',
          p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('select a.montant || '' '' || a.moyen || '' '' || (a.date_encaissement = %L) || '' '' || length(a.motif) || '' '' || (a.cree_par = %L) from annuler_encaissement(%L, %L, %L, %L) a', jour, chef, dossier_f, e1, jour, repeat('m', 2000)),
          format('select string_agg(trim_scale(t.taux)::text || '':'' || t.montant, '','') from encaissements_factures_taux t join encaissements_factures e on e.id = t.encaissement_id where e.annule_id = %L', e1),
          '-10 cheque true 2000 true | 20:-10'),
        ('50. une contre-passation retirée, jamais déclarée, l''encaissement s''annule de nouveau',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1,
          format('select (r.retire_le is not null)::text from retirer_encaissement(%L, %L) r', dossier_f, a1),
          format('select a.montant::text from annuler_encaissement(%L, %L, %L, ''essai'') a', dossier_f, e1, aujourd_hui),
          'true | -10')
      ) t(o, p, a, v, x)
    loop
      accepte := false; code_recu := null; message_recu := null; verif_lue := null;
      begin
        if prep is not null then execute prep; end if;
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute appel into verif_lue;
        reset role;
        if verif is not null then
          execute verif into detail;
          verif_lue := verif_lue || ' | ' || detail;
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : accepté',
        'observe', coalesce(verif_lue, '?') || ' — ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', accepte and code_recu = 'P0001' and verif_lue = verif_attendue);
    end loop;

    -- 51. Contre-passé, un encaissement libère le reste de la facture et son mouvement : la facture s'encaisse de nouveau
    -- en entier, sur le même virement, et pas un centime de plus.
    detail := null; code_recu := null; message_recu := null; fixture := null;
    begin
      execute p_acc;
      insert into lignes_bancaires (id, dossier_id, date, libelle, montant) values (m1, dossier_f, jour, 'essai', 1355.5);
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select e.id into ident from enregistrer_encaissement(dossier_f, fm, jour, 1355.5, 'virement', m1,
        '[{"taux": 20, "montant": 1200}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]') e;
      perform declarer_encaissement_hors_application(dossier_f, ident, null);
      perform annuler_encaissement(dossier_f, ident, jour, 'Déclaré sur la mauvaise facture.');
      select e.montant::text into detail from enregistrer_encaissement(dossier_f, fm, jour, 1355.5, 'virement', m1,
        '[{"taux": 20, "montant": 1200}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]') e;
      begin
        perform enregistrer_encaissement(dossier_f, fm, jour, 0.01, 'especes', null, '[{"taux": 0, "montant": 0.01}]');
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '51. contre-passé, un encaissement libère la facture et son virement : 1 355,50 € s''encaissent de nouveau, et pas un centime de plus',
      'observe', coalesce(fixture, coalesce(detail, '?') || ' — puis 0,01 € : ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, '')),
      'ok', fixture is null and detail = '1355.5' and code_recu = '22023'
        and message_recu = 'L''encaissement dépasserait le total de la facture : il reste 0,00 € à encaisser.');

    -- ══ 52 à 57. Le retrait, désormais pour de vrai ══════════
    for obs, prep, qui, requete, code_attendu, motif in
      select * from (values
        ('52. retirer un encaissement déclaré, par la fonction', p_acc || '; ' || p_e1 || '; ' || p_d1, 'chef',
          format('select retirer_encaissement(%L, %L)', dossier_f, e1),
          '22023', 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'),
        ('53. retirer un encaissement déclaré, en direct (le rôle des Edge Functions)', p_acc || '; ' || p_e1 || '; ' || p_d1, 'service',
          format('update encaissements_factures set retire_le = now() where id = %L', e1),
          '23514', 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.'),
        ('54. retirer un encaissement dont la déclaration par une API est partie sans issue connue', p_acc || '; ' || p_e1 || '; ' || p_d1_api_envoi, 'chef',
          format('select retirer_encaissement(%L, %L)', dossier_f, e1),
          '22023', 'Un encaissement déclaré ne se retire pas%'),
        ('55. retirer une contre-passation déclarée', p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, a1, fm), 'chef',
          format('select retirer_encaissement(%L, %L)', dossier_f, a1),
          '22023', 'Un encaissement déclaré ne se retire pas%'),
        ('56. retirer un encaissement dont la déclaration a échoué', p_acc || '; ' || p_e1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec'')', dossier_f, e1, fm, sha), 'chef',
          format('select retirer_encaissement(%L, %L)', dossier_f, e1),
          'ACCEPTÉ', null),
        ('57. retirer un encaissement dont la déclaration a été rejetée', p_acc || '; ' || p_e1 || '; '
          || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''rejete'')', dossier_f, e1, fm), 'chef',
          format('select retirer_encaissement(%L, %L)', dossier_f, e1),
          'ACCEPTÉ', null)
      ) t(o, p, w, r, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        if qui = 'chef' then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        else
          set local role service_role;
        end if;
        execute requete;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || case when code_attendu = 'ACCEPTÉ' then ' : accepté' else ' : refusé' end,
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', case when code_attendu = 'ACCEPTÉ' then accepte and code_recu = 'P0001'
                   else not accepte and code_recu = code_attendu and message_recu like motif end);
    end loop;

    -- ══ 58 à 99. Ce que la table et sa garde refusent seules, à une écriture directe (le rôle des Edge Functions) ══════
    for obs, prep, requete, code_attendu, motif in
      select * from (values
        ('58. l''encaissement d''une autre facture', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, f2),
          '23514', 'Une déclaration désigne un encaissement de sa facture et de son dossier.'),
        ('59. l''encaissement d''un autre dossier', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', autre_dossier, e1, fm),
          '23514', 'Une déclaration désigne un encaissement de sa facture et de son dossier.'),
        ('60. un encaissement qui n''existe pas', p_acc,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, gen_random_uuid(), fm),
          '23514', 'Une déclaration désigne un encaissement de sa facture et de son dossier.'),
        ('61. la déclaration active d''un encaissement retiré', p_acc || '; ' || p_e1_retire,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Un encaissement retiré ne se déclare pas.'),
        ('62. à la main, sur une plateforme qui n''a pas reçu la facture', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''autre.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une déclaration se fait sur la plateforme qui a reçu la facture — par une API, par le canal qui la lui a transmise.'),
        ('63. par l''API de la plateforme du client, pour une facture partie par Super PDP sur le même hôte',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''accepte'', ''4242'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''api.superpdp.tech'', %L, ''envoi'')', dossier_f, e1, fm, sha),
          '23514', 'Une déclaration se fait sur la plateforme qui a reçu la facture%'),
        ('64. sur la plateforme d''une transmission qui a échoué',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une déclaration se fait sur la plateforme qui a reçu la facture%'),
        ('65. une facture rejetée avant la déclaration',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''rejete'', ''flux-f'')', dossier_f, fm, sha) || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas de statut « Encaissée » : elle s''annule par un avoir interne.'),
        ('66. une facture refusée par l''acheteur (210) avant la déclaration', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas%'),
        ('67. une facture rejetée chez Super PDP (213) avant la déclaration, datée d''hier', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at, created_at) values (%L, %L, -1, ''fr:213'', ''essai'', now(), now() - interval ''2 days'')', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', now() - interval ''1 day'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas%'),
        ('68. une facture déposée chez la plateforme du client, sans accusé', p_dep || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Le statut « Encaissée » d''une facture ne se déclare qu''une fois la facture acceptée par sa plateforme.'),
        ('69. une facture déposée chez Super PDP sans le statut 200', p_spdp || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''api.superpdp.tech'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Le statut « Encaissée » d''une facture ne se déclare qu''une fois%'),
        ('70. une restauration : une déclaration d''hier, le statut 200 connu seulement aujourd''hui', p_spdp || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:200'', ''essai'', now())', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''api.superpdp.tech'', ''depose'', now() - interval ''1 day'')', dossier_f, e1, fm),
          '23514', 'Le statut « Encaissée » d''une facture ne se déclare qu''une fois%'),
        ('70b. une déclaration du jour, la facture refusée (210) par une synchronisation partie après elle : le refus compte', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at, created_at) values (%L, %L, -1, ''fr:210'', ''essai'', now(), now() + interval ''1 second'')', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas%'),
        ('71. un canal inconnu (rejetée : la garde ne juge pas une déclaration inactive, la contrainte si)', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''courrier'', ''pa.exemple.fr'', %L, ''rejete'', ''flux-1'')', dossier_f, e1, fm, sha),
          '23514', '%transmissions_encaissements_canal%'),
        ('72. un hôte en capitales (rejetée)', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''PA.exemple.fr'', ''rejete'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_hote%'),
        ('73. un hôte qui n''est pas un nom de domaine (rejetée)', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''localhost'', ''rejete'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_hote%'),
        ('74. un état inconnu', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''valide'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_etat%'),
        ('75. un flux vide', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''depose'', '''')', dossier_f, e1, fm, sha),
          '23514', '%transmissions_encaissements_flux_id%'),
        ('76. un flux de 201 caractères', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''depose'', %L)', dossier_f, e1, fm, sha, repeat('f', 201)),
          '23514', '%transmissions_encaissements_flux_id%'),
        ('77. une empreinte qui n''est pas un SHA-256', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''envoi'')', dossier_f, e1, fm, repeat('AB', 32)),
          '23514', '%transmissions_encaissements_sha256%'),
        ('78. un détail de 2 001 caractères', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, detail) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', %L)', dossier_f, e1, fm, repeat('d', 2001)),
          '23514', '%transmissions_encaissements_detail%'),
        ('79. une note faite d''espaces', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, note) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', ''   '')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_note%'),
        ('80. une note de 2 001 caractères', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, note) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', %L)', dossier_f, e1, fm, repeat('n', 2001)),
          '23514', '%transmissions_encaissements_note%'),
        ('81. à la main, avec un flux', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, flux_id) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', ''flux-1'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_manuel%'),
        ('82. à la main, avec une empreinte', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, sha256) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', %L)', dossier_f, e1, fm, sha),
          '23514', '%transmissions_encaissements_manuel%'),
        ('83. à la main, partie sans issue connue', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''envoi'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_manuel%'),
        ('84. à la main, échouée', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''echec'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_manuel%'),
        ('85. par une API, sans empreinte', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', ''envoi'')', dossier_f, e1, fm),
          '23514', '%transmissions_encaissements_fichier%'),
        ('86. par une API, déposée sans flux', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''depose'')', dossier_f, e1, fm, sha),
          '23514', '%transmissions_encaissements_flux_connu%'),
        ('87. une seconde déclaration active, par l''autre canal', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''envoi'')', dossier_f, e1, fm, sha),
          '23505', '%transmissions_encaissements_une_active%')
      ) t(o, p, r, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        set local role service_role;
        execute requete;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé',
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', not accepte and code_recu = code_attendu and message_recu like motif);
    end loop;

    -- 88 à 94. Ce que la garde laisse passer, en direct : ce qu'une restauration rejoue, et ce qu'une API écrira.
    for obs, prep, requete in
      select * from (values
        ('88. une restauration : la déclaration d''hier d''une facture refusée (210) aujourd''hui', p_acc || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', now() - interval ''1 day'')', dossier_f, e1, fm)),
        ('89. une restauration : la déclaration d''hier d''une facture partie il y a trois jours chez Super PDP (200 avant-hier), rejetée aujourd''hui',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id, cree_le, maj_le) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''rejete'', ''4242'', now() - interval ''3 days'', now())', dossier_f, fm, sha) || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at, created_at) values (%L, %L, -1, ''fr:200'', ''essai'', now(), now() - interval ''2 days'')', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''api.superpdp.tech'', ''depose'', now() - interval ''1 day'')', dossier_f, e1, fm)),
        ('90. une restauration : la déclaration échouée d''un encaissement retiré depuis', p_acc || '; ' || p_e1_retire,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec'')', dossier_f, e1, fm, sha)),
        ('91. par l''API de Super PDP, pour une facture partie par Super PDP et déposée (200)', p_spdp || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:200'', ''essai'', now())', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''superpdp'', ''api.superpdp.tech'', %L, ''envoi'')', dossier_f, e1, fm, sha)),
        ('92. la contre-passation d''une facture rejetée depuis se déclare sur sa plateforme',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''rejete'', ''flux-f'')', dossier_f, fm, sha) || '; ' || p_e1 || '; ' || p_a1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, a1, fm)),
        ('93. une déclaration échouée et une rejetée à côté d''une active', p_acc || '; ' || p_e1 || '; ' || p_d1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat) values (%L, %L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''echec''), (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', null, ''rejete'')', dossier_f, e1, fm, sha, dossier_f, e1, fm)),
        ('93b. une déclaration du jour, le statut 200 lu par une synchronisation partie après elle : il compte', p_spdp || '; ' || p_e1 || '; '
          || format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at, created_at) values (%L, %L, -1, ''fr:200'', ''essai'', now(), now() + interval ''1 second'')', dossier_f, fm),
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''api.superpdp.tech'', ''depose'')', dossier_f, e1, fm)),
        ('94. une déclaration acceptée, écrite d''emblée', p_acc || '; ' || p_e1,
          format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''accepte'')', dossier_f, e1, fm))
      ) t(o, p, r)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        set local role service_role;
        execute requete;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : accepté',
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');
    end loop;

    -- ══ 95 à 113. Rien ne change après l'insertion, sauf l'état vers l'avant, le flux une fois et le détail ══════════
    for obs, prep, requete, attendu, motif in
      select * from (values
        ('95. le dossier', p_d1, format('update transmissions_encaissements set dossier_id = %L where id = %L', autre_dossier, d1), false, 'Une déclaration ne change ni%'),
        ('96. l''encaissement', p_d1 || '; ' || p_e2, format('update transmissions_encaissements set encaissement_id = %L where id = %L', e2, d1), false, 'Une déclaration ne change ni%'),
        ('97. la facture', p_d1, format('update transmissions_encaissements set facture_id = %L where id = %L', f2, d1), false, 'Une déclaration ne change ni%'),
        ('98. le canal, et lui seul (l''API de Super PDP pour celle de la plateforme du client)', p_d1_api_envoi, format('update transmissions_encaissements set canal = ''superpdp'' where id = %L', d1), false, 'Une déclaration ne change ni%'),
        ('99. l''hôte', p_d1, format('update transmissions_encaissements set hote = ''autre.exemple.fr'' where id = %L', d1), false, 'Une déclaration ne change ni%'),
        ('100. l''empreinte', p_d1_api_envoi, format('update transmissions_encaissements set sha256 = %L where id = %L', repeat('cd', 32), d1), false, 'Une déclaration ne change ni%'),
        ('101. la note', p_d1, format('update transmissions_encaissements set note = ''autre'' where id = %L', d1), false, 'Une déclaration ne change ni%'),
        ('102. l''auteur', p_d1, format('update transmissions_encaissements set cree_par = %L where id = %L', chef, d1), false, 'Une déclaration ne change ni%'),
        ('103. la date de création', p_d1, format('update transmissions_encaissements set cree_le = cree_le - interval ''1 day'' where id = %L', d1), false, 'Une déclaration ne change ni%'),
        ('104. un flux renommé', p_d1_api_envoi || format('; update transmissions_encaissements set etat = ''depose'', flux_id = ''flux-1'' where id = %L', d1),
          format('update transmissions_encaissements set flux_id = ''flux-2'' where id = %L', d1), false, 'Le flux d''une déclaration ne se renomme pas.'),
        ('105. déposée, redevenue un envoi', p_d1, format('update transmissions_encaissements set etat = ''envoi'' where id = %L', d1), false, 'Une déclaration ne revient pas en arrière : depose ne devient pas envoi.'),
        ('106. déposée, devenue un échec', p_d1_api_envoi || format('; update transmissions_encaissements set etat = ''depose'', flux_id = ''flux-1'' where id = %L', d1),
          format('update transmissions_encaissements set etat = ''echec'' where id = %L', d1), false, 'Une déclaration ne revient pas en arrière : depose ne devient pas echec.'),
        ('107. acceptée, redevenue déposée', p_d1 || format('; update transmissions_encaissements set etat = ''accepte'' where id = %L', d1),
          format('update transmissions_encaissements set etat = ''depose'' where id = %L', d1), false, 'Une déclaration ne revient pas en arrière : accepte ne devient pas depose.'),
        ('108. rejetée, devenue acceptée', p_d1 || format('; update transmissions_encaissements set etat = ''rejete'' where id = %L', d1),
          format('update transmissions_encaissements set etat = ''accepte'' where id = %L', d1), false, 'Une déclaration ne revient pas en arrière : rejete ne devient pas accepte.'),
        ('109. échouée, repartie', p_d1_api_envoi || format('; update transmissions_encaissements set etat = ''echec'' where id = %L', d1),
          format('update transmissions_encaissements set etat = ''envoi'' where id = %L', d1), false, 'Une déclaration ne revient pas en arrière : echec ne devient pas envoi.'),
        ('110. un envoi sans issue qui échoue', p_d1_api_envoi, format('update transmissions_encaissements set etat = ''echec'', detail = ''Refusée au dépôt.'' where id = %L', d1), true, null),
        ('111. un envoi qui se dépose avec son flux, puis s''accepte', p_d1_api_envoi,
          format('update transmissions_encaissements set etat = ''depose'', flux_id = ''flux-1'' where id = %L; update transmissions_encaissements set etat = ''accepte'' where id = %L', d1, d1), true, null),
        ('112. une déclaration à la main, rejetée (ce qu''une lecture du cycle de vie dira)', p_d1, format('update transmissions_encaissements set etat = ''rejete'', detail = ''601'' where id = %L', d1), true, null),
        ('113. le détail seul', p_d1, format('update transmissions_encaissements set detail = ''Vu sur la plateforme.'' where id = %L', d1), true, null)
      ) t(o, p, r, x, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        execute p_acc || '; ' || p_e1;
        if prep is not null then execute prep; end if;
        set local role service_role;
        execute requete;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || case when attendu then ' : accepté' else ' : refusé' end,
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', case when attendu then accepte and code_recu = 'P0001'
                   else not accepte and code_recu = '23514' and message_recu like motif end);
    end loop;

    -- 114. Ce qui fait un encaissement déclaré : une déclaration active, quel que soit son canal ; pas un échec, pas un rejet.
    detail := null; fixture := null;
    begin
      execute p_acc || '; ' || p_e1;
      select string_agg(x.etat || ':' || x.declare, ' ' order by x.n) into detail from (
        select 0 as n, 'aucune' as etat, encaissement_declare(e1)::text as declare) x;
      for obs in select unnest(array['echec', 'rejete', 'envoi', 'depose', 'accepte']) loop
        begin
          if obs in ('echec', 'envoi') then
            insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, sha256, etat)
              values (dossier_f, e1, fm, 'plateforme', 'pa.exemple.fr', sha, obs);
          else
            insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat)
              values (dossier_f, e1, fm, 'manuel', 'pa.exemple.fr', obs);
          end if;
          detail := detail || ' ' || obs || ':' || encaissement_declare(e1)::text;
          raise exception 'ANNULATION_ESSAI';
        exception when others then
          if sqlerrm <> 'ANNULATION_ESSAI' then detail := detail || ' ' || obs || ':' || sqlstate; end if;
        end;
      end loop;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    verdicts := verdicts || jsonb_build_object('controle', '114. un encaissement est déclaré par une déclaration active (envoi, déposée, acceptée), pas par un échec ni un rejet',
      'observe', coalesce(fixture, detail), 'ok', fixture is null
        and detail = 'aucune:false echec:false rejete:false envoi:true depose:true accepte:true');

    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then
      verdicts := verdicts || jsonb_build_object('controle', '0. les factures d''essai',
        'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;

  -- ══ 115 à 120. Ce que le catalogue dit ══════════
  select string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.policyname) into obs
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'transmissions_encaissements';
  verdicts := verdicts || jsonb_build_object('controle', '115. catalogue : la lecture du cabinet et la restauration du super-administrateur, rien d''autre',
    'observe', obs, 'ok', obs = 'transmissions_encaissements_lecture {authenticated} SELECT admin_du_dossier(dossier_id) -'
      || ' | transmissions_encaissements_restauration {authenticated} INSERT - is_super_admin()');

  select string_agg(c.conname || ':' || c.confdeltype::text, ', ' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.transmissions_encaissements'::regclass and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '116. catalogue : le dossier emporte ses déclarations ; un encaissement ou une facture ne les efface pas sous eux',
    'observe', obs, 'ok', obs = 'transmissions_encaissements_dossier_id_fkey:c, transmissions_encaissements_encaissement_id_fkey:a, '
      || 'transmissions_encaissements_facture_id_fkey:a');

  select string_agg(pg_get_triggerdef(t.oid), ' | ' order by t.tgname) into obs
    from pg_trigger t where t.tgrelid = 'public.transmissions_encaissements'::regclass and not t.tgisinternal;
  verdicts := verdicts || jsonb_build_object('controle', '117. catalogue : la garde veille aussi sur la suppression (jouée sur la réplique)',
    'observe', obs, 'ok', obs = 'CREATE TRIGGER transmissions_encaissements_gardees BEFORE INSERT OR DELETE OR UPDATE ON public.transmissions_encaissements FOR EACH ROW EXECUTE FUNCTION garder_transmission_encaissement()');

  select (select relrowsecurity from pg_class where oid = 'public.transmissions_encaissements'::regclass)::text || ' '
      || string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || '/'
           || has_function_privilege('authenticated', p.oid, 'execute')::text, ' ' order by p.proname) into obs
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('garder_transmission_encaissement', 'encaissement_declare');
  verdicts := verdicts || jsonb_build_object('controle', '118. catalogue : RLS activée ; la garde et encaissement_declare hors de portée en RPC',
    'observe', obs, 'ok', obs = 'true encaissement_declare:false/false garder_transmission_encaissement:false/false');

  select string_agg(p.proname || ':' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
           || has_function_privilege('anon', p.oid, 'execute')::text || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text,
           ' | ' order by p.proname) into obs
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('declarer_encaissement_hors_application', 'annuler_encaissement');
  verdicts := verdicts || jsonb_build_object('controle', '119. catalogue : les deux fonctions qui écrivent sont security definer, search_path fixé, anonyme exclu',
    'observe', obs, 'ok', obs = 'annuler_encaissement:true search_path=public false/true | declarer_encaissement_hors_application:true search_path=public false/true');

  select pg_get_indexdef('public.transmissions_encaissements_une_active'::regclass) into obs;
  verdicts := verdicts || jsonb_build_object('controle', '120. catalogue : une seule déclaration active par encaissement',
    'observe', obs, 'ok', obs = 'CREATE UNIQUE INDEX transmissions_encaissements_une_active ON public.transmissions_encaissements USING btree (encaissement_id) WHERE (etat = ANY (ARRAY[''envoi''::text, ''depose''::text, ''accepte''::text]))');

  -- ══ 121. Rien n'est resté ══════════
  select jsonb_build_object('declarations', (select count(*) from transmissions_encaissements),
    'encaissements', (select count(*) from encaissements_factures), 'parts', (select count(*) from encaissements_factures_taux),
    'factures', (select count(*) from factures_emises), 'lignes', (select count(*) from facture_lignes),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'mouvements', (select count(*) from lignes_bancaires),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '121. rien n''est resté en base',
    'observe', avant::text || ' -> ' || apres::text, 'ok', avant = apres);

  perform set_config('essai.declarations', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui, le fichier entier sans son
-- dernier saut de ligne —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.declarations')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
