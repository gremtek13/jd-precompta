-- INAL1 : LE STOCKAGE GARDE LE FICHIER D'UNE PIÈCE FIGÉE ET D'UNE SOURCE CITÉE PAR LA RÉVISION (ligne 44, INAL-Q5 sur sa
-- recommandation ; PRÉPARÉE, PAS APPLIQUÉE). La conception : HISTORIQUE.md, « 10/11/2026 — L'INALTÉRABILITÉ ET L'ARCHIVAGE À
-- VALEUR PROBANTE : LA CONCEPTION (LIGNE 44) » ; le récit : « 10/11/2026 — INAL1 ET INAL2 : LA PIÈCE FIGÉE DANS LE STOCKAGE
-- ET L'EMPREINTE EN FORME 2 (PRÉPARÉES, PAS APPLIQUÉES) ». L'essai : supabase/essais/pieceFigeeDansLeStockage.sql (sur une
-- réplique seulement : il supprime des lignes de `storage.objects`) et le bloc PF de supabase/essais/rls.sql (en production
-- aussi). Le retour : supabase/preparees/retour/20261110120050_retour_piece_figee_dans_le_stockage.sql.
--
-- LE DÉFAUT. La ligne d'une pièce qui justifie une écriture validée est figée par la base (`garder_piece_validee` : ni
-- modifiée, ni supprimée, sauf avec son dossier), comme celle d'une pièce ou d'un document que la révision cite
-- (`garder_source_citee`). Son FICHIER ne l'était pas : `pieces_storage_delete` laisse à qui administre le dossier retirer
-- l'objet du seau `pieces`, et la ligne figée désigne alors un fichier disparu — la preuve de l'écriture validée perdue, son
-- empreinte (`storage_hash`) ne vérifiant plus rien. Les sources : la conservation des documents comptables et des pièces
-- justificatives sous la forme où ils ont été établis ou reçus (LPF, art. L102 B) ; l'intangibilité des écritures validées
-- et la clôture (PCG, art. 1031-3 et 1031-4 en 2026, les 921-3 et 921-4 que cite encore le BOFiP ; BOI-BIC-DECLA-30-10-20-40,
-- § 110 à 140), relevées par la conception.
--
-- LE MÉCANISME, TEL QUE LE CATALOGUE LE DIT (relevé du 10/11/2026, la production égale à la réplique) :
--   - l'API du stockage supprime sous la session de l'appelant : elle pose `storage.allow_delete_query` (sans lui,
--     `storage.protect_delete` refuse toute suppression SQL, 42501), puis supprime en nommant ses lignes et en les rendant ;
--     une ligne que la policy écarte n'est simplement pas supprimée (aucune erreur), et le fichier ne part pas ;
--   - une suppression qui nomme ou rend ses lignes ne voit que celles que la policy de LECTURE ouvre (PostgreSQL 17,
--     « CREATE POLICY », « Policies Applied by Command Type ») : le droit réel est la lecture ET la suppression ;
--   - `postgres`, qui applique les migrations, n'est pas propriétaire de `storage.objects` : supautils lui ouvre ses policies
--     (`supautils.policy_grants`, qui la nomme). « ALTER POLICY » change en place les rôles et le prédicat d'une policy (ni
--     sa commande, ni son caractère permissif) : rien n'est retiré, la policy garde son nom.
--
-- CE QUI CHANGE.
--   1. `fichier_fige(p_chemin)`, une lecture `security definer` : vrai quand le chemin est le fichier (`storage_path`) ou la
--      version lisible (`lisible_path`) d'une pièce que la base fige — une écriture validée la cite, directement ou par le
--      bien immobilisé qu'elle justifie (`exercice_figeant_la_piece`, la règle même de `garder_piece_validee`), ou la
--      révision la cite (une preuve, `revision_preuves`, ou le dossier permanent, `dossier_permanent`, la règle même de
--      `garder_source_citee`) —, ou le fichier d'un document divers que la révision cite. Elle cherche le chemin dans
--      toutes les lignes, pas seulement dans le dossier que le chemin nomme : une ligne figée qui désignerait le fichier d'un
--      autre dossier le retient aussi. Elle ne répond qu'à qui administre le dossier du chemin (`admin_du_dossier`) : à tout
--      autre — et pour un chemin qui ne commence pas par un identifiant de dossier — elle rend NUL, sans rien lever ; appelée
--      en RPC, elle n'apprend donc rien à qui ne voit pas déjà le dossier. Ses trois index (le chemin d'une pièce, sa version
--      lisible, le chemin d'un document) : la policy l'appelle pour chaque fichier qu'une suppression vise.
--   2. `pieces_storage_delete` : son prédicat d'hier, PLUS « et le fichier n'est pas figé » (`not fichier_fige(name)` : nul
--      vaut refus), et `to authenticated` au lieu de `public` (CLAUDE.md : toute policy neuve porte `to authenticated` ;
--      l'anonyme n'y passait déjà pas, `admin_du_dossier` étant faux sans session). Un resserrement : rien de ce qu'elle
--      refusait ne s'ouvre. Le super-administrateur ne supprime plus, lui non plus, le fichier d'une pièce figée.
--
-- LES DEUX SORTIES, OUVERTES.
--   - La suppression d'un dossier (src/lib/suppressionDossier.ts) vide le stockage AVANT de supprimer la ligne du dossier —
--     et non après : la lecture et la suppression d'un fichier passent par `admin_du_dossier`, qui lit la ligne du dossier ;
--     sitôt celle-ci partie, le chef du cabinet ne voit plus ses fichiers. Le premier passage laisse donc les fichiers figés
--     en place, la ligne du dossier part avec ses pièces (la cascade, que les gardes laissent passer), et un SECOND passage
--     (le même commit) retire ces fichiers, que plus aucune ligne ne fige : le super-administrateur les atteint encore
--     (`admin_du_dossier` le dit vrai sans la ligne) ; un chef qui ne l'est pas, non, et le bilan de la suppression les compte
--     (« préviens l'administrateur pour qu'il les retire à la main ») — question INAL12-Q1.
--   - La restauration ne supprime aucun fichier de ce seau : elle réinsère des lignes, et le retrait d'une restauration
--     interrompue laisse le stockage intact (RESTAU-Q2). Le dépôt (`pieces_storage_insert`) et la lecture ne changent pas.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune autre policy, aucune fonction d'hier, aucun déclencheur ; le chemin d'un
-- fichier d'hier, sa lecture, son dépôt. Les Edge Functions sous la clé secrète ne passent pas par la RLS (elles n'y
-- passaient pas). Un fichier qu'aucune ligne figée ne désigne se supprime comme hier.
--
-- LA VOIE. Le texte ne porte ni retrait d'objet ni suppression de donnée ; mais le mot « delete » y paraît — le nom de la
-- policy, qu'« ALTER POLICY » exige, et la garde qui la lit — : par la règle de la session, elle SE COLLE dans l'éditeur SQL
-- de Supabase, dans une transaction, avec sa ligne d'historique, sur l'accord du cabinet. Aucune barre oblique inverse,
-- aucun retour chariot.
--
-- VERSION PROVISOIRE : le fichier prendra la version que portera sa ligne d'historique.

