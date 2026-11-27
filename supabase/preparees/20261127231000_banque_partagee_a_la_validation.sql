-- LA VALIDATION D'UN EXERCICE REFUSE LE 512 DU PRINCIPAL QUE SES RELEVÉS DU 31 DÉCEMBRE NE FONT PAS, DÈS QU'UN SECOND COMPTE
-- BANCAIRE S'Y ÉCRIT (ligne 26.6 ; MCBR2-Q2, réponse (A) du cabinet du 27/11/2026 : « la validation bloque dès qu'un second
-- compte s'écrit au 512 du principal »). PRÉPARÉE le 27/11/2026, pas appliquée ; elle suit `ouverture_eclatee_par_compte` (258)
-- et `ouverture_suivante_a_la_validation` (261), en production. Le récit : HISTORIQUE.md, « 27/11/2026 — SECU4-Q2 ET MCBR2-Q2 » ;
-- son essai : supabase/essais/banquePartageeALaValidation.sql (une réplique seulement) ; son retour :
-- supabase/preparees/retour/20261127231100_retour_banque_partagee_a_la_validation.sql ; ses mots : ceux de
-- `ouverture_eclatee_attendue` (`REFUS_DE_L_ECLATEMENT`, src/lib/ouvertureEclatee.ts), que le préalable `banque-partagee-retenue`
-- (src/lib/prealablesValidation.ts, `refusDeLaBanquePartagee`) dit avant le clic.
--
-- LE DÉFAUT. Un compte bancaire autre que le principal s'écrit au 512 du rôle `banque` jusqu'au 1er janvier de son 512 propre
-- (`compte_propre_depuis`) — plus tard, ou jamais s'il se clôt avant. Au 31 décembre de l'exercice, le 512 du rôle porte donc
-- l'argent des deux comptes, et la validation le reporte sur l'exercice suivant. Quand les relevés d'un de ces comptes ne disent
-- pas son solde de ce jour, ou que la somme des soldes ne fait pas ce 512, l'exercice se validait (le 512 confronté au relevé n'est
-- qu'un avertissement, MVPD7-Q2) et figeait l'écart : une écriture libre ne touche pas la banque (src/lib/ecritureLibre.ts), rien
-- d'autre ne répare un 512 d'un exercice validé, et chaque exercice suivant le porte — jusqu'à l'éclatement de l'ouverture que ce
-- compte prendra un jour, qui se refuserait (`ouverture_eclatee_attendue`), et le filet de MCB5G-Q2 avec lui. MCBR-Q2 (261) ne le
-- refuse que l'année où l'ouverture suivante s'éclate ; MCBR2-Q2 le refuse dès que le 512 est partagé.
--
-- LA RÈGLE, sur les comptes tenus dans l'exercice et leurs soldes au 31 décembre lus sur leurs SEULS relevés contrôlés
-- (`soldes_des_comptes_au_trente_et_un`, 258 : le calcul même de l'éclatement, sans copie) :
--   - le GROUPE du 512 du rôle au 31 décembre : le principal, et tout compte dont le 512 propre commence après ce jour (la règle
--     de `compte_de_banque_du_mouvement`) ;
--   - il est PARTAGÉ quand un compte du groupe autre que le principal s'y écrit encore ce jour-là : il n'est pas clos au plus
--     tard le 31 décembre (un compte clos dans l'exercice vaut zéro, MCB4-Q1, et ne s'écrit plus au 512 du rôle l'année
--     suivante) ;
--   - partagé, chaque compte du groupe dit son solde (dans l'ordre de la base : le principal, puis le 512 de chaque compte), et
--     leur somme fait, au centime, le 512 du rôle que la validation reporte au 1er janvier suivant (`soldes_reportes`) ; sinon
--     la validation se refuse, aux mots du refus de l'éclatement — le solde d'un compte qui ne se lit pas, deux relevés qui se
--     contredisent, la somme des soldes qui ne fait pas l'ouverture du 512 du rôle. À la différence de l'éclatement, un compte
--     au solde nul ne dispense de rien : l'écart d'un 512 partagé se fige quel que soit le solde du second compte ce jour-là.
--   Un dossier à un seul compte, ou dont aucun second compte ne s'écrit au 512 du rôle au 31 décembre : rien de neuf, le 512
--   confronté au relevé reste un avertissement (MVPD7-Q2).
--
-- CE QUI CHANGE, ET RIEN D'AUTRE : un déclencheur de contrainte sur `exercices_valides`, à part, sans réécrire
-- `valider_exercice` (que cinq chantiers préparés remplacent déjà), sur le modèle exact de 261 : AFTER INSERT, FOR EACH ROW,
-- DIFFÉRÉ jusqu'à la fin de la transaction — `valider_exercice` insère la ligne de l'exercice, PUIS écrit l'ouverture de
-- l'exercice suivant (`soldes_reportes`) ; juste après l'insertion, le 512 reporté manque encore. Sa condition
-- `current_user <> 'authenticated'`, jugée à l'insertion (PostgreSQL 17, CREATE TRIGGER : « In the case of constraint
-- triggers, evaluation of the WHEN condition is not deferred »), exempte la restauration d'une sauvegarde, que le
-- super-administrateur réinsère sous le rôle de l'API ; sa fonction, en security definer (la fin de la transaction tombe
-- sous le rôle de qui la clôt, qui n'exécute pas `soldes_des_comptes_au_trente_et_un`), n'est exécutable par aucun rôle de
-- l'API. Ni table, ni colonne, ni policy, ni droit ouvert.
--
-- SON RANG. Les déclencheurs d'un même évènement tirent dans l'ordre de leur nom, différés compris : le sien
-- (`exercices_valides_releves_de_la_banque_partagee`) tire APRÈS celui de 261 (`exercices_valides_ouverture_suivante`). Quand
-- l'éclatement de l'ouverture suivante se refuse, la base dit donc son refus d'abord, à ses mots — ceux que le préalable
-- `ouverture-suivante-retenue` dit avant le clic ; le préalable de ce filet ne se dit qu'en dehors de ce cas. Toute validation que
-- 261 refuse, ce filet la refuserait aussi : son groupe est celui de l'éclatement, sans ses deux sorties (aucun compte qui sorte,
-- des comptes qui sortent à zéro).
--
-- Aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction remplacée : par l'outil.

