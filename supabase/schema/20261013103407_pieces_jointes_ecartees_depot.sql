-- « LE DÉPÔT A ÉCHOUÉ » : LA TROISIÈME RAISON D'UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL (ligne 22.8 de la
-- feuille de route, préparée le 13/10/2026 ; décision du cabinet du 13/10/2026, S227-Q3 : les autres pertes silencieuses
-- d'une pièce jointe se disent aussi au cabinet, par une troisième raison, « le dépôt a échoué »).
--
-- LE DÉFAUT. La migration `pieces_jointes_ecartees` (ligne 22.7) ne garde que deux raisons, le format et la taille. Or
-- receive-email perd une pièce jointe par d'autres chemins, et répond 200 quand même — Resend ne rejoue donc pas — : la
-- pièce jointe que Resend ne rend pas, son téléchargement raté, la recherche de doublon qui tombe, le stockage ou
-- l'insertion qui refusent, une exception. Seul le journal de la fonction en gardait la trace, un temps. Le client croit
-- l'avoir envoyée ; le cabinet n'en sait rien.
--
-- CE QUE CETTE MIGRATION CHANGE. La raison `depot` s'ajoute à `format` et `taille`. Son poids n'est pas toujours connu :
-- quand Resend n'a pas rendu la pièce jointe, ou que son téléchargement a échoué, rien n'a été lu. `octets` devient donc
-- INCONNU (null) possible, pour la raison `depot` SEULE :
--   - la contrainte `pieces_jointes_ecartees_octets` (plus de zéro) reste telle quelle — un null la passe, comme toute
--     contrainte CHECK —, et refuse toujours un poids de zéro, quelle que soit la raison : une pièce jointe vide reste
--     sautée, pas écartée ;
--   - une contrainte nouvelle, `pieces_jointes_ecartees_poids_connu`, exige le poids de toute autre raison : le format et
--     la taille le gardent obligatoire et positif.
--
-- CE QU'ELLE NE CHANGE PAS. La garde `garder_piece_jointe_ecartee` compare les colonnes reçues par `is distinct from`,
-- qui tient deux null pour égaux et un null face à un poids pour différents : un poids inconnu ne se pose pas après
-- coup, et la marque « vue » se pose sur une ligne `depot` comme sur les autres. `marquer_pieces_jointes_vues` ne lit
-- ni la raison ni le poids. Les policies, les droits et la clé d'idempotence (dossier, empreinte) ne bougent pas : un
-- rejeu du webhook n'écrit pas plus une ligne `depot` qu'une autre. Le client n'en voit toujours rien.
--
-- DESTRUCTIVE AU SENS DES RÈGLES DU DÉPÔT, SANS PERTE : un `drop constraint` — la liste des raisons, remplacée par une
-- liste plus large, sous le même nom : Postgres ne modifie pas une contrainte CHECK en place — et un `drop not null` sur
-- le poids. Aucune donnée n'est retirée ni réécrite ; toute ligne d'aujourd'hui satisfait les contraintes d'après.
--
-- Données mesurées le 13/10/2026 : la table est vide. Le retour arrière est donné à part : il refuse tant qu'une ligne
-- `depot` existe, en dit le nombre, et ne la supprime jamais.

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_raison;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_raison check (raison in ('format', 'taille', 'depot'));

alter table public.pieces_jointes_ecartees alter column octets drop not null;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_poids_connu check (octets is not null or raison = 'depot');

comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7), ou dont le dépôt a échoué (ligne 22.8) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client n''en voit rien.';
comment on column public.pieces_jointes_ecartees.raison is
  'format : un format qu''une pièce n''a pas ; taille : au-delà de la borne d''une pièce ; depot : le format et le poids allaient — ou la pièce jointe n''a pas pu être lue —, et la réception n''a pas pu la déposer.';
comment on column public.pieces_jointes_ecartees.octets is
  'Le poids de la pièce jointe, en octets, plus de zéro ; inconnu (null) seulement pour un dépôt échoué avant toute lecture (Resend ne l''a pas rendue, son téléchargement a échoué).';
