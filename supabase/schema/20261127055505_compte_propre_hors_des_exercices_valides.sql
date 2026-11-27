-- LE COMPTE PROPRE D'UN COMPTE BANCAIRE NE PART NI D'UN EXERCICE VALIDÉ NI D'AVANT LUI, EN BASE (ligne 26.6, MCB6-Q2 ;
-- MCB6Q2-Q1, réponse (A) du cabinet du 15/11/2026 : « un filet en base, collé avec MCB5g, la restauration exceptée »).
-- PRÉPARÉE le 15/11/2026, pas appliquée. PAR L'OUTIL (`apply_migration`) : une fonction et un déclencheur s'ajoutent ; rien
-- ne se retire, aucune policy ne s'élargit, aucun droit ne s'ouvre. À coller avec l'ouverture éclatée (MCB5g :
-- `ouverture_eclatee_par_compte` et `ouverture_eclatee_a_la_validation`), avant la levée de `COMPTES_BANCAIRES_PREVUS`
-- (src/lib/comptesBancaires.ts), avant ou après elles : elle ne lit ni ne pose rien de leurs objets. Le récit : HISTORIQUE.md,
-- « 15/11/2026 — MCB6Q2-Q1 : LE COMPTE PROPRE HORS D'UN EXERCICE VALIDÉ, EN BASE (PRÉPARÉE, PAS APPLIQUÉE) ». Son essai :
-- supabase/essais/comptePropreHorsDesExercicesValides.sql (une réplique seulement, une transaction) ; son retour :
-- supabase/preparees/retour/20261111235800_retour_compte_propre_hors_des_exercices_valides.sql ; ses mots :
-- `REFUS_DES_EXERCICES_VALIDES` (src/lib/comptesBancaires.ts), que la fiche des comptes bancaires dit avant le clic
-- (`REFUS_ANNEE_VALIDEE`, src/lib/ficheDesComptesBancaires.ts).
--
-- LA RÈGLE (MCB6-Q2, tranchée le 11/11/2026, jusqu'ici tenue par l'écran seul) : la date depuis laquelle un compte bancaire
-- autre que le principal tient son propre 512 (`compte_propre_depuis`, un 1er janvier) ne tombe ni sur un exercice validé du
-- dossier ni avant lui. L'ouverture par compte (MCB5g) suppose que l'année de départ ne l'est pas : un exercice validé est
-- figé au seul 512 du principal, et le 512 propre d'un compte qui en partirait ne s'ouvrirait jamais — il partirait de zéro.
-- Une date déjà posée se garde, même sur un exercice validé depuis : seule une date posée ou changée se juge, comme l'écran.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE : un déclencheur BEFORE INSERT OR UPDATE OF `compte_propre_depuis` sur `comptes_bancaires`,
-- à part de la garde d'hier (`garder_comptes_bancaires`, que rien ne réécrit) et nommé pour tirer APRÈS elle — PostgreSQL
-- déclenche les gardes d'une table dans l'ordre de leur nom : `comptes_bancaires_garde` d'abord, ses refus d'abord (la date
-- qui n'est pas un 1er janvier, le compte figé par ses mouvements), puis celui-ci. Il lève 23514, comme elle, aux mots de
-- l'écran : le premier exercice validé qui la retient et la première année qui reste ouverte.
--
-- AUX DROITS DE L'APPELANT, comme la garde d'hier, sans `security definer` — d'où ni la porte `_acces_avant_les_gardes`
-- (elle ne garde que les gardes definer) ni de lecture hors de la RLS : seul le cabinet du dossier écrit un compte bancaire
-- (`comptes_bancaires_cabinet`) et lui seul lit les exercices validés du dossier (`exercices_valides_lecture`) ; un appelant
-- que la policy refusera ensuite (42501) n'y voit aucun exercice, et la garde ne lui apprend rien. Elle prend le verrou
-- PARTAGÉ de la validation (la clé de `cle_validation`, écrite telle quelle comme le font déjà douze fonctions de la base,
-- dont `garder_encaissement_facture`, une garde aux droits de l'appelant : `cle_validation` n'est pas ouverte à l'appelant)
-- avant de lire les exercices validés : un compte posé pendant la validation de son année attend qu'elle finisse, puis la lit.
--
-- LA RESTAURATION EXCEPTÉE (le choix du cabinet), sans exempter le super-administrateur : sur ce projet, le chef du cabinet
-- l'est aussi, et l'écran de la fiche écrit un compte en direct sous la policy — l'exempter ferait taire le filet pour toutes
-- ses saisies (le même écueil que MCB5G-Q2 a écarté). La restauration d'une sauvegarde, elle, réinsère les comptes bien avant
-- les exercices validés, la dernière table qu'elle écrit (src/lib/sauvegarde.ts) : au moment où elle pose un compte, son
-- dossier ne porte encore aucun exercice validé, et le filet n'a rien à refuser — la forme même de l'exception des gardes de
-- MCB5g (« le super-administrateur, avant tout exercice validé »), que l'essai éprouve.

-- ══ 0. La garde de tête ══
do $garde$
begin
  if to_regprocedure('public.garder_compte_propre_hors_des_exercices_valides()') is not null
     or exists (select 1 from pg_trigger t where t.tgrelid = to_regclass('public.comptes_bancaires')
                  and t.tgname = 'comptes_bancaires_garde_des_exercices_valides') then
    raise exception 'La migration compte_propre_hors_des_exercices_valides est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.comptes_bancaires') is null or to_regclass('public.exercices_valides') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.comptes_bancaires'::regclass
                      and a.attname = 'compte_propre_depuis' and not a.attisdropped)
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.exercices_valides'::regclass
                      and a.attname = 'annee' and not a.attisdropped)
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.comptes_bancaires'::regclass
                      and t.tgname = 'comptes_bancaires_garde' and t.tgenabled = 'O') then
    raise exception 'La migration compte_propre_hors_des_exercices_valides suit comptes_bancaires (MCB1) : une table, une colonne ou la garde dont elle dépend manque — relire la base.';
  end if;
  -- La clé du verrou de la validation, que la garde écrit telle quelle : celle de `cle_validation`, au caractère près.
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_proc p where p.oid = to_regprocedure('public.cle_validation(uuid)'))
       is distinct from 'bcbb03363036aa6aa037c0b829e3382f' then
    raise exception 'La fonction cle_validation(uuid) n''est plus celle dont cette migration recopie la clé : la relire contre la base avant de l''appliquer.';
  end if;
