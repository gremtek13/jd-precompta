// L'ÉCRITURE LIBRE DE L'EXPERT-COMPTABLE (EL1 ; conception : docs/conceptions/54-ecriture-libre-de-l-expert-comptable.md).
//
// Une écriture en partie double, saisie compte par compte par le cabinet, que rien dans l'application ne produit. Ce module,
// PUR et en centimes, la juge AVANT le clic, sous les mots et dans l'ordre que la fonction de la base
// (`enregistrer_ecriture_libre`, migration préparée `ecritures_libres`, EL2) redit ; il compose les écritures que la base
// recompose et compare en multiensemble ; il dit les avertissements, qui ne refusent rien. Les réponses du cabinet du
// 17/11/2026 : EL-Q1 (tout compte du cabinet qui suit le dossier l'écrit, la base le vérifie par `admin_du_dossier`), EL-Q2
// (A), EL-Q3 (A), EL-Q4 (A), EL-Q5 (A), EL-Q6 (A), EL-Q7 (A), EL-Q8 (A), EL-Q9 (A) ; et EXP58-Q3 (A), le même jour, qui retire
// la désignation « contre la règle de la trésorerie » qu'EL-Q3 (A) permettait : une charge ou un produit rattaché ne compte
// jamais dans la 2035 de l'année de l'écriture, il se passe hors de la 2035 (l'expert-comptable ne la passe pas ;
// BOI-BNC-BASE-40-10 § 260). Conception 58, § 5.
//
// SOURCES. CGI, art. 93, 1 et 93 A ; BOI-BNC-BASE-40-10 § 260 (en trésorerie, une dépense compte l'année où elle est
// effectivement acquittée) ; PCG (règlement ANC n° 2014-03, numérotation du 1er janvier 2026), art. 1121-1 (la liste des
// comptes), 1214-40, 1214-46 et 1214-48 (charges à payer, produits à recevoir, régularisations) ; LPF, art. A47 A-1 (une
// écriture équilibrée, une date). Lus par la conception (§ 2).

/** LA MIGRATION `ecritures_libres` (EL2) EST-ELLE EN BASE ? Oui depuis le 23/11/2026 (250, collée ;
 *  supabase/schema/20261122150000_ecritures_libres.sql), le drapeau levé le même jour. Sa table est au plan de
 *  sauvegarde PRÉVU depuis EL8 (22/11/2026), avec son bloc de l'essai de restauration (supabase/essais/restauration.sql, que
 *  restaurationEssai.test.ts confronte au plan prévu du code) et celui de supabase/essais/rls.sql (LI) : derrière ce drapeau
 *  (`auPlanDesEcrituresLibres`, `auGrapheDesEcrituresLibres`, lib/sauvegarde.ts), juste après `piece_textes_ocr` — avant le
 *  brouillon qui la cite, hors du bloc des pièces hors de France, de la caisse et du brouillon ; sa colonne `ecriture_libre_id`
 *  au graphe de même. Il se lève avec la migration collée et son fichier rangé dans supabase/schema/ (EL8), la suite entière
 *  jouée d'abord en simulation — elle l'a été le 22/11/2026, et passe dans les deux états. */
export const ECRITURES_LIBRES_PREVUES: boolean = true

/** La table de la migration, au plan de sauvegarde derrière le drapeau. */
export const TABLES_DES_ECRITURES_LIBRES = ['ecritures_libres'] as const

export type ModeComptableDeLEcriture = 'tresorerie' | 'engagement'
export type SensDUneLigne = 'debit' | 'credit'

/** Une ligne saisie. `compte` est déjà lu (`lireCompteSaisi`, lib/compteDeBilan.ts : six à dix chiffres) ; `centimes`, un entier
 *  positif ; `poste2035`, en trésorerie et sur une ligne de classe 6 ou 7 seulement, le poste de la 2035 sous lequel elle
 *  compte, ou nul : « hors de la 2035 » (EL-Q2 (A)) ; `compteLib`, le libellé d'un compte que l'application ne nomme pas. */
export interface LigneDEcritureLibre {
  compte: string
  sens: SensDUneLigne
  centimes: number
  poste2035: string | null
  compteLib: string | null
}

