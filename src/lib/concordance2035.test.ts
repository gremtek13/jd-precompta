import { describe, expect, it } from 'vitest'
import { ecritureDuMouvement } from './affectationBanque'
import { ecritureDeLaDotation } from './amortissements'
import { comptesPartagesEntreCases, concordance2035, ouAgir, phraseDeLEcart, type EcartDeSource } from './concordance2035'
import { ecritureDuPaiementPersonnel } from './cotisationPersonnelle'
import { cotisationsComptees, ecritureDeLaCotisation } from './cotisationRapprochee'
import { calculerDeclaration2035 } from './declaration2035'
import { ecritureDeLEcheance } from './echeanceEmprunt'
import { lignesPourPiece } from './ecritures'
import type { ModeleComptable } from './engagement'
import { ecritureDuForfait } from './forfaitKilometrique'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces } from './rattachement'
import { ecritureDeLaVentilation } from './ventilationBanque'
import { ecritureDeLaLiquidation } from './liquidationTva'
import type {
  Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, LigneBancaire, Piece, VehiculeDossier,
  VentilationBancaire,
} from './types'
import { NON_VALIDEE } from '../test/ecritures'

// LA CONCORDANCE DE LA 2035 AVEC LES ÉCRITURES (ligne 26.6, étape c). Les écritures de ces tests viennent des
// VRAIS générateurs de l'application — celui d'une pièce, d'un mouvement affecté, d'une échéance d'emprunt,
// d'une ventilation, d'une cotisation, d'une dotation, d'un forfait — : ce que le premier test prouve, c'est
// qu'une comptabilité écrite par l'application concorde avec sa 2035, au centime. Chaque test suivant y
// défait une seule chose, et l'écart doit nommer cette chose-là.

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }

const categories = [
  { id: 'c-achats', libelle: 'Achats', compte_comptable: '606100', poste_2035: 'Achats' },
  { id: 'c-recettes', libelle: 'Recettes', compte_comptable: '706000', poste_2035: 'Recettes' },
  { id: 'c-frais', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' },
  { id: 'c-tel', libelle: 'Téléphone', compte_comptable: '626000', poste_2035: 'Fournitures de bureau' },
  { id: 'c-sans-poste', libelle: 'Divers', compte_comptable: '628000', poste_2035: null },
  { id: 'c-sans-compte', libelle: 'Sans compte', compte_comptable: null, poste_2035: 'Achats' },
  { id: 'c-bilan', libelle: 'Ancienne recette', compte_comptable: '108000', poste_2035: 'Recettes' },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece => ({
  id: 'p', dossier_id: 'd1', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10', tiers: 'Fournisseur',
  nom_fichier: 'facture.pdf', montant_ht: 120, montant_tva: null, montant_ttc: 120, categorie_id: 'c-achats',
  created_at: '2025-03-11T09:00:00Z', ...o,
}) as Piece

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2025-03-15', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: 'releve.csv',
  libelle_brut: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null,
  ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2025-03-16T09:00:00Z', ...o,
})

const cotisation = (o: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: 'co', dossier_id: 'd1', echeance: '2025-03-05', montant_appele: 3000, montant_verse: null, montant_csg_crds: 970,
  previsionnel: false, created_at: '2025-03-01T09:00:00Z', ...o,
})

const bien: Immobilisation = {
  id: 'i', dossier_id: 'd1', piece_id: null, nature_id: 'n', libelle: 'Ordinateur', valeur: 3000,
  date_acquisition: '2025-01-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-01-02T09:00:00Z',
}

const vehicule: VehiculeDossier = {
  id: 'v', dossier_id: 'd1', annee: 2025, modele: 'Clio', type: 'voiture', puissance_fiscale: 6, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 4000, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2025-01-02T09:00:00Z', updated_at: '2025-01-02T09:00:00Z',
}

// Une ligne d'écriture du brouillon, telle que la base la rend.
let numero = 0
const brouillon = (
  lignes: readonly { compte: string; sens: 'debit' | 'credit'; montant: number; libelle?: string; date?: string; piece_id?: string; ligne_bancaire_id?: string }[],
  lien: Partial<EcritureBrouillon>,
): EcritureBrouillon[] => lignes.map((l) => ({
  id: `e${++numero}`, dossier_id: 'd1', piece_id: l.piece_id ?? null, ligne_bancaire_id: l.ligne_bancaire_id ?? null,
  date: l.date ?? '2025-03-15', compte: l.compte, libelle: l.libelle ?? 'écriture', montant: l.montant, sens: l.sens,
  statut: 'proposee', created_at: '2025-03-16T09:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE, ...lien,
}))

