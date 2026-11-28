import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { messagesSql } from '../test/raiseSql'

// ── CHAQUE REFUS DE LA VALIDATION D'UN EXERCICE, CONFRONTÉ À CE QUE L'ÉCRAN DIT AVANT LE CLIC (28/11/2026) ──────────────────────
// La règle : les préalables se disent avant le clic, aux mots de la base (CLAUDE.md, « Un exercice validé se fige »). Un refus
// de `valider_exercice`, de ses déclencheurs ou de ses filets différés que l'écran ne dit pas laisserait le cabinet cliquer, et
// le message brut de la base arriverait. Inversement, un préalable bloquant que la base ne tient pas se nomme : l'API
// validerait. Ce test lit le texte EXPORTÉ (supabase/schema/) — jamais une liste tenue de mémoire — et vire au rouge sur :
//   - un refus neuf de `valider_exercice` (un `raise exception`, ou un message d'un `case` qu'un `raise '%'` lève), ou d'une
//     fonction qu'un déclencheur de `exercices_valides` appelle, qui n'est ni dit par un préalable nommé, ni écarté avec sa
//     raison ;
//   - un déclencheur neuf, ou retiré, sur `exercices_valides` ou sur une table que la validation écrit (`ecritures_brouillon`,
//     `soldes_reportes`, `a_nouveaux`) ;
//   - un préalable bloquant neuf de lib/prealablesValidation.ts qui n'est ni tenu par un refus de la base, ni rangé « écran seul ».
// Le récit : HISTORIQUE.md, « LES REFUS DE LA VALIDATION CONFRONTÉS AUX PRÉALABLES DE L'ÉCRAN ».

type Sort =
  | { prealables: readonly string[] }
  // Dit hors des préalables : par la carte qui offre le geste, ou par un onglet qui ne se monte pas.
  | { ecran: string }
  | { inatteignable: string }

const NUMEROTATION = ['numerotation'] as const
const CHAMPS_BNC = ['champs-bnc'] as const
const PAR_CONSTRUCTION_TABLEAU = 'demandeDeValidation (lib/validationExercice.ts) rend toujours un tableau : `n.lignes.map`, `n.aNouveaux.map`.'

