import { describe, expect, it } from 'vitest'
import {
  IMPORT_DES_FACTURES_OFFERT,
  centimesSaisis,
  choixVides,
  confirmationDeLaDateDeReprise,
  confirmationDeLImport,
  confirmationDuRetrait,
  sortDesOriginaux,
  jugerLeLot,
  refusDeLaDateDeReprise,
  refusDuDossier,
  IMPORT_EN_ENGAGEMENT,
  IMPORT_SANS_BASCULE,
  IMPORT_SANS_DATE_DE_REPRISE,
  type ChoixSaisis,
  type EtatDeLImport,
  type FichierLu,
} from './importDesFacturesVue'
import type { FactureRepriseLue } from './lectureDesFacturesReprises'

// L'ÉCRAN D'IMPORT DES FACTURES REPRISES, SA RÈGLE (A8d2b). Données FICTIVES. Ce que ces cas gardent : le dossier qui retient
// tout import ; la date de reprise (le chef seul, un premier du mois, au plus tard la bascule, figée au premier import) ;
// chaque fichier jugé avant le clic — sa lecture, ses doublons (numéro, empreinte), sa date, son avoir, ses choix SANS
// défaut, les refus d'A8d1 tels quels — ; un seul refus retient le lot ; l'ordre du lot ; les confirmations qui nomment.

const etat = (o: Partial<EtatDeLImport> = {}): EtatDeLImport => ({
  dossierId: 'd1', modeComptable: 'tresorerie', bascule: true, basculeLe: '2026-11-05', repriseLe: '2026-11-01',
  siren: '123456782', numeros: ['F2026-000000001'], reprises: [], empreintes: [], lots: [], ...o,
})

const facture = (o: Partial<FactureRepriseLue> = {}): FactureRepriseLue => ({
  format: 'cii', numero: 'FA-2025/118', type: 'facture', origine_numero: null, date_emission: '2025-11-20',
  date_echeance: '2025-12-20', tiers_nom: 'Société fictive', tiers_adresse: '1 rue de l’Essai 75001 Paris', tiers_siren: '987654321',
  tiers_siret: null, nature_lue: 'services', option_debits_lue: false, ht_centimes: 15000, tva_centimes: 3000, ttc_centimes: 18000,
  lignes: [{ designation: 'Conseil', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20, unite: null },
    { designation: 'Suivi', quantite: 1, prix_unitaire_ht: 50, taux_tva: 20, unite: null }],
  ...o,
})

const fichier = (cle: string, lue: FactureRepriseLue | string[], sha = cle.padEnd(64, '0')): FichierLu => ({
  cle, nom: `${cle}.xml`, taille: 1000, fichier: new File(['<x/>'], `${cle}.xml`), sha256: sha, lecture: Array.isArray(lue) ? { refus: lue } : { lue }, original: null,
})

const remplis = (o: Partial<ChoixSaisis> = {}): ChoixSaisis => ({ ...choixVides(), type_client: 'assujetti', transmise_par: 'pdf', encaisse: '0', ...o })

describe('le drapeau', () => {
  // Levé le 11/11/2026 (A8D2B-Q3 : après la migration des originaux) ; l'état baissé, l'onglet d'hier, reste joué par
  // l'accesseur d'ImportDesFactures.test.tsx.
  it('est levé : l’onglet Factures offre l’import des factures de l’ancien logiciel', () => {
    expect(IMPORT_DES_FACTURES_OFFERT).toBe(true)
  })
})

describe('le dossier', () => {
  it('retient l’import en engagement, sans bascule, sans date de reprise', () => {
    expect(refusDuDossier(etat({ modeComptable: 'engagement' }))).toBe(IMPORT_EN_ENGAGEMENT)
    expect(refusDuDossier(etat({ bascule: false, basculeLe: null }))).toBe(IMPORT_SANS_BASCULE)
    expect(refusDuDossier(etat({ repriseLe: null }))).toBe(IMPORT_SANS_DATE_DE_REPRISE)
    expect(refusDuDossier(etat({ repriseLe: '2026-12-01' }))).toMatch(/suit le jour de la bascule/)
    expect(refusDuDossier(etat())).toBeNull()
  })
})

