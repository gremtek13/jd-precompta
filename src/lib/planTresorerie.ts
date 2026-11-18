import { empruntActif, genererEcheancier, type Emprunt } from './emprunts'
import { ajouterJours, ajouterMois, dernierJourDuMois, formatDate, premierJourDuMoisCourant } from './format'
import type { CotisationDeclaree } from './types'

export interface LigneBanquePourPlan { date: string; sens: 'debit' | 'credit'; montant: number }

export interface MoisTresorerie {
  mois: string // 'YYYY-MM'
  soldeDebut: number
  encaissements: number
  decaissements: number
  soldeFin: number
}

/** Le mois de raccord (C8Q2-Q3) : du lendemain de la dernière écriture de banque à la fin du mois en cours (AAAA-MM-JJ). */
export interface RaccordTresorerie {
  du: string
  au: string
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
  /**
   * Le mois de raccord (C8Q2-Q3) : les jours qui séparent la dernière écriture de banque de la fin du mois en cours, au
   * rythme moyen compté au prorata des jours ; nul quand ces jours n'existent pas, ou que l'appelant ne connaît pas la date
   * de cette écriture (`departAu` nul) — le plan est alors celui d'hier, au centime.
   */
  raccord: RaccordTresorerie | null
  /** Les mois complets, du mois qui suit le mois en cours ; le premier part de la fin du raccord, sinon du solde du jour. */
  lignes: MoisTresorerie[]
}

// ── Le mois de raccord (C8Q2-Q3, la réponse (B) du cabinet du 18/11/2026 : « corriger avant le collage, par un mois de
// raccord au prorata des jours ») ─────────────────────────────────────────────────────────────────────────────────────
// Le plan part du solde des écritures de banque au jour de leur dernière écriture, et projette des mois complets à partir
// du mois qui suit le mois en cours : les jours entre cette écriture et la fin du mois en cours n'étaient comptés nulle
// part (le 15 novembre, une dernière écriture du 31 octobre laissait tout novembre de côté, et « décembre » partait du
// solde du 31 octobre). LE RACCORD LES COMPTE : du lendemain de la dernière écriture à la fin du mois en cours, le rythme
// moyen AU PRORATA DES JOURS de chaque mois qu'il touche — pour un mois, ses jours couverts sur ses jours, la part arrondie
// au centime, le demi-centime vers le haut —, puis la somme des parts ; un mois couvert en entier compte le rythme exact.
// Aucun texte ne régit un plan de trésorerie : la règle est celle du cabinet, sur les jours réels du calendrier civil, les
// mois mêmes du plan. La base la refait en entiers sur la prévision publiée (`refus_de_la_prevision`,
// supabase/schema/20261118154124_previsions_publiees.sql) ; l'écran du cabinet et la prévision la tirent d'ici.

/**
 * La date du solde de départ : la dernière écriture de banque comptée au jour donné (celles d'avant l'ouverture ne comptent
 * plus : le solde repris les porte), ou l'ouverture elle-même ; nulle quand rien n'est comptabilisé.
 */
export function dateDuDepart(lignesBanque: readonly LigneBanquePourPlan[], ouverture: OuvertureBanque | null, jour: string): string | null {
  const depart = ouverture && ouverture.date <= jour ? ouverture.date : null
  let au: string | null = depart
  for (const l of lignesBanque) {
    if (l.date > jour || (depart !== null && l.date < depart)) continue
    if (au === null || l.date > au) au = l.date
  }
  return au
}

/** Les jours du raccord : du lendemain de `departAu` au dernier jour du mois de `premierJourMoisCourant` ; nuls s'il n'en reste aucun. */
export function periodeDuRaccord(departAu: string, premierJourMoisCourant: string): { du: string; au: string } | null {
  const du = ajouterJours(departAu, 1)
  const au = dernierJourDuMois(premierJourMoisCourant)
  return du <= au ? { du, au } : null
}

const JOUR_MS = 86_400_000
const instantDuJour = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))

/**
 * La part d'un rythme mensuel (des centimes ENTIERS) sur les jours `du` à `au`, bornes comprises : pour chaque mois touché,
 * le rythme × ses jours couverts ÷ ses jours, arrondi au centime (le demi-centime s'éloigne de zéro), puis la somme. En
 * entiers exacts (BigInt) : la base fait la même division entière, `div(2 × rythme × jours + longueur, 2 × longueur)`.
 * NaN pour un rythme qui n'est pas un entier sûr ; 0 pour une période vide.
 */
export function partDuRythme(centimesParMois: number, du: string, au: string): number {
  if (!Number.isSafeInteger(centimesParMois)) return Number.NaN
  const rythme = BigInt(Math.abs(centimesParMois))
  let total = 0n
  for (let debut = `${du.slice(0, 7)}-01`; debut <= au; debut = ajouterMois(debut, 1)) {
    const fin = dernierJourDuMois(debut)
    const premier = du > debut ? du : debut
    const dernier = au < fin ? au : fin
    const jours = BigInt((instantDuJour(dernier) - instantDuJour(premier)) / JOUR_MS + 1)
    const longueur = BigInt(Number(fin.slice(8, 10)))
    if (jours > 0n) total += (2n * rythme * jours + longueur) / (2n * longueur)
  }
  return Number(centimesParMois < 0 ? -total : total)
}

