import { decimal, numeroAdmis, numeroTvaFrancais, sirenValide, TAUX_ADMIS } from './factureCii'

// LE FICHIER D'UNE DÉCLARATION D'E-REPORTING (ligne 28.5, étape e, sixième temps e6 ; conception du 09/10/2026,
// HISTORIQUE.md, « L'E-REPORTING : LA CONCEPTION », § 2 et § 5.1). Ce que la déclaration hors application (e5b1,
// lib/declarationsEreporting.ts) a FIGÉ devient le fichier XML du flux 10 de la DGFiP (« FRR »), celui qu'on dépose sur
// la plateforme agréée du dossier : ses ACHATS à un fournisseur établi hors de France (bloc 10.1, le dossier acheteur),
// ses VENTES à des particuliers agrégées par jour (bloc 10.3), leurs PAIEMENTS agrégés par jour (bloc 10.4).
//
// DEPUIS LE CONTENU FIGÉ, JAMAIS UN RECALCUL : le fichier écrit ce que la base garde de la déclaration
// (`declarations_ereporting.contenu`, la forme de `contenuADeclarer`), lu sans rien deviner — une donnée qui n'a pas la
// forme qu'e4 lui donne rend le contenu illisible, et rien ne s'écrit. Ce qu'e4 a décidé et figé (le rangement d'une
// opération, le cadre B1/S1/M1 d'une facture reçue, un avoir en montants positifs sous le type 381, un achat
// autoliquidé au code AE et au taux 0 — points 5, 6, 16 et 21 de la conception) s'écrit tel quel : ce module ne les
// tranche pas une seconde fois.
//
// SES SOURCES SONT PUBLIQUES, toutes dans l'archive des spécifications externes de la DGFiP v3.2 (impots.gouv.fr,
// specifications-externes-v3.2.zip, SHA-256 cd8f6e81…3862, que outils/facturation/ereporting/valider.mjs vérifie) : le
// dossier général (§ 3.7.1 à § 3.7.9, notes 117 à 131), l'annexe 6 « Format sémantique FE e-reporting » v1.10 (onglet
// « E-REPORTING - Flux 10 » : chemins, cardinalités, longueurs), l'annexe 7 « Règles de gestion » v1.9 (les règles G, P
// et S citées élément par élément), les cinq XSD du flux 10 et leur Changelog. Les normes AFNOR XP Z12-012 et
// XP Z12-013 ne s'utilisent pas (décision du cabinet du 07/10/2026). Le schéma juge la STRUCTURE — presque toutes ses
// feuilles sont des `xs:string` — : les règles de l'annexe 7 sont à la charge de ce module, une par une, et
// fluxEreporting.test.ts les éprouve ; ce que le schéma laisse passer et qu'elles interdisent (des transactions et des
// paiements dans un même fichier, G6.29) est refusé ICI.
//
// CE QUE LES SOURCES PUBLIQUES NE DISENT PAS est un PARAMÈTRE explicite, sans valeur par défaut (`ChoixFrr`), que le
// premier essai réel tranchera : les annexes décrivent le fichier que la PLATEFORME envoie à l'administration, celui
// qu'un client dépose sur sa plateforme relève de la norme exclue (conception, § 2.5 et point 1).
//   1. l'émetteur du fichier (TG-3) : la plateforme (son matricule, schéma 0238, rôle WK — G6.22, G7.51), le déclarant
//      lui-même, ou qui dépose pour lui (« le déclarant ou son OD », dit le XSD) ;
//   2. le fuseau de l'horodatage (TT-3), au format AAAAMMJJHHMMSS qui ne dit pas le sien (G7.53 ; point 17) ;
//   3. le code de l'option pour la TVA sur les débits (TT-80) : « code 5 (CII) ou 3 (UBL) » (G1.44), dans l'une ou
//      l'autre liste (P1.11), sans que rien ne dise lequel le flux 10 attend ;
//   4. un paiement NÉGATIF (TT-99, une contre-passation) : G7.07 admet le signe, G1.16 — que l'annexe 6 cite aussi pour
//      TT-95 et TT-99 — l'interdit (point 9).
// Une donnée que la base ne fige pas est un paramètre aussi : la raison sociale du déclarant (TT-14), celle du dossier
// au moment où le fichier se crée.
//
// UN REFUS PAR FAUTE, DANS UN ORDRE FIXÉ (`REFUS_FRR`), dit avant tout fichier (`refusFichierFrr`) : la déclaration,
// le contenu, les choix, l'en-tête, la période, puis chaque opération dans l'ordre du contenu, enfin l'absence
// d'opération. Une rectificative se dit RE (G8.01) : depuis la v3.1 des XSD, le fichier ne désigne plus celle qu'elle
// remplace (TG-2 et TT-5 supprimés, Changelog_XSD) — elle « annule et remplace l'ensemble des données […] transmises
// au titre de cette période » (dossier général, § 3.7.7). Le module ne lit ni la base ni l'horloge : l'appelant lui
// donne la déclaration lue, l'instant de création du fichier et ses choix.
//
// Ce qu'il ne fait pas : le bloc 10.2 (le paiement d'une facture à un client établi hors de France, étape e7) ; le
// dépôt par l'API d'une plateforme (étape e9, qui recopiera ce bloc dans plateforme-agreee) ; le bouton qui télécharge
// le fichier (étape e6b, après les écrans d'e5c).

// ── DÉBUT COPIE fluxEreporting ───────────────────────────────────────────────────────────────────────────────────────
// Ce bloc sera recopié AU CARACTÈRE PRÈS dans plateforme-agreee (étape e9), APRÈS ceux de montantsFacture.ts, de
// statutTva.ts et de factureCii.ts : il ne nomme hors de lui que cinq exports du bloc factureCii (decimal, numeroAdmis,
// numeroTvaFrancais, sirenValide, TAUX_ADMIS), et rien du DOM ni de Node — Intl et les chaînes suffisent, et Deno les
// a. Ses noms privés portent la marque « Frr » : la fonction qui le recevra a déjà ses `el`, `echapper`, `serialiser`,
// `NS`, `montant`, `uneLigne`. fluxEreportingCopie.test.ts compile et exécute le bloc derrière ces trois-là, et
// confronte ses noms à ceux de la fonction.

// Le profil du flux de e-reporting (TT-29 ; S1.12 : « Pour le Flux de e-reporting urn.cpro.gouv.fr:1p0:ereporting »).
export const PROFIL_EREPORTING = 'urn.cpro.gouv.fr:1p0:ereporting'

// La version du contenu figé que ce bloc sait écrire (lib/declarationsEreporting.ts, `VERSION_DU_CONTENU`).
export const VERSION_DU_CONTENU_FRR = 1

// Les trois déclarations d'une période, et le rôle de leur déclarant (G7.52 : « BY : Acheteur ; SE : Vendeur ») : un
// fichier n'en porte qu'un (TT-15, 1..1), les achats en acheteur, les ventes et leurs paiements en vendeur.
export const OBJETS_FRR = ['ventes', 'achats', 'paiements'] as const
export type ObjetFrr = (typeof OBJETS_FRR)[number]
export const ROLE_DU_DECLARANT_FRR: Readonly<Record<ObjetFrr, 'SE' | 'BY'>> = { ventes: 'SE', achats: 'BY', paiements: 'SE' }

// Où chaque contenu range ses opérations (e4), et ce que le refus G6.29 en dit.
const OPERATIONS_FRR: Readonly<Record<ObjetFrr, string>> = { ventes: 'transactions', achats: 'achats', paiements: 'paiements' }
const NOMS_DES_OPERATIONS_FRR: Readonly<Record<ObjetFrr, string>> = {
  ventes: 'des ventes à des particuliers', achats: 'des achats', paiements: 'des paiements',
}

// Les types de facture que les fiches décrivent (TT-21) : la facture commerciale (380) et l'avoir (381), deux des
// types de G1.01.
export const TYPES_DE_FACTURE_FRR = ['380', '381'] as const

// Les cadres de facturation (TT-28) que G1.02 admet.
export const CADRES_FRR = ['B1', 'S1', 'M1', 'B2', 'S2', 'M2', 'B4', 'S4', 'M4', 'S5', 'S6', 'B7', 'S7'] as const

// Les codes de type de TVA (TT-56) que G2.31 admet : S, E, AE, K, G, O, Z.
export const CODES_TVA_FRR = ['S', 'E', 'AE', 'K', 'G', 'O', 'Z'] as const

// Les catégories de transactions (TT-81) de G1.68.
export const CATEGORIES_FRR = ['TLB1', 'TPS1', 'TNT1', 'TMA1'] as const

// Les vingt-six autres États membres de l'Union : le fournisseur qui y est établi se désigne par son numéro de TVA
// (schéma 0223, « UE_HORS_FRANCE »), un autre par son pays et son nom (0227, « HORS_UE ») — G2.19.
export const ETATS_MEMBRES_FRR: readonly string[] = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]

