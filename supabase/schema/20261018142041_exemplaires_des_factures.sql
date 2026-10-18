-- L'EXEMPLAIRE D'UNE FACTURE ÉMISE, EN BASE (ligne 28.6 ; chantier EC-Q3, étape VF1a ; décision du cabinet du 17/10/2026,
-- 28.6-Q1 : « le PDF d'une facture émise, que rien ne reliait à elle, se relie à elle — une migration ». Conception :
-- HISTORIQUE.md, « LA FACTURE VALIDÉE, SOURCE DE SA VENTE : LA CONCEPTION », § 8 et § 14 ; le pont d'aujourd'hui : « UNE
-- VENTE PEUT ENTRER DEUX FOIS »). Présentée au cabinet avant d'être appliquée.
--
-- POURQUOI. Une facture émise par l'application ne compte nulle part : sa vente entre par une pièce de vente — la jumelle
-- qui revient de la plateforme du client ou de Super PDP, ou le PDF que le cabinet dépose. Le pont (src/lib/ventesJumelles.ts)
-- reconnaît la jumelle par trois faits qui ne changent pas — le flux de sa transmission, l'identifiant de Super PDP,
-- l'identité G1.42 que son original dit — et dit une vente portée par plusieurs pièces. Le PDF, lui, n'a aucun de ces
-- faits : déposé à côté de la jumelle, il comptait la vente une seconde fois, et rien ne pouvait le voir — le pont
-- s'interdit de rapprocher un montant, une date ou un nom. Il faut donc que le cabinet le DÉSIGNE : « cette pièce est un
-- exemplaire de la facture F… ».
--
-- CE QU'ELLE POSE, et rien d'autre :
--   - `pieces.facture_id` : la facture émise dont la pièce est un EXEMPLAIRE (l'original revenu de la plateforme, ou le
--     PDF) — une facture VALIDÉE du MÊME dossier, sur une pièce de VENTE. Plusieurs pièces peuvent être exemplaires d'une
--     même facture (la jumelle et le PDF) : aucune unicité ;
--   - sa garde, `garder_exemplaire_facture` : la désignation ne change que par les deux fonctions ci-dessous, sauf la
--     restauration d'une sauvegarde par le super-administrateur, qui réinsère une pièce telle qu'elle était ;
--   - deux fonctions du CABINET seul (`admin_du_dossier`), `SECURITY DEFINER`, l'accès d'abord, des refus dans un ordre
--     fixé : `designer_exemplaire_facture` et `defaire_exemplaire_facture`.
-- Aucune policy nouvelle, aucune policy changée. AUCUN EFFET SUR CE QUI SE COMPTE : une pièce désignée compte comme avant
-- (une facture émise ne compte toujours nulle part tant que le dossier n'a pas basculé — étape VF2) ; ce qui change, c'est
-- que le pont la voit : la désignation est sa quatrième preuve, et une vente portée par la jumelle et par le PDF désigné
-- se dit « comptée deux fois » (la Checklist, le préalable bloquant `ventes-en-double`).
--
-- UNE FACTURE D'AVOIR A UN EXEMPLAIRE, comme une facture. Un avoir est une facture émise (type 381), transmis et revenu
-- comme une facture ; le pont le reconnaît déjà par son identité (nature « avoir ») ; son PDF déposé compterait deux fois
-- avec sa jumelle comme celui d'une facture — c'est le trou que 28.6-Q1 ferme ; et, quand le dossier basculera, l'avoir
-- sera source de sa vente comme sa facture (conception, § 9). La garde n'exige que la facture validée — un avoir naît
-- validé.
--
-- LA CLÉ, SANS ACTION À LA SUPPRESSION de la facture (NO ACTION) : une facture validée ne se supprime qu'avec son dossier
-- (`garder_factures_validees`, 07/10/2026), dont la cascade emporte aussi ses pièces — la clé ne se vérifie qu'à la fin de
-- l'instruction ; un brouillon n'a jamais d'exemplaire (la garde). Une suppression en cascade emporterait un
-- justificatif, une remise à nul ferait perdre le lien sans le dire (la famille des clés remises à nul est close) : si un
-- chemin venait un jour à supprimer une facture qui a un exemplaire, la base refuserait. Le patron de
-- `statuts_factures_recus.facture_id` et de `transmissions_encaissements.facture_id`. L'index partiel sert cette
-- vérification et la lecture des exemplaires d'une facture.
--
-- CE QUI FIGE LA DÉSIGNATION : le gel de sa pièce. Une pièce qui porte une écriture validée, ou qui justifie un bien dont
-- une écriture l'est, ne change plus — `garder_piece_validee` (04/10/2026) compare la ligne entière, `facture_id`
-- compris — ; les deux fonctions le disent avant d'écrire, au critère même de la garde (`exercice_figeant_la_piece`,
-- étape e2), sous le verrou partagé de la validation (`cle_validation`) : une validation n'avance pas pendant qu'une
-- désignation s'écrit. La facture, elle, est figée dès sa validation.
--
-- LA GARDE. Une pièce ne naît pas désignée : un dépôt, un import, un e-mail, le client qui dépose — la policy d'insertion
-- de `pieces` ne nomme pas la colonne, et la garde refuse (42501) —, sauf la restauration par le super-administrateur. La
-- désignation ne change que par les deux fonctions, qui l'annoncent à la garde par le réglage `jd.exemplaire_facture`
-- (le patron de `jd.validation_facture`), pour la seule pièce qu'elles écrivent : le cabinet qui modifie une pièce par sa
-- policy ne la pose ni ne la retire (42501). Toute ligne qui porte une désignation reste de son dossier et reste une
-- vente : la désignation d'une facture d'un autre dossier, d'un brouillon, ou sur une pièce qui n'est pas une vente, se
-- refuse (23514), y compris à la restauration ; une pièce désignée ne change ni de dossier ni de nature — défaire
-- d'abord la désignation (23514). Aux droits de l'appelant (la garde ne lit que la facture : le cabinet et le
-- super-administrateur la voient, les fonctions la lisent en propriétaire), `search_path` fixé, hors de portée en RPC.
--
-- LES REFUS DES DEUX FONCTIONS, dans cet ordre — src/lib/exemplairesDesFactures.ts les dit avant le clic, dans le même
-- ordre et sous les mêmes mots :
--   désigner : 1. l'accès au dossier ANNONCÉ, ou un dossier qui n'existe pas (42501) ; 2. la pièce, dans ce dossier
--   (P0002) ; 3. une pièce de vente ; 4. une pièce que rien ne fige ; 5. une pièce qui n'est pas déjà désignée — à cette
--   facture, ou à une autre (défaire d'abord) ; 6. la facture, dans ce dossier (P0002) ; 7. une facture validée.
--   défaire : 1. l'accès (42501) ; 2. la pièce, dans ce dossier (P0002) ; 3. une pièce désignée ; 4. une pièce que rien
--   ne fige.
-- Les autres en 22023. Le client du dossier, quelles que soient ses cases, n'y a pas accès : `admin_du_dossier` est le
-- cabinet. Il LIT la désignation de ses pièces, comme toute leur ligne (la policy de lecture de `pieces`) : un lien, sans
-- rien de la facture pour un accès qui ne porte pas « Ventes ».
--
-- CE QU'ELLE NE FAIT PAS : rien de la bascule (VF2), rien de l'exemplaire d'une facture SOURCE (VF6 : `G3`, `G4`, une
-- pièce de vente qui ne se valide que désignée), aucune lecture du pont en SQL — la cohérence des preuves (une pièce
-- désignée à une facture et rattachée à une autre par son flux ou son identité) est dite par le pont, « à vérifier »,
-- jamais refusée ici ; aucun écran (VF1b), aucune Edge Function. Le texte ne porte aucune instruction qui retire quoi
-- que ce soit : le retour arrière est donné à part, et ne vient qu'après le drapeau `EXEMPLAIRES_DES_FACTURES_EXPORTES`
-- rebaissé en ligne.
--
-- Données mesurées le 18/10/2026 (comptes seulement) : 6 factures émises, toutes validées, dans un bac à sable ; 6 pièces
-- de vente, dont une validée ; aucune jumelle. Tout ce qui suit est latent.

