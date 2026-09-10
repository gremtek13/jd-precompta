import type { EcritureBrouillon } from './types'
import { COMPTE_BANQUE } from './ecritures'

export interface MoisPilotage {
  mois: string // 'YYYY-MM'
  encaissements: number
  decaissements: number
}

// Encaissements/décaissements mensuels réels du compte banque (512), pour le tableau de pilotage de
// l'onglet Balance des comptes (voir StatistiquesTab) — même source que la trésorerie affichée dans
// Financement, juste regroupée mois par mois plutôt qu'en un solde unique. Volontairement indépendant
// de l'exercice sélectionné en en-tête (voir AnneeContext) : une tendance récente reste utile même en
// consultant une année passée, comme le plan de trésorerie de Financement.
// Solde du compte banque (512) à la fin de chacun des N derniers mois d'activité, dans l'ordre
// chronologique — alimente la tendance de trésorerie de la Vue d'ensemble (voir ChecklistTab). Un
// solde cumulé depuis la première écriture du brouillon, donc relatif (pas le solde réel du compte,
// que seul le relevé connaît) : c'est la pente qui compte, pas le niveau absolu.
export function soldesFinDeMois(ecritures: EcritureBrouillon[], nbMois: number): { mois: string; solde: number }[] {
  const parMois = new Map<string, number>()
  for (const e of ecritures) {
    if (e.compte !== COMPTE_BANQUE) continue
    const mois = e.date.slice(0, 7)
    parMois.set(mois, (parMois.get(mois) ?? 0) + (e.sens === 'debit' ? e.montant : -e.montant))
  }
  const moisTries = [...parMois.keys()].sort()
  const cumules = moisTries.reduce<{ mois: string; solde: number }[]>((acc, mois) => {
    const precedent = acc.length > 0 ? acc[acc.length - 1].solde : 0
    return [...acc, { mois, solde: Math.round((precedent + (parMois.get(mois) ?? 0)) * 100) / 100 }]
  }, [])
  return cumules.slice(-nbMois)
}

export function calculerEvolutionMensuelle(ecritures: EcritureBrouillon[], nbMois: number): MoisPilotage[] {
  const lignesBanque = ecritures.filter((e) => e.compte === COMPTE_BANQUE)
  const parMois = new Map<string, { encaissements: number; decaissements: number }>()
  for (const l of lignesBanque) {
    const mois = l.date.slice(0, 7)
    const cur = parMois.get(mois) ?? { encaissements: 0, decaissements: 0 }
    if (l.sens === 'debit') cur.encaissements += l.montant
    else cur.decaissements += l.montant
    parMois.set(mois, cur)
  }
  const moisTries = [...parMois.keys()].sort()
  return moisTries.slice(-nbMois).map((mois) => {
    const valeurs = parMois.get(mois)!
    return {
      mois,
      encaissements: Math.round(valeurs.encaissements * 100) / 100,
      decaissements: Math.round(valeurs.decaissements * 100) / 100,
    }
  })
}