-- ══ 0. La garde de tête ══
do $garde$
declare
  v_corps text;
begin
  if to_regprocedure('public.soldes_des_comptes_au_trente_et_un(uuid, integer)') is null
     or to_regprocedure('public.compte_du_role(uuid, text)') is null
     or to_regprocedure('public.garder_ouverture_suivante_a_la_validation()') is null
     or not exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                     and tgname = 'exercices_valides_ouverture_suivante') then
    raise exception 'La migration banque_partagee_a_la_validation suit ouverture_eclatee_par_compte (258) et ouverture_suivante_a_la_validation (261) : appliquer celles-ci d''abord.';
  end if;
  if to_regprocedure('public.garder_banque_partagee_a_la_validation()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                 and tgname = 'exercices_valides_releves_de_la_banque_partagee') then
    raise exception 'La migration banque_partagee_a_la_validation est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Le calcul que le filet lit, à l'empreinte de son corps : celui de 258, que le module de l'application redit.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.soldes_des_comptes_au_trente_et_un(uuid, integer)'::regprocedure)
     is distinct from '6682875d2d2d188bdb157c084473eb3e' then
    raise exception 'soldes_des_comptes_au_trente_et_un n''est plus celle de la production (258) : relire la migration contre la base avant de l''appliquer.';
  end if;
  select p.prosrc into v_corps from pg_proc p
   where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure and p.prosecdef;
  if v_corps is null then
    raise exception 'valider_exercice n''est plus en security definer : le filet de la banque partagée se tairait sous le rôle de l''API. Relire la migration contre la base.';
  end if;
  if strpos(v_corps, 'insert into public.exercices_valides') = 0 or strpos(v_corps, 'insert into public.soldes_reportes') = 0 then
    raise exception 'valider_exercice n''écrit plus, dans la même transaction, la ligne de l''exercice et l''ouverture de l''exercice suivant : le 512 reporté ne se lirait plus à la fin de la transaction. Relire la migration contre la base.';
  end if;
end
$garde$;

-- ══ 1. Le filet ══
create function public.garder_banque_partagee_a_la_validation() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin date := make_date(new.annee, 12, 31);
  v_lendemain date := make_date(new.annee + 1, 1, 1);
  v_role text := public.compte_du_role(new.dossier_id, 'banque');
  v_compte record;
  v_somme bigint := 0;
  v_ouverture bigint;
