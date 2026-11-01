import { describe, expect, it } from 'vitest'
import {
  brouillonDesVentes, composition, D_BASCULE, exportsDesVentes, ligneBancaire, mouvementDesVentes, pieceDeVente,
  sourcesDuDossierBascule,
} from '../test/dossierBascule'
import { NON_VALIDEE } from '../test/ecritures'
import { anomaliesDgfip, colonnes, desequilibresDgfip } from '../test/fecDgfip'
import { SANS_ECRITURE_DE_VENTE, SANS_VENTE_FACTUREE } from '../test/ventesFacturees'
import { CHAMPS_BNC_NON_EXPORTES, formaterFec, genererFec, numerotationValidee, numeroterFec } from './fec'
import { lignesPourPiece } from './ecritures'
import { formatMoney } from './format'
import { comptesDeTiers, lettrages, lettragesDesFactures, phraseDuLettrage } from './lettrage'
import {
  genererPisteAuditCsv, MANQUE_ECRITURE_PERIMEE, pisteAudit, type JustificatifsDesVentes, type RegistreAudit,
} from './pisteAudit'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import type { EcritureBrouillon, ModeComptable, Piece } from './types'
import {
  factureDeLaLigne, indexDesFactures, nomDuDocument, porteUneSourceDeVente, rattachementDesVentes,
} from './ventesFactureesDesExports'
import { OPERATIONS_DE_CAISSE_ABSENTES } from './controlesDeLaCaisse'

// LES EXPORTS LISENT LES ÉCRITURES D'UNE VENTE FACTURÉE (chantier EC-Q3, étape VF4c2 ; lib/ventesFactureesDesExports.ts,
// lib/fec.ts). Un dossier qui a basculé, de bout en bout : la composition de VF4a sur les lignes de la base, le brouillon que
// la fonction de VF4b aurait écrit, puis le FEC — chaque ligne rattachée à son écriture composée par sa source et sa date,
// jamais par un montant ni un libellé ; ce qui ne se rattache plus reste hors du fichier ; et le fichier passe les contrôles
// de l'outil de la DGFiP. Données FICTIVES.

