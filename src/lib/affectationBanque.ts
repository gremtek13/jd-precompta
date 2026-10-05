import { libelleExploitable } from './appariementBanque'
import { COMPTE_BANQUE, COMPTE_TVA_COLLECTEE } from './comptes'
import { REFUS_REGLE_EN_GROUPE } from './reglementGroupe'
import { horsTaxeEtTva, horsTaxeSigne, tauxApplicable, tauxPrisEnCharge, tauxRequis } from './tvaDuReleve'
import type { Categorie, EcritureBrouillon, LigneBancaire } from './types'
import { estFigee } from './validationExercice'

// UN MOUVEMENT BANCAIRE SANS JUSTIFICATIF S'AFFECTE À UNE CATÉGORIE (ligne 26.6 de la feuille de
// route, étape a).
//
// Jusqu'ici, seul un mouvement rapproché d'une PIÈCE produisait une écriture. Tout le reste — les
// frais bancaires, les encaissements de l'Assurance maladie et des mutuelles, les remboursements —
// n'était écrit nulle part : ni dans le brouillon, ni dans le FEC, ni dans la 2035. Pour un
// infirmier, c'est l'essentiel de ses recettes : il ne transmet pas ses bordereaux (secret médical,
// décision du cabinet du 24/09/2026), ses honoraires arrivent par virement, et la 2035 ne comptait
// que les justificatifs de recette. Une comptabilité tenue dans l'application doit porter CHAQUE
// mouvement du relevé ; c'est la condition pour que son FEC soit celui du dossier.
//
// CE QUI S'ÉCRIT : le compte de la catégorie face à la banque, au montant, à la date et dans le sens
// du mouvement — et, pour une recette d'un dossier assujetti, la TVA collectée à son taux, la recette au
// hors taxe (lib/tvaDuReleve.ts). L'écriture est composée ICI (testée), et la fonction SQL
// `affecter_mouvement_bancaire` la vérifie contre le mouvement, la catégorie et le taux puis l'écrit AVEC
// l'affectation, dans une seule transaction : un mouvement affecté sans écriture compterait dans la 2035
// et pas dans le FEC, une écriture sans affectation l'inverse (voir `supabase/essais/affectation.sql`).

export type NatureCompte = 'recette' | 'depense'

// LA NATURE SE LIT AU COMPTE, et c'est un invariant du plan comptable, pas un libellé : classe 7, un
// produit ; classe 6, une charge. Un compte de bilan (108, 164, 445…) n'a pas de nature ici — il ne
// passe pas par le résultat, et l'affectation le refuse tant qu'aucune étape ne le prend en charge.
export function natureDuCompte(compte: string | null | undefined): NatureCompte | null {
  if (!compte) return null
  if (/^7\d{2}/.test(compte)) return 'recette'
  if (/^6\d{2}/.test(compte)) return 'depense'
  return null
}

/** Ce que le relevé justifie d'un mouvement se lit sur ces colonnes : le reste de la ligne ne décide de rien. */
export type MouvementBancaire = Pick<
  LigneBancaire,
  'id' | 'date' | 'libelle' | 'libelle_brut' | 'montant' | 'statut' | 'piece_id' | 'cotisation_id' | 'categorie_id'
  | 'taux_tva' | 'prelevement_personnel' | 'source_fichier' | 'emprunt_id' | 'emprunt_echeance' | 'emprunt_interets' | 'emprunt_assurance'
  | 'ventilee' | 'reglement_groupe'
>