-- ══ 0. La garde : l'état d'hier, entier, ou rien ══════════
do $garde$
declare
  v record;
  v_chemin constant text := current_setting('search_path');
begin
  if to_regprocedure('public.fichier_fige(text)') is not null then
    raise exception 'La fonction fichier_fige est déjà en base : cette migration ne se rejoue pas.';
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null
     or not exists (select 1 from storage.buckets where id = 'pieces')
     or to_regprocedure('storage.foldername(text)') is null
     or md5((select p.prosrc from pg_proc p where p.oid = to_regprocedure('storage.foldername(text)')))
        is distinct from 'd74c9ac376970bf5b265ecb58e855df9' then
    raise exception 'Le stockage n''est pas celui que la migration suppose (storage.objects, storage.buckets, le seau pieces, storage.foldername) : relire la base.';
  end if;
  -- Les tables et colonnes que la fonction lit.
  for v in select * from (values
      ('public.pieces', 'storage_path'), ('public.pieces', 'lisible_path'), ('public.documents_divers', 'storage_path'),
      ('public.revision_preuves', 'piece_id'), ('public.revision_preuves', 'document_id'),
      ('public.dossier_permanent', 'piece_id'), ('public.dossier_permanent', 'document_id')) x(rel, col) loop
    if to_regclass(v.rel) is null or not exists (select 1 from pg_attribute a where a.attrelid = to_regclass(v.rel)
                                                   and a.attname = v.col and not a.attisdropped) then
      raise exception 'La colonne %.% manque : relire la base.', v.rel, v.col;
    end if;
  end loop;
  -- Les fonctions qu'elle appelle, et les deux gardes dont elle redit la règle, à l'empreinte de leur corps (les retours
  -- chariot d'un collage écartés).
  for v in select * from (values
      ('public.admin_du_dossier(uuid)', '30e9b7246cb939741fe58f4ffc27adf4'),
      ('public.is_super_admin()', 'a9159138778422a43ba8d8c21240c9bb'),
      ('public.exercice_figeant_la_piece(uuid)', '78624664a1794b06816acb2e70436802'),
      ('public.garder_piece_validee()', 'dd346c293980604655f8bcb8d212614e'),
      ('public.garder_source_citee()', 'cc60dc7c667d4a234bfacee53407fd6d')) x(fonction, empreinte) loop
    if to_regprocedure(v.fonction) is null
       or md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), ''))
          is distinct from v.empreinte then
      raise exception 'La fonction % n''est pas celle que cette migration suppose : relire la migration contre la base avant de l''appliquer.', v.fonction;
    end if;
  end loop;
  -- Toute la surface de suppression de storage.objects, policies permissives de suppression et « pour tout », à
  -- l'empreinte de leur prédicat (lu sous un chemin vide, qui nomme le schéma de chaque fonction) : une autre policy qui
  -- ouvrirait le seau pieces s'ajouterait par OU au resserrement et le défairait. Une policy restrictive ne fait que
  -- restreindre (`deux_facteurs`, si sa migration passe avant) : elle n'entre pas dans la comparaison.
  perform set_config('search_path', '', true);
  if (select string_agg(p.polname || ':' || p.polcmd::text || ':' || md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')),
                        ',' order by p.polname collate "C")
        from pg_policy p where p.polrelid = 'storage.objects'::regclass and p.polcmd in ('d', '*') and p.polpermissive)
     is distinct from 'cabinet_logos_suppression_chef:d:fc46cee26a76edcb9a6f03a0d3cd7b1e,packs_storage_all:*:a8ac8b3ed86beb70e800f88abb083b3b,pieces_storage_delete:d:b5d0298fe469d6ccb5b73a7520156ec3,ventes_suppression_par_le_chef:d:f4be98cf500b3037eba40f0f8e3ea94c'
     or not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                     and p.polname = 'pieces_storage_delete' and p.polcmd = 'd' and p.polpermissive
                     and p.polroles = array[0]::oid[] and p.polwithcheck is null) then
    raise exception 'Les policies de suppression de storage.objects ne sont plus celles d''hier : relire la migration contre la base avant de l''appliquer.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

