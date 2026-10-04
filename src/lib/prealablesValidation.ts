import type { ModeleComptable } from './engagement'
import type { DossierTab } from './ongletsDossier'
import type { Concordance2035 } from './concordance2035'
import type { Declaration2035 } from './declaration2035'
import type { DoublonDeTexte } from './doublonsTexte'
import type { Emprunt } from './emprunts'
import { numeroterFec, type NumerotationFec } from './fec'
import { anneeDe } from './format'
import { analyserEcritures, ecrituresSansObjet, piecesAComptabiliser } from './ecritures'
import {
  immobilisationsSansJustificatif, moisEnDoubleSurAbonnement, mouvementsRapprochesSansObjet, piecesADateImpossible,
  piecesDeviseNonConvertie, piecesTvaImpossible, piecesValideesSansCategorie, rapprochementsEcartImportant,
} from './controles'
import { mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSansTaux } from './affectationBanque'
import { mouvementsVentilesDesynchronises, partsDesVentilations, recettesVentileesSansTaux, ventilationsIncoherentes } from './ventilationBanque'
import { virementsPersonnelsAEcrire } from './virementPersonnel'
import { cotisationsAEcrire, cotisationsComptees, rapprochementsCotisationRefuses } from './cotisationRapprochee'
import { couvertureDuReleve, echeancesDesynchronisees, echeancesNonRapprochees } from './echeanceEmprunt'
import { acquisitionsDesBiens, dotationDeLExercice, dotationsDuRegistre, dotationsEnDefaut } from './amortissements'
import { forfaitsDuCadre7, forfaitsEnDefaut } from './forfaitKilometrique'
import { piecesPayeesEnTrop, reglementsGroupesIncoherents } from './reglementGroupe'
import { paiementsDesPieces, rattachementsTresorerie, type PaiementsDesPieces } from './rattachement'
import { defautsDeNumerotation, frontiereDeValidation } from './validationExercice'
import type {
  ANouveau, Categorie, ControleReleveBancaire, CotisationDeclaree, EcritureBrouillon, Immobilisation, LigneBancaire,
  NatureImmobilisation, Piece, ReglementGroupe, VehiculeDossier, VentilationBancaire,
} from './types'

// CE QUI EMPÊCHE DE VALIDER UN EXERCICE, DIT AVANT LE CLIC (ligne 26.6, étape d). Une validation ne se défait
// pas : ce qu'elle fige d'incomplet ou de faux le reste. Deux familles de préalables, et un principe pour chacune.
//
// CE QUE LA BASE REFUSERA, dans l'ordre où elle le refuse et avec ses mots (`valider_exercice`) : un exercice en
// cours, déjà validé, pris hors de l'ordre ou antérieur à l'ouverture ; des écritures antérieures non validées ;
// des mouvements à traiter. Les dire ici évite un clic qui échoue — et la base reste le seul juge : un préalable
// que l'écran aurait manqué, elle le refuse quand même.
//
// LA VALIDATION FIGE TOUT CE QUI PRÉCÈDE LE 31 DÉCEMBRE, pas seulement l'exercice : la frontière de la base est
// une date. Un exercice antérieur que rien n'a validé serait donc figé sans l'avoir été — ses pièces, ses
// mouvements, son forfait ou sa dotation à jamais sans écriture, et sa 2035 à jamais sans concordance. Sans
// ouverture ni exercice validé, le premier exercice qui porte quelque chose se valide donc d'abord ; ensuite,
// la base impose l'ordre, et chaque validation ne fige plus qu'un exercice. Les contrôles qui suivent ne
// regardent donc que l'exercice.
//
// CE QUE LA BASE NE VOIT PAS, et que l'application refuse à sa place — décision du cabinet le 04/10/2026 : on ne
// valide pas tant que la 2035 et les écritures ne concordent pas au centime, ni tant qu'une écriture est en
// anomalie. Une base qui ne sait pas calculer une 2035 ne peut pas le vérifier. L'anomalie se lit ici dans les
// DEUX modèles — en trésorerie aussi, au-delà de la concordance : la concordance compare les comptes de RÉSULTAT,
// et un virement personnel sans écriture, une ligne de banque mal datée ou une TVA sur le mauvais compte la
// laissent juste pendant que le FEC est faux. CE SONT LES CONTRÔLES EN ERREUR DE LA CHECKLIST, ramenés à
// l'exercice : un défaut que l'application signale en erreur ne se fige pas. `prealablesValidation.test.ts` vérifie
// que chaque point en erreur de la Checklist est repris ici ou écarté avec sa raison.
//
// ET CE QUI RESTERAIT EN SUSPENS : une pièce à valider de l'exercice, une pièce sans date, une date impossible.
// Après la validation, aucune écriture ne se passe plus dans l'exercice : une pièce qu'on validerait ensuite ne
// pourrait plus y être comptabilisée.

