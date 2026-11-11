// PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER (ligne 26.6, lot MCB1 ; MCB-Q1 à Q8, tranchées par le cabinet le 11/11/2026) :
// le module pur de la migration `comptes_bancaires`, PRÉPARÉE le 11/11/2026 (supabase/preparees/), pas appliquée. Le récit :
// HISTORIQUE.md, « 11/11/2026 — PLUSIEURS COMPTES BANCAIRES D'UN DOSSIER : D'EMBLÉE, LES LOTS, ET LA BASE (MCB1) ».
//
// Ce que la base tient, et que ce module redit au mot et au code près (comptesBancaires.test.ts le confronte au texte de la
// migration, refus par refus, dans l'ordre de chaque fonction) :
//   - un dossier tient des comptes bancaires professionnels ; le PRINCIPAL, le premier, suit le compte du rôle `banque` de
//     son plan ; un autre compte tient SON compte 512, à six chiffres, qui n'est à aucun rôle du plan ni à aucun autre
//     compte du dossier (MCB-Q1), depuis le 1er janvier d'un exercice — avant, ses mouvements s'écrivent au 512 du
//     principal (MCB-Q7 : 2025 se valide à un seul 512, 2026 s'ouvre avec un solde par compte) ;
//   - un mouvement ou un relevé arrivé sans compte reçoit celui du dossier quand il n'en a qu'un (le principal, créé à son
//     premier mouvement s'il n'en a aucun), et se refuse dès deux : un dossier à un seul compte ne voit rien changer ;
//   - le compte et sa date se figent au premier mouvement ou relevé ; le libellé, que le client « Banque » lit (MCB-Q8),
//     reste modifiable ; l'ouverture et la clôture encadrent les mouvements ; un mouvement et le contrôle de son fichier
//     sont du même compte (le nom d'un fichier reste unique dans le dossier, MCB-Q6).
// Les lots suivants s'en serviront : l'import (le compte choisi, le dédoublonnage par compte), le contrôle des soldes et la
// validation par compte, les compositions et le FEC (`compteDeBanqueDuMouvement`), les écrans, l'espace client.

/** La migration `comptes_bancaires` (supabase/preparees/), PRÉPARÉE le 11/11/2026, pas appliquée : baissé, aucune lecture
 *  ne nomme sa table ni sa colonne `compte_bancaire_id`, et le plan de sauvegarde tient la table dehors — la lire avant la
 *  migration ferait échouer toute sauvegarde. Il se lève le jour de l'application, quand la migration entre dans l'export
 *  (comptesBancaires.test.ts l'exige). */
export const COMPTES_BANCAIRES_PREVUS = false

/** Les tables de la migration, que le plan de sauvegarde tient derrière le drapeau. */
export const TABLES_DES_COMPTES_BANCAIRES: readonly string[] = ['comptes_bancaires']

/** Le libellé du principal que la base crée au premier mouvement d'un dossier, et que la migration pose. */
export const LIBELLE_DU_COMPTE_PRINCIPAL = 'Compte principal'

/** Une ligne de `comptes_bancaires`, telle que la migration la décrit (NOT NULL compris). */
export interface CompteBancaire {
  id: string
  dossier_id: string
  /** Texte libre, d'un à quatre-vingts caractères, que le client « Banque » lit. */
  libelle: string
  principal: boolean
  /** Nul pour le principal (le compte du rôle `banque`) ; sinon son 512 à six chiffres. */
  compte: string | null
  /** Nul pour le principal ; sinon le 1er janvier (AAAA-01-01) depuis lequel ses mouvements s'écrivent à son compte. */
  compte_propre_depuis: string | null
  ouvert_le: string | null
  clos_le: string | null
  created_by: string | null
  created_at: string
}

/** Un refus de la base : sa clé, son code et ses mots, où chaque `%` est une valeur, dans l'ordre. */
export interface RefusDeLaBase {
  cle: string
  code: string
  modele: string
}

