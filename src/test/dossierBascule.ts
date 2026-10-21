import { ecrituresDesVentesFacturees, lignesAuBrouillon, type EcrituresDesVentesFacturees } from '../lib/ecrituresVentesFacturees'
import type {
  EncaissementDesEcritures, FactureDesEcritures, MouvementDesEcritures, SourcesDesEcrituresDeVente,
} from '../lib/ecrituresVentesFactureesEcran'
import type { LigneDeFacture } from '../lib/encaissementsFactures'
import type { PlanComptable } from '../lib/planComptable'
import type { EcritureBrouillon, LigneBancaire, ModeComptable, Piece } from '../lib/types'
import type { PartVendue } from '../lib/ventesFacturees'
import type { VentesFactureesDesExports } from '../lib/ventesFactureesDesExports'
import { NON_VALIDEE } from './ecritures'
import { encaissementVendu, factureVendue, ligneVendue } from './ventesFacturees'

// UN DOSSIER QUI A BASCULÉ, DE BOUT EN BOUT (chantier EC-Q3, étape VF4c2) : les lignes de la base telles que la lecture des
// ventes facturées les rend, la composition de VF4a sur elles, et le brouillon que la fonction de VF4b aurait écrit pour
// chaque écriture composée (`lignesAuBrouillon`) — ce que le FEC, la piste d'audit et le lettrage lisent ensemble. Rien n'y
// est écrit à la main : une ligne posée à la main ne prouverait rien de ce que la composition rend. Données FICTIVES.
//
// Le jeu, des services à 20 %, chez deux clients :
//   - F2025-0001 (Client fictif), 120 € TTC le 10/11/2025, encaissée en entier le 20/11 par un virement du même jour (m1) ;
//   - F2025-0002 (Clinique du Parc), 240 € TTC le 12/11, encaissée en partie le 21/11 par un chèque que le relevé crédite le
//     22/11 (m2, classé par ses encaissements) — il reste 140 € ;
//   - F2025-0003 (Client fictif), 60 € TTC le 14/11, que l'avoir A2025-0001 du 18/11 annule en entier, sans encaissement.

export const D_BASCULE = 'd1'

export const facture = (o: Partial<FactureDesEcritures> & Pick<FactureDesEcritures, 'id'>): FactureDesEcritures => ({
  ...factureVendue(o), montant_ttc: 120, ...o,
})

const encaissement = (
  o: Partial<EncaissementDesEcritures> & Pick<EncaissementDesEcritures, 'id' | 'date_encaissement' | 'montant'>,
): { encaissement: EncaissementDesEcritures; part: PartVendue } => {
  const { encaissement: e, part } = encaissementVendu({ cree_le: `${o.date_encaissement}T10:00:00Z`, ...o })
  return { encaissement: { ...e, compte_contrepartie: o.compte_contrepartie ?? null }, part }
}

export const mouvementDesVentes = (
  o: Partial<MouvementDesEcritures> & Pick<MouvementDesEcritures, 'id' | 'date' | 'montant'>,
): MouvementDesEcritures => ({
  dossier_id: D_BASCULE, libelle: 'VIR CLIENT FICTIF', source_fichier: 'releve-fictif.csv', encaissements_de_factures: true,
  statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null,
  declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false, ...o,
})

const ligneAvoir = (avoirId: string, ht: number, taux: number): LigneDeFacture => ({ ...ligneVendue(avoirId, ht, taux), quantite: -1 })

export function sourcesDuDossierBascule(): SourcesDesEcrituresDeVente {
  const encaissements = [
    encaissement({ id: 'e1', facture_id: 'f1', date_encaissement: '2025-11-20', montant: 120, ligne_bancaire_id: 'm1' }),
    encaissement({ id: 'e2', facture_id: 'f2', date_encaissement: '2025-11-21', montant: 100, moyen: 'cheque', ligne_bancaire_id: 'm2' }),
  ]
  return {
    dossierId: D_BASCULE,
    factures: [
      facture({ id: 'f1', numero: 'F2025-0001', date_emission: '2025-11-10', tiers_nom: 'Client fictif', montant_ttc: 120 }),
      facture({ id: 'f2', numero: 'F2025-0002', date_emission: '2025-11-12', tiers_nom: 'Clinique du Parc', montant_ttc: 240 }),
      facture({ id: 'f3', numero: 'F2025-0003', date_emission: '2025-11-14', tiers_nom: 'Client fictif', montant_ttc: 60 }),
      facture({
        id: 'a1', type: 'avoir', numero: 'A2025-0001', facture_origine_id: 'f3', date_emission: '2025-11-18',
        tiers_nom: 'Client fictif', montant_ttc: -60,
      }),
    ],
    lignes: [ligneVendue('f1', 100, 20), ligneVendue('f2', 200, 20), ligneVendue('f3', 50, 20), ligneAvoir('a1', 50, 20)],
    encaissements: encaissements.map((e) => e.encaissement),
    parts: encaissements.map((e) => e.part),
    mouvements: [
      mouvementDesVentes({ id: 'm1', date: '2025-11-20', montant: 120 }),
      mouvementDesVentes({ id: 'm2', date: '2025-11-22', montant: 100, libelle: 'REMISE CHEQUE FICTIVE' }),
    ],
  }
}

export function composition(sources: SourcesDesEcrituresDeVente, mode: ModeComptable, plan: PlanComptable): EcrituresDesVentesFacturees {
  return ecrituresDesVentesFacturees({
    sources: { dossierId: sources.dossierId, factures: sources.factures, lignes: sources.lignes, encaissements: sources.encaissements, parts: sources.parts },
    mouvements: sources.mouvements,
    comptesDeContrepartie: new Map(sources.encaissements
      .filter((e) => e.compte_contrepartie != null).map((e) => [e.id, e.compte_contrepartie as string])),
    mode, plan,
  })
}

/** Le brouillon que la fonction de VF4b aurait écrit pour chaque écriture composée : proposé, une ligne par ligne composée. */
export function brouillonDesVentes(c: EcrituresDesVentesFacturees, prefixe = 'v'): EcritureBrouillon[] {
  let i = 0
  return c.ecritures.flatMap((e) => lignesAuBrouillon(c.dossierId, e).map((l): EcritureBrouillon => ({
    ...l, id: `${prefixe}${++i}`, created_at: `${e.date}T12:00:00Z`, immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE,
  })))
}

/** Ce que les exports reçoivent de la lecture et de la composition. */
export function exportsDesVentes(sources: SourcesDesEcrituresDeVente, c: EcrituresDesVentesFacturees): VentesFactureesDesExports {
  return { ecritures: c.ecritures, factures: sources.factures, encaissements: sources.encaissements }
}

/** Un mouvement du relevé tel que la piste d'audit le relit en entier. */
export function ligneBancaire(m: MouvementDesEcritures): LigneBancaire {
  return {
    ...m, taux_tva: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, libelle_brut: null,
    id_externe: null, created_at: `${m.date}T08:00:00Z`,
  }
}

/** Une pièce de vente validée, comme celles d'avant la bascule. */
export const pieceDeVente = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => ({
  dossier_id: D_BASCULE, uploaded_by: null, source: 'upload', storage_path: `${D_BASCULE}/${o.id}.pdf`, nom_fichier: `${o.id}.pdf`,
  storage_hash: null, date_piece: '2025-11-05', tiers: 'Client fictif', montant_ht: 50, montant_tva: 10, montant_ttc: 60,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
  type_piece: 'vente', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null,
  created_at: '2025-11-05T09:00:00Z', updated_at: '2025-11-05T09:00:00Z', ...o,
})
