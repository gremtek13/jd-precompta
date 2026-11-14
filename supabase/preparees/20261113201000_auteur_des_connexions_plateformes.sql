-- QUI A ÉCRIT LA CONNEXION À LA PLATEFORME DU CLIENT (espace client, ligne 51.5, étape B4r ; B4RS-Q1, tranchée par le
-- cabinet le 12/11/2026 à la recommandation : « (B) Garder EC-Q4, refuser sur une connexion écrite par un client ») —
-- PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 13/11/2026 — B4RS-Q1, P1T-Q2 ET RET-Q2 » ; l'essai :
-- supabase/essais/auteurDesConnexions.sql ; le retour :
-- supabase/preparees/retour/20261113201100_retour_auteur_des_connexions_plateformes.sql.
--
-- LA RÈGLE. Le cabinet et l'accès client « Ventes » relient l'un et l'autre la plateforme agréée du dossier (EC-Q4,
-- inchangée). La réception des factures d'achat PAR LE CLIENT (l'accès « Achats », actions `lister_achats` et
-- `recevoir_achat` de l'Edge Function `plateforme-agreee`, étape B4r) ne passe que par une connexion dont le cabinet a écrit
-- la configuration en vigueur : la provenance « plateforme » d'une pièce dit qu'une facture électronique est vraiment
-- arrivée par la plateforme du client, et c'est le cabinet qui répond de l'adresse où l'application va la chercher.
--
-- POURQUOI LA BASE, ET COMMENT. L'Edge Function écrit la connexion sous la clé secrète, sans session : la base n'y voit
-- personne, et une colonne d'auteur posée par la fonction serait une affirmation de l'appelant. L'auteur se pose donc en
-- deux temps, la base jugeant chacun :
--   1. Toute écriture de la configuration — les sept colonnes que l'action « enregistrer » écrit (le nom, les deux
--      adresses, l'identifiant, le secret, l'organisation, la portée), et le dossier — EFFACE l'auteur (la garde
--      `garder_auteur_de_la_connexion`, BEFORE INSERT OR UPDATE) : une configuration neuve n'est à personne. Ce qui ne
--      touche pas la configuration (le point de reprise, la dernière récupération, le relevé des statuts, `updated_at`
--      seul) le laisse tel quel ; et personne ne l'écrit en direct, ni le rôle des Edge Functions, ni le propriétaire
--      (42501).
--   2. `attester_connexion_plateforme(dossier, version)`, `security definer`, appelée par l'Edge Function SOUS LA SESSION de
--      l'appelant juste après qu'elle a écrit : si la base reconnaît le cabinet du dossier (`admin_du_dossier`, le
--      super-administrateur compris), elle pose `ecrite_par` (auth.uid(), jamais un paramètre) et `ecrite_le` sur la
--      configuration À CETTE VERSION (`updated_at`) ; sinon 42501, avant toute lecture ; une version qui a changé depuis,
--      22023 (rien n'est attribué : une écriture du client glissée entre les deux temps reste à personne).
-- Une connexion écrite par un accès client reste donc sans auteur — la base ne l'attribue à personne —, et l'Edge Function
-- refuse sur elle la réception par le client, derrière sa constante `AUTEUR_DES_CONNEXIONS_EN_BASE`.
--
-- LES CONNEXIONS D'AVANT : leurs deux colonnes naissent nulles. Personne ne sait qui a écrit leur configuration en vigueur
-- (`created_by` ne dit que la création, et EC-Q4 ouvre la création au client) ; la réception par le client y reste fermée
-- jusqu'à ce que le cabinet les enregistre de nouveau — le côté fermé, comme le veut B4RS-Q1. Relevé : la réception par le
-- client n'est pas encore déployée (B4r attend B1), et aucune plateforme réelle n'a encore été appelée (CLAUDE.md) ; la
-- garde de fin le revérifie : toute connexion de la base est sans auteur après la migration.
--
-- ÉCARTÉS. (a) Une colonne d'auteur posée par l'Edge Function, que la base dériverait du compte nommé : la fonction
-- l'affirmerait, et le prédicat du cabinet serait recopié pour un compte qui n'est pas la session. (b) Écrire la connexion
-- par une fonction appelée sous la session : le navigateur l'appellerait aussi, sans les règles de l'Edge Function que la
-- base ne tient pas (les suffixes des réseaux internes, le secret gardé pour la seule adresse où il a été saisi). (c) Une
-- policy : la table porte le secret, aucune lecture ne s'ouvre.
--
-- SOURCES. PostgreSQL 17 : CREATE TRIGGER (un BEFORE … FOR EACH ROW qui lève annule l'instruction ; il peut modifier la
-- ligne proposée) ; « System Administration Functions » (`set_config(…, true)`, local à la transaction) ; CREATE FUNCTION
-- (SECURITY DEFINER, `SET search_path`). Supabase : `auth.uid()` lit le sujet du jeton de la requête ; la clé secrète n'en
-- porte aucun.
--
-- CE QU'ELLE NE CHANGE PAS : aucune policy (la table n'en a toujours aucune), aucune fonction existante, aucun écran, aucune
-- autre table ; `created_by` garde son sens (la création). L'Edge Function d'aujourd'hui écrit comme hier : la garde efface
-- un auteur qu'elle ne pose pas.
--
-- L'ORDRE : dans la base, elle ne suppose aucune migration préparée et s'applique avant ou après B1 (`trois_cases_de_l_acces`)
-- et B4 (`achats_du_client`) ; mais la réception par le client (B4r) ne se déploie qu'APRÈS elle, sa constante levée dans le
-- même déploiement : la réception ne tourne jamais sans le refus. D'où sa version, après celles de B1 et B4.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée ; ses `revoke` ne retirent que les droits que Postgres donne d'office
-- aux deux fonctions qu'elle crée. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR L'OUTIL. Son retour
-- retire les deux colonnes et ce qu'elles portent : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `AUTEUR_DES_CONNEXIONS_EN_BASE` (l'Edge Function) et
-- `AUTEUR_DES_CONNEXIONS_PREVU` (src/lib/auteurDesConnexions.ts) se lèvent alors.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une table qui ne serait plus celle que la garde lit (ses colonnes, sa RLS active
-- sans aucune policy, hors la restrictive `deux_facteurs` que la double authentification exigée pose sur chaque table de
-- public — `deux_facteurs_exiges`, préparée, s'applique avant ou après celle-ci) ; un déclencheur déjà posé sur elle (la
-- garde se croit seule) ; un jugement du cabinet qui ne serait plus celui que la production porte (l'empreinte du corps
-- d'`admin_du_dossier`, les retours chariot d'un collage écartés).
do $garde$
declare
  v_nombre integer;
