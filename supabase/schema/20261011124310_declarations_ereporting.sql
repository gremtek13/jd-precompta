-- LA DÉCLARATION D'E-REPORTING HORS APPLICATION, ET LA PIÈCE QU'ELLE RETIENT (ligne 28.5, étape e : e-reporting, cinquième
-- temps, seconde moitié, e5b1 ; conception du 11/10/2026, HISTORIQUE.md, « LE RÉGIME D'E-REPORTING CONFIRMÉ ET LA PIÈCE
-- ÉCARTÉE, EN BASE », « e5b — la suite, conçue », § 1 et § 3 ; « L'E-REPORTING : LA CONCEPTION », § 2.4, § 3.3, § 3.4,
-- § 4.3 et § 4.5).
--
-- CE QUI SE GARDE. Le cabinet dépose l'e-reporting d'une période sur la plateforme agréée du dossier, hors de
-- l'application (le canal `manuel`, comme le statut « Encaissée » de l'étape d4), puis dit ici ce qu'il a déclaré : la
-- base garde le CONTENU que l'application avait calculé pour la période (src/lib/ereporting.ts, étape e4), FIGÉ, et son
-- empreinte SHA-256, calculée PAR ELLE sur le texte du `jsonb` — le navigateur n'en envoie aucune. Une période porte jusqu'à
-- trois déclarations qui ne se mêlent pas : les ventes et les achats sont des transactions, les paiements à part, et un
-- fichier ne porte qu'un rôle de déclarant (spécifications externes de la DGFiP v3.2, dossier général, § 3.7.7 ; annexe 7
-- v1.9, G6.29 et G7.52) — l'`objet` dit lequel, et le rôle avec lui (achats : acheteur ; ventes et paiements : vendeur).
--
-- UNE SEULE DÉCLARATION ACTIVE PAR DOSSIER, OBJET ET PÉRIODE ; UNE CORRECTION EST UNE RECTIFICATIVE QUI LA REMPLACE
-- ENTIÈRE. « Ce flux de transmission rectificatif annule et remplace l'ensemble des données agrégées et précédemment
-- transmises au titre de cette période » (dossier général, § 3.7.7, note 127) ; l'unicité d'une transmission tient à son
-- identifiant, au déclarant et à la période (note 131, G8.05). Une rectificative (`RE`) désigne la déclaration active de la
-- période, qui passe « remplacée » dans la même transaction ; une initiale (`IN`) ne se fait que sur une période qui n'en
-- a aucune. Après l'insertion, rien ne change que ce passage, une fois. L'identifiant de la ligne est celui de la
-- transmission (TT-1, 36 caractères ≤ 50).
--
-- LA BASE VÉRIFIE LA FORME, PAS LE CALCUL (conception, § 3.3 : « le module le calcule, la base vérifie ») : l'accès, le
-- régime confirmé sous lequel la période se juge — du dossier, actif, celui qui couvre son premier jour, sans changement
-- jusqu'à sa fin —, les bornes de la période que ce régime donne (la règle d'e1, `periodeDe`, PORTÉE ICI EN SQL :
-- `periode_ereporting`, confrontée par src/lib/declarationsEreporting.test.ts à la même grille), la fin de la période au
-- 01/09/2027 ou après (BOI-TVA-DECLA-20-30-50, § 10), aucune déclaration active qui la chevauche, l'initiale et la
-- rectificative, la plateforme et la note, le contenu — un objet JSON d'un mégaoctet au plus, qui porte l'objet, les bornes
-- et le rôle annoncés, chaque opération datée dans la période avec ses sources, aucune opération deux fois, jamais à blanc
-- (BOI-TVA-DECLA-20-30-50-30, § 80 ; CGI, ann. II, art. 242 nonies O), le nombre d'opérations qu'il annonce, des sources
-- de ce dossier, aucune déjà déclarée dans une autre période active —, et enfin la période finie à Paris (G7.43). Ce
-- dernier refus vient en dernier : avant le 2 septembre 2027 aucune période ne se déclare, et tous les autres se
-- jugent déjà (supabase/essais/declarationsEreporting.sql les joue en production).
--
-- LES SOURCES. Ce que le contenu déclare vient de sources du dossier — la fiche « hors de France » d'une pièce (étape e2)
-- pour un achat, une facture émise validée pour une vente, un encaissement (étape d1) pour un paiement. La fonction les
-- écrit dans `declarations_ereporting_sources` depuis le contenu, une ligne par source : c'est elle que lit la garde de
-- la pièce (ci-dessous). Elles n'ont pas de clé étrangère : une source se désigne par son genre, et l'histoire d'une
-- déclaration remplacée peut survivre à sa pièce.
--
-- HYPOTHÈSES DU CABINET, PRISES COMME LEURS RECOMMANDATIONS (questions E5-Q6 et E5-Q7, SP/d/e5/questions.md) :
--   - E5-Q6 : une pièce dont une fiche — n'importe quelle version — est source d'une déclaration ACTIVE ne se supprime
--     plus, sauf avec son dossier (`garder_piece_declaree`, le patron de `garder_source_citee`, étape R1). La fiche reste
--     corrigeable : la période passe « à rectifier » (src/lib/declarationsEreporting.ts), et une rectificative qui ne la
--     cite plus libère la pièce ;
--   - E5-Q7 : un régime retiré sous une période déjà déclarée reste possible — `retirer_regime_ereporting` ne change pas ;
--     la déclaration garde le régime sous lequel elle a été faite (`regime_id`), et le module la dit « à rectifier ».
-- Q6 (un encaissement retiré après la déclaration de sa période) attend la réponse du cabinet (étape e5b2) : rien ici ne
-- touche au registre des encaissements.
--
-- Le client du dossier n'en voit rien : aucune policy ne le nomme. Données mesurées le 11/10/2026 : aucune déclaration
-- d'e-reporting n'est due avant les factures du 01/09/2027 ; tout ce qui suit est LATENT.

