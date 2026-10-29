-- LA CAISSE D'UN DOSSIER BNC : LE RETRAIT, LE REMPLACEMENT ET LE VERSEMENT D'ESPÈCES (ligne 26.6, étape C1b ; MVP-D2).
-- La conception : HISTORIQUE.md, « LA CAISSE D'UN DOSSIER BNC : LA CONCEPTION — MVP-D2 (LIGNE 26.6) », § 3, § 4 et § 8,
-- n° 2, revue par « LA CAISSE : LA SAISIE DU PRATICIEN ET LA PIÈCE RÉGLÉE PAR LA CAISSE — LA CONCEPTION REPRISE
-- (CAISSE-Q1 ET Q4) », § 5 et § 9, n° 2 ; les réponses du cabinet CAISSE-Q1 à Q4 et CAISSE2-Q1 à Q4 (28/10/2026), qui
-- ne changent rien ici. Préparée sous une version PROVISOIRE, après la migration `caisse` (étape C1,
-- `supabase/preparees/20261029120000_caisse.sql`), qu'elle suppose et ne change pas. À COLLER par le cabinet : le corps
-- de deux fonctions retire les lignes du brouillon qui citent une opération, et `apply_migration` attend alors une
-- confirmation qui ne lui parvient pas (CLAUDE.md, « Quand `apply_migration` attend une confirmation »).
--
-- CE QU'ELLE POSE.
--   1. `retirer_operation_caisse(dossier, opération)` : une opération de la caisse se RETIRE, jamais ne se supprime ni
--      ne se modifie — sa date et son auteur posés (`retire_le`, `retire_par`), et TOUTES les lignes du brouillon qui
--      la citent retirées avec elle, quel que soit son genre, le paiement d'une pièce compris (la migration 4) ; sous
--      le réglage de CETTE opération (`jd.caisse`), que la garde de la table exige, une fois.
--   2. `remplacer_operation_caisse(dossier, opération, nouvelle opération…)` : d'un seul geste, l'ancienne retirée
--      comme ci-dessus et la nouvelle écrite avec son écriture, qui porte `remplace_id` ; la saisie retient la version
--      qu'elle remplace. La nouvelle est jugée par `enregistrer_operation_caisse` elle-même — ses refus, dans son ordre
--      et sous ses mots, l'écriture recomposée et comparée, la caisse de ses sorties —, dans une sous-transaction
--      défaite aussitôt, puis écrite telle qu'elle l'a écrite, son lien en plus : une seule copie de ces refus, et la
--      fonction du remplacement suit d'elle-même ce qu'`enregistrer_operation_caisse` apprendra (l'écriture que la base
--      composera pour le client, à la migration de son droit).
--   3. `ecrire_mouvement_compte_bilan` REMPLACÉE : en trésorerie, un mouvement du relevé s'écrit sur le compte de la
--      caisse du PLAN du dossier — un crédit, le versement d'espèces en banque (la banque au débit, la caisse au
--      crédit) ; un débit, des espèces retirées pour la caisse —, sans passer par `refus_compte_de_bilan` ; tout le
--      reste inchangé, au caractère près. La caisse jamais négative se juge à la fin de la transaction, par les
--      déclencheurs de la migration `caisse` (« Ce versement de … rendrait la caisse négative le … »).
--   4. `refus_compte_de_bilan` REMPLACÉE : en trésorerie, un compte 53 qui n'est pas la caisse du dossier se refuse
--      sous une phrase à lui ; les autres comptes de trésorerie (51, 52, 54), et tout compte en engagement — où la
--      caisse attend sa conception —, sous celle d'hier, comme toutes les autres branches, au caractère près.
--
-- LES REFUS, DANS L'ORDRE (que le module de l'étape C2 redira avant le clic, sous les mêmes mots) :
--   - le retrait — 1. l'accès, avant toute lecture (`qui_ecrit_la_caisse` : 42501) ; 2. l'opération, de ce dossier
--     (P0002) ; 3. pour un accès du client, ses propres opérations seulement (42501 : celle du cabinet, celle d'un
--     autre accès) ; 4. une opération déjà retirée ou remplacée depuis la lecture (P0002) ; 5. la frontière de la
--     validation (23514, pour personne) ; 6. la caisse jamais négative, quand l'opération retirée apportait des espèces
--     (23514, sous les mots de `texte_caisse_negative`) ;
--   - le remplacement — les cinq premiers du retrait, sur l'ancienne ; puis ceux d'`enregistrer_operation_caisse` sur
--     la nouvelle, dans son ordre (le dossier en trésorerie, le genre, la date, le montant, la catégorie, le taux,
--     l'ensemble du jour, l'écriture, la caisse d'une sortie) ; enfin la caisse jamais négative, quand l'ancienne
--     apportait des espèces que la nouvelle ne rend pas (23514, sous les mots du retrait de l'ancienne).
-- La caisse se juge sur ce que le geste laisse : un remplacement qui ne passe sous zéro qu'un instant, entre le retrait
-- et l'écriture, passe.
--
-- CE QU'ELLE TOUCHE D'EXISTANT : les corps de deux fonctions du relevé, relus en production le 29/10/2026 à leur
-- empreinte, que la garde de tête vérifie ; leur signature, leur sécurité, leurs droits et leur commentaire restent
-- (`create or replace`). Aucune table, colonne, contrainte, policy, ni aucun déclencheur ; aucune donnée lue ni écrite
-- d'avance. NEUTRE AUJOURD'HUI (relevé en production le 29/10/2026, des comptes) : aucune opération de caisse (la table
-- n'y est pas encore), aucun mouvement classé sur un compte de bilan ; le compte de la caisse ne reçoit un mouvement
-- qu'avec la migration `caisse`, qui juge la caisse.
--
-- CE QUE LE TEXTE RETIRE (ce que le détecteur d'`apply_migration` retient) : aucun objet, aucune donnée en
-- s'appliquant ; le corps des deux fonctions de la caisse retire, quand on les appelle, les lignes du brouillon de
-- l'opération retirée — d'où le collage. Aucune barre oblique inverse. Son retour arrière, donné à part, rend les deux
-- corps d'hier et retire les deux fonctions ; il se refuse dès qu'un retrait, un remplacement ou un mouvement classé
-- sur un compte 53 existe, et ne se colle que sur l'accord du cabinet.
--
-- VERSION PROVISOIRE, HORS DE L'EXPORT, comme la migration `caisse` : le fichier entre dans `supabase/schema/` le jour
-- de son collage, sous la version que porte sa ligne d'historique, texte inchangé, avec la migration `caisse` et
-- l'étape C2.

-- ══ 0. La garde de tête ══════════
-- Elle refuse une seconde application ; une base sans la migration `caisse` — sa table, ses huit fonctions à leur
-- empreinte, relues sur la réplique de l'étape après son application telle qu'elle est préparée — ; et une fonction que
-- celle-ci appelle ou remplace qui ne serait plus celle qu'elle suppose, à l'empreinte de son corps, les retours
-- chariot d'un collage écartés (relue en production le 29/10/2026 pour les fonctions d'avant la caisse). Puis ce que la
-- caisse lit : le rôle `caisse` du plan, de racine 53, et les colonnes que les deux fonctions écrivent.
do $garde$
declare
  v_attendue record;
  v_nombre integer;
  v_empreinte text;
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('retirer_operation_caisse', 'remplacer_operation_caisse')) then
    raise exception 'La migration caisse_retrait_et_versement est déjà en base : elle ne s''applique pas deux fois.';
  end if;
  if to_regclass('public.operations_caisse') is null then
    raise exception 'La migration caisse n''est pas en base : l''appliquer d''abord, puis celle-ci.';
  end if;
  for v_attendue in select * from (values
      ('qui_ecrit_la_caisse', 'public.qui_ecrit_la_caisse(uuid)', 'd4faab33c7c0cdb268621bd0e881d62c'),
      ('premier_jour_negatif_de_la_caisse', 'public.premier_jour_negatif_de_la_caisse(uuid)', 'fab45f7271d8f7c9104d0082039221cb'),
      ('texte_caisse_negative', 'public.texte_caisse_negative(text, numeric, date, numeric)', 'aa7e7a933ac8ce8afe78209dd32607ab'),
      ('garder_operation_caisse', 'public.garder_operation_caisse()', '3bc037a8e7ae542ef880870256e05dd1'),
      ('garder_ecriture_de_caisse', 'public.garder_ecriture_de_caisse()', 'f936e2bde429a4700d6cfd71d9c6e4d3'),
      ('garder_la_caisse', 'public.garder_la_caisse()', '270ae2ea2787a016e9ecc532a264ecbc'),
      ('enregistrer_operation_caisse', 'public.enregistrer_operation_caisse(uuid, text, date, numeric, uuid, numeric, uuid[], jsonb)', '6d474ccc8f4aefa3bac04c71ef1914fd'),
      ('enregistrer_operations_de_caisse', 'public.enregistrer_operations_de_caisse(uuid, jsonb)', 'f79a5b97da8df6b75af9d59201b76d25'),
      ('cle_validation', 'public.cle_validation(uuid)', 'bcbb03363036aa6aa037c0b829e3382f'),
      ('frontiere_validation', 'public.frontiere_validation(uuid)', '24a04846471ec5e8cdbae6f3b9f4a2e8'),
      ('exercice_fige', 'public.exercice_fige(uuid, integer)', 'b70cbdd4a870f5e17e8e4c6851506bdc'),
      ('compte_du_role', 'public.compte_du_role(uuid, text)', '6108ab75d148aa2800484b89bb112c70'),
      ('compte_du_dirigeant', 'public.compte_du_dirigeant(uuid)', 'c02c751713f2d759745267145e9e6b40'),
      ('ecrire_mouvement_compte_bilan', 'public.ecrire_mouvement_compte_bilan(uuid, text, jsonb)', '954cd1f02123d8c4de03354d6f77e652'),
      ('refus_compte_de_bilan', 'public.refus_compte_de_bilan(text, text, text)', 'e7b841f56d284748a252dc7ef7d39ce5')
    ) as t(nom, signature, empreinte) loop
    select count(*) into v_nombre from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_attendue.nom;
    select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p
     where p.oid = to_regprocedure(v_attendue.signature);
    if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then
      raise exception 'La fonction % n''est plus celle que cette migration suppose (empreinte attendue %…) : la relire avant d''appliquer cette migration.',
        v_attendue.nom, left(v_attendue.empreinte, 8);
    end if;
  end loop;
  if not exists (select 1 from public.roles_comptables r where r.role = 'caisse' and r.racines = array['53']) then
    raise exception 'Le plan comptable des rôles n''a pas le rôle « caisse » de racine 53 : la caisse n''a pas de compte.';
  end if;
  select count(*) into v_nombre from pg_attribute a
   where not a.attisdropped and (a.attrelid, a.attname) in (
     ('public.operations_caisse'::regclass, 'retire_le'), ('public.operations_caisse'::regclass, 'retire_par'),
     ('public.operations_caisse'::regclass, 'remplace_id'), ('public.operations_caisse'::regclass, 'origine'),
     ('public.operations_caisse'::regclass, 'cree_par'), ('public.ecritures_brouillon'::regclass, 'operation_caisse_id'));
  if v_nombre <> 6 then
    raise exception 'Une colonne que les fonctions de la caisse écrivent manque (% sur 6) : cette base n''est pas celle que la migration suppose.', v_nombre;
  end if;
end
$garde$;

-- ══ 1. Retirer une opération de la caisse ══════════
-- Le patron d'`enregistrer_operation_caisse` : l'accès annoncé avant toute lecture, puis les refus dans l'ordre que le
-- module redira sous les mêmes mots (l'en-tête de la migration). Le client, quand la migration de son droit le fera
-- reconnaître par `qui_ecrit_la_caisse` (aujourd'hui, elle ne rend que « cabinet » : ce chemin dort), ne retire que ses
-- propres opérations ; le cabinet retire toutes celles de la caisse. La caisse se juge ici, sous les mots du geste,
-- quand l'opération retirée apportait des espèces (une recette, un apport, le paiement d'une pièce de vente) ; les
-- déclencheurs de la migration `caisse` la jugent encore à la fin de la transaction.
create function public.retirer_operation_caisse(p_dossier_id uuid, p_operation_id uuid)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_operation public.operations_caisse;
  v_frontiere date;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous : celui de la validation, partagé (la frontière lue ici est
  --    celle que la garde lira), et celui de la caisse du dossier, exclusif (deux sessions qui retirent, remplacent ou
  --    vident la même caisse se suivent, et la seconde voit la première).
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));

  -- 2. L'opération, de ce dossier, verrouillée.
  select o.* into v_operation from public.operations_caisse o
   where o.id = p_operation_id and o.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Cette opération n''est pas dans la caisse de ce dossier : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 3. Le client ne retire que ses propres opérations.
  if v_origine = 'client' and v_operation.origine = 'cabinet' then
    raise exception 'Cette opération a été saisie par ton cabinet : demande-lui de la corriger.' using errcode = '42501';
  end if;
  if v_origine = 'client' and v_operation.cree_par is distinct from auth.uid() then
    raise exception 'Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.'
      using errcode = '42501';
  end if;

  -- 4. Une opération déjà retirée — ou remplacée : le remplacement la retire.
  if v_operation.retire_le is not null then
    raise exception 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 5. La frontière de la validation : au-delà, ni retrait ni remplacement, pour personne.
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_operation.date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_operation.date)::integer) using errcode = '23514';
  end if;

  -- Le retrait, sous le réglage de CETTE opération, retiré aussitôt : l'opération, puis toutes les lignes du brouillon
  -- qui la citent.
  perform set_config('jd.caisse', v_operation.id::text, true);
  update public.operations_caisse set retire_le = now(), retire_par = auth.uid()
   where id = v_operation.id
  returning * into v_operation;
  delete from public.ecritures_brouillon where operation_caisse_id = v_operation.id;
  perform set_config('jd.caisse', '', true);

  -- 6. La caisse jamais négative, quand l'opération retirée apportait des espèces.
  if v_operation.genre <> 'prelevement' and v_operation.montant > 0 then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative('retrait_' || v_operation.genre, v_operation.montant, v_jour, v_solde)
        using errcode = '23514';
    end if;
  end if;
  return v_operation;
