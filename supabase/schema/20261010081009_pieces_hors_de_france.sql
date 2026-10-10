-- LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » D'UNE PIÈCE D'ACHAT (ligne 28.5, étape e : e-reporting, deuxième temps,
-- e2 ; conception du 09/10/2026, HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION », §3).
--
-- L'OBLIGATION. Tout assujetti établi en France — exonéré et franchisé compris — transmet à l'administration les données
-- de ses ACQUISITIONS auprès d'un assujetti qui n'y est pas établi : acquisitions intracommunautaires de biens (CGI,
-- art. 290, I-3° a), livraisons de biens situées en France (b), prestations de services situées en France en application
-- du 1° de l'art. 259 et de l'art. 259 A (c) — article maintenu en vigueur jusqu'à sa reprise par le décret qu'annonce le
-- dernier alinéa de l'art. L. 216-55 du CIBS, que la partie réglementaire du CIBS ne porte pas au 10/10/2026 ;
-- BOI-TVA-DECLA-20-30-50-10, §60 —, à partir des factures du 01/09/2027 pour une PME. Le message est le bloc 10.1 du
-- flux 10, rôle « acheteur », facture par facture et sans ses lignes (BOI-TVA-DECLA-20-30-50-20, §70) ; ses données sont
-- celles des annexes 6 (v1.10) et 7 (v1.9) des spécifications externes de la DGFiP, dont les règles sont citées ici par
-- leur numéro.
--
-- CE QUE CETTE MIGRATION POSE : la fiche de la facture d'un fournisseur établi hors de France, que le cabinet SAISIT —
-- rien ne s'en déduit ni ne s'écrit seul — et sa ventilation par code et taux de TVA. Elle ne déclare rien : la
-- déclaration (e5) figera ce qui est parti. Le client du dossier n'en voit rien.
--
-- UNE FICHE SE REMPLACE, ELLE NE SE MODIFIE PAS. Chaque enregistrement est une ligne nouvelle qui remplace la fiche
-- courante de la pièce (`remplace_id`) : la fiche reste « modifiable tant qu'on veut » sans qu'aucune ligne de sa
-- ventilation ait à être retirée, l'historique dit qui a écrit quoi et quand — ce qu'une déclaration rectificative devra
-- comparer —, et deux onglets ne s'écrasent pas l'un l'autre : le second se fait dire de relire. Une pièce qui n'était
-- pas un achat à l'étranger voit sa fiche RETIRÉE (`retire_le`), jamais supprimée ; une fiche retirée peut être
-- remplacée par une nouvelle. Rien ne part, sauf avec la pièce ou le dossier.
--
-- LES QUESTIONS AU CABINET N'ONT PAS ENCORE DE RÉPONSE (09/10/2026) : leurs recommandations sont prises comme
-- HYPOTHÈSES, rangées dans la fonction, qu'une autre réponse reprendra par `create or replace function` :
--   - Q7, un achat facturé avec une TVA — la sienne, ou la TVA française (guichet unique) — est mis de côté, « à
--     trancher par le cabinet » : la fonction refuse une pièce qui porte une TVA et une ligne au taux normal (S) ; la
--     table, elle, admet une ligne S (son taux est alors positif) ;
--   - Q3, le numéro de TVA du dossier : la fiche décrit la facture et n'en dépend pas — c'est la déclaration (e5) qui
--     refusera un dossier sans numéro ;
--   - point 15 de la conception, une acquisition de biens dans l'Union qu'un dossier n'a pas à autoliquider : « à
--     trancher » (§4.4 de la conception).
-- Monaco, l'outre-mer et un fournisseur établi en France n'ont pas de fiche (BOI-TVA-DECLA-20-30-50-10, §170 à §220).
--
-- Données mesurées le 10/10/2026 (comptes seulement) : dans le dossier `test`, 40 pièces d'achat dont 4 en dollars,
-- toutes portant une TVA ; aucune fiche n'existe. Tout ce qui suit est latent jusqu'à l'écran (e3).