export interface PrealableDeValidation {
  id: string
  // Le nombre d'éléments en cause, quand le préalable en compte ; nul pour une condition (un exercice en cours).
  nb: number | null
  // Avec un nombre, ce qu'il compte, à la manière de la Checklist (« pièce(s) à valider … ») ; sans, une
  // phrase qui se lit seule — celle de la base quand elle refuserait de même.
  message: string
  cible: DossierTab
  // Un préalable bloquant refuse la validation ; un avertissement se lit avant de valider, sans la refuser.
  bloquant: boolean
  detail?: string
  // L'exercice qui se valide d'abord, quand le préalable tient à l'ordre des exercices : l'écran y mène d'un clic.
  // Sans cela, il nommerait un exercice que rien n'affiche peut-être — une année qui ne porte qu'une échéance de
  // cotisation, ou rien du tout, n'est pas dans la liste des exercices de l'en-tête.
  exercice?: number
}

export interface DonneesDeValidation {
  annee: number
  // L'année en cours À PARIS (`aujourdHuiAParis`) : la base la lit ainsi, et la nuit du Nouvel An ne doit pas
  // faire diverger l'écran et la base.
  anneeCourante: number
  modele: ModeleComptable
  assujettiTva: boolean
  anneesValidees: readonly number[]
  // Le motif d'une lecture partielle de l'une des collections ci-dessous, ou rien. Une lecture partielle ne
  // commande pas d'écriture (CLAUDE.md) — et une validation est l'écriture la plus définitive qui soit.
  lectureIncomplete: string | null
  piecesValidees: readonly Piece[]
  piecesAValider: readonly Piece[]
  categories: readonly Categorie[]
  immobilisations: readonly Immobilisation[]
  natures: readonly NatureImmobilisation[]
  // Tout le brouillon et tout le relevé du dossier : une écriture antérieure non validée et un mouvement d'un
  // exercice précédent comptent aussi.
  ecritures: readonly EcritureBrouillon[]
  lignes: readonly LigneBancaire[]
  ventilations: readonly VentilationBancaire[]
  reglements: readonly ReglementGroupe[]
  cotisations: readonly CotisationDeclaree[]
  vehicules: readonly VehiculeDossier[]
  emprunts: readonly Emprunt[]
  aNouveaux: readonly ANouveau[]
  // Nuls quand on n'a pas pu les lire : ils ne se taisent pas, ils deviennent un préalable.
  relevesIncoherents: readonly ControleReleveBancaire[] | null
  doublonsTexte: readonly DoublonDeTexte[] | null
  // En trésorerie, la 2035 de l'exercice et sa concordance avec les écritures ; RIEN en engagement, où la 2035 ne se
  // produit pas — l'appelant ne la calcule pas, et la base refuserait de la recevoir.
  declaration: Declaration2035 | null
  concordance: Concordance2035 | null
}

export interface EtatDeValidation {
  prealables: PrealableDeValidation[]
  // La numérotation de l'exercice, celle que la validation enverra — nulle quand une lecture est partielle.
  numerotation: NumerotationFec | null
  // Vrai quand aucun préalable bloquant ne reste.
  validable: boolean
}

