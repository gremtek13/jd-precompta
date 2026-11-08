// LA RÉPÉTITION D'UNE ANNÉE (MVP-D6) — l'année 2025 FICTIVE d'un praticien BNC en trésorerie, exonéré de TVA, dont le
// dossier a basculé « ventes par les factures » (MVP-D1 : le praticien valide lui-même ses factures depuis « Mes ventes »,
// sur un dossier basculé — HISTORIQUE.md, « LES RÉPONSES, LE MÊME JOUR »). Écrite EN CLAIR, ligne à ligne, pour que le test
// (src/lib/repetitionDUneAnnee.test.ts) en tire ses attendus par une arithmétique à lui, jamais par un moteur.
//
// Aucun nom : un patient n'en a pas ici (ses factures disent « Particulier »), un fournisseur s'appelle « Fournisseur n ».
// Les catégories sont les communes de la base, relevées le 08/11/2026 (`categories where dossier_id is null`).
//
// L'année : un compte bancaire ouvert sur une balance reprise (512 au 01/01/2025) ; 25 factures aux patients, 24 payées
// (12 par virement, 6 par chèque remis en banque, 6 en espèces), la dernière impayée au 31/12 ; 12 virements de
// l'Assurance maladie (tiers payant) classés « Ventes / prestations » ; 12 recettes en espèces sans facture, la caisse
// versée trois fois en banque, un prélèvement de l'exploitant en espèces ; des achats et leurs pièces, dont une payée en
// espèces par la caisse et deux réglées par un seul virement ; un prélèvement rejeté puis repris ; le loyer et les frais
// bancaires classés par catégorie ; l'Urssaf mensuelle (une échéance provisionnelle, une régularisation) et la caisse de
// retraite semestrielle ; un véhicule au barème ; un appareil amorti ; des virements personnels.

import type { ANouveau, Categorie, CotisationDeclaree, Immobilisation, NatureImmobilisation, OperationCaisse, Piece, ReglementGroupe, VehiculeDossier } from '../lib/types'
import type { EncaissementDesEcritures, FactureDesEcritures } from '../lib/ecrituresVentesFactureesEcran'
import type { LigneDeFacture } from '../lib/encaissementsFactures'
import type { PartVendue } from '../lib/ventesFacturees'
import { factureVendue } from './ventesFacturees'

export const D = '00000000-0000-4000-8000-000000002025'
export const ANNEE = 2025
const deux = (n: number) => String(n).padStart(2, '0')
const id = (genre: number, n: number) => `00000000-0000-4000-8${String(genre).padStart(3, '0')}-${String(n).padStart(12, '0')}`
const jour = (m: number, j: number) => `${ANNEE}-${deux(m)}-${deux(j)}`

// ── Les catégories communes de la base ───────────────────────────────────────────────────────────────────────────────
const categorie = (identifiant: string, code: string, libelle: string, compte: string, poste: string, ordre: number): Categorie => ({
  id: identifiant, dossier_id: null, code, libelle, ordre, compte_comptable: compte, poste_2035: poste,
})
export const ACHATS = categorie('a8bd39e8-2516-4fc1-ab4b-ae9b84800cfe', 'achats_fournisseurs', 'Achats fournisseurs', '606100', 'Achats', 10)
export const LOYER = categorie('bd740958-525d-4a6c-b214-aeb2e74742b5', 'loyer', 'Loyer', '613200', 'Loyers et charges locatives', 20)
export const FRAIS_BANCAIRES = categorie('bbb992f7-d8fe-44b8-a091-ae48fe654c15', 'frais_bancaires', 'Frais bancaires', '627000', 'Frais financiers', 70)
export const RECETTES = categorie('0373f5b5-28d2-4b9d-9737-086aa29ded59', 'ventes_prestations', 'Ventes / prestations', '706000', 'Recettes', 80)
export const AUTRE = categorie('e6d427ff-e012-4414-afd0-c8347e5b2911', 'autre', 'Autre', '628000', 'Divers', 90)
export const CATEGORIES: Categorie[] = [ACHATS, LOYER, FRAIS_BANCAIRES, RECETTES, AUTRE]

export const NATURE_MATERIEL: NatureImmobilisation = {
  id: id(9, 1), dossier_id: null, libelle: 'Matériel médical', duree_annees_defaut: 5, ordre: 1, compte_immobilisation: '215400',
}

