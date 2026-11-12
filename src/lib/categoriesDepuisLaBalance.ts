import type { LigneBalance } from './balanceImport'
import { compteDeCategorie, libelleDeCategorie, type ClasseDeCategorie } from './categoriesDuDossier'
import { ROLES_COMPTABLES, type PlanComptable } from './planComptable'

// LES CATÉGORIES QUE LA BALANCE PROPOSE (ligne 43, étape PC7 ; la conception, § 3.8, point 4). Les comptes de charges et
// de produits de la balance d'avant disent les habitudes de ventilation du dossier : chacun est PROPOSÉ comme catégorie
// propre au dossier, sous son compte (à six chiffres, à des zéros près) et son libellé de la balance — le poste de la 2035
// est choisi par le cabinet, jamais deviné. Rien ne s'écrit sans le clic. Module pur ; l'écran est le troisième temps de
// la carte de la balance (`CategoriesDeLaBalance`), derrière `CATEGORIES_DU_DOSSIER_PREVUES`.
//
// ÉCARTÉS, ET DITS : un compte de plus de six chiffres significatifs (le plan en a six) ; ce que l'application écrit
// elle-même — les dotations aux amortissements (sous la racine du rôle, 6811 : le registre des immobilisations, case CH),
// les cotisations personnelles de l'exploitant (646 : l'onglet Cotisations, COT-Q2), le compte du barème kilométrique du
// plan (le cadre 7 ; la garde de la base le refuse) ; un compte qu'une catégorie que le dossier voit tient déjà.

export interface CategorieConnue {
  libelle: string
  compte_comptable: string | null
}

export interface CategorieProposee {
  compte: string
  classe: ClasseDeCategorie
  /** Les numéros de la balance qui la portent (6064 et 606400 sont un même compte). */
  numeros: string[]
  /** Le premier libellé de la balance qui en est un, ou nul : le cabinet en tape un. */
  libelle: string | null
  /** Débit moins crédit, en centimes : ce que la balance a vu passer, pour mémoire. */
  solde: number
}

export type RaisonDEcart = 'trop_long' | 'dotations' | 'cotisations' | 'bareme' | 'deja'

export interface CompteEcarteDeLaBalance {
  numero: string
  libelle: string
  raison: RaisonDEcart
  /** La catégorie qui tient déjà le compte (raison « deja »). */
  categorie?: string
}

const racinesDu = (role: 'dotations_amortissements' | 'cotisations_exploitant') =>
  ROLES_COMPTABLES.find((r) => r.role === role)!.racines

const sansZeros = (c: string) => c.replace(/0+$/, '')

export function categoriesDepuisLaBalance(balance: readonly LigneBalance[], plan: PlanComptable, connues: readonly CategorieConnue[]):
  { proposees: CategorieProposee[]; ecartes: CompteEcarteDeLaBalance[] } {
  const parCompte = new Map<string, CategorieProposee>()
  const ecartes: CompteEcarteDeLaBalance[] = []
  for (const ligne of balance) {
    const numero = ligne.compte.trim()
    if (!/^[67][0-9]*$/.test(numero)) continue
    const lu = compteDeCategorie(numero)
    if ('refus' in lu) { ecartes.push({ numero, libelle: ligne.libelle, raison: 'trop_long' }); continue }
    if (racinesDu('dotations_amortissements').some((r) => lu.compte.startsWith(r))) { ecartes.push({ numero, libelle: ligne.libelle, raison: 'dotations' }); continue }
    if (racinesDu('cotisations_exploitant').some((r) => lu.compte.startsWith(r))) { ecartes.push({ numero, libelle: ligne.libelle, raison: 'cotisations' }); continue }
    if (sansZeros(lu.compte) === sansZeros(plan.indemnites_kilometriques)) { ecartes.push({ numero, libelle: ligne.libelle, raison: 'bareme' }); continue }
    const tenue = connues.find((c) => c.compte_comptable !== null && sansZeros(c.compte_comptable.trim()) === sansZeros(lu.compte))
    if (tenue) { ecartes.push({ numero, libelle: ligne.libelle, raison: 'deja', categorie: tenue.libelle }); continue }
    const centimes = Math.round(ligne.debit * 100) - Math.round(ligne.credit * 100)
    const deja = parCompte.get(lu.compte)
    if (deja) {
      deja.numeros.push(numero)
      deja.solde += centimes
      deja.libelle ??= libelleDeCategorie(ligne.libelle)
    } else {
      parCompte.set(lu.compte, { compte: lu.compte, classe: lu.classe, numeros: [numero], libelle: libelleDeCategorie(ligne.libelle), solde: centimes })
    }
  }
  const proposees = [...parCompte.values()].sort((a, b) => (a.compte < b.compte ? -1 : a.compte > b.compte ? 1 : 0))
  return { proposees, ecartes }
}

/** Ce que l'écran dit d'un compte écarté. */
export function texteDUnEcart(e: CompteEcarteDeLaBalance): string {
  const compte = `${e.numero}${e.libelle.trim() ? ` « ${e.libelle.trim()} »` : ''}`
  switch (e.raison) {
    case 'trop_long': return `${compte} : plus de six chiffres significatifs, le plan du dossier en a six.`
    case 'dotations': return `${compte} : les dotations se calculent depuis le registre des immobilisations.`
    case 'cotisations': return `${compte} : les cotisations de l’exploitant passent par l’onglet Cotisations.`
    case 'bareme': return `${compte} : le compte du barème kilométrique du plan (cadre 7), séparé des frais réels.`
    case 'deja': return `${compte} : déjà le compte de la catégorie « ${e.categorie ?? ''} ».`
  }
}