// Pourquoi ce mouvement ne peut pas être affecté à cette catégorie, à ce taux, dit AVANT d'écrire. La
// base refait les mêmes refus, dans le même ordre (`affecter_mouvement_bancaire`) : l'écran les dit pour
// qu'on ne clique pas pour rien, la base pour qu'aucun chemin ne les contourne.
//
// LE TAUX EST UN PARAMÈTRE OBLIGATOIRE, sans valeur par défaut : nul pour une catégorie sans TVA, le taux
// choisi pour une recette d'un dossier assujetti. Un appelant qui l'oublierait enverrait à la base une
// recette sans taux, qu'elle refuse — mieux vaut que le compilateur le lui dise.
export function refusAffectation(
  ligne: MouvementBancaire,
  categorie: Pick<Categorie, 'libelle' | 'compte_comptable'>,
  assujettiTva: boolean,
  taux: number | null,
): string | null {
  if (ligne.reglement_groupe) return REFUS_REGLE_EN_GROUPE
  if (ligne.piece_id || ligne.cotisation_id || ligne.emprunt_id || ligne.ventilee || ligne.prelevement_personnel) {
    return 'Ce mouvement est rapproché d’une pièce, d’une cotisation ou d’un emprunt, ventilé sur plusieurs comptes ou classé en virement personnel : annule d’abord ce classement.'
  }
  const nature = natureDuCompte(categorie.compte_comptable)
  if (!nature) {
    return `La catégorie « ${categorie.libelle} » n’a pas de compte de charge ou de produit (classe 6 ou 7).`
  }
  // UNE RECETTE D'UN DOSSIER ASSUJETTI PORTE DE LA TVA, que le relevé ne dit pas : son taux se choisit
  // (lib/tvaDuReleve.ts). Écrite sans, au TTC en 706, elle compterait la taxe en chiffre d'affaires, et
  // aucune CA3 ne la verrait. Un débit sur une catégorie de recettes en porte aussi : c'est la TVA
  // collectée qu'il diminue.
  if (tauxRequis(assujettiTva, nature) && taux == null) {
    return 'Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».'
  }
  if (!tauxRequis(assujettiTva, nature) && taux != null) {
    return 'Un taux de TVA ne s’applique qu’à une recette d’un dossier assujetti.'
  }
  if (taux != null && !tauxPrisEnCharge(taux)) return 'Ce taux de TVA n’est pas pris en charge.'
  if (ligne.montant === 0) return 'Un mouvement de zéro euro n’a rien à écrire.'
  return null
}

// UN ENCAISSEMENT SUR UNE CATÉGORIE DE DÉPENSE LA DIMINUE — c'est un remboursement, et c'est légitime.
// Mais c'est aussi l'erreur la plus facile : « Honoraires » (622600) est une CHARGE, les honoraires
// qu'on paie à un confrère ; les honoraires qu'on encaisse sont des recettes (706000). Un virement de
// l'Assurance maladie rangé en « Honoraires » diminuerait les dépenses au lieu d'augmenter les
// recettes : le résultat serait juste, la 2035 fausse sur deux lignes. L'écran le dit avant le clic.
export function sensInhabituel(ligne: Pick<LigneBancaire, 'montant'>, nature: NatureCompte): boolean {
  return (ligne.montant > 0 && nature === 'depense') || (ligne.montant < 0 && nature === 'recette')
}

export interface LigneEcritureMouvement {
  compte: string
  sens: 'debit' | 'credit'
  montant: number
  libelle: string
}

