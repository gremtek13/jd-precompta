export interface Emprunt {
  id: string
  dossier_id: string
  nom: string
  organisme_preteur: string | null
  capital_initial: number
  taux_annuel: number
  date_debut: string
  duree_mois: number
  created_at: string
}

export interface LigneEcheancier {
  numero: number
  date: string
  mensualite: number
  interets: number
  capitalRembourse: number
  capitalRestant: number
}

// Amortissement à mensualité constante — la formule la plus répandue pour un prêt professionnel
// classique (contrairement à un in fine, où seuls les intérêts sont versés jusqu'au dernier mois :
// pas géré ici, à ajouter séparément si un cabinet en a besoin plutôt que de complexifier ce calcul).
export function calculerMensualite(capitalInitial: number, tauxAnnuel: number, dureeMois: number): number {
  const tauxMensuel = tauxAnnuel / 100 / 12
  if (tauxMensuel === 0) return capitalInitial / dureeMois
  return (capitalInitial * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -dureeMois))
}

// Échéancier complet, recalculé à la demande plutôt que stocké ligne à ligne (voir migration) — un
// prêt à mensualité constante est entièrement déterminé par ses 4 paramètres, aucune raison de
// persister ce qui s'en déduit mécaniquement. Le dernier mois absorbe l'écart d'arrondi accumulé,
// pour que le capital restant dû final tombe exactement à zéro plutôt que quelques centimes à côté.
export function genererEcheancier(emprunt: Pick<Emprunt, 'capital_initial' | 'taux_annuel' | 'duree_mois' | 'date_debut'>): LigneEcheancier[] {
  const tauxMensuel = emprunt.taux_annuel / 100 / 12
  const mensualite = Math.round(calculerMensualite(emprunt.capital_initial, emprunt.taux_annuel, emprunt.duree_mois) * 100) / 100
  const debut = new Date(emprunt.date_debut)
  let capitalRestant = emprunt.capital_initial
  const lignes: LigneEcheancier[] = []

  for (let i = 1; i <= emprunt.duree_mois; i++) {
    const interets = Math.round(capitalRestant * tauxMensuel * 100) / 100
    let capitalRembourse = Math.round((mensualite - interets) * 100) / 100
    if (i === emprunt.duree_mois) capitalRembourse = capitalRestant
    capitalRestant = Math.max(Math.round((capitalRestant - capitalRembourse) * 100) / 100, 0)
    const date = new Date(debut)
    date.setMonth(date.getMonth() + i)
    lignes.push({ numero: i, date: date.toISOString().slice(0, 10), mensualite, interets, capitalRembourse, capitalRestant })
  }
  return lignes
}

// Capital restant dû à une date donnée (par défaut aujourd'hui) — sert à afficher un état actuel sans
// dérouler tout l'échéancier à l'écran. Avant le début du prêt : le capital initial en entier. Après
// le terme : zéro.
export function capitalRestantDu(emprunt: Emprunt, dateReference: string = new Date().toISOString().slice(0, 10)): number {
  if (dateReference < emprunt.date_debut) return emprunt.capital_initial
  const echeancier = genererEcheancier(emprunt)
  const passees = echeancier.filter((l) => l.date <= dateReference)
  return passees.length > 0 ? passees[passees.length - 1].capitalRestant : emprunt.capital_initial
}

// Un prêt est "actif" à une date donnée s'il reste du capital à rembourser à ce moment — sert à
// exclure les emprunts déjà soldés des totaux (mensualités actuelles, endettement en cours).
export function empruntActif(emprunt: Emprunt, dateReference: string = new Date().toISOString().slice(0, 10)): boolean {
  return dateReference >= emprunt.date_debut && capitalRestantDu(emprunt, dateReference) > 0
}
