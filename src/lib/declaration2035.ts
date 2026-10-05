import { dotationDeLExercice } from './amortissements'
import { anneeDe } from './format'
import { indemniteKilometriqueCentimes, totalIndemnitesKilometriques, vehiculeDuDossier } from './baremeKilometrique'
import {
  COMPTE_COTISATIONS_EXPLOITANT, COMPTE_DOTATIONS_AMORTISSEMENTS, COMPTE_INDEMNITES_KILOMETRIQUES,
} from './comptes'
import { montantRetenu } from './montantRetenu'
import type { PartDuReleve } from './partsDuReleve'
import { centimesParDate, partDeLAnnee, rattachementsTresorerie, type PaiementsDesPieces } from './rattachement'
import type { TotalKilometrique } from './baremeKilometrique'
import type { CotisationComptee } from './cotisationRapprochee'
import type { MouvementBancaire } from './affectationBanque'
import type { Categorie, CotisationDeclaree, Immobilisation, Piece, VehiculeDossier } from './types'

// Moteur de la déclaration 2035 (bénéfices non commerciaux, régime de la déclaration contrôlée).
//
// Produit une structure « poste → montant » que plusieurs sorties consomment : d'abord le
// remplissage du formulaire officiel, plus tard une télétransmission EDI-TDFC. C'est pour ça que le
// calcul vit ici et pas dans l'écran Clôture : une sortie fiscale ne doit pas dépendre de ce qu'un
// composant React se trouve avoir en mémoire, et elle doit être vérifiable par des tests.
//
// **Ce moteur totalise, il ne déclare pas.** Il ne calcule aucun impôt, n'applique aucune option
// fiscale (abattements, exonérations ZFU, frais forfaitaires...) et ne décide pas du sort des
// postes : il regroupe ce qui a été saisi et validé. L'arbitrage reste celui de l'expert-comptable,
// et c'est pour ça que tout ce qui est écarté est remonté plutôt que retiré en silence.

export const POSTE_AMORTISSEMENTS = 'Amortissements'
export const POSTE_COTISATIONS = 'Cotisations sociales personnelles'
// Ligne 14 du 2035-A (case BV). Un poste À PART de POSTE_COTISATIONS, parce que le formulaire les
// sépare : la CSG déductible ne transite pas par la ligne 25.
export const POSTE_CSG_DEDUCTIBLE = 'CSG déductible'
// Le « total A » du cadre 7 du 2035-B, que le bas du formulaire envoie ligne 23 du 2035-A. Un poste
// à lui, et non un ajout au poste « Frais de véhicules » des pièces : les deux arrivent dans la même
// case BJ mais n'ont pas la même origine, et les confondre rendrait la case impossible à justifier —
// or ce sont précisément les deux montants qui ne doivent pas coexister (voir doublonFraisVehicules).
export const POSTE_INDEMNITES_KM = 'Indemnités kilométriques'

// Un poste de la déclaration. `montant` est positif : c'est `nature` qui porte le sens. Mélanger les deux
// (une charge en négatif) obligerait chaque consommateur — PDF, EDI, écran — à refaire la même convention
// de signe, et une seule erreur suffirait à inverser une ligne.
//
// SAUF UN POSTE DONT LES AVOIRS ET REMBOURSEMENTS DE L'EXERCICE DÉPASSENT CE QU'IL COMPTE : il reste
// NÉGATIF, sous sa nature. Le moteur prenait la valeur absolue du total, si bien qu'un remboursement de
// frais bancaires reçu une année sans frais payés comptait en DÉPENSE — le résultat se trompait du double
// de son montant, en silence, et la situation intermédiaire, qui ne retourne rien, disait autre chose sur
// la même année. Trouvé en comparant la 2035 aux écritures (lib/concordance2035.ts), où l'écart ne se
// serait expliqué par aucune source. Une CASE négative ne se dépose pas : `casesNegatives`
// (lib/cases2035.ts) la signale, et l'arbitrage reste celui du cabinet.
export interface LigneDeclaration {
  poste: string
  nature: 'recette' | 'depense'
  montant: number
  // Nombre de pièces derrière ce total, pour que le montant se justifie d'un clic.
  nbPieces: number
  // Et de mouvements bancaires comptés sans justificatif — affectés à une catégorie, échéances d'emprunt
  // ou mouvements ventilés (voir lib/partsDuReleve.ts) : leur preuve est le relevé, et les compter avec
  // les pièces ferait chercher des pièces qui n'existent pas. Un mouvement, pas une part : ventilé sur
  // deux catégories du même poste, il compte une fois.
  nbMouvements: number
}

