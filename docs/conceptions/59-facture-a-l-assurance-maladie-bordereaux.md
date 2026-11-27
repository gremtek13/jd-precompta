# 59 — Ce qui est facturé à l'assurance maladie : les bordereaux de télétransmission (Télévitale)

Recherche documentaire du 17/11/2026, suivie d'une proposition ; **aucun code dans ce lot**. La demande du cabinet : rapprocher
« ce que l'assurance maladie paie » (les retours NOEMIE : conception 53, NOE1 à NOE5b) de « ce qu'elle doit payer » (ce que le
praticien a facturé en télétransmission : conception 56, § 6.3 et § 6.4, question OPT-Q6). Sa réponse du 17/11/2026 : le logiciel
de télétransmission est **Télévitale**, et les bordereaux ne sont donnés qu'en **PDF**.

Les décisions en vigueur, que rien ici ne rouvre : pas d'hébergement de données de santé (RGPD.md § 8.7) ; « on récupère que
les chiffres et on stocke pas de données patients » (16/11/2026) ; le fichier se lit dans le navigateur et n'en sort pas ;
agrégats seuls ; aucune colonne de texte en base.

**Comment lire les degrés de confiance** : *éditeur* (un document que l'éditeur publie : site, FAQ, tutoriel, manuel) ;
*éditeur, capture* (lu sur une capture d'écran d'un tutoriel de l'éditeur : l'intitulé est sûr, la version du logiciel peut
avoir changé) ; *texte* (Légifrance) ; *tiers* (un autre éditeur, la presse) ; *non trouvé*. Toutes les sources ont été
consultées le 17/11/2026. Les captures de l'éditeur montrent des patients d'essai : aucun de leurs noms ni numéros n'est
recopié ici, seuls les intitulés le sont.

## 0. En douze lignes

1. Télévitale est un logiciel Windows installé sur le poste du praticien, agréé SESAM-Vitale 1.40, édité à l'origine par
   Télévitale SAS (Bouches-du-Rhône, créée en 1993), aujourd'hui sous l'enseigne « Topaze Télévitale » du groupe Sofia.
2. Il sert les infirmiers, kinésithérapeutes, orthophonistes, orthoptistes, pédicures-podologues, médecins, dentistes et
   centres de soins — donc bien au-delà du praticien du MVP.
3. **Le mot « bordereau » y désigne deux états différents** : le *bordereau de télétransmission* (un par lot, la liste des
   factures ENVOYÉES : le facturé) et le *bordereau des paiements* (« Paiement Noemie par journée comptable » : le PAYÉ). Savoir
   lequel le cabinet a en main est la première question (BOR-Q1).
4. Le bordereau de télétransmission « précise la liste des factures télétransmises » : il est nominatif par construction. Ses
   colonnes ne sont publiées nulle part : **non trouvé**.
5. L'état qui dit le mieux « ce qu'elle doit » est le **« Tableau de suivi tiers payant »** : une ligne par facture, le total
   facturé, le solde restant dû par la caisse et la complémentaire, l'état de chaque part, les deux organismes. Il s'imprime
   (« Imprimer la liste »). Il porte le nom du bénéficiaire.
6. **Des états sans nom de patient existent** : les statistiques « Chiffre d'affaires par caisse » et « Chiffre d'affaires par
   organisme complémentaire » (exportables en PDF), et surtout « Outils › Requêtes », qui exporte en Excel le résultat d'une
   requête que l'éditeur propose d'aider à écrire. Le « Journal des lots et bordereaux » (une ligne par lot) en est peut-être
   un troisième ; ses colonnes ne sont pas publiées.
7. Aucun export CSV des retours NOEMIE n'est documenté chez Télévitale : **NOE1 (le payé) attend lui aussi un PDF ou une
   requête**, pas le CSV que NOE2 sait lire. C'est la conséquence la plus immédiate de cette recherche.
8. Le droit : la caisse paie une feuille de soins électronique en tiers payant sous **sept jours ouvrés** (CSS, art.
   L. 161-36-3 et D. 161-13-3), sous pénalité (D. 161-13-4). Aucun délai réglementaire trouvé pour la complémentaire.
9. Le rapprochement **par lot est impossible** avec ce que la base garde : la conception 53 (§ 3) a écarté le numéro de lot
   comme le numéro de facture (des pseudonymes). Il se fait **par organisme et par part**, en compte courant : le facturé
   cumulé contre le payé cumulé.
10. Le reste dû et son ancienneté se **lisent** dans le suivi tiers payant (le logiciel du praticien rapproche facture par
    facture, lui seul le peut) plutôt qu'ils ne se calculent ; le calcul « facturé moins payé » sert de contrôle, et se dit
    « estimé ».
11. La garantie qu'aucun nom ne sort : trois étages — pdf.js sur des octets locaux, un module pur dont la sortie n'a aucun
    champ de texte libre, une base sans colonne de texte — et un gabarit fermé par état, qui refuse une mise en page inconnue.
12. Huit lots (BOR0 à BOR7), neuf questions ; BOR0 ne coûte aucun code : une page rendue anonyme et trois captures d'écran.

## 1. Télévitale : ce qui est établi

### 1.1 L'éditeur, les professions, les versions

| Fait | Source | Confiance |
|---|---|---|
| Le site `televitale.fr` renvoie à `televitale.org` ; la société se dit « Créée en 1993 », « membre du groupe Sofia » ; le pied de page nomme « IDEA - Logiciel Télévitale », à Meyreuil (13) ; le site présente Albus (infirmiers), Topaze (kinésithérapeutes), Orthomax (orthophonistes) | https://www.televitale.org/ | éditeur |
| Les tutoriels de 2018 à 2020 portent en pied « TELEVITALE SAS », immeuble Le Gamma, Venelles (13), RCS Aix-en-Provence 391 889 037 ; ceux de 2024-2025 portent « SOFIA DEVELOPPEMENT », SAS, Paris 9e, RCS Paris 852 414 689, et les trois logos Albus, Topaze, Télévitale | tutoriels 013, 124 ; 183, 198 (adresses au § 1.4) | éditeur |
| Le logiciel est nommé « Topaze Télévitale » dans les tutoriels de 2025 | tutoriels 018, 044, 145 | éditeur |
| La date et la forme du rapprochement avec Sofia | — | non trouvé |
| Professions : un manuel par spécialité — infirmier ; kinésithérapeute ; orthophoniste ; orthoptiste ; pédicure-podologue ; médecin généraliste, spécialiste et chirurgien-dentiste ; centres de soins infirmiers et centres de santé | https://www.televitale.org/assistance/tutoriels-pdf-et-videos/ | éditeur |
| Deux interfaces : l'écran d'accueil (« Televitale INFO » : infirmiers, médecins, pédicures-podologues) et le « tableau de bord » (kinésithérapeutes, orthophonistes, orthoptistes) ; les mêmes états sous des chemins différents | tutoriel 025 | éditeur |
| Un logiciel installé sur le poste : Windows 11, ni Mac ni processeur ARM ; une base locale que le praticien sauvegarde sur un support amovible ; « Agréé SESAM VITALE 1.40 » | tutoriel 145 (septembre 2025) ; manuels 055, 038 | éditeur |
| Versions : « Version 450 et + » (manuel infirmier, juin 2024) ; mise à jour « 5xx » (prérequis, septembre 2025) ; une capture montre « TELEVITALE V3.60 » | manuel 055 ; tutoriels 145, 198 | éditeur ; éditeur, capture |
| Une version en ligne ou hébergée | — | non trouvé (un tutoriel de 2019 parle d'une « connexion TSE », sans plus) |
| Le suivi tiers payant « est lié au retour NOEMIE ou RSP580 » : le logiciel reçoit la référence 580 | tutoriel 183 (juin 2025) | éditeur |

### 1.2 Les états autour de la télétransmission

Les chemins sont ceux de l'écran d'accueil ; entre parenthèses, celui du tableau de bord quand il diffère.

| État (nom exact) | Comment on le sort | Ce qu'il contient | Sortie | Patient ? | Confiance |
|---|---|---|---|---|---|
| **Bordereau de télétransmission** | imprimé « pour chaque lot » à l'issue de la télétransmission ; réimprimé par le menu « Télétransmission », rubrique « Journal des lots et bordereaux », liste des lots de FSE ou de DRE, bouton « bordereau » (bouton « transmission », « journal des lots ») | « précise la liste des factures télétransmises » ; s'envoie à la caisse avec les feuilles papier d'un lot en mode dégradé | « aperçu avant impression » ; PDF : non documenté pour cet état | oui, par construction (une liste de factures) ; **colonnes : non trouvé** | éditeur (manuels 057, 038) |
| **Journal des lots et bordereaux** | menu « Télétransmission » | une ligne par lot ; colonne « État du lot » : « A transmettre ou En cours », « Transmis », « accusé de réception positif (ARL) », « accusé de réception négatif (ARL) », « Traitement manuel », « annuler » | impression de la liste : non trouvé | **autres colonnes : non trouvé** — s'il ne porte que le lot, sa date, son destinataire, son nombre de factures et son montant, c'est l'état sans patient cherché | éditeur (tutoriel 198) |
| Fichiers à transmettre | bouton « Transmettre », onglet « 5. Fichiers à transmettre » | colonnes « Type », « Nom Fichier », « Lot(s) », « Date », « Destinataire » | écran | non | éditeur, capture (198) |
| **Journal des factures** | menu « Facturation » | colonnes « Numéro », « Dégradé », « TP », « Lot », « Etat », « TLA », « Patient », « Date », « Montant », « Caisse », « Mutuelle », « Assuré », « Lot archivé », « Nature » ; états « Saisie », « Validée », « à charger », « Chargée dans le TLA », « À transmettre », « À sécuriser », « Transmise », « Non transmissible » ; deux mois affichés par défaut, un filtre par colonne | bouton « Imprimer la liste » | oui (« Patient ») | éditeur, capture (198) |
| **Tableau de suivi tiers payant** | menu « Facturation » | colonnes « Date facture », « N° facture », « Bénéficiaire », « Total facturé (€) », « Solde AMO/AMC (€) », « Part AMO/AMC - État », « Solde patient (€) », « Organisme AMO », « Organisme AMC » (coupé sur la capture) ; quatre états : « En cours », « Facture payée », « Facture rejetée », « En anomalie » (une part payée en partie, un reste dû) | boutons « Détail du suivi », « Rechercher », « Imprimer la liste » | oui (« Bénéficiaire ») | éditeur, capture (183) |
| Suivi détaillé d'une facture | « Détail du suivi » | l'en-tête (numéro, date d'émission, NIR, bénéficiaire, flux FSE ou DRE, « Lot(s) », les deux organismes) ; la « Liste des RSP associés » : « Reçu le », « Date comptable », « Organisme payeur », « Part », « T », « Code tech. », « Payé », « Infos sur virement / rejet / régularisation » ; les types de retour : Paiement, Rejet, Régularisation, Paiement différé ; le tableau « Montant facturé et solde de la facture » : montant facturé, paiement NOEMIE, reste à payer, encaissé, irrécouvrable, à encaisser, par part (AMO, AMC, patient) | écran ; « Forçage NOEMIE » (irréversible) | oui | éditeur, capture (183) |
| **Rapport Noemie par lot** | menu « Télétransmission », bouton « rapport » (bouton « Noemie », « visualiser les retours par lot », onglets « Rapport noemie des lots de FSE » et « … de DRE ») | les paiements ou les rejets reçus pour un lot ; « synthétique » ; seulement les factures faites avec le logiciel ; ni aides, ni indus, ni régularisations | aperçu avant impression | colonnes : non trouvé | éditeur (057, 038, FAQ) |
| **Paiement Noemie par journée comptable** — le « bordereau des paiements » | menu « Télétransmission » (bouton « Noemie », « visualiser les retours par journée », bouton « bordereau ») | pour une journée et une caisse : le montant payé acte par acte, « avec un total par facture, par lot, par journée » ; plus les paiements de factures faites hors du logiciel, les aides, les indus, les régularisations ; « les mêmes informations » que le bordereau papier de la caisse | aperçu avant impression ; son format se règle dans « Outils - Options », onglet impression, « Format d'impression du bordereau des paiements » | colonnes : non trouvé (acte par acte : très probablement) | éditeur (057, 038) |
| Journal des règlements ; Liste détaillée des règlements | menu « Facturation » | les règlements saisis ou tirés des retours ; critères : la date, le compte, le mode de règlement | « imprimer » | le payeur | éditeur (038) ; éditeur, capture du menu (198) |
| Recettes pour Ciel Compta | menu « Facturation » | « Ces règlements pourront ensuite être exportés dans une comptabilité externe (ciel compta libérale par exemple) » | un export ; **format : non trouvé** | non trouvé | éditeur (055, 057) ; capture du menu (198) |
| Interrogation et relance de comptes | menu « Facturation » | le compte d'un patient, d'une caisse ou d'une complémentaire sur une période, « pour connaître les sommes dues » ; un relevé de compte | aperçu avant impression | selon le compte interrogé | éditeur (057) |
| **Statistiques** : « Chiffre d'affaires par caisse », « Chiffre d'affaires par organisme complémentaire » | menu « Outils », « Statistiques » | la part « caisse » (ou « complémentaire ») des factures, à la **date de la facture**, hors factures à l'état « saisies » | « Imprimer » ou « Exporter » ; la fenêtre d'export montre le type « PDF » (vu pour le bilan d'activité) | **non, par nature** ; colonnes : non trouvé ; si une facture sans tiers payant y compte : non trouvé | éditeur (158, 124) |
| **Requêtes** | menu « Outils », « Requêtes » | des requêtes livrées, d'autres ajoutables « au format SQL » ; l'éditeur : « nous pouvons, en fonction de vos besoins, vous assister dans la rédaction des requêtes » | « visualiser, imprimer ou exporter » ; « Différents formats sont disponibles dont Excel, dbase, html,… » | **ce que la requête choisit** : une requête de totaux n'en porte aucun | éditeur (155, avril 2025) |
| Clôture mensuelle, avoirs | « Outils », « Options », onglet « Compta » | un mois clos ne reçoit plus ni facture ni règlement ; une facture annulée laisse un avoir daté du jour | — | — | éditeur (154) |

**Ce qui n'a pas été trouvé**, et ne s'invente pas : les colonnes du bordereau de télétransmission, du « Journal des lots et
bordereaux », du « Rapport Noemie par lot », du « Paiement Noemie par journée comptable » et des statistiques par caisse ; si
un total de lot est imprimé au bas du bordereau ; un export CSV ou Excel d'un journal (seul « Imprimer la liste » est montré) ;
le format de « Recettes pour Ciel Compta » ; si l'aperçu avant impression enregistre un PDF porteur de texte ou une image ;
ce qu'un praticien obtient en « PDF » (l'export du logiciel, ou une imprimante PDF de Windows) ; la liste des requêtes
livrées ; le schéma de la base.

### 1.3 L'état sans nom de patient

Par ordre de préférence :

1. **Une requête sur mesure, exportée en Excel** (« Outils › Requêtes ») : des totaux par date de télétransmission, organisme
   et part, avec l'état de la part. Le fichier ne contient alors aucun patient **à la source** : c'est mieux qu'un PDF
   nominatif lu avec précaution. Il dépend de l'assistance de l'éditeur, que le praticien sollicite (BOR-Q3).
2. **« Chiffre d'affaires par caisse » et « … par organisme complémentaire »**, sur une période : sans patient, déjà dans le
   logiciel. Ils donnent le facturé, pas le reste dû ; leur forme est à voir (BOR0).
3. **Le « Journal des lots et bordereaux »**, s'il s'imprime et ne porte que des lots : à voir (BOR0).
4. À défaut, les états nominatifs — le bordereau de télétransmission, le tableau de suivi tiers payant — lus dans le
   navigateur, la colonne du nom jamais retenue (§ 5).

### 1.4 Les documents de l'éditeur lus

Tous sous `https://static.televitale.org/pdf/`, listés par `https://www.televitale.org/assistance/tutoriels-pdf-et-videos/` ;
la FAQ : `https://www.televitale.org/assistance/faq/`. Par numéro de tutoriel : 183 « Le suivi Tiers Payant – suivi des
factures » (juin 2025) ; 198 « Où sont mes factures – Les Factures dans tous leurs états » (mars 2025) ; 055 « Documentation
infirmier » (juin 2024) ; 057 « Documentation médecin et dentiste » (2017) ; 038 « support mk 2024 » (juin 2024) ; 035
« Rejet NOEMIE "Traitement Caisse" » ; 025 « Gestion des rejets FSE » ; 018 « Délai de Télétransmission » ; 125 « Lexique
SESAM VITALE » ; 154 « Les Avoirs et la Clôture Mensuelle » ; 155 « Les Requêtes » ; 158 « Les Statistiques » ; 124
« Calculer le CA sur une période – Le Bilan d'Activité » ; 145 « Prérequis Télévitale » ; 121 « Paramétrer la BAL FSE » ;
197 « Création d'une mutuelle en Gestion Unique » ; 007 et 013 « Annuler une facture transmise ». Les pages
`mentions-legales` du site et `journal.televitale.org` n'ont pas répondu (erreurs 500 et 503).

## 2. Le cadre commun (SESAM-Vitale)

| Notion | Ce qui est établi | Source | Confiance |
|---|---|---|---|
| **Le lot** | Les factures validées « doivent être regroupées en lot », avec la carte du professionnel, avant l'envoi ; des lots de FSE partent aux caisses, des lots de DRE aux complémentaires ; un fichier transmis porte un ou plusieurs lots et un destinataire ; quand toutes les factures d'un lot sont annulées, elles repartent « dans un nouveau numéro de lot » | manuels 055, 057, 038 ; tutoriel 198 | éditeur |
| Les critères du regroupement (un organisme, un mode de sécurisation…) | « un lot est identifié par sa date de création et l'organisme destinataire » | le cahier des charges de télétransmission d'un autre éditeur (https://www.agetip.fr/wp-content/uploads/2022/06/CDC-Télétransmission-AGETIP.pdf), rendu par un moteur de recherche, non relu | tiers |
| L'accusé de réception (ARL) | envoyé par la caisse sous 48 heures pour un lot de factures sécurisées ; jamais pour un lot de factures dégradées ; obligatoire pour un lot de DRE ; sans lui, le logiciel refait le lot à l'identique, puis le passe en « traitement manuel » (envoi postal). Un ARL positif dit la réception, pas le paiement | manuels 055, 038 ; tutoriel 198 | éditeur |
| Le retour NOEMIE (RSP : rejet, signalement, paiement) | envoyé « uniquement pour les factures en tiers payant » ; deux genres, le paiement et le rejet ; reçu dans la boîte aux lettres de télétransmission, que le logiciel relève à chaque envoi | manuels 055, 057 ; tutoriel 125 | éditeur |
| **La référence qui relie le retour à la facture** | le retour porte les numéros de lot et de facture (conception 53, § 2, ameli.fr) ; Télévitale range les retours par lot (« Rapport Noemie par lot ») et attache à chaque facture ses retours, chacun avec sa « Date comptable », son « Organisme payeur », sa « Part » et les « Infos sur virement / rejet / régularisation » | conception 53 ; tutoriel 183 | éditeur, capture |
| La date comptable d'un retour | c'est la date de journée comptable de la conception 53 — la clé des paiements gardés par NOE3 | tutoriel 183 ; manuel 057 (« par journée comptable ») | éditeur |
| **Le rejet** | « le refus de paiement de la caisse suite à une erreur sur la facturation » ; il porte sur une part : l'obligatoire peut être payée et la complémentaire rejetée, ou l'inverse ; la facture rejetée s'annule (elle repasse à « saisie » sous un **nouveau numéro**) puis se retransmet, seulement quand la caisse n'a pas pu la recycler | manuel 055 ; tutoriels 025, 183 | éditeur |
| « Traitement caisse » | un rejet de ce motif n'en est pas un : la caisse contrôle, « un second retour NOEMIE précisera alors le résultat » ; ne pas annuler, ne pas retransmettre | tutoriel 035, qui cite ameli.fr | éditeur |
| **Le paiement partiel** | une part payée pour moins que le facturé : Télévitale met la facture « En anomalie » et garde un reste dû ; une « régularisation » peut solder la part plus tard ; un « paiement différé » est un genre de retour à lui | tutoriel 183 | éditeur, capture |
| Le délai de transmission | trois jours ouvrés en cas de paiement direct de l'assuré, huit jours ouvrés en cas de dispense d'avance de frais | CSS, art. R. 161-47 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006746783) ; tutoriel 018 | texte (extraits rendus par le moteur de recherche) |
| **Le paiement garanti** | « le paiement de la part prise en charge par l'assurance maladie est garanti » quand le professionnel utilise le moyen d'identification électronique de l'assuré ; un délai fixé par décret ; une pénalité ; les délais publiés ; l'organisme fournit « les informations nécessaires au suivi du paiement de chaque acte ou consultation » | CSS, art. L. 161-36-3, version en vigueur depuis le 27/06/2026 (loi n° 2026-534 du 25/06/2026, art. 78) — https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000054337006 | texte |
| **Le délai de paiement** | « fixé à sept jours ouvrés » quand la facture est transmise selon l'article L. 161-35 (la feuille de soins électronique) | CSS, art. D. 161-13-3 (décret n° 2016-1069 du 3 août 2016) — https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006172105 | texte |
| La pénalité | « une pénalité forfaitaire de 1 € » par facture payée le huitième ou le neuvième jour ouvré ; 10 % de la part prise en charge à partir du dixième ; versées au semestre suivant | CSS, art. D. 161-13-4 (même page) | texte |
| Les délais publiés ; le délai dérogatoire | publiés chaque trimestre par organisme et par profession (D. 161-13-5) ; jusqu'à trente jours ouvrés pour un professionnel sanctionné pour fraude (D. 161-13-6) | même page ; https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048841845 | texte |
| Le point de départ des sept jours ; le sort d'une facture en mode dégradé | — | non lu : à relire sur Légifrance avant BOR5 |
| Un délai pour la part complémentaire | — | non trouvé (les conventions de chaque organisme) |
| Gestion unique et gestion séparée | en gestion unique, la caisse fait suivre son décompte à la complémentaire, qui paie sa part ; sans liaison, une DRE part à la complémentaire | tutoriels 197, 125 | éditeur |

**Deux sources écartées, et pourquoi**. Le cahier des charges du GIE SESAM-Vitale sur la transmission des retours (réf.
OCT-CDC-004, version 2.08, avril 2016, `sesam-vitale.fr`) est public, mais sa page 2 soumet « toute représentation ou
reproduction (intégrale ou partielle) » au consentement du GIE et son pied de page interdit sa diffusion sans autorisation :
seuls son titre et cette mention en ont été lus ; son sommaire annonce des « critères de regroupement du fichier de lots de
FSE », qui ne sont donc pas établis ici. Les pages d'ameli.fr refusent toujours la lecture automatique (403) ; rien n'a été
contourné : ce que la conception 53 en tient reste « à relire à la main ».

## 3. Les autres logiciels (sans creuser)

| Logiciel | Ce qui est su | Confiance |
|---|---|---|
| Albus (infirmiers) et Topaze (kinésithérapeutes) | du même groupe que Télévitale (le site les présente ensemble) ; leurs états de suivi : non trouvé | éditeur ; non trouvé |
| Vega (infirmiers, kinésithérapeutes, orthophonistes, orthoptistes ; CompuGroup Medical) | l'éditeur vend des formations « Suivre ses remboursements et se faire payer » et « Traiter ses paiements et récupérer ses indus » (un tableau de bord des impayés, les retours NOEMIE en attente) ; un export : non trouvé | tiers (programmes de formation, rendus par le moteur de recherche) |
| Agathe (infirmiers ; CBA) | l'éditeur décrit le retour par facture et par part (conception 53, § 2) ; un état par organisme ou un export : non trouvé | éditeur ; non trouvé |
| AxiSanté (médecins ; CompuGroup Medical) | le module de facturation exporte les paiements : « Export CSV ou Export vers AxiCompta » (conception 53, § 2) | tiers |
| Les logiciels d'officine (hors de la cible, cités pour la forme de l'état) | un « Calcul des Impayés » du suivi tiers payant sort une « liste détaillée » et une « liste générale par organisme », à l'impression (https://intercom.help/smart-rx/fr/articles/4322716-lister-les-factures-tiers-payant-non-reglees) | éditeur (d'un autre logiciel) |
| Tous les logiciels agréés | le « suivi des factures en tiers payant » (payée, rejetée, en attente, par part) est une fonction attendue d'un logiciel à jour (conception 53, § 2, ameli.fr) | à relire à la main |

**Ce qu'on en retient** : l'état « reste dû par facture et par part » existe partout, sous une forme propre à chaque éditeur ;
un état agrégé par organisme existe chez certains ; un export tabulaire, pas toujours. La lecture doit donc être **un gabarit
par état et par logiciel**, dans une liste fermée, et non un lecteur universel.

## 4. Ce que l'application garderait — et ce qu'elle ne lirait ni ne garderait

### 4.1 Deux objets, pas un

- **Le facturé** (un flux) : ce qui a été télétransmis en tiers payant, par jour de télétransmission.
- **Le reste dû** (une photographie) : à une date de situation, ce que les organismes n'ont pas encore payé, par ancienneté.
  C'est lui qui répond à « ce qu'elle doit payer » ; il vient du suivi tiers payant, où le logiciel du praticien a déjà
  rapproché facture par facture — ce que cette application ne peut ni ne doit refaire.

### 4.2 Les colonnes, et aucune autre

**Le facturé**, agrégat de toutes les parts facturées sous une même clé :

| Colonne | Type | Pourquoi |
|---|---|---|
| `date_de_teletransmission` | date | l'origine du délai de paiement ; à défaut, la date de la facture, et l'import dit laquelle (une liste fermée) |
| `regime`, `caisse` | deux entiers, nuls pour la part complémentaire (BOR-Q5) | l'organisme, sous la forme même des paiements de NOE3 : c'est la clé commune au dû et au payé |
| `part` | liste fermée : `obligatoire`, `complementaire` | les deux chaînes de paiement |
| `montant_centimes` | entier (négatif pour un avoir) | le facturé en tiers payant de la part |
| `nombre_de_factures` | entier ≥ 0 | un ordre de grandeur |

**Le reste dû**, par date de situation :

| Colonne | Type | Pourquoi |
|---|---|---|
| `date_de_situation` | date | le jour où l'état a été sorti du logiciel — lue dans le fichier, sinon saisie ; jamais l'horloge |
| `regime`, `caisse`, `part` | comme ci-dessus | |
| `etat` | liste fermée : `en_attente`, `rejete`, `paye_en_partie` | les trois façons de n'être pas payé (les quatre états du § 1.2, moins « payée ») |
| `tranche` | liste fermée d'anciennetés (§ 6.3) | calculée dans le navigateur, de la date de facture à la date de situation |
| `montant_centimes`, `nombre_de_factures` | entiers | le solde restant, jamais le détail |

Par import : son genre (facturé ou reste dû), sa période ou sa date de situation, le gabarit qui l'a lu (une liste fermée),
ses comptes, l'auteur et l'instant posés par la base.

### 4.3 Ce qui n'est jamais lu, ou lu et jamais gardé

- **Jamais retenu d'une ligne** : le nom du bénéficiaire ou de l'assuré, le NIR, la date de naissance et le rang, le
  prescripteur, les actes et leurs cotations, les dates de soins, le libellé ou le code d'un rejet, le libellé d'un virement.
- **Ni le numéro d'une facture, ni celui d'un lot, ni leur empreinte** : la règle de la conception 53 (§ 3) — dans le logiciel
  du praticien, une facture désigne un patient et un lot un ensemble de factures ; gardés ici, ils seraient des pseudonymes
  (RGPD, art. 4, 5°). Le rapprochement par lot en devient impossible (§ 6.1) : c'est le prix de cette règle, et BOR-Q4 le
  redit au cabinet.
- **Ni le fichier, ni son nom, ni son empreinte, ni une image de ses pages** : pas de stockage, pas d'Edge Function, pas de
  Textract, pas de journal, pas le modèle de l'assistant.
- **Aucun texte** : ni les tables ni la fonction d'import n'en acceptent.

**Ce que la base apprendrait de plus qu'avec NOE3** : un facturé pas encore payé. Un agrégat d'une seule facture est le
montant d'un acte fait à une personne que la base ne connaît pas et que seul le logiciel du praticien peut retrouver ; NOE3 a
admis ce cas pour le payé (le crédit du relevé le dit déjà). Pour le facturé, rien d'autre en base ne le dit : le grain se
choisit en connaissance de cause (BOR-Q4 : le jour, ou le mois).

## 5. La lecture d'un PDF sans qu'un nom sorte du navigateur

### 5.1 Trois étages, chacun gardé

1. **Les fragments** (`lib/pdfText.ts` existe ; à côté d'`extractPdfLignes`, une fonction qui rend chaque fragment avec sa
   page et sa position, pas seulement l'abscisse du dernier). pdf.js reçoit des **octets** (`getDocument({ data })`), jamais
   une adresse ; son ouvrier est servi par l'application (`?url`), comme aujourd'hui. Un garde lit le texte du module : aucun
   `url`, aucun `fetch`, aucune adresse de police ou de table de caractères distante.
2. **Le module pur** (`lib/factureAssuranceMaladie.ts`, sur le patron de `lib/paiementsAssuranceMaladie.ts`) : des fragments
   aux agrégats, par un gabarit ; ni `supabase`, ni réseau, ni stockage, ni `console`, ni horloge (la date de situation est un
   paramètre). Le scanner `paiementsAssuranceMaladieSansSortie.test.ts` s'étend à lui : la même liste de sorties, la même
   liste d'imports permis, les mêmes trois défauts plantés ; et les nouvelles tables entrent dans son second relevé (aucun
   moteur ne les lit : le facturé n'est pas une recette).
3. **La base** : aucune colonne de texte, une fonction d'import qui refuse toute clé hors de sa liste — un navigateur fautif
   n'y ferait rien entrer.

### 5.2 La liste blanche des genres

Le module ne retient d'une cellule que ce qui s'analyse en **date**, en **montant**, en **organisme** ou en **état** ; le
reste n'est jamais copié dans une valeur rendue, pas même pour une erreur (une erreur dit la page, la ligne et la raison).
Un NIR, une date de naissance et un numéro de facture sont pourtant faits de chiffres : chaque genre porte donc ses bornes.

- un montant : la forme décimale à deux chiffres après la virgule, et un plafond par facture — un NIR n'a pas cette forme ;
- une date : dans la période que l'import déclare, jamais à venir — une date de naissance en est loin ;
- un organisme : la forme imprimée par le logiciel (régime, caisse, centre, séparés : « 01.349.9881 » sur les captures), le
  régime dans la liste des régimes — un numéro de lot à trois chiffres n'a pas cette forme ;
- un état : un mot d'une liste fermée, rendu sous une valeur de l'application, jamais recopié.

Le type de ce que rend le module n'a **aucun champ de texte libre** : des dates, des entiers, des unions littérales. Le test
du **canari** le prouve sur des fragments fabriqués, aux noms et aux numéros manifestement faux : sérialisée, la sortie ne
contient aucune sous-chaîne d'aucune cellule qui n'est ni date, ni montant, ni organisme ; rejoué sur une batterie tirée d'une
graine (`tirage`).

### 5.3 Un gabarit par état, fermé

Un PDF n'a pas d'en-têtes sûrs comme un CSV : le réglage des colonnes de NOE4, à l'aveugle, ferait deviner. À sa place, **un
gabarit par état et par logiciel**, écrit sur la page que le cabinet aura fournie (BOR0) :

- il reconnaît son état à ses **ancres** — les intitulés imprimés (le titre de l'état, les en-têtes de colonnes) — et place
  les colonnes à leur abscisse ; une ancre absente ou déplacée : « mise en page non reconnue », rien n'est lu ;
- il **confronte ses lignes au total que l'état imprime**, quand il en imprime un (à voir en BOR0) : une somme qui diffère
  refuse l'import — le même principe que le contrôle de solde d'un relevé. Sans total imprimé, l'écran dit que rien ne
  confirme la lecture, et le cabinet compare lui-même le total montré à celui de son logiciel ;
- une ligne qui ne se lit pas s'écarte et se **compte**, avec sa raison, jamais sa valeur ; au-delà d'un seuil, tout est
  refusé.

### 5.4 Ce que l'écran montre

Le genre de l'état reconnu, la période, les agrégats avant le clic, le nombre de lignes écartées et leurs raisons ; jamais une
ligne du fichier ni une image de sa page. La confirmation nomme ce qui part (N totaux, sans nom ni numéro) et ce qui reste
dans le fichier. Comme pour NOEMIE, rien ne s'importe seul.

## 6. Le rapprochement « dû contre payé »

### 6.1 Pas par lot, pas par jour : par organisme et par part

- **Par lot** : il faudrait le numéro de lot des deux côtés ; NOE3 ne le garde pas, et ce qui précède non plus. Écarté, sauf
  décision contraire (BOR-Q4, option C, qui rouvre la conception 53).
- **Par jour** : un lot télétransmis le lundi est payé sous une journée comptable de la fin de semaine, parfois en plusieurs
  fois (une part rejetée, un paiement partiel, une régularisation) : aucun jour ne répond à un autre.
- **Par organisme et par part, en compte courant** : pour chaque caisse et chaque part, le facturé cumulé, le payé cumulé
  (les paiements de NOE3, la part `forfait` exclue : un forfait ne paie aucune facture), et leur différence.

### 6.2 Deux niveaux

**Niveau 1 — le reste dû estimé** (le facturé et NOEMIE seuls). Par organisme et par part : le facturé de la période, moins
les paiements dont la journée comptable suit ; les paiements s'imputent aux jours facturés les plus anciens d'abord, ce qui
date le plus ancien jour non couvert. C'est une **estimation**, et l'écran le dit : les rejets ne sont connus que par import
(NOE-Q4), les paiements d'une période règlent aussi des factures d'avant elle, une facture annulée repart sous un autre
numéro et un autre jour, une facture faite hors du logiciel est payée sans avoir été facturée ici. Le mot « impayé » ne
s'écrit pas à ce niveau : « à vérifier dans ton logiciel de télétransmission ».

**Niveau 2 — le reste dû lu** (la photographie du suivi tiers payant). Le solde et son ancienneté sont ceux du logiciel du
praticien : lus, jamais calculés — la règle du solde d'un relevé dans « Ma banque ». Le niveau 1 devient un **contrôle de
bouclage**, par organisme et par part, entre deux photographies : le reste dû d'avant, plus le facturé, moins le payé, contre
le reste dû d'après ; l'écart (des rejets soldés, des irrécouvrables, un « Forçage NOEMIE », des factures hors logiciel) se
dit en attention, jamais en erreur.

Recommandé : le niveau 2 dès que l'état se lit (BOR-Q6) ; le niveau 1 seul tant qu'il ne se lit pas, sous son nom.

### 6.3 Ce qui reste impayé, par ancienneté

Pour la part obligatoire d'une feuille de soins électronique, le droit donne la première borne : **sept jours ouvrés**
(D. 161-13-3). Les tranches proposées : dans le délai (sept jours ouvrés au plus) ; de huit jours ouvrés à trente jours ; de
trente et un à quatre-vingt-dix jours ; au-delà. Les jours ouvrés se comptent sur le calendrier que l'application tient déjà
(`lib/echeancesFiscales.ts`, les onze jours fériés). Pour la part complémentaire, aucun délai n'est établi : les mêmes
tranches en jours civils, sans le mot « retard ». Un rejet a sa propre ligne : il ne vieillit pas, il attend une correction.
La pénalité de D. 161-13-4 **se dit, elle ne se calcule pas** (le point de départ du délai n'est pas lu, et la caisse la
verse d'elle-même au semestre suivant).

### 6.4 Où cela se montre, et ce que cela ne touche pas

- Une section « Facturé à l'assurance maladie » à côté de la section NOEMIE de l'onglet Banque et de « Ma banque » : par
  organisme et par part, le facturé, le payé, le reste dû, par tranche ; muette sur une lecture partielle, jamais 0.
- Des points d'attention avec ceux de NOE6 : un reste dû ancien, un écart de bouclage, une période facturée sans paiement
  importé (ou l'inverse). Jamais bloquants.
- **Aucun moteur** : ni la 2035 (un BNC en trésorerie compte la recette à l'encaissement), ni la CA3, ni l'estimation, ni
  l'alerte du chiffre d'affaires, ni le FEC. En engagement, ce facturé serait une créance : hors de ce chantier, et dit.
- Le SNIR reste saisi par le cabinet (DSAV) ; la comparaison avec lui reste écartée (NOE-E1).

## 7. Les risques

- **Une mise en page qui change** (une mise à jour du logiciel, un autre format d'impression — Télévitale en règle un pour le
  bordereau des paiements) : le gabarit refuse, il n'approxime pas ; le total imprimé, quand il existe, confirme ; un gabarit
  porte sa version et la date de la page qui l'a fondé.
- **Un PDF sans texte** (imprimé puis numérisé, ou enregistré en image) : pdf.js n'y lit aucun fragment ; l'import refuse et
  le dit. Pas de reconnaissance de caractères : elle sortirait du navigateur (Textract), et l'OCR local est écarté depuis le
  21/09/2026.
- **Un nom dans une ligne lue** : la liste blanche et le canari (§ 5.2) ; une ligne à deux étages (un nom long qui déborde)
  s'écarte et se compte, elle ne décale pas les colonnes.
- **Le fichier en main du cabinet** : RGPD.md § 8.7 dit que le praticien ne transmet pas ses bordereaux à son cabinet. Un état
  sans patient lève la difficulté ; un état nominatif ne devrait se lire que dans le navigateur du praticien (BOR-Q8).
- **Le dépôt accidentel** : un PDF est le format ordinaire d'une pièce ; un bordereau déposé dans « Mes pièces » part au
  stockage et à la lecture (Textract), où `extract-piece` le reconnaît déjà à son titre. Cet écran en augmente l'occasion
  (BOR-Q9, dans la suite de NOE-Q6).
- **Deux lots d'un même jour pour une même caisse** : sans numéro de lot, ils tombent sur la même clé ; un import porte donc
  des **journées entières** (une période déclarée, close), et une clé déjà en base sous un autre montant se refuse et se dit,
  comme dans NOE3 — on retire l'import et on le refait.
- **Le doublement d'une recette** si un moteur lisait ces tables : le second relevé du scanner (§ 5.1).
- **Le payé lui-même** : sans export CSV des retours chez Télévitale, NOE1 dépend du même travail (§ 8, BOR0).
- **Le retour arrière** : une migration additive, dont le retour retire les tables et se refuse tant qu'elles portent une
  ligne.

## 8. Les lots

| Lot | Ce qu'il fait | Préalable |
|---|---|---|
| BOR0 | **Une page montrée le 18/11/2026, le reste à recevoir (§ 12).** Sans code : recevoir du cabinet les pièces du § 9 ; savoir lequel des deux « bordereaux » il a (BOR-Q1) ; essayer « Outils › Requêtes » et les deux statistiques par caisse ; relire sur Légifrance le point de départ des sept jours. **Sert aussi NOE1** : la forme du payé chez Télévitale | — |
| BOR1 | **Fait le 18/11/2026 pour le bordereau de télétransmission (§ 12.2)**, dans deux modules à lui plutôt que dans `lib/pdfText.ts`. Le plan d'origine : `lib/pdfText.ts` : les fragments positionnés ; un module pur qui en fait un tableau par ancres (lignes, colonnes par abscisse), testé sans pdf.js ; le garde « des octets, jamais une adresse » | — |
| BOR2 | `lib/factureAssuranceMaladie.ts`, pur : la liste fermée des gabarits (un par état reçu en BOR0), la liste blanche des genres et leurs bornes, le total confronté, les agrégats, les refus ; des fichiers d'essai **fabriqués** ; le scanner « sans sortie » étendu ; le canari | BOR0, BOR1, BOR-Q2 |
| BOR3 | La migration préparée, par l'outil, derrière un drapeau baissé : les tables d'agrégats sans texte, l'import tout ou rien et son retrait, la RLS (le cabinet ; le client « Banque » selon BOR-Q8), la restrictive `deux_facteurs` sous condition, l'essai SQL, le plan de sauvegarde derrière le drapeau | BOR-Q4, Q5, Q8 |
| BOR4 | L'écran d'import, dans la section NOEMIE : le fichier qui ne part nulle part, l'état reconnu ou refusé, les agrégats avant le clic, la confirmation | BOR2, BOR3 |
| BOR5 | `lib/duContrePaye.ts`, pur : le compte par organisme et par part, le reste dû lu ou estimé, les tranches, le bouclage ; muet sur une lecture partielle ; la section « Facturé à l'assurance maladie » | BOR3, NOE3 en production, BOR-Q6 |
| BOR6 | Les points d'attention (avec NOE6) ; le refus d'un bordereau au dépôt et à la réception par e-mail (avec NOE7) | BOR5, BOR-Q9 |
| BOR7 | La mise en production : la migration, le drapeau levé, les essais, les trois contrôles de l'export | tout |

**Ce tableau est celui d'origine ; le plan remis à jour sur les réponses du cabinet du 18/11/2026 est au § 13.5** (et le § 4.3,
pour le numéro du lot, se lit avec les § 13.3 et 14 : une empreinte à clé secrète, jamais le numéro).

Si BOR-Q1 répond « le bordereau des paiements » : ce PDF est du **payé**, et il nourrit NOE (un gabarit PDF dans
`lib/paiementsAssuranceMaladie.ts`, qui ne lit aujourd'hui qu'un CSV) avant de nourrir BOR. BOR1 sert aux deux.

## 9. Ce qu'il faut demander au cabinet

Rien de ce qui suit n'entre au dépôt (public) ni dans la conversation avec un nom lisible : des pages **rendues anonymes**
(les noms, les numéros de sécurité sociale, les dates de naissance et les numéros de facture masqués ; les intitulés, les
organismes et les montants laissés), ou des captures d'écran sur un patient d'essai.

1. **Une page de son bordereau PDF**, rendue anonyme — et son titre exact : « bordereau de télétransmission » (par lot) ou
   bordereau des paiements (« Paiement Noemie par journée comptable ») ?
2. **Comment il l'obtient en PDF** : un bouton du logiciel, ou une imprimante PDF de Windows ? Le texte s'y sélectionne-t-il à
   la souris (sinon c'est une image, que rien ne lira) ?
3. **Une capture de l'écran « Journal des lots et bordereaux »** (menu Télétransmission) : ses colonnes, et s'il s'imprime.
4. **Une capture du « Tableau de suivi tiers payant »** (menu Facturation) et une page de son « Imprimer la liste ».
5. **Le résultat de « Outils › Statistiques › Chiffre d'affaires par caisse »** sur un mois (il ne porte pas de patient), et
   la liste de ce que propose **« Outils › Requêtes »**, avec les formats du bouton « Exporter ».
6. **La version de son Télévitale** (le « ? » ou le titre de la fenêtre), et sa profession (l'écran d'accueil ou le tableau
   de bord).

## 10. Points non vérifiés

- Tout ce que le § 1.2 marque « non trouvé ».
- Les intitulés lus sur des captures datent de 2019 à 2025 ; la version du cabinet peut différer.
- Les articles R. 161-47 et D. 161-13-3 à D. 161-13-5 ont été lus par extraits (Légifrance, page de section, le
  17/11/2026) : à relire en entier avant d'écrire une tranche dans le code.
- Comment NOE3 range le paiement d'un organisme complémentaire : `lib/paiementsAssuranceMaladie.ts` borne `regime` à deux
  chiffres et `caisse` à trois, ou les laisse nuls ; le numéro d'une complémentaire (dix chiffres sur les captures) n'y tient
  pas. Qu'il y soit bien rangé sous deux nuls sur un fichier réel reste à voir avant BOR3 (BOR-Q5).
- Les pages d'ameli.fr (403) et le cahier du GIE (droits réservés) : non exploités.

## 11. Les questions au cabinet

```json
[
  {
    "id": "BOR-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Quel « bordereau » as-tu en PDF ?",
    "question": "Le bordereau que tu reçois en PDF est-il le bordereau de télétransmission (la liste des factures envoyées, un par lot) ou le bordereau des paiements (« Paiement Noemie par journée comptable ») ?",
    "contexte": "Dans Télévitale, le mot désigne deux états : le bordereau de télétransmission, imprimé pour chaque lot et réimprimable depuis « Télétransmission › Journal des lots et bordereaux », dit ce qui est FACTURÉ ; le bordereau des paiements, sorti de « Paiement Noemie par journée comptable », dit ce qui est PAYÉ. Le second nourrirait l'import NOEMIE (qui attend toujours la forme du fichier de Télévitale), pas le facturé. Aucun des deux n'a ses colonnes publiées.",
    "recommandation": "(C) : une page rendue anonyme de chacun des deux, avec son titre exact et la façon dont tu l'obtiens en PDF — les noms, numéros de sécurité sociale, dates de naissance et numéros de facture masqués, les intitulés et les montants laissés.",
    "options": ["(A) Le bordereau de télétransmission, par lot", "(B) Le bordereau des paiements, par journée comptable", "(C) Les deux : une page rendue anonyme de chacun", "(D) Je ne sais pas : une capture de l'écran d'où je le sors"],
    "option_recommandee": "C",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 1.2 et § 9",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q2",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "D'où tirer le facturé ?",
    "question": "Quel état de Télévitale lire pour savoir ce qui a été facturé à l'assurance maladie et ce qui reste dû ?",
    "contexte": "Le bordereau de télétransmission et le « Tableau de suivi tiers payant » portent le nom des patients ; ils se liraient dans le navigateur, le nom jamais retenu. Des états sans patient existent : « Outils › Statistiques › Chiffre d'affaires par caisse » et « … par organisme complémentaire », une requête de « Outils › Requêtes » exportée en Excel, peut-être le « Journal des lots et bordereaux ». Seul le suivi tiers payant donne le reste dû exact, facture soldée par facture soldée.",
    "recommandation": "(D) : un état sans patient pour le facturé dès qu'un tel état suffit, et le tableau de suivi tiers payant pour le reste dû ; le bordereau de télétransmission seulement si rien d'autre ne se lit.",
    "options": ["(A) Un état sans patient seulement (statistique par caisse, journal des lots, requête)", "(B) Le bordereau de télétransmission PDF, lu dans le navigateur", "(C) Le tableau de suivi tiers payant imprimé en PDF, lu dans le navigateur", "(D) Un état sans patient pour le facturé, le suivi tiers payant pour le reste dû"],
    "option_recommandee": "D",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 1.3 et § 4.1",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q3",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Demander une requête sans patient à l'éditeur",
    "question": "Le praticien demande-t-il à l'assistance de Télévitale une requête de totaux, sans patient, exportable en Excel ?",
    "contexte": "Le tutoriel « Les Requêtes » de l'éditeur (avril 2025) dit que « Outils › Requêtes » exécute des requêtes SQL, que leur résultat s'exporte (« Excel, dbase, html,… ») et que l'éditeur peut assister leur rédaction. Une requête qui rend, par date de télétransmission, organisme et part, le montant facturé, le montant payé et le reste dû ne contiendrait aucun patient : le fichier serait sans donnée de santé à la source, et pourrait même être remis au cabinet.",
    "recommandation": "(A) : oui — c'est la seule voie où le fichier lui-même ne porte aucun patient ; le PDF nominatif reste la voie de repli.",
    "options": ["(A) Oui, le praticien la demande à l'assistance de l'éditeur", "(B) Non, on s'en tient aux états que le logiciel a déjà"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 1.3",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q4",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Le grain du facturé gardé",
    "question": "Le facturé se garde-t-il par jour de télétransmission, par mois, ou avec le numéro de lot ?",
    "contexte": "Les paiements NOEMIE sont gardés par journée comptable, organisme et part, sans numéro de lot ni de facture (conception 53, § 3 : ce sont des pseudonymes). Sans numéro de lot, le rapprochement par lot est impossible : il se fait par organisme et par part. Le jour permet de dater le plus ancien facturé non payé quand le reste dû n'est pas lu ; le mois suffit quand il l'est, et en dit moins. Un total d'un jour où une seule facture est partie est le montant d'un acte, sans personne nommée.",
    "recommandation": "(A) : le jour de télétransmission, l'organisme et la part, sans numéro de lot — le grain déjà retenu pour les paiements.",
    "options": ["(A) Par jour de télétransmission, organisme et part, sans numéro de lot", "(B) Par mois, organisme et part", "(C) Avec le numéro de lot, des deux côtés : revient sur la conception 53 et sur la migration préparée de NOE3"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 4.2, § 4.3 et § 6.1",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q5",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "La part complémentaire : par mutuelle ou en un total",
    "question": "Ce que les complémentaires doivent se garde-t-il par organisme complémentaire, ou en un seul total ?",
    "contexte": "Pour la part obligatoire, l'organisme est une caisse (un régime et un numéro de caisse), comme dans les paiements NOEMIE gardés. Pour la part complémentaire en gestion séparée, le payeur est une mutuelle, identifiée par son numéro. Savoir quelle mutuelle doit est utile, mais la mutuelle d'un patient en dit plus sur lui qu'une caisse, et les paiements gardés aujourd'hui n'ont que deux entiers, le régime et la caisse.",
    "recommandation": "(A) : un seul total « complémentaires » — le détail par mutuelle reste dans le logiciel du praticien ; (B) toucherait aussi la table des paiements de NOE3.",
    "options": ["(A) Un seul total pour toutes les complémentaires", "(B) Par organisme complémentaire, sous son numéro, pour le facturé comme pour le payé"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 4.2",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q6",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Le reste dû : lu ou calculé",
    "question": "Ce que l'assurance maladie doit encore se lit-il dans le suivi tiers payant du logiciel, ou se calcule-t-il (facturé moins payé) ?",
    "contexte": "Le logiciel du praticien rapproche chaque paiement de sa facture ; l'application ne garde ni facture ni lot et ne peut que soustraire des totaux. Le calcul est faussé par les rejets, les factures annulées et refaites, les paiements de factures plus anciennes ou faites hors du logiciel. La règle de l'application pour un solde de banque est la même : il se lit au relevé, il ne se calcule pas.",
    "recommandation": "(A) : lu quand l'état se lit, et le calcul sert de contrôle ; calculé sinon, et dit « estimé », sans le mot « impayé ».",
    "options": ["(A) Lu quand l'état existe, estimé sinon et dit comme tel", "(B) Toujours calculé", "(C) Lu seulement : rien tant que l'état ne se lit pas"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 6.2",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q7",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Au MVP ou après",
    "question": "Le facturé à l'assurance maladie entre-t-il au MVP ?",
    "contexte": "L'import NOEMIE (le payé) est au MVP en entier (NOE-Q5) et attend encore la forme du fichier de Télévitale, qui ne documente aucun export CSV des retours : il faudra sans doute lire un PDF ou une requête pour lui aussi. La 2035 de 2026 ne dépend ni du payé ni du facturé : les recettes viennent des crédits du relevé. Recevoir les pièces du § 9 ne coûte aucun code et sert les deux chantiers.",
    "recommandation": "(A) : BOR0 tout de suite (les pièces à recevoir, qui débloquent aussi NOE1), le reste après le MVP.",
    "options": ["(A) BOR0 tout de suite, le reste après le MVP", "(B) Au MVP, en entier", "(C) Rien avant la fin du MVP, pas même BOR0"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 8",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q8",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Qui lit un état qui porte des patients",
    "question": "Un état nominatif (le bordereau, le suivi tiers payant) se lit-il dans le navigateur du praticien seul, ou aussi dans celui du cabinet ?",
    "contexte": "RGPD.md § 8.7 : le praticien ne transmet pas ses bordereaux de télétransmission à son cabinet (secret professionnel). Pour NOEMIE, le cabinet a choisi « le praticien et le cabinet » (NOE-Q1). Ici le document est le bordereau même que le § 8.7 nomme : pour que le cabinet l'importe, il faut qu'il l'ait reçu. Un état sans patient (BOR-Q2, BOR-Q3) ne pose pas la question : il peut être lu par les deux.",
    "recommandation": "(B) : un état nominatif ne se lit que dans l'espace du praticien, sous « Banque » ; un état sans patient, par les deux.",
    "options": ["(A) Le praticien et le cabinet, comme NOEMIE", "(B) Un état nominatif : le praticien seul ; un état sans patient : les deux", "(C) Le praticien seul, quel que soit l'état"],
    "option_recommandee": "B",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 7",
    "pose": "2026-11-17"
  },
  {
    "id": "BOR-Q9",
    "chantier": "Facturé à l'assurance maladie (conception 59)",
    "titre": "Un bordereau déposé par erreur dans les pièces",
    "question": "Refuser au dépôt, et écarter à la réception par e-mail, un PDF reconnu comme un bordereau de télétransmission ?",
    "contexte": "Un PDF est le format ordinaire d'une pièce : un bordereau déposé dans « Mes pièces » ou envoyé à l'adresse de collecte part au stockage et à la lecture (Textract), où il est déjà reconnu à son titre et rangé en recette. Le 24/09/2026 le cabinet a décidé de ne rien changer au code (RGPD.md § 8.7) ; le 16/11/2026 il a décidé de refuser et d'écarter un retour NOEMIE (NOE-Q6). Un écran qui invite à manipuler ses bordereaux augmente l'occasion de l'erreur.",
    "recommandation": "(A) : la même règle que NOE-Q6 — refusé dans le navigateur avant tout envoi, écarté à la réception sous la raison « format » —, une fois la forme du bordereau connue (BOR0).",
    "options": ["(A) Refuser au dépôt et écarter à la réception, comme un retour NOEMIE", "(B) Refuser au dépôt seulement", "(C) Ne rien changer (la décision du 24/09/2026)"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 7",
    "pose": "2026-11-17"
  }
]
```

## 12. BOR0 : ce que la page réelle a montré (18/11/2026)

Le 18/11/2026, le cabinet a montré **une page réelle** d'un bordereau de Télévitale. Elle est restée hors du dépôt, et rien
de ce qui suit n'en recopie une valeur : seule sa **forme** est décrite.

### 12.1 La forme

- Le PDF porte une **couche de texte** (le texte s'y sélectionne) : pdf.js le lit, aucun OCR n'est nécessaire (§ 9, point 2).
- Le titre, centré : « Bordereau de Teletransmission » (sans accents). C'est donc l'état **par lot** du § 1.2 : le **facturé**.
- L'en-tête, une ligne par champ : l'identité du praticien suivie de son numéro d'assurance maladie (deux chiffres, un chiffre, cinq chiffres, une barre et une clé) ;
  « Lot : N créé le JJ/MM/AAAA » ; « LOT NON SECURISE » (ou sécurisé) ; « Organisme assurance maladie destinataire : NNN -
  CPAM - VILLE » (un code de trois chiffres, puis un libellé) ; « Destinataire du réglement : Partenaire de santé » ; puis
  le nom et l'adresse de la caisse.
- Un tableau à neuf colonnes : « Facture | Date prescription | Numéro Assuré | Nom Bénéficiaire | Naissance | Total | Caisse |
  Mutuelle | Assuré », une ligne par facture (un numéro de facture à neuf chiffres, des montants à la française : « 12,34 »,
  « 1 234,56 »).
- Une ligne de total : « TOTAL: LOT de N Factures » suivie de quatre montants (total, caisse, mutuelle, assuré).
- Le pied : la date d'impression, « 1/1 », « Réalisé par Televitale ».

### 12.2 BOR1 : ce qui en est lu

- `lib/bordereauDeTeletransmission.ts`, pur et sans sortie : du texte des pages (des lignes, ou des fragments positionnés
  regroupés par ordonnée), il rend, **par bordereau**, le numéro du lot, sa date de création, sécurisé ou non, le code et le
  libellé de l'organisme (borné à des lettres, espaces, tirets, apostrophes et points), le destinataire du règlement (une liste
  fermée d'une valeur, la seule vue), le nombre de factures annoncé et les quatre totaux en centimes. Chaque ligne de facture
  est **comptée** et ses quatre montants **additionnés** ; rien d'autre n'en est analysé ni rendu, et une raison de refus ne
  cite que le rang du bordereau, la page et le rang d'une ligne.
- Il refuse, tout entier : le titre absent, un en-tête illisible ou absent, l'en-tête des colonnes non reconnu, une ligne du
  tableau qui n'est ni une facture ni le total ni le pied, le total absent, un compte de lignes différent du nombre annoncé,
  une colonne dont la somme diffère du total imprimé, un total différent de caisse + mutuelle + assuré (sur la ligne de total
  **et** sur chaque ligne), le même lot deux fois.
- **Plusieurs lots dans un fichier** : un bordereau rendu par lot, chacun contrôlé par son propre total, un seul refusé
  refusant le fichier. Refuser le fichier entier n'ajoutait aucune sûreté (chaque bordereau porte sa preuve) et aurait obligé
  à imprimer les lots un par un.
- **Un bordereau sur plusieurs pages** : le total en dernière page ; une page qui suit, avec ou sans le titre et les
  en-têtes repris, continue le même lot, ses en-têtes confrontés à la première page.
- `lib/bordereauDeTeletransmissionLecture.ts` ouvre le fichier par pdf.js, sur des octets (jamais une adresse, ni polices,
  ni tables, ni wasm distants), ne rejette jamais et ne cite jamais le message de pdf.js. Le scanner
  `bordereauDeTeletransmissionSansSortie.test.ts` garde les deux modules (défauts plantés) ; le canari est dans
  `bordereauDeTeletransmission.test.ts` et sur un PDF fictif fabriqué par pdf-lib.
- **Non vérifié** : l'ordre et le découpage réels des fragments que pdf.js rend d'un fichier de Télévitale (un intitulé de
  colonne sur deux lignes, un nom qui déborde sur la ligne suivante, un pied à une autre ordonnée) — sur la page réelle, la
  lecture refuserait plutôt que deviner, et la raison dirait la page et le rang de la ligne (BOR1-Q4). Le contrôle « Total =
  Caisse + Mutuelle + Assuré » **par ligne** est tiré de la forme, pas vérifié sur les chiffres de la page (BOR1-Q3).

### 12.3 Ce que cela change aux lots

- **BOR1 a absorbé le gabarit du bordereau de télétransmission** prévu en BOR2. BOR2 devient : le passage des bordereaux lus
  aux agrégats du § 4.2 (par organisme, par part, au grain de BOR-Q4), et un gabarit par AUTRE état, quand le cabinet en
  montrera un (le bordereau des paiements, le suivi tiers payant).
- **La date du facturé** : le bordereau ne dit pas le jour de télétransmission, mais la **date de création du lot**. Le
  § 4.2 (« `date_de_teletransmission`, à défaut la date de la facture ») se lit désormais « la date de création du lot »,
  qui est de l'en-tête, jamais d'une ligne : la date de prescription n'est pas lue.
- **La part complémentaire n'est connue qu'en un total par lot** : la colonne « Mutuelle » est un montant, aucun organisme
  complémentaire n'est imprimé. De cet état, seule l'option « en un total » de BOR-Q5 est possible.
- **Le facturé en tiers payant** est caisse + mutuelle ; la colonne « Assuré » est ce que le patient doit, que l'assurance
  maladie ne paiera pas : BOR2 la garde à part, ou ne la garde pas.
- **L'organisme** : un code de caisse de trois chiffres et un libellé ; le régime n'est pas imprimé (BOR1-Q5).
- **Le numéro du lot** est lu et rendu à l'appelant (pour le montrer avant le clic et refuser un lot deux fois dans un
  fichier) ; le § 4.3 tient toujours : il n'entre pas en base tant que BOR-Q4 ne dit pas le contraire (BOR1-Q1).

### 12.4 Ce que cela change aux questions

- **BOR-Q1** : la page montrée est le bordereau de télétransmission ; le bordereau des paiements n'a pas été montré, et
  NOE1 l'attend toujours. La question reste ouverte pour lui.
- **BOR-Q2** : le bordereau de télétransmission se lit **sans qu'aucune valeur d'une ligne ne sorte** du module : l'option
  « le bordereau » devient possible sans état nominatif gardé. Le reste dû ne s'y lit pas (BOR-Q6 inchangée).
- **BOR-Q5** : de cet état, un total seul (§ 12.3).
- **BOR-Q8** : inchangée — le fichier lu reste nominatif, même si rien de nominatif n'en sort.
- Cinq questions nouvelles :

```json
[
  {
    "id": "BOR1-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR1)",
    "titre": "Le numéro du lot : montré, jamais gardé ?",
    "question": "Le numéro du lot lu sur le bordereau se montre-t-il à l'écran avant l'import, sans jamais entrer en base ?",
    "contexte": "BOR1 rend le numéro du lot à l'écran qui l'appelle : il permet au praticien de reconnaître le lot qu'il importe, et de refuser un fichier qui porte deux fois le même lot. Les conceptions 59 (§ 4.3) et 53 (§ 3) n'en gardent aucun en base : dans le logiciel du praticien, un lot désigne un ensemble de factures, donc de patients ; gardé, il serait un pseudonyme. Sans lui, un même bordereau importé deux fois ne se reconnaît qu'à sa date et à ses totaux.",
    "recommandation": "(A) : montré avant le clic, jamais envoyé en base ; le doublon entre deux imports se juge sur la date de création et les totaux, et se dit en attention.",
    "options": ["(A) Montré à l'écran, jamais en base", "(B) Ni montré ni rendu : le module le lit pour ses contrôles, puis l'oublie", "(C) Gardé en base pour reconnaître un lot importé deux fois (rouvre BOR-Q4 et la conception 53)"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 4.3 et § 12.3",
    "pose": "2026-11-18"
  },
  {
    "id": "BOR1-Q2",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR1)",
    "titre": "Les autres « destinataires du règlement »",
    "question": "Ton logiciel imprime-t-il parfois autre chose que « Partenaire de santé » après « Destinataire du réglement » ?",
    "contexte": "Sur la page montrée, le règlement va au « Partenaire de santé » (le praticien, en tiers payant). Une autre valeur — l'assuré, par exemple, quand il est remboursé lui-même — changerait ce que le lot compte comme dû au praticien. BOR1 ne connaît que la valeur vue et refuse toute autre, en le disant.",
    "recommandation": "(A) : refuser toute autre valeur tant qu'une page ne l'a pas montrée ; une page rendue anonyme d'un tel lot, s'il en existe.",
    "options": ["(A) Refuser toute autre valeur jusqu'à une page qui la montre", "(B) Accepter tout libellé, sans le rendre, et compter le lot comme s'il était en tiers payant", "(C) Il n'y a jamais d'autre valeur"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 12.2",
    "pose": "2026-11-18"
  },
  {
    "id": "BOR1-Q3",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR1)",
    "titre": "Le total de chaque ligne : la somme de ses trois parts ?",
    "question": "Sur ton bordereau, le « Total » de chaque ligne est-il toujours égal à « Caisse » + « Mutuelle » + « Assuré » ?",
    "contexte": "BOR1 contrôle cette égalité sur la ligne de total et sur chaque ligne : elle attrape un montant mal découpé (l'espace des milliers). Elle est tirée de la forme de la page, pas vérifiée sur ses chiffres ; si une ligne réelle ne la vérifie pas (une franchise, un dépassement, une participation forfaitaire), chaque bordereau serait refusé. Les contrôles des colonnes contre le total imprimé resteraient.",
    "recommandation": "(A) : garder le contrôle par ligne si ta page le vérifie (un coup d'œil sur deux ou trois lignes suffit), sinon (B).",
    "options": ["(A) Oui, toujours : garder le contrôle par ligne", "(B) Pas toujours : ne contrôler que la ligne de total et les colonnes", "(C) Je ne sais pas : garder (A) et retirer le contrôle au premier refus réel"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 12.2",
    "pose": "2026-11-18"
  },
  {
    "id": "BOR1-Q4",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR1)",
    "titre": "Le premier essai sur un vrai fichier",
    "question": "Comment éprouver la lecture sur un vrai bordereau, sans qu'il quitte l'ordinateur où il est ?",
    "contexte": "BOR1 est éprouvé sur des textes et un PDF fictifs à la forme de la page montrée. L'ordre et le découpage réels des fragments que pdf.js rend d'un fichier de Télévitale ne sont pas vérifiés : un intitulé sur deux lignes ou un nom qui déborde ferait refuser la lecture (jamais deviner). Le refus dit la page et le rang de la ligne, aucune valeur.",
    "recommandation": "(A) : à l'écran de BOR4, quand il existera, le praticien ou le cabinet importe un vrai bordereau dans son navigateur ; un refus se rapporte par sa seule raison, et le gabarit se corrige sur elle.",
    "options": ["(A) Au premier import réel, à l'écran de BOR4", "(B) Plus tôt, par un petit outil local que le cabinet lance sur un ordinateur, qui n'affiche que le résultat ou la raison", "(C) Sur une page rendue anonyme, convertie en PDF texte par le cabinet"],
    "option_recommandee": "A",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 12.2",
    "pose": "2026-11-18"
  },
  {
    "id": "BOR1-Q5",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR1)",
    "titre": "Le régime d'une caisse que le bordereau ne dit pas",
    "question": "Pour rapprocher un lot des paiements NOEMIE (rangés par régime et par caisse), une caisse imprimée « CPAM » est-elle rangée sous le régime général (01) ?",
    "contexte": "Le bordereau imprime l'organisme sous un code de caisse de trois chiffres et un libellé (« CPAM - … »), sans régime. Les paiements de NOE3 se rangent sous deux entiers, le régime et la caisse. Une caisse primaire d'assurance maladie est un organisme du régime général (code de la sécurité sociale, art. L. 211-1) ; aucun autre libellé (MSA, régimes spéciaux) n'a été vu.",
    "recommandation": "(A) : le régime 01 pour un libellé qui commence par « CPAM », tout autre libellé refusé au rapprochement tant qu'une page ne l'a pas montré.",
    "options": ["(A) « CPAM » vaut le régime 01, tout autre libellé attend", "(B) Celui qui importe choisit le régime, dans une liste fermée", "(C) Rapprocher sur le seul code de caisse"],
    "option_recommandee": "A",
    "source": "Code de la sécurité sociale, art. L. 211-1 (Légifrance) ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 12.3",
    "pose": "2026-11-18"
  }
]
```

## 13. Les réponses du cabinet du 18/11/2026

Quatorze réponses (page des arbitrages, relue le 18/11/2026 à 14 h UTC) : BOR-Q1 à Q9 et BOR1-Q1 à Q5. Sept ne suivent pas la
recommandation (BOR1-Q1, BOR1-Q2, BOR1-Q4, BOR-Q3, BOR-Q5, BOR-Q7, BOR-Q8 — et BOR1-Q5 par sa note). Ce qui suit dit ce que
chacune change ; rien n'est appliqué en base.

### 13.1 Ce que le code a changé le 18/11/2026 (sans base, sans écran)

- **BOR1-Q2 (B)** — tout libellé du destinataire du règlement est accepté et **jamais rendu** : le champ
  `destinataireDuReglement` et son type sont retirés de `BordereauLu` ; la ligne « Destinataire du réglement : … » doit être
  là (elle est de la forme de l'en-tête, son absence se refuse), mais ce qui suit les deux-points n'est ni analysé, ni comparé
  d'une page à l'autre, ni cité dans un refus — un libellé autre que « Partenaire de santé » peut nommer une personne. Le lot se
  compte toujours **comme en tiers payant** : le dû par l'assurance maladie est la caisse plus la mutuelle (§ 12.3). Le risque
  accepté : un lot dont l'assuré est le destinataire (s'il en existe) serait compté comme dû au praticien ; rien ne le
  signalera, puisque le libellé n'est pas lu.
- **BOR1-Q3 (A)** — le contrôle « Total = Caisse + Mutuelle + Assuré » **par ligne** reste tel quel : rien n'a changé dans le
  module, un cas de plus le garde (`bordereauDeTeletransmission.test.ts`).
- **BOR1-Q4 (B)** — l'outil local `outils/bordereau/lire.mjs` : Node, sans réseau ni dépendance nouvelle, par le MÊME code
  que l'application (`lib/bordereauDeTeletransmissionLecture.ts`, pdf.js hors navigateur comme dans les tests). Il n'affiche
  que l'en-tête de chaque lot, le régime tiré du libellé (§ 13.2), les quatre totaux et le dû (caisse + mutuelle), ou la raison
  du refus ; ni une ligne de facture, ni le libellé du destinataire, ni le chemin du fichier ; la console est rendue muette
  pendant la lecture (pdf.js y écrit : une mutation qui la rouvre fait virer le test au rouge). Son mode d'emploi, en trois
  lignes, est en tête du fichier. `src/lib/bordereauOutilLocal.test.ts` le joue dans un processus à part sur un PDF fictif
  (`src/test/bordereauFictif.ts`, désormais partagé avec le test de la lecture). Un refus se rapporte par sa SEULE raison :
  elle dit le bordereau, la page et le rang de la ligne, jamais une valeur, et le gabarit se corrige sur elle.
- **BOR1-Q5, la note « tu peux pas voir les autres régimes ? et les mettre tous ? »** — `lib/regimesAssuranceMaladie.ts`
  (§ 13.2), qui n'est encore branché que dans l'outil local ; BOR2 l'appellera.

### 13.2 Les grands régimes (BOR1-Q5)

**La liste**, fermée, est celle du jeu de valeurs **JDV_Code_regime** de l'Agence du numérique en santé (Terminologies de
santé, OID 1.2.250.1.213.3.4.134, version du 22/03/2024, codes du système 1.2.250.1.213.3.3.104), recopiée ligne à ligne,
chaque ligne portant sa source dans le code : 1 CPAM, 2 MSA, 3 RSI, 4 SNCF, 5 RATP, 6 ENIM, 7 MINES, 8 CNMSS, 9 CPM Banque de
France, 10 CRPCEN, 12 RSAM CCIP, 14 Assemblée nationale, 15 SENAT, 16 PORT AUTONOME DE BORDEAUX, 17 Français à l'étranger,
80 MINISTERE DES ANCIENS COMBATTANTS, 90 CAMAC, 91 MGEN, 92 MG, 93 MGP, 94 MFP, 95 MNH, 96 MNAM, 99 SLM — vingt-quatre lignes,
toutes dans le champ `regime` de NOE3 (0 à 99). La ligne 1 cite aussi le code de la sécurité sociale (art. L. 211-1 : les
caisses primaires sont des organismes du régime général) ; la ligne 3 cite la loi n° 2017-1836 du 30 décembre 2017 (art. 15,
la suppression du régime social des indépendants : un libellé « RSI » ne peut venir que d'un ancien lot).

**La règle de rattachement**, la seule : le premier segment du libellé imprimé, avant le premier « - » (« CPAM » dans « CPAM -
VILLE »), comparé sans accents, casse ni espaces doubles à l'intitulé d'une ligne, **à l'identique** ; jamais une sous-chaîne,
jamais la ville, jamais le code de caisse (le même code existe sous plusieurs régimes). Sinon : **« à choisir par celui qui
importe »**, dans la même liste fermée (`regimeChoisi`), jamais deviné.

**Ce que les sources consultées ne disent pas** :

- comment Télévitale **imprime** l'organisme d'un autre régime que le régime général : seule une page « CPAM » a été vue.
  Qu'un lot de la MSA s'imprime « MSA - … » est vraisemblable, pas vérifié ; un autre libellé tombe à « à choisir », jamais
  sous un régime faux. Le seul faux positif possible serait un libellé dont le premier segment est l'intitulé d'un AUTRE
  régime que le sien, ce qu'aucune source n'annonce ;
- les caisses générales de sécurité sociale d'outre-mer (« CGSS »), les caisses communes, la CAMIEG, le régime local
  d'Alsace-Moselle : aucune ligne du jeu ne porte leur sigle — « à choisir » ;
- le sens de l'intitulé « CAMAC » (code 90) : recopié tel quel ;
- que le **code de caisse à trois chiffres** du bordereau soit celui que porte le paiement NOEMIE de la même caisse (le champ
  `caisse` de NOE3) : la forme du payé chez Télévitale n'est pas connue (NOE1 attend la page du bordereau des paiements) ;
- la structure régime (deux chiffres), caisse (trois), centre (quatre) du code d'un organisme n'est attestée que par des
  sites secondaires (comparateurs d'assurance), pas par une page d'ameli.fr ni du GIE SESAM-Vitale qui ait pu être lue : le
  module ne s'en sert pas.

### 13.3 Le numéro du lot gardé en base (BOR1-Q1 (C), contre la recommandation)

**Ce que la décision rouvre.** La conception 53 (§ 3) écarte, pour le payé, le numéro d'une facture et celui d'un lot, et
jusqu'à leur empreinte : dans le logiciel du praticien, un lot désigne un ensemble de factures, donc de patients ; gardé ici,
il serait un **pseudonyme** (RGPD, art. 4, 5°, et considérant 26). La présente conception reprenait la règle (§ 4.3). La
décision du cabinet ne porte que sur le **facturé** : NOE3 et le payé restent sans numéro de lot (BOR-Q4 (A), ci-dessous, n'a
pas pris l'option « des deux côtés »), et la conception 53 reste vraie pour eux.

**La contradiction avec « aucune donnée de patient »** (la décision du 16/11/2026). Un numéro de lot n'est pas une donnée de
patient en lui-même ; il le devient par le logiciel du praticien, qui le relie à des factures, donc à des personnes et à des
soins. Gardé avec sa date, sa caisse et ses montants, il fait de chaque lot du facturé une donnée **pseudonymisée**, qui reste
une donnée personnelle — et, parce qu'elle porte sur des soins, une donnée concernant la santé de ces personnes. C'était déjà
vrai d'un agrégat d'un jour où une seule facture est partie (§ 4.3, « ce que la base apprendrait de plus ») ; le numéro rend le
lien **certain** au lieu de probable. RGPD.md (§ 8.7, la condition de l'absence d'hébergeur de données de santé) se relit à
BOR3 : il faudra y écrire ce qui est gardé et pourquoi, et le cabinet l'approuver.

**Ce que cela change à la base (BOR3)** — sans en changer le grain :

- **Le grain du facturé reste celui de BOR-Q4 (A)** : par jour (la date de création du lot, § 12.3), organisme et part. Le
  numéro ne devient pas une colonne des montants : il entre dans un **registre des lots importés**, à part, qui ne sert qu'à
  refuser un lot déjà importé — ce qui concilie les deux réponses.
- **Le registre** : `lots_teletransmission_importes` (le dossier, l'import qui l'a apporté, l'identification du lot, sa date de
  création, l'auteur et l'instant posés par la base), sous une contrainte **totale** `unique (dossier_id, identification du
  lot, date de création)` — la date entre dans la clé parce que rien n'établit qu'un numéro de lot de Télévitale ne recommence
  jamais (une réinstallation, un changement de poste) ; un même lot réimprimé garde sa date de création.
- **Les montants** se rangent sous l'import (`unique (dossier_id, import_id, date, régime, caisse, part)`) et se somment à la
  lecture : ce n'est plus la clé naturelle seule qui empêche le double compte (comme dans NOE3), c'est le registre. Un import
  peut alors porter un lot seul, sans les « journées entières » qu'exigeait le § 7 ; retirer un import retire ses montants et
  ses lots d'un même geste.
- **Ce que le client « Banque » en lit** (BOR-Q8 (A) : il importe, comme le cabinet) : les agrégats, comme dans NOE3, et un refus
  « ce lot a déjà été importé le … », rendu par la fonction d'import. **Aucune policy de lecture sur le registre**, pour
  personne : il se lit par la fonction seule (une table sans policy, comme `connexions_plateformes`), qui ne rend jamais
  l'identification d'un lot.
- **Le plan de sauvegarde** : le registre y entre (sinon une restauration rouvrirait les doublons), derrière le drapeau de BOR3.

**Le garde-fou recommandé : une empreinte à clé secrète, plutôt que le numéro.** Une empreinte salée calculée dans le
navigateur ne protège rien : le sel serait lisible par qui importe, et un numéro de lot n'a que quelques milliers de valeurs —
il se retrouve en une fraction de seconde. L'empreinte utile est un **HMAC-SHA-256 sous une clé propre au dossier, tirée et
gardée par la base** (une table sans policy, que seule la fonction d'import lit) : le navigateur envoie le numéro et la date à
la fonction, qui calcule l'empreinte, la compare au registre, la garde et oublie le numéro. Elle suffit à reconnaître le doublon
(c'est le seul usage que le cabinet a nommé) ; elle ne rend pas la donnée anonyme (la base, qui a la clé, peut toujours
recalculer l'empreinte d'un numéro donné), mais aucune lecture, aucun export, aucun journal ne porte plus un numéro du logiciel
du praticien. Le prix : l'écran ne pourra jamais dire « le lot n° N » d'un import passé, seulement sa date et ses totaux ; et la
sauvegarde doit porter la clé du dossier avec le registre (ou la restauration perd la reconnaissance des doublons). Parce que ce
garde-fou change ce que le cabinet a décidé (« le numéro gardé »), il lui est posé : **BOR1Q1-Q1**.

### 13.4 Les autres réponses

- **BOR-Q1 (C), les deux bordereaux** : celui de télétransmission a été montré (§ 12) ; celui des paiements (« Paiement Noemie
  par journée comptable ») reste attendu — il nourrit NOE1, pas BOR.
- **BOR-Q2 (D)** : un état sans patient pour le facturé dès qu'un tel état suffit, le suivi tiers payant pour le reste dû. Aucun
  état sans patient n'a été montré ; avec BOR-Q3 (B), il ne reste que les statistiques « Chiffre d'affaires par caisse » et
  « … par organisme complémentaire » et le journal des lots (§ 1.3). Tant qu'aucun n'est montré, le bordereau de
  télétransmission, lu sans qu'une valeur d'une ligne sorte (BOR1), est la source du facturé — l'option D le prévoyait « si rien
  d'autre ne se lit ».
- **BOR-Q3 (B), contre la recommandation** : aucune requête demandée à l'éditeur ; la voie d'un fichier sans patient à la source
  est fermée, le PDF nominatif lu dans le navigateur devient la voie ordinaire.
- **BOR-Q4 (A)** : le jour, l'organisme et la part, sans numéro de lot dans le grain — tenu avec BOR1-Q1 (C) par le registre à
  part (§ 13.3).
- **BOR-Q5 (B), contre la recommandation** : par organisme complémentaire, sous son numéro, pour le facturé comme pour le payé.
  **L'écart** : le bordereau de télétransmission n'imprime la part complémentaire qu'en un montant par ligne et un total par lot,
  sans organisme (§ 12.3) ; de lui, seul un total « organisme complémentaire non dit » se lit. Il faudrait lire, en plus : la
  statistique « Chiffre d'affaires par organisme complémentaire » (le facturé, par mutuelle), ou le suivi tiers payant (s'il
  porte l'organisme de chaque facture), et, pour le payé, les retours NOEMIE des complémentaires (chacune envoie le sien, sous
  son numéro). **Ce que cela change à NOE3 (préparée, pas appliquée)** : le payé range la part complémentaire sous `regime` et
  `caisse`, deux petits entiers faits pour une caisse ; le numéro d'un organisme complémentaire n'y tient pas (sa forme
  publique n'est pas établie ici : ni sa longueur, ni sa structure). NOE3 doit recevoir, avant d'être collée, une colonne de
  plus — un entier, jamais un texte, nul pour la part obligatoire — et sa clé d'unicité s'étendre à elle. En attendant, le
  total du bordereau se range sous un organisme complémentaire non dit (**BORQ5-Q1**).
- **BOR-Q6 (A)** : le reste dû lu quand l'état existe, estimé sinon et dit « estimé ». Aucun suivi tiers payant n'a été montré :
  BOR5 commence par le niveau 1 seul (§ 6.2).
- **BOR-Q7 (B), contre la recommandation** : au MVP, en entier. Le facturé rejoint NOEMIE (NOE-Q5) dans le MVP ; la 2035 de
  2026 n'en dépend toujours pas (les recettes sont les crédits du relevé). Le calendrier : BOR3 se colle avec NOE3 et NOE5
  (NOE3-quand (A) : après les PDF rendus anonymes).
- **BOR-Q8 (A), contre la recommandation** : le praticien et le cabinet lisent un bordereau, comme NOEMIE. **Le risque** : le
  § 8.7 de RGPD.md fonde l'absence d'hébergeur de données de santé sur la consigne « le praticien ne transmet pas ses
  bordereaux à son cabinet ». Que le cabinet lise un bordereau dans son navigateur ne range rien de nominatif ; mais le fichier
  doit lui parvenir, hors de l'application — et l'adresse de collecte l'écartera (BOR-Q9). La façon dont il lui parvient se pose
  au cabinet : **BORQ8-Q1**.
- **BOR-Q9 (A)** : refusé au dépôt dans le navigateur, écarté à la réception par e-mail, comme un retour NOEMIE (NOE-Q6). La
  forme est connue (le titre « Bordereau de Teletransmission » en tête de la première page) : au dépôt, la lecture du titre par
  pdf.js dans le navigateur suffit. **À la réception, ce n'est pas établi** : `receive-email` ne lit pas le texte d'un PDF
  aujourd'hui ; l'écarter sans l'envoyer d'abord au stockage et à Textract demande d'y lire la couche de texte de la première
  page, dans l'Edge Function — la faisabilité (pdf.js sous Deno, son poids, le mur de 150 s) est à mesurer en BOR6.

### 13.5 Le plan des lots, remis à jour

| Lot | Ce qu'il fait | Taille | Préalable |
|---|---|---|---|
| BOR0 | Sans code. Restent : la page rendue anonyme du bordereau des paiements (NOE1), une page des statistiques « par caisse » et « par organisme complémentaire » (BOR-Q2, BOR-Q5), une page du suivi tiers payant (BOR-Q6) ; **le premier passage de l'outil local** sur un vrai bordereau, dont la sortie (ou la raison) se rapporte telle quelle | — | le cabinet |
| BOR1 | **Fait** (§ 12.2), et le 18/11/2026 après-midi : BOR1-Q2 (B), le contrôle par ligne gardé (BOR1-Q3), la liste des régimes (§ 13.2), l'outil local (§ 13.1) | fait | — |
| BOR2 | **Fait le 19/11/2026** (HISTORIQUE.md, « BOR2 : LE FACTURÉ EN AGRÉGATS »). `lib/factureAssuranceMaladie.ts`, pur et sans sortie : des bordereaux lus aux agrégats (la date de création du lot ; le régime reconnu ou choisi, la caisse au code imprimé ; la part obligatoire = « Caisse », la part complémentaire = « Mutuelle » sous un organisme non dit ; « Assuré » non gardé) ; l'identification des lots pour le registre ; le scanner « sans sortie » étendu, le canari | moyen (un module, ses tests) | BOR1Q1-Q1, BORQ5-Q1 |
| BOR3 | **Préparé le 19/11/2026 (§ 14)** : la migration `factures_assurance_maladie` (à coller : son retrait supprime), drapeau `FACTURES_ASSURANCE_MALADIE_PREVUES` baissé ; NOE3 amendée avant son collage (l'organisme complémentaire) ; RGPD.md § 8.7 proposé. Le plan d'origine : l'import, le facturé sous son import, le registre des lots et la clé du dossier, la fonction d'import tout ou rien, la RLS (le cabinet et le client « Banque »), la restrictive `deux_facteurs` sous condition, l'essai SQL, le plan de sauvegarde derrière le drapeau | fait | — |
| BOR4 | L'écran, dans la section NOEMIE de l'onglet Banque et de « Ma banque » : le fichier lu dans le navigateur, le régime « à choisir » quand le libellé ne le dit pas, les agrégats avant le clic, « lot déjà importé le … » | moyen | BOR3, BORQ8-Q1 |
| BOR5 | **Fait le 20/11/2026 (§ 16)** : `lib/duContrePaye.ts` et la section du cabinet, derrière `DU_CONTRE_PAYE_PREVU` baissé. Le plan : le niveau 1 (estimé) seul tant qu'aucun suivi tiers payant n'est lu, par organisme et par part (par mutuelle quand elle est connue) | moyen | BOR3, NOE3 |
| BOR6 | Les points d'attention (avec NOE6) ; le refus au dépôt (le titre, dans le navigateur) ; l'écart à la réception par e-mail, après la mesure de sa faisabilité dans `receive-email` | moyen à grand (une Edge Function) | BOR5, BOR-Q9 |
| BOR7 | La mise en production, avec NOE3 et NOE5 : les migrations, les drapeaux, les essais, les trois contrôles de l'export | petit | tout, et les PDF rendus anonymes (NOE3-quand) |

Ordre : BOR0 (le cabinet) en parallèle de BOR2, puis BOR3 → BOR4 → BOR5 → BOR6 → BOR7. Au MVP (BOR-Q7 (B)).

### 13.6 Les questions nouvelles

```json
[
  {
    "id": "BOR1Q1-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR3)",
    "titre": "Le numéro du lot en base : en clair, ou une empreinte à clé secrète ?",
    "question": "Pour reconnaître un lot importé deux fois, la base garde-t-elle le numéro du lot en clair, ou seulement une empreinte calculée par la base sous une clé secrète propre au dossier ?",
    "contexte": "Tu as décidé (BOR1-Q1 (C)) de garder le numéro du lot pour refuser un lot importé deux fois. Dans le logiciel du praticien, un numéro de lot désigne un ensemble de factures, donc de patients : gardé, il est un pseudonyme, et une donnée concernant la santé (RGPD, art. 4, 5°). Une empreinte salée dans le navigateur ne protégerait rien (quelques milliers de numéros possibles). Une empreinte HMAC calculée par la base, sous une clé du dossier qu'aucune lecture ne rend, suffit à refuser le doublon ; aucune lecture, aucun export, aucun journal ne porte plus le numéro. Le prix : l'écran ne dira jamais « le lot n° N » d'un import passé, seulement sa date et ses totaux.",
    "recommandation": "(A) : l'empreinte à clé secrète — elle fait ce que tu as demandé (reconnaître le doublon) sans garder le numéro du logiciel du praticien.",
    "options": ["(A) Une empreinte calculée par la base, sous une clé secrète du dossier", "(B) Le numéro en clair, lisible par le cabinet et le praticien", "(C) Revenir à BOR1-Q1 (A) : le numéro montré, jamais gardé ; le doublon jugé sur la date et les totaux"],
    "option_recommandee": "(A) Une empreinte calculée par la base, sous une clé secrète du dossier",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 13.3 ; conception 53 § 3",
    "pose": "2026-11-18"
  },
  {
    "id": "BORQ5-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR2 et BOR3)",
    "titre": "La mutuelle d'un bordereau, qui ne la nomme pas",
    "question": "Tant qu'aucun état ne nomme l'organisme complémentaire, le total « Mutuelle » d'un bordereau se garde-t-il sous un organisme complémentaire « non dit » ?",
    "contexte": "Tu as choisi de suivre les complémentaires une par une, sous leur numéro (BOR-Q5 (B)). Le bordereau de télétransmission n'imprime la part mutuelle qu'en montants, sans organisme. Pour la détailler, il faudrait lire en plus la statistique « Chiffre d'affaires par organisme complémentaire » de Télévitale ou le suivi tiers payant, et, pour le payé, les retours NOEMIE des complémentaires. La table des paiements (NOE3, pas encore appliquée) recevra pour cela une colonne de plus avant d'être collée.",
    "recommandation": "(A) : oui — le total se garde sous « non dit », et se détaille quand un état qui nomme la mutuelle sera montré (une page rendue anonyme de la statistique par organisme complémentaire).",
    "options": ["(A) Oui : sous « non dit », détaillé plus tard", "(B) Ne pas garder la part mutuelle tant qu'elle n'est pas détaillée", "(C) Revenir à BOR-Q5 (A) : un seul total pour toutes les complémentaires"],
    "option_recommandee": "(A) Oui : sous « non dit », détaillé plus tard",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 12.3 et § 13.4",
    "pose": "2026-11-18"
  },
  {
    "id": "BORQ8-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR4)",
    "titre": "Comment le bordereau parvient au cabinet",
    "question": "Quand c'est le cabinet qui importe un bordereau (BOR-Q8 (A)), comment le fichier lui parvient-il ?",
    "contexte": "Le registre (RGPD.md § 8.7) fonde l'absence d'hébergeur de données de santé sur la consigne « le praticien ne transmet pas ses bordereaux à son cabinet ». L'application ne gardera rien du bordereau, mais le fichier, qui porte les noms des patients, doit arriver sur l'ordinateur du cabinet : par e-mail il passerait par une messagerie, et l'adresse de collecte du dossier l'écartera (BOR-Q9 (A)).",
    "recommandation": "(A) : le praticien importe lui-même depuis « Ma banque » ; le cabinet n'importe que sur l'ordinateur du praticien, ou d'un fichier remis de la main à la main, jamais par e-mail — et RGPD.md § 8.7 le dit.",
    "options": ["(A) Le praticien importe ; le cabinet seulement sur place ou de la main à la main, jamais par e-mail", "(B) Le praticien envoie le fichier au cabinet par e-mail (hors de l'adresse de collecte)", "(C) Revenir à BOR-Q8 (B) : un état nominatif ne se lit que dans l'espace du praticien"],
    "option_recommandee": "(A) Le praticien importe ; le cabinet seulement sur place ou de la main à la main, jamais par e-mail",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 13.4 ; RGPD.md § 8.7",
    "pose": "2026-11-18"
  }
]
```

## 14. BOR3, préparé le 19/11/2026 : ce que la base garde

Rien n'est appliqué. La migration : `supabase/schema/20261120110200_factures_assurance_maladie.sql` ; son retour, son essai
(`facturesAssuranceMaladie.sql`, et `facturesAssuranceMaladieSuppression.sql` sur une réplique) ; le module qui redit ses refus et
compose le corps de l'appel : `src/lib/importDuFactureAssuranceMaladie.ts`. Le récit : HISTORIQUE.md, « 19/11/2026 — BOR3 ».

### 14.1 Les quatre tables

- `imports_factures_assurance_maladie` : le dossier, la première et la dernière date de création des lots, le nombre des lots et de
  leurs factures (BOR2-Q1 (A)), qui et quand (posés par la base).
- `factures_assurance_maladie` : les totaux de l'import, par date de création, part et organisme — la part obligatoire sous son
  régime et sa caisse, la part complémentaire sans eux, sous `organisme_complementaire` (un entier ; nul : « non dit », BORQ5-Q1
  (A)) ; le montant signé (un lot d'avoirs), le nombre de lots et de factures. Clé TOTALE (dossier, import, date, part, régime,
  caisse, organisme complémentaire) : les totaux se somment à la lecture, le registre empêchant qu'un lot compte deux fois.
- `lots_teletransmission_importes` : le registre, une empreinte de 32 octets par lot, unique dans le dossier — un HMAC-SHA-256
  (pgcrypto) de « lot:numéro:date de création:caisse », les entiers ramenés à leur forme (7 et 7.0 sont le même lot), sous la clé du
  dossier. La caisse y entre parce que rien n'établit qu'un numéro de lot soit unique d'une caisse à l'autre un même jour ; elle ne
  relâche rien (un lot réimprimé garde sa caisse).
- `cles_des_lots_teletransmission` : la clé du dossier, 32 octets tirés par la base (`gen_random_bytes`) au premier import ; elle
  ne change jamais et ne part qu'avec le dossier.

Aucune colonne de texte hors de la part ; la garde de fin le relit au catalogue.

### 14.2 Qui lit, qui écrit

- Le cabinet du dossier et un accès « Banque » importent et retirent (BOR-Q8 (A)), et lisent les imports et les totaux. **Cette
  lecture et ces deux gestes du client se présentent au cabinet avant l'application** (fiche BOR3-migration).
- Le registre et la clé : AUCUNE policy, pour personne (ni le cabinet, ni le client, ni la restauration) ; seule la fonction
  d'import les lit. Le rôle des Edge Functions passe la RLS, comme pour `connexions_plateformes`, et la garde lui refuse toute
  écriture.
- La garde (aux droits de l'appelant, sans la porte `_acces_avant_les_gardes`) : rien ne s'écrit hors de l'import (et de la
  restauration, pour l'import et ses totaux, jamais une empreinte), rien ne se modifie, rien ne part hors du retrait de son import ou
  de son dossier.

### 14.3 Le numéro du lot

Il arrive en paramètre de `importer_factures_assurance_maladie`, sert à l'empreinte et aux contrôles, et ne s'écrit dans aucune
table, aucun refus, aucun avis : « Le bordereau N de l'envoi a déjà été importé le JJ/MM/AAAA » nomme le RANG du bordereau dans
l'envoi et le jour de l'import qui l'a apporté. Côté navigateur, le corps de l'appel (`corpsDeLImportDuFacture`) se compose au
moment de l'appel ; ce que l'écran montre avant le clic (le résultat de BOR2) ne porte aucun numéro. Hors de la portée de la
base : ce que les journaux de Postgres garderaient des paramètres d'une requête — à relever en production avant BOR7
(`log_statement`, `log_min_duration_statement`, `log_parameter_max_length` : sur la réplique, `none`, `-1`, `-1`).

### 14.4 La sauvegarde, et l'import restauré (BOR3-Q1)

Le § 13.3 voulait la clé dans la sauvegarde. Elle n'y est pas : la sauvegarde d'un dossier se lit sous la session du cabinet, qui
pourrait donc lire la clé, et une empreinte d'un numéro de quelques milliers de valeurs se renverse avec elle. La clé et le
registre n'ont aucune policy : leur lecture rend zéro ligne (le patron de `connexions_plateformes`), et l'écran de la restauration
le dit (`FACTURE_HORS_PERIMETRE`). Le prix : un import RESTAURÉ n'a plus le registre de ses lots. La fonction d'import le
reconnaît — un import sans aucun lot au registre n'a pu être écrit que par la restauration — et refuse tout lot dont la date de
création tombe dans sa période tant qu'il n'est pas retiré ; on le retire, puis on réimporte ses bordereaux. Un lot n'est jamais
compté deux fois en silence.

### 14.5 Ce que la base contrôle

La forme (version 1, trois clés ; quatre par lot, huit par total) ; de 1 à 2 000 lots et au plus 5 000 totaux ; chaque lot (numéro
de 1 à 999 999 999, date de création depuis 1990 et jamais à venir, caisse de 0 à 999, de 1 à 10 000 factures) ; deux lots de même
empreinte ; chaque total (son organisme selon sa part, des centimes entiers, au moins autant de factures que de lots) ; deux totaux
de même clé ; les totaux confrontés aux lots — chacun porte la date d'un lot (et, pour la part obligatoire, la caisse d'un lot de ce
jour) et ne compte pas plus de lots ni de factures que ces lots n'en portent ; puis le registre et l'import restauré. Un exercice
validé ne fige pas le facturé : il ne compte dans aucun moteur, et un lot de décembre est payé en janvier (BOR3-Q2).

### 14.6 NOE3 amendée, NOE5 relue

NOE3 (préparée, jamais collée) reçoit `organisme_complementaire` dans la forme d'un paiement (huit clés, version 1 redéfinie) et
dans sa clé TOTALE (BOR-Q5 (B), BORQ5-Q1 (A)). Relue contre l'état des paiements de Télévitale (la recherche du 19/11/2026), elle
admettait déjà les lignes sans facture et les montants négatifs : une somme positive sans facture (une aide) est un `forfait` ; un
indu ou une régularisation qui retire est une régularisation de sa part, seule ou déduite des factures du jour ; un net négatif
s'admet, un brut négatif jamais. L'essai le prouve (étapes 60 à 72). NOE5 tient sans changement en base (sa garde de tête relit
des corps de NOE3 que l'amendement ne touche pas) ; son module ne forme plus de paire quand deux parts complémentaires nommées
partagent une journée et une caisse.

### 14.7 Les questions nouvelles

```json
[
  {
    "id": "BOR3-migration",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR3)",
    "titre": "Le client « Banque » lit et importe son facturé : la migration à appliquer",
    "question": "La migration du facturé ouvre au client qui porte la case « Banque » la lecture des imports et des totaux du facturé de son dossier, et deux gestes : importer ses bordereaux et retirer un import. L'appliquer ainsi ?",
    "contexte": "Tu as décidé que le praticien importe ses bordereaux, et le cabinet aussi (BOR-Q8 (A), BORQ8-Q1 (A)). La migration préparée le 19/11/2026 ouvre donc au client « Banque » la lecture des imports (période des lots, nombre de lots et de factures, qui et quand) et des totaux (par date de création du lot, organisme et part, en centimes) de son dossier, et l'import et le retrait par deux fonctions. Rien d'autre : il ne lit ni le registre des lots ni la clé du dossier (aucune policy, pour personne), n'écrit rien en direct, et un total ne lui apprend que ce que son logiciel de télétransmission lui dit déjà, agrégé. C'est la règle des paiements NOEMIE (NOE3), sous la même case. CLAUDE.md veut qu'une policy qui ouvre une lecture au client se présente au cabinet avant d'être appliquée.",
    "recommandation": "(A) : l'appliquer telle quelle, avec NOE3 et NOE5, après les PDF rendus anonymes (NOE3-quand) — c'est la lecture de la banque que la case « Banque » ouvre déjà.",
    "options": ["(A) L'appliquer telle quelle : le client « Banque » lit, importe et retire", "(B) Le client lit et importe, le cabinet seul retire un import", "(C) Le cabinet seul : revenir sur BOR-Q8 (A)"],
    "option_recommandee": "(A) L'appliquer telle quelle : le client « Banque » lit, importe et retire",
    "source": "supabase/schema/20261120110200_factures_assurance_maladie.sql ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 14.2 ; CLAUDE.md, « Trois domaines font exception »",
    "pose": "2026-11-19"
  },
  {
    "id": "BOR3-Q1",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR3)",
    "titre": "La clé des lots hors de la sauvegarde",
    "question": "La clé secrète du dossier et le registre des lots restent-ils hors de la sauvegarde, un import restauré retenant alors les lots de sa période jusqu'à son retrait ?",
    "contexte": "La conception (§ 13.3) voulait la clé dans la sauvegarde, pour qu'une restauration reconnaisse encore les lots déjà importés. Mais la sauvegarde d'un dossier se fait dans le navigateur du cabinet : la clé y serait lisible par le cabinet, et un numéro de lot n'ayant que quelques milliers de valeurs, son empreinte se renverserait avec elle. La migration préparée ne la met donc pas dans la sauvegarde (ni le registre, inutile sans elle) ; en contrepartie, après une restauration, la base refuse tout lot créé dans la période d'un import restauré tant qu'il n'est pas retiré, puis ses bordereaux se réimportent. Rien n'est jamais compté deux fois ; une restauration est rare (Supabase sauvegarde aussi la base entière chaque jour, clé comprise).",
    "recommandation": "(A) : hors de la sauvegarde — la clé ne quitte jamais la base, et une restauration coûte un réimport, jamais un double compte.",
    "options": ["(A) La clé et le registre hors de la sauvegarde ; un import restauré retient les lots de sa période jusqu'à son retrait", "(B) La clé et le registre dans la sauvegarde : la restauration reconnaît les lots, mais le cabinet peut lire la clé", "(C) Une clé maîtresse du projet, une clé par dossier tirée d'elle, le registre dans la sauvegarde : reconnu après une restauration dans le même projet, pas dans un autre"],
    "option_recommandee": "(A) La clé et le registre hors de la sauvegarde ; un import restauré retient les lots de sa période jusqu'à son retrait",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 13.3 et § 14.4 ; src/lib/restaurationInterrompue.ts (FACTURE_HORS_PERIMETRE)",
    "pose": "2026-11-19"
  },
  {
    "id": "BOR3-Q2",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR3)",
    "titre": "Le facturé n'est pas figé par un exercice validé",
    "question": "Un import du facturé reste-t-il importable et retirable quand l'exercice de ses lots est validé ?",
    "contexte": "Les paiements NOEMIE (NOE3) se figent avec l'exercice validé de leur journée comptable. Le facturé, lui, ne compte dans aucun moteur (ni 2035, ni CA3, ni FEC, ni association au relevé) : c'est un contrôle de ce que l'assurance maladie doit. Et un lot créé fin décembre est payé en janvier : le contrôle de l'année suivante a besoin du facturé de décembre, même l'année close validée. La migration préparée ne le fige donc pas.",
    "recommandation": "(A) : jamais figé — il ne compte nulle part, et le contrôle « dû contre payé » enjambe le 31 décembre.",
    "options": ["(A) Jamais figé : importable et retirable quelle que soit l'année validée", "(B) Figé comme les paiements, par l'année de création du lot"],
    "option_recommandee": "(A) Jamais figé : importable et retirable quelle que soit l'année validée",
    "source": "docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 14.5 ; supabase/schema/20261120110000_paiements_assurance_maladie.sql",
    "pose": "2026-11-19"
  },
  {
    "id": "BOR3-RGPD",
    "chantier": "Facturé à l'assurance maladie (conception 59, BOR3 ; RGPD.md § 8.7)",
    "titre": "Le bordereau remis au cabinet : sur place seulement ?",
    "question": "Quand c'est le cabinet qui importe un bordereau, le fait-il seulement sur l'ordinateur du praticien, le fichier ne quittant jamais son poste — ou aussi d'un fichier remis de la main à la main ?",
    "contexte": "RGPD.md § 8.7 fonde l'absence d'hébergeur de données de santé sur ta réponse du 24/09/2026 : le praticien « n'a pas le droit de transmettre ses bordereaux de télétransmission à son expert-comptable ». Tu as choisi (BORQ8-Q1 (A)) : le cabinet importe sur place ou d'un fichier remis de la main à la main, jamais par e-mail. L'hébergement reste hors de question dans les deux cas (rien de nominatif n'entre en base : des agrégats et des empreintes). Mais un fichier remis au cabinet, même sur une clé USB, est une transmission du bordereau, que le secret professionnel du praticien (code de la santé publique, art. L. 1110-4) juge en elle-même ; sur l'ordinateur du praticien, rien ne lui est transmis. Le texte proposé pour § 8.7 est écrit dans RGPD.md, à approuver avec cette réponse.",
    "recommandation": "(A) : sur place seulement — le cabinet importe sur l'ordinateur du praticien, ou c'est le praticien qui importe ; aucun bordereau n'est remis au cabinet, et la réponse du 24/09/2026 reste vraie.",
    "options": ["(A) Sur place seulement : le fichier ne quitte jamais le poste du praticien", "(B) Sur place ou de la main à la main, jamais par e-mail (BORQ8-Q1 (A) tel quel), et RGPD.md § 8.7 le dit", "(C) Le praticien seul importe un bordereau"],
    "option_recommandee": "(A) Sur place seulement : le fichier ne quitte jamais le poste du praticien",
    "source": "RGPD.md § 8.7 ; code de la santé publique, art. L. 1110-4 et L. 1111-8 (Légifrance) ; docs/conceptions/59-facture-a-l-assurance-maladie-bordereaux.md § 13.4",
    "pose": "2026-11-19"
  }
]
```

## 15. Les réponses du 19/11/2026 : BOR3-Q1, BOR3-Q2 et BOR3-RGPD

- **BOR3-Q1 (A)** et **BOR3-Q2 (A)**, à la recommandation : rien ne change à la migration préparée (§ 14).
- **BOR3-RGPD (B)**, contre la recommandation : quand c'est le cabinet qui importe un bordereau, il le fait sur place (sur
  l'ordinateur du praticien) ou d'un fichier que le praticien lui remet de la main à la main, jamais par e-mail (BORQ8-Q1 (A) tel
  quel). RGPD.md § 8.7 porte le texte définitif : le fichier lu dans le navigateur, des agrégats et des empreintes seuls en base ;
  la remise est une transmission, que le praticien décide et dont il répond sous son secret professionnel (code de la santé
  publique, art. L. 1110-4), et qui revient, pour ce seul cas, sur la réponse du 24/09/2026 ; la consigne aux clients. Le § 13.4
  et la fiche de BORQ8-Q1 restent tels qu'ils ont été posés ; ce paragraphe les clôt. Deux questions suivent : BOR3RGPD-Q1 (les
  agrégats et les empreintes, données pseudonymisées concernant la santé, au regard de l'article L. 1111-8) et BOR3RGPD-Q2 (le
  support remis, après l'import). L'écran d'import (BOR4) dira la consigne : rien n'y est encore écrit.

## 16. BOR5, fait le 20/11/2026 : ce qui se compare, et ce qui ne se compare pas

Le récit : HISTORIQUE.md, « BOR5 : CE QUE L'ASSURANCE MALADIE DOIT ». Le module : `src/lib/duContrePaye.ts` (son en-tête dit la
règle entière) ; la section : `src/components/DuContrePaye.tsx`, au cabinet seul, en lecture seule, `DU_CONTRE_PAYE_PREVU` baissé.

- **Se compare, sous réserve** : la part obligatoire, par régime et caisse, en compte courant depuis une origine commune (le plus
  tardif des deux premiers jours importés) ; le payé (son brut) imputé aux lots les plus anciens, jamais à un lot créé après la
  journée qui le paie ; les anciennetés à la dernière journée comptable importée. **La réserve** : que le code de caisse du bordereau
  soit celui du paiement NOEMIE n'est pas vérifié (§ 13.2) ; l'écran le dit, et un organisme d'un seul côté se dit tel (DU-Q1).
- **Ne se compare pas** : la part complémentaire (le bordereau ne nomme aucun organisme, et rien n'établit que toutes passent par
  NOEMIE) ; un organisme dont le facturé porte un lot d'avoirs ; un paiement sans régime ou sans caisse. Les forfaits et les
  régularisations se comptent à part ; le nombre de factures se montre, ordre de grandeur, jamais soustrait.
- **Muet, jamais 0** : une lecture partielle, un côté sans import, une donnée illisible, une fenêtre à l'envers, à venir ou hors de
  l'étendue d'un côté. Dans l'étendue, un lot non importé ne se voit pas : les mois sans lot ou sans paiement importé se disent.
- **Pas fait** : « Ma banque » (DU-Q3), les points d'attention (BOR6), le délai de D. 161-13-3 en jours ouvrés (DU-Q2).

## 17. BOR6, troisième partie, et BOR7 : l'état au 27/11/2026

### 17.1 Une photo d'un bordereau, ou un PDF numérisé

- **Ce qui n'est pas faisable** : le refuser AVANT tout envoi. Le navigateur ne lit que la couche de texte d'un PDF (BOR6,
  première partie) ; une image n'en a pas, et la reconnaissance de caractères dans le navigateur est écartée depuis le 21/09/2026.
  L'image passe donc par Textract (AWS, Union européenne), comme toute pièce lue ; c'est le reste du risque, et il est dit
  (RGPD.md § 8.7, BOR6T-Q1).
- **Ce qui est fait** : `extract-piece` juge SA lecture par `porteLaFormeDUnBordereau` (le bloc `formeDUnBordereau` copié,
  `bordereauALaLectureCopie.test.ts`) et, reconnue, ne cite rien au modèle, ne rend ni texte ni champ, et répond 422
  `{ error, code: "bordereau" }`. Les deux chemins du dépôt lisent désormais AVANT l'envoi au stockage (`lib/lectureAuDepot.ts`,
  appelé par `lib/depot.ts` et `lib/importFichiers.ts`) et refusent (`REFUS_D_UN_BORDEREAU_LU`, au cabinet et au client) ;
  `receive-email` lit aussi avant son stockage et écarte la pièce jointe sous la raison `bordereau`, sous la même constante que
  l'écart d'un PDF. Un appelant d'avant voit une lecture ratée (rien de lu, rien cité) : l'ordre des déploiements est libre.
- **Ce qui reste** : la fiche d'une pièce (le fichier choisi à la main) et l'onglet Cotisations disent la phrase du refus à la
  lecture, mais leur enregistrement ne la retient pas ; une image déposée dans un document du cabinet, un original d'import ou
  un procès-verbal n'est lue par personne et ne se reconnaît pas ; une photo que Textract lit mal ne se reconnaît pas ; les
  pièces DÉJÀ au dossier (BOR6T-Q2).

- **Fait le 27/11/2026 (BOR6T-Q1, BOR6T-Q2 (A))** : la fiche d'une pièce et l'onglet Cotisations lisent avant le stockage
  (`lireAvantLeStockage`) et retiennent le refus ; la consigne « un bordereau ne se photographie pas » est dite au praticien ;
  les pièces et documents DÉJÀ au dossier se cherchent d'un clic dans la Vue d'ensemble (`lib/bordereauxDeposes.ts`), nommés
  par leur date de dépôt, leur fiche ouverte pour la suppression confirmée. Restent l'image d'un document du cabinet, d'un
  original d'import ou d'un procès-verbal, et la photo que Textract lit mal.

### 17.2 L'état des paiements par journée comptable

Pas écrit : sa forme n'est pas connue (§ 13.4, BOR-Q1 ; BOR6-Q2 (A), le 21/11/2026 : « il attend une page rendue anonyme »).
Reconnaître ses intitulés sans les avoir lus serait deviner ; le jour où la page est montrée, le prédicat va dans un module à
lui (`lib/formeDeLEtatDesPaiements.ts`), appelé à côté de `porteLaFormeDUnBordereau` aux trois endroits (les préparateurs,
`receive-email`, `extract-piece`), chacun par sa copie gardée.

### 17.3 BOR7

En production : les quatre migrations (246 à 249), `FACTURES_ASSURANCE_MALADIE_EN_BASE`, `FACTURES_ASSURANCE_MALADIE_PREVUES`,
`REFUS_DES_BORDEREAUX_PREVU`, `BORDEREAUX_ECARTES_A_LA_RECEPTION` et `CONTROLES_ASSURANCE_MALADIE_PREVUS` levés ; les essais
de 246 à 249 et `rls.sql` rejoués sur une réplique égale à la production (22/11/2026). Restent, à la session ou au cabinet :
rejouer en production les essais `facturesAssuranceMaladie.sql` et le bloc FM de `rls.sql` ; relever `log_statement`,
`log_min_duration_statement` et `log_parameter_max_length` en production (§ 14.3 : le numéro du lot arrive en paramètre) ;
redéployer `extract-piece` puis `receive-email` (ce lot) ; un premier import réel des deux côtés, après lequel seulement
`DU_CONTRE_PAYE_PREVU` se lève (DU-Q1 (A)).
