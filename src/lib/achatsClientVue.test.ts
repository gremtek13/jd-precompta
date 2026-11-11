import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCES_EN_COURS } from './auteursVentes'
import type { PaiementDeclare } from './achatsClient'
import {
  achatsDits, confirmationDuRetraitAuCabinet, confirmationDuRetraitAuClient, declarationDiteAuCabinet, declarationDiteAuClient,
  echeanceDiteAuCabinet, lotsDeVues, mesAchatsOuverts, montantSaisi, moyenSaisi, origineDeLEcheanceAuClient,
  PRESENTATION_DE_MES_ACHATS, retraitOffertAuClient, SANS_LA_CASE_ACHATS, type AchatDuClient,
} from './achatsClientVue'
import { motsDuCabinet } from './espaceVentes'
import { formatMoney } from './format'

// Un montant se dit par `formatMoney`, ses espaces insécables compris.
const E = formatMoney(120.5)

// LES ACHATS DU CLIENT, À L'ÉCRAN : LA RÈGLE ET LES MOTS (étape B5). Les achats dits (échéance, déclarations, « nouvelle »),
// les lots de `marquer_vues`, la saisie du montant jamais arrondie, les phrases du client au tutoiement et sans les mots du
// cabinet, celles du cabinet qui nomment ce qui part et ne disent « par le client » que d'un compte reconnu.

const piece = (p: Partial<AchatDuClient>): AchatDuClient => ({
  id: 'p1', dossier_id: 'd1', type_piece: 'achat', source: 'upload', nom_fichier: 'facture.pdf', tiers: 'Fournisseur fictif',
  date_piece: '2026-10-01', montant_ttc: 120.5, statut: 'validee', identite_numero: null, date_echeance: null,
  echeance_fixee_par: null, echeance_fixee_le: null, created_at: '2026-10-02T08:00:00Z', ...p,
})
const paiement = (p: Partial<PaiementDeclare>): PaiementDeclare => ({
  id: 'x1', dossier_id: 'd1', piece_id: 'p1', date_paiement: '2026-11-02', moyen: 'virement', montant: 120.5, declare_par: 'u1',
  declare_le: '2026-11-03T09:00:00Z', retire_par: null, retire_le: null, ...p,
})

describe('mesAchatsOuverts', () => {
  it('la migration ET la case', () => {
    expect([mesAchatsOuverts(false, true), mesAchatsOuverts(true, false), mesAchatsOuverts(true, true)]).toEqual([false, false, true])
  })
})

describe('achatsDits', () => {
  it('les achats seuls, les plus récents d’abord ; l’échéance au jour donné ; les déclarations de la pièce, actives puis retirées ; « nouvelle »', () => {
    const dits = achatsDits(
      [piece({ id: 'a', date_piece: '2026-09-01', date_echeance: '2026-11-10' }), piece({ id: 'b', date_piece: '2026-10-15' }),
        piece({ id: 'v', type_piece: 'vente' })],
      [paiement({ id: 'x2', piece_id: 'a', declare_le: '2026-11-05T00:00:00Z', retire_le: '2026-11-06T00:00:00Z', retire_par: 'u0' }),
        paiement({ id: 'x1', piece_id: 'a' }), paiement({ id: 'x9', piece_id: 'autre' })],
      [{ piece_id: 'b' }], '2026-11-11')
    expect(dits.map((d) => d.piece.id)).toEqual(['b', 'a'])
    expect(dits.map((d) => d.etat)).toEqual(['sans', 'en_retard'])
    expect(dits[1].declarees.map((p) => p.id)).toEqual(['x1'])
    expect(dits[1].retirees.map((p) => p.id)).toEqual(['x2'])
    expect(dits.map((d) => d.nouvelle)).toEqual([false, true])
  })

  it('les vues par lots de cinq cents au plus, les seules nouvelles', () => {
    const pieces = Array.from({ length: 1001 }, (_, i) => piece({ id: `p${String(i).padStart(4, '0')}` }))
    const lots = lotsDeVues(achatsDits(pieces, [], [{ piece_id: 'p0000' }], '2026-11-11'))
    expect(lots.map((l) => l.length)).toEqual([500, 500])
    expect(lots.flat()).not.toContain('p0000')
    expect(lotsDeVues(achatsDits(pieces.slice(0, 1), [], [{ piece_id: 'p0000' }], '2026-11-11'))).toEqual([])
  })
})

describe('la saisie', () => {
  it('le montant tel que tapé, jamais arrondi ; illisible, nul', () => {
    expect(montantSaisi('120,50')).toBe(120.5)
    expect(montantSaisi(' 1 200.5 ')).toBe(1200.5)
    expect(montantSaisi('10,005')).toBe(10.005)
    for (const t of ['', '-3', '1e3', '12,', 'douze']) expect(montantSaisi(t), t).toBeNull()
  })
  it('le moyen de la liste fermée, ou nul', () => {
    expect(moyenSaisi('cheque')).toBe('cheque')
    expect(moyenSaisi('')).toBeNull()
    expect(moyenSaisi('bitcoin')).toBeNull()
  })
})

