import type { EcheanceDeLImpot } from './echeancesFiscales'
import { ajouterJours } from './format'

// LA PROPOSITION DE RAPPROCHER UN DÉBIT DU RELEVÉ D'UNE ÉCHÉANCE D'IS (ligne 38, LIA8 ; conception 37, § 6.3). Un paiement
// d'acompte ou de solde se classe au 444 par les gestes du relevé (« un mouvement du relevé s'écrit sur un compte de
// bilan ») ; ce module ne fait que PROPOSER l'échéance qu'un débit paie, par son montant et sa date — il n'écrit rien, ne
// classe jamais seul, et se tait à égalité (la règle du rapprochement : à égalité, aucune proposée). Pur : ni base, ni
// horloge. Aucun écran ne l'appelle encore (le rôle 444 vient avec LIA4, l'écran avec LIA7) : `CALENDRIER_IS_EXPORTE`.
//
// La fenêtre est un choix de l'application, pas une règle fiscale : un prélèvement par télérèglement se débite autour de
// la date limite, jamais des semaines avant ; quinze jours de part et d'autre couvrent un ordre passé en avance ou un
// relevé qui date le débit au jour du règlement interbancaire.
export const FENETRE_DU_RAPPROCHEMENT_JOURS = 15

export interface DebitDuReleve {
  date: string
  // En euros, signé : un débit est négatif.
  montant: number
  libelle: string
}

export type SignalDuRapprochement = 'montant' | 'date' | 'libelle-dgfip'

export interface AcomptePropose {
  echeance: EcheanceDeLImpot
  // Ce qui le justifie : le montant et la date toujours ; le libellé quand il nomme la DGFiP, mot à mot.
  signaux: SignalDuRapprochement[]
}

// « DGFIP » ou « DGFiP », comme mot entier du libellé : jamais une sous-chaîne d'un autre mot.
function nommeLaDgfip(libelle: string): boolean {
  return libelle.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).includes('DGFIP')
}

// L'échéance d'IS qu'un débit paie, s'il n'y en a qu'UNE au même montant (au centime) dans la fenêtre ; nulle sinon. Une
// échéance sans montant, ou sans rien à payer, n'est jamais proposée.
export function acompteAProposer(debit: DebitDuReleve, echeances: readonly EcheanceDeLImpot[]): AcomptePropose | null {
  if (!Number.isFinite(debit.montant) || debit.montant >= 0) return null
  const centimes = Math.round(-debit.montant * 100)
  const candidates = echeances.filter((e) => e.montant.etat === 'du'
    && e.montant.centimes === centimes
    && debit.date >= ajouterJours(e.date, -FENETRE_DU_RAPPROCHEMENT_JOURS)
    && debit.date <= ajouterJours(e.date, FENETRE_DU_RAPPROCHEMENT_JOURS))
  if (candidates.length !== 1) return null
  return { echeance: candidates[0], signaux: nommeLaDgfip(debit.libelle) ? ['montant', 'date', 'libelle-dgfip'] : ['montant', 'date'] }
}