// UN DOSSIER COMPLET, écrit par l'application : une facture payée, une recette sans paiement rapproché, des
// frais bancaires affectés, une échéance d'emprunt, un abonnement ventilé (en partie personnel), une
// cotisation prélevée avec sa CSG-CRDS, la dotation d'un bien et le forfait d'un véhicule.
function dossier(o: { assujetti?: boolean } = {}) {
  const assujetti = o.assujetti ?? false
  const facture = piece({ id: 'facture' })
  const recette = piece({ id: 'recette', type_piece: 'vente', categorie_id: 'c-recettes', date_piece: '2025-06-01', montant_ht: 500, montant_ttc: 500 })
  const paiementFacture = ligne({ id: 'l-facture', piece_id: 'facture', date: '2025-03-15', montant: -120 })
  const frais = ligne({ id: 'l-frais', categorie_id: 'c-frais', date: '2025-04-02', montant: -8.5 })
  const echeance = ligne({
    id: 'l-emprunt', date: '2025-05-06', montant: -540, emprunt_id: 'emp', emprunt_echeance: 2, emprunt_interets: 36, emprunt_assurance: 21.03,
  })
  const abonnement = ligne({ id: 'l-tel', date: '2025-07-10', montant: -120, ventilee: true })
  const ventilations: VentilationBancaire[] = [
    { id: 'vp1', dossier_id: 'd1', ligne_bancaire_id: 'l-tel', categorie_id: 'c-tel', part_personnelle: false, montant: -84, taux_tva: null, created_at: '2025-07-11T09:00:00Z' },
    { id: 'vp2', dossier_id: 'd1', ligne_bancaire_id: 'l-tel', categorie_id: null, part_personnelle: true, montant: -36, taux_tva: null, created_at: '2025-07-11T09:00:00Z' },
  ]
  const appel = cotisation({ id: 'appel' })
  const prelevement = ligne({ id: 'l-cotis', date: '2025-03-07', montant: -3000, cotisation_id: 'appel' })
  const lignes = [paiementFacture, frais, echeance, abonnement, prelevement]

  const paiements = paiementsDesPieces(lignes, [])
  const ecritures: EcritureBrouillon[] = [
    ...[facture, recette].flatMap((p) => brouillon(
      lignesPourPiece('d1', p, { compte: categories.find((c) => c.id === p.categorie_id)!.compte_comptable!, immobilisation: false }, assujetti, paiements.get(p.id) ?? [], TRESORERIE),
      {},
    )),
    ...brouillon(ecritureDuMouvement(frais, '627000', null), { ligne_bancaire_id: 'l-frais', date: frais.date }),
    ...brouillon(ecritureDeLEcheance(echeance, { echeance: 2, interets: 36, assurance: 21.03 }), { ligne_bancaire_id: 'l-emprunt', date: echeance.date }),
    ...brouillon(ecritureDeLaVentilation(abonnement, ventilations, categories, TRESORERIE, assujetti)!, { ligne_bancaire_id: 'l-tel', date: abonnement.date }),
    ...brouillon(ecritureDeLaCotisation(prelevement, appel, 'tresorerie'), { ligne_bancaire_id: 'l-cotis', date: prelevement.date }),
    ...brouillon(ecritureDeLaDotation(bien, '218300', 2025, null), { immobilisation_id: 'i', date: '2025-12-31' }),
    ...brouillon(ecritureDuForfait(vehicule, TRESORERIE, null)!, { vehicule_id: 'v', declaration_tva_id: null, date: '2025-12-31' }),
  ]
  return { pieces: [facture, recette], lignes, ventilations, cotisations: [appel], ecritures, assujetti }
}

type Dossier = ReturnType<typeof dossier>

function concordance(d: Dossier, o: {
  annee?: number; ouverture?: string | null; immobilisations?: Immobilisation[]; vehicules?: VehiculeDossier[]
  declarationsTva?: DeclarationTva[]
} = {}) {
  const immobilisations = o.immobilisations ?? [bien]
  const declaration = calculerDeclaration2035(
    o.annee ?? 2025, d.pieces, categories, immobilisations,
    cotisationsComptees(d.cotisations, d.lignes, 'tresorerie'), o.vehicules ?? [vehicule], d.assujetti,
    paiementsDesPieces(d.lignes, []), partsDuReleve(d.lignes, categories, d.ventilations, d.assujetti), o.declarationsTva ?? [],
  )
  return concordance2035(
    declaration, d.ecritures,
    {
      piecesValidees: new Set(d.pieces.filter((p) => p.statut === 'validee').map((p) => p.id)),
      piecesImmobilisees: new Set(immobilisations.map((i) => i.piece_id).filter((id): id is string => !!id)),
    },
    o.ouverture ?? null,
  )
}

const motifs = (ecarts: readonly EcartDeSource[]) => ecarts.map((e) => [e.cle, e.motif])

