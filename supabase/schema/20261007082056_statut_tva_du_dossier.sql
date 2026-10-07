-- Ligne 28.5 de la feuille de route, étape (a) : le STATUT DE TVA du dossier, en trois — redevable, franchise
-- en base, exonéré. Décision du cabinet du 07/10/2026.
--
-- `assujetti_tva` ne disait qu'une chose : le dossier récupère-t-il la TVA ? Il rangeait sous « non » deux
-- situations que la facturation électronique sépare. La franchise en base (CGI, art. 293 B) n'est pas une
-- exonération : un franchisé est dans le champ de l'e-invoicing et de l'e-reporting. Une exonération (art. 261
-- à 261 E, les soins de l'art. 261, 4, 1° au premier rang) en sort. Et l'application proposait, sur la facture
-- d'un dossier de soins exonérés, la mention de la franchise, que superpdp-emit transmettait aussi comme motif
-- de toute ligne à 0 %.
--
-- `statut_tva` FAIT FOI, et `assujetti_tva` EN EST DÉDUIT : il reste lu partout où l'on demande si le dossier
-- récupère la TVA (le montant retenu d'une pièce, la CA3, l'affectation d'une recette du relevé…), et rien de
-- ce qui le lit ne change. Nul, le statut est À PRÉCISER : un dossier non assujetti d'avant cette migration, ou
-- un dossier neuf, dont personne n'a encore dit s'il est en franchise ou exonéré. On ne le devine pas.
--
-- `article_exoneration` dit quelle exonération, dans une liste fermée dont chaque entrée porte sa mention et
-- son code VATEX (lib/statutTva.ts) : obligatoire pour rien, permis à un dossier exonéré et à un dossier
-- redevable dont une partie de l'activité est exonérée, interdit ailleurs.

alter table public.dossiers
  add column statut_tva text,
  add column article_exoneration text;

comment on column public.dossiers.statut_tva is
  'Le statut de TVA du dossier (ligne 28.5) : redevable, franchise (art. 293 B du CGI) ou exonere (art. 261 à '
  '261 E). Nul : à préciser. Fait foi : assujetti_tva en est déduit par dossiers_deduire_assujetti_tva.';
comment on column public.dossiers.article_exoneration is
  'L''exonération du dossier, dans la liste fermée de lib/statutTva.ts : soins (art. 261, 4, 1°), enseignement et '
  'formation professionnelle (261, 4, 4° a), cours particuliers (261, 4, 4° b), assurance (261 C, 2°). Permise '
  'à un dossier exonéré ou redevable, nulle ailleurs.';

-- Un dossier assujetti est redevable : c'est certain. Un dossier qui ne l'est pas reste à préciser.
update public.dossiers set statut_tva = 'redevable' where assujetti_tva;

alter table public.dossiers
  add constraint dossiers_statut_tva_check
    check (statut_tva in ('redevable', 'franchise', 'exonere')),
  add constraint dossiers_article_exoneration_check
    check (article_exoneration in ('cgi_261_4_1', 'cgi_261_4_4_a', 'cgi_261_4_4_b', 'cgi_261_c_2')),
  add constraint dossiers_statut_tva_coherent
    check (assujetti_tva = coalesce(statut_tva = 'redevable', false)),
  -- Le `coalesce` n'est pas un détail : sans lui, un statut NUL rend la comparaison nulle, et une contrainte
  -- dont la condition est nulle PASSE. Un article sur un statut à préciser serait admis — l'essai l'a attrapé.
  add constraint dossiers_article_exoneration_coherent
    check (article_exoneration is null or coalesce(statut_tva in ('exonere', 'redevable'), false));

-- Le statut fait foi : le changer change `assujetti_tva`. Trois chemins écrivent encore le booléen seul, et
-- chacun reçoit le statut qu'il implique, sans rien deviner entre franchise et exonération :
--   - une création qui n'envoie pas de statut (assujetti par défaut à faux : statut à préciser) ;
--   - la restauration d'une sauvegarde faite avant ce statut (assujetti : redevable ; sinon à préciser) ;
--   - une fenêtre de l'application ouverte avant ce statut, qui ne sait basculer que le booléen.
-- Un écrivain qui enverrait les deux en désaccord voit le booléen recalculé depuis le statut ; un article laissé
-- sur un statut qui ne le permet pas est refusé par dossiers_article_exoneration_coherent, jamais effacé en
-- silence — sauf quand c'est l'ancien booléen qui retire le statut, et l'article avec lui.
create function public.deduire_assujetti_tva() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.statut_tva is null then
      if new.assujetti_tva then
        new.statut_tva := 'redevable';
      end if;
    else
      new.assujetti_tva := new.statut_tva = 'redevable';
    end if;
  elsif new.statut_tva is distinct from old.statut_tva then
    new.assujetti_tva := coalesce(new.statut_tva = 'redevable', false);
  elsif new.assujetti_tva is distinct from old.assujetti_tva then
    new.statut_tva := case when new.assujetti_tva then 'redevable' end;
    if new.statut_tva is null then
      new.article_exoneration := null;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.deduire_assujetti_tva() from public, anon, authenticated;

create trigger dossiers_deduire_assujetti_tva
  before insert or update of statut_tva, assujetti_tva on public.dossiers
  for each row execute function public.deduire_assujetti_tva();
