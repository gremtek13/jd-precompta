-- TROIS CASES DE PLUS SUR UN ACCÈS CLIENT : « ACHATS », « NOTES DE FRAIS », « DOCUMENTS » (espace client, ligne 51.5,
-- partie B, étape B1 ; MEG2-Q1, « oui »). La conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU
-- CLIENT : LE PREMIER GROUPE, LA PARITÉ, ET AU-DELÀ », B.0 (« Trois cases de plus, et une qui n'en est pas une ») ; le
-- récit : « 07/11/2026 — TROIS CASES DE PLUS : « ACHATS », « NOTES DE FRAIS », « DOCUMENTS » (B1, LIGNE 51.5) (PRÉPARÉE, PAS
-- APPLIQUÉE) » ; l'essai : supabase/essais/troisCasesDeLAcces.sql ; le bloc TC de supabase/essais/rls.sql.
--
-- B1 N'OUVRE RIEN. Les trois cases se cochent, se lisent et se tracent ; aucune policy ni aucune autre fonction ne les lit
-- pour ouvrir quoi que ce soit au client : ce sera l'objet des étapes qui s'en serviront — B2 les documents du cabinet, B4
-- les achats, B7 les notes de frais —, chacune présentant au cabinet la lecture qu'elle ouvre avant d'être appliquée
-- (CLAUDE.md, « Trois domaines font exception »). L'onglet Accès dit, sous chaque case, qu'elle ne change encore rien.
--
-- CE QU'ELLE POSE.
--   1. `memberships.droit_achats`, `droit_frais` et `droit_documents` : booléens non nuls, FAUX par défaut (règlement (UE)
--      2016/679, art. 25, § 2 : aucun droit n'arrive à un accès sans un geste du cabinet). Le client lit sa ligne
--      (`memberships_select`), ses cases comprises ; aucune policy de mise à jour, pour personne.
--   2. `client_du_dossier` connaît les mots « achats », « frais » et « documents » ; `droits_sur_le_dossier` rend les clés
--      `achats`, `frais` et `documents` — le cabinet du dossier, ou un accès qui porte la case (le patron de « comptes »).
--      Des clés de plus, sans changer la signature : les Edge Functions de la vente ne lisent que leurs quatre clés.
--   3. `changer_droits_acces` à HUIT paramètres (`p_achats`, `p_frais`, `p_documents`, sans valeur par défaut), la seule
--      écriture des droits, au corps de la forme à cinq de C4a plus les trois cases ; les formes à trois, quatre et cinq
--      deviennent chacune un appel DIRECT de la forme à huit, les cases qu'elles ne nomment pas nulles donc inchangées —
--      un seul corps écrit `memberships`, aucune forme n'est retirée (PostgREST distingue les quatre par leurs noms de
--      paramètres ; l'onglet Accès appelle celle à quatre, à cinq sous `SITUATIONS_PUBLIEES_EXPORTEES`, à huit sous
--      `TROIS_CASES_EXPORTEES`).
--   4. La trace des droits connaît les trois cases : la fonction de son déclencheur, au corps de celle de C4a plus les
--      trois cases, et la liste des colonnes du déclencheur ; la contrainte du droit admet leurs mots depuis P1-trace.
--
-- LES REFUS DE LA FORME À HUIT, DANS L'ORDRE : ceux de la forme à cinq — l'appelant qui n'est pas le cabinet du dossier de
-- l'accès, ou un accès qui n'existe pas (42501, les mêmes mots) ; aucun droit donné (22023, ses mots nommant les sept
-- cases) ; l'accès retiré entre la lecture et l'écriture (P0002) ; puis les gardes de `memberships`, inchangées.
--
-- CE QU'ELLE NE CHANGE PAS : les policies de `memberships`, ses gardes (`garder_droit_ventes`, `garder_droit_caisse`) ;
-- `gere_les_ventes`, `gere_la_banque`, `gere_la_caisse` ; les Edge Functions. Aucune ligne écrite d'avance : aucun accès ne
-- reçoit une case.
--
-- L'ORDRE : après `trace_des_droits` (P1-trace) et `situations_publiees` (C4a), dont elle reprend les versions des
-- fonctions qu'elle remplace (pas celles de l'export) ; sa garde de tête refuse une base où l'une manque, en le disant.
--
-- CE QUE LE TEXTE RETIRE : rien — ni objet, ni donnée ; des `create or replace` et une fonction neuve, dont le `revoke`
-- ne retire que les droits que Postgres donne d'office. Ni barre oblique inverse, ni retour chariot. Elle s'applique PAR
-- L'OUTIL, après les deux autres. Son retour (`supabase/preparees/retour/20261107140100`) retire les colonnes et la forme à
-- huit : destructif, à accorder et à coller.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT : le fichier entre dans `supabase/schema/` le jour de son application, sous la
-- version que porte sa ligne d'historique, texte inchangé ; `TROIS_CASES_EXPORTEES` (src/lib/droitsAcces.ts) se lève alors.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans la trace des droits, puis sans la case « Comptes » (en le disant, et
-- dans cet ordre : c'est celui des migrations) ; une case `droit_…` que cette migration ne connaît pas ; une fonction
-- remplacée qui ne serait plus celle que C4a laisse — à l'empreinte de son corps, les retours chariot d'un collage
-- écartés ; une contrainte du droit qui n'admettrait pas les trois mots.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
  v_cases text;