describe('concordance2035 — une comptabilité écrite par l’application', () => {
  it('concorde avec sa 2035, au centime', () => {
    const c = concordance(dossier())
    expect(c.ecarts).toEqual([])
    expect(c.concorde).toBe(true)
  })

  it('les deux résultats ne s’écartent que de la CSG déductible, sans écriture par construction', () => {
    // 970 € de CSG-CRDS au 108000 : 680 € déductibles en case BV, qu'aucune écriture ne porte.
    const c = concordance(dossier())
    expect(c.csgDeductible).toBe(680)
    expect(c.ecritures.recettes).toBe(c.declaration.recettes)
    expect(c.ecritures.depenses).toBe(Math.round((c.declaration.depenses - 680) * 100) / 100)
    expect(c.ecritures.resultat).toBe(Math.round((c.declaration.resultat + 680) * 100) / 100)
  })

  it('les totaux des écritures se lisent sur les comptes de résultat, au sens de chaque ligne', () => {
    // Recette : 500. Dépenses : 120 (facture) + 8,50 (frais) + 36 + 21,03 (échéance) + 84 (part du téléphone)
    // + 2 030 (cotisation sans sa CSG-CRDS) + 1 000 (dotation) + 2 660 (forfait).
    const c = concordance(dossier())
    expect(c.ecritures).toEqual({ recettes: 500, depenses: 5959.53, resultat: -5459.53 })
  })

  it('concorde aussi sur un dossier assujetti, au hors taxe', () => {
    const d = dossier({ assujetti: true })
    d.pieces[0] = piece({ id: 'facture', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })
    const paiements = paiementsDesPieces(d.lignes, [])
    d.ecritures = [
      ...brouillon(lignesPourPiece('d1', d.pieces[0], { compte: '606100', immobilisation: false }, true, paiements.get('facture') ?? [], TRESORERIE), {}),
      ...d.ecritures.filter((e) => e.piece_id !== 'facture'),
    ]
    expect(concordance(d).ecarts).toEqual([])
  })

  it('concorde au centime une pièce payée sur deux exercices', () => {
    // 100 € HT payés 50 € TTC en décembre, 70 € en janvier : 41,67 € et 58,33 €, dans les deux exercices.
    const d = dossier({ assujetti: true })
    const deux = [piece({ id: 'a', date_piece: '2025-12-01', montant_ht: 100, montant_tva: 20 }), piece({ id: 'b', date_piece: '2025-12-01', montant_ht: 100, montant_tva: 20 })]
    const paiementsDeux = deux.flatMap((p) => [
      ligne({ id: `${p.id}-dec`, piece_id: p.id, date: '2025-12-20', montant: -50 }),
      ligne({ id: `${p.id}-jan`, piece_id: p.id, date: '2026-01-10', montant: -70 }),
    ])
    const paiements = paiementsDesPieces(paiementsDeux, [])
    const e = { ...d, pieces: deux, lignes: paiementsDeux, ventilations: [], cotisations: [],
      ecritures: deux.flatMap((p) => brouillon(lignesPourPiece('d1', p, { compte: '606100', immobilisation: false }, true, paiements.get(p.id) ?? [], TRESORERIE), {})) }
    expect(concordance(e, { annee: 2025, immobilisations: [], vehicules: [] }).ecarts).toEqual([])
    expect(concordance(e, { annee: 2026, immobilisations: [], vehicules: [] }).ecarts).toEqual([])
  })
})

// L'ARRONDI D'UNE LIQUIDATION DE TVA (lib/liquidationTva.ts) : la 2035 le compte en gains divers ou en frais
// divers, l'écriture de la liquidation le porte au 758000 ou au 658000 — à la fin de la période.
describe('concordance2035 — l’arrondi d’une liquidation de TVA', () => {
  const q1: DeclarationTva = {
    id: 'q1', dossier_id: 'd1', periode_debut: '2025-01-01', periode_fin: '2025-03-31', tva_declaree: 79,
    credit_anterieur: 0, remboursement_demande: 0, date_declaration: '2025-04-15', notes: null, created_at: '2025-04-15T09:00:00Z',
    cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, l26: 0, l27: 0, l28: 79, l32: 79 },
    tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 0,
  }
  const liquidation = (d: DeclarationTva) => brouillon(ecritureDeLaLiquidation(d), { declaration_tva_id: d.id, date: d.periode_fin })

  it('concorde quand la liquidation est écrite : un produit au 758000, compté en gains divers', () => {
    const d = dossier({ assujetti: true })
    d.ecritures.push(...liquidation(q1))
    const c = concordance(d, { declarationsTva: [q1] })
    expect(c.ecarts).toEqual([])
    expect(c.declaration.recettes).toBe(500.80)
  })

  it('une charge au 658000, comptée en frais divers', () => {
    const d = dossier({ assujetti: true })
    const charge = { ...q1, tva_collectee: 99.20 }
    d.ecritures.push(...liquidation(charge))
    const c = concordance(d, { declarationsTva: [charge] })
    expect(c.ecarts).toEqual([])
    expect(c.ecritures.depenses).toBe(5959.93)
  })

  it('une liquidation sans écriture : la 2035 compte l’arrondi, rien ne le porte — à retrouver dans l’onglet TVA', () => {
    const c = concordance(dossier({ assujetti: true }), { declarationsTva: [q1] })
    expect(motifs(c.ecarts)).toEqual([['declaration:q1', 'sans_ecriture']])
    expect(c.ecarts[0]).toMatchObject({ declaration: 0.80, libelle: 'Arrondi de la CA3 1er trimestre 2025', date: '2025-03-31', comptesDeclaration: ['758000'] })
    expect(ouAgir(c.ecarts[0])).toBe('TVA')
  })

  it('l’arrondi d’une période d’un autre exercice ne compte pas dans celui-ci', () => {
    const q4 = { ...q1, id: 'q4', periode_debut: '2024-10-01', periode_fin: '2024-12-31' }
    const c = concordance(dossier({ assujetti: true }), { declarationsTva: [q4] })
    expect(c.ecarts).toEqual([])
  })
})

