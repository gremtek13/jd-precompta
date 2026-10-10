import { amortissementCumuleCentimes, compteAmortissement, dotationsDuRegistre, miseEnService, montantDeFactureDifferent, rang360 } from './amortissements'
import {
  COMPTE_BANQUE, COMPTE_CAPITAL_INDIVIDUEL, COMPTE_CREDIT_TVA_A_REPORTER, COMPTE_EMPRUNT, COMPTE_EXPLOITANT,
  COMPTE_REMBOURSEMENT_TVA_DEMANDE, COMPTE_TVA_A_DECAISSER, COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE,
  COMPTE_TVA_IMMOBILISATIONS, COMPTE_VIREMENTS_INTERNES,
} from './comptes'
import { montantsDesMouvementsIgnores, mouvementsIgnoresHorsFec } from './controles'
import { creditReporte, libellePeriode } from './declarationTva'
import { echeancesNonRapprochees } from './echeanceEmprunt'
import { capitalRestantDu, type Emprunt } from './emprunts'
import type { ModeleComptable } from './engagement'
import { formatDate, formatMoney } from './format'
import { liquidationsDesynchronisees, paiementsTvaDesynchronises, periodesNonDeclarees } from './liquidationTva'
import { etatDeLOuverture, ouvertureDeLExercice } from './reportDesSoldes'
import { TAILLE_MAX_PREUVE_APPLICATION } from './revisionSoldes'
import type {
  ANouveau, ControleReleveBancaire, DeclarationTva, DocumentDivers, EcritureBrouillon, ExerciceValide, Immobilisation,
  LigneBancaire, NatureImmobilisation, PeriodiciteTva, Piece, SoldeReporte,
} from './types'
import { frontiereDeValidation } from './validationExercice'

// LES PREUVES QUE L'APPLICATION PROPOSE POUR UN SOLDE DE BILAN (ligne 41, étape R2 ; conception du 09/10/2026,
// HISTORIQUE.md, « LA RÉVISION DES COMPTES : LA CONCEPTION », § 3.6). Un module PUR : il ne lit rien en base, n'appelle
// personne et ne lit pas l'horloge — l'écran (étape R3) lui donne ce qu'il a lu, en entier.
//
// UNE PREUVE EST PROPOSÉE, JAMAIS APPLIQUÉE. Chacune dit ce qu'elle ÉTABLIT et ce qu'elle N'ÉTABLIT PAS — l'écran dit les
// deux —, compare ce qu'elle attend au solde du compte, et nomme les causes possibles d'un écart sans en choisir une :
// le jugement de suffisance est celui du cabinet (conception, § 1.7). Seul le clic du cabinet fait d'une preuve une
// justification, et son INSTANTANÉ part alors dans `preuve_application` (`instantaneDeLaPreuve`) : ce que l'écran a
// montré, versionné, relu sans deviner (`lireInstantaneDePreuve`), sous la borne de la base, mesurée comme elle la mesure
// (`octetsJsonb`).
//
// RIEN DE CE QUE LE CABINET OU LE CLIENT A SAISI N'ENTRE DANS LE TEXTE D'UNE PREUVE : ni libellé de mouvement, ni nom de
// tiers, de fichier, de bien ou d'emprunt. Le texte se compose de dates, de montants et de comptes ; chaque ligne de
// détail désigne sa source par son identifiant, que l'écran résout pour l'afficher. L'instantané, gardé en base, n'en
// porte donc aucun — et aucune donnée de patient ne peut s'y glisser (RGPD.md, § 4).
//
// Les montants sont en CENTIMES ENTIERS, débit positif, comptés comme `solde_du_compte` et `soldeDuCompteCentimes`
// (lib/revisionSoldes.ts) : chaque ligne pour Math.round(montant × 100).

// ── Ce que les preuves lisent ─────────────────────────────────────────────────────────────────────────────────────

export type PiecePourRevision = Pick<Piece, 'id' | 'type_piece' | 'storage_hash' | 'montant_ht' | 'montant_tva' | 'montant_ttc'>
export type DocumentPourRevision = Pick<DocumentDivers, 'id' | 'nom_fichier' | 'categorie' | 'storage_hash'>
export type ExercicePourRevision = Pick<ExerciceValide, 'annee' | 'valide_le' | 'empreinte'>

/**
 * Ce que l'écran a lu du dossier, EN ENTIER : une lecture partielle ne propose aucune preuve (lib/revision.ts). Les
 * listes sont celles du DOSSIER, toutes années confondues — le module filtre l'exercice lui-même, comme la base, et les
 * causes d'un écart du 512 se comptent depuis la reprise.
 */
export interface DonneesDesPreuves {
  annee: number
  // L'année en cours à Paris (`aujourdHuiAParis`) : les dotations la lisent pour dire ce qui reste à écrire.
  anneeCourante: number
  modele: ModeleComptable
  assujettiTva: boolean
  periodiciteTva: PeriodiciteTva
  ecritures: readonly EcritureBrouillon[]
  reprise: readonly ANouveau[]
  reportes: readonly SoldeReporte[]
  exercicesValides: readonly ExercicePourRevision[]
  // Ce que `verifier_exercice_valide` a rendu pour l'exercice précédent, ou nul quand l'écran ne l'a pas demandé.
  verificationPrecedent: boolean | null
  lignes: readonly LigneBancaire[]
  controlesReleves: readonly ControleReleveBancaire[]
  pieces: readonly PiecePourRevision[]
  documents: readonly DocumentPourRevision[]
  immobilisations: readonly Immobilisation[]
  natures: readonly NatureImmobilisation[]
  emprunts: readonly Emprunt[]
  declarationsTva: readonly DeclarationTva[]
}

// ── Ce qu'une preuve rend ─────────────────────────────────────────────────────────────────────────────────────────

// Les listes fermées de ce module sont des tableaux dont les types dérivent : le lecteur de l'instantané les relit, et
// une valeur ajoutée au type sans l'être à la liste ferait refuser un instantané juste.
export const TYPES_DE_PREUVE = [
  'releve', 'virements-internes', 'registre-valeurs', 'registre-amortissements', 'echeancier', 'declarations-tva',
  'ouverture', 'decomposition-exploitant', 'aucune',
] as const
export type TypeDePreuve = (typeof TYPES_DE_PREUVE)[number]

// Ce que la preuve conclut :
//   - `concorde` : ce qu'elle attend est le solde du compte, au centime ;
//   - `ecart` : il ne l'est pas, ou un maillon de la preuve ne tient pas ;
//   - `incomplete` : elle n'a pas de quoi conclure — aucun relevé qui boucle, plusieurs relevés qu'elle ne sait pas
//     départager, une ouverture qui attend, une empreinte à vérifier ;
//   - `decrit` : elle dit de quoi le solde est fait sans rien attendre d'autre (le compte de l'exploitant) ;
//   - `sans-preuve` : l'application ne tient aucune preuve de ce compte.
// Seule `concorde` peut suffire seule (`preuveSuffisanteSeule`) : « une preuve qui ne boucle pas n'est pas présentée
// comme suffisante » (conception, § 5.4).
export const VERDICTS_DE_PREUVE = ['concorde', 'ecart', 'incomplete', 'decrit', 'sans-preuve'] as const
export type VerdictDePreuve = (typeof VERDICTS_DE_PREUVE)[number]

export const CLES_DE_FAITS = [
  // Le relevé au 31 décembre.
  'aucun-releve', 'releve-ne-boucle-pas', 'releve-sans-fichier', 'mouvements-modifies', 'plusieurs-releves',
  'ecart-egal-solde-initial', 'ouverture-absente', 'mouvements-ignores', 'mouvements-a-traiter', 'banque-sans-mouvement',
  // Les virements internes.
  'virements-sans-contrepartie',
  // Le registre.
  'acquisitions-non-ecrites', 'facture-differente', 'lignes-hors-registre', 'biens-sans-nature', 'biens-sans-justificatif',
  'dotations-en-defaut', 'biens-repris',
  // Les emprunts.
  'echeances-non-rapprochees', 'deblocages-ecart', 'lignes-hors-emprunt',
  // La TVA.
  'periodes-non-declarees', 'non-redevable', 'liquidations-a-reecrire', 'paiements-a-reecrire', 'exigibilite-decalee',
  // L'ouverture.
  'ouverture-en-attente', 'ecritures-sur-le-compte', 'maillon-rompu', 'empreinte-a-verifier', 'empreinte-alteree',
  'empreinte-intacte',
] as const
export type CleDeFait = (typeof CLES_DE_FAITS)[number]

export interface FaitDeLaPreuve {
  cle: CleDeFait
  texte: string
  montantCentimes: number | null
  nombre: number | null
}

export const TYPES_DE_REFERENCE = [
  'releve', 'mouvement', 'ecriture', 'bien', 'emprunt', 'declaration', 'a-nouveau', 'solde-reporte',
] as const
export type TypeDeReference = (typeof TYPES_DE_REFERENCE)[number]

