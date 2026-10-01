export type Statut = 'a_valider' | 'validee'
export type TypePiece = 'achat' | 'vente' | 'note_frais' | 'autre'
export type Source = 'upload' | 'email' | 'superpdp'

export interface Dossier {
  id: string
  nom: string
  // NOT NULL en base, mais JAMAIS envoyé à l'insertion : un trigger BEFORE INSERT
  // (`set_cabinet_id_dossier`) le remplit depuis `mon_cabinet_id()`. Il est ici parce que ce type
  // décrit la LIGNE, que toute ligne le porte, et que la sauvegarde le lit explicitement — en
  // l'omettant, le type faisait croire qu'un dossier n'appartient à personne.
  // Le trigger ne fait que REMPLIR (`if new.cabinet_id is null`), il n'écrase pas : c'est ce qui
  // permet à une restauration de rendre un dossier à SON cabinet d'origine et non à celui qui
  // restaure. Même mécanique pour `code_email` (`generate_code_email`), déjà présent plus bas.
  cabinet_id: string
  siret: string | null
  contact_nom: string | null
  contact_email: string | null
  notes: string | null
  archive: boolean
  created_at: string
  code_email: string
  assujetti_tva: boolean
  // Le régime de TVA d'un dossier assujetti, que l'onglet TVA lit pour préparer la CA3 (voir
  // lib/declarationTva.ts). Trimestrielle par défaut : à partir de 2027 le régime simplifié disparaît
  // et c'est la périodicité de droit sous 1 000 000 € de chiffre d'affaires. `tva_sur_debits` est
  // l'option qui rend la TVA des recettes due à la date de la facture plutôt qu'à l'encaissement.
  tva_periodicite: PeriodiciteTva
  tva_sur_debits: boolean
  // Le modèle comptable du dossier (voir lib/engagement.ts). Trésorerie : une pièce compte à la date de
  // son paiement, c'est la règle du BNC et de la 2035. Engagement : la facture crée une dette ou une
  // créance à sa date, en 401 ou en 411, et le paiement la solde — la tenue d'une société à l'IS ou
  // d'une entreprise au BIC. Il ne se change que tant que le brouillon d'écritures est vide : un
  // déclencheur en base refuse ensuite (`verrouiller_modele_comptable`, errcode 23514).
  mode_comptable: ModeComptable
  // En engagement, le compte crédité par une note de frais que le dirigeant a payée de sa poche.
  compte_notes_de_frais: CompteNotesDeFrais
  code_naf: string | null
  libelle_naf: string | null
  // Adresse de l'émetteur — mention obligatoire sur une facture (voir FacturesTab). Absente du modèle
  // jusqu'à l'ajout de la facturation : nom/siret suffisaient à tout ce qui existait avant.
  adresse: string | null
}

export interface Categorie {
  id: string
  dossier_id: string | null
  code: string
  libelle: string
  ordre: number
  compte_comptable: string | null
  poste_2035: string | null
}

export type StatutLigneBancaire = 'non_rapprochee' | 'rapprochee' | 'ignoree'

export interface RegleBancaireIgnoree {
  id: string
  dossier_id: string
  motif: string
  created_at: string
}

// Une règle d'affectation apprise par libellé (ligne 26.6) : les mouvements de ce sens dont le
// libellé contient le motif sont PROPOSÉS à l'affectation dans la catégorie — jamais affectés seuls
// (lib/reglesAffectation.ts). Le motif est normalisé (minuscules sans accents, mots séparés par une
// espace) : la base refuse toute autre forme, et un motif de chiffres seuls en porte au moins cinq.
export type SensMouvementBancaire = 'encaissement' | 'decaissement'

export interface RegleAffectationBancaire {
  id: string
  dossier_id: string
  motif: string
  sens: SensMouvementBancaire
  categorie_id: string
  // Le taux de TVA que la règle propose avec sa catégorie, pour une recette d'un dossier assujetti : le lot
  // le transmet à l'affectation. Nul pour une dépense et sur un dossier non assujetti
  // (`regles_affectation_bancaire_taux_tva`).
  taux_tva: number | null
  created_at: string
}

// Une PART d'un mouvement ventilé sur plusieurs comptes (ligne 26.6) — la table `ventilations_bancaires`.
// Elle va à une catégorie de résultat OU au compte du dirigeant (`part_personnelle`), jamais aux deux ni à
// aucune (`ventilations_bancaires_cible`). Son montant est SIGNÉ COMME LE RELEVÉ — positif, une entrée ;
// négatif, une sortie — et n'est jamais nul ; une part peut aller en sens inverse du mouvement (la
// commission retenue sur une remise de carte bancaire). Une cible ne reçoit qu'une part par mouvement.
export interface VentilationBancaire {
  id: string
  dossier_id: string
  ligne_bancaire_id: string
  categorie_id: string | null
  part_personnelle: boolean
  montant: number
  // Le taux de TVA d'une part de RECETTE sur un dossier assujetti, comme sur un mouvement affecté (voir
  // `LigneBancaire.taux_tva`). Nul pour une part de dépense, pour la part personnelle et sur un dossier non
  // assujetti (`ventilations_bancaires_taux_tva`).
  taux_tva: number | null
  created_at: string
}