-- ══ Ce qu'elle suppose ══════════
do $prealable$
begin
  if to_regprocedure('public.exercice_figeant_la_piece(uuid)') is null
     or to_regprocedure('public.garder_factures_validees()') is null
     or to_regprocedure('public.admin_du_dossier(uuid)') is null
     or to_regprocedure('public.cle_validation(uuid)') is null then
    raise exception 'Cette migration suppose la facture validée figée (garder_factures_validees), la validation des exercices (cle_validation) et la fiche « hors de France » (exercice_figeant_la_piece).';
  end if;
end
$prealable$;

-- ══ La colonne ══════════
alter table public.pieces add column facture_id uuid references public.factures_emises (id);

create index pieces_facture_idx on public.pieces (facture_id) where facture_id is not null;

comment on column public.pieces.facture_id is
  'La facture émise dont la pièce est un EXEMPLAIRE (l''original revenu de la plateforme, ou le PDF), désignée par le cabinet : une facture validée du même dossier, sur une pièce de vente. Posée et retirée par designer_exemplaire_facture et defaire_exemplaire_facture seules, figée avec la pièce.';

-- ══ La garde ══════════
create function public.garder_exemplaire_facture() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_dossier uuid;
  v_statut text;
  v_numero text;
begin
  if tg_op = 'INSERT' then
    if new.facture_id is null then
      return new;
    end if;
    -- Une pièce ne naît désignée que réinsérée par la restauration d'une sauvegarde : le super-administrateur.
    if not public.is_super_admin() then
      raise exception 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'
        using errcode = '42501';
    end if;
  elsif new.facture_id is distinct from old.facture_id then
    -- Les deux fonctions annoncent la pièce qu'elles écrivent ; toute autre écriture de la désignation est refusée.
    if coalesce(current_setting('jd.exemplaire_facture', true), '') is distinct from old.id::text then
      raise exception 'Une pièce ne se désigne exemplaire d''une facture, et ne cesse de l''être, que par l''application.'
        using errcode = '42501';
    end if;
    if new.facture_id is null then
      return new;
    end if;
  elsif new.facture_id is null then
    return new;
  else
    -- La désignation ne change pas, la pièce si : elle reste de son dossier, et reste une vente.
    if new.dossier_id is distinct from old.dossier_id or new.type_piece is distinct from 'vente' then
      select f.numero into v_numero from public.factures_emises f where f.id = new.facture_id;
      if new.dossier_id is distinct from old.dossier_id then
        raise exception 'Cette pièce est l''exemplaire de la facture % : elle ne change plus de dossier — défaire d''abord la désignation.',
          coalesce(v_numero, '(sans numéro)') using errcode = '23514';
      end if;
      raise exception 'Cette pièce est l''exemplaire de la facture % : elle reste une pièce de vente — défaire d''abord la désignation.',
        coalesce(v_numero, '(sans numéro)') using errcode = '23514';
    end if;
    return new;
  end if;
  -- Une désignation qui se pose, par une fonction ou par la restauration : une facture validée du même dossier, sur une
  -- pièce de vente.
  select f.dossier_id, f.statut into v_dossier, v_statut from public.factures_emises f where f.id = new.facture_id;
  if not found or v_dossier is distinct from new.dossier_id then
    raise exception 'Une pièce n''est l''exemplaire que d''une facture de son dossier.' using errcode = '23514';
  end if;
  if v_statut is distinct from 'validee' then
    raise exception 'Seule une facture validée a un exemplaire.' using errcode = '23514';
  end if;
  if new.type_piece is distinct from 'vente' then
    raise exception 'Seule une pièce de vente est l''exemplaire d''une facture émise.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_exemplaire_de_facture
  before insert or update of facture_id, dossier_id, type_piece on public.pieces
  for each row execute function public.garder_exemplaire_facture();

