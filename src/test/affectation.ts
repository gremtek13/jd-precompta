import type { SoldesAvantAffectation } from '../lib/affectationDuResultat'
import type { IdentiteDeLaSociete, ValeursFigeesDeLaDecision } from '../lib/affectationEcran'

// LES VALEURS FIGÉES D'UNE DÉCISION D'AFFECTATION, POUR LES TESTS (ligne 45, AFF5). Données FICTIVES : une SARL au capital de
// 10 000 €, une réserve légale de 800 €, un bénéfice 2026 de 30 000 €.

export const SOLDES_FIGES_DE_TEST: SoldesAvantAffectation = {
  capitalAuxComptes: 1_000_000, primes: 0, ecartsDeReevaluation: 0, reserveLegale: 80_000, reservesIndisponibles: 0,
  reservesStatutaires: 0, reservesReglementees: 0, autresReserves: 0, reportCrediteur: 0, pertesAnterieures: 0, acomptesSurDividendes: 0,
}

export const FIGEE_DE_TEST: ValeursFigeesDeLaDecision = {
  resultatCentimes: 3_000_000, formeJuridique: '5499', capitalCentimes: 1_000_000, soldes: SOLDES_FIGES_DE_TEST,
}

export const IDENTITE_DE_TEST: IdentiteDeLaSociete = {
  denomination: 'Société Fictive', siret: '12345678900011', adresse: '1 rue Fictive, 75001 Paris', rcsVille: 'Paris',
}