// Un code de motif d'exonération (TT-59, « EN16931 Codelists » : la liste VATEX), 30 caractères au plus — la forme que
// la fiche d'un achat exige déjà (lib/piecesHorsDeFrance.ts, `MOTIF_VATEX`).
export const MOTIF_VATEX_FRR =/^VATEX-[A-Z]{2}-[0-9A-Z]+(-[0-9A-Z]+)*$/

// Le motif d'un avoir net de taxe, que seul un avoir porte (G6.21).
export const MOTIF_AVOIR_NET_DE_TAXE_FRR = 'VATEX-FR-CNWVAT'

// ── Les choix que les sources publiques ne tranchent pas ───────────────────────────────────────────────────────────

// 1. L'émetteur du fichier (TG-3 : TT-8 et son schéma TT-7, TT-9, TT-10). Les schémas : 0002, un SIREN (le schéma du
// déclarant, G6.26), ou 0238, le matricule d'une plateforme (G6.22 ; quatre chiffres, `IdentifiantMatriculePlateformeType`
// du XSD de l'annuaire de la même archive). Les rôles : WK, celui d'une plateforme (G7.51), ou celui du déclarant quand
// il émet lui-même (SE ou BY, G7.52).
export const SCHEMAS_EMETTEUR_FRR = ['0002', '0238'] as const
export type SchemaEmetteurFrr = (typeof SCHEMAS_EMETTEUR_FRR)[number]
export const ROLES_EMETTEUR_FRR = ['WK', 'SE', 'BY'] as const
export type RoleEmetteurFrr = (typeof ROLES_EMETTEUR_FRR)[number]

export interface EmetteurFrr {
  identifiant: string
  schema: SchemaEmetteurFrr
  // TT-9, 1..1 : 150 caractères au plus (annexe 6).
  nom: string
  role: RoleEmetteurFrr
}

// 2. Le fuseau dans lequel l'instant de création s'écrit (TT-3, AAAAMMJJHHMMSS, G7.53).
export const FUSEAUX_FRR = ['Europe/Paris', 'UTC'] as const
export type FuseauFrr = (typeof FUSEAUX_FRR)[number]

// 3. Le code qui dit l'option pour la TVA sur les débits (TT-80) : 5, de la liste UNTDID 2475 (celui que la facture
// CII de l'application écrit), ou 3, de la liste UNTDID 2005.
export const CODES_OPTION_DEBITS_FRR = ['5', '3'] as const
export type CodeOptionDebitsFrr = (typeof CODES_OPTION_DEBITS_FRR)[number]

// 4. Un montant de paiement négatif (TT-99) : écrit avec son signe (G7.07), ou refusé (G1.16).
export const PAIEMENTS_NEGATIFS_FRR = ['ecrits_avec_leur_signe', 'refuses'] as const
export type PaiementsNegatifsFrr = (typeof PAIEMENTS_NEGATIFS_FRR)[number]

export interface ChoixFrr {
  emetteur: EmetteurFrr
  fuseau: FuseauFrr
  codeOptionDebits: CodeOptionDebitsFrr
  paiementsNegatifs: PaiementsNegatifsFrr
}

// ── Ce que le bloc lit ─────────────────────────────────────────────────────────────────────────────────────────────

// La déclaration telle que la base la garde (`declarations_ereporting`), sous les noms et les types des colonnes : une
// ligne lue par une Edge Function s'y passe telle quelle. Les textes sont des `string` : une valeur que la base ne
// connaît pas se refuse, elle n'est pas une erreur de type.
export interface DeclarationPourFrr {
  // TT-1 : l'identifiant de la déclaration est celui de la transmission (conception, § 3.4).
  id: string
  objet: string
  periode_debut: string
  periode_fin: string
  // TT-4.
  type_transmission: string
  remplace_id: string | null
  etat: string
  // Le contenu figé, tel que `jsonb` le rend.
  contenu: unknown
}

export interface DonneesFrr {
  declaration: DeclarationPourFrr
  // TT-14 : la raison sociale du déclarant, que le contenu ne fige pas.
  nomDuDeclarant: string
  // TT-3 : l'instant où le fichier se crée.
  maintenant: Date
  choix: ChoixFrr
}

// ── Les refus, dans leur ordre ─────────────────────────────────────────────────────────────────────────────────────

