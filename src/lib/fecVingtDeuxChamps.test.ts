import { describe, expect, it } from 'vitest'
import { anomaliesBnc, anomaliesDgfip, colonnes, desequilibresDgfip, ENTETES_BNC_ATTENDUS, structureBncDgfip } from '../test/fecDgfip'
import { brouillonDesVentes, composition, ligneBancaire, pieceDeVente, sourcesDuDossierBascule } from '../test/dossierBascule'
import { NON_VALIDEE, A_NOUVEAU_NON_VALIDE } from '../test/ecritures'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { SANS_ECRITURE_DE_VENTE } from '../test/ventesFacturees'
import type { AcquisitionDuBien } from './amortissements'
import { POSTES_RATTACHES } from './cases2035'
import {
  CHAMPS_BNC_EXPORTES, MODES_REGLEMENT, NATURES_OPERATION, SEPARATEUR_DU_POSTE, type ChoixChampsBnc, type EncaissementDuRegistre,
  type FactureDuClient,
} from './champsBncDuFec'
import { OPERATIONS_DE_CAISSE_ABSENTES, type OperationsDeCaisse } from './controlesDeLaCaisse'
import { ecritureDuPaiementPersonnel } from './cotisationPersonnelle'
import { POSTE_COTISATIONS, POSTE_INDEMNITES_KM, POSTE_VENTES_FACTUREES } from './declaration2035'
import { lignesPourPiece } from './ecritures'
import type { ModeleComptable } from './engagement'
import {
  CHAMPS_BNC_NON_EXPORTES, formaterFec, genererFec, numeroterFec, numerotationValidee, type ChampsBncDuFec, type EntreesDesChampsBnc,
} from './fec'
import type { LettrageDeLigne } from './lettrage'
import { ecritureDeLaLiquidation, type DeclarationLiquidable } from './liquidationTva'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces, type PartEncaissee, type PartReglee } from './rattachement'
import type {
  ANouveau, Categorie, CotisationDeclaree, EcritureBrouillon, LigneBancaire, ModeComptable, OperationCaisse, Piece, VentilationBancaire,
} from './types'
import type { EcritureVenteFacturee } from './ecrituresVentesFacturees'

// LE FEC D'UN BNC EN TRÉSORERIE À VINGT-DEUX CHAMPS (lot FEC22c1 ; lib/fec.ts). Ce que ces cas gardent : le drapeau baissé,
// le fichier d'hier ; en engagement, le fichier d'hier, OCTET POUR OCTET, quoi qu'on passe ; levé en trésorerie, l'en-tête du
// VIII, 7° et vingt-deux champs par ligne, chaque sorte d'écriture avec ses quatre valeurs, la scission d'une pièce payée le
// même jour par deux modes ; 200 dossiers tirés d'une graine fixe, jugés aux contrôles de l'outil de la DGFiP et de la
// conception ; aucun nom dans les quatre champs, sur le fichier entier. Toutes les données sont FICTIVES : les noms plantés
// n'appartiennent à personne, les SIREN et SIRET sont fabriqués pour passer (ou non) la clé de Luhn.

const D = 'd1'
const SANS_LETTRAGE: ReadonlyMap<string, LettrageDeLigne> = new Map()
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const VIDES: ChoixChampsBnc = { sansReglement: 'vides' }
const DATE_ECRITURE: ChoixChampsBnc = { sansReglement: 'date_de_l_ecriture' }

// ── Les noms plantés, que les quatre champs ne doivent jamais rendre ──
const NOMS = [
  'Zéphyrin Fictif-Dupré', 'Cabinet Imaginaire Oxalis', 'Mme Ondine Inventée', 'patient-ficelle-0427', 'Kinésithérapie Brumaire',
  'VIR SEPA ZEPHYRIN FICTIF', 'CHQ 4711 ONDINE', 'releve-imaginaire-mars.csv', 'ordonnance-ondine.pdf', 'Motif : Ondine a payé deux fois',
] as const

const SIREN_VALIDE = '123456782'
const SIRET_VALIDE = '12345678200010'
const SIRET_INVALIDE = '12345678200011'

// ── Les catégories : leur LIBELLÉ est un nom planté, leur poste un poste de la 2035 — NatOp ne doit lire que le second ──
const categorie = (id: string, compte: string, poste: string | null, libelle: string, code = id): Categorie => ({
  id, dossier_id: D, code, libelle, ordre: 1, compte_comptable: compte, poste_2035: poste,
})
const CATEGORIES: Categorie[] = [
  categorie('c-achats', '606100', 'Achats', NOMS[4]),
  categorie('c-recettes', '706000', 'Recettes', NOMS[3]),
  categorie('c-bureau', '606400', 'Fournitures de bureau', NOMS[1]),
  categorie('c-divers', '625100', 'Divers', NOMS[0]),
  categorie('c-frais', '627000', 'Frais financiers', NOMS[2], 'frais_bancaires'),
]

// ── Les fabriques, typées Partial<T> => T ──
const ligne = (o: Partial<EcritureBrouillon> & Pick<EcritureBrouillon, 'id' | 'compte' | 'sens' | 'montant' | 'date'>): EcritureBrouillon => ({
  dossier_id: D, piece_id: null, ligne_bancaire_id: null, libelle: NOMS[2], statut: 'proposee', created_at: `${o.date}T12:00:00Z`,
  immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null,
  operation_caisse_id: null, ...NON_VALIDEE, ...o,
})
const mouvement = (o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id' | 'date' | 'montant'>): LigneBancaire => ({
  dossier_id: D, libelle: NOMS[5], libelle_brut: NOMS[6], source_fichier: NOMS[7], statut: 'rapprochee', piece_id: null, cotisation_id: null,
  categorie_id: null, taux_tva: null, prelevement_personnel: false, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
  emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
  created_at: `${o.date}T08:00:00Z`, encaissements_de_factures: false, ...o,
})
const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => pieceDeVente({
  type_piece: 'achat', tiers: NOMS[1], nom_fichier: NOMS[8], date_piece: '2026-03-10', montant_ht: null, montant_tva: null, montant_ttc: 120,
  categorie_id: 'c-achats', created_at: '2026-03-10T09:00:00Z', ...o,
})
// Le nom du client, le motif d'un encaissement : hors des types lus, plantés à côté comme une lecture trop large les rendrait.
type FactureEnTrop = FactureDuClient & { tiers_nom: string }
type EncaissementEnTrop = EncaissementDuRegistre & { motif: string }
const facture = (o: Partial<FactureEnTrop> & Pick<FactureEnTrop, 'id' | 'numero'>): FactureEnTrop => ({
  statut: 'validee', tiers_siret: null, source_de_la_vente: false, tiers_nom: NOMS[0], ...o,
})
const encaissement = (o: Partial<EncaissementEnTrop> & Pick<EncaissementEnTrop, 'id' | 'facture_id' | 'ligne_bancaire_id'>): EncaissementEnTrop => ({
  dossier_id: D, date_encaissement: '2026-03-20', montant: 100, moyen: 'virement', annule_id: null, retire_le: null, motif: NOMS[9], ...o,
})
const aNouveau = (id: string, compte: string, sens: 'debit' | 'credit', montant: number): ANouveau => ({
  id, dossier_id: D, date: '2026-01-01', compte, compte_origine: compte, libelle: NOMS[3], sens, montant, source_nom: NOMS[7],
  source_empreinte: 'a'.repeat(64), created_at: '2026-01-02T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
})
const operation = (o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id' | 'genre' | 'date' | 'montant'>): OperationCaisse => ({
  dossier_id: D, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null,
  cree_le: `${o.date}T18:00:00Z`, cree_par: 'u', retire_le: null, retire_par: null, ...o,
})
const caisseLue = (operations: OperationCaisse[]): OperationsDeCaisse => ({ etat: 'lue', dossierId: D, operations })

