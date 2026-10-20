import { describe, expect, it } from 'vitest'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { encaissementVendu, factureVendue, ligneVendue } from '../test/ventesFacturees'
import type { LigneDeFacture } from './encaissementsFactures'
import { ecartDeFrais, justifieSonMouvement } from './encaissementsFactures'
import { auxiliaireDuTiers } from './engagement'
import { montantsDuDocument } from './factureCii'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, ROLES_COMPTABLES, type CleRoleComptable, type PlanComptable } from './planComptable'
import type { ModeComptable, MoyenEncaissement } from './types'
import {
  LIBELLE_MOTIF_VENTE, recettesFactureesParMois, type EncaissementVendu, type FactureVendue, type PartVendue,
  type SourcesVentesFacturees,
} from './ventesFacturees'
import {
  LIBELLE_MOTIF_NON_ECRITE, auxiliaireDeLaLigne, cleFecEncaissement, cleFecFacture, cleFecMouvementEncaissements,
  colonnesDeLaSource, ecrituresDesVentesFacturees, lignesAuBrouillon, memeEcritureQueLeBrouillon, ordreDesLignes,
  refusCompteDeContrepartie, type EcritureVenteFacturee, type EcrituresDesVentesFacturees, type LigneVenteFacturee,
  type MouvementDesEncaissements,
} from './ecrituresVentesFacturees'

// LES ÉCRITURES D'UNE VENTE FACTURÉE (chantier EC-Q3, étape VF4a ; lib/ecrituresVentesFacturees.ts) : chaque cas du § 5
// de la conception, dans les deux modèles comptables et sous les deux plans (le plan par défaut et le plan décalé : aucun
// compte écrit en dur) ; ce qui ne s'écrit pas, et pourquoi ; ce que la base vérifiera à VF4b ; puis un tirage, qui
// confronte les écritures au module des ventes facturées — l'équilibre, la recette, la TVA, le 512 de chaque mouvement.
// Données FICTIVES.