// Une PART d'un mouvement qui règle plusieurs pièces (ligne 26) — la table `reglements_groupes`. Elle
// désigne la pièce réglée et le montant qui la règle, SIGNÉ COMME LE RELEVÉ et jamais nul ; son signe est
// celui qui règle la pièce (une sortie pour une facture d'achat, une entrée pour une facture de vente ou
// pour un avoir d'achat). `piece_id` est nul quand la pièce a été supprimée depuis (`on delete set null`) :
// la part garde son montant, et l'application la signale. Une pièce ne reçoit qu'une part par mouvement.
export interface ReglementGroupe {
  id: string
  dossier_id: string
  ligne_bancaire_id: string
  piece_id: string | null
  montant: number
  created_at: string
}

// Contrôle de cohérence d'un relevé bancaire importé : solde d'ouverture + somme des mouvements
// doit donner le solde de clôture. Conservé en base (et non affiché une fois puis jeté) parce qu'un
// relevé incomplet est une information qui doit survivre à la fermeture d'une alerte — voir
// lib/controlesReleves.ts. Décrit la table `controles_releves_bancaires`, colonnes NOT NULL comprises.
export interface ControleReleveBancaire {
  id: string
  dossier_id: string
  // Nul sur les chemins d'import qui ne portent pas de nom de fichier.
  source_fichier: string | null
  solde_initial: number
  solde_final: number
  somme_mouvements: number
  // (solde_initial + somme_mouvements) − solde_final. Positif : le relevé porte plus d'entrées que
  // le solde ne le justifie, donc il manque des sorties (ou des entrées sont en double).
  ecart: number
  coherent: boolean
  periode_debut: string | null
  periode_fin: string | null
  created_at: string
}

