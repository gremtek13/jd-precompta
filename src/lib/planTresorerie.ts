import { empruntActif, genererEcheancier, type Emprunt } from './emprunts'
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
  const aujourdHui = new Date()
  const premierJourMoisCourant = new Date(aujourdHui.getFullYear(), aujourdHui.getMonth(), 1)
  const debutHistorique = new Date(premierJourMoisCourant)
  debutHistorique.setMonth(debutHistorique.getMonth() - nbMoisHistorique)

  const dansHistorique = lignesBanque.filter((l) => {
    const d = new Date(l.date)
    return d >= debutHistorique && d < premierJourMoisCourant
  })
  const totalEncaissements = dansHistorique.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.montant, 0)
  const totalDecaissements = dansHistorique.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.montant, 0)
  const moyenneEncaissements = Math.round((totalEncaissements / nbMoisHistorique) * 100) / 100
  const moyenneDecaissements = Math.round((totalDecaissements / nbMoisHistorique) * 100) / 100

  const lignes: MoisTresorerie[] = []
  let soldeCourant = soldeActuel
  for (let i = 1; i <= nbMoisProjection; i++) {
    const date = new Date(premierJourMoisCourant)
    date.setMonth(date.getMonth() + i)
    const soldeDebut = soldeCourant
    const soldeFin = Math.round((soldeDebut + moyenneEncaissements - moyenneDecaissements) * 100) / 100
    lignes.push({ mois: date.toISOString().slice(0, 7), soldeDebut, encaissements: moyenneEncaissements, decaissements: moyenneDecaissements, soldeFin })
    soldeCourant = soldeFin
  }

  return { moyenneEncaissements, moyenneDecaissements, nbMoisHistorique, lignes }
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
