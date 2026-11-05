-- L'ACOMPTE D'UN DEVIS, ÉPROUVÉ EN BASE (espace client, étape P5b2) — à rejouer par `execute_sql` après toute migration qui
-- touche `factures_emises`, `facture_lignes`, `devis_factures`, `enregistrer_facture`, `facturer_devis`,
-- `facturer_acompte_devis`, `centimes_ligne_facture`, les gardes des factures ou des devis. La migration :
-- supabase/preparees/20261105110000_acomptes_des_devis.sql (puis supabase/schema/, le jour de son application) ; le
-- module que la base redit : src/lib/acompteDevis.ts ; le récit : HISTORIQUE.md, « L'ACOMPTE D'UN DEVIS, EN BASE (P5B2)
-- (PRÉPARÉE, PAS APPLIQUÉE) ».
--
-- Ce qui se prouve ici :
--   - LE CATALOGUE : les quatre colonnes, leurs contraintes, la clé de la reprise sans action, son index, les deux gardes
--     neuves, les droits des fonctions (la facture d'acompte aux connectés, ni à l'anonyme ni à PUBLIC ; les fonctions
--     d'appoint et les gardes à aucun rôle de l'API), les policies des trois tables inchangées ;
--   - LES REFUS de `facturer_acompte_devis`, dans l'ordre et sous les mots du module (`REFUS_ACOMPTE`, le dépassement du
--     reste, `refusDeTvaNegative`), chacun à son SQLSTATE ; ceux de `facturer_devis` (un acompte en brouillon, une finale
--     active) et d'`enregistrer_facture` (l'acompte en brouillon retouché, la date du versement hors d'un acompte, une
--     reprise introuvable ou hors de sa finale, l'avoir qui défait trop, l'avoir d'un acompte repris ou partiel, et à la
--     validation : le cumul, P5B-Q5, la finale qui ne reprend pas exactement, qui reprend un acompte crédité, qu'un
--     acompte en brouillon retient, négative à un taux en HT puis en TVA — `refusDeLaFinale`) ; les gardes (la marque, la
--     date du versement, les lignes d'un acompte, la reprise, le rôle du lien) ;
--   - LE PARCOURS d'un devis à deux taux : deux acomptes (un pourcentage, un TTC), validés, la finale qui les reprend au
--     signe opposé, validée, son avoir qui défait ses reprises, puis une NOUVELLE finale (P5B-Q4) ;
--   - LES ARRONDIS : une table de cas relevée par le module (`preparerAcompte`, un script jetable, hors du dépôt), dont
--     ceux de P5B-Q5 (3 x 10,02 € à 20 % : 99,9 % refusé, 99,8 % accepté, 100 % refusé) et une batterie tirée d'une graine
--     fixe : chaque acompte de la base, ses lignes, ses prix et son TTC, ou son refus au mot près, égaux au module ;
--   - et que RIEN ne reste en base.
-- Les défenses que les fonctions rendent inaccessibles (un acompte incohérent avec son devis, le cumul dépassé ou P5B-Q5 à
-- la validation, une finale négative) se jouent sur des acomptes PLANTÉS : un brouillon marqué sous l'annonce que les
-- fonctions posent (`jd.acompte_facture`), lié par le propriétaire, validé au besoin sous `jd.validation_facture`, numéro
-- de la série 9000 ; jamais en désactivant une garde.
--
-- Tout se joue dans deux dossiers JETABLES du cabinet du chef (A, basculé, en trésorerie, où le client de l'essai a un
-- accès d'essai ; B, en engagement), au sein d'un bloc qui s'annule entièrement à la fin (`ANNULATION_ESSAI_GLOBALE`) :
-- chaque contrôle dans sa sous-transaction, annulée elle aussi (`ANNULATION_ESSAI`, P0001) ; les étapes « fait » sont
-- gardées jusqu'à l'annulation finale, et une étape peut rendre une valeur que les suivantes citent (`{CLE}`). Quatre
-- formes abrégées : `VALIDER <dossier> <facture>` et `RETOUCHER …` (enregistrer_facture, la facture et ses lignes telles
-- qu'elles sont, validée ou non), `AVOIR <dossier> <facture>` (l'avoir qui la crédite en entier, ses lignes au signe
-- opposé, reprises comprises), `PLANTER <devis> <prix> <taux> <brouillon|validee> <numéro>`. Un refus se juge à son code
-- ET à son message (`like`, les mots du module). Les verdicts voyagent dans un réglage LOCAL (`essai.acomptes_des_devis`) :
-- le fichier se joue d'un seul appel, ne crée aucun objet et ne porte AUCUNE instruction de retrait de ligne. Hors de
-- l'outil d'exécution, en UNE transaction (`psql -1`). Sans les migrations des devis, il se dit impossible ; sans la
-- sienne, il se joue et le dit : la ligne 0 « EN ATTENTE », ses contrôles en faute.
--
-- LES MUTATIONS (genre « mutation ») rejouent un contrôle avec un profil, une cible ou une saisie délibérément autre :
-- chacune doit MORDRE, c'est-à-dire rendre ce que le contrôle qu'elle vise refuserait.
do $essai$
declare
  client uuid := '797fe440-df8d-4b8e-828b-d148927bfd60';
  chef uuid := 'bd6bd047-0ef0-4c9d-a319-1b642aaf2162';
  cabinet uuid;
  ids jsonb;
  jour date := (now() at time zone 'Europe/Paris')::date;
  avant text; apres text;
  s record; c record; d record; k text; ordre text; attendu text; rendu text; accepte boolean; code_recu text; message text;
  ok boolean; erreur text; en_base boolean; t text[]; fid uuid; dv uuid; num text; ht numeric; tva numeric;
  verdicts jsonb := '[]'::jsonb;
  cas jsonb := $cas$
[
{
"nom": "P5B-Q5 : 3 x 10,02 a 20 %, 99,9 % refuse",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 99.9
},
"attendu": "REFUS:L’acompte laisserait une TVA négative à la facture finale (-0,01 € à 20 %) : la TVA du devis s’arrondit ligne par ligne, celle de l’acompte sur sa part. Demandez un peu moins, ou tirez la facture finale."
},
{
"nom": "P5B-Q5 : 3 x 10,02 a 20 %, 99,8 % accepte",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 99.8
},
"attendu": "LIGNES:Acompte de 99,8 % sur le devis {NUM}|30|20|TTC:3600"
},
{
"nom": "P5B-Q5 : 100 % refuse",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 100
},
"attendu": "REFUS:L’acompte couvrirait tout ce qui reste du devis : le solde se facture par la facture finale, jamais par un acompte."
},
{
"nom": "64,6 % de 2,50",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 2.5,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 2.5,
"montant_tva": 0.5,
"montant_ttc": 3
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 64.6
},
"attendu": "LIGNES:Acompte de 64,6 % sur le devis {NUM}|1.62|20|TTC:194"
},
{
"nom": "trois taux, 30 %",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 125.5,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 80,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 15.33,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 376.99,
"montant_tva": 60.73,
"montant_ttc": 437.72
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 30
},
"attendu": "LIGNES:Acompte de 30 % sur le devis {NUM} — TVA 20 %|75.3|20;Acompte de 30 % sur le devis {NUM} — TVA 10 %|24|10;Acompte de 30 % sur le devis {NUM} — TVA 5,5 %|13.8|5.5|TTC:13132"
},
{
"nom": "TTC inaccessible : 0,03",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 1,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 1,
"montant_tva": 0.2,
"montant_ttc": 1.2
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 3
},
"attendu": "LIGNES:Acompte de 0,03 € TTC sur le devis {NUM}|0.02|20|TTC:2"
},
{
"nom": "trois taux, TTC 123,45",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 125.5,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 80,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 15.33,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 376.99,
"montant_tva": 60.73,
"montant_ttc": 437.72
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 12345
},
"attendu": "LIGNES:Acompte de 123,45 € TTC sur le devis {NUM} — TVA 20 %|70.79|20;Acompte de 123,45 € TTC sur le devis {NUM} — TVA 10 %|22.56|10;Acompte de 123,45 € TTC sur le devis {NUM} — TVA 5,5 %|12.97|5.5|TTC:12345"
},
{
"nom": "deux acomptes puis 40 % : depassement",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 125.5,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 80,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 15.33,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 376.99,
"montant_tva": 60.73,
"montant_ttc": 437.72
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 40
},
{
"mode": "pourcentage",
"pourcentage": 30
}
],
"demande": {
"mode": "pourcentage",
"pourcentage": 40
},
"attendu": "REFUS:L’acompte (150,80 € HT) dépasse ce qui reste à facturer du devis (113,09 € HT)."
},
{
"nom": "TTC apres un acompte",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 125.5,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 80,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 15.33,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 376.99,
"montant_tva": 60.73,
"montant_ttc": 437.72
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 50
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 10000
},
"attendu": "LIGNES:Acompte de 100,00 € TTC sur le devis {NUM} — TVA 20 %|57.34|20;Acompte de 100,00 € TTC sur le devis {NUM} — TVA 10 %|18.28|10;Acompte de 100,00 € TTC sur le devis {NUM} — TVA 5,5 %|10.5|5.5|TTC:10000"
},
{
"nom": "TTC au-dela du reste",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 125.5,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 80,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 15.33,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 376.99,
"montant_tva": 60.73,
"montant_ttc": 437.72
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 50
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 999999
},
"attendu": "REFUS:L’acompte (9 999,99 € TTC) dépasse ce qui reste à facturer du devis (218,85 € TTC)."
},
{
"nom": "moins d un centime",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 0.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 0.02,
"montant_tva": 0,
"montant_ttc": 0.02
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 1
},
"attendu": "REFUS:Ce pourcentage du devis fait moins d’un centime."
},
{
"nom": "restes egaux : l ordre du devis",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 1,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 1,
"taux_tva": 10
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 1,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 3,
"montant_tva": 0.36,
"montant_ttc": 3.36
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 33.33
},
"attendu": "LIGNES:Acompte de 33,33 % sur le devis {NUM} — TVA 20 %|0.34|20;Acompte de 33,33 % sur le devis {NUM} — TVA 10 %|0.33|10;Acompte de 33,33 % sur le devis {NUM} — TVA 5,5 %|0.33|5.5|TTC:112"
},
{
"nom": "pourcentage trop precis",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 33.333
},
"attendu": "REFUS:Le pourcentage de l’acompte s’écrit au centième près."
},
{
"nom": "pourcentage nul",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 0
},
"attendu": "REFUS:Le pourcentage de l’acompte se situe au-delà de 0 % et jusqu’à 100 %."
},
{
"nom": "pourcentage au-dela de 100",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 100.01
},
"attendu": "REFUS:Le pourcentage de l’acompte se situe au-delà de 0 % et jusqu’à 100 %."
},
{
"nom": "TTC nul",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 0
},
"attendu": "REFUS:Le montant de l’acompte doit être positif."
},
{
"nom": "TTC fractionnaire",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 10.5
},
"attendu": "REFUS:Le montant de l’acompte s’écrit au centime près."
},
{
"nom": "une remise sur la ligne",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 100,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": -10,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 90,
"montant_tva": 18,
"montant_ttc": 108
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 50
},
"attendu": "LIGNES:Acompte de 50 % sur le devis {NUM}|45|20|TTC:5400"
},
{
"nom": "TTC sur 0 % et 20 %",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 50,
"taux_tva": 0
},
{
"designation": "ligne 2",
"quantite": 2,
"prix_unitaire_ht": 10,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 70,
"montant_tva": 4,
"montant_ttc": 74
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 3000
},
"attendu": "LIGNES:Acompte de 30,00 € TTC sur le devis {NUM} — TVA 0 %|20.27|0;Acompte de 30,00 € TTC sur le devis {NUM} — TVA 20 %|8.11|20|TTC:3000"
},
{
"nom": "quantite decimale, le demi",
"devis": [
{
"designation": "ligne 1",
"quantite": 2.5,
"prix_unitaire_ht": 32.05,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 80.13,
"montant_tva": 16.03,
"montant_ttc": 96.16
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 12.5
},
"attendu": "LIGNES:Acompte de 12,5 % sur le devis {NUM}|10.02|20|TTC:1202"
},
{
"nom": "apres un acompte, le TTC de tout le reste",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 10.02,
"taux_tva": 20
}
],
"totaux": {
"montant_ht": 30.06,
"montant_tva": 6,
"montant_ttc": 36.06
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 50
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 1803
},
"attendu": "REFUS:L’acompte laisserait une TVA négative à la facture finale (-0,01 € à 20 %) : la TVA du devis s’arrondit ligne par ligne, celle de l’acompte sur sa part. Demandez un peu moins, ou tirez la facture finale."
},
{
"nom": "grand devis, 17,29 %",
"devis": [
{
"designation": "ligne 1",
"quantite": 120,
"prix_unitaire_ht": 47.83,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 7,
"prix_unitaire_ht": 1234.56,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 14381.52,
"montant_tva": 2012.11,
"montant_ttc": 16393.63
},
"avant": [],
"demande": {
"mode": "pourcentage",
"pourcentage": 17.29
},
"attendu": "LIGNES:Acompte de 17,29 % sur le devis {NUM} — TVA 20 %|992.37|20;Acompte de 17,29 % sur le devis {NUM} — TVA 10 %|1494.19|10|TTC:283445"
},
{
"nom": "tire 1",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 113.69,
"taux_tva": 5.5
}
],
"totaux": {
"montant_ht": 227.38,
"montant_tva": 12.51,
"montant_ttc": 239.89
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 29.6
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 13434
},
"attendu": "LIGNES:Acompte de 134,34 € TTC sur le devis {NUM}|127.34|5.5|TTC:13434"
},
{
"nom": "tire 2",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 469.75,
"taux_tva": 0
}
],
"totaux": {
"montant_ht": 469.75,
"montant_tva": 0,
"montant_ttc": 469.75
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 20316
},
"attendu": "LIGNES:Acompte de 203,16 € TTC sur le devis {NUM}|203.16|0|TTC:20316"
},
{
"nom": "tire 3",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 420.32,
"taux_tva": 0
}
],
"totaux": {
"montant_ht": 840.64,
"montant_tva": 0,
"montant_ttc": 840.64
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 24.58
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 30482
},
"attendu": "LIGNES:Acompte de 304,82 € TTC sur le devis {NUM}|304.82|0|TTC:30482"
},
{
"nom": "tire 4",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 118.86,
"taux_tva": 2.1
}
],
"totaux": {
"montant_ht": 237.72,
"montant_tva": 4.99,
"montant_ttc": 242.71
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 19.41
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 6772
},
"attendu": "LIGNES:Acompte de 67,72 € TTC sur le devis {NUM}|66.33|2.1|TTC:6772"
},
{
"nom": "tire 5",
"devis": [
{
"designation": "ligne 1",
"quantite": 3,
"prix_unitaire_ht": 40.35,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 358.51,
"taux_tva": 2.1
},
{
"designation": "ligne 3",
"quantite": 2,
"prix_unitaire_ht": 431.59,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 1342.74,
"montant_tva": 118.06,
"montant_ttc": 1460.8
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 46.47
}
],
"demande": {
"mode": "pourcentage",
"pourcentage": 8.61
},
"attendu": "LIGNES:Acompte de 8,61 % sur le devis {NUM} — TVA 20 %|10.42|20;Acompte de 8,61 % sur le devis {NUM} — TVA 2,1 %|30.87|2.1;Acompte de 8,61 % sur le devis {NUM} — TVA 10 %|74.32|10|TTC:12577"
},
{
"nom": "tire 6",
"devis": [
{
"designation": "ligne 1",
"quantite": 3,
"prix_unitaire_ht": 393.04,
"taux_tva": 5.5
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 305.62,
"taux_tva": 2.1
},
{
"designation": "ligne 3",
"quantite": 2,
"prix_unitaire_ht": 127.86,
"taux_tva": 2.1
}
],
"totaux": {
"montant_ht": 1740.46,
"montant_tva": 76.64,
"montant_ttc": 1817.1
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 66423
},
"attendu": "LIGNES:Acompte de 664,23 € TTC sur le devis {NUM} — TVA 5,5 %|431.02|5.5;Acompte de 664,23 € TTC sur le devis {NUM} — TVA 2,1 %|205.19|2.1|TTC:66423"
},
{
"nom": "tire 7",
"devis": [
{
"designation": "ligne 1",
"quantite": 3,
"prix_unitaire_ht": 25.78,
"taux_tva": 5.5
},
{
"designation": "ligne 2",
"quantite": 2,
"prix_unitaire_ht": 477.52,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 1,
"prix_unitaire_ht": 1.3,
"taux_tva": 5.5
},
{
"designation": "ligne 4",
"quantite": 1,
"prix_unitaire_ht": 312.22,
"taux_tva": 2.1
}
],
"totaux": {
"montant_ht": 1345.9,
"montant_tva": 201.89,
"montant_ttc": 1547.79
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 34.05
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 34991
},
"attendu": "LIGNES:Acompte de 349,91 € TTC sur le devis {NUM} — TVA 5,5 %|17.78|5.5;Acompte de 349,91 € TTC sur le devis {NUM} — TVA 20 %|215.91|20;Acompte de 349,91 € TTC sur le devis {NUM} — TVA 2,1 %|70.58|2.1|TTC:34991"
},
{
"nom": "tire 8",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 454.83,
"taux_tva": 10
},
{
"designation": "ligne 2",
"quantite": 1,
"prix_unitaire_ht": 180.74,
"taux_tva": 0
}
],
"totaux": {
"montant_ht": 635.57,
"montant_tva": 45.48,
"montant_ttc": 681.05
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 2352
},
"attendu": "LIGNES:Acompte de 23,52 € TTC sur le devis {NUM} — TVA 10 %|15.71|10;Acompte de 23,52 € TTC sur le devis {NUM} — TVA 0 %|6.24|0|TTC:2352"
},
{
"nom": "tire 9",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 448.7,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 897.4,
"montant_tva": 89.74,
"montant_ttc": 987.14
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 18.96
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 26120
},
"attendu": "LIGNES:Acompte de 261,20 € TTC sur le devis {NUM}|237.45|10|TTC:26120"
},
{
"nom": "tire 10",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 7.52,
"taux_tva": 5.5
},
{
"designation": "ligne 2",
"quantite": 3,
"prix_unitaire_ht": 301.01,
"taux_tva": 5.5
},
{
"designation": "ligne 3",
"quantite": 3,
"prix_unitaire_ht": 426.97,
"taux_tva": 2.1
},
{
"designation": "ligne 4",
"quantite": 2,
"prix_unitaire_ht": 87.1,
"taux_tva": 2.1
}
],
"totaux": {
"montant_ht": 2365.66,
"montant_tva": 80.64,
"montant_ttc": 2446.3
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 24.24
}
],
"demande": {
"mode": "pourcentage",
"pourcentage": 57.9
},
"attendu": "LIGNES:Acompte de 57,9 % sur le devis {NUM} — TVA 5,5 %|527.21|5.5;Acompte de 57,9 % sur le devis {NUM} — TVA 2,1 %|842.51|2.1|TTC:141641"
},
{
"nom": "tire 11",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 138.5,
"taux_tva": 0
}
],
"totaux": {
"montant_ht": 138.5,
"montant_tva": 0,
"montant_ttc": 138.5
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 42.72
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 6337
},
"attendu": "LIGNES:Acompte de 63,37 € TTC sur le devis {NUM}|63.37|0|TTC:6337"
},
{
"nom": "tire 12",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 117.63,
"taux_tva": 2.1
},
{
"designation": "ligne 2",
"quantite": 3,
"prix_unitaire_ht": 102.35,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 542.31,
"montant_tva": 35.65,
"montant_ttc": 577.96
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 26728
},
"attendu": "LIGNES:Acompte de 267,28 € TTC sur le devis {NUM} — TVA 2,1 %|108.8|2.1;Acompte de 267,28 € TTC sur le devis {NUM} — TVA 10 %|142|10|TTC:26728"
},
{
"nom": "tire 13",
"devis": [
{
"designation": "ligne 1",
"quantite": 1,
"prix_unitaire_ht": 424.05,
"taux_tva": 20
},
{
"designation": "ligne 2",
"quantite": 3,
"prix_unitaire_ht": 111.86,
"taux_tva": 20
},
{
"designation": "ligne 3",
"quantite": 2,
"prix_unitaire_ht": 440.77,
"taux_tva": 0
},
{
"designation": "ligne 4",
"quantite": 1,
"prix_unitaire_ht": 170.29,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 1811.46,
"montant_tva": 168.96,
"montant_ttc": 1980.42
},
"avant": [
{
"mode": "pourcentage",
"pourcentage": 23.24
}
],
"demande": {
"mode": "ttc",
"ttcCentimes": 14483
},
"attendu": "LIGNES:Acompte de 144,83 € TTC sur le devis {NUM} — TVA 20 %|55.55|20;Acompte de 144,83 € TTC sur le devis {NUM} — TVA 0 %|64.47|0;Acompte de 144,83 € TTC sur le devis {NUM} — TVA 10 %|12.45|10|TTC:14483"
},
{
"nom": "tire 14",
"devis": [
{
"designation": "ligne 1",
"quantite": 2,
"prix_unitaire_ht": 235.71,
"taux_tva": 10
},
{
"designation": "ligne 2",
"quantite": 2,
"prix_unitaire_ht": 443.21,
"taux_tva": 0
},
{
"designation": "ligne 3",
"quantite": 2,
"prix_unitaire_ht": 396.18,
"taux_tva": 2.1
},
{
"designation": "ligne 4",
"quantite": 1,
"prix_unitaire_ht": 174.19,
"taux_tva": 10
}
],
"totaux": {
"montant_ht": 2324.39,
"montant_tva": 81.2,
"montant_ttc": 2405.59
},
"avant": [],
"demande": {
"mode": "ttc",
"ttcCentimes": 138290
},
"attendu": "LIGNES:Acompte de 1 382,90 € TTC sur le devis {NUM} — TVA 10 %|371.14|10;Acompte de 1 382,90 € TTC sur le devis {NUM} — TVA 0 %|509.58|0;Acompte de 1 382,90 € TTC sur le devis {NUM} — TVA 2,1 %|455.5|2.1|TTC:138290"
}
]
$cas$;
begin
  if to_regclass('public.devis') is null or to_regprocedure('public.supprimer_brouillon_devis(uuid, uuid)') is null then
    raise exception 'ESSAI_IMPOSSIBLE : les migrations des devis ne sont pas en base';
  end if;
  en_base := exists (select 1 from pg_attribute where attrelid = 'public.factures_emises'::regclass and attname = 'acompte'
                      and not attisdropped);
  select ca.cabinet_id into cabinet from cabinet_admins ca where ca.user_id = chef and ca.role = 'comptable_en_chef'
   order by ca.cabinet_id limit 1;
  if cabinet is null or exists (select 1 from cabinet_admins where user_id = client)
     or exists (select 1 from super_admins where user_id = client)
     or not exists (select 1 from memberships where user_id = client) then
    raise exception 'ESSAI_IMPOSSIBLE : jeu de départ introuvable, ou comptes rattachés autrement qu''attendu';
  end if;

  ids := jsonb_build_object('CLIENT', client, 'CHEF', chef, 'CAB', cabinet,
    'DA', 'acc00000-0000-4000-8000-0000000000a1', 'DB', 'acc00000-0000-4000-8000-0000000000b1',
    'ACCES', 'acc00000-0000-4000-8000-0000000000c1',
    'JOUR', to_char(jour, 'YYYY-MM-DD'), 'HIER', to_char(jour - 1, 'YYYY-MM-DD'), 'AVANTHIER', to_char(jour - 2, 'YYYY-MM-DD'),
    'JOURFR', to_char(jour, 'DD/MM/YYYY'), 'AN', to_char(jour, 'YYYY'));

  select string_agg(n::text, '/') into avant from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from devis)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)),
    ((select count(*) from devis_numerotation)), ((select count(*) from facture_numerotation))
  ) as x(n);

  verdicts := verdicts || jsonb_build_object('controle', '0. la migration acomptes_des_devis est en base (son témoin : la colonne factures_emises.acompte)',
    'genre', case when en_base then 'controle' else 'attente' end,
    'observe', case when en_base then 'présente' else 'absente : les contrôles qui la demandent sont en faute' end, 'ok', en_base);

  begin
    for s in select * from (values
      -- (numéro, genre, contrôle, qui, droits de l'accès d'essai, ordre, code attendu ou OK, message ou valeur attendus, clé)

      -- ══ Le jeu : deux dossiers, un accès d'essai, des devis émis et acceptés par leurs fonctions ══════════
      ('j1', 'jeu', 'dossiers jetables A (basculé, trésorerie) et B (engagement)', 'proprietaire', null,
        $q$insert into dossiers (id, nom, cabinet_id, statut_tva, assujetti_tva, ventes_par_les_factures, forme_juridique,
             denomination_imprimee, siret, adresse, mode_comptable) values
          ('{DA}', 'ESSAI ACOMPTE A', '{CAB}', 'redevable', true, true, '5710', 'ESSAI ACOMPTE A SAS', '12345678200010', '1 rue de l''Essai, 75001 Paris', 'tresorerie'),
          ('{DB}', 'ESSAI ACOMPTE B', '{CAB}', 'redevable', true, false, '5710', 'ESSAI ACOMPTE B SAS', '12345678200028', '2 rue de l''Essai, 75001 Paris', 'engagement')$q$, 'OK', null, null),
      ('j2', 'jeu', 'l''accès d''essai du client au dossier A', 'proprietaire', null,
        $q$insert into memberships (id, user_id, dossier_id, role, email) values ('{ACCES}', '{CLIENT}', '{DA}', 'client', 'essai-acompte@exemple.invalid')$q$, 'OK', null, null),
      ('j3', 'jeu', 'DV1 : 1 000 € à 20 % et 500 € à 10 %', 'chef', null, $q$DEVIS {DA} [{"designation":"ESSAI-A-20","quantite":1,"prix_unitaire_ht":1000,"taux_tva":20},{"designation":"ESSAI-A-10","quantite":1,"prix_unitaire_ht":500,"taux_tva":10}] 1500 250 1750 acceptee$q$, 'OK', null, 'DV1'),
      ('j4', 'jeu', 'DV2 : 3 x 10,02 € à 20 %', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20},{"designation":"c","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20}] 30.06 6.00 36.06 acceptee$q$, 'OK', null, 'DV2'),
      ('j5', 'jeu', 'DV3, émis sans réponse', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 emis$q$, 'OK', null, 'DV3'),
      ('j6', 'jeu', 'DVB, accepté, dans le dossier en engagement', 'chef', null, $q$DEVIS {DB} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DVB'),
      ('j7', 'jeu', 'DV6 : 2 x 0,02 € à 20 % (aucune TVA)', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":0.02,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":0.02,"taux_tva":20}] 0.04 0 0.04 acceptee$q$, 'OK', null, 'DV6'),
      ('j8', 'jeu', 'DV5, DV8, DV10, DV11, DV13 : 100 € à 20 %', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DV5'),
      ('j9', 'jeu', 'DV8', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DV8'),
      ('j10', 'jeu', 'DV9 : 100 € à 20 % et 100 € à 10 %', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":100,"taux_tva":10}] 200 30 230 acceptee$q$, 'OK', null, 'DV9'),
      ('j11', 'jeu', 'DV10', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DV10'),
      ('j12', 'jeu', 'DV11', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DV11'),
      ('j13', 'jeu', 'DV12 : 3 x 10,02 € à 20 %', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20},{"designation":"b","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20},{"designation":"c","quantite":1,"prix_unitaire_ht":10.02,"taux_tva":20}] 30.06 6.00 36.06 acceptee$q$, 'OK', null, 'DV12'),
      ('j14', 'jeu', 'DV13', 'chef', null, $q$DEVIS {DA} [{"designation":"a","quantite":1,"prix_unitaire_ht":100,"taux_tva":20}] 100 20 120 acceptee$q$, 'OK', null, 'DV13'),
      ('j15', 'jeu', 'X0, une facture brouillon sans devis', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI X0","date_emission":"{JOUR}","nature_operation":"services","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) e$q$, 'OK', null, 'X0'),
      ('j16', 'jeu', 'le numéro de DV1', 'proprietaire', null, $q$select numero from devis where id = '{DV1}'$q$, 'OK', null, 'NUM1'),
      -- Une facture validée ouvre la série du dossier A : la porte de la restauration (le super-administrateur dans un dossier
      -- sans série, `restauration_des_factures`) s'y ferme, et le chef, s'il est aussi super-administrateur, écrit comme un
      -- membre du cabinet.
      ('j17', 'jeu', 'X1, une facture validée qui ouvre la série du dossier A', 'chef', null,
        $q$select e.numero from enregistrer_facture('{DA}', null, '{"tiers_nom":"ESSAI X1","date_emission":"{JOUR}","nature_operation":"services","montant_ht":10,"montant_tva":2,"montant_ttc":12}'::jsonb, '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, true) e$q$, 'OK', null, 'NX1'),

      -- ══ 1 à 6. Le catalogue ══════════
      ('1', 'valeur', 'les quatre colonnes : la marque (faux, non nul), la date du versement, la reprise, le rôle (« finale » par défaut)', 'proprietaire', null,
        $q$select string_agg(x.col, ' | ' order by x.col collate "C") from (select a.attrelid::regclass::text || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '') || case when a.attnotnull then ' not null' else '' end as col
             from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
            where (a.attrelid, a.attname) in (('public.factures_emises'::regclass, 'acompte'), ('public.factures_emises'::regclass, 'date_versement_acompte'),
              ('public.facture_lignes'::regclass, 'reprise_facture_id'), ('public.devis_factures'::regclass, 'role'))) as x$q$,
        'OK', 'devis_factures.role text default ''finale''::text not null | facture_lignes.reprise_facture_id uuid | factures_emises.acompte boolean default false not null | factures_emises.date_versement_acompte date', null),
      ('2', 'valeur', 'leurs contraintes : une facture, jamais un avoir ; le versement d''un acompte, autre jour ; deux rôles ; la reprise sans action à la suppression', 'proprietaire', null,
        $q$select string_agg(conname || ' ' || pg_get_constraintdef(oid), ' | ' order by conname collate "C") from pg_constraint
            where conname in ('factures_emises_acompte_d_une_facture', 'factures_emises_versement_d_un_acompte', 'devis_factures_role_check', 'facture_lignes_reprise_facture_id_fkey')$q$,
        'OK', 'devis_factures_role_check CHECK ((role = ANY (ARRAY[''acompte''::text, ''finale''::text]))) | facture_lignes_reprise_facture_id_fkey FOREIGN KEY (reprise_facture_id) REFERENCES factures_emises(id) | factures_emises_acompte_d_une_facture CHECK (((NOT acompte) OR (type = ''facture''::text))) | factures_emises_versement_d_un_acompte CHECK (((date_versement_acompte IS NULL) OR (acompte AND (date_versement_acompte <> date_emission))))', null),
      ('3', 'valeur', 'l''index de la reprise', 'proprietaire', null,
        $q$select indexdef from pg_indexes where schemaname = 'public' and indexname = 'facture_lignes_reprise_facture_id_idx'$q$,
        'OK', 'CREATE INDEX facture_lignes_reprise_facture_id_idx ON public.facture_lignes USING btree (reprise_facture_id)', null),
      ('4', 'valeur', 'les deux gardes neuves : avant l''insertion et la mise à jour d''une facture, avant toute écriture d''une ligne, après les gardes d''hier (l''ordre des noms)', 'proprietaire', null,
        $q$select string_agg(tgrelid::regclass::text || ' ' || tgname || ' ' || tgfoid::regproc::text || ' ' || tgtype::text, ' | ' order by tgname collate "C") from pg_trigger
            where tgname in ('factures_emises_marque_d_acompte', 'facture_lignes_gardes_d_acompte')$q$,
        'OK', 'facture_lignes facture_lignes_gardes_d_acompte garder_lignes_d_acompte 31 | factures_emises factures_emises_marque_d_acompte garder_marque_d_acompte 23', null),
      ('5', 'valeur', 'les droits : la facture d''acompte aux connectés (security definer, chemin fixé), ni à l''anonyme ni à PUBLIC ; les fonctions d''appoint et les gardes à aucun rôle de l''API', 'proprietaire', null,
        $q$select string_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') || ':'
               || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('anon', p.oid, 'execute')::text, ' | ' order by p.proname collate "C")
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('facturer_acompte_devis', 'acompte_en_euros', 'acompte_en_taux',
               'acomptes_en_vigueur', 'finale_active_du_devis', 'acompte_repartir_sur_les_restes', 'acompte_refus_de_la_finale_laissee', 'garder_marque_d_acompte', 'garder_lignes_d_acompte')$q$,
        'OK', 'acompte_en_euros:false:search_path=public:false:false | acompte_en_taux:false:search_path=public:false:false | acompte_refus_de_la_finale_laissee:false:search_path=public:false:false | acompte_repartir_sur_les_restes:false:search_path=public:false:false | acomptes_en_vigueur:false:search_path=public:false:false | facturer_acompte_devis:true:search_path=public:true:false | finale_active_du_devis:false:search_path=public:false:false | garder_lignes_d_acompte:true:search_path=public:false:false | garder_marque_d_acompte:true:search_path=public:false:false', null),
      ('6', 'valeur', 'les policies des trois tables, inchangées', 'proprietaire', null,
        $q$select string_agg(polrelid::regclass::text || '.' || polname, ' | ' order by polname collate "C") from pg_policy
            where polrelid in ('public.factures_emises'::regclass, 'public.facture_lignes'::regclass, 'public.devis_factures'::regclass)$q$,
        'OK', 'devis_factures.devis_factures_lecture | devis_factures.devis_factures_lecture_ventes | devis_factures.devis_factures_restauration | facture_lignes.facture_lignes_all | facture_lignes.facture_lignes_lecture_ventes | factures_emises.factures_emises_all | factures_emises.factures_emises_lecture_ventes', null),

      -- ══ 10 à 19. Les refus de la facture d'acompte : l'accès, le devis, l'état, la saisie ══════════
      ('10', 'controle', 'le client sans « Ventes » : refusé avant toute lecture', 'client', 'aucun',
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '42501', 'Accès refusé à ce dossier.', null),
      ('M10', 'mutation', 'le contrôle 10 rejoué avec « Ventes » : le brouillon se tire', 'client', 'ventes',
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('11', 'controle', 'un devis d''un autre dossier : introuvable', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DVB}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'P0002', 'Devis introuvable dans ce dossier.', null),
      ('12', 'controle', 'un devis émis sans réponse : pas accepté', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV3}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Le devis n’est pas accepté : un acompte ne se facture que sur un devis accepté.', null),
      ('M12', 'mutation', 'le contrôle 12 rejoué sur un devis accepté', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('13', 'controle', 'un dossier en engagement', 'chef', null,
        $q$select facturer_acompte_devis('{DB}', '{DVB}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Le dossier tient sa comptabilité en engagement : l’acompte d’un devis ne s’y facture pas encore (son compte, le 4191, viendra avec l’engagement).', null),
      ('M13', 'mutation', 'le contrôle 11 rejoué dans le bon dossier : le refus de l''engagement', 'chef', null,
        $q$select facturer_acompte_devis('{DB}', '{DVB}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Le dossier tient sa comptabilité en engagement%', null),
      ('14', 'controle', 'une demande d''une autre forme', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"autre","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'La demande d’acompte est un pourcentage ou un montant TTC.', null),
      ('M14', 'mutation', 'le contrôle 14 rejoué en pourcentage', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('15', 'controle', 'un pourcentage écrit en texte : hors des bornes', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":"10"}'::jsonb, null)::text$q$, '22023', 'Le pourcentage de l’acompte se situe au-delà de 0 % et jusqu’à 100 %.', null),
      ('M15', 'mutation', 'les bornes : 99,99 % du devis DV1 se tire', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":99.99}'::jsonb, null)::text$q$, 'OK', null, null),
      ('M16', 'mutation', 'trop précis : 33,33 % se tire', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":33.33}'::jsonb, null)::text$q$, 'OK', null, null),
      ('M17', 'mutation', 'non positif : un centime TTC se tire', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"ttc","ttcCentimes":1}'::jsonb, null)::text$q$, 'OK', null, null),
      ('M18', 'mutation', 'fractionnaire : 10 centimes TTC se tirent', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"ttc","ttcCentimes":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('19', 'controle', 'moins d''un centime : 1 % de 0,04 €', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV6}', '{"mode":"pourcentage","pourcentage":1}'::jsonb, null)::text$q$, '22023', 'Ce pourcentage du devis fait moins d’un centime.', null),
      ('M19', 'mutation', 'le contrôle 19 à 50 % : un centime', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV6}', '{"mode":"pourcentage","pourcentage":50}'::jsonb, null)::text$q$, 'OK', null, null),
      ('M20', 'mutation', 'P5B-Q5 : 99,8 % de DV2 se tire', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":99.8}'::jsonb, null)::text$q$, 'OK', null, null),
      ('M21', 'mutation', 'P5B-Q5 : 99 % de DV2 se tire', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":99}'::jsonb, null)::text$q$, 'OK', null, null),

      -- ══ 30 à 59. Le parcours de DV1 ══════════
      ('30', 'fait', 'le chef tire A1, 30 % de DV1, versé la veille', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":30}'::jsonb, '{HIER}')::text$q$, 'OK', null, 'A1'),
      ('30b', 'valeur', 'A1 : une ligne par taux, au prorata du reste ; marqué, brouillon, versé la veille ; ses totaux', 'proprietaire', null,
        $q$select string_agg(trim_scale(l.quantite)::text || '|' || l.designation || '|' || trim_scale(l.prix_unitaire_ht)::text || '|' || trim_scale(l.taux_tva)::text || '|' || coalesce(l.reprise_facture_id::text, '-'), ';' order by l.ordre)
             || ' ' || (select f.acompte::text || '/' || f.statut || '/' || coalesce(f.date_versement_acompte::text, '-') || '/' || f.montant_ht || '/' || f.montant_tva || '/' || f.montant_ttc
                          || '/' || (select r.role from devis_factures r where r.facture_id = f.id) from factures_emises f where f.id = '{A1}')
             from facture_lignes l where l.facture_id = '{A1}'$q$,
        'OK', '1|Acompte de 30 % sur le devis {NUM1} — TVA 20 %|300|20|-;1|Acompte de 30 % sur le devis {NUM1} — TVA 10 %|150|10|- true/brouillon/{HIER}/450.00/75.00/525.00/acompte', null),
      ('31', 'controle', 'un second acompte pendant que A1 est en brouillon', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer un autre.', null),
      ('M31', 'mutation', 'le contrôle 31 rejoué sur DV2, sans brouillon', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('32', 'controle', 'la facture finale, pendant que A1 est en brouillon', 'chef', null,
        $q$select facturer_devis('{DA}', '{DV1}')::text$q$, '22023', 'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer la facture finale.', null),
      ('M32', 'mutation', 'le contrôle 32 rejoué sur DV2 : sa finale se tire', 'chef', null,
        $q$select facturer_devis('{DA}', '{DV2}')::text$q$, 'OK', null, null),
      ('33', 'controle', 'A1 retouché dans ses lignes', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{A1}', (select to_jsonb(f) from factures_emises f where f.id = '{A1}'), '[{"designation":"x","quantite":1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, false) e$q$,
        '22023', 'Les lignes et les montants d’une facture d’acompte se calculent du devis : ils ne se retouchent pas. Supprimez le brouillon pour en tirer un autre.', null),
      ('34', 'controle', 'A1 retouché dans ses montants', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{A1}', (select to_jsonb(f) || '{"montant_ttc":1}'::jsonb from factures_emises f where f.id = '{A1}'), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva) order by l.ordre) from facture_lignes l where l.facture_id = '{A1}'), false) e$q$,
        '22023', 'Les lignes et les montants d’une facture d’acompte se calculent du devis%', null),
      ('M33', 'mutation', 'les contrôles 33 et 34 rejoués sans rien changer : le brouillon se réenregistre', 'chef', null, $q$RETOUCHER {DA} {A1}$q$, 'OK', null, null),
      ('35', 'controle', 'la garde : la marque posée en direct', 'chef', null,
        $q$with u as (update factures_emises set acompte = true where id = '{X0}' returning 1) select count(*)::text from u$q$, '42501', 'La marque d’acompte d’une facture et la date du versement ne se posent que par facturer_acompte_devis et enregistrer_facture.', null),
      ('36', 'controle', 'la garde : la date du versement posée en direct', 'chef', null,
        $q$with u as (update factures_emises set date_versement_acompte = '{AVANTHIER}' where id = '{A1}' returning 1) select count(*)::text from u$q$, '42501', 'La marque d’acompte d’une facture et la date du versement%', null),
      ('M35', 'mutation', 'les contrôles 35 et 36 rejoués sur les notes : la mise à jour passe', 'chef', null,
        $q$with u as (update factures_emises set notes = 'essai' where id = '{A1}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('37', 'controle', 'la garde : une facture qui naît marquée', 'chef', null,
        $q$insert into factures_emises (dossier_id, tiers_nom, date_emission, montant_ht, montant_tva, montant_ttc, acompte) values ('{DA}', 'ESSAI', '{JOUR}', 0, 0, 0, true)$q$, '42501', 'Une facture ne naît pas facture d’acompte : elle se tire d’un devis accepté par facturer_acompte_devis.', null),
      ('M37', 'mutation', 'le contrôle 37 rejoué sans la marque', 'chef', null,
        $q$insert into factures_emises (dossier_id, tiers_nom, date_emission, montant_ht, montant_tva, montant_ttc, acompte) values ('{DA}', 'ESSAI', '{JOUR}', 0, 0, 0, false)$q$, 'OK', null, null),
      ('38', 'controle', 'la garde : une ligne de A1 changée en direct', 'chef', null,
        $q$with u as (update facture_lignes set prix_unitaire_ht = 1 where facture_id = '{A1}' returning 1) select count(*)::text from u$q$, '42501', 'Les lignes d’une facture d’acompte se calculent du devis : elles ne se retouchent pas.', null),
      ('39', 'controle', 'la garde : une ligne ajoutée à A1', 'chef', null,
        $q$insert into facture_lignes (facture_id, ordre, designation, quantite, prix_unitaire_ht, taux_tva) values ('{A1}', 9, 'x', 1, 1, 20)$q$, '42501', 'Les lignes d’une facture d’acompte se calculent du devis%', null),
      ('M38', 'mutation', 'les contrôles 38 et 39 rejoués sur X0 : la ligne change', 'chef', null,
        $q$with u as (update facture_lignes set prix_unitaire_ht = 1 where facture_id = '{X0}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('40', 'controle', 'la garde : une reprise posée en direct', 'chef', null,
        $q$with u as (update facture_lignes set reprise_facture_id = '{A1}' where facture_id = '{X0}' returning 1) select count(*)::text from u$q$, '42501', 'Une ligne ne reprend un acompte que par facturer_devis ou enregistrer_facture.', null),
      ('M40', 'mutation', 'le contrôle 40 rejoué sur la désignation : la ligne change', 'chef', null,
        $q$with u as (update facture_lignes set designation = 'y' where facture_id = '{X0}' returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('41', 'controle', 'la garde des liens : une facture d''acompte liée comme finale', 'proprietaire', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id, role) values ('{DA}', '{DV1}', '{A1}', 'finale')$q$, '23514', 'Le lien d’un devis à une facture d’acompte porte le rôle « acompte », celui d’une autre facture le rôle « finale ».', null),
      ('M41', 'mutation', 'le contrôle 41 rejoué au rôle « acompte » : la garde passe, l''unicité du lien parle', 'proprietaire', null,
        $q$insert into devis_factures (dossier_id, devis_id, facture_id, role) values ('{DA}', '{DV1}', '{A1}', 'acompte')$q$, '23505', '%devis_factures_une_facture_un_devis%', null),
      ('42', 'controle', 'la date du versement sur une facture qui n''est pas un acompte', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{X0}', (select to_jsonb(f) || jsonb_build_object('date_versement_acompte', '{HIER}') from factures_emises f where f.id = '{X0}'), '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) e$q$,
        '22023', 'La date du versement ne se porte que sur une facture d’acompte.', null),
      ('M42', 'mutation', 'le contrôle 42 rejoué sans la date', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{X0}', (select to_jsonb(f) from factures_emises f where f.id = '{X0}'), '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20}]'::jsonb, false) e$q$, 'OK', null, null),
      ('43', 'fait', 'A1 réenregistré, versé le jour de sa date : la date du versement ne se dit pas', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{A1}', (select to_jsonb(f) || jsonb_build_object('date_versement_acompte', '{JOUR}') from factures_emises f where f.id = '{A1}'), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva) order by l.ordre) from facture_lignes l where l.facture_id = '{A1}'), false) e$q$, 'OK', null, null),
      ('43b', 'valeur', 'sa date du versement : nulle', 'proprietaire', null, $q$select coalesce(date_versement_acompte::text, '-') from factures_emises where id = '{A1}'$q$, 'OK', '-', null),
      ('44', 'fait', 'puis versé l''avant-veille', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{A1}', (select to_jsonb(f) || jsonb_build_object('date_versement_acompte', '{AVANTHIER}') from factures_emises f where f.id = '{A1}'), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva) order by l.ordre) from facture_lignes l where l.facture_id = '{A1}'), false) e$q$, 'OK', null, null),
      ('45', 'fait', 'A1 validé', 'chef', null, $q$VALIDER {DA} {A1}$q$, 'OK', null, 'NA1'),
      ('45b', 'valeur', 'A1 validé, sa date du versement figée', 'proprietaire', null, $q$select statut || '/' || date_versement_acompte::text from factures_emises where id = '{A1}'$q$, 'OK', 'validee/{AVANTHIER}', null),
      ('46', 'fait', 'A2 : 350 € TTC, versé le jour de sa date', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"ttc","ttcCentimes":35000}'::jsonb, '{JOUR}')::text$q$, 'OK', null, 'A2'),
      ('46b', 'valeur', 'A2 : le HT dont le TTC réparti fait 350 €, au prorata du reste ; sans date du versement', 'proprietaire', null,
        $q$select string_agg(l.designation || '|' || trim_scale(l.prix_unitaire_ht)::text || '|' || trim_scale(l.taux_tva)::text, ';' order by l.ordre)
             || ' ' || (select coalesce(f.date_versement_acompte::text, '-') || '/' || f.montant_ttc from factures_emises f where f.id = '{A2}')
             from facture_lignes l where l.facture_id = '{A2}'$q$,
        'OK', 'Acompte de 350,00 € TTC sur le devis {NUM1} — TVA 20 %|200|20;Acompte de 350,00 € TTC sur le devis {NUM1} — TVA 10 %|100|10 -/350.00', null),
      ('47', 'fait', 'A2 validé', 'chef', null, $q$VALIDER {DA} {A2}$q$, 'OK', null, 'NA2'),
      ('48', 'controle', '60 % de DV1 : au-delà du reste (750 € HT)', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":60}'::jsonb, null)::text$q$, '22023', 'L’acompte (900,00 € HT) dépasse ce qui reste à facturer du devis (750,00 € HT).', null),
      ('M48', 'mutation', 'le contrôle 48 à 20 %', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":20}'::jsonb, null)::text$q$, 'OK', null, null),
      ('49', 'controle', 'un TTC au-delà du reste (875 € TTC)', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"ttc","ttcCentimes":99999999}'::jsonb, null)::text$q$, '22023', 'L’acompte (999 999,99 € TTC) dépasse ce qui reste à facturer du devis (875,00 € TTC).', null),
      ('M49', 'mutation', 'le contrôle 49 à 10 € TTC', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"ttc","ttcCentimes":1000}'::jsonb, null)::text$q$, 'OK', null, null),
      ('50', 'controle', '50 % de DV1 : tout ce qui reste (P5B-Q5)', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":50}'::jsonb, null)::text$q$, '22023', 'L’acompte couvrirait tout ce qui reste du devis : le solde se facture par la facture finale, jamais par un acompte.', null),
      ('M50', 'mutation', 'le contrôle 50 à 49,99 %', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":49.99}'::jsonb, null)::text$q$, 'OK', null, null),
      ('51', 'fait', 'F1, la facture finale de DV1', 'chef', null, $q$select facturer_devis('{DA}', '{DV1}')::text$q$, 'OK', null, 'F1'),
      ('51b', 'valeur', 'F1 : les lignes du devis, puis celles de A1 et de A2 au signe opposé, chacune citant son acompte ; les montants du devis moins les acomptes ; le rôle « finale »', 'proprietaire', null,
        $q$select string_agg(trim_scale(l.quantite)::text || '|' || l.designation || '|' || trim_scale(l.prix_unitaire_ht)::text || '|' || trim_scale(l.taux_tva)::text || '|' || coalesce(l.reprise_facture_id::text, '-'), ';' order by l.ordre)
             || ' ' || (select f.montant_ht || '/' || f.montant_tva || '/' || f.montant_ttc || '/' || f.acompte::text || '/' || (select r.role from devis_factures r where r.facture_id = f.id) from factures_emises f where f.id = '{F1}')
             from facture_lignes l where l.facture_id = '{F1}'$q$,
        'OK', '1|ESSAI-A-20|1000|20|-;1|ESSAI-A-10|500|10|-;-1|Reprise de l’acompte {NA1} du {JOURFR}|300|20|{A1};-1|Reprise de l’acompte {NA1} du {JOURFR}|150|10|{A1};-1|Reprise de l’acompte {NA2} du {JOURFR}|200|20|{A2};-1|Reprise de l’acompte {NA2} du {JOURFR}|100|10|{A2} 750.00/125.00/875.00/false/finale', null),
      ('52', 'controle', 'un acompte de DV1 sous sa finale active', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV1}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Le devis a déjà sa facture finale : il ne s’en tire plus d’acompte.', null),
      ('M52', 'mutation', 'le contrôle 52 rejoué sur DV2, sans finale', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('53', 'controle', 'une seconde finale : DV1 a déjà la sienne', 'chef', null,
        $q$select facturer_devis('{DA}', '{DV1}')::text$q$, '22023', 'Le devis {NUM1} a déjà sa facture (un brouillon) : un devis se transforme une fois.', null),
      ('54', 'controle', 'F1 retouchée : une reprise d''une facture qui n''est pas un acompte', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{F1}', (select to_jsonb(f) from factures_emises f where f.id = '{F1}'), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva, 'reprise_facture_id', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = '{F1}') || jsonb_build_array(jsonb_build_object('designation', 'x', 'quantite', -1, 'prix_unitaire_ht', 1, 'taux_tva', 20, 'reprise_facture_id', '{X0}')), false) e$q$,
        'P0002', 'Ligne 7 : l’acompte qu’elle reprend est introuvable dans ce dossier.', null),
      ('M54', 'mutation', 'le contrôle 54 rejoué en citant A1 : la retouche passe (la validation jugera)', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{F1}', (select to_jsonb(f) from factures_emises f where f.id = '{F1}'), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva, 'reprise_facture_id', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = '{F1}') || jsonb_build_array(jsonb_build_object('designation', 'x', 'quantite', -1, 'prix_unitaire_ht', 1, 'taux_tva', 20, 'reprise_facture_id', '{A1}')), false) e$q$, 'OK', null, null),
      ('55', 'controle', 'X0 retouchée : une reprise hors d''une facture finale', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', '{X0}', (select to_jsonb(f) from factures_emises f where f.id = '{X0}'), '[{"designation":"x","quantite":1,"prix_unitaire_ht":10,"taux_tva":20},{"designation":"y","quantite":-1,"prix_unitaire_ht":300,"taux_tva":20,"reprise_facture_id":"{A1}"}]'::jsonb, false) e$q$,
        '22023', 'Ligne 2 : seule la facture finale d’un devis reprend ses acomptes, et seul l’avoir de cette facture défait ses reprises.', null),
      ('56', 'fait', 'une reprise de F1 changée en direct (299 € au lieu de 300 €)', 'chef', null,
        $q$with u as (update facture_lignes set prix_unitaire_ht = 299 where facture_id = '{F1}' and ordre = 2 returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('57', 'controle', 'F1 validée : elle ne reprend plus exactement A1', 'chef', null, $q$VALIDER {DA} {F1}$q$, '22023', 'La facture finale ne reprend pas exactement l’acompte {NA1} : chacune de ses lignes s’y reprend une fois, au signe opposé.', null),
      ('56b', 'fait', 'la reprise rendue à 300 €, et la ligne du devis à 10 % ramenée à 50 €', 'chef', null,
        $q$with u as (update facture_lignes set prix_unitaire_ht = case ordre when 2 then 300 else 50 end where facture_id = '{F1}' and ordre in (1, 2) returning 1) select count(*)::text from u$q$, 'OK', '2', null),
      ('58', 'controle', 'F1 validée : négative à 10 % (refusDeLaFinale)', 'chef', null, $q$VALIDER {DA} {F1}$q$, '22023', 'La facture finale serait négative à 10 % : les acomptes repris dépassent le devis.', null),
      ('56c', 'fait', 'la ligne du devis rendue à 500 €', 'chef', null,
        $q$with u as (update facture_lignes set prix_unitaire_ht = 500 where facture_id = '{F1}' and ordre = 1 returning 1) select count(*)::text from u$q$, 'OK', '1', null),
      ('M57', 'mutation', 'les contrôles 57 et 58 rejoués sur F1 rendue : elle se valide', 'chef', null, $q$VALIDER {DA} {F1}$q$, 'OK', null, null),
      ('59', 'fait', 'F1 validée', 'chef', null, $q$VALIDER {DA} {F1}$q$, 'OK', null, 'NF1'),

      -- ══ 60 à 79. Les avoirs, et la nouvelle finale (P5B-Q4) ══════════
      ('60', 'controle', 'l''avoir de A1, que F1 validée reprend', 'chef', null, $q$AVOIR {DA} {A1}$q$, '22023', 'L’acompte {NA1} est repris par la facture finale {NF1} : il ne se crédite pas tant qu’elle le reprend — un avoir de la facture finale d’abord.', null),
      ('61', 'controle', 'l''avoir de F1 : une ligne positive qui ne défait aucune reprise', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', '{F1}', 'date_emission', '{JOUR}', 'montant_ht', -10, 'montant_tva', -2, 'montant_ttc', -12), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":11,"taux_tva":20},{"designation":"y","quantite":1,"prix_unitaire_ht":1,"taux_tva":20}]'::jsonb, true) e$q$,
        '22023', 'Les lignes d''un avoir créditent : leurs quantités sont négatives.', null),
      ('62', 'controle', 'l''avoir de F1 : une reprise de A1 défaite deux fois', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', '{F1}', 'date_emission', '{JOUR}', 'montant_ht', -450, 'montant_tva', -65, 'montant_ttc', -515), (select jsonb_agg(jsonb_build_object('designation', l.designation, 'quantite', -l.quantite, 'prix_unitaire_ht', l.prix_unitaire_ht, 'taux_tva', l.taux_tva, 'reprise_facture_id', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = '{F1}') || jsonb_build_array(jsonb_build_object('designation', 'x', 'quantite', 1, 'prix_unitaire_ht', 300, 'taux_tva', 20, 'reprise_facture_id', '{A1}')), true) e$q$,
        '22023', 'L’avoir défait une reprise que la facture finale {NF1} ne porte pas, ou que d’autres avoirs ont déjà défaite.', null),
      ('M61', 'mutation', 'les contrôles 61 et 62 rejoués : l''avoir de F1 qui défait chaque reprise une fois passe', 'chef', null, $q$AVOIR {DA} {F1}$q$, 'OK', null, null),
      ('63', 'fait', 'l''avoir de F1, entier : ses reprises défaites', 'chef', null, $q$AVOIR {DA} {F1}$q$, 'OK', null, 'AF1'),
      ('M60', 'mutation', 'le contrôle 60 rejoué, F1 créditée en entier : l''avoir de A1 passe', 'chef', null, $q$AVOIR {DA} {A1}$q$, 'OK', null, null),
      ('64', 'controle', 'un avoir partiel de A2', 'chef', null,
        $q$select e.facture_id::text from enregistrer_facture('{DA}', null, jsonb_build_object('type', 'avoir', 'facture_origine_id', '{A2}', 'date_emission', '{JOUR}', 'montant_ht', -200, 'montant_tva', -40, 'montant_ttc', -240), '[{"designation":"x","quantite":-1,"prix_unitaire_ht":200,"taux_tva":20}]'::jsonb, true) e$q$,
        '22023', 'L’avoir d’un acompte le crédite en entier, à chaque taux et en une fois : l’acompte {NA2}, de 350,00 € TTC, ne se crédite pas en partie.', null),
      ('M64', 'mutation', 'le contrôle 64 rejoué en entier', 'chef', null, $q$AVOIR {DA} {A2}$q$, 'OK', null, null),
      ('65', 'fait', 'P5B-Q4 : F2, une nouvelle finale de DV1', 'chef', null, $q$select facturer_devis('{DA}', '{DV1}')::text$q$, 'OK', null, 'F2'),
      ('65b', 'valeur', 'F2 reprend de nouveau A1 et A2', 'proprietaire', null,
        $q$select string_agg(coalesce(l.reprise_facture_id::text, '-'), ';' order by l.ordre) || ' ' || (select f.montant_ttc::text from factures_emises f where f.id = '{F2}') from facture_lignes l where l.facture_id = '{F2}'$q$,
        'OK', '-;-;{A1};{A1};{A2};{A2} 875.00', null),
      ('M66', 'mutation', 'le contrôle 66 rejoué avant l''avoir de A2 : F2 se valide', 'chef', null, $q$VALIDER {DA} {F2}$q$, 'OK', null, null),
      ('67', 'fait', 'l''avoir de A2, entier, F2 en brouillon', 'chef', null, $q$AVOIR {DA} {A2}$q$, 'OK', null, null),
      ('66', 'controle', 'F2 validée : elle reprend A2, crédité depuis', 'chef', null, $q$VALIDER {DA} {F2}$q$, '22023', 'La facture finale reprend l’acompte {NA2}, qui n’est plus un acompte en vigueur de son devis (validé et non crédité).', null),

      -- ══ 80 à 99. Les défenses, sur des acomptes plantés ══════════
      ('80', 'fait', 'P1 : un acompte de DV5 planté, validé, qui couvre tout le devis', 'chef', null, $q$PLANTER {DV5} 100 20 validee F{AN}-9001$q$, 'OK', null, 'P1'),
      ('81', 'controle', 'un acompte de DV5 : sans reste', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV5}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Les acomptes validés couvrent déjà tout le devis : il ne reste qu’à en tirer la facture finale.', null),
      ('M81', 'mutation', 'le contrôle 81 rejoué sur DV2', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV2}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('82', 'fait', 'P2 : un acompte de DV8 planté, validé, à 10 %', 'chef', null, $q$PLANTER {DV8} 10 10 validee F{AN}-9002$q$, 'OK', null, 'P2'),
      ('83', 'controle', 'un acompte de DV8 : un acompte validé porte un taux que le devis n''a pas', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV8}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'L’acompte F{AN}-9002 porte une ligne à 10 % que le devis n’a pas.', null),
      ('84', 'fait', 'P3 : un acompte de DV9 planté, validé, 150 € à 20 %', 'chef', null, $q$PLANTER {DV9} 150 20 validee F{AN}-9003$q$, 'OK', null, 'P3'),
      ('85', 'controle', 'un acompte de DV9 : les acomptes validés dépassent le devis à 20 %', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV9}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, '22023', 'Les acomptes validés dépassent le devis à 20 %.', null),
      ('M83', 'mutation', 'les contrôles 83 et 85 rejoués sur DV10, sans acompte', 'chef', null,
        $q$select facturer_acompte_devis('{DA}', '{DV10}', '{"mode":"pourcentage","pourcentage":10}'::jsonb, null)::text$q$, 'OK', null, null),
      ('86', 'fait', 'P4 : un brouillon d''acompte de DV10 planté, à 10 %', 'chef', null, $q$PLANTER {DV10} 10 10 brouillon -$q$, 'OK', null, 'P4'),
      ('87', 'controle', 'P4 validé : une ligne hors des taux du devis', 'chef', null, $q$VALIDER {DA} {P4}$q$, '22023', 'L’acompte porte une ligne à 10 % que le devis {NUM10} n’a pas : il ne se valide pas.', null),
      ('88', 'fait', 'P5 : un acompte de DV11 planté, 60 € à 20 %, validé par sa fonction', 'chef', null, $q$PLANTER {DV11} 60 20 brouillon -$q$, 'OK', null, 'P5'),
      ('88b', 'fait', 'P5 validé', 'chef', null, $q$VALIDER {DA} {P5}$q$, 'OK', null, null),
      ('89', 'fait', 'P6 : un brouillon de DV11 planté, 50 € à 20 %', 'chef', null, $q$PLANTER {DV11} 50 20 brouillon -$q$, 'OK', null, 'P6'),
      ('90', 'controle', 'P6 validé : le cumul dépasse le devis', 'chef', null, $q$VALIDER {DA} {P6}$q$, '22023', 'Le cumul des acomptes du devis {NUM11} dépasse le devis à 20 % : cet acompte ne se valide pas.', null),
      ('91', 'fait', 'P7 : un brouillon de DV11 planté, 30 € à 20 %', 'chef', null, $q$PLANTER {DV11} 30 20 brouillon -$q$, 'OK', null, 'P7'),
      ('M90', 'mutation', 'les contrôles 87 et 90 rejoués sur P7 : il se valide', 'chef', null, $q$VALIDER {DA} {P7}$q$, 'OK', null, null),
      ('92', 'fait', 'P8 : un brouillon de DV12 planté, 30,03 € à 20 %', 'chef', null, $q$PLANTER {DV12} 30.03 20 brouillon -$q$, 'OK', null, 'P8'),
      ('93', 'controle', 'P8 validé : il laisserait une TVA négative (P5B-Q5)', 'chef', null, $q$VALIDER {DA} {P8}$q$, '22023', 'L’acompte laisserait une TVA négative à la facture finale (-0,01 € à 20 %) : la TVA du devis s’arrondit ligne par ligne, celle de l’acompte sur sa part. Demandez un peu moins, ou tirez la facture finale.', null),
      ('94', 'fait', 'P9 : un brouillon de DV12 planté, 30,06 € à 20 %', 'chef', null, $q$PLANTER {DV12} 30.06 20 brouillon -$q$, 'OK', null, 'P9'),
      ('95', 'controle', 'P9 validé : il couvrirait tout le devis (P5B-Q5)', 'chef', null, $q$VALIDER {DA} {P9}$q$, '22023', 'L’acompte couvrirait tout ce qui reste du devis : le solde se facture par la facture finale, jamais par un acompte.', null),
      ('96', 'fait', 'P10 : un brouillon de DV12 planté, 30,00 € à 20 %', 'chef', null, $q$PLANTER {DV12} 30 20 brouillon -$q$, 'OK', null, 'P10'),
      ('M93', 'mutation', 'les contrôles 93 et 95 rejoués sur P10 : il se valide', 'chef', null, $q$VALIDER {DA} {P10}$q$, 'OK', null, null),
      ('97', 'fait', 'F13, la finale de DV13 ; puis P11, un brouillon d''acompte de DV13 planté', 'chef', null, $q$select facturer_devis('{DA}', '{DV13}')::text$q$, 'OK', null, 'F13'),
      ('97b', 'fait', 'P11', 'chef', null, $q$PLANTER {DV13} 10 20 brouillon -$q$, 'OK', null, 'P11'),
      ('98', 'controle', 'F13 validée : un acompte de son devis en brouillon la retient', 'chef', null, $q$VALIDER {DA} {F13}$q$, '22023', 'Un acompte du devis est encore en brouillon : la facture finale ne se valide qu’une fois ses acomptes validés ou supprimés.', null),
      ('98b', 'fait', 'P11 supprimé par sa fonction', 'chef', null, $q$select supprimer_brouillon_facture('{DA}', '{P11}')::text$q$, 'OK', null, null),
      ('M98', 'mutation', 'le contrôle 98 rejoué sans P11 : F13 se valide', 'chef', null, $q$VALIDER {DA} {F13}$q$, 'OK', null, null),
      ('99a', 'fait', 'P12 : un acompte de DV6 planté, validé, 0,03 € à 20 %', 'chef', null, $q$PLANTER {DV6} 0.03 20 validee F{AN}-8999$q$, 'OK', null, 'P12'),
      ('99b', 'fait', 'F6, la finale de DV6, qui le reprend', 'chef', null, $q$select facturer_devis('{DA}', '{DV6}')::text$q$, 'OK', null, 'F6'),
      ('99c', 'controle', 'F6 validée : une TVA négative à 20 % (refusDeLaFinale)', 'chef', null, $q$VALIDER {DA} {F6}$q$, '22023', 'La facture finale porterait une TVA négative à 20 % : les acomptes repris en ont pris plus que le devis n’en porte.', null),
      ('M99', 'mutation', 'le contrôle 99c rejoué sur une finale sans acompte (DV2) : elle se valide', 'chef', null, $q$FINALE_VALIDEE {DA} {DV2}$q$, 'OK', null, null)
    ) as x(num, genre, controle, qui, droits, ordre, code, attendu, cle)
    loop
      if s.droits is not null then
        update memberships set droit_ventes = (s.droits = 'ventes'), droit_banque = false where id = (ids ->> 'ACCES')::uuid;
      end if;
      ordre := s.ordre;
      attendu := s.attendu;
      for k in select jsonb_object_keys(ids) order by 1 desc loop
        ordre := replace(ordre, '{' || k || '}', ids ->> k);
        attendu := replace(attendu, '{' || k || '}', ids ->> k);
      end loop;
      accepte := false; code_recu := null; message := null; rendu := null;
      begin
        if s.qui in ('client', 'chef') then
          set local role authenticated;
          perform set_config('request.jwt.claims', json_build_object('sub',
            case s.qui when 'chef' then chef else client end, 'role', 'authenticated')::text, true);
        else
          perform set_config('request.jwt.claims', '', true);
        end if;
        t := string_to_array(ordre, ' ');
        if t[1] in ('VALIDER', 'RETOUCHER') then
          execute format('select %s from enregistrer_facture(%L, %L, (select to_jsonb(f) from factures_emises f where f.id = %L),'
            || ' (select jsonb_agg(jsonb_build_object(''designation'', l.designation, ''quantite'', l.quantite, ''prix_unitaire_ht'', l.prix_unitaire_ht,'
            || ' ''taux_tva'', l.taux_tva, ''unite'', l.unite, ''reference'', l.reference, ''article_id'', l.article_id, ''nature'', l.nature,'
            || ' ''reprise_facture_id'', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = %L), %s) e',
            case t[1] when 'VALIDER' then 'e.numero' else 'e.facture_id::text' end, t[2], t[3], t[3], t[3],
            case t[1] when 'VALIDER' then 'true' else 'false' end) into rendu;
        elsif t[1] = 'AVOIR' then
          execute format('select e.facture_id::text from enregistrer_facture(%L, null, (select jsonb_build_object(''type'', ''avoir'','
            || ' ''facture_origine_id'', f.id, ''date_emission'', %L, ''montant_ht'', -f.montant_ht, ''montant_tva'', -f.montant_tva,'
            || ' ''montant_ttc'', -f.montant_ttc) from factures_emises f where f.id = %L), (select jsonb_agg(jsonb_build_object(''designation'','
            || ' l.designation, ''quantite'', -l.quantite, ''prix_unitaire_ht'', l.prix_unitaire_ht, ''taux_tva'', l.taux_tva, ''nature'', l.nature,'
            || ' ''reprise_facture_id'', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = %L), true) e',
            t[2], ids ->> 'JOUR', t[3], t[3]) into rendu;
        elsif t[1] = 'DEVIS' then
          -- DEVIS <dossier> <lignes> <ht> <tva> <ttc> <emis|acceptee> : émis par sa fonction, accepté au besoin.
          select e.devis_id into dv from enregistrer_devis(t[2]::uuid, null, jsonb_build_object('tiers_nom', 'ESSAI ACOMPTE',
            'date_emission', jour, 'date_validite', jour, 'nature_operation', 'services', 'montant_ht', t[4]::numeric,
            'montant_tva', t[5]::numeric, 'montant_ttc', t[6]::numeric), t[3]::jsonb, true) e;
          if t[7] = 'acceptee' then
            perform decider_devis(t[2]::uuid, dv, 'acceptee', jour, false);
          end if;
          rendu := dv::text;
        elsif t[1] = 'FINALE_VALIDEE' then
          fid := facturer_devis(t[2]::uuid, t[3]::uuid);
          execute format('select e.numero from enregistrer_facture(%L, %L, (select to_jsonb(f) from factures_emises f where f.id = %L),'
            || ' (select jsonb_agg(jsonb_build_object(''designation'', l.designation, ''quantite'', l.quantite, ''prix_unitaire_ht'', l.prix_unitaire_ht,'
            || ' ''taux_tva'', l.taux_tva, ''reprise_facture_id'', l.reprise_facture_id) order by l.ordre) from facture_lignes l where l.facture_id = %L), true) e',
            t[2], fid, fid, fid) into rendu;
        elsif t[1] = 'PLANTER' then
          -- PLANTER <devis> <prix> <taux> <brouillon|validee> <numéro> : une facture brouillon du chef, marquée sous l'annonce que
          -- les fonctions posent, liée par le propriétaire, validée au besoin sous l'annonce de la validation.
          ht := t[3]::numeric;
          tva := round(ht * t[4]::numeric / 100, 2);
          select e.facture_id into fid from enregistrer_facture((ids ->> 'DA')::uuid, null, jsonb_build_object('tiers_nom', 'ESSAI PLANTE',
            'date_emission', jour, 'nature_operation', 'services', 'montant_ht', ht, 'montant_tva', tva, 'montant_ttc', ht + tva),
            jsonb_build_array(jsonb_build_object('designation', 'plante', 'quantite', 1, 'prix_unitaire_ht', ht, 'taux_tva', t[4]::numeric)), false) e;
          execute format('update factures_emises set acompte = true where id = %L and set_config(''jd.acompte_facture'', %L, true) is not null', fid, fid);
          perform set_config('jd.acompte_facture', '', true);
          reset role;
          execute format('insert into devis_factures (dossier_id, devis_id, facture_id, role) values (%L, %L, %L, ''acompte'')', ids ->> 'DA', t[2], fid);
          set local role authenticated;
          if t[5] = 'validee' then
            execute format('update factures_emises set statut = ''validee'', numero = %L, validated_at = now() where id = %L'
              || ' and set_config(''jd.validation_facture'', %L, true) is not null', t[6], fid, fid);
            perform set_config('jd.validation_facture', '', true);
          end if;
          rendu := fid::text;
        elsif ordre ~* '^\s*insert' and ordre !~* 'returning' then
          execute ordre;
        else
          execute ordre into rendu;
        end if;
        accepte := true;
        if s.genre in ('controle', 'mutation', 'valeur') then
          raise exception 'ANNULATION_ESSAI';
        end if;
      exception when others then code_recu := sqlstate; message := sqlerrm;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      if s.cle is not null and accepte and rendu is not null then
        ids := ids || jsonb_build_object(s.cle, rendu);
      end if;
      ok := case
        when s.code = 'OK' then accepte and (attendu is null or coalesce(rendu, '') like attendu)
                                and (s.cle is null or rendu is not null)
        else not accepte and code_recu = s.code and message like attendu
      end;
      if s.genre = 'jeu' and not ok then
        raise exception 'ESSAI_IMPOSSIBLE : le jeu % n''a pas pu être posé (% %)', s.num, code_recu, message;
      end if;
      if s.genre <> 'jeu' then
        verdicts := verdicts || jsonb_build_object('controle', s.num || '. ' || s.controle, 'genre', s.genre,
          'observe', case when accepte then 'accepté : ' || coalesce(rendu, '—') else coalesce(code_recu, '?') || ' ' || coalesce(message, '') end,
          'ok', ok);
      end if;
      -- Les numéros des devis que les refus nomment.
      if s.num in ('j11', 'j12') and accepte then
        ids := ids || jsonb_build_object(case s.num when 'j11' then 'NUM10' else 'NUM11' end, (select v.numero from devis v where v.id = rendu::uuid));
      end if;
    end loop;

    -- ══ A. Les arrondis : chaque cas relevé par le module, rejoué par la base ══════════
    for c in select * from jsonb_to_recordset(cas) as x(nom text, devis jsonb, totaux jsonb, avant jsonb, demande jsonb, attendu text) loop
      accepte := false; code_recu := null; message := null; rendu := null; num := null;
      begin
        set local role authenticated;
        perform set_config('request.jwt.claims', json_build_object('sub', chef, 'role', 'authenticated')::text, true);
        select e.devis_id into dv from enregistrer_devis((ids ->> 'DA')::uuid, null, jsonb_build_object('tiers_nom', 'ESSAI ACOMPTE CAS',
          'date_emission', jour, 'date_validite', jour, 'nature_operation', 'services') || c.totaux, c.devis, true) e;
        perform decider_devis((ids ->> 'DA')::uuid, dv, 'acceptee', jour, false);
        select v.numero into num from devis v where v.id = dv;
        for d in select x.valeur from jsonb_array_elements(c.avant) as x(valeur) loop
          fid := facturer_acompte_devis((ids ->> 'DA')::uuid, dv, d.valeur, null);
          execute format('select e.numero from enregistrer_facture(%L, %L, (select to_jsonb(f) from factures_emises f where f.id = %L),'
            || ' (select jsonb_agg(jsonb_build_object(''designation'', l.designation, ''quantite'', l.quantite, ''prix_unitaire_ht'', l.prix_unitaire_ht,'
            || ' ''taux_tva'', l.taux_tva) order by l.ordre) from facture_lignes l where l.facture_id = %L), true) e',
            ids ->> 'DA', fid, fid, fid);
        end loop;
        begin
          fid := facturer_acompte_devis((ids ->> 'DA')::uuid, dv, c.demande, null);
          select 'LIGNES:' || string_agg(l.designation || '|' || trim_scale(l.prix_unitaire_ht)::text || '|' || trim_scale(l.taux_tva)::text, ';' order by l.ordre)
                 || '|TTC:' || (select (f.montant_ttc * 100)::bigint::text from factures_emises f where f.id = fid)
            into rendu from facture_lignes l where l.facture_id = fid;
        exception when others then
          rendu := 'REFUS:' || sqlerrm; code_recu := sqlstate;
        end;
        accepte := true;
        raise exception 'ANNULATION_ESSAI';
      exception when others then
        if sqlerrm <> 'ANNULATION_ESSAI' then message := sqlstate || ' ' || sqlerrm; end if;
      end;
      reset role;
      perform set_config('request.jwt.claims', '', true);
      attendu := replace(c.attendu, '{NUM}', coalesce(num, '?'));
      ok := accepte and message is null and rendu = attendu and (rendu like 'LIGNES:%' or code_recu = '22023');
      verdicts := verdicts || jsonb_build_object('controle', 'A. ' || c.nom, 'genre', 'controle',
        'observe', coalesce(message, case when ok then rendu else 'rendu « ' || coalesce(rendu, '—') || ' » au lieu de « ' || attendu || ' »' end), 'ok', ok);
    end loop;
    raise exception 'ANNULATION_ESSAI_GLOBALE';
  exception
    when sqlstate 'P0001' then if sqlerrm <> 'ANNULATION_ESSAI_GLOBALE' then erreur := sqlerrm; end if;
    when others then erreur := sqlstate || ' ' || sqlerrm;
  end;
  reset role;

  select string_agg(n::text, '/') into apres from (values
    ((select count(*) from dossiers)), ((select count(*) from memberships)), ((select count(*) from devis)),
    ((select count(*) from devis_factures)), ((select count(*) from factures_emises)), ((select count(*) from facture_lignes)),
    ((select count(*) from devis_numerotation)), ((select count(*) from facture_numerotation))
  ) as x(n);
  -- L'écart seul, non les comptes de toute la base, qui diraient le volume d'un dossier réel.
  verdicts := verdicts || jsonb_build_object('controle', '999. l''essai s''est joué jusqu''au bout, et rien n''est resté en base', 'genre', 'controle',
    'observe', coalesce(erreur || ' — ', '') || 'écarts ' || (select string_agg(to_char(ecart_.apres_::bigint - ecart_.avant_::bigint, 'FMSG9999999990'), '/' order by ecart_.rang_) from unnest(string_to_array(avant, '/'), string_to_array(apres, '/')) with ordinality as ecart_(avant_, apres_, rang_)), 'ok', erreur is null and avant = apres);
  perform set_config('essai.acomptes_des_devis', verdicts::text, true);
end
$essai$;

select v.genre, v.controle, case when v.genre = 'attente' then '*** EN ATTENTE ***'
                                 when v.genre = 'mutation' then case when v.ok then 'mord' else '*** NE MORD PAS ***' end
                                 else case when v.ok then 'ok' else '*** EN FAUTE ***' end end as verdict, v.observe
from jsonb_to_recordset(current_setting('essai.acomptes_des_devis')::jsonb) as v(controle text, genre text, ok boolean, observe text)
order by v.genre desc, v.controle collate "C";