begin
  if exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
              and a.attname in ('droit_achats', 'droit_frais', 'droit_documents'))
     or to_regprocedure('public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean)') is not null then
    raise exception 'La migration trois_cases_de_l_acces est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.trace_des_droits') is null then
    raise exception 'La trace des droits (migration trace_des_droits, P1-trace) manque : appliquer d''abord trace_des_droits, puis situations_publiees (C4a), puis celle-ci, qui étend la trace aux trois cases de plus.';
  end if;
  if to_regclass('public.situations_publiees') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.memberships'::regclass and not a.attisdropped
                     and a.attname = 'droit_comptes') then
    raise exception 'La case « Comptes » (migration situations_publiees, C4a) manque : l''appliquer d''abord, après trace_des_droits ; celle-ci reprend sa forme à cinq de changer_droits_acces et sa trace.';
  end if;
  select string_agg(a.attname, ', ' order by a.attname) into v_cases from pg_attribute a
   where a.attrelid = 'public.memberships'::regclass and a.attnum > 0 and not a.attisdropped
     and left(a.attname, 6) = 'droit_' and a.attname not in ('droit_ventes', 'droit_banque', 'droit_caisse', 'droit_comptes');
  if v_cases is not null then
    raise exception 'memberships porte une case que cette migration ne connaît pas (%) : la reprendre pour la connaître (sa trace, changer_droits_acces) avant de l''appliquer.', v_cases;
  end if;
  for v_attendue in select * from (values
      ('is_super_admin', 'public.is_super_admin()', 1, 'a9159138778422a43ba8d8c21240c9bb'),
      ('admin_du_dossier', 'public.admin_du_dossier(uuid)', 1, '30e9b7246cb939741fe58f4ffc27adf4'),
      ('client_du_dossier', 'public.client_du_dossier(uuid,text)', 1, '083478a55f445159323e710f0b576514'),
      ('droits_sur_le_dossier', 'public.droits_sur_le_dossier(uuid)', 1, '73f1ea4c58adb08324651acbaa3944ff'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid,boolean,boolean)', 3, '01b57bc1d59853eb12b94387bcaf444e'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid,boolean,boolean,boolean)', 3, 'ada1fd5af0ba8916240bb4e17cfd2da2'),
      ('changer_droits_acces', 'public.changer_droits_acces(uuid,boolean,boolean,boolean,boolean)', 3, 'e44cb2f4c878bc20c6b8e8dfaf393579'),
      ('tracer_les_droits', 'public.tracer_les_droits()', 1, '808b209e76b5ddaa079dc2cfac01e934')
    ) as t(nom, signature, formes, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> v_attendue.formes or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que la migration situations_publiees laisse (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.signature, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  select pg_get_constraintdef(c.oid) into v_cases from pg_constraint c
   where c.conrelid = 'public.trace_des_droits'::regclass and c.conname = 'trace_des_droits_droit';
  if strpos(coalesce(v_cases, ''), '''achats''') = 0 or strpos(v_cases, '''frais''') = 0 or strpos(v_cases, '''documents''') = 0 then
    raise exception 'La contrainte du droit de la trace (trace_des_droits_droit) n''admet pas « achats », « frais » et « documents » : la trace serait refusée. Relire trace_des_droits avant d''appliquer cette migration.';
  end if;
end
$garde$;

-- ══ 1. Les trois cases d'un accès ══════════
-- Fausses par défaut : un accès d'aujourd'hui n'en reçoit aucune, et une case ne s'ouvre que d'un geste du cabinet
-- (`changer_droits_acces`, ou l'insertion de l'accès). Ce que chacune ouvrira se dit avec les mots de la conception (B.0) ;
-- l'onglet Accès les reprend, et dit qu'aucune ne change encore rien.
alter table public.memberships
  add column droit_achats boolean not null default false,
  add column droit_frais boolean not null default false,
  add column droit_documents boolean not null default false;

comment on column public.memberships.droit_achats is
  'Le droit « Achats » de cet accès : factures d''achat, échéances, règlements, fournisseurs — les pièces d''achat, leur fichier et leurs montants, ce qui est réglé ou à régler, la réception de ses factures par sa plateforme. Posé par le cabinet par changer_droits_acces, faux par défaut ; il n''ouvre encore rien : l''étape B4 s''en servira (espace client, étape B1 ; MEG2-Q1).';
comment on column public.memberships.droit_frais is
  'Le droit « Notes de frais » de cet accès : saisie et suivi de ses notes de frais — les siennes, sans voir celles des autres ni les achats. Posé par le cabinet par changer_droits_acces, faux par défaut ; il n''ouvre encore rien : l''étape B7 s''en servira (espace client, étape B1 ; MEG2-Q1).';
comment on column public.memberships.droit_documents is
  'Le droit « Documents » de cet accès : documents mis à disposition par le cabinet : 2035, liasse, comptes, attestations, lettre de mission. Posé par le cabinet par changer_droits_acces, faux par défaut ; il n''ouvre encore rien : l''étape B2 s''en servira (espace client, étape B1 ; MEG2-Q1).';

-- ══ 2. Lire les droits de l'appelant : trois mots, trois clés ══════════
-- Le corps de `situations_publiees` (C4a), au caractère près, plus les trois mots. Tout autre mot, ou aucun, rend toujours
-- faux.
create or replace function public.client_du_dossier(p_dossier_id uuid, p_droit text) returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.dossier_id = p_dossier_id
      and m.user_id = auth.uid()
      and case p_droit
            when 'membre' then true
            when 'ventes' then m.droit_ventes
            when 'banque' then m.droit_banque
            when 'caisse' then m.droit_caisse
            when 'comptes' then m.droit_comptes
            when 'achats' then m.droit_achats
            when 'frais' then m.droit_frais
            when 'documents' then m.droit_documents
            else false
          end
  )
$$;

comment on function public.client_du_dossier(uuid, text) is
  'Vrai si l''appelant a un accès à ce dossier qui porte ce droit (« ventes », « banque », « caisse », « comptes », « achats », « frais », « documents », ou « membre » pour un accès quelconque) ; tout autre mot rend faux. Ne lit que memberships.';

-- Le corps de `situations_publiees` (C4a), au caractère près, plus trois clés : le cabinet du dossier, ou un accès qui
-- porte la case (le patron de « comptes »).
create or replace function public.droits_sur_le_dossier(p_dossier_id uuid) returns jsonb
  language sql
  stable
  security definer
  set search_path = public
as $$
  select jsonb_build_object(
    'cabinet', public.admin_du_dossier(p_dossier_id),
    'membre', public.client_du_dossier(p_dossier_id, 'membre'),
    'ventes', public.gere_les_ventes(p_dossier_id),
    'banque', public.gere_la_banque(p_dossier_id),
    'caisse', public.gere_la_caisse(p_dossier_id),
    'comptes', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'comptes'),
    'achats', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'achats'),
    'frais', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'frais'),
    'documents', public.admin_du_dossier(p_dossier_id) or public.client_du_dossier(p_dossier_id, 'documents')
  )
