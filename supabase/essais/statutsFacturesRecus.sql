-- LES STATUTS LUS SUR LA PLATEFORME DU CLIENT, ÉPROUVÉS EN BASE — à rejouer par `execute_sql` après toute migration qui
-- touche `statuts_factures_recus`, son déclencheur `garder_statut_facture_recu` ou ses policies, le point de reprise des
-- statuts (`connexions_plateformes.cycle_vie_depuis`, `cycle_vie_lu_le`), ou l'une des quatre fonctions qui tirent les
-- conséquences d'un refus lu : `enregistrer_encaissement`, `declarer_encaissement_hors_application`,
-- `garder_transmission_encaissement`, `garder_transmission_facture` (ligne 28.5, étape d7 ; migration
-- `cycle_de_vie_des_factures_emises`).
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - QUI LIT ET QUI ÉCRIT : un statut EXISTE, et l'anonyme, un compte rattaché à rien et le client ne le voient pas, ne
--     le modifient pas, ne l'écrivent pas ; le chef du cabinet le voit, ne le modifie pas, et, super-administrateur, en
--     insère un (la restauration) ; le rôle des Edge Functions en écrit un, ne le modifie pas, et ne fait pas entrer
--     deux fois le même flux ;
--   - CE QUE LA TABLE ET SA GARDE REFUSENT SEULES : chaque contrainte par son nom, chaque règle du déclencheur par son
--     message ;
--   - CE QU'UN REFUS LU FAIT REFUSER, chacun jugé à son code ET à son message : un 210 ou un 213 lu refuse un
--     encaissement (refus 5), une déclaration hors application (refus 6), une déclaration écrite en direct (la garde),
--     une transmission de la facture et celle de son avoir — et un 205, un 207, un 211, un 212 ne refusent rien ; pour
--     une écriture d'hier (une restauration), seul le statut lu AVANT elle compte ; une contre-passation et un retrait
--     restent possibles ;
--   - CE QUE LE CATALOGUE DIT, faute de pouvoir le jouer ici : les policies, les clés et leur action à la suppression,
--     la garde de suppression, les droits d'exécution, l'unicité totale du flux, le point de reprise ;
--   - et que RIEN ne reste en base après l'essai.
--
-- CE QUI NE SE JOUE PAS ICI, ET SE JOUE SUR UNE RÉPLIQUE LOCALE DU SCHÉMA (HISTORIQUE.md, entrée de l'étape d7) : une
-- suppression (refusée en direct, permise par la cascade d'un dossier), et un membre du cabinet qui n'est pas
-- super-administrateur (aucun n'existe sur ce projet).
--
-- Chaque contrôle s'annule dans sa sous-transaction (`ANNULATION_ESSAI`, P0001), le verdict posé dans une VARIABLE avant
-- le `raise`, comme transmissionsEncaissements.sql ; les factures d'essai naissent dans un bloc qui s'annule lui-même à
-- la fin (leurs numéros consommés sont rendus). Aucune instruction de suppression.
--
-- ÉPROUVÉ LE 09/10/2026, après la migration `cycle_de_vie_des_factures_emises` (version 20261009034144) : 61 contrôles
-- sur 61 en production, les factures d'essai rendues (contrôle 0), rien laissé en base ; le texte transmis — ce
-- fichier, ce paragraphe retiré — rend 43 644 caractères, empreinte 1b8aed0d672c2ff2eb12d48fe0b5c7f1 (la ligne 0). Sur
-- la réplique : les mêmes, ce qui ne se joue pas ici (huit contrôles, R1 à R7b), et quatre-vingt-deux mutations de la
-- migration, qui mordent toutes (HISTORIQUE.md, entrée de l'étape d7).
--
-- 10/10/2026, SUR UNE RÉPLIQUE, PAS EN PRODUCTION (espace client, étape P2 : préparée, non appliquée). La migration
-- `ventes_du_client` ajoute à la table la lecture du client qui porte le droit « Ventes », et reprend trois des quatre
-- fonctions qui tirent les conséquences d'un refus lu (`gere_les_ventes` ; la garde des transmissions, un refus de plus
-- à la mise à jour) sans toucher à ces conséquences. Le contrôle 42 attend désormais le catalogue de l'état où la base
-- se trouve, chacun exactement (témoin : la colonne `factures_emises.valide_par`, posée d'un seul tenant avec les
-- policies), et le client d'essai doit être SANS le droit « Ventes » — coché sur ce compte, l'essai se dit impossible
-- plutôt que de virer au rouge à tort ; le client qui le porte se joue dans `ventesClient.sql`. 61 sur 61 sur une
-- réplique identique à la production (`signature.sql`), avant comme après les deux migrations de l'étape.
do $$
declare
  inconnu uuid := gen_random_uuid();
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  jour date := (now() at time zone 'Europe/Paris')::date - 1;
  sha text := repeat('ab', 32);
  e1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); a1 uuid := gen_random_uuid();

  facture_v uuid; dossier_f uuid; autre_dossier uuid; chef_super boolean; fm uuid; av uuid; brouillon uuid;
  p_acc text; p_e1 text; p_d1 text; p_a1 text;
  accepte boolean; code_recu text; message_recu text; obs text; motif text; code_attendu text; prep text; appel text;
  vus int; n_maj int; detail text; fixture text;
  code_i text; msg_i text; code_u text; msg_u text;
  avant jsonb; apres jsonb; ventes_du_client boolean;
  verdicts jsonb := '[]'::jsonb;
begin
  select f.id, f.dossier_id into facture_v, dossier_f from factures_emises f
   where f.statut = 'validee' and f.type = 'facture' order by f.id limit 1;
  select d.id into autre_dossier from dossiers d where d.id <> dossier_f order by d.id limit 1;
  select exists (select 1 from super_admins s where s.user_id = chef) into chef_super;
  if facture_v is null or autre_dossier is null then
    raise exception 'ESSAI_IMPOSSIBLE : il faut une facture validée et un second dossier';
  end if;
  -- Le client d'essai est SANS le droit « Ventes » (espace client, étape P2) : avec lui, il voit les statuts lus pour
  -- son dossier, légitimement, et c'est `ventesClient.sql` qui le joue.
  if exists (select 1 from memberships m where m.user_id = client and m.droit_ventes) then
    raise exception 'ESSAI_IMPOSSIBLE : le client d''essai porte le droit « Ventes » sur un de ses dossiers (voir ventesClient.sql)';
  end if;
  select jsonb_build_object('statuts', (select count(*) from statuts_factures_recus),
    'declarations', (select count(*) from transmissions_encaissements),
    'encaissements', (select count(*) from encaissements_factures), 'parts', (select count(*) from encaissements_factures_taux),
    'factures', (select count(*) from factures_emises), 'lignes', (select count(*) from facture_lignes),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'connexions', (select count(*) from connexions_plateformes),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into avant;

  -- ══ 1 à 3. Un statut EXISTE, et l'anonyme, le compte rattaché à rien et le client ne l'atteignent pas ══════════
  for obs in select unnest(array['1. anonyme', '2. rattaché à rien', '3. client']) loop
    vus := null; n_maj := null; code_i := null; msg_i := null; fixture := null;
    begin
      insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
        values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai', '210');
      if obs like '1.%' then
        set local role anon;
        perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      else
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub',
          case when obs like '2.%' then inconnu else client end, 'role', 'authenticated')::text, true);
      end if;
      select count(*) into vus from statuts_factures_recus;
      update statuts_factures_recus set motifs = 'essai' where flux_id = 'flux-essai';
      get diagnostics n_maj = row_count;
      begin
        insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
          values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai-2', '205');
        code_i := 'ACCEPTÉ';
      exception when others then code_i := sqlstate; msg_i := sqlerrm;
      end;
      raise exception 'ANNULATION_ESSAI';
    exception when others then
      if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', obs || ' : ne voit, ne modifie ni n''écrit aucun statut',
      'observe', coalesce(fixture, 'vus ' || coalesce(vus::text, '?') || ', modifiés ' || coalesce(n_maj::text, '?')
        || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
      'ok', fixture is null and vus = 0 and n_maj = 0
        and (code_i = '42501' and msg_i like 'new row violates row-level security policy%'
             or code_i = '23514' and msg_i = 'Un statut lu désigne une facture validée de son dossier.'));
  end loop;

  -- ══ 4. Le chef voit, ne modifie pas ; super-administrateur, il insère (la restauration) ══════════
  vus := null; n_maj := null; code_i := null; msg_i := null; fixture := null;
  begin
    insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
      values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai', '210');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select count(*) into vus from statuts_factures_recus where flux_id = 'flux-essai';
    update statuts_factures_recus set motifs = 'essai' where flux_id = 'flux-essai';
    get diagnostics n_maj = row_count;
    begin
      insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, lu_le)
        values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai-2', '205', '2000-01-01');
      code_i := 'ACCEPTÉ';
    exception when others then code_i := sqlstate; msg_i := sqlerrm;
    end;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '4. le chef voit le statut, ne le modifie pas ; super-administrateur, il en insère un (restauration)',
    'observe', coalesce(fixture, 'super-administrateur : ' || chef_super || ', vus ' || coalesce(vus::text, '?') || ', modifiés '
      || coalesce(n_maj::text, '?') || ' — insérer : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
    'ok', fixture is null and vus = 1 and n_maj = 0
      and case when chef_super then code_i = 'ACCEPTÉ' else code_i = '42501' end);

  -- ══ 5. Le rôle des Edge Functions écrit un statut, ne le modifie pas, et ne fait pas entrer deux fois le même flux ══
  detail := null; fixture := null; code_u := null; msg_u := null; code_i := null; msg_i := null;
  begin
    set local role service_role;
    insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, message_id, emis_le, createur_role,
      date_statut, motifs, commentaire, montants, lu_par)
      values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai', '211', 'PAIEMENT-1', '20271014090000', 'BY',
        '2027-10-13', 'MPA', 'Payée par virement.', '[{"code":"MPA","montant":"1200.00","devise":"EUR","taux":null,"date":"2027-10-13"}]', chef);
    select s.code || ' ' || s.message_id || ' ' || s.emis_le || ' ' || s.createur_role || ' ' || s.date_statut || ' '
        || s.montants::text || ' ' || (s.lu_le = now()) || ' ' || (s.lu_par = chef)
      into detail from statuts_factures_recus s where s.flux_id = 'flux-essai';
    begin
      update statuts_factures_recus set commentaire = 'autre' where flux_id = 'flux-essai';
      code_u := 'ACCEPTÉ';
    exception when others then code_u := sqlstate; msg_u := sqlerrm;
    end;
    begin
      insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
        values (dossier_f, facture_v, 'pa.exemple.fr', 'flux-essai', '210');
      code_i := 'ACCEPTÉ';
    exception when others then code_i := sqlstate; msg_i := sqlerrm;
    end;
    -- Le même identifiant de flux chez une autre plateforme est un autre flux.
    insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
      values (dossier_f, facture_v, 'autre.exemple.fr', 'flux-essai', '210');
    reset role;
    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then fixture := sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  verdicts := verdicts || jsonb_build_object('controle', '5. le rôle des Edge Functions écrit un statut, ne le modifie pas, ne fait pas entrer deux fois un flux ; le même flux d''une autre plateforme entre',
    'observe', coalesce(fixture, coalesce(detail, '?') || ' — modifier : ' || coalesce(code_u, '?') || ' ' || coalesce(msg_u, '')
      || ' — le même flux : ' || coalesce(code_i, '?') || ' ' || coalesce(msg_i, '')),
    'ok', fixture is null
      and detail = '211 PAIEMENT-1 20271014090000 BY 2027-10-13 [{"code": "MPA", "date": "2027-10-13", "taux": null, "devise": "EUR", "montant": "1200.00"}] true true'
      and code_u = '23514' and msg_u = 'Un statut lu ne se modifie pas.'
      and code_i = '23505' and msg_i like '%statuts_factures_recus_un_flux%');

  -- ══ 6 à 19. Ce que la table et sa garde refusent seules, à une écriture directe ══════════
  for obs, appel, code_attendu, motif in
    select * from (values
      ('6. un code hors du tableau 8 (214)', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''f'', ''214'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_code%'),
      ('7. un code qui ne vise pas une facture (601)', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''f'', ''601'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_code%'),
      ('8. un hôte en capitales', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''PA.exemple.fr'', ''f'', ''210'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_hote%'),
      ('9. un hôte sans domaine', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''localhost'', ''f'', ''210'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_hote%'),
      ('10. un flux vide', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', '''', ''210'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_flux_id%'),
      ('11. un flux qui porte une espace', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''f 1'', ''210'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_flux_id%'),
      ('11b. un flux de 201 caractères', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', %L, ''210'')', dossier_f, facture_v, repeat('f', 201)),
        '23514', '%statuts_factures_recus_flux_id%'),
      ('12. un horodatage qui n''a pas quatorze chiffres', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, emis_le) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', ''2027100814'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_emis_le%'),
      ('13. un rôle qui n''est pas un code', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, createur_role) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', ''acheteur'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_createur_role%'),
      ('14. des motifs faits d''espaces', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, motifs) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', ''   '')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_motifs%'),
      ('14b. des motifs de 2 001 caractères', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, motifs) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', %L)', dossier_f, facture_v, repeat('m', 2001)),
        '23514', '%statuts_factures_recus_motifs%'),
      ('15. un commentaire de 2 001 caractères', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, commentaire) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', %L)', dossier_f, facture_v, repeat('c', 2001)),
        '23514', '%statuts_factures_recus_commentaire%'),
      ('15b. un commentaire fait d''espaces', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, commentaire) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', '' '')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_commentaire%'),
      ('16. des montants qui ne sont pas une liste', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, montants) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', ''{}'')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_montants%'),
      ('16b. des montants absents (null)', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, montants) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', null)', dossier_f, facture_v),
        '23502', '%"montants"%'),
      ('16c. une lecture sans date (lu_le null)', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, lu_le) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', null)', dossier_f, facture_v),
        '23502', '%"lu_le"%'),
      ('17. un identifiant de message vide', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, message_id) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', '''')', dossier_f, facture_v),
        '23514', '%statuts_factures_recus_message_id%'),
      ('17b. un identifiant de message de 201 caractères', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, message_id) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'', %L)', dossier_f, facture_v, repeat('i', 201)),
        '23514', '%statuts_factures_recus_message_id%'),
      ('18. la facture d''un autre dossier', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'')', autre_dossier, facture_v),
        '23514', 'Un statut lu désigne une facture validée de son dossier.'),
      ('19. une facture qui n''existe pas', format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''f'', ''210'')', dossier_f, gen_random_uuid()),
        '23514', 'Un statut lu désigne une facture validée de son dossier.')
    ) t(o, a, c, m)
  loop
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
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

  -- ══ Les factures d'essai : nées ici, annulées à la fin du bloc ══════════
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    -- 120,00 € à 20 %, son avoir de 12,00 €, et un brouillon.
    select r.facture_id into fm from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true) r;
    select r.facture_id into av from enregistrer_facture(dossier_f, null,
      jsonb_build_object('type', 'avoir', 'facture_origine_id', fm, 'tiers_nom', 'Essai', 'date_emission', jour,
        'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12),
      '[{"designation":"a","quantite":-1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) r;
    select r.facture_id into brouillon from enregistrer_facture(dossier_f, null,
      jsonb_build_object('tiers_nom', 'Essai', 'date_emission', jour, 'montant_ht', 100, 'montant_tva', 20, 'montant_ttc', 120),
      '[{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false) r;
    reset role;

    -- Les morceaux dont les contrôles se composent, écrits en direct par le propriétaire de la base : une transmission
    -- acceptée de fm (la plateforme du client, pa.exemple.fr), un encaissement e1 de 10 € à 20 %, sa déclaration à la
    -- main d1, sa contre-passation a1.
    p_acc := format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''accepte'', ''flux-f'')', dossier_f, fm, sha);
    p_e1 := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen) values (%L, %L, %L, %L, 10, ''virement''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, 10)', e1, dossier_f, fm, jour, e1, dossier_f);
    p_d1 := format('insert into transmissions_encaissements (id, dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', d1, dossier_f, e1, fm);
    p_a1 := format('insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif) values (%L, %L, %L, %L, -10, ''virement'', %L, ''essai''); insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (%L, %L, 20, -10)', a1, dossier_f, fm, jour, e1, a1, dossier_f);

    -- ══ 20. Un brouillon ne reçoit pas de statut ══════════
    accepte := false; code_recu := null; message_recu := null;
    begin
      set local role service_role;
      insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code)
        values (dossier_f, brouillon, 'pa.exemple.fr', 'f', '210');
      accepte := true;
      raise exception 'ANNULATION_ESSAI';
    exception when others then code_recu := sqlstate; message_recu := sqlerrm;
    end;
    reset role;
    verdicts := verdicts || jsonb_build_object('controle', '20. un brouillon ne reçoit pas de statut : refusé',
      'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
      'ok', brouillon is not null and not accepte and code_recu = '23514' and message_recu = 'Un statut lu désigne une facture validée de son dossier.');

    -- ══ 21 à 41. Ce qu'un statut lu fait refuser, et ce qu'il laisse faire ══════════
    -- `prep` s'écrit en propriétaire ; `appel` se joue en chef du cabinet (les fonctions) ou dans le rôle des Edge
    -- Functions (les écritures directes, marquées « service: ») ; null pour le code attendu : accepté.
    for obs, prep, appel, code_attendu, motif in
      select * from (values
        -- L'enregistrement d'un encaissement (refus 5).
        ('21. enregistrer un encaissement d''une facture refusée sur sa plateforme (210)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select enregistrer_encaissement(%L, %L, %L, 10, ''virement'', null, ''[{"taux": 20, "montant": 10}]'')', dossier_f, fm, jour),
          '22023', 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun encaissement ne la suit.'),
        ('22. enregistrer un encaissement d''une facture rejetée par une plateforme (213)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''213'')', dossier_f, fm),
          format('select enregistrer_encaissement(%L, %L, %L, 10, ''virement'', null, ''[{"taux": 20, "montant": 10}]'')', dossier_f, fm, jour),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('23. enregistrer un encaissement d''une facture en litige (207), approuvée (205), payée (211), encaissée (212)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''207''), (%L, %L, ''pa.exemple.fr'', ''s2'', ''205''), (%L, %L, ''pa.exemple.fr'', ''s3'', ''211''), (%L, %L, ''pa.exemple.fr'', ''s4'', ''212'')', dossier_f, fm, dossier_f, fm, dossier_f, fm, dossier_f, fm),
          format('select enregistrer_encaissement(%L, %L, %L, 10, ''virement'', null, ''[{"taux": 20, "montant": 10}]'')', dossier_f, fm, jour),
          null, null),
        ('24. enregistrer un encaissement quand c''est une AUTRE facture qui a été refusée',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, facture_v),
          format('select enregistrer_encaissement(%L, %L, %L, 10, ''virement'', null, ''[{"taux": 20, "montant": 10}]'')', dossier_f, fm, jour),
          null, null),
        -- La déclaration hors application (refus 6).
        ('25. déclarer l''encaissement d''une facture refusée sur sa plateforme (210)',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cette facture a été rejetée ou refusée : elle s''annule par un avoir interne, et aucun statut « Encaissée » ne la suit.'),
        ('26. déclarer l''encaissement d''une facture rejetée par une plateforme (213)',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''213'')', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cette facture a été rejetée ou refusée%'),
        ('27. un encaissement déjà déclaré d''une facture refusée depuis : déjà déclaré, que l''ordre juge avant le refus',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          '22023', 'Cet encaissement est déjà déclaré%'),
        ('28. déclarer l''encaissement d''une facture en litige (207)',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''207'')', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          null, null),
        ('28b. déclarer un encaissement quand c''est une AUTRE facture qui a été refusée',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, facture_v),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, e1),
          null, null),
        ('29. déclarer la contre-passation d''un encaissement déclaré, la facture refusée depuis',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || p_a1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select declarer_encaissement_hors_application(%L, %L, null)', dossier_f, a1),
          null, null),
        ('30. contre-passer un encaissement déclaré, la facture refusée depuis',
          p_acc || '; ' || p_e1 || '; ' || p_d1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select annuler_encaissement(%L, %L, %L, ''Facture refusée'')', dossier_f, e1, jour),
          null, null),
        ('31. retirer un encaissement jamais déclaré, la facture refusée depuis',
          p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          format('select retirer_encaissement(%L, %L)', dossier_f, e1),
          null, null),
        -- La garde des déclarations, à une écriture directe (le rôle des Edge Functions).
        ('32. écrire en direct la déclaration du jour d''une facture refusée',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas de statut « Encaissée » : elle s''annule par un avoir interne.'),
        ('33. réinsérer une déclaration d''hier, le refus lu après elle (une restauration)',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', ''2000-01-01'')', dossier_f, e1, fm),
          null, null),
        ('34. réinsérer une déclaration d''hier, le refus lu AVANT elle',
          p_acc || '; ' || p_e1 || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code, lu_le) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''213'', ''1999-12-31'')', dossier_f, fm),
          'service:' || format('insert into transmissions_encaissements (dossier_id, encaissement_id, facture_id, canal, hote, etat, cree_le) values (%L, %L, %L, ''manuel'', ''pa.exemple.fr'', ''depose'', ''2000-01-01'')', dossier_f, e1, fm),
          '23514', 'Une facture rejetée ou refusée ne reçoit pas de statut%'),
        -- La transmission d'une facture, et celle de son avoir.
        ('35. transmettre une facture refusée sur sa plateforme (210) — déposée par le client lui-même',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)', dossier_f, fm, sha),
          '23514', 'Une facture refusée ou rejetée sur sa plateforme ne part pas : elle s''annule par un avoir interne, qui ne se transmet pas, puis une nouvelle facture.'),
        ('36. transmettre une facture rejetée sur sa plateforme (213)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''213'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L)', dossier_f, fm, sha),
          '23514', 'Une facture refusée ou rejetée sur sa plateforme ne part pas%'),
        ('37. transmettre une facture en litige (207)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''207'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)', dossier_f, fm, sha),
          null, null),
        ('37b. transmettre une facture quand c''est une AUTRE facture qui a été refusée',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, facture_v),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)', dossier_f, fm, sha),
          null, null),
        ('37c. une transmission déposée avance encore (acceptée) après la lecture d''un refus — le suivi n''est pas un nouvel envoi',
          format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''depose'', ''flux-f''); ', dossier_f, fm, sha)
            || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          -- La division échoue si aucune ligne n'a changé : un accord sur rien ne prouverait rien.
          'service:' || format('with m as (update transmissions_factures set etat = ''accepte'' where facture_id = %L returning 1) select 1 / count(*) from m', fm),
          null, null),
        ('38. réinsérer la transmission d''hier d''une facture refusée depuis (une restauration)',
          format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id, cree_le) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''accepte'', ''flux-f'', ''2000-01-01'')', dossier_f, fm, sha),
          null, null),
        ('39. transmettre l''avoir d''une facture refusée sur sa plateforme : un avoir interne',
          p_acc || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)', dossier_f, av, sha),
          '23514', 'Cet avoir annule une facture rejetée ou refusée : c''est un avoir interne, qui ne se transmet pas.'),
        ('39b. transmettre l''avoir d''une facture rejetée sur sa plateforme (213) : un avoir interne',
          p_acc || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''213'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''superpdp'', ''api.superpdp.tech'', %L)', dossier_f, av, sha),
          '23514', 'Cet avoir annule une facture rejetée ou refusée%'),
        ('40. réinsérer la transmission d''hier de l''avoir d''une facture refusée depuis (une restauration)',
          p_acc || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''210'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256, etat, flux_id, cree_le) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L, ''accepte'', ''flux-a'', ''2000-01-01'')', dossier_f, av, sha),
          null, null),
        ('41. transmettre l''avoir d''une facture en litige (207)',
          p_acc || '; ' || format('insert into statuts_factures_recus (dossier_id, facture_id, hote, flux_id, code) values (%L, %L, ''pa.exemple.fr'', ''s1'', ''207'')', dossier_f, fm),
          'service:' || format('insert into transmissions_factures (dossier_id, facture_id, canal, hote, sha256) values (%L, %L, ''plateforme'', ''pa.exemple.fr'', %L)', dossier_f, av, sha),
          null, null)
      ) t(o, p, a, c, m)
    loop
      accepte := false; code_recu := null; message_recu := null;
      begin
        if prep is not null then execute prep; end if;
        if appel like 'service:%' then
          set local role service_role;
          execute substr(appel, 9);
        else
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
          execute appel;
        end if;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then code_recu := sqlstate; message_recu := sqlerrm;
      end;
      reset role;
      verdicts := verdicts || jsonb_build_object('controle', obs || case when code_attendu is null then ' : accepté' else ' : refusé' end,
        'observe', coalesce(code_recu, '?') || ' ' || coalesce(message_recu, ''),
        'ok', case when code_attendu is null then accepte and code_recu = 'P0001'
                   else not accepte and code_recu = code_attendu and message_recu like motif end);
    end loop;

    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then
      verdicts := verdicts || jsonb_build_object('controle', '0. les factures d''essai',
        'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;
  reset role;

  -- ══ 42 à 49. Ce que le catalogue dit ══════════
  -- Depuis la migration `ventes_du_client` (espace client, étape P2 ; son témoin : `factures_emises.valide_par`), la
  -- table a aussi la lecture du client qui porte le droit « Ventes ». Chaque état s'attend exactement.
  select exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par'
                 and not attisdropped) into ventes_du_client;
  select string_agg(p.policyname || ' ' || p.roles::text || ' ' || p.cmd || ' ' || coalesce(p.qual, '-') || ' ' || coalesce(p.with_check, '-'), ' | ' order by p.policyname) into obs
    from pg_policies p where p.schemaname = 'public' and p.tablename = 'statuts_factures_recus';
  verdicts := verdicts || jsonb_build_object('controle', '42. catalogue : la lecture du cabinet et la restauration du super-administrateur — et, les ventes du client en base, la lecture au droit « Ventes » —, rien d''autre',
    'observe', obs, 'ok', obs = 'statuts_factures_recus_lecture {authenticated} SELECT admin_du_dossier(dossier_id) -'
      || case when ventes_du_client then ' | statuts_factures_recus_lecture_ventes {authenticated} SELECT client_du_dossier(dossier_id, ''ventes''::text) -' else '' end
      || ' | statuts_factures_recus_restauration {authenticated} INSERT - is_super_admin()');

  select string_agg(c.conname || ':' || c.confdeltype::text, ', ' order by c.conname) into obs
    from pg_constraint c where c.conrelid = 'public.statuts_factures_recus'::regclass and c.contype = 'f';
  verdicts := verdicts || jsonb_build_object('controle', '43. catalogue : le dossier emporte ses statuts ; une facture ne les efface pas sous elle',
    'observe', obs, 'ok', obs = 'statuts_factures_recus_dossier_id_fkey:c, statuts_factures_recus_facture_id_fkey:a');

  select string_agg(pg_get_triggerdef(t.oid), ' | ' order by t.tgname) into obs
    from pg_trigger t where t.tgrelid = 'public.statuts_factures_recus'::regclass and not t.tgisinternal;
  verdicts := verdicts || jsonb_build_object('controle', '44. catalogue : la garde veille aussi sur la suppression (jouée sur la réplique)',
    'observe', obs, 'ok', obs = 'CREATE TRIGGER statuts_factures_recus_gardes BEFORE INSERT OR DELETE OR UPDATE ON public.statuts_factures_recus FOR EACH ROW EXECUTE FUNCTION garder_statut_facture_recu()');

  select (select relrowsecurity from pg_class where oid = 'public.statuts_factures_recus'::regclass)::text || ' '
      || has_function_privilege('anon', 'public.garder_statut_facture_recu()', 'execute')::text || '/'
      || has_function_privilege('authenticated', 'public.garder_statut_facture_recu()', 'execute')::text || ' '
      || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') into obs
    from pg_proc p where p.oid = 'public.garder_statut_facture_recu()'::regprocedure;
  verdicts := verdicts || jsonb_build_object('controle', '45. catalogue : RLS activée ; la garde hors de portée en RPC, aux droits de l''appelant, son search_path fixé',
    'observe', obs, 'ok', obs = 'true false/false false search_path=public');

  select pg_get_constraintdef(c.oid) into obs from pg_constraint c
   where c.conrelid = 'public.statuts_factures_recus'::regclass and c.conname = 'statuts_factures_recus_un_flux';
  verdicts := verdicts || jsonb_build_object('controle', '46. catalogue : un flux n''entre qu''une fois par dossier et par plateforme — une contrainte TOTALE',
    'observe', obs, 'ok', obs = 'UNIQUE (dossier_id, hote, flux_id)');

  select string_agg(pg_get_indexdef(i.indexrelid), ' | ' order by pg_get_indexdef(i.indexrelid)) into obs
    from pg_index i where i.indrelid = 'public.statuts_factures_recus'::regclass and not i.indisunique;
  verdicts := verdicts || jsonb_build_object('controle', '46b. catalogue : les statuts d''une facture se trouvent par un index',
    'observe', obs, 'ok', obs = 'CREATE INDEX statuts_factures_recus_facture ON public.statuts_factures_recus USING btree (facture_id)');

  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || (not a.attnotnull)::text, ', ' order by a.attname)
      || ' — policies ' || (select count(*) from pg_policies where schemaname = 'public' and tablename = 'connexions_plateformes')
    into obs from pg_attribute a
   where a.attrelid = 'public.connexions_plateformes'::regclass and a.attname in ('cycle_vie_depuis', 'cycle_vie_lu_le') and not a.attisdropped;
  verdicts := verdicts || jsonb_build_object('controle', '47. catalogue : le point de reprise des statuts sur la connexion, qui reste sans aucune policy',
    'observe', obs, 'ok', obs = 'cycle_vie_depuis timestamp with time zone true, cycle_vie_lu_le timestamp with time zone true — policies 0');

  select string_agg(p.proname || ':' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-') || ' '
           || has_function_privilege('anon', p.oid, 'execute')::text || '/' || has_function_privilege('authenticated', p.oid, 'execute')::text,
           ' | ' order by p.proname) into obs
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('enregistrer_encaissement', 'declarer_encaissement_hors_application', 'garder_transmission_encaissement',
                       'garder_transmission_facture');
  verdicts := verdicts || jsonb_build_object('controle', '48. catalogue : les quatre fonctions redéfinies gardent leur sécurité, leur search_path et leurs droits',
    'observe', obs, 'ok', obs = 'declarer_encaissement_hors_application:true search_path=public false/true'
      || ' | enregistrer_encaissement:true search_path=public false/true'
      || ' | garder_transmission_encaissement:false search_path=public false/false'
      || ' | garder_transmission_facture:false search_path=public false/false');

  select count(*)::text into obs from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('enregistrer_encaissement', 'declarer_encaissement_hors_application', 'garder_transmission_encaissement',
                       'garder_transmission_facture')
     and p.prosrc like '%statuts_factures_recus s%' and p.prosrc like '%s.code in (''210'', ''213'')%';
  verdicts := verdicts || jsonb_build_object('controle', '49. catalogue : les quatre fonctions lisent les statuts 210 et 213',
    'observe', obs, 'ok', obs = '4');

  -- ══ 50. Rien n'est resté ══════════
  select jsonb_build_object('statuts', (select count(*) from statuts_factures_recus),
    'declarations', (select count(*) from transmissions_encaissements),
    'encaissements', (select count(*) from encaissements_factures), 'parts', (select count(*) from encaissements_factures_taux),
    'factures', (select count(*) from factures_emises), 'lignes', (select count(*) from facture_lignes),
    'transmissions', (select count(*) from transmissions_factures), 'evenements', (select count(*) from facture_superpdp_events),
    'connexions', (select count(*) from connexions_plateformes),
    'numerotation', (select coalesce(sum(dernier_numero), 0) from facture_numerotation)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '50. rien n''est resté en base',
    'observe', avant::text || ' -> ' || apres::text, 'ok', avant = apres);

  perform set_config('essai.statuts', verdicts::text, true);
end $$;

-- Un verdict qui n'a pas pu se calculer (une valeur nulle dans sa comparaison) est une faute, pas un silence. La ligne 0
-- dit le texte que la base a reçu — par l'outil MCP, qui ajoute sa signature après lui, le fichier entier sans son
-- dernier saut de ligne —, pour le comparer au fichier par son empreinte.
select x.controle, x.ok, x.observe from (
  select v.controle, coalesce(v.ok, false) as ok, v.observe
  from jsonb_to_recordset(current_setting('essai.statuts')::jsonb) as v(controle text, ok boolean, observe text)
  union all
  select '0. information : le texte reçu par la base', true, length(t.recu) || ' caractères, empreinte ' || md5(t.recu)
  from (select case when position(E'\n\n-- source: POST /mcp' in current_query()) > 0
                    then left(current_query(), position(E'\n\n-- source: POST /mcp' in current_query()) - 1)
                    else current_query() end as recu) t
) x
order by (regexp_match(x.controle, '^(\d+)'))[1]::int, x.controle;