-- ══ Les tables ══════════
-- Une version de la fiche d'une pièce. Le numéro suit la règle G1.05 (35 caractères, alphanumériques, « espace - + _ / »,
-- sans espace au début, à la fin ni double) ; les dates, G1.36 (2000 à 2099) ; le type, la liste de G1.01, dont la
-- fonction n'écrit que 380 et 381 ; une facture d'origine (G1.32) pour un avoir ou une facture rectificative, et pour eux
-- seuls ; une date de livraison OU une période de facturation (G1.38), la fin jamais avant le début (G6.20). Le pays est
-- un code à deux lettres, jamais la France ; l'identifiant suit G2.19 (0223 : le numéro de TVA d'un fournisseur de
-- l'Union ; 0227 : le code pays et les seize premiers caractères de la dénomination), 18 caractères au plus. La devise est
-- celle de la pièce, que la fonction recopie : la ventilation est dans la devise de la facture (TT-22). L'auteur est un
-- repère d'audit sans clé étrangère, comme `revision_justifications.auteur` : retirer le compte d'un membre parti ne doit
-- pas effacer qui a écrit.
create table public.pieces_hors_de_france (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  piece_id uuid not null references public.pieces (id) on delete cascade,
  remplace_id uuid references public.pieces_hors_de_france (id),
  numero text not null
    constraint pieces_hors_de_france_numero
      check (char_length(numero) <= 35 and numero ~ '^[A-Za-z0-9+_/-]+( [A-Za-z0-9+_/-]+)*$'),
  date_facture date not null
    constraint pieces_hors_de_france_date_facture check (date_facture between date '2000-01-01' and date '2099-12-31'),
  type_document text not null
    constraint pieces_hors_de_france_type_document
      check (type_document in ('380', '389', '393', '501', '386', '500', '384', '471', '472', '473', '261', '381', '396', '502', '503')),
  facture_origine_numero text
    constraint pieces_hors_de_france_origine_numero
      check (char_length(facture_origine_numero) <= 35 and facture_origine_numero ~ '^[A-Za-z0-9+_/-]+( [A-Za-z0-9+_/-]+)*$'),
  facture_origine_date date
    constraint pieces_hors_de_france_origine_date check (facture_origine_date between date '2000-01-01' and date '2099-12-31'),
  devise text not null
    constraint pieces_hors_de_france_devise check (devise ~ '^[A-Z]{3}$'),
  pays text not null
    constraint pieces_hors_de_france_pays check (pays ~ '^[A-Z]{2}$' and pays <> 'FR'),
  schema_identifiant text not null
    constraint pieces_hors_de_france_schema check (schema_identifiant in ('0223', '0227')),
  identifiant text not null
    constraint pieces_hors_de_france_identifiant
      check (char_length(identifiant) between 3 and 18 and identifiant = btrim(identifiant) and left(identifiant, 2) ~ '^[A-Z]{2}$'),
  nature text not null
    constraint pieces_hors_de_france_nature check (nature in ('biens', 'services', 'mixte')),
  autoliquidation boolean not null,
  date_operation date
    constraint pieces_hors_de_france_date_operation check (date_operation between date '2000-01-01' and date '2099-12-31'),
  periode_debut date
    constraint pieces_hors_de_france_periode_debut check (periode_debut between date '2000-01-01' and date '2099-12-31'),
  periode_fin date
    constraint pieces_hors_de_france_periode_fin check (periode_fin between date '2000-01-01' and date '2099-12-31'),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  retire_le timestamptz,
  retire_par uuid,
  constraint pieces_hors_de_france_origine
    check ((type_document in ('381', '261', '396', '502', '503', '384', '471', '472', '473')) = (facture_origine_numero is not null)
           and (facture_origine_numero is null) = (facture_origine_date is null)),
  constraint pieces_hors_de_france_periode
    check ((periode_debut is null) = (periode_fin is null) and (periode_fin is null or periode_fin >= periode_debut)),
  constraint pieces_hors_de_france_livraison_ou_periode check (date_operation is null or periode_debut is null),
  constraint pieces_hors_de_france_une_suite unique (remplace_id)
);

-- Une seule PREMIÈRE fiche par pièce. Avec l'unicité de `remplace_id`, chaque pièce porte une CHAÎNE linéaire de fiches,
-- et la fiche courante est celle qu'aucune autre ne remplace : l'ordre est la chaîne, aucun horodatage ne départage, et
-- il survit à une restauration. Partiel, et c'est un invariant : aucun upsert ne le vise, une fiche s'insère.
create unique index pieces_hors_de_france_une_premiere on public.pieces_hors_de_france (piece_id) where remplace_id is null;
create index pieces_hors_de_france_piece on public.pieces_hors_de_france (piece_id);
create index pieces_hors_de_france_dossier on public.pieces_hors_de_france (dossier_id);

-- La ventilation d'une version de la fiche, par code (G2.31) et taux (G1.24, la liste de TAUX_ADMIS de
-- src/lib/factureCii.ts), dans la devise de la facture : la base (TT-54) positive au centime, la TVA (TT-55) au centime.
-- Sans TVA facturée — tout code sauf S —, le taux et la TVA sont nuls (norme EN 16931, règles BR-AE, BR-E, BR-IC, BR-G et
-- BR-Z 05 et 09, BR-O-09 ; le flux 10 exige un taux, TT-57) ; au taux normal (S), le taux est positif (BR-S-05). Une
-- exonération porte son motif, code et libellé (G1.40) ; une ligne S ou Z n'en porte pas (BR-S-10, BR-Z-10).
create table public.pieces_hors_de_france_taux (
  fiche_id uuid not null references public.pieces_hors_de_france (id) on delete cascade,
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  code_tva text not null
    constraint pieces_hors_de_france_taux_code check (code_tva in ('S', 'E', 'AE', 'K', 'G', 'O', 'Z')),
  taux numeric not null
    constraint pieces_hors_de_france_taux_taux
      check (taux in (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6)),
  base numeric not null
    constraint pieces_hors_de_france_taux_base check (base > 0 and base = round(base, 2) and base < 10000000000000),
  tva numeric not null
    constraint pieces_hors_de_france_taux_tva check (tva >= 0 and tva = round(tva, 2) and tva < 10000000000000),
  motif_code text
    constraint pieces_hors_de_france_taux_motif_code
      check (char_length(motif_code) <= 30 and motif_code ~ '^VATEX-[A-Z]{2}-[0-9A-Z]+(-[0-9A-Z]+)*$'),
  motif_texte text
    constraint pieces_hors_de_france_taux_motif_texte
      check (char_length(motif_texte) <= 1024 and btrim(motif_texte, E' \t\n\r') <> ''),
  primary key (fiche_id, code_tva, taux),
  constraint pieces_hors_de_france_taux_sans_tva check (code_tva = 'S' or (taux = 0 and tva = 0)),
  constraint pieces_hors_de_france_taux_normal check (code_tva <> 'S' or taux > 0),
  constraint pieces_hors_de_france_taux_motif_exoneration
    check (code_tva <> 'E' or (motif_code is not null and motif_texte is not null)),
  constraint pieces_hors_de_france_taux_sans_motif
    check (code_tva not in ('S', 'Z') or (motif_code is null and motif_texte is null))
);
create index pieces_hors_de_france_taux_dossier on public.pieces_hors_de_france_taux (dossier_id);

