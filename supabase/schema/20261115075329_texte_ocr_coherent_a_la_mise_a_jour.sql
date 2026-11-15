-- SECU3-Q2 — LE TEXTE LU D'UNE PIÈCE RESTE RATTACHÉ À SON DOSSIER QUAND IL EST RÉÉCRIT (relecture de sécurité du
-- 13/11/2026, point 2 ; PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE ; la question SECU3-Q2 est posée au cabinet, pas encore
-- tranchée). Par l'outil (`apply_migration`) : elle ne retire rien, une policy se modifie en place. Le récit :
-- HISTORIQUE.md, « 13/11/2026 — SECU3-Q1 ET SECU3-Q2 : LE STOCKAGE SANS MISE À JOUR, LE TEXTE LU RELU À SA RÉÉCRITURE
-- (PRÉPARÉES, PAS APPLIQUÉES) » ; le retour :
-- supabase/preparees/retour/20261113194100_retour_texte_ocr_coherent_a_la_mise_a_jour.sql ; l'essai : le bloc TO de
-- supabase/essais/rls.sql ; le garde de source : src/lib/policiesDeMiseAJour.test.ts.
--
-- SOURCES. PostgreSQL 17, « CREATE POLICY » (une mise à jour juge la ligne existante par USING et la ligne proposée par
-- WITH CHECK ; une ligne proposée que WITH CHECK refuse lève une erreur, 42501) et « ALTER POLICY » (la policy garde son
-- nom, sa commande et ce que l'instruction ne nomme pas ; TO remplace ses rôles, WITH CHECK son expression).
--
-- LA RÈGLE. La mise à jour relit la cible comme l'insertion : la ligne mise à jour reste rattachée à une pièce, ou à un
-- document, du dossier qu'elle annonce, et ce dossier est l'un de ceux que l'appelant administre. L'insertion le vérifie
-- depuis le 18/09/2026 (`textes_ocr_couvrent_aussi_les_documents`) ; la mise à jour, réservée au cabinet, ne relisait que
-- le dossier annoncé. Le modèle : `notes_internes_cabinet` (P0), au même rattachement. L'application écrit toujours un
-- texte cohérent (lib/texteOcr.ts : un `upsert` sur la pièce ou le document, avec son dossier) : rien ne change à l'écran.
--
-- L'ÉTAT DE DÉPART. Relu le 13/11/2026 sur la réplique (l'export rejoué, 218 migrations, égal à la production) : la
-- policy de mise à jour juge `admin_du_dossier(dossier_id)` des deux côtés, sans clause TO ; l'insertion relit la pièce et
-- le document. La garde de tête exige l'une et l'autre mot pour mot, et AUCUN texte incohérent en base (un texte dont la
-- pièce ou le document n'est pas du dossier qu'il annonce) : la policy posée refuserait ensuite toute réécriture d'un tel
-- texte, et le cabinet décide d'abord (la requête de lecture qui les compte est dans le récit).
--
-- CE QU'ELLE FAIT. Elle donne à `piece_textes_ocr_update` le WITH CHECK du rattachement — le dossier administré, puis la
-- pièce OU le document de ce dossier, la cible de l'insertion mot pour mot — et la passe à `authenticated` (un prédicat qui
-- ne peut être vrai sans session ne vise pas l'anonyme). Son USING ne change pas.
--
-- CE QU'ELLE NE CHANGE PAS. Qui réécrit un texte (le cabinet du dossier), et quels textes il voit ; l'insertion, la
-- lecture, le retrait ; aucune donnée, aucune table, aucune fonction. Le retour rend le WITH CHECK et le rôle d'hier.