begin
  if to_regprocedure('public.attester_connexion_plateforme(uuid, timestamp with time zone)') is not null
     or to_regprocedure('public.garder_auteur_de_la_connexion()') is not null
     or exists (select 1 from pg_catalog.pg_attribute a where a.attrelid = 'public.connexions_plateformes'::regclass
                 and a.attname in ('ecrite_par', 'ecrite_le') and not a.attisdropped) then
    raise exception 'La migration auteur_des_connexions_plateformes est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  select count(*) into v_nombre from pg_catalog.pg_attribute a
   where a.attrelid = 'public.connexions_plateformes'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname in ('dossier_id', 'nom', 'url_flux', 'url_jeton', 'client_id', 'client_secret', 'organisation_id', 'portee',
                       'updated_at');
  if v_nombre <> 9 then
    raise exception 'connexions_plateformes n''a plus les colonnes que la garde de l''auteur lit (% sur 9) : relire la table.', v_nombre;
  end if;
  if not (select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'public.connexions_plateformes'::regclass)
     or exists (select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.connexions_plateformes'::regclass
                 and not (p.polname = 'deux_facteurs' and not p.polpermissive)) then
    raise exception 'connexions_plateformes doit garder sa RLS sans aucune policy hors la restrictive deux_facteurs (elle porte le secret) : relire la table avant d''appliquer cette migration.';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.connexions_plateformes'::regclass and not t.tgisinternal) then
    raise exception 'connexions_plateformes porte déjà un déclencheur : la garde de l''auteur suppose être seule à réécrire la ligne proposée.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.admin_du_dossier(uuid)')), ''), chr(13), ''))
       <> '30e9b7246cb939741fe58f4ffc27adf4'
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'admin_du_dossier n''est plus celle que cette migration suppose (empreinte attendue 30e9b724…) : la relire avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. Les deux colonnes ══════════
-- Sans clé étrangère vers le compte : retirer le compte d'un membre parti ne doit pas réattribuer la connexion (le patron de
-- `paiements_declares.declare_par`) ; un membre parti n'écrit plus rien, et sa configuration reste celle du cabinet.
alter table public.connexions_plateformes
  add column ecrite_par uuid,
  add column ecrite_le timestamptz,
  add constraint connexions_plateformes_auteur check ((ecrite_par is null) = (ecrite_le is null));