describe('concordance2035 — ce que la 2035 compte et que le brouillon ne porte pas', () => {
  it('une pièce sans écriture', () => {
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => e.piece_id !== 'facture')
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'sans_ecriture']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -120, ecritures: 0, libelle: 'Fournisseur', date: '2025-03-10', comptesDeclaration: ['606100'] })
    expect(c.concorde).toBe(false)
  })

  it('une écriture datée d’un autre exercice : manquante ici, de trop là-bas', () => {
    // Payée en janvier 2026, écrite à sa date de facture avant le rapprochement, jamais régénérée.
    const d = dossier()
    const decembre = piece({ id: 'dec', date_piece: '2025-12-20' })
    d.pieces.push(decembre)
    d.lignes.push(ligne({ id: 'l-dec', piece_id: 'dec', date: '2026-01-05', montant: -120 }))
    d.ecritures.push(...brouillon(lignesPourPiece('d1', decembre, { compte: '606100', immobilisation: false }, false, [], TRESORERIE), {}))
    expect(motifs(concordance(d, { annee: 2026, immobilisations: [], vehicules: [] }).ecarts)).toEqual([['piece:dec', 'ecriture_autre_exercice']])
    expect(concordance(d, { annee: 2026, immobilisations: [], vehicules: [] }).ecarts[0].autresExercices).toEqual([2025])
    expect(motifs(concordance(d).ecarts)).toEqual([['piece:dec', 'compte_autre_exercice']])
  })

  it('une catégorie qui a perdu son compte après l’écriture', () => {
    const d = dossier()
    d.pieces[0] = piece({ id: 'facture', categorie_id: 'c-sans-compte' })
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'sans_compte']])
    expect(c.ecarts[0]).toMatchObject({ comptesDeclaration: [null], comptesEcritures: ['606100'] })
  })

  it('une catégorie sans compte : la 2035 compte la pièce, rien ne peut l’écrire', () => {
    const d = dossier()
    d.pieces.push(piece({ id: 'sc', categorie_id: 'c-sans-compte' }))
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:sc', 'sans_compte']])
    expect(c.ecarts[0].comptesDeclaration).toEqual([null])
  })

  it('une échéance de cotisation comptée à son échéance, faute de prélèvement rapproché', () => {
    const d = dossier()
    d.cotisations.push(cotisation({ id: 'attente', echeance: '2025-09-05', montant_appele: 500, montant_csg_crds: null }))
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['cotisation:attente', 'echeance_sans_paiement']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -500, reference: { type: 'cotisation', id: 'attente' } })
  })

  it('une échéance rapprochée d’un mouvement qui ne peut pas la payer : son rapprochement, pas un prélèvement manquant', () => {
    // Un remboursement rapproché d'un appel ne s'écrit pas : l'échéance reste comptée à son échéance, et la
    // phrase reprend la raison que donne le rapprochement, au lieu d'envoyer chercher un prélèvement.
    const d = dossier()
    d.cotisations.push(cotisation({ id: 'refuse', echeance: '2025-09-05', montant_appele: 500, montant_csg_crds: null }))
    d.lignes.push(ligne({ id: 'l-rembourse', date: '2025-09-08', montant: 500, cotisation_id: 'refuse' }))
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['cotisation:refuse', 'rapprochement_refuse']])
    expect(phraseDeLEcart(c.ecarts[0])).toMatch(/^Son rapprochement ne s’écrit pas, elle reste comptée à son échéance\. Ce mouvement est un encaissement/)
    expect(ouAgir(c.ecarts[0])).toBe('Banque')
  })

  // PAYÉE DEPUIS LE COMPTE PERSONNEL (lib/cotisationPersonnelle.ts) : la 2035 la compte au jour du paiement, son écriture
  // la désigne ce jour-là — la cotisation hors CSG-CRDS au 646000 face au 108000 —, et les deux concordent.
  const payeePerso = (o: Partial<CotisationDeclaree> = {}) => cotisation({
    id: 'perso', echeance: '2025-09-05', montant_appele: 500, montant_csg_crds: 48.5, paiement_personnel_le: '2025-09-10', ...o,
  })
  const ecritePerso = (c: CotisationDeclaree) =>
    brouillon(ecritureDuPaiementPersonnel(c, TRESORERIE), { cotisation_id: c.id, date: c.paiement_personnel_le! })

  it('une échéance payée depuis le compte personnel concorde avec son écriture, au jour du paiement', () => {
    const d = dossier()
    const c = payeePerso()
    d.cotisations.push(c)
    d.ecritures.push(...ecritePerso(c))
    expect(concordance(d).ecarts).toEqual([])
    // Payée en 2026 pour une échéance de 2025 : elle compte en 2026, comme son écriture.
    const e = dossier()
    const tardive = payeePerso({ paiement_personnel_le: '2026-01-10' })
    e.cotisations.push(tardive)
    e.ecritures.push(...ecritePerso(tardive))
    expect(concordance(e).ecarts).toEqual([])
    expect(motifs(concordance(e, { annee: 2026 }).ecarts).filter(([cle]) => cle === 'cotisation:perso')).toEqual([])
  })

  it('payée depuis le compte personnel sans son écriture : une écriture manque, pas un paiement', () => {
    const d = dossier()
    d.cotisations.push(payeePerso())
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['cotisation:perso', 'sans_ecriture']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -451.5, reference: { type: 'cotisation', id: 'perso' } })
    expect(c.ecarts[0].libelle).toBe('Échéance de cotisation du 05/09/2025, réglée sur le compte personnel le 10/09/2025')
    expect(ouAgir(c.ecarts[0])).toBe('Cotisations')
  })

  it('un paiement personnel qui ne peut pas s’écrire : comptée à son échéance, le paiement est à reprendre', () => {
    const d = dossier()
    d.cotisations.push(payeePerso({ montant_csg_crds: 600 }))
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['cotisation:perso', 'paiement_personnel_refuse']])
    expect(phraseDeLEcart(c.ecarts[0])).toBe(
      'Son paiement depuis le compte personnel ne s’écrit pas, elle reste comptée à son échéance. '
      + 'La CSG-CRDS de cette échéance (600,00 €) dépasse son montant (500,00 €).')
    expect(ouAgir(c.ecarts[0])).toBe('Cotisations')
  })

  it('nomme chaque source comme la carte la dit', () => {
    // Un véhicule sans modèle se nomme par ce que le barème en sait ; une échéance porte ses deux dates.
    const d = dossier()
    d.ecritures = []
    d.cotisations.push(cotisation({ id: 'attente', echeance: '2025-09-05', montant_appele: 500, montant_csg_crds: null }))
    const sansModele = { ...vehicule, modele: null }
    const noms = new Map(concordance(d, { vehicules: [sansModele] }).ecarts.map((e) => [e.cle, [e.libelle, e.date]]))
    expect(noms.get('vehicule:v')).toEqual(['Forfait kilométrique : Voiture 6 CV', null])
    expect(noms.get('bien:i')).toEqual(['Dotation : Ordinateur', null])
    expect(noms.get('mouvement:l-cotis')).toEqual(['Échéance de cotisation du 05/03/2025, prélevée le 07/03/2025', null])
    expect(noms.get('cotisation:attente')).toEqual(['Échéance de cotisation du 05/09/2025', null])
    expect(noms.get('piece:facture')).toEqual(['Fournisseur', '2025-03-10'])
    expect(noms.get('mouvement:l-frais')).toEqual(['PRLV', '2025-04-02'])
  })

  it('une dotation que l’onglet Immobilisations n’a pas écrite', () => {
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => !e.immobilisation_id)
    expect(motifs(concordance(d).ecarts)).toEqual([['bien:i', 'sans_ecriture']])
  })

  it('la dotation de l’exercice qui manque, quand celle d’avant est écrite : à écrire, pas « datée d’un autre exercice »', () => {
    // Une dotation tombe au 31 décembre de son exercice : celle de 2025 est l'AUTRE dotation du bien, pas celle de
    // 2026 écrite ailleurs. Le dire « à régénérer » enverrait chercher une écriture qui n'existe pas.
    const d = dossier()
    const c = concordance(d, { annee: 2026, vehicules: [] })
    const ecart = c.ecarts.find((e) => e.cle === 'bien:i')!
    expect(ecart.motif).toBe('sans_ecriture')
    expect(ecart.autresExercices).toEqual([])
    expect(ecart.declaration).toBe(-1000)
    expect(phraseDeLEcart(ecart)).not.toMatch(/datée/)
    expect(ouAgir(ecart)).toBe('Immobilisations')
  })

  it('la dotation d’un bien sans nature : rien ne peut l’écrire tant que sa nature manque', () => {
    // La 2035 la compte — sa valeur et sa durée suffisent au calcul —, mais son compte 28 vient de sa nature.
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => !e.immobilisation_id)
    const c = concordance(d, { immobilisations: [{ ...bien, nature_id: null }] })
    expect(motifs(c.ecarts)).toEqual([['bien:i', 'bien_sans_nature']])
    expect(phraseDeLEcart(c.ecarts[0])).toMatch(/^Sans nature, son compte d’amortissement n’est pas connu/)
    expect(ouAgir(c.ecarts[0])).toBe('Immobilisations')
  })

  it('un forfait kilométrique qu’on n’a pas écrit', () => {
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => !e.vehicule_id)
    expect(motifs(concordance(d).ecarts)).toEqual([['vehicule:v', 'sans_ecriture']])
  })
})

