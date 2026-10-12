// LES QUATRE DOSSIERS DE RÉFÉRENCE (demande du cabinet du 12/10/2026) — FICTIFS de bout en bout : aucune personne, aucune
// entreprise, aucun numéro réel. Ils sont faits pour être recalculés par l'expert-comptable du cabinet avec son propre
// logiciel ; ses chiffres deviendront des cas de référence, comme ceux du moteur de l'Urssaf. Une seule source : le
// document remis à l'expert et le calcul de nos chiffres partent de ces données, jamais d'une recopie.
//
// Chaque opération est écrite deux fois : en mots (ce que l'expert lit sur un relevé ou une facture) et dans la forme où
// l'application la tient (`modele`). La forme de l'application suit ce qu'un cabinet ferait AUJOURD'HUI avec elle — les
// dix catégories communes, faute d'écran pour en créer une propre au dossier (PC7) : c'est voulu, l'écart éventuel avec
// l'expert dira aussi ce que les catégories ne permettent pas.

export type CodeCategorie =
  | 'achats_fournisseurs' | 'loyer' | 'assurance' | 'carburant_deplacements' | 'notes_frais' | 'honoraires'
  | 'frais_bancaires' | 'ventes_prestations' | 'autre' | 'gains_divers'

// Les dix catégories communes, telles que la production les porte le 12/10/2026 (lecture du catalogue).
export const CATEGORIES_COMMUNES: { code: CodeCategorie; libelle: string; compte: string; poste: string }[] = [
  { code: 'achats_fournisseurs', libelle: 'Achats fournisseurs', compte: '606100', poste: 'Achats' },
  { code: 'loyer', libelle: 'Loyer', compte: '613200', poste: 'Loyers et charges locatives' },
  { code: 'assurance', libelle: 'Assurance', compte: '616100', poste: "Primes d'assurance" },
  { code: 'carburant_deplacements', libelle: 'Carburant / déplacements', compte: '625100', poste: 'Frais de déplacement' },
  { code: 'notes_frais', libelle: 'Notes de frais', compte: '625700', poste: 'Frais de réception, de représentation' },
  { code: 'honoraires', libelle: 'Honoraires', compte: '622600', poste: 'Honoraires ne constituant pas des rétrocessions' },
  { code: 'frais_bancaires', libelle: 'Frais bancaires', compte: '627000', poste: 'Frais financiers' },
  { code: 'ventes_prestations', libelle: 'Ventes / prestations', compte: '706000', poste: 'Recettes' },
  { code: 'autre', libelle: 'Autre', compte: '628000', poste: 'Divers' },
  { code: 'gains_divers', libelle: "Gains divers (indemnités, remboursements d'assurance)", compte: '758000', poste: 'Gains divers' },
]

const arrondi = (n: number) => Math.round(n * 100) / 100
const deux = (n: number) => String(n).padStart(2, '0')

// ── Les pièces (factures, quittances, avoirs) ─────────────────────────────────────────────────────────────────────────

export interface PieceDeReference {
  id: string
  date: string
  tiers: string
  objet: string
  type: 'achat' | 'vente'
  // Les montants de la facture ; un avoir est négatif.
  ht: number | null
  tva: number | null
  ttc: number
  categorie: CodeCategorie | null
  // Une immobilisation : la facture n'est pas une charge, le bien s'amortit (registre du dossier).
  immobilisation?: string
}

// ── Le relevé bancaire ────────────────────────────────────────────────────────────────────────────────────────────────

export type ModeleDuMouvement =
  | { type: 'categorie'; categorie: CodeCategorie; taux?: number | null }
  | { type: 'personnel' }
  | { type: 'piece'; piece: string }
  | { type: 'cotisation'; cotisation: string }
  | { type: 'emprunt'; numero: number; capital: number; interets: number; assurance: number }

export interface MouvementDeReference {
  id: string
  date: string
  libelle: string
  // Signé comme le relevé : positif, un crédit ; négatif, un débit.
  montant: number
  // Ce que c'est, en clair, pour l'expert-comptable.
  nature: string
  modele: ModeleDuMouvement
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DOSSIER A — infirmière libérale fictive, BNC, déclaration contrôlée, comptabilité de trésorerie, exonérée de TVA
// (CGI, art. 261-4-1°), option pour le barème kilométrique. Exercice 2025.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const A_SITUATION = {
  titre: 'Dossier A — infirmière libérale (fictive), déclaration 2035 de l’exercice 2025',
  points: [
    'Infirmière diplômée d’État, conventionnée, exerce seule dans un cabinet loué depuis 2015. Personne fictive.',
    'Bénéfices non commerciaux, régime de la déclaration contrôlée (2035), exercice civil du 1er janvier au 31 décembre 2025.',
    'Comptabilité recettes-dépenses (trésorerie) : un seul compte bancaire professionnel, relevé ci-dessous.',
    'Exonérée de TVA (CGI, art. 261-4-1°) : aucune TVA récupérable, les dépenses se comptent TTC.',
    'Option pour le barème kilométrique BNC pour sa voiture personnelle (thermique, 5 CV) : 14 500 km professionnels en 2025.',
    'Ni salarié, ni remplaçant, ni rétrocession d’honoraires ; aucune plus-value ; pas d’adhésion Madelin ni PER.',
  ],
}