describe('la date de reprise', () => {
  it('se pose par le chef seul, un mois saisi, au plus tard celui de la bascule, avant tout import', () => {
    expect(refusDeLaDateDeReprise(etat({ repriseLe: null }), '2026-10', false)).toMatch(/chef du cabinet/)
    expect(refusDeLaDateDeReprise(etat({ repriseLe: null }), '', true)).toMatch(/premier jour d’un mois/)
    expect(refusDeLaDateDeReprise(etat({ repriseLe: null }), '2026-12', true)).toMatch(/suit le jour de la bascule \(le 05\/11\/2026\)/)
    expect(refusDeLaDateDeReprise(etat({ repriseLe: null, bascule: false, basculeLe: null }), '2026-10', true)).toBe(IMPORT_SANS_BASCULE)
    const lot = { id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 1, factures: [] }
    expect(refusDeLaDateDeReprise(etat({ lots: [lot] }), '2026-10', true)).toMatch(/figée depuis le premier import/)
    expect(refusDeLaDateDeReprise(etat(), '2026-11', true)).toMatch(/déjà la date/)
    expect(refusDeLaDateDeReprise(etat({ repriseLe: null }), '2026-11', true)).toBeNull()
  })
  it('sa confirmation dit qu’elle se fige au premier import', () => {
    expect(confirmationDeLaDateDeReprise('2026-11')).toMatch(/le 01\/11\/2026.*se fige au premier import/)
  })
})

describe('un montant saisi', () => {
  it('se lit au centime, positif ou nul, jamais arrondi', () => {
    expect(centimesSaisis('1 234,56')).toBe(123456)
    expect(centimesSaisis('0')).toBe(0)
    expect(centimesSaisis('12.5')).toBe(1250)
    expect(centimesSaisis('1,234')).toBeNull()
    expect(centimesSaisis('-3')).toBeNull()
    expect(centimesSaisis('abc')).toBeNull()
  })
})