comment on column public.connexions_plateformes.ecrite_par is
  'Le compte du cabinet du dossier (admin_du_dossier, le super-administrateur compris) qui a écrit la configuration en vigueur, posé par attester_connexion_plateforme sous sa session ; nul tant que le cabinet ne l''a pas écrite (une configuration écrite par un accès client, ou d''avant la migration). Effacé par la base à toute écriture de la configuration. La réception par le client ne passe que par une connexion qui le porte (B4RS-Q1).';
comment on column public.connexions_plateformes.ecrite_le is
  'L''instant où le cabinet a écrit la configuration en vigueur (attester_connexion_plateforme) ; nul avec ecrite_par.';

-- ══ 2. La garde de l'auteur ══════════
-- Aux droits de l'appelant, chemin vide : elle ne lit que la ligne. Hors de l'attestation, l'auteur ne s'écrit jamais, et
-- une configuration qui change l'efface ; dans l'attestation (le réglage `jd.auteur_de_la_connexion`, le dossier de la
-- ligne), seul l'auteur change.
create function public.garder_auteur_de_la_connexion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fonction$
begin
  if tg_op = 'UPDATE'
     and pg_catalog.current_setting('jd.auteur_de_la_connexion', true) is not distinct from old.dossier_id::text then
    if (pg_catalog.to_jsonb(new) operator(pg_catalog.-) array['ecrite_par', 'ecrite_le'])
         is distinct from (pg_catalog.to_jsonb(old) operator(pg_catalog.-) array['ecrite_par', 'ecrite_le']) then
      raise exception 'L''attestation du cabinet n''écrit que l''auteur de la connexion.' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.ecrite_par is not null or new.ecrite_le is not null then
      raise exception 'L''auteur d''une connexion ne se pose que par attester_connexion_plateforme, sous la session du cabinet.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.ecrite_par, new.ecrite_le) is distinct from (old.ecrite_par, old.ecrite_le) then
    raise exception 'L''auteur d''une connexion ne se pose que par attester_connexion_plateforme, sous la session du cabinet.'
      using errcode = '42501';
  end if;
  -- Une configuration qui change n'est plus celle que le cabinet a écrite : son auteur s'efface, jusqu'à ce que le cabinet
  -- l'écrive à son tour.
  if (new.dossier_id, new.nom, new.url_flux, new.url_jeton, new.client_id, new.client_secret, new.organisation_id, new.portee)
     is distinct from
     (old.dossier_id, old.nom, old.url_flux, old.url_jeton, old.client_id, old.client_secret, old.organisation_id, old.portee) then
    new.ecrite_par := null;
    new.ecrite_le := null;
  end if;
  return new;
end
$fonction$;

revoke all on function public.garder_auteur_de_la_connexion() from public, anon, authenticated;

comment on function public.garder_auteur_de_la_connexion() is
  'Garde de connexions_plateformes (B4RS-Q1) : l''auteur ne s''écrit que par attester_connexion_plateforme (42501), qui n''écrit que lui ; toute écriture de la configuration l''efface. Aucun rôle de l''API ne l''exécute.';

create trigger connexions_plateformes_auteur
  before insert or update on public.connexions_plateformes
  for each row execute function public.garder_auteur_de_la_connexion();