/** La saisie : une date (AAAA-MM-JJ), un libellé (qui part au FEC), un motif (qui n'y part jamais), les lignes, et l'extourne
 *  au 1er janvier qui suit une écriture du 31 décembre (proposée devant une charge ou un produit rattaché, jamais exigée). */
export interface SaisieDEcritureLibre {
  date: string
  libelle: string
  motif: string
  lignes: readonly LigneDEcritureLibre[]
  avecExtourne: boolean
}

/** Ce que l'écran lit avant de juger : le mode du dossier, sa frontière de validation (le 31 décembre du dernier exercice
 *  validé, ou nulle), son ouverture (la date de ses à-nouveaux, ou nulle) et le jour de Paris. */
export interface ContexteDEcritureLibre {
  mode: ModeComptableDeLEcriture
  frontiere: string | null
  ouverture: string | null
  aujourdhui: string
}

/** Un refus, dit avant le clic ; `code` est celui que la base lève : 22023 la saisie, 23514 l'exercice figé. Dans une liste,
 *  l'ordre est celui des contrôles de la fonction : le premier est celui que la base dirait. `ligne` : le rang (0, 1…) de la
 *  ligne qu'il vise, s'il en vise une. */
export interface RefusDEcritureLibre {
  cle: string
  code: '22023' | '23514'
  message: string
  ligne?: number
}

/** Un avertissement : il ne refuse rien, se dit sous la ligne avant le clic et se répète dans la confirmation (§ 3.4). */
export interface AvertissementDEcritureLibre {
  cle: string
  message: string
  ligne?: number
}

/** Les écritures que la base recompose et compare : la constatation à sa date, et l'extourne au 1er janvier suivant. */
export interface LigneProposee {
  compte: string
  sens: SensDUneLigne
  centimes: number
}
export interface EcritureLibreProposee {
  date: string
  journal: 'OD'
  libelle: string
  lignes: LigneProposee[]
}

// ── Les comptes (§ 3.4) ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Refusés (EL-Q4 (A)) : la banque et la caisse — l'argent du dossier se prouve par le relevé et par les opérations de caisse,
 *  il ne s'invente pas par une écriture — et le résultat, qui se calcule. Toute banque du plan (le rôle `banque`, le 512 de
 *  chaque compte bancaire) est sous le 512, toute caisse sous le 53 (leurs racines au catalogue). */
export const RACINES_DE_LA_BANQUE = ['512'] as const
export const RACINES_DE_LA_CAISSE = ['53'] as const
export const RACINES_DU_RESULTAT = ['120', '129'] as const

/** Les comptes de rattachement d'une charge ou d'un produit à l'exercice (PCG, art. 1214-40, 1214-46, 1214-48 ; les listes de
 *  l'inventaire, lib/inventaire.ts) : une ligne de classe 6 ou 7 en face d'eux, en trésorerie, est une charge ou un produit
 *  RATTACHÉ, que la 2035 ne compte pas l'année de l'écriture (CGI, art. 93 ; BOI-BNC-BASE-40-10 § 260). En trésorerie le
 *  dirigeant est toujours l'exploitant (108) : le 467 et le 468 n'y portent pas son compte. */
export const RACINES_DE_RATTACHEMENT = [
  '408', '418', '4282', '4286', '4382', '4386', '439', '44812', '4482', '1688', '518', '467', '468', '486', '487',
] as const

/** Les postes de la 2035 qu'une ligne de classe 7 ou 6 peut porter : la liste fermée de la base
 *  (`ecritures_brouillon_champs_bnc_du_fec`, supabase/schema/20261102080337_champs_bnc_du_fec.sql), que la fonction de la base
 *  recopie ; ecritureLibreEnBase.test.ts confronte les trois textes. */
