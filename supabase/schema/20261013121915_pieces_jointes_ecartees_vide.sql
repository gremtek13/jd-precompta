-- « ARRIVÉE VIDE » : LA QUATRIÈME RAISON D'UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL (ligne 22.91 de la feuille
-- de route, préparée le 13/10/2026 ; décision du cabinet du 13/10/2026, S228-Q2 : la pièce jointe vide se dit au cabinet,
-- sous une quatrième raison — arrivée vide : demander au client de vérifier son fichier).
--
-- LE DÉFAUT. Depuis la ligne 22.8, receive-email consigne la pièce jointe refusée à son format ou à son poids, et celle
-- dont le dépôt a échoué ; mais une pièce jointe de 0 octet n'est que SAUTÉE : seul le journal de la fonction le dit, un
-- temps. Le client croit l'avoir envoyée ; le cabinet n'en sait rien, et « ce qu'il reste à envoyer » continue de la
-- réclamer.
--
-- CE QUE CETTE MIGRATION CHANGE. La raison `vide` s'ajoute à `format`, `taille` et `depot`. Son poids est CONNU : zéro,
-- et il n'est zéro que pour elle :
--   - la liste des raisons, `pieces_jointes_ecartees_raison`, est remplacée sous le même nom par une liste plus large ;
--   - la contrainte du poids, `pieces_jointes_ecartees_octets` (plus de zéro), est remplacée sous le même nom par sa règle
--     raison par raison : zéro pour une pièce jointe arrivée vide, plus de zéro pour toute autre. Zéro reste refusé au
--     format, à la taille et au dépôt échoué ; un poids positif (ou négatif) est refusé à une pièce jointe vide. Un null
--     la passe, comme toute contrainte CHECK ;
--   - la contrainte du poids connu, `pieces_jointes_ecartees_poids_connu` (un poids inconnu pour la raison `depot` seule),
--     ne change pas : elle refuse le null à une pièce jointe vide comme au format et à la taille.
-- Postgres ne modifie pas une contrainte CHECK en place : chacune est retirée puis posée de nouveau, dans la même
-- transaction, sous le même nom.
--
-- CE QU'ELLE NE CHANGE PAS. La garde `garder_piece_jointe_ecartee` compare toutes les colonnes reçues — la raison et le
-- poids compris — par `is distinct from` : rien de ce qui a été reçu ne change, sur une ligne `vide` comme sur une
-- autre, et la marque « vue » s'y pose une fois. `marquer_pieces_jointes_vues` ne lit ni la raison ni le poids. Les
-- policies, les droits et la clé d'idempotence (dossier, empreinte) ne bougent pas : un rejeu du webhook n'écrit pas plus
-- une ligne `vide` qu'une autre. Le client n'en voit toujours rien.
--
-- DESTRUCTIVE AU SENS DES RÈGLES DU DÉPÔT, SANS PERTE : deux `drop constraint`, chacune remplacée aussitôt sous le même
-- nom — la liste des raisons par une liste plus large, la règle du poids par une règle qui ne change rien pour les trois
-- raisons d'aujourd'hui. Aucune donnée n'est retirée ni réécrite ; toute ligne d'aujourd'hui satisfait les contraintes
-- d'après.
--
-- Données mesurées le 13/10/2026 : la table est vide. Le retour arrière est donné à part : il refuse tant qu'une ligne
-- `vide` existe, en dit le nombre, et ne la supprime jamais.

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_raison;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_raison check (raison in ('format', 'taille', 'depot', 'vide'));

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_octets;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_octets check (case when raison = 'vide' then octets = 0 else octets > 0 end);

comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7), dont le dépôt a échoué (ligne 22.8), ou arrivées vides (ligne 22.91) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client n''en voit rien.';
comment on column public.pieces_jointes_ecartees.raison is
  'format : un format qu''une pièce n''a pas ; taille : au-delà de la borne d''une pièce ; depot : le format et le poids allaient — ou la pièce jointe n''a pas pu être lue —, et la réception n''a pas pu la déposer ; vide : la pièce jointe est arrivée vide (0 octet), il n''y avait rien à déposer.';
comment on column public.pieces_jointes_ecartees.octets is
  'Le poids de la pièce jointe, en octets : zéro pour une pièce jointe arrivée vide, et pour elle seule ; plus de zéro pour toute autre ; inconnu (null) seulement pour un dépôt échoué avant toute lecture (Resend ne l''a pas rendue, son téléchargement a échoué).';