describe('concordance2035 — une écriture qui ne suit plus sa source', () => {
  it('un montant différent', () => {
    // Le TTC corrigé après la génération : 150 € à la 2035, 120 € au brouillon.
    const d = dossier()
    d.pieces[0] = piece({ id: 'facture', montant_ht: 150, montant_ttc: 150 })
    d.lignes[0] = ligne({ id: 'l-facture', piece_id: 'facture', date: '2025-03-15', montant: -150 })
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'montant_different']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -150, ecritures: -120 })
  })

  it('le même montant sur un autre compte', () => {
    // Recatégorisée après la génération : la 2035 l'attend au 626000, l'écriture est restée au 606100.
    const d = dossier()
    d.pieces[0] = piece({ id: 'facture', categorie_id: 'c-tel' })
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'compte_different']])
    expect(c.ecarts[0]).toMatchObject({ comptesDeclaration: ['626000'], comptesEcritures: ['606100'] })
  })

  it('une ventilation dont une part a changé de catégorie', () => {
    const d = dossier()
    d.ventilations[0] = { ...d.ventilations[0], categorie_id: 'c-achats' }
    expect(motifs(concordance(d).ecarts)).toEqual([['mouvement:l-tel', 'compte_different']])
  })

  it('une échéance de cotisation dont la CSG-CRDS a été saisie après l’écriture', () => {
    const d = dossier()
    d.cotisations[0] = cotisation({ id: 'appel', montant_csg_crds: 1000 })
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['mouvement:l-cotis', 'montant_different']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -2000, ecritures: -2030 })
  })
})

