import type { RegleBancaireIgnoree, StatutLigneBancaire } from './types'

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