export interface LigneBancaire {
  id: string
  dossier_id: string
  date: string
  libelle: string
  montant: number
  statut: StatutLigneBancaire
  piece_id: string | null
  // Rattache le mouvement à une échéance de cotisations_declarees plutôt qu'à une pièce — un
  // prélèvement URSSAF/CARPIMKO n'a pas de facture, juste un montant appelé sur un échéancier.
  //
  // MUTUELLEMENT EXCLUSIF AVEC `piece_id`, `categorie_id` ET `emprunt_id`, ET C'EST LA BASE QUI LE
  // TIENT : `lignes_bancaires_un_seul_rapprochement` (num_nonnulls(piece_id, cotisation_id,
  // categorie_id, emprunt_id) <= 1). Ce commentaire a affirmé du 23/09 au 29/09/2026 qu'aucune
  // contrainte CHECK n'existait : c'était faux, `pg_constraint` la rend depuis le 22/09 au moins (le
  // socle l'exporte déjà), et rien n'avait recoupé l'affirmation avec l'export qui portait la réponse.
  //
  // ET IL S'ÉCRIT (ligne 26.6, étape b, lib/cotisationRapprochee.ts) : posé par `rapprocher_cotisation`
  // AVEC son écriture — le 646000 face à la banque, la CSG-CRDS au 108000 en trésorerie —, retiré avec
  // elle par `retirer_rapprochement_cotisation`. La base tient le reste : un mouvement qui porte une
  // échéance est rapproché et jamais personnel (`lignes_bancaires_cotisation_rapprochee`), et une échéance
  // ne se rapproche que d'un mouvement (`lignes_bancaires_cotisation_unique`).
  cotisation_id: string | null
  // La catégorie d'un mouvement SANS justificatif (ligne 26.6 de la feuille de route) : frais
  // bancaires, encaissements de l'Assurance maladie, remboursements. Le mouvement est alors rapproché,
  // et son écriture — le compte de la catégorie face à la banque — s'écrit AVEC l'affectation, par la
  // fonction SQL `affecter_mouvement_bancaire` (voir lib/affectationBanque.ts). La base refuse une
  // catégorie sur un mouvement non rapproché ou classé en virement personnel
  // (`lignes_bancaires_affectation_rapprochee`).
  categorie_id: string | null
  // Le taux de TVA d'une RECETTE affectée sur un dossier assujetti (20, 10, 5,5 ou 8,5 ; zéro : exonérée
  // ou non imposable), choisi à l'affectation — jamais deviné, un relevé ne le dit pas (voir
  // lib/tvaDuReleve.ts). Nul pour une dépense, sur un dossier non assujetti et sur un mouvement non
  // affecté. Écrit avec l'affectation par `affecter_mouvement_bancaire`, qui l'exige pour une recette d'un
  // dossier assujetti et le refuse ailleurs, effacé avec elle ; la base n'admet pas un taux sans catégorie
  // (`lignes_bancaires_taux_tva`).
  taux_tva: number | null
  // L'emprunt dont le mouvement est une ÉCHÉANCE (une sortie) ou le DÉBLOCAGE (une entrée) — ligne 26.6,
  // étape (a). Écrit avec son écriture par la fonction SQL `rapprocher_echeance_emprunt`, retiré avec
  // elle par `retirer_echeance_emprunt` (voir lib/echeanceEmprunt.ts). Le DÉCOUPAGE validé par le cabinet
  // se garde ici et non seulement dans l'écriture : la 2035 le lit sur le mouvement, comme l'écran du
  // client, qui n'a pas accès aux écritures. Le capital remboursé est le reste du prélèvement.
  // La base tient la forme sans le code (`lignes_bancaires_decoupage_emprunt`) : tout nul sans emprunt ;
  // une échéance porte son numéro (1 à la durée) et des intérêts et une assurance positifs qui tiennent
  // dans le prélèvement ; un déblocage n'a ni numéro, ni intérêts, ni assurance (zéro). Un mouvement
  // rapproché d'un emprunt est rapproché et n'est pas un virement personnel
  // (`lignes_bancaires_emprunt_rapproche`), et une échéance ne se rapproche que d'un mouvement
  // (`lignes_bancaires_echeance_emprunt_unique`).
  emprunt_id: string | null
  emprunt_echeance: number | null
  emprunt_interets: number | null
  emprunt_assurance: number | null
  // Le mouvement est VENTILÉ sur plusieurs comptes (ligne 26.6, étape a) : ses parts sont dans
  // `ventilations_bancaires`, une catégorie de résultat ou la part personnelle chacune, et leur somme
  // est le mouvement. Posé avec les parts et l'écriture par la fonction SQL `ventiler_mouvement_bancaire`
  // (voir lib/ventilationBanque.ts). La base le tient dans les contraintes de la ligne : exclusif d'une
  // pièce, d'une cotisation, d'une catégorie et d'un emprunt (`lignes_bancaires_un_seul_rapprochement`),
  // rapproché et jamais personnel (`lignes_bancaires_ventilation_rapprochee`). Que les parts fassent le
  // montant, seule la fonction le vérifie — un contrôle de l'application dit un écart.
  ventilee: boolean
  // Le mouvement RÈGLE PLUSIEURS PIÈCES (ligne 26) : ses parts sont dans `reglements_groupes`, une pièce
  // et le montant qui la règle chacune, et leur somme est le mouvement. `piece_id` reste nul. Posé avec
  // les parts par la fonction SQL `regler_pieces_par_mouvement` (voir lib/reglementGroupe.ts), retiré avec
  // elles par `retirer_reglement_groupe`. La base le tient comme `ventilee` : exclusif de tout autre lien
  // (`lignes_bancaires_un_seul_rapprochement`), rapproché et jamais personnel
  // (`lignes_bancaires_reglement_groupe_rapproche`).
  reglement_groupe: boolean
  // Virement du compte pro vers le compte personnel de l'exploitant — un prélèvement, pas une charge :
  // n'a ni pièce ni échéance à rattacher (voir VirementsTab), exclu des totaux par poste de Clôture.
  // Le mouvement est aussi marqué "ignoree" côté rapprochement dès que ce drapeau passe à true (rien
  // d'autre ne viendra jamais s'y rapprocher).
  prelevement_personnel: boolean
  // Traçabilité de l'import (voir audit ergonomie) : nom du fichier déposé (CSV ou PDF) et ligne brute
  // telle que trouvée dans ce fichier — utile surtout quand libelle est retombé sur le générique
  // "Mouvement bancaire" (colonne Libellé vide sur cette ligne côté banque), pour retrouver de quoi il
  // s'agissait sans devoir rouvrir le relevé d'origine. Nuls sur tout import antérieur à leur ajout.
  source_fichier: string | null
  libelle_brut: string | null
  // L'identifiant du mouvement chez le prestataire de la connexion bancaire (ligne 24 de la feuille de
  // route), préfixé de l'empreinte du compte : c'est lui qui dédoublonne un mouvement récupéré deux fois
  // (`lignes_bancaires_id_externe_unique`, sur le dossier et lui). Nul pour un mouvement importé d'un
  // relevé, CSV ou PDF — deux NULL ne se heurtent pas.
  id_externe: string | null
  created_at: string
}