export const POSTES_DES_RECETTES: readonly string[] = [
  'Recettes', 'Recettes encaissées y compris les remboursements de frais', 'Produits financiers', 'Gains divers',
  'Indemnités journalières',
]
export const POSTES_DES_DEPENSES: readonly string[] = [
  'Débours payés pour le compte des clients', 'Débours', 'Honoraires rétrocédés', 'Rétrocessions',
  'Achats', 'Salaires nets et avantages en nature', 'Salaires', 'Charges sociales sur salaires',
  'Taxe sur la valeur ajoutée', 'TVA', 'Contribution économique territoriale', 'CET', 'Autres impôts',
  'Impôts et taxes', 'Contribution sociale généralisée déductible', 'CSG déductible',
  'Loyer et charges locatives', 'Loyers et charges locatives', 'Location de matériel et de mobilier',
  'Redevances de collaboration',
  'Entretien et réparations', 'Personnel intérimaire', 'Petit outillage', 'Chauffage, eau, gaz, électricité',
  'Honoraires ne constituant pas des rétrocessions', 'Primes d\'assurance', 'Primes d\'assurances', 'Assurance',
  'Frais de véhicules', 'Autres frais de déplacements', 'Frais de déplacement', 'Frais de déplacements',
  'Indemnités kilométriques', 'Cotisations sociales personnelles', 'Charges sociales personnelles',
  'Cotisations facultatives Madelin', 'Plan d\'épargne retraite',
  'Frais de réception, de représentation et de congrès', 'Frais de réception, de représentation',
  'Fournitures de bureau, frais de documentation, de correspondance et de téléphone', 'Fournitures de bureau',
  'Frais d\'actes et de contentieux', 'Cotisations syndicales et professionnelles',
  'Autres frais divers de gestion', 'Frais divers de gestion', 'Divers', 'Frais financiers', 'Pertes diverses',
  'Amortissements', 'Dotation aux amortissements',
]

/** Les bornes que la base tient aussi : la ligne, l'écriture, le texte. */
export const LIGNES_AU_PLUS = 200
export const LIBELLE_AU_PLUS = 200
export const MOTIF_AU_PLUS = 2000

/** Les mots des refus, que la fonction de la base redit au caractère près, dans cet ordre (ecritureLibreEnBase.test.ts). */
export const MOTS_DES_REFUS = {
  dateIllisible: 'La date de l’écriture se lit en une date civile, entre 2000 et 2100.',
  dateFigee: 'Cette date est dans un exercice validé : une écriture libre ne s’y passe plus.',
  avantLOuverture: 'Cette date précède l’ouverture du dossier dans l’application : l’écriture n’y a pas de place.',
  dateAVenir: 'Une écriture libre se date au plus tard du 31 décembre de l’année en cours.',
  extourneIllisible: 'L’extourne se demande ou ne se demande pas : vrai ou faux.',
  extourneHorsDuTrenteEtUn: 'Seule une écriture du 31 décembre reçoit son extourne au 1er janvier suivant.',
  libelle: 'Le libellé de l’écriture tient en 1 à 200 caractères, sur une ligne : il part au FEC.',
  motif: 'Le motif de l’écriture tient en 1 à 2 000 caractères : il dit pourquoi l’écriture est passée.',
  nombreDeLignes: 'Une écriture libre porte de 2 à 200 lignes.',
  compte: 'Ce numéro de compte n’a pas la forme d’un compte de l’application : six à dix chiffres, d’une classe 1 à 7.',
  banque: 'Le 512 est le compte du relevé : un mouvement manquant s’importe avec son relevé, il ne s’écrit pas à la main.',
  caisse: 'La caisse se rejoue depuis ses opérations : une recette ou une dépense en espèces se saisit dans Caisse.',
  resultat: 'Le résultat (120, 129) se calcule : une écriture libre ne le passe pas.',
  sens: 'Une ligne est au débit ou au crédit.',
  montant: 'Le montant d’une ligne est un nombre de centimes entier et positif.',
  posteEnEngagement: 'En comptabilité d’engagement, une écriture libre ne porte aucun poste de la 2035.',
  posteHorsDuResultat: 'Seule une ligne de charge ou de produit (classe 6 ou 7) porte un poste de la 2035.',
  posteInconnu: 'Ce poste n’est pas un poste de la 2035 pour une ligne de cette classe.',
  libelleDuCompte: 'Le libellé d’un compte tient en 1 à 200 caractères, sur une ligne.',
  deuxLibelles: 'Un même compte porte deux libellés dans cette écriture.',
  desequilibre: 'L’écriture n’est pas équilibrée : au moins un débit et un crédit, la somme des débits égale à celle des crédits, au centime.',
  rattacheeComptee: 'En trésorerie, une charge ou un produit rattaché ne compte pas dans la 2035 de l’année de l’écriture : ses '
    + 'lignes de charge ou de produit se passent hors de la 2035.',
} as const

