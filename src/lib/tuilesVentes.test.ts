import { describe, expect, it } from 'vitest'
import { compterLesPastilles, type ListesDesVentes } from './tuilesVentes'
import { pastilleDeclaration, pastilleEncaissement } from './encaissementsAffichage'
import { facture as factureCii } from '../test/facturesCii'
import type { FactureEmise, TransmissionFacture } from './types'
import type { EncaissementPourContrePassation, PartLue } from './encaissementsFactures'

// LE COMPTE DES TUILES DE L'ACCUEIL DU CLIENT (espace client, étape P4b) : les pastilles de l'onglet Factures, comptées.
// Ce que ces cas gardent : le compte est celui des deux fonctions de pastille, facture par facture ; « Encaissée » ne compte
// pas, « Encaissée en partie » compte aussi « en partie » ; « Déclaration en retard » compte aussi « en retard » ; une seule
// liste partielle, quelle qu'elle soit, rend les tuiles MUETTES, avec son motif — un « 0 » ne se dit que de listes lues en
// entier. Le test d'écran (TuilesVentesClient.test.tsx) confronte les nombres aux pastilles rendues par l'onglet.

const LIGNE = { ordre: 1, designation: 'Conseil', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }
const AUJOURDHUI = '2027-11-20'
const HOTE = 'flux.plateforme-fictive.fr'

const facture = (id: string, o: Partial<FactureEmise> = {}): FactureEmise => factureCii([LIGNE], {
  id, numero: `F-${id}`, date_emission: '2027-10-01', date_echeance: '2027-10-31', option_debits: false, ...o,
})
const transmission = (factureId: string): TransmissionFacture => ({
  id: `t-${factureId}`, dossier_id: 'd1', facture_id: factureId, canal: 'plateforme', hote: HOTE, flux_id: `flux-${factureId}`,
  sha256: 'e'.repeat(64), etat: 'accepte', detail: null, cree_le: '2027-10-02T09:00:00Z', maj_le: '2027-10-02T09:05:00Z',
})
const encaissement = (id: string, factureId: string, montant: number, date: string): EncaissementPourContrePassation => ({
  id, dossier_id: 'd1', facture_id: factureId, date_encaissement: date, montant, ligne_bancaire_id: null, annule_id: null,
  retire_le: null,
})
const part = (encaissementId: string, montant: number): PartLue => ({ encaissement_id: encaissementId, taux: 20, montant })

function listes(o: Partial<ListesDesVentes> = {}): ListesDesVentes {
  const factures = [facture('f1'), facture('f2'), facture('f3'), facture('f4'), facture('b1', { statut: 'brouillon', numero: null })]
  return {
    factures,
    facturesIncompletes: null,
    transmissions: ['f2', 'f3', 'f4'].map(transmission),
    transmissionsIncompletes: null,
    lignes: factures.map((f) => ({ ...LIGNE, facture_id: f.id })),
    encaissements: [
      encaissement('e2', 'f2', 600, '2027-10-05'), encaissement('e3', 'f3', 1200, '2027-11-15'),
      encaissement('e4', 'f4', 1200, '2027-10-20'),
    ],
    parts: [part('e2', 600), part('e3', 1200), part('e4', 1200)],
    encaissementsIncomplets: null,
    declarations: [{ id: 'te4', dossier_id: 'd1', encaissement_id: 'e4', facture_id: 'f4', canal: 'manuel', hote: HOTE, etat: 'depose' }],
    evenementsSuperpdp: [],
    declarationsIncompletes: null,
    statutsLus: [],
    statutsIncomplets: null,
    ...o,
  }
}

describe('compterLesPastilles', () => {
  it('compte, facture par facture, ce que les deux pastilles disent', () => {
    const l = listes()
    const compte = compterLesPastilles('d1', l, 'redevable', AUJOURDHUI)
    expect(compte).toEqual({ etat: 'comptees', aEncaisser: 2, enPartie: 1, aDeclarer: 2, enRetard: 1 })
    // La même chose, recomptée depuis les pastilles elles-mêmes : le module n'a pas d'autre calcul.
    const encaissements = l.factures.map((f) => pastilleEncaissement(f, l.lignes, l.encaissements, l.parts, 'redevable')?.libelle)
    expect(encaissements.map((t) => t?.split(' — ')[0]))
      .toEqual(['À encaisser', 'Encaissée en partie', 'Encaissée', 'Encaissée', undefined])
    const declarations = l.factures.map((f) => pastilleDeclaration(
      'd1', f, l.lignes, l.encaissements, l.declarations, l.transmissions, l.evenementsSuperpdp, l.statutsLus, 'redevable', AUJOURDHUI,
    )?.libelle)
    expect(declarations).toEqual([undefined, 'Déclaration en retard', 'À déclarer', undefined, undefined])
  })

  it('le jour compte : avant l’échéance, rien n’est en retard', () => {
    expect(compterLesPastilles('d1', listes(), 'redevable', '2027-10-06'))
      .toMatchObject({ etat: 'comptees', aDeclarer: 2, enRetard: 0 })
  })

  it('des factures à un particulier : le statut « Encaissée » est sans objet, rien ne se compte', () => {
    const l = listes()
    const aUnParticulier = l.factures.map((f) => ({ ...f, type_client: 'non_assujetti' as const }))
    expect(compterLesPastilles('d1', { ...l, factures: aUnParticulier }, 'redevable', AUJOURDHUI))
      .toEqual({ etat: 'comptees', aEncaisser: 0, enPartie: 0, aDeclarer: 0, enRetard: 0 })
  })

  it('un statut de TVA à préciser : rien ne se déclare d’ici, l’encaissement se compte encore', () => {
    expect(compterLesPastilles('d1', listes(), null, AUJOURDHUI))
      .toMatchObject({ etat: 'comptees', aDeclarer: 0, enRetard: 0 })
  })

  it('aucune facture, listes lues en entier : « 0 »', () => {
    expect(compterLesPastilles('d1', listes({ factures: [] }), 'redevable', AUJOURDHUI))
      .toEqual({ etat: 'comptees', aEncaisser: 0, enPartie: 0, aDeclarer: 0, enRetard: 0 })
  })

  it.each([
    ['facturesIncompletes'], ['transmissionsIncompletes'], ['encaissementsIncomplets'], ['declarationsIncompletes'],
    ['statutsIncomplets'],
  ] as const)('%s : muettes, avec ce motif', (cle) => {
    expect(compterLesPastilles('d1', listes({ [cle]: `motif ${cle}` }), 'redevable', AUJOURDHUI))
      .toEqual({ etat: 'muettes', motif: `motif ${cle}` })
  })
})