-- ══ La période d'e-reporting, en SQL ══════════
-- La période d'une fréquence qui contient un jour — la décade (du 1er au 10, du 11 au 20, du 21 à la fin du mois), le
-- mois, le bimestre civil (janvier-février, mars-avril…) : BOI-TVA-DECLA-20-30-50-30, § 50 à § 70 ; BOI-TVA-DECLA-20-30-60,
-- § 170 et § 180. La règle de `periodeDe` (src/lib/periodesEreporting.ts, étape e1), portée ici sans son échéance, que la
-- base n'emploie pas ; une fréquence inconnue rend deux bornes nulles. Sur le seul calendrier : `make_date` et des
-- intervalles d'une date, jamais `date_trunc`, qui passerait par un horodatage du fuseau de la session. Une ligne, rendue
-- comme une table (et non par des paramètres de sortie, que l'inventaire de l'export compterait comme des arguments).
create function public.periode_ereporting(p_jour date, p_frequence text)
returns table (debut date, fin date)
language sql immutable set search_path = public as $$
  select case p_frequence
           when 'mois' then make_date(j.a, j.m, 1)
           when 'bimestre' then make_date(j.a, j.m - (j.m + 1) % 2, 1)
           when 'decade' then make_date(j.a, j.m, case when j.d <= 10 then 1 when j.d <= 20 then 11 else 21 end)
         end,
         case p_frequence
           when 'mois' then (make_date(j.a, j.m, 1) + interval '1 month')::date - 1
           when 'bimestre' then (make_date(j.a, j.m - (j.m + 1) % 2, 1) + interval '2 months')::date - 1
           when 'decade' then case when j.d <= 10 then make_date(j.a, j.m, 10) when j.d <= 20 then make_date(j.a, j.m, 20)
                                   else (make_date(j.a, j.m, 1) + interval '1 month')::date - 1 end
         end
    from (select extract(year from p_jour)::int as a, extract(month from p_jour)::int as m, extract(day from p_jour)::int as d) j
$$;

-- ══ Les déclarations ══════════
-- Une déclaration d'une période, telle que le cabinet l'a faite hors de l'application. Le régime (`regime_id`) est celui
-- sous lequel la période a été jugée : il reste désigné si on le retire ensuite (E5-Q7), d'où une clé sans action — un
-- régime ne se supprime pas, sauf avec le dossier. Le contenu est un objet JSON d'un mégaoctet au plus, comme
-- `revision_conclusions.travaux` borne le sien ; son empreinte, en hexadécimal, est vérifiée par la garde à l'insertion,
-- y compris par la porte de la restauration. Le canal ne connaît que `manuel` : un dépôt par l'API d'une plateforme (étape
-- e9) apportera ses états — l'envoi, l'issue — et élargira les deux listes. L'auteur est un repère d'audit sans clé
-- étrangère, comme `regimes_ereporting.cree_par`.
create table public.declarations_ereporting (
  id uuid primary key default gen_random_uuid(),
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  objet text not null
    constraint declarations_ereporting_objet check (objet in ('ventes', 'achats', 'paiements')),
  periode_debut date not null
    constraint declarations_ereporting_periode_debut check (periode_debut between date '2000-01-01' and date '2099-12-31'),
  periode_fin date not null,
  regime_id uuid not null references public.regimes_ereporting (id),
  type_transmission text not null
    constraint declarations_ereporting_type_transmission check (type_transmission in ('IN', 'RE')),
  remplace_id uuid references public.declarations_ereporting (id),
  canal text not null constraint declarations_ereporting_canal check (canal in ('manuel')),
  plateforme text not null
    constraint declarations_ereporting_plateforme check (btrim(plateforme) <> '' and length(plateforme) <= 200),
  contenu jsonb not null
    constraint declarations_ereporting_contenu check (jsonb_typeof(contenu) = 'object' and octet_length(contenu::text) <= 1048576),
  empreinte text not null constraint declarations_ereporting_empreinte check (empreinte ~ '^[0-9a-f]{64}$'),
  nb_operations integer not null constraint declarations_ereporting_nb_operations check (nb_operations > 0),
  etat text not null constraint declarations_ereporting_etat check (etat in ('declaree', 'remplacee')),
  note text constraint declarations_ereporting_note check (btrim(note) <> '' and length(note) <= 2000),
  cree_par uuid,
  cree_le timestamptz not null default now(),
  constraint declarations_ereporting_periode check (periode_fin >= periode_debut),
  constraint declarations_ereporting_rectificative check ((type_transmission = 'RE') = (remplace_id is not null)),
  constraint declarations_ereporting_une_suite unique (remplace_id)
);