/** Les mots que la base seule dit (la pièce, la version, la recomposition), et ceux de ses deux gardes. */
export const MOTS_DE_LA_BASE = {
  acces: 'Accès refusé à ce dossier.',
  accesALEcriture: 'Accès refusé à cette écriture libre.',
  piece: 'La pièce citée n’est pas une pièce de ce dossier.',
  version: 'Cette écriture libre a changé depuis sa lecture : relire les écritures avant de l’écrire.',
  nouvelle: 'Une écriture libre nouvelle ne porte pas de version lue.',
  ecritures: 'Les écritures proposées ne sont pas celles de l’écriture libre : les recomposer.',
  garde: 'Une écriture libre ne s’écrit que par enregistrer_ecriture_libre et retirer_ecriture_libre.',
  gardeDesLignes: 'Une ligne d’une écriture libre ne change que par son écriture.',
} as const

/** L'avertissement fixe du libellé (EL-Q7 (A)) : la base ne sait pas reconnaître un nom. */
export const AVERTISSEMENT_DU_LIBELLE =
  'Ce libellé part au FEC et à la piste d’audit : il ne porte jamais le nom d’un patient, ni celui d’un client qui n’est pas une '
  + 'entreprise. Le motif, lui, reste au cabinet.'

/** Les mots des avertissements (EL-Q5 (A), EL-Q6 (A), EL-Q3 (A) et EXP58-Q3 (A)) : ils disent ce qui ne suivra pas. */
export const MOTS_DES_AVERTISSEMENTS = {
  tva: 'La CA3 se calcule des sources et ne verra pas cette ligne ; le compte ne se soldera plus par la liquidation. Une '
    + 'correction de TVA se déclare sur la CA3 de la période où elle se constate.',
  tiers: 'Le lettrage se déduit du rapprochement : cette ligne restera non lettrée.',
  immobilisation: 'Le registre des immobilisations et ses dotations ne verront pas cette ligne : le bilan et le registre divergeront.',
  emprunt: 'L’échéancier de l’emprunt ne verra pas cette ligne.',
  passage: 'Un compte de passage se solde avant la validation : la révision dira son solde.',
  inventaire: 'Une régularisation d’inventaire a son onglet : elle s’y compose avec son extourne.',
  horsDeLa2035: 'Hors de la 2035 : la 2035 ne compte pas cette ligne. C’est un écart déclaré entre la 2035 et les écritures, '
    + 'dit avant la validation, qui ne la retient pas.',
  chargeRattachee: 'En trésorerie, une dépense compte dans la 2035 de l’année où elle est payée, une recette dans celle où elle '
    + 'est encaissée (CGI, art. 93 ; BOI-BNC-BASE-40-10 § 260) : cette charge ou ce produit rattaché change les comptes, pas la '
    + '2035. Proposé hors de la 2035, avec son extourne au 1er janvier.',
} as const

// ── Les petites règles ──────────────────────────────────────────────────────────────────────────────────────────────────

const sousLaRacine = (compte: string, racines: readonly string[]) => racines.some((r) => compte.startsWith(r))
// Les caractères de contrôle (C0, DEL, C1) : la base les refuse par la même classe (`chr(1)` à `chr(31)`, `chr(127)` à `chr(159)`),
// composée ici des mêmes points de code plutôt qu'écrite en échappements.
const CONTROLE = new RegExp(`[${String.fromCodePoint(1)}-${String.fromCodePoint(31)}${String.fromCodePoint(127)}-${String.fromCodePoint(159)}]`)
// Une longueur en points de code, comme `char_length` la compte en base (un émoji est UN caractère, pas deux).
const longueur = (texte: string) => [...texte].length

/** La classe d'une ligne de résultat : 6 (une dépense) ou 7 (une recette), nulle pour un compte de bilan. */
export function classeDeResultat(compte: string): 6 | 7 | null {
  return compte.startsWith('6') ? 6 : compte.startsWith('7') ? 7 : null
}