export interface LigneDeDetail {
  // Composé de dates, de montants et de comptes seulement : l'écran résout la référence pour nommer la source.
  libelle: string
  montantCentimes: number | null
  reference: { type: TypeDeReference; id: string } | null
}

export interface SourceProposee {
  pieceId: string | null
  documentId: string | null
  raison: string
}

export interface PreuveProposee {
  type: TypeDePreuve
  compte: string
  annee: number
  titre: string
  etablit: string
  netablitPas: string
  soldeCentimes: number
  attenduCentimes: number | null
  // Le solde du compte moins ce que la preuve attend ; nul quand elle n'attend rien.
  ecartCentimes: number | null
  verdict: VerdictDePreuve
  // La ligne que la carte du cycle montre sous le compte.
  resume: string
  faits: FaitDeLaPreuve[]
  detail: LigneDeDetail[]
  // Les sources que le cabinet peut citer — jamais citées d'elles-mêmes : rien ne se décide sans son clic.
  sourcesProposees: SourceProposee[]
}

// CE QUE CHAQUE PREUVE ÉTABLIT ET N'ÉTABLIT PAS (§ 3.6), écrit une fois : l'écran le montre, l'instantané le garde.
export const TEXTES_DES_PREUVES: Readonly<Record<TypeDePreuve, { etablit: string; netablitPas: string }>> = {
  releve: {
    etablit: 'Le solde de la banque au 31 décembre, tiré d’un relevé qui boucle — celui dont la période finit le 31 '
      + 'décembre, sinon celui qui couvre la fin de ce jour, par son solde initial et ses mouvements jusqu’au 31 '
      + 'décembre —, comparé au 512000 ; un écart se dit avec ses causes possibles.',
    netablitPas: 'Qu’aucun compte bancaire ne manque — un relevé ne dit pas de quel compte il est : plusieurs relevés au '
      + '31 décembre se montrent un à un, sans s’additionner — ; le relevé lui-même, dont le document se cite ; une '
      + 'remise de chèques de fin d’exercice.',
  },
  'virements-internes': {
    etablit: 'Que le compte est soldé au 31 décembre, ou la liste des virements de l’exercice sans contrepartie de même '
      + 'montant.',
    netablitPas: 'Le solde d’un compte que l’application ne tient pas — un compte d’épargne, un second compte bancaire : '
      + 'son relevé se cite.',
  },
  'registre-valeurs': {
    etablit: 'Que le solde du compte est la valeur des biens que le registre range à ce compte, acquis au plus tard le 31 '
      + 'décembre, ouverture comprise ; la facture de chacun se propose à la citation.',
    netablitPas: 'L’existence du bien ; une cession ou une mise au rebut, que l’application ne connaît pas ; un bien hors '
      + 'du registre.',
  },
  'registre-amortissements': {
    etablit: 'Que le solde du compte est le cumul des amortissements du registre au 31 décembre, ouverture comprise, '
      + 'calculé comme les dotations : linéaire, au prorata depuis la mise en service.',
    netablitPas: 'La durée et le mode d’amortissement retenus ; une dépréciation.',
  },
  echeancier: {
    etablit: 'Que le solde du compte est le capital restant dû au 31 décembre selon l’échéancier de chaque emprunt, '
      + 'calculé à mensualité constante.',
    netablitPas: 'Le tableau d’amortissement de la banque — un différé, un taux variable, une renégociation : il se cite.',
  },
  'declarations-tva': {
    etablit: 'Que le solde est ce que disent les déclarations de TVA enregistrées et leurs paiements rapprochés : au '
      + '445510 la TVA déclarée et non payée au 31 décembre, au 445670 le crédit reporté, au 445830 le remboursement '
      + 'demandé et non reçu ; les TVA collectée et déductible soldées quand toutes les périodes sont déclarées.',
    netablitPas: 'Une déclaration déposée ailleurs et non enregistrée ; une TVA dont l’exigibilité ne tombe pas dans la '
      + 'période de son écriture — une facture réglée après le 31 décembre, toute facture non réglée d’un dossier en '
      + 'engagement —, qui laisse un solde aux TVA collectée et déductible ; la cohérence de la TVA collectée avec les '
      + 'recettes.',
  },
  ouverture: {
    etablit: 'Que l’ouverture du compte est celle que la validation de l’exercice précédent a écrite — ou celle de la '
      + 'balance reprise —, qu’aucune écriture de l’exercice ne la modifie, et que l’exercice précédent se relit tel '
      + 'qu’il a été validé.',
    netablitPas: 'La justesse d’une balance reprise d’un autre logiciel.',
  },
  'decomposition-exploitant': {
    etablit: 'De quoi le solde est fait : les prélèvements et les apports du relevé, la CSG-CRDS des cotisations, les '
      + 'cotisations payées depuis le compte personnel, les forfaits kilométriques, les notes de frais, les parts '
      + 'personnelles des ventilations.',
    netablitPas: 'La vraisemblance des prélèvements au regard du résultat.',
  },
  aucune: {
    etablit: 'Rien : l’application ne tient aucune preuve de ce solde.',
    netablitPas: 'Le solde lui-même : un contrat, un acte, un relevé de compte courant se cite.',
  },
}

function titreDe(type: TypeDePreuve, annee: number): string {
  switch (type) {
    case 'releve': return `Relevé au 31/12/${annee}`
    case 'virements-internes': return 'Virements internes'
    case 'registre-valeurs': return 'Registre des immobilisations'
    case 'registre-amortissements': return 'Amortissements du registre'
    case 'echeancier': return 'Échéancier des emprunts'
    case 'declarations-tva': return 'Déclarations de TVA'
    case 'ouverture': return 'Ouverture de l’exercice'
    case 'decomposition-exploitant': return 'Composition du compte de l’exploitant'
    case 'aucune': return 'Aucune preuve de l’application'
  }
}

// Les six comptes de TVA que les déclarations et leurs paiements écrivent (lib/liquidationTva.ts). Un autre compte 44
// n'a pas de preuve : rien dans l'application ne dit ce qu'il doit porter.
export const COMPTES_DE_TVA_DECLARES: readonly string[] = [
  COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE, COMPTE_TVA_IMMOBILISATIONS, COMPTE_TVA_A_DECAISSER,
  COMPTE_CREDIT_TVA_A_REPORTER, COMPTE_REMBOURSEMENT_TVA_DEMANDE,
]
// Ceux que la liquidation SOLDE (collectée, déductible) : leur solde au 31 décembre dépend de l'exigibilité.
const COMPTES_DE_TVA_SOLDES: readonly string[] = [COMPTE_TVA_COLLECTEE, COMPTE_TVA_DEDUCTIBLE, COMPTE_TVA_IMMOBILISATIONS]

/** La preuve que l'application propose pour un compte de bilan (§ 3.6) ; `aucune` pour tout compte qu'elle ne prouve pas. */
export function typeDePreuveDuCompte(compte: string): TypeDePreuve {
  if (compte === COMPTE_BANQUE) return 'releve'
  if (compte === COMPTE_VIREMENTS_INTERNES) return 'virements-internes'
  if (/^28/.test(compte)) return 'registre-amortissements'
  if (/^2[01]/.test(compte)) return 'registre-valeurs'
  if (compte === COMPTE_EMPRUNT) return 'echeancier'
  if (COMPTES_DE_TVA_DECLARES.includes(compte)) return 'declarations-tva'
  if (compte === COMPTE_CAPITAL_INDIVIDUEL) return 'ouverture'
  if (compte === COMPTE_EXPLOITANT) return 'decomposition-exploitant'
  return 'aucune'
}

// ── Les outils ────────────────────────────────────────────────────────────────────────────────────────────────────

const centimes = (montant: number) => Math.round(montant * 100)
const signe = (e: Pick<EcritureBrouillon, 'sens'>) => (e.sens === 'debit' ? 1 : -1)
// L'opposé d'un montant, sans zéro négatif : `-0` passerait pour un montant dans une comparaison stricte d'objets.
const oppose = (c: number) => (c === 0 ? 0 : -c)
const enEuros = (c: number) => formatMoney(Math.abs(c) / 100)

/** Un solde en mots : « 1 034,25 € au débit », « 12,34 € au crédit », « nul ». */
export function soldeEnMots(c: number): string {
  if (c === 0) return 'nul'
  return `${enEuros(c)} au ${c > 0 ? 'débit' : 'crédit'}`
}

// L'accord d'un mot avec un nombre — au moins un : un fait ne se dit que s'il compte quelque chose.
function accord(n: number, un: string, plusieurs: string): string {
  return n > 1 ? plusieurs : un
}

function pluriel(n: number, singulier: string, plurielForme: string): string {
  return `${n} ${accord(n, singulier, plurielForme)}`
}

