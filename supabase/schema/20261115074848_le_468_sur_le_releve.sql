-- PC4Q2-Q1 — LE 468 SUR UN MOUVEMENT DU RELEVÉ, COMME LE 467 (ligne 43 ; décisions du cabinet : 43-Q12, « oui » le
-- 17/10/2026 — le 468 sur un mouvement du relevé se traite comme le 467, à part — ; PC4Q2-Q1, le 11/11/2026, à la
-- recommandation — « Tout de suite, à part », avant l'écran du plan). PRÉPARÉE le 13/11/2026, PAS APPLIQUÉE. Le récit :
-- HISTORIQUE.md, « 13/11/2026 — PC4Q2-Q1, A8B-Q3 ET A8Q5Q3-Q2 : TROIS MIGRATIONS PRÉPARÉES » ; l'essai :
-- supabase/essais/compteBilan.sql (le bloc « 468 », EN ATTENTE sans elle) ; le retour :
-- supabase/preparees/retour/20261113210100_retour_le_468_sur_le_releve.sql ; le module qui redit le refus avant le clic :
-- src/lib/compteDeBilan.ts (`refusCompteDeBilanSelon`, `LE_468_SUR_LE_RELEVE_PREVU`, baissé jusqu'à l'application),
-- confronté à ce texte par src/lib/compteDeBilan.test.ts.
--
-- SOURCES. Le plan comptable général (règlement ANC n° 2014-03, version consolidée au 1er janvier 2026, anc.gouv.fr) :
-- art. 1214-46 (« Les opérations dont le solde peut être indifféremment soit débiteur, soit créditeur sont comptabilisées à
-- des subdivisions ouvertes sous le compte 467 « Divers comptes débiteurs et produits à recevoir » ou le compte 468
-- « Divers comptes créditeurs et charges à payer » » ; la version de 2019 ne nommait que le 467, et rangeait sous le 468
-- les charges à payer et produits à recevoir « divers », 4686 et 4687, que le plan de 2026 n'a plus) ; la liste des
-- comptes (art. 1121-1) : le 48 « Comptes de régularisation » y tient le 481 « Frais d'émission des emprunts », le 486
-- « Charges constatées d'avance », le 487 « Produits constatés d'avance » et le 488 « Comptes de répartition périodique
-- des charges et des produits » ; art. 1214-48 (le 486 et le 487 se passent en fin d'exercice et se contre-passent à
-- l'ouverture ; le 488, l'abonnement, se solde à la fin de l'exercice ; le 481 « enregistre à son débit les frais
-- d'émission des emprunts », crédité à chaque clôture par le 6862) ; art. 212-11 (les frais d'émission d'emprunt
-- « peuvent être répartis » sur sa durée : une faculté, que l'application ne tient pas — elle n'écrit ni le 481 ni sa
-- dotation). PostgreSQL 17, « CREATE FUNCTION » (CREATE OR REPLACE garde la fonction, son propriétaire et ses droits ; ses
-- autres propriétés sont celles que l'instruction dit).
--
-- POURQUOI. `refus_compte_de_bilan` dit pourquoi un compte ne reçoit pas un mouvement du relevé ; la fonction d'écriture
-- (`ecrire_mouvement_compte_bilan`) l'appelle, et l'écran le redit avant le clic. Sa branche `^(468|48)` refusait le 468
-- comme « compte de régularisation (charges à payer, produits à recevoir…) » : le sens du plan de 2019. Dans celui de
-- 2026, le 468 est le pendant créditeur du 467 (art. 1214-46), que le relevé reçoit déjà ; le catalogue des rôles l'admet
-- pour le dirigeant non associé depuis `dirigeant_au_468` (PC4-Q2, en production le 11/11/2026). Et la phrase du 48
-- nommait les charges à payer et produits à recevoir, que le 48 ne tient pas.
--
-- CE QU'ELLE FAIT : elle remplace le corps de `refus_compte_de_bilan` (empreinte b578ff1d…, celui de la migration
-- `caisse_retrait_et_versement`, en production) par le même, une seule branche changée :
--   - le 468 sort de la branche du 48 : un 468 qui n'est pas le compte du dirigeant ne reçoit plus de refus, comme le 467
--     (aucune autre branche ne le prend) ; un 468 qui EST le compte du dirigeant se dit comme hier par la branche du
--     dirigeant, qui le précède (« Virement personnel ») ;
--   - la phrase du 48 suit le plan de 2026 : ce qu'il tient (frais d'émission des emprunts, charges ou produits constatés
--     d'avance, répartition périodique des charges et des produits), et où va le mouvement — les frais d'émission d'un
--     emprunt en charge, par une catégorie, que l'application n'étale pas ; le reste à l'inventaire.
-- Les dix-huit autres branches, leur ordre et leurs mots ne changent pas ; la fonction reste `language sql`, `stable`, au
-- chemin `public`, non `security definer` ; ses droits (authenticated) restent.
--
-- CE QU'ELLE NE CHANGE PAS : aucune donnée, aucune table, aucune policy, aucun déclencheur, aucune autre fonction. Aucun
-- mouvement n'est réécrit : un mouvement déjà sur un compte de bilan l'a été sous un refus plus large, et rien ne s'y
-- refuse de plus. Ni la ventilation, ni les règles, ni les lots n'appellent ce refus. Relevé sur la réplique du 13/11/2026
-- (218 migrations, égale à la production à la signature) : aucun mouvement sur un 468 (`lignes_bancaires.compte_bilan`).
--
-- COMMENT ELLE S'APPLIQUE : aucun mot de retrait ni de vidage, aucune barre oblique inverse — PAR L'OUTIL. Indépendante des
-- deux migrations préparées du même jour (`reprises_retiennent_la_tresorerie`, `recu_par_la_piece_citee`) : aucune
-- fonction, aucune table en commun ; elle s'applique avant, après ou entre elles. Aucune autre migration préparée ne
-- remplace `refus_compte_de_bilan`. Le jour de son application, `LE_468_SUR_LE_RELEVE_PREVU` se lève (src/lib/
-- compteDeBilan.ts) et le fichier entre dans supabase/schema/ sous la version que porte sa ligne d'historique, texte
-- inchangé.

-- ══ 0. La garde de tête ══════════
-- La fonction est celle de `caisse_retrait_et_versement` (en production), à l'empreinte de son corps ; la migration ne se
-- rejoue pas.
do $garde$
declare
  v_empreinte text;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.refus_compte_de_bilan(text, text, text)');
  if v_empreinte = 'ecaf1d7dbe31a508ff781b2e3ed728d6' then
    raise exception 'PC4Q2-Q1 : le 468 est déjà reçu sur le relevé (refus_compte_de_bilan à l''empreinte de cette migration) : elle ne se rejoue pas.';
  end if;
  if v_empreinte is distinct from 'b578ff1dd54cc8fad50323caea4d5ba1' then
    raise exception 'PC4Q2-Q1 : refus_compte_de_bilan n''est pas celle de caisse_retrait_et_versement (empreinte %) : relire la migration contre la base avant de l''appliquer.',
      coalesce(v_empreinte, 'absente');
  end if;
end
$garde$;

-- ══ 1. Le refus d'un compte de bilan : le 468 comme le 467, le 48 dans le plan de 2026 ══════════
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
    when p_compte ~ '^48'
      then 'Un compte de régularisation (frais d''émission des emprunts, charges ou produits constatés d''avance, répartition périodique des charges et des produits) ne reçoit pas un mouvement de banque : les frais d''émission d''un emprunt se rangent en charge, par une catégorie — l''application ne les étale pas sur sa durée —, et le reste se passe à l''inventaire.'
    when p_mode = 'tresorerie' and p_compte ~ '^4[234]'
      then 'En comptabilité de trésorerie, un salaire, une cotisation ou un impôt payés sont des charges : range le paiement dans une catégorie. L''impôt sur le revenu de l''exploitant est un virement personnel.'
    when p_mode = 'engagement' and p_compte ~ '^4[234]' and p_compte !~ '^444'
      then 'L''application ne passe pas l''écriture qui solderait ce compte (paie, impôts et taxes) : range le paiement dans une catégorie de charge.'
  end
$$;

-- ══ 2. La garde de fin : ce que la fonction rend désormais ══════════
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.refus_compte_de_bilan(text, text, text)')) is distinct from 'ecaf1d7dbe31a508ff781b2e3ed728d6' then
    raise exception 'PC4Q2-Q1 : le corps de refus_compte_de_bilan n''est pas celui de cette migration : rien n''est appliqué.';
  end if;
  if public.refus_compte_de_bilan('468000', 'tresorerie', '108000') is not null
     or public.refus_compte_de_bilan('468100', 'engagement', '455000') is not null
     or public.refus_compte_de_bilan('467000', 'engagement', '455000') is not null
     or public.refus_compte_de_bilan('468000', 'engagement', '468000') not like 'Les apports et les prélèvements du dirigeant%'
     or public.refus_compte_de_bilan('486000', 'tresorerie', '108000') not like 'Un compte de régularisation (frais d''émission des emprunts,%'
     or public.refus_compte_de_bilan('481000', 'engagement', '455000') not like 'Un compte de régularisation (frais d''émission des emprunts,%'
     or public.refus_compte_de_bilan('471000', 'tresorerie', '108000') not like 'Un compte transitoire ou d''attente%' then
    raise exception 'PC4Q2-Q1 : refus_compte_de_bilan ne rend pas ce que cette migration attend (le 468 reçu, le 48 sous sa phrase de 2026) : rien n''est appliqué.';
  end if;
end
$fin$;