/** Le poste convient-il à la classe du compte ? La liste fermée de la base, au caractère près. */
export function posteDeLaClasse(compte: string, poste: string): boolean {
  const classe = classeDeResultat(compte)
  return classe === 7 ? POSTES_DES_RECETTES.includes(poste) : classe === 6 ? POSTES_DES_DEPENSES.includes(poste) : false
}

/** Une date civile AAAA-MM-JJ, entre 2000 et 2100, qui existe ; nulle sinon. */
function dateLue(date: string): { annee: number; mois: number; jour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const [annee, mois, jour] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (annee < 2000 || annee > 2100) return null
  const d = new Date(Date.UTC(annee, mois - 1, jour))
  return d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour ? { annee, mois, jour } : null
}

/** La ligne compte-t-elle dans la 2035 ? En trésorerie, une ligne de classe 6 ou 7 qui porte un poste. */
const comptee = (l: LigneDEcritureLibre, mode: ModeComptableDeLEcriture) =>
  mode === 'tresorerie' && classeDeResultat(l.compte) != null && l.poste2035 != null

/** Une charge ou un produit RATTACHÉ (§ 5.1) : en trésorerie, une ligne de classe 6 ou 7 en face d'un compte de rattachement. */
export function estRattachee(lignes: readonly LigneDEcritureLibre[], mode: ModeComptableDeLEcriture): boolean {
  return mode === 'tresorerie' && lignes.some((l) => classeDeResultat(l.compte) != null)
    && lignes.some((l) => sousLaRacine(l.compte, RACINES_DE_RATTACHEMENT))
}

/** Rattachée ET comptée : ce que la base refuse depuis EXP58-Q3 (A) — la 2035 de l'année ne compte pas une dépense payée, ni
 *  une recette encaissée, l'année suivante (CGI, art. 93 ; BOI-BNC-BASE-40-10 § 260). */
export function estRattacheeComptee(lignes: readonly LigneDEcritureLibre[], mode: ModeComptableDeLEcriture): boolean {
  return estRattachee(lignes, mode) && lignes.some((l) => comptee(l, mode))
}

/** Le 1er janvier qui suit une date du 31 décembre. */
function lendemainDuTrenteEtUn(date: string): string {
  return `${Number(date.slice(0, 4)) + 1}-01-01`
}

// ── Le jugement ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Les refus de la saisie, dans l'ordre des contrôles de `enregistrer_ecriture_libre` ; vide : la base l'acceptera, sauf ce
 *  qu'elle seule dit (la pièce citée, la version lue, les écritures proposées). */
