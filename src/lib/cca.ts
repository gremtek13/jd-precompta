export type TypeMouvementCca = 'apport' | 'retrait' | 'interet'

export interface CompteCourantAssocie {
  id: string
  dossier_id: string
  nom_associe: string
  taux_interet_annuel: number | null
  created_at: string
}

export interface MouvementCca {
  id: string
  compte_id: string
  date: string
  type: TypeMouvementCca
  montant: number
  libelle: string | null
  created_at: string
}

export const LABEL_TYPE_MOUVEMENT_CCA: Record<TypeMouvementCca, string> = {
  apport: 'Apport',
  retrait: 'Retrait',
  interet: 'Intérêts',
}

// Solde recalculé à partir des mouvements plutôt que stocké (voir migration) : un apport ou des
// intérêts créditent le compte courant (l'associé a prêté à la société), un retrait le débite. Pas
// de calcul automatique des intérêts en V1 — le taux renseigné sur le compte reste indicatif, à
// saisir soi-même comme mouvement "Intérêts" le cas échéant (les conventions de calcul, prorata
// temporis ou non, varient trop d'un cabinet à l'autre pour en figer une par défaut).
export function soldeCca(mouvements: MouvementCca[]): number {
  const solde = mouvements.reduce((s, m) => s + (m.type === 'retrait' ? -m.montant : m.montant), 0)
  return Math.round(solde * 100) / 100
}
