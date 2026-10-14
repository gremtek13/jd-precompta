-- LES ARTICLES, EN BASE (espace client, étape A1 ; décision du cabinet du 09/10/2026 d'ouvrir l'espace client aux
-- ventes ; conception : HISTORIQUE.md, « L'ESPACE CLIENT, LOGICIEL DE GESTION DU CLIENT : LE PREMIER GROUPE, LA PARITÉ,
-- ET AU-DELÀ », §A.1). Présentée au cabinet avant d'être appliquée : elle OUVRE une lecture au client qui porte la case
-- « Ventes » (CLAUDE.md, « une policy qui lui ouvre une lecture se présente au cabinet »).
--
-- CE QU'UN ARTICLE EST. Rien n'impose un catalogue : l'objet légal est la LIGNE d'une facture — « la quantité, la
-- dénomination précise, et le prix unitaire hors TVA » (C. com., art. L441-9, I), la désignation, la quantité, le prix
-- unitaire hors taxe et le taux (CGI, ann. II, art. 242 nonies A, I). Un article PRÉ-REMPLIT une ligne ; la ligne garde
-- sa copie, jamais un renvoi : la base ne lit jamais un article pour imprimer, transmettre ou compter une facture. D'où :
-- un article se MODIFIE (c'est un catalogue, pas une pièce légale) et rien de ce qu'il a pré-rempli ne bouge ; il se
-- RETIRE — il sort des choix — et se REPREND ; il ne se supprime jamais (il ne coûte rien, et l'étape A7 y fera pointer
-- les lignes qu'il a pré-remplies).
--
-- SES CHAMPS (norme EN 16931, telle que les artefacts de validation de la Commission l'appliquent ; DGFiP, spécifications
-- externes v3.2, annexe 7) : la désignation (BT-153, le nom de l'article, obligatoire), sa description (BT-154),
-- l'identifiant que lui donne le vendeur (BT-155, ici `reference`), l'unité de la quantité (BT-130 : une liste FERMÉE de
-- codes des recommandations 20 et 21 de la CEE-ONU, `C62` — l'unité — par défaut, celle que porte toute ligne
-- aujourd'hui), le prix net hors taxes (BT-146 : positif ou nul, six décimales au plus — G1.16 — et, borne TECHNIQUE
-- reprise des devis, sous dix milliards d'euros), le taux de TVA (BT-152 : un taux que la DGFiP admet, G1.24) et la
-- nature, biens ou services (elle proposera la catégorie de l'opération de la facture, CGI, ann. II, art. 242 nonies A,
-- I, 8° bis, et celle de l'e-reporting, G1.68). Le taux est celui de l'opération QUAND le dossier est redevable : une
-- ligne pré-remplie applique le statut de TVA du jour (src/lib/articles.ts, `ligneDepuisArticle`). L'unité, la référence
-- et la provenance n'entrent sur une ligne de facture qu'avec l'étape A7 : d'ici là, une ligne garde ses quatre champs et
-- la facture électronique son `C62`.
--
-- QUI TIENT LE CATALOGUE — MEG1-Q1, PRISE COMME HYPOTHÈSE (recommandation de la conception, à confirmer par le cabinet) :
-- le cabinet du dossier ET le client qui porte la case « Ventes », par les mêmes fonctions (`gere_les_ventes`), chaque
-- article disant qui l'a créé, changé ou retiré — un identifiant de compte, sans clé vers les comptes (comme
-- `factures_emises.valide_par` : retirer le compte d'un membre parti ne réécrit rien). Si le cabinet répondait « le cabinet
-- seul », les trois fonctions passeraient à `admin_du_dossier` ; « le client seul », à `client_du_dossier(…, 'ventes')`.
--
-- QUI LIT, QUI ÉCRIT. Le cabinet du dossier (`admin_du_dossier`) et un accès client qui porte « Ventes »
-- (`client_du_dossier(…, 'ventes')`) LISENT les articles de ce dossier, toutes leurs colonnes, retirés compris ; la policy
-- du client est à part (`articles_lecture_ventes`, comme les neuf de l'étape P2), `for select to authenticated` : sans
-- session, `auth.uid()` est nul et aucun accès ne lui correspond. PERSONNE n'écrit directement : trois fonctions
-- SECURITY DEFINER vérifient l'accès d'abord, énumèrent les colonnes qu'elles écrivent et refusent dans un ordre fixé,
-- que src/lib/articles.ts redit avant le clic ; le super-administrateur seul insère, pour restaurer une sauvegarde. Aucune
-- policy de mise à jour ni de suppression, pour personne. Un refus d'accès dit « Accès refusé à ce dossier. » (42501) pour
-- tous : il ne dit pas si le dossier existe.
--
-- CE QU'ELLE SUPPOSE : les migrations de l'étape P2 (`ventes_du_client`, `ventes_du_client_facturation`) — le catalogue se
-- range sous la case « Ventes », que la phrase de l'onglet Accès ne dit ouverte qu'avec elles ; son premier bloc le
-- vérifie, et s'arrête sinon. CE QU'ELLE NE FAIT PAS : aucune table d'hier n'est modifiée, aucune policy ni fonction
-- d'hier n'est changée ; aucune donnée n'est lue, écrite ni retirée ; aucun écran (étape A2), aucune Edge Function. Le
-- texte ne porte aucune instruction qui retire quoi que ce soit (le mot n'y paraît que dans `on delete cascade`) :
-- `apply_migration` le prend. Le retour arrière est donné à part. Règlement (UE) 2016/679, art. 25 § 2 : par défaut rien
-- n'est ouvert, la case « Ventes » est fausse tant que le cabinet ne la coche pas.

-- ══ 0. Les migrations de l'étape P2 d'abord ══════════
do $garde$
begin
  if not exists (select 1 from pg_attribute
                  where attrelid = 'public.factures_emises'::regclass and attname = 'valide_par' and not attisdropped)
     or to_regprocedure('public.supprimer_brouillon_facture(uuid, uuid)') is null
     or to_regprocedure('public.gere_les_ventes(uuid)') is null then
    raise exception 'Les migrations ventes_du_client et ventes_du_client_facturation ne sont pas en base : les appliquer d''abord, puis celle-ci.';
  end if;
end
$garde$;

-- ══ 1. La table ══════════
-- La référence est facultative ; donnée, elle tient en un à cent caractères, sans blanc (espace, tabulation, saut de
-- ligne) au début ni à la fin, et elle est UNIQUE dans son dossier — une contrainte TOTALE (deux articles sans référence
-- ne se heurtent pas ; CLAUDE.md : jamais d'index unique partiel) ; un article retiré garde la sienne, qu'on retrouve en
-- le reprenant. Le retrait est entier (l'instant et le compte) ou absent, comme la dernière modification.
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  reference text
    constraint articles_reference_forme
      check (char_length(reference) between 1 and 100 and btrim(reference, E' \t\n\r') = reference),
  designation text not null
    constraint articles_designation_forme
      check (btrim(designation, E' \t\n\r') <> '' and char_length(designation) <= 1000),
  description text
    constraint articles_description_forme check (char_length(description) <= 4000),
  unite text not null default 'C62'
    constraint articles_unite_check
      check (unite in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS')),
  prix_unitaire_ht numeric not null
    constraint articles_prix_check
      check (prix_unitaire_ht >= 0 and prix_unitaire_ht = round(prix_unitaire_ht, 6) and prix_unitaire_ht < 10000000000),
  taux_tva numeric not null
    constraint articles_taux_check
      check (taux_tva in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6)),
  nature text not null
    constraint articles_nature_check check (nature in ('biens', 'services')),
  retire_le timestamptz,
  retire_par uuid,
  cree_par uuid,
  cree_le timestamptz not null default now(),
  modifie_par uuid,
  modifie_le timestamptz,
  constraint articles_retrait_entier check ((retire_le is null) = (retire_par is null)),
  constraint articles_modification_entiere check ((modifie_le is null) = (modifie_par is null)),
  constraint articles_reference_unique unique (dossier_id, reference)
);

-- ══ 2. Qui lit, qui écrit ══════════
-- Le cabinet du dossier et le client qui porte le droit « Ventes » LISENT ; personne n'écrit directement — les fonctions
-- ci-dessous, et le super-administrateur qui restaure une sauvegarde.
alter table public.articles enable row level security;
create policy articles_lecture on public.articles
  for select to authenticated using (public.admin_du_dossier(dossier_id));
create policy articles_lecture_ventes on public.articles
  for select to authenticated using (public.client_du_dossier(dossier_id, 'ventes'));
create policy articles_restauration on public.articles
  for insert to authenticated with check (public.is_super_admin());

-- ══ 3. Enregistrer un article ══════════
-- Le créer (`p_article_id` nul) ou le réécrire EN ENTIER (chaque champ de la saisie ; une clé absente vaut nul, l'unité
-- absente vaut `C62`). Rend l'article tel qu'il est écrit.
--
-- Les refus, en neuf rangs et dans cet ordre — le module (src/lib/articles.ts) les dit avant le clic, dans le même ordre
-- et sous les mêmes mots :
--   1. l'accès au dossier annoncé, avant de rien lire (42501) ; 2. l'article, dans ce dossier (P0002) ; 3. un article
--   retiré ne se modifie pas : il se reprend d'abord ; 4. la désignation (présente, puis mille caractères au plus) et sa
--   description (un texte de quatre mille caractères au plus) ; 5. la référence : sa forme, puis son unicité dans le
--   dossier, l'article qui la porte nommé (23505) ; 6. l'unité, de la liste ; 7. le prix (présent, puis dans ses bornes) ;
--   8. le taux (présent, puis admis) ; 9. la nature.
-- Ensuite, les contraintes de la table, qui disent la même chose (23514) : une écriture concurrente qui prendrait la même
-- référence entre la lecture et l'écriture reçoit le même refus que le rang 5.
create function public.enregistrer_article(p_dossier_id uuid, p_article_id uuid, p_article jsonb)
returns public.articles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existant public.articles;
  v_autre public.articles;
  v_ecrit public.articles;
  v_reference text;
  v_designation text;
  v_description text;
  v_unite text;
  v_prix numeric;
  v_taux numeric;
  v_nature text;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  -- 2 et 3. (Le rang 1, l'accès, ci-dessus : avant de rien lire.)
  if p_article_id is not null then
    select * into v_existant from public.articles a where a.id = p_article_id and a.dossier_id = p_dossier_id for update;
    if not found then
      raise exception 'Article introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_existant.retire_le is not null then
      raise exception 'Cet article est retiré : le reprendre avant de le modifier.' using errcode = '22023';
    end if;
  end if;

  -- 4. La désignation, puis la description. Un champ se lit par son TYPE JSON d'abord : un nombre n'est pas un texte.
  if jsonb_typeof(p_article->'designation') is distinct from 'string'
     or btrim(p_article->>'designation', E' \t\n\r') = '' then
    raise exception 'La désignation de l''article est à renseigner.' using errcode = '22023';
  end if;
  v_designation := p_article->>'designation';
  if char_length(v_designation) > 1000 then
    raise exception 'La désignation de l''article tient en mille caractères au plus.' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_article->'description'), 'null') <> 'null' then
    if jsonb_typeof(p_article->'description') <> 'string' or char_length(p_article->>'description') > 4000 then
      raise exception 'La description de l''article est un texte de quatre mille caractères au plus.' using errcode = '22023';
    end if;
    v_description := p_article->>'description';
  end if;

  -- 5. La référence : sa forme, puis son unicité dans le dossier — l'article qui la porte nommé par sa désignation
  -- (quatre-vingts caractères au plus), et dit retiré s'il l'est.
  if coalesce(jsonb_typeof(p_article->'reference'), 'null') <> 'null' then
    if jsonb_typeof(p_article->'reference') <> 'string'
       or char_length(p_article->>'reference') not between 1 and 100
       or btrim(p_article->>'reference', E' \t\n\r') <> p_article->>'reference' then
      raise exception 'La référence de l''article tient en un à cent caractères, sans blanc au début ni à la fin.'
        using errcode = '22023';
    end if;
    v_reference := p_article->>'reference';
    select * into v_autre from public.articles a
     where a.dossier_id = p_dossier_id and a.reference = v_reference and a.id is distinct from p_article_id;
    if found then
      raise exception 'La référence « % » est déjà celle de l''article « % »% : une référence ne sert qu''une fois par dossier.',
        v_reference,
        case when char_length(v_autre.designation) > 80 then left(v_autre.designation, 79) || '…' else v_autre.designation end,
        case when v_autre.retire_le is not null then ' (retiré)' else '' end
        using errcode = '23505';
    end if;
  end if;

  -- 6. L'unité, de la liste fermée ; absente, l'unité générique.
  if coalesce(jsonb_typeof(p_article->'unite'), 'null') = 'null' then
    v_unite := 'C62';
  elsif jsonb_typeof(p_article->'unite') <> 'string'
        or p_article->>'unite' not in ('C62', 'H87', 'HUR', 'DAY', 'WEE', 'MON', 'ANN', 'KGM', 'MTR', 'MTK', 'LTR', 'KMT', 'LS') then
    raise exception 'L''unité de l''article n''est pas de la liste des unités admises.' using errcode = '22023';
  else
    v_unite := p_article->>'unite';
  end if;

  -- 7. Le prix unitaire hors taxes : un nombre, positif ou nul, à six décimales au plus, sous dix milliards d'euros.
  if jsonb_typeof(p_article->'prix_unitaire_ht') is distinct from 'number' then
    raise exception 'Le prix unitaire hors taxes de l''article est à renseigner.' using errcode = '22023';
  end if;
  v_prix := (p_article->>'prix_unitaire_ht')::numeric;
  if v_prix < 0 or v_prix <> round(v_prix, 6) or v_prix >= 10000000000 then
    raise exception 'Le prix unitaire hors taxes de l''article est positif ou nul, à six décimales au plus, sous dix milliards d''euros.'
      using errcode = '22023';
  end if;

  -- 8. Le taux : un nombre, que la DGFiP admet (G1.24).
  if jsonb_typeof(p_article->'taux_tva') is distinct from 'number' then
    raise exception 'Le taux de TVA de l''article est à renseigner.' using errcode = '22023';
  end if;
  v_taux := (p_article->>'taux_tva')::numeric;
  if v_taux not in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6) then
    raise exception 'Le taux de % %% n''est pas un taux de TVA admis.', replace(trim_scale(v_taux)::text, '.', ',')
      using errcode = '22023';
  end if;

  -- 9. La nature.
  if jsonb_typeof(p_article->'nature') is distinct from 'string' or p_article->>'nature' not in ('biens', 'services') then
    raise exception 'La nature de l''article est « biens » ou « services ».' using errcode = '22023';
  end if;
  v_nature := p_article->>'nature';

  -- L'écriture : les colonnes énumérées ; l'auteur et l'instant posés par la base. La référence prise entre-temps par une
  -- autre session se dit comme le rang 5.
  begin
    if p_article_id is null then
      insert into public.articles (dossier_id, reference, designation, description, unite, prix_unitaire_ht, taux_tva, nature,
                                   cree_par)
      values (p_dossier_id, v_reference, v_designation, v_description, v_unite, v_prix, v_taux, v_nature, auth.uid())
      returning * into v_ecrit;
    else
      update public.articles a
         set reference = v_reference, designation = v_designation, description = v_description, unite = v_unite,
             prix_unitaire_ht = v_prix, taux_tva = v_taux, nature = v_nature, modifie_par = auth.uid(), modifie_le = now()
       where a.id = p_article_id
      returning * into v_ecrit;
    end if;
  exception when unique_violation then
    select * into v_autre from public.articles a
     where a.dossier_id = p_dossier_id and a.reference = v_reference and a.id is distinct from p_article_id;
    if not found then
      raise;
    end if;
    raise exception 'La référence « % » est déjà celle de l''article « % »% : une référence ne sert qu''une fois par dossier.',
      v_reference,
      case when char_length(v_autre.designation) > 80 then left(v_autre.designation, 79) || '…' else v_autre.designation end,
      case when v_autre.retire_le is not null then ' (retiré)' else '' end
      using errcode = '23505';
  end;
  return v_ecrit;
end
$$;

-- ══ 4. Retirer un article, le reprendre ══════════
-- Retiré, un article sort des choix ; il garde sa référence et tout ce qu'il dit. Repris, il y revient, et la reprise est
-- sa dernière modification. Trois refus chacune, dans cet ordre : l'accès (42501), l'article dans ce dossier (P0002), son
-- état (22023).
create function public.retirer_article(p_dossier_id uuid, p_article_id uuid)
returns public.articles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article public.articles;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_article from public.articles a where a.id = p_article_id and a.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Article introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_article.retire_le is not null then
    raise exception 'Cet article est déjà retiré.' using errcode = '22023';
  end if;
  update public.articles a set retire_le = now(), retire_par = auth.uid() where a.id = p_article_id
  returning * into v_article;
  return v_article;
end
$$;

create function public.reprendre_article(p_dossier_id uuid, p_article_id uuid)
returns public.articles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_article public.articles;
begin
  if not public.gere_les_ventes(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  select * into v_article from public.articles a where a.id = p_article_id and a.dossier_id = p_dossier_id for update;
  if not found then
    raise exception 'Article introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_article.retire_le is null then
    raise exception 'Cet article n''est pas retiré.' using errcode = '22023';
  end if;
  update public.articles a
     set retire_le = null, retire_par = null, modifie_par = auth.uid(), modifie_le = now()
   where a.id = p_article_id
  returning * into v_article;
  return v_article;
end
$$;

-- ══ 5. Les droits d'exécution ══════════
-- Chaque fonction vérifie l'accès elle-même ; un anonyme n'a rien à y faire.
revoke execute on function public.enregistrer_article(uuid, uuid, jsonb) from public, anon;
grant execute on function public.enregistrer_article(uuid, uuid, jsonb) to authenticated;
revoke execute on function public.retirer_article(uuid, uuid) from public, anon;
grant execute on function public.retirer_article(uuid, uuid) to authenticated;
revoke execute on function public.reprendre_article(uuid, uuid) from public, anon;
grant execute on function public.reprendre_article(uuid, uuid) to authenticated;

comment on table public.articles is
  'Le catalogue d''articles d''un dossier (espace client, étape A1) : chacun pré-remplit une ligne de facture, qui en garde sa copie. Le cabinet et le client qui porte la case « Ventes » le lisent et le tiennent par enregistrer_article, retirer_article et reprendre_article ; il ne se supprime pas, il se retire.';
comment on column public.articles.reference is
  'L''identifiant que le vendeur donne à l''article (BT-155) : facultatif, unique dans le dossier, retirés compris.';
comment on column public.articles.unite is
  'L''unité de la quantité (BT-130), de la liste fermée des recommandations 20 et 21 de la CEE-ONU ; C62, l''unité, par défaut.';
comment on column public.articles.taux_tva is
  'Le taux de l''opération quand le dossier est redevable (G1.24) : une ligne pré-remplie applique le statut de TVA du jour.';
comment on column public.articles.nature is
  'Biens ou services : la catégorie de l''opération de la facture et de l''e-reporting, proposée.';
comment on function public.enregistrer_article(uuid, uuid, jsonb) is
  'Crée ou réécrit un article du dossier, pour le cabinet ou le client qui porte la case « Ventes » : l''accès d''abord, puis neuf rangs de refus dans un ordre fixé ; rend l''article écrit.';
comment on function public.retirer_article(uuid, uuid) is
  'Retire un article du dossier : il sort des choix, garde sa référence, et se reprend.';
comment on function public.reprendre_article(uuid, uuid) is
  'Reprend un article retiré du dossier : il revient dans les choix ; la reprise est sa dernière modification.';
