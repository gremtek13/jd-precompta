// @vitest-environment jsdom
// L'analyseur XML est celui du navigateur (`DOMParser`), comme pour les autres tests qui lisent une facture électronique.
import { describe, expect, it } from 'vitest'
import { lectureDeLaFactureOfferte, lireLaFactureRecue, type PieceRecue } from './factureRecueVue'
import { factureRecueCii, octetsDe, SIREN_DU_DOSSIER } from '../test/factureRecue'

// B4R-Q1 (12/11/2026, « (A) Un bouton du cabinet dans la fiche ») : la facture d'achat reçue par l'accès « Achats » se relit
// dans la fiche, par le lecteur des factures électroniques du navigateur ; ce qu'elle dit remplit la fiche, rien ne s'écrit.

const piece = (p: Partial<PieceRecue> = {}): PieceRecue => ({
  source: 'plateforme', type_piece: 'achat', nom_fichier: 'facture 42.xml', storage_path: 'd1/1-facture-42.xml', ...p,
})

describe('le bouton s’offre', () => {
  it('derrière son drapeau, sur une facture d’ACHAT reçue d’une plateforme dont l’original est un XML, pas figée', () => {
    expect(lectureDeLaFactureOfferte(true, piece(), false)).toBe(true)
    expect(lectureDeLaFactureOfferte(false, piece(), false)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, null, false)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, piece(), true)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, piece({ source: 'upload' }), false)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, piece({ type_piece: 'vente' }), false)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, piece({ nom_fichier: 'facture.pdf' }), false)).toBe(false)
    expect(lectureDeLaFactureOfferte(true, piece({ storage_path: null }), false)).toBe(false)
  })
})

describe('ce que la lecture remplit', () => {
  it('la date, le fournisseur et les montants d’une facture adressée au dossier', () => {
    const lue = lireLaFactureRecue(octetsDe(factureRecueCii()), SIREN_DU_DOSSIER)
    expect('champs' in lue && lue).toEqual({
      champs: { date: '2026-09-15', tiers: 'Fournitures Martin', montants: { montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR' } },
      confiance: 'haute',
      avertissements: [],
    })
  })

  it('un avoir se lit en négatif, comme à l’import', () => {
    const lue = lireLaFactureRecue(octetsDe(factureRecueCii({ type: '381' })), SIREN_DU_DOSSIER)
    expect('champs' in lue && lue.champs.montants.montant_ttc).toBe(-120)
  })

  it('une autre entreprise comme acheteur : rien ne se remplit, et le SIREN se dit', () => {
    const lue = lireLaFactureRecue(octetsDe(factureRecueCii({ acheteur: '111111118' })), SIREN_DU_DOSSIER)
    expect('refus' in lue && lue.refus).toContain('autre entreprise comme acheteur (SIREN 111111118)')
  })

  it('un acheteur non dit, ou un dossier sans SIRET : la fiche se remplit, en confiance moyenne, et le dit', () => {
    const sansAcheteur = lireLaFactureRecue(octetsDe(factureRecueCii({ acheteur: null })), SIREN_DU_DOSSIER)
    expect('champs' in sansAcheteur && [sansAcheteur.confiance, sansAcheteur.avertissements[0]])
      .toEqual(['moyenne', 'La facture ne dit pas le SIREN de son acheteur : rien ne vérifie ici qu’elle est adressée à ce dossier.'])
    const sansSiret = lireLaFactureRecue(octetsDe(factureRecueCii()), null)
    expect('champs' in sansSiret && [sansSiret.confiance, sansSiret.avertissements[0]])
      .toEqual(['moyenne', 'Le dossier n’a pas de SIRET lisible : rien ne vérifie ici que la facture lui est adressée.'])
  })

  it('sans total : aucun montant, confiance basse ; un original illisible ou pas en UTF-8 : refusé', () => {
    const sansTotal = lireLaFactureRecue(octetsDe(factureRecueCii({ ttc: null })), SIREN_DU_DOSSIER)
    expect('champs' in sansTotal && [sansTotal.champs.montants.montant_ht, sansTotal.champs.montants.montant_ttc, sansTotal.confiance])
      .toEqual([null, null, 'basse'])
    expect('champs' in sansTotal && sansTotal.avertissements).toContain('La facture ne dit pas de total lisible : ses montants sont à saisir.')
    const illisible = lireLaFactureRecue(octetsDe('<pas-une-facture/>'), SIREN_DU_DOSSIER)
    expect('refus' in illisible && illisible.refus).toMatch(/^Facture illisible : .* Rien n’est rempli, saisis-la à la main\.$/)
    const pasUtf8 = lireLaFactureRecue(new Uint8Array([0xff, 0xfe, 0x3c]), SIREN_DU_DOSSIER)
    expect('refus' in pasUtf8 && pasUtf8.refus).toContain('UTF-8')
  })
})