// Ce qui n'a PAS été pris dans le calcul, avec la raison. Sur une déclaration fiscale, une pièce
// écartée en silence est un manquant que personne ne verra jamais : l'ancien calcul, dans
// ClotureTab, faisait un simple `continue`. Ces listes existent pour que l'écran les affiche.
export interface ExclusionsDeclaration {
  // Catégorie sans poste 2035 rattaché : la pièce est validée, son montant est connu, mais il
  // n'irait dans aucune case. C'est le cas le plus grave — un vrai trou dans le total.
  sansPoste: Piece[]
  // Ni paiement rapproché ni date de pièce : impossible de rattacher à un exercice (toute la pièce,
  // ou le reste d'un paiement partiel — voir lib/rattachement.ts).
  sansDate: Piece[]
  // Aucun montant lisible : rien à additionner.
  sansMontant: Piece[]
  // Un mouvement affecté à une catégorie sans poste 2035 : même trou que `sansPoste`, côté relevé.
  mouvementsSansPoste: PartDuReleve[]
  // Un mouvement affecté à une catégorie dont le compte n'est plus un compte de résultat : il a changé
  // depuis l'affectation, que la base aurait refusée sinon. Ni recette ni dépense — donc dit.
  mouvementsHorsResultat: PartDuReleve[]
}

// Une pièce comptée à sa DATE DE FACTURE faute de paiement rapproché — une supposition, que l'écran
// dit : la dépense a peut-être été payée l'année suivante, la recette encaissée plus tard (voir
// lib/rattachement.ts). `montant` est la part comptée ainsi dans CET exercice, signée comme la pièce.
export interface PieceSansPaiement {
  piece: Piece
  montant: number
}

// D'OÙ VIENT CHAQUE CENTIME DE LA DÉCLARATION. Une pièce, un mouvement du relevé (affecté, ventilé, une
// échéance d'emprunt), la dotation d'un bien, le forfait d'un véhicule, une échéance de cotisation, et la
// CSG déductible. La concordance de la 2035 avec les écritures (lib/concordance2035.ts) les retrouve une à
// une dans le brouillon : un total qui diffère ne dit pas où chercher, une source oui.
export type SourceDeclaration =
  | { type: 'piece'; id: string; piece: Piece }
  | { type: 'mouvement'; id: string; ligne: MouvementBancaire }
  | { type: 'bien'; id: string; immobilisation: Immobilisation }
  | { type: 'vehicule'; id: string; vehicule: VehiculeDossier }
  // Une échéance de cotisation : son écriture désigne le mouvement qui la paie, quand il y en a un ; `refus`
  // dit pourquoi un rapprochement qu'elle porte ne s'écrit pas (lib/cotisationRapprochee.ts).
  | { type: 'cotisation'; id: string; cotisation: CotisationDeclaree; ligne: MouvementBancaire | null; refus: string | null }
  // La part déductible de la CSG-CRDS de l'exercice (case BV) : une seule, calculée sur le total.
  | { type: 'csg' }

export interface ContributionDeclaration {
  source: SourceDeclaration
  poste: string
  nature: 'recette' | 'depense'
  // Le compte où l'écriture de la source porte ce montant : celui de la catégorie, ou le compte fixe d'une
  // dotation (681100), d'un forfait (625110), d'une cotisation (646000), d'une échéance d'emprunt (661100,
  // 616800). Nul pour une catégorie sans compte, que rien ne peut écrire, et pour la CSG déductible,
  // qu'aucune écriture ne porte : la CSG-CRDS passe entière au 108000, et seule sa part déductible entre en
  // BV — la présentation relevée sur la 2035 déposée par le cabinet (voir plus bas).
  compte: string | null
  // En centimes, signé comme ce que la source fait à son poste : un avoir ou un remboursement le diminue.
  centimes: number
}