-- ══ 3. L'attestation du cabinet ══════════
-- Le cabinet du dossier, sous SA session, attribue à son compte la configuration qu'il vient d'écrire, à la version que
-- l'Edge Function lui repasse. Le contrôle vient d'abord, avant toute lecture de la connexion.
create function public.attester_connexion_plateforme(p_dossier_id uuid, p_version timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $fonction$
declare
  v_le timestamptz;
begin
  if p_dossier_id is null or auth.uid() is null or not public.admin_du_dossier(p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_catalog.set_config('jd.auteur_de_la_connexion', p_dossier_id::text, true);
  update public.connexions_plateformes c
     set ecrite_par = auth.uid(), ecrite_le = pg_catalog.now()
   where c.dossier_id = p_dossier_id and c.updated_at = p_version
  returning c.ecrite_le into v_le;
  perform pg_catalog.set_config('jd.auteur_de_la_connexion', '', true);
  if v_le is null then
    raise exception 'La connexion à la plateforme a changé entre-temps, ou a été retirée : l''enregistrer de nouveau.'
      using errcode = '22023';
  end if;
  return v_le;
end
$fonction$;

revoke all on function public.attester_connexion_plateforme(uuid, timestamptz) from public, anon;
grant execute on function public.attester_connexion_plateforme(uuid, timestamptz) to authenticated;

comment on function public.attester_connexion_plateforme(uuid, timestamptz) is
  'Le cabinet du dossier (admin_du_dossier) attribue à son compte la configuration de la connexion à la plateforme à cette version (updated_at) : ecrite_par = auth.uid(), ecrite_le = maintenant (B4RS-Q1). 42501 sans le droit, avant toute lecture ; 22023 si la version a changé. Appelée par l''Edge Function plateforme-agreee sous la session de l''appelant.';

-- ══ 4. La garde de fin ══════════
-- Ce qui est posé, à l'empreinte de son corps et sous ses droits ; et toute connexion de la base sans auteur.
do $fin$
begin
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p where p.oid = 'public.garder_auteur_de_la_connexion()'::regprocedure), chr(13), ''))
       <> 'cb99dc3ced1b63011fdc468ba330663e'
     or (select p.prosecdef or p.proconfig is distinct from array['search_path=""'] from pg_catalog.pg_proc p
          where p.oid = 'public.garder_auteur_de_la_connexion()'::regprocedure)
     or has_function_privilege('anon', 'public.garder_auteur_de_la_connexion()', 'execute')
     or has_function_privilege('authenticated', 'public.garder_auteur_de_la_connexion()', 'execute') then
    raise exception 'Garde de fin : la garde de l''auteur n''a pas le corps ou les droits attendus.';
  end if;
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p
                   where p.oid = 'public.attester_connexion_plateforme(uuid, timestamp with time zone)'::regprocedure), chr(13), ''))
       <> '2b23f498dfbb3e921ac6c6ed5acb0fcc'
     or not (select p.prosecdef and p.proconfig = array['search_path=""'] from pg_catalog.pg_proc p
              where p.oid = 'public.attester_connexion_plateforme(uuid, timestamp with time zone)'::regprocedure)
     or has_function_privilege('anon', 'public.attester_connexion_plateforme(uuid, timestamp with time zone)', 'execute')
     or not has_function_privilege('authenticated', 'public.attester_connexion_plateforme(uuid, timestamp with time zone)', 'execute') then
    raise exception 'Garde de fin : l''attestation du cabinet n''a pas le corps ou les droits attendus.';
  end if;
  if (select string_agg(pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text, ' ; ' order by t.tgname)
        from pg_catalog.pg_trigger t where t.tgrelid = 'public.connexions_plateformes'::regclass and not t.tgisinternal)
     is distinct from 'CREATE TRIGGER connexions_plateformes_auteur BEFORE INSERT OR UPDATE ON public.connexions_plateformes FOR EACH ROW EXECUTE FUNCTION garder_auteur_de_la_connexion() O' then
    raise exception 'Garde de fin : la garde de l''auteur n''est pas le seul déclencheur de connexions_plateformes.';
  end if;
  if exists (select 1 from public.connexions_plateformes c where c.ecrite_par is not null or c.ecrite_le is not null) then
    raise exception 'Garde de fin : une connexion d''avant la migration porterait un auteur.';
  end if;
end
$fin$;
