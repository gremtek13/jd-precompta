-- PC6 — LA REPRISE PROPOSE LE PLAN : `enregistrer_a_nouveaux` RANGE SUR LE PLAN DU DOSSIER (ligne 43 de la feuille de
-- route ; PRÉPARÉE le 11/11/2026, PAS APPLIQUÉE). La conception : HISTORIQUE.md, « LE PLAN COMPTABLE PERSONNALISABLE : LA
-- CONCEPTION » (§ 3.8, point 2 ; la ligne PC6 du découpage) ; le récit : « 11/11/2026 — PC6 : LA REPRISE PROPOSE LE PLAN
-- (PRÉPARÉE, PAS APPLIQUÉE) » ; l'essai : supabase/essais/planDepuisLaBalance.sql ; le retour :
-- supabase/preparees/retour/20261111241100_retour_plan_depuis_la_balance.sql ; le module que la base redit :
-- src/lib/aNouveaux.ts (`compteRangeSurLePlan`, `refusDUnANouveau`) et src/lib/planDepuisLaBalance.ts.
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03 consolidé au 1er janvier 2026), art. 1011-5 (« L'entité
-- établit un plan de comptes »), 1131-1 (le compte divisionnaire commence par le numéro du compte dont il est une
-- subdivision) et 1131-2 (deux numéros qui ne diffèrent que par leurs zéros de fin désignent le même compte global) ;
-- art. 1215-53 (la caisse) ; LPF, art. A47 A-1 (CompteNum, CompteLib : un compte, un numéro) ; PostgreSQL 17,
-- « Advisory Lock Functions » et « Transaction Isolation » (en lecture validée, chaque instruction lit ce qui est validé
-- quand elle commence).
--
-- LE DÉFAUT (relevé à la conception, § 9, point 1 ; LATENT : aucun à-nouveau en production, relevé du 11/11/2026). La
-- reprise d'une balance ne range que la banque, la caisse et, à des zéros près, deux comptes de TVA : un 4455100 s'ouvre
-- sous ce numéro quand le paiement de la TVA écrit au 445510, un 1640000 garde le capital restant quand les échéances
-- écrivent au 164000, et le compte ne se solde jamais — deux comptes pour un, dans la balance, le FEC et la révision. La
-- base n'en dit rien : `enregistrer_a_nouveaux` accepte tout compte de bilan.
--
-- CE QU'ELLE FAIT. `enregistrer_a_nouveaux` garde sa signature, ses droits, ses refus et leur ordre ; après l'insertion
-- (sous le verrou partagé de la validation du dossier, que `garder_a_nouveaux_valides` pose à la première ligne), et avant
-- l'équilibre, elle refuse (23514), sur la première ligne fautive dans l'ordre de la liste :
--   1. un compte 512… qui n'est pas la banque du plan du dossier (`compte_du_role(…, 'banque')`) ;
--   2. un compte 53… qui n'est pas la caisse du plan (`compte_du_role(…, 'caisse')`) ;
--   3. un compte égal, à des zéros près, au compte d'un rôle du plan sans lui être égal (le 4455100 du 445510).
-- Un autre sous-compte sous la racine d'un rôle (un second 401…, un 164200) passe, comme hier : il s'ouvre tel quel, et
-- l'écran dit que l'application n'y écrira pas. Une ligne qui n'est pas un compte de bilan (`^[1-5][0-9]{2,}$`) n'arrive
-- pas jusque-là : la contrainte de la table la refuse à l'insertion, comme hier.
--
-- PLUSIEURS COMPTES BANCAIRES (MCB-Q1 à Q8, MCB5g). La conception disait « l'application ne tient qu'une banque » : depuis
-- MCB, un dossier tient un 512 par compte bancaire, le PRINCIPAL suivant le rôle `banque`. La reprise n'en range pas moins
-- tout 512… sur la banque du plan : l'ouverture des autres comptes s'en détache par l'écriture qui éclate l'ouverture au
-- relevé du 31 décembre (`ouverture_eclatee_par_compte`, préparée), qui lit l'ouverture au 512 du RÔLE et l'exige égale,
-- au centime, à la somme des relevés de tous les comptes. Un à-nouveau ouvert au 512 propre d'un autre compte compterait
-- donc son solde deux fois — l'éclatement le refuserait, et la validation de l'exercice avec lui (MCB5G-Q2). Le refus 1
-- vaut ainsi pour tout 512… autre que la banque du plan, celui d'un compte bancaire du dossier compris ; il ne lit pas
-- `comptes_bancaires`, et se pose avant comme après MCB1.
--
-- POURQUOI APRÈS L'INSERTION, ET NON AVANT. La fonction est `SECURITY INVOKER` et `cle_validation` n'est pas ouverte à
-- `authenticated` : le verrou partagé de la validation, celui sous lequel toute fonction lit le plan (PC2) et que
-- `regler_plan_du_dossier` prend EXCLUSIF, arrive par le déclencheur `garder_a_nouveaux_valides` (`security definer`) à la
-- première ligne insérée. Lu après, le plan est celui que la base garde : un réglage du plan concurrent finit d'abord (et
-- la lecture qui suit le voit), ou attend la fin de cet enregistrement (et se refuse alors sur ses à-nouveaux). Écartés :
-- passer la fonction en `security definer` (la RLS du cabinet ne la garderait plus) ; recopier la formule de
-- `cle_validation` (la clé écrite deux fois).
--
-- PRÉREQUIS. Aucune des migrations préparées ne redéfinit `enregistrer_a_nouveaux` (`ouverture_eclatee_par_compte` la
-- nomme sans la toucher) : le corps remplacé est celui de la production, `creation_a_nouveaux` (26/09/2026), que la garde
-- de tête vérifie à son empreinte ; `compte_du_role` (PC2) et `regler_plan_du_dossier` (PC4) y sont. Elle se pose donc
-- avant ou après les cinq migrations des comptes bancaires ; elle a été éprouvée APRÈS elles.
--
-- L'ORDRE (« un resserrement vient en dernier »). Le rangement d'hier envoie encore un 4455100 sous ce numéro : lever
-- d'abord `PLAN_DEPUIS_LA_BALANCE_PREVU` (src/lib/planDepuisLaBalance.ts : l'application range alors tout compte de rôle à
-- des zéros près), le déployer, puis coller cette migration.
--
-- DESTRUCTIF au sens des règles du dépôt : le corps de la fonction porte, comme hier, la suppression des à-nouveaux qu'il
-- remplace (`delete from public.a_nouveaux where dossier_id = p_dossier_id`). Aucune donnée n'est touchée par la
-- migration. L'outil d'application attendrait une confirmation : elle SE COLLE dans l'éditeur SQL de Supabase, dans une
-- transaction, avec sa ligne d'historique, sur l'accord du cabinet.