end
$garde$;

-- ══ 1. Le filet ══
create function public.garder_compte_propre_hors_des_exercices_valides() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_validee integer;
  v_ouverte integer;
begin
  -- Le principal ne porte pas de date à lui ; une date inchangée, déjà posée, se garde, même sur un exercice validé depuis.
  if new.principal or new.compte_propre_depuis is null
     or (tg_op = 'UPDATE' and new.compte_propre_depuis is not distinct from old.compte_propre_depuis) then
    return new;
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || new.dossier_id::text, 0));
  select min(v.annee) filter (where v.annee >= extract(year from new.compte_propre_depuis)), max(v.annee) + 1
    into v_validee, v_ouverte
    from public.exercices_valides v where v.dossier_id = new.dossier_id;
  if v_validee is not null then
    raise exception 'L’exercice % du dossier est validé : un compte bancaire tient son propre compte du plan depuis le 1er janvier d’un exercice qui ne l’est pas, % au plus tôt — son ouverture par compte suppose que cette année n’est pas figée.',
      v_validee, v_ouverte using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function public.garder_compte_propre_hors_des_exercices_valides() from public, anon, authenticated;
create trigger comptes_bancaires_garde_des_exercices_valides
  before insert or update of compte_propre_depuis on public.comptes_bancaires
  for each row execute function public.garder_compte_propre_hors_des_exercices_valides();
comment on function public.garder_compte_propre_hors_des_exercices_valides() is
  'MCB6Q2-Q1 (ligne 26.6) : un compte bancaire autre que le principal ne tient pas son propre 512 depuis un exercice validé du dossier, ni depuis une année antérieure ; une date déjà posée se garde. Aux droits de l''appelant, après la garde d''hier ; la restauration, qui réinsère les exercices validés en dernier, n''y rencontre rien.';