// Deuxième brique du "dossier bancaire automatisé" (voir CLAUDE.md) — projection linéaire à partir
// de la moyenne mensuelle réelle des encaissements/décaissements bancaires sur les
// `nbMoisHistorique` derniers mois complets (hors mois en cours, pas terminé). Ce n'est PAS un
// budget prévisionnel poste par poste (l'app n'a pas cette notion) : juste "si le rythme actuel se
// maintient". Les mensualités d'emprunts déjà en cours et les cotisations déjà payées transitent par
// ce même compte banque, donc sont déjà comprises dans cette moyenne — les rajouter séparément
// doublerait leur effet. Voir echeancesEmprunts/echeancesCotisations ci-dessous pour une liste
// indicative des échéances connues, à part, plutôt que fusionnée dans le calcul.
//
// `departAu` : la date du solde de départ (`dateDuDepart`), d'où part le raccord ; nulle, aucun raccord — le plan d'hier,
// pour qui ne lit que la moyenne (les ratios) ou ne connaît pas cette date. Un paramètre sans défaut : chaque appelant dit
// s'il veut le raccord.
export function calculerPlanTresorerie(
  lignesBanque: LigneBanquePourPlan[], soldeActuel: number, nbMoisHistorique: number, nbMoisProjection: number,
  departAu: string | null,
): PlanTresorerie {
  return calculerPlanTresorerieAu(lignesBanque, soldeActuel, nbMoisHistorique, nbMoisProjection, premierJourDuMoisCourant(), departAu)
}

// LE MÊME PLAN, AU MOIS QU'ON LUI DONNE (C8-Q2) : `premierJourMoisCourant` (AAAA-MM-01) remplace le mois du jour lu sur
// l'horloge locale. La prévision publiée au client se compose au jour de PARIS, celui que la base vérifie
// (lib/previsionsPubliees.ts) ; l'écran du cabinet garde `calculerPlanTresorerie`, au jour local, comme hier.
export function calculerPlanTresorerieAu(
  lignesBanque: readonly LigneBanquePourPlan[], soldeActuel: number, nbMoisHistorique: number, nbMoisProjection: number,
  premierJourMoisCourant: string, departAu: string | null,
): PlanTresorerie {
  // Bornes comparées en chaînes AAAA-MM-JJ plutôt qu'en objets Date : `l.date` est une date SQL nue,
  // et la convertir en Date la place à minuit UTC, décalée par rapport à un minuit local — de quoi
  // faire basculer d'un jour les lignes situées pile sur une borne.
  const debutHistorique = ajouterMois(premierJourMoisCourant, -nbMoisHistorique)

  const dansHistorique = lignesBanque.filter(
    (l) => l.date >= debutHistorique && l.date < premierJourMoisCourant,
  )
  const totalEncaissements = dansHistorique.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.montant, 0)
  const totalDecaissements = dansHistorique.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.montant, 0)
  const moyenneEncaissements = Math.round((totalEncaissements / nbMoisHistorique) * 100) / 100
  const moyenneDecaissements = Math.round((totalDecaissements / nbMoisHistorique) * 100) / 100
  const nbMoisAvecDonnees = new Set(dansHistorique.map((l) => l.date.slice(0, 7))).size

  // Le raccord, en centimes comme la prévision publiée : les moyennes sont déjà au centime.
  const periode = departAu === null ? null : periodeDuRaccord(departAu, premierJourMoisCourant)
  let raccord: RaccordTresorerie | null = null
  if (periode !== null) {
    const encaissements = partDuRythme(Math.round(moyenneEncaissements * 100), periode.du, periode.au) / 100
    const decaissements = partDuRythme(Math.round(moyenneDecaissements * 100), periode.du, periode.au) / 100
    const soldeFin = Math.round((soldeActuel + encaissements - decaissements) * 100) / 100
    raccord = { du: periode.du, au: periode.au, soldeDebut: soldeActuel, encaissements, decaissements, soldeFin }
  }

  const lignes: MoisTresorerie[] = []
  let soldeCourant = raccord ? raccord.soldeFin : soldeActuel
  for (let i = 1; i <= nbMoisProjection; i++) {
    const soldeDebut = soldeCourant
    const soldeFin = Math.round((soldeDebut + moyenneEncaissements - moyenneDecaissements) * 100) / 100
    const mois = ajouterMois(premierJourMoisCourant, i).slice(0, 7)
    lignes.push({ mois, soldeDebut, encaissements: moyenneEncaissements, decaissements: moyenneDecaissements, soldeFin })
    soldeCourant = soldeFin
  }

  return {
    moyenneEncaissements, moyenneDecaissements, nbMoisHistorique,
    nbLignesObservees: dansHistorique.length, nbMoisAvecDonnees, raccord, lignes,
  }
}

// LA RÉSERVE QUI MANQUAIT À LA MOYENNE. Rendue `null` quand elle n'apprend rien — une mise en garde
// permanente cesse d'être lue, puis emporte ses voisines dans son discrédit (même arbitrage que
// `detailPiecesSansDate`).
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
  lignesBanque: readonly LigneBanquePourPlan[], ouverture: OuvertureBanque | null, date: string,
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
  lignesBanque: readonly LigneBanquePourPlan[], ouverture: OuvertureBanque | null, date: string,
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
