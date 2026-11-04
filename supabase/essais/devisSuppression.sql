-- LES DEVIS DEVANT UNE SUPPRESSION (espace client, étape P5 ; migrations `devis_du_client` et
-- `devis_du_client_suppression`) — SUR UNE RÉPLIQUE SEULEMENT : l'outil d'exécution de la production soumet toute
-- suppression à une confirmation qui n'arrive pas, et l'appel expire. Le compagnon de `devis.sql`, à rejouer avec lui,
-- après toute migration qui touche `devis`, `devis_factures`, `devis_numerotation`, leurs gardes (`garder_devis`,
-- `garder_devis_facture`), `supprimer_brouillon_devis`, `facturer_devis`, `supprimer_brouillon_facture` ou les clés qui
-- les lient aux dossiers et aux factures. Avant les migrations, il le dit (ESSAI_IMPOSSIBLE) et n'écrit rien.
--
-- Ce qui se prouve ici, et ne se relit pas :
--   - un devis émis ne se supprime pas directement, ni par le propriétaire de la base (sa garde) ni par le cabinet
--     (aucune policy : aucune ligne touchée) ; un brouillon, le propriétaire le peut — la garde ne retient que l'émis ;
--   - le lien d'un devis à sa facture ne se supprime pas directement, ni par le propriétaire (sa garde) ni par le
--     cabinet (aucune policy) ;
--   - un brouillon se supprime par `supprimer_brouillon_devis`, après ses trois refus dans l'ordre : l'accès (42501)
--     avant « introuvable » (P0002), « introuvable » avant « émis » (22023) ;
--   - le lien part avec le brouillon de la facture supprimé (`supprimer_brouillon_facture`), et le devis se transforme
--     de nouveau ;
--   - la suppression du dossier emporte ses devis — émis et acceptés compris —, leurs liens, sa série et ses factures.
--
-- Le moteur d'étapes de `devis.sql` (`jeu`, `controle`, `fait`, `valeur`, `mutation`), dans deux dossiers JETABLES du
-- cabinet du chef, aux identifiants FIXES (préfixe `e55d5000`), au sein d'un bloc qui s'annule entièrement à la fin ;
-- chaque contrôle dans sa sous-transaction, annulée elle aussi. Un ordre qui insère, modifie ou supprime sans `returning`
-- s'exécute sans rien rendre. Le fichier se joue en UNE transaction (`psql -1`), sous le rôle qui tient la place du
-- propriétaire des tables (`proprietaire`).
--
-- Une garde de tête, la première instruction du bloc, refuse de le jouer hors d'une réplique (ESSAI_HORS_REPLIQUE), avant
-- toute écriture : le rôle `proprietaire` manque à la production (comme `caisseSuppression.sql`, AUDIT-Q1).
--
-- 04/11/2026 — ÉCRIT ET JOUÉ SUR UNE RÉPLIQUE DE LA PRODUCTION À 171 MIGRATIONS, LES DEUX MIGRATIONS DES DEVIS APPLIQUÉES
-- SOUS `proprietaire` (elles attendent l'accord du cabinet) : 22 verdicts, 0 en faute, 2 mutations sur 2 qui mordent,
-- rien resté ; sans elles, ESSAI_IMPOSSIBLE, rien d'écrit. Quatre mutations des migrations y virent au rouge, chacune sur
-- une copie neuve, que `devis.sql` laisse toutes passer : la garde qui laisserait supprimer un devis émis (1), celle qui
-- laisserait supprimer un lien (4), celle qui retiendrait un devis émis devant la suppression de son dossier (15), la
-- série sans `on delete cascade` (15).
do $essai$
declare
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  inconnu uuid := gen_random_uuid();
  cabinet uuid;
  ids jsonb;
  avant text; apres text;
  s record; k text; ordre text; partie text; attendu text; rendu text; accepte boolean; code_recu text; message text; ok boolean;
  erreur text;
  verdicts jsonb := '[]'::jsonb;
begin
  -- La garde de tête : sur une réplique seulement, avant toute écriture.
  if not exists (select 1 from pg_roles where rolname = 'proprietaire') then
    raise exception 'ESSAI_HORS_REPLIQUE : cet essai supprime des lignes et ne se joue que sur une réplique ; le rôle proprietaire, que toute réplique porte, est absent : rien n''est écrit.';
  end if;
  if to_regclass('public.devis') is null
     or to_regprocedure('public.supprimer_brouillon_devis(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les migrations devis_du_client et devis_du_client_suppression ne sont pas en base';
  end if;
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or not exists (select 1 from super_admins where user_id = chef) then
    raise exception 'ESSAI_IMPOSSIBLE : le chef du cabinet de l''essai est introuvable, ou n''est pas super-administrateur';
  end if;

  ids := jsonb_build_object('CHEF', chef, 'CAB', cabinet, 'DS', 'e55d5000-0000-4000-8000-0000000000a1',
    'DT', 'e55d5000-0000-4000-8000-0000000000b1', 'INCONNUE', gen_random_uuid());

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from devis)), ((select count(*) from devis_numerotation)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes))
  ) as t(n);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, ordre(s), code attendu ou OK, message ou valeur attendus, clé) — comme devis.sql ;
      -- qui : anon, inconnu, chef, proprietaire.
      ('j1', 'jeu', 'dossiers jetables S et T', 'proprietaire',
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva) values
          ('{DS}', 'ESSAI DEVIS SUPPRESSION S', '{CAB}', 'redevable', true), ('{DT}', 'ESSAI DEVIS SUPPRESSION T', '{CAB}', 'redevable', true)$q$, 'OK', null, null),
      ('f1', 'fait', 'le chef émet DE dans S : D2026-0001', 'chef',
        $q$select devis_id::text from enregistrer_devis('{DS}', null, '{"tiers_nom":"ESSAI SUPPRESSION","date_emission":"2026-09-15","date_validite":"2026-10-15","montant_ht":100,"montant_tva":20,"montant_ttc":120,"emetteur_nom":"ESSAI SUPPRESSION S"}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, true)$q$,
        'OK', null, 'DE'),
      ('f2', 'fait', 'le chef enregistre l''acceptation de DE', 'chef',
        $q$select reponse from decider_devis('{DS}', '{DE}', 'acceptee', '2026-09-20', false)$q$, 'OK', 'acceptee', null),
      ('f3', 'fait', 'le chef transforme DE en facture : le brouillon FDE', 'chef',
        $q$select facturer_devis('{DS}', '{DE}')::text$q$, 'OK', null, 'FDE'),
      ('f4', 'fait', 'le chef crée le brouillon DBR dans S', 'chef',
        $q$select devis_id::text from enregistrer_devis('{DS}', null, '{"tiers_nom":"ESSAI SUPPRESSION BROUILLON","date_emission":"2026-09-16","date_validite":"2026-10-16","montant_ht":100,"montant_tva":20,"montant_ttc":120}'::jsonb, '[{"designation":"essai","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}]'::jsonb, false)$q$,
        'OK', null, 'DBR'),

      -- ══ 1. Un devis émis ne se supprime pas directement ══════════
      ('1', 'controle', 'le propriétaire de la base ne supprime pas un devis émis : la garde', 'proprietaire',
        $q$delete from devis where id = '{DE}'$q$, '23514', 'Le devis D2026-0001 est émis : il ne se supprime plus.', null),
      ('2', 'controle', 'le chef non plus, en direct : aucune policy de suppression, aucune ligne touchée', 'chef',
        $q$with u as (delete from devis where id = '{DE}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('3', 'controle', 'ni un brouillon, en direct', 'chef',
        $q$with u as (delete from devis where id = '{DBR}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),
      ('M1', 'mutation', 'le contrôle 1 rejoué sur le brouillon : la garde ne retient que l''émis', 'proprietaire',
        $q$with u as (delete from devis where id = '{DBR}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),

      -- ══ 2. Le lien d'un devis à sa facture ne se supprime pas directement ══════════
      ('4', 'controle', 'le propriétaire ne supprime pas le lien de DE à sa facture : la garde', 'proprietaire',
        $q$delete from devis_factures where facture_id = '{FDE}'$q$,
        '23514', 'Le lien d''un devis à sa facture ne part qu''avec la facture, le devis ou le dossier.', null),
      ('5', 'controle', 'le chef non plus, en direct : aucune policy de suppression, aucune ligne touchée', 'chef',
        $q$with u as (delete from devis_factures where facture_id = '{FDE}' returning 1) select count(*)::text from u$q$, 'OK', '0', null),

      -- ══ 3. Un brouillon se supprime par sa fonction, après ses trois refus dans l'ordre ══════════
      ('6', 'controle', 'l''anonyme n''exécute pas supprimer_brouillon_devis', 'anon',
        $q$select supprimer_brouillon_devis('{DS}', '{DBR}')::text$q$, '42501', 'permission denied for function supprimer_brouillon_devis', null),
      ('7', 'controle', 'ORDRE : un compte rattaché à rien, sur un devis émis d''un autre dossier : l''accès d''abord', 'inconnu',
        $q$select supprimer_brouillon_devis('{DT}', '{DE}')::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('8', 'controle', 'ORDRE : le devis émis de S annoncé dans T : introuvable, avant « émis »', 'chef',
        $q$select supprimer_brouillon_devis('{DT}', '{DE}')::text$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('9', 'controle', 'un devis émis ne se supprime pas par la fonction', 'chef',
        $q$select supprimer_brouillon_devis('{DS}', '{DE}')::text$q$, '22023', 'Le devis D2026-0001 est émis : il ne se supprime plus.', null),
      ('10', 'controle', 'le brouillon se supprime par la fonction, qui rend son identifiant', 'chef',
        $q$select (supprimer_brouillon_devis('{DS}', '{DBR}') = '{DBR}')::text §§ select count(*)::text from devis where id = '{DBR}'$q$, 'OK', '0', null),

      -- ══ 4. Le lien part avec le brouillon de la facture ; le devis se transforme de nouveau ══════════
      ('11', 'fait', 'le chef supprime le brouillon FDE', 'chef',
        $q$select 'supprimé' from supprimer_brouillon_facture('{DS}', '{FDE}')$q$, 'OK', 'supprimé', null),
      ('12', 'valeur', 'le lien est parti avec lui, le devis est resté', 'proprietaire',
        $q$select (select count(*) from devis_factures where devis_id = '{DE}') || '/' || (select count(*) from devis where id = '{DE}')$q$, 'OK', '0/1', null),
      ('13', 'fait', 'le chef transforme DE de nouveau : le brouillon FDE2', 'chef',
        $q$select facturer_devis('{DS}', '{DE}')::text$q$, 'OK', null, 'FDE2'),
      ('14', 'valeur', 'un lien, vers FDE2', 'proprietaire',
        $q$select string_agg((facture_id = '{FDE2}')::text, ',') from devis_factures where devis_id = '{DE}'$q$, 'OK', 'true', null),

      -- ══ 5. La suppression du dossier emporte tout ══════════
      ('15', 'controle', 'le dossier S supprimé emporte ses devis (émis et accepté compris), leurs liens, sa série et ses factures', 'proprietaire',
        $q$select (select count(*) from devis where dossier_id = '{DS}') || '/' || (select count(*) from devis_factures where dossier_id = '{DS}')
             || '/' || (select count(*) from devis_numerotation where dossier_id = '{DS}') || '/' || (select count(*) from factures_emises where dossier_id = '{DS}')
           §§ delete from dossiers where id = '{DS}'
           §§ select (select count(*) from devis where dossier_id = '{DS}') || '/' || (select count(*) from devis_factures where dossier_id = '{DS}')
             || '/' || (select count(*) from devis_numerotation where dossier_id = '{DS}') || '/' || (select count(*) from factures_emises where dossier_id = '{DS}')$q$,
        'OK', '0/0/0/0', null),
      ('M2', 'mutation', 'le contrôle 15 sans la suppression : les deux devis, le lien, la série et la facture sont là', 'proprietaire',
        $q$select (select count(*) from devis where dossier_id = '{DS}') || '/' || (select count(*) from devis_factures where dossier_id = '{DS}')
             || '/' || (select count(*) from devis_numerotation where dossier_id = '{DS}') || '/' || (select count(*) from factures_emises where dossier_id = '{DS}')$q$,
        'OK', '2/1/1/1', null)
    ) as x(num, genre, controle, qui, ordre, code, attendu, cle)
    loop
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        if s.qui = 'anon' then
          set local role anon;
          perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
        elsif s.qui in ('inconnu', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'inconnu' then inconnu else chef end, 'role', 'authenticated')::text, true);
        else
          -- Le propriétaire : sans session, `auth.uid()` est nul.
          perform set_config('request.jwt.claims', '', true);
        end if;
        foreach partie in array string_to_array(ordre, '§§') loop
          partie := replace(partie, '{RENDU}', coalesce(rendu, ''));
          if partie ~* '^\s*(insert|update|delete)' and partie !~* 'returning' then
            execute partie;
          else
            execute partie into rendu;
          end if;
        end loop;
        accepte := true;
        if s.genre in ('controle', 'mutation', 'valeur') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if s.cle is not null and accepte and rendu is not null then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
                                and (s.cle is null or rendu is not null)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', ok);
      end if;
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from devis)), ((select count(*) from devis_numerotation)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes))
  ) as t(n);
  -- L'écart seul, jamais les comptes de toute la base.
  verdicts := verdicts || jsonb_build_object('controle', '99. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.devis_suppression', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.devis_suppression')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, (regexp_match(v.controle, '^M?(\d+)'))[1]::int, v.controle;