// LES REFUS DE `valider_exercice` (le corps de production, `codes_des_clients`, 25/11/2026), message par message.
const REFUS_DE_VALIDER_EXERCICE: Readonly<Record<string, Sort>> = {
  'Seul le chef du cabinet valide un exercice.': { ecran: 'ValidationExerciceCard : le bouton au chef seul (`estChef`), cette phrase aux autres.' },
  'Exercice invalide.': { prealables: ['exercice-hors-bornes', 'exercice-en-cours'] },
  "L'exercice % n'est pas terminé : il se valide une fois clos.": { prealables: ['exercice-en-cours'] },
  "L'exercice % est déjà validé, ou un exercice postérieur l'est.": { prealables: ['deja-valide'] },
  "L'exercice % n'est pas validé : les exercices se valident dans l'ordre.": { prealables: ['ordre'] },
  "L'exercice % précède l'ouverture du dossier : il est dans les comptes repris.": { prealables: ['avant-ouverture'] },
  "L'exercice % porte les à-nouveaux du dossier : il se valide d'abord.": { prealables: ['ouverture-d-abord'] },
  "Des écritures antérieures à l'ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation.": { prealables: ['ecritures-anterieures'] },
  "L'exercice % porte des écritures qui ne sont pas validées : les exercices se valident dans l'ordre.": { prealables: ['ecritures-anterieures'] },
  "L'exercice % porte un mouvement du % réservé à l'encaissement de la facture % : le classer par ses encaissements avant la validation.": { prealables: ['mouvements-reserves'] },
  "L'exercice % porte un mouvement du % réservé à la contre-passation d'un encaissement de la facture % : le classer par ses contre-passations avant la validation.": { prealables: ['mouvements-reserves'] },
  "Des mouvements bancaires antérieurs à l'ouverture du dossier restent à traiter : les ignorer avant la validation.": { prealables: ['mouvements-a-traiter'] },
  "L'exercice % porte des mouvements bancaires à traiter : ils se traitent avant la validation.": { prealables: ['mouvements-a-traiter'] },
  "L'exercice % porte un encaissement de la facture % par % du %, sans son mouvement : il manque au relevé, ou n'y est pas rattaché — le rattacher avant la validation.": { prealables: ['encaissements-sans-mouvement'] },
  "L'exercice % porte une vente facturée qui n'est pas écrite : % — l'écrire avant la validation.": { prealables: ['ventes-facturees-a-ecrire'] },
  "L'exercice % porte une vente facturée dont l'écriture proposée n'est plus celle que sa source commande : % — la réécrire avant la validation.": { prealables: ['ventes-facturees-a-ecrire'] },
  "L'exercice % porte l'écriture proposée d'une vente facturée qui n'a plus rien à écrire : % — la retirer avant la validation.": { prealables: ['ventes-facturees-a-ecrire'] },
  "L'exercice % porte une vente facturée qui ne s'écrit pas : % — lever ce qui la retient avant la validation.": { prealables: ['ventes-facturees-a-ecrire'] },
  'La numérotation proposée est illisible.': { inatteignable: PAR_CONSTRUCTION_TABLEAU },
  'Les libellés proposés des à-nouveaux sont illisibles.': { inatteignable: PAR_CONSTRUCTION_TABLEAU },
  "La numérotation proposée ne couvre pas exactement les % écritures de l'exercice %.": { prealables: ['ecritures-orphelines', 'ecritures-a-repartir', 'ventes-facturees-a-ecrire'] },
  "Les libellés proposés ne couvrent pas exactement les % à-nouveaux de l'exercice %.": { inatteignable: 'ouvertureDeLExercice (lib/reportDesSoldes.ts) prend les lignes mêmes de `an_e` — la reprise datée de l’exercice, les soldes reportés du 1er janvier —, lues en entier (sinon `lecture-partielle`).' },
  'Une ligne de la numérotation proposée porte une date de règlement illisible.': { prealables: CHAMPS_BNC },
  "Une ligne de la numérotation proposée porte une date de règlement postérieure à aujourd'hui.": { prealables: CHAMPS_BNC },
  'Une ligne de la numérotation proposée porte un mode de règlement hors de sa liste.': { prealables: CHAMPS_BNC },
  "Une ligne de la numérotation proposée porte une nature d'opération hors de sa liste.": { prealables: CHAMPS_BNC },
  'Une ligne de la numérotation proposée porte un poste de la 2035 hors de sa liste.': { prealables: CHAMPS_BNC },
  "Une ligne de la numérotation proposée porte un poste de la 2035 sans nature d'opération.": { prealables: CHAMPS_BNC },
  "Une ligne de la numérotation proposée porte un poste de la 2035 sur un compte qui n'est ni de charge ni de produit.": { prealables: CHAMPS_BNC },
  'Une ligne de la numérotation proposée porte un poste de la 2035 que son compte ne porte pas : un poste de recettes va sur un compte de produit ; un poste de dépenses, et les débours ou les honoraires rétrocédés qui se déduisent des recettes, sur un compte de charge.': { prealables: CHAMPS_BNC },
  "Les lignes d'une même écriture ne portent pas la même date de règlement.": { prealables: CHAMPS_BNC },
  "Les lignes d'une même écriture ne portent pas le même mode de règlement.": { prealables: CHAMPS_BNC },
  "Les lignes d'une même écriture ne portent pas la même nature d'opération.": { prealables: CHAMPS_BNC },
  "Les lignes d'une même écriture ne portent pas la même identification du client.": { prealables: CHAMPS_BNC },
  "Une ligne de la numérotation proposée identifie le client autrement que par le numéro d'une facture validée du dossier ou par le SIREN qu'elle porte.": { prealables: CHAMPS_BNC },
  "L'exercice % porte le paiement en espèces du % d'une pièce (% €) sans sa contrepartie entière au compte de la caisse : valider sa pièce et générer ses écritures, ou les régénérer, avant la validation — ou retirer ce paiement.": { prealables: ['pieces-a-valider', 'caisse-a-reprendre'] },
  "Une écriture de l'exercice % n'a pas été validée.": { inatteignable: 'Après le refus de couverture, chaque écriture datée de l’exercice est dans `p_lignes`, et celles d’avant son 1er janvier sont refusées plus haut (`ecritures-anterieures`).' },
  "L'exercice % se clôt sur le solde de comptes qui ne sont ni de bilan ni de résultat (%) : il ne se reporte pas, corriger leurs écritures avant la validation.": { prealables: ['report-hors-classes'] },
  "Les soldes de l'exercice % ne s'équilibrent pas, à-nouveaux compris : l'ouverture de l'exercice suivant ne peut pas s'écrire.": { prealables: ['report-desequilibre', 'ecritures-desequilibrees'] },
  // Les deux messages du `raise exception '%', case when v_mode = 'tresorerie' then … else … end`.
  'La 2035 à valider manque.': { inatteignable: 'En trésorerie, Clôture ne donne la carte de validation que par `validationDe(annee, f)`, la 2035 de l’exercice (ClotureTab.tsx).' },
  "Un dossier tenu en engagement n'a pas de 2035.": { inatteignable: 'En engagement, Clôture appelle `validationDe(annee)` sans 2035, et `demandeDeValidation` reçoit alors `null` (useClotureDuDossier.ts).' },
  // Les messages du `case` que `raise exception '%', v_defaut` lève.
  'Une ligne de la numérotation proposée est incomplète.': { prealables: NUMEROTATION },
  'Un à-nouveau proposé est incomplet.': { inatteignable: 'Le libellé d’écriture d’un à-nouveau commence par « À-nouveau » (`libelleEcritureANouveau`), celui de son compte retombe sur son numéro (`libelleCompte`, lib/fec.ts).' },
  "Les numéros d'un journal ne se suivent pas.": { prealables: NUMEROTATION },
  "Les numéros d'un journal ne suivent pas l'ordre des dates.": { prealables: NUMEROTATION },
  "Une écriture n'est pas équilibrée au centime.": { prealables: ['ecritures-desequilibrees'] },
  "Les lignes d'une même écriture ne portent pas la même pièce.": { prealables: NUMEROTATION },
  "Les lignes d'une même écriture ne portent pas la même date.": { prealables: NUMEROTATION },
  'Un même compte porte deux libellés.': { prealables: NUMEROTATION },
  'Un même compte auxiliaire porte deux libellés.': { prealables: NUMEROTATION },
}