describe('concordance2035 — une écriture de l’exercice que la 2035 ne compte pas', () => {
  it('la pièce n’est plus validée', () => {
    const d = dossier()
    d.pieces[0] = { ...d.pieces[0], statut: 'a_valider' }
    expect(motifs(concordance(d).ecarts)).toEqual([['piece:facture', 'piece_non_validee']])
  })

  it('la facture est celle d’un bien du registre, compté par sa dotation', () => {
    const d = dossier()
    const c = concordance(d, { immobilisations: [{ ...bien, piece_id: 'facture' }] })
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'piece_immobilisee']])
  })

  it('la pièce n’a pas de date : son écriture est au dépôt', () => {
    const d = dossier()
    const sansDate = piece({ id: 'sd', date_piece: null, created_at: '2025-05-10T08:00:00Z' })
    d.pieces.push(sansDate)
    d.ecritures.push(...brouillon(lignesPourPiece('d1', sansDate, { compte: '606100', immobilisation: false }, false, [], TRESORERIE), {}))
    expect(motifs(concordance(d).ecarts)).toEqual([['piece:sd', 'piece_sans_date']])
  })

  it('une pièce dont une part n’a pas de date, l’autre comptée le même exercice', () => {
    // 48 € payés le 10/05, les 72 € restants sans date, écrits au dépôt le même jour : la 2035 compte 48 €.
    const d = dossier()
    const sansDate = piece({ id: 'sd', date_piece: null, created_at: '2025-05-10T08:00:00Z' })
    const partiel = ligne({ id: 'l-sd', piece_id: 'sd', date: '2025-05-10', montant: -48 })
    d.pieces.push(sansDate)
    d.lignes.push(partiel)
    d.ecritures.push(...brouillon(lignesPourPiece('d1', sansDate, { compte: '606100', immobilisation: false }, false, paiementsDesPieces([partiel], []).get('sd') ?? [], TRESORERIE), {}))
    const c = concordance(d)
    expect(motifs(c.ecarts)).toEqual([['piece:sd', 'piece_sans_date']])
    expect(c.ecarts[0]).toMatchObject({ declaration: -48, ecritures: -120 })
  })

  it('la catégorie n’a pas de poste', () => {
    const d = dossier()
    const sansPoste = piece({ id: 'sp', categorie_id: 'c-sans-poste' })
    d.pieces.push(sansPoste)
    d.ecritures.push(...brouillon(lignesPourPiece('d1', sansPoste, { compte: '628000', immobilisation: false }, false, [], TRESORERIE), {}))
    expect(motifs(concordance(d).ecarts)).toEqual([['piece:sp', 'sans_poste']])
  })

  it('la pièce n’a plus de montant lisible', () => {
    const d = dossier()
    const vide = piece({ id: 'vide' })
    d.ecritures.push(...brouillon(lignesPourPiece('d1', vide, { compte: '606100', immobilisation: false }, false, [], TRESORERIE), {}))
    d.pieces.push({ ...vide, montant_ht: null, montant_ttc: null })
    expect(motifs(concordance(d).ecarts)).toEqual([['piece:vide', 'sans_montant']])
  })

  it('le compte de la catégorie d’un mouvement a quitté les comptes de résultat', () => {
    const d = dossier()
    d.lignes[1] = { ...d.lignes[1], categorie_id: 'c-bilan' }
    expect(motifs(concordance(d).ecarts)).toEqual([['mouvement:l-frais', 'hors_resultat']])
  })

  it('la catégorie d’un mouvement n’a plus de poste', () => {
    const d = dossier()
    d.lignes[1] = { ...d.lignes[1], categorie_id: 'c-sans-poste' }
    expect(motifs(concordance(d).ecarts)).toEqual([['mouvement:l-frais', 'sans_poste']])
  })

  it('un forfait écrit pour un véhicule qui ne roule plus', () => {
    const d = dossier()
    expect(motifs(concordance(d, { vehicules: [{ ...vehicule, km_professionnel: 0 }] }).ecarts)).toEqual([['vehicule:v', 'non_comptee']])
  })

  it('une écriture sans pièce, sans mouvement, sans bien ni véhicule', () => {
    const d = dossier()
    d.ecritures.push(...brouillon([{ compte: '606100', sens: 'debit', montant: 199.99, libelle: 'BOULANGER' }, { compte: '512000', sens: 'credit', montant: 199.99 }], {}))
    const c = concordance(d)
    expect(c.ecarts.map((e) => e.motif)).toEqual(['sans_justificatif'])
    expect(c.ecarts[0]).toMatchObject({ declaration: 0, ecritures: -199.99, libelle: 'BOULANGER', source: null, reference: { type: 'ecriture' } })
  })
})

