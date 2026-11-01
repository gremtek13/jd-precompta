import { describe, expect, it, vi } from 'vitest'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { pieceDeVente } from '../test/dossierBascule'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { SANS_ECRITURE_DE_VENTE } from '../test/ventesFacturees'
import { colonnes } from '../test/fecDgfip'
import type { ChoixChampsBnc } from './champsBncDuFec'
import { refusDesChampsBnc, REFUS_DES_CHAMPS_BNC, type LigneAJuger } from './champsBncFiges'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'
import {
  analyserEcritures, lignesChargeProduitPourPiece, lignesPourPiece, type CibleComptable, type LigneAGenerer,
} from './ecritures'
import { reglementsDeLaDate, repartirLesLignesPartagees, seRepartit } from './ecritureParReglement'
import type { ModeleComptable } from './engagement'
import {
  CHAMPS_BNC_NON_EXPORTES, formaterFec, numerotationValidee, numeroterFec, type ChampsBncDuFec, type EntreesDesChampsBnc,
  type NumerotationFec,
} from './fec'
import { compteTvaDe, montantRetenu, tvaVentilee } from './montantRetenu'
import { PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { centimesParDate, paiementsDesPieces, type PaiementDePiece, type PartPayeeParLaCaisse } from './rattachement'
import type { ANouveau, Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { defautsDeNumerotation, demandeDeValidation, type LigneDemandee } from './validationExercice'

// LA DEMANDE DE VALIDATION PORTE LES CLÉS DES QUATRE CHAMPS (lot FEC22c2 ; HISTORIQUE.md, « LE FEC D'UN BNC : LA DEMANDE DE
// VALIDATION PORTE SES CLÉS (FEC22C2, DERRIÈRE SON DRAPEAU) »). Ce que ces cas gardent, le drapeau `CHAMPS_BNC_EXPORTES` joué
// dans ses deux états par un accesseur sur lib/champsBncExportes.ts :
//   - BAISSÉ : la génération est celle d'hier au caractère près (confrontée à sa copie d'hier, sur un tirage), la demande
//     aussi (ses huit clés, rien de plus), et un brouillon d'une ligne pour deux règlements ne se dit ni « à régénérer » ni
//     en défaut ;
//   - LEVÉ : une ligne de charge et une de TVA par règlement d'une même date, le total de chaque compte à chaque date intact ;
//     la numérotation range chaque ligne dans l'écriture de son règlement — le fichier est celui qu'hier on scindait, octet
//     pour octet — et la demande porte les cinq clés de chaque ligne ; le brouillon d'avant se dit « à régénérer » et en
//     défaut (une ligne numérotée deux fois) ; le FEC relu d'un exercice validé avec eux est celui d'avant la validation,
//     ValidDate près.
// Toutes les données sont FICTIVES.

const generation = vi.hoisted(() => ({ choix: null as ChoixChampsBnc | null }))
vi.mock('./champsBncExportes', async (original) => {
  const vrai = await original<typeof import('./champsBncExportes')>()
  return { ...vrai, get CHAMPS_BNC_EXPORTES() { return generation.choix } }
})

const D = 'd1'
const VIDES: ChoixChampsBnc = { sansReglement: 'vides' }
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ACHATS: Categorie = { id: 'c-achats', dossier_id: D, code: 'c-achats', libelle: 'Achats fictifs', ordre: 1, compte_comptable: '606100', poste_2035: 'Achats' }
const DIVERS: Categorie = { id: 'c-divers', dossier_id: D, code: 'c-divers', libelle: 'Divers fictifs', ordre: 2, compte_comptable: '625100', poste_2035: 'Divers' }
const CATEGORIES = [ACHATS, DIVERS]

const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => pieceDeVente({
  dossier_id: D, type_piece: 'achat', tiers: 'Fournisseur fictif', nom_fichier: `${o.id}.pdf`, date_piece: '2025-03-20',
  montant_ht: 100, montant_tva: 20, montant_ttc: 120, categorie_id: 'c-achats', created_at: '2025-03-20T09:00:00Z', ...o,
})
const mouvement = (o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id' | 'date' | 'montant'>): LigneBancaire => ({
  dossier_id: D, libelle: 'PRLV FICTIF', libelle_brut: null, source_fichier: null, statut: 'rapprochee', piece_id: null, cotisation_id: null,
  categorie_id: null, taux_tva: null, prelevement_personnel: false, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
  emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
  created_at: `${o.date}T08:00:00Z`, encaissements_de_factures: false, ...o,
})
const enBrouillon = (prefixe: string, lignes: readonly LigneAGenerer[]): EcritureBrouillon[] => lignes.map((l, i) => ({
  ...NON_VALIDEE, id: `${prefixe}-${String(i).padStart(2, '0')}`, dossier_id: l.dossier_id, piece_id: l.piece_id, date: l.date, libelle: l.libelle,
  sens: l.sens, statut: 'proposee', compte: l.compte, montant: l.montant, created_at: `${l.date}T12:00:00Z`,
  ligne_bancaire_id: l.ligne_bancaire_id ?? null, operation_caisse_id: l.operation_caisse_id ?? null, immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null,
}))
// La génération dans l'état du drapeau demandé : `null` baissé, un choix levé.
function avecLeDrapeau<T>(choix: ChoixChampsBnc | null, f: () => T): T {
  const avant = generation.choix
  generation.choix = choix
  try { return f() } finally { generation.choix = avant }
}

// UN ACHAT PAYÉ LE MÊME JOUR PAR LA BANQUE ET PAR LA CAISSE (assujetti) : 120 € TTC, dont 20 € de TVA, 70 € prélevés et
// 50 € en espèces le 20/03/2025.
const ACHAT = piece({ id: 'p-achat' })
const PRELEVEMENT = mouvement({ id: 'm-achat', date: '2025-03-20', montant: -70, piece_id: 'p-achat' })
const ESPECES: PartPayeeParLaCaisse = { operation_caisse_id: 'op-achat', piece_id: 'p-achat', date: '2025-03-20', montant: -50 }
// UNE NOTE DE FRAIS REMBOURSÉE EN PARTIE LE JOUR MÊME (exonéré) : 80 €, 30 € remboursés le 01/06/2025, le reste de la poche.
const NOTE = piece({ id: 'p-note', type_piece: 'note_frais', date_piece: '2025-06-01', montant_ht: null, montant_tva: null, montant_ttc: 80, categorie_id: 'c-divers' })
const REMBOURSEMENT = mouvement({ id: 'm-note', date: '2025-06-01', montant: -30, piece_id: 'p-note' })
const PAIEMENTS = paiementsDesPieces([PRELEVEMENT, REMBOURSEMENT], [], [], [ESPECES])

const cibleDe = (p: Piece): CibleComptable => ({ compte: p.categorie_id === 'c-divers' ? '625100' : '606100', immobilisation: false })
const brouillonDe = (choix: ChoixChampsBnc | null, p: Piece, assujetti: boolean, paiements = PAIEMENTS) =>
  avecLeDrapeau(choix, () => enBrouillon(`${p.id}-${choix === null ? 'hier' : 'reglement'}`,
    lignesPourPiece(D, p, cibleDe(p), assujetti, paiements.get(p.id) ?? [], TRESORERIE)))

const entrees = (o: Partial<EntreesDesChampsBnc> = {}): EntreesDesChampsBnc => ({
  choix: VIDES, paiements: PAIEMENTS, registre: [], factures: [], cotisations: [], ventilations: [], acquisitions: new Map(),
  plan: PLAN_PAR_DEFAUT, ...o,
})
const exportes = (o: Partial<EntreesDesChampsBnc> = {}): ChampsBncDuFec => ({ etat: 'exportes', entrees: entrees(o) })
const numeroter = (brouillon: readonly EcritureBrouillon[], pieces: readonly Piece[], champs: ChampsBncDuFec, mouvements = [PRELEVEMENT, REMBOURSEMENT]) =>
  numeroterFec(brouillon, pieces, CATEGORIES, [], 'tresorerie', mouvements, SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, champs)
const SANS_LETTRAGE = new Map()

// LA GÉNÉRATION D'HIER, recopiée telle qu'elle était avant FEC22c2 : ce que la génération du drapeau baissé doit rendre,
// au caractère près.
function generationDHier(
  dossierId: string, p: Piece, cible: CibleComptable, assujettiTva: boolean, paiements: readonly Pick<PaiementDePiece, 'date' | 'montant'>[],
  plan: PlanComptable,
): LigneAGenerer[] {
  const sensPiece: 'debit' | 'credit' = p.type_piece === 'vente' ? 'credit' : 'debit'
  const libelle = p.tiers ?? p.nom_fichier
  function ligne(date: string, compte: string, montant: number): LigneAGenerer {
    const sens = montant >= 0 ? sensPiece : (sensPiece === 'debit' ? 'credit' : 'debit')
    return { dossier_id: dossierId, piece_id: p.id, date, libelle, statut: 'proposee', compte, sens, montant: Math.abs(montant) }
  }
  const tva = tvaVentilee(p, assujettiTva)
  const charge = tva ? montantRetenu(p, assujettiTva)! : p.montant_ttc!
  const charges = centimesParDate(p, charge, paiements)
  const tvas = tva
    ? centimesParDate(p, charge + tva, paiements).map((t, i) => ({ date: t.date, centimes: t.centimes - charges[i].centimes }))
    : []
  return charges.flatMap((f, i) => {
    const lignes = f.centimes !== 0 ? [ligne(f.date, cible.compte, f.centimes / 100)] : []
    if (tva && tvas[i].centimes !== 0) lignes.push(ligne(f.date, compteTvaDe(p, cible.immobilisation, plan), tvas[i].centimes / 100))
    return lignes
  })
}

// Les lignes de la demande telles que la base les juge : leur écriture, le compte de leur ligne, leurs cinq valeurs.
function aJuger(n: NumerotationFec): LigneAJuger[] {
  return demandeDeValidation(n, null).p_lignes.map((l, i) => {
    if (!('nature_operation' in l)) throw new Error('une ligne sans les cinq clés')
    return {
      journal: l.journal, numero: l.numero, compte: n.lignes[i].ecriture.compte, date_reglement: l.date_reglement,
      mode_reglement: l.mode_reglement, nature_operation: l.nature_operation, poste_rattache: l.poste_rattache,
      identification_client: l.identification_client,
    }
  })
}

const HUIT_CLES = ['id', 'journal', 'numero', 'piece_ref', 'piece_date', 'compte_lib', 'comp_aux_num', 'comp_aux_lib']
const CINQ_CLES = ['date_reglement', 'mode_reglement', 'nature_operation', 'poste_rattache', 'identification_client']

describe('le module partagé : les règlements d’une date et la répartition de ses lignes', () => {
  it('un règlement par moyen, dans l’ordre du fichier, leurs parts sommant à celle de la date', () => {
    const r = reglementsDeLaDate(ACHAT, PAIEMENTS.get('p-achat')!, '2025-03-20')
    expect(r.map((x) => [x.sorte, x.cle, Math.round(x.part * 120)])).toEqual([['releve', 'releve', 70], ['caisse', 'caisse', 50]])
    expect(seRepartit(r)).toBe(true)
    const n = reglementsDeLaDate(NOTE, PAIEMENTS.get('p-note')!, '2025-06-01')
    expect(n.map((x) => [x.sorte, Math.round(x.part * 80)])).toEqual([['releve', 30], ['note_de_frais', 50]])
    // Payée en entier d'un seul moyen : rien à répartir ; payée en partie le jour de sa facture, le reste que rien ne paie
    // est un règlement de plus (« Sans règlement », ou vide : FEC22-Q1).
    const entier = paiementsDesPieces([{ ...PRELEVEMENT, montant: -120 }], [], [], []).get('p-achat')!
    expect(seRepartit(reglementsDeLaDate(ACHAT, entier, '2025-03-20'))).toBe(false)
    expect(reglementsDeLaDate(ACHAT, [PAIEMENTS.get('p-achat')![0]], '2025-03-20').map((x) => x.sorte)).toEqual(['releve', 'aucun'])
  })

  it('la TVA d’un règlement complète sa charge : chaque règlement tombe juste au centime', () => {
    // 20 € TTC, dont 3,33 € de TVA, en deux moitiés : 8,34 + 1,66 et 8,33 + 1,67.
    expect(repartirLesLignesPartagees([1667, 333], [0.5, 0.5])).toEqual([[834, 833], [166, 167]])
  })
})

describe('le drapeau baissé : rien ne change, au caractère près', () => {
  it('la génération est celle d’hier, sur 400 pièces tirées (graine fixe), payées par la banque, la caisse ou la poche, le même jour ou non', () => {
    const suivant = tirage(20261101)
    let deuxModes = 0
    for (let k = 0; k < 400; k++) {
      const type = (['achat', 'vente', 'note_frais'] as const)[entierTire(suivant, 3)]
      const ttc = (entierTire(suivant, 40000) + 1) / 100 * (entierTire(suivant, 10) === 0 ? -1 : 1)
      const tva = entierTire(suivant, 2) === 0 ? null : Math.round(ttc * 0.1667 * 100) / 100
      const p = piece({
        id: `p${k}`, type_piece: type, montant_ttc: ttc, montant_tva: tva, montant_ht: tva === null ? null : Math.round((ttc - tva) * 100) / 100,
        date_piece: entierTire(suivant, 8) === 0 ? null : '2025-04-10',
      })
      const dates = ['2025-04-10', '2025-04-10', '2025-05-02']
      const signe = type === 'vente' ? 1 : -1
      const mvts = Array.from({ length: entierTire(suivant, 3) }, (_, i) =>
        mouvement({ id: `m${k}-${i}`, date: dates[entierTire(suivant, 3)], montant: signe * (entierTire(suivant, 20000) + 1) / 100, piece_id: p.id }))
      const caisse = Array.from({ length: entierTire(suivant, 2) }, (_, i): PartPayeeParLaCaisse =>
        ({ operation_caisse_id: `o${k}-${i}`, piece_id: p.id, date: dates[entierTire(suivant, 3)], montant: signe * (entierTire(suivant, 10000) + 1) / 100 }))
      const paiements = paiementsDesPieces(mvts, [], [], caisse).get(p.id) ?? []
      const assujetti = entierTire(suivant, 2) === 0
      const cible = cibleDe(p)
      const hier = generationDHier(D, p, cible, assujetti, paiements, PLAN_PAR_DEFAUT)
      const baisse = avecLeDrapeau(null, () => lignesChargeProduitPourPiece(D, p, cible, assujetti, paiements, PLAN_PAR_DEFAUT))
      expect(JSON.stringify(baisse), `pièce ${k}`).toBe(JSON.stringify(hier))
      // Le témoin : levé, une pièce payée le même jour par deux moyens a des lignes de plus — le tirage en porte.
      const leve = avecLeDrapeau(VIDES, () => lignesChargeProduitPourPiece(D, p, cible, assujetti, paiements, PLAN_PAR_DEFAUT))
      if (leve.length > hier.length) deuxModes++
    }
    expect(deuxModes).toBeGreaterThanOrEqual(40)
  })

  it('la demande porte les huit clés d’hier, et rien de plus', () => {
    const n = numeroter(brouillonDe(null, ACHAT, true), [ACHAT], CHAMPS_BNC_NON_EXPORTES)
    const demande = demandeDeValidation(n, null)
    expect(demande.p_lignes.length).toBe(4)
    for (const l of demande.p_lignes) expect(Object.keys(l)).toEqual(HUIT_CLES)
    expect(JSON.stringify(demande.p_lignes)).toBe(JSON.stringify(n.lignes.map((l) => ({
      id: l.ecriture.id, journal: l.journal, numero: l.numero, piece_ref: l.pieceRef, piece_date: l.pieceDate,
      compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    }))))
  })

  it('un brouillon d’une ligne pour deux règlements n’est ni « à régénérer » ni en défaut', () => {
    const brouillon = [...brouillonDe(null, ACHAT, true), ...brouillonDe(null, NOTE, false)]
    const a = avecLeDrapeau(null, () => analyserEcritures(brouillon, [
      { piece: ACHAT, ...cibleDe(ACHAT) }, { piece: NOTE, ...cibleDe(NOTE) },
    ], true, PAIEMENTS, TRESORERIE, null, new Set()))
    expect(a.piecesDesynchronisees).toEqual([])
    expect(defautsDeNumerotation(numeroter(brouillon, [ACHAT, NOTE], CHAMPS_BNC_NON_EXPORTES))).toEqual([])
  })
})

describe('le drapeau levé : une ligne par règlement, et la demande porte les cinq clés', () => {
  it('la génération écrit une charge et une TVA par règlement de la date ; chaque compte garde son total', () => {
    const leve = brouillonDe(VIDES, ACHAT, true)
    expect(leve.map((l) => [l.compte, l.sens, l.montant, l.ligne_bancaire_id ?? l.operation_caisse_id ?? ''])).toEqual([
      ['606100', 'debit', 58.33, ''], ['445660', 'debit', 11.67, ''], ['606100', 'debit', 41.67, ''], ['445660', 'debit', 8.33, ''],
      ['512000', 'credit', 70, 'm-achat'], ['530000', 'credit', 50, 'op-achat'],
    ])
    const note = brouillonDe(VIDES, NOTE, false)
    expect(note.map((l) => [l.compte, l.sens, l.montant])).toEqual([['625100', 'debit', 30], ['625100', 'debit', 50], ['512000', 'credit', 30], ['108000', 'credit', 50]])
  })

  it('la numérotation range chaque ligne dans l’écriture de son règlement : aucune ligne numérotée deux fois, chaque écriture équilibrée', () => {
    const brouillon = [...brouillonDe(VIDES, ACHAT, true), ...brouillonDe(VIDES, NOTE, false)]
    const n = numeroter(brouillon, [ACHAT, NOTE], exportes())
    expect(n.lignes.map((l) => [`${l.journal}${l.numero}`, l.ecriture.compte, l.ecriture.montant, l.champsBnc?.modeRglt, l.champsBnc?.natOp])).toEqual([
      ['AC1', '445660', 11.67, 'Banque', 'Dépense'], ['AC1', '606100', 58.33, 'Banque', 'Dépense — Achats'], ['AC1', '512000', 70, 'Banque', 'Dépense'],
      ['AC2', '445660', 8.33, 'Espèces', 'Dépense'], ['AC2', '606100', 41.67, 'Espèces', 'Dépense — Achats'], ['AC2', '530000', 50, 'Espèces', 'Dépense'],
      ['AC3', '625100', 30, 'Banque', 'Dépense — Divers'], ['AC3', '512000', 30, 'Banque', 'Dépense'],
      ['AC4', '625100', 50, 'Compte personnel', 'Dépense — Divers'], ['AC4', '108000', 50, 'Compte personnel', 'Dépense'],
    ])
    expect(new Set(n.lignes.map((l) => l.ecriture.id)).size).toBe(n.lignes.length)
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('le fichier est celui qu’hier on scindait, octet pour octet : seuls les identifiants des lignes changent', () => {
    const regeneres = [...brouillonDe(VIDES, ACHAT, true), ...brouillonDe(VIDES, NOTE, false)]
    const dHier = [...brouillonDe(null, ACHAT, true), ...brouillonDe(null, NOTE, false)]
    const f = (b: EcritureBrouillon[]) => formaterFec(numeroter(b, [ACHAT, NOTE], exportes()), SANS_LETTRAGE, 'tresorerie')
    expect(f(regeneres)).toBe(f(dHier))
    expect(colonnes(f(regeneres))[0].length).toBe(22)
  })

  it('la demande porte les cinq clés de chaque ligne, que la base accepte telles quelles', () => {
    const n = numeroter([...brouillonDe(VIDES, ACHAT, true), ...brouillonDe(VIDES, NOTE, false)], [ACHAT, NOTE], exportes())
    const demande = demandeDeValidation(n, null)
    for (const l of demande.p_lignes) expect(Object.keys(l)).toEqual([...HUIT_CLES, ...CINQ_CLES])
    const champs = (l: LigneDemandee) => ('nature_operation' in l
      ? [l.journal, l.numero, l.date_reglement, l.mode_reglement, l.nature_operation, l.poste_rattache, l.identification_client] : null)
    expect(demande.p_lignes.map(champs)).toEqual([
      ['AC', 1, '2025-03-20', 'Banque', 'Dépense', null, null], ['AC', 1, '2025-03-20', 'Banque', 'Dépense', 'Achats', null],
      ['AC', 1, '2025-03-20', 'Banque', 'Dépense', null, null],
      ['AC', 2, '2025-03-20', 'Espèces', 'Dépense', null, null], ['AC', 2, '2025-03-20', 'Espèces', 'Dépense', 'Achats', null],
      ['AC', 2, '2025-03-20', 'Espèces', 'Dépense', null, null],
      ['AC', 3, '2025-06-01', 'Banque', 'Dépense', 'Divers', null], ['AC', 3, '2025-06-01', 'Banque', 'Dépense', null, null],
      ['AC', 4, '2025-06-01', 'Compte personnel', 'Dépense', 'Divers', null], ['AC', 4, '2025-06-01', 'Compte personnel', 'Dépense', null, null],
    ])
    // Le jugement de la base, redit : rien à refuser.
    const lignes = aJuger(n)
    expect(refusDesChampsBnc(lignes, [], '2026-11-01')).toBeNull()
  })

  it('une demande qui se dit avant aujourd’hui à Paris est acceptée ; la même, jugée un jour plus tôt, se refuse sous les mots de la base', () => {
    const n = numeroter(brouillonDe(VIDES, ACHAT, true), [ACHAT], exportes())
    const lignes = aJuger(n)
    expect(refusDesChampsBnc(lignes, [], '2025-03-20')).toBeNull()
    expect(refusDesChampsBnc(lignes, [], '2025-03-19')).toBe(REFUS_DES_CHAMPS_BNC.find((r) => r.cle === 'date_future'))
  })

  it('le brouillon d’avant se dit « à régénérer », et sa ligne scindée en défaut, nommée par sa pièce', () => {
    const dHier = [...brouillonDe(null, ACHAT, true), ...brouillonDe(null, NOTE, false)]
    const a = avecLeDrapeau(VIDES, () => analyserEcritures(dHier, [
      { piece: ACHAT, ...cibleDe(ACHAT) }, { piece: NOTE, ...cibleDe(NOTE) },
    ], true, PAIEMENTS, TRESORERIE, null, new Set()))
    expect(a.piecesDesynchronisees.map((p) => p.id).sort()).toEqual(['p-achat', 'p-note'])
    const defauts = defautsDeNumerotation(numeroter(dHier, [ACHAT, NOTE], exportes()))
    expect(defauts.map((x) => (x.type === 'ligne_numerotee_deux_fois' ? [x.journal, x.numero, x.pieceRef, x.ligneId] : x.type))).toEqual([
      ['AC', 1, 'p-achat.pdf', 'p-achat-hier-01'], ['AC', 1, 'p-achat.pdf', 'p-achat-hier-00'], ['AC', 3, 'p-note.pdf', 'p-note-hier-00'],
    ])
    // Et régénéré, plus rien : ni « à régénérer », ni défaut.
    const regeneres = [...brouillonDe(VIDES, ACHAT, true), ...brouillonDe(VIDES, NOTE, false)]
    const b = avecLeDrapeau(VIDES, () => analyserEcritures(regeneres, [
      { piece: ACHAT, ...cibleDe(ACHAT) }, { piece: NOTE, ...cibleDe(NOTE) },
    ], true, PAIEMENTS, TRESORERIE, null, new Set()))
    expect(b.piecesDesynchronisees).toEqual([])
  })

  it('sur 300 pièces tirées (graine fixe) : le fichier régénéré est celui d’hier scindé, chaque compte et chaque date gardent leur total', () => {
    const suivant = tirage(20261102)
    let reparties = 0
    for (let k = 0; k < 300; k++) {
      const type = (['achat', 'vente', 'note_frais'] as const)[entierTire(suivant, 3)]
      const ttc = (entierTire(suivant, 40000) + 1) / 100
      const tva = entierTire(suivant, 2) === 0 ? null : Math.round(ttc * 0.1667 * 100) / 100
      const p = piece({ id: `q${k}`, type_piece: type, montant_ttc: ttc, montant_tva: tva, montant_ht: tva === null ? null : Math.round((ttc - tva) * 100) / 100,
        date_piece: '2025-04-10', categorie_id: type === 'note_frais' ? 'c-divers' : 'c-achats' })
      const signe = type === 'vente' ? 1 : -1
      const dates = ['2025-04-10', '2025-04-10', '2025-05-02']
      const mvts = Array.from({ length: entierTire(suivant, 3) }, (_, i) =>
        mouvement({ id: `n${k}-${i}`, date: dates[entierTire(suivant, 3)], montant: signe * (entierTire(suivant, Math.round(ttc * 50)) + 1) / 100, piece_id: p.id }))
      const caisse = Array.from({ length: entierTire(suivant, 2) }, (_, i): PartPayeeParLaCaisse =>
        ({ operation_caisse_id: `r${k}-${i}`, piece_id: p.id, date: dates[entierTire(suivant, 3)], montant: signe * (entierTire(suivant, Math.round(ttc * 40)) + 1) / 100 }))
      const paiements = paiementsDesPieces(mvts, [], [], caisse)
      const assujetti = tva !== null
      const regeneres = brouillonDe(VIDES, p, assujetti, paiements)
      const dHier = brouillonDe(null, p, assujetti, paiements)
      if (regeneres.length > dHier.length) reparties++
      const champs = exportes({ paiements })
      const n = numeroter(regeneres, [p], champs, mvts)
      expect(defautsDeNumerotation(n).filter((x) => x.type === 'ligne_numerotee_deux_fois'), `pièce ${k}`).toEqual([])
      expect(formaterFec(n, SANS_LETTRAGE, 'tresorerie'), `pièce ${k}`).toBe(formaterFec(numeroter(dHier, [p], champs, mvts), SANS_LETTRAGE, 'tresorerie'))
    }
    expect(reparties).toBeGreaterThanOrEqual(40)
  })
})

describe('le FEC d’un exercice validé avec les quatre champs se relit de ce qui a été figé', () => {
  const VALIDE_LE = '2026-01-15T10:00:00Z'
  const ouverture: ANouveau[] = [{
    id: 'an-1', dossier_id: D, date: '2025-01-01', compte: '512000', compte_origine: '512000', libelle: 'Banque', sens: 'debit', montant: 500,
    source_nom: 'balance-fictive.csv', source_empreinte: 'a'.repeat(64), created_at: '2025-01-02T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  }, {
    id: 'an-2', dossier_id: D, date: '2025-01-01', compte: '101000', compte_origine: '101000', libelle: 'Capital', sens: 'credit', montant: 500,
    source_nom: 'balance-fictive.csv', source_empreinte: 'a'.repeat(64), created_at: '2025-01-02T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
  }]
  // Ce que `valider_exercice` fait d'une demande : elle fige, ligne par ligne, ce que la demande porte.
  function valider(n: NumerotationFec, brouillon: readonly EcritureBrouillon[]): EcritureBrouillon[] {
    const parId = new Map(demandeDeValidation(n, null).p_lignes.map((l) => [l.id, l]))
    return brouillon.map((e) => {
      const l = parId.get(e.id)!
      return {
        ...e, statut: 'validee', valide_le: VALIDE_LE, journal_code: l.journal, numero_ecriture: l.numero, piece_ref: l.piece_ref,
        piece_date: l.piece_date, compte_lib: l.compte_lib, comp_aux_num: l.comp_aux_num, comp_aux_lib: l.comp_aux_lib,
        ...('nature_operation' in l ? {
          date_reglement: l.date_reglement, mode_reglement: l.mode_reglement, nature_operation: l.nature_operation,
          poste_rattache: l.poste_rattache, identification_client: l.identification_client,
        } : {}),
      }
    })
  }
  const brouillon = [...brouillonDe(VIDES, ACHAT, true), ...brouillonDe(VIDES, NOTE, false)]
  const avant = numeroterFec(brouillon, [ACHAT, NOTE], CATEGORIES, ouverture, 'tresorerie', [PRELEVEMENT, REMBOURSEMENT], SANS_ECRITURE_DE_VENTE,
    OPERATIONS_DE_CAISSE_ABSENTES, exportes())
  const sansValidDate = (f: string) => colonnes(f).map((r) => r.filter((_, i) => i !== 15))

  it('vingt-deux colonnes, NatOp recomposée, et le fichier d’avant la validation, ValidDate près', () => {
    const relu = numerotationValidee(valider(avant, brouillon), ouverture, VALIDE_LE, VIDES)
    expect(relu.champsBnc).toBe('calcules')
    expect(relu.horsFec).toEqual([])
    expect(sansValidDate(formaterFec(relu, SANS_LETTRAGE, 'tresorerie'))).toEqual(sansValidDate(formaterFec(avant, SANS_LETTRAGE, 'tresorerie')))
  })

  it('le drapeau baissé, le même exercice se relit à dix-huit colonnes : rien ne s’invente', () => {
    const relu = numerotationValidee(valider(avant, brouillon), ouverture, VALIDE_LE, null)
    expect(relu.champsBnc).toBe('non_calcules')
    expect(colonnes(formaterFec(relu, SANS_LETTRAGE, 'tresorerie'))[0].length).toBe(18)
  })

  it('un exercice validé sans eux se relit comme hier, quel que soit le drapeau', () => {
    const sans = numeroterFec(brouillon, [ACHAT, NOTE], CATEGORIES, ouverture, 'tresorerie', [PRELEVEMENT, REMBOURSEMENT], SANS_ECRITURE_DE_VENTE,
      OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    const valides = valider(sans, brouillon)
    expect(formaterFec(numerotationValidee(valides, ouverture, VALIDE_LE, VIDES), SANS_LETTRAGE, 'tresorerie'))
      .toBe(formaterFec(numerotationValidee(valides, ouverture, VALIDE_LE, null), SANS_LETTRAGE, 'tresorerie'))
  })

  it('une ligne figée hors de sa liste, ou sans les champs dans un exercice qui les porte, se voit hors du fichier', () => {
    const valides = valider(avant, brouillon)
    const horsListe = valides.map((e, i) => (i === 0 ? { ...e, mode_reglement: 'Troc' } : e))
    expect(numerotationValidee(horsListe, ouverture, VALIDE_LE, VIDES).horsFec.map((e) => e.id)).toEqual([valides[0].id])
    const sansChamps = valides.map((e, i) => (i === 1 ? { ...e, nature_operation: null, date_reglement: null, mode_reglement: null, poste_rattache: null } : e))
    expect(numerotationValidee(sansChamps, ouverture, VALIDE_LE, VIDES).horsFec.map((e) => e.id)).toEqual([valides[1].id])
  })
})

describe('les bords du rangement et de la répartition', () => {
  it('deux virements mixtes du même moyen, le même jour : deux lignes, une seule écriture « Chèque »', () => {
    const vente = piece({ id: 'p-v', type_piece: 'vente', montant_ht: null, montant_tva: null, montant_ttc: 300, categorie_id: 'c-achats', facture_id: 'f-avant', date_piece: '2025-02-01' })
    const mouvements = [
      mouvement({ id: 'm-a', date: '2025-02-03', montant: 100, piece_id: 'p-v' }),
      mouvement({ id: 'm-b', date: '2025-02-03', montant: 450, encaissements_de_factures: true }),
      mouvement({ id: 'm-c', date: '2025-02-03', montant: 320, encaissements_de_factures: true }),
    ]
    const paiements = paiementsDesPieces(mouvements, [], [
      { ligne_bancaire_id: 'm-b', piece_id: 'p-v', montant: 100 }, { ligne_bancaire_id: 'm-c', piece_id: 'p-v', montant: 100 },
    ], [])
    const encaissement = (id: string, mvt: string) => ({
      id, dossier_id: D, facture_id: 'f-avant', ligne_bancaire_id: mvt, date_encaissement: '2025-02-03', montant: 100, moyen: 'cheque' as const,
      annule_id: null, retire_le: null,
    })
    const brouillon = brouillonDe(VIDES, vente, false, paiements)
    expect(brouillon.filter((l) => l.compte === '606100').map((l) => l.montant)).toEqual([100, 100, 100])
    const n = numeroter(brouillon, [vente], exportes({
      paiements, registre: [encaissement('e-b', 'm-b'), encaissement('e-c', 'm-c')],
      factures: [{ id: 'f-avant', numero: 'F2024-0102', statut: 'validee', tiers_siret: null, source_de_la_vente: false }],
    }), mouvements)
    expect([...new Set(n.lignes.map((l) => `${l.journal}${l.numero} ${l.champsBnc?.modeRglt}`))]).toEqual(['VE1 Banque', 'VE2 Chèque'])
    expect(n.lignes.filter((l) => l.numero === 2).length).toBe(4)
    expect(defautsDeNumerotation(n)).toEqual([])
  })

  it('une date dont les parts s’annulent ne se répartit pas : un rejet et un paiement en espèces le même jour', () => {
    // Prélevé le 10/04, rejeté le 15/04 et payé en espèces le même jour : la date du 15 porte −1 et +1, une somme nulle.
    const p = piece({ id: 'p-r', date_piece: '2025-04-01', montant_ht: null, montant_tva: null, montant_ttc: 120 })
    const paiements = paiementsDesPieces([
      mouvement({ id: 'm-r1', date: '2025-04-10', montant: -120, piece_id: 'p-r' }),
      mouvement({ id: 'm-r2', date: '2025-04-15', montant: 120, piece_id: 'p-r' }),
    ], [], [], [{ operation_caisse_id: 'o-r', piece_id: 'p-r', date: '2025-04-15', montant: -120 }])
    expect(seRepartit(reglementsDeLaDate(p, paiements.get('p-r')!, '2025-04-15'))).toBe(false)
    const leve = avecLeDrapeau(VIDES, () => lignesChargeProduitPourPiece(D, p, cibleDe(p), false, paiements.get('p-r')!, PLAN_PAR_DEFAUT))
    const hier = generationDHier(D, p, cibleDe(p), false, paiements.get('p-r')!, PLAN_PAR_DEFAUT)
    expect(JSON.stringify(leve)).toBe(JSON.stringify(hier))
    expect(leve.every((l) => Number.isFinite(l.montant))).toBe(true)
  })

  it('des paiements qui s’annulent ne paient rien : prélevée le jour de sa date et rejetée, la pièce se génère comme hier (lot FEC22c3)', () => {
    // Prélevé le 01/04, le jour de la pièce, et rejeté le 15/04, pas encore repris : la somme est nulle, `partsDesPaiements` ne
    // rend aucune part, et la pièce compte à sa date comme sans paiement. La génération levée lisait la part d'un paiement
    // qui n'en a pas, et levait.
    const p = piece({ id: 'p-z', date_piece: '2025-04-01' })
    const paiements = paiementsDesPieces([
      mouvement({ id: 'm-z1', date: '2025-04-01', montant: -120, piece_id: 'p-z' }),
      mouvement({ id: 'm-z2', date: '2025-04-15', montant: 120, piece_id: 'p-z' }),
    ], [], [], []).get('p-z')!
    expect(reglementsDeLaDate(p, paiements, '2025-04-01').map((x) => [x.sorte, x.part])).toEqual([['aucun', 1]])
    const leve = avecLeDrapeau(VIDES, () => lignesChargeProduitPourPiece(D, p, cibleDe(p), true, paiements, PLAN_PAR_DEFAUT))
    expect(JSON.stringify(leve)).toBe(JSON.stringify(generationDHier(D, p, cibleDe(p), true, paiements, PLAN_PAR_DEFAUT)))
  })

  it('des paiements qui s’annulent ne font aucun règlement au fichier : la pièce part « Sans règlement », à vingt-deux colonnes (lot FEC22c3)', () => {
    // La même pièce, au FEC : `partsDesReglementsALaDate` (lib/champsBncDuFec.ts), que la numérotation lit quand la date ne se
    // répartit pas, lisait la part d'un paiement qui n'en a pas, et levait.
    const p = piece({ id: 'p-z', date_piece: '2025-04-01' })
    const mouvements = [
      mouvement({ id: 'm-z1', date: '2025-04-01', montant: -120, piece_id: 'p-z' }),
      mouvement({ id: 'm-z2', date: '2025-04-15', montant: 120, piece_id: 'p-z' }),
    ]
    const paiements = paiementsDesPieces(mouvements, [], [], [])
    const brouillon = brouillonDe(VIDES, p, true, paiements)
    const champs = exportes({ choix: { sansReglement: 'date_de_l_ecriture' }, paiements })
    const n = numeroter(brouillon, [p], champs, mouvements)
    const charge = n.lignes.find((l) => l.ecriture.compte === '606100')
    expect(charge?.champsBnc?.modeRglt).toBe('Sans règlement')
    expect(new Set(n.lignes.map((l) => l.ecriture.id))).toEqual(new Set(brouillon.map((l) => l.id)))
    expect(colonnes(formaterFec(n, SANS_LETTRAGE, 'tresorerie')).every((c) => c.length === 22)).toBe(true)
  })

  it('une répartition fausse au centime, au même total et au même nombre de lignes, se dit « à régénérer »', () => {
    const faux = brouillonDe(VIDES, ACHAT, true).map((l) => (l.compte === '606100' ? { ...l, montant: l.montant === 58.33 ? 60 : 40 } : l))
    const a = avecLeDrapeau(VIDES, () => analyserEcritures(faux, [{ piece: ACHAT, ...cibleDe(ACHAT) }], true, PAIEMENTS, TRESORERIE, null, new Set()))
    expect(a.piecesDesynchronisees.map((p) => p.id)).toEqual(['p-achat'])
  })

  it('aucune ligne du brouillon ne se perd : deux lignes de plus qui s’annulent font reprendre la scission d’hier', () => {
    const regeneres = brouillonDe(VIDES, ACHAT, true)
    const charge = regeneres.find((l) => l.compte === '606100')!
    const plus = [...regeneres, { ...charge, id: 'x-plus', montant: 5 }, { ...charge, id: 'x-moins', montant: 5, sens: 'credit' as const }]
    const n = numeroter(plus, [ACHAT], exportes())
    expect(new Set(n.lignes.map((l) => l.ecriture.id))).toEqual(new Set(plus.map((l) => l.id)))
    expect(n.horsFec).toEqual([])
  })
})