-- ══ Le verrou ══════════
-- Le verrou consultatif des fiches d'un dossier. `enregistrer_fiche_hors_de_france` et `retirer_fiche_hors_de_france` le
-- prennent en EXCLUSIF — deux enregistrements concurrents se suivent, et le second voit la fiche du premier (la chaîne,
-- et la même facture sur une autre pièce) —, APRÈS le verrou PARTAGÉ de la validation (`cle_validation`) : une validation
-- n'avance pas pendant qu'une fiche s'écrit. Toujours dans cet ordre, la validation puis la fiche, comme la révision.
create function public.cle_hors_de_france(p_dossier_id uuid) returns bigint
language sql immutable set search_path = public as $$
  select hashtextextended('jd.pieces_hors_de_france:' || p_dossier_id::text, 0)
$$;

-- ══ Le gel de la validation ══════════
-- L'exercice qui fige une pièce : celui de sa première écriture validée, ou de celle du bien qu'elle justifie — le critère
-- même de `garder_piece_validee`. Une fiche suit sa pièce : figée, elle ne se remplace ni ne se retire plus. Aux droits de
-- l'appelant : la fonction qui écrit la lit en propriétaire, la restauration en super-administrateur.
create function public.exercice_figeant_la_piece(p_piece_id uuid) returns integer
language sql stable set search_path = public as $$
  select min(extract(year from e.date))::integer
    from public.ecritures_brouillon e
   where e.statut = 'validee'
     and (e.piece_id = p_piece_id
       or e.immobilisation_id in (select i.id from public.immobilisations i where i.piece_id = p_piece_id))
$$;

-- ══ La garde des fiches ══════════
-- Une fiche décrit une pièce de son dossier ; elle en remplace une de la même pièce ; une pièce figée n'en reçoit plus.
-- Après l'insertion, rien ne change que le retrait, une fois, de la fiche COURANTE d'une pièce que rien ne fige. Rien ne
-- se supprime, sauf avec la pièce ou le dossier, que la ligne ne voit déjà plus pendant la cascade (le critère des gardes
-- de la validation). Ce que la fonction vérifie de plus — les formats, la ventilation, la fiche courante — ne se rejoue
-- pas ici : une restauration réinsère l'historique tel qu'il a été écrit, AVANT les écritures (src/lib/sauvegarde.ts),
-- donc avant qu'aucune ne fige sa pièce. Aux droits de l'appelant, et avant la RLS : qui ne voit pas la pièce est refusé
-- sans apprendre si elle existe. Elle ne prend pas le verrou de la validation, que seuls les propriétaires exécutent :
-- les deux fonctions qui écrivent le prennent avant elle.
create function public.garder_fiche_hors_de_france() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_annee integer;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id)
       or not exists (select 1 from public.pieces p where p.id = old.piece_id) then
      return old;
    end if;
    raise exception 'Une fiche « hors de France » ne se supprime pas : elle se remplace, ou se retire ; elle part avec sa pièce.'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id) then
      raise exception 'Une fiche « hors de France » décrit une pièce de son dossier.' using errcode = '23514';
    end if;
    if new.remplace_id is not null and not exists (
         select 1 from public.pieces_hors_de_france f
          where f.id = new.remplace_id and f.piece_id = new.piece_id and f.dossier_id = new.dossier_id) then
      raise exception 'Une fiche en remplace une de la même pièce.' using errcode = '23514';
    end if;
    v_annee := public.exercice_figeant_la_piece(new.piece_id);
    if v_annee is not null then
      raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa fiche ne change plus.', v_annee
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array['retire_le', 'retire_par']) is distinct from (to_jsonb(old) - array['retire_le', 'retire_par'])
     or old.retire_le is not null or new.retire_le is null then
    raise exception 'Une fiche « hors de France » ne se modifie pas : elle se remplace par une nouvelle, ou se retire, une fois.'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = old.id) then
    raise exception 'Seule la fiche courante d''une pièce se retire.' using errcode = '23514';
  end if;
  v_annee := public.exercice_figeant_la_piece(old.piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa fiche ne se retire plus.', v_annee
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_hors_de_france_gardes before insert or update or delete on public.pieces_hors_de_france
  for each row execute function public.garder_fiche_hors_de_france();

-- Une ligne de la ventilation appartient à une fiche de son dossier ; elle ne se modifie pas, et ne part qu'avec sa
-- fiche ou son dossier.
create function public.garder_fiche_hors_de_france_taux() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.pieces_hors_de_france f where f.id = old.fiche_id)
       or not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'La ventilation d''une fiche « hors de France » ne se supprime pas : elle part avec sa fiche.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'La ventilation d''une fiche « hors de France » ne se modifie pas : la fiche se remplace.'
      using errcode = '23514';
  end if;
  if not exists (select 1 from public.pieces_hors_de_france f where f.id = new.fiche_id and f.dossier_id = new.dossier_id) then
    raise exception 'Une ligne de ventilation appartient à une fiche de son dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_hors_de_france_taux_gardes before insert or update or delete on public.pieces_hors_de_france_taux
  for each row execute function public.garder_fiche_hors_de_france_taux();

-- Une pièce qui a une fiche ne change plus de dossier : sa fiche porte son dossier en propre (la policy le lit sans
-- jointure), et resterait lisible là où la pièce n'est plus. La suppression d'un dossier emporte ses pièces sans les
-- modifier : elle ne passe pas par ici. DEFINER pour voir les fiches quelle que soit la RLS de qui modifie la pièce ;
-- elle ne rend que la ligne, ou le refus.
create function public.garder_piece_hors_de_france() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dossier_id is not distinct from old.dossier_id then
    return new;
  end if;
  if exists (select 1 from public.pieces_hors_de_france f where f.piece_id = old.id) then
    raise exception 'Cette pièce a une fiche « hors de France » : elle ne change plus de dossier.' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger pieces_hors_de_france_dossier before update of dossier_id on public.pieces
  for each row execute function public.garder_piece_hors_de_france();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les fiches de ses dossiers et les écrit par les deux fonctions ci-dessous, seules à le faire depuis le