// Chaque « % » reçoit une valeur, dans l'ordre. `regle` dit d'où vient le refus ; le message ne cite aucun texte : il
// dit la règle.
export const REFUS_FRR = [
  // La déclaration.
  {
    cle: 'objet_inconnu', regle: 'G7.52, G6.29',
    modele: 'Une déclaration d’e-reporting porte sur les ventes, les achats ou les paiements du dossier : « % » n’est aucun des trois.',
  },
  {
    cle: 'declaration_remplacee', regle: 'dossier général, § 3.7.7',
    modele: 'Cette déclaration a été remplacée par une rectificative : son fichier ne se dépose plus, celui de la rectificative si.',
  },
  { cle: 'type_de_transmission', regle: 'G8.01', modele: 'Une transmission est initiale (IN) ou rectificative (RE) : « % » n’est ni l’une ni l’autre.' },
  {
    cle: 'rectificative_discordante', regle: 'dossier général, § 3.7.7',
    modele: 'La déclaration se contredit : une rectificative (RE) remplace une déclaration de la période, une initiale (IN) n’en remplace aucune.',
  },
  {
    cle: 'identifiant_de_transmission', regle: 'G1.104 ; annexe 6, TT-1',
    modele: 'L’identifiant de la transmission ne s’écrit pas dans le fichier : 50 caractères au plus — lettres sans accent, chiffres, '
      + '« - », « + », « _ », « / » et des espaces simples, ni au début ni à la fin.',
  },
  // Le contenu figé.
  { cle: 'contenu_illisible', regle: 'lib/declarationsEreporting.ts', modele: 'Le contenu figé de la déclaration ne se lit pas (%) : rien ne s’en écrit.' },
  {
    cle: 'version_du_contenu', regle: 'lib/declarationsEreporting.ts',
    modele: 'Le contenu figé est de la version %, que ce module ne sait pas écrire : il écrit la version %.',
  },
  {
    cle: 'contenu_d_une_autre_declaration', regle: 'lib/declarationsEreporting.ts',
    modele: 'Le contenu figé ne porte pas sur l’objet et la période de la déclaration : relisez.',
  },
  {
    cle: 'role_du_declarant', regle: 'G7.52 ; annexe 6, TT-15',
    modele: 'Le contenu dit le déclarant « % » : il déclare ses achats en acheteur (BY), ses ventes et leurs paiements en vendeur (SE).',
  },
  {
    cle: 'objets_meles', regle: 'G6.29, G7.52 ; dossier général, note 129',
    modele: 'Le contenu porte aussi % : un fichier ne porte que des transactions ou que des paiements, d’un seul rôle de déclarant.',
  },
  // Les choix.
  { cle: 'emetteur_absent', regle: 'annexe 6, TG-3', modele: 'L’émetteur du fichier n’est pas dit : il ne se devine pas.' },
  {
    cle: 'emetteur_schema', regle: 'G6.22 ; annexe 6, TT-7',
    modele: 'L’émetteur du fichier est désigné sous un schéma inconnu (« % ») : 0002, un SIREN, ou 0238, le matricule d’une plateforme.',
  },
  {
    cle: 'emetteur_siren', regle: 'G6.26 ; annexe 6, TT-8',
    modele: 'L’émetteur du fichier est désigné par un SIREN qui n’en est pas un (neuf chiffres et leur clé).',
  },
  {
    cle: 'emetteur_matricule', regle: 'G6.22 ; annexe 6, TT-8',
    modele: 'L’émetteur du fichier est désigné par un matricule de plateforme qui n’a pas quatre chiffres.',
  },
  {
    cle: 'emetteur_role', regle: 'G7.51, G7.52 ; annexe 6, TT-10',
    modele: 'L’émetteur du fichier a un rôle inconnu (« % ») : WK pour une plateforme, ou le rôle du déclarant quand il émet lui-même.',
  },
  { cle: 'emetteur_plateforme', regle: 'G6.22, G7.51', modele: 'Une plateforme désignée par son matricule émet sous le rôle WK.' },
  {
    cle: 'emetteur_declarant', regle: 'G7.52',
    modele: 'Sous le rôle « % », l’émetteur est le déclarant lui-même : son SIREN, sous le schéma 0002, et le rôle qu’il déclare.',
  },
  { cle: 'emetteur_nom', regle: 'annexe 6, TT-9', modele: 'La raison sociale de l’émetteur du fichier manque, ou dépasse 150 caractères.' },
  { cle: 'fuseau', regle: 'G7.53', modele: 'Le fuseau de l’horodatage du fichier, « % », n’est ni Europe/Paris ni UTC.' },
  { cle: 'code_option_debits', regle: 'G1.44, P1.11', modele: 'Le code de l’option pour la TVA sur les débits, « % », n’est ni 5 ni 3.' },
  {
    cle: 'choix_paiements_negatifs', regle: 'G7.07, G1.16',
    modele: 'Ce que devient un paiement négatif, « % », n’est ni l’écrire avec son signe ni le refuser.',
  },
  // L'en-tête.
  { cle: 'horodatage', regle: 'G7.53 ; annexe 6, TT-3', modele: 'L’instant de création du fichier n’est pas un instant.' },
  {
    cle: 'horodatage_avant_la_fin', regle: 'G7.43',
    modele: 'Le fichier serait daté du % (%), qui n’est pas après la fin de la période, le % : il se crée une fois la période finie.',
  },
  {
    cle: 'siren_du_declarant', regle: 'G6.26',
    modele: 'Le SIREN du déclarant n’en est pas un (neuf chiffres et leur clé) : le fichier se fait au SIREN du dossier.',
  },
  { cle: 'nom_du_declarant', regle: 'annexe 6, TT-14', modele: 'La raison sociale du déclarant manque, ou dépasse 150 caractères.' },
  {
    cle: 'numero_tva_du_declarant', regle: 'G2.33, G6.28',
    modele: 'Le numéro de TVA du dossier manque au contenu, ou n’est pas celui de son SIREN : le fichier de ses achats le porte toujours.',
  },
  // La période.
  { cle: 'periode_dates', regle: 'G1.09, G1.36', modele: 'Une borne de la période n’est pas une date des années 2000 à 2099.' },
  {
    cle: 'periode_bornes', regle: 'G6.25',
    modele: 'La période commence le % et finit le % : une période de transmission finit après son début.',
  },
  // Les achats (bloc 10.1).
  { cle: 'achat_hors_periode', regle: 'TG-7 ; dossier général, note 125', modele: 'La facture n° % est rangée au %, hors de la période.' },
  {
    cle: 'achat_numero', regle: 'G1.05',
    modele: 'Le numéro d’une facture rangée au % ne s’écrit pas dans le fichier : 35 caractères au plus — lettres sans accent, '
      + 'chiffres, « - », « + », « _ », « / » et des espaces simples, ni au début ni à la fin.',
  },
  {
    cle: 'achat_date', regle: 'G1.09, G1.36, G1.07',
    modele: 'La facture n° % est datée du %, qui n’est pas une date des années 2000 à 2099 déjà arrivée quand le fichier se crée.',
  },
  { cle: 'achat_type', regle: 'G1.01', modele: 'La facture n° % n’est ni une facture (380) ni un avoir (381) : « % ».' },
  { cle: 'achat_avoir_sans_origine', regle: 'G1.32', modele: 'L’avoir n° % ne cite pas la facture qu’il corrige, avec sa date.' },
  {
    cle: 'achat_origine', regle: 'G1.05, G1.09, G1.36, G1.07',
    modele: 'L’avoir n° % cite une facture d’origine qui ne s’écrit pas dans le fichier : un numéro de 35 caractères admis, et une '
      + 'date des années 2000 à 2099 déjà arrivée.',
  },
  { cle: 'achat_devise', regle: 'G1.10', modele: 'La facture n° % est en « % », qui n’est pas un code de devise de trois lettres.' },
  { cle: 'achat_cadre', regle: 'G1.02', modele: 'La facture n° % porte un cadre de facturation inconnu (« % »).' },
  {
    cle: 'achat_vendeur_schema', regle: 'G2.19',
    modele: 'Le fournisseur de la facture n° % se désigne sous un schéma inconnu (« % ») : 0223, son numéro de TVA dans l’Union, '
      + 'ou 0227, son pays et son nom hors de l’Union.',
  },
  {
    cle: 'achat_vendeur_pays', regle: 'G2.01, G2.19, G6.08',
    modele: 'Le fournisseur de la facture n° % est dit établi en « % », qui n’est pas un pays hors de France que son schéma admet.',
  },
  {
    cle: 'achat_vendeur_identifiant', regle: 'G2.19',
    modele: 'Le fournisseur de la facture n° % a un identifiant que le fichier n’admet pas : 18 caractères au plus — son numéro de '
      + 'TVA dans l’Union, son code de pays suivi des seize premiers caractères de sa dénomination hors de l’Union.',
  },
  {
    cle: 'achat_livraison', regle: 'G1.09, G1.36, G6.20',
    modele: 'La date de livraison ou la période de facturation de la facture n° % ne s’écrit pas : des dates des années 2000 à '
      + '2099, une période qui ne finit pas avant de commencer.',
  },
  { cle: 'achat_sans_ventilation', regle: 'annexe 6, TG-23', modele: 'La facture n° % n’a pas de ventilation par taux.' },
  { cle: 'achat_code_tva', regle: 'G2.31', modele: 'La facture n° % porte un code de TVA inconnu (« % »).' },
  { cle: 'achat_taux', regle: 'G1.24', modele: 'La facture n° % porte un taux de TVA que le fichier n’admet pas (%).' },
  {
    cle: 'achat_motif', regle: 'G1.40 ; annexe 6, TT-58, TT-59',
    modele: 'Une part exonérée (E) de la facture n° % ne porte pas son motif : un code de la liste VATEX de 30 caractères au '
      + 'plus, et un libellé de 1 024 caractères au plus.',
  },
  { cle: 'achat_motif_d_avoir', regle: 'G6.21', modele: 'La facture n° % porte le motif d’un avoir net de taxe : seul un avoir le porte.' },
  {
    cle: 'achat_tva_du_vendeur', regle: 'G1.102',
    modele: 'La facture n° % porte une part exonérée (E) : le fichier demande alors le numéro de TVA du fournisseur, qu’un '
      + 'fournisseur établi hors de l’Union n’a pas.',
  },
  { cle: 'achat_totaux', regle: 'G1.53', modele: 'Les totaux de la facture n° % ne font pas la somme de sa ventilation.' },
  // Les ventes à des particuliers (bloc 10.3).
  { cle: 'ventes_date', regle: 'G1.09, G1.36, G1.07 ; TG-7', modele: 'Des ventes sont datées du %, qui n’est pas un jour de la période.' },
  {
    cle: 'ventes_devise', regle: 'G6.23, G1.53',
    modele: 'Les ventes du % sont en « % » : celles de l’application sont en euros, et le fichier dit leur TVA en euros.',
  },
  { cle: 'ventes_categorie', regle: 'G1.68', modele: 'Les ventes du % sont d’une catégorie inconnue (« % »).' },
  {
    cle: 'ventes_option_hors_services', regle: 'G1.67, G1.44',
    modele: 'Les ventes de biens du % portent l’option pour la TVA sur les débits, qui ne vise que des prestations de services.',
  },
  { cle: 'ventes_sans_ventilation', regle: 'annexe 6, TG-32', modele: 'Les ventes du % n’ont pas de répartition par taux.' },
  { cle: 'ventes_taux', regle: 'G1.24', modele: 'Les ventes du % portent un taux de TVA que le fichier n’admet pas (%).' },
  { cle: 'ventes_totaux', regle: 'G1.53', modele: 'Les totaux des ventes du % ne font pas la somme de leur répartition par taux.' },
  // Les paiements des ventes à des particuliers (bloc 10.4).
  { cle: 'paiements_date', regle: 'G1.09, G1.36, G1.07 ; TG-33', modele: 'Des paiements sont datés du %, qui n’est pas un jour de la période.' },
  { cle: 'paiements_sans_ventilation', regle: 'annexe 6, TG-39', modele: 'Les paiements du % n’ont pas de répartition par taux.' },
  { cle: 'paiements_taux', regle: 'G1.24', modele: 'Les paiements du % portent un taux de TVA que le fichier n’admet pas (%).' },
  {
    cle: 'paiement_negatif', regle: 'G1.16',
    modele: 'Les paiements du % sont négatifs au taux de % : le choix retenu ne les écrit pas.',
  },
  // Les textes libres.
  { cle: 'caractere_interdit', regle: 'XML 1.0, § 2.2', modele: '% porte un caractère que XML n’admet pas : il ne s’écrirait pas tel quel.' },
  // La fin.
  {
    cle: 'aucune_operation', regle: 'CGI, ann. II, art. 242 nonies O ; BOI-TVA-DECLA-20-30-50-30, § 80',
    modele: 'Le contenu ne porte aucune opération : une période sans opération ne se transmet pas.',
  },
] as const

export type CleRefusFrr = (typeof REFUS_FRR)[number]['cle']

export interface RefusFrr {
  cle: CleRefusFrr
  regle: string
  message: string
}

export type ResultatFrr = { xml: string; refus: [] } | { xml: null; refus: RefusFrr[] }