export interface TiersCategorie {
  id: string
  dossier_id: string
  tiers_normalise: string
  categorie_id: string
  updated_at: string
}

// Même correspondance tiers → catégorie que TiersCategorie, mais partagée entre tous les dossiers
// d'un cabinet (voir migration tiers_categories_cabinet) — categorie_id y référence toujours une
// catégorie globale. `cabinet_id` manquait ici alors que la colonne existe et est NOT NULL : c'est
// ce qui a laissé écrire un enregistrement sans elle, rejeté à chaque fois par la base.
export interface TiersCategorieCabinet {
  id: string
  cabinet_id: string
  tiers_normalise: string
  categorie_id: string
  updated_at: string
}

export interface SousDossier {
  id: string
  dossier_id: string
  nom: string
  ordre: number
  created_at: string
}

export interface Piece {
  id: string
  dossier_id: string
  uploaded_by: string | null
  source: Source
  storage_path: string
  nom_fichier: string
  // Empreinte SHA-256 du contenu du fichier — sert à détecter un doublon à l'import (voir
  // ImportDossierModal). Nul pour les pièces créées avant l'introduction de ce champ.
  storage_hash: string | null
  date_piece: string | null
  tiers: string | null
  // Les trois montants sont TOUJOURS en euros, y compris pour une pièce libellée en devise
  // étrangère : tout l'aval en dépend — écritures, rapprochement bancaire, FEC, clôture, 2035. La
  // devise d'origine vit dans les trois champs qui suivent (voir lib/devises.ts).
  montant_ht: number | null
  montant_tva: number | null
  montant_ttc: number | null
  // Devise du document (ISO 4217). 'EUR' pour l'écrasante majorité des pièces ; jamais nulle, pour
  // qu'« inconnue » ne soit pas une valeur possible.
  devise: string
  // Montant TTC tel qu'écrit sur le document, dans sa devise, et taux BCE retenu (unités de devise
  // pour 1 EUR). Nuls quand devise vaut 'EUR' — une contrainte en base l'impose, sans quoi deux
  // champs diraient deux choses différentes de la même somme.
  montant_devise: number | null
  taux_change: number | null
  // D'où vient le montant en euros : 'bce' (provisoire, taux de référence à la date de la pièce) ou
  // 'banque' (définitif, repris du mouvement qui l'a payée). Nulle pour une pièce en euros.
  conversion_source: 'bce' | 'banque' | null
  categorie_id: string | null
  sous_dossier_id: string | null
  type_piece: TypePiece
  statut: Statut
  notes: string | null
  // Score de confiance de l'extraction automatique (haute/moyenne/basse), null pour une pièce jamais
  // passée par extractPiece() (saisie 100% manuelle, ou créée avant l'ajout de ce champ).
  confiance: 'haute' | 'moyenne' | 'basse' | null
  // Id de la facture côté Super PDP — non nul uniquement pour une pièce importée par superpdp-sync ;
  // sert à la déduplication (voir la migration) et à savoir qu'une pièce vient de la facturation
  // électronique plutôt que d'un dépôt (voir source).
  superpdp_invoice_id: number | null
  created_at: string
  updated_at: string
}

export interface Pack {
  id: string
  dossier_id: string
  periode_debut: string
  periode_fin: string
  generated_at: string
  generated_by: string
  storage_path_zip: string
  storage_path_excel: string
  nb_pieces: number
  total_ttc: number | null
}

export type SensEcriture = 'debit' | 'credit'
export type StatutEcriture = 'proposee' | 'validee'

// Palier 5 — brouillon comptable : une proposition d'écriture générée à partir d'une pièce validée
// ou d'une ligne bancaire rapprochée. Reste toujours un brouillon (voir le bandeau de l'onglet
// Écritures) — jamais présenté comme une comptabilité tenue, jamais exporté comme définitif.
export interface EcritureBrouillon {
  id: string
  dossier_id: string
  piece_id: string | null
  ligne_bancaire_id: string | null
  date: string
  compte: string
  libelle: string
  montant: number
  sens: SensEcriture
  statut: StatutEcriture
  created_at: string
  // Le bien dont cette écriture est la DOTATION aux amortissements (ligne 26.6, étape b — voir
  // lib/amortissements.ts) : au 31 décembre, sans pièce ni mouvement, justifiée par le tableau
  // d'amortissement. Nul sur toute autre écriture. Clé sans action à la suppression : un bien dont une
  // dotation est écrite ne se retire que par `retirer_immobilisation`, qui emporte ses dotations.
  immobilisation_id: string | null
}