/** Les refus de `garder_comptes_bancaires`, dans l'ordre du corps de la fonction. */
export const REFUS_DE_LA_GARDE: readonly RefusDeLaBase[] = [
  { cle: 'porte_des_mouvements', code: '23503',
    modele: 'Le compte bancaire « % » porte des mouvements ou des relevés : il ne se retire pas.' },
  { cle: 'libelle', code: '23514',
    modele: "Un compte bancaire se nomme d'un libellé d'un à quatre-vingts caractères, que le client « Banque » lit." },
  { cle: 'rang', code: '23514',
    modele: 'Un compte bancaire ne change ni de dossier ni de rang : le principal le reste, un autre compte aussi.' },
  { cle: 'fige', code: '23514',
    modele: 'Le compte bancaire « % » porte déjà des mouvements ou des relevés : son compte du plan et la date depuis laquelle il le tient ne changent plus.' },
  { cle: 'periode_des_mouvements', code: '23514',
    modele: "Le compte bancaire « % » porte des mouvements hors de la période qu'on lui donne : ses dates d'ouverture et de clôture les encadrent." },
  { cle: 'periode', code: '23514', modele: 'Un compte bancaire se clôt le jour de son ouverture ou après.' },
  { cle: 'principal_sans_compte', code: '23514',
    modele: 'Le compte principal suit le compte de banque du plan du dossier : il ne porte ni compte ni date à lui.' },
  { cle: 'second_principal', code: '23505',
    modele: 'Ce dossier a déjà son compte principal : un autre compte bancaire tient son propre compte 512.' },
  { cle: 'forme_du_compte', code: '23514',
    modele: "Un compte bancaire autre que le principal tient son propre compte du plan, six chiffres qui commencent par 512 : « % » n'en est pas un." },
  { cle: 'premier_janvier', code: '23514',
    modele: "Un compte bancaire tient son propre compte depuis le premier jour d'un exercice, un 1er janvier : « % » n'en est pas un." },
  { cle: 'compte_d_un_role', code: '23514',
    modele: "Le compte % est celui du rôle « % » du plan comptable du dossier : un compte bancaire tient un compte qui n'est qu'à lui." },
  { cle: 'compte_d_un_autre', code: '23505', modele: 'Le compte % tient déjà un autre compte bancaire du dossier.' },
]

/** Le refus de `garder_compte_principal_present`, jugé à la fin de la transaction. */
export const REFUS_PRINCIPAL_ABSENT: RefusDeLaBase = {
  cle: 'principal_absent', code: '23514',
  modele: 'Un dossier qui tient un compte bancaire tient son compte principal : le premier créé, qui suit le compte de banque du plan.',
}

const FICHIER_D_UN_AUTRE_COMPTE =
  "Le relevé « % » est d'un autre compte bancaire : ses mouvements sont du compte de son contrôle."

/** Les refus de `poser_compte_bancaire`, dans l'ordre du corps : le mouvement, puis le contrôle, pour le fichier. Un
 *  compte qu'on ne lit pas et un compte d'un autre dossier se refusent d'un même mot : la clé ne tient que le compte. */
export const REFUS_DU_MOUVEMENT: readonly RefusDeLaBase[] = [
  { cle: 'change_de_compte', code: '23514',
    modele: "Un mouvement ou un relevé ne change pas de compte bancaire : il se retire, et s'importe sous le sien." },
  { cle: 'plusieurs_comptes', code: '23502',
    modele: 'Ce dossier tient plusieurs comptes bancaires : un mouvement ou un relevé dit le sien.' },
  { cle: 'compte_d_un_autre_dossier', code: '23503',
    modele: "Le compte bancaire d'un mouvement ou d'un relevé est un compte de son dossier." },
  { cle: 'hors_periode', code: '23514',
    modele: "Le mouvement du % tombe hors de la période du compte bancaire « % » : ses dates d'ouverture et de clôture l'encadrent." },
  { cle: 'fichier_d_un_autre_compte', code: '23514', modele: FICHIER_D_UN_AUTRE_COMPTE },
  { cle: 'fichier_d_un_autre_compte_controle', code: '23514', modele: FICHIER_D_UN_AUTRE_COMPTE },
]

