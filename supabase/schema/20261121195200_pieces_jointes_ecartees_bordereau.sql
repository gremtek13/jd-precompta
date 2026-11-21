-- « BORDEREAU » : LA CINQUIÈME RAISON D'UNE PIÈCE JOINTE ÉCARTÉE À LA RÉCEPTION PAR E-MAIL (conception 59, BOR6, seconde
-- partie, préparée le 21/11/2026 ; BOR-Q9 (A), décision du cabinet : refuser le bordereau de télétransmission au dépôt dans le
-- navigateur, l'ÉCARTER à la réception par e-mail). PRÉPARÉE, PAS APPLIQUÉE : à COLLER par le cabinet dans l'éditeur SQL de
-- Supabase, dans une transaction, avec sa ligne d'historique — elle retire deux contraintes CHECK avant de les reposer, ce
-- que l'outil d'application retient (CLAUDE.md, « Quand `apply_migration` attend une confirmation »).
--
-- LE BESOIN. receive-email écarte, derrière sa constante `BORDEREAUX_ECARTES_A_LA_RECEPTION` (baissée), la pièce jointe PDF
-- qui a la forme d'un bordereau de télétransmission (son titre, ou l'en-tête de ses colonnes nominatives), AVANT tout dépôt au
-- stockage et toute lecture par Textract : ces fichiers portent des noms de patients, et l'application n'est pas hébergée chez
-- un hébergeur de données de santé (RGPD.md § 8.7). Écartée, la pièce jointe se dit au cabinet comme les autres (ligne 22.7) ;
-- aucune des quatre raisons d'aujourd'hui ne la dit : « format non pris en charge » ferait renvoyer le même fichier, « le dépôt
-- a échoué » aussi.
--
-- CE QUE CETTE MIGRATION CHANGE. La raison `bordereau` s'ajoute à `format`, `taille`, `depot` et `vide`. Son poids est CONNU et
-- positif (le fichier a été lu) :
--   - la liste des raisons, `pieces_jointes_ecartees_raison`, est remplacée sous le même nom par une liste plus large ;
--   - la contrainte du poids, `pieces_jointes_ecartees_octets`, est remplacée sous le même nom par la même règle (zéro pour
--     une pièce jointe vide, et pour elle seule ; plus de zéro pour toute autre, `bordereau` comprise) : son texte ne change
--     pas, elle est seulement reposée pour que la règle se lise à côté de la liste ;
--   - la contrainte du poids connu, `pieces_jointes_ecartees_poids_connu` (un poids inconnu pour `depot` seule), ne change pas :
--     elle refuse le null à un bordereau comme au format.
--
-- CE QU'ELLE NE CHANGE PAS. La garde `garder_piece_jointe_ecartee`, `marquer_pieces_jointes_vues`, les policies, les droits, la
-- clé d'idempotence (dossier, empreinte) : un rejeu du webhook n'écrit pas plus une ligne `bordereau` qu'une autre. Le client
-- lit ses pièces jointes écartées comme avant (`pieces_jointes_ecartees_au_client`) : la raison lui est dite par l'écran.
--
-- DESTRUCTIVE AU SENS DES RÈGLES DU DÉPÔT, SANS PERTE : deux `drop constraint`, chacune reposée aussitôt sous le même nom, plus
-- large ou identique. Aucune donnée n'est retirée ni réécrite ; toute ligne d'aujourd'hui satisfait les contraintes d'après.
--
-- L'ORDRE DE MISE EN PRODUCTION : cette migration d'abord ; puis la constante levée et receive-email déployée. Une fonction
-- levée sur une base sans la raison écarte quand même le bordereau (le refus est du côté fermé) ; seule sa trace manque, et le
-- journal le dit (« pièce jointe écartée NON consignée »). Le retour arrière est donné à part
-- (retour/20261121120100_retour_pieces_jointes_ecartees_bordereau.sql) : il refuse tant qu'une ligne `bordereau` existe.

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_raison;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_raison check (raison in ('format', 'taille', 'depot', 'vide', 'bordereau'));

alter table public.pieces_jointes_ecartees drop constraint pieces_jointes_ecartees_octets;
alter table public.pieces_jointes_ecartees
  add constraint pieces_jointes_ecartees_octets check (case when raison = 'vide' then octets = 0 else octets > 0 end);

comment on table public.pieces_jointes_ecartees is
  'Les pièces jointes que la réception par e-mail (receive-email) a écartées, par format ou par taille (ligne 22.7), dont le dépôt a échoué (ligne 22.8), arrivées vides (ligne 22.91), ou qui ont la forme d''un bordereau de télétransmission (BOR6) : le dossier, l''instant, la raison, le poids, l''empreinte des identifiants Resend qui rend l''écriture idempotente, et la marque « vue » du cabinet — jamais le nom du fichier, son extension, l''expéditeur ni l''objet. Le cabinet la lit ; le client ne la lit pas : il en reçoit, par pieces_jointes_ecartees_du_client seule, le jour, la raison et le poids de celles des 90 derniers jours (ligne 22.9).';
comment on column public.pieces_jointes_ecartees.raison is
  'format : un format qu''une pièce n''a pas ; taille : au-delà de la borne d''une pièce ; depot : le format et le poids allaient — ou la pièce jointe n''a pas pu être lue —, et la réception n''a pas pu la déposer ; vide : la pièce jointe est arrivée vide (0 octet), il n''y avait rien à déposer ; bordereau : un PDF qui a la forme d''un bordereau de télétransmission (des noms de patients), écarté avant tout dépôt.';