export function refusDeLEcritureLibre(saisie: SaisieDEcritureLibre, contexte: ContexteDEcritureLibre): RefusDEcritureLibre[] {
  const M = MOTS_DES_REFUS
  const refus: RefusDEcritureLibre[] = []
  const r = (cle: keyof typeof MOTS_DES_REFUS, ligne?: number, code: RefusDEcritureLibre['code'] = '22023') =>
    refus.push(ligne === undefined ? { cle, code, message: M[cle] } : { cle, code, message: M[cle], ligne })

  // 1. La date : lisible, hors d'un exercice validé, pas avant l'ouverture, au plus tard le 31 décembre de l'année en cours.
  const date = dateLue(saisie.date)
  if (!date) r('dateIllisible')
  else {
    if (contexte.frontiere != null && saisie.date <= contexte.frontiere) r('dateFigee', undefined, '23514')
    if (contexte.ouverture != null && saisie.date < contexte.ouverture) r('avantLOuverture')
    if (date.annee > Number(contexte.aujourdhui.slice(0, 4))) r('dateAVenir')
  }
  // 2. L'extourne : au 1er janvier qui suit une écriture du 31 décembre seulement.
  if (typeof saisie.avecExtourne !== 'boolean') r('extourneIllisible')
  else if (saisie.avecExtourne && !(date && date.mois === 12 && date.jour === 31)) r('extourneHorsDuTrenteEtUn')
  // 3. Le libellé, puis le motif.
  const libelle = saisie.libelle.trim()
  if (longueur(libelle) < 1 || longueur(libelle) > LIBELLE_AU_PLUS || CONTROLE.test(libelle)) r('libelle')
  const motif = saisie.motif.trim()
  if (longueur(motif) < 1 || longueur(motif) > MOTIF_AU_PLUS) r('motif')
  // 4. Les lignes : leur nombre, puis chacune, dans l'ordre.
  if (saisie.lignes.length < 2 || saisie.lignes.length > LIGNES_AU_PLUS) r('nombreDeLignes')
  saisie.lignes.forEach((l, i) => {
    if (!/^[1-7][0-9]{5,9}$/.test(l.compte)) r('compte', i)
    else if (sousLaRacine(l.compte, RACINES_DE_LA_BANQUE)) r('banque', i)
    else if (sousLaRacine(l.compte, RACINES_DE_LA_CAISSE)) r('caisse', i)
    else if (sousLaRacine(l.compte, RACINES_DU_RESULTAT)) r('resultat', i)
    if (l.sens !== 'debit' && l.sens !== 'credit') r('sens', i)
    if (!Number.isSafeInteger(l.centimes) || l.centimes <= 0) r('montant', i)
    if (l.poste2035 != null) {
      if (contexte.mode !== 'tresorerie') r('posteEnEngagement', i)
      else if (classeDeResultat(l.compte) == null) r('posteHorsDuResultat', i)
      else if (!posteDeLaClasse(l.compte, l.poste2035)) r('posteInconnu', i)
    }
    if (l.compteLib != null) {
      const lib = l.compteLib.trim()
      if (longueur(lib) < 1 || longueur(lib) > LIBELLE_AU_PLUS || CONTROLE.test(lib)) r('libelleDuCompte', i)
    }
  })
  // 5. Un compte, un libellé.
  const libelles = new Map<string, Set<string>>()
  for (const l of saisie.lignes) {
    const s = libelles.get(l.compte) ?? new Set<string>()
    s.add(l.compteLib?.trim() ?? '')
    libelles.set(l.compte, s)
  }
  if ([...libelles.values()].some((s) => s.size > 1)) r('deuxLibelles')
  // 6. L'équilibre, au centime, sur des montants lisibles.
  const lisibles = saisie.lignes.every((l) => Number.isSafeInteger(l.centimes) && l.centimes > 0)
  const debit = lisibles ? saisie.lignes.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.centimes, 0) : NaN
  const credit = lisibles ? saisie.lignes.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.centimes, 0) : NaN
  if (lisibles && (debit === 0 || credit === 0 || debit !== credit || !Number.isSafeInteger(debit))) r('desequilibre')
  // 7. La règle de la trésorerie (EXP58-Q3 (A)) : une charge ou un produit rattaché ne compte pas dans la 2035 ; aucune
  //    désignation ne le permet plus.
  if (estRattacheeComptee(saisie.lignes, contexte.mode)) r('rattacheeComptee')
  return refus
}

/** Les avertissements, ligne par ligne puis pour l'écriture ; ils ne refusent rien (EL-Q5 (A), EL-Q6 (A), EL-Q3 (A)). La règle
 *  de la trésorerie se dit devant toute charge ou tout produit rattaché, compté ou non : compté, le refus la redit. */
export function avertissementsDeLEcritureLibre(saisie: SaisieDEcritureLibre, mode: ModeComptableDeLEcriture): AvertissementDEcritureLibre[] {
  const A = MOTS_DES_AVERTISSEMENTS
  const avis: AvertissementDEcritureLibre[] = []
  const a = (cle: keyof typeof MOTS_DES_AVERTISSEMENTS, ligne?: number) =>
    avis.push(ligne === undefined ? { cle, message: A[cle] } : { cle, message: A[cle], ligne })
  saisie.lignes.forEach((l, i) => {
    const c = l.compte
    if (c.startsWith('445')) a('tva', i)
    if (c.startsWith('40') || c.startsWith('41')) a('tiers', i)
    if (c.startsWith('2')) a('immobilisation', i)
    if (c.startsWith('164')) a('emprunt', i)
    if (c.startsWith('47') || c.startsWith('58')) a('passage', i)
    if (mode === 'engagement' && sousLaRacine(c, ['486', '487', '408', '418', '44586', '44587', '151', '491'])) a('inventaire', i)
    if (mode === 'tresorerie' && classeDeResultat(c) != null && l.poste2035 == null) a('horsDeLa2035', i)
  })
  if (estRattachee(saisie.lignes, mode)) a('chargeRattachee')
  return avis
}

