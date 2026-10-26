-- LA GARDE DE LA FRONTIÈRE DES ENCAISSEMENTS, SEULE, ÉPROUVÉE SUR UNE RÉPLIQUE (chantier EC-Q3, étape VF7a ; migration
-- `frontiere_des_encaissements`) — SUR UNE RÉPLIQUE SEULEMENT, par psql, en super-utilisateur, en UNE transaction
-- (`psql -1`) : le temps de son bloc, il désactive les deux gardes d'hier des encaissements (`alter table … disable
-- trigger`) et supprime un dossier jetable ; rien de cela ne se joue sur la base du cabinet. Le reste de la frontière se
-- rejoue par `ventesFacturees.sql` (105, 145 à 149, 183 à 186), `encaissementsFactures.sql` (5b, 95, 96),
-- `ecrituresVentesFacturees.sql` (170 à 176), `validationExercice.sql` (141) et `rls.sql` (FE1 à FE5), en production
-- aussi.
--
-- POURQUOI À PART. La garde de la frontière, `garder_frontiere_des_encaissements`, passe APRÈS celle des encaissements
-- (l'ordre des noms des déclencheurs ; l'en-tête de la migration dit pourquoi). Or celle-ci refuse déjà, pour une
-- facture source, toute modification d'un encaissement hors de ses fonctions et de leurs réglages, toute suppression, et
-- ce qu'une part change ou retire : ces règles de la frontière ne s'atteignent pas tant que la garde d'hier tient. Elles
-- comptent le jour où celle-ci change (VF5H2-Q1, ou une autre étape) ; cet essai les joue, les deux gardes d'hier
-- désactivées — puis remises, pour la suppression du dossier.
--
-- CE QUI SE PROUVE, dans un dossier jetable du cabinet du dossier `test` qui a basculé et dont l'exercice 2025 est validé
-- (et un second qui n'a pas basculé) ; chaque refus à son code (23514) ET à ses mots :
--   0. le jeu : quatre encaissements par la fonction du cabinet, avant la validation de 2025 ;
--   S1 à S4. un encaissement daté du 31 décembre 2025 — la frontière même — ne change plus : une autre colonne, sa
--     suppression, son détachement du mouvement qu'il cite, le rattachement mêlé à une autre colonne ;
--   S5. une mise à jour qui ne change rien passe ;
--   S6 à S8. sa part ne change pas, ne se retire pas, et la part d'un encaissement de 2026 ne le rejoint pas ;
--   S9. un encaissement de 2026 et sa part : libres ; S10. une facture qui n'est pas source : libre ;
--   S11. les gardes d'hier remises, la suppression d'un dossier qui porte un encaissement figé passe, et l'emporte ;
--   99. l'essai s'est joué jusqu'au bout, rien n'est resté, et les deux gardes d'hier sont actives.
-- Tout se joue dans un bloc annulé à la fin (`ANNULATION_ESSAI`) ; les verdicts voyagent dans un réglage LOCAL à la
-- transaction (`essai.frontiere_seule`). Les identifiants jetables sont FIXES (préfixe `5f7a0000`).
--
-- ÉPROUVÉ LE 25/10/2026 SUR LA RÉPLIQUE DE L'ÉTAPE (PostgreSQL 16, UTF8 ; `signature.sql` : les neuf familles, et
-- l'historique, égaux à la production à 148 migrations ; puis `registre_virement_mixte`, de l'étape VF5h2), migration
-- `frontiere_des_encaissements`, appliquée le 26/10/2026 : sans elle, 13 verdicts, 7 en faute — S1 à S4, S6 à S8 — ;
-- avec elle, 13 justes, rien n'est resté, les gardes d'hier actives ; de même sur la production sans VF5h2. Des
-- quarante-six mutations de la migration, il est seul à en tuer quatre — l'encaissement qu'une part quitte, la
-- suppression d'un dossier, le rattachement mêlé à une autre colonne, tout autre changement d'un encaissement figé —, et
-- en tue sept autres avec les essais qui se jouent aussi en production (HISTORIQUE.md, « LA FRONTIÈRE DES
-- ENCAISSEMENTS, EN BASE »).
--
-- 26/10/2026, migration `insertion_des_encaissements` (VF5H2-Q1 et VF5H2Q1-Q1, préparée, pas appliquée) : la garde des
-- encaissements change, à l'insertion et au rattachement, pour un mouvement classé par ses encaissements — désactivée
-- le temps des contrôles S, elle ne masque rien de plus ici, et ce qu'elle masquait (la modification, la suppression,
-- les parts) reste masqué. Rejoué sur la réplique, sans puis avec elle : 13 verdicts, 0 en faute, identiques
-- (HISTORIQUE.md, « L'INSERTION DIRECTE D'UN ENCAISSEMENT SUR UN MOUVEMENT CLASSÉ PAR SES ENCAISSEMENTS »).
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cab uuid;
  d uuid := '5f7a0000-0000-4000-8000-000000000001';
  dn uuid := '5f7a0000-0000-4000-8000-000000000002';
  m_dec uuid := '5f7a0000-0000-4000-8000-000000000021';
  m_jan uuid := '5f7a0000-0000-4000-8000-000000000022';
  fj jsonb := '{"tiers_nom":"ESSAI","tiers_siret":"12345678900012","emetteur_nom":"ESSAI","montant_ht":100,"montant_tva":20,"montant_ttc":120,"date_emission":"2025-06-01","nature_operation":"services"}';
  lj jsonb := '[{"designation":"x","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]';
  rep jsonb := '[{"taux":20,"montant":10}]';
  f uuid; fn uuid; e_fige uuid; e_rat uuid; e_26 uuid; e_non uuid;
  code text; msg text; erreur text;
  fige_change text := 'L''exercice 2025 est validé : cet encaissement ne change plus.';
  fige_repartition text := 'L''exercice 2025 est validé : la répartition de cet encaissement ne change plus.';
  avant text; apres text; actives text;
  verdicts jsonb := '[]'::jsonb;
begin
  select cabinet_id into cab from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cab is null or not exists (select 1 from super_admins where user_id = chef)
     or not exists (select 1 from cabinet_admins where user_id = chef and cabinet_id = cab and role = 'comptable_en_chef')
     or exists (select 1 from dossiers where id in (d, dn)) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou dossier jetable déjà présent';
  end if;
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from factures_emises), (select count(*) from facture_lignes),
      (select count(*) from lignes_bancaires), (select count(*) from encaissements_factures), (select count(*) from encaissements_factures_taux),
      (select count(*) from exercices_valides), (select count(*) from facture_numerotation)) into avant;

  begin
    insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures)
      values (d, 'ESSAI VF7A SEULE', cab, 'tresorerie', '455000', true), (dn, 'ESSAI VF7A SEULE N', cab, 'tresorerie', '455000', false);
    insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut)
      values (m_dec, d, '2025-12-20', 'ESSAI', 10, 'non_rapprochee'), (m_jan, d, '2026-01-05', 'ESSAI', 10, 'non_rapprochee');
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
    select e.facture_id into f from enregistrer_facture(d, null, fj, lj, true) e;
    select e.facture_id into fn from enregistrer_facture(dn, null, fj, lj, true) e;
    e_fige := (enregistrer_encaissement(d, f, '2025-12-31', 10, 'cheque', null, rep)).id;
    e_rat := (enregistrer_encaissement(d, f, '2025-12-20', 10, 'cheque', m_dec, rep)).id;
    e_26 := (enregistrer_encaissement(d, f, '2026-01-02', 10, 'cheque', null, rep)).id;
    e_non := (enregistrer_encaissement(dn, fn, '2025-12-31', 10, 'cheque', null, rep)).id;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
      total_credit, empreinte, declaration)
      values (d, 2025, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('a', 64), '{}'), (dn, 2025, now(), chef, 'tresorerie', 0, 0, 0, 0, repeat('b', 64), '{}');
    verdicts := verdicts || jsonb_build_object('controle', '0. le jeu : quatre encaissements, deux factures, l''exercice 2025 validé dans les deux dossiers',
      'ok', (select count(*) = 4 from encaissements_factures where id in (e_fige, e_rat, e_26, e_non))
        and (select f2.source_de_la_vente from factures_emises f2 where f2.id = f) and not (select f2.source_de_la_vente from factures_emises f2 where f2.id = fn),
      'observe', 'construit');

    -- Les gardes d'hier, désactivées le temps du bloc.
    alter table encaissements_factures disable trigger encaissements_factures_gardes;
    alter table encaissements_factures_taux disable trigger encaissements_factures_taux_gardes;

    begin update encaissements_factures set moyen = 'virement' where id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S1. un encaissement figé : une autre modification', 'ok', code = '23514' and msg = fige_change, 'observe', code || ' ' || coalesce(msg, ''));

    begin delete from encaissements_factures where id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S2. … sa suppression', 'ok', code = '23514' and msg = fige_change, 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures set ligne_bancaire_id = null where id = e_rat; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S3. … rattaché, il ne se détache pas', 'ok', code = '23514' and msg = fige_change, 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures set ligne_bancaire_id = m_jan, moyen = 'virement' where id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S4. … le rattachement et une autre colonne d''un même geste', 'ok', code = '23514' and msg = fige_change, 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures set montant = montant where id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S5. … une mise à jour qui ne change rien passe', 'ok', code = 'OK', 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures_taux set montant = 9 where encaissement_id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S6. sa part ne change pas', 'ok', code = '23514' and msg = fige_repartition, 'observe', code || ' ' || coalesce(msg, ''));

    begin delete from encaissements_factures_taux where encaissement_id = e_fige; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S7. … ni ne se retire', 'ok', code = '23514' and msg = fige_repartition, 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures_taux set encaissement_id = e_fige where encaissement_id = e_26; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S8. la part d''un encaissement de 2026 ne rejoint pas un encaissement figé', 'ok', code = '23514' and msg = fige_repartition, 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures_taux set montant = 9 where encaissement_id = e_26; delete from encaissements_factures_taux where encaissement_id = e_26;
      update encaissements_factures set moyen = 'virement' where id = e_26; delete from encaissements_factures where id = e_26; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S9. un encaissement de 2026 et sa part : libres, la garde d''hier écartée', 'ok', code = 'OK', 'observe', code || ' ' || coalesce(msg, ''));

    begin update encaissements_factures set moyen = 'virement' where id = e_non; update encaissements_factures_taux set montant = 9 where encaissement_id = e_non;
      delete from encaissements_factures_taux where encaissement_id = e_non; delete from encaissements_factures where id = e_non; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S10. une facture qui n''est pas source, dans un exercice validé : libre', 'ok', code = 'OK', 'observe', code || ' ' || coalesce(msg, ''));

    -- Les gardes d'hier remises : la suppression du dossier passe, son encaissement figé et sa part avec lui.
    alter table encaissements_factures enable trigger encaissements_factures_gardes;
    alter table encaissements_factures_taux enable trigger encaissements_factures_taux_gardes;
    begin delete from dossiers where id = d; code := 'OK'; msg := null;
    exception when others then code := sqlstate; msg := sqlerrm; end;
    verdicts := verdicts || jsonb_build_object('controle', 'S11. la suppression d''un dossier qui porte un encaissement figé passe', 'ok', code = 'OK'
      and not exists (select 1 from encaissements_factures where dossier_id = d), 'observe', code || ' ' || coalesce(msg, ''));

    raise exception 'ANNULATION_ESSAI';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI' then erreur := sqlstate || ' ' || sqlerrm; end if;
  end;

  select concat_ws('/', (select count(*) from dossiers), (select count(*) from factures_emises), (select count(*) from facture_lignes),
      (select count(*) from lignes_bancaires), (select count(*) from encaissements_factures), (select count(*) from encaissements_factures_taux),
      (select count(*) from exercices_valides), (select count(*) from facture_numerotation)) into apres;
  select string_agg(tgname || ':' || tgenabled::text, ',' order by tgname collate "C") into actives
    from pg_trigger where tgname in ('encaissements_factures_gardes', 'encaissements_factures_taux_gardes');
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, rien n''est resté, et les gardes d''hier sont actives',
    'ok', erreur is null and avant = apres and actives = 'encaissements_factures_gardes:O,encaissements_factures_taux_gardes:O',
    'observe', coalesce(erreur || ' — ', '') || avant || ' -> ' || apres || ' ; ' || coalesce(actives, '?'));
  perform set_config('essai.frontiere_seule', verdicts::text, true);
end
$essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.frontiere_seule')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^S?(\d+)'))[1]::int, v.controle;