// L'écriture d'un mouvement affecté : le compte de la catégorie face à la banque. LE SENS VIENT DU
// SIGNE DU MOUVEMENT, jamais de la nature de la catégorie — la règle de la contrepartie banque d'une
// pièce (voir contrepartieBanque.ts) : une entrée d'argent augmente la banque au débit, une sortie la
// diminue au crédit, et la catégorie prend le sens inverse. Un remboursement reçu sur une charge la
// crédite donc, et la diminue, sans cas à part.
//
// AVEC UN TAUX, la catégorie prend le hors taxe et la TVA collectée (445710) le reste, du même côté
// qu'elle : trois lignes, la banque au TTC. Sans taux — ou à zéro —, deux lignes, comme toujours. Le
// taux est celui qui s'APPLIQUE (`tauxApplicable`), pas forcément celui qu'on a gardé.
export function ecritureDuMouvement(
  ligne: MouvementBancaire,
  compteCategorie: string,
  taux: number | null,
): LigneEcritureMouvement[] {
  const { ht, tva } = horsTaxeEtTva(ligne.montant, taux)
  const entree = ligne.montant >= 0
  const sensCompte = entree ? 'credit' : 'debit'
  // Le libellé complet quand l'import n'a gardé que le générique « Mouvement bancaire » : c'est ce
  // qu'un vérificateur lira dans le FEC pour retrouver la ligne du relevé.
  const libelle = libelleExploitable(ligne) || ligne.libelle
  return [
    { compte: compteCategorie, sens: sensCompte, montant: ht, libelle },
    ...(tva > 0 ? [{ compte: COMPTE_TVA_COLLECTEE, sens: sensCompte, montant: tva, libelle } as const] : []),
    { compte: COMPTE_BANQUE, sens: entree ? 'debit' : 'credit', montant: Math.abs(ligne.montant), libelle },
  ]
}

export interface MouvementAffecte {
  ligne: MouvementBancaire
  categorie: Categorie
  // Nulle quand le compte de la catégorie n'est plus un compte de résultat : il a changé depuis
  // l'affectation, que la base aurait refusée sinon. Le mouvement ne compte alors dans aucun poste,
  // et son écriture est à reprendre (voir `mouvementsAffectesDesynchronises`).
  nature: NatureCompte | null
  // Le taux de TVA qui s'applique AUJOURD'HUI (`tauxApplicable`) : celui gardé sur le mouvement, pour une
  // recette d'un dossier assujetti ; nul ailleurs. Nul AUSSI pour une recette d'un dossier assujetti
  // affectée sans taux — avant qu'il le devienne —, que `recettesAffecteesSansTaux` montre.
  taux: number | null
  // Ce que le mouvement ajoute à son poste, positif quand il l'augmente : une recette encaissée ou
  // une dépense payée, négatif pour un remboursement dans l'un ou l'autre sens — au HORS TAXE pour une
  // recette taxée, la TVA collectée n'étant pas une recette. Sans objet quand la nature est nulle.
  montantPoste: number
}

// Les mouvements AFFECTÉS : rapprochés et portant une catégorie. Le statut est relu ici plutôt que
// supposé de l'appelant, comme dans `paiementsParPiece` — et la base garantit qu'une catégorie ne vit
// que sur un mouvement rapproché. Une catégorie absente de la liste fournie (une lecture partielle,
// que l'écran signale déjà) écarte le mouvement : on ne compte pas ce qu'on ne sait pas ranger.
//
// L'ASSUJETTISSEMENT EST UN PARAMÈTRE OBLIGATOIRE : c'est lui qui décide si le taux gardé s'applique,
// donc si une recette compte au hors taxe ou au TTC. Un appelant qui l'oublierait compterait la TVA
// collectée dans les recettes de la 2035.
export function mouvementsAffectes(
  lignes: readonly MouvementBancaire[],
  categories: readonly Categorie[],
  assujettiTva: boolean,
): MouvementAffecte[] {
  const parId = new Map(categories.map((c) => [c.id, c]))
  const affectes: MouvementAffecte[] = []
  for (const ligne of lignes) {
    if (ligne.statut !== 'rapprochee' || !ligne.categorie_id) continue
    const categorie = parId.get(ligne.categorie_id)
    if (!categorie) continue
    const nature = natureDuCompte(categorie.compte_comptable)
    const taux = tauxApplicable(assujettiTva, nature, ligne.taux_tva)
    const horsTaxe = horsTaxeSigne(ligne.montant, taux)
    affectes.push({
      ligne,
      categorie,
      nature,
      taux,
      montantPoste: nature === 'depense' ? -horsTaxe : horsTaxe,
    })
  }
  return affectes
}