function fait(cle: CleDeFait, texte: string, montantCentimes: number | null, nombre: number | null): FaitDeLaPreuve {
  return { cle, texte, montantCentimes, nombre }
}

function ecrituresDeLExercice(d: Pick<DonneesDesPreuves, 'annee' | 'ecritures'>): EcritureBrouillon[] {
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  return d.ecritures.filter((e) => e.date >= debut && e.date <= fin)
}

function dateDeLaReprise(d: Pick<DonneesDesPreuves, 'reprise'>): string | null {
  return d.reprise.length > 0 ? d.reprise.map((a) => a.date).sort()[0] : null
}

function sommeEcritures(lignes: readonly Pick<EcritureBrouillon, 'sens' | 'montant'>[]): number {
  return lignes.reduce((s, e) => s + signe(e) * centimes(e.montant), 0)
}

// La ligne de la carte : ce que la preuve conclut, en une phrase.
function resumeDe(
  titre: string, verdict: VerdictDePreuve, soldeCentimes: number, attendu: number | null, ecart: number | null,
  raison: string | null,
): string {
  switch (verdict) {
    case 'concorde':
      return `${titre} : ${attendu === 0 || attendu === null ? 'solde nul' : soldeEnMots(attendu)}, comme le compte.`
    case 'ecart':
      return ecart !== null && ecart !== 0
        ? `${titre} : ${soldeEnMots(attendu ?? 0)} attendu, le compte ${soldeEnMots(soldeCentimes)} — écart de ${enEuros(ecart)}.`
        : `${titre} : ${raison ?? 'un maillon de la preuve ne tient pas.'}`
    case 'incomplete':
    case 'decrit':
      return `${titre} : ${raison ?? 'rien à conclure.'}`
    case 'sans-preuve':
      return `${titre}.`
  }
}

// Le cœur commun : le verdict, depuis ce que la preuve attend, et la ligne de la carte. `verdictForce` l'emporte quand
// la preuve ne conclut pas sur les montants seuls ; `raison` dit alors pourquoi, en minuscule et avec son point.
function conclure(
  type: TypeDePreuve,
  compte: string,
  annee: number,
  soldeCentimes: number,
  attenduCentimes: number | null,
  verdictForce: VerdictDePreuve | null,
  raison: string | null,
  faits: FaitDeLaPreuve[],
  detail: LigneDeDetail[],
  sourcesProposees: SourceProposee[],
): PreuveProposee {
  const titre = titreDe(type, annee)
  const ecartCentimes = attenduCentimes === null ? null : soldeCentimes - attenduCentimes
  const verdict: VerdictDePreuve = verdictForce ?? (ecartCentimes === 0 ? 'concorde' : 'ecart')
  return {
    type, compte, annee, titre, ...TEXTES_DES_PREUVES[type], soldeCentimes, attenduCentimes, ecartCentimes, verdict,
    resume: resumeDe(titre, verdict, soldeCentimes, attenduCentimes, ecartCentimes, raison), faits, detail, sourcesProposees,
  }
}

// ── Le relevé au 31 décembre (512000) ─────────────────────────────────────────────────────────────────────────────

// LE SOLDE DE LA BANQUE AU 31 DÉCEMBRE, LU SUR UN RELEVÉ QUI BOUCLE (§ 3.6) : celui dont la période finit le 31 décembre
// (son solde final), sinon celui qui couvre la FIN de ce jour — sa période commence au plus tard le 1er janvier suivant
// et finit après le 31 décembre : son solde initial et ceux de ses mouvements qui sont datés au plus tard du 31. Les dates
// d'un contrôle sont celles de ses deux lignes de solde (lib/soldeReleve.ts) : un relevé de janvier dont le solde initial
// est daté du 1er janvier dit, par lui, le solde de la fin du 31 décembre.
//
// PLUSIEURS RELEVÉS RETENUS NE S'ADDITIONNENT PAS. Le modèle ne sait pas de quel compte bancaire est un relevé (aucune
// colonne ne le dit), l'import écarte les mouvements déjà présents, et deux relevés d'un MÊME compte peuvent finir le 31
// décembre — le mensuel et l'annuel — : les additionner compterait le compte deux fois et pourrait tomber juste à tort.
// La preuve les montre alors un à un, avec leur somme, et ne conclut pas : le cabinet sait, lui, combien le dossier a de
// comptes.
function preuveDuReleve(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const fin = `${d.annee}-12-31`
  const lendemain = `${d.annee + 1}-01-01`
  const parPeriode = (a: ControleReleveBancaire, b: ControleReleveBancaire) =>
    (a.periode_debut ?? '').localeCompare(b.periode_debut ?? '') || a.id.localeCompare(b.id)
  const finissent = d.controlesReleves.filter((c) => c.periode_fin === fin).sort(parPeriode)
  const couvrent = d.controlesReleves
    .filter((c) => c.periode_debut !== null && c.periode_fin !== null && c.periode_debut <= lendemain && c.periode_fin > fin)
    .sort(parPeriode)
  const bouclentEtFinissent = finissent.filter((c) => c.coherent)
  const candidats = bouclentEtFinissent.length > 0 ? bouclentEtFinissent : couvrent.filter((c) => c.coherent)
  const faits: FaitDeLaPreuve[] = []
  const detail: LigneDeDetail[] = []
  const sources: SourceProposee[] = []
  const periodeDe = (c: ControleReleveBancaire) => `du ${formatDate(c.periode_debut)} au ${formatDate(c.periode_fin)}`

  // Ceux qui ne bouclent pas parmi ceux que la preuve a regardés : ceux qui finissent le 31 décembre, et, faute de l'un
  // d'eux qui boucle, ceux qui couvrent la fin de ce jour.
  const regardes = bouclentEtFinissent.length > 0 ? finissent : [...finissent, ...couvrent]
  for (const c of regardes.filter((x) => !x.coherent)) {
    faits.push(fait('releve-ne-boucle-pas',
      `Le relevé ${periodeDe(c)} ne boucle pas — un écart de ${enEuros(centimes(c.ecart))} entre ses soldes et ses mouvements : il ne prouve pas le solde.`,
      centimes(c.ecart), null))
  }

  const soldes: number[] = []
  for (const c of candidats) {
    // Les mouvements du relevé, retrouvés par le nom du fichier importé : ils doivent faire encore la somme que le
    // contrôle a mesurée à l'import, sinon le relevé ne boucle plus avec ce que la base en garde.
    const duFichier = c.source_fichier === null ? null : d.lignes.filter((l) => l.source_fichier === c.source_fichier)
    const intact = duFichier !== null && duFichier.reduce((s, l) => s + centimes(l.montant), 0) === centimes(c.somme_mouvements)
    let au31: number
    if (c.periode_fin === fin) {
      au31 = centimes(c.solde_final)
      if (duFichier !== null && !intact) {
        faits.push(fait('mouvements-modifies',
          `Les mouvements du relevé ${periodeDe(c)} ne font plus en base la somme contrôlée à son import : un mouvement a été retiré ou ajouté depuis.`, null, null))
      }
    } else if ((c.periode_debut as string) > fin) {
      // Il commence le 1er janvier : son solde initial est celui de la fin du 31 décembre, sans aucun mouvement à lire.
      au31 = centimes(c.solde_initial)
    } else if (duFichier === null) {
      faits.push(fait('releve-sans-fichier',
        `Le relevé ${periodeDe(c)} couvre le 31/12/${d.annee}, mais son import n’a pas gardé de nom de fichier : ses mouvements ne se retrouvent pas, et son solde au 31 décembre ne se calcule pas.`, null, null))
      continue
    } else if (!intact) {
      faits.push(fait('mouvements-modifies',
        `Les mouvements du relevé ${periodeDe(c)} ne font plus en base la somme contrôlée à son import : son solde au 31 décembre ne se calcule pas.`, null, null))
      continue
    } else {
      au31 = centimes(c.solde_initial) + duFichier.filter((l) => l.date <= fin).reduce((s, l) => s + centimes(l.montant), 0)
    }
    soldes.push(au31)
    detail.push({ libelle: `Relevé ${periodeDe(c)} : solde au 31/12/${d.annee}`, montantCentimes: au31, reference: { type: 'releve', id: c.id } })
    // Le document d'un relevé : l'onglet Banque importe un relevé classé sous le nom de son document, et ce nom devient
    // celui du fichier source de ses mouvements. Proposé, jamais cité : un nom n'est pas une preuve d'identité.
    for (const doc of d.documents) {
      if (c.source_fichier !== null && doc.categorie === 'releve_bancaire' && doc.nom_fichier === c.source_fichier
        && !sources.some((s) => s.documentId === doc.id)) {
        sources.push({ pieceId: null, documentId: doc.id, raison: `Le relevé bancaire déposé sous le nom du relevé ${periodeDe(c)}.` })
      }
    }
  }

  let attendu: number | null = null
  let verdictForce: VerdictDePreuve | null = null
  let raison: string | null = null
  if (soldes.length === 0) {
    if (finissent.length === 0 && couvrent.length === 0) {
      faits.unshift(fait('aucun-releve', `Aucun relevé importé ne finit le 31/12/${d.annee} ni ne couvre la fin de ce jour.`, null, null))
    }
    verdictForce = 'incomplete'
    raison = `aucun relevé qui boucle ne donne le solde au 31/12/${d.annee}.`
  } else if (soldes.length > 1) {
    const somme = soldes.reduce((s, x) => s + x, 0)
    faits.push(fait('plusieurs-releves',
      `${soldes.length} relevés donnent un solde au 31/12/${d.annee}, ${soldeEnMots(somme)} à eux tous : la preuve ne sait pas s’ils sont de comptes différents, que le ${compte} réunit, ou du même compte.`,
      somme, soldes.length))
    verdictForce = 'incomplete'
    raison = `${soldes.length} relevés donnent un solde au 31/12/${d.annee} : un seul compte, ou plusieurs ?`
  } else {
    attendu = soldes[0]
  }

  // LES CAUSES POSSIBLES D'UN ÉCART, sans en choisir une — dès que la preuve ne tombe pas juste. Le 512 du 31 décembre
  // cumule tout depuis l'ouverture : chaque cause se compte depuis la reprise, jusqu'au 31 décembre.
  if (attendu === null || attendu !== soldeCentimes) {
    const reprise = dateDeLaReprise(d)
    const ouvre = ouvertureDeLExercice(d.reprise, d.reportes, d.annee).some((a) => a.compte === compte)
    // Le premier relevé de la TENUE du dossier : celui qui commence au plus tôt parmi ceux qui finissent APRÈS le jour de
    // la reprise. Un relevé plus ancien est dans les comptes repris, et son solde initial ne dit rien de l'ouverture ; celui
    // qui finit le jour même aussi : son solde de clôture, daté de ce jour, est l'ouverture — comme le solde initial d'un
    // relevé qui commence le 1er janvier est celui de la fin du 31 décembre.
    const premier = d.controlesReleves
      .filter((c) => c.periode_debut !== null && (reprise === null || c.periode_fin === null || c.periode_fin > reprise))
      .sort(parPeriode)[0]
    if (premier && centimes(premier.solde_initial) !== 0) {
      const initial = centimes(premier.solde_initial)
      if (attendu !== null && soldeCentimes - attendu === -initial) {
        faits.push(fait('ecart-egal-solde-initial',
          `L’écart est exactement le solde initial du premier relevé du dossier (${soldeEnMots(initial)} au ${formatDate(premier.periode_debut)}) : `
          + (ouvre ? 'l’ouverture du dossier ne le porte pas.' : `l’exercice n’a pas d’ouverture sur le ${compte}, qui part de zéro.`),
          initial, null))
      } else if (!ouvre) {
        faits.push(fait('ouverture-absente',
          `L’exercice n’a pas d’ouverture sur le ${compte}, et le premier relevé du dossier commence à ${soldeEnMots(initial)} : sans balance reprise, le ${compte} part de zéro.`,
          initial, null))
      }
    }
    const depuisLaReprise = (date: string) => date <= fin && (reprise === null || date >= reprise)
    const ignores = mouvementsIgnoresHorsFec(d.lignes, reprise, null).filter((l) => l.date <= fin)
    if (ignores.length > 0) {
      const net = ignores.reduce((s, l) => s + centimes(l.montant), 0)
      // Les deux sens à part (`montantsDesMouvementsIgnores`) : leur net seul cacherait un encaissement derrière un
      // paiement du même montant.
      faits.push(fait('mouvements-ignores',
        `${pluriel(ignores.length, 'mouvement ignoré', 'mouvements ignorés')} jusqu’au 31/12/${d.annee} (${montantsDesMouvementsIgnores(ignores) ?? 'aucun montant'}), ${soldeEnMots(net)} au net : un doublon le reste, un mouvement réel manque au ${compte}.`,
        net, ignores.length))
    }
    const aTraiter = d.lignes.filter((l) => l.statut === 'non_rapprochee' && depuisLaReprise(l.date))
    if (aTraiter.length > 0) {
      const net = aTraiter.reduce((s, l) => s + centimes(l.montant), 0)
      faits.push(fait('mouvements-a-traiter',
        `${pluriel(aTraiter.length, 'mouvement', 'mouvements')} à traiter jusqu’au 31/12/${d.annee}, ${soldeEnMots(net)} au net : ${accord(aTraiter.length, 'son', 'leur')} écriture manque au ${compte}.`,
        net, aTraiter.length))
    }
    const sansMouvement = d.ecritures.filter((e) => e.compte === compte && !e.ligne_bancaire_id && depuisLaReprise(e.date))
    if (sansMouvement.length > 0) {
      const net = sommeEcritures(sansMouvement)
      faits.push(fait('banque-sans-mouvement',
        `${pluriel(sansMouvement.length, 'écriture', 'écritures')} du ${compte} jusqu’au 31/12/${d.annee} ${accord(sansMouvement.length, 'ne désigne', 'ne désignent')} aucun mouvement du relevé, ${soldeEnMots(net)} au net.`,
        net, sansMouvement.length))
    }
  }
  return conclure('releve', compte, d.annee, soldeCentimes, attendu, verdictForce, raison, faits, detail, sources)
}

