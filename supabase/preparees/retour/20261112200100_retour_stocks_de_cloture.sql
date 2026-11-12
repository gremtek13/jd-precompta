-- RETOUR DE 20261112200000_stocks_de_cloture (LIA2, ligne 36) — À COLLER, et seulement sur l'accord du cabinet : il
-- DÉTRUIT les stocks de clôture saisis (une table), leurs écritures proposées au brouillon (les lignes qui citent un stock),
-- la colonne `ecritures_brouillon.stock_de_cloture_id` et ses deux contraintes, les deux gardes, les deux fonctions et les
-- dix rôles du catalogue. Ce qu'il rend : la base d'avant la migration.
-- Avant de le coller : relever la table et les lignes qui la citent (deux SELECT), baisser `STOCKS_PREVUS`
-- (src/lib/stocks.ts) dans le même déploiement. Il refuse de partir si un exercice VALIDÉ porte une écriture de stock (la
-- validation l'a figée : la retirer changerait des comptes validés), ou si un dossier a réglé l'un des dix rôles dans son
-- plan (la ligne du plan citerait un rôle disparu).

do $garde$
begin
  if to_regclass('public.stocks_de_cloture') is null then
    raise exception 'retour_stocks_de_cloture : la migration stocks_de_cloture n''est pas en base.';
  end if;
  if exists (select 1 from public.ecritures_brouillon b where b.stock_de_cloture_id is not null and b.statut = 'validee') then
    raise exception 'retour_stocks_de_cloture : un exercice validé porte une écriture de stock — le retour ne part pas.';
  end if;
  if exists (select 1 from public.plan_comptable_dossier p where p.role in ('stocks_matieres', 'stocks_autres_approvisionnements',
       'en_cours_biens', 'en_cours_services', 'stocks_produits', 'stocks_marchandises', 'variation_stocks_matieres',
       'variation_stocks_approvisionnements', 'variation_stocks_marchandises', 'production_stockee')) then
    raise exception 'retour_stocks_de_cloture : le plan d''un dossier règle un rôle des stocks — le retour ne part pas.';
  end if;
end
$garde$;

drop function public.retirer_stock_de_cloture(uuid, uuid, integer);
drop function public.enregistrer_stock_de_cloture(uuid, jsonb, jsonb, integer);
drop trigger ecritures_brouillon_stock on public.ecritures_brouillon;
drop function public.garder_ecriture_de_stock();
-- Les écritures proposées des stocks, sous le réglage de chacun (la garde du brouillon est déjà retirée ; celle des
-- écritures validées les laisse partir, proposées).
delete from public.ecritures_brouillon b where b.stock_de_cloture_id is not null;
-- Les contraintes de ses paires avec les sources sœurs (INV2, MCB5g), si l'une d'elles est en base, quel que soit l'ordre
-- des collages : la colonne retirée les emporterait, le retour les nomme.
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_inventaire_hors_des_stocks;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_stock_hors_de_l_ouverture;
alter table public.ecritures_brouillon drop constraint if exists ecritures_brouillon_stock_hors_de_l_affectation;
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_stock_au_31_decembre;
alter table public.ecritures_brouillon drop constraint ecritures_brouillon_stock_sans_autre_source;
drop index public.ecritures_brouillon_stock_de_cloture;
alter table public.ecritures_brouillon drop column stock_de_cloture_id;
drop trigger stocks_de_cloture_par_ses_fonctions on public.stocks_de_cloture;
drop function public.garder_stock_de_cloture();
drop table public.stocks_de_cloture;
delete from public.roles_comptables r where r.role in ('stocks_matieres', 'stocks_autres_approvisionnements', 'en_cours_biens',
  'en_cours_services', 'stocks_produits', 'stocks_marchandises', 'variation_stocks_matieres',
  'variation_stocks_approvisionnements', 'variation_stocks_marchandises', 'production_stockee');