begin
  -- Le 512 du rôle partagé au 31 décembre : un compte autre que le principal, pas clos ce jour-là, dont la banque s'y écrit
  -- encore (son 512 propre commence après). Sinon, rien de neuf : le 512 confronté au relevé reste un avertissement.
  if not exists (select 1 from public.soldes_des_comptes_au_trente_et_un(new.dossier_id, new.annee) s
                  where not s.principal and s.compte_propre_depuis > v_fin and s.etat <> 'clos') then
    return null;
  end if;
  -- Chaque compte du groupe dit son solde, dans l'ordre de la base ; un solde nul ne dispense de rien.
  for v_compte in
    select s.* from public.soldes_des_comptes_au_trente_et_un(new.dossier_id, new.annee) s
     where s.principal or s.compte_propre_depuis > v_fin
     order by s.principal desc, s.compte collate "C", s.compte_bancaire_id
  loop
    if v_compte.etat = 'inconnu' then
      raise exception 'Le solde au % du compte bancaire « % » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d''éclater l''ouverture de la banque.',
        to_char(v_fin, 'DD/MM/YYYY'), v_compte.libelle using errcode = '23514';
    end if;
    if v_compte.etat = 'plusieurs' then
      raise exception 'Les relevés du compte bancaire « % » disent des soldes différents au % : l''un d''eux ne dit pas le bon, et l''ouverture de la banque ne s''éclate pas.',
        v_compte.libelle, to_char(v_fin, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    v_somme := v_somme + v_compte.centimes;
  end loop;
  -- Le 512 du rôle que la validation reporte au 1er janvier suivant (l'ouverture de l'exercice suivant).
  select coalesce(sum(case when x.sens = 'debit' then 1 else -1 end * round(x.montant * 100)::bigint), 0) into v_ouverture
    from (select a.sens, a.montant from public.a_nouveaux a
           where a.dossier_id = new.dossier_id and a.date = v_lendemain and a.compte = v_role
          union all
          select s.sens, s.montant from public.soldes_reportes s
           where s.dossier_id = new.dossier_id and s.date = v_lendemain and s.compte = v_role) x;
  if v_somme <> v_ouverture then
    raise exception 'Les soldes des relevés au % (% €) ne font pas l''ouverture du compte % (% €) : l''ouverture de la banque ne s''éclate pas entre ses comptes.',
      to_char(v_fin, 'DD/MM/YYYY'), replace(to_char(v_somme / 100.0, 'FM999999999990.00'), '.', ','), v_role,
      replace(to_char(v_ouverture / 100.0, 'FM999999999990.00'), '.', ',') using errcode = '23514';
  end if;
  return null;
end
$$;
revoke all on function public.garder_banque_partagee_a_la_validation() from public, anon, authenticated, service_role;
comment on function public.garder_banque_partagee_a_la_validation() is
  'Filet de la validation (MCBR2-Q2) : à la fin de la transaction qui valide un exercice, dès qu''un second compte bancaire s''écrit au 512 du rôle au 31 décembre, chaque compte de ce 512 dit son solde sur ses relevés (soldes_des_comptes_au_trente_et_un) et leur somme fait le 512 reporté ; sinon la validation se refuse, aux mots du refus de l''éclatement. Tire après le filet de l''ouverture suivante (261). La restauration (sous le rôle de l''API) ne se rejuge pas.';
create constraint trigger exercices_valides_releves_de_la_banque_partagee
  after insert on public.exercices_valides
  deferrable initially deferred
  for each row when (current_user <> 'authenticated')
  execute function public.garder_banque_partagee_a_la_validation();

-- ══ 2. La garde de fin ══
do $fin$
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_releves_de_la_banque_partagee'
                    and t.tgenabled = 'O' and t.tgtype = 5 and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
                    and t.tgfoid = 'public.garder_banque_partagee_a_la_validation()'::regprocedure
                    and pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER exercices_valides_releves_de_la_banque_partagee AFTER INSERT ON public.exercices_valides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((CURRENT_USER <> ''authenticated''::name)) EXECUTE FUNCTION garder_banque_partagee_a_la_validation()')
     or not exists (select 1 from pg_proc where oid = 'public.garder_banque_partagee_a_la_validation()'::regprocedure
                     and prosecdef and proconfig @> array['search_path=public'])
     or has_function_privilege('anon', 'public.garder_banque_partagee_a_la_validation()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_banque_partagee_a_la_validation()', 'execute')
     or has_function_privilege('service_role', 'public.garder_banque_partagee_a_la_validation()', 'execute') then
    raise exception 'Garde de fin : le déclencheur ou la fonction du filet ne sont pas ceux que la migration pose.';
  end if;
  -- Son rang : après le filet de l'ouverture suivante (261), toujours là et différé, dans l'ordre des noms, octet par octet.
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_ouverture_suivante'
                    and t.tgdeferrable and t.tginitdeferred
                    and t.tgname collate "C" < 'exercices_valides_releves_de_la_banque_partagee' collate "C") then
    raise exception 'Garde de fin : le filet de la banque partagée ne tirerait pas après celui de l''ouverture suivante.';
  end if;
end
$fin$;