describe('le jugement du lot', () => {
  it('un fichier prêt part, son aperçu montrant HT, TVA par taux, TTC et nature', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture())], { a: remplis({ encaisse: '30' }) }, false)
    expect(j.fichiers[0].refus).toEqual([])
    expect(j.fichiers[0].apercu).toMatchObject({ numero: 'FA-2025/118', ht_centimes: 15000, ttc_centimes: 18000, nature: 'services',
      par_taux: [{ taux: 20, ht_centimes: 15000, tva_centimes: 3000 }] })
    expect(j.pret?.factures[0].facture).toMatchObject({ numero: 'FA-2025/118', type_client: 'assujetti', transmise_par: 'pdf', encaisse_avant_reprise: 30 })
    expect(j.pret?.format).toBe('cii')
  })

  it('les choix sont SANS défaut : rien de choisi, tout se dit, rien ne part', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture({ nature_lue: null, option_debits_lue: null }))], {}, false)
    expect(j.fichiers[0].refus).toEqual([
      'Le type du client est à choisir.',
      'La transmission de la facture est à choisir (« Inconnue » si on ne la sait pas).',
      'L’encaissé avant la reprise est à saisir (« 0 » si rien n’était encaissé).',
      'Le fichier ne dit pas la nature des opérations (BT-23) : biens, services ou mixte, à préciser.',
      'Le fichier ne dit pas si la facture a été émise sous l’option pour les débits (BT-8) : à préciser.',
    ])
    expect(j.pret).toBeNull()
  })

  it('une facture mixte dit la nature de chaque ligne', () => {
    const lue = facture({ nature_lue: 'mixte' })
    expect(jugerLeLot(etat(), [fichier('a', lue)], { a: remplis() }, false).fichiers[0].refus)
      .toEqual(['Une facture mixte dit la nature de chacune de ses 2 lignes : à choisir.'])
    const pret = jugerLeLot(etat(), [fichier('a', lue)], { a: remplis({ natures_des_lignes: ['services', 'biens'] }) }, false).pret
    expect(pret?.factures[0].facture.lignes.map((l) => l.nature)).toEqual(['services', 'biens'])
  })

  it('les refus d’A8d1 passent tels quels : plateforme sans nom, encaissé au-delà du TTC', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture())], { a: remplis({ transmise_par: 'plateforme', encaisse: '181' }) }, false)
    expect(j.fichiers[0].refus).toEqual([
      'Une facture transmise par une plateforme agréée la nomme, et seule celle-là.',
      expect.stringMatching(/^L’encaissé avant la reprise dépasse le TTC de la facture/),
    ])
  })

  it('un fichier illisible dit sa lecture et retient le lot', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture()), fichier('b', ['Ce fichier n’est ni un PDF ni un XML.'])], { a: remplis() }, false)
    expect(j.fichiers[1].refus).toEqual(['Ce fichier n’est ni un PDF ni un XML.'])
    expect(j.fichiers[0].refus).toEqual([])
    expect(j.pret).toBeNull()
  })

  it('les doublons : un numéro déjà en base ou dans le lot, une empreinte déjà importée ou déposée deux fois', () => {
    const enBase = jugerLeLot(etat({ numeros: ['FA-2025/118'], empreintes: ['e'.repeat(64)] }), [fichier('a', facture(), 'e'.repeat(64))], { a: remplis() }, false)
    expect(enBase.fichiers[0].refus).toEqual([
      'Ce fichier a déjà été importé dans ce dossier (la même empreinte).',
      'Le numéro FA-2025/118 est déjà celui d’une facture de ce dossier : un numéro ne se réemploie jamais.',
    ])
    const dansLeLot = jugerLeLot(etat(), [fichier('a', facture(), 'f'.repeat(64)), fichier('b', facture(), 'f'.repeat(64))], { a: remplis(), b: remplis() }, false)
    expect(dansLeLot.fichiers[0].refus).toEqual([])
    expect(dansLeLot.fichiers[1].refus).toEqual(['Ce fichier est déposé deux fois dans ce lot.', 'Le numéro FA-2025/118 est aussi celui d’un autre fichier de ce lot.'])
    expect(dansLeLot.pret).toBeNull()
  })

  it('une facture datée de la reprise ou après se refuse', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture({ date_emission: '2026-11-01' }))], { a: remplis() }, false)
    expect(j.fichiers[0].refus).toEqual([expect.stringMatching(/datée du 01\/11\/2026, la date de reprise ou après/)])
  })

  it('un avoir cite une facture reprise, du lot ou d’avant, et ne la précède pas ; le lot part dans l’ordre de la base', () => {
    const avoir = facture({ numero: 'AV-2025/3', type: 'avoir', origine_numero: 'FA-2025/118', date_emission: '2025-11-20',
      ht_centimes: -5000, tva_centimes: -1000, ttc_centimes: -6000, lignes: [{ designation: 'Geste', quantite: -1, prix_unitaire_ht: 50, taux_tva: 20, unite: null }] })
    const sansOrigine = jugerLeLot(etat(), [fichier('v', avoir)], { v: remplis({ encaisse: '' }) }, false)
    expect(sansOrigine.fichiers[0].refus).toEqual([expect.stringMatching(/cite la facture « FA-2025\/118 », qui n’est pas une facture reprise/)])
    const avant = jugerLeLot(etat({ reprises: [{ numero: 'FA-2025/118', type: 'facture', date_emission: '2025-12-01' }] }),
      [fichier('v', avoir)], { v: remplis() }, false)
    expect(avant.fichiers[0].refus).toEqual(['Il précède la facture qu’il crédite (émise le 01/12/2025).'])
    // L'avoir déposé en premier, sa facture en second, le même jour : la facture part d'abord.
    const lot = jugerLeLot(etat(), [fichier('v', avoir), fichier('a', facture({ date_emission: '2025-11-20' }))], { v: remplis(), a: remplis() }, false)
    expect(lot.fichiers.map((f) => f.refus)).toEqual([[], []])
    expect(lot.pret?.factures.map((f) => f.facture.numero)).toEqual(['FA-2025/118', 'AV-2025/3'])
    expect(lot.pret?.factures[1].facture.encaisse_avant_reprise).toBe(0)
  })

  it('un lot ne mêle pas les formats, et le dossier qui retient se dit au lot', () => {
    const j = jugerLeLot(etat(), [fichier('a', facture()), fichier('b', facture({ numero: 'FA-2025/119', format: 'ubl' }))], { a: remplis(), b: remplis() }, false)
    expect(j.refusDuLot).toEqual(['Un import ne mêle pas les formats (CII, UBL) : importer chaque format à part.'])
    expect(j.pret).toBeNull()
    const engagement = jugerLeLot(etat({ modeComptable: 'engagement' }), [fichier('a', facture())], { a: remplis() }, false)
    expect(engagement.refusDuLot).toEqual([IMPORT_EN_ENGAGEMENT])
    expect(engagement.pret).toBeNull()
  })

  it('originaux prévus : un original que le seau refuse retient le fichier ; baissé, il ne compte pas', () => {
    const f = { ...fichier('a', facture()), original: { refus: { raison: 'taille' as const, message: 'pèse 21 Mo', taille: 21e6 } } }
    expect(jugerLeLot(etat(), [f], { a: remplis() }, true).fichiers[0].refus).toEqual(['Son original ne se dépose pas : pèse 21 Mo.'])
    expect(jugerLeLot(etat(), [f], { a: remplis() }, false).pret).not.toBeNull()
  })
})