-- navigateur : les tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en insère pour restaurer une
-- sauvegarde. Le client n'y voit rien : aucune policy ne le nomme.
alter table public.pieces_hors_de_france enable row level security;
create policy pieces_hors_de_france_lecture on public.pieces_hors_de_france
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy pieces_hors_de_france_restauration on public.pieces_hors_de_france
  for insert to authenticated with check (is_super_admin());

alter table public.pieces_hors_de_france_taux enable row level security;
create policy pieces_hors_de_france_taux_lecture on public.pieces_hors_de_france_taux
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy pieces_hors_de_france_taux_restauration on public.pieces_hors_de_france_taux
  for insert to authenticated with check (is_super_admin());

-- ══ Enregistrer une fiche ══════════
-- D'UN SEUL TENANT : la fiche et sa ventilation, sous le verrou partagé de la validation, le verrou exclusif des fiches du
-- dossier, et celui de la ligne de la pièce (ses montants ne changent pas pendant qu'on les compare). La fiche nouvelle
-- REMPLACE la fiche courante de la pièce, que l'écran désigne (`p_remplace_id`, nul s'il n'y en a pas) ; elle rend la
-- fiche écrite, son identifiant et son instant compris.
--
-- Les refus, dans cet ordre — le module (src/lib/piecesHorsDeFrance.ts) les dit avant le clic, dans le même ordre et sous
-- les mêmes mots :
--   1. l'accès au dossier annoncé, ou un dossier qui n'existe pas (42501) ; 2. la pièce, dans ce dossier (P0002) ;
--   3. une pièce d'achat ou une note de frais ; 4. une pièce que rien ne fige ; 5. le montant TTC de la pièce dans sa
--   devise ; 6. une pièce sans TVA (HYPOTHÈSE Q7) ; 7. la fiche remplacée : une fiche de cette pièce, la courante ;
--   8. le numéro (G1.05) ; 9. la date (renseignée, pas avant 2000, pas dans l'avenir à Paris : G1.36, G1.07) ; 10. le
--   type, 380 ou 381 ; 11. le sens de la pièce (un avoir y est négatif) ; 12. la facture d'origine d'un avoir (G1.32) ;
--   13. le pays (ISO 3166 : G2.01 ; ni la France, ni Monaco, ni l'outre-mer) ; 14. le schéma de l'identifiant ; 15.
--   l'identifiant (G2.19) ; 16. la nature ; 17. l'autoliquidation, dite ; 18. la date de livraison ou la période (G1.38,
--   G1.36, G6.20) ; 19. la ventilation : lisible, sans ligne répétée, des codes de G2.31, aucune ligne S (HYPOTHÈSE Q7),
--   taux et TVA nuls, des bases positives au centime, les motifs (G1.40, EN 16931), aucune exonération pour un
--   fournisseur hors de l'Union (G1.102), l'autoliquidation d'une ligne AE ou K (point 15), quelque chose à autoliquider,
--   et la somme des bases égale au montant TTC de la pièce à un centime près (G1.53) ; 20. la même facture — numéro,
--   année, fournisseur — sur une autre pièce du dossier (G1.42, transposée à l'acheteur).
-- Tous en 22023, sauf l'accès et la pièce introuvable.
create function public.enregistrer_fiche_hors_de_france(
  p_dossier_id uuid,
  p_piece_id uuid,
  p_remplace_id uuid,
  p_numero text,
  p_date_facture date,
  p_type_document text,
  p_facture_origine_numero text,
  p_facture_origine_date date,
  p_pays text,
  p_schema_identifiant text,
  p_identifiant text,
  p_nature text,
  p_autoliquidation boolean,
  p_date_operation date,
  p_periode_debut date,
  p_periode_fin date,
  p_taux jsonb
)
returns public.pieces_hors_de_france
language plpgsql
security definer
set search_path = public
as $$
declare
  -- ISO 3166-1 alpha-2, les 249 codes attribués (paquet iso-codes 4.16.0, qui reprend la liste de l'ISO).
  c_pays constant text[] := array[
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ','BA','BB','BD','BE','BF','BG','BH',
    'BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL',
    'CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET',
    'FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU',
    'GW','GY','HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP','KE',
    'KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC',
    'MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA','NC',
    'NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT',
    'PW','PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR',
    'SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA',
    'UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'];
  -- Les vingt-six autres États membres de l'Union ; le préfixe du numéro de TVA de la Grèce est EL.
  c_union constant text[] := array[
    'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE',
    'SI','SK'];
  -- La Guadeloupe, la Martinique et La Réunion : la facture électronique (BOI-TVA-DECLA-20-30-50-10, §170).
  c_drom_tva constant text[] := array['GP','MQ','RE'];
  -- Le reste de l'outre-mer français, hors du territoire de la TVA (§180) : règles et schémas propres (0228, 0229, FRWF).
  c_outre_mer constant text[] := array['GF','YT','PM','BL','MF','WF','PF','NC','TF'];
  v_numero_g105 constant text := '^[A-Za-z0-9+_/-]+( [A-Za-z0-9+_/-]+)*$';
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_piece public.pieces;
  v_annee integer;
  v_ttc numeric;
  v_courante uuid;
  v_ligne record;
  v_code text;
  v_somme numeric;
  v_fiche public.pieces_hors_de_france;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_hors_de_france(p_dossier_id));
  -- 2. La pièce, cherchée dans ce dossier seulement : un compte qui n'y a pas droit n'apprend pas qu'elle existe.
  select * into v_piece from public.pieces p where p.id = p_piece_id and p.dossier_id = p_dossier_id for share;
  if not found then
    raise exception 'Pièce introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  -- 3. Un achat : une vente à l'étranger demande ses lignes et ses mentions, qui viendront avec elle.
  if v_piece.type_piece not in ('achat', 'note_frais') then
    raise exception 'Seule une pièce d''achat ou une note de frais reçoit une fiche « fournisseur établi hors de France ».'
      using errcode = '22023';
  end if;
  -- 4. Le gel de la validation, comme sa pièce.
  v_annee := public.exercice_figeant_la_piece(p_piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa fiche ne change plus.', v_annee
      using errcode = '22023';
  end if;
  -- 5. Le montant TTC de la pièce dans sa devise : celui que la ventilation doit refaire.
  v_ttc := case when v_piece.devise = 'EUR' then v_piece.montant_ttc else v_piece.montant_devise end;
  if v_ttc is null then
    raise exception 'La pièce n''a pas encore son montant TTC dans sa devise (%) : le saisir sur la pièce d''abord.', v_piece.devise
      using errcode = '22023';
  end if;
  -- 6. HYPOTHÈSE Q7 : une TVA facturée met l'achat de côté.
  if v_piece.montant_tva is not null and v_piece.montant_tva <> 0 then
    raise exception 'La pièce porte une TVA de % € : un achat à un fournisseur établi hors de France facturé avec une TVA — la sienne ou la TVA française — est mis de côté, à trancher par le cabinet.',
      replace(to_char(abs(v_piece.montant_tva), 'FM999999999990.00'), '.', ',') using errcode = '22023';
  end if;
  -- 7. La fiche courante est celle qu'aucune autre ne remplace : on remplace celle-là, ou rien s'il n'y en a pas.
  select f.id into v_courante from public.pieces_hors_de_france f
   where f.piece_id = p_piece_id
     and not exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = f.id);
  if p_remplace_id is not null and not exists (
       select 1 from public.pieces_hors_de_france f where f.id = p_remplace_id and f.piece_id = p_piece_id) then
    raise exception 'La fiche à remplacer n''est pas une fiche de cette pièce.' using errcode = '22023';
  end if;
  if p_remplace_id is distinct from v_courante then
    raise exception 'Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d''enregistrer.' using errcode = '22023';
  end if;
  -- 8. Le numéro (G1.05).
  if p_numero is null or btrim(p_numero, E' \t\n\r') = '' then
    raise exception 'Le numéro de la facture est à renseigner.' using errcode = '22023';
  end if;
  if char_length(p_numero) > 35 or p_numero !~ v_numero_g105 then
    raise exception 'Le numéro de la facture tient en 35 caractères : lettres sans accent, chiffres, espaces simples et « - + _ / », sans espace au début ni à la fin.'
      using errcode = '22023';
  end if;
  -- 9. La date (G1.36, G1.07), le jour lu à Paris.
  if p_date_facture is null then
    raise exception 'La date de la facture est à renseigner.' using errcode = '22023';
  end if;
  if p_date_facture < date '2000-01-01' then
    raise exception 'Une facture ne se date pas avant l''an 2000.' using errcode = '22023';
  end if;
  if p_date_facture > v_aujourd_hui then
    raise exception 'Une facture ne se date pas dans l''avenir : nous sommes le %.', to_char(v_aujourd_hui, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  -- 10. Une facture ou un avoir : les autres types de G1.01 ne s'écrivent pas encore.
  if p_type_document is null or p_type_document not in ('380', '381') then
    raise exception 'Une fiche décrit une facture (380) ou un avoir (381).' using errcode = '22023';
  end if;
  -- 11. Le sens : un avoir porte un montant négatif dans la pièce, une facture un montant positif (src/lib/factureElectronique.ts),
  -- lu dans la devise de la pièce, celui que la ventilation refait.
  if (p_type_document = '381' and v_ttc > 0) or (p_type_document = '380' and v_ttc < 0) then
    raise exception 'La pièce et sa fiche ne disent pas le même sens : une facture (380) porte un montant positif dans la pièce, un avoir (381) un montant négatif.'
      using errcode = '22023';
  end if;
  -- 12. La facture d'origine d'un avoir (G1.32), et d'un avoir seul.
  if p_type_document = '381' and (p_facture_origine_numero is null or btrim(p_facture_origine_numero, E' \t\n\r') = ''
                                  or p_facture_origine_date is null) then
    raise exception 'Un avoir cite la facture qu''il corrige : son numéro et sa date.' using errcode = '22023';
  end if;
  if p_type_document = '381' and (char_length(p_facture_origine_numero) > 35 or p_facture_origine_numero !~ v_numero_g105
                                  or p_facture_origine_date < date '2000-01-01' or p_facture_origine_date > v_aujourd_hui) then
    raise exception 'La facture d''origine se cite par un numéro de 35 caractères (lettres sans accent, chiffres, espaces simples et « - + _ / ») et une date entre le 01/01/2000 et aujourd''hui.'
      using errcode = '22023';
  end if;
  if p_type_document = '380' and (p_facture_origine_numero is not null or p_facture_origine_date is not null) then
    raise exception 'Seul un avoir cite une facture d''origine.' using errcode = '22023';
  end if;
  -- 13. Le pays (G2.01), hors de France au sens de la TVA.
  if p_pays is null or not (p_pays = any (c_pays)) then
    raise exception 'Le pays du fournisseur est un code de pays à deux lettres (norme ISO 3166).' using errcode = '22023';
  end if;
  if p_pays = 'FR' then
    raise exception 'Un fournisseur établi en France n''a pas de fiche « hors de France ».' using errcode = '22023';
  end if;
  if p_pays = 'MC' then
    raise exception 'Un fournisseur établi à Monaco est traité comme un fournisseur établi en France : il n''a pas de fiche « hors de France ».'
      using errcode = '22023';
  end if;
  if p_pays = any (c_drom_tva) then
    raise exception 'Un achat à un fournisseur établi en Guadeloupe, en Martinique ou à La Réunion passe par la facture électronique, pas par cette fiche.'
      using errcode = '22023';
  end if;
  if p_pays = any (c_outre_mer) then
    raise exception 'L''outre-mer français a ses propres règles (Guyane, Mayotte, collectivités d''outre-mer, Nouvelle-Calédonie, Terres australes) : cette fiche ne le couvre pas encore.'
      using errcode = '22023';
  end if;
  -- 14. Le schéma de l'identifiant (G2.19) : un fournisseur de l'Union par son numéro de TVA, les autres par leur nom.
  if p_schema_identifiant is null or p_schema_identifiant not in ('0223', '0227') then
    raise exception 'Le fournisseur se désigne par son numéro de TVA s''il est établi dans l''Union (schéma 0223), par son pays et son nom sinon (schéma 0227).'
      using errcode = '22023';
  end if;
  if p_schema_identifiant = '0227' and p_pays = any (c_union) then
    raise exception 'Un fournisseur établi dans l''Union se désigne par son numéro de TVA (schéma 0223).' using errcode = '22023';
  end if;
  if p_schema_identifiant = '0223' and not (p_pays = any (c_union)) then
    raise exception 'Un fournisseur établi hors de l''Union se désigne par son pays et son nom (schéma 0227).' using errcode = '22023';
  end if;
  -- 15. L'identifiant (G2.19), 18 caractères au plus.
  if p_identifiant is null or btrim(p_identifiant, E' \t\n\r') = '' then
    raise exception 'L''identifiant du fournisseur est à renseigner.' using errcode = '22023';
  end if;
  if p_schema_identifiant = '0223'
     and (p_identifiant !~ '^[A-Z]{2}[0-9A-Z+*]{2,16}$'
          or left(p_identifiant, 2) <> case when p_pays = 'GR' then 'EL' else p_pays end) then
    raise exception 'Le numéro de TVA d''un fournisseur établi dans ce pays (%) commence par % et tient en 18 caractères au plus : des lettres sans accent et des chiffres.',
      p_pays, case when p_pays = 'GR' then 'EL' else p_pays end using errcode = '22023';
  end if;
  if p_schema_identifiant = '0227'
     and (left(p_identifiant, 2) <> p_pays or char_length(p_identifiant) not between 3 and 18
          or p_identifiant <> btrim(p_identifiant) or p_identifiant ~ '[[:cntrl:]]') then
    raise exception 'L''identifiant d''un fournisseur établi hors de l''Union est son code de pays (%) suivi des seize premiers caractères de sa dénomination, sans espace au début ni à la fin.',
      p_pays using errcode = '22023';
  end if;
  -- 16. La nature, qui donne le cadre de facturation (TT-28, G1.02).
  if p_nature is null or p_nature not in ('biens', 'services', 'mixte') then
    raise exception 'La nature de l''achat est des biens, des services, ou les deux.' using errcode = '22023';
  end if;
  -- 17.
  if p_autoliquidation is null then
    raise exception 'Dire si le dossier autoliquide la TVA de cet achat.' using errcode = '22023';
  end if;
  -- 18. Une date de livraison OU une période de facturation (G1.38), entre 2000 et 2099 (G1.36), la fin après le
  -- début (G6.20).
  if p_date_operation is not null and (p_periode_debut is not null or p_periode_fin is not null) then
    raise exception 'Une facture porte une date de livraison ou une période de facturation, pas les deux.' using errcode = '22023';
  end if;
  if (p_periode_debut is null) <> (p_periode_fin is null) or p_periode_fin < p_periode_debut then
    raise exception 'Une période de facturation a un début et une fin, et ne finit pas avant de commencer.' using errcode = '22023';
  end if;
  if p_date_operation not between date '2000-01-01' and date '2099-12-31'
     or p_periode_debut not between date '2000-01-01' and date '2099-12-31'
     or p_periode_fin not between date '2000-01-01' and date '2099-12-31' then
    raise exception 'Une date de livraison ou de période se situe entre l''an 2000 et 2099.' using errcode = '22023';
  end if;
  -- 19. La ventilation : une liste d'objets, chacun un code, un taux, une base et une TVA, et peut-être un motif.
  if jsonb_typeof(p_taux) is distinct from 'array' or jsonb_array_length(p_taux) = 0
     or exists (select 1 from jsonb_array_elements(p_taux) e(v)
                 where jsonb_typeof(e.v) <> 'object'
                    or exists (select 1 from jsonb_object_keys(e.v) k(cle)
                                where k.cle not in ('code', 'taux', 'base', 'tva', 'motif_code', 'motif_texte'))
                    or jsonb_typeof(e.v -> 'code') is distinct from 'string'
                    or jsonb_typeof(e.v -> 'taux') is distinct from 'number'
                    or jsonb_typeof(e.v -> 'base') is distinct from 'number'
                    or jsonb_typeof(e.v -> 'tva') is distinct from 'number'
                    or coalesce(jsonb_typeof(e.v -> 'motif_code'), 'null') not in ('string', 'null')
                    or coalesce(jsonb_typeof(e.v -> 'motif_texte'), 'null') not in ('string', 'null')) then
    raise exception 'La ventilation par taux est illisible : une liste de codes, de taux et de montants.' using errcode = '22023';
  end if;
  -- Chaque règle se juge sur toutes les lignes avant la suivante, et le refus nomme la PREMIÈRE ligne fautive dans
  -- l'ordre de la saisie : ce qui met l'achat de côté se dit avant une forme à reprendre.
  select l.code, l.taux into v_ligne
    from (select e.v ->> 'code' as code, (e.v ->> 'taux')::numeric as taux, e.rang
            from jsonb_array_elements(p_taux) with ordinality e(v, rang)) l
   where exists (select 1 from jsonb_array_elements(p_taux) with ordinality d(v, rang)
                  where d.v ->> 'code' = l.code and (d.v ->> 'taux')::numeric = l.taux and d.rang < l.rang)
   order by l.rang limit 1;
  if found then
    raise exception 'Le code % au taux de % %% figure deux fois dans la ventilation.', v_ligne.code,
      replace(trim_scale(v_ligne.taux)::text, '.', ',') using errcode = '22023';
  end if;
  select e.v ->> 'code' into v_code from jsonb_array_elements(p_taux) with ordinality e(v, rang)
   where e.v ->> 'code' not in ('S', 'E', 'AE', 'K', 'G', 'O', 'Z')
   order by e.rang limit 1;
  if found then
    raise exception 'Le code de TVA « % » n''est pas un code que la facturation électronique admet.', v_code
      using errcode = '22023';
  end if;
  -- HYPOTHÈSE Q7.
  if exists (select 1 from jsonb_array_elements(p_taux) e(v) where e.v ->> 'code' = 'S') then
    raise exception 'Une ligne au taux normal (S) dit une TVA facturée par le fournisseur : cet achat est mis de côté, à trancher par le cabinet.'
      using errcode = '22023';
  end if;
  select e.v ->> 'code' into v_code from jsonb_array_elements(p_taux) with ordinality e(v, rang)
   where (e.v ->> 'taux')::numeric <> 0 or (e.v ->> 'tva')::numeric <> 0
   order by e.rang limit 1;
  if found then
    raise exception 'Une ligne % ne porte ni taux ni TVA : sans TVA facturée, l''un et l''autre sont nuls.', v_code
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_taux) e(v)
              where not ((e.v ->> 'base')::numeric > 0 and (e.v ->> 'base')::numeric < 10000000000000)
                 or (e.v ->> 'base')::numeric <> round((e.v ->> 'base')::numeric, 2)) then
    raise exception 'Chaque base de la ventilation est un montant positif, au centime.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_taux) e(v)
              where e.v ->> 'code' = 'E' and (e.v ->> 'motif_code' is null or e.v ->> 'motif_texte' is null)) then
    raise exception 'Une exonération (E) porte son motif : un code VATEX et son libellé.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_taux) e(v)
              where e.v ->> 'motif_code' is not null
                and (char_length(e.v ->> 'motif_code') > 30 or (e.v ->> 'motif_code') !~ '^VATEX-[A-Z]{2}-[0-9A-Z]+(-[0-9A-Z]+)*$')
                 or e.v ->> 'motif_texte' is not null
                and (char_length(e.v ->> 'motif_texte') > 1024 or btrim(e.v ->> 'motif_texte', E' \t\n\r') = '')) then
    raise exception 'Un motif se compose d''un code VATEX de 30 caractères au plus et d''un libellé de 1 024 caractères au plus, qui ne se compose pas que de blancs.'
      using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_taux) e(v)
              where e.v ->> 'code' = 'Z' and (e.v ->> 'motif_code' is not null or e.v ->> 'motif_texte' is not null)) then
    raise exception 'Une ligne au taux zéro (Z) ne porte pas de motif.' using errcode = '22023';
  end if;
  -- G1.102 : une exonération demande le numéro de TVA du vendeur, qu'un fournisseur hors de l'Union n'a pas.
  if p_schema_identifiant = '0227' and exists (select 1 from jsonb_array_elements(p_taux) e(v) where e.v ->> 'code' = 'E') then
    raise exception 'Une exonération (E) demande le numéro de TVA du fournisseur : un fournisseur établi hors de l''Union n''en a pas.'
      using errcode = '22023';
  end if;
  -- Point 15 de la conception : une acquisition de biens dans l'Union que le dossier n'autoliquide pas est à trancher.
  if not p_autoliquidation and exists (select 1 from jsonb_array_elements(p_taux) e(v) where e.v ->> 'code' in ('AE', 'K')) then
    raise exception 'Une ligne en autoliquidation (AE) ou une acquisition dans l''Union (K) suppose que le dossier autoliquide la TVA de cet achat ; une acquisition de biens qu''il n''a pas à autoliquider est à trancher par le cabinet.'
      using errcode = '22023';
  end if;
  -- Une ligne hors du champ (O) reste admise avec l'autoliquidation : un achat hors de l'Union s'écrit AE ou O, et le
  -- choix est le point 5, NON VÉRIFIÉ, de la conception.
  if p_autoliquidation
     and not exists (select 1 from jsonb_array_elements(p_taux) e(v) where e.v ->> 'code' not in ('E', 'Z')) then
    raise exception 'Rien à autoliquider : une exonération (E) ou un taux zéro (Z) ne laisse aucune TVA due.' using errcode = '22023';
  end if;
  -- La somme des bases et des TVA refait le montant TTC de la pièce, à un centime près (G1.53).
  select sum((e.v ->> 'base')::numeric + (e.v ->> 'tva')::numeric) into v_somme from jsonb_array_elements(p_taux) e(v);
  if abs(v_somme - abs(v_ttc)) > 0.01 then
    raise exception 'La ventilation (% %) ne fait pas le montant TTC de la pièce (% %), à un centime près.',
      replace(to_char(v_somme, 'FM999999999990.00'), '.', ','), v_piece.devise,
      replace(to_char(abs(v_ttc), 'FM999999999990.00'), '.', ','), v_piece.devise using errcode = '22023';
  end if;
  -- 20. La même facture sur une autre pièce du dossier, dont la fiche courante n'est pas retirée.
  if exists (select 1 from public.pieces_hors_de_france f
              where f.dossier_id = p_dossier_id and f.piece_id <> p_piece_id and f.retire_le is null
                and not exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = f.id)
                and f.schema_identifiant = p_schema_identifiant and upper(f.identifiant) = upper(p_identifiant)
                and upper(f.numero) = upper(p_numero)
                and extract(year from f.date_facture) = extract(year from p_date_facture)) then
    raise exception 'Cette facture a déjà une fiche, sur une autre pièce du dossier : une facture ne se déclare qu''une fois.'
      using errcode = '22023';
  end if;

  insert into public.pieces_hors_de_france (
    dossier_id, piece_id, remplace_id, numero, date_facture, type_document, facture_origine_numero, facture_origine_date,
    devise, pays, schema_identifiant, identifiant, nature, autoliquidation, date_operation, periode_debut, periode_fin,
    cree_par
  ) values (
    p_dossier_id, p_piece_id, p_remplace_id, p_numero, p_date_facture, p_type_document,
    case when p_type_document = '381' then p_facture_origine_numero end,
    case when p_type_document = '381' then p_facture_origine_date end,
    v_piece.devise, p_pays, p_schema_identifiant, p_identifiant, p_nature, p_autoliquidation, p_date_operation,
    p_periode_debut, p_periode_fin, auth.uid()
  )
  returning * into v_fiche;
  insert into public.pieces_hors_de_france_taux (fiche_id, dossier_id, code_tva, taux, base, tva, motif_code, motif_texte)
  select v_fiche.id, p_dossier_id, e.v ->> 'code', (e.v ->> 'taux')::numeric, (e.v ->> 'base')::numeric,
         (e.v ->> 'tva')::numeric, e.v ->> 'motif_code', e.v ->> 'motif_texte'
    from jsonb_array_elements(p_taux) with ordinality e(v, rang)
   order by e.rang;
  return v_fiche;