// ── Les virements internes (580000) ───────────────────────────────────────────────────────────────────────────────

function preuveDesVirementsInternes(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  if (soldeCentimes === 0) return conclure('virements-internes', compte, d.annee, soldeCentimes, 0, null, null, [], [], [])
  // Un virement sort d'un compte et entre dans l'autre : au 580000, un débit et un crédit du même montant. On apparie
  // chaque montant dans l'ordre des dates ; ce qui reste n'a pas de contrepartie dans l'exercice.
  type Ligne = { date: string; centimes: number; reference: LigneDeDetail['reference'] }
  const lignes: Ligne[] = [
    ...ouvertureDeLExercice(d.reprise, d.reportes, d.annee).filter((a) => a.compte === compte).map((a) => ({
      date: a.date, centimes: signe(a) * centimes(a.montant),
      reference: { type: (d.reportes.some((s) => s.id === a.id) ? 'solde-reporte' : 'a-nouveau') as TypeDeReference, id: a.id },
    })),
    ...ecrituresDeLExercice(d).filter((e) => e.compte === compte).map((e) => ({
      date: e.date, centimes: signe(e) * centimes(e.montant), reference: { type: 'ecriture' as const, id: e.id },
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.reference?.id ?? '').localeCompare(b.reference?.id ?? ''))
  const restants: Ligne[] = []
  const enAttente = new Map<number, Ligne[]>()
  for (const l of lignes) {
    const opposees = enAttente.get(-l.centimes)
    if (opposees && opposees.length > 0) {
      opposees.shift()
      continue
    }
    enAttente.set(l.centimes, [...(enAttente.get(l.centimes) ?? []), l])
  }
  for (const attente of enAttente.values()) restants.push(...attente)
  restants.sort((a, b) => a.date.localeCompare(b.date) || (a.reference?.id ?? '').localeCompare(b.reference?.id ?? ''))
  const detail = restants.map((l) => ({
    libelle: `${l.reference?.type === 'ecriture' ? 'Virement' : 'Ouverture'} du ${formatDate(l.date)} : ${soldeEnMots(l.centimes)}, sans contrepartie`,
    montantCentimes: l.centimes, reference: l.reference,
  }))
  const faits = [fait('virements-sans-contrepartie',
    `${pluriel(restants.length, 'ligne', 'lignes')} du compte sans contrepartie de même montant dans l’exercice : le compte n’est pas soldé.`,
    restants.reduce((s, l) => s + l.centimes, 0), restants.length)]
  return conclure('virements-internes', compte, d.annee, soldeCentimes, 0, null, null, faits, detail, [])
}

// ── Le registre des immobilisations (20…, 21…, 28…) ──────────────────────────────────────────────────────────────

function biensSansNature(d: DonneesDesPreuves, fin: string): Immobilisation[] {
  const natures = new Set(d.natures.map((n) => n.id))
  return d.immobilisations.filter((b) => b.date_acquisition <= fin && (!b.nature_id || !natures.has(b.nature_id)))
}

// LA VALEUR BRUTE : le registre, pas l'écriture. L'acquisition s'écrit au montant de la FACTURE et les dotations sur la
// valeur du REGISTRE (lib/amortissements.ts) : quand les deux diffèrent, le compte du bien ne se recoupe plus avec son
// amortissement. La preuve compare donc le compte au registre, et dit la facture qui en diffère.
function preuveDuRegistreValeurs(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  const naturesDuCompte = new Set(d.natures.filter((n) => n.compte_immobilisation === compte).map((n) => n.id))
  const biens = d.immobilisations
    .filter((b) => b.nature_id !== null && naturesDuCompte.has(b.nature_id) && b.date_acquisition <= fin)
    .sort((a, b) => a.date_acquisition.localeCompare(b.date_acquisition) || a.id.localeCompare(b.id))
  const attendu = biens.reduce((s, b) => s + centimes(b.valeur), 0)
  const detail: LigneDeDetail[] = biens.map((b) => ({
    libelle: `Bien acquis le ${formatDate(b.date_acquisition)}`, montantCentimes: centimes(b.valeur), reference: { type: 'bien', id: b.id },
  }))
  // LE REGISTRE SE SOUVIENT DE LUI-MÊME (§ 3.7) : chaque bien, tant qu'il y est, repropose sa facture chaque année.
  const sources: SourceProposee[] = biens.filter((b) => b.piece_id !== null).map((b) => ({
    pieceId: b.piece_id, documentId: null, raison: `La facture du bien acquis le ${formatDate(b.date_acquisition)}.`,
  }))
  const faits: FaitDeLaPreuve[] = []
  if (attendu !== soldeCentimes) {
    const reprise = dateDeLaReprise(d)
    const ecritures = ecrituresDeLExercice(d).filter((e) => e.compte === compte)
    const piecesDesBiens = new Set(biens.map((b) => b.piece_id).filter((p): p is string => p !== null))
    // Un bien sans facture n'a pas d'acquisition à écrire (lib/amortissements.ts) : il se dit à part, plus bas.
    const nonEcrites = biens.filter((b) => b.piece_id !== null && b.date_acquisition >= debut
      && (reprise === null || b.date_acquisition >= reprise) && !ecritures.some((e) => e.piece_id === b.piece_id))
    if (nonEcrites.length > 0) {
      faits.push(fait('acquisitions-non-ecrites',
        `${pluriel(nonEcrites.length, 'bien acquis', 'biens acquis')} dans l’exercice sans écriture d’acquisition de l’exercice sur ce compte — un paiement après le 31 décembre, ou une écriture à générer.`,
        nonEcrites.reduce((s, b) => s + centimes(b.valeur), 0), nonEcrites.length))
    }
    const pieces = new Map(d.pieces.map((p) => [p.id, p]))
    const differentes = biens.filter((b) => b.piece_id !== null
      && montantDeFactureDifferent(b, pieces.get(b.piece_id), d.assujettiTva, reprise) !== null)
    if (differentes.length > 0) {
      faits.push(fait('facture-differente',
        `${pluriel(differentes.length, 'bien', 'biens')} dont la facture ne porte pas la valeur du registre : l’acquisition s’écrit au montant de la facture.`,
        null, differentes.length))
    }
    const horsRegistre = ecritures.filter((e) => e.piece_id === null || !piecesDesBiens.has(e.piece_id))
    if (horsRegistre.length > 0) {
      faits.push(fait('lignes-hors-registre',
        `${pluriel(horsRegistre.length, 'écriture', 'écritures')} de l’exercice sur ce compte sans bien du registre rangé à ce compte, ${soldeEnMots(sommeEcritures(horsRegistre))}.`,
        sommeEcritures(horsRegistre), horsRegistre.length))
    }
    const sansPiece = biens.filter((b) => b.piece_id === null)
    if (sansPiece.length > 0) {
      faits.push(fait('biens-sans-justificatif',
        `${pluriel(sansPiece.length, 'bien', 'biens')} du compte sans facture : ${accord(sansPiece.length, 'son justificatif a été supprimé', 'leurs justificatifs ont été supprimés')}.`, null, sansPiece.length))
    }
    const sansNature = biensSansNature(d, fin)
    if (sansNature.length > 0) {
      faits.push(fait('biens-sans-nature',
        `${pluriel(sansNature.length, 'bien', 'biens')} du registre sans nature : ${accord(sansNature.length, 'son compte n’est pas connu, et aucun compte ne l’attend', 'leur compte n’est pas connu, et aucun compte ne les attend')}.`,
        sansNature.reduce((s, b) => s + centimes(b.valeur), 0), sansNature.length))
    }
  }
  return conclure('registre-valeurs', compte, d.annee, soldeCentimes, attendu, null, null, faits, detail, sources)
}

function preuveDuRegistreAmortissements(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const fin = `${d.annee}-12-31`
  const naturesDuCompte = new Set(d.natures.filter((n) => compteAmortissement(n.compte_immobilisation) === compte).map((n) => n.id))
  const biens = d.immobilisations
    .filter((b) => b.nature_id !== null && naturesDuCompte.has(b.nature_id) && miseEnService(b) <= fin)
    .sort((a, b) => miseEnService(a).localeCompare(miseEnService(b)) || a.id.localeCompare(b.id))
  const cumulDe = (b: Immobilisation) => Number(amortissementCumuleCentimes(b, rang360(fin)))
  // Un amortissement est au crédit : ce que la preuve attend est négatif.
  const attendu = oppose(biens.reduce((s, b) => s + cumulDe(b), 0))
  const detail: LigneDeDetail[] = biens.map((b) => ({
    libelle: `Bien mis en service le ${formatDate(miseEnService(b))} : amortissements cumulés au 31/12/${d.annee}`,
    montantCentimes: oppose(cumulDe(b)), reference: { type: 'bien', id: b.id },
  }))
  const faits: FaitDeLaPreuve[] = []
  if (attendu !== soldeCentimes) {
    const reprise = dateDeLaReprise(d)
    const ids = new Set(biens.map((b) => b.id))
    const enDefaut = dotationsDuRegistre(d.immobilisations, d.natures, d.ecritures, reprise, d.anneeCourante,
      frontiereDeValidation(d.exercicesValides.map((e) => e.annee)))
      .filter((x) => x.annee === d.annee && ids.has(x.immobilisation.id) && x.etat !== 'ecrite')
    if (enDefaut.length > 0) {
      faits.push(fait('dotations-en-defaut',
        `${pluriel(enDefaut.length, 'dotation', 'dotations')} de l’exercice à écrire, à réécrire ou à retirer : l’écriture ne suit pas le registre.`,
        null, enDefaut.length))
    }
    const horsRegistre = ecrituresDeLExercice(d).filter((e) => e.compte === compte && (!e.immobilisation_id || !ids.has(e.immobilisation_id)))
    if (horsRegistre.length > 0) {
      faits.push(fait('lignes-hors-registre',
        `${pluriel(horsRegistre.length, 'écriture', 'écritures')} de l’exercice sur ce compte sans bien du registre amorti à ce compte, ${soldeEnMots(sommeEcritures(horsRegistre))}.`,
        sommeEcritures(horsRegistre), horsRegistre.length))
    }
    const repris = biens.filter((b) => reprise !== null && b.date_acquisition < reprise)
    if (repris.length > 0) {
      faits.push(fait('biens-repris',
        `${pluriel(repris.length, 'bien acquis', 'biens acquis')} avant la reprise du dossier : ${accord(repris.length, 'son', 'leur')} amortissement antérieur est celui de la balance reprise, que la preuve recalcule.`,
        null, repris.length))
    }
    const sansNature = biensSansNature(d, fin)
    if (sansNature.length > 0) {
      faits.push(fait('biens-sans-nature',
        `${pluriel(sansNature.length, 'bien', 'biens')} du registre sans nature : ${accord(sansNature.length, 'son', 'leur')} compte d’amortissement n’est pas connu.`,
        null, sansNature.length))
    }
  }
  return conclure('registre-amortissements', compte, d.annee, soldeCentimes, attendu, null, null, faits, detail, [])
}

// ── L'échéancier des emprunts (164000) ────────────────────────────────────────────────────────────────────────────

function preuveDeLEcheancier(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  // Un emprunt qui commence après le 31 décembre n'existe pas encore à cette date ; `capitalRestantDu` rendrait son
  // capital entier. La date passe EXPLICITEMENT : la valeur par défaut de la fonction est aujourd'hui.
  const emprunts = d.emprunts.filter((e) => e.date_debut <= fin)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut) || a.id.localeCompare(b.id))
  const restantDu = (e: Emprunt) => centimes(capitalRestantDu(e, fin))
  const attendu = oppose(emprunts.reduce((s, e) => s + restantDu(e), 0))
  const detail: LigneDeDetail[] = emprunts.map((e) => ({
    libelle: `Emprunt du ${formatDate(e.date_debut)}, ${enEuros(centimes(e.capital_initial))} sur ${e.duree_mois} mois : capital restant dû au 31/12/${d.annee}`,
    montantCentimes: oppose(restantDu(e)), reference: { type: 'emprunt', id: e.id },
  }))
  const faits: FaitDeLaPreuve[] = []
  if (attendu !== soldeCentimes) {
    const manquantes = echeancesNonRapprochees(emprunts, d.lignes, debut, fin)
    if (manquantes.length > 0) {
      const capital = manquantes.reduce((s, x) => s + centimes(x.echeance.capitalRembourse), 0)
      faits.push(fait('echeances-non-rapprochees',
        `${pluriel(manquantes.length, 'échéance', 'échéances')} de l’exercice qu’aucun mouvement ne paie : ${accord(manquantes.length, 'son', 'leur')} capital (${enEuros(capital)}) n’est pas déduit du ${compte}.`,
        capital, manquantes.length))
    }
    // LE CAPITAL REÇU : l'échéancier suppose le capital entier débloqué ; le 164000 ne reçoit que les déblocages
    // rapprochés (lib/echeanceEmprunt.ts). Un déblocage absent, partiel ou rapproché deux fois se dit, emprunt par
    // emprunt — sauf pour un emprunt antérieur à la reprise, que la balance reprise porte déjà.
    const reprise = dateDeLaReprise(d)
    const debloque = new Map<string, number>()
    for (const l of d.lignes) {
      if (l.emprunt_id && l.montant > 0 && l.statut === 'rapprochee' && l.date <= fin) {
        debloque.set(l.emprunt_id, (debloque.get(l.emprunt_id) ?? 0) + centimes(l.montant))
      }
    }
    const ecarts = emprunts.filter((e) => reprise === null || e.date_debut >= reprise)
      .map((e) => centimes(e.capital_initial) - (debloque.get(e.id) ?? 0))
      .filter((manque) => manque !== 0)
    if (ecarts.length > 0) {
      const manque = ecarts.reduce((s, x) => s + x, 0)
      faits.push(fait('deblocages-ecart',
        `${pluriel(ecarts.length, 'emprunt', 'emprunts')} dont les déblocages rapprochés au 31/12/${d.annee} ne font pas le capital emprunté (${enEuros(manque)} ${manque > 0 ? 'manquent' : 'de trop'}) : un déblocage non rapproché, rapproché deux fois, ou versé ailleurs qu’au compte bancaire.`,
        manque, ecarts.length))
    }
    const lignesEmprunt = new Set(d.lignes.filter((l) => l.emprunt_id).map((l) => l.id))
    const horsEmprunt = ecrituresDeLExercice(d).filter((e) => e.compte === compte && (!e.ligne_bancaire_id || !lignesEmprunt.has(e.ligne_bancaire_id)))
    if (horsEmprunt.length > 0) {
      faits.push(fait('lignes-hors-emprunt',
        `${pluriel(horsEmprunt.length, 'écriture', 'écritures')} de l’exercice sur ce compte sans mouvement rapproché d’un emprunt, ${soldeEnMots(sommeEcritures(horsEmprunt))}.`,
        sommeEcritures(horsEmprunt), horsEmprunt.length))
    }
  }
  return conclure('echeancier', compte, d.annee, soldeCentimes, attendu, null, null, faits, detail, [])
}