$$;

comment on function public.droits_sur_le_dossier(uuid) is
  'Les droits de l''appelant sur ce dossier : {cabinet, membre, ventes, banque, caisse, comptes, achats, frais, documents}. N''écrit rien.';

-- ══ 3. Changer les droits d'un accès : la forme à huit ══════════
-- Le corps de la forme à cinq (C4a), plus les trois cases : les mêmes refus dans le même ordre, les mots de 22023 nommant
-- les sept cases. UN DROIT NUL EST UN DROIT INCHANGÉ. Elle n'écrit que les sept colonnes, et rend l'accès tel que l'écriture
-- l'a laissé ; les gardes parlent après elle. Écrite AVANT les formes à trois, quatre et cinq, qui l'appellent.
create function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean,
  p_comptes boolean, p_achats boolean, p_frais boolean, p_documents boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dossier uuid;
  v_acces public.memberships;
begin
  select m.dossier_id into v_dossier from public.memberships m where m.id = p_membership_id;
  if v_dossier is null or not public.admin_du_dossier(v_dossier) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  if p_ventes is null and p_banque is null and p_caisse is null and p_comptes is null
     and p_achats is null and p_frais is null and p_documents is null then
    raise exception 'Aucun droit à changer : précise « Ventes », « Banque », « Caisse », « Comptes », « Achats », « Notes de frais » ou « Documents ».' using errcode = '22023';
  end if;
  update public.memberships m
     set droit_ventes = coalesce(p_ventes, m.droit_ventes),
         droit_banque = coalesce(p_banque, m.droit_banque),
         droit_caisse = coalesce(p_caisse, m.droit_caisse),
         droit_comptes = coalesce(p_comptes, m.droit_comptes),
         droit_achats = coalesce(p_achats, m.droit_achats),
         droit_frais = coalesce(p_frais, m.droit_frais),
         droit_documents = coalesce(p_documents, m.droit_documents)
   where m.id = p_membership_id and m.dossier_id = v_dossier
  returning m.* into v_acces;
  if not found then
    raise exception 'Cet accès vient d''être retiré : il n''a plus de droits à changer.' using errcode = 'P0002';
  end if;
  return v_acces;
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) is
  'Change les droits « Ventes », « Banque », « Caisse », « Comptes », « Achats », « Notes de frais » et « Documents » d''un accès client — un droit nul reste tel quel. Réservée au cabinet du dossier de l''accès (42501, aussi pour un accès qui n''existe pas) ; n''écrit que ces sept colonnes ; rend l''accès tel que l''écriture l''a laissé (espace client, étape B1).';