-- ══ 1. Les index que la policy lit ══════════
create index pieces_storage_path_idx on public.pieces (storage_path);
create index pieces_lisible_path_idx on public.pieces (lisible_path) where lisible_path is not null;
create index documents_divers_storage_path_idx on public.documents_divers (storage_path);

-- ══ 2. Le fichier figé par sa ligne ══════════
create function public.fichier_fige(p_chemin text)
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
                or exists (select 1 from public.dossier_permanent d where d.piece_id = p.id)))
      or exists (
        select 1 from public.documents_divers dd
         where dd.storage_path = p_chemin
           and (exists (select 1 from public.revision_preuves r where r.document_id = dd.id)
                or exists (select 1 from public.dossier_permanent d where d.document_id = dd.id)))
  end
$$;

revoke execute on function public.fichier_fige(text) from public, anon;
grant execute on function public.fichier_fige(text) to authenticated;

comment on function public.fichier_fige(text) is
  'Vrai quand le chemin est le fichier (ou la version lisible) d''une pièce que la base fige — une écriture validée la cite, directement ou par son bien immobilisé, ou la révision la cite — ou le fichier d''un document divers que la révision cite ; nul pour qui n''administre pas le dossier du chemin, et pour un chemin qui ne commence pas par un dossier. La policy pieces_storage_delete refuse la suppression d''un tel fichier (INAL1, ligne 44).';

-- ══ 3. La policy de suppression du seau pieces, resserrée ══════════
alter policy pieces_storage_delete on storage.objects
  to authenticated
  using (bucket_id = 'pieces' and admin_du_dossier(((storage.foldername(name))[1])::uuid) and not public.fichier_fige(name));

-- ══ 4. La garde de fin : ce que la base porte désormais ══════════
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'storage.objects'::regclass
                  and p.polname = 'pieces_storage_delete' and p.polcmd = 'd' and p.polpermissive
                  and p.polroles = array['authenticated'::regrole]::oid[] and p.polwithcheck is null
                  and pg_get_expr(p.polqual, p.polrelid)
                      = '((bucket_id = ''pieces''::text) AND public.admin_du_dossier(((storage.foldername(name))[1])::uuid) AND (NOT public.fichier_fige(name)))')
     or not exists (select 1 from pg_depend d join pg_policy p on p.oid = d.objid
                     where d.classid = 'pg_policy'::regclass and p.polname = 'pieces_storage_delete'
                       and p.polrelid = 'storage.objects'::regclass and d.refclassid = 'pg_proc'::regclass
                       and d.refobjid = 'public.fichier_fige(text)'::regprocedure) then
    raise exception 'Garde de fin : la policy pieces_storage_delete n''est pas celle que la migration pose.';
  end if;
  if has_function_privilege('anon', 'public.fichier_fige(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.fichier_fige(text)', 'execute')
     or not (select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=public']
               from pg_proc p where p.oid = 'public.fichier_fige(text)'::regprocedure) then
    raise exception 'Garde de fin : la fonction fichier_fige n''a pas les droits ou la forme attendus.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