-- ══ 0. La garde de tête : le corps que cette migration remplace, celui de la production, ou rien ══════════════════════
do $garde$
begin
  if to_regprocedure('public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb)') is null
     or (select md5(p.prosrc) from pg_proc p
          where p.oid = to_regprocedure('public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb)'))
        is distinct from '6bc763dbcf5d40799dcb38a979f314c5' then
    raise exception 'La fonction enregistrer_a_nouveaux n''est plus celle que cette migration remplace (ou la migration plan_depuis_la_balance est déjà en base) : la relire contre la base avant de l''appliquer.';
  end if;
  if to_regprocedure('public.compte_du_role(uuid, text)') is null
     or to_regprocedure('public.regler_plan_du_dossier(uuid, jsonb)') is null
     or to_regprocedure('public.garder_a_nouveaux_valides()') is null then
    raise exception 'La migration plan_depuis_la_balance suit le plan des dossiers (PC2) et son réglage (PC4) : ils manquent.';
  end if;
end
$garde$;

-- ══ 1. enregistrer_a_nouveaux : les à-nouveaux rangés sur le plan du dossier ══════════════════════════════════════════
create or replace function public.enregistrer_a_nouveaux(
  p_dossier_id uuid,
  p_date date,
  p_source_nom text,
  p_source_empreinte text,
  p_lignes jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
  v_compte text;
  v_attendu text;
  v_role text;
begin
  if not admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if extract(month from p_date) <> 1 or extract(day from p_date) <> 1 then
    raise exception 'Des à-nouveaux ouvrent un exercice : leur date est un 1er janvier.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lignes) is distinct from 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne à enregistrer.' using errcode = '22023';
  end if;

  -- Deux enregistrements simultanés du même dossier : sans ce verrou, chacun supprime ce que l'autre
  -- n'a pas encore validé, puis les deux insèrent, et le trigger ne voit pas les lignes de l'autre
  -- transaction.
  perform pg_advisory_xact_lock(hashtextextended('a_nouveaux:' || p_dossier_id::text, 0));

  delete from public.a_nouveaux where dossier_id = p_dossier_id;

  insert into public.a_nouveaux (dossier_id, date, compte, compte_origine, libelle, sens, montant, source_nom, source_empreinte)
  select p_dossier_id, p_date, l->>'compte', nullif(l->>'compte_origine', ''), coalesce(l->>'libelle', ''),
         l->>'sens', (l->>'montant')::numeric, p_source_nom, p_source_empreinte
  from jsonb_array_elements(p_lignes) as l;
  get diagnostics v_nb = row_count;

  -- PC6 (ligne 43). Le plan se lit ICI, après l'insertion : le déclencheur `garder_a_nouveaux_valides` a pris, à la
  -- première ligne, le verrou PARTAGÉ de la validation du dossier, que `regler_plan_du_dossier` prend exclusif. Un réglage
  -- concurrent a donc fini (et cette lecture le voit), ou attend la fin de cette transaction (et refusera ses à-nouveaux).
  -- 1. Toute banque de la balance s'ouvre sur la banque du plan, réunie : un autre compte bancaire du dossier reçoit son
  --    ouverture de l'écriture qui l'éclate au relevé du 31 décembre (MCB5g), qui l'exige entière au 512 du rôle.
  select x.e ->> 'compte', public.compte_du_role(p_dossier_id, 'banque') into v_compte, v_attendu
    from jsonb_array_elements(p_lignes) with ordinality as x(e, n)
   where left(x.e ->> 'compte', 3) = '512'
     and (x.e ->> 'compte') <> public.compte_du_role(p_dossier_id, 'banque')
   order by x.n limit 1;
  if found then
    raise exception 'Le compte « % » de ces à-nouveaux est une banque (512…) sans être celle du plan de ce dossier (« % ») : toute banque de la balance s''ouvre sur la banque du plan, réunie.',
      v_compte, v_attendu using errcode = '23514';
  end if;
  -- 2. Toute caisse, sur la caisse du plan : la base ne lit que celle-là (`premier_jour_negatif_de_la_caisse`).
  select x.e ->> 'compte', public.compte_du_role(p_dossier_id, 'caisse') into v_compte, v_attendu
    from jsonb_array_elements(p_lignes) with ordinality as x(e, n)
   where left(x.e ->> 'compte', 2) = '53'
     and (x.e ->> 'compte') <> public.compte_du_role(p_dossier_id, 'caisse')
   order by x.n limit 1;
  if found then
    raise exception 'Le compte « % » de ces à-nouveaux est une caisse (53…) sans être celle du plan de ce dossier (« % ») : toute caisse de la balance s''ouvre sur la caisse du plan, réunie.',
      v_compte, v_attendu using errcode = '23514';
  end if;
  -- 3. Le compte d'un rôle du plan, à des zéros près (art. 1131-2), s'ouvre sous le numéro du plan.
  select x.e ->> 'compte', p.compte, p.role into v_compte, v_attendu, v_role
    from jsonb_array_elements(p_lignes) with ordinality as x(e, n)
    join (select r.role, r.ordre, public.compte_du_role(p_dossier_id, r.role) as compte
            from public.roles_comptables r) p
      on rtrim(p.compte, '0') = rtrim(x.e ->> 'compte', '0')
   where (x.e ->> 'compte') <> p.compte
   order by x.n, p.ordre limit 1;
  if found then
    raise exception 'Le compte « % » de ces à-nouveaux est, à des zéros près, le compte « % » du rôle « % » dans le plan de ce dossier : il s''ouvre sous ce numéro.',
      v_compte, v_attendu, v_role using errcode = '23514';
  end if;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.a_nouveaux where dossier_id = p_dossier_id;
  if v_debit <> v_credit then
    raise exception 'À-nouveaux déséquilibrés : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

revoke execute on function public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.enregistrer_a_nouveaux(uuid, date, text, text, jsonb) to authenticated;