end
$$;

comment on function public.retirer_operation_caisse(uuid, uuid) is
  'Retire une opération de la caisse et toutes les lignes du brouillon qui la citent (ligne 26.6, étape C1b) : jamais une suppression. Ses refus, dans l''ordre : l''accès (42501), l''opération de ce dossier (P0002), pour le client ses propres opérations seulement (42501), une opération déjà retirée ou remplacée (P0002), la frontière de la validation (23514), la caisse jamais négative (23514).';

-- ══ 2. Remplacer une opération de la caisse ══════════
-- L'ancienne se retire comme au § 1 — ses cinq premiers refus, puis son retrait — ; la nouvelle est jugée et écrite par
-- `enregistrer_operation_caisse` dans une sous-transaction qu'on défait aussitôt (le code « JDC1B », qu'aucune fonction
-- ne lève ailleurs) : ses refus remontent tels quels, et sinon on garde la ligne et l'écriture qu'elle a écrites, pour
-- les écrire de nouveau, l'opération portant `remplace_id`. Aucun refus ni aucune règle de la saisie n'est donc recopié
-- ici. Le paiement d'une pièce (la migration 4) ne se REMPLACE pas par un paiement ici : `enregistrer_operation_caisse`
-- ne connaît pas ce genre ; il se retire, ou se remplace par une autre opération (un prélèvement, CAISSE2-Q4).
create function public.remplacer_operation_caisse(p_dossier_id uuid, p_operation_id uuid, p_genre text, p_date date,
  p_montant numeric, p_categorie_id uuid, p_taux_tva numeric, p_encaissements_du_jour uuid[], p_ecritures jsonb)
