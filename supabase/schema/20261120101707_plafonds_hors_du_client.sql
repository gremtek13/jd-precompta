-- LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT (OPT1-Q3, tranchée (B) par le cabinet le 19/11/2026 : « fermer au
-- client les colonnes des plafonds, après avoir repris les lectures du client ») — PRÉPARÉE le 19/11/2026, PAS APPLIQUÉE. Le
-- récit : HISTORIQUE.md, « 19/11/2026 — OPT1-Q3 : LES PLAFONDS DE L'ASSISTANT HORS DE LA LECTURE DU CLIENT » ; l'essai :
-- supabase/essais/plafondsHorsDuClient.sql ; le bloc PL de supabase/essais/rls.sql (et son HR5) ; le retour :
-- supabase/preparees/retour/20261119150100_retour_plafonds_hors_du_client.sql ; le module : src/lib/plafondsDeLAssistant.ts
-- (`PLAFONDS_HORS_DU_CLIENT_PREVUS`) ; le scanner des lectures : src/lib/lecturesDesCabinets.test.ts.
--
-- LE CONSTAT (relevé sur la réplique le 19/11/2026). `cabinets_select` ouvre la ligne d'un cabinet à son équipe et à tout
-- accès client d'un de ses dossiers ; la RLS ne choisit que des LIGNES : le client lit donc aussi `limite_ia_alerte_usd` et
-- `limite_ia_blocage_usd`, ce que son cabinet s'autorise à dépenser d'assistant par mois.
--
-- LA RÈGLE. Une colonne se ferme par les droits de PostgreSQL, pas par une policy. Les deux rôles de l'API perdent la lecture
-- de la TABLE et la retrouvent sur chacune de ses huit autres colonnes ; aucun d'eux — ni le client, ni l'équipe, ni le
-- super-administrateur sous sa session — ne lit plus les plafonds par la table (42501, même dans un filtre : aucune lecture
-- détournée). L'équipe du cabinet et le super-administrateur les lisent par `plafonds_de_l_assistant()`, aux droits du
-- propriétaire, sur `admin_du_cabinet` : rien de changé pour eux, le client n'en reçoit aucune ligne. L'écriture ne change
-- pas : la mise à jour reste un droit de la table (la policy `cabinets_update`, et, après OPT1, la garde des plafonds) ; elle
-- ne lit que `id`. L'assistant lit les plafonds avec la clé du service, que ces droits ne touchent pas.
--
-- POURQUOI CETTE FORME. Écartées : (1) déplacer les plafonds dans une table à part, sans branche client — il faudrait retirer
-- les deux colonnes de `cabinets` (une migration destructive, à l'accord du cabinet), redéployer l'assistant, changer la
-- sauvegarde, et OPT1, dont la garde de tête exige ces colonnes, ne s'appliquerait plus après elle ; (2) fermer au client la
-- ligne entière et lui rendre sa charte par une fonction — chaque lecture du client (la charte, le nom du mandataire, le
-- dossier du cabinet) changerait, pour cacher deux colonnes. Les droits par colonne ont déjà un précédent ici
-- (`cabinet_admins.role`, la mise à jour) ; leur piège — une colonne AJOUTÉE plus tard n'est lisible par aucun rôle de l'API
-- tant qu'on ne la lui donne pas — est gardé par la garde de tête (les dix colonnes connues, sinon refus), par le bloc PL de
-- rls.sql (toute colonne hors des plafonds lisible) et par l'essai.
--
-- L'ORDRE (un resserrement vient en dernier). Depuis le 19/11/2026, aucune lecture de `cabinets` d'un connecté ne demande `*`
-- ni un plafond, l'écran du super-administrateur excepté (lecturesDesCabinets.test.ts) : l'application d'aujourd'hui tient
-- avant et après. Puis cette migration ; puis `PLAFONDS_HORS_DU_CLIENT_PREVUS` levé dans le même commit que ce fichier posé
-- dans l'export : entre les deux, l'écran du super-administrateur dit sa lecture refusée et n'offre aucun plafond à modifier.
-- Elle s'applique avant OU après `options_des_cabinets` (OPT1) : aucune ne touche ce que l'autre lit ou pose (OPT1 lit les
-- colonnes au catalogue et garde l'écriture des plafonds par un déclencheur, qui lit NEW et OLD sans droit de colonne).
--
-- Aucune table neuve : ni la restrictive `deux_facteurs`, ni la porte `_acces_avant_les_gardes` ; la fonction, une lecture
-- `security definer` de l'API, est couverte par la pré-requête de PostgREST le jour du second temps de C7. Aucun des mots qui
-- retiennent l'outil d'application, pas même en commentaire : elle passe par `apply_migration`. Le retour, qui retire la
-- fonction, se colle. VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son
-- application, sous la version que porte sa ligne d'historique, texte inchangé. Ni barre oblique inverse, ni retour chariot.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application, et un état d'avant qui ne serait pas celui qu'elle suppose : les rôles de l'API qui
-- lisent la table entière ; aucun droit de lecture par colonne déjà posé ; les dix colonnes connues, ni plus ni moins (une
-- colonne de plus ne serait plus lisible par l'API après elle) ; les fonctions appelées, à l'empreinte de leur corps, les
-- retours chariot d'un collage écartés.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
  v_colonnes text;
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'plafonds_de_l_assistant') then
    raise exception 'La migration plafonds_hors_du_client est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if not has_table_privilege('anon', 'public.cabinets', 'SELECT')
     or not has_table_privilege('authenticated', 'public.cabinets', 'SELECT') then
    raise exception 'Les rôles de l''API ne lisent plus la table cabinets entière : la migration plafonds_hors_du_client est déjà en base, ou un autre retrait s''y est fait ; relire les droits avant de l''appliquer.';
  end if;
  if exists (select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) d
              where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0 and d.privilege_type = 'SELECT'
                and (d.grantee = 0 or d.grantee in (to_regrole('anon'), to_regrole('authenticated')))) then
    raise exception 'Une colonne de cabinets porte déjà un droit de lecture propre à un rôle de l''API : relire les droits avant d''appliquer cette migration.';
  end if;
  select string_agg(a.attname::text, ',' order by a.attname::text collate "C") into v_colonnes
    from pg_attribute a
   where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0 and not a.attisdropped;
  if v_colonnes is distinct from 'couleur_primaire,couleur_primaire_claire,created_at,dossier_du_cabinet,id,limite_ia_alerte_usd,limite_ia_blocage_usd,logo_storage_path,nom,police_google_font' then
    raise exception 'La table cabinets n''a plus les dix colonnes que cette migration suppose (%) : une colonne de plus ne serait plus lisible par l''API ; la relire avant d''appliquer cette migration.', v_colonnes;
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_cabinet', 'public.admin_du_cabinet(uuid)', '9e3218c1a32719441078f0c354493507'),
      ('mon_cabinet_id', 'public.mon_cabinet_id()', 'bbe2ddb196036b1b449486f1e2e67c46')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
end
$garde$;

-- ══ 1. La lecture de la table, colonne par colonne ══════════
-- Le retrait d'abord, puis les huit colonnes rendues, les deux plafonds exceptés. L'insertion, la mise à jour et le reste du
-- DML de la table ne changent pas (la RLS les garde comme hier).
revoke select on public.cabinets from anon, authenticated;
grant select (id, nom, couleur_primaire, couleur_primaire_claire, police_google_font, logo_storage_path, created_at, dossier_du_cabinet)
  on public.cabinets to anon, authenticated;

-- ══ 2. La lecture des plafonds par l'équipe du cabinet et le super-administrateur ══════════
-- Une ligne par cabinet que l'appelant administre (`admin_du_cabinet` : son cabinet, chef ou non ; tous, pour le
-- super-administrateur) ; aucune au client, ni à un compte sans cabinet. Rien d'autre que l'identifiant et les deux plafonds.
create function public.plafonds_de_l_assistant()
returns table (cabinet_id uuid, limite_ia_alerte_usd numeric, limite_ia_blocage_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.limite_ia_alerte_usd, c.limite_ia_blocage_usd
    from public.cabinets c
   where public.admin_du_cabinet(c.id)
$$;

comment on function public.plafonds_de_l_assistant() is
  'Les plafonds de coût de l''assistant (OPT1-Q3) des cabinets que l''appelant administre (admin_du_cabinet) : les deux colonnes de cabinets ne se lisent plus par aucun rôle de l''API, le client n''en reçoit aucune ligne.';

revoke execute on function public.plafonds_de_l_assistant() from public, anon;
grant execute on function public.plafonds_de_l_assistant() to authenticated;

-- ══ 3. La garde de fin ══════════
-- Ce que la migration a posé, relu au catalogue, quel que soit le chemin (un autre donneur, PUBLIC, une appartenance) : aucun
-- rôle de l'API ne lit la table entière ni un plafond ; chacun lit chaque autre colonne ; la fonction aux droits du
-- propriétaire, le chemin fixé, exécutée par authenticated, ni par l'anonyme ni par PUBLIC.
do $fin$
begin
  if exists (select 1 from (values ('anon'), ('authenticated')) r(n)
              where has_table_privilege(r.n, 'public.cabinets', 'SELECT')
                 or has_column_privilege(r.n, 'public.cabinets', 'limite_ia_alerte_usd', 'SELECT')
                 or has_column_privilege(r.n, 'public.cabinets', 'limite_ia_blocage_usd', 'SELECT')) then
    raise exception 'Un rôle de l''API lit encore les plafonds de l''assistant (un droit d''un autre donneur, ou de PUBLIC) : la migration ne s''applique pas.';
  end if;
  if exists (select 1 from (values ('anon'), ('authenticated')) r(n)
              cross join pg_attribute a
              where a.attrelid = 'public.cabinets'::regclass and a.attnum > 0 and not a.attisdropped
                and a.attname not in ('limite_ia_alerte_usd', 'limite_ia_blocage_usd')
                and not has_column_privilege(r.n, 'public.cabinets', a.attname::text, 'SELECT')) then
    raise exception 'Une colonne de cabinets hors des plafonds n''est plus lisible par un rôle de l''API.';
  end if;
  if (select count(*) from pg_proc p
       where p.oid = 'public.plafonds_de_l_assistant()'::regprocedure
         and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) <> 1 then
    raise exception 'La lecture des plafonds de l''assistant n''a pas les droits que la migration pose.';
  end if;
end
$fin$;