// ── Les déclarations de TVA (445…) ────────────────────────────────────────────────────────────────────────────────

// Ce que la liquidation d'une déclaration porte au 445510 et au 445830 (lib/liquidationTva.ts) : les lignes 28 et 26 de
// sa CA3 — la ligne 32, ce qui se paie, vaut la ligne 28 dans la CA3 de l'application. Une déclaration saisie à la main
// n'a pas de liquidation — sa TVA est dans les à-nouveaux — : ce qu'elle fait payer est sa TVA nette moins le crédit
// reçu (`aPayerDe`), son remboursement celui qu'elle a demandé.
function aPayerAuCompte(x: DeclarationTva): number {
  return x.cases ? centimes(Number(x.cases.l28 ?? 0)) : centimes(Math.max(x.tva_declaree - x.credit_anterieur, 0))
}
function remboursementAuCompte(x: DeclarationTva): number {
  return x.cases ? centimes(Number(x.cases.l26 ?? 0)) : centimes(x.remboursement_demande)
}

function preuveDesDeclarations(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const fin = `${d.annee}-12-31`
  const declarees = d.declarationsTva.filter((x) => x.periode_fin <= fin)
    .sort((a, b) => a.periode_fin.localeCompare(b.periode_fin) || a.id.localeCompare(b.id))
  const mouvementsDe = (x: DeclarationTva) =>
    d.lignes.filter((l) => l.declaration_tva_id === x.id && l.statut === 'rapprochee' && l.date <= fin)
  const nom = (x: DeclarationTva) => `Déclaration ${libellePeriode(x.periode_debut, x.periode_fin)}`
  const detail: LigneDeDetail[] = []
  let attendu = 0
  if (compte === COMPTE_TVA_A_DECAISSER) {
    // Au crédit : ce qui reste à payer au 31 décembre de chaque déclaration — la dernière période, payée en janvier.
    for (const x of declarees) {
      const paye = mouvementsDe(x).filter((l) => l.montant < 0).reduce((s, l) => s - centimes(l.montant), 0)
      const reste = aPayerAuCompte(x) - paye
      attendu -= reste
      if (reste !== 0) detail.push({ libelle: `${nom(x)} : reste à payer au 31/12/${d.annee}`, montantCentimes: -reste, reference: { type: 'declaration', id: x.id } })
    }
  } else if (compte === COMPTE_CREDIT_TVA_A_REPORTER) {
    // Au débit : le crédit que reporte la dernière déclaration — chaque liquidation porte le crédit nouveau moins celui
    // qu'elle a reçu, et leur somme est le dernier reporté.
    const derniere = declarees[declarees.length - 1]
    if (derniere) {
      attendu = centimes(creditReporte(derniere))
      if (attendu !== 0) detail.push({ libelle: `${nom(derniere)} : crédit reporté`, montantCentimes: attendu, reference: { type: 'declaration', id: derniere.id } })
    }
  } else if (compte === COMPTE_REMBOURSEMENT_TVA_DEMANDE) {
    // Au débit : le remboursement demandé et non encore reçu au 31 décembre.
    for (const x of declarees) {
      const recu = mouvementsDe(x).filter((l) => l.montant > 0).reduce((s, l) => s + centimes(l.montant), 0)
      const reste = remboursementAuCompte(x) - recu
      attendu += reste
      if (reste !== 0) detail.push({ libelle: `${nom(x)} : remboursement attendu au 31/12/${d.annee}`, montantCentimes: reste, reference: { type: 'declaration', id: x.id } })
    }
  }
  // La TVA collectée et déductible : soldée par chaque liquidation, donc nulle quand toutes les périodes sont déclarées —
  // et quand chaque TVA est exigible dans la période de son écriture.
  const faits: FaitDeLaPreuve[] = []
  if (attendu !== soldeCentimes) {
    let causes = 0
    if (!d.assujettiTva) {
      faits.push(fait('non-redevable', 'Le dossier n’est pas redevable : aucune déclaration n’est attendue pour solder ce compte.', null, null))
      causes++
    } else {
      const manquantes = periodesNonDeclarees(d.declarationsTva, d.annee, d.periodiciteTva, `${d.annee + 1}-01-01`, dateDeLaReprise(d))
      if (manquantes.length > 0) {
        faits.push(fait('periodes-non-declarees',
          `${pluriel(manquantes.length, 'période', 'périodes')} de l’exercice sans déclaration enregistrée (${manquantes.map((p) => p.libelle).join(', ')}) : ${accord(manquantes.length, 'sa', 'leur')} TVA reste aux comptes 4457 et 4456.`,
          null, manquantes.length))
        causes++
      }
    }
    const frontiere = frontiereDeValidation(d.exercicesValides.map((e) => e.annee))
    const liquidations = liquidationsDesynchronisees(d.ecritures, declarees.filter((x) => x.periode_fin >= `${d.annee}-01-01`), frontiere)
    if (liquidations.length > 0) {
      faits.push(fait('liquidations-a-reecrire',
        `${pluriel(liquidations.length, 'déclaration', 'déclarations')} de l’exercice dont l’écriture de liquidation manque ou ne suit plus la déclaration.`,
        null, liquidations.length))
      causes++
    }
    const paiements = paiementsTvaDesynchronises(d.ecritures, d.lignes.filter((l) => l.date >= `${d.annee}-01-01` && l.date <= fin), frontiere)
    if (paiements.length > 0) {
      faits.push(fait('paiements-a-reecrire',
        `${pluriel(paiements.length, 'paiement ou remboursement', 'paiements ou remboursements')} de TVA de l’exercice dont l’écriture ne suit plus le mouvement.`,
        null, paiements.length))
      causes++
    }
    // Rien de ce qui précède ne l'explique : la cause qui reste possible sur une TVA que la liquidation solde.
    if (causes === 0 && COMPTES_DE_TVA_SOLDES.includes(compte)) {
      faits.push(fait('exigibilite-decalee',
        `Toutes les périodes de l’exercice sont déclarées et liquidées : le solde peut venir d’une TVA qui n’est pas exigible dans la période de son écriture — une facture réglée après le 31 décembre${d.modele.mode === 'engagement' ? ', ou toute facture non réglée d’un dossier en engagement' : ''} —, que la preuve ne calcule pas.`,
        null, null))
    }
  }
  return conclure('declarations-tva', compte, d.annee, soldeCentimes, attendu, null, null, faits, detail, [])
}