describe('les confirmations', () => {
  it('l’import nomme ce qui part et dit qu’il ne se défait que par « Retirer l’import »', () => {
    const pret = jugerLeLot(etat(), [fichier('a', facture())], { a: remplis() }, false).pret
    expect(pret).not.toBeNull()
    const texte = confirmationDeLImport(pret!, false)
    expect(texte).toMatch(/1 facture de l’ancien logiciel, au format CII : FA-2025\/118/)
    expect(texte).toMatch(/180,00\s€ TTC/)
    expect(texte).toMatch(/ne se défait que par « Retirer l’import »/)
    expect(texte).toMatch(/ne se gardent pas encore/)
  })
  it('le retrait nomme les documents du lot', () => {
    const lot = { id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 2,
      factures: [{ facture_id: 'x', numero: 'FA-2', rang: 2, fichier_chemin: null }, { facture_id: 'y', numero: 'FA-1', rang: 1, fichier_chemin: null }] }
    expect(confirmationDuRetrait(lot, false, true)).toMatch(/import du 10\/11\/2026 : ses 2 documents \(FA-1, FA-2\)/)
    expect(confirmationDuRetrait(lot, false, true)).not.toMatch(/original/)
  })
  it('les originaux d’un lot retiré : rien drapeau baissé ; au chef, retirés après ; au membre, ils restent, et c’est dit', () => {
    const lot = { id: 'l1', format: 'cii', importe_le: '2026-11-10T10:00:00Z', nombre_factures: 2, factures: [
      { facture_id: 'x', numero: 'FA-1', rang: 1, fichier_chemin: 'd1/imports/l1/a.xml' },
      { facture_id: 'y', numero: 'FA-2', rang: 2, fichier_chemin: 'd1/imports/l1/b.xml' }] }
    expect(sortDesOriginaux(lot, false, true)).toEqual({ retirer: [], phrase: null })
    expect(sortDesOriginaux(lot, true, true)).toEqual({ retirer: ['d1/imports/l1/a.xml', 'd1/imports/l1/b.xml'], phrase: expect.stringMatching(/^Ses 2 originaux quittent le stockage/) })
    expect(sortDesOriginaux(lot, true, false)).toEqual({ retirer: [], phrase: expect.stringMatching(/^Ses 2 originaux restent dans le stockage : seul le chef du cabinet/) })
    expect(confirmationDuRetrait(lot, true, false)).toMatch(/restent dans le stockage.*Continuer \?$/)
  })
})
