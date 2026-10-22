import type { MouvementsHorsDesLots } from './mouvementsDesVentes'
import type { LigneBancaire, RegleBancaireIgnoree, StatutLigneBancaire } from './types'

// Le statut d'un mouvement À SON IMPORT : « ignoré » quand une règle « toujours ignorer » du dossier en
// reconnaît le libellé, « à traiter » sinon. Ce statut est ÉCRIT en base : une règle qu'on n'a pas lue
// laisserait « à traiter » un mouvement qu'elle couvre, et aucun rechargement ne le réparerait — d'où la
// suspension de chaque import sur une lecture partielle des règles.
//
// Commun aux trois chemins d'import — un relevé CSV, un relevé PDF, la connexion bancaire —, et c'est la
// raison d'être de ce module : la règle vivait dans l'onglet Banque, et la connexion bancaire en aurait
// écrit une seconde copie.
export function statutPourLibelle(libelle: string, regles: Pick<RegleBancaireIgnoree, 'motif'>[]): StatutLigneBancaire {
  const l = libelle.toLowerCase()
  return regles.some((r) => l.includes(r.motif)) ? 'ignoree' : 'non_rapprochee'
}

export interface IgnoresParLaRegle<L> {
  // Les mouvements déjà importés que la règle nouvelle fait ignorer, en une seule mise à jour.
  aIgnorer: L[]
  // Ceux qu'elle reconnaît mais qui portent des encaissements de factures (étape VF5a2, lib/mouvementsDesVentes.ts) : la
  // garde G2 refuserait la mise à jour ENTIÈRE. Ils restent à traiter ; l'écran dit combien, et pourquoi.
  ecartesParLesVentes: L[]
}

// LA RÈGLE « TOUJOURS IGNORER », SUR LES MOUVEMENTS DÉJÀ IMPORTÉS : ceux qui sont à traiter et dont le libellé contient le
// motif — le jugement même de l'import (`statutPourLibelle`), qui, lui, ne rencontre jamais un mouvement réservé : un
// mouvement naît libre, et un encaissement ne le cite qu'ensuite. `horsDesLots` n'a pas de valeur par défaut.
export function ignoresParLaRegle<L extends Pick<LigneBancaire, 'id' | 'statut' | 'libelle'>>(
  lignes: readonly L[],
  motif: string,
  horsDesLots: MouvementsHorsDesLots,
): IgnoresParLaRegle<L> {
  const resultat: IgnoresParLaRegle<L> = { aIgnorer: [], ecartesParLesVentes: [] }
  for (const l of lignes) {
    if (l.statut !== 'non_rapprochee' || statutPourLibelle(l.libelle, [{ motif }]) !== 'ignoree') continue
    if (horsDesLots.has(l.id)) resultat.ecartesParLesVentes.push(l)
    else resultat.aIgnorer.push(l)
  }
  return resultat
}
