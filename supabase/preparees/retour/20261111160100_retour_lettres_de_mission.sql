-- RETOUR DE LM4 (la migration `lettres_de_mission`, supabase/schema/20261112140911_lettres_de_mission.sql) : rend la
-- base d'avant, celle de LM1. DESTRUCTIF : il retire les deux tables, leurs lignes avec elles ; il se refuse donc tant
-- qu'un modèle ou une lettre existe (une lettre proposée est un contrat, que le cabinet garde cinq ans — C. civ.,
-- art. 2224) : les exporter d'abord, et ne le jouer qu'avec l'accord du cabinet. À COLLER (il supprime).
-- La migration est en production depuis le 12/11/2026 (version 20261112140911) : supabase/schema/20261112140911_lettres_de_mission.sql.
do $garde$
begin
  if to_regclass('public.lettres_de_mission') is null then
    raise exception 'Les lettres de mission ne sont pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.lettres_de_mission) or exists (select 1 from public.modeles_lettre_de_mission) then
    raise exception 'Des lettres de mission ou des modèles existent : le retour les détruirait. Les exporter, puis décider avec le cabinet.';
  end if;
end
$garde$;

drop trigger cabinets_designation_des_lettres on public.cabinets;
drop function public.garder_designation_des_lettres();
drop function public.retirer_lettre_de_mission(uuid, uuid, date);
drop function public.enregistrer_reponse_a_la_lettre(uuid, uuid, text, uuid, date);
drop function public.proposer_lettre_de_mission(uuid, uuid, timestamptz);
drop function public.enregistrer_brouillon_de_lettre(uuid, uuid, jsonb, timestamptz);
drop function public.retirer_modele_de_lettre(uuid, uuid);
drop function public.enregistrer_modele_de_lettre(uuid, text, text, jsonb, jsonb, uuid);
drop function public.empreinte_de_la_lettre(public.lettres_de_mission);
drop table public.lettres_de_mission;
drop function public.garder_lettre_de_mission();
drop table public.modeles_lettre_de_mission;
drop function public.garder_modele_de_lettre();
drop function public.acceptation_en_ligne_ouverte();
drop function public.honoraires_valides(jsonb);
drop function public.repartition_valide(jsonb);
drop function public.modele_clauses_valides(jsonb);
drop function public.modele_missions_valides(jsonb);
drop function public.lettre_missions_valides(text[]);
drop function public.clauses_requises(text[]);
drop function public.clauses_de_lettre();
drop function public.missions_de_lettre();