/** Le refus de `garder_plan_hors_des_comptes_bancaires`. */
export const REFUS_DU_PLAN: RefusDeLaBase = {
  cle: 'plan_sur_un_compte_bancaire', code: '23514',
  modele: 'Le compte % tient le compte bancaire « % » du dossier : le rôle « % » du plan ne le prend pas.',
}

/** Un refus dit : sa clé, son code, et ses mots, les valeurs posées. */
export interface RefusDit {
  cle: string
  code: string
  message: string
}

/** Les mots d'un refus, chaque `%` remplacé par la valeur suivante, comme `raise exception` les compose. */
export function formuler(refus: RefusDeLaBase, ...valeurs: readonly string[]): RefusDit {
  let i = 0
  const message = refus.modele.replace(/%/g, () => valeurs[i++] ?? '')
  return { cle: refus.cle, code: refus.code, message }
}

const refusDeLaGarde = (cle: string, ...valeurs: readonly string[]): RefusDit =>
  formuler(REFUS_DE_LA_GARDE.find((r) => r.cle === cle) as RefusDeLaBase, ...valeurs)

/** Une date civile AAAA-MM-JJ dite JJ/MM/AAAA, comme `to_char(…, 'DD/MM/YYYY')`. */
export function dateDite(date: string): string {
  const [annee, mois, jour] = date.slice(0, 10).split('-')
  return `${jour}/${mois}/${annee}`
}

/** Un 1er janvier : le premier jour d'un exercice, seul départ du compte propre d'un compte bancaire. */
export function estUnPremierJanvier(date: string): boolean {
  return /^\d{4}-01-01$/.test(date)
}

/** Le compte d'un rôle du plan effectif du dossier : le rôle et son compte, dans l'ordre du catalogue. */
export interface CompteDUnRole {
  role: string
  compte: string
}

/** Ce qu'un compte bancaire saisi porte, pour la garde. */
export type SaisieDUnCompte = Pick<CompteBancaire, 'libelle' | 'principal' | 'compte' | 'compte_propre_depuis' | 'ouvert_le' | 'clos_le'>

/** Ce que la garde lit autour d'une saisie : TOUS les comptes du dossier, le plan effectif, et, pour une modification,
 *  le compte d'avant, s'il porte un mouvement ou un relevé, et les dates de ses mouvements. Sans défaut : un appelant qui
 *  n'a pas lu en entier ne juge pas. */
export interface ContexteDUnCompte {
  comptesDuDossier: readonly Pick<CompteBancaire, 'id' | 'principal' | 'compte'>[]
  comptesDesRoles: readonly CompteDUnRole[]
  avant: (Pick<CompteBancaire, 'id' | 'libelle' | 'principal' | 'compte' | 'compte_propre_depuis' | 'ouvert_le' | 'clos_le'> & {
    porteDesMouvementsOuDesReleves: boolean
    datesDesMouvements: readonly string[]
  }) | null
}

/** Le premier refus que `garder_comptes_bancaires` opposerait à cette saisie (une insertion si `avant` est nul, une
 *  modification sinon), dans l'ordre de la fonction ; nul si elle passe. Le dossier qui change n'est pas une saisie de
 *  l'écran : il n'est pas jugé ici. */
