import { pastilleDeclaration, pastilleEncaissement } from './encaissementsAffichage'
import type {
  DeclarationLue, EncaissementPourContrePassation, EvenementSuperpdpLu, LigneDeFacture, PartLue,
} from './encaissementsFactures'
import type { StatutLu } from './statutsLus'
import type { FactureEmise, StatutTva, TransmissionFacture } from './types'

// « À ENCAISSER » ET « À DÉCLARER » SUR L'ACCUEIL DU CLIENT (espace client, étape P4b ; conception : HISTORIQUE.md,
// « L'ESPACE CLIENT DEVIENT LE LOGICIEL DE GESTION DU CLIENT : LA CONCEPTION », §2.2) : les pastilles de l'onglet Factures,
// COMPTÉES. Ni un autre calcul ni une autre lecture : `pastilleEncaissement` et `pastilleDeclaration` (encaissementsAffichage.ts)
// sur les listes que lit `lireLesVentesDuDossier` (ventesLecture.ts), celles-là mêmes que l'onglet affiche. Un compte qui
// divergerait de l'onglet enverrait le client chercher des factures qu'il n'y trouve pas.
//
// Un compte est une affirmation sur TOUTES les factures : il ne se dit que de listes lues en entier, chacune. L'onglet, lui,
// montre une pastille dès que les listes dont ELLE dépend sont lues ; une facture qu'il n'aurait pas lue n'y paraît pas — sur
// l'accueil, elle ferait un « 0 » faux. D'où la règle plus stricte : une seule liste partielle, et rien ne se compte.

/** Ce que l'onglet Factures lit d'un dossier pour ses pastilles ; chaque `…Incomplet(e)s` est le motif d'une lecture partielle. */
export interface ListesDesVentes {
  factures: FactureEmise[]
  facturesIncompletes: string | null
  transmissions: TransmissionFacture[]
  transmissionsIncompletes: string | null
  lignes: LigneDeFacture[]
  encaissements: EncaissementPourContrePassation[]
  parts: PartLue[]
  /** Les lignes, les encaissements ou leurs parts. */
  encaissementsIncomplets: string | null
  declarations: DeclarationLue[]
  evenementsSuperpdp: EvenementSuperpdpLu[]
  /** Les déclarations ou l'historique de Super PDP. */
  declarationsIncompletes: string | null
  statutsLus: StatutLu[]
  statutsIncomplets: string | null
}

export type TuilesVentes =
  | { etat: 'muettes'; motif: string }
  | {
    etat: 'comptees'
    /** Les factures qui portent « À encaisser » ou « Encaissée en partie » : il en reste à encaisser. */
    aEncaisser: number
    /** Parmi elles, celles déjà encaissées en partie. */
    enPartie: number
    /** Les factures qui portent « À déclarer » ou « Déclaration en retard ». */
    aDeclarer: number
    /** Parmi elles, celles dont une déclaration est en retard. */
    enRetard: number
  }

/**
 * Les deux comptes de l'accueil, au jour de Paris `aujourdHui` (celui de l'onglet, lu au rendu). Muets, avec le premier
 * motif, dès qu'une des listes est partielle.
 */
export function compterLesPastilles(
  dossierId: string,
  listes: ListesDesVentes,
  statutTva: StatutTva | null,
  aujourdHui: string,
): TuilesVentes {
  const motif = listes.facturesIncompletes ?? listes.transmissionsIncompletes ?? listes.encaissementsIncomplets
    ?? listes.declarationsIncompletes ?? listes.statutsIncomplets
  if (motif !== null) return { etat: 'muettes', motif }
  let aEncaisser = 0
  let enPartie = 0
  let aDeclarer = 0
  let enRetard = 0
  for (const f of listes.factures) {
    const encaissement = pastilleEncaissement(f, listes.lignes, listes.encaissements, listes.parts, statutTva)
    // « Encaissée » : plus rien à encaisser. Les deux autres pastilles disent un reste.
    if (encaissement && encaissement.libelle !== 'Encaissée') {
      aEncaisser += 1
      if (encaissement.libelle !== 'À encaisser') enPartie += 1
    }
    const declaration = pastilleDeclaration(
      dossierId, f, listes.lignes, listes.encaissements, listes.declarations, listes.transmissions, listes.evenementsSuperpdp,
      listes.statutsLus, statutTva, aujourdHui,
    )
    if (declaration) {
      aDeclarer += 1
      if (declaration.libelle === 'Déclaration en retard') enRetard += 1
    }
  }
  return { etat: 'comptees', aEncaisser, enPartie, aDeclarer, enRetard }
}
