-- Ligne 26.8 de la feuille de route : le refus d'un compte de TVA disait « ce chemin n'existe pas encore ». Il existe :
-- la déclaration enregistrée dans l'onglet TVA liquide la TVA de sa période, et son paiement ou le remboursement d'un
-- crédit se rapproche d'elle depuis la fiche du mouvement (rapprocher_declaration_tva). La raison le dit désormais, dans
-- le même ordre et avec les mêmes mots que refusCompteDeBilan (lib/compteDeBilan.ts), que compteDeBilan.test.ts
-- confronte à cette fonction en l'exécutant. Rien d'autre ne change : ni l'ordre, ni les conditions, ni la signature.

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