returns public.operations_caisse
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origine text;
  v_ancienne public.operations_caisse;
  v_nouvelle public.operations_caisse;
  v_lignes public.ecritures_brouillon[];
  v_frontiere date;
  v_jour date;
  v_solde numeric;
begin
  -- 1. L'accès, avant toute lecture ; puis les verrous, ceux du retrait.
  v_origine := public.qui_ecrit_la_caisse(p_dossier_id);
  perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));
  perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));

  -- 2. L'ancienne, de ce dossier, verrouillée.
  select o.* into v_ancienne from public.operations_caisse o
   where o.id = p_operation_id and o.dossier_id = p_dossier_id
   for update;
  if not found then
    raise exception 'Cette opération n''est pas dans la caisse de ce dossier : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 3. Le client ne remplace que ses propres opérations.
  if v_origine = 'client' and v_ancienne.origine = 'cabinet' then
    raise exception 'Cette opération a été saisie par ton cabinet : demande-lui de la corriger.' using errcode = '42501';
  end if;
  if v_origine = 'client' and v_ancienne.cree_par is distinct from auth.uid() then
    raise exception 'Cette opération a été saisie depuis un autre accès à ce dossier : demande à ton cabinet de la corriger.'
      using errcode = '42501';
  end if;

  -- 4. Une opération déjà retirée ou remplacée.
  if v_ancienne.retire_le is not null then
    raise exception 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.' using errcode = 'P0002';
  end if;

  -- 5. La frontière de la validation, pour l'ancienne ; celle de la nouvelle, `enregistrer_operation_caisse` la juge.
  v_frontiere := public.frontiere_validation(p_dossier_id);
  if v_frontiere is not null and v_ancienne.date <= v_frontiere then
    raise exception '% : sa caisse ne change plus.',
      public.exercice_fige(p_dossier_id, extract(year from v_ancienne.date)::integer) using errcode = '23514';
  end if;

  -- Le retrait de l'ancienne, sous son réglage, retiré aussitôt : l'opération, puis toutes ses lignes.
  perform set_config('jd.caisse', v_ancienne.id::text, true);
  update public.operations_caisse set retire_le = now(), retire_par = auth.uid()
   where id = v_ancienne.id
  returning * into v_ancienne;
  delete from public.ecritures_brouillon where operation_caisse_id = v_ancienne.id;
  perform set_config('jd.caisse', '', true);

  -- 6 et suivants. La nouvelle, jugée et écrite par `enregistrer_operation_caisse`, l'ancienne déjà retirée : la caisse
  -- d'une sortie se juge sur ce que le remplacement laisse. Puis la sous-transaction se défait.
  begin
    v_nouvelle := public.enregistrer_operation_caisse(p_dossier_id, p_genre, p_date, p_montant, p_categorie_id, p_taux_tva,
                                                      p_encaissements_du_jour, p_ecritures);
    v_lignes := array(select b from public.ecritures_brouillon b where b.operation_caisse_id = v_nouvelle.id order by b.id);
    raise exception 'La nouvelle opération est jugée : elle s''écrit maintenant avec son lien.' using errcode = 'JDC1B';
  exception when sqlstate 'JDC1B' then
    null;
  end;

  -- La nouvelle, telle qu'`enregistrer_operation_caisse` l'a écrite, son lien en plus, sous son réglage, retiré
  -- aussitôt.
  v_nouvelle.remplace_id := v_ancienne.id;
  perform set_config('jd.caisse', v_nouvelle.id::text, true);
  insert into public.operations_caisse select (v_nouvelle).*;
  insert into public.ecritures_brouillon select (l).* from unnest(v_lignes) l;
  perform set_config('jd.caisse', '', true);

  -- La caisse jamais négative, quand l'ancienne apportait des espèces que la nouvelle ne rend pas, sous les mots de son
  -- retrait ; une nouvelle sortie a déjà été jugée par `enregistrer_operation_caisse`, sous les siens.
  if v_ancienne.genre <> 'prelevement' and v_ancienne.montant > 0 then
    select n.jour, n.solde into v_jour, v_solde from public.premier_jour_negatif_de_la_caisse(p_dossier_id) n;
    if v_jour is not null then
      raise exception '%', public.texte_caisse_negative('retrait_' || v_ancienne.genre, v_ancienne.montant, v_jour, v_solde)
        using errcode = '23514';
    end if;
  end if;
  return v_nouvelle;
