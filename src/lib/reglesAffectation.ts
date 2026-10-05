import {
  candidatsCotisations, candidatsPieces, libelleExploitable, sensCoherent, tiersConfirmeParBanque, type CotisationRapprochable,
} from './appariementBanque'
import { ecritureDuMouvement, natureDuCompte, refusAffectation, type LigneEcritureMouvement } from './affectationBanque'
import { recollerSiglesPointes } from './format'
import { tauxApplicable, tauxRequis } from './tvaDuReleve'
import type { Categorie, LigneBancaire, Piece, RegleAffectationBancaire, SensMouvementBancaire } from './types'

// LES RÈGLES D'AFFECTATION APPRISES PAR LIBELLÉ (ligne 26.6 de la feuille de route, étape a).
//
// Affecter un mouvement sans justificatif se fait un par un depuis sa fiche. Sur le relevé 2025 du
// dossier `test` (données fictives), 372 mouvements ne sont rattachés à rien : un par un, c'est une
// journée. Mais ils se répètent — mesuré le 29/09/2026 sans remonter un seul libellé, 324 d'entre eux
// portent un mot distinctif, et 13 mots en couvrent 80 %. Une règle dit donc : les mouvements de CE
// sens dont le libellé contient CE motif vont dans CETTE catégorie.
//
// UNE RÈGLE PROPOSE, ELLE N'ÉCRIT JAMAIS. Ni à l'import, ni au chargement de l'écran : une
// affectation écrit une écriture comptable, et rien n'est validé automatiquement dans cette
// application. Les mouvements qu'une règle désigne sont montrés, catégorie et règle en face, et c'est
// le clic « Affecter les N » qui les écrit — par `affecter_mouvements_bancaires`, tout ou rien, qui
// refait pour chacun les vérifications de l'affectation à l'unité.
//
// LE SENS FAIT PARTIE DE LA RÈGLE : « amazon » en paiement est un achat ; en encaissement c'est un
// remboursement, que la même règle ne doit pas ranger sans qu'on le voie. Un mouvement de l'autre sens
// reste à traiter : un faux négatif coûte un clic, un faux positif écrit une écriture fausse.
//
// LE TAUX DE TVA AUSSI, pour une recette d'un dossier assujetti (lib/tvaDuReleve.ts) : la règle le garde
// tel qu'il a été choisi à l'affectation qui l'a fait naître, et le lot le transmet. Une règle qui n'en
// dit pas — retenue avant que le dossier devienne assujetti — ne range pas de recette : sa TVA se
// choisirait en masse, sur un seul clic, sans que personne l'ait choisie.

/** Le sens d'un mouvement ; nul pour un mouvement de zéro euro, qui n'a rien à affecter. */
export function sensDuMouvement(ligne: Pick<LigneBancaire, 'montant'>): SensMouvementBancaire | null {
  if (ligne.montant > 0) return 'encaissement'
  if (ligne.montant < 0) return 'decaissement'
  return null
}

