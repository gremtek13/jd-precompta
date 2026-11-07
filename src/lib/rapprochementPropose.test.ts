import { describe, expect, it } from 'vitest'
import type { AccesDuDossier } from './auteursVentes'
import type { ExemplaireLu, LigneDeFacture, PartLue } from './encaissementsFactures'
import {
  AUCUN_HORS_DES_LOTS, candidatsDeLaVente, horsDesLotsAvecLesCandidats, JUSTIFICATIF_ENCAISSEMENT_CITE, justificatifDeLaVente,
  mentionDuClient, rapprochementProposeParLEncaissement, ventesDuReleve,
  type CandidatsDeLaVente, type EncaissementDuMouvementLu, type FactureDesGestes, type LectureDesGestes, type SourcesDesGestes,
} from './mouvementsDesVentes'
import type { LigneBancaire } from './types'

// LE RAPPROCHEMENT PROPOSÉ PAR L'ENCAISSEMENT (étape C6 de la ligne 51.5). L'encaissement d'une facture d'avant la bascule
// — que son exemplaire compte — enregistré AVEC un crédit qu'aucune facture source ne réserve propose l'exemplaire unique et
// validé de la facture, sous ce qui a été saisi et quand, jamais un nom ; tant que le crédit est à traiter, aucun lot ne le
// prend. Les instants vers 9 h UTC : le même jour à Paris, à New York et à Auckland. Données FICTIVES.

const D = 'd-bascule'
const CLIENT = 'u-client'
const ACCES: AccesDuDossier = { etat: 'lus', comptes: [CLIENT] }

const facture = (o: Partial<FactureDesGestes> & Pick<FactureDesGestes, 'id' | 'numero'>): FactureDesGestes => ({
  dossier_id: D, type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: false, tiers_nom: 'Client fictif',
  date_emission: '2025-12-15', montant_ttc: 600, ...o,
})
// Deux factures d'avant la bascule, une facture source.
const FACTURES = [
  facture({ id: 'f0', numero: 'F2025-0099' }),
  facture({ id: 'f9', numero: 'F2025-0100', montant_ttc: 300 }),
  facture({ id: 'fs', numero: 'F2026-0001', source_de_la_vente: true, date_emission: '2026-02-01' }),
]
const LIGNES: LigneDeFacture[] = FACTURES.map((f) => ({
  facture_id: f.id, ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: f.montant_ttc / 1.2, taux_tva: 20,
}))

const encaissement = (
  o: Partial<EncaissementDuMouvementLu> & Pick<EncaissementDuMouvementLu, 'id' | 'facture_id' | 'montant'>,
): EncaissementDuMouvementLu => ({
  dossier_id: D, date_encaissement: '2026-01-08', moyen: 'virement', ligne_bancaire_id: 'm1', annule_id: null,
  cree_le: '2026-01-09T09:00:00Z', retire_le: null, cree_par: CLIENT, ...o,
})

function mouvement(o: Partial<LigneBancaire> & Pick<LigneBancaire, 'id'>): LigneBancaire {
  return {
    dossier_id: D, date: '2026-01-08', libelle: 'VIR SEPA RECU /DE CLIENT FICTIF', montant: 600,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
    compte_bilan: null, declaration_tva_id: null, id_externe: null, source_fichier: 'releve-2026.csv', libelle_brut: null,
    created_at: '2026-01-10T09:00:00Z', encaissements_de_factures: false, ...o,
  }
}

const exemplaire = (id: string, factureId: string, o: Partial<ExemplaireLu> = {}): ExemplaireLu => ({
  id, dossier_id: D, facture_id: factureId, statut: 'validee', type_piece: 'vente', ...o,
})

const partsDe = (encaissements: readonly EncaissementDuMouvementLu[]): PartLue[] =>
  encaissements.filter((e) => e.annule_id == null).map((e) => ({ encaissement_id: e.id, taux: 20, montant: e.montant }))