// ── L'ouverture de l'exercice (101000) ────────────────────────────────────────────────────────────────────────────

function preuveDeLOuverture(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const anneesValidees = d.exercicesValides.map((e) => e.annee)
  const etat = etatDeLOuverture(d.annee, { reprise: d.reprise, reportes: d.reportes, anneesValidees, ecritures: d.ecritures })
  const ouverture = ouvertureDeLExercice(d.reprise, d.reportes, d.annee).filter((a) => a.compte === compte)
  const attendu = sommeEcritures(ouverture)
  const ecritures = ecrituresDeLExercice(d).filter((e) => e.compte === compte)
  const faits: FaitDeLaPreuve[] = []
  const detail: LigneDeDetail[] = []
  if (ecritures.length > 0) {
    faits.push(fait('ecritures-sur-le-compte',
      `${pluriel(ecritures.length, 'écriture', 'écritures')} de l’exercice ${accord(ecritures.length, 'modifie', 'modifient')} l’ouverture du compte, ${soldeEnMots(sommeEcritures(ecritures))}.`,
      sommeEcritures(ecritures), ecritures.length))
  }
  switch (etat.type) {
    case 'en-attente':
      faits.unshift(fait('ouverture-en-attente', `L’ouverture de l’exercice attend la validation de l’exercice ${etat.exercice}.`, null, null))
      return conclure('ouverture', compte, d.annee, soldeCentimes, null, 'incomplete',
        `l’ouverture attend la validation de l’exercice ${etat.exercice}.`, faits, detail, [])
    case 'reprise':
      // La balance reprise se désigne par son EMPREINTE, jamais par le nom de son fichier.
      for (const a of ouverture) {
        detail.push({
          libelle: `Balance reprise au ${formatDate(a.date)}, empreinte ${a.source_empreinte.slice(0, 16)}…`,
          montantCentimes: signe(a) * centimes(a.montant), reference: { type: 'a-nouveau', id: a.id },
        })
      }
      return conclure('ouverture', compte, d.annee, soldeCentimes, attendu, null, null, faits, detail, [])
    case 'sans-objet':
      // Rien ne précède l'exercice : le compte n'a pas d'ouverture, et ne doit rien porter d'autre.
      return conclure('ouverture', compte, d.annee, soldeCentimes, 0, null, null, faits, detail, [])
    case 'report': {
      const valide = d.exercicesValides.find((e) => e.annee === d.annee - 1)
      // LE MAILLON : chaque solde reporté porte l'empreinte de l'exercice validé dont il vient (`valider_exercice`).
      const chaine = valide !== undefined && ouverture.every((a) => a.source_empreinte === valide.empreinte)
      for (const a of ouverture) {
        detail.push({
          libelle: `Solde reporté de l’exercice ${d.annee - 1} validé`, montantCentimes: signe(a) * centimes(a.montant),
          reference: { type: 'solde-reporte', id: a.id },
        })
      }
      if (!chaine) {
        faits.push(fait('maillon-rompu',
          `Un solde reporté ne porte pas l’empreinte de l’exercice ${d.annee - 1} validé : l’ouverture n’est pas celle que sa validation a écrite.`, null, null))
      }
      if (d.verificationPrecedent === null) {
        faits.push(fait('empreinte-a-verifier', `L’empreinte de l’exercice ${d.annee - 1} n’a pas été vérifiée : « Vérifier l’empreinte ».`, null, null))
      } else if (d.verificationPrecedent) {
        faits.push(fait('empreinte-intacte', `L’exercice ${d.annee - 1} se relit tel qu’il a été validé : son empreinte est intacte.`, null, null))
      } else {
        faits.push(fait('empreinte-alteree', `L’exercice ${d.annee - 1} ne se relit plus tel qu’il a été validé : son empreinte est altérée.`, null, null))
      }
      // Les montants d'abord ; puis le maillon et l'empreinte, qui peuvent faire tomber une preuve aux montants justes.
      const ecart = soldeCentimes !== attendu || !chaine || d.verificationPrecedent === false
      const verdict: VerdictDePreuve | null = ecart ? 'ecart' : d.verificationPrecedent === null ? 'incomplete' : null
      const raison = !chaine ? 'le maillon avec l’exercice précédent est rompu.'
        : d.verificationPrecedent === false ? `l’empreinte de l’exercice ${d.annee - 1} est altérée.`
          : d.verificationPrecedent === null ? `l’empreinte de l’exercice ${d.annee - 1} reste à vérifier.` : null
      return conclure('ouverture', compte, d.annee, soldeCentimes, attendu, verdict, raison, faits, detail, [])
    }
  }
}

