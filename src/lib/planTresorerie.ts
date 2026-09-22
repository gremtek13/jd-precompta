import { empruntActif, genererEcheancier, type Emprunt } from './emprunts'
import { ajouterMois, premierJourDuMoisCourant } from './format'
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

// LE SOLDE VIENT DE LA MÊME SOURCE, ET SA FENÊTRE N'EST PAS LA MÊME. `reserveSurMoyenne` parle des
// `nbMoisHistorique` derniers mois ; un solde de trésorerie, lui, cumule TOUT l'historique — un dossier
// peut donc avoir un solde parfaitement juste et une moyenne qui ne repose sur rien. Les deux réserves
// sont distinctes pour cette raison, et pas par symétrie décorative.
//
// « Trésorerie à cette date : 0,00 € » est arithmétiquement JUSTE quand rien n'est comptabilisé — et
// c'est précisément ce qui le rend dangereux : indiscernable d'un compte réellement vide, sur l'état
// qu'un cabinet montre à une banque.
export function reserveSurSolde(lignesBanque: LigneBanquePourPlan[]): string | null {
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
