-- RETOUR de la migration `le_468_sur_le_releve` (PC4Q2-Q1, ligne 43 ;
-- supabase/schema/20261115074848_le_468_sur_le_releve.sql — en production depuis le 15/11/2026, version 20261115074848).
-- Rend à `refus_compte_de_bilan` le corps de la migration
-- `caisse_retrait_et_versement`, à l'octet près (empreinte b578ff1dd54cc8fad50323caea4d5ba1) : le 468 se refuse de nouveau
-- comme « compte de régularisation », sous la phrase du plan de 2019. Aucune donnée n'est touchée : un mouvement écrit au
-- 468 sous la migration reste écrit — la fonction ne juge que le geste suivant, et « Remettre à traiter » le défait comme
-- tout autre. Baisser `LE_468_SUR_LE_RELEVE_PREVU` D'ABORD (src/lib/compteDeBilan.ts), puis déployer, puis ce retour :
-- l'écran redit le refus de la base. Rien n'y est retiré — la fonction se remplace, ses droits restent — : par l'outil.

-- La garde de tête : la fonction est celle que la migration a posée.
do $garde$
declare
  v_empreinte text;
begin
  select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) into v_empreinte
    from pg_catalog.pg_proc p where p.oid = to_regprocedure('public.refus_compte_de_bilan(text, text, text)');
  if v_empreinte is distinct from 'ecaf1d7dbe31a508ff781b2e3ed728d6' then
    raise exception 'Retour de PC4Q2-Q1 : refus_compte_de_bilan n''est pas celle de le_468_sur_le_releve (empreinte %) : rien n''est rendu.',
      coalesce(v_empreinte, 'absente');
  end if;
end
$garde$;

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

-- La garde de fin : le corps d'hier, à son empreinte.
do $fin$
begin
  if (select md5(replace(p.prosrc, chr(13) || chr(10), chr(10))) from pg_catalog.pg_proc p
       where p.oid = to_regprocedure('public.refus_compte_de_bilan(text, text, text)')) is distinct from 'b578ff1dd54cc8fad50323caea4d5ba1' then
    raise exception 'Retour de PC4Q2-Q1 : le corps rendu n''est pas celui de caisse_retrait_et_versement : rien n''est rendu.';
  end if;
end
$fin$;
