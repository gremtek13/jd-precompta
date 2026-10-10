-- LES ENCAISSEMENTS D'UNE FACTURE ÉMISE, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche `encaissements_factures`, `encaissements_factures_taux`, leurs déclencheurs ou leurs policies, ou les fonctions
-- `enregistrer_encaissement`, `retirer_encaissement`, `montants_par_taux_facture`, `centimes_ligne_facture` et
-- `encaissement_declare` (ligne 28.5, étape d1 ; migration `encaissements_des_factures` — et, pour
-- `encaissement_declare`, la migration `transmissions_des_encaissements` de l'étape d4, qui lui donne son vrai corps).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT : un encaissement EXISTE, et l'anonyme, un compte rattaché à rien et le client ne le voient
--     pas, ne le modifient pas, ne l'écrivent pas et n'appellent aucune des deux fonctions (l'anonyme n'a pas le droit
--     de les exécuter, les deux autres se font refuser l'accès au dossier) ; le chef du cabinet enregistre un
--     encaissement d'un seul tenant (l'encaissement et sa part par taux), le voit, ne le modifie pas directement et le
--     retire (les contrôles POSITIFS) ; super-administrateur, il en insère un (la restauration d'une sauvegarde) ; le
--     rôle des Edge Functions en écrit un valide ;
--   - LES REFUS D'`enregistrer_encaissement`, chacun jugé à son code ET à son message, dans l'ordre de la fonction —
--     celui que le module d2 et l'écran d3 reprendront ;
--   - CE QU'ELLE ACCEPTE : le solde exact de chaque taux après un encaissement partiel, et plus un centime ; un
--     mouvement que des frais ont rogné sous le seuil ; un mouvement qu'un encaissement retiré ou annulé a libéré ;
--   - LE RETRAIT : un encaissement retiré cesse de compter, ne se retire pas deux fois, et ne se retire pas tant
--     qu'une annulation vivante le vise ; DÉCLARÉ (étape d4), il ne se retire ni par la fonction ni en direct ;
--   - CE QUE LA TABLE ET SES DÉCLENCHEURS REFUSENT SEULS, à une écriture directe : chaque contrainte par son nom, chaque
--     règle du déclencheur par son message, l'unicité de l'annulation vivante, l'immuabilité, la répartition ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les policies, les clés et leur action à la suppression,
--     la garde de suppression, les droits d'exécution ; et quelques montants par taux relevés sur l'application ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape d1) : une
-- suppression (refusée en direct, permise par la cascade d'un dossier), deux sessions qui enregistrent en même temps
-- sur la même facture, et un membre du cabinet qui n'est pas super-administrateur (aucun n'existe sur ce projet).
-- Un encaissement DÉCLARÉ se joue ici depuis l'étape d4 (contrôles 47b et 47c) ; les déclarations elles-mêmes, dans
-- transmissionsEncaissements.sql.
--
-- QUI REFUSE L'ÉCRITURE DIRECTE, ET POURQUOI CE N'EST PAS TOUJOURS LA RLS : le déclencheur lit la facture avec les
-- droits de l'appelant et passe AVANT la RLS ; qui ne voit pas la facture est refusé par lui (23514), sans apprendre si
-- elle existe.
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE
-- avant le `raise`, comme rls.sql et transmissionsFactures.sql ; les factures, les mouvements et les transmissions
-- d'essai naissent dans un bloc qui s'annule lui-même à la fin (leurs numéros consommés sont rendus). Les verdicts
-- voyagent dans un réglage LOCAL à la transaction (`essai.encaissements`), que la requête finale lit. Aucune
-- instruction de suppression.
--
-- ÉPROUVÉ LE 08/10/2026, après la migration `encaissements_des_factures` (version 20261008180607) : 107 contrôles
-- sur 107 en production, le texte transmis identique à ce fichier (la ligne 0 en rend l'empreinte), rien laissé en
-- base. Sur la réplique : les mêmes 107, ce qui ne se joue pas ici (13 contrôles), deux sessions concurrentes, et
-- cent trois mutations de la migration, dont cent mordent — les trois survivantes sont équivalentes.
--
-- REJOUÉ LE 08/10/2026, après la migration `transmissions_des_encaissements` (version 20261008221156), qui donne son
-- corps à `encaissement_declare` : 109 contrôles sur 109 en production (47b et 47c ajoutés, le contrôle 99 reformulé),
-- le texte transmis identique à ce fichier, rien laissé en base ; les mêmes 109 sur la réplique.
--
-- REJOUÉ LE 09/10/2026, après la migration `cycle_de_vie_des_factures_emises` (version 20261009034144), qui élargit le
-- refus 5 de `enregistrer_encaissement` à un refus lu sur la plateforme du client : 109 contrôles sur 109 en
-- production, le texte transmis identique à ce fichier, ce paragraphe retiré (67 530 caractères, empreinte
-- 4b0bf6ab65c73927f5e6340be4891023), rien laissé en base.
--
-- 10/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape P2 : préparée, non appliquée). La migration
-- `ventes_du_client` ajoute aux deux tables la lecture du client qui porte le droit « Ventes », fait accepter ce client
-- par les deux fonctions (`gere_les_ventes`), et donne à `enregistrer_encaissement` un refus NEUF à son rang 2 : le
-- mouvement bancaire ne se désigne qu'avec le droit « Banque ». Le chef du cabinet porte les deux droits : les refus
-- joués ici gardent leur ordre et leurs mots ; le refus neuf et le client qui porte les droits se jouent dans
-- `ventesClient.sql`. Le contrôle 93 attend désormais le catalogue de l'état où la base se trouve, chacun exactement
-- (témoin : la colonne `factures_emises.valide_par`, posée d'un seul tenant avec les policies), et le client d'essai
-- doit être SANS le droit « Ventes » — coché sur ce compte, l'essai se dit impossible plutôt que de virer au rouge à
-- tort. 109 contrôles sur 109 sur une réplique identique à la production (`signature.sql`), avant comme après les deux
-- migrations de l'étape.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  jour date := (now() at time zone 'Europe/Paris')::date - 1;

  facture_v uuid; dossier_f uuid; autre_dossier uuid; taux_v numeric; chef_super boolean;
  fm uuid; fb uuid; fa uuid; f19 uuid; fx uuid;
  m_credit uuid; m_cent uuid; m_mille uuid; m_98 uuid; m_debit uuid; m_zero uuid; m_autre uuid;
  ident uuid; ident2 uuid; ident3 uuid;
  accepte boolean; code_recu text; message_recu text; obs text; motif text; code_attendu text; prep text; appel text;
  requete text; attendu boolean; vus int; vus_taux int; n_maj int; detail text; ligne record;
  code_e text; msg_e text; code_r text; msg_r text; code_i text; msg_i text; fixture text;
  avant jsonb; apres jsonb; ventes_du_client boolean;
  verdicts jsonb := '[]'::jsonb;
begin
  select f.id, f.dossier_id into facture_v, dossier_f from factures_emises f
   where f.statut = 'validee' and f.type = 'facture' order by f.id limit 1;
  select d.id into autre_dossier from dossiers d where d.id <> dossier_f order by d.id limit 1;
  select l.taux_tva into taux_v from facture_lignes l where l.facture_id = facture_v order by l.ordre limit 1;
  select exists (select 1 from super_admins s where s.user_id = chef) into chef_super;
  if facture_v is null or autre_dossier is null or taux_v is null then
    raise exception 'ESSAI_IMPOSSIBLE : il faut une facture validée, avec une ligne, et un second dossier';
  end if;
  if exists (select 1 from encaissements_factures where facture_id = facture_v) then
    raise exception 'ESSAI_IMPOSSIBLE : la facture d''essai porte déjà un encaissement';
  end if;
  -- Le client d'essai est SANS le droit « Ventes » (espace client, étape P2) : avec lui, il voit les encaissements de
  -- son dossier et les enregistre, légitimement, et c'est `ventesClient.sql` qui le joue.
  if exists (select 1 from memberships m where m.user_id = client and m.droit_ventes) then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai porte le droit « Ventes » sur un de ses dossiers (voir ventesClient.sql)';
  end if;
  select jsonb_build_object('encaissements', (select count(*) from encaissements_factures),
    'parts', (select count(*) from encaissements_factures_taux), 'factures', (select count(*) from factures_emises),
    'lignes', (select count(*) from facture_lignes), 'mouvements', (select count(*) from lignes_bancaires),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into avant;

  -- ══ 1 à 3. Un encaissement EXISTE, et l'anonyme, le compte rattaché à rien et le client ne l'atteignent pas ══════════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client']) loop
    vus := null; vus_taux := null; n_maj := null; code_e := null; msg_e := null; code_r := null; msg_r := null;
    code_i := null; msg_i := null; fixture := null;
    begin
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
        values (dossier_f, facture_v, jour, 1, 'virement') returning id into ident;
      insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (ident, dossier_f, taux_v, 1);
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu else client end, 'role', 'authenticated')::text, true);
      end if;
      select count(*) into vus from encaissements_factures;
      select count(*) into vus_taux from encaissements_factures_taux;
      update encaissements_factures set moyen = 'cheque' where id = ident;
      get diagnostics n_maj = row_count;
      begin
        perform enregistrer_encaissement(dossier_f, facture_v, jour, 1, 'virement', null,
          jsonb_build_array(jsonb_build_object('taux', taux_v, 'montant', 1)));
        code_e := 'ACCEPTÉ';
      exception when others then code_e := sqlstate; msg_e := sqlerrm;
      end;
      begin
        perform retirer_encaissement(dossier_f, ident);
        code_r := 'ACCEPTÉ';
      exception when others then code_r := sqlstate; msg_r := sqlerrm;
      end;
      begin
        insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
          values (dossier_f, facture_v, jour, 1, 'virement');
        code_i := 'ACCEPTÉ';
      exception when others then code_i := sqlstate; msg_i := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucun encaissement, n''appelle aucune des deux fonctions',
      'observe', coalesce(fixture, 'vus ' || coalesce(vus::text, '?') || '/' || coalesce(vus_taux::text, '?') || ', modifiés '
        || coalesce(n_maj::text, '?') || ' — enregistrer : ' || coalesce(code_e, '?') || ' ' || coalesce(msg_e, '')
        || ' — retirer : ' || coalesce(code_r, '?') || ' ' || coalesce(msg_r, '') || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
      'ok', fixture is null and vus = 0 and vus_taux = 0 and n_maj = 0
        and case when obs like '1.%'
              then code_e = '42501' and msg_e = 'permission denied for function enregistrer_encaissement'
               and code_r = '42501' and msg_r = 'permission denied for function retirer_encaissement'
              else code_e = '42501' and msg_e = 'Accès refusé à ce dossier.' and code_r = '42501' and msg_r = 'Accès refusé à ce dossier.' end
        and (code_i = '42501' and msg_i like 'new row violates row-level security policy%'
             or code_i = '23514' and msg_i like 'Seule une facture validée de son dossier reçoit un encaissement%'));
  end loop;

  -- ══ 4. Le chef enregistre d'un seul tenant, voit, ne modifie pas directement, retire ; il insère s'il est super-admin ═
  vus := null; n_maj := null; detail := null; code_i := null; msg_i := null; fixture := null;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.id into ident from enregistrer_encaissement(dossier_f, facture_v, jour, 1, 'virement', null,
      jsonb_build_array(jsonb_build_object('taux', taux_v, 'montant', 1))) e;
    select count(*) into vus from encaissements_factures where id = ident;
    select e.montant || ' ' || e.moyen || ' ' || (e.cree_par = chef) || ' ' || (e.retire_le is null) || ' | parts '
        || (select string_agg(trim_scale(t.taux)::text || ':' || t.montant, ',') from encaissements_factures_taux t where t.encaissement_id = e.id)
      into detail from encaissements_factures e where e.id = ident;
    update encaissements_factures set moyen = 'cheque' where id = ident;
    get diagnostics n_maj = row_count;
    select detail || ' | retiré : ' || (r.retire_le is not null) || ' par le chef : ' || (r.retire_par = chef)
      into detail from retirer_encaissement(dossier_f, ident) r;
    begin
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
        values (dossier_f, facture_v, jour, 1, 'cheque');
      code_i := 'ACCEPTÉ';
    exception when others then code_i := sqlstate; msg_i := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '4. le chef enregistre d''un seul tenant, voit, ne modifie pas directement et retire ; super-administrateur, il insère (restauration)',
    'observe', coalesce(fixture, 'super-administrateur : ' || chef_super || ', vus ' || coalesce(vus::text, '?') || ', modifiés ' || coalesce(n_maj::text, '?')
      || ' — ' || coalesce(detail, '?') || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
    'ok', fixture is null and vus = 1 and n_maj = 0
      and detail = '1 virement true true | parts ' || trim_scale(taux_v)::text || ':1 | retiré : true par le chef : true'
      and case when chef_super then code_i = 'ACCEPTÉ' else code_i = '42501' end);

  -- ══ 5. Le rôle des Edge Functions écrit un encaissement valide et sa part ══════════
  accepte := false; code_recu := null; message_recu := null;
  begin
    set local role service_role;
    insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
      values (dossier_f, facture_v, jour, 2.5, 'especes') returning id into ident;
    insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (ident, dossier_f, taux_v, 2.5);
    accepte := true;
    raise exception 'ANNULATION_ESSAI';
  exception when others then code_recu := sqlstate; message_recu := sqlerrm;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. le rôle des Edge Functions écrit un encaissement valide et sa part',
    'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');

  -- ══ Les factures, les mouvements et l'état d'essai : nés ici, annulés à la fin du bloc ══════════
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    -- Trois taux : 1 200,00 € à 20 %, 105,50 € à 5,5 %, 50,00 € à 0 % — 1 355,50 € TTC.
    select r.facture_id into fm from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 1150, 'montant_tva', 205.5, 'montant_ttc', 1355.5),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":1000,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":100,"taux_tva":5.5},{"designation":"c","quantite":1,"prix_unitaire_ht":50,"taux_tva":0}]'::jsonb,
      true) r;
    select r.facture_id into fb from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 10, 'montant_tva', 2, 'montant_ttc', 12),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) r;
    select r.facture_id into fa from enregistrer_facture(dossier_f, null,
      jsonb_build_object('type', 'avoir', 'facture_origine_id', facture_v, 'date_emission', aujourd_hui,
        'montant_ht', -1, 'montant_tva', 0, 'montant_ttc', -1),
      '[{"designation":"a","quantite":-1,"prix_unitaire_ht":1,"taux_tva":0}]'::jsonb, true) r;
    -- Un taux que la facturation électronique n'admet pas (19 %), et une facture dont l'en-tête dit une TVA de 21 €
    -- quand sa ligne en porte 20 : enregistrer_facture prend les montants de l'en-tête tels qu'ils lui viennent.
    select r.facture_id into f19 from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 100, 'montant_tva', 19, 'montant_ttc', 119),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":19}]'::jsonb, true) r;
    select r.facture_id into fx from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 100, 'montant_tva', 21, 'montant_ttc', 121),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) r;
    reset role;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', 1355.5) returning id into m_credit;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', 100) returning id into m_cent;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', 1000) returning id into m_mille;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', 98) returning id into m_98;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', -50) returning id into m_debit;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (dossier_f, jour, 'essai', 0) returning id into m_zero;
    insert into lignes_bancaires (dossier_id, date, libelle, montant) values (autre_dossier, jour, 'essai', 100) returning id into m_autre;

    -- ══ 6 à 41. Les refus d'enregistrer_encaissement, dans son ordre ══════════
    for obs, prep, appel, code_attendu, motif in
      select * from (values
        ('6. une facture d''un autre dossier', null::text,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', autre_dossier, fm, jour),
          'P0002', 'Facture introuvable dans ce dossier.'),
        ('7. une facture qui n''existe pas', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, gen_random_uuid(), jour),
          'P0002', 'Facture introuvable dans ce dossier.'),
        ('8. un brouillon', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fb, jour),
          '22023', 'Seule une facture validée reçoit un encaissement : celle-ci est un brouillon.'),
        ('9. un avoir', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 0, "montant": 1}]'')', dossier_f, fa, jour),
          '22023', 'Un avoir ne reçoit pas d''encaissement : seule une facture en reçoit.'),
        ('10. une facture rejetée par une plateforme',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''rejete'', ''flux-1'')', dossier_f, fm, repeat('ab', 32)),
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun encaissement ne la suit.'),
        ('11. une facture refusée chez Super PDP (210)',
          format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:210'', ''essai'', now())', dossier_f, fm),
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('12. une facture rejetée chez Super PDP (213)',
          format('insert into facture_superpdp_events (dossier_id, facture_id, superpdp_event_id, status_code, status_text, occurred_at) values (%L, %L, -1, ''fr:213'', ''essai'', now())', dossier_f, fm),
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('13. des lignes qui ne redonnent pas les montants enregistrés', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fx, jour),
          '22023', 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes%'),
        ('14. une date absente', null,
          format('select enregistrer_encaissement(%L, %L, null, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm),
          '22023', 'La date de l''encaissement est à renseigner.'),
        ('15. une date d''avant l''an 2000', null,
          format('select enregistrer_encaissement(%L, %L, ''1999-12-31'', 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm),
          '22023', 'Un encaissement ne se date pas avant l''an 2000.'),
        ('16. une date de demain, à Paris', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, aujourd_hui + 1),
          '22023', 'Un encaissement ne se date pas dans l''avenir : nous sommes le ' || to_char(aujourd_hui, 'DD/MM/YYYY') || '.'),
        ('17. un montant nul', null,
          format('select enregistrer_encaissement(%L, %L, %L, 0, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Un encaissement est un montant positif.'),
        ('18. un montant négatif', null,
          format('select enregistrer_encaissement(%L, %L, %L, -1, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Un encaissement est un montant positif.'),
        ('19. un montant qui n''est pas un nombre (NaN)', null,
          format('select enregistrer_encaissement(%L, %L, %L, ''NaN''::numeric, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Un encaissement est un montant positif.'),
        ('20. un montant absent', null,
          format('select enregistrer_encaissement(%L, %L, %L, null, ''virement'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Un encaissement est un montant positif.'),
        ('21. un montant au millième', null,
          format('select enregistrer_encaissement(%L, %L, %L, 10.001, ''virement'', null, ''[{"taux": 20, "montant": 10.001}]'')', dossier_f, fm, jour),
          '22023', 'Un encaissement se compte au centime.'),
        ('22. un moyen de paiement inconnu', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''troc'', null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Le moyen de paiement est inconnu.'),
        ('23. un moyen de paiement absent', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, null, null, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Le moyen de paiement est inconnu.'),
        ('24. un mouvement d''un autre dossier', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', %L, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour, m_autre),
          '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'),
        ('25. un mouvement qui n''existe pas', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', %L, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour, gen_random_uuid()),
          '22023', 'Ce mouvement n''est pas un mouvement de ce dossier.'),
        ('26. un débit', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', %L, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour, m_debit),
          '22023', 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.'),
        ('26b. un mouvement de zéro euro', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', %L, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour, m_zero),
          '22023', 'Un encaissement se justifie par un crédit : ce mouvement n''en est pas un.'),
        ('27. un mouvement qui justifie déjà un encaissement de cette facture',
          format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id) values (%L, %L, %L, 1, ''virement'', %L)', dossier_f, fm, jour, m_credit),
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', %L, ''[{"taux": 20, "montant": 1}]'')', dossier_f, fm, jour, m_credit),
          '22023', 'Ce mouvement justifie déjà un encaissement de cette facture.'),
        ('28. un mouvement de 100 € pour 102,05 € d''encaissements, au-delà de l''écart de frais', null,
          format('select enregistrer_encaissement(%L, %L, %L, 102.05, ''virement'', %L, ''[{"taux": 20, "montant": 102.05}]'')', dossier_f, fm, jour, m_cent),
          '22023', 'Ce mouvement de 100,00 € justifierait 102,05 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'),
        ('28b. un mouvement de 1 000 € pour 1 005,01 € d''encaissements : l''écart toléré ne passe pas 5 €', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1005.01, ''virement'', %L, ''[{"taux": 20, "montant": 1005.01}]'')', dossier_f, fm, jour, m_mille),
          '22023', 'Ce mouvement de 1000,00 € justifierait 1005,01 € d''encaissements : l''écart dépasse ce que des frais bancaires expliquent.'),
        ('29. une répartition qui n''est pas une liste', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''{"taux": 20, "montant": 1}'')', dossier_f, fm, jour),
          '22023', 'La répartition par taux est illisible : une liste de taux et de montants.'),
        ('30. une répartition vide', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[]'')', dossier_f, fm, jour),
          '22023', 'La répartition par taux est illisible : une liste de taux et de montants.'),
        ('31. une part sans montant', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20}]'')', dossier_f, fm, jour),
          '22023', 'La répartition par taux est illisible : une liste de taux et de montants.'),
        ('32. un montant écrit en texte', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": "1"}]'')', dossier_f, fm, jour),
          '22023', 'La répartition par taux est illisible : une liste de taux et de montants.'),
        ('33. un taux répété', null,
          format('select enregistrer_encaissement(%L, %L, %L, 2, ''virement'', null, ''[{"taux": 20, "montant": 1}, {"taux": 20.0, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Le taux de 20 % figure deux fois dans la répartition.'),
        ('34. un taux qui n''est pas un taux de la facture', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 10, "montant": 1}]'')', dossier_f, fm, jour),
          '22023', 'Le taux de 10 % n''est pas un taux de cette facture.'),
        ('35. un taux que la facturation électronique n''admet pas', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 19, "montant": 1}]'')', dossier_f, f19, jour),
          '22023', 'Le taux de 19 % n''est pas un taux de TVA que la facturation électronique admet.'),
        ('36. une part nulle', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 1}, {"taux": 5.5, "montant": 0}]'')', dossier_f, fm, jour),
          '22023', 'Chaque part de la répartition est un montant positif, au centime.'),
        ('37. une part négative', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 2}, {"taux": 5.5, "montant": -1}]'')', dossier_f, fm, jour),
          '22023', 'Chaque part de la répartition est un montant positif, au centime.'),
        ('38. une part au millième', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1, ''virement'', null, ''[{"taux": 20, "montant": 0.995}, {"taux": 5.5, "montant": 0.005}]'')', dossier_f, fm, jour),
          '22023', 'Chaque part de la répartition est un montant positif, au centime.'),
        ('39. une répartition qui ne fait pas le montant', null,
          format('select enregistrer_encaissement(%L, %L, %L, 10, ''virement'', null, ''[{"taux": 20, "montant": 6}, {"taux": 5.5, "montant": 3.99}]'')', dossier_f, fm, jour),
          '22023', 'La répartition (9,99 €) ne fait pas le montant encaissé (10,00 €).'),
        ('40. plus que le total de la facture', null,
          format('select enregistrer_encaissement(%L, %L, %L, 1355.51, ''virement'', null, ''[{"taux": 20, "montant": 1200.01}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]'')', dossier_f, fm, jour),
          '22023', 'L''encaissement dépasserait le total de la facture : il reste 1355,50 € à encaisser.'),
        ('41. plus que ce qu''un taux porte', null,
          format('select enregistrer_encaissement(%L, %L, %L, 105.51, ''virement'', null, ''[{"taux": 5.5, "montant": 105.51}]'')', dossier_f, fm, jour),
          '22023', 'À 5,5 %, l''encaissement dépasserait ce que la facture porte : il reste 105,50 € à encaisser à ce taux.')
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

    -- ══ 42 à 46. Ce qu'elle accepte ══════════
    -- 42. Un mouvement de 100 € justifie 102,04 € : 2,04 € d'écart, sous min(2 % de 102,04 €, 5 €).
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_f, fm, jour, 102.04, 'virement', m_cent, '[{"taux": 20, "montant": 102.04}]');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '42. un mouvement de 100 € justifie 102,04 € : l''écart est sous le seuil des frais',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');

    for obs, appel in
      select * from (values
        ('42b. un mouvement de 1 000 € justifie 1 005,00 € : 5 € d''écart, le plafond exact',
          format('select enregistrer_encaissement(%L, %L, %L, 1005, ''virement'', %L, ''[{"taux": 20, "montant": 1005}]'')', dossier_f, fm, jour, m_mille)),
        ('42c. un mouvement de 98 € justifie 100,00 € : 2 € d''écart, 2 % exactement',
          format('select enregistrer_encaissement(%L, %L, %L, 100, ''virement'', %L, ''[{"taux": 20, "montant": 100}]'')', dossier_f, fm, jour, m_98))
      ) t(o, a)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        execute appel;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs,
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');
    end loop;

    -- 42d. Les montants par taux d'une facture et d'un avoir, tels que la facture électronique les transmet : l'avoir
    -- dans le sens de son document, en montants positifs.
    select string_agg(trim_scale(m.taux)::text || ':' || m.base_centimes || '/' || m.tva_centimes || '/' || m.ttc_centimes, ' ' order by m.taux desc)
      into detail from montants_par_taux_facture(fm) m;
    select detail || ' | ' || string_agg(trim_scale(m.taux)::text || ':' || m.base_centimes || '/' || m.tva_centimes || '/' || m.ttc_centimes, ' ' order by m.taux desc)
      into detail from montants_par_taux_facture(fa) m;
    verdicts := verdicts || jsonb_build_object('controle', '42d. les montants par taux d''une facture, et d''un avoir dans le sens de son document',
      'observe', coalesce(detail, '?'), 'ok', detail = '20:100000/20000/120000 5.5:10000/550/10550 0:5000/0/5000 | 0:100/0/100');

    -- 43. Un encaissement partiel, puis le solde EXACT de chaque taux, puis plus un centime.
    detail := null; code_recu := null; message_recu := null; fixture := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_f, fm, jour, 500, 'virement', m_credit,
        '[{"taux": 20, "montant": 442.64}, {"taux": 5.5, "montant": 38.92}, {"taux": 0, "montant": 18.44}]');
      perform enregistrer_encaissement(dossier_f, fm, jour, 855.5, 'cheque', null,
        '[{"taux": 20, "montant": 757.36}, {"taux": 5.5, "montant": 66.58}, {"taux": 0, "montant": 31.56}]');
      begin
        perform enregistrer_encaissement(dossier_f, fm, jour, 0.01, 'especes', null, '[{"taux": 0, "montant": 0.01}]');
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      select string_agg(trim_scale(t.taux)::text || ':' || sum_t, ',' order by t.taux desc) into detail
        from (select tt.taux, sum(tt.montant) as sum_t from encaissements_factures_taux tt
                join encaissements_factures e on e.id = tt.encaissement_id
               where e.facture_id = fm and e.retire_le is null group by tt.taux) t;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '43. un encaissement partiel puis le solde exact de chaque taux passent, et plus un centime ne passe',
      'observe', coalesce(fixture, coalesce(detail, '?') || ' — puis 0,01 € : ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, '')),
      'ok', fixture is null and detail = '20:1200.00,5.5:105.50,0:50.00' and code_recu = '22023'
        and message_recu = 'L''encaissement dépasserait le total de la facture : il reste 0,00 € à encaisser.');

    -- 44. Retiré, un encaissement cesse de compter et libère son mouvement ; il ne se retire pas deux fois.
    detail := null; code_recu := null; message_recu := null; fixture := null;
    begin
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      select e.id into ident from enregistrer_encaissement(dossier_f, fm, jour, 1355.5, 'virement', m_credit,
        '[{"taux": 20, "montant": 1200}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]') e;
      perform retirer_encaissement(dossier_f, ident);
      select e.id into ident2 from enregistrer_encaissement(dossier_f, fm, jour, 1355.5, 'virement', m_credit,
        '[{"taux": 20, "montant": 1200}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]') e;
      detail := 'ressaisi : ' || (ident2 is not null);
      begin
        perform retirer_encaissement(dossier_f, ident);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '44. retiré, un encaissement cesse de compter et libère son mouvement ; il ne se retire pas deux fois',
      'observe', coalesce(fixture, coalesce(detail, '?') || ' — second retrait : ' || coalesce(code_recu, '?') || ' ' || coalesce(message_recu, '')),
      'ok', fixture is null and detail = 'ressaisi : true' and code_recu = '22023' and message_recu = 'Cet encaissement est déjà retiré.');

    -- 45. Annulé par une annulation vivante, un encaissement libère son mouvement et ne compte plus.
    accepte := false; code_recu := null; message_recu := null;
    begin
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id)
        values (dossier_f, fm, jour, 1355.5, 'virement', m_credit) returning id into ident;
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
        values (dossier_f, fm, jour, -1355.5, 'virement', ident, 'essai');
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform enregistrer_encaissement(dossier_f, fm, jour, 1355.5, 'virement', m_credit,
        '[{"taux": 20, "montant": 1200}, {"taux": 5.5, "montant": 105.5}, {"taux": 0, "montant": 50}]');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '45. annulé, un encaissement libère son mouvement et ne compte plus',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');

    -- 46 et 47. Les refus du retrait : un encaissement introuvable dans ce dossier ; une annulation vivante le vise,
    -- qui se retire d'abord — puis lui.
    accepte := false; code_recu := null; message_recu := null;
    begin
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
        values (dossier_f, fm, jour, 5, 'virement') returning id into ident;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      perform retirer_encaissement(autre_dossier, ident);
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '46. retirer un encaissement par un autre dossier : refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', not accepte and code_recu = 'P0002' and message_recu = 'Encaissement introuvable dans ce dossier.');

    detail := null; code_recu := null; message_recu := null; fixture := null;
    begin
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
        values (dossier_f, fm, jour, 5, 'virement') returning id into ident;
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
        values (dossier_f, fm, jour, -5, 'virement', ident, 'essai') returning id into ident2;
      set local role authenticated;
      perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
      begin
        perform retirer_encaissement(dossier_f, ident);
        code_recu := 'ACCEPTÉ';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      perform retirer_encaissement(dossier_f, ident2);
      perform retirer_encaissement(dossier_f, ident);
      reset role;
      select string_agg((e.retire_le is not null)::text, ',' order by e.montant) into detail
        from encaissements_factures e where e.id in (ident, ident2);
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '47. une annulation vivante empêche de retirer son encaissement ; elle se retire d''abord, puis lui',
      'observe', coalesce(fixture, coalesce(code_recu, '?') || ' ' || coalesce(message_recu, '') || ' — retirés : ' || coalesce(detail, '?')),
      'ok', fixture is null and code_recu = '22023'
        and message_recu = 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.' and detail = 'true,true');

    -- 47b et 47c. DÉCLARÉ, un encaissement ne se retire plus, ni par la fonction ni en direct : il se contre-passe
    -- (étape d4). La facture acceptée par la plateforme du client, l'encaissement déclaré à la main.
    for obs in select unnest(array['47b. un encaissement déclaré : la fonction refuse de le retirer',
                                   '47c. un encaissement déclaré : le retrait direct est refusé']) loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id)
          values (dossier_f, fm, 'plateforme', 'pa.exemple.fr', repeat('ab', 32), 'accepte', 'flux-1');
        insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
          values (dossier_f, fm, jour, 5, 'virement') returning id into ident;
        insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat)
          values (dossier_f, ident, fm, 'manuel', 'pa.exemple.fr', 'depose');
        if obs like '47b.%' then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          perform retirer_encaissement(dossier_f, ident);
        else
          set local role service_role;
          update encaissements_factures set retire_le = now() where id = ident;
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs, 'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', not accepte and code_recu = case when obs like '47b.%' then '22023' else '23514' end
          and message_recu = 'Un encaissement déclaré ne se retire pas : il se contre-passe, et l''annulation se déclare à son tour.');
    end loop;

    -- ══ 48 à 71. Ce que la table et son déclencheur refusent seuls, à une écriture directe ══════════
    insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen)
      values (dossier_f, fm, jour, 10, 'virement') returning id into ident;
    insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, retire_le)
      values (dossier_f, fm, jour, 7, 'virement', now()) returning id into ident3;
    insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
      values (dossier_f, fm, jour, -10, 'virement', ident, 'essai') returning id into ident2;
    for obs, requete, code_attendu, motif in
      select * from (values
        ('48. un montant nul', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 0, ''virement'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_montant%'),
        ('49. un montant au millième', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 1.234, ''virement'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_montant%'),
        ('50. dix mille milliards d''euros', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 10000000000000, ''virement'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_montant%'),
        ('51. un montant qui n''est pas un nombre (NaN)', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, ''NaN'', ''virement'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_montant%'),
        ('52. un moyen inconnu', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 1, ''troc'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_moyen%'),
        ('53. une date d''avant l''an 2000', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, ''1999-12-31'', 1, ''virement'')', dossier_f, fm),
          '23514', '%encaissements_factures_date%'),
        ('54. un montant négatif qui n''annule rien', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, -1, ''virement'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_signe%'),
        ('55. un motif sur un encaissement', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, motif) values (%L, %L, %L, 1, ''virement'', ''essai'')', dossier_f, fm, jour),
          '23514', '%encaissements_factures_motif_d_une_annulation%'),
        ('56. une annulation sans motif', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, retire_le) values (%L, %L, %L, -7, ''virement'', %L, now())', dossier_f, fm, jour, ident3),
          '23514', '%'),
        ('57. une annulation justifiée par un mouvement', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, ligne_bancaire_id, retire_le) values (%L, %L, %L, -7, ''virement'', %L, ''essai'', %L, now())', dossier_f, fm, jour, ident3, m_credit),
          '23514', '%encaissements_factures_annulation_sans_mouvement%'),
        ('58. un motif blanc', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, retire_le) values (%L, %L, %L, -7, ''virement'', %L, ''   '', now())', dossier_f, fm, jour, ident3),
          '23514', '%encaissements_factures_motif%'),
        ('59. un motif de 2 001 caractères', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, retire_le) values (%L, %L, %L, -7, ''virement'', %L, %L, now())', dossier_f, fm, jour, ident3, repeat('m', 2001)),
          '23514', '%encaissements_factures_motif%'),
        ('60. un brouillon', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 1, ''virement'')', dossier_f, fb, jour),
          '23514', 'Seule une facture validée de son dossier reçoit un encaissement : jamais un brouillon, jamais un avoir.'),
        ('61. un avoir', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 1, ''virement'')', dossier_f, fa, jour),
          '23514', 'Seule une facture validée de son dossier reçoit un encaissement%'),
        ('62. la facture d''un autre dossier', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, 1, ''virement'')', autre_dossier, fm, jour),
          '23514', 'Seule une facture validée de son dossier reçoit un encaissement%'),
        ('63. un débit', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id) values (%L, %L, %L, 1, ''virement'', %L)', dossier_f, fm, jour, m_debit),
          '23514', 'Un encaissement se justifie par un crédit de son dossier.'),
        ('64. un crédit d''un autre dossier', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id) values (%L, %L, %L, 1, ''virement'', %L)', dossier_f, fm, jour, m_autre),
          '23514', 'Un encaissement se justifie par un crédit de son dossier.'),
        ('65. l''annulation d''un encaissement d''une autre facture', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, -10, ''virement'', %L, ''essai'')', dossier_f, facture_v, jour, ident),
          '23514', 'Une annulation contre-passe un encaissement de la même facture.'),
        ('66. l''annulation d''une annulation', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, -10, ''virement'', %L, ''essai'')', dossier_f, fm, jour, ident2),
          '23514', 'Une annulation ne se contre-passe pas%'),
        ('67. une annulation qui n''est pas montant pour montant', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, retire_le) values (%L, %L, %L, -9, ''virement'', %L, ''essai'', now())', dossier_f, fm, jour, ident),
          '23514', 'Une annulation contre-passe l''encaissement montant pour montant.'),
        ('68. l''annulation vivante d''un encaissement retiré', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, -7, ''virement'', %L, ''essai'')', dossier_f, fm, jour, ident3),
          '23514', 'Un encaissement retiré ne s''annule pas : il n''a jamais été déclaré.'),
        ('69. une seconde annulation vivante', format('insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, -10, ''virement'', %L, ''essai'')', dossier_f, fm, jour, ident),
          '23505', '%encaissements_factures_une_annulation%')
      ) t(o, r, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        set local role service_role;
        execute requete;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || ' : refusé',
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', not accepte and code_recu = code_attendu and message_recu like motif
          -- 56 : la contrainte vise une annulation sans motif ; c'est elle, et non le déclencheur, qui doit refuser.
          and (obs not like '56.%' or message_recu like '%encaissements_factures_motif_d_une_annulation%'));
    end loop;

    -- 70. Ce que la restauration rejoue : l'annulation retirée d'un encaissement retiré passe, et l'annulation
    -- vivante unique se remplace une fois la première retirée.
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, retire_le)
        values (dossier_f, fm, jour, -7, 'virement', ident3, 'essai', now());
      update encaissements_factures set retire_le = now() where id = ident2;
      insert into encaissements_factures (dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif)
        values (dossier_f, fm, jour, -10, 'virement', ident, 'essai');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '70. l''annulation retirée d''un encaissement retiré passe (restauration) ; la première annulation retirée, une autre passe',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''), 'ok', accepte and code_recu = 'P0001');

    -- 71 à 84. Rien ne change après l'insertion, sauf le retrait, une fois.
    for obs, requete, attendu in
      select * from (values
        ('71. le montant', format('update encaissements_factures set montant = 11 where id = %L', ident), false),
        ('72. la date', format('update encaissements_factures set date_encaissement = date_encaissement - 1 where id = %L', ident), false),
        ('73. le moyen', format('update encaissements_factures set moyen = ''cheque'' where id = %L', ident), false),
        ('74. la facture', format('update encaissements_factures set facture_id = %L where id = %L', facture_v, ident), false),
        ('75. le dossier', format('update encaissements_factures set dossier_id = %L where id = %L', autre_dossier, ident), false),
        ('76. le mouvement', format('update encaissements_factures set ligne_bancaire_id = %L where id = %L', m_cent, ident), false),
        ('77. le motif d''une annulation', format('update encaissements_factures set motif = ''autre'' where id = %L', ident2), false),
        ('78. l''auteur', format('update encaissements_factures set cree_par = %L where id = %L', chef, ident), false),
        ('79. la date de création', format('update encaissements_factures set cree_le = cree_le - interval ''1 day'' where id = %L', ident), false),
        ('80. un retrait défait', format('update encaissements_factures set retire_le = null where id = %L', ident3), false),
        ('81. un retrait redaté', format('update encaissements_factures set retire_le = retire_le - interval ''1 day'' where id = %L', ident3), false),
        ('82. l''auteur d''un retrait, seul', format('update encaissements_factures set retire_par = %L where id = %L', chef, ident), false),
        ('83. le retrait d''un encaissement qu''une annulation vivante vise', format('update encaissements_factures set retire_le = now() where id = %L', ident), false),
        ('84. le retrait, une fois (celui de l''annulation)', format('update encaissements_factures set retire_le = now(), retire_par = %L where id = %L', chef, ident2), true)
      ) t(o, r, x)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
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
          when obs like '83.%' then not accepte and code_recu = '23514'
            and message_recu = 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.'
          else not accepte and code_recu = '23514' and message_recu like 'Un encaissement ne se modifie pas%' end);
    end loop;

    -- 85 à 92. La répartition, écrite en direct.
    for obs, requete, code_attendu, motif in
      select * from (values
        ('85. la part d''un encaissement d''un autre dossier', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 1)', ident, autre_dossier),
          '23514', 'Une part par taux appartient à un encaissement de son dossier.'),
        ('86. une part du signe contraire', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, -1)', ident, dossier_f),
          '23514', 'Une part par taux est du signe de son encaissement.'),
        ('86b. une part nulle', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 0)', ident, dossier_f),
          '23514', 'Une part par taux est du signe de son encaissement.'),
        ('87. un taux hors des lignes de la facture', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 10, 1)', ident, dossier_f),
          '23514', 'Une part par taux vise un taux des lignes de sa facture.'),
        ('88. des parts qui dépassent le montant', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 6), (%L, %L, 5.5, 4.01)', ident, dossier_f, ident, dossier_f),
          '23514', 'Les parts par taux dépasseraient le montant de leur encaissement.'),
        ('89. un taux que la facturation électronique n''admet pas', format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, %L, 1, ''virement''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 19, 1)', inconnu, dossier_f, f19, jour, inconnu, dossier_f),
          '23514', '%encaissements_factures_taux_taux%'),
        ('90. une part au millième', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 1.234)', ident, dossier_f),
          '23514', '%encaissements_factures_taux_montant%'),
        ('91. un taux répété', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 1), (%L, %L, 20.00, 1)', ident, dossier_f, ident, dossier_f),
          '23505', '%encaissements_factures_taux_pkey%'),
        ('92. une part modifiée', format('insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 1); update encaissements_factures_taux set montant = 2 where encaissement_id = %L', ident, dossier_f, ident),
          '23514', 'La répartition d''un encaissement ne se modifie pas.')
      ) t(o, r, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
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

    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then
      verdicts := verdicts || jsonb_build_object('controle', '0. les factures et les mouvements d''essai',
        'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;

  -- ══ 93 à 100. Ce que le catalogue dit ══════════
  -- Depuis la migration `ventes_du_client` (espace client, étape P2 ; son témoin : `factures_emises.valide_par`), chaque
  -- table a aussi la lecture du client qui porte le droit « Ventes ». Chaque état s'attend exactement.
  select exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                 and not attisdropped) into ventes_du_client;
  select string_agg(p.tablename || '.' || p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.tablename, p.policyname) into obs
    from pg_policies p where p.schemaname = 'public' and p.tablename in ('encaissements_factures', 'encaissements_factures_taux');
  verdicts := verdicts || jsonb_build_object('controle', '93. catalogue : la lecture du cabinet et la restauration du super-administrateur — et, les ventes du client en base, la lecture au droit « Ventes » —, rien d''autre',
    'observe', obs, 'ok', obs = 'encaissements_factures.encaissements_factures_lecture {authenticated} SELECT admin_du_dossier(dossier_id) -'
      || case when ventes_du_client then ' | encaissements_factures.encaissements_factures_lecture_ventes {authenticated} SELECT client_du_dossier(dossier_id, ''ventes''::text) -' else '' end
      || ' | encaissements_factures.encaissements_factures_restauration {authenticated} INSERT - is_super_admin()'
      || ' | encaissements_factures_taux.encaissements_factures_taux_lecture {authenticated} SELECT admin_du_dossier(dossier_id) -'
      || case when ventes_du_client then ' | encaissements_factures_taux.encaissements_factures_taux_lecture_ventes {authenticated} SELECT client_du_dossier(dossier_id, ''ventes''::text) -' else '' end
      || ' | encaissements_factures_taux.encaissements_factures_taux_restauration {authenticated} INSERT - is_super_admin()');

  select string_agg(c.conname || ':' || c.confdeltype::text, ', ' order by c.conname) into obs
    from pg_constraint c where c.conrelid in ('public.encaissements_factures'::regclass, 'public.encaissements_factures_taux'::regclass) and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '94. catalogue : le dossier et la facture emportent leurs encaissements, un mouvement ou un encaissement annulé ne s''efface pas sous eux',
    'observe', obs, 'ok', obs = 'encaissements_factures_annule_id_fkey:a, encaissements_factures_dossier_id_fkey:c, encaissements_factures_facture_id_fkey:c, '
      || 'encaissements_factures_ligne_bancaire_id_fkey:a, encaissements_factures_taux_dossier_id_fkey:c, encaissements_factures_taux_encaissement_id_fkey:c');

  select string_agg(pg_get_triggerdef(t.oid), ' | ' order by t.tgname) into obs
    from pg_trigger t where t.tgrelid in ('public.encaissements_factures'::regclass, 'public.encaissements_factures_taux'::regclass) and not t.tgisinternal;
  verdicts := verdicts || jsonb_build_object('controle', '95. catalogue : les deux gardes veillent aussi sur la suppression (jouée sur la réplique)',
    'observe', obs, 'ok', obs = 'CREATE TRIGGER encaissements_factures_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.encaissements_factures FOR EACH ROW EXECUTE FUNCTION garder_encaissement_facture()'
      || ' | CREATE TRIGGER encaissements_factures_taux_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.encaissements_factures_taux FOR EACH ROW EXECUTE FUNCTION garder_encaissement_facture_taux()');

  select (select relrowsecurity from pg_class where oid = 'public.encaissements_factures'::regclass)::text || ' '
      || (select relrowsecurity from pg_class where oid = 'public.encaissements_factures_taux'::regclass)::text || ' '
      || string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || '/'
           || has_function_privilege('authenticated', p.oid, 'execute')::text, ' ' order by p.proname) into obs
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('garder_encaissement_facture', 'garder_encaissement_facture_taux', 'centimes_ligne_facture',
                       'montants_par_taux_facture', 'encaissement_declare');
  verdicts := verdicts || jsonb_build_object('controle', '96. catalogue : RLS activée ; les gardes et les calculs hors de portée en RPC',
    'observe', obs, 'ok', obs = 'true true centimes_ligne_facture:false/false encaissement_declare:false/false garder_encaissement_facture:false/false '
      || 'garder_encaissement_facture_taux:false/false montants_par_taux_facture:false/false');

  select string_agg(p.proname || ':' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
           || has_function_privilege('anon', p.oid, 'execute')::text || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text,
           ' | ' order by p.proname) into obs
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('enregistrer_encaissement', 'retirer_encaissement');
  verdicts := verdicts || jsonb_build_object('controle', '97. catalogue : les deux fonctions qui écrivent sont security definer, search_path fixé, anonyme exclu',
    'observe', obs, 'ok', obs = 'enregistrer_encaissement:true search_path=public false/true | retirer_encaissement:true search_path=public false/true');

  select pg_get_indexdef('public.encaissements_factures_une_annulation'::regclass) into obs;
  verdicts := verdicts || jsonb_build_object('controle', '98. catalogue : une seule annulation vivante par encaissement',
    'observe', obs, 'ok', obs = 'CREATE UNIQUE INDEX encaissements_factures_une_annulation ON public.encaissements_factures USING btree (annule_id) WHERE (retire_le IS NULL)');

  select encaissement_declare(gen_random_uuid())::text into obs;
  verdicts := verdicts || jsonb_build_object('controle', '99. un encaissement qu''aucune déclaration ne vise n''est pas déclaré',
    'observe', obs, 'ok', obs = 'false');

  -- 100. Le calcul de la base est celui de l'application : des lignes relevées avec montantsDuDocument (factureCii.ts) —
  -- une ligne à 1,005 € (1,00 € en virgule flottante), des demis exacts, un avoir, une remise à prix négatif, des
  -- quantités à quatre décimales et des prix à six, et des lignes où la TVA prise sur le HT non arrondi, ou arrondie
  -- autrement que Math.round (une TVA qui tombe exactement sur un demi-centime : 1 € à 5,5 %), différerait d'un centime.
  select string_agg(c.ht_centimes || '/' || c.tva_centimes, ' ' order by t.n) into obs
    from (values (1, 1::numeric, 1.005::numeric, 20::numeric, false), (2, 3, 0.335, 5.5, false), (3, 1, 0.125, 0, true),
                 (4, -2, 1.115, 20, true), (5, 2.5, -4.015, 10, false), (6, 0.3333, 100.123456, 20, false),
                 (7, 7, 12.345678, 5.5, false), (8, 1, 0.285, 20, false), (9, 1, 0.094, 5.5, false), (10, 1, 0.046, 10, false),
                 (11, 1, 0.05, 10, false), (12, 1, 1, 5.5, false), (13, 1, 0.15, 10, false)) t(n, q, p, tx, av)
    cross join lateral centimes_ligne_facture(t.q, t.p, t.tx, t.av) c;
  verdicts := verdicts || jsonb_build_object('controle', '100. le HT et la TVA d''une ligne, en centimes, sont ceux que l''application calcule',
    'observe', obs, 'ok', obs = '100/20 101/6 -13/0 223/45 -1004/-100 3337/667 8642/475 28/6 9/0 5/1 5/1 100/6 15/2');

  -- ══ 101. Rien n'est resté ══════════
  select jsonb_build_object('encaissements', (select count(*) from encaissements_factures),
    'parts', (select count(*) from encaissements_factures_taux), 'factures', (select count(*) from factures_emises),
    'lignes', (select count(*) from facture_lignes), 'mouvements', (select count(*) from lignes_bancaires),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '101. rien n''est resté en base',
    'observe', avant::text || ' -> ' || apres::text, 'ok', avant = apres);

  perform set_config('essai.encaissements', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui, le fichier entier sans son
-- dernier saut de ligne —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.encaissements')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
