// Les déclarations FICTIVES du fichier de l'e-reporting (lib/fluxEreporting.ts) : deux dossiers inventés (des SIREN
// valides par leur clé, aucun nom réel), des fiches « hors de France », des factures et des encaissements de
// démonstration, des numéros de TVA de l'Union faits de zéros, des matricules de plateforme inventés (999x). Le contenu de
// chaque déclaration est CALCULÉ par e4 (lib/ereporting.ts) et figé comme e5b1 le fige — `contenuADeclarer`, puis relu
// en JSON comme `jsonb` le rend —, jamais écrit à la main : un exemple est ce que la base garderait. Ils servent aux
// tests du module (fluxEreporting.test.ts), à son garde de copie (fluxEreportingCopie.test.ts), et serviront à celui de
// plateforme-agreee (étape e9).
import { contenuADeclarer, type ContenuDuCalcul } from '../lib/declarationsEreporting'
import {
  declarationDesAchats, declarationDesPaiements, declarationDesVentes, HYPOTHESES_DE_LA_CONCEPTION, type ContexteDeclaration,
  type DeclarationEreporting, type DossierEreporting, type EncaissementLu, type FactureLue, type Lecture, type LigneLue,
  type PartLue, type PieceLue,
} from '../lib/ereporting'
import type { ChoixFrr, DeclarationPourFrr, DonneesFrr, EmetteurFrr } from '../lib/fluxEreporting'
import type { LigneDeRegime } from '../lib/regimesEreporting'
import type { PieceHorsDeFrance, PieceHorsDeFranceTaux } from '../lib/types'

