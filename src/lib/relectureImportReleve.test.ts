// RELECTURE DE L'IMPORT DES RELEVÉS ET DU RAPPROCHEMENT (31/10/2026) — des défauts PROUVÉS, rien de corrigé.
// Chaque test décrit le comportement ATTENDU ; il est rouge tant que le défaut vit. Ils sont marqués `it.fails` pour que
// la suite reste verte : le jour où le défaut est corrigé, `it.fails` passe au rouge et rappelle de le rendre `it`.
import { describe, expect, it } from 'vitest'
import { detectColumnMapping, montantDeLigne, parseCsv, parseDateBancaire, parseMontantBancaire } from './csv'
import { decoderUtf8OuWindows1252 } from './decodageTexte'
import { controlerSolde, lignesDeSolde } from './soldeReleve'
import { analyserAppariements, planRapprochementAutomatique } from './appariementBanque'
import { justificatifPossible, planAffectationParRegles } from './reglesAffectation'
import { statutPourLibelle } from './reglesIgnorees'
import { AUCUN_CANDIDAT, AUCUN_HORS_DES_LOTS } from './mouvementsDesVentes'
import { AUCUNE_FACTURE_SOURCE } from './facturesSources'
import type { Categorie, LigneBancaire, Piece, RegleAffectationBancaire } from './types'

function ligne(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'l1', dossier_id: 'd1', date: '2025-03-12', libelle: 'PRLV SEPA X', montant: -38.4,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null,
    source_fichier: 'releve-2025.csv', libelle_brut: null, created_at: '2025-04-01T10:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/p1.pdf',
    nom_fichier: 'facture.pdf', storage_hash: null, date_piece: '2025-03-01', tiers: 'Fournitures Medicales Bertin',
    montant_ht: 60, montant_tva: 0, montant_ttc: 60, devise: 'EUR', montant_devise: null,
    taux_change: null, conversion_source: null, categorie_id: null, sous_dossier_id: null,
    type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2025-03-02T09:00:00Z', updated_at: '2025-03-02T09:00:00Z', ...o,
  }
}

const HONORAIRES: Categorie = {
  id: 'cat-tel', dossier_id: null, code: 'telecom', libelle: 'Téléphone', ordre: 60,
  compte_comptable: '626000', poste_2035: 'Frais de télécommunication',
}

function regle(o: Partial<RegleAffectationBancaire> = {}): RegleAffectationBancaire {
  return { id: 'r1', dossier_id: 'd1', motif: 'telecom', sens: 'decaissement', categorie_id: 'cat-tel', taux_tva: null, created_at: '2025-04-02T10:00:00Z', ...o }
}

describe('Relecture — la détection des colonnes', () => {
  // Export CIC / Crédit Mutuel : « Date;Date de valeur;Débit;Crédit;Libellé;Solde ». La colonne Solde est remplie sur
  // TOUTES les lignes, Débit et Crédit sur une partie seulement : elle gagne le compte des montants, et l'import, laissé
  // en « Une colonne (montant signé) », écrit le SOLDE COURANT comme montant de chaque mouvement.
  const CIC = [
    'Date;Date de valeur;Débit;Crédit;Libellé;Solde',
    '02/01/2025;02/01/2025;-45,20;;CB PHARMACIE DU CENTRE;1 954,80',
    '03/01/2025;03/01/2025;;120,00;VIR CPAM DES YVELINES;2 074,80',
    '06/01/2025;06/01/2025;-89,00;;PRLV SEPA ORANGE;1 985,80',
    '07/01/2025;07/01/2025;;60,00;VIR M DUPONT;2 045,80',
  ].join('\n')
  // Corrigé le 31/10/2026 : l'en-tête Solde fait foi, et le format Débit / Crédit est réglé par la détection.
  it('ne prend pas la colonne du solde courant pour celle des montants', () => {
    const rows = parseCsv(CIC)
    const m = detectColumnMapping(rows)
    expect(m.colMontant).not.toBe(5)
    expect(m).toMatchObject({ format: 'debit_credit', colDebit: 2, colCredit: 3, colSolde: 5 })
    expect(montantDeLigne(rows[1], m)).toEqual({ montant: -45.2 })
  })

  // Export Crédit Agricole : « Date;Libellé;Débit euros;Crédit euros », débits POSITIFS dans leur colonne. La détection
  // ne proposait jamais « Deux colonnes » (handleFile remettait `mode` à 'signe') : laissée telle quelle, la colonne Débit
  // était prise comme un montant signé, et chaque débit entrait comme un ENCAISSEMENT ; les crédits étaient « ignorés ».
  it('ne laisse pas un fichier Débit / Crédit en « montant signé » : un débit positif n’est pas une recette', () => {
    const rows = parseCsv([
      'Date;Libellé;Débit euros;Crédit euros',
      '02/01/2025;CB PHARMACIE;45,20;',
      '06/01/2025;PRLV ORANGE;89,00;',
      '07/01/2025;VIR CPAM;;120,00',
    ].join('\n'))
    const m = detectColumnMapping(rows)
    // L'assertion d'origine lisait `colMontant` en montant signé : le format étant désormais réglé, le montant se lit
    // par `montantDeLigne`, la seule interprétation de l'aperçu comme de l'import.
    expect(m.format).toBe('debit_credit')
    expect(montantDeLigne(rows[1], m)).toEqual({ montant: -45.2 })
    expect(montantDeLigne(rows[3], m)).toEqual({ montant: 120 })
  })
})