// UN MOUVEMENT JUSTIFIÉ PAR LE RELEVÉ : son écriture n'a pas de pièce, et c'est légitime — le relevé
// qui le porte en est le justificatif. Cinq cas : affecté à une catégorie (rapproché, portant une
// catégorie), rapproché d'un emprunt dont il est une échéance ou le déblocage (lib/echeanceEmprunt.ts),
// rapproché d'une échéance de cotisation (lib/cotisationRapprochee.ts), ventilé sur plusieurs comptes
// (lib/ventilationBanque.ts), ou classé en virement personnel (lib/virementPersonnel.ts), écrit sur le
// compte du dirigeant. Ce qui dit, pour une écriture sans pièce, si elle est l'écriture d'un mouvement ou
// le reste d'une pièce supprimée (une rupture). Voir lib/pisteAudit.ts et lib/fec.ts.
//
// UN SEUL PRÉDICAT pour le FEC, la piste d'audit, Écritures et la Checklist : l'emprunt, la ventilation
// puis la cotisation se sont ajoutés ICI et nulle part ailleurs — une copie oubliée aurait fait sortir
// leurs écritures du FEC ou crier « sans justificatif » sur une écriture juste, sur l'un des cinq
// seulement, donc sans que les autres le disent.
//
// LU SUR LA LIGNE, SANS LA CATÉGORIE NI LES PARTS, et c'est voulu : la légitimité de l'écriture tient à
// ce que son mouvement est affecté ou ventilé, pas à ce qu'on a pu lire de sa catégorie ou de ses parts.
// Une catégorie absente de la liste chargée ferait sinon crier « écriture sans justificatif » sur une
// écriture juste — l'artefact de filtrage que `rupturesPisteAudit` refuse déjà de prendre pour une
// rupture.
export function mouvementJustifieParLeReleve(
  ligne: Pick<LigneBancaire, 'statut' | 'categorie_id' | 'emprunt_id' | 'cotisation_id' | 'ventilee' | 'prelevement_personnel'>,
): boolean {
  return (ligne.statut === 'rapprochee' && (!!ligne.categorie_id || !!ligne.emprunt_id || !!ligne.cotisation_id || ligne.ventilee))
    || ligne.prelevement_personnel
}

export function idsMouvementsJustifiesParLeReleve(
  lignes: readonly Pick<LigneBancaire, 'id' | 'statut' | 'categorie_id' | 'emprunt_id' | 'cotisation_id' | 'ventilee' | 'prelevement_personnel'>[],
): ReadonlySet<string> {
  return new Set(lignes.filter(mouvementJustifieParLeReleve).map((l) => l.id))
}

// La pièce d'un mouvement affecté est le RELEVÉ qui le porte : c'est ce qu'un vérificateur ouvrira
// pour retrouver la ligne. Son nom quand l'import l'a gardé, sinon ce qu'il est.
export function referenceDuReleve(ligne: Pick<LigneBancaire, 'source_fichier'>): string {
  return ligne.source_fichier?.trim() || 'Relevé bancaire'
}

// LES RECETTES AFFECTÉES SANS TAUX D'UN DOSSIER ASSUJETTI. La base n'en affecte plus une sans son taux
// sur un dossier assujetti ; mais un dossier peut le DEVENIR après coup — le cabinet coche « assujetti »
// dans l'en-tête —, et les encaissements déjà affectés restent alors écrits au TTC en 706 : leur TVA
// collectée n'est dans aucune CA3, et la 2035 compte la taxe comme du chiffre d'affaires. Rien ne les
// réécrit sans qu'on choisisse leur taux : on les montre, et le geste est de les réaffecter en le
// choisissant — ou de rapprocher leur facture à la place.
//
// Sauf un mouvement d'un exercice VALIDÉ (lib/validationExercice.ts) : la base refuse de le réaffecter, et sa TVA
// relève d'un exercice que rien ne rouvre. Un dossier qui devient assujetti APRÈS une validation laisserait sinon
// un point en erreur que rien ne lève. Sans valeur par défaut, comme les autres contrôles du relevé.
export function recettesAffecteesSansTaux(
  affectes: readonly MouvementAffecte[],
  assujettiTva: boolean,
  frontiere: string | null,
): MouvementAffecte[] {
  return assujettiTva
    ? affectes.filter((m) => m.nature === 'recette' && m.taux === null && !estFigee(m.ligne.date, frontiere))
    : []
}

