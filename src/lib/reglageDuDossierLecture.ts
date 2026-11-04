import { supabase } from './supabase'
import { messageErreur } from './messageErreur'
import { etatCaisseDuDossier, reglageDuDossier, type EtatCaisseDuDossier, type ReglageDuDossier } from './droitsAcces'

// CE QUE L'ONGLET ACCÈS LIT DU DOSSIER POUR JUGER SES CASES (chantier EC-Q3, étape VF8d ; ligne 26.6, étape C11 ; le module
// pur est lib/droitsAcces.ts, `reglageDuDossier`, `etatCaisseDuDossier` et `gesteDeLaCase`) : une ligne lue par sa clé —
// donc en entier —, quatre colonnes de `dossiers` :
//   - `ventes_par_les_factures`, le réglage qui ouvre la case « Ventes » ;
//   - `statut_tva`, qui ouvre la case « Caisse » (exonéré ou en franchise en base : `garder_droit_caisse`) ;
//   - `mode_comptable`, lu avec le statut (C11-Q2) : sur un dossier tenu en engagement, la case « Caisse » ne se coche pas ;
//   - `categorie_recettes_client`, la nature des recettes en espèces que le cabinet fixe pour le client (CAISSE2-Q2, (B) ;
//     `garder_categorie_recettes_client`) : l'onglet la montre et la change.
// Ce module ne rejette jamais : un refus, une ligne absente ou une requête qui lève rendent les trois états ILLISIBLES, avec leur
// motif, et aucune case qui en dépend ne s'offre. Une colonne absente de la réponse rend illisible ce qu'elle porte, et elle
// seule. La réponse porte le dossier lu : un écran qui en a changé entre-temps ne la prend pas pour la sienne.

/** La nature des recettes du client, lue : l'identifiant d'une catégorie, ou nul (pas encore fixée) ; ou illisible. */
export type NatureLue = { etat: 'lue'; categorieId: string | null } | { etat: 'illisible'; motif: string }

export interface LectureDuReglage {
  /** Le dossier dont le réglage a été lu. */
  dossierId: string
  reglage: ReglageDuDossier
  caisse: EtatCaisseDuDossier
  nature: NatureLue
}

/** La nature d'une ligne : une chaîne ou nul se lisent ; une colonne absente ou d'un autre type est illisible. */
export function natureDeLaLigne(ligne: { readonly categorie_recettes_client?: unknown } | null): NatureLue {
  if (ligne == null) return { etat: 'illisible', motif: 'le dossier n’a pas été trouvé' }
  const valeur = ligne.categorie_recettes_client
  if (valeur === null) return { etat: 'lue', categorieId: null }
  if (typeof valeur === 'string' && valeur !== '') return { etat: 'lue', categorieId: valeur }
  return { etat: 'illisible', motif: 'la nature des recettes du client n’est pas lisible' }
}

function illisible(dossierId: string, motif: string): LectureDuReglage {
  return {
    dossierId,
    reglage: { etat: 'illisible', motif },
    caisse: { etat: 'illisible', motif },
    nature: { etat: 'illisible', motif },
  }
}

export async function lireLeReglageDuDossier(dossierId: string): Promise<LectureDuReglage> {
  try {
    const { data, error } = await supabase.from('dossiers')
      .select('ventes_par_les_factures, statut_tva, mode_comptable, categorie_recettes_client').eq('id', dossierId).maybeSingle()
    if (error) return illisible(dossierId, messageErreur(error, 'lecture refusée'))
    return { dossierId, reglage: reglageDuDossier(data), caisse: etatCaisseDuDossier(data), nature: natureDeLaLigne(data) }
  } catch (erreur) {
    return illisible(dossierId, messageErreur(erreur, 'lecture interrompue'))
  }
}