function candidatsDe(
  mouvements: readonly LigneBancaire[],
  encaissements: readonly EncaissementDuMouvementLu[],
  exemplaires: readonly ExemplaireLu[] = [exemplaire('p0', 'f0')],
  annees: readonly number[] = [],
): CandidatsDeLaVente {
  const s: SourcesDesGestes = {
    dossierId: D, factures: FACTURES, lignes: LIGNES, encaissements, parts: partsDe(encaissements), mouvements, exemplaires,
  }
  const lue: LectureDesGestes = { dossierId: D, etat: 'lue', sources: s }
  return candidatsDeLaVente(ventesDuReleve(true, D, lue, ACCES), lue, annees)
}

const M1 = mouvement({ id: 'm1' })

describe('rapprochementProposeParLEncaissement : l’exemplaire de la facture, sous ce qui a été saisi', () => {
  it('le client a enregistré l’encaissement avec ce crédit : l’exemplaire, « Proposé par le client le … », jamais un nom', () => {
    const c = candidatsDe([M1], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })])
    const p = rapprochementProposeParLEncaissement(c, M1, ACCES)
    expect(p).not.toBeNull()
    expect(p?.pieceId).toBe('p0')
    expect(p?.libre).toBe(true)
    expect(p?.note).toBeNull()
    expect(p?.noteDesAuteurs).toBeNull()
    expect(p?.encaissements.map((e) => [e.origine, e.libelle.replace(/\s/g, ' ')])).toEqual([
      ['Proposé par le client le 09/01/2026', 'Facture F2025-0099 — virement du 08/01/2026, 600,00 €'],
    ])
    expect(JSON.stringify(p)).not.toContain('Client fictif')
  })

  it('enregistré par un autre compte : « Enregistré avec ce mouvement le … », jamais « par le cabinet »', () => {
    const c = candidatsDe([M1], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600, cree_par: 'u-cabinet' })])
    const origine = rapprochementProposeParLEncaissement(c, M1, ACCES)?.encaissements[0].origine
    expect(origine).toBe('Enregistré avec ce mouvement le 09/01/2026')
  })

  it('des accès lus en partie : personne n’est reconnu, et la fiche le dit', () => {
    const c = candidatsDe([M1], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })])
    const p = rapprochementProposeParLEncaissement(c, M1, { etat: 'incomplets', motif: 'refusée' })
    expect(p?.encaissements[0].origine).toBe('Enregistré avec ce mouvement le 09/01/2026')
    expect(p?.noteDesAuteurs).toMatch(/^Les accès du dossier n’ont pas été lus en entier \(refusée\)/)
  })

  it('sans exemplaire unique et validé : aucune pièce, une note — ni brouillon, ni deux exemplaires, ni une pièce d’achat', () => {
    const e = [encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })]
    for (const exemplaires of [
      [],
      [exemplaire('p0', 'f0', { statut: 'a_valider' })],
      [exemplaire('p0', 'f0'), exemplaire('p1', 'f0')],
      [exemplaire('p0', 'f0', { type_piece: 'achat' })],
    ]) {
      const p = rapprochementProposeParLEncaissement(candidatsDe([M1], e, exemplaires), M1, ACCES)
      expect(p?.pieceId).toBeNull()
      expect(p?.note).toBe('La facture F2025-0099 n’a pas d’exemplaire unique et validé : la pièce qui la compte se choisit à la main, plus bas.')
    }
  })

  it('deux factures sur le même crédit : aucune pièce, la note dit « Plusieurs pièces »', () => {
    const c = candidatsDe([mouvement({ id: 'm1', montant: 900 })], [
      encaissement({ id: 'e9', facture_id: 'f9', montant: 300, cree_le: '2026-01-09T10:00:00Z' }),
      encaissement({ id: 'e0', facture_id: 'f0', montant: 600 }),
    ], [exemplaire('p0', 'f0'), exemplaire('p9', 'f9')])
    const p = rapprochementProposeParLEncaissement(c, M1, ACCES)
    expect(p?.pieceId).toBeNull()
    expect(p?.encaissements).toHaveLength(2)
    expect(p?.note).toBe('Les encaissements des factures F2025-0099, F2025-0100 citent ce mouvement : leurs exemplaires se règlent '
      + 'ensemble, par « Plusieurs pièces » plus bas.')
  })

  it('rien : ventes pas lues, un débit, un crédit que des encaissements de factures sources réservent ou classent, figé, retiré', () => {
    const e0 = encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })
    const lue = candidatsDe([M1], [e0])
    // Les ventes facturées pas lues en entier : aucun candidat, aucune proposition.
    expect(rapprochementProposeParLEncaissement(candidatsDeLaVente({ etat: 'incomplete', motif: 'refusée' }, null, []), M1, ACCES)).toBeNull()
    // Un mouvement d'un autre dossier, ou que la lecture n'a pas rendu.
    expect(rapprochementProposeParLEncaissement(lue, { ...M1, dossier_id: 'autre' }, ACCES)).toBeNull()
    expect(rapprochementProposeParLEncaissement(lue, { ...M1, id: 'm-absent' }, ACCES)).toBeNull()
    // Un débit.
    const d = mouvement({ id: 'm1', montant: -600 })
    expect(rapprochementProposeParLEncaissement(candidatsDe([d], [e0]), d, ACCES)).toBeNull()
    // Le virement mixte : une facture source le réserve, la carte de VF5a1 le dit.
    const mixte = candidatsDe([mouvement({ id: 'm1', montant: 1200 })], [e0, encaissement({ id: 'es', facture_id: 'fs', montant: 600 })])
    expect(rapprochementProposeParLEncaissement(mixte, M1, ACCES)).toBeNull()
    // Classé par ses encaissements.
    const classe = mouvement({ id: 'm1', statut: 'rapprochee', encaissements_de_factures: true })
    expect(rapprochementProposeParLEncaissement(candidatsDe([classe], [e0]), classe, ACCES)).toBeNull()
    // Figé par l'exercice 2026 validé.
    expect(rapprochementProposeParLEncaissement(candidatsDe([M1], [e0], undefined, [2026]), M1, ACCES)).toBeNull()
    // Un encaissement retiré, ou qui ne cite pas ce mouvement.
    expect(rapprochementProposeParLEncaissement(candidatsDe([M1], [{ ...e0, retire_le: '2026-01-10T09:00:00Z' }]), M1, ACCES)).toBeNull()
    expect(rapprochementProposeParLEncaissement(candidatsDe([M1], [{ ...e0, ligne_bancaire_id: null }]), M1, ACCES)).toBeNull()
  })

  it('un crédit déjà rapproché : la proposition reste dite, mais n’est plus libre', () => {
    const r = mouvement({ id: 'm1', statut: 'rapprochee', piece_id: 'p0' })
    const p = rapprochementProposeParLEncaissement(candidatsDe([r], [encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })]), r, ACCES)
    expect(p?.pieceId).toBe('p0')
    expect(p?.libre).toBe(false)
  })
})

