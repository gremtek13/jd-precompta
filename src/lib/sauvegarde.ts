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
  /** Vrai quand Postgres ACCEPTERA quand même la restauration, en écrivant NULL sans rien dire. */
  silencieux: boolean
}

type Contenu = Record<string, Record<string, unknown>[]>

// Le contrôle qui décide si une restauration est réellement complète.
//
// Pourquoi il est indispensable, et pourquoi il ne peut pas être délégué à la base : treize relations
// du schéma sont en SET NULL. Quand la ligne pointée manque, Postgres ne refuse RIEN — il écrit NULL
// et la restauration se déroule sans une seule erreur. Or ces treize-là sont précisément les liens qui
// portent le travail comptable :
//
//   lignes_bancaires.piece_id      le rapprochement bancaire de chaque mouvement
//   ecritures_brouillon.piece_id   la pièce justifiant chaque écriture
//   ecritures_brouillon.ligne_bancaire_id  le mouvement qui la justifie
//   immobilisations.piece_id       la facture d'achat de l'immobilisation
//   supplements.facture_id         le rattachement d'un supplément à sa facture
//
// Une restauration qui perd des lignes rend donc un dossier d'apparence intacte, où le rapprochement
// est défait et les écritures orphelines, sans qu'aucune alerte ne se déclenche. C'est exactement ce
// qu'on découvre six mois plus tard. D'où ce contrôle, à exécuter APRÈS toute restauration.
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
        silencieux: relation.aLaSuppression === 'met_a_null',
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
// Trois tables, enfin, n'appartiennent à aucun dossier : le référentiel des taux de change, la liste
// des super-administrateurs et les cabinets eux-mêmes. Les inclure dans l'export d'un dossier serait
// faux — on restaurerait un référentiel mondial en croyant restaurer un client.
export type CheminDossier =
  /** La table porte `dossier_id` : lecture directe. */
  | { acces: 'direct' }
  /** Pas de `dossier_id` : les lignes se prennent par les identifiants déjà lus dans `parent`. */
  | { acces: 'par_parent'; parent: string; colonne: string }
  /** Table de niveau cabinet : elle suit le cabinet, pas le dossier. */
  | { acces: 'cabinet' }
  /** Référentiel partagé, qui n'appartient à aucun dossier ni à aucun cabinet. */
  | { acces: 'global' }

export const CHEMINS_DOSSIER: Readonly<Record<string, CheminDossier>> = {
  cabinets: { acces: 'global' },
  super_admins: { acces: 'global' },
  taux_change_bce: { acces: 'global' },

  dossiers: { acces: 'cabinet' },
  cabinet_admins: { acces: 'cabinet' },
  tiers_categories_cabinet: { acces: 'cabinet' },

  facture_lignes: { acces: 'par_parent', parent: 'factures_emises', colonne: 'facture_id' },
  mouvements_cca: { acces: 'par_parent', parent: 'comptes_courants_associes', colonne: 'compte_id' },

  agent_conversations: { acces: 'direct' },
  categories: { acces: 'direct' },
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
  natures_immobilisation: { acces: 'direct' },
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
// Les tables globales sont exclues : un export de dossier qui embarquerait le référentiel des taux de
// change laisserait croire, à la restauration, qu'on rétablit un client alors qu'on écrase un
// référentiel partagé par tous.
export function planExportDossier(ordre: readonly string[] = ORDRE_RESTAURATION): EtapeExport[] {
  return ordre
    .map((table) => ({ table, chemin: CHEMINS_DOSSIER[table] }))
    .filter((e): e is EtapeExport => e.chemin != null && e.chemin.acces !== 'global')
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

// L'ordre de SUPPRESSION est l'inverse exact de l'ordre de restauration : on retire les enfants avant
// les parents. Déduit plutôt que réécrit — deux listes à tenir finiraient par diverger, et la seconde
// ne serait vérifiée par personne.
export function ordreSuppression(ordre: readonly string[] = ORDRE_RESTAURATION): string[] {
  return [...ordre].reverse()
}
