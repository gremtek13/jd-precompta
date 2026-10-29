-- LE SECOND ACCÈS DU CLIENT D'ESSAI, POUR droitsAcces.sql (outils/leurre/banc.py, famille « second_acces » ; SUR UNE
-- RÉPLIQUE SEULEMENT, par le super-utilisateur) : la production en porte deux, la réplique un. Le second, sur le dossier
-- fictif que la réplique tient à la place du troisième dossier d'essai, sans aucun droit. La base qu'il rend est celle que
-- les sessions précédentes semaient à la main (comparée table par table le 29/10/2026 : identique). Données FICTIVES.
\set ON_ERROR_STOP on
begin;
insert into memberships (user_id, dossier_id, role, email)
values ('797fe440-df8d-4b8e-828b-d148927bfd60', 'd0551e20-0000-4000-8000-000000000003', 'client', 'client@replique.example.test');
select 'second accès', count(*) from memberships where user_id = '797fe440-df8d-4b8e-828b-d148927bfd60';
commit;