export interface Declaration2035 {
  annee: number
  recettes: LigneDeclaration[]
  depenses: LigneDeclaration[]
  totalRecettes: number
  totalDepenses: number
  // Positif = bénéfice, négatif = déficit. Nommé « résultat » et non « bénéfice » parce que les deux
  // cas existent et vont dans deux cases différentes du formulaire.
  resultat: number
  exclusions: ExclusionsDeclaration
  // Comptées, mais à leur date de facture : aucune note de frais (payée hors du compte, sa date EST
  // celle du paiement), seulement les pièces dont le paiement n'est pas encore rapproché.
  sansPaiementConnu: PieceSansPaiement[]
  // Le détail du cadre 7 pour cet exercice, ou null quand aucun véhicule n'y est déclaré. Porté à
  // part du poste : `nonCalcules` doit remonter jusqu'à l'écran, sans quoi un véhicule dont le
  // barème manque disparaîtrait de la déclaration sans laisser de trace.
  indemnitesKilometriques: TotalKilometrique | null
  // Chaque montant des postes, avec sa source : leur somme par poste EST le poste, au centime.
  contributions: ContributionDeclaration[]
}

function arrondi(n: number): number {
  return Number(n.toFixed(2))
}

// LA DOTATION D'UN BIEN EST CELLE DE LA RÈGLE FISCALE : linéaire, prorata temporis depuis la mise en
// service, le reliquat après la durée (lib/amortissements.ts, `dotationDeLExercice`). C'est le calcul que
// la base vérifie quand la dotation s'écrit au brouillon, donc la case CH et le FEC disent le même chiffre.
//
// La dotation y était comptée EN ENTIER dès l'année d'acquisition, et l'écran le disait (« à reprendre à
// la main avant de signer ») : une première annuité surévaluée pour un bien acquis en cours d'année, et le
// reliquat jamais déduit. Le modèle ne portait pas de date de mise en service ; il la porte depuis le
// 01/10/2026, et sans elle l'amortissement part de la date d'acquisition.

// LA CSG-CRDS EST DÉDUITE EN ENTIER, ET 2,9 DE SES 9,7 POINTS NE SONT PAS DÉDUCTIBLES.
//
// `calculerDeclaration2035` porte la cotisation COMPLÈTE au poste « Cotisations sociales
// personnelles » (case BK, ligne 25). Or la CSG-CRDS d'un travailleur non salarié se décompose en
// 6,8 points DÉDUCTIBLES du résultat BNC et 2,9 points qui ne le sont pas (CSG non déductible 2,4 +
// CRDS 0,5). La part non déductible part donc en déduction sur une déclaration signée.
//
// L'application SAIT la calculer : `cotisations_declarees.montant_csg_crds` existe et l'écran
// Cotisations le saisit — il affichait même la part déductible, avec ces deux taux écrits en dur
// dans le composant. Le moteur, lui, l'ignorait entièrement.
//
// ON LE CORRIGE DÉSORMAIS, ET C'EST UNE PRÉSENTATION ÉTABLIE SUR PIÈCE, PAS UN ARBITRAGE DU CODE
// (22/09/2026). La version précédente de ce commentaire disait « on signale, on ne corrige pas » —
// c'était juste tant que la présentation retenue par le cabinet n'était pas connue, deux étant
// admises et donnant le même résultat imposable. Une 2035 réelle l'a tranchée, cases relevées à
// leurs coordonnées sur le formulaire déposé :
//
//   - case BV (2035-A ligne 14, « Contribution sociale généralisée déductible ») : REMPLIE ;
//   - case CC (2035-B ligne 36, « Divers à réintégrer ») : VIDE, donc aucune réintégration ;
//   - ligne 25 : BT « dont obligatoires » + BZ « dont facultatives » = BK au centime, et la CSG
//     n'y est pas.
//
// Et c'est FORCÉ PAR LE FORMULAIRE, pas seulement observé : BK entre dans le total des lignes 8 à 32
// et BV y entre aussi par la ligne 14 — la CSG présente dans les deux serait déduite deux fois.
// Côté tenue de comptes, l'expert-comptable passe la CSG-CRDS ENTIÈRE au compte 108 (compte de
// l'exploitant), donc hors résultat ; seule la part déductible est réintroduite en BV. Les deux
// moitiés se tiennent, et la part non déductible n'apparaît alors nulle part.
//
// CE QUI RESTE SIGNALÉ SANS ÊTRE CORRIGÉ : une cotisation dont `montant_csg_crds` n'est pas saisi.
// On ne peut alors rien ventiler — sa part non déductible continue de partir en déduction, et
// AUCUN calcul ne peut la retrouver. C'est une SAISIE qui manque, pas un arbitrage ; l'écran le dit.
export const TAUX_CSG_DEDUCTIBLE = 6.8
export const TAUX_CSG_CRDS_TOTAL = 9.7

