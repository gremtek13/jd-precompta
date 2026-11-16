-- RETIRER LE MEMBRE D'ÉQUIPE D'ESSAI (ESSAIS-Q1) — DESTRUCTIF, SUR LA DÉCISION DU CABINET SEULE, À COLLER dans l'éditeur SQL
-- de Supabase. Le chemin le plus simple reste le tableau de bord : Authentication › Users › `membre-d-essai@essai.invalid` ›
-- « Delete user » ; ce texte en est l'équivalent.
--
-- CE QU'IL DÉTRUIT : le compte (auth.users) ; par les clés étrangères en cascade, sa ligne d'équipe (cabinet_admins) et son
-- assignation (dossier_assignations). Rien d'autre ne le cite : les essais n'écrivent rien qui reste. Il se refuse si le
-- compte porte autre chose que ce que creer.sql a posé (un mot de passe, une identité, un autre dossier, un accès client) :
-- c'est alors un compte dont on a changé la nature, à regarder avant de le retirer.
--
-- QUAND : avec le dossier `test`, que MVP-D8 garde tant que les essais se rejouent en production ; ou plus tôt, si le cabinet
-- cesse de rejouer en production les essais qui le nomment. Après lui, ces essais s'arrêtent de nouveau sur la clé
-- étrangère de l'assignation, comme avant le 16/11/2026.
begin;

do $garde$
begin
  if not exists (select 1 from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') then
    raise exception 'Le membre d''essai n''existe pas : rien à retirer.';
  end if;
  if exists (select 1 from auth.users where id = '3e3b0000-0000-4000-8000-000000000001' and coalesce(encrypted_password, '') <> '')
     or exists (select 1 from auth.identities where user_id = '3e3b0000-0000-4000-8000-000000000001')
     or exists (select 1 from public.dossier_assignations where user_id = '3e3b0000-0000-4000-8000-000000000001'
                 and dossier_id <> '001c7ed7-c23b-4590-901e-693489f8af24')
     or exists (select 1 from public.memberships where user_id = '3e3b0000-0000-4000-8000-000000000001') then
    raise exception 'Le membre d''essai n''est plus celui que creer.sql a posé : le regarder avant de le retirer ; rien n''est retiré.';
  end if;
end
$garde$;

delete from auth.users where id = '3e3b0000-0000-4000-8000-000000000001';

commit;
