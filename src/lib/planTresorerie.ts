import { empruntActif, genererEcheancier, type Emprunt } from './emprunts'
import { ajouterMois, formatDate, premierJourDuMoisCourant } from './format'
import type { CotisationDeclaree } from './types'

export interface LigneBanquePourPlan { date: string; sens: 'debit' | 'credit'; montant: number }

export interface MoisTresorerie {
  mois: string // 'YYYY-MM'
  soldeDebut: number
  encaissements: number
  decaissements: number
  soldeFin: number
}

export interface PlanTresorerie {
  moyenneEncaissements: number
  moyenneDecaissements: number
  nbMoisHistorique: number
  // CE SUR QUOI LA MOYENNE REPOSE RÉELLEMENT — sans quoi « 0,00 € observé » et « rien à observer »
  // rendent exactement le même écran, et c'est une AFFIRMATION : le plan annonce alors une activité
  // nulle là où il n'a rien lu. Famille déjà connue de ce dépôt (« une lecture dont l'échec ressemble
  // à un résultat vide »), sur le document qu'un cabinet montre à une banque.
  nbLignesObservees: number
  // Combien des `nbMoisHistorique` mois portent au moins une écriture. Le DIVISEUR reste
  // `nbMoisHistorique` : un mois calme est un vrai zéro, et diviser par les seuls mois servis
  // gonflerait la moyenne d'un cabinet en congés. On le DIT au lieu de le corriger — le code ne peut
  // pas distinguer « rien lu » de « rien encaissé », l'écran, lui, peut poser la question.
  nbMoisAvecDonnees: number
  lignes: MoisTresorerie[]
}

// Deuxième brique du "dossier bancaire automatisé" (voir CLAUDE.md) — projection linéaire à partir
// de la moyenne mensuelle réelle des encaissements/décaissements bancaires sur les
// `nbMoisHistorique` derniers mois complets (hors mois en cours, pas terminé). Ce n'est PAS un
// budget prévisionnel poste par poste (l'app n'a pas cette notion) : juste "si le rythme actuel se
// maintient". Les mensualités d'emprunts déjà en cours et les cotisations déjà payées transitent par
// ce même compte banque, donc sont déjà comprises dans cette moyenne — les rajouter séparément
// doublerait leur effet. Voir echeancesEmprunts/echeancesCotisations ci-dessous pour une liste
// indicative des échéances connues, à part, plutôt que fusionnée dans le calcul.
export function calculerPlanTresorerie(
  lignesBanque: LigneBanquePourPlan[], soldeActuel: number, nbMoisHistorique: number, nbMoisProjection: number,
): PlanTresorerie {
  // Bornes comparées en chaînes AAAA-MM-JJ plutôt qu'en objets Date : `l.date` est une date SQL nue,
  // et la convertir en Date la place à minuit UTC, décalée par rapport à un minuit local — de quoi
  // faire basculer d'un jour les lignes situées pile sur une borne.
  const premierJourMoisCourant = premierJourDuMoisCourant()
  const debutHistorique = ajouterMois(premierJourMoisCourant, -nbMoisHistorique)

  const dansHistorique = lignesBanque.filter(
    (l) => l.date >= debutHistorique && l.date < premierJourMoisCourant,
  )
  const totalEncaissements = dansHistorique.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.montant, 0)
  const totalDecaissements = dansHistorique.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.montant, 0)
  const moyenneEncaissements = Math.round((totalEncaissements / nbMoisHistorique) * 100) / 100
  const moyenneDecaissements = Math.round((totalDecaissements / nbMoisHistorique) * 100) / 100
  const nbMoisAvecDonnees = new Set(dansHistorique.map((l) => l.date.slice(0, 7))).size

  const lignes: MoisTresorerie[] = []
  let soldeCourant = soldeActuel
  for (let i = 1; i <= nbMoisProjection; i++) {
    const soldeDebut = soldeCourant
    const soldeFin = Math.round((soldeDebut + moyenneEncaissements - moyenneDecaissements) * 100) / 100
    const mois = ajouterMois(premierJourMoisCourant, i).slice(0, 7)
    lignes.push({ mois, soldeDebut, encaissements: moyenneEncaissements, decaissements: moyenneDecaissements, soldeFin })
    soldeCourant = soldeFin
  }

  return {
    moyenneEncaissements, moyenneDecaissements, nbMoisHistorique,
    nbLignesObservees: dansHistorique.length, nbMoisAvecDonnees, lignes,
  }
}

// LA RÉSERVE QUI MANQUAIT À LA MOYENNE. Rendue `null` quand elle n'apprend rien — une mise en garde
// permanente cesse d'être lue, puis emporte ses voisines dans son discrédit (même arbitrage que
// `dotationsNonProratisees` et `detailPiecesSansDate`).
//
// Les deux cas ne disent PAS la même chose, et les fondre ferait porter à l'un la conséquence de
// l'autre : « rien à observer » est une moyenne qui ne repose sur rien, « observé sur une partie »
// est une moyenne juste dont l'assiette est plus courte que l'étiquette ne le laisse croire.
export function reserveSurMoyenne(plan: PlanTresorerie): string | null {
  if (plan.nbLignesObservees === 0) {
    return `Aucun mouvement bancaire sur ces ${plan.nbMoisHistorique} mois : la moyenne ne repose sur rien, `
      + `et 0,00 € ne veut pas dire « aucun encaissement ». Les mouvements n'arrivent ici qu'une fois les `
      + `écritures générées (onglet Écritures) — un relevé importé ne suffit pas.`
  }
  if (plan.nbMoisAvecDonnees < plan.nbMoisHistorique) {
    const manquants = plan.nbMoisHistorique - plan.nbMoisAvecDonnees
    return `Mouvements observés sur ${plan.nbMoisAvecDonnees} de ces ${plan.nbMoisHistorique} mois : `
      + `${manquants === 1 ? 'le mois restant compte' : `les ${manquants} mois restants comptent`} comme `
      + `${manquants === 1 ? 'un mois' : 'des mois'} à zéro dans la moyenne. Si c'est l'historique qui manque `
      + `et non l'activité, la moyenne est sous-estimée d'autant.`
  }
  return null
}

