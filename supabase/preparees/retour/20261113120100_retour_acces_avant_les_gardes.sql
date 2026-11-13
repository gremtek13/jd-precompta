-- RETOUR DE acces_avant_les_gardes (20261113120000) : la porte d'accès retirée des 32 tables, sa fonction retirée ; les
-- gardes, les policies et les données restent telles quelles. Après lui, les gardes parlent de nouveau avant la RLS (le
-- défaut décrit en tête de la migration revient). DESTRUCTIF (des `drop`) : il se colle dans l'éditeur SQL de Supabase,
-- dans une transaction, avec sa ligne d'historique. Il ne retire que ce que la migration a posé : la garde de tête vérifie
-- que la porte est bien la sienne (sa fonction, `security invoker`, ses 32 déclencheurs, et ceux que la migration ou les
-- sept migrations préparées d'INAL5, INV2, LIA2, INV4, AFF2, INV3 et EXD2 ont posés sur leurs dix tables).

do $garde$
begin
  if to_regprocedure('public.acces_avant_les_gardes()') is null then
    raise exception 'retour_acces_avant_les_gardes : la porte n''est pas en base ; rien à retirer.';
  end if;
  if (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.acces_avant_les_gardes()'::regprocedure) then
    raise exception 'retour_acces_avant_les_gardes : la fonction en base n''est pas la porte de la migration (security definer).';
  end if;
  if (select count(*) from pg_catalog.pg_trigger t where t.tgname = '_acces_avant_les_gardes'
        and t.tgfoid = 'public.acces_avant_les_gardes()'::regprocedure
        and (select c.relname from pg_catalog.pg_class c where c.oid = t.tgrelid) not in ('affectations_du_resultat', 'conservations_des_dossiers', 'exercices', 'exercices_valides',
          'inventaires_declares', 'lignes_d_affectation', 'memberships', 'operations_inventaire', 'provisions', 'stocks_de_cloture')) <> 32
     or exists (select 1 from pg_catalog.pg_trigger t where t.tgfoid = 'public.acces_avant_les_gardes()'::regprocedure
                 and t.tgname <> '_acces_avant_les_gardes') then
    raise exception 'retour_acces_avant_les_gardes : la porte n''est pas sur les 32 tables de la migration, ou un autre déclencheur l''appelle : relire avant de retirer.';
  end if;
end
$garde$;

drop trigger _acces_avant_les_gardes on public.a_nouveaux;
drop trigger _acces_avant_les_gardes on public.cabinets;
drop trigger _acces_avant_les_gardes on public.categories;
drop trigger _acces_avant_les_gardes on public.contacts;
drop trigger _acces_avant_les_gardes on public.continuite_des_series;
drop trigger _acces_avant_les_gardes on public.cotisations_declarees;
drop trigger _acces_avant_les_gardes on public.declarations_tva;
drop trigger _acces_avant_les_gardes on public.devis;
drop trigger _acces_avant_les_gardes on public.documents_divers;
drop trigger _acces_avant_les_gardes on public.ecritures_brouillon;
drop trigger _acces_avant_les_gardes on public.encaissements_factures;
drop trigger _acces_avant_les_gardes on public.encaissements_factures_taux;
drop trigger _acces_avant_les_gardes on public.facture_lignes;
drop trigger _acces_avant_les_gardes on public.factures_emises;
drop trigger _acces_avant_les_gardes on public.factures_importees;
drop trigger _acces_avant_les_gardes on public.immobilisations;
drop trigger _acces_avant_les_gardes on public.imports_factures;
drop trigger _acces_avant_les_gardes on public.lettrages_manuels;
drop trigger _acces_avant_les_gardes on public.lignes_bancaires;
drop trigger _acces_avant_les_gardes on public.modeles_numerotation;
drop trigger _acces_avant_les_gardes on public.operations_caisse;
drop trigger _acces_avant_les_gardes on public.parametres_des_cotisations;
drop trigger _acces_avant_les_gardes on public.pieces;
drop trigger _acces_avant_les_gardes on public.pieces_des_factures_reprises;
drop trigger _acces_avant_les_gardes on public.plan_comptable_cabinet;
drop trigger _acces_avant_les_gardes on public.plan_comptable_dossier;
drop trigger _acces_avant_les_gardes on public.reglements_groupes;
drop trigger _acces_avant_les_gardes on public.saisies_2035;
drop trigger _acces_avant_les_gardes on public.saisies_2035e;
drop trigger _acces_avant_les_gardes on public.soldes_reportes;
drop trigger _acces_avant_les_gardes on public.vehicules;
drop trigger _acces_avant_les_gardes on public.ventilations_bancaires;
-- Les dix tables des sept migrations préparées, là où la porte y est.
do $preparees$
declare
  v_table text;
begin
  foreach v_table in array array['affectations_du_resultat', 'conservations_des_dossiers', 'exercices', 'exercices_valides',
    'inventaires_declares', 'lignes_d_affectation', 'memberships', 'operations_inventaire', 'provisions', 'stocks_de_cloture'] loop
    if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = to_regclass('public.' || v_table) and t.tgname = '_acces_avant_les_gardes') then
      execute format('drop trigger _acces_avant_les_gardes on public.%I', v_table);
    end if;
  end loop;
end
$preparees$;
drop function public.acces_avant_les_gardes();
