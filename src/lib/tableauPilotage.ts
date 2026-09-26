import type { EcritureBrouillon } from './types'
import { COMPTE_BANQUE } from './comptes'
import type { OuvertureBanque } from './planTresorerie'

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
// chronologique — alimente la tuile de trésorerie de la Vue d'ensemble (voir ChecklistTab).
//
// SANS ouverture, c'est un solde cumulé depuis la première écriture du brouillon, donc RELATIF (pas le
// solde réel du compte, que seul le relevé connaît) : la pente compte, pas le niveau. AVEC des
// à-nouveaux (voir lib/aNouveaux.ts), le niveau devient réel : la série part du solde repris, et les
// écritures antérieures à l'ouverture en sont écartées — elles y sont déjà. C'est la règle de
// `soldeBanqueADate` (lib/planTresorerie.ts), écriture du jour de l'ouverture comprise : sans elle, la
// tuile de la Vue d'ensemble comptait l'ouverture pour rien et passait au ROUGE sur un dossier repris
// dont la trésorerie, dans Financement, est positive.
//
// L'ouverture est un paramètre OBLIGATOIRE, nul quand le dossier n'en a pas : un appelant qui
// l'oublierait retomberait sur l'ancien calcul sans que rien ne le dise.
export function soldesFinDeMois(
  ecritures: EcritureBrouillon[],
  nbMois: number,
  ouverture: OuvertureBanque | null,
): { mois: string; solde: number }[] {
  // En centimes : un cumul de flottants dérive sur une longue série.
  const parMois = new Map<string, number>()
  const ajouter = (mois: string, centimes: number) => parMois.set(mois, (parMois.get(mois) ?? 0) + centimes)
  for (const e of ecritures) {
    if (e.compte !== COMPTE_BANQUE) continue
    if (ouverture && e.date < ouverture.date) continue
    ajouter(e.date.slice(0, 7), (e.sens === 'debit' ? 1 : -1) * Math.round(e.montant * 100))
  }
  // Le mois de l'ouverture existe même sans écriture : un dossier qu'on vient d'ouvrir a un solde.
  if (ouverture) ajouter(ouverture.date.slice(0, 7), Math.round(ouverture.solde * 100))
  let cumul = 0
  const cumules = [...parMois.keys()].sort().map((mois) => {
    cumul += parMois.get(mois) ?? 0
    return { mois, solde: cumul / 100 }
  })
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