export const A_VEHICULE = {
  type: 'voiture' as const,
  puissanceFiscale: 5,
  motorisation: 'thermique' as const,
  kmProfessionnels: 14_500,
  annee: 2025,
}

// Le registre des immobilisations — c'est aussi le dossier C (plan d'amortissement).
export interface BienDeReference {
  id: string
  libelle: string
  valeur: number
  dateAcquisition: string
  dateMiseEnService: string
  dureeAnnees: number
  // La facture d'acquisition, quand elle est dans l'exercice (sinon le bien vient d'un exercice antérieur).
  piece?: string
  compte: string
}

export const REGISTRE: BienDeReference[] = [
  { id: 'imm-mobilier', libelle: 'Mobilier du cabinet (bureau, armoire, sièges)', valeur: 2_400, dateAcquisition: '2021-06-20', dateMiseEnService: '2021-07-01', dureeAnnees: 5, compte: '218400' },
  { id: 'imm-table', libelle: 'Table d’examen électrique', valeur: 3_150, dateAcquisition: '2024-02-25', dateMiseEnService: '2024-02-29', dureeAnnees: 7, compte: '215400' },
  { id: 'imm-logiciel', libelle: 'Logiciel de soins (licence perpétuelle)', valeur: 840, dateAcquisition: '2025-01-31', dateMiseEnService: '2025-01-31', dureeAnnees: 3, piece: 'A-F-LOGICIEL', compte: '205000' },
  { id: 'imm-ordinateur', libelle: 'Ordinateur portable', valeur: 1_290, dateAcquisition: '2025-03-14', dateMiseEnService: '2025-03-14', dureeAnnees: 3, piece: 'A-F-ORDI', compte: '218300' },
  { id: 'imm-agencement', libelle: 'Agencement du cabinet (travaux)', valeur: 6_875.55, dateAcquisition: '2025-09-25', dateMiseEnService: '2025-10-01', dureeAnnees: 10, piece: 'A-F-AGENCEMENT', compte: '218100' },
  { id: 'imm-ecg', libelle: 'Appareil ECG portable', valeur: 1_999.99, dateAcquisition: '2025-12-20', dateMiseEnService: '2025-12-31', dureeAnnees: 5, piece: 'A-F-ECG', compte: '215400' },
]

// Les factures d'une dépense TTC à 20 % : le hors taxe et la TVA, au centime, comme sur une facture.
const a20 = (ttc: number) => {
  const ht = arrondi(ttc / 1.2)
  return { ht, tva: arrondi(ttc - ht), ttc }
}