export function refusDuCompteBancaire(saisie: SaisieDUnCompte, contexte: ContexteDUnCompte): RefusDit | null {
  const { avant } = contexte
  const libelle = saisie.libelle ?? ''
  if (libelle.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '') === '' || libelle.length > 80) return refusDeLaGarde('libelle')
  if (avant) {
    if (saisie.principal !== avant.principal) return refusDeLaGarde('rang')
    if ((saisie.compte !== avant.compte || saisie.compte_propre_depuis !== avant.compte_propre_depuis)
      && avant.porteDesMouvementsOuDesReleves) return refusDeLaGarde('fige', avant.libelle)
    if ((saisie.ouvert_le !== avant.ouvert_le || saisie.clos_le !== avant.clos_le)
      && avant.datesDesMouvements.some((d) => (saisie.ouvert_le !== null && d < saisie.ouvert_le)
        || (saisie.clos_le !== null && d > saisie.clos_le))) return refusDeLaGarde('periode_des_mouvements', avant.libelle)
  }
  if (saisie.ouvert_le !== null && saisie.clos_le !== null && saisie.clos_le < saisie.ouvert_le) return refusDeLaGarde('periode')
  if (saisie.principal) {
    if (saisie.compte !== null || saisie.compte_propre_depuis !== null) return refusDeLaGarde('principal_sans_compte')
    if (!avant && contexte.comptesDuDossier.some((c) => c.principal)) return refusDeLaGarde('second_principal')
    return null
  }
  if (saisie.compte === null || !/^512[0-9]{3}$/.test(saisie.compte)) return refusDeLaGarde('forme_du_compte', saisie.compte ?? '')
  if (saisie.compte_propre_depuis === null || !estUnPremierJanvier(saisie.compte_propre_depuis)) {
    return refusDeLaGarde('premier_janvier', saisie.compte_propre_depuis === null ? '' : dateDite(saisie.compte_propre_depuis))
  }
  const role = contexte.comptesDesRoles.find((r) => r.compte === saisie.compte)
  if (role) return refusDeLaGarde('compte_d_un_role', saisie.compte, role.role)
  if (contexte.comptesDuDossier.some((c) => c.compte === saisie.compte && c.id !== avant?.id)) {
    return refusDeLaGarde('compte_d_un_autre', saisie.compte)
  }
  return null
}

/** Ce que la base fait d'un mouvement ou d'un relevé arrivé SANS compte (`poser_compte_bancaire`) : le principal à créer
 *  quand le dossier n'en tient aucun, le seul compte quand il en tient un, le refus dès deux. */
export type CompteDUnArrivantSansLeSien =
  | { cas: 'principal_a_creer' }
  | { cas: 'compte'; id: string }
  | { cas: 'refus'; refus: RefusDit }

export function compteDUnArrivantSansLeSien(comptesDuDossier: readonly Pick<CompteBancaire, 'id'>[]): CompteDUnArrivantSansLeSien {
  if (comptesDuDossier.length === 0) return { cas: 'principal_a_creer' }
  if (comptesDuDossier.length === 1) return { cas: 'compte', id: comptesDuDossier[0].id }
  return { cas: 'refus', refus: formuler(REFUS_DU_MOUVEMENT[1]) }
}

/** Le compte 512 où s'écrit la jambe de banque d'un mouvement (`compte_de_banque_du_mouvement`) : celui du rôle `banque`
 *  du plan pour le principal, et pour un autre compte avant le 1er janvier qu'il porte (MCB-Q7) ; le sien ensuite. Les
 *  dates sont des dates civiles AAAA-MM-JJ, que l'ordre du texte compare. */
export function compteDeBanqueDuMouvement(
  compte: Pick<CompteBancaire, 'principal' | 'compte' | 'compte_propre_depuis'>,
  date: string,
  compteDuRoleBanque: string,
): string {
  if (compte.principal || compte.compte === null || compte.compte_propre_depuis === null
    || date.slice(0, 10) < compte.compte_propre_depuis) return compteDuRoleBanque
  return compte.compte
}

/** Le refus qu'un rôle du plan rencontrerait sur le compte d'un compte bancaire du dossier
 *  (`garder_plan_hors_des_comptes_bancaires`), nul s'il passe. */
export function refusDuPlan(
  comptesDuDossier: readonly Pick<CompteBancaire, 'libelle' | 'compte'>[],
  role: string,
  compte: string,
): RefusDit | null {
  const tenu = comptesDuDossier.find((c) => c.compte === compte)
  return tenu ? formuler(REFUS_DU_PLAN, compte, tenu.libelle, role) : null
}