// Les lignes d'une pièce telles que la génération les écrit (`lignesPourPiece`), avec un identifiant.
function lignesDeLaPiece(p: Piece, compte: string, immobilisation: boolean, assujetti: boolean, paiements: ReturnType<typeof paiementsDesPieces>) {
  return lignesPourPiece(D, p, { compte, immobilisation }, assujetti, paiements.get(p.id) ?? [], TRESORERIE)
    .map((l, i) => ligne({ ...l, id: `${p.id}-${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null }))
}

interface Jeu {
  brouillon: EcritureBrouillon[]
  pieces: Piece[]
  aNouveaux: ANouveau[]
  mouvements: LigneBancaire[]
  ventes: readonly EcritureVenteFacturee[]
  caisse: OperationsDeCaisse
  entrees: EntreesDesChampsBnc
}

const exportes = (entrees: EntreesDesChampsBnc): ChampsBncDuFec => ({ etat: 'exportes', entrees })
const fec = (j: Jeu, mode: ModeComptable, champs: ChampsBncDuFec) => genererFec(
  j.brouillon, j.pieces, CATEGORIES, j.aNouveaux, mode, j.mouvements, SANS_LETTRAGE, j.ventes, j.caisse, champs,
)
const entreesVides = (o: Partial<EntreesDesChampsBnc>): EntreesDesChampsBnc => ({
  choix: VIDES, paiements: new Map(), registre: [], factures: [], cotisations: [], ventilations: [], acquisitions: new Map(),
  plan: PLAN_PAR_DEFAUT, ...o,
})

// ── UN DOSSIER COMPLET : une écriture de chaque sorte ────────────────────────────────────────────────────────────────

function dossierComplet(choix: ChoixChampsBnc): Jeu {
  const mouvements: LigneBancaire[] = [
    mouvement({ id: 'm-achat', date: '2026-03-20', montant: -120, piece_id: 'p-achat' }),
    mouvement({ id: 'm-vente', date: '2026-04-02', montant: 60, piece_id: 'p-vente' }),
    mouvement({ id: 'm-bien', date: '2026-05-05', montant: -1200, piece_id: 'p-bien' }),
    mouvement({ id: 'm-cpam', date: '2026-03-12', montant: 250, categorie_id: 'c-recettes' }),
    mouvement({ id: 'm-perso', date: '2026-03-25', montant: -500, statut: 'ignoree', prelevement_personnel: true }),
    mouvement({ id: 'm-vent', date: '2026-04-15', montant: 70, ventilee: true }),
    mouvement({ id: 'm-emp', date: '2026-04-05', montant: -150, emprunt_id: 'emp', emprunt_echeance: 3 }),
  ]
  const pieces = [
    piece({ id: 'p-achat', montant_ttc: 120 }),
    piece({ id: 'p-vente', type_piece: 'vente', montant_ttc: 60, categorie_id: 'c-recettes', facture_id: 'f-avant', date_piece: '2026-03-30' }),
    piece({ id: 'p-bien', montant_ttc: 1200, date_piece: '2026-05-01' }),
    piece({ id: 'p-note', type_piece: 'note_frais', montant_ttc: 80, categorie_id: 'c-divers', date_piece: '2026-06-01' }),
  ]
  const paiements = paiementsDesPieces(mouvements, [], [], [])
  const cotisation: CotisationDeclaree = {
    id: 'co1', dossier_id: D, echeance: '2026-03-05', montant_appele: 1000, montant_verse: null, montant_csg_crds: 300,
    previsionnel: false, created_at: '2026-02-01T00:00:00Z', paiement_personnel_le: '2026-03-10',
  }
  const acquisitions = new Map<string, AcquisitionDuBien>([['p-bien', { compte: '218300', motif: null }]])
  const ops = [
    operation({ id: 'op-recette', genre: 'recette', date: '2026-07-03', montant: 65, categorie_id: 'c-recettes', encaissements_du_jour: [] }),
    operation({ id: 'op-apport', genre: 'apport', date: '2026-07-04', montant: 200 }),
  ]
  const brouillon = [
    ...lignesDeLaPiece(pieces[0], '606100', false, false, paiements),
    ...lignesDeLaPiece(pieces[1], '706000', false, false, paiements),
    ...lignesDeLaPiece(pieces[2], '218300', true, false, paiements),
    ...lignesDeLaPiece(pieces[3], '625100', false, false, paiements),
    ligne({ id: 'cpam-1', ligne_bancaire_id: 'm-cpam', compte: '706000', sens: 'credit', montant: 250, date: '2026-03-12' }),
    ligne({ id: 'cpam-2', ligne_bancaire_id: 'm-cpam', compte: '512000', sens: 'debit', montant: 250, date: '2026-03-12' }),
    ligne({ id: 'perso-1', ligne_bancaire_id: 'm-perso', compte: '108000', sens: 'debit', montant: 500, date: '2026-03-25' }),
    ligne({ id: 'perso-2', ligne_bancaire_id: 'm-perso', compte: '512000', sens: 'credit', montant: 500, date: '2026-03-25' }),
    ligne({ id: 'vent-1', ligne_bancaire_id: 'm-vent', compte: '706000', sens: 'credit', montant: 100, date: '2026-04-15' }),
    ligne({ id: 'vent-2', ligne_bancaire_id: 'm-vent', compte: '606400', sens: 'debit', montant: 30, date: '2026-04-15' }),
    ligne({ id: 'vent-3', ligne_bancaire_id: 'm-vent', compte: '512000', sens: 'debit', montant: 70, date: '2026-04-15' }),
    ligne({ id: 'emp-1', ligne_bancaire_id: 'm-emp', compte: '164000', sens: 'debit', montant: 120, date: '2026-04-05' }),
    ligne({ id: 'emp-2', ligne_bancaire_id: 'm-emp', compte: '661100', sens: 'debit', montant: 25, date: '2026-04-05' }),
    ligne({ id: 'emp-3', ligne_bancaire_id: 'm-emp', compte: '616800', sens: 'debit', montant: 5, date: '2026-04-05' }),
    ligne({ id: 'emp-4', ligne_bancaire_id: 'm-emp', compte: '512000', sens: 'credit', montant: 150, date: '2026-04-05' }),
    ligne({ id: 'liq-1', declaration_tva_id: 'q1', compte: '445710', sens: 'debit', montant: 100.4, date: '2026-03-31' }),
    ligne({ id: 'liq-2', declaration_tva_id: 'q1', compte: '445510', sens: 'credit', montant: 100, date: '2026-03-31' }),
    ligne({ id: 'liq-3', declaration_tva_id: 'q1', compte: '758000', sens: 'credit', montant: 0.4, date: '2026-03-31' }),
    ligne({ id: 'dot-1', immobilisation_id: 'i1', compte: '681100', sens: 'debit', montant: 240, date: '2026-12-31' }),
    ligne({ id: 'dot-2', immobilisation_id: 'i1', compte: '281830', sens: 'credit', montant: 240, date: '2026-12-31' }),
    ligne({ id: 'km-1', vehicule_id: 'v1', compte: '625110', sens: 'debit', montant: 300, date: '2026-12-31' }),
    ligne({ id: 'km-2', vehicule_id: 'v1', compte: '108000', sens: 'credit', montant: 300, date: '2026-12-31' }),
    ...ecritureDuPaiementPersonnel(cotisation, TRESORERIE).map((l, i) => ligne({ ...l, id: `perso-co-${i}`, cotisation_id: 'co1', date: '2026-03-10' })),
    ligne({ id: 'cr-1', operation_caisse_id: 'op-recette', compte: '530000', sens: 'debit', montant: 65, date: '2026-07-03' }),
    ligne({ id: 'cr-2', operation_caisse_id: 'op-recette', compte: '706000', sens: 'credit', montant: 65, date: '2026-07-03' }),
    ligne({ id: 'ca-1', operation_caisse_id: 'op-apport', compte: '530000', sens: 'debit', montant: 200, date: '2026-07-04' }),
    ligne({ id: 'ca-2', operation_caisse_id: 'op-apport', compte: '108000', sens: 'credit', montant: 200, date: '2026-07-04' }),
  ]
  return {
    brouillon, pieces, mouvements, ventes: SANS_ECRITURE_DE_VENTE, caisse: caisseLue(ops),
    aNouveaux: [aNouveau('an-1', '512000', 'debit', 1000), aNouveau('an-2', '101000', 'credit', 1000)],
    entrees: entreesVides({
      choix, paiements, acquisitions, cotisations: [cotisation],
      ventilations: [{ ligne_bancaire_id: 'm-vent', categorie_id: 'c-recettes' }, { ligne_bancaire_id: 'm-vent', categorie_id: 'c-bureau' }],
      factures: [facture({ id: 'f-avant', numero: 'F2025-0099', tiers_siret: SIRET_VALIDE })],
    }),
  }
}

// Les quatre champs de chaque ligne, avec son journal et son compte : ce que le fichier imprime.
const quatre = (f: string) => colonnes(f).slice(1).map((r) => [r[0], r[4], r[18], r[19], r[20], r[21]])

describe('le drapeau baissé : le fichier d’hier', () => {
  it('le drapeau est baissé dans ce lot : il attend la migration FEC22b et la réponse de l’expert-comptable (FEC22-E2)', () => {
    expect(CHAMPS_BNC_EXPORTES).toBe(null)
  })

  it('sans les champs, la numérotation n’en porte aucun, et le fichier d’un dossier en trésorerie reste à dix-huit colonnes', () => {
    const j = dossierComplet(VIDES)
    const n = numeroterFec(j.brouillon, j.pieces, CATEGORIES, j.aNouveaux, 'tresorerie', j.mouvements, j.ventes, j.caisse, CHAMPS_BNC_NON_EXPORTES)
    expect(n.champsBnc).toBe('non_calcules')
    expect(n.lignes.every((l) => l.champsBnc === null) && n.aNouveaux.every((a) => a.champsBnc === null)).toBe(true)
    const rows = colonnes(formaterFec(n, SANS_LETTRAGE, 'tresorerie'))
    expect(rows[0]).toEqual(ENTETES_BNC_ATTENDUS.slice(0, 18))
    expect(rows.every((r) => r.length === 18)).toBe(true)
  })
})

describe('en engagement : le fichier d’hier, octet pour octet, quoi qu’on passe', () => {
  it('les entrées des quatre champs ne changent rien au fichier d’un dossier en engagement', () => {
    const j = dossierComplet(DATE_ECRITURE)
    const sans = fec(j, 'engagement', CHAMPS_BNC_NON_EXPORTES)
    expect(fec(j, 'engagement', exportes(j.entrees))).toBe(sans)
    expect(colonnes(sans).every((r) => r.length === 18)).toBe(true)
    expect(numeroterFec(j.brouillon, j.pieces, CATEGORIES, j.aNouveaux, 'engagement', j.mouvements, j.ventes, j.caisse, exportes(j.entrees)).champsBnc)
      .toBe('non_calcules')
  })

  it('et d’un dossier qui a basculé : sa composition en engagement, le même fichier', () => {
    const sources = sourcesDuDossierBascule()
    const c = composition(sources, 'engagement', PLAN_PAR_DEFAUT)
    const brouillon = brouillonDesVentes(c)
    const mouvements = sources.mouvements.map(ligneBancaire)
    const avec = genererFec(brouillon, [], [], [], 'engagement', mouvements, SANS_LETTRAGE, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES,
      exportes(entreesVides({ registre: sources.encaissements, factures: sources.factures.map((f) => facture({ ...f, tiers_siret: SIRET_VALIDE })) })))
    expect(avec).toBe(genererFec(brouillon, [], [], [], 'engagement', mouvements, SANS_LETTRAGE, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES,
      CHAMPS_BNC_NON_EXPORTES))
  })

  it('une numérotation qui porte les champs ne s’écrit pas en engagement : elle se voit', () => {
    const j = dossierComplet(VIDES)
    const n = numeroterFec(j.brouillon, j.pieces, CATEGORIES, j.aNouveaux, 'tresorerie', j.mouvements, j.ventes, j.caisse, exportes(j.entrees))
    expect(() => formaterFec(n, SANS_LETTRAGE, 'engagement')).toThrow(/engagement/)
  })

  it('un exercice relu de ce qui a été figé, sans les quatre champs : dix-huit colonnes, même en trésorerie (FEC22c2)', () => {
    const n = numerotationValidee([], [], '2027-01-15T10:00:00Z')
    expect(n.champsBnc).toBe('non_calcules')
    expect(colonnes(formaterFec(n, SANS_LETTRAGE, 'tresorerie'))[0]).toHaveLength(18)
  })
})

describe('en trésorerie, le drapeau levé : vingt-deux champs, chaque sorte avec ses quatre valeurs', () => {
  it('l’en-tête du VIII, 7°, dans l’ordre, et vingt-deux champs sur chaque ligne', () => {
    const f = fec(dossierComplet(VIDES), 'tresorerie', exportes(dossierComplet(VIDES).entrees))
    expect(structureBncDgfip(f)).toEqual([])
    expect(colonnes(f)[0].slice(18)).toEqual(['DateRglt', 'ModeRglt', 'NatOp', 'IdClient'])
    expect(anomaliesDgfip(f)).toEqual([])
  })

  it('chaque sorte : la date et le mode de son règlement, sa nature et son poste, son client', () => {
    const j = dossierComplet(VIDES)
    const lignes = quatre(fec(j, 'tresorerie', exportes(j.entrees)))
    const de = (journal: string, compte: string, date: string) => lignes.filter((l) => l[0] === journal && l[1] === compte && l[2] === date)
    // Les à-nouveaux : aucun règlement (FEC22-Q1, vides), NatOp sur chaque ligne, jamais un poste.
    expect(lignes.filter((l) => l[0] === 'AN')).toEqual([['AN', '101000', '', '', 'À-nouveaux', ''], ['AN', '512000', '', '', 'À-nouveaux', '']])
    expect(de('AC', '606100', '20260320')).toEqual([['AC', '606100', '20260320', 'Banque', 'Dépense — Achats', '']])
    expect(de('AC', '512000', '20260320')).toEqual([['AC', '512000', '20260320', 'Banque', 'Dépense', '']])
    // L'exemplaire désigné d'une facture qui n'est pas source : le SIREN de son client, jamais son nom.
    expect(de('VE', '706000', '20260402')).toEqual([['VE', '706000', '20260402', 'Banque', 'Recette — Recettes', SIREN_VALIDE]])
    expect(de('AC', '218300', '20260505')).toEqual([['AC', '218300', '20260505', 'Banque', "Acquisition d'immobilisation", '']])
    // La note de frais : la poche de l'exploitant, à la date que la 2035 compte.
    expect(de('AC', '625100', '20260601')).toEqual([['AC', '625100', '20260601', 'Compte personnel', 'Dépense — Divers', '']])
    expect(de('BQ', '706000', '20260312')).toEqual([['BQ', '706000', '20260312', 'Banque', 'Recette — Recettes', '']])
    expect(de('BQ', '108000', '20260325')).toEqual([['BQ', '108000', '20260325', 'Banque', "Prélèvement de l'exploitant", '']])
    // Ventilé : une nature, un poste par ligne — celui de la part dont la catégorie porte le compte de la ligne.
    expect(lignes.filter((l) => l[2] === '20260415').map((l) => [l[1], l[4]])).toEqual([
      ['512000', 'Recette et dépense'], ['606400', 'Recette et dépense — Fournitures de bureau'], ['706000', 'Recette et dépense — Recettes'],
    ])
    // Une échéance d'emprunt : le poste que le moteur de la 2035 donne aux intérêts et à l'assurance, par le rôle du plan.
    expect(lignes.filter((l) => l[2] === '20260405').map((l) => [l[1], l[4]])).toEqual([
      ['164000', "Échéance d'emprunt"], ['616800', "Échéance d'emprunt — Primes d'assurance"],
      ['661100', "Échéance d'emprunt — Frais financiers"], ['512000', "Échéance d'emprunt"],
    ])
    // La liquidation : aucun règlement, l'arrondi sous son poste.
    expect(lignes.filter((l) => l[0] === 'OD' && l[1].startsWith('4') || l[1] === '758000').map((l) => [l[1], l[2], l[3], l[4]])).toEqual([
      ['445710', '', '', 'Liquidation de TVA'], ['445510', '', '', 'Liquidation de TVA'], ['758000', '', '', 'Liquidation de TVA — Gains divers'],
    ])
    expect(lignes.filter((l) => l[1] === '681100')).toEqual([['OD', '681100', '', '', 'Dotation aux amortissements — Amortissements', '']])
    expect(lignes.filter((l) => l[1] === '625110')).toEqual([['OD', '625110', '', '', `Frais de véhicule (barème) — ${POSTE_INDEMNITES_KM}`, '']])
    // Le paiement depuis le compte personnel : la date saisie de ce paiement.
    expect(lignes.filter((l) => l[1] === '646000')).toEqual([['OD', '646000', '20260310', 'Compte personnel', `Cotisation sociale — ${POSTE_COTISATIONS}`, '']])
    expect(de('VE', '706000', '20260703')).toEqual([['VE', '706000', '20260703', 'Espèces', 'Recette — Recettes', '']])
    expect(lignes.filter((l) => l[0] === 'OD' && l[2] === '20260704').map((l) => l[4])).toEqual(["Apport de l'exploitant", "Apport de l'exploitant"])
  })

  it('le choix de FEC22-Q1 dans son second état : la date de l’écriture et « Sans règlement » pour ce qui n’en est pas un', () => {
    const j = dossierComplet(DATE_ECRITURE)
    const lignes = quatre(fec(j, 'tresorerie', exportes(j.entrees)))
    expect(lignes.filter((l) => l[0] === 'AN').map((l) => [l[2], l[3]])).toEqual([['20260101', 'Sans règlement'], ['20260101', 'Sans règlement']])
    expect(lignes.filter((l) => l[1] === '681100').map((l) => [l[2], l[3]])).toEqual([['20261231', 'Sans règlement']])
    // Un règlement garde le sien.
    expect(lignes.filter((l) => l[1] === '606100').map((l) => [l[2], l[3]])).toEqual([['20260320', 'Banque']])
  })

  it('DateRglt se lit du paiement, jamais de la date de l’écriture : un paiement personnel dont l’écriture a été datée autrement', () => {
    const j = dossierComplet(VIDES)
    const desynchronise = { ...j, brouillon: j.brouillon.map((l) => (l.cotisation_id === 'co1' ? { ...l, date: '2026-03-12' } : l)) }
    const lignes = quatre(fec(desynchronise, 'tresorerie', exportes(j.entrees)))
    expect(lignes.filter((l) => l[1] === '646000').map((l) => l[2])).toEqual(['20260310'])
  })

  it('une pièce que la lecture ne rend pas : la nature de ses comptes, aucun règlement, aucun client', () => {
    const j = dossierComplet(VIDES)
    const lignes = quatre(fec({ ...j, pieces: j.pieces.filter((p) => p.id !== 'p-achat') }, 'tresorerie', exportes(j.entrees)))
    expect(lignes.filter((l) => l[1] === '606100')).toEqual([['AC', '606100', '', '', 'Dépense', '']])
  })

  it('les ventes facturées d’un dossier qui a basculé : la TVA due, l’encaissement, la remise', () => {
    // La facture F2025-0001 sur les débits : sa TVA est due à sa date, avant l'encaissement — l'écriture de la facture.
    const base = sourcesDuDossierBascule()
    const sources = { ...base, factures: base.factures.map((f) => (f.id === 'f1' ? { ...f, option_debits: true } : f)) }
    const c = composition(sources, 'tresorerie', PLAN_PAR_DEFAUT)
    const factures = sources.factures.map((f) => facture({ ...f, tiers_siret: f.id === 'f2' ? SIRET_VALIDE : SIRET_INVALIDE, tiers_nom: NOMS[0] }))
    const f = genererFec(brouillonDesVentes(c), [], CATEGORIES, [], 'tresorerie', sources.mouvements.map(ligneBancaire), SANS_LETTRAGE,
      c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, exportes(entreesVides({ registre: sources.encaissements, factures })))
    expect(structureBncDgfip(f)).toEqual([])
    expect(anomaliesDgfip(f)).toEqual([])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(anomaliesBnc(f, new Set([...sources.factures.map((x) => x.numero!), SIREN_VALIDE]))).toEqual([])
    const rows = colonnes(f).slice(1)
    const ecritures = (piece: string) => [...new Set(rows.filter((r) => r[8] === piece)
      .map((r) => `${r[0]} ${r[18]} ${r[19]} ${r[20].split(SEPARATEUR_DU_POSTE)[0]} ${r[21]}`))]
    // F2025-0001, son SIRET invalide : son numéro, sur la TVA due (sans règlement, FEC22-Q1) comme sur son encaissement.
    expect(ecritures('F2025-0001')).toEqual(['VE   TVA due sur facture F2025-0001', 'VE 20251120 Virement Recette F2025-0001'])
    // F2025-0002 : le SIREN de son client, encaissée par un chèque remis le 21/11.
    expect(ecritures('F2025-0002')).toEqual(['VE 20251121 Chèque Recette 123456782'])
    // Le crédit d'une remise de chèques : « Chèque », « Remise en banque », aucun client — un bordereau en porte plusieurs.
    expect(new Set(rows.filter((r) => r[0] === 'BQ').map((r) => r.slice(18).join('|')))).toEqual(new Set(['20251122|Chèque|Remise en banque|']))
    expect(new Set(rows.filter((r) => r[4] === '706000').map((r) => r[20]))).toEqual(new Set([`Recette — ${POSTE_VENTES_FACTUREES}`]))
  })
})

// ── LA SCISSION : une pièce payée le même jour par deux modes fait deux écritures ──────────────────────────────────────

// Ce que le fichier porte par compte, date et sens, en centimes : ce que la scission ne doit pas changer.
function totaux(f: string): Map<string, number> {
  const t = new Map<string, number>()
  for (const r of colonnes(f).slice(1)) {
    const cle = `${r[4]}|${r[3]}`
    t.set(cle, (t.get(cle) ?? 0) + Math.round(Number(r[11].replace(',', '.')) * 100) - Math.round(Number(r[12].replace(',', '.')) * 100))
  }
  return t
}

describe('la scission d’une pièce payée le même jour par deux modes', () => {
  function noteRembourseeLeJourMeme(assujetti: boolean): Jeu {
    const note = piece({
      id: 'p-note', type_piece: 'note_frais', date_piece: '2026-06-01', montant_ttc: 120, categorie_id: 'c-divers',
      ...(assujetti ? { montant_ht: 100, montant_tva: 20 } : {}),
    })
    const mouvements = [mouvement({ id: 'm-remb', date: '2026-06-01', montant: -50, piece_id: 'p-note' })]
    const paiements = paiementsDesPieces(mouvements, [], [], [])
    return {
      brouillon: lignesDeLaPiece(note, '625100', false, assujetti, paiements), pieces: [note], aNouveaux: [], mouvements,
      ventes: SANS_ECRITURE_DE_VENTE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, entrees: entreesVides({ paiements }),
    }
  }

  // Une note de frais de `ttc` (dont `tva`, assujetti), remboursée le jour même par un virement par montant de `remboursements`.
  function note(ttc: number, tva: number | null, remboursements: readonly number[]): Jeu {
    const p = piece({
      id: 'p-note', type_piece: 'note_frais', date_piece: '2026-06-01', montant_ttc: ttc, categorie_id: 'c-divers',
      ...(tva === null ? {} : { montant_ht: Math.round((ttc - tva) * 100) / 100, montant_tva: tva }),
    })
    const mouvements = remboursements.map((m, i) => mouvement({ id: `m-remb-${i}`, date: '2026-06-01', montant: -m, piece_id: 'p-note' }))
    const paiements = paiementsDesPieces(mouvements, [], [], [])
    return {
      brouillon: lignesDeLaPiece(p, '625100', false, tva !== null, paiements), pieces: [p], aNouveaux: [], mouvements,
      ventes: SANS_ECRITURE_DE_VENTE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, entrees: entreesVides({ paiements }),
    }
  }

  it('la TVA d’un règlement complète sa charge : réparties chacune de son côté, deux demi-centimes ne tomberaient plus juste', () => {
    // 20 € TTC, dont 3,33 € de TVA, 10 € remboursés le jour même : la moitié de 16,67 et la moitié de 3,33 s'arrondissent
    // toutes deux vers le haut (8,34 et 1,67), 10,01 face à 10,00 de banque. Le TTC d'abord, la TVA en complément : 8,34 et 1,66.
    const j = note(20, 3.33, [10])
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(colonnes(f).slice(1).filter((r) => r[2] === 'AC00001').map((r) => [r[4], r[11], r[12]])).toEqual([
      ['445660', '1,66', '0,00'], ['625100', '8,34', '0,00'], ['512000', '0,00', '10,00'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(totaux(f)).toEqual(totaux(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)))
  })

  it('deux virements du jour même et la poche de l’exploitant : la part de la banque est celle des deux virements', () => {
    const j = note(120, null, [30, 20])
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12], r[19]])).toEqual([
      ['AC00001', '625100', '50,00', '0,00', 'Banque'], ['AC00001', '512000', '0,00', '30,00', 'Banque'],
      ['AC00001', '512000', '0,00', '20,00', 'Banque'],
      ['AC00002', '625100', '70,00', '0,00', 'Compte personnel'], ['AC00002', '108000', '0,00', '70,00', 'Compte personnel'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
  })

  it('une note de frais remboursée en partie par un virement du jour même : la banque, puis la poche de l’exploitant', () => {
    const j = noteRembourseeLeJourMeme(false)
    // Une seule écriture au brouillon : la charge de 120 €, la banque de 50 €, l'exploitant de 70 €, le même jour.
    expect(j.brouillon.map((l) => [l.compte, l.sens, l.montant])).toEqual([['625100', 'debit', 120], ['512000', 'credit', 50], ['108000', 'credit', 70]])
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12], r[18], r[19], r[20]])).toEqual([
      ['AC00001', '625100', '50,00', '0,00', '20260601', 'Banque', 'Dépense — Divers'],
      ['AC00001', '512000', '0,00', '50,00', '20260601', 'Banque', 'Dépense'],
      ['AC00002', '625100', '70,00', '0,00', '20260601', 'Compte personnel', 'Dépense — Divers'],
      ['AC00002', '108000', '0,00', '70,00', '20260601', 'Compte personnel', 'Dépense'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(anomaliesDgfip(f)).toEqual([])
    expect(anomaliesBnc(f, new Set())).toEqual([])
    // Le total de la date, par compte, est celui du fichier d'hier : la balance et la 2035 n'y voient rien.
    expect(totaux(f)).toEqual(totaux(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)))
  })

  it('assujetti : la charge et sa TVA se sous-répartissent ensemble, chaque écriture tombe juste face à son règlement', () => {
    const j = noteRembourseeLeJourMeme(true)
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    const rows = colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12]])
    // 120 € TTC, dont 20 € de TVA : 50 € remboursés par la banque, 70 € de la poche de l'exploitant. Le TTC d'abord (50,00 et
    // 70,00), puis la charge (41,67 et 58,33), la TVA complétant chacun : 8,33 et 11,67 — 20,00 en tout, comme hier.
    expect(rows).toEqual([
      ['AC00001', '445660', '8,33', '0,00'], ['AC00001', '625100', '41,67', '0,00'], ['AC00001', '512000', '0,00', '50,00'],
      ['AC00002', '445660', '11,67', '0,00'], ['AC00002', '625100', '58,33', '0,00'], ['AC00002', '108000', '0,00', '70,00'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(totaux(f)).toEqual(totaux(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)))
  })

  it('une pièce de vente payée le même jour par un rapprochement et un virement mixte : deux écritures, le même client', () => {
    const vente = piece({ id: 'p-v', type_piece: 'vente', montant_ttc: 300, categorie_id: 'c-recettes', facture_id: 'f-avant', date_piece: '2026-02-01' })
    const mouvements = [
      mouvement({ id: 'm-a', date: '2026-02-03', montant: 100, piece_id: 'p-v' }),
      mouvement({ id: 'm-b', date: '2026-02-03', montant: 450, encaissements_de_factures: true }),
    ]
    const encaissees: PartEncaissee[] = [{ ligne_bancaire_id: 'm-b', piece_id: 'p-v', montant: 200 }]
    const paiements = paiementsDesPieces(mouvements, [], encaissees, [])
    const j: Jeu = {
      brouillon: lignesDeLaPiece(vente, '706000', false, false, paiements), pieces: [vente], aNouveaux: [], mouvements,
      ventes: SANS_ECRITURE_DE_VENTE, caisse: OPERATIONS_DE_CAISSE_ABSENTES,
      entrees: entreesVides({
        paiements, factures: [facture({ id: 'f-avant', numero: 'F2025-0102' })],
        registre: [encaissement({ id: 'e-b', facture_id: 'f-avant', ligne_bancaire_id: 'm-b', moyen: 'cheque', montant: 200 })],
      }),
    }
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12], r[19], r[21]])).toEqual([
      ['VE00001', '512000', '100,00', '0,00', 'Banque', 'F2025-0102'],
      ['VE00001', '706000', '0,00', '100,00', 'Banque', 'F2025-0102'],
      ['VE00002', '512000', '200,00', '0,00', 'Chèque', 'F2025-0102'],
      ['VE00002', '706000', '0,00', '200,00', 'Chèque', 'F2025-0102'],
    ])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(totaux(f)).toEqual(totaux(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)))
  })

  it('une pièce payée en partie le jour même de sa facture : le règlement, puis le reste sans règlement — seul ce reste est déséquilibré', () => {
    const p = piece({ id: 'p-part', date_piece: '2026-03-20', montant_ttc: 120 })
    const mouvements = [mouvement({ id: 'm-part', date: '2026-03-20', montant: -40, piece_id: 'p-part' })]
    const paiements = paiementsDesPieces(mouvements, [], [], [])
    const j: Jeu = {
      brouillon: lignesDeLaPiece(p, '606100', false, false, paiements), pieces: [p], aNouveaux: [], mouvements,
      ventes: SANS_ECRITURE_DE_VENTE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, entrees: entreesVides({ paiements }),
    }
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(colonnes(f).slice(1).map((r) => [r[2], r[4], r[11], r[12], r[18], r[19]])).toEqual([
      ['AC00001', '606100', '40,00', '0,00', '20260320', 'Banque'],
      ['AC00001', '512000', '0,00', '40,00', '20260320', 'Banque'],
      ['AC00002', '606100', '80,00', '0,00', '', ''],
    ])
    // Le fichier d'hier la portait déséquilibrée en une écriture : la scission n'en crée pas d'autre.
    expect(desequilibresDgfip(f)).toEqual(['AC00002'])
    expect(desequilibresDgfip(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES))).toEqual(['AC00001'])
  })

  it('deux mouvements du relevé le même jour ne font qu’un mode : aucune scission', () => {
    const p = piece({ id: 'p-deux', date_piece: '2026-03-01', montant_ttc: 120 })
    const mouvements = [
      mouvement({ id: 'm-1', date: '2026-03-20', montant: -70, piece_id: 'p-deux' }),
      mouvement({ id: 'm-2', date: '2026-03-20', montant: -30, reglement_groupe: true }),
    ]
    const parts: PartReglee[] = [{ ligne_bancaire_id: 'm-2', piece_id: 'p-deux', montant: -50 }]
    const paiements = paiementsDesPieces(mouvements, parts, [], [])
    const j: Jeu = {
      brouillon: lignesDeLaPiece(p, '606100', false, false, paiements), pieces: [p], aNouveaux: [], mouvements,
      ventes: SANS_ECRITURE_DE_VENTE, caisse: OPERATIONS_DE_CAISSE_ABSENTES, entrees: entreesVides({ paiements }),
    }
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(new Set(colonnes(f).slice(1).map((r) => r[2]))).toEqual(new Set(['AC00001']))
    expect(colonnes(f).slice(1).map((r) => r.slice(0, 18))).toEqual(colonnes(fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)).slice(1))
  })

  it('le fichier ne dépend pas de l’ordre de la lecture, et la scission ne touche pas au brouillon', () => {
    const j = noteRembourseeLeJourMeme(true)
    const avant = JSON.stringify(j.brouillon)
    const f = fec(j, 'tresorerie', exportes(j.entrees))
    expect(fec({ ...j, brouillon: [...j.brouillon].reverse() }, 'tresorerie', exportes(j.entrees))).toBe(f)
    expect(JSON.stringify(j.brouillon)).toBe(avant)
  })
})

// ── 200 DOSSIERS TIRÉS ─────────────────────────────────────────────────────────────────────────────────────────────────

interface JeuTire extends Jeu { identifiants: Set<string> }

function dossierTire(suivant: () => number, n: number): JeuTire {
  const parmi = <T>(liste: readonly T[]): T => liste[entierTire(suivant, liste.length)]
  const oui = (p: number) => suivant() < p
  const nom = () => parmi(NOMS)
  const centimes = (min: number, max: number) => min + entierTire(suivant, max - min)
  const jour = () => `2026-${String(1 + entierTire(suivant, 12)).padStart(2, '0')}-${String(1 + entierTire(suivant, 28)).padStart(2, '0')}`
  const assujetti = oui(0.4)
  const pieces: Piece[] = []
  const mouvements: LigneBancaire[] = []
  const parts: PartReglee[] = []
  const encaissees: PartEncaissee[] = []
  const registre: EncaissementEnTrop[] = []
  const factures: FactureEnTrop[] = []
  const acquisitions = new Map<string, AcquisitionDuBien>()
  const cibles = new Map<string, { compte: string; immobilisation: boolean }>()
  const identifiants = new Set<string>()
  const brouillon: EcritureBrouillon[] = []
  const ventilations: Pick<VentilationBancaire, 'ligne_bancaire_id' | 'categorie_id'>[] = []
  const cotisations: CotisationDeclaree[] = []
  const ops: OperationCaisse[] = []
  let k = 0
  const id = (p: string) => `${p}-${n}-${++k}`
  const facturePour = (): FactureEnTrop => {
    const siret = parmi([SIRET_VALIDE, SIRET_INVALIDE, null])
    const f = facture({ id: id('f'), numero: `F2025-${String(k).padStart(4, '0')}`, tiers_siret: siret, tiers_nom: nom() })
    factures.push(f)
    identifiants.add(f.numero!)
    if (siret === SIRET_VALIDE) identifiants.add(SIREN_VALIDE)
    return f
  }

  // Les pièces, chacune d'une sorte de paiement, montants entiers en centimes.
  for (let i = 0, nb = 1 + entierTire(suivant, 6); i < nb; i++) {
    const sorte = entierTire(suivant, 10)
    const ttc = centimes(1000, 60000) / 100
    const date = jour()
    const tva = assujetti && oui(0.5) ? { montant_ht: Math.round((ttc / 1.2) * 100) / 100 } : null
    const montants = tva ? { montant_ht: tva.montant_ht, montant_tva: Math.round((ttc - tva.montant_ht) * 100) / 100 } : {}
    const pid = id('p')
    const vente = sorte === 6 || sorte === 7 || sorte === 9
    const note = sorte === 3 || sorte === 4 || sorte === 5
    const f = sorte === 6 || sorte === 7 ? facturePour() : null
    const p = piece({
      id: pid, type_piece: vente ? 'vente' : note ? 'note_frais' : 'achat', montant_ttc: ttc, date_piece: date, tiers: nom(), nom_fichier: nom(),
      categorie_id: vente ? 'c-recettes' : note ? 'c-divers' : parmi(['c-achats', 'c-bureau']), facture_id: f?.id ?? null, ...montants,
    })
    pieces.push(p)
    const signe = vente ? 1 : -1
    const rapprocher = (montant: number, d: string) => mouvements.push(mouvement({
      id: id('m'), date: d, montant: signe * montant, piece_id: pid, libelle: nom(), libelle_brut: nom(), source_fichier: nom(),
    }))
    if (sorte === 0 || sorte === 6 || sorte === 9) rapprocher(ttc, oui(0.5) ? date : jour())
    if (sorte === 1) {
      const premier = centimes(100, Math.round(ttc * 100) - 100) / 100
      rapprocher(premier, '2026-01-15')
      rapprocher(Math.round((ttc - premier) * 100) / 100, '2026-11-15')
    }
    if (sorte === 2) {
      const m = id('m')
      mouvements.push(mouvement({ id: m, date: jour(), montant: -(ttc + 10), reglement_groupe: true, libelle: nom() }))
      parts.push({ ligne_bancaire_id: m, piece_id: pid, montant: -ttc })
    }
    // 3 : une note de frais que rien ne rembourse. 4 : remboursée en partie le jour de la note. 5 : un autre jour. En partie,
    // au-delà de l'écart que la banque couvre (`seuilAlignement`, 5 € au plus) : en deçà, la note serait réglée par la banque,
    // sans part de l'exploitant — et son écriture, d'hier comme d'aujourd'hui, déséquilibrée de cet écart.
    if (sorte === 4 || sorte === 5) rapprocher(centimes(100, Math.round(ttc * 100) - 600) / 100, sorte === 4 ? date : '2026-12-20')
    if (sorte === 7) {
      // Le même jour : une part rapprochée, le reste par un virement mixte d'un moyen tiré.
      const premiere = centimes(100, Math.round(ttc * 100) - 100) / 100
      const reste = Math.round((ttc - premiere) * 100) / 100
      rapprocher(premiere, date)
      const m = id('m')
      mouvements.push(mouvement({ id: m, date, montant: reste + 100, encaissements_de_factures: true, libelle: nom() }))
      encaissees.push({ ligne_bancaire_id: m, piece_id: pid, montant: reste })
      registre.push(encaissement({
        id: id('e'), facture_id: f!.id, ligne_bancaire_id: m, montant: reste, date_encaissement: date, motif: nom(),
        moyen: parmi(['virement', 'cheque', 'carte', 'especes', 'effet', 'autre'] as const),
      }))
    }
    if (sorte === 8) {
      acquisitions.set(pid, { compte: '218300', motif: null })
      rapprocher(ttc, jour())
    }
    cibles.set(pid, sorte === 8 ? { compte: '218300', immobilisation: true }
      : { compte: CATEGORIES.find((c) => c.id === p.categorie_id)!.compte_comptable!, immobilisation: false })
  }
  const paiements = paiementsDesPieces(mouvements, parts, encaissees, [])
  for (const p of pieces) {
    const c = cibles.get(p.id)!
    brouillon.push(...lignesDeLaPiece(p, c.compte, c.immobilisation, assujetti, paiements))
  }

  // Les mouvements que le relevé justifie, chacun d'un lien tiré.
  for (let i = 0, nb = entierTire(suivant, 6); i < nb; i++) {
    const m = id('r')
    const date = jour()
    const montant = centimes(500, 90000) / 100
    const l = (compte: string, sens: 'debit' | 'credit', mt: number) =>
      brouillon.push(ligne({ id: id('l'), ligne_bancaire_id: m, compte, sens, montant: mt, date, libelle: nom() }))
    const sorte = entierTire(suivant, 8)
    if (sorte === 0) {
      const cat = parmi(CATEGORIES)
      const credit = cat.compte_comptable!.startsWith('7')
      mouvements.push(mouvement({ id: m, date, montant: credit ? montant : -montant, categorie_id: cat.id, libelle: nom() }))
      l(cat.compte_comptable!, credit ? 'credit' : 'debit', montant)
      l('512000', credit ? 'debit' : 'credit', montant)
    } else if (sorte === 1) {
      const depense = Math.round(montant * 40) / 100
      mouvements.push(mouvement({ id: m, date, montant: Math.round((montant - depense) * 100) / 100, ventilee: true, libelle: nom() }))
      ventilations.push({ ligne_bancaire_id: m, categorie_id: 'c-recettes' }, { ligne_bancaire_id: m, categorie_id: 'c-bureau' })
      l('706000', 'credit', montant)
      l('606400', 'debit', depense)
      l('512000', 'debit', Math.round((montant - depense) * 100) / 100)
    } else if (sorte === 2) {
      const credit = oui(0.5)
      mouvements.push(mouvement({ id: m, date, montant: credit ? montant : -montant, statut: 'ignoree', prelevement_personnel: true }))
      l('108000', credit ? 'credit' : 'debit', montant)
      l('512000', credit ? 'debit' : 'credit', montant)
    } else if (sorte === 3) {
      if (oui(0.5)) {
        mouvements.push(mouvement({ id: m, date, montant: -150, emprunt_id: 'emp', emprunt_echeance: 3 }))
        l('164000', 'debit', 120)
        l('661100', 'debit', 25)
        l('616800', 'debit', 5)
        l('512000', 'credit', 150)
      } else {
        mouvements.push(mouvement({ id: m, date, montant, emprunt_id: 'emp' }))
        l('512000', 'debit', montant)
        l('164000', 'credit', montant)
      }
    } else if (sorte === 4) {
      mouvements.push(mouvement({ id: m, date, montant: -montant, cotisation_id: id('co') }))
      l('646000', 'debit', montant)
      l('512000', 'credit', montant)
    } else if (sorte === 5) {
      const credit = oui(0.5)
      const compte = parmi(['530000', '275000'])
      mouvements.push(mouvement({ id: m, date, montant: credit ? montant : -montant, compte_bilan: compte }))
      l(compte, credit ? 'credit' : 'debit', montant)
      l('512000', credit ? 'debit' : 'credit', montant)
    } else if (sorte === 6) {
      const credit = oui(0.3)
      mouvements.push(mouvement({ id: m, date, montant: credit ? montant : -montant, declaration_tva_id: id('dt') }))
      l(credit ? '445830' : '445510', credit ? 'credit' : 'debit', montant)
      l('512000', credit ? 'debit' : 'credit', montant)
    } else {
      // Un mouvement d'une pièce qui n'est plus rapproché : ses lignes, sans pièce, restent hors du fichier.
      mouvements.push(mouvement({ id: m, date, montant: -montant, statut: 'non_rapprochee' }))
    }
  }

  // Les opérations diverses : une dotation, un forfait, une liquidation, un paiement depuis le compte personnel.
  if (oui(0.5)) {
    brouillon.push(ligne({ id: id('d'), immobilisation_id: 'i1', compte: '681100', sens: 'debit', montant: 240, date: '2026-12-31' }))
    brouillon.push(ligne({ id: id('d'), immobilisation_id: 'i1', compte: '281830', sens: 'credit', montant: 240, date: '2026-12-31' }))
  }
  if (oui(0.4)) {
    brouillon.push(ligne({ id: id('k'), vehicule_id: 'v1', compte: '625110', sens: 'debit', montant: 300, date: '2026-12-31' }))
    brouillon.push(ligne({ id: id('k'), vehicule_id: 'v1', compte: '108000', sens: 'credit', montant: 300, date: '2026-12-31' }))
  }
  if (assujetti && oui(0.5)) {
    const q: DeclarationLiquidable = {
      periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 0,
      cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, l26: 0, l27: 0, l28: 79, l32: 79 },
    }
    brouillon.push(...ecritureDeLaLiquidation(q, PLAN_PAR_DEFAUT).map((l) => ligne({ ...l, id: id('q'), declaration_tva_id: 'q1', date: '2026-03-31' })))
  }
  if (oui(0.4)) {
    const co: CotisationDeclaree = {
      id: id('cp'), dossier_id: D, echeance: '2026-03-05', montant_appele: 1000, montant_verse: null, montant_csg_crds: 300,
      previsionnel: false, created_at: '2026-02-01T00:00:00Z', paiement_personnel_le: jour(),
    }
    cotisations.push(co)
    brouillon.push(...ecritureDuPaiementPersonnel(co, TRESORERIE).map((l) => ligne({ ...l, id: id('c'), cotisation_id: co.id, date: co.paiement_personnel_le! })))
  }

  // La caisse : une recette, un apport, un prélèvement.
  for (let i = 0, nb = entierTire(suivant, 3); i < nb; i++) {
    const genre = parmi(['recette', 'apport', 'prelevement'] as const)
    const o = operation({ id: id('o'), genre, date: jour(), montant: 40, categorie_id: genre === 'recette' ? 'c-recettes' : null })
    ops.push(o)
    const [debit, credit] = genre === 'recette' ? ['530000', '706000'] : genre === 'apport' ? ['530000', '108000'] : ['108000', '530000']
    brouillon.push(ligne({ id: id('x'), operation_caisse_id: o.id, compte: debit, sens: 'debit', montant: 40, date: o.date }))
    brouillon.push(ligne({ id: id('x'), operation_caisse_id: o.id, compte: credit, sens: 'credit', montant: 40, date: o.date }))
  }

  // Un dossier sur trois a basculé : les ventes facturées du jeu de bout en bout, des SIRET tirés.
  let ventes: readonly EcritureVenteFacturee[] = SANS_ECRITURE_DE_VENTE
  if (oui(0.33)) {
    // Une facture sur deux sur les débits : sa TVA due s'écrit à sa date, avant l'encaissement.
    const base = sourcesDuDossierBascule()
    const sources = { ...base, factures: base.factures.map((f) => (f.type === 'facture' && oui(0.5) ? { ...f, option_debits: true } : f)) }
    const c = composition(sources, 'tresorerie', PLAN_PAR_DEFAUT)
    ventes = c.ecritures
    brouillon.push(...brouillonDesVentes(c, `v${n}-`))
    mouvements.push(...sources.mouvements.map(ligneBancaire))
    for (const f of sources.factures) {
      const siret = parmi([SIRET_VALIDE, SIRET_INVALIDE, null])
      factures.push(facture({ ...f, tiers_siret: siret, tiers_nom: nom() }))
      identifiants.add(f.numero!)
      if (siret === SIRET_VALIDE) identifiants.add(SIREN_VALIDE)
    }
    registre.push(...sources.encaissements.map((e) => ({ ...e, motif: nom() })))
  }

  const aNouveaux = oui(0.5) ? [aNouveau(id('an'), '512000', 'debit', 1000), aNouveau(id('an'), '101000', 'credit', 1000)] : []
  return {
    brouillon, pieces, aNouveaux, mouvements, ventes, caisse: caisseLue(ops), identifiants,
    entrees: entreesVides({
      choix: parmi([VIDES, DATE_ECRITURE]), paiements, registre, factures, cotisations, ventilations, acquisitions,
    }),
  }
}

describe('200 dossiers tirés (graine fixe), de toutes les sortes', () => {
  it('chaque fichier passe les contrôles de la DGFiP et de la conception ; aucun nom ; le total de chaque compte intact', () => {
    const suivant = tirage(20261031)
    const vus = { modes: new Set<string>(), natures: new Set<string>(), postes: 0, sirens: 0, numeros: 0, scissions: 0, lignes: 0 }
    for (let n = 0; n < 200; n++) {
      const j = dossierTire(suivant, n)
      const f22 = fec(j, 'tresorerie', exportes(j.entrees))
      const f18 = fec(j, 'tresorerie', CHAMPS_BNC_NON_EXPORTES)
      // Une faute nomme le dossier, le contrôle, et imprime les lignes de la première écriture fautive.
      const faute = (quoi: string, liste: string[]) => {
        if (liste.length === 0) return
        const lignes = colonnes(f22).filter((r) => liste[0].startsWith(r[2])).map((r) => r.join(' | '))
        throw new Error(`dossier ${n} : ${quoi} : ${liste.slice(0, 3).join(' ; ')}\n${lignes.join('\n')}`)
      }
      faute('structure', structureBncDgfip(f22))
      faute('anomalies de la DGFiP', anomaliesDgfip(f22))
      faute('déséquilibres', desequilibresDgfip(f22))
      faute('déséquilibres d’hier', desequilibresDgfip(f18))
      faute('conception', anomaliesBnc(f22, j.identifiants))
      const r22 = colonnes(f22).slice(1)
      const r18 = colonnes(f18).slice(1)
      for (const r of r22) {
        const [, mode, natOp, idClient] = r.slice(18)
        for (const v of r.slice(18)) for (const nom of NOMS) if (v.includes(nom)) throw new Error(`dossier ${n} : « ${nom} » dans « ${v} »`)
        if (mode !== '' && !MODES_REGLEMENT.some((m) => m === mode)) throw new Error(`dossier ${n} : mode « ${mode} »`)
        const [nature, poste] = natOp.split(SEPARATEUR_DU_POSTE)
        if (!NATURES_OPERATION.some((x) => x === nature)) throw new Error(`dossier ${n} : nature « ${nature} »`)
        if (poste !== undefined && !POSTES_RATTACHES.includes(poste)) throw new Error(`dossier ${n} : poste « ${poste} »`)
        vus.modes.add(mode)
        vus.natures.add(nature)
        if (poste !== undefined) vus.postes++
        if (idClient === SIREN_VALIDE) vus.sirens++
        else if (idClient !== '') vus.numeros++
      }
      // Ce que le fichier porte par compte et par date est celui d'hier ; sans scission, ses dix-huit premiers champs aussi.
      expect(totaux(f22)).toEqual(totaux(f18))
      if (r22.length === r18.length) expect(r22.map((r) => r.slice(0, 18))).toEqual(r18)
      else vus.scissions++
      vus.lignes += r22.length
    }
    // Les planchers : la batterie a rencontré chaque mode, presque chaque nature, des postes, des clients et des scissions.
    expect([...vus.modes].sort()).toEqual(['', 'Autre', 'Banque', 'Carte bancaire', 'Chèque', 'Compte personnel', 'Effet', 'Espèces', 'Sans règlement',
      'Virement'].sort())
    // Toutes les natures, hors l'annulation d'une recette, qu'une contre-passation seule écrit (champsBncDuFec.test.ts la juge).
    expect([...vus.natures].sort()).toEqual(NATURES_OPERATION.filter((x) => x !== 'Annulation de recette').sort())
    expect(vus.postes).toBeGreaterThan(200)
    expect(vus.sirens).toBeGreaterThan(20)
    expect(vus.numeros).toBeGreaterThan(20)
    expect(vus.scissions).toBeGreaterThan(20)
    expect(vus.lignes).toBeGreaterThan(4000)
  })
})

// ── L'ORACLE LUI-MÊME (src/test/fecDgfip.ts) : chacun de ses contrôles voit le défaut qu'on lui plante ─────────────────

describe('les contrôles du fichier à vingt-deux champs voient chacun son défaut planté', () => {
  const j = dossierComplet(VIDES)
  const juste = fec(j, 'tresorerie', exportes(j.entrees))
  const ids = new Set([SIREN_VALIDE])
  // Le fichier, une colonne d'une ligne remplacée : `numero` choisit l'écriture, `rang` la ligne en elle.
  const plante = (numero: string, rang: number, colonne: number, valeur: string) => {
    let vu = -1
    return colonnes(juste).map((r) => (r[2] === numero && ++vu === rang ? r.map((v, i) => (i === colonne ? valeur : v)) : r))
      .map((r) => r.join('\t')).join('\r\n')
  }
  const numeroDu = (compte: string) => colonnes(juste).find((r) => r[4] === compte)![2]

  it('le fichier juste ne porte aucune faute', () => {
    expect(structureBncDgfip(juste)).toEqual([])
    expect(anomaliesBnc(juste, ids)).toEqual([])
  })

  it('la structure : un en-tête, un champ de moins, une date qui n’existe pas', () => {
    const rang = colonnes(juste).findIndex((r) => r[4] === '606100')
    expect(structureBncDgfip(juste.replace('DateRglt\tModeRglt', 'ModeRglt\tDateRglt'))).toHaveLength(1)
    expect(structureBncDgfip(juste.replace(/\tDépense — Achats\t/, '\t'))).toEqual([`ligne ${rang} : 21 champs`])
    expect(structureBncDgfip(plante(numeroDu('606100'), 0, 18, '20260230'))).toEqual([`ligne ${rang} : DateRglt « 20260230 »`])
  })

  it('une écriture : deux dates, deux modes, deux natures, deux clients ; un règlement sans date ; un client inconnu', () => {
    const achat = numeroDu('606100')
    expect(anomaliesBnc(plante(achat, 1, 18, '20260321'), ids)).toContain(`${achat} : différentes dates de règlement`)
    expect(anomaliesBnc(plante(achat, 1, 19, 'Chèque'), ids)).toEqual([`${achat} : différents modes de règlement`])
    // Deux postes ne sont pas deux natures ; deux natures, si.
    expect(anomaliesBnc(plante(achat, 1, 20, 'Dépense — Fournitures de bureau'), ids)).toEqual([])
    expect(anomaliesBnc(plante(achat, 1, 20, 'Recette'), ids)).toEqual([`${achat} : différentes natures`])
    expect(anomaliesBnc(plante(achat, 1, 21, SIREN_VALIDE), ids)).toEqual([`${achat} : différents clients`])
    const sansDate = juste.split('\r\n').map((l) => (l.split('\t')[2] === achat ? l.replace('\t20260320\tBanque\t', '\t\t\t') : l)).join('\r\n')
    expect(anomaliesBnc(sansDate, ids)).toEqual([`${achat} : un règlement sans date ou sans mode`])
    const vente = colonnes(juste).find((r) => r[21] !== '' && r[0] !== 'JournalCode')![2]
    expect(anomaliesBnc(juste, new Set())).toContain(`${vente} : IdClient « ${SIREN_VALIDE} » n'est ni un numéro de facture ni un SIREN du jeu`)
  })
})
