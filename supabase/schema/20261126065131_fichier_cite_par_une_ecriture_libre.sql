-- LE FICHIER D'UNE PIÈCE QU'UNE ÉCRITURE LIBRE CITE NE SE RETIRE PLUS DU STOCKAGE (relecture adverse du 25/11/2026 des
-- migrations 251 à 253 ; PRÉPARÉE le 25/11/2026, PAS APPLIQUÉE). Le récit : HISTORIQUE.md, « 25/11/2026 — LA RELECTURE
-- ADVERSE DES TROIS MIGRATIONS DU JOUR (251 À 253) ». L'essai : supabase/essais/fichierCiteParUneEcritureLibre.sql (sur une
-- réplique seulement : il retire des lignes de `storage.objects`). Le retour :
-- supabase/preparees/retour/20261125200100_retour_fichier_cite_par_une_ecriture_libre.sql. Le test qui confronte ce texte au
-- corps de production : src/lib/fichierCiteParUneEcritureLibre.test.ts.
--
-- LE DÉFAUT. Une écriture libre (EL2, en production depuis le 23/11/2026) cite une pièce du dossier (`piece_citee_id`, une clé
-- sans clause : la LIGNE de la pièce ne part plus, 23503, sauf avec son dossier) ; validée avec son exercice, elle est figée (ni
-- remplacée, ni retirée, 23514) et sa contre-passation (EL7, 251) ne retire pas la citation. Son FICHIER, lui, ne l'est pas :
-- `fichier_fige` (INAL1, 10/11/2026), que la policy de suppression du seau des pièces appelle, ne connaît que la pièce qu'une
-- écriture validée cite, et celle que la révision ou le dossier permanent citent. Qui administre le dossier — son chef, un
-- membre assigné, le super-administrateur — retire donc par l'API du stockage le fichier d'une pièce qu'une écriture libre
-- cite, ou sa version lisible : la ligne désigne alors un fichier disparu, et l'écriture d'un exercice validé perd sa pièce.
-- L'application ne le fait jamais (elle ne retire un fichier qu'après sa ligne, que la clé refuse) ; un appel direct à l'API, si.
-- Mesuré le 25/11/2026 sur une copie de `replique_227` portée à 253 : `fichier_fige` rend faux pour une telle pièce, la
-- suppression telle que l'API la fait (sous la session du chef, le réglage de l'API posé) retire sa ligne de
-- `storage.objects` ; la même sur une pièce que le dossier permanent cite n'en retire aucune. Les sources : la conservation des
-- pièces justificatives sous la forme où elles ont été établies ou reçues (LPF, art. L102 B) ; l'intangibilité des écritures
-- validées (PCG, art. 1031-3) ; relevées par INAL1, non relues ce jour.
--
-- CE QUI CHANGE : `fichier_fige(p_chemin)`, son corps de production au caractère près (5372f8d2…), plus UNE condition — la
-- pièce qu'une écriture libre cite, ouverte ou figée, comme la révision et le dossier permanent figent la leur dès qu'ils la
-- citent : la ligne d'une telle pièce ne part pas non plus, et un fichier retiré sans elle laisserait une ligne sans fichier.
-- Retirer la citation d'une écriture d'un exercice ouvert rend la pièce à la suppression, ligne et fichier, comme hier.
-- `create or replace` garde l'objet, son propriétaire et ses droits (authenticated l'exécute, ni l'anonyme ni PUBLIC) ; la
-- policy n'est pas touchée : elle appelle la fonction. L'index qui sert la lecture est celui d'EL2
-- (`ecritures_libres_piece_citee`, partiel, la pièce citée non nulle).
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune policy, aucun déclencheur, aucune autre fonction. Le départ d'un dossier
-- (src/lib/suppressionDossier.ts) : son premier passage laisse désormais aussi le fichier d'une pièce citée, que le second, après
-- la ligne du dossier (la cascade retire ses écritures libres), retire comme celui d'une pièce figée — le super-administrateur
-- l'atteint, un chef qui ne l'est pas non (la LIMITE d'INAL1, que le bilan compte ; INAL12-Q1). Les Edge Functions sous la clé
-- secrète ne passent pas par la RLS. Le dépôt et la lecture ne changent pas.
--
-- AVEC LA MIGRATION DE L'INVENTAIRE (`validation_de_l_inventaire`, INV3, préparée) : elle remplace elle aussi `fichier_fige`
-- depuis ce corps de production. La seconde appliquée se refuse à sa garde de tête et se reprend sur le corps du jour (REPET-Q2) ;
-- celle-ci ne touche qu'aux pièces et peut passer la première.
--
-- LA VOIE : aucune instruction n'y retire un objet ou une ligne, et le texte n'en porte pas le mot : par l'outil d'application.
-- Ni barre oblique inverse ni retour chariot. VERSION PROVISOIRE : le fichier prendra celle que portera sa ligne d'historique.

-- ══ 0. La garde de tête : l'état de production, entier, ou rien ══════════
do $garde$
declare
  v record;
  v_empreinte text;
begin
  if to_regprocedure('public.fichier_fige(text)') is null then
    raise exception 'La fonction fichier_fige (INAL1) manque : relire la base.';
  end if;
  v_empreinte := md5(replace((select p.prosrc from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure), chr(13), ''));
  if v_empreinte = '5e7016c08bcdda1190d6e56202661113' then
    raise exception 'La migration fichier_cite_par_une_ecriture_libre est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  -- Le corps qu'elle remplace : celui que la production porte depuis INAL1 (le 10/11/2026). Une autre migration qui l'a remplacé
  -- avant (INV3) la fait refuser : elle se reprend alors sur le corps du jour.
  if v_empreinte is distinct from '5372f8d248432f0932598a6efca24ca2' then
    raise exception 'La fonction fichier_fige n''est plus celle que cette migration remplace : relire la migration contre la base avant de l''appliquer.';
  end if;
  -- Les fonctions que le corps appelle, à l'empreinte de leur corps (les retours chariot d'un collage écartés).
  for v in select * from (values
      ('public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('public.exercice_figeant_la_piece(uuid)', '78624664a1794b06816acb2e70436802')) x(fonction, empreinte) loop
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), ''))
          is distinct from v.empreinte then
      raise exception 'La fonction % n''est pas celle que cette migration suppose : relire la base.', v.fonction;
    end if;
  end loop;
  -- La colonne qu'elle lit, et l'index d'EL2 qui la sert.
  if not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.ecritures_libres')
                   and a.attname = 'piece_citee_id' and not a.attisdropped)
     or to_regclass('public.ecritures_libres_piece_citee') is null then
    raise exception 'La pièce citée d''une écriture libre (EL2) ou son index manquent : relire la base.';
  end if;
  -- La policy de suppression du seau des pièces appelle bien cette fonction : sans elle, le changement ne fermerait rien.
  if not exists (select 1 from pg_depend d join pg_policy p on p.oid = d.objid
                  where d.classid = 'pg_policy'::regclass and p.polrelid = 'storage.objects'::regclass and p.polcmd = 'd'
                    and d.refclassid = 'pg_proc'::regclass and d.refobjid = 'public.fichier_fige(text)'::regprocedure) then
    raise exception 'Aucune policy de suppression de storage.objects n''appelle fichier_fige : relire la base.';
  end if;