// La forme sous laquelle un motif est ENREGISTRÉ et un libellé COMPARÉ : minuscules sans accents, sigles
// pointés recollés (« C.A.R.P.I.M.K.O » devient « carpimko » — sans ça il explose en lettres isolées),
// toute ponctuation ramenée à une espace. La base refuse un motif sous une autre forme (contrainte
// `regles_affectation_bancaire_motif_normalise`) : un motif « CPAM » ne se retrouverait jamais dans un
// libellé normalisé, et la règle ne proposerait rien, en silence.
export function normaliserPourRegle(texte: string): string {
  return recollerSiglesPointes(texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// LE MOTIF SE CHERCHE EN DÉBUT DE MOT, et c'est la règle déjà payée pour le rapprochement (« comparer
// deux noms se fait mot à mot, jamais par sous-chaîne ») : « sfr » ne doit pas trouver « transfert ».
// La fin, elle, reste libre — les relevés coupent (« SWISSLIFE PREVOYAN »), et c'est ce qui permet à un
// début de référence de désigner toute une famille de virements.
export function libelleCorrespond(libelleNormalise: string, motif: string): boolean {
  return motif !== '' && ` ${libelleNormalise}`.includes(` ${motif}`)
}

// Les mots qu'une banque colle devant ses libellés, et les mots sans identité. Un motif fait QUE de ces
// mots désignerait un type d'opération, pas un tiers : « prlv sepa » couvre 139 prélèvements de
// fournisseurs différents sur le relevé du dossier `test`. Le critère d'entrée est celui de
// `cleFournisseur` : si ce mot était retenu, des tiers sans rapport se confondraient sous lui.
const MOTS_SANS_IDENTITE_BANCAIRE = new Set([
  // Codes et vocabulaire d'opération.
  'prlv', 'prelevement', 'sepa', 'sdd', 'sct', 'vir', 'virt', 'virement', 'inst', 'instantane', 'recu', 'recue',
  'emis', 'emise', 'carte', 'paiement', 'achat', 'retrait', 'dab', 'cheque', 'chq', 'remise', 'abon', 'ech',
  'echeance', 'mandat', 'emetteur', 'ref', 'reference', 'rum', 'ics', 'mdt', 'lib', 'libelle', 'motif', 'nom',
  'ordre', 'compte', 'cpt', 'fav', 'faveur', 'date', 'facture', 'mouvement', 'bancaire', 'operation',
  // Formes juridiques et civilités.
  'sarl', 'sas', 'sasu', 'eurl', 'selarl', 'scp', 'scm', 'sci', 'societe', 'entreprise', 'groupe',
  'monsieur', 'madame', 'mme', 'mlle', 'mr',
  // Liaisons de trois lettres ou plus — en dessous, le seuil suffit.
  'des', 'les', 'pour', 'sur', 'avec', 'par', 'aux', 'une', 'dans',
])

// Chiffres seuls : cinq au moins, sinon une date ou un montant les porte par hasard (la base refuse
// aussi un motif de chiffres seuls plus court). Lettres et chiffres mêlés : une référence de créancier
// (« fr12zzz123456 ») identifie bien quelqu'un, à six caractères au moins. Lettres seules : trois,
// pour garder « edf », « sfr », « bnp ».
export function motDistinctif(mot: string): boolean {
  if (/^[0-9]+$/.test(mot)) return mot.length >= 5
  if (/[0-9]/.test(mot)) return mot.length >= 6
  return mot.length >= 3 && !MOTS_SANS_IDENTITE_BANCAIRE.has(mot)
}

/**
 * Pourquoi ce motif ne peut pas devenir une règle, dit AVANT le clic — ou null s'il le peut. Le motif
 * est jugé sous sa forme normalisée, celle qui sera enregistrée.
 */
export function refusMotif(motif: string): string | null {
  const normalise = normaliserPourRegle(motif)
  if (!normalise) return 'Indique un mot du libellé qui désigne ce tiers.'
  if (!normalise.split(' ').some(motDistinctif)) {
    return 'Ce motif ne contient que des mots communs aux relevés (« prlv », « sepa », « vir »…), trop courts, ou moins de cinq chiffres : il désignerait un type d’opération, pas un tiers. Garde un mot qui nomme le tiers, ou le début d’une référence.'
  }
  return null
}

// LE MOTIF PROPOSÉ est modifiable ; c'est un point de départ, jamais une décision. Le premier mot
// distinctif du libellé : « PRLV SEPA TRANSMEDICAL ECH/150625 » donne « transmedical », « VIR SEPA RECU
// /DE CPAM BOUCHES DU RHONE » donne « cpam ».
//
// UNE RÉFÉRENCE SEULE est le cas qui a fait écrire la seconde moitié : sur le relevé du dossier `test`,
// 29 encaissements ne portent qu'une référence de 28 chiffres, toutes différentes, toutes ouvertes par
// les mêmes cinq chiffres. Aucun mot n'est à proposer ; le DÉBUT de la référence, si — le plus long
// début commun à toute sa famille (les références du même sens qui partagent ses cinq premiers
// chiffres). Seule, sans famille, elle ne propose rien : une référence entière ne désigne qu'elle.
const CHIFFRES_MINIMUM_FAMILLE = 5

export function motifPropose(
  ligne: Pick<LigneBancaire, 'id' | 'libelle' | 'libelle_brut' | 'montant'>,
  lignes: readonly Pick<LigneBancaire, 'id' | 'libelle' | 'libelle_brut' | 'montant'>[],
): string | null {
  const mots = normaliserPourRegle(libelleExploitable(ligne)).split(' ').filter(Boolean)
  const mot = mots.find((m) => /^[a-z]+$/.test(m) && motDistinctif(m))
  if (mot) return mot

  const reference = mots.find((m) => /^[0-9]+$/.test(m) && m.length > CHIFFRES_MINIMUM_FAMILLE)
  const sens = sensDuMouvement(ligne)
  if (!reference || !sens) return null
  const debut = reference.slice(0, CHIFFRES_MINIMUM_FAMILLE)
  const famille = lignes
    .filter((l) => l.id !== ligne.id && sensDuMouvement(l) === sens)
    .flatMap((l) => normaliserPourRegle(libelleExploitable(l)).split(' '))
    .filter((m) => /^[0-9]+$/.test(m) && m.startsWith(debut))
  if (famille.length === 0) return null
  let longueur = CHIFFRES_MINIMUM_FAMILLE
  while (longueur < reference.length && famille.every((m) => m.startsWith(reference.slice(0, longueur + 1)))) {
    longueur++
  }
  return reference.slice(0, longueur)
}

/** Un mouvement que le lot peut affecter : à traiter, jamais un virement personnel, jamais zéro euro. */
export function mouvementATraiter(ligne: Pick<LigneBancaire, 'statut' | 'prelevement_personnel' | 'montant'>): boolean {
  return ligne.statut === 'non_rapprochee' && !ligne.prelevement_personnel && ligne.montant !== 0
}

/** Les mouvements À TRAITER de ce sens que le motif désigne — ce qu'une règle nouvelle proposerait. */
export function mouvementsCouverts<L extends Pick<LigneBancaire, 'statut' | 'prelevement_personnel' | 'montant' | 'libelle' | 'libelle_brut'>>(
  motif: string,
  sens: SensMouvementBancaire,
  lignes: readonly L[],
): L[] {
  const normalise = normaliserPourRegle(motif)
  if (!normalise) return []
  return lignes.filter((l) =>
    mouvementATraiter(l) && sensDuMouvement(l) === sens
    && libelleCorrespond(normaliserPourRegle(libelleExploitable(l)), normalise))
}

export type ResultatRegles =
  | { etat: 'aucune' }
  | { etat: 'proposee'; regle: RegleAffectationBancaire }
  | { etat: 'conflit'; regles: RegleAffectationBancaire[] }

// LA RÈGLE QUI S'APPLIQUE À UN MOUVEMENT. Plusieurs règles d'accord sur la catégorie : aucun doute. En
// désaccord : la plus PRÉCISE l'emporte quand elle contient toutes les autres — « amazon prime » est plus
// précis que « amazon » ; sinon, aucune n'est proposée. Trancher par l'ordre de création ou la longueur
// serait choisir à la place de l'opérateur, en masse, sur un seul clic — le défaut déjà corrigé une fois
// dans le rapprochement automatique (voir `planRapprochementAutomatique`).
export function regleApplicable(
  ligne: Pick<LigneBancaire, 'libelle' | 'libelle_brut' | 'montant'>,
  regles: readonly RegleAffectationBancaire[],
): ResultatRegles {
  const sens = sensDuMouvement(ligne)
  if (!sens) return { etat: 'aucune' }
  const libelle = normaliserPourRegle(libelleExploitable(ligne))
  const applicables = regles.filter((r) => r.sens === sens && libelleCorrespond(libelle, r.motif))
  if (applicables.length === 0) return { etat: 'aucune' }
  const plusPrecise = applicables.reduce((a, b) => (b.motif.length > a.motif.length ? b : a))
  const departagee = applicables.every((r) =>
    r.categorie_id === plusPrecise.categorie_id || libelleCorrespond(plusPrecise.motif, r.motif))
  return departagee ? { etat: 'proposee', regle: plusPrecise } : { etat: 'conflit', regles: applicables }
}

export interface JustificatifsDuDossier {
  // TOUTES les pièces lues, à valider comprises : une pièce qu'on n'a pas encore relue reste le
  // justificatif d'un paiement.
  pieces: Piece[]
  piecesRapprochees: ReadonlySet<string>
  // Ce qu'il reste à régler des pièces payées en partie (`restesAReglerDesPieces`, lib/controles.ts) : un mouvement
  // en est peut-être le solde. Vide sur une lecture partielle du relevé ou des parts.
  restesARegler: ReadonlyMap<string, number>
  cotisations: CotisationRapprochable[]
  cotisationsRapprochees: ReadonlySet<string>
}

// UN MOUVEMENT QUI A PEUT-ÊTRE SON JUSTIFICATIF NE S'AFFECTE PAS EN LOT. Affecté, il compterait dans la
// 2035 à côté de la pièce qui le justifie — la même dépense deux fois, sans que rien ne le dise : la
// pièce resterait « sans mouvement », ce qui est exactement ce qu'on attend d'une pièce payée en
// espèces. Une règle « transmedical » aurait fait ça sur le dossier `test`, qui porte dix-sept factures
// Transmedical.
//
// Trois signaux, du plus sûr au plus large : une pièce du même montant dans la fenêtre du
// rapprochement, une échéance de cotisation de même, puis une pièce de CE tiers qui n'est rapprochée
// d'aucun mouvement — quel que soit son montant, parce qu'un paiement en deux fois ou une facture mal
// lue échappent au montant et pas au nom. Le troisième est large exprès : le mouvement reste à traiter,
// l'opérateur l'ouvre, et un faux négatif coûte un clic.
export function justificatifPossible(ligne: LigneBancaire, justificatifs: JustificatifsDuDossier): string | null {
  if (candidatsPieces(ligne, justificatifs.pieces, justificatifs.piecesRapprochees).length > 0) {
    return 'Une pièce du même montant attend un rapprochement.'
  }
  if (candidatsCotisations(ligne, justificatifs.cotisations, justificatifs.cotisationsRapprochees).length > 0) {
    return 'Une échéance de cotisation du même montant attend un rapprochement.'
  }
  const libelle = libelleExploitable(ligne)
  if (justificatifs.pieces.some((p) =>
    !justificatifs.piecesRapprochees.has(p.id) && sensCoherent(p, ligne) && tiersConfirmeParBanque(p.tiers, libelle))) {
    return 'Un justificatif de ce tiers n’est rapproché d’aucun mouvement.'
  }
  // UNE PIÈCE PAYÉE EN PARTIE ATTEND SON SOLDE : rapprochée de son acompte, elle échappait aux deux questions
  // précédentes, et le solde affecté en lot aurait compté la dépense une seconde fois — la 2035 compte déjà la pièce
  // entière, son reste à la date de la facture. Le même tiers, ou le montant du reste, suffit à la soupçonner.
  if (justificatifs.pieces.some((p) => {
    const reste = justificatifs.restesARegler.get(p.id)
    return reste != null && sensCoherent(p, ligne)
      && (tiersConfirmeParBanque(p.tiers, libelle) || Math.round(Math.abs(ligne.montant) * 100) === Math.round(reste * 100))
  })) {
    return 'Une pièce payée en partie attend son solde : ce mouvement le règle peut-être.'
  }
  return null
}

export interface PropositionRegle {
  ligne: LigneBancaire
  regle: RegleAffectationBancaire
  categorie: Categorie
  // Le taux que l'affectation portera : celui de la règle pour une recette d'un dossier assujetti, nul
  // ailleurs (`tauxApplicable`).
  taux: number | null
}

export interface RefusRegle {
  ligne: LigneBancaire
  regle: RegleAffectationBancaire
  raison: string
}

export interface ConflitRegles {
  ligne: LigneBancaire
  regles: RegleAffectationBancaire[]
}

export interface PlanAffectationParRegles {
  propositions: PropositionRegle[]
  // Désignés par une règle, mais qui ont peut-être leur justificatif (`justificatifPossible`) : à
  // rapprocher, pas à affecter.
  aRapprocher: RefusRegle[]
  // Désignés par une règle, mais que l'affectation refuserait : une recette d'un dossier assujetti dont la
  // règle ne dit pas le taux, une catégorie dont le compte n'est plus de résultat. Montrés avec leur
  // raison, jamais écrits.
  refus: RefusRegle[]
  conflits: ConflitRegles[]
}

// Ce que le clic « Affecter les N » écrirait. Seuls les mouvements À TRAITER : un mouvement rapproché,
// classé ou déjà affecté porte une décision humaine que le lot n'a pas à revoir — la base le refuse
// d'ailleurs (`affecter_mouvements_bancaires`). Les refus reprennent mot pour mot ceux de l'affectation
// à l'unité (`refusAffectation`), que la base refait.
export function planAffectationParRegles(
  lignes: readonly LigneBancaire[],
  regles: readonly RegleAffectationBancaire[],
  categories: readonly Categorie[],
  assujettiTva: boolean,
  // Sans valeur par défaut, et c'est voulu : un appelant qui l'oublierait affecterait en lot des
  // paiements dont la pièce est au dossier.
  justificatif: (ligne: LigneBancaire) => string | null,
): PlanAffectationParRegles {
  const parId = new Map(categories.map((c) => [c.id, c]))
  const plan: PlanAffectationParRegles = { propositions: [], aRapprocher: [], refus: [], conflits: [] }
  if (regles.length === 0) return plan
  for (const ligne of lignes) {
    if (!mouvementATraiter(ligne)) continue
    const resultat = regleApplicable(ligne, regles)
    if (resultat.etat === 'aucune') continue
    if (resultat.etat === 'conflit') {
      plan.conflits.push({ ligne, regles: resultat.regles })
      continue
    }
    const aRapprocher = justificatif(ligne)
    if (aRapprocher) {
      plan.aRapprocher.push({ ligne, regle: resultat.regle, raison: aRapprocher })
      continue
    }
    const categorie = parId.get(resultat.regle.categorie_id)
    if (!categorie) {
      plan.refus.push({ ligne, regle: resultat.regle, raison: 'La catégorie de cette règle ne figure pas parmi les catégories lues.' })
      continue
    }
    const nature = natureDuCompte(categorie.compte_comptable)
    if (tauxRequis(assujettiTva, nature) && resultat.regle.taux_tva == null) {
      plan.refus.push({ ligne, regle: resultat.regle, raison: REFUS_REGLE_SANS_TAUX })
      continue
    }
    const taux = tauxApplicable(assujettiTva, nature, resultat.regle.taux_tva)
    const raison = refusAffectation(ligne, categorie, assujettiTva, taux)
    if (raison) plan.refus.push({ ligne, regle: resultat.regle, raison })
    else plan.propositions.push({ ligne, regle: resultat.regle, categorie, taux })
  }
  return plan
}

// Le refus qu'on dirait de l'affectation à l'unité (« choisis-le ») ne se suit pas depuis la carte du lot :
// on n'y choisit rien. Il dit donc où le taux se choisit.
export const REFUS_REGLE_SANS_TAUX =
  'Sur un dossier assujetti à la TVA, une recette porte son taux, et cette règle n’en dit pas : affecte ce mouvement depuis sa fiche en choisissant le taux, et retiens la règle de nouveau.'

export interface TotalCategorie {
  categorie: Categorie
  nombre: number
  // Signé comme les mouvements : ce que ces mouvements font entrer (positif) ou sortir de la banque.
  montant: number
}

/** Le lot, catégorie par catégorie, dans l'ordre des catégories — ce qu'on relit avant de cliquer. */
export function totauxParCategorie(propositions: readonly PropositionRegle[]): TotalCategorie[] {
  const parCategorie = new Map<string, TotalCategorie>()
  for (const p of propositions) {
    const total = parCategorie.get(p.categorie.id) ?? { categorie: p.categorie, nombre: 0, montant: 0 }
    total.nombre++
    total.montant = Math.round((total.montant + p.ligne.montant) * 100) / 100
    parCategorie.set(p.categorie.id, total)
  }
  return [...parCategorie.values()].sort((a, b) =>
    a.categorie.ordre - b.categorie.ordre || a.categorie.libelle.localeCompare(b.categorie.libelle, 'fr'))
}

export interface AffectationEnvoyee {
  ligne_bancaire_id: string
  categorie_id: string
  // Transmis à `affecter_mouvement_bancaire` par le lot, qui le refuse ailleurs que sur une recette d'un
  // dossier assujetti et l'exige là.
  taux_tva: number | null
  ecritures: LigneEcritureMouvement[]
}

// MESURÉ le 29/09/2026 : 372 affectations en 2,5 s sous RLS, et la base coupe un appel à 8 s
// (`statement_timeout` du rôle `authenticated`). Par envois de cent, chacun tient donc en moins d'une
// seconde, et un relevé de plusieurs années ne bute pas sur le délai. Chaque envoi est tout ou rien ;
// l'écran dit combien sont passés avant un refus.
export const TAILLE_ENVOI_AFFECTATION = 100

/** Les envois du lot, dans l'ordre des propositions — l'écriture de chacune composée ici, testée. */
export function envoisDuLot(
  propositions: readonly PropositionRegle[],
  taille: number = TAILLE_ENVOI_AFFECTATION,
): AffectationEnvoyee[][] {
  // Une proposition a passé `refusAffectation`, donc sa catégorie a un compte de résultat ; le filtre ne
  // sert qu'au typage.
  const affectations = propositions.flatMap((p) => p.categorie.compte_comptable
    ? [{
        ligne_bancaire_id: p.ligne.id,
        categorie_id: p.categorie.id,
        taux_tva: p.taux,
        ecritures: ecritureDuMouvement(p.ligne, p.categorie.compte_comptable, p.taux),
      }]
    : [])
  const envois: AffectationEnvoyee[][] = []
  for (let i = 0; i < affectations.length; i += taille) envois.push(affectations.slice(i, i + taille))
  return envois
}