export const A_PIECES: PieceDeReference[] = [
  { id: 'A-F-FOURN-1', date: '2024-12-18', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Pansements, compresses, gants', type: 'achat', ...a20(156.30), categorie: 'achats_fournisseurs' },
  { id: 'A-F-FOURN-2', date: '2025-02-12', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Fournitures de soins', type: 'achat', ...a20(312.40), categorie: 'achats_fournisseurs' },
  { id: 'A-F-FOURN-3', date: '2025-05-15', tiers: 'Pharmacie (fictive)', objet: 'Fournitures de soins', type: 'achat', ...a20(189.90), categorie: 'achats_fournisseurs' },
  { id: 'A-F-FOURN-4', date: '2025-09-03', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Fournitures de soins', type: 'achat', ...a20(245.15), categorie: 'achats_fournisseurs' },
  { id: 'A-F-FOURN-5', date: '2025-12-22', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Fournitures de soins', type: 'achat', ...a20(211.80), categorie: 'achats_fournisseurs' },
  { id: 'A-AV-FOURN', date: '2025-06-06', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Avoir : retour de gants non conformes', type: 'achat', ...a20(-24.90), categorie: 'achats_fournisseurs' },
  { id: 'A-F-TENSIO', date: '2025-04-14', tiers: 'Pharmacie (fictive)', objet: 'Tensiomètre électronique (petit matériel)', type: 'achat', ...a20(89.00), categorie: 'achats_fournisseurs' },
  { id: 'A-F-RCP', date: '2025-01-15', tiers: 'Assureur (fictif)', objet: 'Responsabilité civile professionnelle 2025', type: 'achat', ht: null, tva: null, ttc: 186.00, categorie: 'assurance' },
  { id: 'A-F-HONORAIRES', date: '2025-04-20', tiers: 'Cabinet comptable (fictif)', objet: 'Honoraires : comptabilité et 2035 de 2024', type: 'achat', ...a20(1_080.00), categorie: 'honoraires' },
  { id: 'A-F-LOGICIEL', date: '2025-01-31', tiers: 'Éditeur de logiciel (fictif)', objet: 'Licence perpétuelle du logiciel de soins', type: 'achat', ...a20(840.00), categorie: null, immobilisation: 'imm-logiciel' },
  { id: 'A-F-ORDI', date: '2025-03-14', tiers: 'Revendeur informatique (fictif)', objet: 'Ordinateur portable', type: 'achat', ...a20(1_290.00), categorie: null, immobilisation: 'imm-ordinateur' },
  { id: 'A-F-AGENCEMENT', date: '2025-09-25', tiers: 'Entreprise de travaux (fictive)', objet: 'Agencement du cabinet, réception des travaux le 01/10/2025', type: 'achat', ...a20(6_875.55), categorie: null, immobilisation: 'imm-agencement' },
  { id: 'A-F-ECG', date: '2025-12-20', tiers: 'Fournisseur de matériel médical (fictif)', objet: 'Appareil ECG portable, livré et mis en service le 31/12/2025', type: 'achat', ...a20(1_999.99), categorie: null, immobilisation: 'imm-ecg' },
]

// L'échéancier URSSAF 2025 (appels provisionnels) : 12 prélèvements, la CSG-CRDS de chacun selon l'avis d'appel ; puis
// une régularisation REMBOURSÉE en novembre. La caisse de retraite (CARPIMKO, fictive ici par ses montants) n'appelle
// pas de CSG-CRDS.
export interface CotisationDeReference {
  id: string
  organisme: 'URSSAF' | 'Caisse de retraite'
  echeance: string
  // Positif, un appel ; négatif, un remboursement.
  montant: number
  csgCrds: number
  objet: string
}

export const A_COTISATIONS: CotisationDeReference[] = [
  ...Array.from({ length: 12 }, (_, i): CotisationDeReference => ({
    id: `A-URSSAF-${deux(i + 1)}`, organisme: 'URSSAF', echeance: `2025-${deux(i + 1)}-05`, montant: 1_186.00, csgCrds: 530.00,
    objet: `Échéance provisionnelle ${deux(i + 1)}/2025 (allocations familiales, maladie-maternité, CSG-CRDS, CURPS, formation)`,
  })),
  {
    id: 'A-URSSAF-REGUL', organisme: 'URSSAF', echeance: '2025-11-18', montant: -412.00, csgCrds: 180.00,
    objet: 'Régularisation sur revenus 2024 : remboursement de 412,00 €, dont 180,00 € de CSG-CRDS',
  },
  ...Array.from({ length: 12 }, (_, i): CotisationDeReference => ({
    id: `A-RETRAITE-${deux(i + 1)}`, organisme: 'Caisse de retraite', echeance: `2025-${deux(i + 1)}-15`, montant: 412.50, csgCrds: 0,
    objet: `Retraite de base, complémentaire et invalidité-décès, échéance ${deux(i + 1)}/2025`,
  })),
]

// LE PRÊT PROFESSIONNEL : 8 000 € débloqués le 05/02/2024, 48 mensualités au taux nominal de 3,20 %, la première le
// 25/03/2024 ; une assurance emprunteur de 4,00 € par mois. Le tableau d'amortissement se calcule comme une banque le
// fait : intérêts du mois au centime sur le capital restant dû, mensualité hors assurance constante, au centime.
export interface EcheanceDePret {
  numero: number
  date: string
  capital: number
  interets: number
  assurance: number
  total: number
  restantDu: number
}

export function tableauDuPret(): EcheanceDePret[] {
  const capitalInitial = 8_000
  const taux = 0.032 / 12
  const n = 48
  const mensualite = arrondi(capitalInitial * taux / (1 - (1 + taux) ** -n))
  const lignes: EcheanceDePret[] = []
  let restant = capitalInitial
  for (let k = 1; k <= n; k++) {
    const interets = arrondi(restant * taux)
    const capital = k === n ? arrondi(restant) : arrondi(mensualite - interets)
    restant = arrondi(restant - capital)
    const mois = 3 + (k - 1)
    const annee = 2024 + Math.floor((mois - 1) / 12)
    const date = `${annee}-${deux(((mois - 1) % 12) + 1)}-25`
    lignes.push({ numero: k, date, capital, interets, assurance: 4.00, total: arrondi(capital + interets + 4.00), restantDu: restant })
  }
  return lignes
}

export const A_PRET = { capitalInitial: 8_000, taux: '3,20 %', duree: '48 mois', deblocage: '2024-02-05', premiereEcheance: '2024-03-25' }

const mensuel = (jour: number, construire: (mois: number) => Omit<MouvementDeReference, 'date'>): MouvementDeReference[] =>
  Array.from({ length: 12 }, (_, i) => ({ date: `2025-${deux(i + 1)}-${deux(jour)}`, ...construire(i + 1) }))

const CPAM: [string, number][] = [
  ['2025-01-10', 5_812.40], ['2025-02-10', 5_640.10], ['2025-03-10', 6_105.75], ['2025-04-10', 5_930.20],
  ['2025-05-12', 5_701.85], ['2025-06-10', 5_988.30], ['2025-07-10', 4_210.60], ['2025-08-11', 3_905.45],
  ['2025-09-10', 6_012.95], ['2025-10-10', 6_230.15], ['2025-11-10', 5_870.05], ['2025-12-10', 6_041.80],
  ['2025-12-30', 2_315.40],
]
const MUTUELLES: [string, number][] = [['2025-03-31', 1_120.35], ['2025-06-30', 1_080.90], ['2025-09-30', 905.60], ['2025-12-31', 1_210.45]]
const CHEQUES: [string, number][] = [['2025-02-14', 320.00], ['2025-05-20', 285.50], ['2025-09-16', 410.00], ['2025-11-18', 198.00]]

export function releveA(): MouvementDeReference[] {
  const pret = tableauDuPret().filter((e) => e.date.startsWith('2025-'))
  const m: MouvementDeReference[] = [
    ...CPAM.map(([date, montant], i): MouvementDeReference => ({
      id: `A-CPAM-${i + 1}`, date, libelle: 'VIR CPAM TIERS PAYANT', montant, nature: 'Honoraires : tiers payant de l’Assurance maladie',
      modele: { type: 'categorie', categorie: 'ventes_prestations' },
    })),
    ...MUTUELLES.map(([date, montant], i): MouvementDeReference => ({
      id: `A-MUT-${i + 1}`, date, libelle: 'VIR ORGANISMES COMPLEMENTAIRES', montant, nature: 'Honoraires : part des complémentaires santé',
      modele: { type: 'categorie', categorie: 'ventes_prestations' },
    })),
    ...CHEQUES.map(([date, montant], i): MouvementDeReference => ({
      id: `A-CHQ-${i + 1}`, date, libelle: 'REMISE DE CHEQUES', montant, nature: 'Honoraires : chèques de patients',
      modele: { type: 'categorie', categorie: 'ventes_prestations' },
    })),
    { id: 'A-APPORT', date: '2025-02-03', libelle: 'VIR COMPTE PERSONNEL', montant: 1_500.00, nature: 'Apport de l’infirmière depuis son compte personnel', modele: { type: 'personnel' } },
    ...mensuel(5, (mois) => ({ id: `A-LOYER-${mois}`, libelle: 'PRLV LOYER CABINET', montant: -480.00, nature: `Loyer du cabinet, ${deux(mois)}/2025 (quittance mensuelle, sans TVA)`, modele: { type: 'categorie', categorie: 'loyer' } })),
    { id: 'A-PAI-FOURN-1', date: '2025-01-08', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: -156.30, nature: 'Paiement de la facture A-F-FOURN-1 (du 18/12/2024)', modele: { type: 'piece', piece: 'A-F-FOURN-1' } },
    { id: 'A-PAI-FOURN-2', date: '2025-02-20', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: -312.40, nature: 'Paiement de la facture A-F-FOURN-2', modele: { type: 'piece', piece: 'A-F-FOURN-2' } },
    { id: 'A-PAI-FOURN-3', date: '2025-05-15', libelle: 'CB PHARMACIE', montant: -189.90, nature: 'Paiement de la facture A-F-FOURN-3', modele: { type: 'piece', piece: 'A-F-FOURN-3' } },
    { id: 'A-PAI-AVOIR', date: '2025-06-12', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: 24.90, nature: 'Remboursement de l’avoir A-AV-FOURN', modele: { type: 'piece', piece: 'A-AV-FOURN' } },
    { id: 'A-PAI-FOURN-4', date: '2025-09-10', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: -245.15, nature: 'Paiement de la facture A-F-FOURN-4', modele: { type: 'piece', piece: 'A-F-FOURN-4' } },
    { id: 'A-PAI-TENSIO', date: '2025-04-14', libelle: 'CB PHARMACIE', montant: -89.00, nature: 'Paiement de la facture A-F-TENSIO', modele: { type: 'piece', piece: 'A-F-TENSIO' } },
    { id: 'A-PAI-RCP', date: '2025-01-15', libelle: 'PRLV ASSURANCE RCP', montant: -186.00, nature: 'Paiement de la facture A-F-RCP', modele: { type: 'piece', piece: 'A-F-RCP' } },
    { id: 'A-PAI-HONORAIRES', date: '2025-04-20', libelle: 'VIR CABINET COMPTABLE', montant: -1_080.00, nature: 'Paiement de la facture A-F-HONORAIRES', modele: { type: 'piece', piece: 'A-F-HONORAIRES' } },
    { id: 'A-PAI-LOGICIEL', date: '2025-01-31', libelle: 'CB EDITEUR LOGICIEL', montant: -840.00, nature: 'Paiement de la facture A-F-LOGICIEL (immobilisation)', modele: { type: 'piece', piece: 'A-F-LOGICIEL' } },
    { id: 'A-PAI-ORDI', date: '2025-03-14', libelle: 'CB REVENDEUR INFORMATIQUE', montant: -1_290.00, nature: 'Paiement de la facture A-F-ORDI (immobilisation)', modele: { type: 'piece', piece: 'A-F-ORDI' } },
    { id: 'A-PAI-AGENCEMENT', date: '2025-10-10', libelle: 'VIR ENTREPRISE DE TRAVAUX', montant: -6_875.55, nature: 'Paiement de la facture A-F-AGENCEMENT (immobilisation)', modele: { type: 'piece', piece: 'A-F-AGENCEMENT' } },
    { id: 'A-PAI-ECG', date: '2025-12-22', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: -1_999.99, nature: 'Paiement de la facture A-F-ECG (immobilisation)', modele: { type: 'piece', piece: 'A-F-ECG' } },
    { id: 'A-ASSU-AUTO', date: '2025-03-10', libelle: 'PRLV ASSURANCE AUTO', montant: -624.00, nature: 'Assurance annuelle de la voiture personnelle (barème kilométrique retenu)', modele: { type: 'personnel' } },
    ...([['2025-02-14', 180.40], ['2025-05-13', 205.15], ['2025-08-12', 172.90], ['2025-11-14', 183.85]] as [string, number][]).map(([date, montant], i): MouvementDeReference => ({
      id: `A-CARBURANT-${i + 1}`, date, libelle: 'CB STATION SERVICE', montant: -montant, nature: 'Carburant de la voiture personnelle (barème kilométrique retenu)', modele: { type: 'personnel' },
    })),
    ...([['2025-03-21', 32.40], ['2025-06-18', 28.80], ['2025-10-22', 23.40]] as [string, number][]).map(([date, montant], i): MouvementDeReference => ({
      id: `A-PEAGE-${i + 1}`, date, libelle: 'CB PEAGE / STATIONNEMENT', montant: -montant, nature: 'Péages et stationnement lors des tournées', modele: { type: 'categorie', categorie: 'carburant_deplacements' },
    })),
    ...mensuel(8, (mois) => ({ id: `A-TEL-${mois}`, libelle: 'PRLV OPERATEUR TELEPHONE', montant: -41.99, nature: 'Téléphone mobile et internet du cabinet (ligne professionnelle)', modele: { type: 'categorie', categorie: 'autre' } })),
    ...mensuel(2, (mois) => ({ id: `A-TELETRANS-${mois}`, libelle: 'PRLV ABONNEMENT TELETRANSMISSION', montant: -29.90, nature: 'Abonnement au logiciel de télétransmission (service mensuel)', modele: { type: 'categorie', categorie: 'autre' } })),
    { id: 'A-ORDRE', date: '2025-03-31', libelle: 'PRLV ORDRE NATIONAL INFIRMIERS', montant: -75.00, nature: 'Cotisation ordinale 2025', modele: { type: 'categorie', categorie: 'autre' } },
    ...mensuel(28, (mois) => ({ id: `A-FRAIS-${mois}`, libelle: 'FRAIS TENUE DE COMPTE', montant: -9.50, nature: 'Frais de tenue de compte', modele: { type: 'categorie', categorie: 'frais_bancaires' } })),
    { id: 'A-COMMISSION', date: '2025-07-17', libelle: 'COMMISSION INTERVENTION', montant: -15.00, nature: 'Commission d’intervention bancaire', modele: { type: 'categorie', categorie: 'frais_bancaires' } },
    { id: 'A-CFE', date: '2025-12-15', libelle: 'PRLV DGFIP CFE 2025', montant: -287.00, nature: 'Cotisation foncière des entreprises 2025', modele: { type: 'categorie', categorie: 'autre' } },
    ...A_COTISATIONS.map((c): MouvementDeReference => ({
      id: `M-${c.id}`, date: c.echeance, libelle: c.organisme === 'URSSAF' ? (c.montant > 0 ? 'PRLV URSSAF' : 'VIR URSSAF REGULARISATION') : 'PRLV CAISSE DE RETRAITE',
      montant: -c.montant, nature: c.objet, modele: { type: 'cotisation', cotisation: c.id },
    })),
    ...pret.map((e): MouvementDeReference => ({
      id: `A-PRET-${e.numero}`, date: e.date, libelle: 'ECHEANCE PRET PROFESSIONNEL', montant: -e.total,
      nature: `Échéance n° ${e.numero} du prêt : capital ${virgule(e.capital)} €, intérêts ${virgule(e.interets)} €, assurance ${virgule(e.assurance)} €`,
      modele: { type: 'emprunt', numero: e.numero, capital: e.capital, interets: e.interets, assurance: e.assurance },
    })),
    ...mensuel(28, (mois) => ({ id: `A-PRELEV-${mois}`, libelle: 'VIR COMPTE PERSONNEL', montant: -2_400.00, nature: 'Prélèvement personnel de l’infirmière', modele: { type: 'personnel' } })),
  ]
  return m.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1))
}

// CE QUI SUIT LA CLÔTURE et doit rester hors de 2025 : la facture de décembre payée en janvier, les soins de décembre
// payés en janvier.
export const A_APRES_CLOTURE: MouvementDeReference[] = [
  { id: 'A-CPAM-2026', date: '2026-01-02', libelle: 'VIR CPAM TIERS PAYANT', montant: 5_102.30, nature: 'Honoraires : tiers payant (soins de décembre 2025)', modele: { type: 'categorie', categorie: 'ventes_prestations' } },
  { id: 'A-PAI-FOURN-5', date: '2026-01-07', libelle: 'VIR FOURNISSEUR MATERIEL MEDICAL', montant: -211.80, nature: 'Paiement de la facture A-F-FOURN-5 (du 22/12/2025)', modele: { type: 'piece', piece: 'A-F-FOURN-5' } },
]

export const A_SOLDE_INITIAL = 8_240.15

// Un libellé du relevé s'écrit à la française : virgule décimale.
function virgule(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DOSSIER B — formateur-consultant fictif, BNC, redevable de la TVA au régime réel normal : CA3 de MARS 2026. Prestations
// de services : TVA exigible à l'encaissement, sans option pour les débits.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

// Le solde du compte au 1er mars 2026 : sans effet sur la CA3, il permet de contrôler un import du relevé.
export const B_SOLDE_INITIAL = 6_450

export const B_SITUATION = {
  titre: 'Dossier B — formateur-consultant (fictif), déclaration CA3 de mars 2026',
  points: [
    'Consultant et formateur en entreprise, profession libérale, personne fictive.',
    'Redevable de la TVA au régime réel normal : déclaration CA3 mensuelle. Période : du 1er au 31 mars 2026.',
    'Prestations de services en France métropolitaine, toutes au taux normal de 20 %. TVA exigible à l’encaissement : pas d’option pour les débits.',
    'Crédit de TVA reporté de la CA3 de février 2026 (ligne 27) : 180,00 €. Aucun remboursement demandé.',
    'Aucune opération intracommunautaire, aucune importation, aucune autoliquidation, aucun coefficient de déduction.',
  ],
  creditAnterieur: 180,
}

const t20 = (ht: number) => ({ ht, tva: arrondi(ht * 0.2), ttc: arrondi(ht * 1.2) })

export const B_PIECES: PieceDeReference[] = [
  { id: 'B-F-007', date: '2026-02-20', tiers: 'Client 1 (fictif)', objet: 'Facture F-2026-007 : mission de conseil', type: 'vente', ...t20(2_400), categorie: 'ventes_prestations' },
  { id: 'B-F-008', date: '2026-02-27', tiers: 'Client 2 (fictif)', objet: 'Facture F-2026-008 : formation', type: 'vente', ...t20(1_000), categorie: 'ventes_prestations' },
  { id: 'B-F-009', date: '2026-03-05', tiers: 'Client 3 (fictif)', objet: 'Facture F-2026-009 : mission de conseil', type: 'vente', ...t20(1_500), categorie: 'ventes_prestations' },
  { id: 'B-F-010', date: '2026-03-18', tiers: 'Client 1 (fictif)', objet: 'Facture F-2026-010 : mission de conseil', type: 'vente', ...t20(3_000), categorie: 'ventes_prestations' },
  { id: 'B-AV-001', date: '2026-03-20', tiers: 'Client 4 (fictif)', objet: 'Avoir AV-2026-001 sur la facture F-2026-006 (janvier, encaissée en janvier) : remise accordée', type: 'vente', ...t20(-200), categorie: 'ventes_prestations' },
  { id: 'B-A-COWORK', date: '2026-03-01', tiers: 'Espace de travail partagé (fictif)', objet: 'Location de bureau, mars 2026', type: 'achat', ...t20(400), categorie: 'loyer' },
  { id: 'B-A-LOGICIEL', date: '2026-02-28', tiers: 'Éditeur de logiciel (fictif)', objet: 'Abonnement logiciel, février 2026', type: 'achat', ...t20(49), categorie: 'autre' },
  { id: 'B-A-AVOIR-LOG', date: '2026-03-10', tiers: 'Éditeur de logiciel (fictif)', objet: 'Avoir : remise commerciale sur l’abonnement de février', type: 'achat', ...t20(-20), categorie: 'autre' },
  { id: 'B-A-ORDI', date: '2026-03-10', tiers: 'Revendeur informatique (fictif)', objet: 'Ordinateur (immobilisation), livré le 10/03/2026', type: 'achat', ...t20(1_500), categorie: null, immobilisation: 'B-IMM-ORDI' },
  { id: 'B-A-REPAS', date: '2026-03-18', tiers: 'Restaurant (fictif)', objet: 'Repas d’affaires avec un client (TVA à 10 %)', type: 'achat', ht: 60, tva: 6, ttc: 66, categorie: 'notes_frais' },
  { id: 'B-A-FOURNITURES', date: '2026-03-26', tiers: 'Papeterie (fictive)', objet: 'Fournitures de bureau', type: 'achat', ...t20(85), categorie: 'achats_fournisseurs' },
]

export function releveB(): MouvementDeReference[] {
  const m: MouvementDeReference[] = [
    { id: 'B-ENC-007', date: '2026-03-06', libelle: 'VIR CLIENT 1', montant: 2_880.00, nature: 'Encaissement de la facture F-2026-007', modele: { type: 'piece', piece: 'B-F-007' } },
    { id: 'B-ENC-008-1', date: '2026-03-16', libelle: 'VIR CLIENT 2', montant: 600.00, nature: 'Acompte sur la facture F-2026-008 (la moitié du TTC)', modele: { type: 'piece', piece: 'B-F-008' } },
    { id: 'B-ENC-009', date: '2026-03-25', libelle: 'VIR CLIENT 3', montant: 1_800.00, nature: 'Encaissement de la facture F-2026-009', modele: { type: 'piece', piece: 'B-F-009' } },
    { id: 'B-REMB-AV', date: '2026-03-20', libelle: 'VIR CLIENT 4 REMBOURSEMENT', montant: -240.00, nature: 'Remboursement au client de l’avoir AV-2026-001', modele: { type: 'piece', piece: 'B-AV-001' } },
    { id: 'B-PAI-COWORK', date: '2026-03-03', libelle: 'PRLV ESPACE DE TRAVAIL', montant: -480.00, nature: 'Paiement de la location de bureau de mars', modele: { type: 'piece', piece: 'B-A-COWORK' } },
    { id: 'B-PAI-LOGICIEL', date: '2026-03-02', libelle: 'PRLV EDITEUR LOGICIEL', montant: -58.80, nature: 'Paiement de l’abonnement de février', modele: { type: 'piece', piece: 'B-A-LOGICIEL' } },
    { id: 'B-REMB-LOG', date: '2026-03-12', libelle: 'VIR EDITEUR LOGICIEL', montant: 24.00, nature: 'Remboursement de l’avoir sur l’abonnement', modele: { type: 'piece', piece: 'B-A-AVOIR-LOG' } },
    { id: 'B-PAI-REPAS', date: '2026-03-18', libelle: 'CB RESTAURANT', montant: -66.00, nature: 'Repas d’affaires', modele: { type: 'piece', piece: 'B-A-REPAS' } },
    { id: 'B-PAI-FOURN', date: '2026-03-26', libelle: 'CB PAPETERIE', montant: -102.00, nature: 'Fournitures de bureau', modele: { type: 'piece', piece: 'B-A-FOURNITURES' } },
    { id: 'B-FRAIS', date: '2026-03-31', libelle: 'FRAIS TENUE DE COMPTE', montant: -12.00, nature: 'Frais bancaires (hors du champ de la TVA)', modele: { type: 'categorie', categorie: 'frais_bancaires' } },
  ]
  return m.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.id < y.id ? -1 : 1))
}

// Après la période : ce qui n'est pas de mars.
export const B_APRES_PERIODE: MouvementDeReference[] = [
  { id: 'B-PAI-ORDI', date: '2026-04-08', libelle: 'VIR REVENDEUR INFORMATIQUE', montant: -1_800.00, nature: 'Paiement de l’ordinateur (facture du 10/03/2026)', modele: { type: 'piece', piece: 'B-A-ORDI' } },
  { id: 'B-ENC-008-2', date: '2026-04-09', libelle: 'VIR CLIENT 2', montant: 600.00, nature: 'Solde de la facture F-2026-008', modele: { type: 'piece', piece: 'B-F-008' } },
  { id: 'B-ENC-010', date: '2026-04-12', libelle: 'VIR CLIENT 1', montant: 3_600.00, nature: 'Encaissement de la facture F-2026-010', modele: { type: 'piece', piece: 'B-F-010' } },
]

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DOSSIER D — société d'exercice libéral fictive (SELARL d'infirmières), impôt sur les sociétés, régime réel simplifié,
// comptabilité d'engagement : le bilan 2033-A de l'exercice 2025, depuis la balance générale après inventaire.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const D_SITUATION = {
  titre: 'Dossier D — SELARL d’infirmières (fictive), bilan simplifié 2033-A au 31 décembre 2025',
  points: [
    'Société d’exercice libéral à responsabilité limitée, associée unique gérante, soumise à l’impôt sur les sociétés. Société fictive.',
    'Régime réel simplifié : liasse 2033. Exercice du 1er janvier au 31 décembre 2025. Activité exonérée de TVA.',
    'Comptabilité d’engagement. La balance ci-dessous est la balance générale APRÈS inventaire : amortissements, charges constatées d’avance et impôt sur les sociétés sont déjà comptabilisés.',
    'Le résultat de 2024 a été affecté (réserve légale et report à nouveau) ; celui de 2025 n’est pas encore affecté.',
    'Les comptes 401 et 411 sont détaillés par tiers : un tiers débiteur et un tiers créditeur ne se compensent pas.',
  ],
}