/** La part déductible d'un montant de CSG-CRDS, arrondie au centime. */
export function csgDeductible(montantCsgCrds: number): number {
  return arrondi(montantCsgCrds * (TAUX_CSG_DEDUCTIBLE / TAUX_CSG_CRDS_TOTAL))
}

export interface PartCsgNonDeductible {
  /** Cotisations de l'exercice dont la ventilation CSG-CRDS est saisie. */
  nbVentilees: number
  /** Les autres. La part non déductible y est INCONNUE, surtout pas nulle — d'où un compte à part. */
  nbSansVentilation: number
  totalCsgCrds: number
  csgDeductible: number
  /** Ce qui est déduit à tort, sur ce qu'on sait ventiler. */
  csgNonDeductible: number
}

// Ce que la ligne 25 porte à tort sur cet exercice, et ce qu'on ne peut pas encore chiffrer.
//
// Rendue `null` quand l'exercice ne porte AUCUNE cotisation : il n'y a alors rien à dire, et une
// mise en garde permanente cesse d'être lue avant d'emporter ses voisines.
//
// Les deux comptes sont séparés à dessein : une cotisation sans ventilation ne vaut pas « zéro de
// CSG » — c'est la famille des lectures dont l'échec ressemble à un résultat vide, appliquée à une
// SAISIE. Les additionner ferait annoncer « rien à réintégrer » sur un dossier qui n'a simplement
// jamais renseigné le détail.
//
// LES COTISATIONS SONT CELLES DE `cotisationsComptees` (lib/cotisationRapprochee.ts) : une échéance payée
// par un mouvement rapproché compte l'année de ce mouvement, et sa CSG-CRDS avec elle — la même année que
// l'écriture qui la passe au 108000. Une CSG-CRDS d'un remboursement est négative et diminue le total.
//
// Le non déductible se déduit du déductible (`total - déductible`) plutôt que de se calculer sur
// 2,9/9,7. **Et la raison d'abord écrite ici était FAUSSE** : « deux arrondis indépendants
// laisseraient un centime d'écart » — mesuré sur les 20 000 000 de montants au centime de 0,01 € à
// 200 000 €, les deux formules rendent EXACTEMENT le même résultat, zéro écart. C'est arithmétique :
// 6,8 + 2,9 = 9,7, donc les deux produits somment exactement au total et leurs parties
// fractionnaires se complètent — celle qui arrondit vers le bas rend précisément ce que l'autre
// prend. La mutation correspondante ne mord donc pas, et c'est dit ici plutôt que déguisé en
// assertion de complaisance.
// Ce qui décide vraiment : la forme par complément tient PAR CONSTRUCTION, sans dépendre de cette
// coïncidence ni du jour où l'un des deux taux changera (ils bougent d'une année sur l'autre).
export function partCsgNonDeductible(cotisations: readonly CotisationComptee[], annee: number): PartCsgNonDeductible | null {
  const deLAnnee = cotisations.filter((c) => anneeDe(c.date) === annee)
  if (deLAnnee.length === 0) return null

  const ventilees = deLAnnee.filter((c) => c.csgCrds != null)
  const totalCsgCrds = arrondi(ventilees.reduce((s, c) => s + (c.csgCrds ?? 0), 0))
  const deductible = csgDeductible(totalCsgCrds)

  return {
    nbVentilees: ventilees.length,
    nbSansVentilation: deLAnnee.length - ventilees.length,
    totalCsgCrds,
    csgDeductible: deductible,
    csgNonDeductible: arrondi(totalCsgCrds - deductible),
  }
}