-- La garde de tête : les deux policies d'hier, mot pour mot (lues sous un chemin vide), et aucun texte incohérent.
do $garde$
declare
  v_chemin constant text := current_setting('search_path');
  v_incoherents bigint;
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_update'
                   and p.polcmd = 'w' and p.polpermissive and p.polroles = array[0]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = 'public.admin_du_dossier(dossier_id)'
                   and pg_get_expr(p.polwithcheck, p.polrelid) = 'public.admin_du_dossier(dossier_id)') then
    raise exception 'SECU3-Q2 : la policy piece_textes_ocr_update n''est pas celle d''hier (mise à jour, sans clause TO, le dossier administré des deux côtés) : rien n''est changé sans la relire.';
  end if;
  if (select md5(pg_get_expr(p.polwithcheck, p.polrelid)) from pg_policy p
       where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_insert' and p.polcmd = 'a')
     is distinct from 'f32f02dd4278a751b16259d265b314af' then
    raise exception 'SECU3-Q2 : la policy d''insertion du texte lu n''est plus celle du 18/09/2026 : la cible qu''elle relit est à relire avant de la recopier.';
  end if;
  if exists (select 1 from pg_policy p where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polpermissive
               and p.polcmd in ('w', '*') and p.polname <> 'piece_textes_ocr_update') then
    raise exception 'SECU3-Q2 : une autre policy permissive ouvre la mise à jour du texte lu : la règle ne tiendrait pas.';
  end if;
  select count(*) into v_incoherents
    from public.piece_textes_ocr t
   where not ((t.piece_id is not null and exists (select 1 from public.pieces p where p.id = t.piece_id and p.dossier_id = t.dossier_id))
           or (t.document_id is not null and exists (select 1 from public.documents_divers d where d.id = t.document_id and d.dossier_id = t.dossier_id)));
  if v_incoherents > 0 then
    raise exception 'SECU3-Q2 : % texte(s) lu(s) ne sont pas rattachés à une pièce ou à un document du dossier qu''ils annoncent : le cabinet décide d''abord.',
      v_incoherents;
  end if;
  perform set_config('search_path', v_chemin, true);
end
$garde$;

alter policy piece_textes_ocr_update on public.piece_textes_ocr
  to authenticated
  with check (
    public.admin_du_dossier(dossier_id)
    and (
      (piece_id is not null and exists (
        select 1 from public.pieces p where p.id = piece_textes_ocr.piece_id and p.dossier_id = piece_textes_ocr.dossier_id))
      or (document_id is not null and exists (
        select 1 from public.documents_divers d where d.id = piece_textes_ocr.document_id and d.dossier_id = piece_textes_ocr.dossier_id))
    )
  );

-- La garde de fin : la policy posée, mot pour mot ; sa cible, celle de l'insertion à la lettre.
do $fin$
declare
  v_chemin constant text := current_setting('search_path');
  v_cible constant text := '(((piece_id IS NOT NULL) AND (EXISTS ( SELECT 1' || chr(10)
    || '   FROM public.pieces p' || chr(10)
    || '  WHERE ((p.id = piece_textes_ocr.piece_id) AND (p.dossier_id = piece_textes_ocr.dossier_id))))) OR ((document_id IS NOT NULL) AND (EXISTS ( SELECT 1' || chr(10)
    || '   FROM public.documents_divers d' || chr(10)
    || '  WHERE ((d.id = piece_textes_ocr.document_id) AND (d.dossier_id = piece_textes_ocr.dossier_id))))))';
begin
  perform set_config('search_path', '', true);
  if not exists (select 1 from pg_policy p where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_update'
                   and p.polcmd = 'w' and p.polpermissive and p.polroles = array['authenticated'::regrole]::oid[]
                   and pg_get_expr(p.polqual, p.polrelid) = 'public.admin_du_dossier(dossier_id)'
                   and pg_get_expr(p.polwithcheck, p.polrelid) = '(public.admin_du_dossier(dossier_id) AND ' || v_cible || ')') then
    raise exception 'Garde de fin : la policy piece_textes_ocr_update n''est pas celle que la migration pose.';
  end if;
  if strpos((select pg_get_expr(p.polwithcheck, p.polrelid) from pg_policy p
              where p.polrelid = 'public.piece_textes_ocr'::regclass and p.polname = 'piece_textes_ocr_insert'), ' AND ' || v_cible || ')') = 0 then
    raise exception 'Garde de fin : la cible que la mise à jour relit n''est pas celle de l''insertion.';
  end if;
  perform set_config('search_path', v_chemin, true);
end
$fin$;