// Solde d'ouverture d'un compte de bilan, repris de la balance d'un dossier venu d'un autre logiciel
// (voir lib/aNouveaux.ts). Toutes les lignes d'un dossier portent la même date — un 1er janvier — et
// la même balance source : la base le garantit (trigger `a_nouveaux_une_seule_ouverture`), et
// `enregistrer_a_nouveaux` les remplace en une seule transaction, en refusant un jeu déséquilibré.
// À part du brouillon, et c'est voulu : une écriture du brouillon a une pièce, un à-nouveau a une
// balance pour justificatif. Les mêler aurait fait crier « sans justificatif » tous les contrôles.
export interface ANouveau {
  id: string
  dossier_id: string
  date: string
  // Le compte de l'application : un compte de banque de la balance (512…) est ramené au compte banque.
  compte: string
  // Le numéro lu dans la balance. Nul sur la ligne du résultat, que l'application calcule.
  compte_origine: string | null
  libelle: string
  sens: SensEcriture
  montant: number
  source_nom: string
  // SHA-256 du fichier de balance : la preuve de ce qui a été repris, comme pour une pièce.
  source_empreinte: string
  created_at: string
}

// La profession, au sens des règles de l'Urssaf pour les praticiens et auxiliaires médicaux
// conventionnés : c'est elle qui décide de la prise en charge par l'Assurance maladie et du taux de
// la CURPS. Infirmiers, masseurs-kinésithérapeutes, orthophonistes, orthoptistes et
// pédicures-podologues sont des auxiliaires médicaux.
export type ProfessionPamc =
  | 'auxiliaire_medical'
  | 'sage_femme'
  | 'medecin_secteur_1'
  | 'medecin_secteur_2'
  | 'chirurgien_dentiste'

// Les chiffres du volet social d'un praticien conventionné pour un exercice (voir
// lib/voletSocialPamc.ts), gardés parce qu'ils viennent du relevé SNIR et non de la comptabilité.
// Un montant absent (null) veut dire « pas encore saisi », jamais zéro : un zéro se saisit.
export interface VoletSocialPamc {
  id: string
  dossier_id: string
  annee: number
  profession: ProfessionPamc | null
  // Remplaçant exclusif au 1er janvier : pas de CURPS, et DSAV porte les rétrocessions reçues.
  remplacant: boolean
  // DSCS. Absent : l'application reprend la ligne 4 de la 2035-A (recettes nettes).
  recettes_brutes: number | null
  // DSAV, honoraires de l'activité conventionnée du relevé SNIR.
  honoraires_conventionnes: number | null
  // DSAW, dépassements d'honoraires du relevé SNIR.
  depassements: number | null
  // DSAT, recettes perçues en structures de soins (EHPAD, SSIAD, HAD, CMPP…).
  recettes_structures: number | null
}

// Nature d'un bien immobilisé (téléphone, véhicule, mobilier...) — elle suggère une durée
// d'amortissement usuelle à l'enregistrement d'une immobilisation, et elle porte le COMPTE de classe 2 du
// bien, d'où se déduit son compte d'amortissement (`compteAmortissement`, lib/amortissements.ts) : c'est
// lui que la dotation crédite. Les catégories de dépense (Achats fournisseurs, Autre...) ne s'y prêtent
// pas, un téléphone et une voiture tombant souvent dans la même catégorie de dépense alors qu'ils n'ont
// pas la même durée d'usage. dossier_id null = règle partagée par tous les dossiers, sinon spécifique à
// un dossier.
export interface NatureImmobilisation {
  id: string
  dossier_id: string | null
  libelle: string
  duree_annees_defaut: number
  ordre: number
  // Immobilisation incorporelle (20…) ou corporelle (21…), six chiffres — la base le vérifie.
  compte_immobilisation: string
}

// Palier 5, brique 2 — registre des immobilisations. Une pièce validée dépassant le seuil peut être
// enregistrée ici plutôt que traitée comme une charge courante ; la durée d'amortissement est une
// suggestion de la nature, l'arbitrage réel restant à l'expert-comptable. L'amortissement est
// LINÉAIRE, PRORATA TEMPORIS depuis la mise en service (lib/amortissements.ts) : c'est le calcul que la
// 2035 compte en case CH et que la base vérifie quand la dotation s'écrit.
export interface Immobilisation {
  id: string
  dossier_id: string
  piece_id: string | null
  nature_id: string | null
  libelle: string
  // Au centime : la base le garantit, le calcul la prenant en centimes entiers.
  valeur: number
  date_acquisition: string
  // Le point de départ de l'amortissement. Nulle, c'est la date d'acquisition (`miseEnService`).
  date_mise_en_service: string | null
  duree_annees: number
  created_at: string
}