-- Une seule déclaration ACTIVE par dossier, objet et période : deux clics, deux onglets, deux personnes ne déclarent pas
-- deux fois. Partiel, et c'est un invariant : aucun upsert ne le vise, une déclaration s'insère. Avec l'unicité de
-- `remplace_id`, les déclarations d'une période forment une chaîne linéaire, dont l'active est le dernier maillon.
create unique index declarations_ereporting_une_active
  on public.declarations_ereporting (dossier_id, objet, periode_debut, periode_fin) where etat = 'declaree';
create index declarations_ereporting_dossier on public.declarations_ereporting (dossier_id);
create index declarations_ereporting_regime on public.declarations_ereporting (regime_id);

-- Les sources d'une déclaration, une ligne par source, écrites par la fonction depuis le contenu : une fiche pour une
-- déclaration des achats, une facture pour une des ventes, un encaissement pour une des paiements.
create table public.declarations_ereporting_sources (
  declaration_id uuid not null references public.declarations_ereporting (id) on delete cascade,
  dossier_id uuid not null references public.dossiers (id) on delete cascade,
  genre text not null
    constraint declarations_ereporting_sources_genre check (genre in ('fiche', 'facture', 'encaissement')),
  source_id uuid not null,
  primary key (declaration_id, genre, source_id)
);
create index declarations_ereporting_sources_dossier on public.declarations_ereporting_sources (dossier_id);
create index declarations_ereporting_sources_source on public.declarations_ereporting_sources (source_id);

-- ══ Les gardes ══════════
-- Une déclaration naît avec l'empreinte de son contenu, sous un régime de son dossier ; une rectificative remplace la
-- déclaration de la même période et du même objet, déjà passée « remplacée » ; une déclaration active n'en chevauche pas
-- une autre du même objet. Ensuite, rien ne change que le passage de « déclarée » à « remplacée », une fois ; rien ne se
-- supprime, sauf avec le dossier, que la ligne ne voit déjà plus pendant la cascade. Aux droits de l'appelant : la
-- restauration (le super-administrateur) insère par la même porte, et réinsère une chaîne telle qu'elle a été écrite, par
-- vagues (`remplace_id`) — le maillon remplacé d'abord, déjà « remplacé ».
create function public.garder_declaration_ereporting() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Une déclaration d''e-reporting ne se supprime pas : ce qui a été déclaré reste, et une erreur se corrige par une déclaration rectificative de la période.'
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'etat') is distinct from (to_jsonb(old) - 'etat') or old.etat <> 'declaree' or new.etat <> 'remplacee' then
      raise exception 'Une déclaration d''e-reporting ne se modifie pas : une rectificative la remplace, et elle passe « remplacée », une fois.'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.empreinte is distinct from encode(sha256(convert_to(new.contenu::text, 'UTF8')), 'hex') then
    raise exception 'L''empreinte d''une déclaration est celle de son contenu, calculée par la base.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.regimes_ereporting r where r.id = new.regime_id and r.dossier_id = new.dossier_id) then
    raise exception 'Une déclaration se fait sous un régime de son dossier.' using errcode = '23514';
  end if;
  if new.remplace_id is not null and not exists (
       select 1 from public.declarations_ereporting d
        where d.id = new.remplace_id and d.dossier_id = new.dossier_id and d.objet = new.objet
          and d.periode_debut = new.periode_debut and d.periode_fin = new.periode_fin and d.etat = 'remplacee') then
    raise exception 'Une rectificative remplace la déclaration de la même période et du même objet, dans son dossier, passée « remplacée ».'
      using errcode = '23514';
  end if;
  if new.etat = 'declaree' and exists (
       select 1 from public.declarations_ereporting d
        where d.dossier_id = new.dossier_id and d.objet = new.objet and d.etat = 'declaree'
          and (d.periode_debut, d.periode_fin) is distinct from (new.periode_debut, new.periode_fin)
          and d.periode_debut <= new.periode_fin and new.periode_debut <= d.periode_fin) then
    raise exception 'Une déclaration active ne chevauche pas une autre déclaration active du même objet : une même opération ne se déclare pas deux fois.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger declarations_ereporting_gardes before insert or update or delete on public.declarations_ereporting
  for each row execute function public.garder_declaration_ereporting();