const D = 'd1'
const PLANS: readonly [string, PlanComptable][] = [['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE]]
const MODES: readonly ModeComptable[] = ['tresorerie', 'engagement']

// ── Les jeux ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const facture = (o: Partial<FactureVendue> = {}) => factureVendue({ numero: 'F2025-0001', date_emission: '2025-11-10', ...o })
const avoir = (o: Partial<FactureVendue> = {}) => factureVendue({
  id: 'a1', type: 'avoir', numero: 'A2025-0001', facture_origine_id: 'f1', date_emission: '2025-11-12', ...o,
})
// Une ligne d'avoir : son hors taxe, en quantité négative.
const ligneAvoir = (avoirId: string, ht: number, taux: number): LigneDeFacture => ({ ...ligneVendue(avoirId, ht, taux), quantite: -1 })

/** Un encaissement à un seul taux, et sa part. */
function enc(
  id: string, date: string, montant: number, o: Partial<EncaissementVendu> = {}, taux = 20,
): { encaissement: EncaissementVendu; part: PartVendue } {
  return encaissementVendu({ id, date_encaissement: date, montant, cree_le: `${date}T10:00:00Z`, ...o }, taux)
}

const mvt = (o: Partial<MouvementDesEncaissements> & Pick<MouvementDesEncaissements, 'id' | 'date' | 'montant'>): MouvementDesEncaissements => ({
  dossier_id: D, libelle: 'VIREMENT FICTIF', source_fichier: 'releve-fictif.csv', encaissements_de_factures: true, ...o,
})

interface Jeu {
  factures?: FactureVendue[]
  lignes?: LigneDeFacture[]
  encaissements?: { encaissement: EncaissementVendu; part: PartVendue }[]
  mouvements?: MouvementDesEncaissements[]
  comptes?: Map<string, string>
}

function composer(jeu: Jeu, mode: ModeComptable, plan: PlanComptable): EcrituresDesVentesFacturees {
  const encs = jeu.encaissements ?? []
  const r = ecrituresDesVentesFacturees({
    sources: {
      dossierId: D, factures: jeu.factures ?? [facture()], lignes: jeu.lignes ?? [ligneVendue('f1', 100, 20)],
      encaissements: encs.map((e) => e.encaissement), parts: encs.map((e) => e.part),
    },
    mouvements: jeu.mouvements ?? [], comptesDeContrepartie: jeu.comptes ?? new Map(), mode, plan,
  })
  verifier(r)
  return r
}

// Ce que chaque composition doit tenir, quelle qu'elle soit : des centimes entiers et positifs, une écriture équilibrée,
// des lignes triées et sans doublon, une clé qui dit sa source et sa date, le journal de son genre.
function verifier(r: EcrituresDesVentesFacturees) {
  for (const e of r.ecritures) {
    expect(e.lignes.length, e.cle).toBeGreaterThan(0)
    for (const l of e.lignes) {
      expect(Number.isInteger(l.centimes) && l.centimes > 0, `${e.cle} ${l.compte}`).toBe(true)
    }
    const debit = e.lignes.filter((l) => l.sens === 'debit').reduce((s, l) => s + l.centimes, 0)
    const credit = e.lignes.filter((l) => l.sens === 'credit').reduce((s, l) => s + l.centimes, 0)
    expect(debit, `${e.cle} : équilibrée`).toBe(credit)
    expect([...e.lignes].sort(ordreDesLignes), e.cle).toEqual(e.lignes)
    expect(new Set(e.lignes.map((l) => `${l.compte}|${l.ligneBancaireId}`)).size, e.cle).toBe(e.lignes.length)
    const s = e.source
    if (s.genre === 'mouvement') {
      expect(e.cle).toBe(cleFecMouvementEncaissements(s.ligneBancaireId))
      expect(e.journal).toBe('BQ')
      for (const l of e.lignes) expect(l.ligneBancaireId).toBe(s.ligneBancaireId)
    } else if (s.genre === 'encaissement') {
      expect(e.cle).toBe(cleFecEncaissement(s.encaissementId, e.date))
    } else {
      expect(e.cle).toBe(cleFecFacture(s.factureId, e.date))
      expect(e.journal).toBe('VE')
    }
  }
  expect(new Set(r.ecritures.map((e) => e.cle)).size).toBe(r.ecritures.length)
}

type Attendue = readonly [sens: 'D' | 'C', role: CleRoleComptable | string, centimes: number, mouvement?: string]

// Les lignes attendues, écrites par RÔLE : chacune se lit dans le plan du cas — un compte qui n'est pas un rôle (un compte
// de contrepartie choisi) s'écrit tel quel.
function lignes(plan: PlanComptable, attendues: readonly Attendue[]): LigneVenteFacturee[] {
  return attendues.map(([sens, role, centimes, mouvement]) => ({
    compte: role in plan ? plan[role as CleRoleComptable] : role, sens: sens === 'D' ? 'debit' as const : 'credit' as const,
    centimes, ligneBancaireId: mouvement ?? null,
  })).sort(ordreDesLignes)
}

const ecriture = (r: EcrituresDesVentesFacturees, cle: string): EcritureVenteFacturee => {
  const e = r.ecritures.find((x) => x.cle === cle)
  if (!e) throw new Error(`écriture ${cle} absente : ${r.ecritures.map((x) => x.cle).join(', ')}`)
  return e
}
const cles = (r: EcrituresDesVentesFacturees) => r.ecritures.map((e) => e.cle)

// ── Les cas du § 5 ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe.each(PLANS)('les écritures d’une vente facturée, cas par cas — %s', (_nom, plan) => {
  describe('des services encaissés en une fois, par un virement du même jour', () => {
    const jeu: Jeu = {
      encaissements: [enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' })],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 120 })],
    }

    it('en trésorerie : la banque du mouvement, la recette hors taxe, la TVA collectée — rien à la facture', () => {
      const r = composer(jeu, 'tresorerie', plan)
      expect(cles(r)).toEqual([cleFecEncaissement('e1', '2025-11-20')])
      const e = r.ecritures[0]
      expect(e.lignes).toEqual(lignes(plan, [['D', 'banque', 12000, 'm1'], ['C', 'prestations_de_services', 10000], ['C', 'tva_collectee', 2000]]))
      expect(e.source).toEqual({ genre: 'encaissement', encaissementId: 'e1', factureId: 'f1' })
      // Au journal des ventes, la facture pour pièce : son numéro et sa date d'émission.
      expect([e.journal, e.pieceRef, e.pieceDate, e.date]).toEqual(['VE', 'F2025-0001', '2025-11-10', '2025-11-20'])
      expect(e.libelle).toBe('Encaissement, facture F2025-0001 — Client fictif')
      expect(r.nonEcrites).toEqual([])
    })

    it('en engagement : la créance à la facture, la TVA en attente ; le règlement, et la TVA qui devient exigible', () => {
      const r = composer(jeu, 'engagement', plan)
      expect(cles(r)).toEqual([cleFecFacture('f1', '2025-11-10'), cleFecEncaissement('e1', '2025-11-20')])
      const f = ecriture(r, cleFecFacture('f1', '2025-11-10'))
      expect(f.lignes).toEqual(lignes(plan, [['D', 'clients', 12000], ['C', 'prestations_de_services', 10000], ['C', 'tva_collectee_en_attente', 2000]]))
      expect([f.journal, f.pieceRef, f.pieceDate, f.libelle]).toEqual(['VE', 'F2025-0001', '2025-11-10', 'Facture F2025-0001 — Client fictif'])
      expect(f.source).toEqual({ genre: 'facture', factureId: 'f1' })
      const e = ecriture(r, cleFecEncaissement('e1', '2025-11-20'))
      expect(e.lignes).toEqual(lignes(plan, [
        ['D', 'banque', 12000, 'm1'], ['C', 'clients', 12000], ['D', 'tva_collectee_en_attente', 2000], ['C', 'tva_collectee', 2000],
      ]))
      // Un règlement d'engagement va au journal de banque.
      expect(e.journal).toBe('BQ')
    })
  })

  describe('des services encaissés en trois fois, par chèques remis sans mouvement encore cité', () => {
    const jeu: Jeu = {
      encaissements: [
        enc('e1', '2025-11-12', 40, { moyen: 'cheque' }), enc('e2', '2025-11-14', 40, { moyen: 'cheque' }),
        enc('e3', '2025-11-16', 40, { moyen: 'cheque' }),
      ],
    }

    it.each(MODES)('%s : chaque part porte la TVA de la règle du cumul (667, 666, 667), au 511, jamais recalculée', (mode) => {
      const r = composer(jeu, mode, plan)
      const tva = ['e1', 'e2', 'e3'].map((id) => r.ventes.parts.find((p) => p.encaissementId === id)!.tvaCentimes)
      expect(tva).toEqual([667, 666, 667])
      tva.forEach((v, i) => {
        const e = ecriture(r, cleFecEncaissement(`e${i + 1}`, `2025-11-${12 + 2 * i}`))
        expect(e.lignes).toEqual(lignes(plan, mode === 'tresorerie'
          ? [['D', 'valeurs_a_l_encaissement', 4000], ['C', 'prestations_de_services', 4000 - v], ['C', 'tva_collectee', v]]
          : [['D', 'valeurs_a_l_encaissement', 4000], ['C', 'clients', 4000], ['D', 'tva_collectee_en_attente', v], ['C', 'tva_collectee', v]]))
      })
    })
  })

  describe('un bien, livré à la date de sa facture, dont un acompte est encaissé avant', () => {
    const jeu: Jeu = {
      factures: [facture({ nature_operation: 'biens' })],
      encaissements: [
        enc('e1', '2025-11-05', 60, { ligne_bancaire_id: 'm1' }), enc('e2', '2025-11-20', 60, { ligne_bancaire_id: 'm2' }),
      ],
      mouvements: [mvt({ id: 'm1', date: '2025-11-05', montant: 60 }), mvt({ id: 'm2', date: '2025-11-20', montant: 60 })],
    }

    it('en trésorerie : l’acompte à sa date avec sa TVA ; la TVA du reste à la livraison, au 411 ; le solde l’y solde', () => {
      const r = composer(jeu, 'tresorerie', plan)
      expect(cles(r)).toEqual([cleFecEncaissement('e1', '2025-11-05'), cleFecFacture('f1', '2025-11-10'), cleFecEncaissement('e2', '2025-11-20')])
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-05')).lignes)
        .toEqual(lignes(plan, [['D', 'banque', 6000, 'm1'], ['C', 'ventes_de_biens', 5000], ['C', 'tva_collectee', 1000]]))
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes).toEqual(lignes(plan, [['D', 'clients', 1000], ['C', 'tva_collectee', 1000]]))
      expect(ecriture(r, cleFecEncaissement('e2', '2025-11-20')).lignes)
        .toEqual(lignes(plan, [['D', 'banque', 6000, 'm2'], ['C', 'ventes_de_biens', 5000], ['C', 'clients', 1000]]))
    })

    it('en engagement : l’acompte fait passer sa TVA au 44571 ; la facture porte le reste au 44571, la TVA en attente se solde', () => {
      const r = composer(jeu, 'engagement', plan)
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-05')).lignes).toEqual(lignes(plan, [
        ['D', 'banque', 6000, 'm1'], ['C', 'clients', 6000], ['D', 'tva_collectee_en_attente', 1000], ['C', 'tva_collectee', 1000],
      ]))
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes).toEqual(lignes(plan, [
        ['D', 'clients', 12000], ['C', 'ventes_de_biens', 10000], ['C', 'tva_collectee', 1000], ['C', 'tva_collectee_en_attente', 1000],
      ]))
      expect(ecriture(r, cleFecEncaissement('e2', '2025-11-20')).lignes).toEqual(lignes(plan, [['D', 'banque', 6000, 'm2'], ['C', 'clients', 6000]]))
    })
  })

  describe('un bien livré avant la date de sa facture', () => {
    const jeu: Jeu = { factures: [facture({ nature_operation: 'biens', date_prestation: '2025-11-03' })] }

    it('en trésorerie : la TVA due à la livraison, dans une écriture de la facture datée de la livraison', () => {
      const r = composer(jeu, 'tresorerie', plan)
      expect(cles(r)).toEqual([cleFecFacture('f1', '2025-11-03')])
      const e = r.ecritures[0]
      expect(e.lignes).toEqual(lignes(plan, [['D', 'clients', 2000], ['C', 'tva_collectee', 2000]]))
      // La pièce reste la facture, à sa date d'émission.
      expect([e.pieceRef, e.pieceDate, e.date]).toEqual(['F2025-0001', '2025-11-10', '2025-11-03'])
    })

    it('en engagement : la facture à sa date, la TVA en attente ; à la livraison, elle passe au 44571', () => {
      const r = composer(jeu, 'engagement', plan)
      expect(cles(r)).toEqual([cleFecFacture('f1', '2025-11-03'), cleFecFacture('f1', '2025-11-10')])
      expect(ecriture(r, cleFecFacture('f1', '2025-11-03')).lignes)
        .toEqual(lignes(plan, [['D', 'tva_collectee_en_attente', 2000], ['C', 'tva_collectee', 2000]]))
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes)
        .toEqual(lignes(plan, [['D', 'clients', 12000], ['C', 'ventes_de_biens', 10000], ['C', 'tva_collectee_en_attente', 2000]]))
    })
  })

  describe('des services sur l’option pour les débits', () => {
    const jeu: Jeu = {
      factures: [facture({ option_debits: true })],
      encaissements: [enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' })],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 120 })],
    }

    it('en trésorerie : la TVA due à la facture, au 411 ; l’encaissement la solde', () => {
      const r = composer(jeu, 'tresorerie', plan)
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes).toEqual(lignes(plan, [['D', 'clients', 2000], ['C', 'tva_collectee', 2000]]))
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-20')).lignes)
        .toEqual(lignes(plan, [['D', 'banque', 12000, 'm1'], ['C', 'prestations_de_services', 10000], ['C', 'clients', 2000]]))
    })

    it('en engagement : la TVA au 44571 dès la facture, rien en attente ; l’encaissement solde la créance', () => {
      const r = composer(jeu, 'engagement', plan)
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes)
        .toEqual(lignes(plan, [['D', 'clients', 12000], ['C', 'prestations_de_services', 10000], ['C', 'tva_collectee', 2000]]))
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-20')).lignes).toEqual(lignes(plan, [['D', 'banque', 12000, 'm1'], ['C', 'clients', 12000]]))
    })
  })

  describe('un avoir', () => {
    it('de services, en trésorerie : rien à lui ; l’encaissement du net porte la TVA nette', () => {
      const r = composer({
        factures: [facture(), avoir()], lignes: [ligneVendue('f1', 100, 20), ligneAvoir('a1', 20, 20)],
        encaissements: [enc('e1', '2025-11-20', 96, { moyen: 'cheque' })],
      }, 'tresorerie', plan)
      expect(cles(r)).toEqual([cleFecEncaissement('e1', '2025-11-20')])
      expect(r.ecritures[0].lignes)
        .toEqual(lignes(plan, [['D', 'valeurs_a_l_encaissement', 9600], ['C', 'prestations_de_services', 8000], ['C', 'tva_collectee', 1600]]))
    })

    it('de services, en engagement : l’inverse de sa facture, à sa date, sous sa propre pièce', () => {
      const r = composer({
        factures: [facture(), avoir()], lignes: [ligneVendue('f1', 100, 20), ligneAvoir('a1', 20, 20)],
        encaissements: [enc('e1', '2025-11-20', 96, { moyen: 'cheque' })],
      }, 'engagement', plan)
      const a = ecriture(r, cleFecFacture('a1', '2025-11-12'))
      expect(a.lignes).toEqual(lignes(plan, [['C', 'clients', 2400], ['D', 'prestations_de_services', 2000], ['D', 'tva_collectee_en_attente', 400]]))
      expect(a.source).toEqual({ genre: 'avoir', factureId: 'a1' })
      expect([a.journal, a.pieceRef, a.pieceDate, a.libelle]).toEqual(['VE', 'A2025-0001', '2025-11-12', 'Avoir A2025-0001 — Client fictif'])
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-20')).lignes).toEqual(lignes(plan, [
        ['D', 'valeurs_a_l_encaissement', 9600], ['C', 'clients', 9600], ['D', 'tva_collectee_en_attente', 1600], ['C', 'tva_collectee', 1600],
      ]))
    })

    it('d’un bien, daté après la livraison : sa TVA quitte le 44571 à sa date, dans les deux modèles', () => {
      const jeu: Jeu = {
        factures: [facture({ nature_operation: 'biens' }), avoir({ date_emission: '2025-11-15' })],
        lignes: [ligneVendue('f1', 100, 20), ligneAvoir('a1', 20, 20)],
      }
      expect(ecriture(composer(jeu, 'tresorerie', plan), cleFecFacture('a1', '2025-11-15')).lignes)
        .toEqual(lignes(plan, [['D', 'tva_collectee', 400], ['C', 'clients', 400]]))
      expect(ecriture(composer(jeu, 'engagement', plan), cleFecFacture('a1', '2025-11-15')).lignes)
        .toEqual(lignes(plan, [['C', 'clients', 2400], ['D', 'ventes_de_biens', 2000], ['D', 'tva_collectee', 400]]))
    })

    it('d’un bien, daté au plus tard de la livraison : déjà déduit de la TVA de la livraison — en trésorerie, rien à lui', () => {
      const jeu: Jeu = {
        factures: [facture({ nature_operation: 'biens', date_prestation: '2025-11-20' }), avoir({ date_emission: '2025-11-15' })],
        lignes: [ligneVendue('f1', 100, 20), ligneAvoir('a1', 20, 20)],
      }
      const r = composer(jeu, 'tresorerie', plan)
      expect(cles(r)).toEqual([cleFecFacture('f1', '2025-11-20')])
      expect(r.ecritures[0].lignes).toEqual(lignes(plan, [['D', 'clients', 1600], ['C', 'tva_collectee', 1600]]))
    })
  })

  describe('une contre-passation', () => {
    // Un chèque remis le 12, crédité le 14, revenu impayé le 25 : la contre-passation cite le débit qui a défait l'argent.
    const jeu: Jeu = {
      encaissements: [
        enc('e1', '2025-11-12', 120, { moyen: 'cheque', ligne_bancaire_id: 'm1' }),
        enc('c1', '2025-11-25', -120, { moyen: 'cheque', annule_id: 'e1', ligne_bancaire_id: 'm2' }),
      ],
      mouvements: [mvt({ id: 'm1', date: '2025-11-14', montant: 120 }), mvt({ id: 'm2', date: '2025-11-25', montant: -120, libelle: 'CHEQUE IMPAYE FICTIF' })],
    }

    it.each(MODES)('%s : un chèque impayé — l’inverse de l’encaissement, à la banque du débit qui le défait', (mode) => {
      const r = composer(jeu, mode, plan)
      expect(r.nonEcrites).toEqual([])
      const c = ecriture(r, cleFecEncaissement('c1', '2025-11-25'))
      expect(c.libelle).toBe('Contre-passation, facture F2025-0001 — Client fictif')
      expect(c.lignes).toEqual(lignes(plan, mode === 'tresorerie'
        ? [['C', 'banque', 12000, 'm2'], ['D', 'prestations_de_services', 10000], ['D', 'tva_collectee', 2000]]
        : [['C', 'banque', 12000, 'm2'], ['D', 'clients', 12000], ['C', 'tva_collectee_en_attente', 2000], ['D', 'tva_collectee', 2000]]))
      // Le chèque était passé au 511, que le crédit du 14 solde ; le débit du 25, du même jour, n'a rien à écrire de plus.
      expect(ecriture(r, cleFecMouvementEncaissements('m1')).lignes)
        .toEqual(lignes(plan, [['D', 'banque', 12000, 'm1'], ['C', 'valeurs_a_l_encaissement', 12000, 'm1']]))
      expect(cles(r)).not.toContain(cleFecMouvementEncaissements('m2'))
    })

    it('sans mouvement, elle défait l’encaissement là où il a été écrit : la banque du mouvement, qui n’est plus justifié', () => {
      const r = composer({
        encaissements: [
          enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' }),
          enc('c1', '2025-11-22', -120, { annule_id: 'e1' }),
        ],
        mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 120 })],
      }, 'tresorerie', plan)
      expect(ecriture(r, cleFecEncaissement('c1', '2025-11-22')).lignes)
        .toEqual(lignes(plan, [['C', 'banque', 12000, 'm1'], ['D', 'prestations_de_services', 10000], ['D', 'tva_collectee', 2000]]))
      // Le mouvement ne justifie plus rien : il n'a pas d'écriture, et son 512 se solde à zéro.
      expect(cles(r)).not.toContain(cleFecMouvementEncaissements('m1'))
      expect(banqueDuMouvement(r, 'm1')).toBe(0)
    })
  })

  describe('un mouvement qui porte plusieurs encaissements', () => {
    // Deux factures, payées par un seul virement : l'une le jour même, l'autre deux jours avant (passée au 511).
    const base = (montant: number, o: Partial<MouvementDesEncaissements> = {}): Jeu => ({
      factures: [facture(), facture({ id: 'f2', numero: 'F2025-0002' })],
      lignes: [ligneVendue('f1', 100, 20), ligneVendue('f2', 50, 20)],
      encaissements: [
        enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' }),
        enc('e2', '2025-11-18', 60, { facture_id: 'f2', ligne_bancaire_id: 'm1' }),
      ],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant, ...o })],
    })

    it.each(MODES)('%s : sous l’écart des frais — la banque du reste, le 511 de l’autre jour, le 627 de l’écart', (mode) => {
      const r = composer(base(178.5), mode, plan)
      expect(ecriture(r, cleFecEncaissement('e2', '2025-11-18')).lignes).toContainEqual(
        lignes(plan, [['D', 'valeurs_a_l_encaissement', 6000]])[0])
      const m = ecriture(r, cleFecMouvementEncaissements('m1'))
      expect(m.lignes).toEqual(lignes(plan, [
        ['D', 'banque', 5850, 'm1'], ['C', 'valeurs_a_l_encaissement', 6000, 'm1'], ['D', 'services_bancaires', 150, 'm1'],
      ]))
      expect([m.journal, m.pieceRef, m.pieceDate, m.date, m.libelle, m.tiers]).toEqual(['BQ', 'releve-fictif.csv', '2025-11-20', '2025-11-20', 'VIREMENT FICTIF', null])
      expect(m.source).toEqual({ genre: 'mouvement', ligneBancaireId: 'm1' })
      // Le 512 du mouvement fait exactement son montant.
      expect(banqueDuMouvement(r, 'm1')).toBe(17850)
    })

    it('au seuil — min(2 %, 5 €) de 180 €, 3,60 € — il s’écrit ; un centime au-delà, il ne s’écrit pas, et le dit', () => {
      expect(ecartDeFrais(360, 18000)).toBe(true)
      expect(ecartDeFrais(361, 18000)).toBe(false)
      const auSeuil = composer(base(176.4), 'tresorerie', plan)
      expect(ecriture(auSeuil, cleFecMouvementEncaissements('m1')).lignes).toContainEqual(
        lignes(plan, [['D', 'services_bancaires', 360, 'm1']])[0])
      const auDela = composer(base(176.39), 'tresorerie', plan)
      expect(cles(auDela)).not.toContain(cleFecMouvementEncaissements('m1'))
      expect(auDela.nonEcrites).toEqual([{
        source: { genre: 'mouvement', ligneBancaireId: 'm1' }, motif: 'mouvement_ecart',
        detail: `${LIBELLE_MOTIF_NON_ECRITE.mouvement_ecart} (mouvement du 2025-11-20)`,
      }])
      // Des encaissements qui dépassent le crédit à rebours (un crédit plus fort) ne s'écrivent pas non plus.
      expect(composer(base(180.01), 'tresorerie', plan).nonEcrites.map((n) => n.motif)).toEqual(['mouvement_ecart'])
    })

    it('tout du même jour, sans écart : le mouvement n’a rien à écrire', () => {
      const r = composer({ ...base(180), encaissements: [
        enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' }),
        enc('e2', '2025-11-20', 60, { facture_id: 'f2', ligne_bancaire_id: 'm1' }),
      ] }, 'tresorerie', plan)
      expect(cles(r)).not.toContain(cleFecMouvementEncaissements('m1'))
      expect(r.nonEcrites).toEqual([])
      expect(banqueDuMouvement(r, 'm1')).toBe(18000)
    })

    it('pas encore classé, mais sans rien à écrire (tout du même jour, sans écart) : rien n’attend, rien ne se dit', () => {
      const r = composer({ ...base(180, { encaissements_de_factures: false }), encaissements: [
        enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' }),
        enc('e2', '2025-11-20', 60, { facture_id: 'f2', ligne_bancaire_id: 'm1' }),
      ] }, 'tresorerie', plan)
      expect(r.nonEcrites).toEqual([])
      expect(cles(r)).not.toContain(cleFecMouvementEncaissements('m1'))
    })

    it('pas encore classé par ses encaissements : son écriture attend, et le dit', () => {
      const r = composer(base(178.5, { encaissements_de_factures: false }), 'tresorerie', plan)
      expect(cles(r)).not.toContain(cleFecMouvementEncaissements('m1'))
      expect(r.nonEcrites).toEqual([{
        source: { genre: 'mouvement', ligneBancaireId: 'm1' }, motif: 'mouvement_non_classe',
        detail: `${LIBELLE_MOTIF_NON_ECRITE.mouvement_non_classe} (mouvement du 2025-11-20)`,
      }])
      // Les encaissements, eux, s'écrivent.
      expect(cles(r)).toEqual([cleFecEncaissement('e2', '2025-11-18'), cleFecEncaissement('e1', '2025-11-20')])
    })
  })

  describe('des espèces', () => {
    it.each(MODES)('%s : à la caisse ; déposées un autre jour, le mouvement les fait passer de la caisse à la banque', (mode) => {
      const r = composer({
        factures: [facture(), facture({ id: 'f2', numero: 'F2025-0002' })],
        lignes: [ligneVendue('f1', 100, 20), ligneVendue('f2', 50, 20)],
        encaissements: [
          enc('e1', '2025-11-20', 120, { moyen: 'especes' }),
          enc('e2', '2025-11-21', 60, { facture_id: 'f2', moyen: 'especes', ligne_bancaire_id: 'm1' }),
        ],
        mouvements: [mvt({ id: 'm1', date: '2025-11-24', montant: 60, libelle: 'VERSEMENT ESPECES FICTIF' })],
      }, mode, plan)
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-20')).lignes).toContainEqual(lignes(plan, [['D', 'caisse', 12000]])[0])
      expect(ecriture(r, cleFecEncaissement('e2', '2025-11-21')).lignes).toContainEqual(lignes(plan, [['D', 'caisse', 6000]])[0])
      expect(ecriture(r, cleFecMouvementEncaissements('m1')).lignes)
        .toEqual(lignes(plan, [['D', 'banque', 6000, 'm1'], ['C', 'caisse', 6000, 'm1']]))
    })
  })

  describe('une compensation', () => {
    const jeu = (comptes: Map<string, string>, moyen: MoyenEncaissement = 'compensation'): Jeu => ({
      encaissements: [enc('e1', '2025-11-20', 120, { moyen })], comptes,
    })

    it.each(MODES)('%s : sur le compte de bilan que le cabinet a choisi — ici la dette envers le client, aussi fournisseur', (mode) => {
      const r = composer(jeu(new Map([['e1', plan.fournisseurs]])), mode, plan)
      expect(r.ecritures.at(-1)!.lignes).toContainEqual(lignes(plan, [['D', 'fournisseurs', 12000]])[0])
      expect(r.nonEcrites).toEqual([])
    })

    it('sans compte choisi, l’encaissement ne s’écrit pas, et le dit — par compensation comme par un autre moyen', () => {
      for (const moyen of ['compensation', 'autre'] as const) {
        const r = composer(jeu(new Map(), moyen), 'tresorerie', plan)
        expect(r.ecritures).toEqual([])
        expect(r.nonEcrites).toEqual([{
          source: { genre: 'encaissement', encaissementId: 'e1', factureId: 'f1' }, motif: 'compte_a_choisir',
          detail: `${LIBELLE_MOTIF_NON_ECRITE.compte_a_choisir} (encaissement du 2025-11-20)`,
        }])
      }
    })

    it('un compte choisi que la contrepartie refuse ne s’écrit pas, et dit pourquoi', () => {
      const r = composer(jeu(new Map([['e1', plan.clients]])), 'engagement', plan)
      expect(r.ecritures.map((e) => e.source.genre)).toEqual(['facture'])
      expect(r.nonEcrites).toEqual([{
        source: { genre: 'encaissement', encaissementId: 'e1', factureId: 'f1' }, motif: 'compte_refuse',
        detail: `${LIBELLE_MOTIF_NON_ECRITE.compte_refuse} (${plan.clients} : ${refusCompteDeContrepartie(plan.clients, plan)})`,
      }])
    })
  })

  describe('une facture en franchise ou exonérée : des lignes à 0 %', () => {
    const jeu: Jeu = {
      lignes: [ligneVendue('f1', 100, 0)],
      encaissements: [enc('e1', '2025-11-20', 100, { ligne_bancaire_id: 'm1' }, 0)],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 100 })],
    }

    it('en trésorerie : la recette au TTC, aucune TVA', () => {
      expect(composer(jeu, 'tresorerie', plan).ecritures[0].lignes)
        .toEqual(lignes(plan, [['D', 'banque', 10000, 'm1'], ['C', 'prestations_de_services', 10000]]))
    })

    it('en engagement : la créance au TTC, aucune TVA, ni en attente ni collectée', () => {
      const r = composer(jeu, 'engagement', plan)
      expect(ecriture(r, cleFecFacture('f1', '2025-11-10')).lignes).toEqual(lignes(plan, [['D', 'clients', 10000], ['C', 'prestations_de_services', 10000]]))
      expect(ecriture(r, cleFecEncaissement('e1', '2025-11-20')).lignes).toEqual(lignes(plan, [['D', 'banque', 10000, 'm1'], ['C', 'clients', 10000]]))
    })
  })

  describe('une facture à deux taux', () => {
    it.each(MODES)('%s : une part par taux, une ligne par compte — la TVA des deux taux réunie au 44571', (mode) => {
      // Un encaissement à deux taux : deux parts au registre (G7.45), dont le module tire la TVA de chacune.
      const deux = ecrituresDesVentesFacturees({
        sources: {
          dossierId: D, factures: [facture()], lignes: [ligneVendue('f1', 100, 20), { ...ligneVendue('f1', 50, 5.5), ordre: 2 }],
          encaissements: [enc('e1', '2025-11-20', 172.75, { ligne_bancaire_id: 'm1' }).encaissement],
          parts: [{ encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 120 }, { encaissement_id: 'e1', dossier_id: D, taux: 5.5, montant: 52.75 }],
        },
        mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 172.75 })], comptesDeContrepartie: new Map(), mode, plan,
      })
      verifier(deux)
      expect(ecriture(deux, cleFecEncaissement('e1', '2025-11-20')).lignes).toEqual(lignes(plan, mode === 'tresorerie'
        ? [['D', 'banque', 17275, 'm1'], ['C', 'prestations_de_services', 15000], ['C', 'tva_collectee', 2275]]
        : [['D', 'banque', 17275, 'm1'], ['C', 'clients', 17275], ['D', 'tva_collectee_en_attente', 2275], ['C', 'tva_collectee', 2275]]))
    })
  })
})