// Le modèle rempli, « % » après « % » : une valeur qui porte un « % » ne se relit pas comme un trou.
function remplirFrr(modele: string, valeurs: readonly string[]): string {
  const morceaux = modele.split('%')
  return morceaux.map((m, i) => (i === 0 ? m : `${valeurs[i - 1] ?? ''}${m}`)).join('')
}

function refusFrr(cle: CleRefusFrr, ...valeurs: string[]): RefusFrr {
  const r = REFUS_FRR.find((x) => x.cle === cle) as (typeof REFUS_FRR)[number]
  return { cle, regle: r.regle, message: remplirFrr(r.modele, valeurs) }
}

const rangFrr = (cle: CleRefusFrr) => REFUS_FRR.findIndex((r) => r.cle === cle)

// ── Les formes du format ───────────────────────────────────────────────────────────────────────────────────────────

const JOURS_FRR = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// Une date civile AAAA-MM-JJ qui existe au calendrier, sans passer par une Date : elle n'a pas de fuseau.
function dateCivileFrr(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const bissextile = (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
  const dernier = mois === 2 && bissextile ? 29 : JOURS_FRR[mois - 1]
  // Un mois hors de 1 à 12 n'a pas d'entrée : `jour <= undefined` est faux.
  return jour >= 1 && jour <= dernier
}

// Une date que le fichier écrit : une date civile (G1.09 la veut AAAAMMJJ, « une date sans tiret »), d'une année de
// 2000 à 2099 (G1.36).
const dateAdmiseFrr = (iso: string) => dateCivileFrr(iso) && iso >= '2000-01-01' && iso <= '2099-12-31'
const dateFrr = (iso: string) => iso.replace(/-/g, '')

// Pour les messages : une date civile en JJ/MM/AAAA, une autre forme telle quelle ; un taux « 5,5 % ».
const jourLisibleFrr = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso)
const tauxLisibleFrr = (taux: number) => `${String(taux).replace('.', ',')} %`

/**
 * Un instant au format AAAAMMJJHHMMSS (G7.53), dans le fuseau choisi ; null s'il n'en est pas un, ou si le fuseau
 * n'est pas l'un des deux (Intl lèverait sur un nom inconnu). Le calendrier et l'heure d'été sont ceux d'Intl.
 */
export function horodatageFrr(instant: Date, fuseau: FuseauFrr): string | null {
  if (!(FUSEAUX_FRR as readonly string[]).includes(fuseau)) return null
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return null
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ''
  const texte = `${partie('year')}${partie('month')}${partie('day')}${partie('hour')}${partie('minute')}${partie('second')}`
  return /^\d{14}$/.test(texte) ? texte : null
}

