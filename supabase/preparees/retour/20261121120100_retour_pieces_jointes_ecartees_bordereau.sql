-- RETOUR DE `pieces_jointes_ecartees_bordereau` (BOR6, seconde partie, supabase/preparees/20261121120000_pieces_jointes_ecartees_bordereau.sql)
-- — À COLLER par le cabinet dans l'éditeur SQL de Supabase, dans une transaction : il retire une contrainte avant de la reposer,
-- ce que l'outil d'application retient. Il rend la liste des quatre raisons d'avant. receive-email se redéploie AVANT lui, sa
-- constante `BORDEREAUX_ECARTES_A_LA_RECEPTION` baissée.
--
-- La garde : une ligne `bordereau` ne se supprime jamais ici ; tant qu'il en existe, rien n'est retiré, et leur nombre est dit.
do $garde$
declare
  n bigint;
begin
  select count(*) into n from public.pieces_jointes_ecartees where raison = 'bordereau';
  if n > 0 then
    raise exception 'Retour de BOR6 : % pièce(s) jointe(s) écartée(s) sous la raison « bordereau » : rien n''est retiré.', n;
  end if;
end
$garde$;

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_raison;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_raison check (raison in ('format', 'taille', 'depot', 'vide'));

comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7), dont le dépôt a échoué (ligne 22.8), ou arrivées vides (ligne 22.91) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client ne la lit pas : il en reçoit, par pieces_jointes_ecartees_du_client seule, le jour, la raison et le poids de celles des 90 derniers jours (ligne 22.9).';
comment on column public.pieces_jointes_ecartees.raison is
  'format : un format qu''une pièce n''a pas ; taille : au-delà de la borne d''une pièce ; depot : le format et le poids allaient — ou la pièce jointe n''a pas pu être lue —, et la réception n''a pas pu la déposer ; vide : la pièce jointe est arrivée vide (0 octet), il n''y avait rien à déposer.';
