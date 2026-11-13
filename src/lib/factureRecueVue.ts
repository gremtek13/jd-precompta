import {
  concordanceAvecLeDossier, confianceDeLaFacture, lireFactureXml, montantsDeLaFacture, tiersDeLaFacture,
  type MontantsDeLaFacture,
} from './factureElectronique'

// « LIRE LA FACTURE ÉLECTRONIQUE » : LA FACTURE D'ACHAT REÇUE PAR L'ACCÈS « ACHATS », RELUE DANS LA FICHE DU CABINET (espace
// client, ligne 51.5, étape B4r ; B4R-Q1, tranchée par le cabinet le 12/11/2026 : « (A) Un bouton du cabinet dans la fiche »).
// Le serveur (`plateforme-agreee`, `recevoir_achat`) vérifie l'acheteur et dépose l'original, mais écrit la pièce SANS
// montants : le lecteur complet des factures électroniques vit dans le navigateur (lib/factureElectronique.ts). Le cabinet le
// rejoue sur l'original stocké, d'un clic, et la fiche se REMPLIT — date, fournisseur, montants — sans rien écrire : la pièce
// reste « à valider », et c'est l'enregistrement du cabinet qui part. Un seul lecteur, celui de l'import du cabinet
// (lib/receptionPlateforme.ts), appelé tel quel, jamais recopié.
//
// Pur : aucun accès à la base (la lecture de l'original et du SIRET est dans lib/factureRecueLecture.ts).

/** Ce que la fiche doit savoir d'une pièce pour offrir le bouton. */
export interface PieceRecue {
  source: string
  type_piece: string
  nom_fichier: string
  storage_path: string | null
}

/**
 * Le bouton s'offre-t-il ? Derrière la migration des achats du client (le drapeau), sur une pièce d'ACHAT reçue d'une
 * plateforme, dont l'original stocké est un XML (le serveur ne reçoit ni Factur-X ni autre syntaxe : ils attendent le
 * cabinet), et qui n'est pas figée. La même facture importée par le cabinet a déjà été lue à l'import ; la relire ne remplit
 * que ce que la facture dit, et rien ne part sans l'enregistrement.
 */
export function lectureDeLaFactureOfferte(drapeau: boolean, piece: PieceRecue | null, figee: boolean): boolean {
  return drapeau && piece !== null && !figee && piece.source === 'plateforme' && piece.type_piece === 'achat'
    && piece.storage_path !== null && /\.xml$/i.test(piece.nom_fichier)
}

export const EXPLICATION_DE_LA_LECTURE = 'Une facture reçue par la plateforme du client arrive sans montants : « Lire la facture '
  + 'électronique » relit l’original transmis et remplit la date, le fournisseur et les montants. Rien n’est enregistré : '
  + 'vérifie, puis enregistre ou valide.'

export interface ChampsDeLaFacture {
  date: string | null
  tiers: string | null
  montants: MontantsDeLaFacture
}

export type LectureDeLaFactureRecue =
  | { refus: string }
  | { champs: ChampsDeLaFacture; confiance: 'haute' | 'moyenne' | 'basse'; avertissements: string[] }

/**
 * L'original lu par le lecteur des factures électroniques, et ce qu'il remplit. Refusé : un texte qui n'est pas de l'UTF-8,
 * une facture illisible, un acheteur qui n'est pas le dossier (rien ne se remplit, comme à l'import). Un acheteur que la
 * facture ne dit pas, ou un dossier sans SIRET, se lisent mais abaissent la confiance ; ce que la facture a de contradictoire
 * (ses `anomalies`) se dit ; sans total TTC ni nature connue, aucun montant.
 */
export function lireLaFactureRecue(octets: Uint8Array, sirenDossier: string | null): LectureDeLaFactureRecue {
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(octets)
  } catch {
    return { refus: 'L’original n’est pas un texte UTF-8 : rien n’est rempli, saisis la facture à la main.' }
  }
  const lecture = lireFactureXml(xml)
  if ('refus' in lecture) return { refus: `Facture illisible : ${lecture.refus} Rien n’est rempli, saisis-la à la main.` }
  const f = lecture.facture
  const concordance = concordanceAvecLeDossier(f, 'achat', sirenDossier)
  if (concordance.etat === 'autre') {
    return {
      refus: `La facture désigne une autre entreprise comme acheteur (SIREN ${concordance.siren}) : rien n’est rempli. `
        + 'Vérifie la plateforme du client avant de garder cette pièce.',
    }
  }
  const avertissements: string[] = []
  let douteuse = false
  if (concordance.etat === 'inconnue') {
    douteuse = true
    avertissements.push(sirenDossier === null
      ? 'Le dossier n’a pas de SIRET lisible : rien ne vérifie ici que la facture lui est adressée.'
      : 'La facture ne dit pas le SIREN de son acheteur : rien ne vérifie ici qu’elle est adressée à ce dossier.')
  }
  avertissements.push(...f.anomalies)
  const lus = montantsDeLaFacture(f)
  // Sans total TTC, aucun montant (comme à l'import) : un hors taxes et une TVA seuls laisseraient croire la pièce chiffrée.
  const montants: MontantsDeLaFacture = lus.montant_ttc === null || lus.devise === null
    ? { montant_ht: null, montant_tva: null, montant_ttc: null, devise: lus.devise }
    : lus
  if (montants.montant_ttc === null) avertissements.push('La facture ne dit pas de total lisible : ses montants sont à saisir.')
  return {
    champs: { date: f.date, tiers: tiersDeLaFacture(f, 'achat'), montants },
    confiance: montants.montant_ttc === null ? 'basse' : douteuse ? 'moyenne' : confianceDeLaFacture(f),
    avertissements,
  }
}