end
$$;

-- ══ Retirer une fiche ══════════
-- Une pièce qui n'était pas un achat à l'étranger : sa fiche courante est marquée retirée (par qui, quand) et cesse de
-- compter ; elle reste, et une fiche nouvelle peut la remplacer. Refus dans cet ordre : l'accès au dossier, la fiche dans
-- ce dossier, remplacée depuis, déjà retirée, figée par la validation. Sous les mêmes verrous que l'enregistrement.
create function public.retirer_fiche_hors_de_france(p_dossier_id uuid, p_fiche_id uuid)
returns public.pieces_hors_de_france
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fiche public.pieces_hors_de_france;
  v_annee integer;
begin
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(public.cle_hors_de_france(p_dossier_id));
  select * into v_fiche from public.pieces_hors_de_france f where f.id = p_fiche_id and f.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Fiche introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.pieces_hors_de_france s where s.remplace_id = p_fiche_id) then
    raise exception 'Cette fiche a été remplacée depuis : relire avant de la retirer.' using errcode = '22023';
  end if;
  if v_fiche.retire_le is not null then
    raise exception 'Cette fiche est déjà retirée.' using errcode = '22023';
  end if;
  v_annee := public.exercice_figeant_la_piece(v_fiche.piece_id);
  if v_annee is not null then
    raise exception 'Cette pièce porte une écriture validée de l''exercice % : sa fiche ne se retire plus.', v_annee
      using errcode = '22023';
  end if;
  update public.pieces_hors_de_france
     set retire_le = now(), retire_par = auth.uid()
   where id = p_fiche_id
  returning * into v_fiche;
  return v_fiche;
