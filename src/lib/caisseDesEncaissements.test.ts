import { describe, expect, it } from 'vitest'
import { texteCaisseNegative, type EncaissementDeLaCaisse, type EtatDeLaCaisse } from './caisse'
import {
  CAISSE_JUGEE_PAR_LA_BASE, caisseDeLaFenetre, caisseRetenue, contrePassationPourLaCaisse, PERMIS_PAR_LA_CAISSE,
  retenuParLaCaisse, retraitPourLaCaisse, type CaisseDeLaFenetre, type EntreesDeLaCaisseDeLaFenetre,
} from './caisseDesEncaissements'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import type { OperationCaisse } from './types'

// LA CAISSE DANS LA FENÊTRE DES ENCAISSEMENTS (la relecture de la caisse du 31/10/2026 ; lib/caisseDesEncaissements.ts) : le
// retrait, ou la contre-passation sans mouvement, d'un encaissement en espèces d'une facture source dont les espèces ont déjà
// servi se refuse AVANT le clic, sous les mots de `texte_caisse_negative` ; une caisse pas lue en entier retient le geste ; le
// client, qui ne lit pas la caisse, l'apprend de la base ; la caisse absente ne change rien. Des jeux FICTIFS.

const D = 'd1'
const CAISSE = PLAN_PAR_DEFAUT.caisse
const SOURCE = { id: 'f1', numero: 'F2026-0012', source_de_la_vente: true }
const D_AVANT = { id: 'f2', numero: 'F2026-0013', source_de_la_vente: false }
const FACTURES = [SOURCE, D_AVANT]
const especes = (o: Partial<EncaissementDeLaCaisse> = {}): EncaissementDeLaCaisse => ({
  id: 'e1', facture_id: 'f1', date_encaissement: '2026-03-12', montant: 30, moyen: 'especes', ligne_bancaire_id: null,
  annule_id: null, retire_le: null, ...o,
})
// Les 30 € reçus le 12/03 sont versés en banque le 15/03 : le versement, classé sur la caisse, les a fait sortir.
const VERSEMENT = { id: 'm-vrst', date: '2026-03-15', montant: 30, compte_bilan: CAISSE }

function caisseLue(o: Partial<EtatDeLaCaisse> = {}): CaisseDeLaFenetre {
  return {
    etat: 'lue',
    caisse: { compteCaisse: CAISSE, ouvertures: [], operations: [], mouvements: [VERSEMENT], encaissements: [especes()], factures: FACTURES, ...o },
  }
}
const lus = (...encaissements: EncaissementDeLaCaisse[]) => ({ encaissements, factures: FACTURES })
const sansEspaceInsecable = (s: string) => s.replace(/[  ]/g, ' ')

describe('la caisse que la fenêtre juge, ou ce qui l’en empêche', () => {
  const operation = (o: Partial<OperationCaisse> = {}): OperationCaisse => ({
    id: 'o1', dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 10, categorie_id: null, taux_tva: null,
    encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z',
    cree_par: 'u', retire_le: null, retire_par: null, ...o,
  })
  const ouverture = { dossier_id: D, date: '2026-01-01', compte: CAISSE, sens: 'debit' as const, montant: 50 }
  const cabinet = (o: Partial<Extract<EntreesDeLaCaisseDeLaFenetre, { espace: 'cabinet' }>> = {}): EntreesDeLaCaisseDeLaFenetre => ({
    espace: 'cabinet', dossierId: D, compteCaisse: CAISSE,
    caisse: { dossierId: D, enBase: true, lignes: [operation()], complete: true, motif: null },
    reprise: { dossierId: D, lignes: [ouverture], complete: true, motif: null },
    mouvements: [VERSEMENT], encaissements: [especes()], factures: FACTURES, ...o,
  })
  const motif = (e: EntreesDeLaCaisseDeLaFenetre) => { const c = caisseDeLaFenetre(e); return c.etat === 'pas_lue' ? c.motif : c.etat }

  it('le cabinet, tout lu : la caisse rejouée sur les opérations, la reprise, le relevé, les encaissements — au compte du plan', () => {
    expect(caisseDeLaFenetre(cabinet())).toEqual({
      etat: 'lue',
      caisse: {
        compteCaisse: CAISSE, ouvertures: [ouverture], operations: [operation()], mouvements: [VERSEMENT], encaissements: [especes()],
        factures: FACTURES,
      },
    })
    const decale = caisseDeLaFenetre(cabinet({ compteCaisse: PLAN_DECALE.caisse }))
    expect(decale.etat === 'lue' && decale.caisse.compteCaisse).toBe(PLAN_DECALE.caisse)
  })

  it('une entrée pas lue en entier, ou d’un autre dossier : pas lue, et son motif', () => {
    expect(motif(cabinet({ caisse: { dossierId: 'd2', enBase: true, lignes: [], complete: true, motif: null } })))
      .toBe('la caisse du dossier n’est pas encore lue')
    expect(motif(cabinet({ caisse: { dossierId: D, enBase: true, lignes: [], complete: false, motif: '500 lues sur 900' } })))
      .toBe('les opérations de la caisse : 500 lues sur 900')
    expect(motif(cabinet({ caisse: { dossierId: D, enBase: true, lignes: [operation({ dossier_id: 'd2' })], complete: true, motif: null } })))
      .toBe('les opérations de la caisse : une ligne rendue n’est pas de ce dossier')
    expect(motif(cabinet({ reprise: null }))).toBe('la reprise du dossier n’est pas encore lue')
    expect(motif(cabinet({ reprise: { dossierId: 'd2', lignes: [], complete: true, motif: null } }))).toBe('la reprise du dossier n’est pas encore lue')
    expect(motif(cabinet({ reprise: { dossierId: D, lignes: [], complete: false, motif: 'coupée' } }))).toBe('la reprise du dossier : coupée')
    expect(motif(cabinet({ reprise: { dossierId: D, lignes: [{ ...ouverture, dossier_id: 'd2' }], complete: true, motif: null } })))
      .toBe('la reprise du dossier : une ligne rendue n’est pas de ce dossier')
  })

  it('le drapeau baissé : absente, au cabinet comme au client ; le client, la caisse en base : jugée par la base', () => {
    expect(caisseDeLaFenetre(cabinet({ caisse: { dossierId: D, enBase: false, lignes: [], complete: false, motif: 'pas en base' }, reprise: null })))
      .toEqual({ etat: 'absente' })
    expect(caisseDeLaFenetre({ espace: 'client', caisseEnBase: false })).toEqual({ etat: 'absente' })
    expect(caisseDeLaFenetre({ espace: 'client', caisseEnBase: true })).toEqual({ etat: 'jugee_par_la_base' })
  })
})

