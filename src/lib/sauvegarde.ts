// Socle de la sauvegarde et de la restauration : l'ordre des tables, le graphe de leurs dépendances,
// et le contrôle qui dit si une restauration a VRAIMENT tout remis.
//
// Pourquoi ce fichier existe, et pourquoi il ne parle pas au réseau : la partie qui se trompe dans
// une restauration n'est pas l'accès à la base, c'est l'ORDRE et la COMPLÉTUDE. Les deux sont de la
// logique pure, donc testables sans rien simuler — et c'est la seule façon de répéter une
// restauration à chaque exécution de la suite de tests plutôt qu'une fois par an.
//
// Tout ce qui suit est LU du schéma réel (pg_constraint) le 18/09/2026, jamais supposé.

/** Une relation de clé étrangère, telle que Postgres la déclare. */
export interface Relation {
  /** La table qui porte la colonne. */
  enfant: string
  /** La table pointée. Elle doit exister AVANT l'enfant. */
  parent: string
  colonne: string
  /** Ce que fait Postgres quand la ligne parente disparaît. */
  aLaSuppression: 'cascade' | 'bloque' | 'met_a_null'
}

// Le graphe complet des dépendances entre tables du schéma `public`. Les relations vers `auth.users`
// sont volontairement absentes : cette table n'appartient pas à l'application, elle n'est ni
// sauvegardée ni restaurée par ce chemin, et l'y faire figurer donnerait l'illusion du contraire.
export const RELATIONS: readonly Relation[] = [
  { enfant: 'agent_conversations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'cabinet_admins', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'categories', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'comptes_courants_associes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'controles_releves_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'cotisations_declarees', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'declarations_tva', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'documents_divers', parent: 'cotisations_declarees', colonne: 'attached_to_cotisation_id', aLaSuppression: 'met_a_null' },
  { enfant: 'documents_divers', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'documents_divers', parent: 'sous_dossiers', colonne: 'sous_dossier_id', aLaSuppression: 'bloque' },
  { enfant: 'dossier_assignations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'dossiers', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'ecritures_brouillon', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'ecritures_brouillon', parent: 'lignes_bancaires', colonne: 'ligne_bancaire_id', aLaSuppression: 'met_a_null' },
  { enfant: 'ecritures_brouillon', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'emails_envoyes', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'emails_envoyes', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'met_a_null' },
  { enfant: 'emprunts', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_lignes', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_numerotation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_superpdp_events', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'facture_superpdp_events', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'cascade' },
  { enfant: 'factures_emises', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'factures_emises', parent: 'factures_emises', colonne: 'facture_origine_id', aLaSuppression: 'bloque' },
  { enfant: 'immobilisations', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'immobilisations', parent: 'natures_immobilisation', colonne: 'nature_id', aLaSuppression: 'bloque' },
  { enfant: 'immobilisations', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'informations_dossier', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'lignes_bancaires', parent: 'cotisations_declarees', colonne: 'cotisation_id', aLaSuppression: 'met_a_null' },
  { enfant: 'lignes_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'lignes_bancaires', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'met_a_null' },
  { enfant: 'memberships', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'mouvements_cca', parent: 'comptes_courants_associes', colonne: 'compte_id', aLaSuppression: 'cascade' },
  { enfant: 'natures_immobilisation', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'packs', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_commentaires', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'documents_divers', colonne: 'document_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'piece_textes_ocr', parent: 'pieces', colonne: 'piece_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'pieces', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'pieces', parent: 'sous_dossiers', colonne: 'sous_dossier_id', aLaSuppression: 'met_a_null' },
  { enfant: 'previsionnels_bancaires', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'references_annuelles', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'references_postes_annuels', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'regles_bancaires_ignorees', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'sous_dossiers', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'superpdp_credentials', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'supplements', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'supplements', parent: 'factures_emises', colonne: 'facture_id', aLaSuppression: 'met_a_null' },
  { enfant: 'tiers_categories', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'tiers_categories', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
  { enfant: 'tiers_categories_cabinet', parent: 'cabinets', colonne: 'cabinet_id', aLaSuppression: 'bloque' },
  { enfant: 'tiers_categories_cabinet', parent: 'categories', colonne: 'categorie_id', aLaSuppression: 'bloque' },
  { enfant: 'vehicules', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
]

// L'ordre dans lequel réinsérer les tables pour qu'une restauration aboutisse : toute table parente
// précède ses enfants. Calculé par tri topologique sur RELATIONS, puis figé ici — et vérifié à chaque
// exécution des tests contre RELATIONS, de sorte qu'une relation ajoutée sans reclasser la liste
// casse bruyamment au lieu de casser une nuit de restauration.
//
// Les tables sans aucune dépendance (cabinets, super_admins, taux_change_bce) viennent en tête ;
// `ecritures_brouillon` ferme la marche, car elle dépend de tout le reste de la chaîne comptable.
export const ORDRE_RESTAURATION: readonly string[] = [
  'cabinets',
  'super_admins',
  'taux_change_bce',
  'cabinet_admins',
  'dossiers',
  'agent_conversations',
  'categories',
  'comptes_courants_associes',
  'controles_releves_bancaires',
  'cotisations_declarees',
  'declarations_tva',
  'dossier_assignations',
  'emprunts',
  'facture_numerotation',
  'factures_emises',
  'informations_dossier',
  'memberships',
  'natures_immobilisation',
  'packs',
  'previsionnels_bancaires',
  'references_annuelles',
  'references_postes_annuels',
  'regles_bancaires_ignorees',
  'sous_dossiers',
  'superpdp_credentials',
  'vehicules',
  'documents_divers',
  'emails_envoyes',
  'facture_lignes',
  'facture_superpdp_events',
  'mouvements_cca',
  'pieces',
  'supplements',
  'tiers_categories',
  'tiers_categories_cabinet',
  'immobilisations',
  'lignes_bancaires',
  'piece_commentaires',
  'piece_textes_ocr',
  'ecritures_brouillon',
]

// Une table qui se référence elle-même ne peut PAS être restaurée en un seul passage : la première
// ligne insérée peut pointer une ligne qui n'existe pas encore. Ici c'est `factures_emises`, dont un
// avoir porte l'identifiant de la facture qu'il annule (`facture_origine_id`).
//
// La restauration doit donc se faire en deux temps sur ces tables : insérer toutes les lignes avec la
// colonne auto-référencée à NULL, puis la renseigner par une seconde passe. Aucun ordre de tables,
// aussi juste soit-il, ne peut éviter ça.
export const TABLES_AUTO_REFERENCEES: readonly { table: string; colonne: string }[] = [
  { table: 'factures_emises', colonne: 'facture_origine_id' },
]

/** Un lien qui pointe une ligne absente de la sauvegarde. */
export interface LienPerdu {
  table: string
  colonne: string
  parent: string
  /** L'identifiant pointé, introuvable. */
  valeur: string
  /**
   * Vrai quand la colonne accepte NULL, donc quand la restauration PEUT aboutir en effaçant le lien
   * au lieu de s'arrêter. C'est le cas dangereux — non parce que Postgres se tairait, mais parce que
   * c'est nous qui serions tentés de le faire taire. Voir le commentaire de `liensPerdus`.
   */
  effacable: boolean
}

type Contenu = Record<string, Record<string, unknown>[]>

// Le contrôle qui décide si une sauvegarde est réellement complète — à exécuter AVANT de restaurer.
//
// La première version de ce commentaire affirmait que Postgres, sur une relation ON DELETE SET NULL,
// accepte une ligne dont le parent manque et écrit NULL en silence. C'est FAUX, et l'essai en base l'a
// montré (18/09/2026, schéma jetable, deux tables, une relation SET NULL) : à l'INSERT, Postgres refuse
// par `foreign_key_violation`, exactement comme sur les autres. ON DELETE ne décrit que ce qui arrive à
// la SUPPRESSION du parent ; il ne relâche rien à l'insertion.
//
// Le danger est réel, mais il est ailleurs, et il est pire :
//
//   1. Une restauration n'est pas atomique. Quarante tables insérées par lots successifs : l'échec
//      arrive au milieu, sur une base déjà à moitié peuplée, et il faut décider à 3 h du matin ce
//      qu'on fait des trente-neuf autres. Ce contrôle le dit AVANT que rien ne soit écrit.
//   2. C'est NOUS qui produisons le silence. Face à un refus sur une colonne nullable, la correction
//      qui vient à l'esprit est d'y mettre NULL pour que ça passe — et ça passe. Neuf relations du
//      graphe métier le permettent, et ce sont précisément celles qui portent le travail comptable :
//
//   lignes_bancaires.piece_id      le rapprochement bancaire de chaque mouvement
//   ecritures_brouillon.piece_id   la pièce justifiant chaque écriture
//   ecritures_brouillon.ligne_bancaire_id  le mouvement qui la justifie
//   immobilisations.piece_id       la facture d'achat de l'immobilisation
//   supplements.facture_id         le rattachement d'un supplément à sa facture
//
// Un dossier ainsi « restauré » paraît intact : toutes les pièces sont là, tous les mouvements aussi.
// Seul le lien entre eux a disparu — le rapprochement est défait, les écritures sont orphelines, et
// rien à l'écran ne le dit. C'est ce qu'on découvre six mois plus tard, en cherchant autre chose.
//
// D'où `effacable`, qui ne dit pas « Postgres se taira » mais « ce lien-là peut être sacrifié pour que
// la restauration passe » — c'est-à-dire : ne le sacrifie pas sans le savoir.
//
// `contenu` est la sauvegarde entière : un tableau de lignes par table. Chaque ligne est supposée
// porter un `id` — c'est la clé primaire partout dans ce schéma.
export function liensPerdus(contenu: Contenu): LienPerdu[] {
  const identifiants = new Map<string, Set<string>>()
  for (const [table, lignes] of Object.entries(contenu)) {
    identifiants.set(table, new Set(lignes.map((l) => String(l.id))))
  }

  const perdus: LienPerdu[] = []
  for (const relation of RELATIONS) {
    const lignes = contenu[relation.enfant]
    if (!lignes) continue
    // Une table parente absente de la sauvegarde n'est pas un lien perdu mais un périmètre : on ne
    // sauvegarde pas forcément tout le schéma (un export par dossier, par exemple). Ce qui compte est
    // qu'une table PRÉSENTE ne référence rien qui manque.
    const connus = identifiants.get(relation.parent)
    if (!connus) continue

    for (const ligne of lignes) {
      const valeur = ligne[relation.colonne]
      // Un lien vide est un lien absent, pas un lien cassé : la plupart de ces colonnes sont
      // facultatives (une pièce sans sous-dossier, un mouvement non rapproché).
      if (valeur == null) continue
      if (connus.has(String(valeur))) continue
      perdus.push({
        table: relation.enfant,
        colonne: relation.colonne,
        parent: relation.parent,
        valeur: String(valeur),
        effacable: relation.aLaSuppression === 'met_a_null',
      })
    }
  }
  return perdus
}

/** Une violation de l'ordre : un enfant placé avant son parent, ou une table absente de l'ordre. */
export interface ViolationOrdre {
  enfant: string
  parent: string
  motif: 'parent_apres_enfant' | 'table_absente_de_lordre'
}

// Vérifie qu'un ordre de restauration respecte bien toutes les dépendances.
//
// Sert de garde-fou permanent : ORDRE_RESTAURATION est une liste figée, écrite à la main à partir
// d'un calcul. Le jour où une relation est ajoutée au schéma sans reclasser la liste, ce contrôle le
// dit — au lieu de laisser la découverte pour la nuit où on restaure vraiment.
//
// Les auto-références sont ignorées : elles ne peuvent être satisfaites par aucun ordre (voir
// TABLES_AUTO_REFERENCEES), et les compter comme violations rendrait le contrôle toujours rouge.
export function violationsOrdre(
  ordre: readonly string[],
  relations: readonly Relation[] = RELATIONS,
): ViolationOrdre[] {
  const rang = new Map(ordre.map((table, i) => [table, i]))
  const violations: ViolationOrdre[] = []

  for (const relation of relations) {
    if (relation.enfant === relation.parent) continue
    const rangEnfant = rang.get(relation.enfant)
    const rangParent = rang.get(relation.parent)
    if (rangEnfant === undefined || rangParent === undefined) {
      violations.push({ enfant: relation.enfant, parent: relation.parent, motif: 'table_absente_de_lordre' })
      continue
    }
    // `>=` et non `>`, bien que l'égalité soit aujourd'hui inatteignable : deux tables distinctes ont
    // toujours des rangs distincts, et le seul cas d'égalité — une table et elle-même — est écarté
    // juste au-dessus. La borne large est donc équivalente à la borne stricte en l'état, et aucun
    // test ne peut les distinguer. Elle est gardée parce qu'elle cesse de l'être dès qu'on touche à
    // l'exemption des auto-références au-dessus : `>` laisserait alors passer en silence une table
    // déclarée parente d'elle-même, qu'aucun ordre ne peut satisfaire.
    if (rangParent >= rangEnfant) {
      violations.push({ enfant: relation.enfant, parent: relation.parent, motif: 'parent_apres_enfant' })
    }
  }
  return violations
}

// Comment atteindre, pour chaque table, les lignes qui appartiennent à UN dossier.
//
// Le piège que ça ferme : trente-deux des quarante tables portent une colonne `dossier_id`, et on
// serait tenté d'écrire « pour chaque table, WHERE dossier_id = ? ». Deux tables n'en ont pas et ne
// sont atteignables que par leur parent — `facture_lignes` par sa facture, `mouvements_cca` par son
// compte courant. Un export naïf rendrait zéro ligne pour ces deux-là, sans la moindre erreur : toutes
// les lignes de facture et tous les mouvements de compte courant perdus, en silence. C'est la même
// classe de panne que les liens en SET NULL plus haut, et elle mérite la même méfiance.
//
// Le piège suivant, découvert en écrivant l'export réel, et bien plus coûteux : `dossier_id` est
// NULLABLE sur deux tables — `categories` et `natures_immobilisation`. Elles mélangent les lignes
// propres à un dossier et des lignes PARTAGÉES par tous, marquées d'un `dossier_id` nul. Or en SQL une
// comparaison avec NULL n'est jamais vraie : `WHERE dossier_id = <le dossier>` écarte les lignes
// partagées sans le dire. C'est mot pour mot le défaut du filtre de période sur les pièces sans date,
// revenu sur une autre colonne.
//
// Ce qu'il coûtait ici, mesuré en production le 18/09/2026 : les DIX catégories et les HUIT natures
// d'immobilisation du cabinet sont partagées, aucune n'appartient à un dossier. Un export « direct »
// rendait donc zéro ligne pour ces deux tables, pendant que 76 pièces catégorisées sur 76 et une
// immobilisation sur deux les pointaient. Et `pieces.categorie_id` comme `immobilisations.nature_id`
// sont en NO ACTION : la restauration se serait arrêtée net sur `pieces`, la plus grosse table de la
// chaîne, sans que rien en aval ne soit tenté. D'où `partage`, qui lit les deux.
//
// Ce qui reste dehors, et la règle qui le décide : une table est exclue de l'export d'un dossier
// uniquement si RIEN dans l'export ne la pointe. Les taux de change, les super-administrateurs et les
// cabinets eux-mêmes remplissent cette condition — sauf `cabinets`, que `dossiers.cabinet_id` pointe,
// et qui est donc un prérequis explicite de la base d'arrivée (voir `referencesExternes`). Les tables
// de niveau cabinet sont dehors pour une raison de sens, pas de graphe : elles décrivent qui dirige le
// cabinet et quelles règles il partage, pas ce que contient un dossier. Les embarquer ferait
// réinsérer, en restaurant un client, la liste des administrateurs du cabinet.
//
// Cette règle n'est pas une intention : `parentsHorsPlan` la vérifie à chaque exécution des tests.
export type CheminDossier =
  /** La ligne `dossiers` elle-même : c'est ce qu'on restaure, tout le reste y pend. */
  | { acces: 'le_dossier' }
  /** `dossier_id` NOT NULL : toutes les lignes du dossier, et rien d'autre. */
  | { acces: 'direct' }
  /**
   * `dossier_id` NULLABLE : la table mélange les lignes d'un dossier et des lignes PARTAGÉES entre
   * tous (`dossier_id` nul). Les deux doivent être lues — voir le commentaire ci-dessous, c'est le
   * piège qui rendait cet export inexploitable.
   */
  | { acces: 'partage' }
  /** Pas de `dossier_id` : les lignes se prennent par les identifiants déjà lus dans `parent`. */
  | { acces: 'par_parent'; parent: string; colonne: string }
  /** Table de niveau cabinet : elle décrit le cabinet, pas le dossier — hors de cet export. */
  | { acces: 'cabinet' }
  /** Référentiel que rien dans l'export ne pointe : hors de cet export lui aussi. */
  | { acces: 'global' }

export const CHEMINS_DOSSIER: Readonly<Record<string, CheminDossier>> = {
  cabinets: { acces: 'global' },
  super_admins: { acces: 'global' },
  taux_change_bce: { acces: 'global' },

  dossiers: { acces: 'le_dossier' },
  cabinet_admins: { acces: 'cabinet' },
  tiers_categories_cabinet: { acces: 'cabinet' },

  categories: { acces: 'partage' },
  natures_immobilisation: { acces: 'partage' },

  facture_lignes: { acces: 'par_parent', parent: 'factures_emises', colonne: 'facture_id' },
  mouvements_cca: { acces: 'par_parent', parent: 'comptes_courants_associes', colonne: 'compte_id' },

  agent_conversations: { acces: 'direct' },
  comptes_courants_associes: { acces: 'direct' },
  controles_releves_bancaires: { acces: 'direct' },
  cotisations_declarees: { acces: 'direct' },
  declarations_tva: { acces: 'direct' },
  documents_divers: { acces: 'direct' },
  dossier_assignations: { acces: 'direct' },
  ecritures_brouillon: { acces: 'direct' },
  emails_envoyes: { acces: 'direct' },
  emprunts: { acces: 'direct' },
  facture_numerotation: { acces: 'direct' },
  facture_superpdp_events: { acces: 'direct' },
  factures_emises: { acces: 'direct' },
  immobilisations: { acces: 'direct' },
  informations_dossier: { acces: 'direct' },
  lignes_bancaires: { acces: 'direct' },
  memberships: { acces: 'direct' },
  packs: { acces: 'direct' },
  piece_commentaires: { acces: 'direct' },
  piece_textes_ocr: { acces: 'direct' },
  pieces: { acces: 'direct' },
  previsionnels_bancaires: { acces: 'direct' },
  references_annuelles: { acces: 'direct' },
  references_postes_annuels: { acces: 'direct' },
  regles_bancaires_ignorees: { acces: 'direct' },
  sous_dossiers: { acces: 'direct' },
  superpdp_credentials: { acces: 'direct' },
  supplements: { acces: 'direct' },
  tiers_categories: { acces: 'direct' },
  vehicules: { acces: 'direct' },
}

/** Une étape du plan de lecture d'un dossier, dans l'ordre où elle doit être exécutée. */
export interface EtapeExport {
  table: string
  chemin: CheminDossier
}

// Le plan de lecture d'un dossier : les tables à lire, dans un ordre où chaque table atteignable
// seulement par son parent vient APRÈS lui — sans quoi on n'aurait pas encore les identifiants
// nécessaires pour la lire.
//
// L'ordre de restauration convient tel quel, puisqu'un parent y précède toujours ses enfants ; on le
// réutilise plutôt que d'en tenir un second, qui finirait par diverger.
//
// Sont exclues les tables que rien dans l'export ne pointe (`global`) et celles qui décrivent le
// cabinet plutôt que le dossier (`cabinet`). Attention à ne pas confondre avec `partage` : une ligne
// partagée est bien dans l'export, parce que les pièces du dossier la pointent — ce qui la distingue
// d'un référentiel, c'est qu'elle sera réinsérée seulement si elle manque (voir `estLignePartagee`).
export function planExportDossier(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): EtapeExport[] {
  return ordre
    .map((table) => ({ table, chemin: chemins[table] }))
    .filter((e): e is EtapeExport => e.chemin != null && e.chemin.acces !== 'global' && e.chemin.acces !== 'cabinet')
}

// Vrai quand la ligne appartient à tout le cabinet plutôt qu'au dossier exporté.
//
// Se lit dans la donnée elle-même (`dossier_id` nul) plutôt que dans une déclaration à tenir à jour à
// côté : une seconde liste finirait par diverger de la première, et rien ne le dirait.
//
// La conséquence est au moment de la restauration : une ligne partagée est réinsérée SEULEMENT si elle
// manque. Elle ne se réécrit jamais — une catégorie renommée depuis la sauvegarde, ou dont le compte
// comptable a été corrigé, appartient à tous les dossiers du cabinet, et restaurer un client n'est pas
// une raison de la ramener en arrière pour les autres.
export function estLignePartagee(table: string, ligne: Record<string, unknown>): boolean {
  return CHEMINS_DOSSIER[table]?.acces === 'partage' && ligne.dossier_id == null
}

/** Une table dont on ne saurait pas lire les lignes : elle serait absente de tout export, en silence. */
export interface TableSansChemin {
  table: string
  motif: 'chemin_non_declare' | 'parent_lu_trop_tard'
}

// Le garde-fou permanent sur la carte ci-dessus.
//
// Deux façons de perdre une table sans s'en apercevoir : ne pas déclarer son chemin du tout — elle
// sort alors de l'export sans un mot — ou déclarer un parent lu APRÈS elle, auquel cas on chercherait
// ses lignes avec une liste d'identifiants encore vide, ce qui rend zéro ligne et aucune erreur.
export function tablesSansChemin(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): TableSansChemin[] {
  const rang = new Map(ordre.map((table, i) => [table, i]))
  const problemes: TableSansChemin[] = []

  for (const table of ordre) {
    const chemin = chemins[table]
    if (!chemin) {
      problemes.push({ table, motif: 'chemin_non_declare' })
      continue
    }
    if (chemin.acces !== 'par_parent') continue
    const rangParent = rang.get(chemin.parent)
    if (rangParent === undefined || rangParent >= rang.get(table)!) {
      problemes.push({ table, motif: 'parent_lu_trop_tard' })
    }
  }
  return problemes
}

/** Une table que l'export pointe sans la lire : la restauration s'arrêtera dessus. */
export interface ParentHorsPlan {
  parent: string
  /** Les tables du plan qui la pointent. */
  pointeePar: string[]
  /** Vrai quand le lien accepte NULL : la restauration pourrait passer en sacrifiant le lien. */
  effacable: boolean
}

// L'invariant qui aurait évité le défaut des lignes partagées, et qui l'évitera la prochaine fois.
//
// La règle est simple et se vérifie toute seule : si une table du plan pointe une table absente du
// plan, alors la restauration butera dessus — soit Postgres refuse (NO ACTION), soit il faut sacrifier
// le lien. Une seule exception est légitime, et elle doit être VOULUE, pas subie : `cabinets`, qu'un
// export de dossier ne contient délibérément pas et que la base d'arrivée doit déjà porter.
//
// Écrit après coup : `categories` et `natures_immobilisation` étaient lues avec un filtre qui rendait
// zéro ligne, donc absentes de fait de tout export, pendant que les pièces et les immobilisations les
// pointaient. Ce contrôle-là l'aurait dit dès la première exécution des tests.
export function parentsHorsPlan(
  ordre: readonly string[] = ORDRE_RESTAURATION,
  chemins: Readonly<Record<string, CheminDossier>> = CHEMINS_DOSSIER,
): ParentHorsPlan[] {
  const dansLePlan = new Set(planExportDossier(ordre, chemins).map((e) => e.table))
  const parTable = new Map<string, ParentHorsPlan>()

  for (const relation of RELATIONS) {
    if (!dansLePlan.has(relation.enfant)) continue
    if (dansLePlan.has(relation.parent)) continue
    // Une table sans chemin déclaré relève de `tablesSansChemin`, qui le dit mieux : la compter ici
    // aussi ferait deux alertes pour un seul défaut.
    if (chemins[relation.parent] == null) continue

    const deja = parTable.get(relation.parent)
    if (deja) {
      if (!deja.pointeePar.includes(relation.enfant)) deja.pointeePar.push(relation.enfant)
      // Un parent pointé par plusieurs liens n'est effaçable que si TOUS le sont : il suffit d'un
      // lien obligatoire pour que la restauration s'arrête.
      deja.effacable = deja.effacable && relation.aLaSuppression === 'met_a_null'
      continue
    }
    parTable.set(relation.parent, {
      parent: relation.parent,
      pointeePar: [relation.enfant],
      effacable: relation.aLaSuppression === 'met_a_null',
    })
  }

  return [...parTable.values()].sort((a, b) => a.parent.localeCompare(b.parent))
}

// L'ordre de SUPPRESSION est l'inverse exact de l'ordre de restauration : on retire les enfants avant
// les parents. Déduit plutôt que réécrit — deux listes à tenir finiraient par diverger, et la seconde
// ne serait vérifiée par personne.
export function ordreSuppression(ordre: readonly string[] = ORDRE_RESTAURATION): string[] {
  return [...ordre].reverse()
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ce qu'une sauvegarde de données ne contient pas — et qu'il faudra pourtant pour la restaurer.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Une colonne qui pointe un compte utilisateur (`auth.users`), table que ce chemin ne sauvegarde pas. */
export interface PrerequisCompte {
  table: string
  colonne: string
  /**
   * Vrai quand la colonne est NOT NULL. La distinction décide de tout : un prérequis facultatif se
   * solde par une trace d'auteur perdue, un prérequis obligatoire empêche purement et simplement la
   * ligne d'être réinsérée, et il n'existe aucun contournement — on ne met pas NULL dans une colonne
   * qui le refuse.
   */
  obligatoire: boolean
}

// Les quatorze colonnes du schéma `public` qui pointent `auth.users`, lues de pg_constraint le
// 18/09/2026 comme le reste de ce fichier.
//
// RELATIONS les exclut volontairement, et c'est justifié : `auth.users` n'appartient pas à
// l'application, ce chemin ne la sauvegarde pas et ne la restaurera pas. Mais les taire entièrement
// revient à laisser croire qu'un export de données suffit à remonter un dossier. Il ne suffit pas :
// quatre tables du plan d'export portent un compte en NOT NULL — `cabinet_admins`,
// `dossier_assignations`, `memberships` et `packs`. Une restauration dans une base dont les comptes
// ont disparu s'arrête net sur elles : la direction du cabinet, les affectations d'équipe, les accès
// clients et l'historique des packs.
//
// Autrement dit : la sauvegarde des données et celle des comptes sont deux sauvegardes, pas une. Les
// lister ici, hors de RELATIONS, dit les deux choses à la fois — elles ne sont pas restaurées, et
// elles sont exigées.
export const PREREQUIS_AUTH: readonly PrerequisCompte[] = [
  { table: 'agent_conversations', colonne: 'created_by', obligatoire: false },
  { table: 'cabinet_admins', colonne: 'user_id', obligatoire: true },
  { table: 'comptes_courants_associes', colonne: 'created_by', obligatoire: false },
  { table: 'dossier_assignations', colonne: 'user_id', obligatoire: true },
  { table: 'emails_envoyes', colonne: 'envoye_par', obligatoire: false },
  { table: 'emprunts', colonne: 'created_by', obligatoire: false },
  { table: 'memberships', colonne: 'user_id', obligatoire: true },
  { table: 'mouvements_cca', colonne: 'created_by', obligatoire: false },
  { table: 'packs', colonne: 'generated_by', obligatoire: true },
  { table: 'piece_commentaires', colonne: 'auteur_id', obligatoire: false },
  { table: 'pieces', colonne: 'uploaded_by', obligatoire: false },
  { table: 'previsionnels_bancaires', colonne: 'updated_by', obligatoire: false },
  { table: 'super_admins', colonne: 'user_id', obligatoire: true },
  { table: 'supplements', colonne: 'created_by', obligatoire: false },
]

/** Les comptes utilisateurs dont une sauvegarde dépend, séparés selon ce que coûte leur absence. */
export interface ComptesRequis {
  /** Sans eux, la restauration s'arrête : la colonne refuse NULL. */
  obligatoires: string[]
  /** Sans eux, la restauration aboutit ; seule la trace de l'auteur est perdue. */
  facultatifs: string[]
}

// Les comptes qu'il faudra avoir sous la main avant de restaurer cette sauvegarde-ci.
//
// À exécuter en même temps que `liensPerdus`, et pour la même raison : savoir avant d'écrire la
// première ligne, plutôt que de le découvrir sur la trente-septième table.
//
// Un compte qui figure dans les deux colonnes est obligatoire — c'est le cas dès qu'un même
// utilisateur a, par exemple, généré un pack et déposé une pièce.
export function comptesRequis(contenu: Contenu): ComptesRequis {
  const obligatoires = new Set<string>()
  const facultatifs = new Set<string>()

  for (const prerequis of PREREQUIS_AUTH) {
    const lignes = contenu[prerequis.table]
    if (!lignes) continue
    for (const ligne of lignes) {
      const valeur = ligne[prerequis.colonne]
      if (valeur == null) continue
      ;(prerequis.obligatoire ? obligatoires : facultatifs).add(String(valeur))
    }
  }

  for (const compte of obligatoires) facultatifs.delete(compte)
  return { obligatoires: [...obligatoires].sort(), facultatifs: [...facultatifs].sort() }
}

/** Une ligne que la sauvegarde suppose déjà présente dans la base d'arrivée. */
export interface ReferenceExterne {
  table: string
  colonne: string
  /** La table parente, absente de la sauvegarde. */
  parent: string
  /** Les identifiants attendus, sans doublon. */
  valeurs: string[]
}

// L'envers exact de `liensPerdus` : ce que celui-ci ignore délibérément, celui-ci le nomme.
//
// `liensPerdus` passe son chemin quand la table parente est absente de la sauvegarde, et il a raison —
// un export d'un seul dossier ne contient pas `cabinets`, ce n'est pas une faute. Mais le silence
// laissait ces lignes-là sans statut : ni perdues, ni garanties. Or elles décident du succès de la
// restauration tout autant que les autres, à ceci près qu'elles ne dépendent pas de la sauvegarde
// mais de la base d'arrivée.
//
// Concrètement, sur un export de dossier : la ligne `cabinets` du cabinet propriétaire. Sans elle,
// `dossiers.cabinet_id` échoue à la toute première table, et rien d'autre ne sera tenté.
export function referencesExternes(contenu: Contenu): ReferenceExterne[] {
  const externes: ReferenceExterne[] = []

  for (const relation of RELATIONS) {
    const lignes = contenu[relation.enfant]
    if (!lignes) continue
    // La table parente est là : ses liens relèvent de `liensPerdus`, pas d'ici.
    if (contenu[relation.parent]) continue

    const valeurs = new Set<string>()
    for (const ligne of lignes) {
      const valeur = ligne[relation.colonne]
      if (valeur == null) continue
      valeurs.add(String(valeur))
    }
    if (valeurs.size === 0) continue
    externes.push({
      table: relation.enfant,
      colonne: relation.colonne,
      parent: relation.parent,
      valeurs: [...valeurs].sort(),
    })
  }
  return externes
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Le plan de réinsertion : dans quel ordre écrire, et ce qu'il faut repasser ensuite.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Une table à réinsérer, avec les lignes telles qu'elles doivent partir au PREMIER passage. */
export interface EtapeReinsertion {
  table: string
  lignes: Record<string, unknown>[]
}

/** Les valeurs auto-référencées à reposer, une fois toutes les lignes de la table en place. */
export interface SecondePasse {
  table: string
  colonne: string
  valeurs: { id: string; valeur: unknown }[]
}

export interface PlanReinsertion {
  etapes: EtapeReinsertion[]
  secondePasse: SecondePasse[]
  /**
   * Les tables présentes dans la sauvegarde mais absentes de l'ordre de restauration. Elles ne
   * seraient écrites nulle part : un appelant qui les ignore restaure moins qu'il ne croit.
   */
  tablesIgnorees: string[]
}

// Transforme une sauvegarde en la suite d'écritures qui la remet en base.
//
// Pourquoi la seconde passe, exactement : `factures_emises.facture_origine_id` pointe une autre
// facture (un avoir désigne celle qu'il annule). L'essai en base du 18/09/2026 est plus précis que ce
// qu'on croyait — Postgres ACCEPTE un avoir placé avant son origine tant que les deux lignes partent
// dans la MÊME commande INSERT ; il le refuse dès qu'elles partent en deux commandes.
//
// Or une restauration découpe forcément ses écritures en lots : le lot est un paramètre technique, il
// ne doit pas décider si la restauration aboutit. Sans seconde passe, une table restaurée d'un bloc
// passerait et la même table restaurée en deux lots échouerait — le genre de panne qui n'apparaît
// qu'en production, parce que seule la production est assez grosse pour franchir le seuil.
//
// D'où la règle : la colonne part à NULL pour tout le monde, puis on la repose. Le résultat ne dépend
// alors plus d'aucune taille de lot.
export function planReinsertion(
  contenu: Contenu,
  ordre: readonly string[] = ORDRE_RESTAURATION,
): PlanReinsertion {
  const etapes: EtapeReinsertion[] = []
  const secondePasse: SecondePasse[] = []

  for (const table of ordre) {
    const lignes = contenu[table]
    if (!lignes || lignes.length === 0) continue

    const auto = TABLES_AUTO_REFERENCEES.filter((a) => a.table === table)
    if (auto.length === 0) {
      etapes.push({ table, lignes })
      continue
    }

    // Copie plutôt que modification en place : la sauvegarde reçue doit rester intacte, ne serait-ce
    // que pour que `liensPerdus` puisse encore être exécuté dessus après coup.
    const premierePasse = lignes.map((ligne) => ({ ...ligne }))
    for (const { colonne } of auto) {
      const valeurs: { id: string; valeur: unknown }[] = []
      for (const ligne of premierePasse) {
        if (ligne[colonne] == null) continue
        valeurs.push({ id: String(ligne.id), valeur: ligne[colonne] })
        ligne[colonne] = null
      }
      if (valeurs.length > 0) secondePasse.push({ table, colonne, valeurs })
    }
    etapes.push({ table, lignes: premierePasse })
  }

  const connues = new Set(ordre)
  const tablesIgnorees = Object.keys(contenu)
    .filter((table) => !connues.has(table) && contenu[table].length > 0)
    .sort()

  return { etapes, secondePasse, tablesIgnorees }
}