end
$$;

-- ══ Les droits d'exécution ══════════
-- Les deux fonctions qui écrivent vérifient l'accès elles-mêmes, et un anonyme n'a rien à y faire. Le gel se lit aux
-- droits de l'appelant (la garde l'appelle pendant une restauration) : un anonyme n'en a pas l'usage. Les autres ne
-- servent qu'aux fonctions et aux déclencheurs : personne ne les appelle.
revoke execute on function public.enregistrer_fiche_hors_de_france(uuid, uuid, uuid, text, date, text, text, date, text, text, text, text, boolean, date, date, date, jsonb)
  from public, anon;
grant execute on function public.enregistrer_fiche_hors_de_france(uuid, uuid, uuid, text, date, text, text, date, text, text, text, text, boolean, date, date, date, jsonb)
  to authenticated;
revoke execute on function public.retirer_fiche_hors_de_france(uuid, uuid) from public, anon;
grant execute on function public.retirer_fiche_hors_de_france(uuid, uuid) to authenticated;
revoke execute on function public.exercice_figeant_la_piece(uuid) from public, anon;
grant execute on function public.exercice_figeant_la_piece(uuid) to authenticated;
revoke execute on function public.cle_hors_de_france(uuid) from public, anon, authenticated;
revoke execute on function public.garder_fiche_hors_de_france() from public, anon, authenticated;
revoke execute on function public.garder_fiche_hors_de_france_taux() from public, anon, authenticated;
revoke execute on function public.garder_piece_hors_de_france() from public, anon, authenticated;