describe('le retrait d’un encaissement en espèces d’une facture source', () => {
  it('ses espèces ont déjà servi (le versement du 15/03) : le refus de la base, ses mots, le jour et le solde', () => {
    const j = retraitPourLaCaisse(caisseLue(), especes(), lus(especes()))
    expect(j.etat).toBe('refuse')
    expect(j.etat === 'refuse' && sansEspaceInsecable(j.message)).toBe(
      'Retirer cet encaissement de 30,00 € en espèces rendrait la caisse négative le 15/03/2026 (−30,00 €) : ses espèces ont déjà servi.',
    )
    expect(j.etat === 'refuse' && j.message).toBe(texteCaisseNegative('retrait_encaissement', 3000, '2026-03-15', -3000))
    expect(retenuParLaCaisse(j)).toBe(true)
  })

  it('un prélèvement les a fait sortir : de même', () => {
    const prelevement: OperationCaisse = {
      id: 'p1', dossier_id: D, genre: 'prelevement', date: '2026-03-20', montant: 20, categorie_id: null, taux_tva: null,
      encaissements_du_jour: null, piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-20T08:00:00Z',
      cree_par: 'u', retire_le: null, retire_par: null,
    }
    const j = retraitPourLaCaisse(caisseLue({ mouvements: [], operations: [prelevement] }), especes(), lus(especes()))
    expect(j.etat === 'refuse' && sansEspaceInsecable(j.message)).toBe(
      'Retirer cet encaissement de 30,00 € en espèces rendrait la caisse négative le 20/03/2026 (−20,00 €) : ses espèces ont déjà servi.',
    )
  })

  it('des espèces qui n’ont pas servi, ou que d’autres couvrent : permis', () => {
    expect(retraitPourLaCaisse(caisseLue({ mouvements: [] }), especes(), lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
    const ouverture = { date: '2026-01-01', compte: CAISSE, sens: 'debit' as const, montant: 30 }
    expect(retraitPourLaCaisse(caisseLue({ ouvertures: [ouverture] }), especes(), lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
  })

  it('un encaissement que la caisse ne compte pas, ou dont le retrait lui rend des espèces : rien ne se juge', () => {
    // La caisse rejouée serait négative sans eux quoi qu'il arrive : seul l'encaissement qui la touche se refuse.
    const vide = caisseLue({ encaissements: [] })
    for (const e of [
      especes({ moyen: 'cheque' }), especes({ facture_id: 'f2' }), especes({ ligne_bancaire_id: 'm1' }),
      especes({ retire_le: '2026-03-13T10:00:00Z' }), especes({ id: 'cp', montant: -30, annule_id: 'e1', date_encaissement: '2026-03-14' }),
    ]) {
      expect(retraitPourLaCaisse(vide, e, lus(especes(), e))).toBe(PERMIS_PAR_LA_CAISSE)
      expect(retraitPourLaCaisse({ etat: 'pas_lue', motif: 'x' }, e, lus(especes(), e))).toBe(PERMIS_PAR_LA_CAISSE)
      expect(retraitPourLaCaisse({ etat: 'jugee_par_la_base' }, e, lus(especes(), e))).toBe(PERMIS_PAR_LA_CAISSE)
    }
  })

  it('la caisse pas lue en entier retient le geste et le dit ; le client l’apprend de la base ; absente, rien de plus qu’hier', () => {
    expect(retraitPourLaCaisse({ etat: 'pas_lue', motif: 'la reprise du dossier : coupée' }, especes(), lus(especes()))).toEqual({
      etat: 'retenu', message: caisseRetenue('la reprise du dossier : coupée'),
    })
    expect(caisseRetenue('la reprise du dossier : coupée')).toBe('La caisse du dossier n’est pas lue en entier (la reprise du dossier : '
      + 'coupée) : ce geste fait sortir des espèces de la caisse, et ne se juge pas sans elle — il ne part pas. Rouvre cette fenêtre.')
    const client = retraitPourLaCaisse({ etat: 'jugee_par_la_base' }, especes(), lus(especes()))
    expect(client).toEqual({ etat: 'juge_par_la_base', message: CAISSE_JUGEE_PAR_LA_BASE })
    expect(retenuParLaCaisse(client)).toBe(false)
    expect(retraitPourLaCaisse({ etat: 'absente' }, especes(), lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
  })
})

describe('la contre-passation sans mouvement d’un encaissement en espèces d’une facture source', () => {
  it('le décaissement du 20/03, les espèces déjà versées : le refus de la base, ses mots', () => {
    const j = contrePassationPourLaCaisse(caisseLue(), especes(), '2026-03-20', null, lus(especes()))
    expect(j.etat === 'refuse' && sansEspaceInsecable(j.message)).toBe(
      'Cette contre-passation de 30,00 € en espèces rendrait la caisse négative le 20/03/2026 (−30,00 €) : la caisse n\'a plus ces espèces ce jour-là.',
    )
    expect(j.etat === 'refuse' && j.message).toBe(texteCaisseNegative('contre_passation', 3000, '2026-03-20', -3000))
  })

  it('le jour compte : avant le versement, la contre-passation passe, et c’est le versement qui deviendrait impossible — la base juge la caisse entière', () => {
    // Le 13/03 : la caisse retombe à zéro, et le versement du 15/03 la rendrait négative — la base refuse toujours.
    const j = contrePassationPourLaCaisse(caisseLue(), especes(), '2026-03-13', null, lus(especes()))
    expect(j.etat === 'refuse' && sansEspaceInsecable(j.message)).toContain('le 15/03/2026 (−30,00 €)')
    // Sans versement : rien ne s'y oppose.
    expect(contrePassationPourLaCaisse(caisseLue({ mouvements: [] }), especes(), '2026-03-13', null, lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
  })

  it('citant un débit, elle n’entre pas dans la caisse : rien ne se juge', () => {
    expect(contrePassationPourLaCaisse(caisseLue(), especes(), '2026-03-20', 'm-debit', lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
    expect(contrePassationPourLaCaisse({ etat: 'pas_lue', motif: 'x' }, especes(), '2026-03-20', 'm-debit', lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
  })

  it('d’un encaissement que la caisse ne compte pas : rien ne se juge', () => {
    for (const e of [especes({ moyen: 'virement' }), especes({ facture_id: 'f2' }), especes({ ligne_bancaire_id: 'm1' })]) {
      expect(contrePassationPourLaCaisse(caisseLue({ encaissements: [] }), e, '2026-03-20', null, lus(e))).toBe(PERMIS_PAR_LA_CAISSE)
    }
  })

  it('sans date encore : rien ne se rejoue sur une caisse lue — la date se refuse d’abord ; pas lue, retenue quelle que soit la date', () => {
    expect(contrePassationPourLaCaisse(caisseLue(), especes(), null, null, lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
    expect(contrePassationPourLaCaisse({ etat: 'pas_lue', motif: 'm' }, especes(), null, null, lus(especes())))
      .toEqual({ etat: 'retenu', message: caisseRetenue('m') })
    expect(contrePassationPourLaCaisse({ etat: 'jugee_par_la_base' }, especes(), '2026-03-20', null, lus(especes())))
      .toEqual({ etat: 'juge_par_la_base', message: CAISSE_JUGEE_PAR_LA_BASE })
    expect(contrePassationPourLaCaisse({ etat: 'absente' }, especes(), '2026-03-20', null, lus(especes()))).toBe(PERMIS_PAR_LA_CAISSE)
  })
})

describe('les mots que le client lit', () => {
  it('ni onglet, ni vouvoiement, ni « le client » du cabinet ; la réécriture de l’espace n’y change rien', () => {
    const refus = [
      texteCaisseNegative('retrait_encaissement', 3000, '2026-03-15', -3000),
      texteCaisseNegative('contre_passation', 3000, '2026-03-20', -3000),
    ]
    for (const t of [CAISSE_JUGEE_PAR_LA_BASE, ...refus]) {
      expect(motsDuCabinet(t)).toEqual([])
      expect(pourLEspace('client', t)).toBe(t)
    }
  })
})