/** Ce que l'écran propose devant une charge ou un produit rattaché (EL-Q3 (A)) : hors de la 2035, avec son extourne quand
 *  l'écriture est du 31 décembre. Rien ne change sur une autre écriture. */
export function propositionDeLaRegle(saisie: SaisieDEcritureLibre, mode: ModeComptableDeLEcriture): SaisieDEcritureLibre {
  if (!estRattachee(saisie.lignes, mode)) return saisie
  return {
    ...saisie,
    lignes: saisie.lignes.map((l) => (classeDeResultat(l.compte) != null ? { ...l, poste2035: null } : l)),
    avecExtourne: /-12-31$/.test(saisie.date),
  }
}

/** Le poste proposé pour un compte de résultat (§ 5.1) : celui des catégories qui portent ce compte, s'il est unique et dans la
 *  liste de sa classe ; nul sinon — le cabinet le choisit, ou laisse « hors de la 2035 ». */
export function posteProposeDuCompte(compte: string,
  categories: readonly { compte_comptable: string | null; poste_2035: string | null }[]): string | null {
  const postes = new Set(categories.filter((c) => c.compte_comptable === compte && c.poste_2035 != null).map((c) => c.poste_2035 as string))
  if (postes.size !== 1) return null
  const [poste] = [...postes]
  return posteDeLaClasse(compte, poste) ? poste : null
}

/** Les écritures à proposer à la base : la constatation à sa date, sous le libellé rogné, et, si elle est demandée,
 *  l'extourne au 1er janvier suivant, chaque ligne au sens inverse, sous « Extourne — » et le libellé. Une saisie que le
 *  module refuse ne se compose pas. */
export function composerEcrituresLibres(saisie: SaisieDEcritureLibre, contexte: ContexteDEcritureLibre): EcritureLibreProposee[] | null {
  if (refusDeLEcritureLibre(saisie, contexte).length > 0) return null
  const libelle = saisie.libelle.trim()
  const lignes = saisie.lignes.map((l) => ({ compte: l.compte, sens: l.sens, centimes: l.centimes }))
  const constatation: EcritureLibreProposee = { date: saisie.date, journal: 'OD', libelle, lignes }
  if (!saisie.avecExtourne) return [constatation]
  return [constatation, {
    date: lendemainDuTrenteEtUn(saisie.date), journal: 'OD', libelle: `Extourne — ${libelle}`,
    lignes: lignes.map((l) => ({ ...l, sens: l.sens === 'debit' ? 'credit' : 'debit' })),
  }]
}

/** L'écriture telle que la fonction de la base la reçoit (`p_ecriture`) : les noms de ses colonnes, le libellé et le motif
 *  rognés comme elle les rogne, chaque libellé de compte aussi. */
export function ecritureLibrePourLaBase(saisie: SaisieDEcritureLibre, id: string | null, pieceCiteeId: string | null) {
  return {
    id, date: saisie.date, libelle: saisie.libelle.trim(), motif: saisie.motif.trim(), piece_citee_id: pieceCiteeId,
    avec_extourne: saisie.avecExtourne,
    lignes: saisie.lignes.map((l) => ({
      compte: l.compte, sens: l.sens, centimes: l.centimes, poste_2035: l.poste2035, compte_lib: l.compteLib?.trim() ?? null,
    })),
  }
}

/** L'écart déclaré d'une écriture (EL-Q6 (A)) : en trésorerie, ses lignes de résultat hors de la 2035, en centimes signés —
 *  une dépense au débit, une recette au crédit, comptées en positif, comme la 2035 les compterait. */
export function ecartDeclare(saisie: SaisieDEcritureLibre, mode: ModeComptableDeLEcriture): { depenses: number; recettes: number } {
  let depenses = 0
  let recettes = 0
  if (mode !== 'tresorerie') return { depenses, recettes }
  for (const l of saisie.lignes) {
    if (l.poste2035 != null) continue
    const classe = classeDeResultat(l.compte)
    if (classe === 6) depenses += l.sens === 'debit' ? l.centimes : -l.centimes
    if (classe === 7) recettes += l.sens === 'credit' ? l.centimes : -l.centimes
  }
  return { depenses, recettes }
}
