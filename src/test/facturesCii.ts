// Les factures FICTIVES du générateur de la facture électronique (factureCii.ts) : des identifiants valides par leur
// clé mais inventés, des noms et des adresses de démonstration. Elles servent à ses propres tests (factureCii.test.ts)
// et au garde des copies de ce générateur dans les Edge Functions (copiesFacturation.test.ts), qui les fait passer par
// la copie ET par l'original : un exemple ajouté ici est éprouvé des deux côtés sans qu'on ait à y penser.
import { lignesDeLaFinale, preparerAcompte, type AcompteValide, type DemandeAcompte, type LigneTiree } from '../lib/acompteDevis'
import {
  donneesDeLaFacture, SANS_ACOMPTE_CII, type AcompteCii, type DonneesCii, type DossierCii, type LigneCii, type VendeurCii,
} from '../lib/factureCii'
import { calculerTotaux } from '../lib/montantsFacture'
import type { FactureEmise } from '../lib/types'
import { MENTIONS_VIDES } from './factures'

export const SIRET_VENDEUR = '12345678200010'
export const TVA_VENDEUR = 'FR11123456782'
export const SIREN_CLIENT = '987654324'
export const SIRET_CLIENT = '98765432400019'
export const SIREN_PUBLIC = '100000207'
export const AUJOURD_HUI = '2026-10-07'

export function vendeur(o: Partial<VendeurCii> = {}): VendeurCii {
  return {
    nom: 'Atelier Démo Conseil',
    siret: SIRET_VENDEUR,
    adresse: '12 rue des Exemples\n13001 Marseille',
    numeroTva: TVA_VENDEUR,
    numeroTvaAttribue: false,
    statutTva: 'redevable',
    articleExoneration: null,
    ...o,
  }
}