describe('Relecture — les lignes de solde', () => {
  // Un virement d'un patient « SOLDE » d'une note d'honoraires est une OPÉRATION. Le mot le fait prendre pour un solde :
  // il ne s'importe pas, et avec les deux vrais soldes il y en a TROIS — `controlerSolde` rend null, le relevé n'est
  // plus vérifié du tout, et la recette disparaît sans que le contrôle ne crie.
  const rows = parseCsv([
    '01/03/2025;SOLDE CREDITEUR AU 28/02/2025;1 000,00',
    '05/03/2025;VIR M DUPONT SOLDE NOTE HONORAIRES;60,00',
    '10/03/2025;PRLV SEPA ORANGE;-40,00',
    '31/03/2025;SOLDE CREDITEUR AU 31/03/2025;1 020,00',
  ].join('\n'))
  const mapping = { colDate: 0, colLibelle: 1, colMontant: 2, hasHeader: false }
  // Corrigé le 31/10/2026 : seul ce qui a la forme d'un solde en est un (`aLaFormeDUnSolde`).
  it('ne prend pas pour un solde un virement dont le libellé dit « solde »', () => {
    expect(lignesDeSolde(rows, mapping).map((l) => l.index)).toEqual([0, 3])
  })
  it('et le relevé, ses deux vrais soldes reconnus, se vérifie avec la recette', () => {
    const indices = lignesDeSolde(rows, mapping).map((l) => l.index)
    const soldes = indices.map((i) => ({ date: parseDateBancaire(rows[i][0])!, montant: parseMontantBancaire(rows[i][2])! }))
    expect(controlerSolde(soldes, [{ montant: 60 }, { montant: -40 }])).toMatchObject({ coherent: true })
  })
})

describe('Relecture — l’encodage du fichier', () => {
  // `handleFile` (BanqueTab.tsx) lit le fichier par `blob.text()` : de l'UTF-8 indulgent. Un export en windows-1252
  // (courant chez les banques françaises) qui écrit « € » dans ses montants (octet 0x80) le voit devenir U+FFFD — et
  // `parseMontantBancaire` ne retire que U+20AC : le montant devient illisible, la ligne est « ignorée ». BalanceCard
  // et l'import des contacts décodent, eux, en UTF-8 strict avec repli windows-1252.
  // Corrigé le 31/10/2026 : `handleFile` décode les octets par `decoderUtf8OuWindows1252`, la règle de la balance reprise.
  // Le test d'origine décodait par `blob.text()`, le défaut lui-même : il décode désormais comme l'import.
  it('lit le montant d’une ligne d’un export windows-1252 qui écrit le symbole euro', async () => {
    const octets = Uint8Array.from([...'05/03/2025;PHARMACIE;-12,50 '].map((c) => c.charCodeAt(0)).concat([0x80]))
    const { texte, encodage } = decoderUtf8OuWindows1252(new Uint8Array(await new Blob([octets]).arrayBuffer()))
    expect(encodage).toBe('windows-1252')
    const rows = parseCsv(texte)
    expect(parseMontantBancaire(rows[0][2])).toBe(-12.5)
  })
})