const MODES: readonly ModeComptable[] = ['tresorerie', 'engagement']
const PLANS: readonly [string, PlanComptable][] = [['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE]]
const SANS_LETTRAGE = new Map()

function jeu(mode: ModeComptable, plan: PlanComptable = PLAN_PAR_DEFAUT) {
  const sources = sourcesDuDossierBascule()
  const c = composition(sources, mode, plan)
  return { sources, c, brouillon: brouillonDesVentes(c), exports: exportsDesVentes(sources, c) }
}

const fec = (brouillon: EcritureBrouillon[], mode: ModeComptable, ecritures = jeu(mode).c.ecritures, pieces: Piece[] = []) =>
  genererFec(brouillon, pieces, [], [], mode, [], SANS_LETTRAGE, ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)

describe('rattachementDesVentes — une ligne retrouve son écriture composée par sa source et sa date', () => {
  for (const mode of MODES) {
    for (const [nomPlan, plan] of PLANS) {
      it(`${mode}, ${nomPlan} : chaque ligne écrite d'après la composition est rattachée, à l'écriture de sa source`, () => {
        const { c, brouillon } = jeu(mode, plan)
        const r = rattachementDesVentes(brouillon, c.ecritures)
        expect(brouillon.length).toBeGreaterThan(0)
        for (const b of brouillon) {
          const e = r.get(b.id)
          expect(e, b.id).toBeDefined()
          expect(e!.date, b.id).toBe(b.date)
          if (b.facture_id != null) expect(e!.source, b.id).toMatchObject({ factureId: b.facture_id })
          else if (b.encaissement_id != null) expect(e!.source, b.id).toMatchObject({ genre: 'encaissement', encaissementId: b.encaissement_id })
          else expect(e!.source, b.id).toEqual({ genre: 'mouvement', ligneBancaireId: b.ligne_bancaire_id })
        }
      })
    }
  }

  it('ne dépend ni de l’ordre de lecture, ni du libellé', () => {
    const { c, brouillon } = jeu('engagement')
    const r = rattachementDesVentes(brouillon, c.ecritures)
    const inverse = rattachementDesVentes([...brouillon].reverse(), c.ecritures)
    const relibelle = rattachementDesVentes(brouillon.map((b) => ({ ...b, libelle: 'un autre libellé' })), c.ecritures)
    for (const b of brouillon) {
      expect(inverse.get(b.id)).toBe(r.get(b.id))
      expect(relibelle.get(b.id)).toBe(r.get(b.id))
    }
  })

  it('jamais par un montant : deux encaissements du même montant, le même jour, chacun à sa source', () => {
    const sources = sourcesDuDossierBascule()
    // Un second encaissement de 120 €, le même jour, sur une autre facture du même montant.
    const autre = { ...sources.encaissements[0], id: 'e9', facture_id: 'f9', ligne_bancaire_id: null, moyen: 'cheque' as const }
    const s = {
      ...sources,
      factures: [...sources.factures, { ...sources.factures[0], id: 'f9', numero: 'F2025-0009' }],
      lignes: [...sources.lignes, { ...sources.lignes[0], facture_id: 'f9' }],
      encaissements: [...sources.encaissements, autre],
      parts: [...sources.parts, { ...sources.parts[0], encaissement_id: 'e9' }],
    }
    const c = composition(s, 'tresorerie', PLAN_PAR_DEFAUT)
    const brouillon = brouillonDesVentes(c)
    const r = rattachementDesVentes(brouillon, c.ecritures)
    for (const b of brouillon.filter((x) => x.encaissement_id != null)) {
      expect(r.get(b.id)?.source).toMatchObject({ encaissementId: b.encaissement_id })
    }
    // Échanger les lignes des deux sources ne rattache rien : la source est sur la ligne, le montant n'y suffit pas.
    const echange = brouillon.map((b) => (b.encaissement_id === 'e1' ? { ...b, encaissement_id: 'e9' }
      : b.encaissement_id === 'e9' ? { ...b, encaissement_id: 'e1' } : b))
    const re = rattachementDesVentes(echange, c.ecritures)
    expect(echange.filter((b) => (b.encaissement_id === 'e1' || b.encaissement_id === 'e9') && re.has(b.id))).toEqual([])
    expect(echange.filter((b) => b.encaissement_id === 'e2').every((b) => re.has(b.id))).toBe(true)
  })

  it('une écriture qui n’est plus celle de sa source (« à réécrire ») n’est pas rattachée ; les autres le restent', () => {
    const { c, brouillon } = jeu('engagement')
    const perime = brouillon.map((b) => (b.encaissement_id === 'e2' && b.compte === '511000' ? { ...b, montant: b.montant + 0.01 } : b))
    const r = rattachementDesVentes(perime, c.ecritures)
    expect(perime.filter((b) => !r.has(b.id)).map((b) => b.encaissement_id)).toEqual(['e2', 'e2', 'e2', 'e2'])
    // Une ligne de plus, à une date que la source n'écrit pas, ne se rattache pas — et ne défait pas l'écriture d'à côté.
    const deTrop = { ...brouillon.find((b) => b.encaissement_id === 'e1')!, id: 'de-trop', date: '2025-11-21' }
    const r2 = rattachementDesVentes([...brouillon, deTrop], c.ecritures)
    expect(r2.has('de-trop')).toBe(false)
    expect(brouillon.every((b) => r2.has(b.id))).toBe(true)
  })

  it('une source que la composition ne rend plus (« à retirer ») : un encaissement retiré, un mouvement déclassé', () => {
    const { sources, brouillon } = jeu('engagement')
    const sansE2 = {
      ...sources,
      encaissements: sources.encaissements.map((e) => (e.id === 'e2' ? { ...e, retire_le: '2025-11-25T08:00:00Z' } : e)),
      mouvements: sources.mouvements.map((m) => (m.id === 'm2' ? { ...m, encaissements_de_factures: false, statut: 'non_rapprochee' as const } : m)),
    }
    const c = composition(sansE2, 'engagement', PLAN_PAR_DEFAUT)
    const r = rattachementDesVentes(brouillon, c.ecritures)
    const nonRattachees = brouillon.filter((b) => !r.has(b.id))
    expect(new Set(nonRattachees.map((b) => b.encaissement_id ?? b.ligne_bancaire_id))).toEqual(new Set(['e2', 'm2']))
  })

  it('ne prend jamais la ligne d’une pièce, ni celle d’un mouvement classé autrement', () => {
    const { c, brouillon } = jeu('engagement')
    const autres: EcritureBrouillon[] = [
      { ...brouillon[0], id: 'piece', piece_id: 'p1', facture_id: null, encaissement_id: null },
      // La ligne d'une pièce rapprochée du mouvement que la composition écrit (m2) : une pièce, pas le troisième genre.
      { ...brouillon[0], id: 'piece-m2', piece_id: 'p1', facture_id: null, encaissement_id: null, ligne_bancaire_id: 'm2' },
      // Une ligne sans source sur un mouvement que la composition n'écrit pas (m1 : tout est du même jour).
      { ...brouillon[0], id: 'm1-sans-source', facture_id: null, encaissement_id: null, ligne_bancaire_id: 'm1' },
      // Une ligne d'un mouvement composé, mais qui porte une autre source (une échéance de cotisation) : pas du troisième genre.
      { ...brouillon[0], id: 'm2-cotisation', facture_id: null, encaissement_id: null, ligne_bancaire_id: 'm2', cotisation_id: 'c1' },
    ]
    const r = rattachementDesVentes([...brouillon, ...autres], c.ecritures)
    for (const a of autres) expect(r.has(a.id), a.id).toBe(false)
    expect(brouillon.every((b) => r.has(b.id))).toBe(true)
  })
})

describe('factureDeLaLigne — la créance qu’une ligne porte au 411', () => {
  it('la facture elle-même, celle que corrige l’avoir, celle que règle l’encaissement ; rien pour un mouvement', () => {
    const { sources, brouillon } = jeu('engagement')
    const index = indexDesFactures(sources)
    const parSource = (b: EcritureBrouillon) => factureDeLaLigne(b, index)
    expect(parSource({ ...brouillon[0], facture_id: 'f1', encaissement_id: null })).toBe('f1')
    expect(parSource({ ...brouillon[0], facture_id: 'a1', encaissement_id: null })).toBe('f3')
    expect(parSource({ ...brouillon[0], facture_id: null, encaissement_id: 'e2' })).toBe('f2')
    expect(parSource({ ...brouillon[0], facture_id: null, encaissement_id: null })).toBeNull()
    // Une source que la lecture n'a pas rendue n'est rattachée à aucune facture : rien ne se devine.
    expect(parSource({ ...brouillon[0], facture_id: 'inconnue', encaissement_id: null })).toBeNull()
    expect(parSource({ ...brouillon[0], facture_id: null, encaissement_id: 'inconnu' })).toBeNull()
  })

  it('nomme un document, et dit qu’une ligne porte une source', () => {
    expect(nomDuDocument({ type: 'facture', numero: 'F2025-0001', id: 'f1' })).toBe('Facture F2025-0001')
    expect(nomDuDocument({ type: 'avoir', numero: null, id: '0123456789' })).toBe('Avoir 01234567')
    expect(porteUneSourceDeVente({ facture_id: null, encaissement_id: 'e1' })).toBe(true)
    expect(porteUneSourceDeVente({ facture_id: null, encaissement_id: null })).toBe(false)
  })
})

describe('le FEC d’un dossier qui a basculé', () => {
  it('en engagement : chaque écriture dans son journal, sous sa pièce, avec l’auxiliaire du client', () => {
    const { brouillon } = jeu('engagement')
    const rows = colonnes(fec(brouillon, 'engagement')).slice(1)
    // Journal, numéro, date, compte, auxiliaire, PieceRef, PieceDate — une écriture par source et par date.
    expect(rows.map((r) => [r[0], r[2], r[3], r[4], r[6], r[8], r[9]])).toEqual([
      ['VE', 'VE00001', '20251110', '411000', 'CFICTIF', 'F2025-0001', '20251110'],
      ['VE', 'VE00001', '20251110', '445800', '', 'F2025-0001', '20251110'],
      ['VE', 'VE00001', '20251110', '706000', '', 'F2025-0001', '20251110'],
      ['VE', 'VE00002', '20251112', '411000', 'CCLINIQUE', 'F2025-0002', '20251112'],
      ['VE', 'VE00002', '20251112', '445800', '', 'F2025-0002', '20251112'],
      ['VE', 'VE00002', '20251112', '706000', '', 'F2025-0002', '20251112'],
      ['VE', 'VE00003', '20251114', '411000', 'CFICTIF', 'F2025-0003', '20251114'],
      ['VE', 'VE00003', '20251114', '445800', '', 'F2025-0003', '20251114'],
      ['VE', 'VE00003', '20251114', '706000', '', 'F2025-0003', '20251114'],
      ['VE', 'VE00004', '20251118', '445800', '', 'A2025-0001', '20251118'],
      ['VE', 'VE00004', '20251118', '706000', '', 'A2025-0001', '20251118'],
      ['VE', 'VE00004', '20251118', '411000', 'CFICTIF', 'A2025-0001', '20251118'],
      ['BQ', 'BQ00001', '20251120', '445800', '', 'F2025-0001', '20251110'],
      ['BQ', 'BQ00001', '20251120', '512000', '', 'F2025-0001', '20251110'],
      ['BQ', 'BQ00001', '20251120', '411000', 'CFICTIF', 'F2025-0001', '20251110'],
      ['BQ', 'BQ00001', '20251120', '445710', '', 'F2025-0001', '20251110'],
      ['BQ', 'BQ00002', '20251121', '445800', '', 'F2025-0002', '20251112'],
      ['BQ', 'BQ00002', '20251121', '511000', '', 'F2025-0002', '20251112'],
      ['BQ', 'BQ00002', '20251121', '411000', 'CCLINIQUE', 'F2025-0002', '20251112'],
      ['BQ', 'BQ00002', '20251121', '445710', '', 'F2025-0002', '20251112'],
      ['BQ', 'BQ00003', '20251122', '512000', '', 'releve-fictif.csv', '20251122'],
      ['BQ', 'BQ00003', '20251122', '511000', '', 'releve-fictif.csv', '20251122'],
    ])
    // EcritureLib : le libellé que la composition a donné à la ligne en l'écrivant.
    expect(rows.find((r) => r[2] === 'VE00004')![10]).toBe('Avoir A2025-0001 — Client fictif')
    expect(rows.find((r) => r[2] === 'BQ00003')![10]).toBe('REMISE CHEQUE FICTIVE')
  })

  it('en trésorerie : l’encaissement au journal des ventes, le mouvement au journal de banque', () => {
    const { brouillon } = jeu('tresorerie')
    const rows = colonnes(fec(brouillon, 'tresorerie')).slice(1)
    expect([...new Set(rows.map((r) => `${r[2]} ${r[8]} ${r[9]}`))]).toEqual([
      'VE00001 F2025-0001 20251110', 'VE00002 F2025-0002 20251112', 'BQ00001 releve-fictif.csv 20251122',
    ])
    // Rien au 411 en trésorerie pour des services : aucune ligne n'a d'auxiliaire.
    expect(rows.every((r) => r[6] === '')).toBe(true)
  })

  for (const mode of MODES) {
    for (const [nomPlan, plan] of PLANS) {
      it(`${mode}, ${nomPlan} : passe les contrôles de l’outil de la DGFiP, ventes facturées et pièces mêlées, et rien n’est hors du fichier`, () => {
        const { c, brouillon } = jeu(mode, plan)
        // Une pièce de vente d'avant la bascule, et un achat, que la génération écrit comme hier.
        const vente = pieceDeVente({ id: 'p-vente', date_piece: '2025-11-05', montant_ttc: 60 })
        const achat = pieceDeVente({ id: 'p-achat', type_piece: 'achat', tiers: 'Fournisseur fictif', date_piece: '2025-11-15', montant_ttc: 24 })
        const pieces = (mode === 'engagement' ? [vente, achat] : []).flatMap((p) => lignesPourPiece(
          D_BASCULE, p, { compte: p.type_piece === 'vente' ? '706000' : '606400', immobilisation: false }, false, [],
          { mode, plan, compteNotesDeFrais: plan.associe },
        ).map((l, i): EcritureBrouillon => ({
          ...l, id: `${p.id}-${i}`, ligne_bancaire_id: l.ligne_bancaire_id ?? null, created_at: `${l.date}T09:00:00Z`,
          immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, encaissement_id: null,
          facture_id: null, ...NON_VALIDEE,
        })))
        const tout = [...pieces, ...brouillon]
        const n = numeroterFec(tout, [vente, achat], [], [], mode, [], c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
        expect(n.horsFec).toEqual([])
        const f = genererFec(tout, [vente, achat], [], [], mode, [], SANS_LETTRAGE, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
        expect(anomaliesDgfip(f)).toEqual([])
        expect(desequilibresDgfip(f)).toEqual([])
        // Les numéros d'un journal se suivent dans l'ordre des dates.
        for (const journal of ['VE', 'BQ', 'AC']) {
          const dates = [...new Map(colonnes(f).slice(1).filter((r) => r[0] === journal).map((r) => [r[2], r[3]])).entries()]
          expect(dates.map(([num]) => num)).toEqual(dates.map((_, i) => `${journal}${String(i + 1).padStart(5, '0')}`))
          expect(dates.map(([, d]) => d)).toEqual([...dates.map(([, d]) => d)].sort())
        }
      })
    }
  }

  it('un même client, avant et après la bascule : un seul compte auxiliaire, sous un seul libellé', () => {
    const { c, brouillon } = jeu('engagement')
    const vente = pieceDeVente({ id: 'p-vente', tiers: 'CLIENT FICTIF', date_piece: '2025-11-05' })
    const lignes = lignesPourPiece(D_BASCULE, vente, { compte: '706000', immobilisation: false }, false, [], {
      mode: 'engagement', plan: PLAN_PAR_DEFAUT, compteNotesDeFrais: PLAN_PAR_DEFAUT.associe,
    }).map((l, i): EcritureBrouillon => ({
      ...l, id: `pv-${i}`, ligne_bancaire_id: null, created_at: '2025-11-05T09:00:00Z', immobilisation_id: null, vehicule_id: null,
      declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE,
    }))
    const rows = colonnes(genererFec([...lignes, ...brouillon], [vente], [], [], 'engagement', [], SANS_LETTRAGE, c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)).slice(1)
    const fictif = rows.filter((r) => r[6] === 'CFICTIF')
    expect(fictif.length).toBeGreaterThan(4)
    expect(new Set(fictif.map((r) => r[7]))).toEqual(new Set(['CLIENT FICTIF']))
  })

  it('rend le même fichier dans les deux ordres de lecture', () => {
    const { brouillon } = jeu('engagement')
    expect(fec([...brouillon].reverse(), 'engagement')).toBe(fec(brouillon, 'engagement'))
  })

  it('laisse hors du fichier ce qui ne se rattache plus, et le fichier reste juste', () => {
    const { brouillon } = jeu('engagement')
    const perime = brouillon.map((b) => (b.encaissement_id === 'e2' && b.compte === '511000' ? { ...b, montant: 100.01 } : b))
    const n = numeroterFec(perime, [], [], [], 'engagement', [], jeu('engagement').c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(n.horsFec.map((e) => e.encaissement_id)).toEqual(['e2', 'e2', 'e2', 'e2'])
    const f = fec(perime, 'engagement')
    expect(anomaliesDgfip(f)).toEqual([])
    expect(desequilibresDgfip(f)).toEqual([])
    expect(colonnes(f).slice(1).some((r) => r[10].includes('Clinique du Parc') && r[0] === 'BQ' && r[3] === '20251121')).toBe(false)
  })

  // Sans la composition, chaque ligne d'une vente facturée est hors du fichier : c'est pourquoi la numérotation que la
  // validation envoie la reçoit, depuis l'étape VF7c (lib/prealablesValidation.ts ; dossierBasculeBoutEnBout.test.ts).
  it('sans la composition, chaque ligne d’une vente facturée est hors du fichier — la validation la reçoit depuis VF7c', () => {
    const { brouillon } = jeu('engagement')
    const n = numeroterFec(brouillon, [], [], [], 'engagement', [], SANS_ECRITURE_DE_VENTE, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(n.lignes).toEqual([])
    expect(n.horsFec).toHaveLength(brouillon.length)
  })

  // CE QUE LA VALIDATION FIGE (étape VF7c) : `valider_exercice` écrit sur chaque ligne ce que la numérotation a décidé — le
  // journal, le numéro, la pièce, les libellés et l'auxiliaire —, et le FEC de l'exercice validé se relit de ces colonnes
  // seules. Pour les ventes facturées comme pour le reste, il est celui d'avant, ValidDate près.
  it.each(MODES)('%s : le FEC d’un exercice validé est celui d’avant la validation, ValidDate près', (mode) => {
    const { c, brouillon } = jeu(mode)
    const avant = numeroterFec(brouillon, [], [], [], mode, [], c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(avant.horsFec).toEqual([])
    const VALIDE_LE = '2026-01-20T10:00:00Z'
    const figees = avant.lignes.map((l): EcritureBrouillon => ({
      ...l.ecriture, statut: 'validee', valide_le: VALIDE_LE, journal_code: l.journal, numero_ecriture: l.numero, piece_ref: l.pieceRef,
      piece_date: l.pieceDate, compte_lib: l.compteLib, comp_aux_num: l.compAuxNum, comp_aux_lib: l.compAuxLib,
    }))
    const apres = numerotationValidee([...figees].reverse(), [], VALIDE_LE)
    expect(apres.horsFec).toEqual([])
    const sansValidDate = (f: string) => colonnes(f).map((r) => r.filter((_, i) => i !== 15))
    expect(sansValidDate(formaterFec(apres, SANS_LETTRAGE, mode))).toEqual(sansValidDate(formaterFec(avant, SANS_LETTRAGE, mode)))
    expect(sansValidDate(formaterFec(avant, SANS_LETTRAGE, mode))).toEqual(sansValidDate(fec(brouillon, mode)))
  })

  it('le FEC d’un exercice validé se relit des colonnes que la validation fige, jamais de la composition', () => {
    const { brouillon } = jeu('engagement')
    // Une ligne d'une vente facturée validée sans ce que la validation fige ne se numérote pas, comme toute autre.
    const validee = { ...brouillon[0], statut: 'validee' as const, valide_le: '2026-01-20T10:00:00Z' }
    expect(numerotationValidee([validee], [], '2026-01-20T10:00:00Z').horsFec).toEqual([validee])
    const figee = {
      ...validee, journal_code: 'VE' as const, numero_ecriture: 1, piece_ref: 'F2025-0001', piece_date: '2025-11-10',
      compte_lib: 'Clients', comp_aux_num: 'CFICTIF', comp_aux_lib: 'Client fictif',
    }
    expect(numerotationValidee([figee], [], '2026-01-20T10:00:00Z').lignes.map((l) => [l.journal, l.pieceRef, l.compAuxNum]))
      .toEqual([['VE', 'F2025-0001', 'CFICTIF']])
  })

  it('un mouvement que ses encaissements classent n’entre pas comme mouvement « justifié par le relevé »', () => {
    // Le relevé passé au FEC ne change rien : seule la composition rattache ses lignes.
    const { c, brouillon } = jeu('engagement')
    const m2 = mouvementDesVentes({ id: 'm2', date: '2025-11-22', montant: 100 })
    const n = numeroterFec(brouillon, [], [], [], 'engagement', [{
      ...m2, libelle_brut: null, taux_tva: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
    }], c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    expect(n.lignes.filter((l) => l.ecriture.ligne_bancaire_id === 'm2' && l.ecriture.encaissement_id == null).map((l) => l.pieceRef))
      .toEqual(['releve-fictif.csv', 'releve-fictif.csv'])
  })
})

describe('la piste d’audit d’un dossier qui a basculé', () => {
  const EXEMPLAIRE = pieceDeVente({ id: 'p-ex', facture_id: 'f1', nom_fichier: 'F2025-0001.pdf', storage_hash: 'a'.repeat(64) })
  const justificatifs = (exports: ReturnType<typeof jeu>['exports']): JustificatifsDesVentes => ({
    ...exports,
    exemplaires: [EXEMPLAIRE],
    transmissions: [
      // Une transmission échouée ne prouve rien ; la transmission déposée, si.
      { id: 't0', facture_id: 'f2', etat: 'echec', sha256: 'c'.repeat(64), hote: 'api.superpdp.tech' },
      { id: 't1', facture_id: 'f2', etat: 'depose', sha256: 'b'.repeat(64), hote: 'api.superpdp.tech' },
    ],
  })
  const registre = (j: JustificatifsDesVentes): RegistreAudit => ({ immobilisations: [], factures: [], vehicules: [], ventes: j, caisse: OPERATIONS_DE_CAISSE_ABSENTES })
  const releve = sourcesDuDossierBascule().mouvements.map(ligneBancaire)

  it('donne à chaque ligne son justificatif — la facture, le registre, le relevé —, et rien ne lui manque', () => {
    const { brouillon, exports } = jeu('engagement')
    const lignes = pisteAudit(brouillon, [], releve, [], registre(justificatifs(exports)))
    expect(lignes).toHaveLength(brouillon.length)
    for (const l of lignes) expect(l.manque, `${l.ecritureId} ${l.compte}`).toEqual([])
    const premiere = (p: (b: EcritureBrouillon) => boolean) => lignes.find((l) => l.ecritureId === brouillon.find(p)!.id)!
    // La facture et son exemplaire désigné : le nom de l'original et son empreinte.
    expect(premiere((b) => b.facture_id === 'f1')).toMatchObject({
      pieceTiers: 'Client fictif', pieceDate: '2025-11-10', pieceMontantTtc: 120,
      pieceFichier: 'Facture F2025-0001 — exemplaire : F2025-0001.pdf', pieceEmpreinte: 'a'.repeat(64), mouvementDate: null,
    })
    // Sans exemplaire, le CII déposé : l'empreinte de la transmission déposée, jamais celle d'un échec.
    expect(premiere((b) => b.facture_id === 'f2')).toMatchObject({
      pieceFichier: 'Facture F2025-0002 — CII transmis à api.superpdp.tech', pieceEmpreinte: 'b'.repeat(64),
    })
    // Ni l'un ni l'autre : la colonne reste vide, jamais remplacée par un nom.
    expect(premiere((b) => b.facture_id === 'f3')).toMatchObject({ pieceFichier: 'Facture F2025-0003', pieceEmpreinte: null })
    expect(premiere((b) => b.facture_id === 'a1')).toMatchObject({ pieceFichier: 'Avoir A2025-0001', pieceMontantTtc: -60 })
    // L'encaissement : son registre, et son mouvement — même sur une ligne qui ne le porte pas (le 411).
    expect(premiere((b) => b.encaissement_id === 'e1' && b.compte === '411000')).toMatchObject({
      pieceTiers: 'Client fictif', pieceDate: '2025-11-20', pieceMontantTtc: 120, pieceEmpreinte: null,
      pieceFichier: 'Registre des encaissements : encaissement du 20/11/2025 (virement) — Facture F2025-0001',
      mouvementDate: '2025-11-20', mouvementMontant: 120,
    })
    expect(premiere((b) => b.encaissement_id === 'e2' && b.compte === '511000')).toMatchObject({
      pieceFichier: 'Registre des encaissements : encaissement du 21/11/2025 (chèque) — Facture F2025-0002',
      mouvementDate: '2025-11-22', mouvementLibelle: 'REMISE CHEQUE FICTIVE',
    })
    // Le mouvement que ses encaissements classent : le relevé qui le porte.
    expect(premiere((b) => b.ligne_bancaire_id === 'm2' && b.encaissement_id == null)).toMatchObject({
      pieceFichier: 'Relevé bancaire : releve-fictif.csv', pieceDate: '2025-11-22', mouvementMontant: 100,
    })
  })

  it('une ligne qui n’est plus celle de sa source le dit, son justificatif restant nommé', () => {
    const { brouillon, exports } = jeu('engagement')
    const perime = brouillon.map((b) => (b.encaissement_id === 'e2' && b.compte === '511000' ? { ...b, montant: 100.01 } : b))
    const lignes = pisteAudit(perime, [], releve, [], registre(justificatifs(exports)))
    const e2 = lignes.filter((l) => perime.find((b) => b.id === l.ecritureId)?.encaissement_id === 'e2')
    expect(e2).toHaveLength(4)
    for (const l of e2) {
      expect(l.manque).toEqual([MANQUE_ECRITURE_PERIMEE])
      expect(l.pieceFichier).toMatch(/^Registre des encaissements/)
    }
    expect(lignes.filter((l) => !e2.includes(l)).every((l) => l.manque.length === 0)).toBe(true)
  })

  it('nomme une contre-passation, et la facture qu’elle rouvre', () => {
    const { brouillon, exports } = jeu('engagement')
    const contre = { ...exports.encaissements[0], id: 'c1', montant: -120, annule_id: 'e1', date_encaissement: '2025-11-25' }
    const ligne = { ...brouillon.find((b) => b.encaissement_id === 'e1' && b.compte === '411000')!, id: 'l-c1', encaissement_id: 'c1', date: '2025-11-25' }
    const [l] = pisteAudit([ligne], [], releve, [], registre(justificatifs({ ...exports, encaissements: [...exports.encaissements, contre] })))
    expect(l.pieceFichier).toBe('Registre des encaissements : contre-passation du 25/11/2025 (virement) — Facture F2025-0001')
    expect(l.pieceMontantTtc).toBe(-120)
  })

  it('distingue un lien nul d’une source hors du jeu chargé', () => {
    const { brouillon, exports } = jeu('engagement')
    const lignes = pisteAudit(brouillon, [], [], [], registre(SANS_VENTE_FACTUREE))
    // Sans la composition, rien ne se rattache ; sans les factures et le registre, aucune source n'est lue.
    const facture = lignes.find((l) => brouillon.find((b) => b.id === l.ecritureId)?.facture_id === 'f1')!
    expect(facture.manque).toEqual([MANQUE_ECRITURE_PERIMEE, 'justificatif hors du jeu chargé'])
    // Un encaissement lu dont le mouvement ne l'est pas : un filtre de l'appelant, pas une rupture.
    const sansReleve = pisteAudit(brouillon, [], [], [], registre(justificatifs(exports)))
    expect(sansReleve.find((l) => brouillon.find((b) => b.id === l.ecritureId)?.encaissement_id === 'e1')!.manque)
      .toEqual(['mouvement hors du jeu chargé'])
  })

  it('l’exemplaire d’une facture source n’attend aucune écriture ; celui d’une facture qui n’est pas source, si', () => {
    const { brouillon, exports } = jeu('engagement')
    const nonSource = pieceDeVente({ id: 'p-ns', facture_id: 'f-ns' })
    const j = justificatifs({ ...exports, factures: [...exports.factures, { ...exports.factures[0], id: 'f-ns', source_de_la_vente: false }] })
    const lignes = pisteAudit(brouillon, [EXEMPLAIRE, nonSource], releve, [], registre(j))
    expect(lignes.find((l) => l.pieceId === 'p-ex')).toMatchObject({
      ecritureId: null, manque: [], libelle: 'Exemplaire de : Facture F2025-0001 — la vente est comptée par la facture',
    })
    expect(lignes.find((l) => l.pieceId === 'p-ns')!.manque).toEqual(['écriture'])
  })

  it('le fichier exporté : une ligne par écriture, et la colonne de ce qui manque vide (trésorerie)', () => {
    const { brouillon, exports } = jeu('tresorerie')
    const csv = genererPisteAuditCsv(pisteAudit(brouillon, [], releve, [], registre(justificatifs(exports))))
    const rangs = csv.replace(/^\uFEFF/, '').split('\r\n').slice(1)
    expect(rangs).toHaveLength(brouillon.length)
    for (const r of rangs) expect(r.endsWith(';'), r).toBe(true)
  })
})

describe('le lettrage du 411 d’une vente facturée, par facture', () => {
  const lettrer = (brouillon: EcritureBrouillon[], exports: ReturnType<typeof jeu>['exports'], mode: ModeComptable = 'engagement') =>
    lettrages(brouillon, [], [], mode, exports)
  const codes = (brouillon: EcritureBrouillon[], l: ReadonlyMap<string, { code: string }>, p: (b: EcritureBrouillon) => boolean) =>
    [...new Set(brouillon.filter((b) => b.compte === '411000' && p(b)).map((b) => l.get(b.id)?.code ?? '—'))]

  it('la facture, ses avoirs, ses encaissements : un même code quand ils se soldent, dans l’ordre où les lettrages naissent', () => {
    const { brouillon, exports } = jeu('engagement')
    const l = lettrer(brouillon, exports)
    // F2025-0003 et son avoir se soldent le 18/11 ; F2025-0001 et son encaissement, le 20/11 : A, puis B.
    expect(codes(brouillon, l, (b) => b.facture_id === 'f3' || b.facture_id === 'a1')).toEqual(['A'])
    expect(codes(brouillon, l, (b) => b.facture_id === 'f1' || b.encaissement_id === 'e1')).toEqual(['B'])
    expect(l.get(brouillon.find((b) => b.facture_id === 'a1' && b.compte === '411000')!.id)!.date).toBe('2025-11-18')
    // Payée en partie : rien.
    expect(codes(brouillon, l, (b) => b.facture_id === 'f2' || b.encaissement_id === 'e2')).toEqual(['—'])
    // Rien d'autre que le 411 ne se lettre.
    expect(brouillon.filter((b) => b.compte !== '411000').some((b) => l.has(b.id))).toBe(false)
  })

  it('rien en trésorerie, et rien sans les ventes facturées', () => {
    const t = jeu('tresorerie')
    expect(lettrer(t.brouillon, t.exports, 'tresorerie').size).toBe(0)
    const { brouillon } = jeu('engagement')
    expect(lettrages(brouillon, [], [], 'engagement', SANS_VENTE_FACTUREE).size).toBe(0)
  })

  it('une écriture à réécrire ne se lettre pas, ni ce qu’elle aurait soldé : le FEC la laisse dehors', () => {
    const { brouillon, exports } = jeu('engagement')
    const perime = brouillon.map((b) => (b.encaissement_id === 'e1' && b.compte === '445710' ? { ...b, montant: 20.01 } : b))
    const l = lettrer(perime, exports)
    // L'encaissement ne se rattache plus : la facture et lui restent sans code, alors même que leur 411 se solde.
    expect(codes(perime, l, (b) => b.facture_id === 'f1' || b.encaissement_id === 'e1')).toEqual(['—'])
    // Ce qui ne dépend pas de lui ne change pas.
    expect(codes(perime, l, (b) => b.facture_id === 'f3' || b.facture_id === 'a1')).toEqual(['A'])
  })

  it('dit, facture par facture, le lettrage ou pourquoi il n’y en a pas', () => {
    const { brouillon, exports } = jeu('engagement')
    const perime = brouillon.map((b) => (b.encaissement_id === 'e1' && b.compte === '445710' ? { ...b, montant: 20.01 } : b))
    const l = lettrer(perime, exports)
    const etats = lettragesDesFactures(perime, exports, 'engagement', l)
    expect(Object.fromEntries([...etats].map(([id, x]) => [id, [x.code, x.motif, x.reste]]))).toEqual({
      f1: [null, 'ecriture_a_reprendre', 0],
      f2: [null, 'reste', 140],
      f3: ['A', null, 0],
    })
    expect(phraseDuLettrage(etats.get('f3')!)).toBe('Lettrée A au 411000 le 18/11/2025 : la facture, ses avoirs et ses encaissements se soldent.')
    expect(phraseDuLettrage(etats.get('f2')!)).toBe(`Non lettrée au 411000 : il reste ${formatMoney(140)} au brouillon, à encaisser ou à écrire.`)
    expect(phraseDuLettrage(etats.get('f1')!)).toMatch(/^Non lettrée au 411000 : ses lignes se soldent, mais une de ses écritures est à réécrire/)
    expect(phraseDuLettrage({ ...etats.get('f2')!, reste: -5 })).toBe(`Non lettrée au 411000 : ${formatMoney(5)} de plus que la facture au brouillon.`)
    expect(phraseDuLettrage({ ...etats.get('f2')!, motif: 'deux_comptes' })).toMatch(/deux comptes de tiers/)
    expect(lettragesDesFactures(perime, exports, 'tresorerie', l).size).toBe(0)
  })

  it('le FEC porte ces codes, une écriture ne porte qu’un lettrage, et l’outil de la DGFiP ne relève rien', () => {
    const { c, brouillon, exports } = jeu('engagement')
    const f = genererFec(brouillon, [], [], [], 'engagement', [], lettrer(brouillon, exports), c.ecritures, OPERATIONS_DE_CAISSE_ABSENTES, CHAMPS_BNC_NON_EXPORTES)
    const lettrees = colonnes(f).slice(1).filter((r) => r[13] !== '')
    expect(lettrees.map((r) => [r[2], r[4], r[13], r[14]])).toEqual([
      ['VE00001', '411000', 'B', '20251120'],
      ['VE00003', '411000', 'A', '20251118'],
      ['VE00004', '411000', 'A', '20251118'],
      ['BQ00001', '411000', 'B', '20251120'],
    ])
    expect(anomaliesDgfip(f)).toEqual([])
  })
})

describe('les comptes de tiers d’un dossier qui a basculé', () => {
  it('rangent chaque facture chez son client, ouverte ou réglée en partie, et jamais parmi les écritures sans pièce', () => {
    const { brouillon, exports } = jeu('engagement')
    const au = (date: string) => comptesDeTiers(brouillon, [], [], [], 'engagement', date, exports)
    // Avant tout encaissement et avant l'avoir du 18/11 : les trois factures ouvertes, chacune pour son TTC.
    expect(au('2025-11-15').map((s) => [s.libelle, s.auxiliaire, s.solde, s.pieces.map((p) => [p.libelle, p.etat, p.reste, p.factureId])])).toEqual([
      ['Client fictif', 'CFICTIF', 180, [['Facture F2025-0001', 'ouverte', 120, 'f1'], ['Facture F2025-0003', 'ouverte', 60, 'f3']]],
      ['Clinique du Parc', 'CCLINIQUE', 240, [['Facture F2025-0002', 'ouverte', 240, 'f2']]],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr')))
    // À la fin de l'année : seule la facture payée en partie reste, avec son reste — ce qui dit pourquoi elle n'est pas lettrée.
    const fin = au('2025-12-31')
    expect(fin.map((s) => [s.libelle, s.origine, s.solde])).toEqual([['Clinique du Parc', 'tiers', 140]])
    expect(fin[0].pieces).toEqual([expect.objectContaining({
      pieceId: 'f2', factureId: 'f2', libelle: 'Facture F2025-0002', etat: 'payee_en_partie', facture: 240, regle: 100, reste: 140,
      dateFacture: '2025-11-12', lettrageManuel: null,
    })])
  })

  it('sans les factures, les lignes tomberaient parmi les écritures sans pièce : le paramètre est obligatoire', () => {
    const { brouillon } = jeu('engagement')
    expect(comptesDeTiers(brouillon, [], [], [], 'engagement', '2025-12-31', SANS_VENTE_FACTUREE).map((s) => s.origine)).toEqual(['sans_piece'])
  })

  it('un client d’avant et d’après la bascule : une seule ligne, sous son compte auxiliaire', () => {
    const { brouillon, exports } = jeu('engagement')
    const vente = pieceDeVente({ id: 'p-vente', tiers: 'Client fictif', date_piece: '2025-11-05' })
    const lignes = lignesPourPiece(D_BASCULE, vente, { compte: '706000', immobilisation: false }, false, [], {
      mode: 'engagement', plan: PLAN_PAR_DEFAUT, compteNotesDeFrais: PLAN_PAR_DEFAUT.associe,
    }).map((l, i): EcritureBrouillon => ({
      ...l, id: `pv-${i}`, ligne_bancaire_id: null, created_at: '2025-11-05T09:00:00Z', immobilisation_id: null, vehicule_id: null,
      declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, ...NON_VALIDEE,
    }))
    const soldes = comptesDeTiers([...lignes, ...brouillon], [vente], [], [], 'engagement', '2025-12-31', exports)
    const fictif = soldes.filter((s) => s.auxiliaire === 'CFICTIF')
    expect(fictif).toHaveLength(1)
    expect(fictif[0].pieces.map((p) => [p.pieceId, p.factureId])).toEqual([['p-vente', undefined]])
  })
})