describe('concordance2035 — bornes', () => {
  it('ne compare rien d’un exercice antérieur à l’ouverture d’un dossier repris', () => {
    const d = dossier()
    d.ecritures = []
    const c = concordance(d, { ouverture: '2026-01-01' })
    expect(c.anterieurALOuverture).toBe(true)
    expect(c.ecarts).toEqual([])
  })

  it('compare l’exercice même de l’ouverture', () => {
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => e.piece_id !== 'facture')
    const c = concordance(d, { ouverture: '2025-01-01' })
    expect(c.anterieurALOuverture).toBe(false)
    expect(motifs(c.ecarts)).toEqual([['piece:facture', 'sans_ecriture']])
  })

  it('ignore les comptes de bilan, d’un côté comme de l’autre', () => {
    // La banque, la TVA, le compte du dirigeant, une immobilisation : rien de cela n'entre dans le résultat.
    const d = dossier()
    d.ecritures.push(...brouillon([{ compte: '218300', sens: 'debit', montant: 3000 }, { compte: '445620', sens: 'debit', montant: 600 }, { compte: '512000', sens: 'credit', montant: 3600 }], {}))
    expect(concordance(d).ecarts).toEqual([])
  })

  it('range les écarts du plus gros au plus petit', () => {
    const d = dossier()
    d.ecritures = d.ecritures.filter((e) => e.piece_id !== 'facture' && !e.vehicule_id && e.ligne_bancaire_id !== 'l-frais')
    expect(concordance(d).ecarts.map((e) => e.cle)).toEqual(['vehicule:v', 'piece:facture', 'mouvement:l-frais'])
  })
})

describe('phraseDeLEcart', () => {
  const ecart = (o: Partial<EcartDeSource>): EcartDeSource => ({
    cle: 'piece:p', source: null, reference: { type: 'piece', id: 'p' }, libelle: 'x', date: null,
    declaration: -120, ecritures: 0, comptesDeclaration: ['606100'], comptesEcritures: [], autresExercices: [], motif: 'sans_ecriture', ...o,
  })

  it('dit ce qui diffère et ce qui le corrige', () => {
    expect(phraseDeLEcart(ecart({}))).toBe('La 2035 la compte (120,00 €), aucune écriture ne la porte : à écrire.'.replace(/ €/g, ' €'))
    expect(phraseDeLEcart(ecart({ motif: 'ecriture_autre_exercice', autresExercices: [2024, 2026] })))
      .toBe('Son écriture est datée de 2024, 2026, la 2035 la compte cet exercice : à régénérer.')
    expect(phraseDeLEcart(ecart({ motif: 'compte_different', comptesDeclaration: ['626000'], comptesEcritures: ['606100'] })))
      .toBe('L’écriture est au 606100, la 2035 l’attend au 626000 : à régénérer ou à réécrire.')
    expect(phraseDeLEcart(ecart({ motif: 'sans_compte', comptesDeclaration: [null], comptesEcritures: ['606100'] })))
      .toBe('Sa catégorie n’a plus de compte comptable : son écriture est restée au 606100, et rien ne peut la réécrire tant qu’elle n’en a pas.')
  })

  it('a une phrase pour chaque motif', () => {
    const tous = [
      'sans_ecriture', 'ecriture_autre_exercice', 'sans_compte', 'echeance_sans_paiement', 'rapprochement_refuse', 'bien_sans_nature',
      'montant_different', 'compte_different',
      'piece_non_validee', 'piece_immobilisee', 'piece_sans_date', 'sans_poste', 'sans_montant', 'hors_resultat',
      'compte_autre_exercice', 'non_comptee', 'sans_justificatif',
    ] as const
    const phrases = tous.map((motif) => phraseDeLEcart(ecart({ motif })))
    expect(new Set(phrases).size).toBe(tous.length)
    for (const p of phrases) expect(p.length).toBeGreaterThan(20)
  })
})