const lu = <T>(lignes: T[]): Lecture<T> => ({ lignes, complete: true, motif: null })
const uuid = (n: number) => `e6a0f000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

// ── Les dossiers ───────────────────────────────────────────────────────────────────────────────────────────────────

export const SIREN_A = '123456782'
export const NOM_A = 'Atelier Démo Conseil'
// Le SIREN fictif du client des factures d'essai (src/test/facturesCii.ts) : un numéro tiré au jugé, valide par sa
// clé, peut être celui d'une entreprise ou d'une collectivité réelle.
export const SIREN_B = '987654324'
// Une esperluette et un tiret long : l'échappement et l'UTF-8 passent par un exemple validé.
export const NOM_B = 'Démo & Fils — Débits'

export const DOSSIER_A: DossierEreporting = {
  id: uuid(0xa), siret: `${SIREN_A}00010`, statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
  tva_periodicite: 'trimestrielle', tva_sur_debits: false,
}
// Un redevable sur option pour la TVA sur les débits : ses factures de services la portent (TT-80).
export const DOSSIER_B: DossierEreporting = { ...DOSSIER_A, id: uuid(0xb), siret: `${SIREN_B}00019`, tva_sur_debits: true }

const REGIME_A: LigneDeRegime = {
  id: uuid(0xa1), dossier_id: DOSSIER_A.id, depuis: '2026-01-01', statut_tva: 'redevable', article_exoneration: null,
  tva_periodicite: 'trimestrielle', tva_sur_debits: false, frequence_transactions: 'mois', frequence_paiements: 'mois', retire_le: null,
}
const REGIME_B: LigneDeRegime = { ...REGIME_A, id: uuid(0xb1), dossier_id: DOSSIER_B.id, tva_sur_debits: true, frequence_paiements: null }

const OCTOBRE = { debut: '2027-10-01', fin: '2027-10-31' }
const NOVEMBRE = { debut: '2027-11-01', fin: '2027-11-30' }
const contexte = (dossier: DossierEreporting, regime: LigneDeRegime, periode: { debut: string; fin: string }, aujourdHui: string): ContexteDeclaration =>
  ({ periode, dossier, regimes: lu([regime]), aujourdHui })

// ── Les achats à des fournisseurs établis hors de France (dossier A, octobre 2027) ─────────────────────────────────

function piece(n: number, o: Partial<PieceLue>): PieceLue {
  return {
    id: uuid(0x100 + n), dossier_id: DOSSIER_A.id, type_piece: 'achat', devise: 'EUR', montant_ttc: null, montant_devise: null,
    montant_tva: null, tiers: 'Fournisseur fictif', date_piece: '2027-10-01', ...o,
  }
}

function fiche(n: number, o: Partial<PieceHorsDeFrance>): PieceHorsDeFrance {
  return {
    id: uuid(0x200 + n), dossier_id: DOSSIER_A.id, piece_id: uuid(0x100 + n), remplace_id: null, numero: `F-${n}`,
    date_facture: '2027-10-01', type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR',
    pays: 'DE', schema_identifiant: '0223', identifiant: 'DE000000000', nature: 'services', autoliquidation: true,
    date_operation: null, periode_debut: null, periode_fin: null, cree_par: 'u1', cree_le: '2027-11-02T09:00:00Z',
    retire_le: null, retire_par: null, ...o,
  }
}

function taux(n: number, o: Partial<PieceHorsDeFranceTaux>): PieceHorsDeFranceTaux {
  return { fiche_id: uuid(0x200 + n), dossier_id: DOSSIER_A.id, code_tva: 'AE', taux: 0, base: 0, tva: 0, motif_code: null, motif_texte: null, ...o }
}

// Cinq factures reçues : un service autoliquidé d'Allemagne, un abonnement en dollars des États-Unis (une période
// facturée), une acquisition de biens en Italie (livrée), l'avoir du fournisseur allemand (sa facture d'origine), une
// formation exonérée en Belgique (son motif).
const ACHATS = [
  {
    piece: piece(1, { montant_ttc: 49, date_piece: '2027-10-05' }),
    fiche: fiche(1, { numero: 'INV-2027-0042', date_facture: '2027-10-05' }),
    taux: [taux(1, { base: 49 })],
  },
  {
    piece: piece(2, { devise: 'USD', montant_devise: 120, montant_ttc: 110.5, date_piece: '2027-10-01' }),
    fiche: fiche(2, {
      numero: 'NDS-1029', date_facture: '2027-10-01', devise: 'USD', pays: 'US', schema_identifiant: '0227',
      identifiant: 'USNuage Demo Softw', periode_debut: '2027-10-01', periode_fin: '2027-10-31',
    }),
    taux: [taux(2, { base: 120 })],
  },
  {
    piece: piece(3, { montant_ttc: 300, date_piece: '2027-10-10' }),
    fiche: fiche(3, {
      numero: 'FT 2027/118', date_facture: '2027-10-10', pays: 'IT', identifiant: 'IT00000000000', nature: 'biens',
      date_operation: '2027-10-12',
    }),
    taux: [taux(3, { code_tva: 'K', base: 300 })],
  },
  {
    piece: piece(4, { montant_ttc: -9, date_piece: '2027-10-20' }),
    fiche: fiche(4, {
      numero: 'AV-2027-0007', date_facture: '2027-10-20', type_document: '381', facture_origine_numero: 'INV-2027-0042',
      facture_origine_date: '2027-10-05',
    }),
    taux: [taux(4, { base: 9 })],
  },
  {
    piece: piece(5, { montant_ttc: 250, date_piece: '2027-10-25' }),
    fiche: fiche(5, {
      numero: 'BE-FORM-77', date_facture: '2027-10-25', pays: 'BE', identifiant: 'BE0000000000', autoliquidation: false,
    }),
    taux: [taux(5, {
      code_tva: 'E', base: 250, motif_code: 'VATEX-EU-132-1I',
      motif_texte: 'Exonération : enseignement (directive 2006/112/CE, art. 132, 1, i)',
    })],
  },
]

// La facture que la rectificative ajoute : un service autoliquidé de Suisse, en francs.
const ACHAT_RECTIFIE = {
  piece: piece(6, { devise: 'CHF', montant_devise: 80, montant_ttc: 84.2, date_piece: '2027-10-28' }),
  fiche: fiche(6, {
    numero: 'CH-2027-15', date_facture: '2027-10-28', devise: 'CHF', pays: 'CH', schema_identifiant: '0227', identifiant: 'CHMontagne Demo AG',
  }),
  taux: [taux(6, { base: 80 })],
}

function achats(liste: typeof ACHATS): DeclarationEreporting<ContenuDuCalcul> {
  return declarationDesAchats(contexte(DOSSIER_A, REGIME_A, OCTOBRE, '2027-11-05'), {
    pieces: lu(liste.map((a) => a.piece)), fiches: lu(liste.map((a) => a.fiche)), taux: lu(liste.flatMap((a) => a.taux)),
    textes: lu([]), ecarts: lu([]),
  }, { rangement: HYPOTHESES_DE_LA_CONCEPTION.rangement })
}

// ── Les ventes à des particuliers ──────────────────────────────────────────────────────────────────────────────────

function facture(id: string, o: Partial<FactureLue>): FactureLue {
  return {
    id, dossier_id: DOSSIER_A.id, statut: 'validee', type: 'facture', date_emission: '2027-10-04', montant_ht: 0, montant_tva: 0,
    montant_ttc: 0, type_client: 'non_assujetti', nature_operation: 'services', option_debits: false, date_prestation: null,
    periode_fin: null, ...o,
  }
}

const ligne = (factureId: string, ordre: number, designation: string, quantite: number, prix: number, t: number): LigneLue =>
  ({ facture_id: factureId, ordre, designation, quantite, prix_unitaire_ht: prix, taux_tva: t })

const FV1 = uuid(0x301)
const FV2 = uuid(0x302)
const FV3 = uuid(0x303)
const AV1 = uuid(0x304)
const FV5 = uuid(0x305)
// Le 4 : une séance (services, 20 %) et des biens (5,5 % et 20 %) ; le 11 : un atelier (services, 10 %) ; le 18 :
// l'avoir de la séance, qui rend négatives les ventes de services du jour.
const FACTURES_A = [
  facture(FV1, { montant_ht: 100, montant_tva: 20, montant_ttc: 120 }),
  facture(FV2, { nature_operation: 'biens', montant_ht: 80, montant_tva: 11.65, montant_ttc: 91.65 }),
  facture(FV3, { date_emission: '2027-10-11', montant_ht: 200, montant_tva: 20, montant_ttc: 220 }),
  facture(AV1, { type: 'avoir', date_emission: '2027-10-18', montant_ht: -100, montant_tva: -20, montant_ttc: -120 }),
  facture(FV5, { date_emission: '2027-11-02', montant_ht: 50, montant_tva: 10, montant_ttc: 60 }),
]
const LIGNES_A = [
  ligne(FV1, 0, 'Séance individuelle', 1, 100, 20),
  ligne(FV2, 0, 'Livre', 2, 15, 5.5),
  ligne(FV2, 1, 'Coffret', 1, 50, 20),
  ligne(FV3, 0, 'Atelier collectif', 1, 200, 10),
  ligne(AV1, 0, 'Séance individuelle', -1, 100, 20),
  ligne(FV5, 0, 'Séance individuelle', 1, 50, 20),
]

const FB1 = uuid(0x401)
const FB2 = uuid(0x402)
const FACTURES_B = [
  facture(FB1, { dossier_id: DOSSIER_B.id, date_emission: '2027-10-06', option_debits: true, montant_ht: 300, montant_tva: 60, montant_ttc: 360 }),
  facture(FB2, { dossier_id: DOSSIER_B.id, date_emission: '2027-10-06', nature_operation: 'biens', montant_ht: 40, montant_tva: 2.2, montant_ttc: 42.2 }),
]
const LIGNES_B = [ligne(FB1, 0, 'Conseil', 1, 300, 20), ligne(FB2, 0, 'Guide imprimé', 1, 40, 5.5)]

// ── Les paiements de ces ventes ────────────────────────────────────────────────────────────────────────────────────

const encaissement = (n: number, factureId: string, date: string, montant: number, annuleId: string | null = null): EncaissementLu =>
  ({ id: uuid(0x500 + n), dossier_id: DOSSIER_A.id, facture_id: factureId, date_encaissement: date, montant, annule_id: annuleId, retire_le: null })
const part = (n: number, t: number, montant: number): PartLue => ({ encaissement_id: uuid(0x500 + n), dossier_id: DOSSIER_A.id, taux: t, montant })

// Octobre : la séance et l'atelier le 15, le solde de l'atelier le 22 ; les biens, payés le 15, n'entrent pas (leur
// TVA est due à la livraison). Novembre : la séance d'octobre contre-passée le 3 (un chèque revenu), une autre séance
// payée le même jour — un jour négatif.
const ENCAISSEMENTS = [
  encaissement(1, FV1, '2027-10-15', 120),
  encaissement(2, FV3, '2027-10-15', 100),
  encaissement(3, FV3, '2027-10-22', 120),
  encaissement(4, FV2, '2027-10-15', 91.65),
  encaissement(5, FV1, '2027-11-03', -120, uuid(0x501)),
  encaissement(6, FV5, '2027-11-03', 60),
]
const PARTS = [part(1, 20, 120), part(2, 10, 100), part(3, 10, 120), part(4, 5.5, 31.65), part(4, 20, 60), part(5, 20, -120), part(6, 20, 60)]

// ── Les déclarations figées ────────────────────────────────────────────────────────────────────────────────────────

/** Le contenu qu'e5b1 fige d'une déclaration calculée par e4, tel que `jsonb` le rend ; lève si e4 ne la dit pas « à
 * déclarer » sans refus — un exemple ne se fige que s'il se déclarerait. */
function fige(d: DeclarationEreporting<ContenuDuCalcul>): Record<string, unknown> {
  if (d.etat !== 'a_declarer' || d.refus.length > 0) {
    throw new Error(`exemple qui ne se déclarerait pas (${d.objet}) : ${d.etat} — ${d.refus.map((r) => r.cle).join(', ')}`)
  }
  return JSON.parse(JSON.stringify(contenuADeclarer(d))) as Record<string, unknown>
}

export const ID_ACHATS = uuid(0xf01)
export const ID_ACHATS_RECTIFIES = uuid(0xf02)

function declaration(id: string, objet: string, periode: { debut: string; fin: string }, contenu: Record<string, unknown>,
  o: Partial<DeclarationPourFrr> = {}): DeclarationPourFrr {
  return {
    id, objet, periode_debut: periode.debut, periode_fin: periode.fin, type_transmission: 'IN', remplace_id: null,
    etat: 'declaree', contenu, ...o,
  }
}

export const DECLARATION_ACHATS = declaration(ID_ACHATS, 'achats', OCTOBRE, fige(achats(ACHATS)))
export const DECLARATION_ACHATS_RECTIFIES = declaration(ID_ACHATS_RECTIFIES, 'achats', OCTOBRE, fige(achats([...ACHATS, ACHAT_RECTIFIE])),
  { type_transmission: 'RE', remplace_id: ID_ACHATS })
export const DECLARATION_VENTES = declaration(uuid(0xf03), 'ventes', OCTOBRE, fige(declarationDesVentes(
  contexte(DOSSIER_A, REGIME_A, OCTOBRE, '2027-11-05'), { factures: lu(FACTURES_A), lignes: lu(LIGNES_A) },
  { rangement: HYPOTHESES_DE_LA_CONCEPTION.rangement },
)))
export const DECLARATION_VENTES_DEBITS = declaration(uuid(0xf04), 'ventes', OCTOBRE, fige(declarationDesVentes(
  contexte(DOSSIER_B, REGIME_B, OCTOBRE, '2027-11-05'), { factures: lu(FACTURES_B), lignes: lu(LIGNES_B) },
  { rangement: HYPOTHESES_DE_LA_CONCEPTION.rangement },
)))
export const DECLARATION_PAIEMENTS = declaration(uuid(0xf05), 'paiements', OCTOBRE, fige(declarationDesPaiements(
  contexte(DOSSIER_A, REGIME_A, OCTOBRE, '2027-11-05'),
  { factures: lu(FACTURES_A), encaissements: lu(ENCAISSEMENTS), parts: lu(PARTS) },
  { contrePassation: HYPOTHESES_DE_LA_CONCEPTION.contrePassation },
)))
export const DECLARATION_PAIEMENTS_CONTRE_PASSATION = declaration(uuid(0xf06), 'paiements', NOVEMBRE, fige(declarationDesPaiements(
  contexte(DOSSIER_A, REGIME_A, NOVEMBRE, '2027-12-03'),
  { factures: lu(FACTURES_A), encaissements: lu(ENCAISSEMENTS), parts: lu(PARTS) },
  { contrePassation: HYPOTHESES_DE_LA_CONCEPTION.contrePassation },
)))

// ── Les choix ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const MATRICULE_PLATEFORME_FRR = '9991'
export const PLATEFORME_FRR: EmetteurFrr = { identifiant: MATRICULE_PLATEFORME_FRR, schema: '0238', nom: 'Plateforme Fictive', role: 'WK' }
export const DECLARANT_A_EMETTEUR: EmetteurFrr = { identifiant: SIREN_A, schema: '0002', nom: NOM_A, role: 'SE' }

export function choixFrr(o: Partial<ChoixFrr> = {}): ChoixFrr {
  return { emetteur: PLATEFORME_FRR, fuseau: 'Europe/Paris', codeOptionDebits: '5', paiementsNegatifs: 'ecrits_avec_leur_signe', ...o }
}

// Le 05/11/2027 à 9 h 30 à Paris (8 h 30 UTC) : la période d'octobre est finie.
export const CINQ_NOVEMBRE = new Date('2027-11-05T08:30:00Z')
// Le 03/12/2027 à 10 h à Paris : celle de novembre l'est aussi.
export const TROIS_DECEMBRE = new Date('2027-12-03T09:00:00Z')

/** Une déclaration d'achats d'octobre du dossier A, prête à écrire ; chaque champ se remplace. */
export function donneesFrr(o: Partial<DonneesFrr> = {}): DonneesFrr {
  return { declaration: DECLARATION_ACHATS, nomDuDeclarant: NOM_A, maintenant: CINQ_NOVEMBRE, choix: choixFrr(), ...o }
}

// ── Les exemples figés dans outils/facturation/ereporting/exemples/ ────────────────────────────────────────────────

export interface ExempleFrr {
  nom: string
  donnees: DonneesFrr
}

export const EXEMPLES_FRR: ExempleFrr[] = [
  { nom: 'achats', donnees: donneesFrr() },
  { nom: 'achats-rectificative', donnees: donneesFrr({ declaration: DECLARATION_ACHATS_RECTIFIES }) },
  { nom: 'ventes', donnees: donneesFrr({ declaration: DECLARATION_VENTES }) },
  { nom: 'ventes-option-debits', donnees: donneesFrr({ declaration: DECLARATION_VENTES_DEBITS, nomDuDeclarant: NOM_B }) },
  {
    nom: 'paiements',
    donnees: donneesFrr({ declaration: DECLARATION_PAIEMENTS, choix: choixFrr({ emetteur: DECLARANT_A_EMETTEUR, fuseau: 'UTC' }) }),
  },
  { nom: 'paiements-contre-passation', donnees: donneesFrr({ declaration: DECLARATION_PAIEMENTS_CONTRE_PASSATION, maintenant: TROIS_DECEMBRE }) },
]