export function calculerDeclaration2035(
  annee: number,
  pieces: Piece[],
  categories: Categorie[],
  immobilisations: Immobilisation[],
  // Les échéances de cotisation à la date et au montant auxquels elles comptent (`cotisationsComptees`,
  // lib/cotisationRapprochee.ts) : celles du mouvement qui les paie, sinon leur échéance. Un tableau
  // d'échéances brutes ne passe plus : il ferait compter à son échéance une cotisation que le FEC porte
  // à son paiement, l'année d'après.
  cotisations: readonly CotisationComptee[],
  // Sans valeur par défaut, volontairement : un appelant qui oublie les véhicules doit s'en rendre
  // compte à la compilation, pas en découvrant une case BJ vide sur un formulaire déjà déposé.
  vehicules: VehiculeDossier[],
  // Même raison : un dossier exonéré déclare ses dépenses TVA comprise, un assujetti hors taxes (voir
  // lib/montantRetenu.ts). Une valeur par défaut ferait passer l'un pour l'autre en silence.
  assujettiTva: boolean,
  // Les paiements de chaque pièce, rapprochements et parts de règlements groupés réunis
  // (`paiementsDesPieces`) : ce sont eux qui DATENT une pièce (voir lib/rattachement.ts). Sans valeur par
  // défaut non plus — une liste vide ferait tout compter à la date de facture, soit exactement le défaut
  // que ce paramètre corrige.
  paiements: PaiementsDesPieces,
  // Ce que le relevé compte sans justificatif (lib/partsDuReleve.ts) : les mouvements affectés à une
  // catégorie — les encaissements de l'Assurance maladie, les frais bancaires — et les intérêts et
  // l'assurance des échéances d'emprunt. Ils comptent à la date du MOUVEMENT, qui est celle de
  // l'encaissement ou du paiement — la règle de la 2035 sans supposition. Sans valeur par défaut : un
  // appelant qui les oublie rendrait la 2035 d'un infirmier presque sans recettes.
  partsDuReleve: readonly PartDuReleve[],
): Declaration2035 {
  const categorieById = (id: string | null) => categories.find((c) => c.id === id) ?? null

  // Une pièce déjà enregistrée comme immobilisation est représentée par sa dotation annuelle, pas
  // par son montant d'achat : la compter deux fois gonflerait les charges de l'exercice.
  const pieceIdsImmobilisees = new Set(immobilisations.map((i) => i.piece_id).filter(Boolean))

  const exclusions: ExclusionsDeclaration = {
    sansPoste: [], sansDate: [], sansMontant: [], mouvementsSansPoste: [], mouvementsHorsResultat: [],
  }
  const sansPaiementConnu: PieceSansPaiement[] = []
  const contributions: ContributionDeclaration[] = []
  // EN CENTIMES ENTIERS, comme les écritures : une somme de flottants dérive, et un total qui dérive d'un
  // centime n'est plus la somme de ses sources. Les mouvements d'un poste se comptent par IDENTIFIANT, pas
  // par part : un mouvement ventilé sur deux catégories du même poste (lib/ventilationBanque.ts) y apporte
  // deux parts, et reste UN mouvement à retrouver sur le relevé.
  //
  // UNE LIGNE PAR POSTE ET PAR NATURE, jamais par poste seul. Le total était tenu par libellé : une recette
  // et une dépense rangées sous le même poste — une vente classée dans une catégorie de dépense, ou deux
  // catégories qui se donnent le même libellé — fusionnaient en UNE ligne, de la nature de la première
  // source rencontrée. La recette comptait alors en dépense, et le résultat se trompait du double de son
  // montant, en silence : la concordance avec les écritures, qui juge source par source, n'y voyait rien,
  // et `cadreCompatible` (lib/cases2035.ts), qui refuse une recette dans une case de dépenses, ne voyait
  // plus que la ligne fusionnée. Séparées, la ligne du mauvais sens tombe dans les postes sans case, que
  // Clôture montre et que la validation d'un exercice refuse.
  const totaux = new Map<string, { poste: string; nature: 'recette' | 'depense'; centimes: number; nbPieces: number; mouvements: Set<string> }>()

  const ajouter = (contribution: ContributionDeclaration, nbPieces: number, mouvementId: string | null = null) => {
    contributions.push(contribution)
    const cle = `${contribution.nature}:${contribution.poste}`
    let actuel = totaux.get(cle)
    if (!actuel) {
      actuel = { poste: contribution.poste, nature: contribution.nature, centimes: 0, nbPieces: 0, mouvements: new Set() }
      totaux.set(cle, actuel)
    }
    actuel.centimes += contribution.centimes
    actuel.nbPieces += nbPieces
    if (mouvementId) actuel.mouvements.add(mouvementId)
  }
  const enCentimes = (montant: number) => Math.round(montant * 100)

  for (const piece of pieces) {
    if (piece.statut !== 'validee') continue
    if (pieceIdsImmobilisees.has(piece.id)) continue

    // L'EXERCICE EST CELUI DU PAIEMENT, PAS CELUI DE LA FACTURE (CGI, art. 93 : recettes encaissées,
    // dépenses payées). Le calcul lisait `anneeDe(date_piece)` : une facture de décembre réglée en
    // janvier partait dans la déclaration de l'année d'avant. La date vient de lib/rattachement.ts,
    // la même règle que la situation intermédiaire, l'estimation et les écritures.
    //
    // L'ordre des contrôles porte une intention : une pièce d'un autre exercice n'est pas une
    // anomalie, elle n'a juste rien à faire ici — elle sort avant d'être comptée comme un défaut.
    const paiementsPiece = paiements.get(piece.id) ?? []
    const rattachements = rattachementsTresorerie(piece, paiementsPiece)
    if (rattachements.some((r) => r.date === null)) exclusions.sansDate.push(piece)
    const part = partDeLAnnee(rattachements, annee)
    if (part === 0) continue

    const montant = montantRetenu(piece, assujettiTva)
    if (montant == null) {
      exclusions.sansMontant.push(piece)
      continue
    }

    const categorie = categorieById(piece.categorie_id)
    if (!categorie?.poste_2035) {
      exclusions.sansPoste.push(piece)
      continue
    }

    // AU CENTIME DE SON ÉCRITURE : la part de l'exercice telle que la génération la répartit
    // (`centimesParDate`), la part sans date en moins — l'écriture la porte au dépôt, la 2035 nulle part.
    // Additionner `montant × part` laissait un centime d'écart avec le FEC sur une pièce payée sur deux
    // exercices.
    const centimes = centimesParDate(piece, montant, paiementsPiece)
      .filter((m) => anneeDe(m.date) === annee)
      .reduce((s, m) => s + m.centimes - m.centimesSansDate, 0)

    // Un montant négatif (avoir, remboursement) ne change pas le poste, il le diminue. Le signe est
    // porté par `nature` au niveau du poste, donc on additionne le montant tel quel ici.
    ajouter({
      source: { type: 'piece', id: piece.id, piece },
      poste: categorie.poste_2035,
      nature: piece.type_piece === 'vente' ? 'recette' : 'depense',
      compte: categorie.compte_comptable,
      centimes,
    }, 1)

    // Ce qui compte ici à la date de facture faute de paiement connu — rendu APRÈS les contrôles, une
    // pièce écartée n'étant pas comptée du tout.
    const partSansPaiement = rattachements
      .filter((r) => r.source === 'sans_paiement' && r.date !== null && anneeDe(r.date) === annee)
      .reduce((s, r) => s + r.part, 0)
    if (partSansPaiement > 0) sansPaiementConnu.push({ piece, montant: arrondi(montant * partSansPaiement) })
  }

  // LE RELEVÉ, APRÈS LES PIÈCES. Une part compte l'année de la date de son mouvement, dans son poste et
  // selon sa nature — pour un mouvement affecté, celle de son COMPTE (classe 7 une recette, classe 6 une
  // dépense) —, signée comme ce qu'elle fait au poste : un remboursement le diminue. Un mouvement ne
  // peut pas être aussi une pièce — la base interdit qu'il porte les deux
  // (`lignes_bancaires_un_seul_rapprochement`).
  for (const p of partsDuReleve) {
    if (anneeDe(p.ligne.date) !== annee) continue
    if (!p.nature) {
      exclusions.mouvementsHorsResultat.push(p)
      continue
    }
    if (!p.poste) {
      exclusions.mouvementsSansPoste.push(p)
      continue
    }
    ajouter({
      source: { type: 'mouvement', id: p.ligne.id, ligne: p.ligne },
      poste: p.poste,
      nature: p.nature,
      compte: p.compte,
      centimes: enCentimes(p.montantPoste),
    }, 0, p.ligne.id)
  }

  // Une dotation par bien : la case CH est leur somme, et chacune s'écrit à part au brouillon.
  for (const immobilisation of immobilisations) {
    const dotation = dotationDeLExercice(immobilisation, annee)
    if (dotation === 0) continue
    ajouter({
      source: { type: 'bien', id: immobilisation.id, immobilisation },
      poste: POSTE_AMORTISSEMENTS,
      nature: 'depense',
      compte: COMPTE_DOTATIONS_AMORTISSEMENTS,
      centimes: enCentimes(dotation),
    }, 0)
  }

  // LA CSG-CRDS SORT DE LA LIGNE 25 ET SA PART DÉDUCTIBLE REJOINT LA LIGNE 14 (voir plus haut).
  //
  // Les deux chiffres viennent de `partCsgNonDeductible` plutôt que d'un second calcul : c'est la
  // MÊME fonction qui alimente l'avertissement de Clôture, donc l'écran et le formulaire ne peuvent
  // pas annoncer deux montants à un centime près. Une règle recopiée deux fois n'attend pas de
  // diverger (règle du projet, payée sur `analyserEcritures` et sur `calculerLigne`).
  //
  // Une cotisation sans ventilation laisse sa CSG dans la ligne 25 — on ne sait pas l'en extraire,
  // et inventer un taux sur le montant total serait une valeur plausible et fausse.
  //
  // Le paiement fait foi quand le rapprochement le connaît — sa date et son montant, ceux du FEC ; à
  // défaut, le versement saisi ou l'appel, à l'échéance (voir `cotisationsComptees`). Chaque échéance
  // porte ce qui va au 646000, sa CSG-CRDS en moins : c'est le montant de son écriture.
  for (const c of cotisations) {
    if (anneeDe(c.date) !== annee) continue
    const centimes = enCentimes(c.montant) - enCentimes(c.csgCrds ?? 0)
    if (centimes === 0) continue
    ajouter({
      source: { type: 'cotisation', id: c.cotisation.id, cotisation: c.cotisation, ligne: c.ligne, refus: c.refus },
      poste: POSTE_COTISATIONS,
      nature: 'depense',
      compte: COMPTE_COTISATIONS_EXPLOITANT,
      centimes,
    }, 0)
  }
  const csg = partCsgNonDeductible(cotisations, annee)
  if (csg && csg.csgDeductible !== 0) {
    ajouter({
      source: { type: 'csg' }, poste: POSTE_CSG_DEDUCTIBLE, nature: 'depense', compte: null,
      centimes: enCentimes(csg.csgDeductible),
    }, 0)
  }

  // Cadre 7 du 2035-B → ligne 23 du 2035-A. Le kilométrage est propre à un exercice (l'option pour
  // le forfait se prend au 1er janvier et vaut l'année entière, notice renvoi 12), d'où le filtre sur
  // l'année — un véhicule saisi pour 2024 n'a rien à faire dans la déclaration 2025. Un forfait par
  // véhicule, comme au brouillon.
  const vehiculesDeLExercice = vehicules.filter((v) => v.annee === annee)
  const indemnitesKilometriques = vehiculesDeLExercice.length > 0
    ? totalIndemnitesKilometriques(vehiculesDeLExercice.map(vehiculeDuDossier), annee)
    : null
  for (const vehicule of vehiculesDeLExercice) {
    const centimes = indemniteKilometriqueCentimes(vehiculeDuDossier(vehicule), annee)
    if (centimes === null || centimes === 0n) continue
    ajouter({
      source: { type: 'vehicule', id: vehicule.id, vehicule },
      poste: POSTE_INDEMNITES_KM,
      nature: 'depense',
      compte: COMPTE_INDEMNITES_KILOMETRIQUES,
      centimes: Number(centimes),
    }, 0)
  }

  // Le total SIGNÉ de chaque poste, jamais sa valeur absolue (voir `LigneDeclaration`).
  const lignes = [...totaux.values()]
    .filter((t) => t.centimes !== 0)
    .map((t) => ({
      poste: t.poste,
      nature: t.nature,
      montant: t.centimes / 100,
      nbPieces: t.nbPieces,
      nbMouvements: t.mouvements.size,
    }))

  const recettes = lignes.filter((l) => l.nature === 'recette').sort((a, b) => b.montant - a.montant)
  const depenses = lignes.filter((l) => l.nature === 'depense').sort((a, b) => b.montant - a.montant)
  const centimesDe = (ls: LigneDeclaration[]) => ls.reduce((s, l) => s + Math.round(l.montant * 100), 0)
  const totalRecettes = centimesDe(recettes) / 100
  const totalDepenses = centimesDe(depenses) / 100

  return {
    annee,
    recettes,
    depenses,
    totalRecettes,
    totalDepenses,
    resultat: (centimesDe(recettes) - centimesDe(depenses)) / 100,
    exclusions,
    sansPaiementConnu,
    indemnitesKilometriques,
    contributions,
  }
}