// ── Les pièces ───────────────────────────────────────────────────────────────────────────────────────────────────────
let rangPiece = 0
function piece(date: string, ttc: number, categorieId: string | null, tiers: string): Piece {
  const n = rangPiece++
  return {
    id: id(1, n), dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/piece-${n}.pdf`, nom_fichier: `piece-${n}.pdf`,
    storage_hash: `empreinte-${n}`, date_piece: date, tiers, montant_ht: ttc, montant_tva: 0, montant_ttc: ttc, devise: 'EUR',
    montant_devise: null, taux_change: null, conversion_source: null, categorie_id: categorieId, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', confiance: 'haute', superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
    vente_hors_des_factures: false, updated_at: `${date}T10:00:00Z`, created_at: `${date}T10:00:00Z`,
  }
}

// Dix achats de fournitures médicales, chacun payé par un mouvement du relevé (date de la pièce, puis date du paiement).
export const ACHATS_RAPPROCHES: { piece: Piece; paiement: string }[] = [
  [jour(1, 14), 85.40, jour(1, 16)], [jour(2, 6), 132.00, jour(2, 8)], [jour(3, 20), 64.90, jour(3, 21)],
  [jour(4, 9), 210.00, jour(4, 11)], [jour(5, 22), 98.30, jour(5, 23)], [jour(6, 3), 150.00, jour(6, 5)],
  [jour(7, 17), 77.70, jour(7, 18)], [jour(9, 11), 120.50, jour(9, 12)], [jour(10, 2), 189.90, jour(10, 6)],
  [jour(11, 25), 56.00, jour(11, 26)],
].map(([date, ttc, paiement], i) => ({ piece: piece(date as string, ttc as number, ACHATS.id, `Fournisseur ${i + 1}`), paiement: paiement as string }))

// Une pièce payée en espèces par la caisse (C8).
export const ACHAT_EN_ESPECES = piece(jour(3, 12), 45.00, ACHATS.id, 'Fournisseur 11')
// Deux pièces réglées par un seul virement (un règlement groupé).
export const ACHATS_GROUPES = [piece(jour(6, 2), 200.00, ACHATS.id, 'Fournisseur 12'), piece(jour(6, 10), 250.00, ACHATS.id, 'Fournisseur 12')]
// Un abonnement prélevé, rejeté par la banque, puis représenté.
export const PIECE_DU_REJET = piece(jour(5, 2), 59.99, AUTRE.id, 'Fournisseur 13')
// Un appareil, immobilisé et amorti (sa pièce sans catégorie : c'est sa nature qui donne le compte).
export const PIECE_DE_L_APPAREIL = piece(jour(4, 1), 3600.00, null, 'Fournisseur 14')

export const PIECES: Piece[] = [...ACHATS_RAPPROCHES.map((a) => a.piece), ACHAT_EN_ESPECES, ...ACHATS_GROUPES, PIECE_DU_REJET, PIECE_DE_L_APPAREIL]

export const IMMOBILISATIONS: Immobilisation[] = [{
  id: id(7, 1), dossier_id: D, piece_id: PIECE_DE_L_APPAREIL.id, nature_id: NATURE_MATERIEL.id, libelle: 'Appareil d’échographie',
  valeur: 3600.00, date_acquisition: jour(4, 1), date_mise_en_service: jour(4, 1), duree_annees: 5, created_at: `${jour(4, 2)}T10:00:00Z`,
}]

export const VEHICULES: VehiculeDossier[] = [{
  id: id(10, 1), dossier_id: D, annee: ANNEE, modele: 'Voiture fictive', type: 'voiture', puissance_fiscale: 5, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 8000, inscrit_immobilisations: false, amortissements_a_reintegrer: null,
  created_at: `${ANNEE}-12-31T10:00:00Z`, updated_at: `${ANNEE}-12-31T10:00:00Z`,
}]

// ── Les cotisations ──────────────────────────────────────────────────────────────────────────────────────────────────
let rangCotisation = 0
function cotisation(echeance: string, montant: number, csg: number, previsionnel = false): CotisationDeclaree {
  return {
    id: id(3, rangCotisation++), dossier_id: D, echeance, montant_appele: montant, montant_verse: montant, montant_csg_crds: csg,
    previsionnel, created_at: `${echeance}T08:00:00Z`, paiement_personnel_le: null,
  }
}
// L'Urssaf, chaque 5 du mois ; mars encore provisionnelle (l'appel définitif n'est pas venu), payée comme les autres.
export const URSSAF_MENSUELLE = Array.from({ length: 12 }, (_, i) => cotisation(jour(i + 1, 5), 650.00, 194.00, i === 2))
// La régularisation de l'année précédente, appelée en novembre.
export const URSSAF_REGULARISATION = cotisation(jour(11, 20), 380.00, 97.00)
// La caisse de retraite, deux fois l'an (sans CSG-CRDS : saisie à zéro).
export const RETRAITE = [cotisation(jour(2, 10), 1800.00, 0), cotisation(jour(8, 10), 1800.00, 0)]
export const COTISATIONS: CotisationDeclaree[] = [...URSSAF_MENSUELLE, URSSAF_REGULARISATION, ...RETRAITE]

// ── Les factures aux patients ────────────────────────────────────────────────────────────────────────────────────────
export interface FactureDeLAnnee {
  facture: FactureDesEcritures
  ligne: LigneDeFacture
  // Comment elle est payée : par un virement (son mouvement du relevé), un chèque remis en banque, des espèces, ou rien.
  paiement: { moyen: 'virement' | 'cheque'; date: string } | { moyen: 'especes'; date: string } | null
}
let rangFacture = 0
function factureDuPatient(date: string, montant: number, paiement: FactureDeLAnnee['paiement']): FactureDeLAnnee {
  const n = rangFacture++
  const f = factureVendue({
    id: id(4, n), dossier_id: D, numero: `F${ANNEE}-${String(n + 1).padStart(4, '0')}`, date_emission: date, tiers_nom: 'Particulier',
  })
  return {
    facture: { ...f, montant_ttc: montant, tiers_siret: null },
    ligne: { facture_id: f.id, ordre: 1, designation: 'Consultation', quantite: 1, prix_unitaire_ht: montant, taux_tva: 0 },
    paiement,
  }
}
// Chaque mois : une facture de 120,00 € le 5, payée par virement le 10 ; une de 90,00 € le 18, payée par chèque remis le
// 24 (mois impairs) ou en espèces le jour même (mois pairs). Puis une facture du 20/12, impayée au 31/12.
export const FACTURES: FactureDeLAnnee[] = [
  ...Array.from({ length: 12 }, (_, i) => [
    factureDuPatient(jour(i + 1, 5), 120.00, { moyen: 'virement', date: jour(i + 1, 10) }),
    factureDuPatient(jour(i + 1, 18), 90.00, (i + 1) % 2 === 1 ? { moyen: 'cheque', date: jour(i + 1, 24) } : { moyen: 'especes', date: jour(i + 1, 18) }),
  ]).flat(),
  factureDuPatient(jour(12, 20), 150.00, null),
]

// ── Le relevé, mouvement par mouvement ───────────────────────────────────────────────────────────────────────────────
export type Classement =
  | { type: 'piece'; pieceId: string }
  | { type: 'groupe'; parts: { pieceId: string; montant: number }[] }
  | { type: 'categorie'; categorie: Categorie }
  | { type: 'cotisation'; cotisationId: string }
  | { type: 'encaissements'; factureId: string; moyen: 'virement' | 'cheque' }
  | { type: 'caisse' }
  | { type: 'personnel' }

export interface MouvementDeLAnnee { date: string; libelle: string; montant: number; classement: Classement }

const mouvements: MouvementDeLAnnee[] = []
const m = (date: string, libelle: string, montant: number, classement: Classement) => mouvements.push({ date, libelle, montant, classement })

for (const f of FACTURES) {
  if (f.paiement?.moyen === 'virement') m(f.paiement.date, 'VIR SEPA HONORAIRES', f.facture.montant_ttc, { type: 'encaissements', factureId: f.facture.id, moyen: 'virement' })
  if (f.paiement?.moyen === 'cheque') m(f.paiement.date, 'REMISE CHEQUE', f.facture.montant_ttc, { type: 'encaissements', factureId: f.facture.id, moyen: 'cheque' })
}
for (let i = 1; i <= 12; i++) {
  m(jour(i, 15), 'VIR CPAM TIERS PAYANT', 4000.00, { type: 'categorie', categorie: RECETTES })
  m(jour(i, 3), 'PRLV LOYER CABINET', -800.00, { type: 'categorie', categorie: LOYER })
  m(jour(i, 28), 'FRAIS TENUE DE COMPTE', -7.50, { type: 'categorie', categorie: FRAIS_BANCAIRES })
  m(jour(i, 28), 'VIR COMPTE PERSONNEL', -2000.00, { type: 'personnel' })
}
for (const c of [...URSSAF_MENSUELLE, URSSAF_REGULARISATION]) m(c.echeance, 'PRLV URSSAF', -c.montant_appele, { type: 'cotisation', cotisationId: c.id })
for (const c of RETRAITE) m(c.echeance, 'PRLV CAISSE RETRAITE', -c.montant_appele, { type: 'cotisation', cotisationId: c.id })
for (const a of ACHATS_RAPPROCHES) m(a.paiement, `CB ${a.piece.tiers!.toUpperCase()}`, -a.piece.montant_ttc!, { type: 'piece', pieceId: a.piece.id })
m(jour(6, 15), 'VIR FOURNISSEUR 12', -450.00, { type: 'groupe', parts: ACHATS_GROUPES.map((p) => ({ pieceId: p.id, montant: -p.montant_ttc! })) })
m(jour(5, 5), 'PRLV FOURNISSEUR 13', -59.99, { type: 'piece', pieceId: PIECE_DU_REJET.id })
m(jour(5, 12), 'REJET PRLV FOURNISSEUR 13', 59.99, { type: 'piece', pieceId: PIECE_DU_REJET.id })
m(jour(5, 20), 'PRLV FOURNISSEUR 13', -59.99, { type: 'piece', pieceId: PIECE_DU_REJET.id })
m(jour(4, 3), 'VIR FOURNISSEUR 14', -3600.00, { type: 'piece', pieceId: PIECE_DE_L_APPAREIL.id })
m(jour(4, 30), 'VERSEMENT ESPECES', 300.00, { type: 'caisse' })
m(jour(9, 30), 'VERSEMENT ESPECES', 400.00, { type: 'caisse' })
m(jour(12, 29), 'VERSEMENT ESPECES', 300.00, { type: 'caisse' })

// Dans l'ordre du relevé : la date, puis l'ordre d'écriture ci-dessus (stable).
export const MOUVEMENTS: readonly MouvementDeLAnnee[] = [...mouvements].sort((a, b) => a.date.localeCompare(b.date))

// Les deux soldes que la banque imprime. Celui du 31/12 est ce que la banque DIT, écrit en clair, jamais recalculé ici :
// le contrôle de solde de l'import le confronte aux mouvements.
export const SOLDE_DU_01_01 = 4000.00
export const SOLDE_DU_31_12_IMPRIME = '4 215,31'

// ── La caisse ────────────────────────────────────────────────────────────────────────────────────────────────────────
let rangOperation = 0
function operation(o: Pick<OperationCaisse, 'genre' | 'date' | 'montant'> & Partial<OperationCaisse>): OperationCaisse {
  return {
    id: id(6, rangOperation++), dossier_id: D, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null,
    origine: 'client', remplace_id: null, cree_le: `${o.date}T18:00:00Z`, cree_par: null, retire_le: null, retire_par: null, ...o,
  }
}
// Une recette en espèces sans facture, le 27 de chaque mois (aucune facture payée en espèces ce jour-là).
export const OPERATIONS_DE_CAISSE: OperationCaisse[] = [
  ...Array.from({ length: 12 }, (_, i) => operation({ genre: 'recette', date: jour(i + 1, 27), montant: 60.00, categorie_id: RECETTES.id, encaissements_du_jour: [] })),
  // Un paiement d'achat fait SORTIR des espèces : son montant est négatif (le sens de sa pièce, `especesEntrentPour`).
  operation({ genre: 'paiement', date: jour(3, 12), montant: -45.00, piece_id: ACHAT_EN_ESPECES.id }),
  operation({ genre: 'prelevement', date: jour(7, 30), montant: 100.00 }),
]

// ── La balance reprise : la banque au solde du premier relevé, face au compte de l'exploitant ─────────────────────────
const aNouveau = (n: number, compte: string, sens: 'debit' | 'credit', montant: number, libelle: string): ANouveau => ({
  id: id(11, n), dossier_id: D, date: jour(1, 1), compte, compte_origine: compte, libelle, sens, montant, source_nom: 'balance-2024.csv',
  source_empreinte: 'empreinte-balance', created_at: `${jour(1, 1)}T09:00:00Z`, compte_lib: null, ecriture_lib: null,
})
export const A_NOUVEAUX: ANouveau[] = [
  aNouveau(1, '512000', 'debit', SOLDE_DU_01_01, 'Banque'),
  aNouveau(2, '108000', 'credit', SOLDE_DU_01_01, "Compte de l'exploitant"),
]

// ── Les fichiers du relevé, tels qu'une banque les exporte ───────────────────────────────────────────────────────────
const francais = (n: number) => n.toFixed(2).replace('.', ',')
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/** Un CSV « Débit / Crédit », encadré de ses deux lignes de solde — un solde créditeur dans la colonne Crédit. */
export function texteDuReleveCsv(): string {
  return [
    'Date;Libellé;Débit;Crédit',
    `01/01/${ANNEE};SOLDE AU 01/01/${ANNEE};;${francais(SOLDE_DU_01_01)}`,
    ...MOUVEMENTS.map((x) => `${dateFr(x.date)};${x.libelle};${x.montant < 0 ? francais(-x.montant) : ''};${x.montant > 0 ? francais(x.montant) : ''}`),
    `31/12/${ANNEE};SOLDE AU 31/12/${ANNEE};;${SOLDE_DU_31_12_IMPRIME}`,
  ].join('\r\n')
}

/** Le même relevé en OFX 1.x (SGML), son solde comptable au 31/12. */
export function texteDuReleveOfx(): string {
  const entete = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', ''].join('\r\n')
  const operations = MOUVEMENTS.flatMap((x, i) => [
    '<STMTTRN>', `<TRNTYPE>${x.montant < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${x.date.replaceAll('-', '')}`, `<TRNAMT>${x.montant.toFixed(2)}`,
    `<FITID>REPETITION${i}`, `<NAME>${x.libelle}`, '</STMTTRN>',
  ])
  const stmtrs = [
    '<STMTRS>', '<CURDEF>EUR', '<BANKACCTFROM>', '<BANKID>99999', '<BRANCHID>00001', '<ACCTID>00012345678', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${ANNEE}0101`, `<DTEND>${ANNEE}1231`, ...operations, '</BANKTRANLIST>',
    '<LEDGERBAL>', `<BALAMT>${SOLDE_DU_31_12_IMPRIME.replace(/\s/g, '').replace(',', '.')}`, `<DTASOF>${ANNEE}1231`, '</LEDGERBAL>', '</STMTRS>',
  ].join('\r\n')
  return `${entete}\r\n<OFX>\r\n<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${ANNEE + 1}0105<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>\r\n`
    + `<BANKMSGSRSV1>\r\n<STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>\r\n${stmtrs}\r\n</STMTTRNRS>\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n`
}

// ── Ce que la base porterait une fois le relevé importé et classé ─────────────────────────────────────────────────────
export function reglementsDuMouvement(ligneId: string, parts: { pieceId: string; montant: number }[]): ReglementGroupe[] {
  return parts.map((p, i) => ({ id: `${ligneId}-part-${i}`, dossier_id: D, ligne_bancaire_id: ligneId, piece_id: p.pieceId, montant: p.montant, created_at: `${ANNEE}-12-31T10:00:00Z` }))
}

export function encaissementsEtParts(ligneDuMouvement: (factureId: string) => string | null): { encaissements: EncaissementDesEcritures[]; parts: PartVendue[] } {
  const encaissements: EncaissementDesEcritures[] = []
  const parts: PartVendue[] = []
  FACTURES.forEach((f, n) => {
    if (!f.paiement) return
    const e: EncaissementDesEcritures = {
      id: id(5, n), dossier_id: D, facture_id: f.facture.id, date_encaissement: f.paiement.date, montant: f.facture.montant_ttc,
      moyen: f.paiement.moyen, ligne_bancaire_id: f.paiement.moyen === 'especes' ? null : ligneDuMouvement(f.facture.id),
      annule_id: null, cree_le: `${f.paiement.date}T19:00:00Z`, retire_le: null, cree_par: null, compte_contrepartie: null,
    }
    encaissements.push(e)
    parts.push({ encaissement_id: e.id, dossier_id: D, taux: 0, montant: e.montant })
  })
  return { encaissements, parts }
}
