import type { StatutLu } from '../lib/statutsLus'
import type { ListesDesVentes } from '../lib/tuilesVentes'
import type { EtatFactureElectroniqueLu } from '../lib/types'

// L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, FICTIF, tel que `etat_facture_electronique` le rend (espace client, étape A6b2) : la
// plateforme agréée reliée, Super PDP non relié, une adresse déclarée sans vérification. Typé sans `as` — le compilateur
// confronte chaque champ à la forme que le module lit (lib/etatFactureElectronique.ts) — ; aucune donnée réelle.
// Les identifiants sont des UUID : le module refuse ce qui n'en est pas un.
export const ADRESSE_FICTIVE_ID = 'a6b20000-0000-4000-8000-0000000000a1'
export const AUTEUR_FICTIF_ID = '797fe440-df8d-4b8e-828b-d148927bfd60'

type Adresse = NonNullable<EtatFactureElectroniqueLu['adresse']>

export const ADRESSE_FICTIVE: Adresse = {
  id: ADRESSE_FICTIVE_ID, forme: 'siren', identifiant: '123456782', plateforme: 'Plateforme fictive Bêta', prise_effet: '2026-09-01',
  verification: 'declaration', verifiee_le: null, auteur: AUTEUR_FICTIF_ID, cree_le: '2026-09-02T09:00:00+00:00',
}

export const ETAT_FICTIF: EtatFactureElectroniqueLu = {
  plateforme: {
    reliee: true, nom: 'Plateforme fictive Alpha', creee_le: '2026-09-01T08:00:00+00:00',
    derniere_recuperation: '2026-10-01T07:30:00+00:00', statuts_lus_le: '2026-10-10T09:00:00+00:00',
  },
  superpdp: { relie: false, depuis: null },
  adresse: ADRESSE_FICTIVE,
}

/** Rien de relié, aucune adresse : ce que la base rend d'un dossier neuf. */
export const ETAT_NEUF: EtatFactureElectroniqueLu = {
  plateforme: { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null },
  superpdp: { relie: false, depuis: null },
  adresse: null,
}

export function etatFictif(o: Partial<EtatFactureElectroniqueLu> = {}): EtatFactureElectroniqueLu {
  return { ...ETAT_FICTIF, ...o }
}

export function adresseFictive(o: Partial<Adresse> = {}): Adresse {
  return { ...ADRESSE_FICTIVE, ...o }
}

/** Les listes des ventes d'un dossier sans vente, toutes lues en entier. */
export function listesVides(o: Partial<ListesDesVentes> = {}): ListesDesVentes {
  return {
    factures: [], facturesIncompletes: null, transmissions: [], transmissionsIncompletes: null, lignes: [], encaissements: [],
    parts: [], encaissementsIncomplets: null, declarations: [], evenementsSuperpdp: [], declarationsIncompletes: null,
    statutsLus: [], statutsIncomplets: null, ...o,
  }
}

/** Un statut lu sur la plateforme du client, tel qu'un écran le lit. */
export function statutLuFictif(o: Partial<StatutLu> = {}): StatutLu {
  return {
    id: 's1', facture_id: 'f1', hote: 'flux.plateforme-fictive.fr', flux_id: `flux-${o.id ?? 's1'}`, code: '205', message_id: null,
    emis_le: '20271015101500', createur_role: 'BY', date_statut: '2027-10-15', motifs: null, commentaire: null, montants: [],
    lu_le: '2027-10-16T09:00:00Z', ...o,
  }
}