// Tolérance de deux centimes, celle du contrôle des écritures d'une pièce (voir ecritures.ts).
const EPSILON = 0.02

// UN MOUVEMENT AFFECTÉ DONT L'ÉCRITURE N'EST PLUS CELLE QUE SON AFFECTATION PRODUIRAIT : absente, sur
// un autre compte, d'un autre montant, dans un autre sens ou à une autre date. La transaction de
// `affecter_mouvement_bancaire` les écrit ensemble, donc le cas ne vient pas d'un échec à mi-chemin ;
// il vient d'une CATÉGORIE dont le compte a changé depuis — le même défaut que celui d'une pièce
// recatégorisée (voir `analyserEcritures`), et invisible de la même façon, les totaux ne bougeant
// pas —, ou d'un dossier qui a cessé d'être assujetti : sa recette porte encore sa TVA, que le taux
// qui s'applique n'a plus. « Réaffecter » la réécrit. Le libellé n'est pas comparé : il ne change rien
// à ce qui est compté.
//
// Un mouvement d'un exercice VALIDÉ ne se juge plus (lib/validationExercice.ts) : son écriture est validée, la
// base refuse de la réécrire, et le dire « à réaffecter » laisserait un point en erreur que rien ne lève. Sans
// valeur par défaut : un appelant qui oublie la frontière le dirait quand même.
export function mouvementsAffectesDesynchronises(
  ecritures: readonly EcritureBrouillon[],
  affectes: readonly MouvementAffecte[],
  frontiere: string | null,
): MouvementAffecte[] {
  const parLigne = ecrituresSansPieceParMouvement(ecritures)
  return affectes.filter((m) => {
    if (estFigee(m.ligne.date, frontiere)) return false
    if (!m.nature || !m.categorie.compte_comptable) return true
    return !ecritureConforme(parLigne.get(m.ligne.id) ?? [], ecritureDuMouvement(m.ligne, m.categorie.compte_comptable, m.taux), m.ligne.date)
  })
}

// Les écritures SANS PIÈCE, rangées par mouvement : celles d'un mouvement affecté ou d'un virement
// personnel. Les lignes d'une pièce qui désignent le même mouvement (sa contrepartie banque) n'en sont
// pas — elles appartiennent à la pièce.
export function ecrituresSansPieceParMouvement(ecritures: readonly EcritureBrouillon[]): Map<string, EcritureBrouillon[]> {
  const parLigne = new Map<string, EcritureBrouillon[]>()
  for (const e of ecritures) {
    if (e.piece_id || !e.ligne_bancaire_id) continue
    parLigne.set(e.ligne_bancaire_id, [...(parLigne.get(e.ligne_bancaire_id) ?? []), e])
  }
  return parLigne
}

// L'écriture présente est-elle exactement celle attendue — mêmes lignes, dans n'importe quel ordre, à
// la date du mouvement, au centime près ? Une ligne de trop ou de moins suffit à dire non.
export function ecritureConforme(
  presentes: readonly EcritureBrouillon[],
  attendues: readonly LigneEcritureMouvement[],
  date: string,
): boolean {
  if (presentes.length !== attendues.length) return false
  const restantes = [...presentes]
  for (const a of attendues) {
    const i = restantes.findIndex((e) =>
      e.compte === a.compte && e.sens === a.sens && e.date === date && Math.abs(e.montant - a.montant) <= EPSILON)
    if (i < 0) return false
    restantes.splice(i, 1)
  }
  return true
}