comment on table public.pieces_hors_de_france is
  'La fiche « fournisseur établi hors de France » d''une pièce d''achat (e-reporting des achats, ligne 28.5, étape e2) : saisie par le cabinet, versionnée (remplace_id), retirée et jamais supprimée. Écrite par enregistrer_fiche_hors_de_france et retirer_fiche_hors_de_france seules ; le client n''en voit rien.';
comment on table public.pieces_hors_de_france_taux is
  'La ventilation d''une version de la fiche hors de France, par code (G2.31) et taux (G1.24), dans la devise de la facture.';
comment on function public.enregistrer_fiche_hors_de_france(uuid, uuid, uuid, text, date, text, text, date, text, text, text, text, boolean, date, date, date, jsonb) is
  'Enregistre une version de la fiche hors de France d''une pièce et sa ventilation, d''un seul tenant et sous verrou, après les refus dits dans la migration pieces_hors_de_france.';
comment on function public.retirer_fiche_hors_de_france(uuid, uuid) is
  'Retire la fiche hors de France courante d''une pièce qui n''était pas un achat à l''étranger : elle reste, marquée retirée.';
comment on function public.exercice_figeant_la_piece(uuid) is
  'L''exercice de la première écriture validée d''une pièce, ou du bien qu''elle justifie : le critère du gel de garder_piece_validee.';
comment on function public.cle_hors_de_france(uuid) is
  'La clé du verrou consultatif des fiches hors de France d''un dossier.';