// Palier 5, brique 4 — suivi des cotisations sociales URSSAF. Le montant_csg_crds est saisi
// séparément du montant total appelé car un appel URSSAF cumule plusieurs cotisations (maladie,
// retraite, CSG-CRDS...) — seule la part CSG-CRDS visible sur le décompte peut être ventilée
// déductible/non déductible, jamais le montant appelé dans son ensemble.
export interface CotisationDeclaree {
  id: string
  dossier_id: string
  echeance: string
  montant_appele: number
  montant_verse: number | null
  montant_csg_crds: number | null
  // Une échéance CARPIMKO peut apparaître dans une section "ÉCHÉANCIER PRÉVISIONNEL" (estimation pour
  // l'année suivante, pas encore un appel officiel) plutôt que l'échéancier confirmé — prélevée telle
  // quelle par la caisse en pratique, donc suivie comme les autres plutôt qu'ignorée, mais signalée
  // pour ne pas la confondre avec un montant définitif. Repassée à false quand l'appel définitif
  // arrive et corrige le montant (voir CotisationsTab.creerEcheancesProposees).
  previsionnel: boolean
  created_at: string
}

// Détail par poste (Achats, Loyer, Assurance...) d'un repère annuel — complète le CA et les
// cotisations sociales de ReferenceAnnuelle par les "autres charges", pour comparer une année sur
// l'autre poste par poste plutôt qu'en un seul total. Indépendant de ReferenceAnnuelle (pas besoin
// que celle-ci existe pour ce faire) : calculé automatiquement en réutilisant le regroupement par
// poste_2035 déjà utilisé dans l'onglet Clôture si l'année est dans ce dossier, ou saisi à la main
// (poste libre, pas de liste imposée) sinon.
export interface ReferencePosteAnnuel {
  id: string
  dossier_id: string
  annee: number
  poste: string
  montant: number
  created_at: string
}

export type SourceReference = 'calculee' | 'saisie_manuelle'

// Repère annuel (CA + total cotisations sociales) utilisé pour l'estimation des charges de l'année en
// cours. "calculee" quand l'année est entièrement dans l'appli (sommée automatiquement depuis les
// pièces/cotisations de ce dossier) ; "saisie_manuelle" quand le cabinet transcrit les chiffres de la
// 2035 réellement déposée par le client, faute d'historique applicatif pour cette année-là.
export interface ReferenceAnnuelle {
  id: string
  dossier_id: string
  annee: number
  chiffre_affaires: number | null
  total_cotisations_sociales: number | null
  // Bénéfice/résultat net déjà officiellement déclaré sur une 2035 réelle — jamais calculé par
  // l'appli (ce serait précisément le calcul qu'on refuse de faire ailleurs), uniquement transcrit à
  // la main ou lu depuis le document. "calculee" ne le renseigne jamais.
  resultat_net: number | null
  source: SourceReference
  notes: string | null
  created_at: string
}

// Montant de TVA réellement déclaré à l'administration (CA3) sur une période — jamais calculé par
// l'appli, saisi une fois le dépôt réel fait, pour comparer ensuite au total du brouillon sur la même
// période (voir EcrituresTab). Même logique que ReferenceAnnuelle : une vérité externe transcrite, pas
// une donnée dérivée.
export type PeriodiciteTva = 'mensuelle' | 'trimestrielle'

export type ModeComptable = 'tresorerie' | 'engagement'
// 455 : compte courant d'un dirigeant associé d'une société ; 108 : compte de l'exploitant d'une
// entreprise individuelle ; 467 : autres comptes débiteurs ou créditeurs. Voir lib/engagement.ts.
export type CompteNotesDeFrais = '455000' | '108000' | '467000'

export interface DeclarationTva {
  id: string
  dossier_id: string
  periode_debut: string
  periode_fin: string
  // La TVA nette DE LA PÉRIODE telle que déposée : TVA brute (ligne 16) moins TVA déductible de la
  // période (lignes 19 à 21), sans le crédit reporté de la déclaration précédente — c'est ce qui se
  // compare au calcul de la même période (voir lib/declarationTva.ts). Négative sur une période en crédit.
  tva_declaree: number
  // Le crédit reporté de la déclaration précédente et porté sur celle-ci (ligne 22). C'est de lui
  // qu'on déduit le crédit que cette déclaration reporte à son tour (ligne 27).
  credit_anterieur: number
  date_declaration: string | null
  notes: string | null
  created_at: string
}

export type CategorieDocument = 'releve_bancaire' | 'cotisation' | 'attestation' | 'autre'

// Archive des documents qui ne sont ni des pièces d'achat/vente (pas de HT/TVA/TTC à extraire) ni des
// lignes bancaires : relevés de compte, attestations d'assurance/fiscales, appels de cotisation avant
// rattachement à une échéance. Classés automatiquement à l'import en masse (voir la classification
// côté extract-piece), reclassables à la main depuis l'onglet Documents.
export interface DocumentDivers {
  id: string
  dossier_id: string
  sous_dossier_id: string | null
  storage_path: string
  storage_hash: string | null
  nom_fichier: string
  categorie: CategorieDocument
  // Rattaché à une échéance de cotisations_declarees une fois pointé depuis l'onglet Cotisations —
  // reste dans cette table (pas déplacé) pour que le rattachement soit réversible.
  attached_to_cotisation_id: string | null
  notes: string | null
  created_at: string
}

