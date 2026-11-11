-- RETOUR DE LA MIGRATION relance_des_demandes_par_email (étape B3b, ligne 51.5 ; supabase/preparees/
-- 20261111239000_relance_des_demandes_par_email.sql). À COLLER (le texte porte « drop ») : il retire la fonction
-- `journaliser_relance_de_demande` et rend à la contrainte du type d'`emails_envoyes` son texte d'hier. Il N'EFFACE RIEN :
-- il se refuse tant qu'une ligne « relance_demande » est au journal (une relance par e-mail la cite ; les retirer, c'est
-- effacer la trace d'un e-mail parti, que le cabinet seul déciderait, par une migration à part). Avant lui, `send-email`
-- se redéploie sa constante `RELANCES_DE_DEMANDES_EN_BASE` baissée : sinon chaque relance partirait et son inscription
-- serait refusée APRÈS l'envoi.

do $garde$
begin
  if to_regprocedure('public.journaliser_relance_de_demande(uuid,uuid,text,text,text,uuid)') is null then
    raise exception 'La migration relance_des_demandes_par_email n''est pas en base : rien à retirer.';
  end if;
  if exists (select 1 from public.emails_envoyes where type = 'relance_demande') then
    raise exception 'Le journal porte des relances de demandes par e-mail : le retour les effacerait ; il ne s''applique pas.';
  end if;
end
$garde$;

drop function public.journaliser_relance_de_demande(uuid, uuid, text, text, text, uuid);

alter table public.emails_envoyes
  drop constraint emails_envoyes_type_check,
  add constraint emails_envoyes_type_check check (type in ('facture', 'relance_pieces', 'devis', 'relance_facture'));