// La banque d'un mouvement, nette, sur toutes les écritures : ce que le relevé doit retrouver.
function banqueDuMouvement(r: EcrituresDesVentesFacturees, mouvementId: string, plan: PlanComptable = PLAN_PAR_DEFAUT): number {
  let net = 0
  for (const e of r.ecritures) {
    for (const l of e.lignes) {
      if (l.ligneBancaireId === mouvementId && (l.compte === plan.banque || l.compte === PLAN_DECALE.banque)) {
        net += l.sens === 'debit' ? l.centimes : -l.centimes
      }
    }
  }
  return net
}

// ── Ce qui ne s'écrit pas ─────────────────────────────────────────────────────────────────────────────────────────────

describe('ce qui ne s’écrit pas se dit, avec sa raison', () => {
  it('une facture que le module écarte — mixte, ou sans nature — ne s’écrit pas, ni ses encaissements, ni leur mouvement', () => {
    for (const nature of ['mixte', null] as const) {
      const r = composer({
        factures: [facture({ nature_operation: nature })],
        encaissements: [enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' })],
        mouvements: [mvt({ id: 'm1', date: '2025-11-21', montant: 120 })],
      }, 'engagement', PLAN_PAR_DEFAUT)
      expect(r.ecritures).toEqual([])
      expect(r.nonEcrites).toEqual([
        { source: { genre: 'facture', factureId: 'f1' }, motif: 'vente_ecartee', detail: `${LIBELLE_MOTIF_NON_ECRITE.vente_ecartee} (${LIBELLE_MOTIF_VENTE.nature})` },
        { source: { genre: 'mouvement', ligneBancaireId: 'm1' }, motif: 'mouvement_vente_ecartee', detail: LIBELLE_MOTIF_NON_ECRITE.mouvement_vente_ecartee },
      ])
    }
  })

  it('un encaissement qui cite un mouvement qu’on n’a pas lu : on ne sait pas s’il est du même jour', () => {
    const r = composer({ encaissements: [enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm-absent' })] }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(r.ecritures).toEqual([])
    expect(r.nonEcrites).toEqual([{
      source: { genre: 'encaissement', encaissementId: 'e1', factureId: 'f1' }, motif: 'mouvement_inconnu',
      detail: `${LIBELLE_MOTIF_NON_ECRITE.mouvement_inconnu} (encaissement du 2025-11-20)`,
    }])
    // Sa contre-passation sans mouvement, qui le défait là où il aurait été écrit, ne s'écrit pas davantage.
    const avecContre = composer({ encaissements: [
      enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm-absent' }), enc('c1', '2025-11-22', -120, { annule_id: 'e1' }),
    ] }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(avecContre.ecritures).toEqual([])
    expect(avecContre.nonEcrites.map((n) => [n.source, n.motif])).toEqual([
      [{ genre: 'encaissement', encaissementId: 'e1', factureId: 'f1' }, 'mouvement_inconnu'],
      [{ genre: 'encaissement', encaissementId: 'c1', factureId: 'f1' }, 'mouvement_inconnu'],
    ])
  })

  it('un mouvement qui porte aussi l’encaissement d’une facture qui n’est pas source (VF2-Q2) : à concevoir, il ne s’écrit pas', () => {
    const r = composer({
      factures: [facture(), facture({ id: 'f9', numero: 'F2025-0009', source_de_la_vente: false })],
      lignes: [ligneVendue('f1', 100, 20), ligneVendue('f9', 50, 20)],
      encaissements: [
        enc('e1', '2025-11-19', 120, { ligne_bancaire_id: 'm1' }),
        enc('e9', '2025-11-20', 60, { facture_id: 'f9', ligne_bancaire_id: 'm1' }),
      ],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 180 })],
    }, 'tresorerie', PLAN_PAR_DEFAUT)
    // L'encaissement de la facture source s'écrit (au 511 : son mouvement est d'un autre jour) ; celui de l'autre facture,
    // compté par sa pièce, n'est pas une vente facturée.
    expect(cles(r)).toEqual([cleFecEncaissement('e1', '2025-11-19')])
    expect(r.nonEcrites).toEqual([{
      source: { genre: 'mouvement', ligneBancaireId: 'm1' }, motif: 'mouvement_facture_non_source',
      detail: LIBELLE_MOTIF_NON_ECRITE.mouvement_facture_non_source,
    }])
  })

  it('un mouvement au montant illisible (plus de deux décimales) ne s’écrit pas', () => {
    const r = composer({
      encaissements: [enc('e1', '2025-11-19', 120, { ligne_bancaire_id: 'm1' })],
      mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 119.995 })],
    }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(r.nonEcrites).toEqual([{
      source: { genre: 'mouvement', ligneBancaireId: 'm1' }, motif: 'mouvement_ecart',
      detail: `${LIBELLE_MOTIF_NON_ECRITE.mouvement_ecart} (un montant illisible)`,
    }])
  })

  it('la contre-passation d’une compensation la défait sur le compte choisi pour l’encaissement qu’elle annule', () => {
    const r = composer({
      encaissements: [
        enc('e1', '2025-11-20', 120, { moyen: 'compensation' }), enc('c1', '2025-11-21', -120, { moyen: 'compensation', annule_id: 'e1' }),
      ],
      comptes: new Map([['e1', '467200']]),
    }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(ecriture(r, cleFecEncaissement('c1', '2025-11-21')).lignes)
      .toEqual(lignes(PLAN_PAR_DEFAUT, [['C', '467200', 12000], ['D', 'prestations_de_services', 10000], ['D', 'tva_collectee', 2000]]))
  })

  it('un encaissement retiré ne s’écrit pas, et ne compte pas dans son mouvement', () => {
    const r = composer({
      encaissements: [
        enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1', retire_le: '2025-11-21T09:00:00Z' }),
        enc('e2', '2025-11-21', 120, { ligne_bancaire_id: 'm1' }),
      ],
      mouvements: [mvt({ id: 'm1', date: '2025-11-21', montant: 120 })],
    }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(cles(r)).toEqual([cleFecEncaissement('e2', '2025-11-21')])
    expect(r.nonEcrites).toEqual([])
  })
})

describe('refusCompteDeContrepartie — l’hypothèse de VF4a', () => {
  it.each(PLANS)('%s : un compte de bilan, ni le 411, ni la trésorerie du plan, ni la TVA', (_nom, plan) => {
    expect(refusCompteDeContrepartie(plan.fournisseurs, plan)).toBeNull()
    expect(refusCompteDeContrepartie('4672000', plan)).toBeNull()
    for (const compte of ['606100', '706200', '61', 'abc123', '12345678901', '0123456']) {
      expect(refusCompteDeContrepartie(compte, plan), compte).toBe('Un compte de contrepartie est un compte de bilan, de classe 1 à 5, de six à dix chiffres.')
    }
    expect(refusCompteDeContrepartie(plan.clients, plan)).toMatch(/^Le compte des clients/)
    for (const compte of [plan.banque, plan.valeurs_a_l_encaissement, plan.caisse]) {
      expect(refusCompteDeContrepartie(compte, plan), compte).toMatch(/^Un encaissement par la banque/)
    }
    expect(refusCompteDeContrepartie(plan.tva_deductible, plan)).toMatch(/^Un compte de TVA/)
  })
})

// ── Ce que la base vérifiera (VF4b), et ce que le FEC lira (VF4c) ───────────────────────────────────────────────────

describe('chaque écriture porte sa source, et se recompose à l’identique depuis ses lignes', () => {
  const r = composer({
    factures: [facture(), avoir()], lignes: [ligneVendue('f1', 100, 20), ligneAvoir('a1', 20, 20)],
    encaissements: [enc('e1', '2025-11-18', 96, { moyen: 'cheque', ligne_bancaire_id: 'm1' })],
    mouvements: [mvt({ id: 'm1', date: '2025-11-20', montant: 95.5 })],
  }, 'engagement', PLAN_PAR_DEFAUT)

  it('les colonnes de la source : une seule des deux, ou aucune pour un mouvement (la garde de VF2)', () => {
    expect(r.ecritures.map((e) => [e.source.genre, colonnesDeLaSource(e.source)])).toEqual([
      ['facture', { facture_id: 'f1', encaissement_id: null }],
      ['avoir', { facture_id: 'a1', encaissement_id: null }],
      ['encaissement', { facture_id: null, encaissement_id: 'e1' }],
      ['mouvement', { facture_id: null, encaissement_id: null }],
    ])
  })

  it('les lignes du brouillon : proposées, sans pièce, en euros, liées à la source — et relues, la même écriture', () => {
    for (const e of r.ecritures) {
      const brouillon = lignesAuBrouillon(D, e)
      expect(brouillon).toHaveLength(e.lignes.length)
      for (const b of brouillon) {
        expect(b).toMatchObject({ dossier_id: D, piece_id: null, statut: 'proposee', date: e.date, libelle: e.libelle, ...colonnesDeLaSource(e.source) })
      }
      expect(brouillon.map((b) => Math.round(b.montant * 100))).toEqual(e.lignes.map((l) => l.centimes))
      expect(memeEcritureQueLeBrouillon(e, brouillon), e.cle).toBe(true)
      // Dans le désordre aussi : la base ne rend pas ses lignes dans un ordre promis.
      expect(memeEcritureQueLeBrouillon(e, [...brouillon].reverse()), e.cle).toBe(true)
    }
  })

  it('un centime, un compte, un sens, une date, une source, un mouvement, une ligne de plus ou de moins : une autre écriture', () => {
    const e = ecriture(r, cleFecMouvementEncaissements('m1'))
    const b = lignesAuBrouillon(D, e)
    const variantes = [
      b.map((x, i) => (i === 0 ? { ...x, montant: x.montant + 0.01 } : x)),
      b.map((x, i) => (i === 0 ? { ...x, compte: '512900' } : x)),
      b.map((x, i) => (i === 0 ? { ...x, sens: x.sens === 'debit' ? 'credit' as const : 'debit' as const } : x)),
      b.map((x, i) => (i === 0 ? { ...x, date: '2025-11-21' } : x)),
      b.map((x, i) => (i === 0 ? { ...x, encaissement_id: 'e1' } : x)),
      b.map((x, i) => (i === 0 ? { ...x, ligne_bancaire_id: null } : x)),
      [...b, b[0]],
      b.slice(1),
      b.map((x, i) => (i === 0 ? { ...x, montant: -x.montant } : x)),
    ]
    for (const v of variantes) expect(memeEcritureQueLeBrouillon(e, v)).toBe(false)
    // Et sur l'écriture d'une facture, sa colonne : nulle, ou celle d'un autre document.
    const f = ecriture(r, cleFecFacture('f1', '2025-11-10'))
    const bf = lignesAuBrouillon(D, f)
    expect(memeEcritureQueLeBrouillon(f, bf)).toBe(true)
    expect(memeEcritureQueLeBrouillon(f, bf.map((x, i) => (i === 0 ? { ...x, facture_id: null } : x)))).toBe(false)
    expect(memeEcritureQueLeBrouillon(f, bf.map((x, i) => (i === 0 ? { ...x, facture_id: 'a1' } : x)))).toBe(false)
    // Le libellé n'en décide pas.
    expect(memeEcritureQueLeBrouillon(e, b.map((x) => ({ ...x, libelle: 'autre' })))).toBe(true)
  })

  it('l’ordre des lignes : le compte, le débit avant le crédit, puis le mouvement', () => {
    const l = (compte: string, sens: 'debit' | 'credit', ligneBancaireId: string | null = null): LigneVenteFacturee =>
      ({ compte, sens, centimes: 1, ligneBancaireId })
    expect([l('512000', 'credit', 'm2'), l('512000', 'debit', 'm2'), l('411000', 'credit'), l('512000', 'debit', 'm1')].sort(ordreDesLignes))
      .toEqual([l('411000', 'credit'), l('512000', 'debit', 'm1'), l('512000', 'debit', 'm2'), l('512000', 'credit', 'm2')])
  })

  it('un mouvement d’un autre dossier, même cité sous son identifiant, n’est pas lu : l’encaissement le dit inconnu', () => {
    const r2 = composer({
      encaissements: [enc('e1', '2025-11-20', 120, { ligne_bancaire_id: 'm1' })],
      mouvements: [mvt({ id: 'm1', dossier_id: 'd2', date: '2025-11-20', montant: 120 })],
    }, 'tresorerie', PLAN_PAR_DEFAUT)
    expect(r2.ecritures).toEqual([])
    expect(r2.nonEcrites.map((n) => n.motif)).toEqual(['mouvement_inconnu'])
  })

  it('les clés du FEC : une source, une date', () => {
    expect(cleFecFacture('f1', '2025-11-10')).toBe('facture|f1|2025-11-10')
    expect(cleFecEncaissement('e1', '2025-11-18')).toBe('encaissement|e1|2025-11-18')
    expect(cleFecMouvementEncaissements('m1')).toBe('mouvement-encaissements|m1')
    expect(cles(r)).toEqual(['facture|f1|2025-11-10', 'facture|a1|2025-11-12', 'encaissement|e1|2025-11-18', 'mouvement-encaissements|m1'])
  })

  it('l’auxiliaire du 411 est celui d’une pièce de vente du même client : « C » et la clé de son nom', () => {
    const f = ecriture(r, cleFecFacture('f1', '2025-11-10'))
    const quatreCentOnze = f.lignes.find((l) => l.compte === PLAN_PAR_DEFAUT.clients)!
    const pieceDeVente = auxiliaireDuTiers({ tiers: 'Client fictif' }, PLAN_PAR_DEFAUT.clients)
    expect(pieceDeVente?.num).toMatch(/^C/)
    expect(auxiliaireDeLaLigne(f, quatreCentOnze)).toEqual(pieceDeVente)
    expect(auxiliaireDeLaLigne(f, f.lignes.find((l) => l.compte === PLAN_PAR_DEFAUT.prestations_de_services)!)).toBeNull()
    const m = ecriture(r, cleFecMouvementEncaissements('m1'))
    expect(m.lignes.map((l) => auxiliaireDeLaLigne(m, l))).toEqual(m.lignes.map(() => null))
  })

  it('la composition ne dépend que des lignes : lues dans un autre ordre, ou avec celles d’un autre dossier, elle rend la même chose', () => {
    const encs = [enc('e1', '2025-11-18', 96, { moyen: 'cheque', ligne_bancaire_id: 'm1' })]
    const autreDossier = { ...enc('x1', '2025-11-18', 96, { dossier_id: 'd2', ligne_bancaire_id: 'm1' }) }
    const r2 = ecrituresDesVentesFacturees({
      sources: {
        dossierId: D, factures: [avoir(), facture({ ...facture(), id: 'fx', dossier_id: 'd2' }), facture()],
        lignes: [ligneAvoir('a1', 20, 20), ligneVendue('f1', 100, 20)],
        encaissements: [autreDossier.encaissement, ...encs.map((e) => e.encaissement)], parts: [autreDossier.part, ...encs.map((e) => e.part)],
      },
      mouvements: [mvt({ id: 'm9', dossier_id: 'd2', date: '2025-11-20', montant: 3 }), mvt({ id: 'm1', date: '2025-11-20', montant: 95.5 })],
      comptesDeContrepartie: new Map(), mode: 'engagement', plan: PLAN_PAR_DEFAUT,
    })
    expect(JSON.stringify(r2.ecritures)).toBe(JSON.stringify(r.ecritures))
    expect(r2.nonEcrites).toEqual(r.nonEcrites)
  })
})

// ── Le tirage ──────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Tire {
  sources: SourcesVentesFacturees
  mouvements: MouvementDesEncaissements[]
  comptes: Map<string, string>
}

const TAUX_TIRES = [20, 10, 5.5, 0] as const
const MOYENS: readonly MoyenEncaissement[] = ['virement', 'cheque', 'carte', 'prelevement', 'effet', 'especes', 'compensation', 'autre']
const CONTREPARTIES = ['467200', '401500'] as const

const jourDe = (n: number) => new Date(Date.UTC(2026, 2, 1 + n)).toISOString().slice(0, 10)

// Un dossier tiré : une à trois factures (services, biens, débits ; un ou deux taux, 0 % compris), puis, jour après jour,
// des encaissements par tous les moyens — qui citent un mouvement du même jour, d'un autre jour, partagé avec d'autres,
// ou n'en citent pas —, des avoirs, des contre-passations (sans mouvement, ou citant le débit qui défait l'argent) ; et les
// mouvements, montés sur ce que leurs encaissements justifient, moins des frais sous le seuil, classés par eux.
function tirerUnDossier(suivant: () => number, numero: number): Tire {
  const entier = (n: number) => entierTire(suivant, n)
  const factures: FactureVendue[] = []
  const lignesDeFacture: LigneDeFacture[] = []
  const encaissements: EncaissementVendu[] = []
  const parts: PartVendue[] = []
  const mouvements: MouvementDesEncaissements[] = []
  const comptes = new Map<string, string>()
  let horloge = 0
  let jour = entier(5)

  for (let k = 0; k < 1 + entier(3); k++) {
    const id = `t${numero}-f${k}`
    const f = factureVendue({
      id, numero: `F${numero}-${k}`, dossier_id: D, date_emission: jourDe(3 + entier(15)),
      nature_operation: entier(3) === 0 ? 'biens' : 'services', option_debits: entier(3) === 0,
      date_prestation: entier(3) === 0 ? jourDe(1 + entier(18)) : null, tiers_nom: `Client fictif ${entier(4)}`,
    })
    factures.push(f)
    const taux = [...new Set(Array.from({ length: 1 + entier(2) }, () => TAUX_TIRES[entier(TAUX_TIRES.length)]))]
    for (const t of taux) {
      for (let i = 0; i < 1 + entier(2); i++) {
        lignesDeFacture.push({ ...ligneVendue(id, (1 + entier(300_000)) / 100, t, lignesDeFacture.length + 1), quantite: 1 + entier(3) })
      }
    }
    const ttcDe = (doc: FactureVendue) => {
      const m = new Map<number, number>()
      for (const g of montantsDuDocument(doc, lignesDeFacture.filter((l) => l.facture_id === doc.id), null).groupes) {
        m.set(g.taux, (m.get(g.taux) ?? 0) + g.baseCentimes + g.tvaCentimes)
      }
      return m
    }
    const ttc = ttcDe(f)
    const pris = new Map<number, number>(taux.map((t) => [t, 0]))
    const reste = (t: number) => ttc.get(t)! - pris.get(t)!
    const ordinaires: EncaissementVendu[] = []
    const annules = new Set<string>()
    let avoirs = 0

    const nouvel = (montants: Map<number, number>, o: Partial<EncaissementVendu> & Pick<EncaissementVendu, 'date_encaissement'>) => {
      const total = [...montants.values()].reduce((s, c) => s + c, 0)
      const e: EncaissementVendu = {
        id: `${id}-e${encaissements.length}`, dossier_id: D, facture_id: id, montant: total / 100, moyen: 'virement',
        ligne_bancaire_id: null, annule_id: null, cree_le: new Date(Date.UTC(2026, 0, 1) + ++horloge * 1000).toISOString(),
        retire_le: null, ...o,
      }
      encaissements.push(e)
      for (const [t, c] of montants) if (c !== 0) parts.push({ encaissement_id: e.id, dossier_id: D, taux: t, montant: c / 100 })
      return e
    }
    // Le mouvement d'un encaissement : un nouveau, du même jour ou de quelques jours après, ou un crédit déjà tiré.
    const citer = (date: string, credit: boolean): string => {
      const existants = mouvements.filter((m) => (m.montant > 0) === credit)
      if (existants.length > 0 && entier(3) === 0) return existants[entier(existants.length)].id
      const m = mvt({ id: `t${numero}-m${mouvements.length}`, date: entier(2) === 0 ? date : jourDe(Math.round((Date.parse(date) - Date.UTC(2026, 2, 1)) / 86_400_000) + 1 + entier(3)), montant: credit ? 1 : -1 })
      mouvements.push(m)
      return m.id
    }

    for (let pas = 0; pas < entier(7); pas++) {
      const coup = entier(10)
      jour += entier(3)
      const date = jourDe(jour)
      if (coup < 6) {
        const montants = new Map<number, number>()
        for (const t of taux) if (reste(t) > 0 && entier(3) !== 0) montants.set(t, 1 + entier(reste(t)))
        if (montants.size === 0) continue
        const moyen = MOYENS[entier(MOYENS.length)]
        const sansMouvement = moyen === 'compensation' || moyen === 'autre' || entier(3) === 0
        const e = nouvel(montants, { date_encaissement: date, moyen, ligne_bancaire_id: sansMouvement ? null : citer(date, true) })
        if (moyen === 'compensation' || moyen === 'autre') comptes.set(e.id, CONTREPARTIES[entier(2)])
        for (const [t, c] of montants) pris.set(t, pris.get(t)! + c)
        ordinaires.push(e)
      } else if (coup < 8) {
        // Un avoir d'une ligne sur un taux qui garde du reste, son TTC jamais au-delà ; daté après tout ce qui précède.
        const t = taux[entier(taux.length)]
        if (reste(t) < 3) continue
        jour += 1
        const a = factureVendue({
          id: `${id}-a${avoirs++}`, type: 'avoir', numero: `A${numero}-${k}-${avoirs}`, facture_origine_id: id, dossier_id: D,
          date_emission: jourDe(jour) < f.date_emission ? f.date_emission : jourDe(jour), tiers_nom: f.tiers_nom,
        })
        const l = { ...ligneVendue(a.id, (1 + entier(Math.max(1, Math.floor(reste(t) / 1.3)))) / 100, t), quantite: -1 }
        lignesDeFacture.push(l)
        const credit = ttcDe(a).get(t)!
        if (credit > reste(t)) {
          lignesDeFacture.pop()
          continue
        }
        pris.set(t, pris.get(t)! + credit)
        factures.push(a)
      } else {
        const candidats = ordinaires.filter((e) => !annules.has(e.id))
        if (candidats.length === 0) continue
        const de = candidats[entier(candidats.length)]
        const siennes = new Map(parts.filter((p) => p.encaissement_id === de.id).map((p) => [p.taux, -Math.round(p.montant * 100)]))
        const d = date < de.date_encaissement ? de.date_encaissement : date
        // Sans mouvement (une erreur, une somme jamais reçue), ou citant le débit qui défait l'argent (un chèque impayé).
        const debit = entier(2) === 0 ? citer(d, false) : null
        nouvel(siennes, { annule_id: de.id, date_encaissement: d, moyen: de.moyen, ligne_bancaire_id: debit })
        for (const [t, m] of siennes) pris.set(t, pris.get(t)! + m)
        annules.add(de.id)
      }
    }
    // Une fois sur deux, le solde de chaque taux, le même jour, par virement du jour.
    if (entier(2) === 0) {
      const montants = new Map(taux.filter((t) => reste(t) > 0).map((t) => [t, reste(t)]))
      jour += 1
      if (montants.size > 0) nouvel(montants, { date_encaissement: jourDe(jour), ligne_bancaire_id: citer(jourDe(jour), true) })
      for (const [t, c] of montants) pris.set(t, pris.get(t)! + c)
    }
  }

  // Les mouvements : ce que leurs encaissements justifient, moins des frais sous le seuil ; classés par eux.
  const montes = mouvements.map((m) => {
    const justifies = encaissements.filter((e) => e.ligne_bancaire_id === m.id && e.retire_le == null && justifieSonMouvement(e, encaissements))
    const total = justifies.reduce((s, e) => s + Math.round(e.montant * 100), 0)
    if (total === 0) return { ...m, montant: m.montant > 0 ? 1 : -1, encaissements_de_factures: false }
    const plafond = Math.floor(Math.min(50_000, Math.abs(total) * 2) / 100)
    const frais = entier(2) === 0 ? 0 : entier(plafond + 1)
    return { ...m, montant: (total - frais) / 100, encaissements_de_factures: true }
  })
  const melange = <T,>(l: T[]) => l.map((x) => [x, suivant()] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
  return {
    sources: { dossierId: D, factures: melange(factures), lignes: melange(lignesDeFacture), encaissements: melange(encaissements), parts: melange(parts) },
    mouvements: melange(montes), comptes,
  }
}

const somme = (l: readonly number[]) => l.reduce((s, x) => s + x, 0)
// Le solde d'un ensemble de comptes sur des écritures, signé au débit.
function solde(ecritures: readonly EcritureVenteFacturee[], comptes: readonly string[], filtre: (e: EcritureVenteFacturee, l: LigneVenteFacturee) => boolean = () => true) {
  let s = 0
  for (const e of ecritures) for (const l of e.lignes) if (comptes.includes(l.compte) && filtre(e, l)) s += l.sens === 'debit' ? l.centimes : -l.centimes
  return s
}

describe('un tirage de 1 500 dossiers : les écritures portent exactement ce que le module des ventes facturées compte', () => {
  const suivant = tirage(20261020)
  const dossiers = Array.from({ length: 1500 }, (_, i) => tirerUnDossier(suivant, i))
  const calcules = dossiers.map((t) => ({
    t,
    parMode: Object.fromEntries(MODES.map((mode) => [mode, ecrituresDesVentesFacturees({
      sources: t.sources, mouvements: t.mouvements, comptesDeContrepartie: t.comptes, mode, plan: PLAN_PAR_DEFAUT,
    })])) as Record<ModeComptable, EcrituresDesVentesFacturees>,
  }))
  const P = PLAN_PAR_DEFAUT
  const TRESORERIE = (t: Tire) => [P.banque, P.valeurs_a_l_encaissement, P.caisse, ...new Set(t.comptes.values())]

  it('le tirage couvre ce qu’il prétend : chaque régime, chaque moyen, des frais, des mouvements partagés, des avoirs, des contre-passations', () => {
    const toutes = calcules.flatMap((c) => c.parMode.tresorerie.ecritures)
    const compte = (p: (e: EcritureVenteFacturee) => boolean) => toutes.filter(p).length
    expect(compte((e) => e.lignes.some((l) => l.compte === P.services_bancaires))).toBeGreaterThan(300)
    expect(compte((e) => e.source.genre === 'mouvement' && e.lignes.some((l) => l.compte === P.valeurs_a_l_encaissement))).toBeGreaterThan(300)
    expect(compte((e) => e.source.genre === 'mouvement' && e.lignes.some((l) => l.compte === P.caisse))).toBeGreaterThan(30)
    expect(compte((e) => e.lignes.some((l) => l.compte === P.caisse))).toBeGreaterThan(300)
    expect(compte((e) => e.lignes.some((l) => (CONTREPARTIES as readonly string[]).includes(l.compte)))).toBeGreaterThan(300)
    expect(compte((e) => e.source.genre === 'avoir')).toBeGreaterThan(100)
    expect(compte((e) => e.libelle.startsWith('Contre-passation'))).toBeGreaterThan(300)
    expect(compte((e) => e.libelle.startsWith('Contre-passation') && e.lignes.some((l) => l.ligneBancaireId != null && l.compte === P.banque))).toBeGreaterThan(50)
    expect(compte((e) => e.source.genre === 'facture')).toBeGreaterThan(500)
    expect(compte((e) => e.source.genre === 'mouvement' && e.lignes.some((l) => l.compte === P.banque && l.sens === 'credit'))).toBeGreaterThan(50)
    const engagement = calcules.flatMap((c) => c.parMode.engagement.ecritures)
    // Des livraisons datées autrement que leur facture : une écriture de la TVA à elles, en engagement.
    expect(engagement.filter((e) => e.source.genre === 'facture' && e.lignes.length === 2
      && e.lignes.every((l) => l.compte === P.tva_collectee || l.compte === P.tva_collectee_en_attente)).length).toBeGreaterThan(50)
    for (const regime of ['encaissement', 'livraison', 'debits'] as const) {
      expect(calcules.filter((c) => c.parMode.tresorerie.ventes.parts.some((p) => p.regime === regime)).length, regime).toBeGreaterThan(300)
    }
    expect(calcules.filter((c) => new Set(c.t.mouvements.map((m) => m.id)).size > 0
      && c.t.sources.encaissements.some((e, i, l) => e.ligne_bancaire_id != null
        && l.some((x, j) => j !== i && x.ligne_bancaire_id === e.ligne_bancaire_id))).length).toBeGreaterThan(200)
  })

  it('rien n’est écarté ni laissé de côté : chaque source tirée s’écrit, chaque écriture est équilibrée, en centimes entiers', () => {
    for (const { parMode } of calcules) {
      for (const mode of MODES) {
        expect(parMode[mode].ventes.ecartees).toEqual([])
        expect(parMode[mode].nonEcrites).toEqual([])
        verifier(parMode[mode])
      }
    }
  })

  it('la recette écrite au 706 et au 707 est celle que le module compte, mois par mois, dans les deux modèles', () => {
    let mois_ = 0
    for (const { parMode } of calcules) {
      for (const mode of MODES) {
        const r = parMode[mode]
        const ecrite = new Map<string, number>()
        for (const e of r.ecritures) {
          ecrite.set(e.date.slice(0, 7), (ecrite.get(e.date.slice(0, 7)) ?? 0) - solde([e], [P.prestations_de_services, P.ventes_de_biens]))
        }
        const attendue = recettesFactureesParMois(r.ventes, mode)
        for (const mois of new Set([...attendue.keys(), ...ecrite.keys()])) {
          expect(ecrite.get(mois) ?? 0, `${mode} ${mois}`).toBe(attendue.get(mois) ?? 0)
          mois_++
        }
      }
    }
    expect(mois_).toBeGreaterThan(2000)
  })

  it('la TVA écrite au 44571 est, jour par jour, celle des exigibilités du module — la CA3 et les écritures sortent du même calcul', () => {
    let jours = 0
    for (const { parMode } of calcules) {
      for (const mode of MODES) {
        const r = parMode[mode]
        const attendue = new Map<string, number>()
        for (const x of r.ventes.exigibilites) attendue.set(x.date, (attendue.get(x.date) ?? 0) + x.tvaCentimes)
        const ecrite = new Map<string, number>()
        for (const e of r.ecritures) ecrite.set(e.date, (ecrite.get(e.date) ?? 0) - solde([e], [P.tva_collectee]))
        for (const date of new Set([...attendue.keys(), ...ecrite.keys()])) {
          expect(ecrite.get(date) ?? 0, `${mode} ${date}`).toBe(attendue.get(date) ?? 0)
          jours++
        }
      }
    }
    expect(jours).toBeGreaterThan(5000)
  })

  it('le 512 de chaque mouvement fait exactement son montant ; la trésorerie et le 627 font ce qui a été encaissé', () => {
    for (const { t, parMode } of calcules) {
      for (const mode of MODES) {
        const r = parMode[mode]
        for (const m of t.mouvements) {
          const attendu = m.encaissements_de_factures ? Math.round(m.montant * 100) : 0
          expect(solde(r.ecritures, [P.banque], (_e, l) => l.ligneBancaireId === m.id), m.id).toBe(attendu)
        }
        expect(solde(r.ecritures, [...TRESORERIE(t), P.services_bancaires])).toBe(somme(r.ventes.parts.map((p) => p.ttcCentimes)))
        // Les frais : exactement l'écart des mouvements classés.
        expect(solde(r.ecritures, [P.services_bancaires])).toBe(somme(t.mouvements.filter((m) => m.encaissements_de_factures).map((m) => {
          const justifies = t.sources.encaissements.filter((e) => e.ligne_bancaire_id === m.id && e.retire_le == null
            && justifieSonMouvement(e, t.sources.encaissements))
          return somme(justifies.map((e) => Math.round(e.montant * 100))) - Math.round(m.montant * 100)
        })))
      }
    }
  })

  it('le 411 et la TVA en attente : la créance nette en engagement, et rien quand la facture est soldée', () => {
    let soldees = 0
    for (const { parMode } of calcules) {
      const ventes = parMode.engagement.ventes
      for (const factureId of new Set(ventes.documents.map((d) => d.factureId))) {
        const sienne = (e: EcritureVenteFacturee) => (e.source.genre === 'encaissement' ? e.source.factureId
          : e.source.genre === 'mouvement' ? null
            : ventes.documents.find((d) => (d.avoirId ?? d.factureId) === (e.source as { factureId: string }).factureId)?.factureId) === factureId
        const docs = ventes.documents.filter((d) => d.factureId === factureId)
        const encaisse = somme(ventes.parts.filter((p) => p.factureId === factureId).map((p) => p.ttcCentimes))
        const creance = somme(docs.map((d) => d.ttcCentimes)) - encaisse
        const tvaDesDocuments = somme(docs.map((d) => d.tvaCentimes))
        const eng = parMode.engagement.ecritures.filter(sienne)
        expect(solde(eng, [P.clients])).toBe(creance)
        // La TVA des documents est tout entière au 44571 ou en attente.
        expect(0 - solde(eng, [P.tva_collectee, P.tva_collectee_en_attente])).toBe(tvaDesDocuments)
        const tres = parMode.tresorerie.ecritures.filter(sienne)
        // Soldée au jour de son dernier encaissement : un avoir daté après lui peut, par l'arrondi des lignes, laisser le
        // cumul d'un centime à côté de la TVA nette (« LES VENTES FACTURÉES, EN MODULE », À REVOIR ; VF3-Q1).
        const dernier = ventes.parts.filter((p) => p.factureId === factureId).reduce((d, p) => (p.date > d ? p.date : d), '')
        if (creance === 0 && docs.every((d) => d.avoirId == null || d.date <= dernier)) {
          soldees++
          expect(solde(eng, [P.tva_collectee_en_attente])).toBe(0)
          expect(solde(tres, [P.clients])).toBe(0)
        }
      }
    }
    expect(soldees).toBeGreaterThan(500)
  })

  it('sous le plan décalé, les mêmes écritures, chaque compte de rôle à son compte décalé', () => {
    const versLeDefaut = new Map(ROLES_COMPTABLES.map((r) => [PLAN_DECALE[r.role], PLAN_PAR_DEFAUT[r.role]]))
    const defauts = new Set(Object.values(PLAN_PAR_DEFAUT))
    for (const { t, parMode } of calcules.slice(0, 300)) {
      for (const mode of MODES) {
        const decale = ecrituresDesVentesFacturees({ sources: t.sources, mouvements: t.mouvements, comptesDeContrepartie: t.comptes, mode, plan: PLAN_DECALE })
        for (const e of decale.ecritures) for (const l of e.lignes) expect(defauts.has(l.compte), l.compte).toBe(false)
        const ramene = decale.ecritures.map((e) => ({
          ...e, lignes: e.lignes.map((l) => ({ ...l, compte: versLeDefaut.get(l.compte) ?? l.compte })).sort(ordreDesLignes),
        }))
        expect(ramene).toEqual(parMode[mode].ecritures)
        expect(decale.nonEcrites).toEqual(parMode[mode].nonEcrites)
      }
    }
  })

  it('la composition ne dépend pas de l’ordre de la lecture', () => {
    const autre = tirage(7)
    const melange = <T,>(l: readonly T[]) => l.map((x) => [x, autre()] as const).sort((a, b) => a[1] - b[1]).map(([x]) => x)
    for (const { t, parMode } of calcules.slice(0, 300)) {
      const r = ecrituresDesVentesFacturees({
        sources: { ...t.sources, factures: melange(t.sources.factures), lignes: melange(t.sources.lignes), encaissements: melange(t.sources.encaissements), parts: melange(t.sources.parts) },
        mouvements: melange(t.mouvements), comptesDeContrepartie: t.comptes, mode: 'engagement', plan: PLAN_PAR_DEFAUT,
      })
      expect(JSON.stringify(r.ecritures)).toBe(JSON.stringify(parMode.engagement.ecritures))
    }
  })
})
