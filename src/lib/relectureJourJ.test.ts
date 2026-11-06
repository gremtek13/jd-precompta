import { describe, expect, it } from 'vitest'
import { encaissementVendu, factureVendue, ligneVendue } from '../test/ventesFacturees'
import { ecrituresDesVentesFacturees, type MouvementDesEncaissements } from './ecrituresVentesFacturees'
import { PLAN_PAR_DEFAUT } from './planComptable'
import type { ModeComptable } from './types'

// RELECTURE DU JOUR J (06/11/2026, ligne 29.7) : la facturation du praticien, de la bascule à la 2035. Des tests de
// PREUVE : chacun échoue sur le code d'aujourd'hui, et dit le défaut qu'il établit. Données FICTIVES.
//
// JJ1 — le nom d'un patient atteint le FEC par le libellé du RELEVÉ. FEC22-Q7 (02/11/2026) : « le libellé des écritures
// d'une vente porte le nom d'une entreprise, sinon le numéro de la facture » (lib/libellesDesVentes.ts). L'écriture d'un
// mouvement que ses encaissements classent (`cleFecMouvementEncaissements`, lib/ecrituresVentesFacturees.ts, ligne 445)
// prend `libelle: m.libelle` — le libellé de la banque, qui nomme qui a payé (« VIR SEPA DE MME … ») : VF9CQ1 le tait à
// l'assistant pour cette raison même. Elle se compose dès que l'encaissement n'est pas daté du jour du mouvement (le
// virement noté le jour où le patient l'annonce, crédité le lendemain), ou qu'un frais sépare les montants ; le FEC en
// reprend le libellé tel quel (EcritureLib, lib/fec.ts). Le même virement, encaissé le jour du mouvement, s'écrit
// « Encaissement, facture F… » : le nom du patient dépend de la date saisie.

const D = 'd1'
const NOM_DU_PATIENT = 'MME PATIENTE FICTIVE'

const mvt = (o: Partial<MouvementDesEncaissements> & Pick<MouvementDesEncaissements, 'id' | 'date' | 'montant'>): MouvementDesEncaissements => ({
  dossier_id: D, libelle: `VIR SEPA RECU DE ${NOM_DU_PATIENT} MOTIF SEANCE`, source_fichier: 'releve-fictif.csv',
  encaissements_de_factures: true, ...o,
})

function composer(dateEncaissement: string, montantDuMouvement: number, mode: ModeComptable) {
  // Une facture d'un patient (aucun SIRET), exonérée (taux 0), de 60 €, payée par virement.
  const f = factureVendue({ id: 'f1', numero: 'F2026-0001', date_emission: '2026-12-14', tiers_nom: 'Patiente Fictive', tiers_siret: null })
  const { encaissement, part } = encaissementVendu({
    id: 'e1', facture_id: 'f1', date_encaissement: dateEncaissement, montant: 60, moyen: 'virement', ligne_bancaire_id: 'm1',
    cree_le: `${dateEncaissement}T10:00:00Z`,
  }, 0)
  return ecrituresDesVentesFacturees({
    sources: { dossierId: D, factures: [f], lignes: [ligneVendue('f1', 60, 0)], encaissements: [encaissement], parts: [part] },
    mouvements: [mvt({ id: 'm1', date: '2026-12-16', montant: montantDuMouvement })],
    comptesDeContrepartie: new Map(), exemplaires: [], mode, plan: PLAN_PAR_DEFAUT,
  })
}

describe('JJ1 — aucune écriture d’une vente facturée à un patient ne porte son nom (FEC22-Q7)', () => {
  it('le même jour : « Encaissement, facture F2026-0001 », sans nom (ce qui tient aujourd’hui)', () => {
    const r = composer('2026-12-16', 60, 'tresorerie')
    expect(r.ecritures.length).toBeGreaterThan(0)
    for (const e of r.ecritures) expect(e.libelle, e.cle).not.toContain('PATIENTE')
  })

  it.each(['tresorerie', 'engagement'] as const)('%s : encaissement noté la veille du crédit — l’écriture du mouvement ne nomme pas la patiente', (mode) => {
    const r = composer('2026-12-15', 60, mode)
    const libelles = r.ecritures.map((e) => e.libelle)
    expect(libelles.some((l) => l.startsWith('Encaissement, facture F2026-0001'))).toBe(true)
    // Échoue aujourd'hui : l'écriture « mouvement-encaissements|m1 » porte « VIR SEPA RECU DE MME PATIENTE FICTIVE … ».
    for (const l of libelles) expect(l).not.toContain('PATIENTE')
  })

  it('le jour même, mais 0,50 € de frais retenus par la banque : l’écriture du mouvement ne nomme pas la patiente', () => {
    const r = composer('2026-12-16', 59.5, 'tresorerie')
    expect(r.ecritures.some((e) => e.cle === 'mouvement-encaissements|m1')).toBe(true)
    for (const e of r.ecritures) expect(e.libelle, e.cle).not.toContain('PATIENTE')
  })
})
