# RGPD — registre des traitements, sous-traitants, conservation

État au 19 septembre 2026. Les chiffres viennent de la base, pas d'une estimation ; les régions et
les flux, du code des Edge Functions. Ce qui reste à décider est nommé comme tel, à la fin.

---

## 1. Qui est responsable de quoi

La distinction commande tout le reste, et elle est double parce que l'application est
multi-cabinets dès l'origine.

- **Chaque cabinet est responsable de traitement** pour les dossiers de ses clients. C'est lui qui
  décide pourquoi et comment les données sont traitées : quelles pièces collecter, quelles
  catégories, quand clôturer.
- **L'éditeur de la plateforme est sous-traitant** au sens de l'article 28 : il héberge et fait
  fonctionner l'outil, sans finalité propre sur les données des cabinets.

Aujourd'hui JD Consult est les deux à la fois — le seul cabinet en production est le sien. C'est
confortable et trompeur : **le jour où un second cabinet arrive, il faudra un contrat de
sous-traitance entre lui et l'éditeur**, et l'éditeur ne pourra plus regarder les données d'un
dossier sans mandat. Le super-admin, qui voit tout par construction (`is_super_admin()` figure dans
le OR de chaque fonction d'accès), devient à ce moment-là un pouvoir à encadrer par écrit, pas
seulement par le code.

Un troisième acteur existe et n'est utilisateur de rien : **le patient**. Son nom, sa date de
naissance et parfois son NIR figurent sur les bordereaux de télétransmission du praticien — et
**ces bordereaux n'ont pas à être transmis au cabinet** : ils relèvent du secret médical, et c'est
le relevé SNIR, sans identité de patient, qui justifie les recettes auprès de l'expert-comptable
(règle rappelée par le cabinet le 24/09/2026). Le patient n'entre donc dans l'application que si un
bordereau y est déposé par erreur. Il n'a alors aucun compte, aucun écran, aucun moyen de savoir que
ses données sont là. Voir §6 et §8.7.

Un quatrième acteur est entré avec le fichier des clients du client (espace client, étape A4a,
appliquée sur l'accord du cabinet) : **les clients et les prospects du client**. La configuration
écrite pour les devis (§8.9) s'y étend — le client est responsable des données de SES clients, le
cabinet, qui lui fournit l'outil et agit pour lui, son sous-traitant (art. 28), l'éditeur un
sous-traitant ultérieur ; la clause tient dans la lettre de mission (hypothèse MEG1-Q11, question
au cabinet). Voir §6 et §8.7.

---

## 2. Registre des traitements

| Traitement | Finalité | Base légale | Personnes concernées | Données |
|---|---|---|---|---|
| **Tenue de la pré-comptabilité** | Produire la comptabilité et les déclarations d'un client | Obligation légale du client (Code de commerce L123-12 et s., CGI) + exécution du contrat de mission | Client, ses fournisseurs, ses clients | Identité, SIRET, adresse, montants, mouvements bancaires ; soldes d'ouverture d'un dossier repris (`a_nouveaux` : comptes, libellés — qui peuvent nommer un fournisseur ou un client —, montants, nom et empreinte du fichier de balance) ; chiffres du volet social d'un praticien conventionné (`volet_social_pamc` : honoraires du relevé SNIR, dépassements, recettes en structures de soins, profession — les revenus du praticien lui-même, aucune donnée de patient) |
| **Plan comptable d'un dossier** *(base posée le 10/10/2026, vide : rien ne l'écrit avant l'étape PC4 de la ligne 43)* | Tenir les comptes d'un dossier sous les numéros que le cabinet choisit pour lui (la banque, les tiers, le dirigeant…), plutôt que sous ceux de l'application | Obligation légale du client (Code de commerce L123-12 ; PCG, art. 1121-1 et 1131-1) + exécution du contrat de mission | Client ; un associé ou un tiers, seulement si un libellé le nomme | `plan_comptable_dossier` : pour chaque rôle que le dossier règle, le numéro du compte, son libellé — un texte du cabinet, qui peut nommer un associé (le compte courant d'un associé désigné par son nom) —, le préfixe des comptes auxiliaires d'un rôle de tiers, l'origine de la ligne, l'identifiant de qui l'a réglée et quand ; `roles_comptables` ne porte que des numéros et des intitulés du plan comptable général, rien d'un dossier. Lu par le cabinet du dossier seul — le client n'en voit rien —, écrit par personne tant qu'aucune policy ne l'ouvre (étape PC4), retiré avec le dossier |
| **Collecte des justificatifs** | Rassembler les pièces (dépôt, e-mail, Super PDP) | Exécution du contrat de mission | Client, tiers figurant sur les pièces — des **patients** seulement si un bordereau est déposé par erreur (§8.7) | Fichiers, empreintes SHA-256, horodatages |
| **Collecte par e-mail : les pièces jointes écartées** *(en base depuis le 13/10/2026, ligne 22.7 — migration `pieces_jointes_ecartees` ; la troisième raison, ligne 22.8 — migration `pieces_jointes_ecartees_depot`, appliquée le 13/10/2026 ; la quatrième, ligne 22.91 — migration `pieces_jointes_ecartees_vide`, appliquée le 13/10/2026 ; la lecture du client, ligne 22.9 — migration `pieces_jointes_ecartees_au_client`, appliquée le 13/10/2026)* | Dire au cabinet qu'une pièce jointe reçue à l'adresse de collecte d'un dossier n'a pas été déposée — son format n'est pas celui d'une pièce (PDF, JPEG, PNG, CSV), ou elle pèse plus de 20 Mo —, pour qu'il demande au client de la renvoyer autrement (décision du cabinet du 13/10/2026, S226-Q3) ; ou que son dépôt a échoué — Resend ne l'a pas rendue, son téléchargement, la recherche de doublon, le stockage ou l'insertion ont échoué —, pour qu'il la lui fasse renvoyer telle quelle (décision du cabinet du 13/10/2026, S227-Q3) ; ou qu'elle est arrivée vide (0 octet), pour qu'il demande au client de vérifier son fichier avant de la renvoyer (décision du cabinet du 13/10/2026, S228-Q2) ; et le dire au client lui-même dans « Mes pièces », pour qu'il la renvoie (ligne 22.9, migration `pieces_jointes_ecartees_au_client` ; décision du cabinet du 13/10/2026, S227-Q6, et son accord sur la lecture, S228B-Q1) | Exécution du contrat de mission | Client — une personne physique quand il exerce en nom propre ; membres du cabinet (auteur de la marque « vue ») | `pieces_jointes_ecartees` : le dossier, l'instant de la réception, la raison (format, taille, dépôt échoué, ou arrivée vide), le poids en octets (inconnu d'un dépôt échoué avant toute lecture, zéro d'une pièce jointe arrivée vide et d'elle seule), l'empreinte SHA-256 des deux identifiants que Resend donne à l'e-mail et à la pièce jointe (elle rend l'écriture idempotente et ne se relit pas chez Resend sans eux), la marque « vue » du cabinet (instant, identifiant du compte). JAMAIS le nom du fichier, son extension, l'expéditeur, l'objet ni le contenu ; aucune donnée de patient. Écrite par `receive-email` (clé secrète), lue par le cabinet du dossier — et tout accès client du dossier en LIT, par la fonction `pieces_jointes_ecartees_du_client` seule (migration `pieces_jointes_ecartees_au_client`), le jour de la réception à Paris, la raison et le poids de celles des 90 derniers jours, jamais l'empreinte, la marque « vue » ni son auteur, la table lui restant fermée —, marquée vue par `marquer_pieces_jointes_vues` seule ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier. Dans la sauvegarde d'un dossier. Durée de conservation : celle du dossier (décision du cabinet du 13/10/2026, S227-Q4 : la ligne ne porte ni nom ni contenu) |
| **Connexion bancaire** *(preuve de concept, bac à sable seulement)* | Récupérer les mouvements d'un compte directement à la banque, sans relevé déposé, sur le clic d'un membre du cabinet | Exécution du contrat de mission ; l'accès au compte repose sur l'accord que le titulaire donne lui-même, à sa banque et au prestataire (DSP2) | Client titulaire du compte ; tiers nommés dans les libellés | `connexions_bancaires` : banque, échéance de l'accord, identifiant de session chez le prestataire, comptes ouverts (nom du compte, devise, quatre derniers chiffres de l'IBAN, empreinte) — jamais le nom du titulaire ni l'IBAN entier ; les mouvements importés (date, libellé, montant, identifiant externe) vont dans `lignes_bancaires`, comme ceux d'un relevé |
| **Propositions de justificatif et précisions sur un mouvement** *(en base depuis le 10/10/2026, espace client P7, migration `banque_du_client`)* | Que le client dise quelle pièce justifie un mouvement de son relevé, et réponde aux questions du cabinet sur un mouvement — sans rien écrire dans le relevé : le rapprochement reste au cabinet | Exécution du contrat de mission | Client et membres du cabinet (auteurs) ; tiers, et chez un praticien un patient, seulement si un texte les nomme | `justificatifs_proposes` : le mouvement, la pièce, l'identifiant de l'auteur, son origine (client ou cabinet), l'instant, et pour une proposition retirée l'instant et l'auteur du retrait — elle se retire, elle ne s'efface pas ; `precisions_mouvements` : un texte libre de 2 000 caractères au plus, son auteur, son origine, l'instant — il ne se modifie pas, seul le cabinet en supprime un. Lus par le cabinet du dossier et par un accès qui porte la case « Banque », sur son dossier seulement ; écrits par trois fonctions seules ; partis avec le mouvement, la pièce ou le dossier (cascade). Conservation : celle du dossier. Depuis l'étape P9a (11/10/2026), l'accès qui porte « Banque » les voit et les écrit à l'ÉCRAN, dans « Ma banque » : ses propositions et celles de son cabinet (le nom du fichier de la pièce et le jour), le fil de chaque mouvement avec son auteur dit « Toi », « Ton cabinet » ou « Un autre accès de ta société » — jamais un nom ni une adresse. Aucune donnée nouvelle n'est collectée ni stockée |
| **Notes internes du cabinet** *(dans leur propre table depuis le 09/10/2026)* | Garder ce que le cabinet remarque sur une pièce ou un document — pour lui seul — jusqu'à sa validation et au-delà | Exécution du contrat de mission ; intérêt légitime du cabinet | Client, tiers nommés sur la pièce | `notes_internes` : le texte libre du cabinet (il peut nommer une personne), sa cible, la date de sa création et celle de sa dernière modification, posée par la base. Le cabinet du dossier SEUL la lit et l'écrit — aucune branche pour un accès client. Jusqu'au 09/10/2026 ces notes vivaient dans `pieces.notes` et `documents_divers.notes`, des colonnes que le client du dossier lit : elles y restent, recopiées et figées (plus aucun code ne les lit ni ne les écrit), jusqu'à leur suppression, qui attend l'accord du cabinet (EC-Q7) ; d'ici là, le client peut encore les lire, et y écrire à l'insertion d'une pièce ou d'un document — ce que plus personne ne lit |
| **Extraction automatique (OCR)** | Lire tiers, date et montants pour éviter la ressaisie | Intérêt légitime du cabinet (réduction de la saisie) | Idem collecte | Texte intégral du document (`piece_textes_ocr`) |
| **Assistant comptable** | Répondre à des questions sur un dossier, en lecture seule | Intérêt légitime du cabinet | Client | Question, réponse, comptage de tokens |
| **Proposition de catégorie** | Proposer la catégorie d'une pièce d'après son texte, sur le clic d'un membre du cabinet ; rien n'est écrit sans lui | Intérêt légitime du cabinet (réduction de la saisie) | Idem collecte | Texte OCR de la pièce, liste des catégories ; journal : tokens et issue, jamais l'extrait |
| **Facturation et relances** | Émettre et transmettre les factures d'honoraires | Exécution du contrat + obligation légale (facturation) | Client | Identité, adresse, e-mail, montants ; depuis l'espace client, étape P3 (10/10/2026), le client qui porte le droit « Ventes » envoie lui-même une facture par e-mail à son propre client, par le domaine d'envoi du cabinet (`precompta.jdarnis.fr`, Resend) : le journal `emails_envoyes` garde le destinataire, l'objet, la facture, l'identifiant Resend et le compte qui l'a envoyée, et la réponse va à l'adresse de ce compte ; trente e-mails par dossier et par jour de Paris pour un client, comptés avant l'envoi ; la relance de pièces reste au cabinet |
| **Facturation électronique** | Émettre et recevoir des factures au format réglementaire | Obligation légale (réforme de la facturation électronique) | Client et ses tiers | Facture complète, identité émetteur/destinataire ; pour chaque envoi d'une facture émise, sa transmission (`transmissions_factures` : canal, hôte, identifiant du flux, empreinte du fichier, état, et le détail que la plateforme rend — un motif de rejet peut citer la facture) ; pour chaque paiement reçu d'une facture émise, son encaissement (`encaissements_factures`, `encaissements_factures_taux` : date, montant, moyen de paiement, mouvement bancaire qui le prouve, répartition par taux de TVA, auteur et horodatages de l'enregistrement et du retrait ; pour l'annulation d'un encaissement déclaré, son motif — un texte du cabinet, qui peut nommer le client) ; pour chaque statut du cycle de vie qu'une facture émise reçoit sur la plateforme du client et que l'application relève sur un clic (`statuts_factures_recus`, depuis le 09/10/2026 : code du statut, identifiant et horodatage du message, rôle de son auteur, date du statut, motifs et commentaire de l'acheteur ou d'une plateforme — un texte libre, qui peut nommer une personne —, montants par taux de TVA, hôte et identifiant du flux, auteur et instant de la lecture ; un statut qui ne se rattache à aucune facture du dossier n'est pas gardé) ; depuis l'espace client, étape P2 (appliquée le 10/10/2026, avec l'accord du cabinet), l'identifiant du compte qui a VALIDÉ chaque facture — le cabinet, ou le client qui porte le droit « Ventes » (`factures_emises.valide_par`, figé avec la facture ; nul avant la migration) — et de celui qui a réservé chaque transmission (`transmissions_factures.cree_par`) ; depuis l'étape P3 (10/10/2026), le client qui porte « Ventes » transmet ses factures par sa plateforme ou par Super PDP, les suit et relève leurs statuts depuis l'application : `transmissions_factures.cree_par` et `statuts_factures_recus.lu_par` nomment son compte comme celui du cabinet ; sous l'hypothèse EC-Q4 (pas encore tranchée), il relie aussi lui-même sa plateforme et Super PDP — il saisit l'identifiant et le secret, que la fonction écrit sans jamais les rendre, et qui ne partent vers une adresse changée qu'une fois ressaisis ; la création d'une connexion garde son auteur (`connexions_plateformes.created_by`), pas sa modification ni son retrait, et Super PDP n'en garde aucun; depuis l'étape P4a (11/10/2026), le client qui porte « Ventes » VOIT à l'écran les factures et avoirs de sa société, leurs lignes — donc les identités et adresses de SES clients —, leurs transmissions, statuts, encaissements et déclarations, et l'état (nom, hôte, date du dernier relevé) de sa plateforme agréée ; il y écrit des notes de facture, des motifs d'avoir et de contre-passation et des notes de déclaration que le cabinet lit aussi, et le libellé de chaque champ le lui dit ; sans « Banque », aucun mouvement du relevé ne lui est montré, ni lu par l'écran. Depuis l'étape P4b (11/10/2026), l'écran lui offre ce que P3 avait ouvert dans les fonctions sous l'hypothèse EC-Q4 : dans « Mes ventes › Tes plateformes », il relie, teste et retire lui-même sa plateforme agréée et Super PDP — il y saisit l'identifiant et le secret de l'application que SON entreprise a créée, que la fenêtre n'affiche jamais, ni après l'enregistrement ni à la modification — et relit les statuts depuis le début ; la fenêtre lui dit, avant de relier, que son cabinet se sert de la même connexion pour recevoir ses factures (la réception reste au cabinet) ; l'accueil compte ses factures « À encaisser » et « À déclarer » (des nombres, aucun montant ni aucun nom). Depuis l'étape P4c (11/10/2026), le cabinet VOIT à l'écran QUI, du client, a validé ou transmis : sur chaque facture et avoir validé (`factures_emises.valide_par`), sur chaque brouillon (`created_by`), transmission (`transmissions_factures.cree_par`), encaissement et contre-passation (`encaissements_factures.cree_par`) et déclaration (`transmissions_encaissements.cree_par`), la mention « par le client » quand l'auteur est un compte qui porte un accès du dossier (reconnu parmi les accès du dossier, `memberships.user_id`, que l'onglet Factures du cabinet lit une fois), et un filtre « Émises par le client » ; l'écran ne nomme personne (ni nom ni adresse e-mail du compte), n'attribue pas au cabinet un compte qu'il ne reconnaît pas (un accès retiré depuis), et le client n'a pas cet écran. Aucune donnée nouvelle n'est collectée ni stockée : ce sont les tables et les fonctions de P2 et P3 |
| **Réception par la plateforme du client** *(depuis le 07/10/2026)* | Faire entrer dans le dossier, sur le clic d'un membre du cabinet, les factures que le client reçoit et émet par SA plateforme agréée — chacune en pièce « à valider » | Exécution du contrat de mission ; l'accès repose sur l'identité que le client ouvre lui-même au cabinet sur sa plateforme | Client, ses fournisseurs et ses clients | `connexions_plateformes` : nom donné à la plateforme, adresses de son service, identifiant et secret OAuth2, organisation, points de reprise de la recherche et du relevé des statuts (`cycle_vie_depuis`, `cycle_vie_lu_le`) ; pour chaque facture importée, l'original transmis (XML ou PDF) et la version lisible que la plateforme en rend, l'hôte et l'identifiant du flux (`pieces.flux_hote`, `flux_id`, `lisible_path`), les remarques de l'import dans la note interne de la pièce (`notes_internes`, que le client ne lit pas — sur la pièce elle-même jusqu'au 09/10/2026), et, pour une VENTE seulement, l'identité que son original dit — numéro, SIREN du vendeur (le client lui-même), date d'émission, nature (`pieces.identite_numero`, `identite_siren_vendeur`, `identite_date`, `identite_nature`, depuis le 09/10/2026 : ce qui relie la vente à la facture émise dans l'application) |
| **Révision des comptes (dossier de travail du cabinet)** *(base posée le 09/10/2026, à l'écran depuis le 10/10/2026)* | Justifier chaque solde de bilan d'un exercice terminé et en garder la trace — ce qu'un expert-comptable doit pouvoir montrer de ses travaux (NP 2300, A8 ; NPMQ, A28-2) | Intérêt légitime du cabinet ; obligations professionnelles de l'expert-comptable | Membres du cabinet (auteur de chaque décision) ; le client et ses tiers, seulement si un texte du cabinet les nomme | `revision_justifications` : compte, exercice, solde, état (justifié, accepté sur motif, anomalie), motif — un texte du cabinet, qui ne doit porter AUCUNE donnée de patient —, portée, instantané de ce que l'écran a montré, identifiant de l'auteur, horodatage ; `revision_preuves` : la pièce ou le document cité, son empreinte SHA-256 au moment de la citation, une précision. Lu par le cabinet seul — le client n'en voit rien —, écrit par la fonction `justifier_solde` seule ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier entier. Durée de conservation : question Q7 au cabinet (proposé : dix ans après la fin de l'exercice, comme les pièces), jusqu'à sa réponse celle du dossier |
| **Révision des comptes : les cycles (programme, conclusion, journal, revue)** *(base posée et à l'écran le 10/10/2026)* | Documenter le travail de révision cycle par cycle — le programme exécuté, la conclusion, les échanges avec la direction et les consultations, la revue du chef du cabinet — ce que le dossier de travail doit montrer (NP 2300, A8 et A9 ; NPMQ, § 29 et § 30) | Intérêt légitime du cabinet ; obligations professionnelles de l'expert-comptable | Membres du cabinet (auteur de chaque conclusion et de chaque note, celui qui revoit) ; le client et ses tiers, seulement si un texte du cabinet les nomme | `revision_conclusions` : exercice, cycle, état (révisé, anomalie), programme de travail exécuté (libellés, fait ou non, notes), conclusion, points à suivre, identifiant de l'auteur, horodatage ; `revision_notes` : nature (échange avec la direction, consultation, travail), texte, auteur, horodatage ; `revision_revues` : avis (approuvé, à reprendre), observation, identifiant de qui revoit, horodatage — des textes du cabinet, qui ne doivent porter AUCUNE donnée de patient. Lu par le cabinet seul — le client n'en voit rien —, écrit par `conclure_cycle`, `noter_revision` et `revoir_cycle` seules ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier entier. Durée de conservation : question Q7 au cabinet, comme la ligne précédente |
| **Révision des comptes : la revue analytique (seuil de signification, explications des variations)** *(en base et à l'écran le 11/10/2026)* | Comparer chaque exercice au précédent — poste de la 2035, total, compte —, fixer le seuil au-delà duquel une variation demande une explication, et garder l'explication obtenue (NP 2300, § 13 à 15 et A7) | Intérêt légitime du cabinet ; obligations professionnelles de l'expert-comptable | Membres du cabinet (auteur de chaque seuil et de chaque explication) ; le client et ses tiers, seulement si un texte du cabinet les nomme | `revision_seuils` : exercice, montant du seuil, motif — un texte du cabinet —, identifiant de l'auteur, horodatage ; `revision_explications` : exercice, la ligne commentée (un poste ou un total de la 2035, ou un numéro de compte), les deux montants qu'elle compare et la source de l'exercice précédent (exercice validé, repère annuel, aucune), l'explication — un texte du cabinet, qui ne doit porter AUCUNE donnée de patient —, identifiant de l'auteur, horodatage. Lu par le cabinet seul — le client n'en voit rien —, écrit par `fixer_seuil_de_signification` et `expliquer_variation` seules ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier entier. Durée de conservation : question Q7 au cabinet, comme les deux lignes précédentes |
| **Révision des comptes : le dossier permanent (lettre de mission, description de l'entité, organisation comptable, statuts, baux et contrats)** *(en base et à l'écran le 12/10/2026)* | Garder ce que le cabinet sait durablement d'un dossier et de sa mission, valable pour plusieurs exercices — la lettre de mission, qui définit la mission (décret n° 2012-432, art. 151), la description de l'entité et de son activité, la présentation de son organisation comptable, ses documents juridiques et contrats importants —, ce que le dossier de travail « comprend » et « peut contenir » (NP 2300, § 16 et A9) | Intérêt légitime du cabinet ; obligations professionnelles de l'expert-comptable | Client — une personne physique quand il exerce en nom propre, qu'un texte du cabinet peut décrire ; ses cocontractants (un bailleur, un prêteur), seulement si un texte du cabinet ou la pièce citée les nomme ; membres du cabinet (auteur de chaque entrée et de son retrait) | `dossier_permanent` : la nature de l'entrée (huit, fermées), un titre (500 caractères) et un texte (8 000) — des textes du cabinet, qui ne doivent porter AUCUNE donnée de patient —, la pièce ou le document du dossier qu'elle cite et l'empreinte SHA-256 de ce fichier au moment de la citation (jamais son nom), la période de validité, la version qu'elle remplace, l'identifiant de l'auteur et celui de l'auteur du retrait, les horodatages. Lu par le cabinet seul — le client n'en voit rien —, écrit par `consigner_au_dossier_permanent` et `retirer_du_dossier_permanent` seules ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier entier ; une pièce ou un document cité ne se supprime plus (hypothèse Q8). Dans la sauvegarde d'un dossier. Durée de conservation : question Q7 au cabinet, comme les lignes précédentes de la révision |
| **E-reporting des achats à l'étranger : la fiche « hors de France » d'une pièce** *(base posée et à l'écran le 10/10/2026)* | Décrire, facture par facture, ce que le client achète à un fournisseur établi hors de France, pour le transmettre à l'administration à partir des opérations du 01/09/2027 (e-reporting) ; le cabinet la saisit, rien ne s'en déduit | Obligation légale du client (CGI, art. 290, I-3°) | Client ; ses fournisseurs établis hors de France — une personne physique seulement quand le fournisseur en est une ; membres du cabinet (auteur de chaque version) | `pieces_hors_de_france` : numéro, date et type de la facture, la facture qu'un avoir corrige, devise, pays du fournisseur et son identifiant — son numéro de TVA dans l'Union ; hors de l'Union, son code pays suivi des seize premiers caractères de sa dénomination, qui peut être le nom d'une personne —, nature de l'achat, autoliquidation, date de livraison ou période, identifiant de l'auteur et horodatages de chaque version et de son retrait ; `pieces_hors_de_france_taux` : code et taux de TVA, base, TVA, motif d'exonération (code VATEX et libellé). Ni l'adresse du fournisseur, ni sa dénomination entière : la facture reste dans le fichier de la pièce ; aucune donnée de patient. Lue par le cabinet seul — le client n'en voit rien —, écrite par `enregistrer_fiche_hors_de_france` et `retirer_fiche_hors_de_france` seules ; rien ne s'y modifie ni ne s'y supprime, sauf avec la pièce ou le dossier. Durée de conservation : celle de la pièce qu'elle décrit, avec laquelle elle part |
| **E-reporting : le régime confirmé d'un dossier, son histoire, et les pièces écartées** *(en base et à l'écran le 11/10/2026)* | Garder le régime de TVA que le client a déclaré à sa plateforme agréée et ses changements datés — sous lequel chaque période d'e-reporting se déclare à partir des opérations du 01/09/2027 —, et les pièces d'achat que le cabinet a vérifiées et écartées de l'e-reporting des achats, avec ce que la vérification a établi | Obligation légale du client (CGI, art. 290 et 290 A ; « communiquer à leur plateforme agréée leur régime de TVA et tout changement de régime », impots.gouv.fr, 22/09/2026) | Client — une personne physique quand il exerce en nom propre ; membres du cabinet (auteur de chaque confirmation, de chaque écart et de leur retrait) | `regimes_ereporting` : le jour à partir duquel le régime vaut, le statut de TVA (redevable, franchise en base, exonéré), l'article d'exonération, la périodicité de la déclaration de TVA et l'option pour les débits, les fréquences d'e-reporting, une note libre du cabinet (2 000 caractères), l'identifiant de l'auteur, les horodatages de la confirmation et du retrait ; `pieces_ecartees_ereporting` : la pièce visée, le motif libre de l'écart (2 000 caractères), l'identifiant de l'auteur, les horodatages de l'écart et de sa reprise. La note et le motif sont des textes du cabinet sur la situation fiscale du client : le libellé de leur champ dira qu'ils ne doivent porter aucune donnée de patient. Lus par le cabinet seul — le client n'en voit rien —, écrits par `confirmer_regime_ereporting`, `retirer_regime_ereporting`, `ecarter_piece_ereporting` et `reprendre_piece_ereporting` seules ; rien ne s'y modifie ni ne s'y supprime, sauf avec la pièce (l'écart) ou le dossier. Dans la sauvegarde d'un dossier. Durée de conservation : celle du dossier — l'histoire du régime justifie chaque déclaration passée, jusqu'à la prescription du droit de reprise |
| **E-reporting : les déclarations faites hors de l'application, et leurs sources** *(en base et à l'écran le 11/10/2026)* | Garder ce que le cabinet a déclaré pour le client à l'administration, période par période, sur la plateforme agréée du client — le contenu calculé par l'application, figé, son empreinte, l'initiale et ses rectificatives —, pour pouvoir le justifier, le rectifier et retenir les pièces qui le fondent, à partir des opérations du 01/09/2027 | Obligation légale du client (CGI, art. 290 et 290 A ; ann. II, art. 242 nonies O) | Client — une personne physique quand il exerce en nom propre ; ses fournisseurs établis hors de France (le contenu d'un achat porte leur numéro de TVA ou leur dénomination tronquée, comme la fiche d'e2) ; ses clients particuliers n'y paraissent PAS (les ventes et les paiements se déclarent agrégés par jour et par taux) ; membres du cabinet (auteur de chaque déclaration) | `declarations_ereporting` : l'objet, la période, le régime sous lequel elle a été jugée, initiale ou rectificative, la plateforme nommée par le cabinet, le CONTENU (un objet JSON d'un mégaoctet au plus : pour les achats, ce que la fiche « hors de France » dit de chaque facture — numéro, dates, pays, identifiant du fournisseur, montants par taux ; pour les ventes et les paiements, des montants par jour et par taux et les identifiants des factures et des encaissements), son empreinte, le nombre d'opérations, l'état, une note libre du cabinet (2 000 caractères), l'identifiant de l'auteur, l'horodatage ; `declarations_ereporting_sources` : l'identifiant de chaque fiche, facture ou encaissement que le contenu déclare. La note est un texte du cabinet : le libellé de son champ dira qu'elle ne doit porter aucune donnée de patient. Lues par le cabinet seul — le client n'en voit rien —, écrites par `declarer_ereporting_hors_application` seule ; rien ne s'y modifie ni ne s'y supprime, sauf avec le dossier ; une pièce dont la fiche est déclarée ne se supprime plus (hypothèse E5-Q6). Dans la sauvegarde d'un dossier. Durée de conservation : celle du dossier — ce qui a été déclaré se justifie jusqu'à la prescription du droit de reprise |
| **Gestion des accès** | Ouvrir et fermer les comptes cabinet et client ; depuis le 09/10/2026, rendre l'accès à qui a oublié son mot de passe (lien « Mot de passe oublié »), et poser les droits de chaque accès client (espace client, étape P1) | Exécution du contrat | Membres du cabinet, clients | E-mail, identifiant, rôle ; pour un mot de passe oublié : l'adresse saisie à l'écran de connexion, et l'e-mail que le service d'authentification envoie au compte — un lien à usage unique, valable une heure, que rien n'envoie quand aucun compte n'existe ; tant que le nouveau mot de passe n'est pas choisi, le navigateur garde l'identifiant du compte (`localStorage`, `jd-precompta-recuperation`) ; pour chaque accès client, deux droits, « Ventes » et « Banque » (`memberships.droit_ventes`, `droit_banque`), faux par défaut, cochés par le cabinet — ni leur auteur ni leur date ne sont gardés ; le client lit les siens, jamais ceux d'une autre personne. « Banque » ouvre à l'écran « Ma simulation » (P7) et « Ma banque » (P9a, 11/10/2026 : les mouvements du relevé — date, libellé, montant et leur état pour le client —, le solde du dernier relevé contrôlé, les noms et jours de dépôt de ses pièces ; jamais la catégorie, le compte ni l'écriture), et l'écran relit la case à la base avant de rien montrer ; « Ventes » ouvre « Mes ventes › Factures » (P4a, 11/10/2026) sur la société affichée, la liaison de sa plateforme agréée et de Super PDP, et les tuiles « À encaisser » et « À déclarer » de l'accueil (P4b, 11/10/2026), et l'écran relit les deux cases à la base avant de rien montrer ; la base honore les deux depuis P2 et P7 (§7) |
| **Journalisation** | Savoir qui a reçu quoi et quand (envois d'e-mails, événements Super PDP) | Intérêt légitime (preuve et diagnostic) | Client | Destinataire, objet, horodatage, statut |
| **Devis** *(préparés le 10/10/2026, espace client P5 — deux migrations présentées au cabinet, NON APPLIQUÉES ; aucun écran encore)* | Établir, émettre et suivre les devis que le client adresse à SES clients — par le cabinet, ou par le client qui porte le droit « Ventes » —, enregistrer leur réponse, et tirer la facture d'un devis accepté | Pour le client : l'exécution de mesures précontractuelles prises à la demande de son propre client (RGPD, art. 6, 1, b) ; pour le cabinet : l'exécution du contrat de mission — la qualification de chacun est une question au cabinet (§8.9) | Client ; les clients du client — le destinataire de chaque devis, une personne physique quand c'est un particulier ; membres du cabinet et client (auteurs) | `devis` : le destinataire (nom, adresse, SIRET, e-mail) et ses mentions (SIREN, adresse de facturation électronique, code service et numéro d'engagement d'un organisme public, nature des opérations, date ou période d'exécution PRÉVUE, adresse de livraison), l'objet, les lignes (désignation, quantité, prix, taux), les montants, les conditions, les mentions légales, des notes PARTAGÉES — le client qui porte « Ventes » les lit comme le cabinet —, l'émetteur figé à l'émission, le numéro, les dates (du devis, de validité, de la réponse), la réponse, et qui a créé, émis, répondu (identifiants des comptes, horodatages) ; `devis_factures` : le lien d'un devis accepté à la facture qui en est tirée, et qui l'a tirée ; `devis_numerotation` : le dernier numéro de la série, par année. Lus par le cabinet du dossier et par l'accès qui porte « Ventes » ; écrits par quatre fonctions seules. Aucune donnée de patient : l'information écrite préalable d'un professionnel de santé n'est pas un devis de l'application (§8.7, §8.9). Durée de conservation : question au cabinet (§8.9) |
| **Catalogue d'articles** *(en base, espace client A1 — migration `articles`, présentée au cabinet et appliquée sur son accord ; à l'écran depuis A2a : la vue « Articles » de l'onglet Factures et de « Mes ventes », la liste et ses gestes ; depuis A2b, le choix d'un article dans le formulaire d'une facture)* | Pré-remplir les lignes des factures du client à partir d'un catalogue qu'il tient avec le cabinet | Exécution du contrat de mission | Client ; membres du cabinet et client (auteurs) | `articles` range, par dossier, une désignation et sa description, une référence, une unité, un prix hors taxes, un taux de TVA et une nature — aucune donnée personnelle attendue, hors l'identifiant du compte qui a créé, changé ou retiré chaque article — ; le cabinet du dossier et l'accès client qui porte « Ventes » la lisent, trois fonctions seules l'écrivent ; un article ne se supprime pas : il part avec le dossier, et la sauvegarde d'un dossier l'emporte |
| **Adresse de réception des factures électroniques** *(en base, espace client A6a — migration `adresses_reception`, présentée au cabinet et appliquée sur son accord ; à l'écran depuis A6b1, le 14/10/2026 : la fenêtre « Adresse de réception » de Justificatifs, au cabinet, et le bloc « Ton adresse de réception » de « Tes plateformes », chez le client qui porte « Ventes »)* | Garder, version par version, l'adresse à laquelle le client reçoit ses factures électroniques, telle que le cabinet ou le client qui porte « Ventes » la déclare après l'avoir vérifiée sur l'annuaire ou sur sa plateforme, pour dire si sa facture électronique est en place | Exécution du contrat de mission ; obligation légale du client (réforme de la facturation électronique) | Client — une personne physique quand il exerce en nom propre ; membres du cabinet et client (auteurs) | `adresses_reception` range, par dossier, un identifiant d'adressage de l'annuaire qui commence par le SIREN du dossier (une donnée personnelle quand l'entreprise est individuelle), sa maille, le nom de la plateforme, la date de prise d'effet, la source et le jour de la vérification, l'identifiant du compte qui l'a déclarée et l'instant ; le cabinet du dossier et l'accès client qui porte « Ventes » la lisent, la fonction `declarer_adresse_reception` seule l'écrit, une version ne se modifie ni ne se supprime — elle part avec le dossier —, et la sauvegarde d'un dossier l'emporte ; l'écran lit la table en entier et le SIRET du dossier, n'écrit que par cette fonction, sur un clic, et n'appelle jamais l'annuaire — son portail public ne s'ouvre que sur un clic, dans une autre page, hors de l'application ; l'auteur d'une version n'y est montré qu'au cabinet, et seulement comme « par le client » |
| **Fichier des clients du client (contacts)** *(en base, espace client A4a — migration `contacts`, présentée au cabinet et appliquée sur son accord ; à l'écran depuis A4b1 : la vue « Clients » de l'onglet Factures et de « Mes ventes » — la liste, la recherche, nouveau client, modifier, retirer, reprendre, et effacer après une confirmation qui nomme ce qui part ; le choix d'un client dans la facture, « Enregistrer ce client » et l'échéance proposée par son délai depuis A4b2, l'import d'un fichier depuis A4b3b et l'export d'une fiche depuis A4b3c ; la proposition d'effacement après trois ans sans activité viendra après l'étape A7, qui relie une facture à son contact)* | Tenir les clients et les prospects du client, pour remplir ses factures — et ses devis, quand ils existeront — sans ressaisie | Pour le client : l'exécution du contrat avec son client (RGPD, art. 6, 1, b), l'intérêt légitime pour un prospect (art. 6, 1, f) ; pour le cabinet : l'exécution du contrat de mission, comme sous-traitant du client (§1, hypothèse MEG1-Q11) | Les clients et les prospects du client — une personne physique quand c'est un particulier ou un entrepreneur individuel —, JAMAIS des patients : un dossier qui dispense des soins exonérés n'y range aucun particulier, et la fonction le refuse nommément (§8.7) ; membres du cabinet et client (auteurs) | `contacts` range, par dossier, le nom, le type (entreprise assujettie, organisme public, non-assujetti, client établi hors de France), l'adresse, le SIREN et le SIRET, l'adresse de facturation électronique et le code service d'un organisme public, l'e-mail, le délai de paiement, des observations PARTAGÉES — le client qui porte « Ventes » les lit comme le cabinet —, et qui a créé, changé, retiré ou effacé chaque contact (identifiants des comptes, horodatages) ; aucun téléphone, aucune date de naissance. Le cabinet du dossier et l'accès client qui porte « Ventes » la lisent, quatre fonctions seules l'écrivent ; un contact ne se supprime pas : il se retire, se reprend, ou s'EFFACE — ses données vidées, la ligne gardée sous « Contact effacé le … » —, part avec le dossier, et la sauvegarde d'un dossier l'emporte. Une facture ne pointe pas son contact : elle garde la COPIE de son client, et ses dix ans — « Choisir un client », dans le formulaire d'une facture, ne fait que remplir cette copie (le nom, l'adresse, le SIRET, le type, le SIREN, l'adresse de facturation électronique, le code service ; jamais l'e-mail, que la facture n'a pas), sans rien écrire dans le contact ni garder de lien en base. Durée : la relation, puis trois ans sans facture ni devis (le référentiel de la CNIL cité au §8.9), au terme desquels l'écran PROPOSERA l'effacement, jamais seul (après l'étape A7, qui relie une facture à son contact). Un contact rangé avant que le dossier passe aux soins est signalé à l'écran dès A4b1 et l'effacement lui est proposé, jamais fait d'office (A4-Q4) ; un contact effacé ne s'affiche jamais, ni dans la liste ni dans la recherche. L'EXPORT d'une fiche (étape A4b3c : « Exporter la fiche », sur chaque client affiché de la vue « Clients », au cabinet comme au client qui porte « Ventes ») télécharge la fiche complète d'un contact — toutes ses données saisies, observations comprises — dans un fichier CSV composé dans le navigateur ; il ne part nulle part, rien ne s'écrit ni ne se garde de plus (§6). L'IMPORT d'un fichier de clients (étape A4b3a : la migration `importer_contacts`, présentée au cabinet et appliquée sur son accord ; à l'écran depuis A4b3b : « Importer des clients », dans la vue « Clients » du cabinet et de « Mes ventes ») range d'un coup les lignes d'une liste tirée de l'ancien logiciel du client — mille au plus —, chacune par la fonction qui range un contact saisi, sous les mêmes refus (la règle des soins comprise), toutes ou aucune, pour le cabinet comme pour le client qui porte « Ventes » ; chaque contact importé est signé de l'importateur, et ceux d'un même import portent le même instant de création. Rien d'autre n'est gardé : ni le fichier — lu dans le navigateur (étape A4b3b), il ne part nulle part, ni au stockage, ni dans un journal, ni vers une Edge Function ; seules les lignes de l'aperçu, une fois ses colonnes choisies une à une (ou « Ne pas importer », nommée), atteignent la base, au clic —, ni une colonne qu'un contact n'a pas — une colonne inconnue fait refuser l'import, plutôt que d'être perdue en silence ou rangée ailleurs (minimisation, art. 5, 1, c) — ; un import ne modifie jamais un contact déjà rangé |
| **Paramètres de facturation** *(en base, espace client A5a — migration `parametres_facturation`, présentée au cabinet et appliquée sur son accord le 16/10/2026 ; à l'écran depuis l'étape A5b1 — la vue « Paramètres » de l'onglet Factures et de « Mes ventes » : la version courante, l'état de son RIB, l'historique, une version nouvelle, la confirmation d'un RIB par le cabinet — ; l'identité légale à l'écran depuis l'étape A5b2 — quatre champs de la carte « Identité du dossier » de l'onglet Informations du cabinet, écrits avec le SIRET et l'adresse — ; l'avis d'un changement de RIB à l'écran depuis l'étape A5b3b ; aucune facture ne les lit ni ne les imprime avant l'étape A7)* | Proposer, puis imprimer sur les factures du client, ses conditions de paiement, son RIB et son identité légale, sans ressaisie | Pour le client : l'obligation légale de mentionner sur ses factures les conditions de règlement (C. com., art. L441-9, I) et son identité (art. R123-237, 2° ; art. R526-27 pour l'entrepreneur individuel), l'exécution de ses contrats pour le RIB ; pour le cabinet : l'exécution du contrat de mission | Le client — une personne physique quand il est entrepreneur individuel : son IBAN, le titulaire du compte (son nom) et sa dénomination (« <nom> EI ») sont alors des données personnelles — ; membres du cabinet et client (auteurs, confirmateurs) | `parametres_facturation` range, par dossier et par VERSION, le délai de paiement, le moyen de paiement proposé, quatre textes (les conditions d'escompte, les pénalités de retard, des mentions complémentaires, un pied de page — le client qui porte « Ventes » les lit comme le cabinet), le RIB imprimé (IBAN, BIC, titulaire du compte), son état (proposé ou confirmé), qui a enregistré chaque version et quand, qui a confirmé le RIB et quand (identifiants des comptes, horodatages) ; et, depuis l'étape A5c1 (migration `logo_des_factures`, appliquée sur l'accord du cabinet), le logo de ses factures — son chemin dans le seau privé `ventes` et son empreinte SHA-256, le fichier dans le stockage et, depuis l'étape A5c2b, dans la sauvegarde du dossier — voir §7, « Le logo des factures d'un dossier ». Une version ne se modifie pas et ne se supprime pas : une nouvelle la remplace, et l'HISTOIRE du RIB reste — qui l'a posé, qui l'a confirmé, quand —, celle qu'on relirait après une fraude au faux RIB ; elle part avec le dossier, et la sauvegarde d'un dossier l'emporte. Le cabinet du dossier et l'accès client qui porte « Ventes » la lisent, toutes colonnes ; un accès qui ne porte que « Banque » ne la lit pas ; deux fonctions seules l'écrivent : un RIB posé ou changé par le client n'est que PROPOSÉ, seul le cabinet le confirme, et un RIB posé par le cabinet est confirmé d'emblée, la version disant par qui (MEG1-Q12, décision du cabinet du 16/10/2026) ; l'écran (A5b1) montre l'IBAN par groupes de quatre, qui l'a posé et confirmé et quand, et, au cabinet, « par le client » sur des accès lus en entier, sans jamais nommer un compte ; la confirmation d'un RIB le nomme en entier et conseille de le vérifier auprès du client par un autre moyen que l'application ; un changement de RIB se dit depuis l'étape A5b3b en tête de la Vue d'ensemble du cabinet et sur l'accueil des accès « Ventes » et « Banque » (§7 ; à un accès « Banque », seulement le jour, l'auteur — le cabinet ou un accès client — et l'état du dernier changement, jamais l'IBAN : A5-Q2, décision du cabinet du 16/10/2026). Sur `dossiers`, quatre colonnes — la dénomination imprimée, la ville du greffe, la forme juridique (une catégorie de l'INSEE) et le capital d'une société — que le cabinet écrit seul (MEG1-Q14, décision du cabinet du 16/10/2026) et que le client lit comme tout son dossier — pas seulement le client qui porte « Ventes » : tout accès du dossier, comme son SIRET et son adresse. Depuis l'étape A5b2 le cabinet les écrit dans la carte « Identité du dossier » de l'onglet Informations, avec le SIRET et l'adresse, en une seule écriture : les libellés de l'adresse, de la dénomination et de la ville du greffe disent que « le client du dossier » les lit ; la dénomination d'un entrepreneur individuel (son nom suivi de « EI », proposée par un bouton, jamais d'elle-même) est une donnée personnelle, et son capital — qu'il n'a pas — est remis à nul à l'enregistrement, et dit avant. Durée : celle du dossier, versions remplacées comprises ; une facture gardera sa copie dix ans (étape A7) |

**Aucune décision automatisée au sens de l'article 22.** C'est une propriété du produit, pas un
hasard : l'application signale et propose, elle ne tranche jamais — une pièce importée arrive
toujours « à valider », et la catégorie reste un arbitrage humain.

---

## 3. Sous-traitants et transferts

| Sous-traitant | Rôle | Région vérifiée | Transfert hors UE |
|---|---|---|---|
| **Supabase** | Base, stockage des fichiers, authentification | `eu-west-1` (Irlande) | Non |
| **AWS Textract** | OCR des pièces déposées | `eu-central-1` (Francfort), repli du code **gardé par un test**, secret **mesuré** le 21/09/2026 (§8.1) | Non |
| **AWS Bedrock** | Assistant comptable (Claude), citation des champs d'une pièce lue, et proposition de sa catégorie (`proposer-categorie`, sur clic, depuis le 26/09/2026) | `eu-west-1` (Irlande) pour l'assistant, écrit dans son code ; `eu-central-1` (Francfort) pour la citation et la catégorie, même secret que Textract — **gardés par un test** | Non |
| **Super PDP** | Plateforme de dématérialisation agréée DGFiP | France | Non |
| **La plateforme agréée du client** *(choisie par le client, depuis le 07/10/2026)* | Celle par laquelle le client reçoit et émet ses factures ; le cabinet y lit ses factures par l'API de flux que publient les plateformes (dite « API AFNOR »), et y déposera celles que le dossier émet (écrit le 08/10/2026, mis en ligne avec les écrans) ; depuis l'espace client, étape P3 (10/10/2026), le client qui porte « Ventes » y dépose aussi les factures du dossier et en relève les statuts | Celle de la plateforme : immatriculée par l'administration fiscale, elle n'est **ni choisie ni mesurée** par le cabinet | À vérifier plateforme par plateforme |
| **Enable Banking** *(bac à sable seulement, depuis le 30/09/2026)* | Connexion bancaire (DSP2) : l'accord du titulaire, la lecture de ses comptes et de leurs mouvements | EEE — Google Cloud EMEA (Irlande) et AWS EMEA (Luxembourg), **déclarés** par sa notice aux utilisateurs de l'API, lue le 30/09/2026, pas mesurés | Non, selon cette notice |
| **Resend** | Envoi et réception d'e-mails ; depuis le 09/10/2026, aussi ceux du service d'authentification de Supabase (SMTP réglé au tableau de bord : le lien « Mot de passe oublié » y transite, et se lit dans le journal des envois de Resend — sans effet une fois servi ou expiré) ; depuis l'espace client, étape P3 (10/10/2026), aussi les factures que le client « Ventes » adresse à ses clients | `eu-west-1` (Irlande), confirmé par le cabinet le 22/09/2026 | Non, **sous réserve du DPA — voir §8.2** |
| **GitHub Pages** | Hébergement du front (fichiers statiques) | — | Aucune donnée de dossier n'y transite |
| **API SIRENE** | Code NAF depuis un SIRET | France (service public) | Non |

Deux précisions qui comptent :

- **GitHub Pages ne reçoit aucune donnée de dossier.** L'application est une SPA qui parle
  directement à Supabase depuis le navigateur ; GitHub ne sert que des fichiers statiques. Il voit
  en revanche les adresses IP des visiteurs, comme tout hébergeur.
- **Enable Banking n'est pas un sous-traitant ordinaire.** Enable Banking Oy (Espoo, Finlande) est un
  prestataire de services d'information sur les comptes enregistré auprès de l'autorité finlandaise
  (FIN-FSA), et le titulaire du compte accepte SES conditions avant de s'authentifier à sa banque : pour
  l'accès au compte, il agit sous le consentement du titulaire, pas seulement pour le compte du
  cabinet. Sa notice déclare garder les données de compte 60 secondes au plus (le temps de les
  convertir), les identifiants d'accès 15 minutes, la session le temps de l'accord (180 jours au
  plus), et ne stocker ni numéro de compte ni nom de titulaire. C'est l'application qui garde les
  mouvements. Et la règle du projet tient : à l'ouverture de l'onglet Banque, l'état de la connexion se
  lit dans la base, sans appel au prestataire ; tout le reste — la liste des banques, la demande
  d'accord, la récupération, le retrait — part d'un clic. Voir §8.8 pour ce qui reste avant la
  production.
- **La plateforme agréée du client n'est pas un sous-traitant du cabinet.** C'est le client qui la
  choisit et la contracte — depuis le 1er septembre 2026, toute entreprise reçoit ses factures par la
  sienne —, et le cabinet n'y entre que par l'identité que le client lui ouvre. Son secret vit dans
  `connexions_plateformes`, une table sans aucune policy que seule l'Edge Function `plateforme-agreee`
  atteint, à la clé de service : il ne revient jamais au navigateur, pas même masqué. La fonction ne
  l'envoie qu'en https, et ses journaux ne portent que des statuts et des comptes — jamais le secret ni
  le contenu d'une facture.
  La règle du projet tient ici aussi : ouvrir la fenêtre « Plateforme du client » ne lit que la base ;
  tester la connexion, chercher les factures et les importer partent chacun d'un clic. Ce qui arrive
  se conserve comme toute pièce (§5), et retirer la connexion ne retire rien de ce qui a été importé.
  **Ce qui reste à vérifier, plateforme par plateforme** : la région où elle héberge les factures. Une
  plateforme est immatriculée par l'administration fiscale française, ce qui n'est pas une garantie
  d'hébergement dans l'UE.
- **L'API SIRENE ne reçoit qu'un SIRET**, et seulement sur clic explicite. Aucun appel réseau
  externe n'est silencieux dans cette application — c'est une règle du projet, pas une constatation.
- **Les polices ne partent plus chez Google** (25/09/2026). Jusque-là, `index.html` et la charte
  d'un cabinet les demandaient à Google Fonts à chaque ouverture : l'adresse IP de chaque
  utilisateur, clients compris, partait chez un destinataire absent de ce tableau, et la phrase
  ci-dessus était fausse sur ce point. Elles sont désormais servies par l'application elle-même
  (paquets @fontsource, licence OFL), et `src/lib/polices.test.ts` refuse toute adresse de Google
  Fonts dans ce que le navigateur reçoit.

---

## 4. Ce que la base contient réellement

> **Précision décisive, ajoutée le 19/09/2026 : la base ne contient aujourd'hui que des données
> FICTIVES.** Aucun patient réel, aucun praticien réel. Un seul dossier est vivant (`test`), les
> trois autres sont d'anciens bacs à sable.
>
> Ce que les chiffres ci-dessous décrivent est donc la **forme** de ce que l'application stocke —
> quel type de contenu entre en base, par quel chemin, et où il se loge — pas une exposition
> constatée. La conclusion du §4 (« les données de patients sont dans les FICHIERS, pas dans les
> tables ») reste valable comme propriété de l'ARCHITECTURE, et c'est bien ainsi qu'elle gouverne
> les §5 à §8.
>
> **Ce registre devra être remesuré au premier dossier réel**, et c'est à ce moment-là seulement
> qu'il décrira un traitement de données personnelles au sens du RGPD. D'ici là il documente une
> conception, ce qui est le bon moment pour le faire : la protection des données par conception
> (art. 25) se décide avant les données, pas après.

Mesuré le 19/09/2026, en comptant sans jamais extraire :

- **2 comptes** utilisateurs, **4 dossiers**, **1 cabinet**.
- **148 fichiers** dans le stockage, **23 Mo** — répartis en trois seaux : `pieces` (privé),
  `packs` (privé), `cabinet-logos` (public, logos seulement). Depuis l'étape A5c1 (migration `logo_des_factures`), un
  quatrième, `ventes` (privé : le logo des factures d'un dossier, §7) — vide le jour de son application.
- **41 textes OCR** conservés, sur 108 fichiers déposés : les 67 documents antérieurs au 18/09/2026
  n'en ont pas.
- Dans ces 41 textes : **0 numéro de sécurité sociale apparent**, **0 date de naissance**,
  **1 bordereau de télétransmission**, 4 textes employant un vocabulaire de patient.
- **0 commentaire** de pièce, **0 e-mail journalisé**, **2 messages** d'assistant.

**Ce que ces chiffres disent, et c'est la conclusion utile : les données de patients sont dans les
FICHIERS, pas dans la base.** Un bordereau déposé — par erreur, il n'a pas à l'être (§8.7) — porte
des noms et des numéros ; sa ligne en base
ne porte qu'un chemin, un montant et une date. Le seul endroit où le contenu d'un document entre en
base est `piece_textes_ocr`, et il n'y en a aujourd'hui qu'un seul de cette famille.

Conséquence pratique : l'effort de protection porte d'abord sur le **stockage** (policies
`storage.objects`, URLs signées, exports), pas sur les tables.

---

## 5. Durées de conservation

### Ce que la loi impose de garder

| Donnée | Durée | Fondement |
|---|---|---|
| Pièces justificatives et livres comptables | **10 ans** à compter de la clôture | Code de commerce, art. L123-22 |
| Factures émises | **10 ans** | Idem |
| Pièces à l'appui d'une déclaration fiscale | **6 ans** | LPF, art. L102 B |

C'est le plus long qui commande : **10 ans**. Rien dans l'application ne peut être purgé avant,
et un contrôle qui proposerait de le faire serait une faute.

### Ce qui n'a AUCUNE durée légale propre, et c'est le levier

**Le texte OCR (`piece_textes_ocr`) est une copie dérivée.** Il sert à classer le document, à
retrouver une date et à aider l'arbitrage — aucune obligation comptable ne porte sur lui : c'est le
fichier d'origine qui fait foi devant un contrôle. Le supprimer ne retire rien à la comptabilité.

Or c'est précisément le seul endroit où le contenu d'un bordereau — donc des données de patients —
entre en base sous forme exploitable et interrogeable.

**D'où la mesure de minimisation qui se présente d'elle-même : purger le texte OCR des pièces
validées depuis un certain temps.** Une fois la pièce arbitrée, catégorisée et rapprochée, le texte
a fait son travail. Le combien de temps est une décision du cabinet (§8.3), pas une constante que
l'application devrait choisir seule.

### État aujourd'hui

- Pièce la plus ancienne : **31/12/2022**. Premier dépôt dans l'application : **26/08/2026**.
- **0 pièce** et **0 document** ont dépassé l'obligation de 10 ans. La première purge légalement
  possible n'aura pas lieu avant 2033.
- Il n'existe **aucun mécanisme de purge** dans l'application. Ce n'est pas urgent au sens des
  durées, et ça l'est au sens de la minimisation (le texte OCR, ci-dessus).

---

## 6. Droits des personnes

Pour le **client du cabinet**, les droits s'exercent auprès de son cabinet, et l'application les
sert déjà en pratique : il voit ses pièces et ses informations dans son espace, la sauvegarde d'un
dossier constitue une portabilité complète (JSON lisible tel quel, le logo de ses factures compris
depuis l'étape A5c2b), l'export de pack rassemble ses fichiers, et la suppression d'un dossier efface
en cascade tout ce qui s'y rattache, fichiers compris.

Pour le **patient**, non. Et il faut le dire plutôt que de le contourner :

- il ne sait pas que son nom figure dans l'outil comptable de son praticien ;
- il ne peut pas s'adresser au cabinet, qui ne le connaît pas comme personne mais comme une ligne
  d'un bordereau ;
- aucune recherche de l'application ne permet aujourd'hui de retrouver « toutes les pièces où
  figure Monsieur X » — l'application n'indexe pas les patients, et c'est heureux.

**La position qui correspond à la pratique, rappelée par le cabinet le 24/09/2026 : ces données
n'ont pas à entrer du tout.** Le praticien reste seul responsable des données de ses patients, et il
n'a pas le droit de transmettre ses bordereaux à son expert-comptable — c'est le relevé SNIR, qui
totalise les honoraires sans identifier personne, qui justifie les recettes. Le cabinet ne traite
donc aucune donnée de patient au titre de sa mission : un bordereau reçu est une erreur d'envoi, pas
un flux du traitement.

*Cette section disait auparavant que le cabinet traitait ces données « pour le compte » du
praticien.* C'est cette rédaction qui plaçait l'application dans le champ de l'hébergement de
données de santé (§8.7) : elle décrivait l'erreur d'envoi comme si c'était la règle. La
minimisation (§5) reste la réponse pour ce qui arrive malgré la consigne.

Pour les **clients du client** (le fichier des contacts, étape A4a), les droits s'exercent auprès
du client, responsable de leurs données (§1). L'application lui donne, par la base, l'effacement
d'un contact — ses données vidées, la ligne gardée — sans toucher aux factures, qui
gardent leur copie et leurs dix ans (C. com., art. L123-22). L'écran « Clients » (étape A4b1) l'offre
au cabinet comme au client « Ventes » : « Effacer », jamais d'office, après une confirmation qui nomme le
contact et ce qui part, dit que les factures gardent leur copie et que le geste ne se défait pas. Il lui offre
aussi l'export d'une fiche (étape A4b3c) : « Exporter la fiche », sur chaque client affiché — en cours ou retiré,
jamais un effacé —, télécharge la fiche COMPLÈTE de ce contact (nom, type, adresse, SIREN et SIRET, adresse de
facturation électronique, code service, e-mail, délai de paiement, observations) dans un fichier CSV, pour répondre à
la personne qui lui demande ce qu'il garde sur elle (accès, art. 15 ; portabilité, art. 20 : un format courant, que
l'import d'un fichier de clients relit tel quel). Le fichier se compose dans le navigateur depuis la ligne déjà lue :
il ne part nulle part, ni au stockage, ni dans un journal, ni vers une Edge Function, et rien ne s'écrit. Il ne porte
ni l'état du contact (en cours, retiré), ni ses dates, ni l'identité de qui l'a rangé, ni les factures qui nomment la
personne : elles gardent leur copie et leurs dix ans, et rien ne les relie à un contact avant l'étape A7 — répondre
pour elles reste, d'ici là, un geste du client sur ses factures.

---

## 7. Mesures de sécurité

Ce qui est **prouvé**, pas seulement affirmé :

- **RLS sur l'intégralité du schéma**, avec une convention unique (`admin_du_dossier`) et trois
  tables volontairement fermées à tout accès client (`super_admins`, `superpdp_credentials`,
  `facture_numerotation`).
- **Isolation des fichiers entre cabinets**, corrigée après audit : les policies du stockage
  vérifient le dossier propriétaire et non plus « est admin d'un cabinet quelconque »
  (migration `storage_pieces_packs_isolation_cabinet`) — et **rejouée** depuis le 19/09/2026 par la
  section S de `supabase/essais/rls.sql`, qui est la seule partie de ce registre à porter sur les
  fichiers eux-mêmes plutôt que sur les lignes qui les décrivent. Mesuré : un anonyme et un
  authentifié rattaché à rien voient 0 des 146 fichiers privés ; le client en voit 61, exactement
  les siens, et aucun des 85 autres ; il ne peut pas déposer dans le dossier d'un tiers.
  Un contrôle POSITIF accompagne les autres — le client doit voir ses propres fichiers — sans quoi
  un bucket devenu illisible à tous passerait pour un succès.
- **Inférence IA en Europe** : Bedrock `eu-west-1`, choix explicite et commenté dans le code.
- **Secrets hors du bundle client** : clés Resend et Bedrock en secrets de fonctions,
  identifiants Super PDP dans une table sans aucune policy, atteinte uniquement par la clé de
  service. Même règle pour la connexion bancaire : la clé privée de l'application Enable Banking est
  un secret de fonction, et `connexions_bancaires` n'a AUCUNE policy — l'identifiant de session, qui
  ouvre les mouvements du compte avec cette clé, ne quitte jamais le serveur. Éprouvé par
  impersonation des trois profils (`supabase/essais/connexionBancaire.sql`, 22 contrôles), et la
  fonction ne rend jamais ni session, ni identifiant de compte, ni jeton de retour : un test le vérifie
  sur chacune de ses réponses (`src/lib/banqueConnexion.test.ts`).
- **Les notes internes du cabinet hors de portée du client** (09/10/2026, art. 5 § 1 f et 32 § 1 b) : un texte du cabinet
  seul ne se range plus dans une table que le client lit. `notes_internes` n'a qu'une policy, `to authenticated` sur
  `admin_du_dossier`, sans branche client ; éprouvée par impersonation de six profils (anonyme, compte rattaché à
  rien, client du dossier, chef, membre affecté au dossier, membre d'un autre dossier) dans
  `supabase/essais/notesInternes.sql` — 29 verdicts dont cinq mutations qui mordent, la recopie vérifiée note par note
  par égalité, sans qu'aucun texte soit lu —, et `rls.sql` rejoué entier le même jour. Côté code, un scanner
  (`src/lib/notesInternesEcritures.test.ts`) refuse toute écriture ou lecture des anciennes colonnes, et une restauration
  range les notes d'une sauvegarde d'hier dans la nouvelle table. **Limite nommée** : tant que les anciennes colonnes
  ne sont pas supprimées (EC-Q7), le client lit encore leur copie figée au 09/10/2026.
- **Les droits d'un accès client tenus en base** (09/10/2026, espace client P1 ; art. 25 § 2, protection des données par
  défaut) : deux cases par accès, « Ventes » et « Banque », fausses par défaut ; `memberships` n'a aucune policy de mise à
  jour, pour personne, et seule `changer_droits_acces` les change, réservée au cabinet du dossier de l'accès. Éprouvé par
  impersonation de sept profils dans `supabase/essais/droitsAcces.sql` (43 verdicts, dont neuf mutations qui mordent :
  la table de vérité des quatre fonctions de lecture, le client qui ne lit que ses lignes et ne se donne aucun droit, la
  fonction refusée en 42501 à tout profil qui n'est pas le cabinet du dossier) ; `rls.sql` rejoué entier, avec un profil
  de plus — le client portant les deux droits, qui ne voit toujours que ses dossiers et n'écrit directement ni une
  facture ni un mouvement. **Limite nommée** : ces droits n'ont rien ouvert jusqu'au 10/10/2026 ; depuis, « Banque »
  ouvre la lecture des deux registres de P7 et du contrôle de solde des relevés, et « Ma simulation » (ci-dessous), et
  « Ventes » la lecture des ventes du dossier et leurs gestes par les fonctions du cabinet (P2, ci-dessous). Ce qu'ils
  ouvriront ensuite (P5, la suite de P7) sera une policy élargie, présentée au cabinet avant.
- **La banque d'un dossier sous la case « Banque »** (espace client P7, décision du cabinet du 10/10/2026 : les deux
  migrations appliquées ce jour-là, `banque_du_client` puis, la bascule de l'application en ligne, le resserrement
  `lectures_bancaires_au_droit_banque` ; art. 5 § 1 c, 25 § 2 et 32 § 1 b). Jusque-là, tout accès client LISAIT en
  base les mouvements de son relevé (date, libellé, montant, catégorie, compte), les parts d'un mouvement ventilé et
  les règlements groupés, sans qu'aucun écran les lui montre. Désormais, seul un accès qui porte la case les lit, avec
  le contrôle de solde des relevés importés et les deux registres ci-dessus ; tout accès lit les mois couverts — sans
  montant ni libellé — par `couverture_du_releve`, d'où l'Accueil et « Mes pièces » les tirent ; « Ma simulation »,
  calculée sur la banque, se tait sans la case (EC-Q1, décidée). Depuis P9a (11/10/2026), ce que la base ouvre ainsi à
  la session du client lui est MONTRÉ, dans « Ma banque » : la limite « sans écran » ne vaut plus. Éprouvé sur une
  réplique (neuf
  familles égales à la production) : `supabase/essais/banqueClient.sql` (86 verdicts, 0 en faute, sept profils, chaque
  refus par sa raison), `rls.sql` (3bis, son contrôle positif, 4bis : 28 lignes, 0 en faute, 19 mutations sur 19), et 47
  mutations des migrations, qui mordent toutes ; puis EN PRODUCTION, après chacune : `banqueClient.sql` rendait après
  la première les trois fautes attendues avant le resserrement, et elles seules, et après la seconde 86 verdicts, 0 en
  faute ; `rls.sql` entier, 0 en faute et 19 mutations sur 19. **Limites nommées** : les relevés DÉPOSÉS en
  fichier — par le client ou par le cabinet — restent lisibles par tout accès du dossier (`documents_divers`, seau
  `pieces`), comme l'a décidé le cabinet le 10/10/2026 : la case porte sur les mouvements que l'application tient, pas
  sur les fichiers ; et une précision est un texte libre qui peut nommer une personne — chez un praticien, un patient :
  la consigne aux clients (§8.7) vaut pour elle comme pour les pièces.
- **Les ventes du client, en base** (espace client, étape P2 : décision du cabinet du 10/10/2026, les deux migrations
  appliquées ce jour-là, `ventes_du_client` puis `ventes_du_client_facturation`, collée par le cabinet ; art. 25 § 2 et
  32 § 1 b). Ce qu'elles ouvrent, et à qui : au seul accès client qui porte le droit « Ventes »
  — faux par défaut, coché par le cabinet —, la LECTURE des ventes de SON dossier, par neuf policies `for select to
  authenticated` ajoutées à côté de celles du cabinet : ses factures et leurs lignes, leurs transmissions et les
  événements de Super PDP, les statuts lus sur sa plateforme, ses encaissements, leurs parts et leurs déclarations, et
  les e-mails qui ont envoyé une facture — jamais la relance de pièces. Aucune écriture directe : ses gestes (créer,
  valider, supprimer un brouillon, encaisser, déclarer, contre-passer, abandonner une transmission) passent par les
  fonctions du cabinet, qui l'acceptent désormais (`gere_les_ventes`) et notent qui a validé (`valide_par`) ; désigner
  le mouvement bancaire d'un encaissement demande AUSSI le droit « Banque ». Éprouvé sur une réplique dont la signature
  égale la production : `supabase/essais/ventesClient.sql` (90 verdicts), `rls.sql` entier avec deux invariants de plus
  — sans le droit, aucune ligne des ventes, même de son dossier ; avec lui, toutes, et aucune écriture directe — et les
  six essais des factures et des encaissements ; vingt-huit mutations des deux migrations, toutes vues ; puis EN
  PRODUCTION, après la seconde : la signature égale à la réplique sur ses neuf familles, `ventesClient.sql` 90 verdicts
  à 0 en faute (sept mutations qui mordent), `rls.sql` entier 35 lignes à 0 en faute et 31 mutations sur 31, les six
  essais sans une faute, rien resté. Au jour de l'application, aucun accès ne porte « Ventes ». **Limites
  nommées** : le client qui porte « Ventes » lit aussi ce que le cabinet écrit sur ces lignes — les notes d'une facture,
  le motif d'un avoir (rangé dans ses notes), le motif d'une contre-passation et la note d'une déclaration : dans un
  domaine ouvert, un texte saisi est PARTAGÉ (conception de l'espace client, §3.6). Aucune facture n'est annotée au
  10/10/2026, et depuis ce jour, avant l'application, le libellé de chacun de ces quatre champs le dit au-dessus du champ
  (« … le client qui porte la case « Ventes » les lit » ; condition du cabinet à son accord). Et
  `valide_par`, sans clé vers les comptes, reste nul sur les factures validées avant la migration. Aucun écran du
  client ne montre encore ses ventes (étape P4) : ce que la case ouvre, sa session l'atteint par la base, et l'onglet
  Accès le dit au cabinet avant qu'il la coche.
- **Les fonctions de la vente acceptent le client** (espace client, étape P3, 10/10/2026 ; art. 25 § 2 et 32 § 1 b) :
  `plateforme-agreee`, `superpdp-emit`, `superpdp-credentials` et `send-email` lisent les droits de l'appelant
  (`droits_sur_le_dossier`, avec son jeton) avant toute lecture d'un secret et tout appel extérieur, et ne font que ce que
  leur table « qui peut quoi » ouvre à la case « Ventes » ; sans elle — client sans la case, client d'un autre dossier,
  compte rattaché à rien —, la réponse d'avant, et rien de lu ; des droits illisibles refusent. Un secret enregistré ne
  part jamais vers une adresse changée sans être ressaisi. Le plafond d'e-mails borne ce qu'un compte client enverrait
  sous le domaine du cabinet. L'onglet Accès dit, avant que la case se coche, chaque geste qu'elle ouvre dans ces
  fonctions. Éprouvé par les contrats HTTP (chaque action, cinq profils) et quarante-cinq mutations. **Limites
  nommées** : le plafond se lit, il ne se réserve pas (des envois parallèles le dépassent d'autant) ; il compte aussi les
  e-mails du cabinet ; le message personnel d'un e-mail n'a pas de longueur bornée.
- **Une restauration éprouvée** contre Postgres, avec son plan de reprise (`PLAN_DE_REPRISE.md`).
- **Les policies RLS rejouées en bloc**, par impersonation réelle de quatre profils — le quatrième, depuis le
  09/10/2026, est le client dont les accès portent les deux droits (`supabase/essais/rls.sql`) : 68 tables, 59 d'entre
  elles portant un `dossier_id`, les trois buckets du stockage, les tentatives d'écriture de ses invariants 4 à 5 bis,
  et les blocs de la banque et des ventes du client. Dernier passage complet le 10/10/2026, après les deux migrations
  des ventes : 35 lignes, 0 en faute. La boucle part de `pg_class` et
  non d'une liste tenue à la main, donc une table ajoutée demain sans policy est attrapée sans que
  personne ait eu à y penser.
  **Et le harnais est lui-même éprouvé** : trente et une mutations délibérées (contrôles rejoués sous le
  super-admin, liste d'exceptions retirée) doivent toutes virer au rouge, et elles le font. Sans
  cela, une impersonation qui échouerait silencieusement rendrait zéro partout et afficherait « 0 en
  faute » sur une base grande ouverte — la panne qui ressemble exactement au succès.
- **Les devis du client, en base** (espace client, étape P5 : PRÉPARÉE le 10/10/2026, présentée au cabinet, PAS
  APPLIQUÉE ; art. 25 § 2 et 32 § 1 b). Trois tables neuves, sous RLS : le cabinet du dossier et l'accès client qui
  porte « Ventes » LISENT les devis et leurs liens (une policy `for select to authenticated` chacun, celle du client à
  part) ; PERSONNE n'écrit directement — quatre fonctions `SECURITY DEFINER` qui vérifient l'accès d'abord
  (`gere_les_ventes`), énumèrent leurs colonnes et refusent dans un ordre fixé ; le super-administrateur seul insère,
  pour restaurer une sauvegarde ; la série n'a aucune policy. Un devis émis est figé par une garde (seule sa réponse
  s'écrit, une fois) ; un brouillon seul se supprime. Éprouvé sur une réplique dont la signature égale la production
  (113 migrations, plus les deux de P2) : `supabase/essais/devis.sql` (167 verdicts, 0 en faute, chaque refus par sa
  raison, rien resté), `rls.sql` entier (onze tables des ventes au catalogue, contrôle positif, aucune écriture directe ;
  avant la migration, une ligne « en attente »), la restauration (68 tables, 0 écart), cinq courses à deux sessions, et
  42 mutations des migrations, toutes vues. **Limites nommées** : les notes d'un devis sont PARTAGÉES (un texte saisi
  dans un domaine ouvert au client, conception §3.6) — l'écran de l'étape P6 doit le dire au-dessus du champ ; et la
  durée de conservation des devis refusés ou expirés n'est pas tranchée (§8.9) : rien ne les purge.
- **Les pièces jointes écartées, dites au client dans « Mes pièces »** (ligne 22.9, migration
  `pieces_jointes_ecartees_au_client` : préparée le 13/10/2026, présentée au cabinet, appliquée sur son accord,
  S228B-Q1 ; art. 5 § 1 c, 25 § 2 et 32 § 1 b). Ce qu'elle ouvre, et à qui : à TOUT accès client du dossier — avec ou
  sans les cases « Ventes » et « Banque », comme « Mes pièces » —, par une fonction de lecture seule,
  `pieces_jointes_ecartees_du_client` (`SECURITY DEFINER`, l'accès vérifié avant toute lecture), le JOUR de la réception
  à Paris, la RAISON et le POIDS des pièces jointes que la réception par e-mail a écartées ces 90 derniers jours —
  jamais l'identifiant de la ligne, l'empreinte des identifiants Resend, la marque « vue » ni son auteur, un membre du
  cabinet ; la table elle-même lui reste FERMÉE (sa policy de lecture inchangée). Écartée : une policy de lecture, qui
  aurait ouvert les huit colonnes et toutes les lignes depuis la création du dossier (le droit de lire une colonne se
  donne à un rôle, et le cabinet et le client sont le même). Rien ne s'écrit : le client ne marque rien. Éprouvé sur une
  réplique dont la signature égale la production (130 migrations) : `supabase/essais/piecesJointesEcartees.sql`
  (81 verdicts, 0 en faute ; sans la migration, une ligne « EN ATTENTE » qui n'est pas une faute), `rls.sql` entier (0
  en faute, 31 mutations sur 31), et 27 mutations de la migration, toutes vues. En production le 13/10/2026, la
  migration appliquée (`20261013174021`) : le même essai, 81 verdicts, 0 en faute ; `signature.sql`, seules les
  fonctions et leurs droits changés. Le jour est celui de Paris, calculé par la base ; « Mes pièces » le montre depuis
  la bascule de l'application (`ECARTEES_DU_CLIENT_EXPORTEES`).
  Depuis la ligne 22.93 (13/10/2026), « Mes pièces » montre aussi au client l'adresse de collecte de son dossier — le
  `code_email` de SA ligne de `dossiers` (son nom en tirets et six caractères de l'identifiant), que la policy de lecture
  de `dossiers` lui ouvrait déjà ; rien de plus n'est ouvert en base, aucune donnée nouvelle ne sort, et la lecture ne
  part qu'avec la société affichée.
  Depuis la ligne 22.94 (13/10/2026), l'accueil du client lit la MÊME fonction, par le même crochet
  (`lib/piecesJointesEcarteesClientLecture.ts`), pour dire en une ligne combien de pièces jointes écartées l'attendent
  dans « Mes pièces » : rien de plus n'est ouvert ni lu — les mêmes trois champs, la même fenêtre de 90 jours, et l'accueil
  n'en montre que le compte (ni raison, ni jour, ni poids) ; la lecture ne part qu'avec la société affichée.
- **L'état de la facture électronique d'un dossier** (espace client, étape A6a : présentée au cabinet le 14/10/2026,
  appliquée sur son accord ; art. 5 § 1 c, 25 § 2 et 32 § 1 b) : la fonction `etat_facture_electronique`
  (`SECURITY DEFINER`, l'accès vérifié avant toute lecture — le cabinet du dossier, ou l'accès client qui porte
  « Ventes ») rend seulement si la plateforme agréée du client et Super PDP sont reliés, le nom donné à la
  plateforme, leurs dates (création, dernière récupération, dernier relevé des statuts) et l'adresse de réception
  courante — jamais une adresse de service, un identifiant ou un secret OAuth2, une organisation ni une portée, que
  l'essai `supabase/essais/etatFactureElectronique.sql` cherche, plantés, dans le texte rendu.
  Depuis l'étape A6b2 (14/10/2026), l'état est à l'écran : l'encart « Facture électronique » de l'accueil du client qui
  porte « Ventes » et la carte de la Vue d'ensemble du cabinet le lisent par un seul crochet
  (`lib/etatFactureElectroniqueLecture.ts`). Rien de plus n'est ouvert ni lu — la même valeur, lue sans rien deviner
  (une valeur d'une autre forme est dite illisible, jamais montrée) —, la lecture ne part qu'avec la société affichée,
  et l'encart n'appelle aucune plateforme. Il montre l'adresse (identifiant, maille, plateforme, prise d'effet,
  vérification) et le nom de la plateforme, jamais l'auteur de l'adresse ; « ce qui attend », chez le client seul, se
  compte des listes de ventes que l'onglet Factures lit déjà, par UNE lecture partagée avec les tuiles de l'accueil.
- **Le dernier changement du RIB des factures d'un dossier** (espace client, étape A5b3a : la migration
  `dernier_changement_de_rib`, préparée le 16/10/2026 et éprouvée sur une réplique, présentée au cabinet, appliquée sur
  son accord le 17/10/2026 sous la version `20261016220724` (A5B3-Q1) ; art. 5 § 1 c, 25 § 2 et 32 § 1 b ; décision du
  cabinet A5-Q2) : une fonction de lecture seule, `dernier_changement_de_rib` (`SECURITY DEFINER`, l'accès vérifié avant
  toute lecture — le cabinet du dossier, ou l'accès client qui porte « Ventes » ou « Banque »), rend le JOUR à Paris du
  dernier changement du RIB des factures — une version qui pose, change ou retire le RIB, ou la confirmation d'un RIB
  proposé —, son geste, son AUTEUR — le cabinet ou un accès client, « inconnu » quand la base ne l'écrit pas, jamais la
  personne —, son ÉTAT et ce qu'il a fait au RIB en vigueur ; jamais l'IBAN, le BIC, le titulaire, l'identifiant d'un
  compte ou d'une version, ni l'heure, que l'essai `supabase/essais/dernierChangementDeRib.sql` cherche, plantés, dans
  chaque réponse de chaque profil. L'accès qui ne porte que « Banque » ne lit toujours pas la table des paramètres : il
  n'en apprend que cela. Écartée : une policy de lecture, qui lui aurait ouvert toutes les colonnes de toutes les
  versions (le cabinet et le client sont le même rôle). Rien ne s'écrit ; `CHANGEMENT_DE_RIB_EXPORTE`, levé avec la
  migration : l'onglet Accès dit ce que la case « Banque » ouvre de plus. **Depuis l'étape A5b3b (17/10/2026), deux
  écrans la lisent** — la Vue d'ensemble de chaque dossier du cabinet, et l'accueil du client qui porte « Ventes » ou
  « Banque » sur la société affichée — pour dire ce changement en une ligne (le jour, l'auteur — « un accès client de
  ton dossier », jamais la personne —, ce que les factures porteront, un conseil) : chez le cabinet, un RIB proposé tant
  qu'il n'est ni confirmé ni remplacé, le reste trente jours depuis le jour du changement ; chez le client, tout
  changement trente jours (décision du cabinet A5B3-Q4). Une lecture par écran, à son ouverture et pour son dossier ; un
  client sans l'une des deux cases n'appelle pas la fonction. Aucune marque « vu », aucune table, aucune donnée de plus
  stockée ni transmise : l'avis se calcule de la valeur lue et du jour de Paris, à chaque affichage.
- **Le logo des factures d'un dossier, et le seau des ventes** (espace client, étape A5c1 : la migration
  `logo_des_factures`, préparée le 17/10/2026 et éprouvée sur une réplique, présentée au cabinet, appliquée sur son
  accord le 17/10/2026 sous la version `20261017120403` (A5C-Q1) ; art. 5 § 1 c et f, 25 § 2 et 32 § 1 b) : un quatrième
  seau du stockage, `ventes`, PRIVÉ — jamais une adresse publique : un logo ne se lit que dans une session à qui une
  policy l'ouvre — et borné en base (500 Kio, une image PNG ou JPEG, jamais un SVG, qui porte du script) ; le logo s'y
  range sous `<dossier>/logos/<empreinte>.png` ou `.jpg`, nommé par son SHA-256, et une version des paramètres de
  facturation le désigne par son chemin et son empreinte (deux colonnes, leur forme tenue par trois contraintes). **Ce
  qui y vit** : le logo du client — pour un entrepreneur individuel, une image qui peut porter son nom, sa signature ou
  son visage : une donnée personnelle, au même titre que sa dénomination « <nom> EI ». **Qui le lit** : le cabinet du
  dossier et l'accès client qui porte « Ventes », les fichiers de CE dossier seulement ; personne d'autre — l'anonyme,
  un compte rattaché à rien, un accès sans case ou qui ne porte que « Banque », un membre du cabinet non affecté, un
  compte d'un autre cabinet. **Qui dépose** : les mêmes, sous `<dossier>/logos/` et à la seule forme d'un logo ; un
  fichier déposé ne se met jamais à jour (aucune policy de mise à jour) et un dépôt qui le remplacerait est refusé.
  **Qui supprime** : le chef du cabinet du dossier seul — celui qui supprime le dossier, et la suppression d'un dossier
  vide ce seau comme ceux des pièces et des packs (`supprimerDossierDefinitivement`, le drapeau
  `LOGO_DES_FACTURES_EXPORTE` levé avec la migration) ; le client ne supprime rien. **Durée** : celle du dossier ; un
  logo qu'une version ne désigne plus reste dans le seau jusqu'à la suppression du dossier (décision du cabinet A5C-Q3,
  17/10/2026). La fonction `enregistrer_parametres_facturation` refuse un logo d'un autre dossier, d'une autre forme,
  absent du seau, d'un type ou d'un poids que le seau n'admet pas (tels que le catalogue les dit) ; un logo inchangé ne
  se rejuge pas ; le retirer est une version qui ne le porte plus. Depuis l'étape A5c2b (17/10/2026, décision du
  cabinet A5C-Q5), la sauvegarde d'un dossier PORTE le fichier de chaque logo qu'une version désigne — relu par la
  session du cabinet qui sauvegarde, son empreinte recalculée, en base64 dans le fichier téléchargé, qui se range
  comme le reste du dossier (PLAN_DE_REPRISE.md, §2) —, et non les fichiers du seau qu'aucune version ne désigne ; un
  logo qu'elle n'a pas pu lire est nommé dans son manifeste, avec sa raison. La restauration, par le
  super-administrateur, le redépose au chemin que la version désigne, sous le dossier restauré et nul autre, son
  empreinte vérifiée avant ; rien d'autre ne part ni n'est gardé. Prouvé par impersonation
  sur une réplique égale à la production, puis en production le 17/10/2026 (`supabase/essais/logoDesFactures.sql`, 126
  verdicts, `rls.sql` et son bloc « Le seau des ventes ») ; les SUPPRESSIONS, sur la réplique seulement
  (`supabase/essais/logoDesFacturesSuppression.sql`, §8.6). Depuis l'étape A5c2a (17/10/2026), le bloc « Logo des
  factures » de la vue « Paramètres » le montre au cabinet et au client « Ventes » — le fichier relu dans le seau et son
  empreinte recalculée avant toute image, l'image gardée dans le navigateur le temps de l'écran (une adresse d'objet
  locale, révoquée ensuite) —, le dépose, le change ou le retire, et, depuis l'étape A5c2b, redépose le fichier qu'une
  version désigne quand le seau ne le rend plus (le même fichier, reconnu à son empreinte) ; aucune facture ne
  l'imprime avant l'étape A7.

Ce qui est **affirmé sans être rejoué** — et c'est la limite à connaître :

- **Le plan Supabase est `free`** : aucune sauvegarde automatique côté hébergeur, et le contrôle
  des mots de passe contre les fuites connues est réservé au plan Pro. Voir PLAN_DE_REPRISE.md §1.
- **Les Edge Functions** restent vérifiées par relecture, advisors et essais manuels : aucun test ne
  les appelle en HTTP, avec leur authentification et leurs erreurs.
- **La SUPPRESSION d'un fichier n'est pas démontrée**, et c'est une limite nommée plutôt qu'un
  oubli — voir §8.6.

---

## 8. Ce qui reste à décider ou à faire

### 8.1 — Lire le secret `AWS_REGION` *(FAIT le 21/09/2026 — `eu-central-1`, donc UE)*

Le contenu INTÉGRAL de chaque document déposé part chez AWS pour être lu, bordereaux compris. La
région décide si c'est un traitement en Europe ou un transfert hors UE.

**La moitié que le code gouverne est désormais gardée** : `edgeFunctionsRegions.test.ts` lit la
vraie source déployée et refuse toute région hors UE, pour Textract comme pour Bedrock — et vérifie
au passage que les fonctions qui lisent le secret retombent toutes sur la même région, sans quoi une
partie des documents partirait ailleurs pendant que le registre annoncerait une seule région.
**Il part de TOUTE fonction qui importe un SDK AWS** (26/09/2026) : sa première version nommait les
siennes, et `proposer-categorie` serait arrivée sans lui. Il exige aussi que chaque client AWS NOMME
sa région — sans elle, le SDK Bedrock prend le secret `AWS_REGION`, puis **`us-east-1`** (vérifié dans
le paquet 0.33.4) : sur un projet recréé dont le secret n'est pas encore posé, les textes partiraient
aux États-Unis sans qu'aucun fichier ne change.

**La moitié qu'il ne gouverne pas est désormais MESURÉE, et c'est mieux qu'une lecture de tableau
de bord** : le secret `AWS_REGION` l'emporte sur le repli du code, et aucun fichier de ce dépôt ne
peut dire sa valeur. Plutôt que d'aller la lire dans Supabase → Edge Functions → Secrets — une
vérification humaine qu'on oublie de refaire, et que rien ne rappelle le jour où le secret change —
`evaluer-extraction` résout le MÊME secret que la production et REND la région obtenue. Appelée avec
`limite: 0` elle ne parcourt aucune pièce, donc ne facture rien.

**Résultat, le 21/09/2026 : `eu-central-1` (Francfort).** C'est bien la région annoncée au §3 comme
repli du code, elle est dans l'Union, et ce point est clos. **Il se rouvre en un appel** le jour où
le secret change ou qu'on veut s'en assurer, sans accès au tableau de bord.

### 8.2 — Établir le statut de Resend *(partiellement fait — deux points restent)*

Les e-mails sortants (factures, relances) et surtout les **pièces jointes entrantes** transitent par
Resend. Trois points étaient à établir : où les données sont traitées, ce que dit leur accord de
sous-traitance, et combien de temps ils conservent les messages.

**La région est confirmée le 22/09/2026 (réponse du cabinet dans « Décisions en attente ») :
`eu-west-1`.** Ce n'est donc pas un transfert hors UE au sens du traitement géographique — la case
« transfert hors UE » du §3 se referme sur ce point précis.

**Ce qui reste ouvert, et ce n'est pas la même question** : le contenu de l'accord de
sous-traitance (DPA) avec Resend, et la durée pendant laquelle ils conservent les messages et leurs
pièces jointes une fois traités. Une région correcte ne dit rien de la durée de rétention côté
Resend ni des garanties contractuelles — les deux restent à obtenir directement auprès d'eux avant
de clore ce point.

### 8.3 — Durée de conservation du texte OCR *(tranchée le 22/09/2026, implémentée le même jour)*

Le cabinet a choisi l'option B — purger après clôture de l'exercice — restreinte aux pièces
sensibles (celles qui portent des données de patients) : « Comme ta préférence, le B, et que pour
les documents sensibles » (« Décisions en attente »).

**Ce que « sensible » veut dire ici** : les justificatifs de recette (bordereaux de
télétransmission), seule famille de pièces à porter des noms de patients — voir §4 et §6. Une
facture EDF n'a aucune raison d'être purgée, et ne l'est pas. **Depuis le 24/09/2026, ces
bordereaux n'ont plus vocation à entrer (§8.7)** : la purge reste en place comme défense en
profondeur, pour ceux qui arriveraient malgré la consigne.

**Le geste** : `ClotureTab` porte un bouton « Clôturer l'exercice » par exercice affiché. Il pose une
ligne dans `exercices_clotures` (date de la demande, pas un vrai calcul de résultat — ce reste un
brouillon, voir le bandeau de l'écran) puis supprime le texte OCR (`piece_textes_ocr`) des pièces
validées de cet exercice dont `type_piece = 'vente'`. **Les fichiers déposés ne sont pas touchés** —
seul le texte déjà lu, la copie dérivée sans durée légale propre (voir §4), disparaît. Rejouer le
bouton sur un exercice déjà clôturé rattrape les pièces sensibles validées depuis, sans reposer une
seconde ligne de clôture.

**Ce que ce geste n'est PAS** : une clôture comptable réelle. `exercices_clotures` ne porte qu'une
date, exactement ce qu'il faut pour décider si la purge a été demandée — rien de plus.

Voir `src/lib/clotureExercice.ts` (logique, testée par mutation) et la migration
`20260922071331_creation_exercices_clotures` (RLS vérifiée par impersonation réelle : anonyme et
utilisateur étranger au dossier refusés, admin du dossier autorisé en lecture/écriture/suppression).

### 8.4 — Contrats de sous-traitance *(à faire avant le second cabinet)*

Aucun contrat n'existe aujourd'hui, et c'est cohérent : JD Consult est à la fois le cabinet et
l'éditeur. Le jour où un cabinet tiers arrive, il faut un contrat de sous-traitance éditeur/cabinet
et la liste des sous-traitants ultérieurs (§3) annexée.

### 8.5 — Rejouer les policies RLS après chaque migration *(fait le 19/09/2026)*

`supabase/essais/rls.sql` le fait, et la section 7 est passée de « affirmée » à « démontrée ».

**Ce qu'il a trouvé à sa première exécution justifie à lui seul le chantier** : un visiteur
**anonyme** — non connecté, muni de la seule clé publique de l'application — lisait les 10 catégories
comptables et les 8 natures d'immobilisation du cabinet. Les deux policies disaient
`using (dossier_id is null or ...)` sans clause `to`, or une policy sans `to` s'applique au rôle
`public`, donc à `anon`. La branche « dossier_id is null » voulait dire « partagé par tout le
cabinet » ; elle disait en fait « lisible par tout Internet ». Corrigé par la migration
`categories_et_natures_reservees_aux_connectes`.

Aucune donnée personnelle n'était exposée, aucune donnée de dossier — la configuration comptable du
cabinet seulement. Ce qui compte ici n'est pas le contenu mais la **forme du défaut** : une porte
qui s'élargit toute seule, le jour où une ligne partagée porte autre chose. Et surtout : ces deux
policies avaient été relues, plusieurs fois, sans que personne ne voie la clause manquante. Il
fallait l'exécuter pour la voir.

**Reste à faire** : le rejouer après chaque migration qui touche une policy. Ce n'est pas automatisé
— le harnais vit dans `supabase/essais/`, qui se rejoue à la main par l'outil MCP, comme la
restauration. L'automatiser supposerait un accès à la base depuis la CI, que ce dépôt n'a pas.

### 8.6 — La suppression d'un fichier reste un essai manuel *(limite assumée)*

Le harnais couvre la lecture et le dépôt des fichiers. Il ne couvre **pas** la suppression, et la
raison mérite d'être écrite parce qu'elle piège :

Un trigger de la plateforme, `protect_objects_delete` (BEFORE DELETE → `storage.protect_delete`),
refuse toute suppression SQL directe sur `storage.objects` — *« Direct deletion from storage tables
is not allowed. Use the Storage API instead. »* Il refuse pour **tout le monde**, et il refuse avec
le SQLSTATE **42501**, celui-là même qu'utilise un refus de policy.

Un essai de suppression est donc indiscernable d'un refus RLS : il **passerait au vert avec une
policy grande ouverte**. C'est ce qui s'est produit — le contrôle avait d'abord été écrit comme les
autres et il était vert. C'est sa MUTATION qui l'a démasqué : rejoué sous le super-admin, à qui la
suppression est permise, il refusait de mordre. Un contrôle vert dont la mutation ne mord pas ne
prouve rien.

Ce qui est gardé à la place est plus faible et dit comme tel : le harnais lit le catalogue et vérifie
que `pieces_storage_delete` existe toujours et porte encore `admin_du_dossier`. Cela ne prouve pas
que Postgres l'applique — seulement qu'aucune migration ne l'a supprimée ni élargie.

Le seau des ventes (étape A5c1, migration appliquée le 17/10/2026) va un pas plus loin, **sur une réplique seulement** :
`supabase/essais/logoDesFacturesSuppression.sql` pose le réglage que l'API Storage pose elle-même
(`storage.allow_delete_query`), qui lève la protection de la plateforme, puis fait supprimer un logo
par chaque profil — et prouve ainsi ce que Postgres applique : le chef du cabinet du dossier seul. Il
porte des suppressions : il ne se joue jamais en production, où `rls.sql` (bloc « Le seau des
ventes ») et `logoDesFactures.sql` lisent la policy au catalogue. Appris en l'écrivant : une
suppression qui nomme ses lignes ne voit que ce que les policies de LECTURE ouvrent — le droit réel
de supprimer est celui de supprimer ET de lire.

**Pour le démontrer vraiment, il faut passer par l'API Storage**, qu'un script SQL ne peut pas
appeler : c'est un essai manuel, depuis un client authentifié. À faire une fois, et à refaire le jour
où les policies du stockage changent.

### 8.7 — Hébergement de données de santé (HDS) *(tranché le 24/09/2026 : non requis, sous condition)*

**La question** : l'article L.1111-8 du Code de la santé publique impose un hébergeur certifié HDS à
« toute personne qui héberge pour le compte de tiers des données de santé […] recueillies à
l'occasion d'activités de […] soins ». Supabase n'est pas certifié HDS. Tant que ce registre disait
que le cabinet traite les données des patients « pour le compte » du praticien (ancienne rédaction
du §6), l'application était dans le cas prévu par ce texte.

**La réponse du cabinet** : le praticien n'a pas le droit de transmettre ses bordereaux de
télétransmission à son expert-comptable, et n'en a pas besoin — le relevé SNIR justifie les recettes
sans identifier aucun patient. Aucune donnée de santé n'a donc vocation à entrer dans l'application,
et l'HDS n'est pas requis.

**La condition, écrite plutôt que sous-entendue** : c'est vrai tant qu'aucun bordereau n'entre, et
aujourd'hui **seule la consigne donnée aux clients le garantit, pas le code**. L'application accepte
toujours les bordereaux : `extract-piece` les reconnaît à leur titre, `orientationDe` les range en
Pièces comme recettes, la fiche pièce annonce à l'opérateur « un justificatif de RECETTE, pas une
dépense », et la purge du §8.3 a été construite autour d'eux. **Décision du cabinet, le 24/09/2026 :
ne rien changer au code.** Deux options avaient été proposées et écartées — refuser le bordereau à
l'arrivée (détectable à son titre, et même dans le navigateur avant tout envoi pour un PDF généré
par le logiciel de télétransmission), ou l'accepter en le signalant comme à supprimer.

**Ce qui rouvrirait la question** : un bordereau, ou tout autre document portant des patients,
constaté dans un dossier réel. Le remède serait alors l'une des deux options ci-dessus, pas un
changement d'hébergeur.

**Pour mémoire, si un hébergement HDS devenait un jour nécessaire** (recherché le 24/09/2026) :
411 hébergeurs certifiés en mai 2026, liste tenue par l'Agence du Numérique en Santé ; depuis le
16/05/2026 seuls comptent les certificats au référentiel v2, qui impose l'Espace économique européen
et la déclaration de toute exposition à une loi extraterritoriale comme le CLOUD Act. Clever Cloud
est le seul hébergeur vérifié à proposer du PostgreSQL managé dans sa région HDS ; Scaleway certifie
son stockage objet mais pas ses bases managées ; chaque offre impose un contrat HDS et un support
payant, de l'ordre de 200 à 300 € par mois avant la première ressource. AWS n'est certifié que pour
une liste de services et de régions : il faudrait y vérifier Textract.

**La règle des soins, pour le fichier des clients du client** (étape A4a ; hypothèse MEG1-Q10) : un dossier qui dispense des soins exonérés (CGI, art. 261, 4, 1° — l'article
d'exonération du dossier, quel que soit son statut de TVA, question A4-Q1) ne range aucun
particulier dans ses contacts — ni un non-assujetti sans SIREN, ni un client établi hors de France
(questions A4-Q2 et A4-Q3) —, et la fonction le refuse nommément : un patient n'entre pas dans le
fichier des clients. Ce que devient un particulier déjà rangé quand l'article du dossier change
ensuite est la question A4-Q4 : depuis l'étape A4b1, l'écran « Clients » le signale (il ne se modifie plus
tel quel ni ne se reprend) et propose de l'effacer, jamais d'office, et dit la règle au-dessus de la liste
d'un dossier de soins. **La facture, elle, le permet encore, et le DIT depuis l'étape A4b2** : rien
n'empêche un brouillon de nommer un particulier dans un dossier de soins (trouvé en passant par la
conception de l'espace client) ; quand le client de la facture est un particulier (un non-assujetti
sans SIREN) ou un client établi hors de France, le formulaire — au cabinet comme au client « Ventes » —
dit que la règle des soins ne le range pas dans les clients du dossier, et pourquoi (une facture à un
particulier y nomme un patient), sans rien refuser : la facture s'enregistre et se valide, seul
« Enregistrer ce client » est refusé avant le clic, sous les mots de la base. « Choisir un client » ne
propose pas non plus les contacts rangés avant le passage aux soins, et le dit. Avertir seulement,
plutôt que refuser la facture, est la lecture que le cabinet a retenue le 15/10/2026 (A4B2-Q2,
« comme recommandé ») : la facture est une pièce légale que le professionnel doit pouvoir émettre,
et la consigne aux clients (ci-dessus) reste ce qui tient la condition.

### 8.8 — Connexion bancaire : ce qui reste avant la production *(ouvert le 30/09/2026)*

La preuve de concept tourne sur le **bac à sable** d'Enable Banking : banques et mouvements fictifs, et
l'écran le dit avant tout import. Rien de ce qui suit ne se pose tant qu'elle y reste ; tout se pose
avant la première connexion d'un vrai compte.

- **Le prestataire n'est pas choisi** — il est sur devis (ligne 24 de la feuille de route). Le
  contrat, sa liste de sous-traitants et la question du rôle (voir §3 : un prestataire agréé qui agit
  sous le consentement du titulaire) se tranchent avec lui, et rejoignent le §8.4.
- **Qui se connecte.** L'accord se donne sur le site de la banque, avec les identifiants du
  titulaire : c'est le CLIENT qui doit le donner, jamais le cabinet à sa place. La preuve de concept
  fait cliquer le cabinet ; en production, il faudra soit un chemin dans l'espace client — pas encore
  construit —, soit une connexion faite par le client lui-même, cabinet à ses côtés.
- **Les libellés nomment des tiers, et pour un praticien parfois un patient** — celui qui règle par
  virement. Ce n'est pas nouveau : un relevé déposé en CSV ou en PDF importe les mêmes libellés depuis
  le début, et la connexion n'y ajoute rien. Mais le §4, qui situe les données de patients dans les
  FICHIERS et non dans les tables, ne compte pas `lignes_bancaires.libelle` : à remesurer au premier
  dossier réel, sans rouvrir le §8.7 pour autant — un nom de payeur n'est pas un bordereau.
- **Retirer la connexion referme l'accord chez la banque**, puis efface la ligne. Si la banque ne
  répond pas, l'écran le dit et propose de retirer quand même : l'accord expire alors de lui-même, à
  sa date, et plus rien dans l'application ne permet de s'en servir.

### 8.9 — Les devis du client : qui en répond, et combien de temps *(questions au cabinet, 10/10/2026)*

L'étape P5 de l'espace client (préparée, non appliquée) range dans l'application les devis que le client adresse à ses
propres clients. Trois questions se posent avant l'application, et aucune ne se tranche dans le code :

- **Qui est responsable de ces données ?** Un devis nomme le client du client — un particulier, parfois. Quand le
  client établit ses devis lui-même dans l'application, c'est LUI qui décide pourquoi et comment ces données sont
  traitées : il en serait le responsable, et le cabinet (qui lui fournit l'outil) son sous-traitant pour cette part —
  ce qui appelle un contrat au sens de l'article 28 — la conception de l'espace client le recommande dans la lettre de
  mission (question EC-Q2, sans réponse au 10/10/2026). Hypothèse retenue en attendant : la recommandation ; rien ne
  s'écrit dans le code, et le premier devis réel attend la réponse.
- **Combien de temps les garder ?** Aucun texte ne fixe la durée de conservation d'un devis. Un devis REFUSÉ ou EXPIRÉ
  ne nomme qu'un prospect : le référentiel de la CNIL sur la gestion des activités commerciales retient trois ans
  après le dernier contact (repris de la conception de l'espace client) ; un devis ACCEPTÉ fait partie du contrat et
  accompagne la facture qui en est tirée, que le code de commerce fait garder dix ans (art. L123-22, §5). Aucune purge
  n'existe ; la décider, c'est choisir ces durées.
- **Aucun devis de soins.** L'information écrite préalable qu'un professionnel de santé remet à un patient (arrêté du
  30 mai 2018) nomme un patient et a son propre modèle : elle n'entre pas dans l'application, comme les bordereaux
  (§8.7). La consigne aux clients le dira ; le code ne le distingue pas.