end
$$;

comment on function public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) is
  'Remplace une opération de la caisse d''un seul geste (ligne 26.6, étape C1b) : l''ancienne retirée avec ses lignes, sous les refus du retrait ; la nouvelle jugée et écrite par enregistrer_operation_caisse, sous ses refus et dans leur ordre, et portant remplace_id ; puis la caisse jamais négative (23514). Un remplacement qui ne passe sous zéro qu''un instant passe.';

-- ══ 3. Le refus d'un compte de bilan : le compte 53 qui n'est pas la caisse du dossier ══════════
-- Le corps d'hier (migration `refus_tva_par_sa_declaration`), au caractère près, plus une branche : en trésorerie, un
-- compte 53 que la fonction d'écriture n'a pas reconnu pour la caisse du plan du dossier. La phrase ne nomme pas le
-- compte — la fonction ne connaît pas le dossier — et reste vraie de tout compte 53. En engagement, la caisse attend sa
-- conception : un compte 53 y garde la phrase d'hier, celle des autres comptes de trésorerie.
create or replace function public.refus_compte_de_bilan(p_compte text, p_mode text, p_dirigeant text) returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_compte is null or p_compte !~ '^[0-9]{6,10}$'
      then 'Ce numéro de compte n''a pas la forme d''un compte de l''application : six à dix chiffres.'
    when p_compte ~ '^[67]'
      then 'Un compte de charge ou de produit (classe 6 ou 7) s''affecte par une catégorie.'
    when p_compte !~ '^[1-5]'
      then 'Un compte de bilan est de classe 1 à 5.'
    when p_compte ~ '^512'
      then 'Le 512 est le compte du relevé lui-même. Un virement vers un autre compte du professionnel (épargne, second compte bancaire) s''écrit au 580000, virements internes.'
    when p_compte ~ '^53' and p_mode = 'tresorerie'
      then 'Seule la caisse du dossier, celle de son plan comptable, reçoit un mouvement de banque : un versement d''espèces, ou un retrait d''espèces pour la caisse, s''écrit sur son compte.'
    when p_compte ~ '^5[1-4]'
      then 'Un virement vers un autre compte de trésorerie du professionnel (autre banque, caisse, chèques postaux, régie d''avances) s''écrit au 580000, virements internes.'
    when p_compte = p_dirigeant or p_compte ~ '^108'
      then format('Les apports et les prélèvements du dirigeant passent par « Virement personnel », qui les écrit sur son compte (%s).', p_dirigeant)
    when p_compte ~ '^164'
      then 'Une échéance ou un déblocage d''emprunt se rapproche de son emprunt, qui sépare le capital, les intérêts et l''assurance : « Rapprocher d''un emprunt ».'
    when p_compte ~ '^4[01]'
      then 'Un compte de fournisseur ou de client se solde en rapprochant la facture du mouvement.'
    when p_compte ~ '^445'
      then 'Un compte de TVA ne se choisit pas ici : la TVA se solde par sa déclaration, enregistrée dans l''onglet TVA, et son paiement ou le remboursement d''un crédit se rapproche ensuite d''elle, depuis cette fiche.'
    when p_compte ~ '^2[012]'
      then 'Un bien s''inscrit au registre des immobilisations depuis sa facture : son acquisition s''écrit sur le compte de sa nature, et il s''amortit.'
    when p_compte ~ '^(2[89]|39|49|59)'
      then 'Un compte d''amortissement ou de dépréciation ne reçoit pas un mouvement de banque.'
    when p_compte ~ '^3'
      then 'Un compte de stock ne reçoit pas un mouvement de banque : le stock se constate à l''inventaire.'
    when p_compte ~ '^(10[5-7]|1[12])'
      then 'Les réserves, les écarts de réévaluation ou d''équivalence, le report à nouveau et le résultat ne reçoivent pas un mouvement de banque : ils naissent de l''affectation du résultat ou d''une écriture d''inventaire.'
    when p_compte ~ '^1[45]'
      then 'Une provision ne reçoit pas un mouvement de banque : elle se constate à l''inventaire.'
    when p_compte ~ '^47'
      then 'Un compte transitoire ou d''attente ne garde pas un mouvement : un mouvement qu''on ne sait pas encore classer reste à traiter, et l''exercice ne se valide qu''une fois tout classé.'
    when p_compte ~ '^(468|48)'
      then 'Un compte de régularisation (charges à payer, produits à recevoir, charges ou produits constatés d''avance) ne reçoit pas un mouvement de banque : il se passe à l''inventaire.'
    when p_mode = 'tresorerie' and p_compte ~ '^4[234]'
      then 'En comptabilité de trésorerie, un salaire, une cotisation ou un impôt payés sont des charges : range le paiement dans une catégorie. L''impôt sur le revenu de l''exploitant est un virement personnel.'
    when p_mode = 'engagement' and p_compte ~ '^4[234]' and p_compte !~ '^444'
      then 'L''application ne passe pas l''écriture qui solderait ce compte (paie, impôts et taxes) : range le paiement dans une catégorie de charge.'
  end