-- Les formes à cinq, à quatre et à trois : un appel direct de la forme à huit, les cases qu'elles ne nomment pas nulles donc
-- inchangées ; leurs refus sont ceux de la forme à huit.
create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean,
  p_comptes boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, p_caisse, p_comptes, null::boolean, null::boolean, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean) is
  'La forme à cinq paramètres de changer_droits_acces : « Achats », « Notes de frais » et « Documents » inchangés — un appel de la forme à huit, qui seule écrit memberships (espace client, étape B1).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean, p_caisse boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, p_caisse, null::boolean,
    null::boolean, null::boolean, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean, boolean) is
  'La forme à quatre paramètres de changer_droits_acces : « Comptes », « Achats », « Notes de frais » et « Documents » inchangés — un appel de la forme à huit, qui seule écrit memberships (espace client, étape B1).';

create or replace function public.changer_droits_acces(p_membership_id uuid, p_ventes boolean, p_banque boolean)
  returns public.memberships
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  return public.changer_droits_acces(p_membership_id, p_ventes, p_banque, null::boolean, null::boolean,
    null::boolean, null::boolean, null::boolean);
end;
$$;

comment on function public.changer_droits_acces(uuid, boolean, boolean) is
  'La forme à trois paramètres de changer_droits_acces : « Caisse », « Comptes », « Achats », « Notes de frais » et « Documents » inchangés — un appel de la forme à huit, qui seule écrit memberships (espace client, étape B1).';