// Un montant au centime (G1.14 pour une facture et des transactions, G7.07 pour des paiements) : le point décimal, deux
// décimales, le signe en tête. Un entier sûr de centimes a au plus seize chiffres : les dix-neuf positions des deux
// règles tiennent toujours — le contenu qui ne serait pas un entier sûr est illisible avant d'arriver ici.
function montantFrr(centimes: number): string {
  const a = Math.abs(centimes)
  const texte = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`
  return centimes < 0 ? `-${texte}` : texte
}

// Un taux admis (G1.24), écrit en pourcentage sans le symbole : « 20 », « 5.5 », « 0 ».
const tauxAdmisFrr = (taux: number) => TAUX_ADMIS.includes(taux)
const tauxFrr = (taux: number) => decimal(taux, 2) as string

// L'identifiant de la transmission (TT-1, 50 caractères ; G1.104) : alphanumérique, l'espace, « - », « + », « _ » et
// « / », jamais seulement des espaces, ni en tête, ni en fin, ni deux de suite. Un identifiant de déclaration (un UUID)
// la respecte toujours.
const IDENTIFIANT_DE_TRANSMISSION_FRR = /^[A-Za-z0-9 +_/-]{1,50}$/
const identifiantDeTransmissionAdmis = (id: string) =>
  IDENTIFIANT_DE_TRANSMISSION_FRR.test(id) && id.trim() === id && !id.includes('  ')

// Des CARACTÈRES, pas des unités UTF-16 : un emoji en vaut deux pour String.length.
const caracteresFrr = (texte: string) => [...texte].length
const uneLigneFrr = (texte: string) => texte.replace(/\s+/g, ' ').trim()

// Un caractère que XML 1.0 n'admet pas (§ 2.2, production Char) : les caractères de commande hors tabulation, saut de
// ligne et retour, une demi-paire de substitution, U+FFFE et U+FFFF.
const HORS_XML_FRR = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u

// ── La lecture du contenu figé ─────────────────────────────────────────────────────────────────────────────────────

// Ce que le contenu figé porte, sous les noms et les types qu'e4 lui donne (lib/ereporting.ts : `AchatDeclare`,
// `TransactionsDuJour`, `PaiementsDuJour`) — les seules données que le fichier écrit, ou qui le décident.
export interface LigneAchatFrr {
  code: string
  taux: number
  baseCentimes: number
  tvaCentimes: number
  motifCode: string | null
  motifTexte: string | null
}

export interface AchatFrr {
  date: string
  numero: string
  dateFacture: string
  typeDocument: string
  origine: { numero: string; date: string } | null
  devise: string
  pays: string
  schema: string
  identifiant: string
  cadre: string
  dateOperation: string | null
  periodeDebut: string | null
  periodeFin: string | null
  lignes: LigneAchatFrr[]
  htCentimes: number
  tvaEurosCentimes: number
}

export interface TransactionsFrr {
  date: string
  devise: string
  categorie: string
  optionDebits: boolean
  htCentimes: number
  tvaCentimes: number
  parTaux: { taux: number; baseCentimes: number; tvaCentimes: number }[]
}

export interface PaiementsFrr {
  date: string
  parTaux: { taux: number; montantCentimes: number }[]
}

interface ContenuLuFrr {
  debut: string
  fin: string
  role: string
  siren: string | null
  numeroTva: string | null
  achats: AchatFrr[]
  transactions: TransactionsFrr[]
  paiements: PaiementsFrr[]
}

// La lecture garde sa PREMIÈRE faute, où elle est et ce qu'il y fallait — jamais la valeur lue.
interface LecteurFrr {
  faute: string | null
}

type ObjetJsonFrr = Record<string, unknown>
const estObjetFrr = (v: unknown): v is ObjetJsonFrr => typeof v === 'object' && v !== null && !Array.isArray(v)

function fauteFrr(l: LecteurFrr, chemin: string, attendu: string): void {
  if (l.faute == null) l.faute = `${chemin} : ${attendu}`
}

function texteFrr(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string): string {
  const v = o[cle]
  if (typeof v === 'string') return v
  fauteFrr(l, `${chemin}${cle}`, 'un texte est attendu')
  return ''
}

// Une clé qu'e4 écrit toujours, nulle quand la donnée manque : absente, le contenu n'est pas le sien.
function texteOuNulFrr(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string): string | null {
  const v = o[cle]
  if (v === null || typeof v === 'string') return v
  fauteFrr(l, `${chemin}${cle}`, 'un texte ou rien est attendu')
  return null
}

function centimesFrr(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string): number {
  const v = o[cle]
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  fauteFrr(l, `${chemin}${cle}`, 'un nombre entier de centimes est attendu')
  return 0
}

function nombreFrr(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string): number {
  const v = o[cle]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  fauteFrr(l, `${chemin}${cle}`, 'un nombre est attendu')
  return 0
}

function booleenFrr(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string): boolean {
  const v = o[cle]
  if (typeof v === 'boolean') return v
  fauteFrr(l, `${chemin}${cle}`, 'vrai ou faux est attendu')
  return false
}

// Une liste d'objets, chacun lu par `lire` ; une liste absente, ou un élément qui n'est pas un objet, est une faute.
function listeFrr<T>(l: LecteurFrr, o: ObjetJsonFrr, cle: string, chemin: string, lire: (x: ObjetJsonFrr, ici: string) => T): T[] {
  const v = o[cle]
  if (!Array.isArray(v)) {
    fauteFrr(l, `${chemin}${cle}`, 'une liste est attendue')
    return []
  }
  return v.map((x, i) => {
    const ici = `${chemin}${cle}[${i}]`
    if (estObjetFrr(x)) return lire(x, `${ici}.`)
    fauteFrr(l, ici, 'un objet est attendu')
    return lire({}, `${ici}.`)
  })
}

function lireAchatFrr(l: LecteurFrr, o: ObjetJsonFrr, ici: string): AchatFrr {
  const brute = o.origine
  let origine: AchatFrr['origine'] = null
  if (estObjetFrr(brute)) {
    origine = { numero: texteFrr(l, brute, 'numero', `${ici}origine.`), date: texteFrr(l, brute, 'date', `${ici}origine.`) }
  } else if (brute !== null) fauteFrr(l, `${ici}origine`, 'la facture d’origine ou rien est attendu')
  return {
    date: texteFrr(l, o, 'date', ici),
    numero: texteFrr(l, o, 'numero', ici),
    dateFacture: texteFrr(l, o, 'dateFacture', ici),
    typeDocument: texteFrr(l, o, 'typeDocument', ici),
    origine,
    devise: texteFrr(l, o, 'devise', ici),
    pays: texteFrr(l, o, 'pays', ici),
    schema: texteFrr(l, o, 'schema', ici),
    identifiant: texteFrr(l, o, 'identifiant', ici),
    cadre: texteFrr(l, o, 'cadre', ici),
    dateOperation: texteOuNulFrr(l, o, 'dateOperation', ici),
    periodeDebut: texteOuNulFrr(l, o, 'periodeDebut', ici),
    periodeFin: texteOuNulFrr(l, o, 'periodeFin', ici),
    lignes: listeFrr(l, o, 'lignes', ici, (x, la) => ({
      code: texteFrr(l, x, 'code', la),
      taux: nombreFrr(l, x, 'taux', la),
      baseCentimes: centimesFrr(l, x, 'baseCentimes', la),
      tvaCentimes: centimesFrr(l, x, 'tvaCentimes', la),
      motifCode: texteOuNulFrr(l, x, 'motifCode', la),
      motifTexte: texteOuNulFrr(l, x, 'motifTexte', la),
    })),
    htCentimes: centimesFrr(l, o, 'htCentimes', ici),
    tvaEurosCentimes: centimesFrr(l, o, 'tvaEurosCentimes', ici),
  }
}

function lireTransactionsFrr(l: LecteurFrr, o: ObjetJsonFrr, ici: string): TransactionsFrr {
  return {
    date: texteFrr(l, o, 'date', ici),
    devise: texteFrr(l, o, 'devise', ici),
    categorie: texteFrr(l, o, 'categorie', ici),
    optionDebits: booleenFrr(l, o, 'optionDebits', ici),
    htCentimes: centimesFrr(l, o, 'htCentimes', ici),
    tvaCentimes: centimesFrr(l, o, 'tvaCentimes', ici),
    parTaux: listeFrr(l, o, 'parTaux', ici, (x, la) => ({
      taux: nombreFrr(l, x, 'taux', la),
      baseCentimes: centimesFrr(l, x, 'baseCentimes', la),
      tvaCentimes: centimesFrr(l, x, 'tvaCentimes', la),
    })),
  }
}

function lirePaiementsFrr(l: LecteurFrr, o: ObjetJsonFrr, ici: string): PaiementsFrr {
  return {
    date: texteFrr(l, o, 'date', ici),
    parTaux: listeFrr(l, o, 'parTaux', ici, (x, la) => ({
      taux: nombreFrr(l, x, 'taux', la),
      montantCentimes: centimesFrr(l, x, 'montantCentimes', la),
    })),
  }
}

/** Le contenu d'un objet, lu sans rien deviner : ses opérations, et ce qui désigne le déclarant et la période. */
function lireContenuFrr(objet: ObjetFrr, c: ObjetJsonFrr): { contenu: ContenuLuFrr; faute: string | null } {
  const l: LecteurFrr = { faute: null }
  const contenu: ContenuLuFrr = {
    debut: texteFrr(l, c, 'debut', ''),
    fin: texteFrr(l, c, 'fin', ''),
    role: texteFrr(l, c, 'role', ''),
    siren: texteOuNulFrr(l, c, 'siren', ''),
    numeroTva: objet === 'achats' ? texteOuNulFrr(l, c, 'numeroTva', '') : null,
    achats: objet === 'achats' ? listeFrr(l, c, 'achats', '', (x, ici) => lireAchatFrr(l, x, ici)) : [],
    transactions: objet === 'ventes' ? listeFrr(l, c, 'transactions', '', (x, ici) => lireTransactionsFrr(l, x, ici)) : [],
    paiements: objet === 'paiements' ? listeFrr(l, c, 'paiements', '', (x, ici) => lirePaiementsFrr(l, x, ici)) : [],
  }
  return { contenu, faute: l.faute }
}

// ── Le jugement ────────────────────────────────────────────────────────────────────────────────────────────────────

// Ce qu'un émetteur désigne de travers EN LUI-MÊME (TG-3), une faute par refus. Un émetteur absent — un choix lu d'un
// JSON incomplet — se refuse : il ne se devine pas.
function refusDeLEmetteurFrr(e: EmetteurFrr | null | undefined): RefusFrr[] {
  if (e == null) return [refusFrr('emetteur_absent')]
  const refus: RefusFrr[] = []
  if (!(SCHEMAS_EMETTEUR_FRR as readonly string[]).includes(e.schema)) refus.push(refusFrr('emetteur_schema', String(e.schema)))
  // TT-8 : un SIREN de neuf chiffres et sa clé (G6.26), ou le matricule de quatre chiffres d'une plateforme (G6.22).
  else if (e.schema === '0002' && !sirenValide(e.identifiant)) refus.push(refusFrr('emetteur_siren'))
  else if (e.schema === '0238' && !/^\d{4}$/.test(e.identifiant)) refus.push(refusFrr('emetteur_matricule'))
  if (!(ROLES_EMETTEUR_FRR as readonly string[]).includes(e.role)) refus.push(refusFrr('emetteur_role', String(e.role)))
  // Une plateforme, désignée par son matricule, émet en WK (G6.22 et G7.51, les deux règles du fichier qu'elle envoie).
  else if (e.schema === '0238' && e.role !== 'WK') refus.push(refusFrr('emetteur_plateforme'))
  // TT-9, 1..1 : 150 caractères au plus.
  const nom = typeof e.nom === 'string' ? uneLigneFrr(e.nom) : ''
  if (nom === '' || caracteresFrr(nom) > 150) refus.push(refusFrr('emetteur_nom'))
  return refus
}

// SE et BY désignent le vendeur et l'acheteur des opérations (G7.52) : dans ce fichier, seul le déclarant l'est. Un
// émetteur désigné par un SIREN valide qui prend l'un de ces rôles est donc le déclarant — son SIREN et son rôle. Un
// émetteur dont l'identité est déjà fautive n'en reçoit pas un second refus.
function emetteurAutreQueLeDeclarant(e: EmetteurFrr | null | undefined, siren: string | null, role: string): boolean {
  return e != null && e.schema === '0002' && sirenValide(e.identifiant) && (e.role === 'SE' || e.role === 'BY')
    && (e.identifiant !== siren || e.role !== role)
}

// Ce qu'un achat (bloc 10.1) laisse sans écriture admise, une faute par refus. `horsDeLaPeriode` : la date qui l'a
// rangé n'est pas un jour de la période jugée ; `jour` : le jour de Paris où le fichier se crée (AAAA-MM-JJ), borne de
// G1.07, nul s'il n'est pas un instant (refusé à part).
function refusDeLAchatFrr(a: AchatFrr, horsDeLaPeriode: boolean, jour: string | null): RefusFrr[] {
  const refus: RefusFrr[] = []
  const n = a.numero
  const arrivee = (iso: string) => dateAdmiseFrr(iso) && (jour == null || iso <= jour)
  // La date qui a rangé l'achat dans la période (e4, `Rangement`) : la transmission concerne cette période (TG-7).
  if (horsDeLaPeriode) refus.push(refusFrr('achat_hors_periode', n, jourLisibleFrr(a.date)))
  // TT-19 (G1.05).
  if (!numeroAdmis(n)) refus.push(refusFrr('achat_numero', jourLisibleFrr(a.date)))
  // TT-20 : AAAAMMJJ (G1.09), de 2000 à 2099 (G1.36), déjà arrivée au contrôle (G1.07).
  if (!arrivee(a.dateFacture)) refus.push(refusFrr('achat_date', n, jourLisibleFrr(a.dateFacture)))
  // TT-21 (G1.01).
  if (!(TYPES_DE_FACTURE_FRR as readonly string[]).includes(a.typeDocument)) refus.push(refusFrr('achat_type', n, a.typeDocument))
  // TG-11 : un avoir cite la facture antérieure et sa date, en tête faute de lignes (G1.32) ; TT-30 suit G1.05, TT-31
  // G1.09, G1.36 et G1.07.
  if (a.typeDocument === '381' && a.origine == null) refus.push(refusFrr('achat_avoir_sans_origine', n))
  if (a.origine != null && (!numeroAdmis(a.origine.numero) || !arrivee(a.origine.date))) refus.push(refusFrr('achat_origine', n))
  // TT-22 : un code ISO 4217 (G1.10), trois lettres capitales.
  if (!/^[A-Z]{3}$/.test(a.devise)) refus.push(refusFrr('achat_devise', n, a.devise))
  // TT-28 (G1.02).
  if (!(CADRES_FRR as readonly string[]).includes(a.cadre)) refus.push(refusFrr('achat_cadre', n, a.cadre))
  // TG-12 (G2.19) : 0223 pour un fournisseur établi dans l'Union, son numéro de TVA ; 0227 hors de l'Union, son code de
  // pays et les seize premiers caractères de sa dénomination ; 18 caractères au plus. TT-35 : un code de pays à deux
  // lettres (G2.01), toujours écrit (G6.08), jamais la France pour un fournisseur qui n'y est pas établi.
  const dansLUnion = ETATS_MEMBRES_FRR.includes(a.pays)
  if (a.schema !== '0223' && a.schema !== '0227') refus.push(refusFrr('achat_vendeur_schema', n, a.schema))
  else if (!/^[A-Z]{2}$/.test(a.pays) || a.pays === 'FR' || dansLUnion !== (a.schema === '0223')) {
    refus.push(refusFrr('achat_vendeur_pays', n, a.pays))
  } else {
    const longueur = caracteresFrr(a.identifiant)
    const admis = a.schema === '0223'
      ? /^[A-Z]{2}[0-9A-Z+*]{2,16}$/.test(a.identifiant)
      : a.identifiant.startsWith(a.pays) && longueur >= 3 && longueur <= 18 && a.identifiant.trim() === a.identifiant
    if (!admis) refus.push(refusFrr('achat_vendeur_identifiant', n))
  }
  // TT-41, TT-42, TT-43 : des dates (G1.09, G1.36) ; une période de facturation ne finit pas avant son début (G6.20).
  const livraisons = [a.dateOperation, a.periodeDebut, a.periodeFin].filter((x): x is string => x != null)
  if (livraisons.some((x) => !dateAdmiseFrr(x)) || (a.periodeDebut != null && a.periodeFin != null && a.periodeFin < a.periodeDebut)) {
    refus.push(refusFrr('achat_livraison', n))
  }
  // TG-23, 1..n : une ventilation par code (G2.31) et par taux (G1.24) ; une exonération porte son motif, code et
  // libellé (G1.40 ; TT-59 de la liste VATEX, 30 caractères ; TT-58, 1 024) ; le motif d'un avoir net de taxe ne va
  // qu'à un avoir (G6.21) ; une exonération demande le numéro de TVA du fournisseur (G1.102), qu'un fournisseur hors de
  // l'Union (0227) n'a pas ici.
  if (a.lignes.length === 0) refus.push(refusFrr('achat_sans_ventilation', n))
  for (const x of a.lignes) {
    if (!(CODES_TVA_FRR as readonly string[]).includes(x.code)) refus.push(refusFrr('achat_code_tva', n, x.code))
    if (!tauxAdmisFrr(x.taux)) refus.push(refusFrr('achat_taux', n, tauxLisibleFrr(x.taux)))
    if (x.code === 'E' && (x.motifCode == null || x.motifTexte == null || caracteresFrr(x.motifCode) > 30 || !MOTIF_VATEX_FRR.test(x.motifCode)
      || uneLigneFrr(x.motifTexte) === '' || caracteresFrr(x.motifTexte) > 1024)) {
      refus.push(refusFrr('achat_motif', n))
    }
    if (x.motifCode === MOTIF_AVOIR_NET_DE_TAXE_FRR && a.typeDocument !== '381') refus.push(refusFrr('achat_motif_d_avoir', n))
  }
  if (a.schema === '0227' && a.lignes.some((x) => x.code === 'E')) refus.push(refusFrr('achat_tva_du_vendeur', n))
  // TG-22 (G1.53) : le hors-taxe (TT-51) fait la somme des bases (TT-54) ; la TVA (TT-52) celle des TVA (TT-55), quand la
  // facture est en euros. La règle tolère un centime pour les arrondis ; une somme de centimes n'en a pas : un écart,
  // même d'un centime, dit un contenu qui n'est pas celui qu'e4 a calculé.
  const bases = a.lignes.reduce((s, x) => s + x.baseCentimes, 0)
  const tva = a.lignes.reduce((s, x) => s + x.tvaCentimes, 0)
  if (a.htCentimes !== bases || (a.devise === 'EUR' && a.tvaEurosCentimes !== tva)) refus.push(refusFrr('achat_totaux', n))
  return refus
}

/** Ce qui empêche d'écrire le fichier, une faute par refus, dans l'ordre de `REFUS_FRR` ; vide quand il s'écrit. */
export function refusFichierFrr(d: DonneesFrr): RefusFrr[] {
  return jugerFrr(d).refus
}

interface JugementFrr {
  refus: RefusFrr[]
  objet: ObjetFrr | null
  contenu: ContenuLuFrr | null
}

function jugerFrr(d: DonneesFrr): JugementFrr {
  const dec = d.declaration
  const c = d.choix
  const refus: RefusFrr[] = []
  const arret = (): JugementFrr => ({ refus: dansLOrdreFrr(refus), objet: null, contenu: null })

  // La déclaration : un objet connu, sans quoi rien ne se lit.
  const objet = OBJETS_FRR.find((o) => o === dec.objet) ?? null
  if (objet == null) {
    refus.push(refusFrr('objet_inconnu', String(dec.objet)))
    return arret()
  }
  // Une remplacée ne se dépose plus : la rectificative « annule et remplace » la période (dossier général, § 3.7.7).
  if (dec.etat !== 'declaree') refus.push(refusFrr('declaration_remplacee'))
  // TT-4 (G8.01) ; une rectificative, et elle seule, remplace une déclaration (la contrainte de la table).
  if (dec.type_transmission !== 'IN' && dec.type_transmission !== 'RE') refus.push(refusFrr('type_de_transmission', String(dec.type_transmission)))
  else if ((dec.type_transmission === 'RE') !== (dec.remplace_id != null)) refus.push(refusFrr('rectificative_discordante'))
  // TT-1 (G1.104).
  if (typeof dec.id !== 'string' || !identifiantDeTransmissionAdmis(dec.id)) refus.push(refusFrr('identifiant_de_transmission'))

  // Les choix ; l'émetteur se juge en lui-même ici, et face au déclarant une fois le contenu lu.
  refus.push(...refusDeLEmetteurFrr(c.emetteur))
  const fuseauConnu = (FUSEAUX_FRR as readonly string[]).includes(c.fuseau)
  if (!fuseauConnu) refus.push(refusFrr('fuseau', String(c.fuseau)))
  if (!(CODES_OPTION_DEBITS_FRR as readonly string[]).includes(c.codeOptionDebits)) refus.push(refusFrr('code_option_debits', String(c.codeOptionDebits)))
  if (!(PAIEMENTS_NEGATIFS_FRR as readonly string[]).includes(c.paiementsNegatifs)) {
    refus.push(refusFrr('choix_paiements_negatifs', String(c.paiementsNegatifs)))
  }
  // L'instant de création (TT-3) : un instant, qui s'écrit dans le fuseau choisi ; son jour à Paris borne G1.07.
  const parisMaintenant = horodatageFrr(d.maintenant, 'Europe/Paris')
  if (parisMaintenant == null) refus.push(refusFrr('horodatage'))
  const jour = parisMaintenant == null ? null : `${parisMaintenant.slice(0, 4)}-${parisMaintenant.slice(4, 6)}-${parisMaintenant.slice(6, 8)}`
  // TT-14, 1..1 : 150 caractères au plus.
  const nomDuDeclarant = typeof d.nomDuDeclarant === 'string' ? uneLigneFrr(d.nomDuDeclarant) : ''
  if (nomDuDeclarant === '' || caracteresFrr(nomDuDeclarant) > 150) refus.push(refusFrr('nom_du_declarant'))

  // Le contenu figé : un objet, de la version que ce bloc écrit, lisible en entier ; sinon rien de ce qui en dépend ne
  // se juge.
  const brut = dec.contenu
  if (!estObjetFrr(brut)) {
    refus.push(refusFrr('contenu_illisible', 'un objet est attendu'))
    return arret()
  }
  if (brut.version !== VERSION_DU_CONTENU_FRR) {
    refus.push(refusFrr('version_du_contenu', String(brut.version), String(VERSION_DU_CONTENU_FRR)))
    return arret()
  }
  const { contenu, faute } = lireContenuFrr(objet, brut)
  if (faute != null) {
    refus.push(refusFrr('contenu_illisible', faute))
    return arret()
  }
  if (brut.objet !== objet || contenu.debut !== dec.periode_debut || contenu.fin !== dec.periode_fin) {
    refus.push(refusFrr('contenu_d_une_autre_declaration'))
  }
  // TT-15 (G7.52).
  const role = ROLE_DU_DECLARANT_FRR[objet]
  if (contenu.role !== role) refus.push(refusFrr('role_du_declarant', contenu.role))
  // Un fichier « mono-objet » (note 129) : des transactions OU des paiements (G6.29), un seul rôle de déclarant (G7.52).
  const autres = OBJETS_FRR.filter((o) => o !== objet && Array.isArray(brut[OPERATIONS_FRR[o]]) && (brut[OPERATIONS_FRR[o]] as unknown[]).length > 0)
  if (autres.length > 0) refus.push(refusFrr('objets_meles', autres.map((o) => NOMS_DES_OPERATIONS_FRR[o]).join(' et ')))

  // L'émetteur face au déclarant (TG-3, G7.52).
  if (emetteurAutreQueLeDeclarant(c.emetteur, contenu.siren, role)) refus.push(refusFrr('emetteur_declarant', c.emetteur.role))
  // TT-13 et TT-12 (G6.26) : le SIREN du dossier, sous 0002.
  if (!sirenValide(contenu.siren)) refus.push(refusFrr('siren_du_declarant'))
  // TT-38 : pour ses achats, le dossier acheteur porte son numéro de TVA, « systématiquement complété » (G2.33), et son
  // SIREN (TT-36, G6.28).
  if (objet === 'achats' && (contenu.numeroTva == null || (sirenValide(contenu.siren) && contenu.numeroTva !== numeroTvaFrancais(contenu.siren)))) {
    refus.push(refusFrr('numero_tva_du_declarant'))
  }

  // La période (TT-17/TT-18, TT-89/TT-90) : des dates (G1.09, G1.36), une fin après le début (G6.25) ; le fichier se
  // crée après sa fin (G7.43, qui compare TT-3 tel qu'il s'écrit à la fin de la période). Le début avant la date du
  // contrôle (G6.24) en suit : il précède la fin, qui précède la création, qui précède le contrôle. Une période refusée
  // ne juge pas ce qui s'y range : ce serait dire deux fois la même faute.
  const { debut, fin } = contenu
  const periodeAdmise = dateAdmiseFrr(debut) && dateAdmiseFrr(fin)
  if (!periodeAdmise) refus.push(refusFrr('periode_dates'))
  else if (fin <= debut) refus.push(refusFrr('periode_bornes', jourLisibleFrr(debut), jourLisibleFrr(fin)))
  const periodeJugee = periodeAdmise && fin > debut
  const ecrit = fuseauConnu ? horodatageFrr(d.maintenant, c.fuseau) : null
  if (periodeAdmise && ecrit != null && ecrit.slice(0, 8) <= dateFrr(fin)) {
    refus.push(refusFrr('horodatage_avant_la_fin', jourLisibleFrr(`${ecrit.slice(0, 4)}-${ecrit.slice(4, 6)}-${ecrit.slice(6, 8)}`),
      `${ecrit.slice(8, 10)} h ${ecrit.slice(10, 12)}, ${c.fuseau}`, jourLisibleFrr(fin)))
  }
  const horsDeLaPeriode = (iso: string) => periodeJugee && (!dateCivileFrr(iso) || iso < debut || iso > fin)

  // Les opérations, dans l'ordre du contenu.
  for (const a of contenu.achats) refus.push(...refusDeLAchatFrr(a, horsDeLaPeriode(a.date), jour))
  for (const t of contenu.transactions) {
    const j = jourLisibleFrr(t.date)
    // TT-77 : un jour de la période (G1.09, G1.36 ; G1.07 suit de G7.43).
    if (horsDeLaPeriode(t.date)) refus.push(refusFrr('ventes_date', j))
    // TT-78 et TT-83 : la TVA en euros (G6.23), la somme des TVA par taux en euros (G1.53).
    if (t.devise !== 'EUR') refus.push(refusFrr('ventes_devise', j, t.devise))
    // TT-81 (G1.68).
    if (!(CATEGORIES_FRR as readonly string[]).includes(t.categorie)) refus.push(refusFrr('ventes_categorie', j, t.categorie))
    // TT-80 : l'option pour les débits vise les prestations de services (G1.67 ; G1.44, la règle du flux 10 — G1.43,
    // sa jumelle, ne vaut que pour le flux 1). G1.67 ne l'interdit pas ailleurs : seule une catégorie qui ne compte que
    // des biens (TLB1) se refuse ; TNT1 et TMA1 comptent aussi des services (G1.68).
    if (t.optionDebits && t.categorie === 'TLB1') refus.push(refusFrr('ventes_option_hors_services', j))
    // TG-32, 1..n : TT-86 (G1.24) ; TT-82 et TT-83 font les sommes de TT-87 et TT-88 (G1.53, sans la tolérance).
    if (t.parTaux.length === 0) refus.push(refusFrr('ventes_sans_ventilation', j))
    for (const x of t.parTaux) if (!tauxAdmisFrr(x.taux)) refus.push(refusFrr('ventes_taux', j, tauxLisibleFrr(x.taux)))
    if (t.htCentimes !== t.parTaux.reduce((s, x) => s + x.baseCentimes, 0) || t.tvaCentimes !== t.parTaux.reduce((s, x) => s + x.tvaCentimes, 0)) {
      refus.push(refusFrr('ventes_totaux', j))
    }
  }
  for (const p of contenu.paiements) {
    const j = jourLisibleFrr(p.date)
    // TT-96 : un jour de la période.
    if (horsDeLaPeriode(p.date)) refus.push(refusFrr('paiements_date', j))
    // TG-39, 1..n : TT-97 (G1.24) ; TT-99 en euros (G6.27), au centime (G7.07) — négatif, selon le choix (G1.16).
    if (p.parTaux.length === 0) refus.push(refusFrr('paiements_sans_ventilation', j))
    for (const x of p.parTaux) {
      if (!tauxAdmisFrr(x.taux)) refus.push(refusFrr('paiements_taux', j, tauxLisibleFrr(x.taux)))
      if (x.montantCentimes < 0 && c.paiementsNegatifs === 'refuses') refus.push(refusFrr('paiement_negatif', j, tauxLisibleFrr(x.taux)))
    }
  }

  // Les textes libres, tels que le fichier les écrirait (une raison sociale sur une ligne) : ils passent tels quels, ou
  // pas du tout.
  const libres: [string, string | null][] = [
    ['La raison sociale de l’émetteur', typeof c.emetteur?.nom === 'string' ? uneLigneFrr(c.emetteur.nom) : null],
    ['La raison sociale du déclarant', nomDuDeclarant],
    ...contenu.achats.flatMap((a): [string, string | null][] => [
      [`L’identifiant du fournisseur de la facture n° ${a.numero}`, a.identifiant],
      ...a.lignes.map((x): [string, string | null] => [`Le motif d’exonération de la facture n° ${a.numero}`, x.motifTexte]),
    ]),
  ]
  for (const [quoi, texte] of libres) if (texte != null && HORS_XML_FRR.test(texte)) refus.push(refusFrr('caractere_interdit', quoi))

  // Rien ne se transmet à blanc.
  if (contenu.achats.length + contenu.transactions.length + contenu.paiements.length === 0) refus.push(refusFrr('aucune_operation'))
  return { refus: dansLOrdreFrr(refus), objet, contenu }
}

// Le tri est stable : dans une même clé, les refus gardent l'ordre où ils ont été jugés (celui du contenu).
const dansLOrdreFrr = (refus: RefusFrr[]) => refus.sort((a, b) => rangFrr(a.cle) - rangFrr(b.cle))

// ── L'écriture ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface NoeudFrr {
  nom: string
  attributs?: Record<string, string>
  texte?: string
  enfants?: (NoeudFrr | null)[]
}

// Les textes ont été jugés : seuls « & », « < », « > » et « " » se changent, en leurs entités.
function echapperFrr(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function elFrr(nom: string, contenu: string | (NoeudFrr | null)[], attributs?: Record<string, string>): NoeudFrr {
  return typeof contenu === 'string' ? { nom, attributs, texte: contenu } : { nom, attributs, enfants: contenu }
}

function serialiserFrr(n: NoeudFrr, profondeur: number): string {
  const retrait = '  '.repeat(profondeur)
  const attributs = Object.entries(n.attributs ?? {}).map(([k, v]) => ` ${k}="${echapperFrr(v)}"`).join('')
  if (n.texte !== undefined) return `${retrait}<${n.nom}${attributs}>${echapperFrr(n.texte)}</${n.nom}>`
  const enfants = (n.enfants ?? []).filter((e): e is NoeudFrr => e !== null)
  return [`${retrait}<${n.nom}${attributs}>`, ...enfants.map((e) => serialiserFrr(e, profondeur + 1)), `${retrait}</${n.nom}>`].join('\n')
}

// Un achat (TG-8), dans l'ordre du XSD (transaction.xsd, `TransactionsReportType/Invoice`) ; chaque élément cite la
// donnée de l'annexe 6 et la règle de l'annexe 7 qui le fondent.
function factureFrr(a: AchatFrr, siren: string, numeroTva: string): NoeudFrr {
  const avecTvaDuVendeur = a.schema === '0223'
  return elFrr('Invoice', [
    // TT-19 (G1.05), TT-20 (G1.09), TT-21 (G1.01), TT-22 (G1.10) — obligatoires (G6.08).
    elFrr('ID', a.numero),
    elFrr('IssueDate', dateFrr(a.dateFacture)),
    elFrr('TypeCode', a.typeDocument),
    elFrr('CurrencyCode', a.devise),
    // TG-10 : le cadre de facturation (TT-28, G1.02) et le profil (TT-29, S1.12).
    elFrr('BusinessProcess', [elFrr('ID', a.cadre), elFrr('TypeID', PROFIL_EREPORTING)]),
    // TG-11 : la facture qu'un avoir corrige, et sa date (G1.32).
    a.origine == null ? null : elFrr('ReferencedDocument', [elFrr('ID', a.origine.numero), elFrr('IssueDate', dateFrr(a.origine.date))]),
    // TG-12 : le fournisseur, son identifiant et son schéma (TT-33, TT-33-1 ; G2.19), son numéro de TVA qualifié « VAT »
    // sous 0223 (TT-34, TT-34-0 ; G2.33), son pays (TT-35 ; G2.01, G6.08).
    elFrr('Seller', [
      elFrr('CompanyId', a.identifiant, { schemeId: a.schema }),
      avecTvaDuVendeur ? elFrr('TaxRegistrationId', a.identifiant, { qualifyingId: 'VAT' }) : null,
      elFrr('PostalAddress', [elFrr('CountryId', a.pays)]),
    ]),
    // TG-14 : le dossier acheteur, son SIREN (TT-36, TT-37 ; G6.28, G2.19) et son numéro de TVA qualifié « VAT »
    // (TT-38, TT-38-0 ; G2.33).
    elFrr('Buyer', [
      elFrr('CompanyId', siren, { schemeId: '0002' }),
      elFrr('TaxRegistrationId', numeroTva, { qualifyingId: 'VAT' }),
    ]),
    // TG-17 : la date de livraison (TT-41 ; G1.38) ; TG-18 : la période de facturation (TT-42, TT-43 ; G6.20).
    a.dateOperation == null ? null : elFrr('Delivery', [elFrr('Date', dateFrr(a.dateOperation))]),
    a.periodeDebut == null && a.periodeFin == null ? null : elFrr('InvoicePeriod', [
      a.periodeDebut == null ? null : elFrr('StartDate', dateFrr(a.periodeDebut)),
      a.periodeFin == null ? null : elFrr('EndDate', dateFrr(a.periodeFin)),
    ]),
    // TG-22 : le hors-taxe dans la devise de la facture (TT-51 ; G1.14, G1.53), la TVA en euros (TT-52, TT-202 ; G6.23).
    elFrr('MonetaryTotal', [
      elFrr('TaxExclusiveAmount', montantFrr(a.htCentimes)),
      elFrr('TaxAmount', montantFrr(a.tvaEurosCentimes), { CurrencyCode: 'EUR' }),
    ]),
    // TG-23 : la ventilation, base et TVA (TT-54, TT-55 ; G1.14), code et taux (TT-56, TT-57 ; G2.31, G1.24), motif
    // d'une exonération (TT-58, TT-59 ; G1.40). Sans les lignes de la facture : « le détail des lignes de factures n'est
    // pas attendu » d'un acheteur (BOI-TVA-DECLA-20-30-50-20, § 70, remarque).
    ...a.lignes.map((x) => elFrr('TaxSubTotal', [
      elFrr('TaxableAmount', montantFrr(x.baseCentimes)),
      elFrr('TaxAmount', montantFrr(x.tvaCentimes)),
      elFrr('TaxCategory', [
        elFrr('Code', x.code),
        elFrr('Percent', tauxFrr(x.taux)),
        x.motifTexte == null ? null : elFrr('TaxExemptionReason', x.motifTexte),
        x.motifCode == null ? null : elFrr('TaxExemptionReasonCode', x.motifCode),
      ]),
    ])),
  ])
}

/**
 * LE FICHIER DE LA DÉCLARATION, ou ce qui l'empêche d'être écrit. Les éléments suivent l'ordre des XSD du flux 10 (la
 * racine `Report`, sans espace de noms, ses éléments non qualifiés — ereporting.xsd) ; un fichier ne porte que le bloc
 * de son objet (G6.29).
 */
export function fichierFrr(d: DonneesFrr): ResultatFrr {
  const j = jugerFrr(d)
  if (j.refus.length > 0 || j.objet == null || j.contenu == null) return { xml: null, refus: j.refus }
  const { objet, contenu } = j
  const c = d.choix
  const siren = contenu.siren as string
  const periode = (nom: string) => elFrr(nom, [elFrr('StartDate', dateFrr(contenu.debut)), elFrr('EndDate', dateFrr(contenu.fin))])
  const emetteur = c.emetteur

  const entete = elFrr('ReportDocument', [
    // TT-1 : l'identifiant de la déclaration (G1.104, G8.05).
    elFrr('Id', d.declaration.id),
    // TG-1, TT-3 : l'instant de création, AAAAMMJJHHMMSS (G7.53), dans le fuseau choisi — choix 2.
    elFrr('IssueDateTime', [elFrr('DateTimeString', horodatageFrr(d.maintenant, c.fuseau) as string)]),
    // TT-4 : IN ou RE (G8.01).
    elFrr('TypeCode', d.declaration.type_transmission),
    // TG-3 : l'émetteur (TT-8, TT-7, TT-9, TT-10 ; G6.22, G7.51) — choix 1.
    elFrr('Sender', [
      elFrr('Id', emetteur.identifiant, { schemeId: emetteur.schema }),
      elFrr('Name', uneLigneFrr(emetteur.nom)),
      elFrr('RoleCode', emetteur.role),
    ]),
    // TG-5 : le déclarant, son SIREN sous 0002 (TT-13, TT-12 ; G6.26), sa raison sociale (TT-14), son rôle (TT-15 ; G7.52).
    elFrr('Issuer', [
      elFrr('Id', siren, { schemeId: '0002' }),
      elFrr('Name', uneLigneFrr(d.nomDuDeclarant)),
      elFrr('RoleCode', ROLE_DU_DECLARANT_FRR[objet]),
    ]),
  ])

  let bloc: NoeudFrr
  if (objet === 'paiements') {
    // TB-3 : la période (TG-33, TT-89, TT-90), puis un paiement par jour (TG-37, TG-38 : TT-96) et par taux (TG-39 :
    // TT-97, TT-99) — « globalisées par jour et par taux » (BOI-TVA-DECLA-20-30-60, § 150) ; le montant en euros
    // (G6.27), au centime (G7.07), négatif selon le choix 4.
    bloc = elFrr('PaymentsReport', [
      periode('ReportPeriod'),
      ...contenu.paiements.map((p) => elFrr('Transactions', [elFrr('Payment', [
        elFrr('Date', dateFrr(p.date)),
        ...p.parTaux.map((x) => elFrr('SubTotals', [elFrr('TaxPercent', tauxFrr(x.taux)), elFrr('Amount', montantFrr(x.montantCentimes))])),
      ])])),
    ])
  } else if (objet === 'ventes') {
    // TB-2 : la période (TG-7, TT-17, TT-18), puis les transactions d'un jour, d'une devise et d'une catégorie (TG-31 ;
    // dossier général, § 3.7.5) : TT-77, TT-78, l'option pour les débits (TT-80 ; G1.67, P1.11) — choix 3 —, TT-81
    // (G1.68), TT-82 et TT-83 (G1.14, G1.53, G6.23), puis par taux (TG-32 : TT-86, TT-87, TT-88). Le nombre de
    // transactions (TT-85) est facultatif depuis la v3.1 : il ne s'écrit pas.
    bloc = elFrr('TransactionsReport', [
      periode('ReportPeriod'),
      ...contenu.transactions.map((t) => elFrr('Transactions', [
        elFrr('Date', dateFrr(t.date)),
        elFrr('TransactionsCurrency', t.devise),
        t.optionDebits ? elFrr('TaxDueDateTypeCode', c.codeOptionDebits) : null,
        elFrr('CategoryCode', t.categorie),
        elFrr('TaxExclusiveAmount', montantFrr(t.htCentimes)),
        elFrr('TaxTotal', montantFrr(t.tvaCentimes)),
        ...t.parTaux.map((x) => elFrr('TaxSubtotal', [
          elFrr('TaxPercent', tauxFrr(x.taux)),
          elFrr('TaxableAmount', montantFrr(x.baseCentimes)),
          elFrr('TaxTotal', montantFrr(x.tvaCentimes)),
        ])),
      ])),
    ])
  } else {
    // TB-2 : la période, puis une facture par achat (TG-8 ; dossier général, § 3.7.3).
    bloc = elFrr('TransactionsReport', [
      periode('ReportPeriod'),
      ...contenu.achats.map((a) => factureFrr(a, siren, contenu.numeroTva as string)),
    ])
  }

  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${serialiserFrr(elFrr('Report', [entete, bloc]), 0)}\n`, refus: [] }
}
// ── FIN COPIE fluxEreporting ─────────────────────────────────────────────────────────────────────────────────────────
