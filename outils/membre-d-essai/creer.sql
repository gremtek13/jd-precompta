-- LE MEMBRE D'ÉQUIPE D'ESSAI, EN PRODUCTION (ESSAIS-Q1, tranchée par le cabinet le 16/11/2026 : « (A) Créer le compte d'essai
-- en production ») — À COLLER PAR LE CABINET dans l'éditeur SQL de Supabase, d'un seul tenant (le texte ouvre et ferme sa
-- transaction). JAMAIS par `apply_migration` : ce sont des LIGNES, pas un schéma — une migration entrerait dans l'export, que
-- la reprise rejoue dans une base vide, où le dossier `test` n'existe pas. Mode d'emploi : outils/membre-d-essai/README.md.
--
-- POURQUOI. Les essais de supabase/essais/ joués en production qui ont besoin d'un simple membre de l'équipe (ni chef, ni
-- super-administrateur) — `repriseEtModeleComptable.sql`, `accesAvantLesGardes.sql` et neuf blocs de `rls.sql` — nomment le
-- compte `3e3b0000-0000-4000-8000-000000000001`, le comptable des répliques. Il n'existe pas en production : rejoués le
-- 15/11/2026, ces essais s'arrêtaient sur la clé étrangère de l'assignation. Ce texte le pose tel que les répliques le
-- portent (le semis de la réplique mère : un compte, sa ligne d'équipe « comptable » dans le cabinet du dossier `test`, son
-- assignation au seul dossier `test`), sous une adresse qui dit ce qu'il est.
--
-- CE QU'IL ÉCRIT, ET RIEN D'AUTRE — trois lignes :
--   1. auth.users : le compte, à cet identifiant fixe ; AUCUN mot de passe (vide : le service d'authentification n'en
--      authentifie aucun) ; l'adresse `membre-d-essai@essai.invalid` (le domaine `.invalid` est réservé, RFC 2606 : aucun
--      courrier n'y arrive, ni lien de connexion, ni lien de récupération), NON confirmée ; BANNI jusqu'en 2999 (le service
--      n'ouvre aucune session à un compte banni, par aucun chemin) ; ni identité, ni facteur, ni session. Les colonnes de
--      jetons reçoivent le texte vide, comme le service les écrit lui-même : nulles, elles rendraient la liste des comptes
--      illisible au service (`auth.admin.listUsers`, dont `create-client-access` et `create-team-member` se servent).
--   2. public.cabinet_admins : le compte, « comptable » (pas chef) du cabinet du dossier `test`, sous la même adresse.
--   3. public.dossier_assignations : le compte assigné au seul dossier `test`.
-- Il ne touche à aucune autre ligne, à aucun objet du schéma, à aucun réglage.
--
-- CE QUE CE COMPTE PEUT FAIRE : RIEN, hors des essais. Personne ne peut se connecter sous lui (ni mot de passe, ni adresse
-- joignable, banni). Seuls les essais le jouent, en se faisant passer pour lui DANS une transaction qu'ils annulent
-- (`request.jwt.claims`), ce qui ne passe pas par le service d'authentification. Il gère le seul dossier fictif `test` ;
-- dans la liste de l'équipe, son adresse le dit. Il ne s'assigne jamais à un dossier réel.
--
-- SES GARDES : il se refuse si le compte, ou son adresse, existe déjà ; si le dossier `test` manque ; et, à la fin, si ce
-- qui est écrit n'est pas exactement ce qui est dit ci-dessus — alors RIEN n'est écrit (la transaction s'annule).
begin;

do $garde$
begin
  if exists (select 1 from auth.users where id = '3e3b0000-0000-4000-8000-000000000001') then
    raise exception 'Le membre d''essai existe déjà : rien n''est écrit.';
  end if;
  if exists (select 1 from auth.users where lower(email) = 'membre-d-essai@essai.invalid')
     or exists (select 1 from public.cabinet_admins where lower(email) = 'membre-d-essai@essai.invalid') then
    raise exception 'L''adresse du membre d''essai sert déjà : rien n''est écrit.';
  end if;
  if not exists (select 1 from public.dossiers where id = '001c7ed7-c23b-4590-901e-693489f8af24' and cabinet_id is not null) then
    raise exception 'Le dossier d''essai test manque : rien n''est écrit.';
  end if;
end
$garde$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, banned_until,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '3e3b0000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'membre-d-essai@essai.invalid', '', null, '2999-12-31 00:00:00+00',
  '', '', '', '', '', '', '', '',
  '{"provider": "email", "providers": ["email"]}', '{"compte_d_essai": "ESSAIS-Q1"}', false, false, now(), now()
);

insert into public.cabinet_admins (user_id, cabinet_id, role, email)
select '3e3b0000-0000-4000-8000-000000000001', d.cabinet_id, 'comptable', 'membre-d-essai@essai.invalid'
  from public.dossiers d where d.id = '001c7ed7-c23b-4590-901e-693489f8af24';

insert into public.dossier_assignations (dossier_id, user_id)
values ('001c7ed7-c23b-4590-901e-693489f8af24', '3e3b0000-0000-4000-8000-000000000001');

-- La garde de fin : exactement ce qui est dit, sinon rien.
do $fin$
begin
  if (select count(*) from auth.users u where u.id = '3e3b0000-0000-4000-8000-000000000001'
        and coalesce(u.encrypted_password, '') = '' and u.email_confirmed_at is null and u.banned_until > now() + interval '900 years') <> 1
     or exists (select 1 from auth.identities i where i.user_id = '3e3b0000-0000-4000-8000-000000000001')
     or (select count(*) from public.cabinet_admins a join public.dossiers d on d.cabinet_id = a.cabinet_id
          where a.user_id = '3e3b0000-0000-4000-8000-000000000001' and a.role = 'comptable'
            and d.id = '001c7ed7-c23b-4590-901e-693489f8af24') <> 1
     or (select count(*) from public.cabinet_admins where user_id = '3e3b0000-0000-4000-8000-000000000001') <> 1
     or (select string_agg(dossier_id::text, ',') from public.dossier_assignations
          where user_id = '3e3b0000-0000-4000-8000-000000000001') is distinct from '001c7ed7-c23b-4590-901e-693489f8af24'
     or exists (select 1 from public.super_admins where user_id = '3e3b0000-0000-4000-8000-000000000001')
     or exists (select 1 from public.memberships where user_id = '3e3b0000-0000-4000-8000-000000000001') then
    raise exception 'Garde de fin : le membre d''essai n''est pas exactement celui que ce texte pose ; rien n''est écrit.';
  end if;
end
$fin$;

commit;

select 'membre d''essai posé' as resultat;
