-- RETOUR DE `ecarts_de_reglement` (ligne 31, 31-changeFrais ; préparé le 12/11/2026). Baisser `ECARTS_DE_REGLEMENT_PREVUS`
-- D'ABORD (src/lib/rolesDuChange.ts), puis déployer, puis ce retour : drapeau levé, la lecture du plan exige les deux
-- rôles, et chaque plan lu sans eux serait incomplet.
--
-- CE QU'IL DÉTRUIT : les deux lignes du catalogue, et rien d'autre. Il REFUSE si un dossier a réglé l'un des deux rôles
-- dans son plan (la ligne de `plan_comptable_dossier` les cite : la retirer serait perdre le choix du cabinet) ; les
-- écritures déjà passées au 656, au 756, au 666 ou au 766 restent ce qu'elles sont (un compte n'est pas un rôle). Le texte
-- porte un `delete` : il SE COLLE dans l'éditeur SQL, dans une transaction, avec le retrait de sa ligne d'historique.

do $$
begin
  if exists (select 1 from public.plan_comptable_dossier p where p.role in ('pertes_de_change', 'gains_de_change')) then
    raise exception 'Un dossier tient un rôle du change dans son plan : le retour le perdrait. Rien n''est retiré.';
  end if;
end
$$;

delete from public.roles_comptables where role in ('pertes_de_change', 'gains_de_change');