export function ligne(o: Partial<LigneCii> = {}): LigneCii {
  return { ordre: 1, designation: 'Prestation de conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, ...o }
}

// La facture telle que la base la garde. Son en-tête est calculé comme l'application le calcule : le total des lignes
// d'une facture, ou, pour un avoir, l'opposé du total des lignes qu'il crédite (creerAvoir) — ses lignes étant stockées
// négatives, on les remet dans le sens du crédit avant de les totaliser.
export function facture(lignes: LigneCii[], o: Partial<FactureEmise> = {}): FactureEmise {
  const avoir = o.type === 'avoir'
  const t = calculerTotaux(lignes.map((l) => ({ ...l, quantite: avoir ? -l.quantite : l.quantite })))
  const signe = (n: number) => (avoir && n !== 0 ? -n : n)
  return {
    id: 'f1',
    dossier_id: 'd1',
    numero: 'F2026-0001',
    statut: 'validee',
    type: 'facture',
    facture_origine_id: null,
    date_emission: '2026-09-15',
    date_echeance: '2026-10-15',
    tiers_nom: 'Client Fictif SAS',
    tiers_adresse: '5 avenue du Port\n13002 Marseille',
    tiers_siret: null,
    montant_ht: signe(t.montant_ht),
    montant_tva: signe(t.montant_tva),
    montant_ttc: signe(t.montant_ttc),
    mentions_legales: null,
    notes: null,
    emetteur_nom: 'Atelier Démo Conseil',
    emetteur_siret: SIRET_VENDEUR,
    emetteur_adresse: '12 rue des Exemples\n13001 Marseille',
    superpdp_invoice_id: null,
    superpdp_dernier_statut: null,
    tiers_email: null,
    created_by: null,
    valide_par: null,
    created_at: '2026-09-15T08:00:00Z',
    validated_at: '2026-09-15T08:05:00Z',
    ...MENTIONS_VIDES,
    type_client: 'assujetti',
    tiers_siren: SIREN_CLIENT,
    nature_operation: 'services',
    source_de_la_vente: false,
    acompte: false,
    date_versement_acompte: null,
    ...o,
  }
}

export interface Cas {
  lignes?: LigneCii[]
  facture?: Partial<FactureEmise>
  vendeur?: Partial<VendeurCii>
  origine?: DonneesCii['origine']
  acompte?: Partial<AcompteCii>
}

export const ORIGINE: DonneesCii['origine'] = { numero: 'F2026-0001', date_emission: '2026-09-01' }

export function donnees(c: Cas = {}): DonneesCii {
  const lignes = c.lignes ?? [ligne()]
  return {
    facture: facture(lignes, c.facture),
    lignes,
    vendeur: vendeur(c.vendeur),
    origine: c.origine ?? null,
    acompte: { ...SANS_ACOMPTE_CII, ...c.acompte },
    aujourdHui: AUJOURD_HUI,
  }
}

// ── La facture qui a figé ses mentions (A7c) ─────────────────────────────────────────────────────────────────────
// Un RIB FICTIF : le code banque 99999 n'est attribué à aucun établissement ; la clé RIB et la clé de l'IBAN sont justes.
export const IBAN_FICTIF = 'FR7699999000011234567890152'
export const BIC_FICTIF = 'DEMOFRPPXXX'
// Le dossier tel qu'il est AUJOURD'HUI, après la validation : passé en franchise sans numéro de TVA. Une facture figée n'en
// lit rien — ni le statut, ni l'article, ni la case du numéro.
export const DOSSIER_CHANGE: DossierCii = { statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: false }

/** Une facture qui a figé ses mentions, assemblée par `donneesDeLaFacture` devant un dossier qui a changé depuis. */
export function donneesFigees(c: Cas, dossier: DossierCii = DOSSIER_CHANGE): DonneesCii {
  const lignes = c.lignes ?? [ligne()]
  return donneesDeLaFacture(
    facture(lignes, { mentions_figees: true, ...c.facture }), lignes, dossier, c.origine ?? null,
    { ...SANS_ACOMPTE_CII, ...c.acompte }, AUJOURD_HUI,
  )
}

// ── L'acompte d'un devis (P5b4a) : des lignes tirées par le module de l'acompte lui-même (acompteDevis.ts) ─────────
// Un devis FICTIF de rénovation à deux taux, aux prix qui ne tombent pas juste (la TVA arrondie ligne par ligne, que la
// règle BR-CO-17 confronte au taux appliqué à la base de chaque taux) ; deux acomptes, 30 % puis 500 € TTC, et la
// finale qui les reprend.
const DEVIS_FICTIF = 'D2026-0007'
const LIGNES_DU_DEVIS = [
  { designation: 'Pose et main-d’œuvre', quantite: 3, prix_unitaire_ht: 333.33, taux_tva: 20, nature: 'services' as const },
  { designation: 'Fournitures de rénovation', quantite: 7, prix_unitaire_ht: 14.29, taux_tva: 10, nature: 'services' as const },
]
const ETAT = { accepte: true, finaleActive: false, acompteEnBrouillon: false, mode: 'tresorerie' as const }

function lignesCii(lignes: readonly LigneTiree[]): LigneCii[] {
  return lignes.map((l, i) => ({ ordre: i + 1, designation: l.designation, quantite: l.quantite, prix_unitaire_ht: l.prix_unitaire_ht, taux_tva: l.taux_tva }))
}

function acompteTire(demande: DemandeAcompte, valides: AcompteValide[]): LigneTiree[] {
  const p = preparerAcompte({ numeroDevis: DEVIS_FICTIF, lignesDevis: LIGNES_DU_DEVIS, acomptesValides: valides, demande, etat: ETAT })
  if (!p.ok) throw new Error(p.refus)
  return p.lignes
}

const LIGNES_DU_PREMIER_ACOMPTE = acompteTire({ mode: 'pourcentage', pourcentage: 30 }, [])
export const PREMIER_ACOMPTE: AcompteValide = { id: 'acompte-1', numero: 'F2026-0021', date: '2026-09-01', lignes: LIGNES_DU_PREMIER_ACOMPTE }
export const SECOND_ACOMPTE: AcompteValide = {
  id: 'acompte-2', numero: 'F2026-0024', date: '2026-09-20',
  lignes: acompteTire({ mode: 'ttc', ttcCentimes: 50000 }, [PREMIER_ACOMPTE]),
}
const LIGNES_FINALE = lignesCii(lignesDeLaFinale(LIGNES_DU_DEVIS, [PREMIER_ACOMPTE, SECOND_ACOMPTE]))
const REPRISES_FINALE = lignesDeLaFinale(LIGNES_DU_DEVIS, [PREMIER_ACOMPTE, SECOND_ACOMPTE])
  .map((l, i) => ({ ordre: i + 1, factureId: l.reprise_facture_id }))
  .filter((r): r is { ordre: number; factureId: string } => r.factureId !== null)
const ACOMPTES_REPRIS = [PREMIER_ACOMPTE, SECOND_ACOMPTE]
  .map((a) => ({ id: a.id, numero: a.numero, date_emission: a.date, acompte: true }))

/** La finale fictive : ses lignes, ses reprises et les acomptes qu'elle cite, pour les cas de refus. */
export const FINALE = { lignes: LIGNES_FINALE, acompte: { reprises: REPRISES_FINALE, acomptesRepris: ACOMPTES_REPRIS } }

// ── Les exemples figés ─────────────────────────────────────────────────────────────────────────────────────────────
// Chacun porte ce que sa relecture doit rendre, calculé à la main et non par le générateur : HT, TVA, TTC dans le sens
// du document (un avoir positif), et la ventilation par taux (catégorie, taux, base, TVA, code du motif).

export interface Exemple {
  nom: string
  donnees: DonneesCii
  numero: string
  nature: 'facture' | 'avoir'
  acheteur: string
  ht: number
  tva: number
  ttc: number
  ventilation: [string, number, number, number, string | null][]
  // Le code du type (BT-3) et l'échéance relue (BT-9), quand ce ne sont pas 380 ou 381 et la date d'échéance de la
  // facture : la facture d'acompte (386, la date de son versement) et l'avoir d'un acompte (503).
  typeCode?: string
  echeance?: string | null
}

export const EXEMPLES: Exemple[] = [
  {
    nom: 'services-debits',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Mission de conseil — septembre 2026', quantite: 10, prix_unitaire_ht: 85.5 }),
        ligne({ ordre: 2, designation: 'Frais de dossier', quantite: 1, prix_unitaire_ht: 35 }),
      ],
      facture: {
        numero: 'F2026-0012',
        option_debits: true,
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
        tiers_siret: SIRET_CLIENT,
        tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
        notes: 'Merci de votre confiance.',
        mentions_legales: "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera exigible, " +
          "ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 €.",
      },
    }),
    numero: 'F2026-0012',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 890,
    tva: 178,
    ttc: 1068,
    ventilation: [['S', 20, 890, 178, null]],
  },
  {
    nom: 'biens-livraison',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Fauteuil de consultation', quantite: 2, prix_unitaire_ht: 349.9, taux_tva: 20 }),
        ligne({ ordre: 2, designation: 'Ouvrage de référence', quantite: 3, prix_unitaire_ht: 24.5, taux_tva: 5.5 }),
        ligne({ ordre: 3, designation: 'Remise commerciale', quantite: 1, prix_unitaire_ht: -50, taux_tva: 20 }),
      ],
      facture: {
        numero: 'F2026-0013',
        nature_operation: 'biens',
        // L'option pour les débits ne vise que les services : sur des biens, elle ne se transmet ni ne s'imprime.
        option_debits: true,
        date_prestation: '2026-09-20',
        livraison_adresse: 'Entrepôt Démo, quai des Essais',
        livraison_code_postal: '13016',
        livraison_ville: 'Marseille',
        livraison_pays: 'FR',
        tiers_siret: '98765432400027',
      },
    }),
    numero: 'F2026-0013',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 723.3,
    tva: 134,
    ttc: 857.3,
    ventilation: [['S', 20, 649.8, 129.96, null], ['S', 5.5, 73.5, 4.04, null]],
  },
  {
    nom: 'mixte-organisme-public',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Installation du matériel', quantite: 1, prix_unitaire_ht: 1200, taux_tva: 20 }),
        ligne({ ordre: 2, designation: 'Transport de personnes', quantite: 4, prix_unitaire_ht: 37.25, taux_tva: 10 }),
      ],
      facture: {
        numero: 'F2026-0014',
        type_client: 'organisme_public',
        nature_operation: 'mixte',
        tiers_nom: 'Commune de Démoville',
        tiers_siren: SIREN_PUBLIC,
        tiers_siret: '10000020700017',
        tiers_adresse: 'Hôtel de ville\nPlace de la Mairie\n13999 Démoville',
        code_service: 'SERVICE-ACHATS',
        numero_engagement: 'EJ-2026-0042',
        date_prestation: '2026-09-25',
      },
    }),
    numero: 'F2026-0014',
    nature: 'facture',
    acheteur: SIREN_PUBLIC,
    ht: 1349,
    tva: 254.9,
    ttc: 1603.9,
    ventilation: [['S', 20, 1200, 240, null], ['S', 10, 149, 14.9, null]],
  },
  {
    nom: 'franchise',
    donnees: donnees({
      lignes: [ligne({ designation: 'Séance de coaching', quantite: 3, prix_unitaire_ht: 60, taux_tva: 0 })],
      // Un dossier en franchise qui a un numéro de TVA : sans lui, la facture ne partirait pas (règle G1.47).
      vendeur: { statutTva: 'franchise', numeroTvaAttribue: true },
      facture: { numero: 'F2026-0015', mentions_legales: 'TVA non applicable, art. 293 B du CGI.' },
    }),
    numero: 'F2026-0015',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 180,
    tva: 0,
    ttc: 180,
    ventilation: [['E', 0, 180, 0, 'VATEX-FR-FRANCHISE']],
  },
  {
    nom: 'redevable-partiellement-exonere',
    donnees: donnees({
      lignes: [
        ligne({ ordre: 1, designation: 'Formation professionnelle continue (deux jours)', quantite: 2, prix_unitaire_ht: 450, taux_tva: 0 }),
        ligne({ ordre: 2, designation: 'Accompagnement individuel', quantite: 1, prix_unitaire_ht: 99, taux_tva: 20 }),
      ],
      vendeur: { articleExoneration: 'cgi_261_4_4_a' },
      // L'option pour les débits se dit dans chaque ventilation, l'exonérée comprise (G1.43, S1.13).
      facture: { numero: 'F2026-0016', option_debits: true },
    }),
    numero: 'F2026-0016',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 999,
    tva: 19.8,
    ttc: 1018.8,
    ventilation: [['S', 20, 99, 19.8, null], ['E', 0, 900, 0, 'VATEX-FR-CGI261-4']],
  },
  {
    nom: 'exonere-organisme-public',
    donnees: donnees({
      lignes: [ligne({ designation: 'Actes de soins infirmiers — septembre 2026', quantite: 1, prix_unitaire_ht: 640, taux_tva: 0 })],
      vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', numeroTvaAttribue: true },
      facture: {
        numero: 'F2026-0017',
        type_client: 'organisme_public',
        tiers_nom: 'Établissement public de démonstration',
        tiers_siren: SIREN_PUBLIC,
        tiers_siret: '10000020700025',
        tiers_adresse: '1 allée des Essais\n13999 Démoville',
        code_service: 'SOINS',
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
      },
    }),
    numero: 'F2026-0017',
    nature: 'facture',
    acheteur: SIREN_PUBLIC,
    ht: 640,
    tva: 0,
    ttc: 640,
    ventilation: [['E', 0, 640, 0, 'VATEX-FR-CGI261-4']],
  },
  {
    nom: 'avoir',
    donnees: donnees({
      // Deux jours de la mission de « services-debits », crédités : la base garde l'avoir et ses lignes négatifs.
      lignes: [ligne({ designation: 'Mission de conseil — septembre 2026', quantite: -2, prix_unitaire_ht: 85.5 })],
      facture: {
        type: 'avoir',
        numero: 'A2026-0003',
        facture_origine_id: 'f-origine',
        date_emission: '2026-10-02',
        date_echeance: null,
        option_debits: true,
        periode_debut: '2026-09-01',
        periode_fin: '2026-09-30',
        tiers_siret: SIRET_CLIENT,
        tiers_adresse_electronique: `${SIREN_CLIENT}_FACTURES`,
        notes: 'Deux jours non réalisés.',
      },
      origine: { numero: 'F2026-0012', date_emission: '2026-09-15' },
    }),
    numero: 'A2026-0003',
    nature: 'avoir',
    acheteur: SIREN_CLIENT,
    ht: 171,
    tva: 34.2,
    ttc: 205.2,
    ventilation: [['S', 20, 171, 34.2, null]],
  },
  {
    nom: 'caracteres-speciaux',
    donnees: donnees({
      lignes: [ligne({ designation: 'Conseil "stratégique" & suivi\u0007 — étape <1> ✓', quantite: 1.5, prix_unitaire_ht: 120.123456 })],
      vendeur: { nom: 'Atelier « Démo »  & Fils <SARL>', adresse: 'Bâtiment B, 3e étage, 12 rue des Exemples, 13001 Marseille' },
      facture: {
        numero: 'F2026/0018',
        tiers_nom: "L'Équipe d'Essai & Cie",
        tiers_adresse: 'Résidence Les Pins\nBâtiment C\nEscalier 2\nAppartement 14\n13008 Marseille',
        mentions_legales: 'Première ligne\nSeconde ligne, avec <balise> & esperluette\uD800',
      },
    }),
    numero: 'F2026/0018',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    // 1,5 × 120,123456 = 180,185184 : 180,19 hors taxes, 36,04 de TVA.
    ht: 180.19,
    tva: 36.04,
    ttc: 216.23,
    ventilation: [['S', 20, 180.19, 36.04, null]],
  },
  {
    // La facture d'acompte de 30 % du devis fictif, versé quatre jours avant elle (BT-9). 30 % de 1 100,02 € HT font
    // 330,01 €, au prorata des restes (999,99 et 100,03) par les plus forts restes : 300,00 € à 20 % et 30,01 € à 10 %.
    nom: 'acompte',
    donnees: donnees({
      lignes: lignesCii(LIGNES_DU_PREMIER_ACOMPTE),
      facture: { numero: PREMIER_ACOMPTE.numero, date_emission: PREMIER_ACOMPTE.date, date_echeance: '2026-09-01' },
      acompte: { acompte: true, dateVersement: '2026-08-28' },
    }),
    numero: 'F2026-0021',
    nature: 'facture',
    typeCode: '386',
    echeance: '2026-08-28',
    acheteur: SIREN_CLIENT,
    // 300,00 × 20 % = 60,00 ; 30,01 × 10 % = 3,001, soit 3,00.
    ht: 330.01,
    tva: 63,
    ttc: 393.01,
    ventilation: [['S', 20, 300, 60, null], ['S', 10, 30.01, 3, null]],
  },
  {
    // La finale du devis fictif, qui reprend les deux acomptes à deux taux : la règle BR-CO-17 juge la TVA de chaque
    // taux sur sa base, nette des reprises.
    nom: 'finale-deux-acomptes',
    donnees: donnees({
      lignes: FINALE.lignes,
      facture: { numero: 'F2026-0030', date_emission: '2026-10-05', date_echeance: '2026-11-04' },
      acompte: FINALE.acompte,
    }),
    numero: 'F2026-0030',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    // Le second acompte, 500,00 € TTC : 381,67 € à 20 % (TVA 76,334, soit 76,33) et 38,18 € à 10 % (3,818, soit 3,82).
    // À 20 % : 999,99 − 300,00 − 381,67 = 318,32 € HT ; TVA 200,00 − 60,00 − 76,33 = 63,67 €, quand 318,32 × 20 % font
    // 63,664 (63,66) : l'écart d'un centime que BR-CO-17 admet. À 10 % : 100,03 − 30,01 − 38,18 = 31,84 € ; TVA
    // 10,00 − 3,00 − 3,82 = 3,18 €.
    ht: 350.16,
    tva: 66.85,
    ttc: 417.01,
    ventilation: [['S', 20, 318.32, 63.67, null], ['S', 10, 31.84, 3.18, null]],
  },
  {
    // L'avoir qui crédite en entier la facture d'acompte de l'exemple « acompte » (le devis abandonné) : 503, sous S1.
    nom: 'avoir-acompte',
    donnees: donnees({
      lignes: lignesCii(LIGNES_DU_PREMIER_ACOMPTE).map((l) => ({ ...l, quantite: -l.quantite })),
      facture: { type: 'avoir', numero: 'A2026-0005', date_emission: '2026-09-15', date_echeance: null },
      origine: { numero: PREMIER_ACOMPTE.numero, date_emission: PREMIER_ACOMPTE.date },
      acompte: { origineAcompte: true },
    }),
    numero: 'A2026-0005',
    nature: 'avoir',
    typeCode: '503',
    acheteur: SIREN_CLIENT,
    ht: 330.01,
    tva: 63,
    ttc: 393.01,
    ventilation: [['S', 20, 300, 60, null], ['S', 10, 30.01, 3, null]],
  },
  {
    // Une facture figée à une entreprise : l'unité et la référence de ses lignes, le bon de commande de l'acheteur (BT-13),
    // le RIB confirmé sous le virement (BG-16), l'escompte en note AAB, les pénalités et l'indemnité dans BT-20.
    nom: 'figee-entreprise',
    donnees: donneesFigees({
      lignes: [
        ligne({ ordre: 1, designation: 'Accompagnement à la gestion', quantite: 7.5, prix_unitaire_ht: 80, unite: 'HUR', reference: 'CONS-H' }),
        ligne({ ordre: 2, designation: 'Classeur de suivi', quantite: 2, prix_unitaire_ht: 12.4, unite: 'C62', reference: null }),
      ],
      facture: {
        numero: 'F2026-0031',
        tiers_siret: SIRET_CLIENT,
        numero_engagement: 'BC-2026-118',
        statut_tva: 'redevable',
        article_exoneration: null,
        numero_tva_attribue: false,
        numero_tva_imprime: TVA_VENDEUR,
        moyen_prefere: 'virement',
        escompte: 'Pas d’escompte pour paiement anticipé.',
        penalites: 'Pénalités de retard : trois fois le taux d’intérêt légal.',
        iban_imprime: IBAN_FICTIF,
        bic_imprime: BIC_FICTIF,
        titulaire_imprime: 'Atelier Démo Conseil',
      },
    }),
    numero: 'F2026-0031',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 624.8,
    tva: 124.96,
    ttc: 749.76,
    ventilation: [['S', 20, 624.8, 124.96, null]],
  },
  {
    // Une facture figée en franchise, avec son numéro de TVA : le dossier est passé depuis en franchise SANS numéro, et la
    // facture transmet ce qu'elle a figé. Un RIB sans moyen préféré ni BIC : l'instrument « non défini » (1).
    nom: 'figee-franchise',
    donnees: donneesFigees({
      lignes: [ligne({ designation: 'Séance de coaching', quantite: 2, prix_unitaire_ht: 60, taux_tva: 0, unite: 'HUR', reference: 'SEANCE' })],
      facture: {
        numero: 'F2026-0032',
        mentions_legales: 'TVA non applicable, art. 293 B du CGI.',
        statut_tva: 'franchise',
        article_exoneration: null,
        numero_tva_attribue: true,
        numero_tva_imprime: TVA_VENDEUR,
        moyen_prefere: null,
        escompte: null,
        penalites: 'Pénalités de retard : trois fois le taux d’intérêt légal.',
        iban_imprime: IBAN_FICTIF,
        bic_imprime: null,
        titulaire_imprime: null,
      },
    }, { statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }),
    numero: 'F2026-0032',
    nature: 'facture',
    acheteur: SIREN_CLIENT,
    ht: 120,
    tva: 0,
    ttc: 120,
    ventilation: [['E', 0, 120, 0, 'VATEX-FR-FRANCHISE']],
  },
]