describe('Relecture — « Tout rapprocher automatiquement » et le sens du mouvement', () => {
  // Une fourniture de 60 € (pièce d'ACHAT validée) datée du 03/03, réglée plus tard ; le 05/03, un patient vire 60 €.
  // `candidatsPieces` compare les montants en valeur absolue et `planRapprochementAutomatique` ne regarde pas le sens
  // (`analyserAppariements`, lui, le fait) : le lot rapproche l'achat de la RECETTE — la recette disparaît de la 2035.
  it.fails('ne rapproche pas une pièce d’achat d’un encaissement du même montant', () => {
    const plan = planRapprochementAutomatique(
      [ligne({ id: 'credit-patient', date: '2025-03-05', montant: 60, libelle: 'VIR M DUPONT' })],
      [piece({ id: 'achat', date_piece: '2025-03-03' })],
      [], { pieces: new Set(), cotisations: new Set() }, AUCUN_HORS_DES_LOTS, AUCUNE_FACTURE_SOURCE,
    )
    expect(plan.retenus).toEqual([])
  })
  it('(constat) le lot certain, lui, le refuse pour « sens contraire »', () => {
    const { certains, aArbitrer } = analyserAppariements(
      [piece({ id: 'achat', date_piece: '2025-03-03', statut: 'a_valider' })],
      [ligne({ id: 'credit-patient', date: '2025-03-05', montant: 60, libelle: 'VIR M DUPONT' })], AUCUNE_FACTURE_SOURCE)
    expect(certains).toEqual([])
    expect(aArbitrer.map((a) => a.motif)).toEqual(['sens contraire au type de pièce'])
  })
})

describe('Relecture — le lot des règles et le justificatif peut-être au dossier', () => {
  // Facture mensuelle datée du 30/04, prélevée le 07/05 : le cas que `JOURS_TOLERANCE` (7 jours) a été choisi pour
  // couvrir. `justificatifPossible` ne cherche le même montant qu'à `JOURS_TOLERANCE_RAPPROCHEMENT` (5 jours) ; sur une
  // pièce dont le tiers lu ne se retrouve pas dans le libellé, la règle AFFECTE le mouvement — et la pièce, restée sans
  // paiement, compte à côté de lui.
  const p = piece({ id: 'facture-avril', date_piece: '2025-04-30', tiers: 'SFR Business', montant_ttc: 45, montant_ht: 45 })
  const l = ligne({ id: 'prlv-mai', date: '2025-05-07', montant: -45, libelle: 'PRLV SEPA TELECOM PRO 0425' })
  const justificatifs = {
    pieces: [p], piecesRapprochees: new Set<string>(), restesARegler: new Map<string, number>(), cotisations: [],
    cotisationsRapprochees: new Set<string>(), ventes: AUCUN_CANDIDAT, facturesSources: AUCUNE_FACTURE_SOURCE,
  }
  it('(constat) le lot « Valider et rapprocher » voit la paire (à arbitrer)', () => {
    const { aArbitrer } = analyserAppariements([p], [l], AUCUNE_FACTURE_SOURCE)
    expect(aArbitrer.map((a) => a.ligne.id)).toEqual(['prlv-mai'])
  })
  it.fails('n’affecte pas en lot un mouvement dont la pièce du même montant est à sept jours', () => {
    expect(justificatifPossible(l, justificatifs)).not.toBeNull()
    const plan = planAffectationParRegles([l], [regle()], [HONORAIRES], false, (x) => justificatifPossible(x, justificatifs), AUCUN_HORS_DES_LOTS)
    expect(plan.propositions).toEqual([])
  })
})

describe('Relecture — « Toujours ignorer »', () => {
  // La règle est une SOUS-CHAÎNE, sans sens ni contrôle du motif (les règles d'affectation ont `refusMotif` et leur
  // sens) : née sur un prélèvement « PRLV CPAM PARTICIPATION », le motif « cpam » fait ignorer à l'import chaque
  // virement de recette de la CPAM ; le motif « prlv » chaque prélèvement.
  it.fails('une règle née d’un débit n’ignore pas un encaissement', () => {
    expect(statutPourLibelle('VIR CPAM DES YVELINES 0325', [{ motif: 'cpam' }])).toBe('non_rapprochee')
  })
  it.fails('un motif fait d’un mot commun aux relevés se refuse', () => {
    expect(statutPourLibelle('PRLV SEPA URSSAF', [{ motif: 'prlv' }])).toBe('non_rapprochee')
  })
})
