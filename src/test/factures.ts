import type { MentionsFacture } from '../lib/types'
import type { ReglageDesVentes } from '../lib/sourceDeLaVente'

// Le réglage d'un dossier qui n'a pas basculé (étape VF8c), aucun exercice validé : le formulaire d'une facture ou d'un avoir
// y est celui d'hier. Les cas d'un dossier basculé sont dans FactureFormModalSource.test.tsx et FactureAvoirModal.test.tsx.
export const NON_BASCULE: ReglageDesVentes = { etat: 'non_bascule', anneesValidees: [] }

// Les mentions de la facture électronique (ligne 28.5, étape c), NULLES : l'état d'une facture d'avant leur
// saisie. Un jeu d'essai les étale plutôt que de recopier quatorze champs nuls — une mention ajoutée demain ne
// se reprend qu'ici (même règle que NON_VALIDEE, src/test/ecritures.ts).
export const MENTIONS_VIDES = {
  type_client: null,
  tiers_siren: null,
  tiers_adresse_electronique: null,
  code_service: null,
  numero_engagement: null,
  nature_operation: null,
  date_prestation: null,
  periode_debut: null,
  periode_fin: null,
  livraison_adresse: null,
  livraison_code_postal: null,
  livraison_ville: null,
  livraison_pays: null,
  option_debits: null,
} satisfies MentionsFacture