export interface LigneDeBalance {
  compte: string
  libelle: string
  // Le solde : positif au débit, négatif au crédit.
  solde: number
  tiers?: string
}

export const D_BALANCE: LigneDeBalance[] = [
  { compte: '101300', libelle: 'Capital souscrit, appelé, versé', solde: -5_000 },
  { compte: '106100', libelle: 'Réserve légale', solde: -500 },
  { compte: '110000', libelle: 'Report à nouveau (solde créditeur)', solde: -12_340 },
  { compte: '164000', libelle: 'Emprunts auprès des établissements de crédit', solde: -18_750 },
  { compte: '215400', libelle: 'Matériel médical', solde: 9_800 },
  { compte: '218300', libelle: 'Matériel de bureau et informatique', solde: 2_450 },
  { compte: '275000', libelle: 'Dépôts et cautionnements versés', solde: 1_200 },
  { compte: '281540', libelle: 'Amortissements du matériel médical', solde: -4_116 },
  { compte: '281830', libelle: 'Amortissements du matériel de bureau et informatique', solde: -1_102.50 },
  { compte: '401000', libelle: 'Fournisseurs', solde: -640, tiers: 'Fournisseur de matériel médical (fictif)' },
  { compte: '401000', libelle: 'Fournisseurs', solde: 120, tiers: 'Prestataire informatique (fictif) — trop-versé à rembourser par lui' },
  { compte: '411000', libelle: 'Clients', solde: 3_420, tiers: 'Assurance maladie (tiers payant)' },
  { compte: '411000', libelle: 'Clients', solde: 380, tiers: 'Complémentaires santé' },
  { compte: '411000', libelle: 'Clients', solde: -60, tiers: 'Patient (fictif) — trop-perçu à lui rembourser' },
  { compte: '431000', libelle: 'Sécurité sociale (URSSAF)', solde: -1_240 },
  { compte: '437000', libelle: 'Autres organismes sociaux (retraite)', solde: -310 },
  { compte: '444000', libelle: 'État — impôt sur les bénéfices (acomptes supérieurs à l’impôt dû)', solde: 350 },
  { compte: '455000', libelle: 'Associés — comptes courants (gérante)', solde: -6_300 },
  { compte: '486000', libelle: 'Charges constatées d’avance', solde: 420 },
  { compte: '512100', libelle: 'Banque — compte courant', solde: 49_484 },
  { compte: '512200', libelle: 'Banque — second compte (à découvert)', solde: -230.50 },
  { compte: '530000', libelle: 'Caisse', solde: 85 },
  { compte: '606100', libelle: 'Fournitures médicales et petit matériel', solde: 3_100 },
  { compte: '613200', libelle: 'Locations immobilières', solde: 6_000 },
  { compte: '616100', libelle: 'Primes d’assurance', solde: 1_450 },
  { compte: '622600', libelle: 'Honoraires', solde: 2_280 },
  { compte: '625100', libelle: 'Voyages et déplacements', solde: 3_900 },
  { compte: '626000', libelle: 'Frais postaux et de télécommunications', solde: 540 },
  { compte: '627000', libelle: 'Services bancaires', solde: 180 },
  { compte: '635110', libelle: 'Cotisation foncière des entreprises', solde: 410 },
  { compte: '641100', libelle: 'Rémunération de la gérante', solde: 42_000 },
  { compte: '646000', libelle: 'Cotisations sociales personnelles de la gérante', solde: 15_800 },
  { compte: '661100', libelle: 'Intérêts des emprunts', solde: 640 },
  { compte: '681120', libelle: 'Dotations aux amortissements des immobilisations corporelles', solde: 2_030 },
  { compte: '695000', libelle: 'Impôt sur les bénéfices', solde: 2_950 },
  { compte: '706000', libelle: 'Prestations de services', solde: -98_400 },
]
