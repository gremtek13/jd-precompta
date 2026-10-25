-- LA RECOMPOSITION D'UN BLOC, CONFRONTÉE À LA COMPOSITION SOURCE PAR SOURCE (chantier EC-Q3, ligne 28.65, étape VF7b0 ;
-- migration `validation_des_ventes_facturees`) — SUR UNE RÉPLIQUE SEULEMENT, par le super-utilisateur, en une transaction
-- (`psql -1`) ; à rejouer après toute migration qui touche la règle du cumul (`calcul_vente_facturee`), la composition
-- (`ecriture_attendue_vente_facturee`, `montants_par_taux_facture`, `refus_compte_de_contrepartie`, `compte_du_role`,
-- `encaissement_justifie_son_mouvement`, `mouvement_libre`), la recomposition (`ecritures_attendues_de_la_periode`) ou le
-- jugement de la validation (`ventes_facturees_de_l_exercice`, étape VF7b).
--
-- `ecritures_attendues_de_la_periode` redit d'un bloc, pour toutes les sources d'une période, ce que la voie d'écriture de
-- VF4b recompose une source à la fois — la référence. Ce qui se prouve ici : sur des dossiers BASCULÉS tirés au hasard, en
-- trésorerie et en engagement, CHAQUE source rend, recomposée d'un bloc, exactement ce que `ecriture_attendue_vente_facturee`
-- rend pour elle — son motif, son détail, ses lignes —, sur toute leur histoire puis sur la période qui suit leur frontière ;
-- aucune source ne manque au bloc ; et le tirage rencontre chaque chemin (chaque motif d'une vente écartée, chaque motif
-- d'une source qui ne s'écrit pas, le 511, le 53 et le 627 d'un mouvement, la TVA en attente de l'engagement), un plancher
-- disant qu'un « zéro écart » n'est pas aveugle. Et le JUGEMENT DE LA VALIDATION (6, 7) : pour chaque dossier et chacun des
-- exercices 2025 et 2026, les sources en défaut que `ventes_facturees_de_l_exercice` rend, dans son ordre, sont celles
-- d'un jugement refait source par source sur la voie de VF4b — toutes les sources du dossier, et non celles que la
-- période retient —, et le tirage rencontre chacun des quatre états.
--
-- LE TIRAGE : `setseed(0.20261025)`, puis `random()`, identifiants compris — déterministe pour une version de
-- PostgreSQL (la réplique, 16 ; la production, 17 : le même générateur depuis la 15) : un tirage qui porte sur
-- plusieurs lignes les prend dans l'ordre de leurs identifiants (ou de leur contenu), jamais dans celui d'un parcours
-- de table, que le plan choisit, ni dans une sous-requête qu'il pourrait rejouer : l'un et l'autre ont fait varier le
-- tirage d'un jeu à l'autre ; quatre-vingts dossiers, chacun huit à quinze factures sources de services ou de biens
-- (une sans nature, une « mixte », une sans option pour les débits, une sans ligne, à leur rang de hasard), un à trois
-- taux par facture, des avoirs (dont certains annulent un taux entier), zéro à trois encaissements par facture par
-- chacun des huit moyens, répartis sur ses taux (quelques-uns illisibles ; pour une facture qui a un avoir, un sur
-- trois du jour même de l'avoir), certains retirés, des contre-passations (avec ou sans débit, quelques-unes illisibles
-- ou datées avant leur encaissement), des mouvements du même jour ou d'un autre, classés ou libres, seuls ou partagés
-- (une remise de chèques, un virement mixte avec une facture qui n'est pas source et zéro, un ou deux exemplaires), des
-- frais sous le seuil, autour de ses deux bornes (2 % et 5 €) et au-delà, des comptes de contrepartie absents, choisis
-- ou refusés ; un tiers des dossiers a son exercice 2025 validé, et un chèque du 30 décembre 2025 rattaché à un crédit
-- de janvier 2026 ; des écritures proposées — à jour, faussées d'un centime ou périmées — de factures, d'avoirs,
-- d'encaissements et de mouvements, et la banque de l'exemplaire d'une facture d'avant sur le mouvement que partage son
-- encaissement. Les déclencheurs sont suspendus le temps du semis (`session_replication_role`) : la confrontation porte
-- sur des états que les gardes refuseraient aussi, sans perte.
--
-- Tout se joue dans un bloc qui s'annule entièrement (`ANNULATION_ESSAI_GLOBALE`) ; les verdicts voyagent dans un réglage
-- local à la transaction (`essai.recomposition`), que la requête finale lit. Données FICTIVES : des dossiers jetables dans
-- le cabinet du dossier `test`, aucun nom, aucun libellé réel.
--
-- ÉPROUVÉ LE 25/10/2026 SUR UNE RÉPLIQUE (PostgreSQL 16 : la production du jour, munie de VF5h2, de VF7a et de la
-- migration), quatre fois — trois de suite sur la même base, que chaque jeu annulé laisse chargée de ses lignes mortes,
-- puis sur une copie fraîche —, les tables semées et les sorties identiques d'un jeu à l'autre : 1, 3 310 sources,
-- 0 écart ; 2, 2 729 sources, 0 écart ; 3, aucune manquante ; 4, les quatre genres, les treize motifs et l'absence de
-- motif ; 5, les dix comptes (411000, 445710, 445800, 467000, 511000, 512000, 530000, 627000, 706000, 707000) ; 6, 160
-- exercices, 2 872 sources en défaut, 0 écart ; 7, les quatre états ; 9, rien n'est resté. Ses mutations (la règle du
-- cumul et la composition d'un bloc, le jugement) : HISTORIQUE.md, « LA VALIDATION REFUSE LES MANQUES DES VENTES
-- FACTURÉES ».
do $essai$
declare
  cabinet uuid;
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  verdicts jsonb := '[]'::jsonb;
  avant text; apres text;
  d uuid; mode text; frontiere date;
  i int; j int; k int; n int;
  f uuid; a uuid; e uuid; m uuid; cp uuid; p uuid;
  emission date; jour date; jour_avoir date; taux_f numeric[]; t numeric; q numeric; prix numeric;
  nature text; debits boolean; prestation date; moyen text; compte text;
  montant numeric; reste numeric; part numeric; porte numeric;
  numero_f int; numero_a int;
  courant uuid; courant_montant numeric; courant_jour date;
  dossiers_essai uuid[] := '{}';
  encs_du_dossier uuid[];
  a_fausser uuid[];
  r record;
  compares int; ecarts int; premier text;
  compares_f int; ecarts_f int; premier_f text;
  manquantes int;
  motifs text[];
  genres text;
  lignes_vues text;
  periodes_jugees int; ecarts_j int; premier_j text; defauts_j int; etats text;
begin
  select cabinet_id into cabinet from dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24';
  if cabinet is null then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable';
  end if;
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from factures_emises),
                   (select count(*) from encaissements_factures), (select count(*) from lignes_bancaires),
                   (select count(*) from ecritures_brouillon)) into avant;

  begin
    -- La graine : tout ce qui suit en découle, jusqu'aux identifiants (`md5(random()::text)::uuid`), dont l'ordre décide
    -- de celui des boucles.
    perform setseed(0.20261025);
    -- Les dossiers, déclencheurs actifs (ils remplissent ce qu'un dossier porte de lui-même) ; puis le semis, sans eux.
    for i in 1..80 loop
      d := ('7f7b0b00-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
      dossiers_essai := dossiers_essai || d;
      insert into dossiers (id, nom, cabinet_id, mode_comptable, compte_notes_de_frais, ventes_par_les_factures)
      values (d, 'ESSAI RECOMPOSITION ' || i, cabinet, case when i % 2 = 0 then 'engagement' else 'tresorerie' end, '455000', true);
    end loop;
    perform set_config('session_replication_role', 'replica', true);

    foreach d in array dossiers_essai loop
      select dd.mode_comptable into mode from dossiers dd where dd.id = d;
      numero_f := 0; numero_a := 0; courant := null; encs_du_dossier := '{}';
      -- ── Les factures sources, leurs lignes, leurs avoirs, leurs encaissements ──
      for j in 1..(8 + floor(random() * 8))::int loop
        f := md5(random()::text)::uuid;
        emission := date '2025-06-01' + floor(random() * 390)::int;
        nature := case when random() < 0.70 then 'services' when random() < 0.85 then 'biens'
                       when random() < 0.5 then null else 'mixte' end;
        debits := case when nature = 'services' then case when random() < 0.12 then true when random() < 0.95 then false end
                       else random() < 0.5 end;
        prestation := case when random() < 0.45 then emission + (floor(random() * 60) - 20)::int end;
        numero_f := numero_f + 1;
        insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, montant_ht, montant_tva,
                                     montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits, date_prestation)
        values (f, d, 'F' || extract(year from emission)::int || '-' || lpad(numero_f::text, 4, '0'), 'validee', 'facture',
                emission, 'ESSAI', 0, 0, 0, now(), true, nature, debits, prestation);
        taux_f := '{}';
        if random() >= 0.03 then
          for k in 1..(1 + floor(random() * 3))::int loop
            t := (array[20, 20, 20, 10, 5.5, 2.1, 0])[1 + floor(random() * 7)::int];
            q := (array[1, 1, 2, 0.5, 3])[1 + floor(random() * 5)::int];
            prix := round((random() * 900 + 0.01)::numeric, 2);
            insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
            values (f, k, 'ESSAI', q, prix, t);
            if not t = any(taux_f) then taux_f := taux_f || t; end if;
          end loop;
        end if;
        -- Un avoir : une part d'un taux, ou le taux entier.
        jour_avoir := null;
        if cardinality(taux_f) > 0 and random() < 0.25 then
          a := md5(random()::text)::uuid;
          numero_a := numero_a + 1;
          jour := emission + floor(random() * 90)::int;
          insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, montant_ht, montant_tva,
                                       montant_ttc, validated_at, source_de_la_vente, facture_origine_id)
          values (a, d, 'A' || extract(year from jour)::int || '-' || lpad(numero_a::text, 4, '0'), 'validee', 'avoir', jour,
                  'ESSAI', 0, 0, 0, now(), true, f);
          jour_avoir := jour;
          select l.taux_tva, l.quantite, l.prix_unitaire_ht into t, q, prix from facture_lignes l where l.facture_id = f order by l.ordre limit 1;
          insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva)
          values (a, 1, 'ESSAI', -q, case when random() < 0.2 then prix else greatest(round(prix * (random() * 0.6 + 0.1)::numeric, 2), 0.01) end, t);
        end if;
        -- Les encaissements : un montant, réparti sur les taux de la facture ; quelques-uns illisibles.
        for k in 1..floor(random() * 4)::int loop
          e := md5(random()::text)::uuid;
          -- Un encaissement sur trois d'une facture qui a un avoir tombe le jour même de l'avoir : la règle du cumul compte
          -- l'avoir de ce jour-là (`date_emission <= date_encaissement`), et sans ce cas, rien ne le vérifiait.
          jour := case when jour_avoir is null then emission + (floor(random() * 90) - 10)::int
                       when random() < 0.34 then jour_avoir
                       else emission + (floor(random() * 90) - 10)::int end;
          moyen := (array['virement', 'virement', 'virement', 'cheque', 'cheque', 'carte', 'prelevement', 'especes', 'especes',
                          'effet', 'compensation', 'compensation', 'autre'])[1 + floor(random() * 13)::int];
          compte := case when moyen in ('compensation', 'autre') then
                      case when random() < 0.3 then null when random() < 0.75 then '467000' when random() < 0.5 then '411000'
                           else '512000' end end;
          montant := round((random() * 500 + 1)::numeric, 2);
          insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, cree_le, retire_le,
                                              compte_contrepartie)
          values (e, d, f, jour, montant, moyen, (jour + time '09:00') + floor(random() * 600) * interval '1 minute',
                  case when random() < 0.08 then now() end, compte);
          reste := montant;
          if cardinality(taux_f) = 0 then
            insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (e, d, 20, montant);
          else
            for n in 1..cardinality(taux_f) loop
              part := case when n = cardinality(taux_f) then reste
                           else greatest(round(reste * (random() * 0.8 + 0.1)::numeric, 2), 0.01) end;
              if part >= reste and n < cardinality(taux_f) then part := reste; end if;
              exit when part <= 0;
              insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
              values (e, d, taux_f[n], part + case when random() < 0.03 then 0.01 else 0 end);
              reste := reste - part;
              exit when reste <= 0;
            end loop;
          end if;
          encs_du_dossier := encs_du_dossier || e;
          -- Son mouvement : du même jour ou d'un autre, partagé parfois avec le précédent (une remise).
          if moyen in ('virement', 'cheque', 'carte', 'prelevement', 'effet', 'especes') and random() < 0.7 then
            if courant is not null and random() < 0.25 then
              update encaissements_factures set ligne_bancaire_id = courant where id = e;
            else
              courant := md5(random()::text)::uuid;
              insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, encaissements_de_factures)
              values (courant, d, jour + case when random() < 0.6 then 0 else (1 + floor(random() * 5))::int end, 'ESSAI', 0,
                      'non_rapprochee', false);
              update encaissements_factures set ligne_bancaire_id = courant where id = e;
            end if;
          end if;
        end loop;
      end loop;

      -- ── Deux factures qui ne sont pas sources (d'avant la bascule), chacune encaissée sur un mouvement partagé ; zéro,
      -- un ou deux exemplaires ──
      for j in 1..2 loop
        f := md5(random()::text)::uuid;
        numero_f := numero_f + 1;
        insert into factures_emises (id, dossier_id, numero, statut, type, date_emission, tiers_nom, montant_ht, montant_tva,
                                     montant_ttc, validated_at, source_de_la_vente, nature_operation, option_debits)
        values (f, d, 'F2025-' || lpad(numero_f::text, 4, '0'), 'validee', 'facture', date '2025-05-01', 'ESSAI', 0, 0, 0, now(),
                false, 'services', false);
        insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values (f, 1, 'ESSAI', 1, 50, 20);
        for k in 1..(case when j = 1 then 1 when random() < 0.5 then 0 else 2 end) loop
          insert into pieces (id, dossier_id, storage_path, nom_fichier, type_piece, statut, facture_id)
          values (md5(random()::text)::uuid, d, d::text || '/essai-recomposition-' || f::text || '-' || k || '.pdf', 'essai.pdf', 'vente',
                  'validee', f);
        end loop;
        select z.id into m
          from (select l.id, random() as tirage from lignes_bancaires l where l.dossier_id = d order by l.id) z
         order by z.tirage limit 1;
        if m is not null then
          e := md5(random()::text)::uuid;
          insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_le)
          values (e, d, f, (select l.date from lignes_bancaires l where l.id = m), 60, 'virement', m, now());
          insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (e, d, 20, 60);
        end if;
      end loop;

      -- ── Les contre-passations : le miroir d'un encaissement, avec ou sans débit ; quelques-unes illisibles ──
      for r in select x.id, x.facture_id, x.date_encaissement, x.montant, x.moyen
                 from encaissements_factures x
                where x.dossier_id = d and x.annule_id is null and x.retire_le is null and x.id = any(encs_du_dossier)
                order by x.id loop
        continue when random() >= 0.12;
        cp := md5(random()::text)::uuid;
        jour := r.date_encaissement + case when random() < 0.08 then -5 else floor(random() * 30)::int end;
        insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, annule_id, motif, cree_le)
        values (cp, d, r.facture_id, jour, -r.montant, r.moyen, r.id, 'ESSAI', (jour + time '18:00'));
        insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant)
        select cp, d, x.taux, -x.montant - case when random() < 0.05 then 0.01 else 0 end
          from encaissements_factures_taux x where x.encaissement_id = r.id
         order by x.taux;
        if random() < 0.4 then
          m := md5(random()::text)::uuid;
          insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, encaissements_de_factures)
          values (m, d, jour, 'ESSAI', -r.montant, case when random() < 0.7 then 'rapprochee' else 'non_rapprochee' end, false);
          update lignes_bancaires set encaissements_de_factures = (statut = 'rapprochee') where id = m;
          update encaissements_factures set ligne_bancaire_id = m where id = cp;
        end if;
      end loop;

      -- ── Les mouvements : leur montant (ce qu'ils portent, moins des frais), classés ou libres ──
      for r in select l.id from lignes_bancaires l where l.dossier_id = d and l.montant = 0 order by l.id loop
        porte := coalesce((select sum(x.montant) from encaissements_factures x where x.ligne_bancaire_id = r.id), 0);
        -- Les frais : aucuns, moins de 2 €, entre 1 et 3 % de ce qu'il porte mais pas plus de 4 à 6 € (les deux bornes du
        -- seuil, ses 2 % et ses 5 €, de part et d'autre), ou plus de 5 €.
        update lignes_bancaires l
           set montant = porte - case when random() < 0.55 then 0 when random() < 0.45 then round((random() * 2)::numeric, 2)
                                      when random() < 0.5 then least(round(porte * (0.01 + random() * 0.02)::numeric, 2),
                                                                     round((4 + random() * 2)::numeric, 2))
                                      else round((random() * 20 + 5.01)::numeric, 2) end
         where l.id = r.id;
        if random() < 0.8 then
          update lignes_bancaires set statut = 'rapprochee', encaissements_de_factures = true where id = r.id;
        end if;
      end loop;

      -- ── Un tiers des dossiers : l'exercice 2025 validé, et le chèque du 30 décembre rattaché au crédit de janvier ──
      if (select count(*) from unnest(dossiers_essai) z where z <= d) % 3 = 0 then
        select x.id into f from factures_emises x where x.dossier_id = d and x.source_de_la_vente and x.type = 'facture'
                                                     and x.nature_operation = 'services' and x.option_debits = false
                                                     and exists (select 1 from facture_lignes l where l.facture_id = x.id and l.taux_tva = 20)
          order by x.id limit 1;
        if f is not null then
          e := md5(random()::text)::uuid; m := md5(random()::text)::uuid;
          insert into lignes_bancaires (id, dossier_id, date, libelle, montant, statut, encaissements_de_factures)
          values (m, d, date '2026-01-04', 'ESSAI', 24, 'rapprochee', true);
          insert into encaissements_factures (id, dossier_id, facture_id, date_encaissement, montant, moyen, ligne_bancaire_id, cree_le)
          values (e, d, f, date '2025-12-30', 24, 'cheque', m, now());
          insert into encaissements_factures_taux (encaissement_id, dossier_id, taux, montant) values (e, d, 20, 24);
        end if;
        insert into exercices_valides (dossier_id, annee, valide_le, valide_par, mode_comptable, nb_lignes, nb_ecritures, total_debit,
                                       total_credit, empreinte, declaration)
        values (d, 2025, now(), chef, mode, 0, 0, 0, 0, repeat('a', 64), case when mode = 'tresorerie' then '{}'::jsonb end);
      end if;

      -- ── Des écritures proposées : à jour pour une source sur cinq (facture, avoir, encaissement, mouvement), faussées
      -- d'un centime sur une ligne sur dix, la ligne périmée d'un encaissement retiré, et la banque de l'exemplaire d'une
      -- facture d'avant sur le mouvement que partage son encaissement (une ligne d'une pièce, pas une ligne propre du
      -- mouvement) ──
      insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, facture_id, encaissement_id)
      select d, nullif(split_part(x, '|', 5), '')::uuid, split_part(x, '|', 1)::date, split_part(x, '|', 2), 'ESSAI',
             split_part(x, '|', 4)::numeric / 100, split_part(x, '|', 3), 'proposee',
             case when s.genre in ('facture', 'avoir') then s.id end, case when s.genre = 'encaissement' then s.id end
        from (select z.genre, z.id
                from (select case when x.type = 'avoir' then 'avoir' else 'facture' end as genre, x.id, random() as tirage
                        from factures_emises x where x.dossier_id = d order by x.id) z
               where z.tirage < 0.2
              union all
              select 'encaissement', z.id
                from (select x.id, random() as tirage from encaissements_factures x where x.dossier_id = d order by x.id) z
               where z.tirage < 0.2
              union all
              select 'mouvement', z.id
                from (select x.id, random() as tirage from lignes_bancaires x where x.dossier_id = d order by x.id) z
               where z.tirage < 0.2) s
        cross join lateral unnest((ecriture_attendue_vente_facturee(d, s.genre, s.id)).lignes) x;
      -- (L'identifiant d'une écriture est tiré par la base : l'ordre est celui de son contenu, que la composition rend
      -- sans doublon. Et le tirage se fait d'une requête, dans un tableau : dans une sous-requête `in (…)`, le plan
      -- pourrait la rejouer pour chaque ligne, et `random()` avec elle.)
      select coalesce(array_agg(z.id), '{}') into a_fausser
        from (select b.id, random() as tirage from ecritures_brouillon b
               where b.dossier_id = d and b.statut = 'proposee'
               order by b.date, b.compte collate "C", b.sens, b.montant, b.ligne_bancaire_id, b.facture_id,
                        b.encaissement_id) z
       where z.tirage < 0.1;
      update ecritures_brouillon w set montant = w.montant + 0.01 where w.id = any(a_fausser);
      insert into ecritures_brouillon (dossier_id, date, compte, libelle, montant, sens, statut, encaissement_id)
      select d, x.date_encaissement, '706000', 'ESSAI', 1, 'credit', 'proposee', x.id
        from (select y.id, y.date_encaissement, random() as tirage
                from encaissements_factures y where y.dossier_id = d and y.retire_le is not null order by y.id) x
       where x.tirage < 0.5;
      insert into ecritures_brouillon (dossier_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut, piece_id)
      select d, x.ligne_bancaire_id, l.date, '512000', 'ESSAI', x.montant, 'debit', 'proposee', pc.id
        from encaissements_factures x
        join factures_emises y on y.id = x.facture_id and not y.source_de_la_vente
        join lignes_bancaires l on l.id = x.ligne_bancaire_id
        cross join lateral (select z.id from pieces z where z.facture_id = y.id order by z.id limit 1) pc
       where x.dossier_id = d;
    end loop;
    perform set_config('session_replication_role', 'origin', true);

    -- ══ 1. Chaque source, sur toute son histoire : la recomposition d'un bloc rend ce que la composition de VF4b rend ══
    select count(*), count(*) filter (where (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)),
           min(case when (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)
                    then b.genre || ' ' || b.source_id || ' : bloc ' || coalesce(b.motif, '∅') || ' ' || array_to_string(b.lignes, ' ')
                         || ' ; VF4b ' || coalesce(c.motif, '∅') || ' ' || array_to_string(c.lignes, ' ') end)
      into compares, ecarts, premier
      from unnest(dossiers_essai) z(dossier)
      cross join lateral ecritures_attendues_de_la_periode(z.dossier, null, date '9999-12-31') b
      cross join lateral ecriture_attendue_vente_facturee(z.dossier, b.genre, b.source_id) c;
    verdicts := verdicts || jsonb_build_object('controle', '1. toute leur histoire : chaque source, recomposée d''un bloc, rend ce que la composition de VF4b rend',
      'observe', compares || ' sources, ' || ecarts || ' écart(s)' || coalesce(' — le premier : ' || premier, ''),
      'ok', ecarts = 0 and compares >= 3000);

    -- ══ 2. La période qui suit la frontière de chaque dossier, jusqu'au 31 décembre 2026 : de même ══
    select count(*), count(*) filter (where (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)),
           min(case when (b.motif, b.detail, b.lignes) is distinct from (c.motif, c.detail, c.lignes)
                    then b.genre || ' ' || b.source_id end)
      into compares_f, ecarts_f, premier_f
      from unnest(dossiers_essai) z(dossier)
      cross join lateral ecritures_attendues_de_la_periode(z.dossier, frontiere_validation(z.dossier), date '2026-12-31') b
      cross join lateral ecriture_attendue_vente_facturee(z.dossier, b.genre, b.source_id) c;
    verdicts := verdicts || jsonb_build_object('controle', '2. après la frontière : de même, sur les sources de la période',
      'observe', compares_f || ' sources, ' || ecarts_f || ' écart(s)' || coalesce(' — la première : ' || premier_f, ''),
      'ok', ecarts_f = 0 and compares_f > 0 and compares_f < compares);

    -- ══ 3. Aucune source ne manque au bloc ══
    select count(*) into manquantes
      from (select x.dossier_id, case when x.type = 'avoir' then 'avoir' else 'facture' end as genre, x.id
              from factures_emises x where x.dossier_id = any(dossiers_essai) and x.statut = 'validee' and x.source_de_la_vente
            union
            select x.dossier_id, 'encaissement', x.id
              from encaissements_factures x join factures_emises y on y.id = x.facture_id
             where x.dossier_id = any(dossiers_essai) and y.source_de_la_vente
            union
            select l.dossier_id, 'mouvement', l.id
              from lignes_bancaires l
             where l.dossier_id = any(dossiers_essai) and (l.encaissements_de_factures or mouvement_libre(l))
               and exists (select 1 from encaissements_factures x join factures_emises y on y.id = x.facture_id
                            where x.ligne_bancaire_id = l.id and y.source_de_la_vente)
            except
            select z.dossier, b.genre, b.source_id
              from unnest(dossiers_essai) z(dossier)
              cross join lateral ecritures_attendues_de_la_periode(z.dossier, null, date '9999-12-31') b) w;
    verdicts := verdicts || jsonb_build_object('controle', '3. aucune source ne manque au bloc',
      'observe', manquantes || ' manquante(s)', 'ok', manquantes = 0);

    -- ══ 4. Le tirage rencontre chaque chemin ══
    select array_agg(distinct coalesce(b.motif, '∅') || coalesce('(' || case when b.motif = 'vente_ecartee' then b.detail end || ')', '')
                     order by coalesce(b.motif, '∅') || coalesce('(' || case when b.motif = 'vente_ecartee' then b.detail end || ')', '')),
           string_agg(distinct b.genre, ',' order by b.genre)
      into motifs, genres
      from unnest(dossiers_essai) z(dossier)
      cross join lateral ecritures_attendues_de_la_periode(z.dossier, null, date '9999-12-31') b;
    verdicts := verdicts || jsonb_build_object('controle', '4. chaque motif est rencontré, et chaque genre de source',
      'observe', genres || ' | ' || array_to_string(motifs, ' '),
      'ok', genres = 'avoir,encaissement,facture,mouvement'
        and motifs @> array['∅', 'compte_a_choisir', 'compte_refuse', 'mouvement_ecart', 'mouvement_facture_non_source',
                            'mouvement_non_classe', 'mouvement_vente_ecartee', 'vente_ecartee(contre_passation_illisible)',
                            'vente_ecartee(encaissement_illisible)', 'vente_ecartee(nature)', 'vente_ecartee(option_debits)',
                            'vente_ecartee(sans_lignes)', 'vente_ecartee(ttc_nul)']);
    select string_agg(distinct split_part(x, '|', 2), ',' order by split_part(x, '|', 2))
      into lignes_vues
      from unnest(dossiers_essai) z(dossier)
      cross join lateral ecritures_attendues_de_la_periode(z.dossier, null, date '9999-12-31') b
      cross join lateral unnest(b.lignes) x;
    verdicts := verdicts || jsonb_build_object('controle', '5. chaque compte de la composition est écrit',
      'observe', lignes_vues,
      'ok', string_to_array(lignes_vues, ',') @> array['411000', '445710', '445800', '467000', '511000', '512000', '530000', '627000', '706000', '707000']);

    -- ══ 6. Le jugement de la validation (étape VF7b) : `ventes_facturees_de_l_exercice`, confronté à la voie de VF4b ══
    -- Pour chaque dossier et chacun des exercices 2025 et 2026, les sources en défaut que la fonction rend — genre, jour,
    -- état, motif et détail, dans son ordre — sont celles d'un jugement refait ici, source par source : TOUTES les sources
    -- du dossier, quelle que soit leur date (et non celles que la période retient), recomposées par
    -- `ecriture_attendue_vente_facturee`, leurs lignes de la période (de la frontière, exclue, au 31 décembre) comparées en
    -- multiensemble à leurs lignes proposées de la période ; une source qui ne s'écrit pas, en défaut quand sa date y tombe.
    with univers as materialized (
      select z.dossier, s.genre, s.id, s.jour_source, c.motif, c.detail, c.lignes
        from unnest(dossiers_essai) z(dossier)
        cross join lateral (
          select case when x.type = 'avoir' then 'avoir' else 'facture' end as genre, x.id, x.date_emission as jour_source
            from factures_emises x where x.dossier_id = z.dossier and x.statut = 'validee' and x.source_de_la_vente
          union all
          select 'encaissement', x.id, x.date_encaissement
            from encaissements_factures x join factures_emises y on y.id = x.facture_id
           where x.dossier_id = z.dossier and y.source_de_la_vente
          union all
          select 'mouvement', l.id, l.date
            from lignes_bancaires l
           where l.dossier_id = z.dossier and (l.encaissements_de_factures or mouvement_libre(l))
             and exists (select 1 from encaissements_factures x join factures_emises y on y.id = x.facture_id
                          where x.ligne_bancaire_id = l.id and y.source_de_la_vente)) s
        cross join lateral ecriture_attendue_vente_facturee(z.dossier, s.genre, s.id) c
    ),
    periodes as (
      select z.dossier, y.annee, frontiere_validation(z.dossier) as frontiere, make_date(y.annee, 12, 31) as fin
        from unnest(dossiers_essai) z(dossier) cross join (values (2025), (2026)) y(annee)
    ),
    jugees as (
      select pe.dossier, pe.annee, pe.frontiere, pe.fin, u.genre, u.id, u.jour_source, u.motif, u.detail,
             coalesce((select array_agg(ww.texte order by ww.texte collate "C") from unnest(u.lignes) ww(texte)
                        where split_part(ww.texte, '|', 1)::date <= pe.fin
                          and (pe.frontiere is null or split_part(ww.texte, '|', 1)::date > pe.frontiere)), '{}') as attendu,
             coalesce((select array_agg(qq.x order by qq.x collate "C")
                         from (select to_char(b.date, 'YYYY-MM-DD') || '|' || b.compte || '|' || b.sens || '|'
                                      || (b.montant * 100)::bigint || '|' || coalesce(b.ligne_bancaire_id::text, '') as x
                                 from ecritures_brouillon b
                                where b.dossier_id = pe.dossier and b.statut = 'proposee' and b.date <= pe.fin
                                  and (pe.frontiere is null or b.date > pe.frontiere)
                                  and case u.genre
                                        when 'encaissement' then b.encaissement_id = u.id
                                        when 'mouvement' then b.ligne_bancaire_id = u.id and b.facture_id is null
                                          and b.encaissement_id is null and b.piece_id is null and b.immobilisation_id is null
                                          and b.vehicule_id is null and b.declaration_tva_id is null and b.cotisation_id is null
                                        else b.facture_id = u.id end) qq), '{}') as propose
        from periodes pe join univers u on u.dossier = pe.dossier
    ),
    reference as (
      select ju.dossier, ju.annee, ju.genre, ju.id, ju.motif, ju.detail,
             case when ju.attendu is distinct from ju.propose
                  then (select min(split_part(dd.x, '|', 1)::date)
                          from ((select unnest(ju.attendu) except all select unnest(ju.propose))
                                union all
                                (select unnest(ju.propose) except all select unnest(ju.attendu))) dd(x))
                  else ju.jour_source end as jour,
             case when ju.attendu = ju.propose then 'ne_s_ecrit_pas' when cardinality(ju.propose) = 0 then 'a_ecrire'
                  when cardinality(ju.attendu) = 0 then 'a_retirer' else 'a_reecrire' end as etat
        from jugees ju
       where ju.attendu is distinct from ju.propose
          or ju.motif is not null and ju.jour_source <= ju.fin and (ju.frontiere is null or ju.jour_source > ju.frontiere)
    ),
    par_periode as (
      select pe.dossier, pe.annee,
             (select string_agg(v.source || '|' || v.source_id || '|' || v.jour || '|' || v.etat || '|' || coalesce(v.motif, '')
                                || '|' || coalesce(v.detail, ''), ' ; ' order by v.o)
                from ventes_facturees_de_l_exercice(pe.dossier, pe.annee) with ordinality v(source, source_id, jour, etat, motif, detail, nom, o)) as fonction,
             (select string_agg(re.genre || '|' || re.id || '|' || re.jour || '|' || re.etat || '|' || coalesce(re.motif, '')
                                || '|' || coalesce(re.detail, ''), ' ; '
                                order by re.jour, case re.genre when 'facture' then 0 when 'avoir' then 1 when 'encaissement' then 2 else 3 end, re.id)
                from reference re where re.dossier = pe.dossier and re.annee = pe.annee) as refait,
             (select count(*) from reference re where re.dossier = pe.dossier and re.annee = pe.annee) as n
        from periodes pe
    )
    select count(*), count(*) filter (where pf.fonction is distinct from pf.refait), sum(pf.n),
           min(case when pf.fonction is distinct from pf.refait then pf.dossier || ' ' || pf.annee || ' : fonction ' || coalesce(pf.fonction, '∅')
                    || ' ; refait ' || coalesce(pf.refait, '∅') end),
           (select string_agg(distinct re.etat, ',' order by re.etat) from reference re)
      into periodes_jugees, ecarts_j, defauts_j, premier_j, etats
      from par_periode pf;
    verdicts := verdicts || jsonb_build_object('controle', '6. le jugement de la validation : chaque exercice de chaque dossier, la fonction rend les sources en défaut d''un jugement refait source par source (étape VF7b)',
      'observe', periodes_jugees || ' exercices, ' || defauts_j || ' sources en défaut, ' || ecarts_j || ' écart(s)'
        || coalesce(' — le premier : ' || left(premier_j, 600), ''),
      'ok', ecarts_j = 0 and periodes_jugees = 160 and defauts_j >= 500);
    verdicts := verdicts || jsonb_build_object('controle', '7. … et le tirage rencontre chaque état',
      'observe', etats, 'ok', etats = 'a_ecrire,a_reecrire,a_retirer,ne_s_ecrit_pas');

    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception when others then
    if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then
      verdicts := verdicts || jsonb_build_object('controle', '0. le déroulé de l''essai', 'observe', sqlstate || ' ' || sqlerrm, 'ok', false);
    end if;
  end;

  -- ══ 9. Rien n'est resté ══
  select concat_ws('/', (select count(*) from dossiers), (select count(*) from factures_emises),
                   (select count(*) from encaissements_factures), (select count(*) from lignes_bancaires),
                   (select count(*) from ecritures_brouillon)) into apres;
  verdicts := verdicts || jsonb_build_object('controle', '9. rien n''est resté en base', 'observe', avant || ' -> ' || apres,
    'ok', avant = apres and current_setting('session_replication_role') = 'origin');
  perform set_config('essai.recomposition', verdicts::text, true);
end $essai$;

select v.controle, v.ok, v.observe
from jsonb_to_recordset(current_setting('essai.recomposition')::jsonb) as v(controle text, ok boolean, observe text)
order by (regexp_match(v.controle, '^(\d+)'))[1]::int, v.controle;