// OÙ AGIR : l'onglet qui porte le geste. Une case de cette colonne qui se trompe envoie l'opérateur dans un
// écran où rien ne le corrige — le défaut d'un point de Checklist qui renvoie vers une liste vide.
describe('ouAgir', () => {
  const ecart = (o: Partial<EcartDeSource>): EcartDeSource => ({
    cle: 'x', source: null, reference: { type: 'piece', id: 'p' }, libelle: 'x', date: null, declaration: -120, ecritures: 0,
    comptesDeclaration: ['606100'], comptesEcritures: [], autresExercices: [], motif: 'sans_ecriture', ...o,
  })
  const d = dossier()
  const sourcePiece = { type: 'piece', id: 'facture', piece: d.pieces[0] } as const
  const sourceCotisation = (o: { ligne?: LigneBancaire | null; paiementPersonnel?: string | null; refus?: string | null } = {}) => ({
    type: 'cotisation', id: 'appel', cotisation: d.cotisations[0], ligne: o.ligne ?? null,
    paiementPersonnel: o.paiementPersonnel ?? null, refus: o.refus ?? null,
  }) as const

  it('un poste ou un compte manquant se complète là où il manque, quelle que soit la source', () => {
    expect(ouAgir(ecart({ motif: 'sans_poste', source: sourcePiece }))).toBe('Clôture — Postes manquants')
    expect(ouAgir(ecart({ motif: 'sans_compte', source: sourcePiece }))).toBe('Écritures — Comptes manquants')
  })

  it('une pièce : Justificatifs pour la valider, Écritures pour l’écrire', () => {
    expect(ouAgir(ecart({ motif: 'piece_non_validee' }))).toBe('Justificatifs')
    expect(ouAgir(ecart({ source: sourcePiece }))).toBe('Écritures')
    expect(ouAgir(ecart({ motif: 'montant_different', source: sourcePiece }))).toBe('Écritures')
  })

  it('un bien, un véhicule : l’onglet qui écrit sa dotation ou son forfait', () => {
    expect(ouAgir(ecart({ source: { type: 'bien', id: 'i', immobilisation: bien } }))).toBe('Immobilisations')
    expect(ouAgir(ecart({ source: { type: 'vehicule', id: 'v', vehicule } }))).toBe('Informations du dossier — Véhicules')
    // Une écriture qui désigne un bien que la 2035 ne compte pas cet exercice : la référence suffit.
    expect(ouAgir(ecart({ motif: 'non_comptee', reference: { type: 'bien', id: 'i' } }))).toBe('Immobilisations')
  })

  it('une échéance de cotisation : Banque pour la rapprocher, Cotisations pour écrire un rapprochement', () => {
    expect(ouAgir(ecart({ motif: 'echeance_sans_paiement', source: sourceCotisation() }))).toBe('Banque')
    expect(ouAgir(ecart({ motif: 'rapprochement_refuse', source: sourceCotisation({ refus: 'Refusé.' }) }))).toBe('Banque')
    expect(ouAgir(ecart({ source: sourceCotisation({ ligne: d.lignes[4] }) }))).toBe('Cotisations')
  })

  it('un mouvement : Banque pour le réaffecter, Écritures pour le réécrire', () => {
    const sourceMouvement = { type: 'mouvement', id: 'l-frais', ligne: d.lignes[1] } as const
    expect(ouAgir(ecart({ motif: 'hors_resultat', source: null, reference: { type: 'mouvement', id: 'l-frais' } }))).toBe('Banque')
    expect(ouAgir(ecart({ source: sourceMouvement }))).toBe('Écritures')
    expect(ouAgir(ecart({ motif: 'sans_justificatif', reference: { type: 'ecriture', id: 'e' } }))).toBe('Écritures')
  })
})

describe('comptesPartagesEntreCases', () => {
  const declarer = (cats: Categorie[], pieces: Piece[]) => calculerDeclaration2035(
    2025, pieces, cats, [], [], [], false, paiementsDesPieces([], []), [], [],
  )

  it('dit un compte que deux postes de cases différentes partagent', () => {
    const cats = [
      { id: 'c1', libelle: 'Honoraires', compte_comptable: '622600', poste_2035: 'Honoraires ne constituant pas des rétrocessions' },
      { id: 'c2', libelle: 'Cotisations', compte_comptable: '622600', poste_2035: 'Cotisations syndicales et professionnelles' },
    ] as Categorie[]
    const d = declarer(cats, [piece({ id: 'a', categorie_id: 'c1' }), piece({ id: 'b', categorie_id: 'c2' })])
    expect(comptesPartagesEntreCases(d)).toEqual([{
      compte: '622600',
      cases: [
        { code: 'BH', postes: ['Honoraires ne constituant pas des rétrocessions'] },
        { code: 'BM', postes: ['Cotisations syndicales et professionnelles'] },
      ],
    }])
  })

  it('se tait sur deux postes de la même case', () => {
    const cats = [
      { id: 'c1', libelle: 'Honoraires', compte_comptable: '616000', poste_2035: 'Honoraires ne constituant pas des rétrocessions' },
      { id: 'c2', libelle: 'Assurance', compte_comptable: '616000', poste_2035: "Primes d'assurance" },
    ] as Categorie[]
    expect(comptesPartagesEntreCases(declarer(cats, [piece({ id: 'a', categorie_id: 'c1' }), piece({ id: 'b', categorie_id: 'c2' })]))).toEqual([])
  })
})