// ── La composition du compte de l'exploitant (108000) ─────────────────────────────────────────────────────────────

export type PartDeLExploitant =
  | 'ouverture' | 'prelevements' | 'apports' | 'csg-crds' | 'cotisations-payees-personnellement' | 'forfaits-kilometriques'
  | 'notes-de-frais' | 'parts-personnelles' | 'mouvements-affectes' | 'pieces' | 'autres'

export const LIBELLES_DES_PARTS: Readonly<Record<PartDeLExploitant, string>> = {
  ouverture: 'Ouverture de l’exercice',
  prelevements: 'Prélèvements du relevé',
  apports: 'Apports du relevé',
  'csg-crds': 'CSG-CRDS des cotisations prélevées',
  'cotisations-payees-personnellement': 'Cotisations payées depuis le compte personnel',
  'forfaits-kilometriques': 'Forfaits kilométriques',
  'notes-de-frais': 'Notes de frais payées par l’exploitant',
  'parts-personnelles': 'Parts personnelles des ventilations',
  'mouvements-affectes': 'Mouvements affectés à ce compte',
  pieces: 'Pièces rangées à ce compte',
  autres: 'Autres écritures',
}

// La source d'une écriture du compte de l'exploitant, lue sur ce qui l'a produite — une écriture n'a qu'une source
// (`ecritures_brouillon_*_sans_autre_source`), et un mouvement qu'un lien (`lignes_bancaires_un_seul_rapprochement`).
function partDeLEcriture(e: EcritureBrouillon, lignes: ReadonlyMap<string, LigneBancaire>, pieces: ReadonlyMap<string, PiecePourRevision>): PartDeLExploitant {
  if (e.cotisation_id) return 'cotisations-payees-personnellement'
  if (e.vehicule_id) return 'forfaits-kilometriques'
  if (e.ligne_bancaire_id) {
    const l = lignes.get(e.ligne_bancaire_id)
    if (!l) return 'autres'
    if (l.prelevement_personnel) return e.sens === 'debit' ? 'prelevements' : 'apports'
    if (l.cotisation_id) return 'csg-crds'
    if (l.ventilee) return 'parts-personnelles'
    if (l.categorie_id) return 'mouvements-affectes'
    return 'autres'
  }
  if (e.piece_id) return pieces.get(e.piece_id)?.type_piece === 'note_frais' ? 'notes-de-frais' : 'pieces'
  return 'autres'
}

function compositionDeLExploitant(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  const lignes = new Map(d.lignes.map((l) => [l.id, l]))
  const pieces = new Map(d.pieces.map((p) => [p.id, p]))
  const parts = new Map<PartDeLExploitant, { nombre: number; centimes: number }>()
  const ajouter = (part: PartDeLExploitant, c: number) => {
    const p = parts.get(part) ?? { nombre: 0, centimes: 0 }
    parts.set(part, { nombre: p.nombre + 1, centimes: p.centimes + c })
  }
  for (const a of ouvertureDeLExercice(d.reprise, d.reportes, d.annee)) if (a.compte === compte) ajouter('ouverture', signe(a) * centimes(a.montant))
  for (const e of ecrituresDeLExercice(d)) if (e.compte === compte) ajouter(partDeLEcriture(e, lignes, pieces), signe(e) * centimes(e.montant))
  const ordre = Object.keys(LIBELLES_DES_PARTS) as PartDeLExploitant[]
  const detail: LigneDeDetail[] = ordre.flatMap((p) => {
    const part = parts.get(p)
    return part === undefined ? [] : [{ libelle: `${LIBELLES_DES_PARTS[p]} (${part.nombre})`, montantCentimes: part.centimes, reference: null }]
  })
  return conclure('decomposition-exploitant', compte, d.annee, soldeCentimes, null, 'decrit',
    detail.length === 0 ? 'aucune écriture.' : `${pluriel(detail.length, 'source', 'sources')}, ${soldeEnMots(soldeCentimes)} en tout.`,
    [], detail, [])
}

// ── La preuve d'un compte ─────────────────────────────────────────────────────────────────────────────────────────