function pluriel(n: number, singulier: string, plurielForme = `${singulier}s`): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`
}

// Les dates où une pièce s'écrit, ou s'écrira : en trésorerie, celles de ses paiements et, pour le reste, sa date
// de facture (lib/rattachement.ts) ; en engagement, sa facture à sa date et chacun de ses règlements à la sienne.
function datesDesEcrituresAttendues(piece: Piece, paiements: PaiementsDesPieces, modele: ModeleComptable): string[] {
  const p = paiements.get(piece.id) ?? []
  const dates = modele.mode === 'engagement'
    ? [piece.date_piece, ...p.map((m) => m.date)]
    : rattachementsTresorerie(piece, p).map((r) => r.date)
  return dates.filter((d): d is string => d !== null)
}

// Ce qui décide de l'ordre des exercices : ce qui est validé, l'ouverture, et ce que chaque année porte.
export type SuiteDesExercices = Pick<DonneesDeValidation,
  'anneeCourante' | 'modele' | 'anneesValidees' | 'aNouveaux' | 'ecritures' | 'lignes' | 'reglements' | 'piecesValidees'
  | 'piecesAValider' | 'cotisations' | 'vehicules' | 'immobilisations'>

// Les années qui portent quelque chose : une écriture, un mouvement qui n'est pas ignoré (un virement personnel
// l'est, et s'écrit), une pièce validée à la date où elle s'écrit, une pièce à valider, une échéance de
// cotisation là où elle compte — au prélèvement qui la paie, sinon à son échéance (lib/cotisationRapprochee.ts) :
// une échéance de décembre prélevée en janvier ne fait pas de décembre un exercice à valider —, un forfait
// kilométrique, la mise en service d'un bien.
function anneesActives(d: SuiteDesExercices, paiements: PaiementsDesPieces): Set<number> {
  const annees = new Set<number>()
  const noter = (date: string | null) => { if (date) annees.add(anneeDe(date)) }
  for (const e of d.ecritures) noter(e.date)
  for (const l of d.lignes) if (l.statut !== 'ignoree' || l.prelevement_personnel) noter(l.date)
  for (const p of d.piecesValidees) for (const date of datesDesEcrituresAttendues(p, paiements, d.modele)) noter(date)
  for (const p of d.piecesAValider) noter(p.date_piece)
  for (const c of cotisationsComptees(d.cotisations, d.lignes, d.modele.mode)) noter(c.date)
  for (const v of d.vehicules) if (v.km_professionnel > 0) annees.add(v.annee)
  for (const i of d.immobilisations) noter(i.date_mise_en_service ?? i.date_acquisition)
  return annees
}

// LE PROCHAIN EXERCICE À VALIDER, celui que les préalables d'ordre réclament : l'exercice qui suit le dernier
// validé ; sans validation, celui de l'ouverture d'un dossier repris ; sans ouverture, le premier qui porte quelque
// chose. Nul quand il n'est pas encore terminé, ou que rien n'est à valider. Une ouverture ne se pose plus après une
// validation (la base le refuse), donc le dernier exercice validé la suit toujours.
//
// Clôture le montre même quand rien ne l'y ferait paraître — une année vide entre deux autres, ou qui ne porte
// qu'une échéance de cotisation : sinon la validation de tous les exercices suivants attendrait un exercice que
// l'écran ne propose pas.
export function prochainExerciceAValider(d: SuiteDesExercices): number | null {
  const ouverture = d.aNouveaux.length === 0 ? null : d.aNouveaux.map((a) => a.date).sort()[0]
  const prochain = d.anneesValidees.length > 0
    ? Math.max(...d.anneesValidees) + 1
    : ouverture !== null
      ? anneeDe(ouverture)
      : Math.min(...anneesActives(d, paiementsDesPieces(d.lignes, d.reglements)))
  return Number.isFinite(prochain) && prochain < d.anneeCourante ? prochain : null
}

export function prealablesDeValidation(d: DonneesDeValidation): EtatDeValidation {
  const debut = `${d.annee}-01-01`
  const fin = `${d.annee}-12-31`
  const dansLExercice = (date: string | null | undefined) => !!date && date >= debut && date <= fin
  const ouverture = d.aNouveaux.length === 0 ? null : d.aNouveaux.map((a) => a.date).sort()[0]
  const anneeOuverture = ouverture ? anneeDe(ouverture) : null
  const prealables: PrealableDeValidation[] = []
  const bloque = (p: Omit<PrealableDeValidation, 'bloquant'>) => { if (p.nb === null || p.nb > 0) prealables.push({ ...p, bloquant: true }) }

  // ── Une lecture partielle d'abord : rien de ce qui suit ne vaudrait. ─────────────────────────────────────
  if (d.lectureIncomplete !== null) {
    prealables.push({
      id: 'lecture-partielle', nb: null, cible: 'cloture', bloquant: true,
      message: `La lecture du dossier est restée partielle (${d.lectureIncomplete}) : une validation ne se fait que sur tout le dossier. Recharger la page.`,
    })
    return { prealables, numerotation: null, validable: false }
  }

  // ── Ce que la base refusera, avec ses mots. ─────────────────────────────────────────────────────────────
  const derniere = d.anneesValidees.length > 0 ? Math.max(...d.anneesValidees) : null
  if (d.annee >= d.anneeCourante) {
    bloque({ id: 'exercice-en-cours', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} n'est pas terminé : il se valide une fois clos.` })
  }
  if (derniere !== null && d.annee <= derniere) {
    bloque({ id: 'deja-valide', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} est déjà validé, ou un exercice postérieur l'est.` })
  } else if (derniere !== null && d.annee !== derniere + 1) {
    bloque({
      id: 'ordre', nb: null, cible: 'cloture', exercice: derniere + 1,
      message: `L'exercice ${derniere + 1} n'est pas validé : les exercices se valident dans l'ordre.`,
    })
  }
  if (anneeOuverture !== null && d.annee < anneeOuverture) {
    bloque({ id: 'avant-ouverture', nb: null, cible: 'cloture', message: `L'exercice ${d.annee} précède l'ouverture du dossier : il est dans les comptes repris.` })
  } else if (anneeOuverture !== null && anneeOuverture < d.annee && !d.anneesValidees.includes(anneeOuverture)) {
    bloque({
      id: 'ouverture-d-abord', nb: null, cible: 'cloture', exercice: anneeOuverture,
      message: `L'exercice ${anneeOuverture} porte les à-nouveaux du dossier : il se valide d'abord.`,
    })
  }
  const anterieures = d.ecritures.filter((e) => e.statut === 'proposee' && e.date < debut)
  const premiereAnterieure = anterieures.length > 0 ? Math.min(...anterieures.map((e) => anneeDe(e.date))) : null
  if (premiereAnterieure !== null) {
    const premiere = premiereAnterieure
    const avantOuverture = anneeOuverture !== null && premiere < anneeOuverture
    bloque({
      id: 'ecritures-anterieures', nb: null, cible: 'ecritures', detail: pluriel(anterieures.length, 'écriture concernée', 'écritures concernées'),
      // Avant l'ouverture, aucun exercice ne se valide : les écritures se retirent ou se redatent.
      ...(avantOuverture ? {} : { exercice: premiere }),
      message: avantOuverture
        ? "Des écritures antérieures à l'ouverture du dossier ne sont pas validées : cette période est dans les comptes repris, les retirer ou les redater avant la validation."
        : `L'exercice ${premiere} porte des écritures qui ne sont pas validées : les exercices se valident dans l'ordre.`,
    })
  }
  const aTraiter = d.lignes.filter((l) => l.statut === 'non_rapprochee' && l.date <= fin)
  if (aTraiter.length > 0) {
    const premiere = Math.min(...aTraiter.map((l) => anneeDe(l.date)))
    bloque({
      id: 'mouvements-a-traiter', nb: null, cible: 'banque', detail: pluriel(aTraiter.length, 'mouvement concerné', 'mouvements concernés'),
      message: anneeOuverture !== null && premiere < anneeOuverture
        ? "Des mouvements bancaires antérieurs à l'ouverture du dossier restent à traiter : les ignorer avant la validation."
        : `L'exercice ${premiere} porte des mouvements bancaires à traiter : ils se traitent avant la validation.`,
    })
  }
  const paiements = paiementsDesPieces(d.lignes, d.reglements)
  // Le premier exercice qui porte quelque chose, quand rien ne le fige encore — et que les écritures
  // antérieures ne l'ont pas déjà nommé.
  if (derniere === null && anneeOuverture === null) {
    const premiere = Math.min(...[...anneesActives(d, paiements)].filter((a) => a < d.annee))
    if (Number.isFinite(premiere) && premiere !== premiereAnterieure) {
      bloque({
        id: 'exercice-anterieur-d-abord', nb: null, cible: 'cloture', exercice: premiere,
        message: `L'exercice ${premiere} porte déjà des pièces, des mouvements ou des écritures : il se valide d'abord. Valider ${d.annee} le figerait sans qu'il l'ait été.`,
      })
    }
  }

  // ── Ce qui resterait en suspens. ──────────────────────────────────────────────────────────────────────
  // Une pièce à valider de l'exercice : validée ensuite, son écriture ne pourrait plus s'y passer. Avant
  // l'ouverture d'un dossier repris, la période est dans les comptes repris : rien ne s'y écrit de toute façon.
  const dansLaPeriodeTenue = (date: string | null) => dansLExercice(date) && (ouverture === null || date! >= ouverture)
  bloque({
    id: 'pieces-a-valider', nb: d.piecesAValider.filter((p) => dansLaPeriodeTenue(p.date_piece)).length, cible: 'pieces',
    message: `pièce(s) à valider datée(s) de l'exercice ${d.annee} : les valider, ou les retirer, avant la validation — ensuite, leur écriture ne pourrait plus s'y passer.`,
  })
  // Une pièce sans date appartient peut-être à cet exercice : on ne fige pas un exercice qu'elle pourrait compléter.
  bloque({
    id: 'pieces-sans-date', nb: [...d.piecesValidees, ...d.piecesAValider].filter((p) => !p.date_piece).length, cible: 'pieces',
    message: "pièce(s) sans date : elles appartiennent peut-être à cet exercice. Les dater avant la validation.",
    detail: "Dans Justificatifs, le filtre « Sans date » les montre.",
  })
  // Une date impossible cache la vraie, qui peut être dans cet exercice.
  bloque({
    id: 'date-impossible', nb: piecesADateImpossible([...d.piecesValidees, ...d.piecesAValider]).length, cible: 'pieces',
    message: "pièce(s) datée(s) après leur dépôt : leur vraie date est peut-être dans cet exercice. Les corriger avant la validation.",
    detail: "Choisir « toutes les années » dans l'en-tête du dossier pour les voir : elles portent le badge « Date impossible ».",
  })

  // ── La numérotation de l'exercice : celle que la validation enverra. ────────────────────────────────────
  const ecrituresDeLExercice = d.ecritures.filter((e) => dansLExercice(e.date))
  const numerotation = numeroterFec(
    ecrituresDeLExercice, d.piecesValidees, [...d.categories], d.aNouveaux.filter((a) => dansLExercice(a.date)), d.modele.mode, d.lignes,
  )
  bloque({
    id: 'ecritures-orphelines', nb: numerotation.horsFec.length, cible: 'ecritures',
    message: "écriture(s) que rien ne rattache — ni pièce, ni mouvement, ni bien, ni véhicule (le reste d'une pièce supprimée) : les retirer avant la validation.",
  })
  const defauts = defautsDeNumerotation(numerotation)
  const desequilibres = defauts.filter((x) => x.type === 'desequilibre')
  bloque({
    id: 'ecritures-desequilibrees', nb: desequilibres.length, cible: d.modele.mode === 'tresorerie' ? 'banque' : 'ecritures',
    message: d.modele.mode === 'tresorerie'
      ? "écriture(s) déséquilibrée(s) — le plus souvent une pièce dont le paiement n'est pas rapproché : rapprocher son paiement, ou la régénérer."
      : "écriture(s) déséquilibrée(s) : les régénérer avant la validation.",
    detail: desequilibres.slice(0, 5).map((x) => x.type === 'desequilibre'
      ? `${x.pieceRef} (écart de ${(Math.abs(x.ecartCentimes) / 100).toFixed(2).replace('.', ',')} €)` : '').join(' ; ') || undefined,
  })
  bloque({
    id: 'numerotation', nb: defauts.length - desequilibres.length, cible: 'ecritures',
    message: "défaut(s) de numérotation que la base refuserait : un compte qui porte deux libellés, ou des numéros qui ne se suivent pas. Signaler ce cas : il ne devrait pas se produire.",
  })

  // ── La 2035 et les écritures (trésorerie). ──────────────────────────────────────────────────────────────
  if (d.declaration) {
    const e = d.declaration.exclusions
    bloque({
      id: 'concordance', nb: d.concordance ? d.concordance.ecarts.length : 0, cible: 'cloture',
      message: "écart(s) entre la 2035 et les écritures : la validation attend une concordance au centime. Le détail est dans la carte « Concordance » ci-dessous.",
    })
    bloque({
      id: 'exclusions-2035', nb: e.sansPoste.length + e.sansMontant.length + e.mouvementsSansPoste.length + e.mouvementsHorsResultat.length,
      cible: 'cloture',
      message: "pièce(s) ou mouvement(s) que la 2035 ne compte pas (sans poste, sans montant, ou un compte sorti des comptes de résultat) : les compléter avant la validation.",
    })
  }

  // ── Les anomalies du brouillon, ramenées à l'exercice — les points en erreur de la Checklist. ───────────
  const ouvertureDate = ouverture
  const acquisitions = acquisitionsDesBiens(d.immobilisations, d.natures, ouvertureDate)
  const pieceIdsImmobilisees = new Set(acquisitions.keys())
  const ecrituresParPiece = new Map<string, EcritureBrouillon[]>()
  for (const e of d.ecritures) if (e.piece_id) ecrituresParPiece.set(e.piece_id, [...(ecrituresParPiece.get(e.piece_id) ?? []), e])
  // Une pièce concerne l'exercice si l'une de ses écritures y est datée, ou si l'une de celles qu'elle doit
  // produire y tombera.
  const pieceDeLExercice = (p: Piece) =>
    (ecrituresParPiece.get(p.id) ?? []).some((e) => dansLExercice(e.date))
    || datesDesEcrituresAttendues(p, paiements, d.modele).some(dansLExercice)
  const mouvementDeLExercice = (l: { date: string }) => dansLExercice(l.date)

  // Ce que les exercices déjà validés ont figé ne se compare plus (lib/validationExercice.ts) : une pièce payée dans
  // l'exercice à valider mais facturée dans le précédent n'est jugée que sur sa part encore ouverte.
  const frontiere = frontiereDeValidation(d.anneesValidees)
  const aComptabiliser = piecesAComptabiliser([...d.piecesValidees], [...d.categories], acquisitions)
  const { piecesDesynchronisees } = analyserEcritures([...d.ecritures], aComptabiliser, d.assujettiTva, paiements, d.modele, frontiere)
  bloque({
    id: 'ecritures-a-generer', cible: 'ecritures',
    nb: aComptabiliser.filter(({ piece }) => !ecrituresParPiece.has(piece.id) && pieceDeLExercice(piece)).length,
    message: "pièce(s) validée(s) de l'exercice sans écriture : générer leurs écritures avant la validation.",
  })
  bloque({
    id: 'desynchronisees', nb: piecesDesynchronisees.filter(pieceDeLExercice).length, cible: 'ecritures',
    message: "écriture(s) à régénérer (pièce modifiée depuis) : les régénérer avant la validation.",
  })
  bloque({
    id: 'ecritures-sans-objet', cible: 'ecritures',
    nb: ecrituresSansObjet([...d.ecritures], [...d.piecesValidees], [...d.categories], acquisitions, frontiere)
      .filter((s) => (ecrituresParPiece.get(s.piece.id) ?? []).some((e) => dansLExercice(e.date))).length,
    message: "écriture(s) que la pièce ne justifie plus : retirer l'écriture ou corriger la pièce.",
  })
  bloque({
    id: 'sans-categorie', nb: piecesValideesSansCategorie([...d.piecesValidees], pieceIdsImmobilisees).filter(pieceDeLExercice).length, cible: 'pieces',
    message: "pièce(s) validée(s) de l'exercice sans catégorie — invisibles en comptabilité : les catégoriser.",
  })
  bloque({
    id: 'devise-non-convertie', nb: piecesDeviseNonConvertie([...d.piecesValidees]).filter(pieceDeLExercice).length, cible: 'pieces',
    message: "pièce(s) en devise étrangère non converties en euros : les convertir.",
  })
  bloque({
    id: 'tva-impossible', nb: piecesTvaImpossible([...d.piecesValidees]).filter((t) => pieceDeLExercice(t.piece)).length, cible: 'pieces',
    message: "pièce(s) dont la TVA est arithmétiquement impossible : corriger leurs montants.",
  })
  bloque({
    id: 'mois-en-double', cible: 'pieces',
    nb: moisEnDoubleSurAbonnement([...d.piecesValidees, ...d.piecesAValider])
      .filter((m) => anneeDe(`${m.mois}-01`) === d.annee || anneeDe(`${m.moisProbable}-01`) === d.annee).length,
    message: "mois d'abonnement en double, avec un mois voisin vide — une pièce mal datée ou en double : vérifier ces pièces.",
  })
  if (d.doublonsTexte === null) {
    prealables.push({
      id: 'doublons-inconnus', nb: null, cible: 'pieces', bloquant: true,
      message: "Les doublons de contenu n'ont pas pu être vérifiés : réessayer avant la validation.",
    })
  } else {
    const piecesDuDossier = new Map([...d.piecesValidees, ...d.piecesAValider].map((p) => [p.id, p]))
    bloque({
      id: 'doublon-texte', cible: 'pieces',
      nb: d.doublonsTexte.filter((g) => g.pieceIds.some((id) => {
        const p = piecesDuDossier.get(id)
        return !!p && (dansLExercice(p.date_piece) || pieceDeLExercice(p))
      })).length,
      message: "pièce(s) déposée(s) plusieurs fois sous des fichiers différents : retirer le doublon.",
    })
  }
  if (d.relevesIncoherents === null) {
    prealables.push({
      id: 'releves-inconnus', nb: null, cible: 'banque', bloquant: true,
      message: "Le contrôle des relevés bancaires n'a pas pu être lu : réessayer avant la validation.",
    })
  } else {
    // Un relevé sans période connue peut couvrir l'exercice : il compte.
    bloque({
      id: 'releve-incoherent', cible: 'banque',
      nb: d.relevesIncoherents.filter((r) => !r.coherent
        && (r.periode_debut === null || r.periode_fin === null || (r.periode_debut <= fin && r.periode_fin >= debut))).length,
      message: "relevé(s) bancaire(s) de l'exercice qui ne bouclent pas — des mouvements manquent : les compléter.",
    })
  }

  const affectes = mouvementsAffectes(d.lignes, d.categories, d.assujettiTva)
  bloque({
    id: 'affectes-perimes', nb: mouvementsAffectesDesynchronises(d.ecritures, affectes, frontiere).filter((a) => mouvementDeLExercice(a.ligne)).length, cible: 'ecritures',
    message: "mouvement(s) affecté(s) dont l'écriture ne suit plus la catégorie : les réaffecter.",
  })
  bloque({
    id: 'recettes-affectees-assujetti', cible: 'banque',
    nb: recettesAffecteesSansTaux(affectes, d.assujettiTva).filter((a) => mouvementDeLExercice(a.ligne)).length
      + recettesVentileesSansTaux(partsDesVentilations(d.lignes, d.ventilations, d.categories, d.assujettiTva), d.assujettiTva)
        .filter(mouvementDeLExercice).length,
    message: "encaissement(s) affecté(s) ou ventilé(s) en recette sans taux de TVA, sur un dossier assujetti : choisir leur taux.",
  })
  bloque({
    id: 'ventiles-perimes', cible: 'ecritures',
    nb: mouvementsVentilesDesynchronises(d.ecritures, d.lignes, d.ventilations, d.categories, d.modele, d.assujettiTva, frontiere).filter(mouvementDeLExercice).length,
    message: "mouvement(s) ventilé(s) dont l'écriture ne suit plus les parts : les réécrire.",
  })
  bloque({
    id: 'ventilations-incoherentes', nb: ventilationsIncoherentes(d.lignes, d.ventilations).filter((v) => mouvementDeLExercice(v.ligne)).length, cible: 'banque',
    message: "mouvement(s) ventilé(s) dont les parts ne font plus le mouvement : modifier ou annuler ces ventilations.",
  })
  bloque({
    id: 'virements-sans-ecriture', nb: virementsPersonnelsAEcrire(d.ecritures, d.lignes, d.modele).filter(mouvementDeLExercice).length, cible: 'virements',
    message: "virement(s) personnel(s) sans écriture — absents du FEC : les écrire.",
  })
  bloque({
    id: 'echeances-emprunt-perimees', nb: echeancesDesynchronisees(d.ecritures, d.lignes).filter(mouvementDeLExercice).length, cible: 'banque',
    message: "échéance(s) d'emprunt dont l'écriture ne suit plus le découpage : les rapprocher de nouveau.",
  })
  bloque({
    id: 'cotisations-sans-ecriture', nb: cotisationsAEcrire(d.ecritures, d.lignes, d.cotisations, d.modele.mode).filter((c) => mouvementDeLExercice(c.ligne)).length,
    cible: 'cotisations',
    message: "échéance(s) de cotisation payée(s) dont l'écriture manque ou n'est plus à jour : les écrire.",
  })
  bloque({
    id: 'cotisations-rapprochement-refuse', cible: 'banque',
    nb: rapprochementsCotisationRefuses(d.lignes, d.cotisations, d.modele.mode).filter((c) => mouvementDeLExercice(c.ligne)).length,
    message: "rapprochement(s) d'une échéance de cotisation qui ne peuvent pas s'écrire : les annuler.",
  })
  bloque({
    id: 'rapproches-sans-objet', nb: mouvementsRapprochesSansObjet([...d.lignes]).filter(mouvementDeLExercice).length, cible: 'banque',
    message: "mouvement(s) bancaire(s) rapproché(s) sans justificatif : annuler ou refaire ces rapprochements.",
  })
  bloque({
    id: 'reglements-groupes-incoherents', cible: 'banque',
    nb: new Set(reglementsGroupesIncoherents(d.lignes, d.reglements).filter((r) => mouvementDeLExercice(r.ligne)).map((r) => r.ligne.id)).size,
    message: "virement(s) groupé(s) dont une part ne justifie plus rien ou dont les parts ne font plus le mouvement : les régler de nouveau ou les annuler.",
  })
  bloque({
    id: 'pieces-payees-en-trop', cible: 'banque',
    nb: piecesPayeesEnTrop([...d.piecesValidees], paiements).filter((p) => pieceDeLExercice(p.piece)).length,
    message: "pièce(s) payée(s) plus que leur montant — un paiement en double ? Annuler le paiement en trop.",
  })
  bloque({
    id: 'ecart-rapprochement', nb: rapprochementsEcartImportant([...d.lignes], [...d.piecesValidees]).filter((x) => mouvementDeLExercice(x.ligne)).length,
    cible: 'banque',
    message: "rapprochement(s) dont le montant ne correspond pas au mouvement : vérifier le montant ou le rapprochement.",
  })
  // Un bien dont le justificatif a disparu, s'il s'amortit dans l'exercice : sa dotation partirait sans pièce.
  bloque({
    id: 'immos-sans-justificatif', cible: 'immobilisations',
    nb: immobilisationsSansJustificatif([...d.immobilisations])
      .filter((i) => dotationDeLExercice(i, d.annee) > 0 || d.ecritures.some((e) => e.immobilisation_id === i.id && dansLExercice(e.date))).length,
    message: "immobilisation(s) dont le justificatif a été supprimé : retrouver le justificatif ou retirer le bien.",
  })
  bloque({
    id: 'dotations-a-ecrire', cible: 'immobilisations',
    nb: dotationsEnDefaut(dotationsDuRegistre(d.immobilisations, d.natures, d.ecritures, ouvertureDate, d.anneeCourante), d.anneeCourante)
      .filter((x) => x.annee === d.annee).length,
    message: "dotation(s) aux amortissements de l'exercice à écrire, ou qui ne suivent plus le registre : les écrire.",
  })
  bloque({
    id: 'forfaits-a-ecrire', cible: 'informations',
    nb: forfaitsEnDefaut(forfaitsDuCadre7(d.vehicules, d.ecritures, d.modele, ouvertureDate, d.anneeCourante), d.anneeCourante)
      .filter((f) => f.vehicule.annee === d.annee).length,
    message: "forfait(s) kilométrique(s) de l'exercice à écrire, ou qui ne suivent plus le cadre 7 : les écrire.",
  })

  // ── Les avertissements : à lire avant de valider, sans refuser. ────────────────────────────────────────
  const couverture = couvertureDuReleve(d.lignes)
  const echeancesManquantes = couverture
    ? echeancesNonRapprochees(d.emprunts, d.lignes, couverture.debut, couverture.fin).filter((x) => dansLExercice(x.echeance.date))
    : []
  if (echeancesManquantes.length > 0) {
    prealables.push({
      id: 'echeances-emprunt-non-rapprochees', nb: echeancesManquantes.length, cible: 'banque', bloquant: false,
      message: "échéance(s) d'emprunt de l'exercice qu'aucun mouvement ne paie — leurs intérêts ne sont pas comptés. Une fois l'exercice validé, ils ne le seront plus.",
    })
  }

  return { prealables, numerotation, validable: !prealables.some((p) => p.bloquant) }
}

// LES POINTS EN ERREUR DE LA CHECKLIST, et ce que la validation en fait. Chacun est repris ici (son
// identifiant figure dans `prealablesDeValidation`) ou écarté avec sa raison — `prealablesValidation.test.ts`
// lit la Checklist et refuse un point en erreur qui ne figure dans aucune des deux listes : un contrôle ajouté
// demain à la Checklist doit se poser la question ici.
export const POINTS_DE_LA_CHECKLIST_ECARTES: Readonly<Record<string, string>> = {
  'montant-suspect': "en trésorerie l'écriture d'une pièce non payée est déséquilibrée, donc refusée par la numérotation ; en engagement une facture impayée à la clôture est une dette, pas une anomalie",
  'piste-rompue': "ce sont les écritures que rien ne rattache, refusées sous « ecritures-orphelines »",
  desequilibrees: "jugé écriture par écriture sur la numérotation de l'exercice, sous « ecritures-desequilibrees »",
}
