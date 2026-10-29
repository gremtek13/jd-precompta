-- LE JOURNAL DES DÉSIGNATIONS SEMÉ POUR rls.sql (outils/leurre/banc.py, famille « journal » ; SUR UNE RÉPLIQUE
-- SEULEMENT, par le super-utilisateur) : la production en porte un, la réplique aucun. Dans le dossier `test`, par les
-- fonctions, sous la session du chef (une désignation, puis son retrait) ; dans celui du client, par la porte de la
-- restauration du super-administrateur (une déclaration). Validé : rls.sql se joue ensuite sur la base semée.
begin;
select 'chef super-administrateur', exists (select 1 from super_admins s where s.user_id = 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162');
select set_config('request.jwt.claims', json_build_object('sub', 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162', 'role', 'authenticated')::text, true);
set local role authenticated;
select 'désignée', (public.designer_exemplaire_facture('001c7ed7-c23b-4590-901e-693489f8af24',
  (select p.id from pieces p where p.dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24' and p.type_piece = 'vente'),
  (select f.id from factures_emises f where f.dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24' and f.statut = 'validee'))).facture_id is not null;
select 'défaite', (public.defaire_exemplaire_facture('001c7ed7-c23b-4590-901e-693489f8af24',
  (select p.id from pieces p where p.dossier_id = '001c7ed7-c23b-4590-901e-693489f8af24' and p.type_piece = 'vente'))).facture_id is null;
insert into designations_des_pieces (dossier_id, piece_id, geste, facture_id, auteur_id)
  select 'ac538d93-7da3-4403-bca6-2d7836810a6f', p.id, 'declaration', null, 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162'
    from pieces p where p.dossier_id = 'ac538d93-7da3-4403-bca6-2d7836810a6f' and p.type_piece = 'vente';
reset role;
select 'journal', dossier_id::text, geste, count(*) from designations_des_pieces group by 2, 3 order by 2, 3;
commit;