-- ══ Désigner une pièce exemplaire d'une facture ══════════
-- Sous le verrou partagé de la validation, puis celui de la ligne de la pièce : deux désignations de la même pièce se
-- suivent, et la seconde voit la première. Rend la pièce écrite.
create function public.designer_exemplaire_facture(p_dossier_id uuid, p_piece_id uuid, p_facture_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
  v_numero text;
  v_statut text;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, cherchée dans ce dossier seulement : un compte qui n'y a pas droit n'apprend pas qu'elle existe.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce de vente : l'exemplaire d'une facture émise est une vente.
  if v_piece.type_piece <> 'vente' then
    raise exception 'Seule une pièce de vente est l''exemplaire d''une facture émise.' using errcode = '22023';
  end if;
  -- 4. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa désignation ne change plus.', v_annee
      using errcode = '22023';
  end if;
  -- 5. Une pièce déjà désignée : à cette facture, ou à une autre, qu'il faut défaire d'abord.
  if v_piece.facture_id is not null then
    select coalesce(f.numero, '(sans numéro)') into v_numero from public.factures_emises f where f.id = v_piece.facture_id;
    if v_piece.facture_id = p_facture_id then
      raise exception 'Cette pièce est déjà l''exemplaire de la facture %.', v_numero using errcode = '22023';
    end if;
    raise exception 'Cette pièce est déjà l''exemplaire de la facture % : défaire cette désignation avant d''en faire une autre.',
      v_numero using errcode = '22023';
  end if;
  -- 6. La facture, cherchée dans ce dossier seulement.
  select f.statut into v_statut from public.factures_emises f where f.id = p_facture_id and f.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Facture introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 7. Une facture validée : un brouillon n'est pas encore une facture émise.
  if v_statut <> 'validee' then
    raise exception 'Seule une facture validée a un exemplaire : un brouillon n''est pas encore une facture émise.'
      using errcode = '22023';
  end if;
  -- Le réglage dit à la garde que CETTE pièce se désigne par cette fonction ; il ne vaut que pour elle, et il est retiré
  -- aussitôt.
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set facture_id = p_facture_id where id = p_piece_id returning * into v_piece;
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ Défaire la désignation ══════════
-- Sous les mêmes verrous. La pièce redevient une pièce que rien ne relie à une facture, sauf ce que le pont en déduit.
create function public.defaire_exemplaire_facture(p_dossier_id uuid, p_piece_id uuid)
returns public.pieces
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piece public.pieces;
  v_annee integer;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  -- 2. La pièce, dans ce dossier.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Une pièce désignée.
  if v_piece.facture_id is null then
    raise exception 'Cette pièce n''est l''exemplaire d''aucune facture.' using errcode = '22023';
  end if;
  -- 4. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa désignation ne change plus.', v_annee
      using errcode = '22023';
  end if;
  perform set_config('jd.exemplaire_facture', p_piece_id::text, true);
  update public.pieces set facture_id = null where id = p_piece_id returning * into v_piece;
  perform set_config('jd.exemplaire_facture', '', true);
  return v_piece;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire ; la garde ne sert qu'au déclencheur.
revoke execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) from public, anon;
grant execute on function public.designer_exemplaire_facture(uuid, uuid, uuid) to authenticated;
revoke execute on function public.defaire_exemplaire_facture(uuid, uuid) from public, anon;
grant execute on function public.defaire_exemplaire_facture(uuid, uuid) to authenticated;
revoke execute on function public.garder_exemplaire_facture() from public, anon, authenticated;

comment on function public.garder_exemplaire_facture() is
  'Garde de la désignation d''une pièce exemplaire d''une facture : posée et retirée par les deux fonctions seules, ou réinsérée par la restauration du super-administrateur ; une facture validée du même dossier, sur une pièce de vente qui ne change ni de dossier ni de nature.';
comment on function public.designer_exemplaire_facture(uuid, uuid, uuid) is
  'Désigne une pièce de vente exemplaire d''une facture émise validée du même dossier (le cabinet seul), après les refus dits dans la migration exemplaires_des_factures.';
comment on function public.defaire_exemplaire_facture(uuid, uuid) is
  'Défait la désignation d''une pièce exemplaire d''une facture (le cabinet seul), tant que rien ne fige la pièce.';