/** La preuve que l'application propose pour un compte de bilan, à son solde de fin d'exercice (en centimes). */
export function preuveDuCompte(compte: string, soldeCentimes: number, d: DonneesDesPreuves): PreuveProposee {
  switch (typeDePreuveDuCompte(compte)) {
    case 'releve': return preuveDuReleve(compte, soldeCentimes, d)
    case 'virements-internes': return preuveDesVirementsInternes(compte, soldeCentimes, d)
    case 'registre-valeurs': return preuveDuRegistreValeurs(compte, soldeCentimes, d)
    case 'registre-amortissements': return preuveDuRegistreAmortissements(compte, soldeCentimes, d)
    case 'echeancier': return preuveDeLEcheancier(compte, soldeCentimes, d)
    case 'declarations-tva': return preuveDesDeclarations(compte, soldeCentimes, d)
    case 'ouverture': return preuveDeLOuverture(compte, soldeCentimes, d)
    case 'decomposition-exploitant': return compositionDeLExploitant(compte, soldeCentimes, d)
    case 'aucune': return conclure('aucune', compte, d.annee, soldeCentimes, null, 'sans-preuve', null, [], [], [])
  }
}

/** Une preuve qui peut justifier un solde SEULE : celle qui tombe juste. Les autres s'accompagnent d'une pièce. */
export function preuveSuffisanteSeule(p: Pick<PreuveProposee, 'verdict'>): boolean {
  return p.verdict === 'concorde'
}

// ── Le texte d'un jsonb, mesuré comme la base le mesure ───────────────────────────────────────────────────────────

// LA BASE BORNE L'INSTANTANÉ À 64 KIO DE SON TEXTE JSONB (`octet_length(preuve_application::text)`, refus 12 de
// `justifier_solde` et contrainte de la table), PAS DE SON TEXTE JSON : jsonb réécrit ce qu'il reçoit. Il range les
// clés d'un objet de la plus courte à la plus longue, en octets, puis octet par octet ; il écrit « , » et « : » suivis
// d'une espace ; il écrit un nombre en décimal, sans exposant (1e-7 devient 0.0000001) ; il échappe une chaîne comme
// JSON.stringify — guillemet, barre oblique inverse, caractères de commande —, sans toucher au reste. Relevé en base
// (`revisionPreuves.test.ts`, la table relevée, rejouée le 10/10/2026 octet pour octet). Ce qui part est ce que
// supabase-js envoie : la valeur passée par JSON.stringify — une clé dont la valeur est `undefined` disparaît, NaN
// devient `null`.
const encodeur = new TextEncoder()

function nombreJsonb(n: number): string {
  const texte = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(texte)
  if (!m) return texte
  const [, signeTexte, entier, fraction = '', exposant] = m
  const chiffres = entier + fraction
  const virgule = entier.length + Number(exposant)
  // JavaScript n'écrit en exposant qu'à partir de 10²¹ et en deçà de 10⁻⁶ : la virgule tombe alors après tous les
  // chiffres significatifs (dix-sept au plus), ou avant eux — jamais entre deux.
  return virgule > 0
    ? `${signeTexte}${chiffres}${'0'.repeat(virgule - chiffres.length)}`
    : `${signeTexte}0.${'0'.repeat(-virgule)}${chiffres}`
}

function ordreJsonb(a: string, b: string): number {
  const x = encodeur.encode(a)
  const y = encodeur.encode(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

function ecrireJsonb(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return nombreJsonb(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(ecrireJsonb).join(', ')}]`
  const objet = v as Record<string, unknown>
  return `{${Object.keys(objet).sort(ordreJsonb).map((c) => `${JSON.stringify(c)}: ${ecrireJsonb(objet[c])}`).join(', ')}}`
}

/** Le texte que la base écrit d'une valeur reçue en jsonb ; nul pour ce que JSON.stringify n'écrit pas (`undefined`). */
export function texteJsonb(valeur: unknown): string | null {
  const json = JSON.stringify(valeur)
  if (json === undefined) return null
  return ecrireJsonb(JSON.parse(json))
}

/** Les octets de ce texte, en UTF-8 : ce que `octet_length` compte. */
export function octetsJsonb(valeur: unknown): number {
  const texte = texteJsonb(valeur)
  return texte === null ? 0 : encodeur.encode(texte).length
}

// ── L'instantané d'une preuve ─────────────────────────────────────────────────────────────────────────────────────

// CE QUE L'ÉCRAN A MONTRÉ AU CLIC, GARDÉ AVEC LA DÉCISION (`revision_justifications.preuve_application`). Versionné, et
// relu sans deviner : un instantané illisible ne s'affiche pas comme une preuve vide, l'écran le dit. Il porte les
// textes tels qu'ils ont été lus — ce que la preuve établissait et n'établissait pas ce jour-là ne doit pas suivre une
// évolution du module —, et les références de ses lignes, jamais un nom. Le détail se borne pour que l'instantané tienne
// sous la borne de la base, et ce qui en est omis se compte : une liste plafonnée dit qu'elle l'est.
export interface InstantaneDePreuve {
  version: 1
  type: Exclude<TypeDePreuve, 'aucune'>
  compte: string
  annee: number
  verdict: VerdictDePreuve
  soldeCentimes: number
  attenduCentimes: number | null
  ecartCentimes: number | null
  titre: string
  etablit: string
  netablitPas: string
  resume: string
  faits: FaitDeLaPreuve[]
  detail: LigneDeDetail[]
  detailOmis: number
  sources: SourceProposee[]
}

/** L'instantané d'une preuve, sous la borne de la base ; nul pour un compte sans preuve — il n'y a rien à garder. */
export function instantaneDeLaPreuve(p: PreuveProposee): InstantaneDePreuve | null {
  if (p.type === 'aucune') return null
  const type = p.type
  const avec = (gardees: number): InstantaneDePreuve => ({
    version: 1, type, compte: p.compte, annee: p.annee, verdict: p.verdict, soldeCentimes: p.soldeCentimes,
    attenduCentimes: p.attenduCentimes, ecartCentimes: p.ecartCentimes, titre: p.titre, etablit: p.etablit,
    netablitPas: p.netablitPas, resume: p.resume, faits: p.faits.map((f) => ({ ...f })),
    detail: p.detail.slice(0, gardees).map((l) => ({ ...l, reference: l.reference ? { ...l.reference } : null })),
    detailOmis: p.detail.length - gardees, sources: p.sourcesProposees.map((s) => ({ ...s })),
  })
  const tient = (gardees: number) => octetsJsonb(avec(gardees)) <= TAILLE_MAX_PREUVE_APPLICATION
  if (tient(p.detail.length)) return avec(p.detail.length)
  // Le plus long début du détail qui tient, par dichotomie : la taille croît avec le nombre de lignes gardées.
  let bas = 0
  let haut = p.detail.length
  while (bas < haut) {
    const milieu = Math.ceil((bas + haut) / 2)
    if (tient(milieu)) bas = milieu
    else haut = milieu - 1
  }
  return avec(bas)
}

const estObjet = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const entier = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const entierOuNul = (v: unknown) => v === null || entier(v)
const texte = (v: unknown): v is string => typeof v === 'string'
const texteOuNul = (v: unknown) => v === null || texte(v)
const parmi = (liste: readonly string[], v: unknown) => texte(v) && liste.includes(v)

/** Relit un instantané gardé en base, et le REFUSE plutôt que de deviner : la base ne garantit qu'« un objet non vide ». */
export function lireInstantaneDePreuve(valeur: unknown): InstantaneDePreuve | null {
  if (!estObjet(valeur)) return null
  const v = valeur
  if (v.version !== 1 || v.type === 'aucune' || !parmi(TYPES_DE_PREUVE, v.type) || !texte(v.compte) || !entier(v.annee)) return null
  if (!parmi(VERDICTS_DE_PREUVE, v.verdict) || !entier(v.soldeCentimes)) return null
  if (!entierOuNul(v.attenduCentimes) || !entierOuNul(v.ecartCentimes) || !entier(v.detailOmis) || v.detailOmis < 0) return null
  if (![v.titre, v.etablit, v.netablitPas, v.resume].every(texte)) return null
  if (!Array.isArray(v.faits) || !v.faits.every((f) => estObjet(f) && parmi(CLES_DE_FAITS, f.cle) && texte(f.texte)
    && entierOuNul(f.montantCentimes) && entierOuNul(f.nombre))) return null
  if (!Array.isArray(v.detail) || !v.detail.every((l) => estObjet(l) && texte(l.libelle) && entierOuNul(l.montantCentimes)
    && (l.reference === null || (estObjet(l.reference) && parmi(TYPES_DE_REFERENCE, l.reference.type) && texte(l.reference.id))))) {
    return null
  }
  if (!Array.isArray(v.sources) || !v.sources.every((s) => estObjet(s) && texteOuNul(s.pieceId) && texteOuNul(s.documentId)
    && (s.pieceId === null) !== (s.documentId === null) && texte(s.raison))) return null
  return valeur as unknown as InstantaneDePreuve
}
