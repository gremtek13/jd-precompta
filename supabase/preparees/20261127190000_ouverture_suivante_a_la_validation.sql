-- LA VALIDATION D'UN EXERCICE REFUSE L'OUVERTURE DE L'EXERCICE SUIVANT QU'ELLE FIGERAIT SANS REMÈDE (ligne 26.6, MCB5g ;
-- MCBR-Q2, réponse (A) du cabinet du 27/11/2026 : « bloquant dans ce seul cas, aux mots du refus de la répartition ;
-- l'avertissement reste pour les autres dossiers »). PRÉPARÉE le 27/11/2026, pas appliquée ; elle suit
-- `ouverture_eclatee_par_compte` (258) et `ouverture_eclatee_a_la_validation` (259), en production. Le récit : HISTORIQUE.md,
-- « 27/11/2026 — MCBR-Q2 : LA VALIDATION REFUSE L'OUVERTURE SUIVANTE QU'ELLE FIGERAIT SANS REMÈDE ». Son essai :
-- supabase/essais/ouvertureSuivanteALaValidation.sql (une réplique seulement) ; son retour :
-- supabase/preparees/retour/20261127190100_retour_ouverture_suivante_a_la_validation.sql ; ses mots : ceux de
-- `ouverture_eclatee_attendue` (`REFUS_DE_L_ECLATEMENT`, src/lib/ouvertureEclatee.ts), que le préalable
-- `ouverture-suivante-retenue` (src/lib/prealablesValidation.ts, `refusDeLOuvertureSuivante`) dit avant le clic.
--
-- LE DÉFAUT (la relecture adverse du 27/11/2026). Un compte bancaire autre que le principal tient son propre 512 depuis le
-- 1er janvier qui suit l'exercice (`compte_propre_depuis`) ; jusque-là, sa banque s'écrit au 512 du rôle. Au 31 décembre, son
-- solde ne se lit sur aucun de ses relevés, ou la somme des soldes des comptes ne fait pas le 512 du rôle : la validation de
-- l'exercice passait (le 512 confronté au relevé n'est qu'un avertissement, MVPD7-Q2), puis l'éclatement de l'ouverture
-- suivante se refusait (`ouverture_eclatee_attendue`), et le filet de MCB5G-Q2 retenait la validation de l'exercice suivant à
-- jamais : l'exercice est figé, une écriture libre ne touche pas la banque, et rouvrir le compte au 1er janvier laisse son 512
-- faux de son solde.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE : un déclencheur de contrainte sur `exercices_valides`, à part, sans réécrire
-- `valider_exercice` (que cinq chantiers préparés remplacent déjà) : AFTER INSERT, FOR EACH ROW, DIFFÉRÉ jusqu'à la fin de la
-- transaction. Il appelle `ouverture_eclatee_attendue` sur l'exercice SUIVANT, telle quelle — le calcul même de l'éclatement,
-- sans copie : ses refus retiennent la validation, à leurs mots (le solde d'un compte qui ne se lit pas, deux relevés qui se
-- contredisent, la somme des soldes qui ne fait pas l'ouverture du 512 du rôle). Rien quand aucun compte n'en sort, qu'il en
-- sort à zéro, ou que l'éclatement se fera ; l'éclatement lui-même ne s'écrit pas ici (la carte de l'onglet Écritures l'écrit,
-- une fois l'exercice suivant ouvert). Ni table, ni colonne, ni policy, ni droit ouvert.
--
-- POURQUOI DIFFÉRÉ. `valider_exercice` insère la ligne de l'exercice APRÈS ses refus et ses écritures numérotées, PUIS écrit
-- l'ouverture de l'exercice suivant (`soldes_reportes`, d'après `soldes_a_reporter`). Avant l'insertion, l'exercice n'est pas
-- encore validé, et `ouverture_eclatee_attendue` dirait l'ouverture « attendue » ; juste après, les soldes reportés manquent
-- encore, et elle comparerait les relevés à un 512 nul. À la fin de la transaction, l'exercice est validé et son ouverture
-- écrite : la recomposition est celle que l'éclatement fera. PostgreSQL 17, CREATE TRIGGER : un déclencheur de contrainte se
-- diffère jusqu'à la fin de la transaction et voit alors tout ce qu'elle a écrit ; sa condition WHEN, elle, se juge AU MOMENT
-- de l'insertion — « In the case of constraint triggers, evaluation of the WHEN condition is not deferred » —, et un
-- déclencheur dont la condition est fausse n'est pas mis en attente. L'ordre des deux insertions n'importe donc plus ; la
-- garde de tête vérifie seulement que le corps de `valider_exercice` les fait toutes deux, la transaction de l'une étant
-- celle de l'autre.
--
-- QUI EST JUGÉ, comme au filet de MCB5G-Q2 : la ligne qu'insère `valider_exercice`, en security definer, sous son
-- propriétaire ; jamais celle que la restauration d'une sauvegarde réinsère sous le rôle de l'API (la policy
-- `exercices_valides_restauration`, le super-administrateur) — un exercice validé avant ce filet, ou des relevés retouchés
-- depuis, ne doivent pas l'arrêter. La condition `current_user <> 'authenticated'`, jugée à l'insertion, le dit. La fonction
-- tire à la fin de la transaction, sous le rôle de qui la clôt (le rôle de l'API, pour un appel de l'application), qui
-- n'exécute pas `ouverture_eclatee_attendue` : elle est donc en security definer, exécutable par aucun rôle de l'API, et ne
-- lit rien d'autre que ce que la recomposition lit. Le super-administrateur n'est pas exempté (`is_super_admin()`) : sur ce
-- projet, il est aussi le chef du cabinet. La garde de tête exige `valider_exercice` en definer : invoker, elle insérerait sous
-- le rôle de l'API, et le filet se tairait. Un déclencheur AFTER ne tire qu'après la policy : ni la porte
-- `_acces_avant_les_gardes` (elle ne garde que les gardes BEFORE), ni rien qu'apprendrait un appelant que la RLS refuse.
-- Un chemin hors de l'application qui rendrait les contraintes immédiates AVANT `valider_exercice` (`set constraints … immediate`,
-- que l'API n'exécute pas) jugerait la ligne avant l'ouverture écrite : la validation s'y refuse, sur un 512 nul — du côté fermé.
--
-- LE CAS LIMITE (posé au cabinet, MCBR2-Q1) : un compte créé APRÈS la validation de l'exercice, son 512 propre au lendemain —
-- ce filet ne peut pas le voir, l'exercice étant validé quand le compte paraît. `compte_propre_hors_des_exercices_valides` (256)
-- ne refuse qu'un départ sur ou avant un exercice validé ; l'éclatement de l'exercice suivant le dit (la carte de l'onglet
-- Écritures et le préalable `ouverture-a-eclater`), et le filet de MCB5G-Q2 en retient la validation.
--
-- Aucune instruction de retrait ni de vidage, aucune barre oblique inverse, aucune fonction remplacée : par l'outil.

-- ══ 0. La garde de tête ══
do $garde$
declare
  v_corps text;
begin
  if to_regprocedure('public.ouverture_eclatee_attendue(uuid, integer)') is null
     or to_regprocedure('public.garder_ouverture_eclatee_a_la_validation()') is null then
    raise exception 'La migration ouverture_suivante_a_la_validation suit ouverture_eclatee_par_compte et ouverture_eclatee_a_la_validation (MCB5g) : appliquer celles-ci d''abord.';
  end if;
  if to_regprocedure('public.garder_ouverture_suivante_a_la_validation()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.exercices_valides'::regclass
                 and tgname = 'exercices_valides_ouverture_suivante') then
    raise exception 'La migration ouverture_suivante_a_la_validation est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Le calcul que le filet appelle, à l'empreinte de son corps : celui de 258, que le module de l'application redit.
  if (select md5(replace(p.prosrc, chr(13), '')) from pg_proc p
       where p.oid = 'public.ouverture_eclatee_attendue(uuid, integer)'::regprocedure)
     is distinct from 'b675ca4407865cadff8b8d3f9086b54d' then
    raise exception 'ouverture_eclatee_attendue n''est plus celle de la production (258) : relire la migration contre la base avant de l''appliquer.';
  end if;
  select p.prosrc into v_corps from pg_proc p
   where p.oid = 'public.valider_exercice(uuid, integer, jsonb, jsonb, jsonb)'::regprocedure and p.prosecdef;
  if v_corps is null then
    raise exception 'valider_exercice n''est plus en security definer : le filet de l''ouverture suivante se tairait sous le rôle de l''API. Relire la migration contre la base.';
  end if;
  if strpos(v_corps, 'insert into public.exercices_valides') = 0 or strpos(v_corps, 'insert into public.soldes_reportes') = 0 then
    raise exception 'valider_exercice n''écrit plus, dans la même transaction, la ligne de l''exercice et l''ouverture de l''exercice suivant : la recomposition à la fin de la transaction ne lirait plus cette ouverture. Relire la migration contre la base.';
  end if;
end
$garde$;

-- ══ 1. Le filet ══
create function public.garder_ouverture_suivante_a_la_validation() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- L'éclatement de l'ouverture de l'exercice suivant, recomposé une fois l'exercice validé et cette ouverture écrite : ses
  -- refus retiennent la validation, à leurs mots ; ses lignes ne s'écrivent pas ici.
  perform 1 from public.ouverture_eclatee_attendue(new.dossier_id, new.annee + 1);
  return null;
end
$$;
revoke all on function public.garder_ouverture_suivante_a_la_validation() from public, anon, authenticated;
comment on function public.garder_ouverture_suivante_a_la_validation() is
  'Filet de la validation (MCBR-Q2) : à la fin de la transaction qui valide un exercice, l''éclatement de l''ouverture de l''exercice suivant (ouverture_eclatee_attendue) se recompose ; ses refus retiennent la validation — un compte qui tient son 512 propre au 1er janvier suivant sans solde lisible au 31 décembre, deux relevés qui se contredisent, la somme des soldes qui ne fait pas le 512 du rôle reporté. La restauration (sous le rôle de l''API) ne se rejuge pas.';
create constraint trigger exercices_valides_ouverture_suivante
  after insert on public.exercices_valides
  deferrable initially deferred
  for each row when (current_user <> 'authenticated')
  execute function public.garder_ouverture_suivante_a_la_validation();

-- ══ 2. La garde de fin ══
do $fin$
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.exercices_valides'::regclass and t.tgname = 'exercices_valides_ouverture_suivante'
                    and t.tgenabled = 'O' and t.tgtype = 5 and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred
                    and t.tgfoid = 'public.garder_ouverture_suivante_a_la_validation()'::regprocedure
                    and pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER exercices_valides_ouverture_suivante AFTER INSERT ON public.exercices_valides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((CURRENT_USER <> ''authenticated''::name)) EXECUTE FUNCTION garder_ouverture_suivante_a_la_validation()')
     or not exists (select 1 from pg_proc where oid = 'public.garder_ouverture_suivante_a_la_validation()'::regprocedure
                     and prosecdef and proconfig @> array['search_path=public'])
     or has_function_privilege('anon', 'public.garder_ouverture_suivante_a_la_validation()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_ouverture_suivante_a_la_validation()', 'execute') then
    raise exception 'Garde de fin : le déclencheur ou la fonction du filet ne sont pas ceux que la migration pose.';
  end if;
end
$fin$;