-- ══ 4. La trace des droits connaît les trois cases ══════════
-- La fonction du déclencheur de C4a au caractère près, plus les trois cases ; son déclencheur nomme les trois colonnes. Les
-- droits d'exécution de la fonction restent ceux de P1-trace (aucun rôle de l'API) : `create or replace` les garde.
create or replace function public.tracer_les_droits() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auteur uuid := auth.uid();
  v_droits constant text[] := array['ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents'];
  v_avant boolean[];
  v_apres boolean[];
  i integer;
begin
  -- La restauration : le super-administrateur réinsère un accès tel qu'il a été, puis sa trace. Sa mise à jour et son
  -- retrait d'un accès, si.
  if tg_op = 'INSERT' and public.is_super_admin() then
    return null;
  end if;
  -- Le retrait d'un accès par la suppression de son dossier : le dossier n'est déjà plus là, sa trace part avec lui.
  if tg_op = 'DELETE' and not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return null;
  end if;
  if tg_op <> 'INSERT' then
    v_avant := array[old.droit_ventes, old.droit_banque, old.droit_caisse, old.droit_comptes,
      old.droit_achats, old.droit_frais, old.droit_documents];
  end if;
  if tg_op <> 'DELETE' then
    v_apres := array[new.droit_ventes, new.droit_banque, new.droit_caisse, new.droit_comptes,
      new.droit_achats, new.droit_frais, new.droit_documents];
  end if;
  if tg_op = 'UPDATE' and new.id = old.id and new.dossier_id = old.dossier_id and new.user_id = old.user_id then
    -- Le même accès : une ligne par case qui change.
    perform set_config('jd.trace_des_droits', new.id::text, true);
    for i in 1 .. 7 loop
      if v_avant[i] is distinct from v_apres[i] then
        insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
        values (new.dossier_id, new.id, new.user_id, v_droits[i], v_apres[i], 'changement', v_auteur);
      end if;
    end loop;
  else
    -- Un accès qui part (retiré, ou emporté vers un autre dossier ou un autre compte) : ses cases cochées, en « retrait ».
    if tg_op <> 'INSERT' then
      perform set_config('jd.trace_des_droits', old.id::text, true);
      for i in 1 .. 7 loop
        if v_avant[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (old.dossier_id, old.id, old.user_id, v_droits[i], false, 'retrait', v_auteur);
        end if;
      end loop;
    end if;
    -- Un accès qui arrive (inséré, ou emporté depuis un autre dossier ou un autre compte) : ses cases cochées, en « creation ».
    if tg_op <> 'DELETE' then
      perform set_config('jd.trace_des_droits', new.id::text, true);
      for i in 1 .. 7 loop
        if v_apres[i] then
          insert into public.trace_des_droits (dossier_id, acces_id, client_id, droit, coche, geste, auteur_id)
          values (new.dossier_id, new.id, new.user_id, v_droits[i], true, 'creation', v_auteur);
        end if;
      end loop;
    end if;
  end if;
  perform set_config('jd.trace_des_droits', '', true);
  return null;
end
$$;

create or replace trigger memberships_trace_des_droits
  after insert or update of droit_ventes, droit_banque, droit_caisse, droit_comptes,
    droit_achats, droit_frais, droit_documents,
    dossier_id, user_id, id or delete on public.memberships
  for each row execute function public.tracer_les_droits();

comment on table public.trace_des_droits is
  'La trace des droits « Ventes », « Banque », « Caisse », « Comptes », « Achats », « Notes de frais » et « Documents » des accès client d''un dossier : qui a coché ou décoché quelle case, et quand (étape P1-trace). Écrite par le déclencheur tracer_les_droits seul, réinsérée par la restauration du super-administrateur ; ne se modifie ni ne se supprime hors de la cascade de son dossier. Lue par le cabinet du dossier ; le client n''en voit rien.';

-- ══ 5. Les droits d'exécution ══════════
revoke execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.changer_droits_acces(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