const ECLATEMENT = ['ouverture-a-eclater'] as const
// LES REFUS DES DÉCLENCHEURS DE `exercices_valides`, fonction par fonction. `ouverture_eclatee_attendue` est appelée par les
// deux filets de l'ouverture (259, pour l'exercice validé ; 261, différé, pour le suivant).
const REFUS_DES_DECLENCHEURS: Readonly<Record<string, Readonly<Record<string, Sort>>>> = {
  garder_frontiere_de_la_tenue: {
    "Le module « Tenue et déclarations » n'est pas ouvert au cabinet de ce dossier : ni validation d'exercice, ni situation publiée, ni écriture libre.": { ecran: 'L’onglet Clôture, où vit la carte de validation, est du module `tenue` (`MODULE_DES_ONGLETS`) : sans lui, il ne se monte pas.' },
  },
  garder_ouverture_eclatee_a_la_validation: {
    'Une écriture éclate l’ouverture de la banque au %, alors que plus rien n’est à éclater : la retirer.': { prealables: ECLATEMENT },
    'L’ouverture du % porte au compte de banque du rôle l’argent de tous les comptes bancaires : l’écriture qui passe le solde de chaque compte à son 512, d’après ses relevés du %, n’est pas écrite.': { prealables: ECLATEMENT },
    'L’écriture qui éclate l’ouverture de la banque au % n’est plus celle que les relevés du % commandent : la réécrire.': { prealables: ECLATEMENT },
  },
  garder_ouverture_suivante_a_la_validation: {},
  ouverture_eclatee_attendue: {
    "L'exercice % n'a pas encore d'ouverture : elle s'écrira à la validation de l'exercice %, et l'ouverture de la banque s'éclatera ensuite entre ses comptes.": { prealables: ECLATEMENT },
    "Le solde au % du compte bancaire « % » ne se lit sur aucun de ses relevés contrôlés : importer le relevé qui finit ce jour-là, ou celui qui le couvre, avant d'éclater l'ouverture de la banque.": { prealables: ['ouverture-a-eclater', 'ouverture-suivante-retenue'] },
    "Les relevés du compte bancaire « % » disent des soldes différents au % : l'un d'eux ne dit pas le bon, et l'ouverture de la banque ne s'éclate pas.": { prealables: ['ouverture-a-eclater', 'ouverture-suivante-retenue'] },
    "Les soldes des relevés au % (% €) ne font pas l'ouverture du compte % (% €) : l'ouverture de la banque ne s'éclate pas entre ses comptes.": { prealables: ['ouverture-a-eclater', 'ouverture-suivante-retenue'] },
  },
}