end
$garde$;

-- ══ 1. Le fichier figé par sa ligne, et par l'écriture libre qui cite la pièce ══════════
create or replace function public.fichier_fige(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Le dossier que le chemin nomme se tire après la forme du chemin, dans cet ordre (`case` n'évalue une branche qu'à son
  -- tour) : un chemin mal formé ne fait rien lever.
  select case
    when p_chemin is null then null
    when p_chemin !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/' then null
    when not public.admin_du_dossier(split_part(p_chemin, '/', 1)::uuid) then null
    else exists (
        select 1 from public.pieces p
         where (p.storage_path = p_chemin or p.lisible_path = p_chemin)
           and (public.exercice_figeant_la_piece(p.id) is not null
                or exists (select 1 from public.revision_preuves r where r.piece_id = p.id)
                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)
                or exists (select 1 from public.ecritures_libres e where e.piece_citee_id = p.id)))
      or exists (
        select 1 from public.documents_divers dd
         where dd.storage_path = p_chemin
           and (exists (select 1 from public.revision_preuves r where r.document_id = dd.id)
                or exists (select 1 from public.dossier_permanent d where d.document_id = dd.id)))
  end
$$;

comment on function public.fichier_fige(text) is
  'Vrai quand le chemin est le fichier (ou la version lisible) d''une pièce que la base fige — une écriture validée la cite, directement ou par son bien immobilisé, ou la révision la cite, ou une écriture libre la cite (relecture adverse du 25/11/2026) — ou le fichier d''un document divers que la révision cite ; nul pour qui n''administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier. La policy de suppression du seau des pièces refuse la suppression d''un tel fichier (INAL1, ligne 44).';

-- ══ 2. La garde de fin : ce que la base porte désormais ══════════
do $fin$
begin
  if md5(replace((select p.prosrc from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure), chr(13), ''))
       is distinct from '5e7016c08bcdda1190d6e56202661113'
     or not (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
               from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure)
     or has_function_privilege('anon', 'public.fichier_fige(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.fichier_fige(text)', 'execute')
     or exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                 where p.oid = 'public.fichier_fige(text)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')
     or not exists (select 1 from pg_depend d join pg_policy p on p.oid = d.objid
                     where d.classid = 'pg_policy'::regclass and p.polrelid = 'storage.objects'::regclass and p.polcmd = 'd'
                       and d.refclassid = 'pg_proc'::regclass and d.refobjid = 'public.fichier_fige(text)'::regprocedure) then
    raise exception 'Garde de fin : fichier_fige n''a pas le corps, la forme ou les droits attendus.';
  end if;
end
$fin$;