describe('aucun lot ne prend le crédit qu’un encaissement cite', () => {
  it('libre : son justificatif est connu, et il sort des lots ; rapproché, plus rien n’est dit', () => {
    const e0 = encaissement({ id: 'e0', facture_id: 'f0', montant: 600 })
    const c = candidatsDe([M1], [e0])
    expect(justificatifDeLaVente(c, M1)).toBe(JUSTIFICATIF_ENCAISSEMENT_CITE)
    expect(horsDesLotsAvecLesCandidats(AUCUN_HORS_DES_LOTS, c, [M1]).get('m1')).toBe(JUSTIFICATIF_ENCAISSEMENT_CITE)
    const r = mouvement({ id: 'm1', statut: 'rapprochee', piece_id: 'p0' })
    expect(justificatifDeLaVente(candidatsDe([r], [e0]), r)).toBeNull()
    // Sans encaissement qui le cite, le crédit libre n'a pas cette raison.
    expect(justificatifDeLaVente(candidatsDe([M1], [{ ...e0, ligne_bancaire_id: null }]), M1)).not.toBe(JUSTIFICATIF_ENCAISSEMENT_CITE)
  })
})

describe('mentionDuClient : la carte d’un mouvement réservé date la proposition', () => {
  it('réservé, « proposé par le client le … » ; classé, « par le client »', () => {
    expect(mentionDuClient('reserve', '2026-03-10T09:00:00Z')).toBe('proposé par le client le 10/03/2026')
    expect(mentionDuClient('classe', '2026-03-10T09:00:00Z')).toBe('par le client')
  })
})
