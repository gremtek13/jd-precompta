-- QUI OUVRE OU RETIRE UN ACCÈS CLIENT, MÊME SANS CASE COCHÉE (espace client, ligne 51.5 ; P1T-Q2, tranchée par le cabinet le
-- 07/11/2026 : « Oui, plus tard avec l'écran » — la recommandation : « dans la même table, avec l'écran de la trace ») —
-- PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE. Le récit : HISTORIQUE.md, « 13/11/2026 — B4RS-Q1, P1T-Q2 ET RET-Q2 » ; les essais :
-- supabase/essais/traceDesDroits.sql (étapes 41 à 52, EN ATTENTE sans elle) et, sur une réplique seulement,
-- supabase/essais/traceDesDroitsSuppression.sql ; le retour :
-- supabase/preparees/retour/20261113202100_retour_arrivee_et_depart_des_acces.sql.
--
-- LE CONSTAT. La trace des droits (`trace_des_droits`, P1-trace, en production depuis le 07/11/2026) n'écrit une ligne que
-- par CASE qui change : un accès créé ou retiré sans aucune case cochée — l'accès le plus courant, celui qui ne dépose que
-- des pièces — n'y laisse rien ; qui a ouvert l'espace client à qui ne se lit nulle part.
--
-- POURQUOI LA CONTRAINTE CHANGE. Elle ne range pas ce geste sans mentir : `trace_des_droits_droit` n'admet que les sept
-- cases, et `trace_des_droits_coche` veut une case COCHÉE à la création, DÉCOCHÉE au retrait — une ligne « creation » d'un
-- accès sans case dirait cochée une case qu'il ne porte pas. Un huitième mot, « acces » (l'accès lui-même), s'y range :
-- l'accès « arrive en se portant » (cochée, creation) et « part en se portant » (décochée, retrait), la contrainte de la case
-- restant juste mot pour mot. Seule la contrainte du droit change, sous son NOM : la garde de tête de B1
-- (`trois_cases_de_l_acces`, préparée) l'y relit par lui, et y trouve toujours ses trois mots.
--
-- CE QU'ELLE POSE :
--   1. `trace_des_droits_droit` admet « acces » en plus des sept cases (retirée et reposée dans la même transaction : aucune
--      ligne ne change, aucune ne peut manquer à la nouvelle, plus large). Le commentaire de la colonne le dit ; celui de la
--      table, que B1 réécrit, ne change pas ici (il ne dépendrait pas de l'ordre des deux).
--   2. `tracer_les_acces()`, un déclencheur APRÈS l'insertion, la suppression, et la mise à jour du dossier, du compte ou de
--      l'identifiant d'un accès (`memberships_trace_des_droits_acces`) : une ligne « acces » cochée en « creation » quand un
--      accès arrive dans un dossier, décochée en « retrait » quand il en part — un accès emporté vers un autre dossier ou un
--      autre compte part de l'un et arrive dans l'autre —, que l'accès porte ou non des cases ; l'auteur `auth.uid()` (nul
--      sans session), l'instant. Les deux portes de `tracer_les_droits` n'écrivent rien ici non plus : l'insertion du
--      super-administrateur (la restauration réinsère l'accès, puis sa trace telle quelle) et le retrait d'un accès par la
--      suppression de son dossier. Elle écrit sous le réglage `jd.trace_des_droits`, que la garde de la trace exige, et le
--      remet à vide.
--   3. Son nom suit celui de la trace des cases et précède celui de l'adresse d'un accès retiré (P1T-E2,
--      `memberships_trace_des_droits_adresse`) : les déclencheurs d'un même genre tirent dans l'ordre de leur nom, et un accès
--      sans case que la trace nomme désormais voit son adresse retenue à son départ, comme celui qui portait une case (P1T-E2 :
--      l'historique nomme un accès retiré par son adresse). C'est un EFFET VOULU, dit ici : un accès retiré sans case garde
--      son adresse, aussi longtemps que le dossier (RGPD.md, « Gestion des accès »).
--
-- CE QU'ELLE NE CHANGE PAS : `tracer_les_droits` et son déclencheur (que B1 remplace à son empreinte), la garde de la trace,
-- ses policies (le cabinet du dossier lit, le super-administrateur restaure), `memberships`, ses policies et ses gardes ;
-- aucune ligne écrite d'avance — les accès d'avant n'ont ni création ni retrait tracés, l'écran le dit déjà (« la trace ne
-- commence qu'à sa mise en base »).
--
-- L'ORDRE : elle ne suppose que P1-trace (en production) ; avant ou après B1, C4a étant déjà là. L'écran ne connaît le mot
-- qu'avec `ACCES_DANS_LA_TRACE_PREVU` (src/lib/traceDesDroits.ts) : sans lui, une ligne « acces » se compte parmi les mots
-- inconnus et rend la lecture partielle. D'où : LEVER LE DRAPEAU D'ABORD (il ne change rien tant que la base n'écrit pas le
-- mot), puis coller la migration.
--
-- CE QUE LE TEXTE RETIRE : la contrainte `trace_des_droits_droit`, reposée aussitôt plus large sous le même nom — aucune
-- donnée, aucune colonne, aucune table, aucun droit d'un objet qui reste. Le mot de la suppression y paraît aussi dans les
-- événements du déclencheur et `tg_op`. À COLLER dans l'éditeur SQL de Supabase, dans une transaction, avec sa ligne
-- d'historique (le détecteur d'`apply_migration` retient le `drop constraint`). Ni barre oblique inverse, ni retour chariot.
-- Son retour se refuse tant que la trace porte une ligne « acces ».
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une trace dont la contrainte du droit ne serait pas celle de P1-trace, mot pour mot,
-- ou dont la contrainte de la case aurait changé ; une garde de la trace qui ne serait plus celle qui admet l'écriture sous
-- le réglage (l'empreinte de son corps, les retours chariot d'un collage écartés) ; un déclencheur de `memberships` qui
-- tirerait entre la trace des cases et le nouveau, ou après l'adresse et avant lui.
do $garde$
declare
  v_def text;
begin
  if to_regprocedure('public.tracer_les_acces()') is not null
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.memberships'::regclass
                 and t.tgname = 'memberships_trace_des_droits_acces') then
    raise exception 'La migration arrivee_et_depart_des_acces est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.trace_des_droits') is null then
    raise exception 'La trace des droits (trace_des_droits, P1-trace) manque : cette migration l''étend.';
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_catalog.pg_constraint c
   where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit';
  if v_def is distinct from 'CHECK ((droit = ANY (ARRAY[''ventes''::text, ''banque''::text, ''caisse''::text, ''comptes''::text, ''achats''::text, ''frais''::text, ''documents''::text])))' then
    raise exception 'La contrainte du droit de la trace n''est plus celle de P1-trace (%) : la relire avant d''appliquer cette migration.', coalesce(v_def, 'absente');
  end if;
  select pg_get_constraintdef(c.oid) into v_def from pg_catalog.pg_constraint c
   where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_coche';
  if v_def is distinct from 'CHECK ((((geste <> ''creation''::text) OR coche) AND ((geste <> ''retrait''::text) OR (NOT coche))))' then
    raise exception 'La contrainte de la case de la trace n''est plus celle de P1-trace : la relire avant d''appliquer cette migration.';
  end if;
  if md5(replace(coalesce((select p.prosrc from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.garder_trace_des_droits()')), ''), chr(13), ''))
       <> 'a63a4b732282845e7cb30e3ce2dd763d'
     or to_regprocedure('public.is_super_admin()') is null then
    raise exception 'La garde de la trace (garder_trace_des_droits) n''est plus celle que cette migration suppose (empreinte attendue a63a4b73…).';
  end if;
  if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = 'public.memberships'::regclass and not t.tgisinternal
              and (t.tgtype & 2) = 0
              and t.tgname > 'memberships_trace_des_droits' and t.tgname < 'memberships_trace_des_droits_acces') then
    raise exception 'Un déclencheur APRÈS de memberships tirerait entre la trace des cases et celle des accès : relire leurs noms.';
  end if;
end
$garde$;

-- ══ 1. Le huitième mot ══════════
alter table public.trace_des_droits
  drop constraint trace_des_droits_droit,
  add constraint trace_des_droits_droit
    check (droit in ('ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents', 'acces'));

comment on column public.trace_des_droits.droit is
  'La case qui change (« ventes », « banque », « caisse », « comptes », « achats », « frais », « documents »), ou « acces » : l''accès lui-même, qui arrive dans le dossier (cochée, creation) ou en part (décochée, retrait), qu''il porte ou non des cases (P1T-Q2).';

-- ══ 2. Le déclencheur des accès ══════════
-- APRÈS l'écriture, aux droits du propriétaire (la trace n'a aucune policy d'écriture pour une session) : les policies et
-- les gardes de `memberships` ont déjà jugé ; une écriture refusée n'arrive jamais ici. Le réglage dit à la garde de la
-- trace que la ligne vient d'un déclencheur, pour CET accès ; il est remis à vide avant de rendre la main.
create function public.tracer_les_acces() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
begin
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, puis sa trace.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le retrait d'un accès par la suppression de son dossier : sa trace part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  -- Le même accès, dans le même dossier, au même compte : il ne part ni n'arrive.
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    perform set_config('jd.trace_des_droits', old.id::text, true);
    insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
    values (old.dossier_id, old.id, old.user_id, 'acces', false, 'retrait', v_auteur);
  end if;
  if tg_op <> 'DELETE' then
    perform set_config('jd.trace_des_droits', new.id::text, true);
    insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
    values (new.dossier_id, new.id, new.user_id, 'acces', true, 'creation', v_auteur);
  end if;
  perform set_config('jd.trace_des_droits', '', true);
  return null;
end
$$;

comment on function public.tracer_les_acces() is
  'Écrit dans la trace des droits l''arrivée et le départ d''un accès client (P1T-Q2) : « acces » cochée en creation, décochée en retrait, qu''il porte ou non des cases ; l''auteur (auth.uid(), nul sans session) et l''instant. Ni l''insertion du super-administrateur (la restauration), ni le retrait d''un accès par la suppression de son dossier. Après les gardes de memberships, aux droits du propriétaire ; aucun rôle de l''API ne l''exécute.';

create trigger memberships_trace_des_droits_acces
  after insert or update of dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_acces();

revoke execute on function public.tracer_les_acces() from public, anon, authenticated;

-- ══ 3. La garde de fin ══════════
-- Ce qui est posé, à l'empreinte de son corps et sous ses droits ; le déclencheur, entre la trace des cases et l'adresse ; la
-- contrainte, les huit mots.
do $fin$
begin
  if md5(replace((select p.prosrc from pg_catalog.pg_proc p where p.oid = 'public.tracer_les_acces()'::regprocedure), chr(13), ''))
       <> '2eaff09f051b7323a6166c0ae73e88f1'
     or not (select p.prosecdef and p.proconfig = array['search_path=public'] from pg_catalog.pg_proc p
              where p.oid = 'public.tracer_les_acces()'::regprocedure)
     or has_function_privilege('anon', 'public.tracer_les_acces()', 'execute')
     or has_function_privilege('authenticated', 'public.tracer_les_acces()', 'execute') then
    raise exception 'Garde de fin : tracer_les_acces n''a pas le corps ou les droits attendus.';
  end if;
  if (select pg_get_triggerdef(t.oid) || ' ' || t.tgenabled::text from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.memberships'::regclass and t.tgname = 'memberships_trace_des_droits_acces')
     is distinct from 'CREATE TRIGGER memberships_trace_des_droits_acces AFTER INSERT OR DELETE OR UPDATE OF dossier_id, user_id, id ON public.memberships FOR EACH ROW EXECUTE FUNCTION tracer_les_acces() O' then
    raise exception 'Garde de fin : le déclencheur des accès n''est pas celui que la migration pose.';
  end if;
  if (select pg_get_constraintdef(c.oid) from pg_catalog.pg_constraint c
       where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit')
     is distinct from 'CHECK ((droit = ANY (ARRAY[''ventes''::text, ''banque''::text, ''caisse''::text, ''comptes''::text, ''achats''::text, ''frais''::text, ''documents''::text, ''acces''::text])))' then
    raise exception 'Garde de fin : la contrainte du droit de la trace n''admet pas exactement les huit mots.';
  end if;
end
$fin$;