// Chaque faute, seule, et le refus qu'elle doit rendre, et lui seul (voir factureCii.test.ts).
export const CAS_DE_REFUS: [string, Cas, string][] = [
  ['un brouillon', { facture: { statut: 'brouillon' } }, 'Seule une facture validée se transmet.'],
  ['sans numéro', { facture: { numero: null } }, 'Seule une facture validée se transmet.'],
  ['un numéro hors du jeu de caractères', { facture: { numero: 'F2026#1' } }, 'Le numéro F2026#1 ne peut pas être transmis'],
  ['une année hors des bornes', { facture: { date_emission: '1999-12-31' } }, 'La date d’émission (31/12/1999) n’est pas une date admise (années 2000 à 2099).'],
  // Une date au-delà de 2099 est aussi dans l'avenir : une seule faute, un seul refus.
  ['une année après 2099', { facture: { date_emission: '2101-01-01' } }, 'n’est pas une date admise'],
  ['une date dans l’avenir', { facture: { date_emission: '2026-10-08' } }, 'qui n’est pas encore arrivé'],
  ['sans destinataire', { facture: { type_client: null } }, 'Dis à qui la facture est adressée'],
  ['à un particulier', { facture: { type_client: 'non_assujetti' } }, 'Une facture à un particulier ne passe pas par la plateforme'],
  ['à un client étranger', { facture: { type_client: 'etranger' } }, 'client établi hors de France'],
  ['sans nature d’opération', { facture: { nature_operation: null } }, 'des livraisons de biens, des prestations de services'],
  ['sans nom de dossier', { vendeur: { nom: '  ' } }, 'Le nom du dossier manque'],
  ['un SIRET du dossier à la clé fausse', { vendeur: { siret: '12345678900010' } }, 'ne donne pas un SIREN valide'],
  ['sans SIRET du dossier', { vendeur: { siret: null } }, 'ne donne pas un SIREN valide'],
  ['sans adresse du dossier', { vendeur: { adresse: null } }, 'L’adresse du dossier manque'],
  ['sans nom de client', { facture: { tiers_nom: ' ' } }, 'Le nom du client manque'],
  ['sans SIREN de client', { facture: { tiers_siren: null } }, 'Le SIREN du client manque'],
  ['un SIREN de client à la clé fausse', { facture: { tiers_siren: '987654321' } }, 'Le SIREN du client manque ou ne passe pas'],
  // Ce qui découle du SIREN ne se juge pas sur un SIREN faux : son refus suffit.
  ['un SIREN de client faux, avec un SIRET', { facture: { tiers_siren: '987654321', tiers_siret: SIRET_CLIENT } }, 'Le SIREN du client manque ou ne passe pas'],
  [
    'un SIREN de client faux, avec une adresse électronique',
    { facture: { tiers_siren: '987654321', tiers_adresse_electronique: SIREN_CLIENT } },
    'Le SIREN du client manque ou ne passe pas',
  ],
  ['sans adresse de client', { facture: { tiers_adresse: null } }, 'L’adresse du client manque'],
  ['un organisme public sans SIRET', { facture: { type_client: 'organisme_public' } }, 'Un organisme public se désigne par son SIRET'],
  ['un SIRET de client à la clé fausse', { facture: { tiers_siret: '98765432400010' } }, 'Le SIRET du client ne passe pas sa clé'],
  ['le SIRET d’un autre SIREN', { facture: { tiers_siret: SIRET_VENDEUR } }, 'Le SIRET du client ne commence pas par son SIREN'],
  ['une adresse électronique d’une autre forme', { facture: { tiers_adresse_electronique: 'FACTURES' } }, 'n’a pas la forme que l’annuaire publie'],
  ['l’adresse électronique d’un autre SIREN', { facture: { tiers_adresse_electronique: '123456782' } }, 'L’adresse de facturation électronique du client ne commence pas par son SIREN'],
  ['un statut de TVA à préciser', { vendeur: { statutTva: null } }, 'Le statut de TVA du dossier est à préciser'],
  ['un statut de TVA à préciser, ligne à 0 %', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: null } }, 'Le statut de TVA du dossier est à préciser'],
  // Le numéro qui manque découle peut-être du statut à préciser : le réclamer à côté dirait deux fois la même faute.
  [
    'un statut de TVA à préciser, sans numéro de TVA',
    { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: null, numeroTva: null } },
    'Le statut de TVA du dossier est à préciser',
  ],
  ['aucune ligne', { lignes: [] }, 'La facture n’a aucune ligne.'],
  // Sans ligne, rien ne demande le numéro de TVA du dossier (BR-S-02, BR-E-02 et G1.47 partent des lignes).
  ['aucune ligne, sans numéro de TVA', { lignes: [], vendeur: { numeroTva: null } }, 'La facture n’a aucune ligne.'],
  ['une ligne sans désignation', { lignes: [ligne({ designation: ' ' })] }, 'Ligne 1 : sa désignation manque.'],
  ['une quantité à cinq décimales', { lignes: [ligne({ quantite: 1.23456 })] }, 'Ligne 1 : la quantité ne s’écrit pas avec quatre décimales au plus.'],
  ['un prix à sept décimales', { lignes: [ligne({ prix_unitaire_ht: 10.1234567 })] }, 'Ligne 1 : le prix ne s’écrit pas avec six décimales au plus.'],
  ['un taux inconnu', { lignes: [ligne({ taux_tva: 15 })] }, 'Ligne 1 : le taux de 15 % n’est pas un taux de TVA admis.'],
  ['une ligne taxée en franchise', { vendeur: { statutTva: 'franchise' } }, 'Ligne 1 : Un dossier en franchise en base ne facture pas de TVA'],
  ['une ligne taxée d’un exonéré', { vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' } }, 'Ligne 1 : Un dossier exonéré ne facture pas de TVA'],
  ['une ligne à 0 % d’un redevable sans article', { lignes: [ligne({ taux_tva: 0 }), ligne({ ordre: 2, taux_tva: 0 })] }, 'Une ligne à 0 % d’un dossier redevable demande l’article'],
  ['une ligne à 0 % d’un exonéré sans article', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere' } }, 'Le dossier est exonéré sans article'],
  ['un total négatif', { lignes: [ligne({ prix_unitaire_ht: -50 })] }, 'Le total de la facture n’est pas positif'],
  ['un total nul', { lignes: [ligne({ prix_unitaire_ht: 0 })] }, 'Le total de la facture n’est pas positif'],
  [
    'un avoir nul',
    { lignes: [ligne({ quantite: -1, prix_unitaire_ht: 0 })], facture: { type: 'avoir', date_echeance: null }, origine: ORIGINE },
    'Un avoir crédite un montant : son total doit être positif.',
  ],
  ['un total TTC qui n’est pas celui des lignes', { facture: { montant_ttc: 120.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
  ['un total HT qui n’est pas celui des lignes', { facture: { montant_ht: 100.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
  ['une TVA qui n’est pas celle des lignes', { facture: { montant_tva: 20.01 } }, 'Les montants enregistrés de la facture ne se retrouvent pas dans ses lignes'],
  [
    'une facture tout exonérée par l’article 261 à une entreprise',
    { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1' } },
    'Une facture dont toutes les opérations sont exonérées par les articles 261 à 261 E du CGI n’entre pas dans la facturation électronique entre entreprises.',
  ],
  [
    'une facture tout exonérée par l’article 261 C à une entreprise',
    { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_c_2' } },
    'n’entre pas dans la facturation électronique entre entreprises',
  ],
  // Hors du champ, c'est tout ce qu'il y a à dire : réclamer le numéro de TVA laisserait croire qu'il suffirait.
  [
    'une facture tout exonérée à une entreprise, sans numéro de TVA',
    { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'exonere', articleExoneration: 'cgi_261_4_1', numeroTva: null } },
    'n’entre pas dans la facturation électronique entre entreprises',
  ],
  ['sans numéro de TVA, redevable', { vendeur: { numeroTva: null } }, 'Le numéro de TVA intracommunautaire du dossier manque.'],
  ['sans numéro de TVA, en franchise', { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'franchise', numeroTva: null } }, 'règle G1.47 de la DGFiP'],
  // La case cochée, le numéro qui manque encore ne se calcule pas : ce n'est plus la case qui se réclame.
  [
    'sans numéro de TVA, en franchise, la case cochée',
    { lignes: [ligne({ taux_tva: 0 })], vendeur: { statutTva: 'franchise', numeroTva: null, numeroTvaAttribue: true } },
    'Le numéro de TVA intracommunautaire du dossier manque.',
  ],
  ['un numéro de TVA d’un autre SIREN', { vendeur: { numeroTva: 'FR00123456782' } }, 'ne correspond pas à son SIREN'],
  ['une facture sans échéance', { facture: { date_echeance: null } }, 'Indique la date d’échéance'],
  ['une échéance hors des bornes', { facture: { date_echeance: '2100-01-01' } }, 'La date d’échéance n’est pas une date admise'],
  [
    'un avoir qui ne cite pas sa facture',
    { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null } },
    'L’avoir doit citer la facture qu’il corrige.',
  ],
  [
    'un avoir qui cite une facture au numéro hors du jeu de caractères',
    { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: { ...ORIGINE, numero: 'F#12' } },
    'Le numéro de la facture corrigée (F#12) ne peut pas être transmis.',
  ],
  [
    'un avoir qui cite une facture datée hors des bornes',
    { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: { ...ORIGINE, date_emission: '1999-12-31' } },
    'La date de la facture corrigée n’est pas une date admise',
  ],
  ['une période à l’envers', { facture: { periode_debut: '2026-09-30', periode_fin: '2026-09-01' } }, 'La période de la prestation finit avant de commencer.'],
  // Hors des bornes et à l'envers : une seule faute dite, celle des bornes.
  ['une période hors des bornes', { facture: { periode_debut: '2026-09-01', periode_fin: '1999-09-30' } }, 'La période de la prestation porte une date qui n’est pas admise'],
  ['une période qui commence avant 2000', { facture: { periode_debut: '1999-09-01', periode_fin: '2026-09-30' } }, 'La période de la prestation porte une date qui n’est pas admise'],
  ['une date de prestation avant 2000', { facture: { date_prestation: '1999-01-01' } }, 'La date de la livraison ou de la prestation n’est pas une date admise'],
  ['une date de prestation après 2099', { facture: { date_prestation: '2100-01-01' } }, 'La date de la livraison ou de la prestation n’est pas une date admise'],
  // L'acompte d'un devis (P5b4a) : une marque illisible n'est jamais un « non », et chaque reprise dit son acompte.
  ['une marque d’acompte illisible', { acompte: { acompte: null } }, 'La marque d’acompte de la facture n’est pas lue'],
  [
    'un avoir dont la marque de la facture corrigée est illisible',
    { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: ORIGINE, acompte: { origineAcompte: null } },
    'La marque d’acompte de la facture corrigée n’est pas lue',
  ],
  [
    'un avoir marqué acompte',
    { lignes: [ligne({ quantite: -1 })], facture: { type: 'avoir', date_echeance: null }, origine: ORIGINE, acompte: { acompte: true } },
    'Un avoir n’est jamais une facture d’acompte',
  ],
  ['une date de versement sur une facture ordinaire', { acompte: { dateVersement: '2026-09-10' } }, 'Une date de versement n’appartient qu’à une facture d’acompte.'],
  ['un versement daté de l’avenir', { acompte: { acompte: true, dateVersement: '2026-10-08' } }, 'Le versement de l’acompte est daté du 08/10/2026'],
  ['un versement hors des bornes', { acompte: { acompte: true, dateVersement: '1999-12-31' } }, 'La date du versement de l’acompte n’est pas une date admise'],
  [
    'une facture d’acompte qui reprend un acompte',
    { lignes: FINALE.lignes, acompte: { acompte: true, ...FINALE.acompte } },
    'Une facture d’acompte ne reprend pas d’acompte.',
  ],
  [
    'une reprise dont l’acompte n’est pas lu (son BG-3 manquerait)',
    { lignes: FINALE.lignes, acompte: { ...FINALE.acompte, reprises: FINALE.acompte.reprises.map((r) => (r.ordre === 5 ? { ...r, factureId: 'acompte-3' } : r)) } },
    'Ligne 5 : la facture d’acompte qu’elle reprend n’est pas lue',
  ],
  [
    'une reprise qui ne dit pas quel acompte elle reprend',
    { lignes: FINALE.lignes, acompte: { ...FINALE.acompte, reprises: FINALE.acompte.reprises.map((r) => (r.ordre === 5 ? { ...r, factureId: null } : r)) } },
    'Ligne 5 : on ne sait pas quelle facture d’acompte elle reprend.',
  ],
  [
    'un acompte cité qu’aucune ligne ne reprend',
    { lignes: FINALE.lignes, acompte: { ...FINALE.acompte, reprises: FINALE.acompte.reprises.filter((r) => r.factureId !== 'acompte-2') } },
    'L’acompte F2026-0024 est cité sans qu’aucune ligne de la facture ne le reprenne.',
  ],
  [
    'une reprise d’une facture qui n’est pas un acompte',
    {
      lignes: FINALE.lignes,
      acompte: {
        reprises: FINALE.acompte.reprises.filter((r) => r.ordre !== 6),
        acomptesRepris: FINALE.acompte.acomptesRepris.map((a) => (a.id === 'acompte-2' ? { ...a, acompte: false } : a)),
      },
    },
    'Ligne 5 : la facture qu’elle reprend (F2026-0024) n’est pas une facture d’acompte.',
  ],
  [
    'une reprise qui ne se déduit pas',
    { lignes: FINALE.lignes.map((l) => (l.ordre === 3 ? { ...l, quantite: 1 } : l)), acompte: FINALE.acompte },
    'Ligne 3 : la reprise d’un acompte se déduit',
  ],
  [
    'une reprise sur une ligne que la facture n’a pas',
    { lignes: FINALE.lignes, acompte: { ...FINALE.acompte, reprises: [...FINALE.acompte.reprises, { ordre: 99, factureId: 'acompte-1' }] } },
    'Une reprise d’acompte désigne une ligne que la facture n’a pas.',
  ],
  [
    'un acompte repris au numéro hors du jeu de caractères',
    { lignes: FINALE.lignes, acompte: { ...FINALE.acompte, acomptesRepris: FINALE.acompte.acomptesRepris.map((a) => (a.id === 'acompte-1' ? { ...a, numero: 'F#21' } : a)) } },
    'Le numéro de l’acompte repris (F#21) ne peut pas être transmis.',
  ],
  [
    'l’avoir d’une finale qui défait ses reprises',
    {
      lignes: FINALE.lignes.map((l) => ({ ...l, quantite: -l.quantite })),
      facture: { type: 'avoir', date_echeance: null },
      origine: ORIGINE,
      acompte: FINALE.acompte,
    },
    'L’avoir d’une facture finale qui défait ses reprises d’acomptes ne se transmet pas encore',
  ],
]