$$;

-- ══ 4. Écrire un mouvement sur un compte de bilan : la caisse du plan ══════════
-- Le corps d'hier (migration `lignes_propres_au_mouvement`), au caractère près, plus la caisse du plan du dossier, lue
-- avec la banque sous le même verrou, et reçue sans `refus_compte_de_bilan` en trésorerie. L'écriture attendue ne
-- change pas : la banque au montant et dans le sens du mouvement, le compte choisi en face — pour un versement
-- d'espèces, la banque au débit et la caisse au crédit. Le mouvement classé sur la caisse, les déclencheurs de la
-- migration `caisse` jugent la caisse à la fin de la transaction ; « Remettre à traiter »
-- (`retirer_mouvement_compte_bilan`, inchangée) le défait, et la caisse se juge de même.
create or replace function public.ecrire_mouvement_compte_bilan(p_ligne_bancaire_id uuid, p_compte text, p_ecritures jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ligne public.lignes_bancaires%rowtype;
  v_mode text;
  v_dirigeant text;
  v_banque text;
  v_caisse text;
  v_refus text;
  v_sens_banque text;
  v_sens_compte text;
  v_conforme boolean;
  v_nb integer;
  v_debit numeric;
  v_credit numeric;
begin
  select * into v_ligne from public.lignes_bancaires where id = p_ligne_bancaire_id for update;
  if not found or not admin_du_dossier(v_ligne.dossier_id) then
    raise exception 'Accès refusé à ce mouvement.' using errcode = '42501';
  end if;
  if v_ligne.reglement_groupe then
    raise exception 'Ce mouvement règle plusieurs pièces : annule d''abord ce règlement groupé.' using errcode = '22023';
  end if;
  if v_ligne.piece_id is not null or v_ligne.cotisation_id is not null or v_ligne.categorie_id is not null
     or v_ligne.emprunt_id is not null or v_ligne.ventilee or v_ligne.prelevement_personnel then
    raise exception 'Ce mouvement est rapproché d''une pièce, d''une cotisation ou d''un emprunt, affecté à une catégorie, ventilé sur plusieurs comptes ou classé en virement personnel : annule d''abord ce classement.'
      using errcode = '22023';
  end if;
  if v_ligne.montant = 0 then
    raise exception 'Un mouvement de zéro euro n''a rien à écrire.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.ecritures_brouillon
    where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null and statut <> 'proposee'
  ) then
    raise exception 'L''écriture de ce mouvement est validée : elle ne se remplace plus.' using errcode = '23514';
  end if;

  -- Le plan du dossier (ligne 43) se lit sous son verrou PARTAGÉ — la clé de `cle_validation`, que l'appelant
  -- n'exécute pas — : un changement du plan (étape PC4) et cet appel ne se croisent pas.
  perform pg_advisory_xact_lock_shared(hashtextextended('jd.validation_exercice:' || v_ligne.dossier_id::text, 0));
  v_banque := public.compte_du_role(v_ligne.dossier_id, 'banque');
  -- La caisse du dossier, lue dans son plan comme la banque (ligne 26.6, étape C1b) : le seul compte 53 sur lequel un
  -- mouvement s'écrive.
  v_caisse := public.compte_du_role(v_ligne.dossier_id, 'caisse');
  -- Le compte du dirigeant se lit dans le dossier, comme pour un virement personnel : celui du rôle `exploitant`
  -- en trésorerie (108000 par défaut), le compte choisi pour lui en engagement.
  select mode_comptable, public.compte_du_dirigeant(id)
    into v_mode, v_dirigeant from public.dossiers where id = v_ligne.dossier_id;
  -- Le compte de la caisse du plan, en trésorerie, se reçoit : le versement d'espèces en banque, ou des espèces
  -- retirées pour la caisse. Tout autre compte — et celui de la caisse en engagement, où elle attend sa conception — se
  -- juge comme hier.
  if v_mode = 'tresorerie' and p_compte = v_caisse then
    v_refus := null;
  else
    v_refus := public.refus_compte_de_bilan(p_compte, v_mode, v_dirigeant);
  end if;
  if v_refus is not null then
    raise exception '%', v_refus using errcode = '22023';
  end if;

  -- L'écriture attendue : la banque au montant et dans le sens du mouvement, le compte choisi en face. Comparée en
  -- MULTIENSEMBLE, comme celle d'une affectation : autant de lignes, et chacune des attendues présente.
  v_sens_banque := case when v_ligne.montant > 0 then 'debit' else 'credit' end;
  v_sens_compte := case when v_ligne.montant > 0 then 'credit' else 'debit' end;
  if jsonb_typeof(p_ecritures) is distinct from 'array' then
    raise exception 'L''écriture proposée est incomplète.' using errcode = '22023';
  end if;
  with attendues as (
    select v_banque as compte, v_sens_banque as sens, abs(v_ligne.montant) as montant
    union all
    select p_compte, v_sens_compte, abs(v_ligne.montant)
  ), recues as (
    select e->>'compte' as compte, e->>'sens' as sens, (e->>'montant')::numeric as montant
    from jsonb_array_elements(p_ecritures) as e
  )
  select (select count(*) from recues) = (select count(*) from attendues)
     and not exists (select compte, sens, montant from attendues except all select compte, sens, montant from recues)
    into v_conforme;
  if not coalesce(v_conforme, false) then
    raise exception 'L''écriture proposée ne correspond pas à ce mouvement et à ce compte.' using errcode = '22023';
  end if;

  update public.lignes_bancaires
     set compte_bilan = p_compte, statut = 'rapprochee'
   where id = p_ligne_bancaire_id;

  delete from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;

  insert into public.ecritures_brouillon (dossier_id, piece_id, ligne_bancaire_id, date, compte, libelle, montant, sens, statut)
  select v_ligne.dossier_id, null, p_ligne_bancaire_id, v_ligne.date, e->>'compte', coalesce(e->>'libelle', ''),
         (e->>'montant')::numeric, e->>'sens', 'proposee'
  from jsonb_array_elements(p_ecritures) as e;
  get diagnostics v_nb = row_count;

  select coalesce(sum(montant) filter (where sens = 'debit'), 0),
         coalesce(sum(montant) filter (where sens = 'credit'), 0)
    into v_debit, v_credit
  from public.ecritures_brouillon where ligne_bancaire_id = p_ligne_bancaire_id and piece_id is null and facture_id is null and encaissement_id is null;
  if v_debit <> v_credit then
    raise exception 'Écriture déséquilibrée : % au débit, % au crédit.', v_debit, v_credit using errcode = '23514';
  end if;

  return v_nb;
end;
$$;

-- ══ 5. Les droits d'exécution ══════════
-- Les deux fonctions de la caisse, au compte connecté (elles contrôlent l'accès elles-mêmes, avant toute lecture), ni à
-- l'anonyme ni à PUBLIC ; les deux fonctions remplacées gardent les leurs.
revoke execute on function public.retirer_operation_caisse(uuid, uuid) from public, anon;
grant execute on function public.retirer_operation_caisse(uuid, uuid) to authenticated;
revoke execute on function public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) from public, anon;
grant execute on function public.remplacer_operation_caisse(uuid, uuid, text, date, numeric, uuid, numeric, uuid[], jsonb) to authenticated;