// L'ouverture d'un dossier repris d'un autre logiciel : le solde du compte banque à sa date, lu dans
// ses à-nouveaux (voir lib/aNouveaux.ts, `ouvertureBanque`).
export interface OuvertureBanque {
  date: string
  solde: number
}

// Le solde du compte banque à une date. Sans ouverture, c'est le cumul de TOUT l'historique du
// brouillon — juste seulement si cet historique remonte à l'ouverture du compte, ce qui n'est vrai
// que d'un dossier né dans l'application.
//
// AVEC UNE OUVERTURE, ELLE FAIT FOI À SA DATE ET REMPLACE TOUT CE QUI PRÉCÈDE. Les écritures
// antérieures sont déjà dans le solde repris : les ajouter le compterait deux fois — le cas d'un
// cabinet qui collectait les pièces d'un exercice dans l'application pendant qu'il le tenait encore
// dans son ancien logiciel. Une écriture datée du jour même de l'ouverture est un mouvement de ce
// jour-là, donc postérieur au solde de la veille : elle s'ajoute.
//
// Avant l'ouverture, aucun solde de départ n'est connu : on retombe sur le cumul, et
// `reserveSurSolde` le dit.
//
// En centimes entiers : une somme de flottants dérive, et ce chiffre-là part à une banque.
export function soldeBanqueADate(
  lignesBanque: LigneBanquePourPlan[], ouverture: OuvertureBanque | null, date: string,
): number {
  const depart = ouverture && date >= ouverture.date ? ouverture : null
  const centimes = lignesBanque
    .filter((l) => l.date <= date && (depart === null || l.date >= depart.date))
    .reduce((s, l) => s + (l.sens === 'debit' ? 1 : -1) * Math.round(l.montant * 100), 0)
  return (centimes + (depart ? Math.round(depart.solde * 100) : 0)) / 100
}

// LE SOLDE VIENT DE LA MÊME SOURCE, ET SA FENÊTRE N'EST PAS LA MÊME. `reserveSurMoyenne` parle des
// `nbMoisHistorique` derniers mois ; un solde de trésorerie, lui, cumule TOUT l'historique — un dossier
// peut donc avoir un solde parfaitement juste et une moyenne qui ne repose sur rien. Les deux réserves
// sont distinctes pour cette raison, et pas par symétrie décorative.
//
// « Trésorerie à cette date : 0,00 € » est arithmétiquement JUSTE quand rien n'est comptabilisé — et
// c'est précisément ce qui le rend dangereux : indiscernable d'un compte réellement vide, sur l'état
// qu'un cabinet montre à une banque.
//
// Des à-nouveaux changent la réponse : à partir de leur date, le solde de départ est CONNU, même sans
// aucune écriture — une banque soldée à la reprise est un zéro vrai. Avant elle, on n'en connaît aucun.
export function reserveSurSolde(
  lignesBanque: LigneBanquePourPlan[], ouverture: OuvertureBanque | null, date: string,
): string | null {
  if (ouverture && date >= ouverture.date) return null
  if (ouverture) {
    return `Cette date précède l'ouverture du dossier (${formatDate(ouverture.date)}) : aucun solde de `
      + `départ n'est connu avant elle, ce chiffre ne compte que les écritures bancaires antérieures.`
  }
  if (lignesBanque.length > 0) return null
  return `Aucune écriture bancaire dans ce dossier : ce solde n'est pas « zéro à la banque », c'est `
    + `« rien de comptabilisé ». Les mouvements n'arrivent ici qu'une fois les écritures générées `
    + `(onglet Écritures) — un relevé importé ne suffit pas.`
}

export interface EcheanceConnue { date: string; libelle: string; montant: number }

// Mensualités futures des emprunts actifs sur la période du plan — sert surtout à repérer un prêt
// qui se termine bientôt (la moyenne historique le suppose actif indéfiniment) ou un emprunt trop
// récent pour être déjà représenté dans l'historique bancaire utilisé ci-dessus.
export function echeancesEmprunts(emprunts: Emprunt[], dateDebut: string, dateFin: string): EcheanceConnue[] {
  return emprunts.flatMap((e) => {
    if (!empruntActif(e, dateDebut)) return []
    return genererEcheancier(e)
      .filter((l) => l.date >= dateDebut && l.date <= dateFin)
      .map((l) => ({ date: l.date, libelle: `Emprunt — ${e.nom}`, montant: l.mensualite }))
  })
}

// Cotisations sociales pas encore versées, à échéance sur la période du plan.
export function echeancesCotisations(cotisations: CotisationDeclaree[], dateDebut: string, dateFin: string): EcheanceConnue[] {
  return cotisations
    .filter((c) => c.montant_verse == null && c.echeance >= dateDebut && c.echeance <= dateFin)
    .map((c) => ({ date: c.echeance, libelle: 'Cotisation sociale', montant: c.montant_appele }))
}