// LES DÉCLENCHEURS DES TABLES QUE LA VALIDATION ÉCRIT, chacun avec la fonction qu'il appelle et ce qui le fait se taire sous
// la validation. `colonnes` : un `update of` dont aucune colonne n'est posée par la validation — vérifié contre son `set`.
type SortDuDeclencheur = { fonction: string } & ({ refus: true } | { colonnes: true } | { raison: string })
const HORS_RLS = 'Sous `valider_exercice` (security definer), `row_security_active` est faux : rien à juger.'
const DECLENCHEURS: Readonly<Record<string, SortDuDeclencheur>> = {
  'exercices_valides.frontiere_de_la_tenue': { fonction: 'garder_frontiere_de_la_tenue', refus: true },
  'exercices_valides.exercices_valides_ouverture_eclatee': { fonction: 'garder_ouverture_eclatee_a_la_validation', refus: true },
  'exercices_valides.exercices_valides_ouverture_suivante': { fonction: 'garder_ouverture_suivante_a_la_validation', refus: true },
  'a_nouveaux._acces_avant_les_gardes': { fonction: 'acces_avant_les_gardes', raison: HORS_RLS },
  'ecritures_brouillon._acces_avant_les_gardes': { fonction: 'acces_avant_les_gardes', raison: HORS_RLS },
  'soldes_reportes._acces_avant_les_gardes': { fonction: 'acces_avant_les_gardes', raison: HORS_RLS },
  'a_nouveaux.a_nouveaux_caisse_jamais_negative_insertion': { fonction: 'garder_la_caisse', raison: 'La validation n’insère aucun à-nouveau.' },
  'a_nouveaux.a_nouveaux_caisse_jamais_negative_modification': { fonction: 'garder_la_caisse', raison: 'La validation ne change que les libellés : la caisse rejugée est celle que la dernière transaction a laissée, jamais négative.' },
  'a_nouveaux.a_nouveaux_caisse_jamais_negative_suppression': { fonction: 'garder_la_caisse', raison: 'La validation ne supprime aucun à-nouveau.' },
  'a_nouveaux.a_nouveaux_figes_par_la_validation': { fonction: 'garder_a_nouveaux_valides', raison: 'La validation ne libelle que la reprise de l’exercice qu’elle valide, le premier (`ouverture-d-abord`) : aucune frontière n’est encore posée.' },
  'a_nouveaux.a_nouveaux_une_seule_ouverture': { fonction: 'a_nouveaux_une_seule_ouverture', raison: 'La validation ne change ni la source ni la date d’un à-nouveau.' },
  'ecritures_brouillon.ecritures_brouillon_caisse': { fonction: 'garder_ecriture_de_caisse', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_comptes_des_pieces': { fonction: 'garder_comptes_des_pieces', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_intangibles': { fonction: 'garder_ecritures_validees', raison: 'Un `insert or delete` : la validation n’insère ni ne supprime d’écriture.' },
  'ecritures_brouillon.ecritures_brouillon_intangibles_modification': { fonction: 'garder_ecritures_validees', raison: 'Une écriture proposée passe à « validée » sous `jd.validation_exercice`, posé pour ce dossier ; aucune n’est déjà validée ni derrière la frontière (`deja-valide`, `ordre`).' },
  'ecritures_brouillon.ecritures_brouillon_libre': { fonction: 'garder_ecriture_libre_du_brouillon', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_ouverture_eclatee': { fonction: 'garder_ecriture_ouverture_eclatee', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_paiement_personnel': { fonction: 'garder_ecriture_paiement_personnel', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_piece_d_une_facture_reprise': { fonction: 'garder_reglement_d_une_piece_reprise', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_sans_exemplaire_d_une_source': { fonction: 'garder_exemplaire_d_une_source', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_vente_facturee': { fonction: 'garder_ecriture_vente_facturee', colonnes: true },
  'ecritures_brouillon.ecritures_brouillon_vente_facturee_lignes': { fonction: 'garder_lignes_de_la_vente_facturee', raison: 'Un `insert or delete` : la validation n’insère ni ne supprime d’écriture.' },
  'ecritures_brouillon.ecritures_brouillon_vente_facturee_lignes_modification': { fonction: 'garder_lignes_de_la_vente_facturee', raison: 'Son `when` retire les colonnes de la validation (gardesDeLaValidationAllegees.test.ts, champsBncFiges.test.ts) : il ne se lève pas.' },
  'soldes_reportes.soldes_reportes_ecrits_par_la_validation': { fonction: 'garder_soldes_reportes', raison: 'Les soldes du 1er janvier s’insèrent, et ceux de l’ouverture se libellent une fois, sous `jd.validation_exercice` posé pour ce dossier.' },
}

// LES PRÉALABLES BLOQUANTS QUE LA BASE NE TIENT PAS (l'API validerait). Chacun avec sa raison ; « en partie » quand un refus de
// la base n'en tient qu'un cas.
const ECRAN_SEUL: Readonly<Record<string, string>> = {
  'lecture-partielle': 'Garde de lecture de l’écran : la base lit tout.',
  'exercice-anterieur-d-abord': 'La base ne regarde que les écritures proposées et les mouvements à traiter d’avant : un exercice qui n’a que des pièces validées sans écriture, ou des mouvements rapprochés, serait figé sans validation.',
  'pieces-a-valider': 'En partie : la base ne tient que la pièce qu’un paiement par la caisse cite ; une pièce à valider datée de l’exercice ne la retient pas.',
  'caisse-a-reprendre': 'En partie : la base ne tient que la contrepartie d’un paiement de pièce ; une recette, un retrait ou un versement dont l’écriture ne suit plus, non.',
  'pieces-sans-date': 'La base ne lit pas les pièces.',
  'date-impossible': 'La base ne lit pas les pièces.',
  'inventaire-mal-numerote': 'Le refus d’INV3, préparée, pas en production.',
  'ouverture-sans-reprise': 'MVPD7-Q2 : la base ne confronte pas le relevé à la banque.',
  'ouverture-en-ecart': 'O33-Q1 : la confrontation de l’ouverture au bilan précédent se calcule dans l’application (lib/ouvertureConfrontee.ts).',
  'banque-partagee-retenue': 'Son filet (`banque_partagee_a_la_validation`) est préparé, pas en production.',
  'concordance': 'La base ne recalcule pas la 2035.',
  'exclusions-2035': 'La base ne recalcule pas la 2035.',
  'postes-sans-case': 'La base ne recalcule pas la 2035.',
  'cases-negatives': 'La base ne recalcule pas la 2035.',
  'cases-dont-incoherentes': 'La base ne recalcule pas la 2035.',
  'frais-vehicule-en-double': 'La base ne recalcule pas la 2035.',
  'ecritures-a-generer': 'La base ne recompose pas les écritures des pièces.',
  'desynchronisees': 'La base ne recompose pas les écritures des pièces.',
  'ecritures-sans-objet': 'La base ne recompose pas les écritures des pièces.',
  'sans-categorie': 'La base ne lit pas les catégories des pièces.',
  'devise-non-convertie': 'La base ne lit pas les pièces.',
  'tva-impossible': 'La base ne lit pas les pièces.',
  'doublons-inconnus': 'Garde de lecture de l’écran.',
  'doublon-texte': 'La base ne compare pas les textes lus.',
  'ventes-en-double': 'Le pont des ventes se juge dans l’application (lib/pont.ts).',
  'releves-inconnus': 'Garde de lecture de l’écran.',
  'releve-incoherent': 'Le contrôle du solde du relevé se calcule dans l’application.',
  'affectes-perimes': 'La base ne recompose pas les écritures du relevé.',
  'recettes-affectees-assujetti': 'La base ne recompose pas les écritures du relevé.',
  'ventiles-perimes': 'La base ne recompose pas les écritures du relevé.',
  'ventilations-incoherentes': 'La base ne recompose pas les écritures du relevé.',
  'comptes-de-bilan-perimes': 'La base ne recompose pas les écritures du relevé.',
  'liquidations-tva-perimees': 'La base ne recompose pas les écritures de la TVA.',
  'paiements-tva-perimes': 'La base ne recompose pas les écritures de la TVA.',
  'virements-sans-ecriture': 'La base ne recompose pas les écritures du relevé.',
  'echeances-emprunt-perimees': 'La base ne recompose pas les écritures du relevé.',
  'cotisations-sans-ecriture': 'La base ne recompose pas les écritures des cotisations.',
  'cotisations-classees-par-categorie': 'COT-Q2 : une règle de l’écran.',
  'cotisations-rapprochement-refuse': 'La base ne recompose pas les écritures des cotisations.',
  'paiements-personnels-a-reprendre': 'La base ne recompose pas les écritures des cotisations.',
  'caisse-negative': 'La garde de la caisse la refuse à chaque écriture ; seule une restauration la laisserait négative.',
  'recettes-de-caisse-a-revoir': 'Une règle de l’écran sur la caisse rejouée.',
  'caisse-paiements-a-retirer': 'Une règle de l’écran sur la caisse rejouée.',
  'rapproches-sans-objet': 'La base ne recompose pas les écritures du relevé.',
  'reglements-groupes-incoherents': 'La base ne recompose pas les écritures du relevé.',
  'pieces-payees-en-trop': 'Les paiements des pièces se calculent dans l’application.',
  'pieces-payees-en-partie': 'Les paiements des pièces se calculent dans l’application.',
  'immos-sans-justificatif': 'La base ne lit pas les justificatifs des biens.',
  'dotations-a-ecrire': 'La base ne recompose pas les dotations.',
  'forfaits-a-ecrire': 'La base ne recompose pas les forfaits kilométriques.',
}

// ── La lecture du texte exporté ─────────────────────────────────────────────────────────────────────────────────────────────

/** Les refus d'une définition : les `raise exception` à message écrit, et les messages qu'un `case` donne à un `raise '%'`. */
function refusDe(definition: string): string[] {
  const ecrits = messagesSql(definition).filter((m) => m !== '%')
  // Un message de `case` : une phrase (un espace, un point final) après `then` ou `else` — les clés des champs du FEC
  // (`then 'date_illisible'`) et les mots d'une valeur (`then 'virement'`) ne le sont pas.
  const deCase = [...definition.matchAll(/\b(?:then|else) '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    .filter((m) => m.includes(' ') && m.endsWith('.'))
  return [...ecrits, ...deCase]
}

const sansCommentaires = (texte: string) => texte.replace(/--[^\n]*/g, '')
// Les chaînes qui citent une instruction (`pg_get_triggerdef(t.oid) = 'CREATE CONSTRAINT TRIGGER …'`), sur une ligne, ne sont
// pas des instructions : une chaîne ne passe jamais la fin de sa ligne ici, capitales ou non.
const sansCitations = (texte: string) => texte.replace(/'(?:[^'\n]|'')*create (?:constraint )?trigger(?:[^'\n]|'')*'/gi, "''")

interface Declencheur { table: string; nom: string; quand: string; fonction: string }
/** Les déclencheurs que l'export laisse sur ces tables, création et retrait rejoués dans l'ordre des fichiers. */
function declencheurs(fichiers: readonly { texte: string }[], tables: readonly string[]): Map<string, Declencheur> {
  const poses = new Map<string, Declencheur>()
  const motif = /\bcreate\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?([^;]*?)\bon\s+(?:public\.)?"?(\w+)"?([^;]*?)\bexecute\s+(?:function|procedure)\s+(?:public\.)?(\w+)|\bdrop\s+trigger\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?/gi
  for (const { texte } of fichiers) {
    for (const m of sansCitations(sansCommentaires(texte)).matchAll(motif)) {
      if (m[1] !== undefined) poses.set(`${m[3]}.${m[1]}`, { table: m[3], nom: m[1], quand: `${m[2]} ${m[4]}`.replace(/\s+/g, ' ').trim(), fonction: m[5] })
      else poses.delete(`${m[7]}.${m[6]}`)
    }
  }
  return new Map([...poses].filter(([, d]) => tables.includes(d.table)))
}

/** Les colonnes que `valider_exercice` pose sur `ecritures_brouillon` (le `set` de son `update`). */
function colonnesPoseesSurLeBrouillon(definition: string): string[] {
  const m = /update public\.ecritures_brouillon e\s+set ([\s\S]*?)\s+from jsonb_to_recordset/.exec(definition)
  if (!m) throw new Error('Le `update` de la validation sur le brouillon est introuvable.')
  return [...m[1].matchAll(/(\w+) = /g)].map((x) => x[1])
}

/** Les préalables de `prealablesDeValidation`, chacun bloquant ou non : l'objet qui porte son `id`, lu jusqu'à son accolade. */
function prealablesDuModule(source: string): Map<string, boolean> {
  const debut = source.indexOf('export function prealablesDeValidation(')
  const corps = source.slice(debut, source.indexOf('\n}\n', debut))
  const lus = new Map<string, boolean>()
  for (const m of corps.matchAll(/\bid: '([a-z0-9-]+)'/g)) {
    let i = m.index
    for (let profondeur = 0; i > 0; i--) {
      if (corps[i] === '}') profondeur++
      else if (corps[i] === '{' && profondeur-- === 0) break
    }
    let j = i
    for (let profondeur = 0; j < corps.length; j++) {
      if (corps[j] === '{') profondeur++
      else if (corps[j] === '}' && --profondeur === 0) break
    }
    const bloquant = !/\bbloquant: false\b/.test(corps.slice(i, j))
    lus.set(m[1], (lus.get(m[1]) ?? false) || bloquant)
  }
  return lus
}

const VALIDER = derniereDefinitionSql('valider_exercice')
const MODULE = readFileSync(new URL('./prealablesValidation.ts', import.meta.url), 'utf8')
const PREALABLES = prealablesDuModule(MODULE)
const BLOQUANTS = [...PREALABLES].filter(([, b]) => b).map(([id]) => id)
const TABLES = ['exercices_valides', 'ecritures_brouillon', 'soldes_reportes', 'a_nouveaux'] as const
const DECLENCHEURS_LUS = declencheurs(fichiersDuSchema(), TABLES)
const nonClasses = (refus: readonly string[], classes: Readonly<Record<string, Sort>>) => refus.filter((r) => !(r in classes))
const prealablesDe = (s: Sort) => ('prealables' in s ? s.prealables : [])
const TENUS = new Set([...Object.values(REFUS_DE_VALIDER_EXERCICE), ...Object.values(REFUS_DES_DECLENCHEURS).flatMap((r) => Object.values(r))]
  .flatMap(prealablesDe))

describe('les refus de valider_exercice, confrontés aux préalables de l’écran', () => {
  const refus = refusDe(VALIDER)

  it('lit bien les refus — le plancher qui distingue « rien à redire » d’« aveugle »', () => {
    expect(refus.length).toBeGreaterThanOrEqual(50)
    expect(new Set(refus).size).toBe(refus.length)
  })

  it('chaque refus est dit par un préalable, par l’écran, ou écarté avec sa raison — et la liste ne nomme que des refus de la base', () => {
    expect(nonClasses(refus, REFUS_DE_VALIDER_EXERCICE)).toEqual([])
    expect(Object.keys(REFUS_DE_VALIDER_EXERCICE).filter((m) => !refus.includes(m))).toEqual([])
    expect(Object.keys(REFUS_DE_VALIDER_EXERCICE)).toHaveLength(refus.length)
  })

  it('vire au rouge sur un refus neuf, écrit ou dans un `case`', () => {
    const plante = VALIDER.replace("  if v_defaut is not null then",
      "  if false then\n    raise exception 'Un refus de plus.' using errcode = '23514';\n  end if;\n  if v_defaut is not null then")
    expect(plante).not.toBe(VALIDER)
    expect(nonClasses(refusDe(plante), REFUS_DE_VALIDER_EXERCICE)).toEqual(['Un refus de plus.'])
    const deCase = VALIDER.replace("then 'Un même compte auxiliaire porte deux libellés.'",
      "then 'Un même compte auxiliaire porte deux libellés.'\n      when false then 'Une écriture de trop.'")
    expect(nonClasses(refusDe(deCase), REFUS_DE_VALIDER_EXERCICE)).toEqual(['Une écriture de trop.'])
  })

  it('le refus que l’écran dit hors des préalables : la carte le dit au caractère près', () => {
    const carte = readFileSync(new URL('../pages/dossier/ValidationExerciceCard.tsx', import.meta.url), 'utf8')
    expect(carte).toContain('Seul le chef du cabinet valide un exercice.')
    expect(carte).toMatch(/!estChef\) return/)
  })

  it('les deux refus de la 2035 : la trésorerie passe sa 2035, l’engagement aucune', () => {
    const cloture = readFileSync(new URL('../pages/dossier/ClotureTab.tsx', import.meta.url), 'utf8')
    expect(cloture.match(/validationDe\(annee, f\)/g)).toHaveLength(1)
    expect(cloture.match(/validationDe\(annee\)/g)).toHaveLength(1)
  })
})

describe('les déclencheurs de la validation, confrontés aux préalables de l’écran', () => {
  it('chaque déclencheur des tables que la validation écrit est rangé, et seulement eux', () => {
    expect(DECLENCHEURS_LUS.size).toBeGreaterThanOrEqual(20)
    expect([...DECLENCHEURS_LUS.keys()].filter((k) => !(k in DECLENCHEURS)).sort()).toEqual([])
    expect(Object.keys(DECLENCHEURS).filter((k) => !DECLENCHEURS_LUS.has(k)).sort()).toEqual([])
    for (const [cle, d] of DECLENCHEURS_LUS) expect(d.fonction, cle).toBe(DECLENCHEURS[cle].fonction)
  })

  it('un `update of` rangé « colonnes » ne porte aucune colonne que la validation pose', () => {
    const posees = colonnesPoseesSurLeBrouillon(VALIDER)
    expect(posees).toEqual(expect.arrayContaining(['statut', 'valide_le', 'journal_code', 'numero_ecriture', 'identification_client']))
    for (const [cle, sort] of Object.entries(DECLENCHEURS)) {
      if (!('colonnes' in sort)) continue
      const quand = DECLENCHEURS_LUS.get(cle)!.quand
      const colonnes = /\bupdate of ([\w, ]+?)(?: or | for |$)/i.exec(quand)?.[1].split(/\s*,\s*/) ?? []
      expect(colonnes.length, cle).toBeGreaterThan(0)
      expect(colonnes.filter((c) => posees.includes(c)), cle).toEqual([])
    }
  })

  it('chaque refus d’une fonction de déclencheur de `exercices_valides` est dit, ou écarté avec sa raison', () => {
    const appelees = [...DECLENCHEURS_LUS.values()].filter((d) => d.table === 'exercices_valides').map((d) => d.fonction)
    // Le filet de l'exercice suivant n'a pas de refus à lui : il appelle le calcul de l'éclatement, rangé avec lui.
    expect(derniereDefinitionSql('garder_ouverture_suivante_a_la_validation')).toContain('public.ouverture_eclatee_attendue(new.dossier_id, new.annee + 1)')
    expect(derniereDefinitionSql('garder_ouverture_eclatee_a_la_validation')).toContain('public.ouverture_eclatee_attendue(new.dossier_id, new.annee)')
    expect([...appelees, 'ouverture_eclatee_attendue'].sort()).toEqual(Object.keys(REFUS_DES_DECLENCHEURS).sort())
    for (const [fonction, classes] of Object.entries(REFUS_DES_DECLENCHEURS)) {
      const lus = refusDe(derniereDefinitionSql(fonction))
      expect(nonClasses(lus, classes), fonction).toEqual([])
      expect(Object.keys(classes).filter((m) => !lus.includes(m)), fonction).toEqual([])
    }
  })

  it('la frontière de la tenue : l’onglet de la validation est du module `tenue`', () => {
    const modules = readFileSync(new URL('./modulesDuCabinet.ts', import.meta.url), 'utf8')
    expect(modules).toMatch(/\n {2}cloture: 'tenue',/)
  })

  it('vire au rouge sur un déclencheur neuf, et sur un déclencheur retiré', () => {
    const neuf = { texte: 'create trigger un_de_plus after insert on public.exercices_valides for each row execute function public.f();' }
    const retire = { texte: 'drop trigger frontiere_de_la_tenue on public.exercices_valides;' }
    expect([...declencheurs([...fichiersDuSchema(), neuf], TABLES).keys()].filter((k) => !(k in DECLENCHEURS))).toEqual(['exercices_valides.un_de_plus'])
    expect(declencheurs([...fichiersDuSchema(), retire], TABLES).has('exercices_valides.frontiere_de_la_tenue')).toBe(false)
  })
})

describe('les préalables bloquants de l’écran, confrontés aux refus de la base', () => {
  it('lit bien les préalables — le plancher, et l’attention n’est pas lue comme un bloquant', () => {
    expect(BLOQUANTS.length).toBeGreaterThanOrEqual(60)
    expect(PREALABLES.get('banque-au-releve')).toBe(false)
    expect(PREALABLES.get('mouvements-a-traiter')).toBe(true)
  })

  it('chaque préalable nommé par un refus existe, et est bloquant', () => {
    for (const id of TENUS) expect(PREALABLES.get(id), id).toBe(true)
  })

  it('chaque préalable bloquant est tenu par un refus de la base, ou rangé « écran seul » avec sa raison', () => {
    expect(BLOQUANTS.filter((id) => !TENUS.has(id) && !(id in ECRAN_SEUL))).toEqual([])
    expect(Object.keys(ECRAN_SEUL).filter((id) => PREALABLES.get(id) !== true)).toEqual([])
    // Rangé « écran seul » et tenu à la fois : seulement « en partie ».
    for (const id of Object.keys(ECRAN_SEUL).filter((x) => TENUS.has(x))) expect(ECRAN_SEUL[id], id).toMatch(/^En partie : /)
  })
})