describe('les mots du client', () => {
  it('la déclaration, son retrait, l’origine de l’échéance — au tutoiement, sans un mot du cabinet', () => {
    expect(declarationDiteAuClient(paiement({}), 'u1')).toBe(`Déclarée payée par toi : le 02/11/2026, par virement, ${E}`)
    expect(declarationDiteAuClient(paiement({ declare_par: 'u2', retire_le: '2026-11-04T10:00:00Z' }), 'u1'))
      .toBe(`Déclarée payée par un autre accès de ta société : le 02/11/2026, par virement, ${E} — retirée le 04/11/2026`)
    expect([retraitOffertAuClient(paiement({}), 'u1'), retraitOffertAuClient(paiement({}), 'u2'),
      retraitOffertAuClient(paiement({ retire_le: '2026-11-04T10:00:00Z' }), 'u1')]).toEqual([true, false, false])
    expect(origineDeLEcheanceAuClient(piece({ source: 'plateforme', date_echeance: '2026-12-01' }), 'u1')).toBe('lue sur la facture électronique')
    expect(origineDeLEcheanceAuClient(piece({ date_echeance: '2026-12-01', echeance_fixee_par: 'u1', echeance_fixee_le: '2026-11-01T10:00:00Z' }), 'u1'))
      .toBe('fixée par toi le 01/11/2026')
    expect(origineDeLEcheanceAuClient(piece({ date_echeance: '2026-12-01', echeance_fixee_par: 'u0', echeance_fixee_le: '2026-11-01T10:00:00Z' }), 'u1'))
      .toBe('fixée le 01/11/2026')
    expect(origineDeLEcheanceAuClient(piece({}), 'u1')).toBeNull()
    for (const texte of [PRESENTATION_DE_MES_ACHATS, SANS_LA_CASE_ACHATS, confirmationDuRetraitAuClient(paiement({}), 'facture.pdf'),
      declarationDiteAuClient(paiement({ retire_le: '2026-11-04T10:00:00Z' }), 'u2')]) {
      expect(motsDuCabinet(texte), texte).toEqual([])
    }
  })
})

describe('les mots du cabinet', () => {
  it('« proposé par le client le … » ; retirée par son auteur ou par le cabinet ; la confirmation nomme la pièce et ce qui reste', () => {
    expect(declarationDiteAuCabinet(paiement({}))).toBe(`Proposé par le client le 03/11/2026 : payée le 02/11/2026, par virement, ${E}`)
    expect(declarationDiteAuCabinet(paiement({ retire_par: 'u1', retire_le: '2026-11-04T10:00:00Z' }))).toMatch(/retirée le 04\/11\/2026 par le client$/)
    expect(declarationDiteAuCabinet(paiement({ retire_par: 'u0', retire_le: '2026-11-04T10:00:00Z' }))).toMatch(/retirée le 04\/11\/2026 par le cabinet$/)
    const c = confirmationDuRetraitAuCabinet(paiement({ moyen: 'cheque' }), 'facture.pdf')
    expect(c).toContain('« facture.pdf »')
    expect(c).toContain(`payée le 02/11/2026, par chèque, ${E}`)
    expect(c).toContain('sa ligne reste')
    expect(c).toContain('Rien ne change en comptabilité.')
  })

  it('l’échéance et qui l’a fixée : « par le client » d’un compte reconnu, jamais deviné', () => {
    const acces = { etat: 'lus', comptes: ['u1'] } as const
    const fixee = piece({ date_echeance: '2026-11-30', echeance_fixee_par: 'u1', echeance_fixee_le: '2026-11-01T10:00:00Z' })
    expect(echeanceDiteAuCabinet(fixee, acces, '2026-11-11')).toBe('Échéance le 30/11/2026 (à venir), fixée le 01/11/2026 par le client.')
    expect(echeanceDiteAuCabinet(fixee, ACCES_EN_COURS, '2026-11-11')).toBe('Échéance le 30/11/2026 (à venir), fixée le 01/11/2026.')
    expect(echeanceDiteAuCabinet({ ...fixee, echeance_fixee_par: 'u0' }, acces, '2026-12-01')).toBe('Échéance le 30/11/2026 (en retard), fixée le 01/11/2026.')
    expect(echeanceDiteAuCabinet(piece({ source: 'superpdp', date_echeance: '2026-11-11' }), acces, '2026-11-11'))
      .toBe('Échéance le 11/11/2026 (aujourd’hui), lue sur la facture électronique.')
    expect(echeanceDiteAuCabinet(piece({}), acces, '2026-11-11')).toBe('Aucune échéance : la facture n’en donne pas, et personne ne l’a fixée.')
    expect(echeanceDiteAuCabinet({ ...fixee, date_echeance: null }, acces, '2026-11-11')).toBe('Échéance effacée le 01/11/2026 par le client.')
  })

  it('la fiche d’une pièce ne monte la section qu’avec la migration, et sur une pièce d’achat enregistrée', () => {
    const fiche = readFileSync(new URL('../pages/dossier/FichePiece.tsx', import.meta.url), 'utf8')
    expect(fiche).toContain("{ACHATS_DU_CLIENT_PREVUS && piece !== null && piece.type_piece === 'achat' && (")
    expect(fiche.match(/<AchatDeLaPiece /g)).toHaveLength(1)
  })
})