-- Une source appartient à une déclaration de son dossier, et en a le genre ; elle ne se modifie pas, et ne part qu'avec
-- son dossier. Qu'elle désigne une ligne qui existe ne se vérifie qu'à la déclaration : l'histoire d'une déclaration
-- remplacée survit à sa pièce, et la restauration la réinsère telle quelle.
create function public.garder_source_declaree() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
      return old;
    end if;
    raise exception 'Les sources d''une déclaration d''e-reporting ne se suppriment pas : elles restent avec elle.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Les sources d''une déclaration d''e-reporting ne se modifient pas.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.declarations_ereporting d
                  where d.id = new.declaration_id and d.dossier_id = new.dossier_id
                    and d.objet = case new.genre when 'fiche' then 'achats' when 'facture' then 'ventes' else 'paiements' end) then
    raise exception 'Une source appartient à une déclaration de son dossier, et en a le genre : une fiche pour les achats, une facture pour les ventes, un encaissement pour les paiements.'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger declarations_ereporting_sources_gardes before insert or update or delete on public.declarations_ereporting_sources
  for each row execute function public.garder_source_declaree();

-- ══ La pièce que sa déclaration retient (HYPOTHÈSE E5-Q6) ══════════
-- Une pièce dont une fiche « hors de France » — n'importe quelle version — est source d'une déclaration ACTIVE ne se
-- supprime plus : ce qui a été déclaré à l'administration resterait sans pièce. Sauf avec son dossier entier, dont la
-- cascade emporte ensemble la pièce, ses fiches et les déclarations. Une rectificative qui ne cite plus la pièce la libère.
-- Une pièce qui a une fiche ne change déjà plus de dossier (`garder_piece_hors_de_france`, étape e2). Seule la source
-- d'une déclaration du dossier de la fiche compte. Une autre réponse du cabinet se reprend en remplaçant cette fonction.
-- DEFINER pour voir les déclarations quelle que soit la RLS de qui supprime ; elle ne rend que la ligne, ou le refus.
create function public.garder_piece_declaree() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_declaration public.declarations_ereporting;
begin
  if not exists (select 1 from public.dossiers d where d.id = old.dossier_id) then
    return old;
  end if;
  select d.* into v_declaration
    from public.pieces_hors_de_france f
    join public.declarations_ereporting_sources s on s.genre = 'fiche' and s.source_id = f.id and s.dossier_id = f.dossier_id
    join public.declarations_ereporting d on d.id = s.declaration_id
   where f.piece_id = old.id and d.etat = 'declaree'
   order by d.periode_debut, d.id
   limit 1;
  if found then
    raise exception 'Cette pièce est déclarée à l''e-reporting des achats du % au % : elle ne se supprime plus, sauf avec son dossier — une erreur se corrige par une déclaration rectificative de la période.',
      to_char(v_declaration.periode_debut, 'DD/MM/YYYY'), to_char(v_declaration.periode_fin, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;
  return old;
end
$$;

create trigger pieces_declarees_ereporting before delete on public.pieces
  for each row execute function public.garder_piece_declaree();

-- ══ Qui lit, qui écrit ══════════
-- Le cabinet LIT les déclarations de ses dossiers et leurs sources, et les écrit par la fonction ci-dessous, seule à le
-- faire depuis le navigateur : les tables n'ont aucune policy d'écriture ordinaire. Le super-administrateur en insère pour
-- restaurer une sauvegarde. Le client n'y voit rien : aucune policy ne le nomme.
alter table public.declarations_ereporting enable row level security;
create policy declarations_ereporting_lecture on public.declarations_ereporting
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy declarations_ereporting_restauration on public.declarations_ereporting
  for insert to authenticated with check (is_super_admin());

alter table public.declarations_ereporting_sources enable row level security;
create policy declarations_ereporting_sources_lecture on public.declarations_ereporting_sources
  for select to authenticated using (admin_du_dossier(dossier_id));
create policy declarations_ereporting_sources_restauration on public.declarations_ereporting_sources
  for insert to authenticated with check (is_super_admin());

-- ══ Déclarer une période ══════════
-- Le cabinet dit avoir déclaré une période sur une plateforme, avec le contenu que l'application a calculé, sous le régime
-- qu'elle a jugé ; initiale sans `p_remplace_id`, rectificative avec. Sous le VERROU de l'e-reporting du dossier
-- (`cle_ereporting`, étape e5a), que la confirmation et le retrait d'un régime prennent aussi : le régime lu reste celui du
-- dossier jusqu'à la fin, et deux déclarations de la même période se suivent. Les pièces des fiches citées sont
-- verrouillées en partage avant d'être lues : une suppression concurrente attend, puis voit la déclaration
-- (`garder_piece_declaree`) ; partie avant, elle fait refuser la source.
--
-- Les refus, dans cet ordre — le module (src/lib/declarationsEreporting.ts) les dit avant le clic, dans le même ordre et
-- sous les mêmes mots :
--   1. l'accès au dossier annoncé, ou un dossier qui n'existe pas (42501) ; 2. l'objet ; 3. les bornes, renseignées ;
--   4. le régime, dans ce dossier (P0002) ; 5. actif ; 6. qui couvre le premier jour ; 7. le régime en vigueur ce jour-là ;
--   8. aucun autre régime dans la période ; 9. des paiements sur option pour les débits ; 10. les bornes de la période que
--   ce régime donne ; 11. la fin au 01/09/2027 ou après ; 12. aucune déclaration active qui chevauche la période ; 13. une
--   initiale sur une période déjà déclarée ; 14. la déclaration remplacée, dans ce dossier (P0002) ; 15. de la même
--   période et du même objet ; 16. active ; 17. la plateforme, nommée ; 18. de 200 caractères au plus ; 19. une note de
--   plus de 2 000 caractères (des espaces seuls ne sont pas une note) ; 20. le contenu, un objet JSON ; 21. d'un mégaoctet
--   au plus ; 22. sur l'objet et la période annoncés ; 23. lisible : chaque opération, sa date et ses sources ; 24. chaque
--   opération dans la période ; 25. au moins une ; 26. aucune source deux fois ; 27. le nombre d'opérations annoncé ;
--   28. des sources de ce dossier ; 29. aucune déjà déclarée dans une autre période active ; 30. la période finie à Paris.
-- Tous en 22023, sauf l'accès et les deux introuvables.
create function public.declarer_ereporting_hors_application(
  p_dossier_id uuid,
  p_objet text,
  p_debut date,
  p_fin date,
  p_regime_id uuid,
  p_remplace_id uuid,
  p_plateforme text,
  p_contenu jsonb,
  p_note text
)
returns public.declarations_ereporting
language plpgsql
security definer
set search_path = public
as $$
declare
  v_aujourd_hui date := (now() at time zone 'Europe/Paris')::date;
  v_note text := case when btrim(p_note) = '' then null else p_note end;
  v_regime public.regimes_ereporting;
  v_suivant public.regimes_ereporting;
  v_frequence text;
  v_periode record;
  v_autre public.declarations_ereporting;
  v_active public.declarations_ereporting;
  v_remplacee public.declarations_ereporting;
  v_cle text;
  v_liste text;
  v_operations jsonb;
  v_lisible boolean;
  v_date date;
  v_ids uuid[];
  v_pieces uuid[];
  v_nombre integer;
  v_inconnue boolean;
  v_declaration public.declarations_ereporting;
begin
  -- 1. L'accès, sur le dossier ANNONCÉ : un dossier qui n'existe pas se refuse comme un dossier interdit.
  if not public.admin_du_dossier(p_dossier_id) or not exists (select 1 from public.dossiers d where d.id = p_dossier_id) then
    raise exception 'Accès refusé à ce dossier.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(public.cle_ereporting(p_dossier_id));
  -- 2. L'objet : les ventes et les achats sont des transactions, les paiements à part.
  if p_objet is null or p_objet not in ('ventes', 'achats', 'paiements') then
    raise exception 'Une déclaration d''e-reporting porte sur les ventes, les achats ou les paiements du dossier.' using errcode = '22023';
  end if;
  -- 3.
  if p_debut is null or p_fin is null then
    raise exception 'Les deux bornes de la période sont à renseigner.' using errcode = '22023';
  end if;
  -- 4 à 8. Le régime sous lequel la période se juge : du dossier, actif, le régime en vigueur à son premier jour — celui
  -- qui le couvre et qu'aucun autre ne suit avant —, et aucun régime qui déclare autrement ne commence avant sa fin : une
  -- période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment (hypothèse E5-Q1,
  -- étape e5a). Deux régimes égaux qui se suivent ne sont pas un changement.
  select * into v_regime from public.regimes_ereporting r where r.id = p_regime_id and r.dossier_id = p_dossier_id;
  if not found then
    raise exception 'Régime introuvable dans ce dossier.' using errcode = 'P0002';
  end if;
  if v_regime.retire_le is not null then
    raise exception 'Ce régime est retiré : une période se déclare sous le régime confirmé qui la couvre.' using errcode = '22023';
  end if;
  if v_regime.depuis > p_debut then
    raise exception 'Ce régime ne vaut qu''à partir du % : il ne couvre pas le début de la période.',
      to_char(v_regime.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_suivant from public.regimes_ereporting r
   where r.dossier_id = p_dossier_id and r.retire_le is null and r.depuis > v_regime.depuis and r.depuis <= p_debut
   order by r.depuis desc limit 1;
  if found then
    raise exception 'Le régime en vigueur le % est celui confirmé à partir du % : relisez.',
      to_char(p_debut, 'DD/MM/YYYY'), to_char(v_suivant.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select * into v_suivant from public.regimes_ereporting r
   where r.dossier_id = p_dossier_id and r.retire_le is null and r.depuis > p_debut and r.depuis <= p_fin
     and (r.statut_tva, r.article_exoneration, r.tva_periodicite, r.tva_sur_debits, r.frequence_transactions, r.frequence_paiements)
         is distinct from (v_regime.statut_tva, v_regime.article_exoneration, v_regime.tva_periodicite, v_regime.tva_sur_debits,
                           v_regime.frequence_transactions, v_regime.frequence_paiements)
   order by r.depuis limit 1;
  if found then
    raise exception 'Le régime du dossier change dans la période, le % : une période à cheval sur deux régimes ne se déclare pas ici, les sources publiques ne disant pas comment. À trancher par le cabinet.',
      to_char(v_suivant.depuis, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 9. La fréquence de l'objet sous ce régime : aucune pour des paiements sur option pour les débits
  -- (BOI-TVA-DECLA-20-30-60, § 30).
  v_frequence := case when p_objet = 'paiements' then v_regime.frequence_paiements else v_regime.frequence_transactions end;
  if v_frequence is null then
    raise exception 'Sous ce régime, sur option pour la TVA sur les débits, le dossier n''a pas de données de paiement à déclarer.'
      using errcode = '22023';
  end if;
  -- 10. Les bornes : la période de cette fréquence qui contient le premier jour (e1).
  select * into v_periode from public.periode_ereporting(p_debut, v_frequence);
  if v_periode.debut is distinct from p_debut or v_periode.fin is distinct from p_fin then
    raise exception 'Du % au % n''est pas une période de ses déclarations : sous ce régime, elles se font %.',
      to_char(p_debut, 'DD/MM/YYYY'), to_char(p_fin, 'DD/MM/YYYY'),
      case v_frequence when 'decade' then 'par décade' when 'mois' then 'chaque mois' else 'tous les deux mois' end
      using errcode = '22023';
  end if;
  -- 11. L'obligation d'une PME ou d'une micro-entreprise vise les factures du 01/09/2027 et après.
  if p_fin < date '2027-09-01' then
    raise exception 'La période finit le %, avant le 1er septembre 2027 : l''e-reporting d''une PME ou d''une micro-entreprise commence avec les factures de ce jour.',
      to_char(p_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 12. Une déclaration active d'autres bornes qui chevauche la période — faite sous un régime d'une autre fréquence,
  -- retiré depuis : une même opération ne se déclare pas deux fois.
  select * into v_autre from public.declarations_ereporting d
   where d.dossier_id = p_dossier_id and d.objet = p_objet and d.etat = 'declaree'
     and (d.periode_debut, d.periode_fin) is distinct from (p_debut, p_fin)
     and d.periode_debut <= p_fin and p_debut <= d.periode_fin
   order by d.periode_debut, d.id limit 1;
  if found then
    raise exception 'La période chevauche celle d''une déclaration active, du % au % : une même opération ne se déclare pas deux fois. À trancher par le cabinet.',
      to_char(v_autre.periode_debut, 'DD/MM/YYYY'), to_char(v_autre.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 13 à 16. L'initiale ou la rectificative.
  select * into v_active from public.declarations_ereporting d
   where d.dossier_id = p_dossier_id and d.objet = p_objet and d.periode_debut = p_debut and d.periode_fin = p_fin
     and d.etat = 'declaree';
  if p_remplace_id is null then
    if found then
      raise exception 'Une déclaration de cette période est déjà active, faite sur « % » : une correction se fait par une déclaration rectificative, qui la remplace entière.',
        v_active.plateforme using errcode = '22023';
    end if;
  else
    select * into v_remplacee from public.declarations_ereporting d where d.id = p_remplace_id and d.dossier_id = p_dossier_id;
    if not found then
      raise exception 'Déclaration introuvable dans ce dossier.' using errcode = 'P0002';
    end if;
    if v_remplacee.objet <> p_objet or v_remplacee.periode_debut <> p_debut or v_remplacee.periode_fin <> p_fin then
      raise exception 'Une rectificative remplace la déclaration de la même période et du même objet : celle-ci en déclare une autre.'
        using errcode = '22023';
    end if;
    if v_remplacee.etat <> 'declaree' then
      raise exception 'Cette déclaration est déjà remplacée : une rectificative remplace la déclaration active de la période.'
        using errcode = '22023';
    end if;
  end if;
  -- 17 et 18. La plateforme, telle que le cabinet la nomme.
  if p_plateforme is null or btrim(p_plateforme) = '' then
    raise exception 'La plateforme sur laquelle la période a été déclarée est à nommer.' using errcode = '22023';
  end if;
  if length(p_plateforme) > 200 then
    raise exception 'Le nom de la plateforme dépasse 200 caractères.' using errcode = '22023';
  end if;
  -- 19.
  if length(v_note) > 2000 then
    raise exception 'La note de la déclaration dépasse 2 000 caractères.' using errcode = '22023';
  end if;
  -- 20 à 22. Le contenu : un objet JSON d'un mégaoctet au plus, qui dit l'objet, les bornes et le rôle du déclarant.
  if p_contenu is null or jsonb_typeof(p_contenu) <> 'object' then
    raise exception 'Le contenu déclaré est à joindre : celui que l''application a calculé pour la période.' using errcode = '22023';
  end if;
  if octet_length(p_contenu::text) > 1048576 then
    raise exception 'Le contenu déclaré dépasse un mégaoctet (1 048 576 octets).' using errcode = '22023';
  end if;
  if p_contenu ->> 'objet' is distinct from p_objet or p_contenu ->> 'debut' is distinct from to_char(p_debut, 'YYYY-MM-DD')
     or p_contenu ->> 'fin' is distinct from to_char(p_fin, 'YYYY-MM-DD')
     or p_contenu ->> 'role' is distinct from (case when p_objet = 'achats' then 'BY' else 'SE' end) then
    raise exception 'Le contenu ne porte pas sur cet objet et cette période : relisez.' using errcode = '22023';
  end if;
  -- 23. Les opérations : un tableau — `achats`, `transactions` ou `paiements` —, chacune un objet qui porte sa date civile
  -- (AAAA-MM-JJ) et ses sources : la fiche et sa pièce d'un achat, les factures d'un agrégat de ventes, les encaissements
  -- d'un agrégat de paiements, chacune un identifiant.
  v_cle := case p_objet when 'achats' then 'achats' when 'ventes' then 'transactions' else 'paiements' end;
  v_liste := case p_objet when 'ventes' then 'factures' when 'paiements' then 'encaissements' end;
  v_operations := p_contenu -> v_cle;
  v_lisible := jsonb_typeof(v_operations) is not distinct from 'array';
  if v_lisible then
    v_lisible := not exists (
      select 1 from jsonb_array_elements(v_operations) e(v)
       where jsonb_typeof(e.v) is distinct from 'object'
          or jsonb_typeof(e.v -> 'date') is distinct from 'string'
          or not coalesce((e.v ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and pg_input_is_valid(e.v ->> 'date', 'date'), false)
          or case when p_objet = 'achats'
                  then jsonb_typeof(e.v -> 'ficheId') is distinct from 'string' or jsonb_typeof(e.v -> 'pieceId') is distinct from 'string'
                       or not coalesce(pg_input_is_valid(e.v ->> 'ficheId', 'uuid') and pg_input_is_valid(e.v ->> 'pieceId', 'uuid'), false)
                  else jsonb_typeof(e.v -> v_liste) is distinct from 'array'
                       or exists (select 1
                                    from jsonb_array_elements(case when jsonb_typeof(e.v -> v_liste) = 'array' then e.v -> v_liste
                                                                   else '[]'::jsonb end) s(x)
                                   where jsonb_typeof(s.x) is distinct from 'string'
                                      or not coalesce(pg_input_is_valid(s.x #>> '{}', 'uuid'), false))
             end);
  end if;
  if not v_lisible then
    raise exception 'Le contenu déclaré ne se lit pas : chaque opération porte sa date et ses sources.' using errcode = '22023';
  end if;
  -- 24. La première date d'opération hors des bornes.
  select min((e.v ->> 'date')::date) into v_date from jsonb_array_elements(v_operations) e(v)
   where (e.v ->> 'date')::date not between p_debut and p_fin;
  if v_date is not null then
    raise exception 'Une opération du contenu est datée du %, hors de la période : relisez.', to_char(v_date, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;
  -- Les sources, dans l'ordre du contenu, et pour un achat la pièce de sa fiche.
  if p_objet = 'achats' then
    select coalesce(array_agg((e.v ->> 'ficheId')::uuid order by e.o), '{}'), coalesce(array_agg((e.v ->> 'pieceId')::uuid order by e.o), '{}')
      into v_ids, v_pieces
      from jsonb_array_elements(v_operations) with ordinality e(v, o);
  else
    select coalesce(array_agg((s.x #>> '{}')::uuid order by e.o, s.p), '{}') into v_ids
      from jsonb_array_elements(v_operations) with ordinality e(v, o),
           jsonb_array_elements(e.v -> v_liste) with ordinality s(x, p);
    v_pieces := '{}';
  end if;
  v_nombre := cardinality(v_ids);
  -- 25 à 27. Jamais à blanc ; une opération une fois ; le nombre que le contenu annonce.
  if v_nombre = 0 then
    raise exception 'Une période sans opération ne se déclare pas : aucune transmission n''est attendue.' using errcode = '22023';
  end if;
  if v_nombre <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'Une même source figure deux fois dans le contenu : une opération ne se déclare qu''une fois.' using errcode = '22023';
  end if;
  if (p_contenu -> 'nombreOperations') is distinct from to_jsonb(v_nombre) then
    raise exception 'Le contenu n''annonce pas le nombre de ses opérations (%) : relisez.', v_nombre using errcode = '22023';
  end if;
  -- 28. Des sources de ce dossier : la fiche d'une pièce — celle que l'achat nomme — dans ce dossier, la pièce verrouillée ;
  -- une facture validée ; un encaissement.
  if p_objet = 'achats' then
    perform 1 from public.pieces p where p.dossier_id = p_dossier_id and p.id = any (v_pieces) order by p.id for share;
    v_inconnue := exists (
      select 1 from unnest(v_ids, v_pieces) as s(fiche, piece)
       where not exists (select 1 from public.pieces_hors_de_france f join public.pieces p on p.id = f.piece_id
                          where f.id = s.fiche and f.dossier_id = p_dossier_id and f.piece_id = s.piece
                            and p.dossier_id = p_dossier_id));
  elsif p_objet = 'ventes' then
    v_inconnue := exists (
      select 1 from unnest(v_ids) x
       where not exists (select 1 from public.factures_emises f
                          where f.id = x and f.dossier_id = p_dossier_id and f.statut = 'validee'));
  else
    v_inconnue := exists (
      select 1 from unnest(v_ids) x
       where not exists (select 1 from public.encaissements_factures e where e.id = x and e.dossier_id = p_dossier_id));
  end if;
  if v_inconnue then
    raise exception 'Une source du contenu n''est pas % de ce dossier : relisez.',
      case p_objet when 'achats' then 'la fiche « fournisseur établi hors de France » d''une pièce' when 'ventes' then 'une facture validée'
                   else 'un encaissement' end
      using errcode = '22023';
  end if;
  -- 29. Une opération que porte déjà une autre déclaration active — la même pièce pour un achat, quelle que soit la
  -- version de sa fiche — : la période qui la porte se rectifie d'abord. La déclaration que la rectificative remplace ne
  -- compte pas.
  select d.* into v_autre
    from public.declarations_ereporting d
    join public.declarations_ereporting_sources s on s.declaration_id = d.id
   where d.dossier_id = p_dossier_id and d.etat = 'declaree' and d.id is distinct from p_remplace_id
     and case when p_objet = 'achats'
              then s.genre = 'fiche' and exists (select 1 from public.pieces_hors_de_france f
                                                  where f.id = s.source_id and f.piece_id = any (v_pieces))
              else s.genre = case p_objet when 'ventes' then 'facture' else 'encaissement' end and s.source_id = any (v_ids)
         end
   order by d.periode_debut, d.id limit 1;
  if found then
    raise exception 'Une opération du contenu est déjà déclarée, dans la période du % au % : la période qui la porte se rectifie d''abord.',
      to_char(v_autre.periode_debut, 'DD/MM/YYYY'), to_char(v_autre.periode_fin, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  -- 30. La période finie, le jour lu à Paris (G7.43 : la fin d'une période est avant le jour du contrôle).
  if p_fin >= v_aujourd_hui then
    raise exception 'La période n''est pas finie : elle se déclare à partir du %.', to_char(p_fin + 1, 'DD/MM/YYYY')
      using errcode = '22023';
  end if;

  -- D'un seul tenant : la déclaration remplacée passe « remplacée » AVANT que la rectificative ne s'insère — l'index des
  -- déclarations actives n'en admet qu'une —, puis les sources.
  if p_remplace_id is not null then
    update public.declarations_ereporting set etat = 'remplacee' where id = p_remplace_id;
  end if;
  insert into public.declarations_ereporting (
    dossier_id, objet, periode_debut, periode_fin, regime_id, type_transmission, remplace_id, canal, plateforme, contenu,
    empreinte, nb_operations, etat, note, cree_par
  ) values (
    p_dossier_id, p_objet, p_debut, p_fin, p_regime_id, case when p_remplace_id is null then 'IN' else 'RE' end, p_remplace_id,
    'manuel', p_plateforme, p_contenu, encode(sha256(convert_to(p_contenu::text, 'UTF8')), 'hex'), v_nombre, 'declaree',
    v_note, auth.uid()
  )
  returning * into v_declaration;
  insert into public.declarations_ereporting_sources (declaration_id, dossier_id, genre, source_id)
  select v_declaration.id, p_dossier_id, case p_objet when 'achats' then 'fiche' when 'ventes' then 'facture' else 'encaissement' end, x
    from unnest(v_ids) x;
  return v_declaration;
end
$$;

-- ══ Les droits d'exécution ══════════
-- La fonction qui écrit vérifie l'accès elle-même, et un anonyme n'a rien à y faire. Les autres ne servent qu'à elle et aux
-- déclencheurs : personne ne les appelle.
revoke execute on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text)
  from public, anon;
grant execute on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text)
  to authenticated;
revoke execute on function public.periode_ereporting(date, text) from public, anon, authenticated;
revoke execute on function public.garder_declaration_ereporting() from public, anon, authenticated;
revoke execute on function public.garder_source_declaree() from public, anon, authenticated;
revoke execute on function public.garder_piece_declaree() from public, anon, authenticated;

comment on table public.declarations_ereporting is
  'Une déclaration d''e-reporting faite hors de l''application (ligne 28.5, étape e5b1) : l''objet (ventes, achats ou paiements), la période, le régime sous lequel elle a été jugée, le contenu figé et son empreinte calculée par la base, initiale ou rectificative ; une seule active par dossier, objet et période. Écrite par declarer_ereporting_hors_application seule ; le client n''en voit rien.';
comment on table public.declarations_ereporting_sources is
  'Les sources d''une déclaration d''e-reporting (ligne 28.5, étape e5b1) : les fiches, factures ou encaissements que son contenu déclare, écrites par la fonction depuis le contenu. Une pièce dont une fiche est source d''une déclaration active ne se supprime plus (hypothèse E5-Q6, garder_piece_declaree).';
comment on function public.declarer_ereporting_hors_application(uuid, text, date, date, uuid, uuid, text, jsonb, text) is
  'Garde une déclaration d''e-reporting faite hors de l''application, initiale ou rectificative, sous verrou, après les refus dits dans la migration declarations_ereporting.';
comment on function public.periode_ereporting(date, text) is
  'La période d''e-reporting d''une fréquence (decade, mois, bimestre) qui contient un jour : la règle de periodeDe (src/lib/periodesEreporting.ts), sans son échéance.';
comment on function public.garder_piece_declaree() is
  'Une pièce dont une fiche hors de France est source d''une déclaration d''e-reporting active ne se supprime plus, sauf avec son dossier (hypothèse E5-Q6).';