// Un commentaire porté sur une pièce ou un document déposé — voir lib/commentaires.ts pour ce qui le
// justifie. Exactement un de `piece_id` / `document_id` est renseigné (contrainte en base).
export interface PieceCommentaire {
  id: string
  dossier_id: string
  piece_id: string | null
  document_id: string | null
  auteur_id: string | null
  // Qui parle. Déduit du droit de l'auteur sur le dossier au moment de l'écriture, jamais déclaré
  // par l'écran : « le client dit que » et « l'opérateur suppose que » n'ont pas le même poids.
  origine: 'client' | 'cabinet'
  texte: string
  created_at: string
}

export type VehiculeType = 'aucun' | 'personnel_ik' | 'societe'

// Un véhicule du cadre 7 du 2035-B (« Barèmes kilométriques »), pour un exercice donné. Le
// kilométrage est par année : l'option pour le forfait se prend au 1er janvier et vaut pour l'année
// entière (notice 2035-NOT-SD, renvoi 12), donc un même véhicule a une ligne par exercice.
export interface VehiculeDossier {
  id: string
  dossier_id: string
  annee: number
  modele: string | null
  type: 'voiture' | 'moto' | 'cyclomoteur'
  // Zéro pour un cyclomoteur, qui n'a pas de puissance fiscale au sens du barème.
  puissance_fiscale: number
  bareme: 'bnc' | 'bic'
  motorisation: 'thermique' | 'hydrogene' | 'hybride' | 'electrique' | null
  carburant: 'diesel' | 'super_sans_plomb' | 'gpl' | null
  km_professionnel: number
  // Véhicule inscrit au registre des immobilisations : ses amortissements sont à réintégrer, le
  // barème les couvrant déjà (notice, renvoi 12).
  inscrit_immobilisations: boolean
  amortissements_a_reintegrer: number | null
  created_at: string
  updated_at: string
}

// Informations déclaratives du client, saisies une fois et rarement modifiées — alimentent la
// checklist (véhicule société → justificatif d'achat attendu, tickets/chèques → justificatif à
// obtenir) et plus tard le calcul des paniers repas (jours_travailles_an). Une ligne par dossier,
// absente tant que personne n'a encore rempli cet onglet.
export interface InformationsDossier {
  id: string
  dossier_id: string
  vehicule_type: VehiculeType
  vehicule_libelle: string | null
  jours_travailles_an: number | null
  tickets_restaurant: boolean
  justificatif_tickets_restaurant_recu: boolean
  cheques_vacances: boolean
  justificatif_cheques_vacances_recu: boolean
  notes: string | null
  updated_at: string
}

// Marque de clôture d'un exercice, posée par le bouton de ClotureTab (voir lib/clotureExercice.ts).
// Ce n'est PAS une clôture comptable : aucun résultat, aucun impôt n'est figé ici. La ligne ne porte
// qu'une date, et elle commande deux choses — la purge du texte OCR des pièces sensibles de
// l'exercice (RGPD.md §8.3) et l'arrêt des réclamations de documents pour cet exercice sur les trois
// écrans « ce qu'il reste à envoyer » (voir lib/resteAEnvoyer.ts).
//
// Pas de colonne `cloture_par` : le cabinet est traité comme un seul acteur dans toute l'application
// (voir AgentConversation juste en dessous), et `cloture_le` suffit à dater le geste.
export interface ExerciceCloture {
  id: string
  dossier_id: string
  annee: number
  cloture_le: string
}

// Historique de l'agent comptable (voir AssistantTab, supabase/functions/agent-comptable) —
// partagé entre tous les admins du cabinet pour un dossier donné, comme le reste de l'appli
// (le cabinet est traité comme un seul acteur). created_by n'est qu'un repère d'audit.
// conversation_id regroupe les messages d'un même fil — un dossier peut avoir plusieurs conversations
// distinctes dans le temps (voir "Nouvelle conversation" dans AssistantTab), aucune n'écrasant les
// précédentes.
export interface AgentConversation {
  id: string
  dossier_id: string
  conversation_id: string
  role: 'user' | 'assistant'
  texte: string
  outils_utilises: string[] | null
  created_by: string | null
  created_at: string
}

