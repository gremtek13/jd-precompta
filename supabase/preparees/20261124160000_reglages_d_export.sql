-- EXP-Q4 : LES RÉGLAGES DE L'EXPORT VERS UN LOGICIEL COMPTABLE, GARDÉS PAR DOSSIER ET PAR LOGICIEL — PRÉPARÉE le 24/11/2026,
-- PAS APPLIQUÉE. La décision du cabinet du 18/11/2026 (EXP-Q4 (A), « un réglage par dossier, saisi par le cabinet, sans
-- défaut ») ; la recherche : docs/conceptions/57-exports-vers-les-logiciels-comptables.md, § 0 point 12, § 3.1 et § 5 (les
-- trois réglages que tout tiers qui exporte vers ces logiciels demande au cabinet, et qui ne se devinent pas). Le récit :
-- HISTORIQUE.md, « 24/11/2026 — EXP-Q4 : LES RÉGLAGES DE L'EXPORT GARDÉS PAR DOSSIER (PRÉPARÉE, PAS APPLIQUÉE) ». Le module
-- qui redit ses refus et ses listes : src/lib/reglagesDExport.ts (`REGLAGES_D_EXPORT_PREVUS`, `REFUS_DE_LA_BASE`),
-- src/lib/reglagesDExport.test.ts les confronte au texte de cette migration. Son essai : supabase/essais/reglagesDExport.sql
-- (une réplique seulement) ; le bloc RX de supabase/essais/rls.sql ; son retour :
-- supabase/preparees/retour/20261124160100_retour_reglages_d_export.sql.
--
-- CE QU'ELLE POSE :
--   1. `logiciels_d_export()` : la LISTE FERMÉE des logiciels qui ont un profil d'export dans l'application, `acd` seul
--      aujourd'hui (src/lib/profilsDExport.ts, `PROFILS_D_EXPORT`). Une fonction immuable que la contrainte de la table et
--      la fonction d'enregistrement appellent : l'étendre à un logiciel de plus (Quadra, le TRA…) est une migration d'une
--      instruction, `create or replace function`, sans aucun retrait — une liste écrite dans la contrainte ne s'étendrait
--      qu'en la retirant puis en la reposant, un collage. Une valeur qui en SORTIRAIT laisserait ses lignes en défaut de la
--      contrainte sans que la base les relise : ne retirer un logiciel qu'après en avoir relu les lignes.
--   2. `reglages_d_export` : une ligne par dossier et par logiciel (`reglages_d_export_un_par_logiciel`, contrainte TOTALE),
--      les trois réglages dans des COLONNES TYPÉES, chacune nulle tant qu'elle est « à saisir » — jamais une valeur par défaut :
--        - `longueur_des_comptes` : le nombre de caractères d'un compte général dans le logiciel, de 6 à 12 (les bornes de
--          src/lib/profilsDExport.ts) ;
--        - `forme_des_tiers` : `nos_auxiliaires` (CompAuxNum et CompAuxLib comme le FEC les écrit) ou `sans_auxiliaires` (les
--          deux colonnes vides, la ligne sur son compte collectif : comme ACD écrit le FEC d'un BNC, relevé du 17/11/2026) ;
--        - `journal_ac`, `journal_ve`, `journal_bq`, `journal_od`, `journal_an` : le code, dans le logiciel, de chacun des cinq
--          journaux que l'application écrit au FEC (src/lib/fec.ts, `LIBELLES_JOURNAUX`, et les à-nouveaux) — 1 à 20 lettres
--          ou chiffres, sans espace : la forme que la mise en forme du profil exige déjà d'un code (lib/profilsDExport.ts), la
--          borne de 20 étant technique — aucun texte public ne borne le code d'un journal d'ACD.
--      Des colonnes, pas un jsonb : les trois réglages sont ceux de tout logiciel que la recherche a lu (§ 0 point 12), la base
--      type et borne chacun par sa contrainte nommée, et aucune n'est un texte libre — rien qu'un code, une longueur, une
--      forme de la liste. Un réglage neuf serait une colonne nullable de plus, sans retrait. Puis sa version, l'auteur et
--      l'instant du dernier réglage, posés par la fonction (`regle_par`, sans clé étrangère vers le compte : retirer le compte
--      d'un membre parti n'efface pas qui a réglé, le patron de `previsions_publiees.auteur`).
--   3. `enregistrer_reglages_d_export(dossier, logiciel, réglages, version lue)`, aux droits du propriétaire : le tout de la
--      ligne d'un seul geste, contre la version LUE qu'il remplace (nulle pour une première), les colonnes énumérées ; il
--      rend la version écrite. Un réglage nul ou absent reste « à saisir » : la base garde ce que le cabinet a dit, rien de
--      plus, et c'est l'export qui refuse tant qu'un réglage qu'il lui faut manque (src/lib/reglagesDExport.ts).
--   4. Une garde, aux droits de l'appelant : la ligne ne s'écrit que par la fonction (le réglage local `jd.reglages_d_export`,
--      qu'elle pose sur son dossier) ou ne se réinsère que par le super-administrateur (la restauration) ; elle ne passe ni à
--      un autre dossier ni à un autre logiciel. Elle ne lit aucune ligne : elle n'a pas à passer derrière la porte d'accès
--      devant les gardes, dont la règle vise une garde security definer (porteDevantLesGardes.test.ts).
--   5. Les policies, à `authenticated` : la lecture au cabinet du dossier (`admin_du_dossier` : son chef, un membre de
--      l'équipe à qui le dossier est assigné, le super-administrateur), la réinsertion au super-administrateur. AUCUNE
--      BRANCHE CLIENT (EXP-Q8 (A), l'export est un geste du cabinet du dossier seul) : un accès client n'en lit rien, quelles
--      que soient ses cases. Aucune policy de mise à jour ni de retrait : la ligne part avec son dossier.
--   6. Si la double authentification exigée (`deux_facteurs_exiges`) est déjà en base, la restrictive `deux_facteurs` (sinon,
--      sa boucle la posera) : les deux se collent dans les deux ordres.
--
-- LES REFUS, DANS L'ORDRE (que src/lib/reglagesDExport.ts redit sous les mêmes mots, `REFUS_DE_LA_BASE`) :
--   l'appelant qui n'est pas le cabinet du dossier, ou un dossier inconnu (42501, sous les mêmes mots : rien n'apprend qu'il
--   existe) ; un logiciel hors de la liste (22023) ; des réglages qui ne sont pas un objet aux trois clés connues (22023) ;
--   une longueur hors de 6 à 12, ou qui n'est pas un nombre entier (22023) ; une forme des tiers hors de la liste (22023) ;
--   une correspondance des journaux qui n'est pas un objet des cinq journaux de l'application (22023) ; un code de journal
--   qui n'est pas fait de 1 à 20 lettres ou chiffres (22023) ; puis, sous le verrou du dossier et du logiciel, des réglages
--   qui ont changé depuis leur lecture (40001). La garde : une écriture par un autre chemin (42501), une ligne qui change de
--   dossier ou de logiciel (23514) ; les contraintes, une valeur hors de ses bornes écrite en direct (23514).
--
-- CE QU'ELLE NE CHANGE PAS : aucune fonction d'hier n'est remplacée (`admin_du_dossier` et `is_super_admin` sont appelées,
-- jamais réécrites ; la garde de tête vérifie l'empreinte de leur corps), ni aucune table ; aucune ligne écrite d'avance —
-- aucun dossier n'a de réglage tant que le cabinet n'en enregistre pas. Le FEC réglementaire, la numérotation et les choix
-- propres à un export (les quatre champs d'un BNC, EXP-Q5 ; les à-nouveaux) ne sont pas ici. Ni barre oblique inverse, ni
-- retour chariot, aucune instruction qui retire un objet ou une ligne : elle passe par l'outil d'application. VERSION
-- PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la version que
-- porte sa ligne d'historique, texte inchangé ; `REGLAGES_D_EXPORT_PREVUS` se lève alors, et la table entre au plan de
-- sauvegarde.
--
-- LE SOCLE ET L'INVENTAIRE, LE JOUR DE L'APPLICATION (relevés le 24/11/2026 sur une copie de la réplique portée à la
-- production du jour, 250, la migration appliquée puis posée en simulation dans l'export) : aucune table du socle n'est
-- touchée, le socle reste à 84 instructions (`e54200f4…`) ; l'inventaire compte 32 objets de plus — treize colonnes, douze
-- contraintes, un déclencheur, deux policies, trois fonctions et la RLS de la table (3 468, puis 3 500 : `5ad6ef4a…`).

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, une fonction appelée qui ne serait plus celle que cette migration suppose — à
-- l'empreinte de son corps, les retours chariot d'un collage écartés —, et une base où manquerait la colonne qu'elle cite.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if to_regclass('public.reglages_d_export') is not null
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('enregistrer_reglages_d_export', 'garder_reglages_d_export', 'logiciels_d_export')) then
    raise exception 'La migration reglages_d_export est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.dossiers'::regclass and a.attname = 'id' and not a.attisdropped) then
    raise exception 'La table dossiers n''a plus de colonne id : la relire avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. La liste fermée des logiciels ══════════
create function public.logiciels_d_export() returns text[]
language sql immutable set search_path = public as $$
  select array['acd']::text[]
$$;

comment on function public.logiciels_d_export() is
  'EXP-Q4 : la liste fermée des logiciels qui ont un profil d''export dans l''application (src/lib/profilsDExport.ts, PROFILS_D_EXPORT), que la contrainte de reglages_d_export et enregistrer_reglages_d_export appellent. L''étendre : la remplacer, sans retrait ; en retirer un logiciel demande d''en relire les lignes d''abord.';

-- Exécutable par le compte connecté : la contrainte la juge sous le compte qui écrit — la réinsertion du super-administrateur
-- (la restauration) comprise. Elle ne lit rien et ne rend que des codes de logiciels.
revoke execute on function public.logiciels_d_export() from public, anon;
grant execute on function public.logiciels_d_export() to authenticated;

-- ══ 2. Les réglages d'un dossier pour un logiciel ══════════
create table public.reglages_d_export (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  logiciel text not null
    constraint reglages_d_export_logiciel check (logiciel = any (public.logiciels_d_export())),
  longueur_des_comptes integer
    constraint reglages_d_export_longueur_des_comptes check (longueur_des_comptes between 6 and 12),
  forme_des_tiers text
    constraint reglages_d_export_forme_des_tiers check (forme_des_tiers in ('nos_auxiliaires', 'sans_auxiliaires')),
  journal_ac text
    constraint reglages_d_export_journal_ac check (journal_ac ~ '^[A-Za-z0-9]{1,20}$'),
  journal_ve text
    constraint reglages_d_export_journal_ve check (journal_ve ~ '^[A-Za-z0-9]{1,20}$'),
  journal_bq text
    constraint reglages_d_export_journal_bq check (journal_bq ~ '^[A-Za-z0-9]{1,20}$'),
  journal_od text
    constraint reglages_d_export_journal_od check (journal_od ~ '^[A-Za-z0-9]{1,20}$'),
  journal_an text
    constraint reglages_d_export_journal_an check (journal_an ~ '^[A-Za-z0-9]{1,20}$'),
  version integer not null default 1
    constraint reglages_d_export_version check (version >= 1),
  regle_par uuid not null,
  regle_le timestamptz not null default now(),
  constraint reglages_d_export_un_par_logiciel unique (dossier_id, logiciel)
);

comment on table public.reglages_d_export is
  'EXP-Q4 (A), 18/11/2026 : les réglages de l''export vers le logiciel comptable de l''expert-comptable, une ligne par dossier et par logiciel — la longueur des comptes, la forme des comptes de tiers, le code de chacun des cinq journaux de l''application dans le logiciel ; un réglage nul est « à saisir », jamais une valeur par défaut. Écrite par enregistrer_reglages_d_export seule, lue par le cabinet du dossier ; aucun client.';
comment on column public.reglages_d_export.logiciel is
  'Un logiciel de la liste fermée, logiciels_d_export() (acd aujourd''hui) : le profil de src/lib/profilsDExport.ts.';
comment on column public.reglages_d_export.longueur_des_comptes is
  'Le nombre de caractères d''un compte général dans le logiciel, de 6 à 12 ; les comptes de l''application s''y complètent de zéros à droite. Nul : à saisir.';
comment on column public.reglages_d_export.forme_des_tiers is
  'nos_auxiliaires : CompAuxNum et CompAuxLib comme le FEC les écrit ; sans_auxiliaires : les deux colonnes vides, la ligne sur son compte collectif (comme ACD écrit le FEC d''un BNC). Nul : à saisir.';
comment on column public.reglages_d_export.journal_an is
  'Le code, dans le logiciel, du journal des à-nouveaux de l''application (AN) ; journal_ac, journal_ve, journal_bq et journal_od de même pour les achats, les ventes, la banque et les opérations diverses. 1 à 20 lettres ou chiffres ; nul : à saisir.';
comment on column public.reglages_d_export.version is
  'La version des réglages, 1 à la première écriture, puis une de plus à chaque enregistrement : la saisie la retient et la base refuse celle qui en remplace une autre.';
comment on column public.reglages_d_export.regle_par is
  'Le compte du dernier enregistrement (auth.uid(), posé par la fonction), sans clé étrangère : il survit au retrait du compte.';
comment on column public.reglages_d_export.regle_le is
  'L''instant du dernier enregistrement (posé par la fonction).';

alter table public.reglages_d_export enable row level security;

-- Le cabinet du dossier lit ; aucun client, aucune case d'accès. Aucune policy de mise à jour ni de retrait : la fonction
-- seule écrit, et la ligne part avec son dossier. La restauration réinsère par la porte du super-administrateur.
create policy reglages_d_export_lecture on public.reglages_d_export
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy reglages_d_export_restauration on public.reglages_d_export
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. La garde ══════════
-- Aux droits de l'appelant : elle ne lit aucune ligne, ne juge que le chemin de l'écriture et sa clé. La fonction écrit sous
-- le réglage local qu'elle pose sur son dossier ; le super-administrateur réinsère une ligne telle qu'elle a été écrite (la
-- restauration) ; tout autre chemin — le propriétaire, le rôle des Edge Functions — se refuse.
create function public.garder_reglages_d_export() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('jd.reglages_d_export', true), '') is distinct from new.dossier_id::text
     and not (tg_op = 'INSERT' and public.is_super_admin()) then
    raise exception 'Les réglages d’export ne s’écrivent que par enregistrer_reglages_d_export.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.dossier_id is distinct from old.dossier_id or new.logiciel is distinct from old.logiciel) then
    raise exception 'Les réglages d’export d’un dossier ne passent ni à un autre dossier ni à un autre logiciel.' using errcode = '23514';
  end if;
  return new;
end
$$;

comment on function public.garder_reglages_d_export() is
  'La garde de reglages_d_export : la ligne ne s''écrit que par enregistrer_reglages_d_export, ou ne se réinsère que par le super-administrateur (42501) ; elle ne change ni de dossier ni de logiciel (23514).';

create trigger reglages_d_export_garde
  before insert or update on public.reglages_d_export
  for each row execute function public.garder_reglages_d_export();

revoke execute on function public.garder_reglages_d_export() from public, anon, authenticated;

-- ══ 4. Enregistrer les réglages d'un dossier pour un logiciel ══════════
-- p_reglages : { longueur_des_comptes: entier | null, forme_des_tiers: texte | null, journaux: { AC, VE, BQ, OD, AN: texte | null } }
-- (`reglagesPourLaBase`, src/lib/reglagesDExport.ts) ; une clé absente vaut nul, « à saisir ». p_version_lue : la version que
-- la saisie remplace, nulle pour une première. Rend la version écrite.
create function public.enregistrer_reglages_d_export(p_dossier_id uuid, p_logiciel text, p_reglages jsonb, p_version_lue integer)
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $fonction$
declare
  v_cle text;
  v_valeur jsonb;
  v_nombre numeric;
  v_longueur integer;
  v_forme text;
  v_journaux jsonb;
  v_codes jsonb := '{}'::jsonb;
  v_actuelle public.reglages_d_export%rowtype;
  v_existe boolean;
  v_version integer;
begin
  -- 0. L'accès, avant toute lecture : le cabinet du dossier (son chef, un membre assigné, le super-administrateur), d'un dossier
  --    qui existe — sous les mêmes mots, qu'il existe ou non.
  if p_dossier_id is null or auth.uid() is null or not coalesce(public.admin_du_dossier(p_dossier_id), false)
     or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;

  -- 1. Le logiciel : un de la liste fermée.
  if p_logiciel is null or not (p_logiciel = any (public.logiciels_d_export())) then
    raise exception 'Ce logiciel n’a pas de profil d’export dans l’application.' using errcode = '22023';
  end if;

  -- 2. Les réglages : un objet, aux seules clés que la base connaît (les clés ne se lisent que d'un objet).
  if jsonb_typeof(p_reglages) is distinct from 'object' then
    raise exception 'Les réglages d’export se donnent en un objet aux clés longueur_des_comptes, forme_des_tiers et journaux.'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_reglages) k(cle)
              where k.cle not in ('longueur_des_comptes', 'forme_des_tiers', 'journaux')) then
    raise exception 'Les réglages d’export se donnent en un objet aux clés longueur_des_comptes, forme_des_tiers et journaux.'
      using errcode = '22023';
  end if;

  -- 3. La longueur des comptes : nulle (à saisir), ou un nombre JSON entier de 6 à 12 — le CASE ne convertit jamais un texte
  --    en nombre.
  v_valeur := p_reglages -> 'longueur_des_comptes';
  if v_valeur is not null and jsonb_typeof(v_valeur) <> 'null' then
    v_nombre := case when jsonb_typeof(v_valeur) = 'number' then (v_valeur #>> '{}')::numeric end;
    if v_nombre is null or v_nombre <> trunc(v_nombre) or v_nombre < 6 or v_nombre > 12 then
      raise exception 'La longueur des comptes du logiciel va de 6 à 12 caractères, ou reste à saisir.' using errcode = '22023';
    end if;
    v_longueur := v_nombre::integer;
  end if;

  -- 4. La forme des comptes de tiers : nulle (à saisir), ou l'une des deux que l'application connaît.
  v_valeur := p_reglages -> 'forme_des_tiers';
  if v_valeur is not null and jsonb_typeof(v_valeur) <> 'null' then
    if jsonb_typeof(v_valeur) <> 'string' or (v_valeur #>> '{}') not in ('nos_auxiliaires', 'sans_auxiliaires') then
      raise exception 'La forme des comptes de tiers est l’une de celles que l’application connaît, ou reste à saisir.'
        using errcode = '22023';
    end if;
    v_forme := v_valeur #>> '{}';
  end if;

  -- 5. La correspondance des journaux : nulle, ou un objet des cinq journaux de l'application ; chaque code nul (à saisir) ou
  --    fait de 1 à 20 lettres ou chiffres, sans espace.
  v_journaux := p_reglages -> 'journaux';
  if v_journaux is not null and jsonb_typeof(v_journaux) <> 'null' then
    if jsonb_typeof(v_journaux) <> 'object' then
      raise exception 'La correspondance des journaux va d’un journal de l’application (AC, VE, BQ, OD, AN) à son code dans le logiciel.'
        using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_object_keys(v_journaux) k(cle) where k.cle not in ('AC', 'VE', 'BQ', 'OD', 'AN')) then
      raise exception 'La correspondance des journaux va d’un journal de l’application (AC, VE, BQ, OD, AN) à son code dans le logiciel.'
        using errcode = '22023';
    end if;
    for v_cle, v_valeur in select j.key, j.value from jsonb_each(v_journaux) j order by j.key collate "C" loop
      if jsonb_typeof(v_valeur) <> 'null'
         and (jsonb_typeof(v_valeur) <> 'string' or (v_valeur #>> '{}') !~ '^[A-Za-z0-9]{1,20}$') then
        raise exception 'Le code d’un journal dans le logiciel tient en 1 à 20 lettres ou chiffres, sans espace, ou reste à saisir.'
          using errcode = '22023';
      end if;
      if jsonb_typeof(v_valeur) = 'string' then
        v_codes := v_codes || jsonb_build_object(v_cle, v_valeur #>> '{}');
      end if;
    end loop;
  end if;

  -- 6. La version lue, sous un verrou du dossier et du logiciel : celle de la ligne que la saisie remplace, aucune pour une
  --    première. Deux enregistrements simultanés se suivent, et le second se dit.
  perform pg_advisory_xact_lock(hashtextextended('reglages_d_export:' || p_dossier_id::text || ':' || p_logiciel, 0));
  select * into v_actuelle from public.reglages_d_export r
   where r.dossier_id = p_dossier_id and r.logiciel = p_logiciel for update;
  v_existe := found;
  if (v_existe and (p_version_lue is null or p_version_lue <> v_actuelle.version)) or (not v_existe and p_version_lue is not null) then
    raise exception 'Les réglages d’export de ce dossier ont changé depuis leur lecture : relis-les avant de les enregistrer.'
      using errcode = '40001';
  end if;

  -- 7. La ligne, par la porte que la garde ouvre à ce dossier seul, ses colonnes énumérées ; l'auteur et l'instant de
  --    l'écriture.
  perform set_config('jd.reglages_d_export', p_dossier_id::text, true);
  if not v_existe then
    insert into public.reglages_d_export (dossier_id, logiciel, longueur_des_comptes, forme_des_tiers, journal_ac, journal_ve,
                                          journal_bq, journal_od, journal_an, version, regle_par, regle_le)
    values (p_dossier_id, p_logiciel, v_longueur, v_forme, v_codes ->> 'AC', v_codes ->> 'VE', v_codes ->> 'BQ',
            v_codes ->> 'OD', v_codes ->> 'AN', 1, auth.uid(), now())
    returning version into v_version;
  else
    update public.reglages_d_export r
       set longueur_des_comptes = v_longueur, forme_des_tiers = v_forme, journal_ac = v_codes ->> 'AC',
           journal_ve = v_codes ->> 'VE', journal_bq = v_codes ->> 'BQ', journal_od = v_codes ->> 'OD',
           journal_an = v_codes ->> 'AN', version = r.version + 1, regle_par = auth.uid(), regle_le = now()
     where r.id = v_actuelle.id
    returning version into v_version;
  end if;
  perform set_config('jd.reglages_d_export', '', true);
  return v_version;
end
$fonction$;

revoke execute on function public.enregistrer_reglages_d_export(uuid, text, jsonb, integer) from public, anon;
grant execute on function public.enregistrer_reglages_d_export(uuid, text, jsonb, integer) to authenticated;

comment on function public.enregistrer_reglages_d_export(uuid, text, jsonb, integer) is
  'EXP-Q4 (A) : enregistre, d''un seul geste, les réglages de l''export d''un dossier vers un logiciel (la longueur des comptes, la forme des comptes de tiers, le code de chacun des cinq journaux), contre la version lue qu''ils remplacent ; un réglage nul reste à saisir. Le cabinet du dossier seul ; rend la version écrite.';

-- ══ 5. La double authentification exigée, si elle est déjà en base ══════════
do $deux_facteurs$
begin
  if to_regprocedure('public.deux_facteurs_satisfaits()') is not null then
    execute 'create policy deux_facteurs on public.reglages_d_export as restrictive for all to authenticated '
      || 'using ((select public.deux_facteurs_satisfaits())) with check ((select public.deux_facteurs_satisfaits()))';
  end if;
end
$deux_facteurs$;
