import type { CotisationDeclaree, Piece } from './types'

// Calculs partagés entre l'Estimation cabinet (EstimationTab, un dossier à la fois) et la Simulation
// côté client (ClientSimulation, lecture seule) — mêmes chiffres, un seul endroit à faire évoluer si
// la règle de projection change un jour.

export function totauxPourAnnee(pieces: Piece[], cotisations: CotisationDeclaree[], annee: number) {
  const ca = pieces
    .filter((p) => p.date_piece?.startsWith(String(annee)))
    .reduce((sum, p) => sum + (p.montant_ht ?? p.montant_ttc ?? 0), 0)
  const cotis = cotisations
    .filter((c) => c.echeance.startsWith(String(annee)))
    .reduce((sum, c) => sum + (c.montant_verse ?? c.montant_appele), 0)
  return { ca, cotis }
}

export function ecartPct(valeurN: number, valeurN1: number | null): string {
  if (!valeurN1) return '—'
  return `${valeurN >= valeurN1 ? '+' : ''}${(((valeurN - valeurN1) / valeurN1) * 100).toFixed(0)} %`
}