// Charte graphique d'un cabinet (voir CabinetBrandingPage, lib/branding.ts) — couleur_primaire_claire
// n'est jamais saisie à la main (dérivée automatiquement de couleur_primaire à l'enregistrement, voir
// lib/colors.ts) : demander deux couleurs cohérentes à quelqu'un de non technique n'a pas de sens.
export interface Cabinet {
  id: string
  nom: string
  couleur_primaire: string | null
  couleur_primaire_claire: string | null
  police_google_font: string | null
  logo_storage_path: string | null
  created_at: string
}

export interface Membership {
  id: string
  user_id: string
  dossier_id: string
  role: 'client'
  created_at: string
}

export type RoleCabinetAdmin = 'comptable_en_chef' | 'comptable'

// Un membre de l'équipe du cabinet (voir EquipePage) — "en chef" voit tous les dossiers du cabinet,
// "comptable" seulement ceux qui lui sont explicitement assignés (voir DossierAssignation).
export interface CabinetAdmin {
  user_id: string
  cabinet_id: string
  role: RoleCabinetAdmin
  email: string | null
}

// Quels dossiers précis un comptable (rôle non "en chef") peut voir — gérée uniquement par un chef de
// cabinet (ou super-admin), voir EquipePage.
export interface DossierAssignation {
  id: string
  dossier_id: string
  user_id: string
  created_at: string
}

export type StatutFacture = 'brouillon' | 'validee'
export type TypeFacture = 'facture' | 'avoir'

// Facture émise par le dossier à un tiers (voir FacturesTab) — première brique pour émettre
// soi-même des factures conformes, pas seulement en recevoir (voir Piece.source === 'superpdp'). Tant
// que statut === 'brouillon', numero reste nul et tout le reste est librement modifiable ; à la
// validation, un numéro séquentiel sans trou est attribué une fois pour toutes (voir
// lib/factures.ts:attribuerNumeroFacture) et la facture n'est plus éditable — corriger une facture
// déjà numérotée se fait par une facture d'avoir (voir type/facture_origine_id, FactureAvoirModal),
// jamais en la rouvrant.
export interface FactureEmise {
  id: string
  dossier_id: string
  numero: string | null
  statut: StatutFacture
  // 'avoir' uniquement pour un document créé via FactureAvoirModal, jamais un brouillon (un avoir est
  // toujours créé déjà validé) — voir facture_origine_id. Sa numérotation vit dans une série "A"
  // indépendante de la série "F" des factures (voir prochain_numero_facture), et ses montants/lignes
  // sont toujours stockés négatifs : sommer tout montant_ttc d'un dossier/année annule alors
  // automatiquement l'effet de l'avoir sur le total, sans cas particulier à coder ailleurs.
  type: TypeFacture
  // Facture corrigée par cet avoir — non nul seulement si type === 'avoir'.
  facture_origine_id: string | null
  date_emission: string
  date_echeance: string | null
  tiers_nom: string
  tiers_adresse: string | null
  tiers_siret: string | null
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  mentions_legales: string | null
  notes: string | null
  // Identité de l'émetteur (nom/siret/adresse du dossier) recopiée à chaque enregistrement du
  // brouillon — jamais relue en direct depuis Dossier à l'affichage, pour qu'une facture déjà validée
  // ne change jamais rétroactivement si l'identité du dossier est corrigée plus tard.
  emetteur_nom: string | null
  emetteur_siret: string | null
  emetteur_adresse: string | null
  // Transmission via Super PDP (voir supabase/functions/superpdp-emit) — null tant que la facture n'a
  // jamais été envoyée par cette voie (l'impression/export PDF manuel reste toujours possible sans).
  // superpdp_dernier_statut est une dénormalisation du plus récent facture_superpdp_events.status_code
  // (fr:200 soumise, fr:205 acceptée, fr:210 refusée...) pour affichage rapide sans jointure.
  superpdp_invoice_id: number | null
  superpdp_dernier_statut: string | null
  // Dernière adresse utilisée pour un envoi par e-mail (voir send-email) — pré-remplit la prochaine
  // fois, jamais obligatoire (beaucoup de factures restent imprimées/exportées manuellement).
  tiers_email: string | null
  created_by: string | null
  created_at: string
  validated_at: string | null
}

// Un événement du cycle de vie d'une facture transmise via Super PDP (voir migration
// superpdp_emission_factures) — l'envoi est asynchrone, un statut à l'instant T ne dit rien du
// suivant : accumulés dans l'ordre, jamais remplacés.
export interface FactureSuperpdpEvent {
  id: string
  facture_id: string
  superpdp_event_id: number
  status_code: string
  status_text: string
  occurred_at: string
}

export interface FactureLigne {
  id: string
  facture_id: string
  ordre: number
  designation: string
  quantite: number
  prix_unitaire_ht: number
  // Pourcentage (0, 5.5, 10, 20...), pas un montant.
  taux_tva: number
}
