import { describe, expect, it } from 'vitest'
import {
  codeLettrage, comptesDeTiers, COMPTES_LETTRABLES, estDivers, etatsDesLettragesManuels, lettrages, lettragesProposes,
  MOTIFS_LETTRAGE_MANUEL, piecesLettreesALaMain, refusLettrageManuel, sensNormal, type SoldeDeTiers,
} from './lettrage'
import { calculerBalance, type CibleComptable, type LigneAGenerer } from './ecritures'
import { auxiliaireDuTiers, lignesEngagementPourPiece } from './engagement'
import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_TVA_DEDUCTIBLE,
} from './comptes'
import type { ANouveau, CompteNotesDeFrais, EcritureBrouillon, LettrageManuel, Piece } from './types'
import { ajouterJours } from './format'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'
import { fichiersDuSchema } from '../test/schema'

// Une écriture du brouillon et une pièce, TYPÉES SANS `as` : le compilateur vérifie chaque colonne contre la table, et une colonne
// ajoutée demain fait échouer ce fichier tant qu'elle n'y est pas.
const ecriture = (o: Partial<EcritureBrouillon> & Pick<EcritureBrouillon, 'id'>): EcritureBrouillon => ({
  dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10', compte: '606100', libelle: 'Fournisseur',
  montant: 100, sens: 'debit', statut: 'proposee', created_at: '2026-03-10T09:00:00Z', immobilisation_id: null,
  vehicule_id: null, declaration_tva_id: null, ...NON_VALIDEE, ...o,
})

const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => ({
  dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `${o.id}.pdf`, nom_fichier: `${o.id}.pdf`,
  storage_hash: null, date_piece: '2026-03-10', tiers: 'Transmedical', montant_ht: null, montant_tva: null, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c1', sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
  identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
  created_at: '2026-03-10T09:00:00Z', updated_at: '2026-03-10T09:00:00Z', ...o,
})

const ACHATS: CibleComptable = { compte: '606100', immobilisation: false }
const VENTES: CibleComptable = { compte: '706000', immobilisation: false }

// Ce que la génération écrit vraiment pour une pièce en engagement (lib/engagement.ts), sa facture et un règlement par
// paiement, avec un identifiant et une date de création par ligne — la date de création dit quand l'application a
// écrit la ligne, et c'est elle que la date de lettrage regarde.
function engagement(
  p: Piece, cible: CibleComptable, paiements: { id: string; date: string; montant: number; creeLe?: string }[],
  compteNotesDeFrais: CompteNotesDeFrais = '455000',
): EcritureBrouillon[] {
  const creation = new Map(paiements.map((m) => [m.id, m.creeLe ?? `${m.date}T10:00:00Z`]))
  return lignesEngagementPourPiece('d1', p, cible, false, compteNotesDeFrais, paiements)
    .map((l: LigneAGenerer, i) => ecriture({
      ...l, id: `${p.id}-${i}`,
      created_at: l.ligne_bancaire_id ? creation.get(l.ligne_bancaire_id)! : `${l.date}T09:00:00Z`,
    }))
}

describe('codeLettrage — des lettres, comme les colonnes d’un tableur', () => {
  it('va de A à Z, puis de AA à ZZ, puis AAA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702, 18277].map(codeLettrage))
      .toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA', 'ZZZ'])
  })
})

describe('lettrages — la facture et les règlements qui la soldent', () => {
  const achat = piece({ id: 'achat', montant_ttc: 120 })

  it('lettre la facture et son règlement sur le compte de tiers, et rien d’autre', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }])
    const l = lettrages(brouillon, [], [], 'engagement')
    const lettrees = brouillon.filter((e) => l.has(e.id))
    expect(lettrees.map((e) => [e.compte, e.sens])).toEqual([[COMPTE_FOURNISSEURS, 'credit'], [COMPTE_FOURNISSEURS, 'debit']])
    expect(new Set(lettrees.map((e) => l.get(e.id)!.code))).toEqual(new Set(['A']))
    expect(brouillon.filter((e) => e.compte === '606100' || e.compte === COMPTE_BANQUE).some((e) => l.has(e.id))).toBe(false)
  })

  it('ne lettre rien en trésorerie, où il n’y a pas de compte de tiers', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }])
    expect(lettrages(brouillon, [], [], 'tresorerie').size).toBe(0)
  })

  it('ne lettre pas une facture payée en partie, ni une facture payée en trop', () => {
    expect(lettrages(engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -100 }]), [], [], 'engagement').size).toBe(0)
    expect(lettrages(engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -130 }]), [], [], 'engagement').size).toBe(0)
  })

  it('lettre une facture que deux paiements soldent, les trois lignes ensemble', () => {
    const brouillon = engagement(achat, ACHATS, [
      { id: 'm1', date: '2026-04-05', montant: -20 }, { id: 'm2', date: '2026-05-06', montant: -100 },
    ])
    const l = lettrages(brouillon, [], [], 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => e.montant)).toEqual([120, 20, 100])
    expect(new Set([...l.values()].map((x) => x.code))).toEqual(new Set(['A']))
    expect([...l.values()][0].date).toBe('2026-05-06')
  })

  // Les centimes : 0,10 + 0,20 ne fait pas 0,30 en virgule flottante, et un lettrage qui en dépendrait laisserait
  // ouverte une facture soldée.
  it('compte en centimes, pas en virgule flottante', () => {
    const p = piece({ id: 'centimes', montant_ttc: 0.3 })
    const brouillon = engagement(p, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -0.1 }, { id: 'm2', date: '2026-04-06', montant: -0.2 }])
    expect(lettrages(brouillon, [], [], 'engagement').size).toBe(3)
  })

  it('lettre un avoir que le fournisseur rembourse', () => {
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const brouillon = engagement(avoir, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: 50 }])
    const l = lettrages(brouillon, [], [], 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => [e.compte, e.sens])).toEqual([
      [COMPTE_FOURNISSEURS, 'debit'], [COMPTE_FOURNISSEURS, 'credit'],
    ])
  })

  it('lettre la vente et son encaissement au 411', () => {
    const vente = piece({ id: 'vente', type_piece: 'vente', montant_ttc: 80, tiers: 'Clinique' })
    const brouillon = engagement(vente, VENTES, [{ id: 'm1', date: '2026-04-05', montant: 80 }])
    const l = lettrages(brouillon, [], [], 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_CLIENTS, COMPTE_CLIENTS])
  })

  it('lettre la facture d’un bien au 404, et la note de frais au compte du dirigeant quand c’est un compte de tiers', () => {
    const bien = engagement(piece({ id: 'bien' }), { compte: '218300', immobilisation: true }, [{ id: 'm1', date: '2026-04-05', montant: -120 }])
    const l = lettrages(bien, [], [], 'engagement')
    expect(bien.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_FOURNISSEURS_IMMOBILISATIONS])
    for (const compte of [COMPTE_COURANT_ASSOCIE, COMPTE_AUTRES_DEBITEURS_CREDITEURS] as const) {
      const note = engagement(piece({ id: 'note', type_piece: 'note_frais' }), ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }], compte)
      const ln = lettrages(note, [], [], 'engagement')
      expect(note.filter((e) => ln.has(e.id)).map((e) => e.compte)).toEqual([compte, compte])
    }
  })

  // Le 108 est le compte de l'exploitant, un compte de capitaux : on ne le lettre pas, même soldé.
  it('ne lettre jamais le 108 de l’exploitant', () => {
    const note = engagement(piece({ id: 'note', type_piece: 'note_frais' }), ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }], '108000')
    expect(note.some((e) => e.compte === COMPTE_EXPLOITANT)).toBe(true)
    expect(lettrages(note, [], [], 'engagement').size).toBe(0)
    expect(COMPTES_LETTRABLES.has(COMPTE_EXPLOITANT)).toBe(false)
  })

  // Les comptes de TVA commencent par 4, comme les comptes de tiers : un filtre sur la classe les lettrerait.
  it('ne lettre pas un compte de TVA, même soldé', () => {
    const brouillon = [
      ecriture({ id: 't1', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
      ecriture({ id: 't2', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
    ]
    expect(lettrages(brouillon, [], [], 'engagement').size).toBe(0)
  })

  it('ne lettre pas les lignes sans pièce, un virement du dirigeant au 455', () => {
    const brouillon = [
      ecriture({ id: 'v1', piece_id: null, ligne_bancaire_id: 'm1', compte: COMPTE_COURANT_ASSOCIE, sens: 'debit', montant: 50 }),
      ecriture({ id: 'v2', piece_id: null, ligne_bancaire_id: 'm2', compte: COMPTE_COURANT_ASSOCIE, sens: 'credit', montant: 50 }),
    ]
    expect(lettrages(brouillon, [], [], 'engagement').size).toBe(0)
  })

  it('lettre chaque pièce d’un virement groupé avec sa part, sous des codes distincts', () => {
    const f1 = piece({ id: 'f1', montant_ttc: 100, date_piece: '2026-03-01' })
    const f2 = piece({ id: 'f2', montant_ttc: 60, date_piece: '2026-03-02' })
    const avoir = piece({ id: 'f3', montant_ttc: -10, date_piece: '2026-03-03' })
    const brouillon = [
      ...engagement(f1, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -100 }]),
      ...engagement(f2, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -60 }]),
      ...engagement(avoir, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: 10 }]),
    ]
    const l = lettrages(brouillon, [], [], 'engagement')
    const codeDe = (pieceId: string) => new Set(brouillon.filter((e) => e.piece_id === pieceId && l.has(e.id)).map((e) => l.get(e.id)!.code))
    expect([codeDe('f1'), codeDe('f2'), codeDe('f3')]).toEqual([new Set(['A']), new Set(['B']), new Set(['C'])])
  })

  it('numérote par compte général : le 411 a sa propre suite', () => {
    const brouillon = [
      ...engagement(piece({ id: 'a1', date_piece: '2026-01-10' }), ACHATS, [{ id: 'm1', date: '2026-02-01', montant: -120 }]),
      ...engagement(piece({ id: 'a2', date_piece: '2026-01-11' }), ACHATS, [{ id: 'm2', date: '2026-02-02', montant: -120 }]),
      ...engagement(piece({ id: 'v1', type_piece: 'vente', montant_ttc: 80 }), VENTES, [{ id: 'm3', date: '2026-03-20', montant: 80 }]),
    ]
    const l = lettrages(brouillon, [], [], 'engagement')
    const codes = (compte: string) => new Set(brouillon.filter((e) => e.compte === compte && l.has(e.id)).map((e) => l.get(e.id)!.code))
    expect(codes(COMPTE_FOURNISSEURS)).toEqual(new Set(['A', 'B']))
    expect(codes(COMPTE_CLIENTS)).toEqual(new Set(['A']))
  })

  // Les codes se donnent dans l'ordre où les lettrages sont nés, comme dans un logiciel qui lettre au fil de l'eau —
  // pas dans l'ordre des factures, ni dans celui où la requête rend les lignes.
  it('donne les codes dans l’ordre des lettrages, quel que soit l’ordre des lignes', () => {
    const ancienne = engagement(piece({ id: 'z-ancienne', date_piece: '2026-01-05' }), ACHATS, [{ id: 'm1', date: '2026-06-30', montant: -120 }])
    const recente = engagement(piece({ id: 'a-recente', date_piece: '2026-05-05' }), ACHATS, [{ id: 'm2', date: '2026-05-20', montant: -120 }])
    for (const brouillon of [[...ancienne, ...recente], [...recente, ...ancienne].reverse()]) {
      const l = lettrages(brouillon, [], [], 'engagement')
      expect(l.get('a-recente-1')!.code).toBe('A')
      expect(l.get('z-ancienne-1')!.code).toBe('B')
    }
  })

  // § 240 : la date à laquelle le lettrage a été validé dans le système comptable. Ici, l'écriture du règlement qui
  // solde la facture : un relevé importé le 20 avril pour un paiement du 5 lettre le 20.
  it('date le lettrage du jour où l’application a écrit le règlement qui solde', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-04-20T08:00:00Z' }])
    expect([...lettrages(brouillon, [], [], 'engagement').values()][0].date).toBe('2026-04-20')
  })

  it('lit ce jour à Paris, pas en UTC', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-04-20T22:30:00Z' }])
    expect([...lettrages(brouillon, [], [], 'engagement').values()][0].date).toBe('2026-04-21')
  })

  it('ne date jamais un lettrage d’avant ce qu’il apparie', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-03-01T08:00:00Z' }])
    expect([...lettrages(brouillon, [], [], 'engagement').values()][0].date).toBe('2026-04-05')
  })

  // La base pose une date de création sur chaque ligne ; une date illisible ne doit pas faire lever un calcul qui tourne
  // au rendu de l'onglet Écritures.
  it('ne lève pas sur une date de création illisible, et retombe sur la date comptable', () => {
    for (const created_at of ['', 'pas une date']) {
      const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }]).map((e) => ({ ...e, created_at }))
      expect([...lettrages(brouillon, [], [], 'engagement').values()][0].date).toBe('2026-04-05')
    }
  })

  // Une écriture du FEC qui porterait deux codes ressortirait parmi les anomalies de l'outil de la DGFiP.
  it('ne lettre rien d’une pièce dont deux comptes lettrables se soldent', () => {
    const brouillon = [
      ecriture({ id: 'x1', compte: COMPTE_FOURNISSEURS, sens: 'credit', montant: 10 }),
      ecriture({ id: 'x2', compte: COMPTE_FOURNISSEURS, sens: 'debit', montant: 10, ligne_bancaire_id: 'm1' }),
      ecriture({ id: 'x3', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'debit', montant: 5 }),
      ecriture({ id: 'x4', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'credit', montant: 5, ligne_bancaire_id: 'm2' }),
    ]
    expect(lettrages(brouillon, [], [], 'engagement').size).toBe(0)
    expect(lettrages(brouillon.slice(0, 2), [], [], 'engagement').size).toBe(2)
  })
})

describe('comptesDeTiers — ce qui reste ouvert, tiers par tiers, à une date', () => {
  const pieces = [
    piece({ id: 'f-jan', tiers: 'Transmedical', date_piece: '2026-01-15', montant_ttc: 120 }),
    piece({ id: 'f-fev', tiers: 'TRANSMEDICAL / et redevient', date_piece: '2026-02-10', montant_ttc: 60 }),
    piece({ id: 'f-mar', tiers: 'Bureau Vallée', date_piece: '2026-03-01', montant_ttc: 200 }),
    piece({ id: 'v-mar', tiers: 'Clinique du Parc', type_piece: 'vente', date_piece: '2026-03-05', montant_ttc: 500 }),
    piece({ id: 'note', tiers: 'Repas client', type_piece: 'note_frais', date_piece: '2026-03-08', montant_ttc: 40 }),
  ]
  const [fJan, fFev, fMar, vMar, note] = pieces
  const brouillon = [
    // Réglée le 5 avril : ouverte au 31 mars, soldée au 30 avril.
    ...engagement(fJan, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }]),
    // Jamais réglée.
    ...engagement(fFev, ACHATS, []),
    // Payée en partie le 20 mars.
    ...engagement(fMar, ACHATS, [{ id: 'm2', date: '2026-03-20', montant: -150 }]),
    // Encaissée en trop le 25 mars.
    ...engagement(vMar, VENTES, [{ id: 'm3', date: '2026-03-25', montant: 520 }]),
    // Note de frais due au dirigeant, au 455.
    ...engagement(note, ACHATS, []),
    // Un virement du dirigeant, sans pièce, au 455.
    ecriture({ id: 'vp', piece_id: null, ligne_bancaire_id: 'm4', date: '2026-03-28', compte: COMPTE_COURANT_ASSOCIE, sens: 'credit', montant: 300 }),
    ecriture({ id: 'vp-b', piece_id: null, ligne_bancaire_id: 'm4', date: '2026-03-28', compte: COMPTE_BANQUE, sens: 'debit', montant: 300 }),
  ]
  const ouverture: ANouveau[] = [{
    id: 'an1', dossier_id: 'd1', date: '2026-01-01', compte: COMPTE_FOURNISSEURS, compte_origine: '401', libelle: 'Fournisseurs',
    sens: 'credit', montant: 75, source_nom: 'balance.csv', source_empreinte: 'x', created_at: '2026-01-02T09:00:00Z',
    ...A_NOUVEAU_NON_VALIDE,
  }]
  const au = (date: string, a: readonly ANouveau[] = ouverture) => comptesDeTiers(brouillon, pieces, a, [], 'engagement', date)
  const ligneDe = (soldes: SoldeDeTiers[], libelle: string) => soldes.find((s) => s.libelle === libelle)

  it('ne rend rien en trésorerie', () => {
    expect(comptesDeTiers(brouillon, pieces, ouverture, [], 'tresorerie', '2026-03-31')).toEqual([])
  })

  it('range les pièces d’un même fournisseur sous son compte auxiliaire, sous le premier nom lu', () => {
    const transmedical = ligneDe(au('2026-03-31'), 'Transmedical')!
    expect(transmedical.auxiliaire).toBe('FTRANSMEDICAL')
    expect(transmedical.pieces.map((p) => p.pieceId)).toEqual(['f-jan', 'f-fev'])
    expect(transmedical.solde).toBe(180)
  })

  it('lit une pièce avec ses seules lignes datées jusqu’à l’arrêté', () => {
    expect(ligneDe(au('2026-03-31'), 'Transmedical')!.pieces.find((p) => p.pieceId === 'f-jan')).toMatchObject({
      etat: 'ouverte', facture: 120, regle: 0, reste: 120, dateFacture: '2026-01-15', age: 75,
    })
    expect(ligneDe(au('2026-04-30'), 'Transmedical')!.pieces.map((p) => p.pieceId)).toEqual(['f-fev'])
    // Avant sa facture, une pièce n'est pas encore là.
    expect(ligneDe(au('2026-01-31'), 'Transmedical')!.pieces.map((p) => p.pieceId)).toEqual(['f-jan'])
  })

  it('dit une facture payée en partie, et son reste', () => {
    expect(ligneDe(au('2026-03-31'), 'Bureau Vallée')!.pieces[0]).toMatchObject({ etat: 'payee_en_partie', facture: 200, regle: 150, reste: 50 })
  })

  it('dit une vente encaissée en trop, au signe de ce que le client attend en retour', () => {
    const clinique = ligneDe(au('2026-03-31'), 'Clinique du Parc')!
    expect(clinique.compte).toBe(COMPTE_CLIENTS)
    expect(clinique.pieces[0]).toMatchObject({ etat: 'payee_en_trop', facture: 500, regle: 520, reste: -20 })
    expect(clinique.solde).toBe(-20)
  })

  it('dit un règlement dont la facture est datée après l’arrêté', () => {
    const acompte = piece({ id: 'acompte', tiers: 'Menuiserie', date_piece: '2026-04-10', montant_ttc: 300 })
    const soldes = comptesDeTiers(
      engagement(acompte, ACHATS, [{ id: 'm9', date: '2026-03-15', montant: -100 }]), [acompte], [], [], 'engagement', '2026-03-31',
    )
    expect(soldes[0].pieces[0]).toMatchObject({ etat: 'reglement_sans_facture', dateFacture: null, facture: 0, reste: -100, age: 16 })
  })

  it('met à part, et dans le total, les écritures sans pièce et les à-nouveaux', () => {
    const soldes = au('2026-03-31')
    expect(soldes.filter((s) => s.origine !== 'tiers').map((s) => [s.compte, s.origine, s.solde])).toEqual([
      [COMPTE_FOURNISSEURS, 'ouverture', 75],
      [COMPTE_COURANT_ASSOCIE, 'sans_piece', 300],
    ])
    // Un à-nouveau daté après l'arrêté n'y est pas.
    expect(au('2025-12-31').some((s) => s.origine === 'ouverture')).toBe(false)
  })

  it('range une note de frais au compte du dirigeant, sans compte auxiliaire', () => {
    const dirigeant = au('2026-03-31').find((s) => s.compte === COMPTE_COURANT_ASSOCIE && s.origine === 'tiers')!
    expect(dirigeant).toMatchObject({ auxiliaire: null, libelle: 'Associés — comptes courants', solde: 40 })
  })

  // LE TOTAL D'UN COMPTE EST SON SOLDE DANS LA BALANCE GÉNÉRALE : sans quoi la vue des tiers dirait une dette que la
  // balance ne porte pas, ou l'inverse, et personne ne saurait laquelle croire.
  it('recoupe, compte par compte, le solde de la balance générale à la même date', () => {
    for (const date of ['2026-01-31', '2026-03-20', '2026-03-31', '2026-04-30']) {
      const soldes = au(date)
      const balance = calculerBalance(brouillon.filter((e) => e.date <= date), [], ouverture.filter((a) => a.date <= date))
      for (const compte of COMPTES_LETTRABLES) {
        const general = balance.find((b) => b.compte === compte)?.solde ?? 0
        const attendu = sensNormal(compte) === 'debit' ? general : -general
        const vue = soldes.filter((s) => s.compte === compte).reduce((t, s) => t + s.solde, 0)
        // `+ 0` : un solde nul calculé en négatif rend -0, que `toBe` distingue de 0.
        expect(Math.round(vue * 100) + 0, `${compte} au ${date}`).toBe(Math.round(attendu * 100) + 0)
      }
    }
  })

  it('montre un tiers au solde nul qui porte deux pièces ouvertes', () => {
    const p1 = piece({ id: 'p1', tiers: 'Garage', montant_ttc: 100, date_piece: '2026-03-01' })
    const p2 = piece({ id: 'p2', tiers: 'Garage', montant_ttc: 30, date_piece: '2026-03-02' })
    const soldes = comptesDeTiers([
      ...engagement(p1, ACHATS, [{ id: 'm1', date: '2026-03-10', montant: -130 }]),
      ...engagement(p2, ACHATS, []),
    ], [p1, p2], [], [], 'engagement', '2026-03-31')
    expect(soldes).toHaveLength(1)
    expect(soldes[0].solde).toBe(0)
    expect(soldes[0].pieces.map((p) => p.etat)).toEqual(['payee_en_trop', 'ouverte'])
  })

  it('tait un tiers dont tout est soldé', () => {
    expect(ligneDe(au('2026-04-30'), 'Transmedical')!.pieces).toHaveLength(1)
    const solde = piece({ id: 'solde', tiers: 'Imprimerie', montant_ttc: 10 })
    expect(comptesDeTiers(engagement(solde, ACHATS, [{ id: 'm1', date: '2026-03-05', montant: -10 }]), [solde], [], [], 'engagement', '2026-03-31')).toEqual([])
  })

  it('range les restes par ancienneté — 30 jours au plus, 31 à 60, 61 à 90, plus de 90 — et leur somme fait le solde', () => {
    const ages = [30, 31, 60, 61, 90, 91]
    const ps = ages.map((_, i) => piece({ id: `a${i}`, tiers: 'Atelier', montant_ttc: 10 ** i }))
    const arrete = '2026-06-30'
    const datees = ps.map((p, i) => ({ ...p, date_piece: ajouterJours(arrete, -ages[i]) }))
    const soldes = comptesDeTiers(datees.flatMap((p) => engagement(p, ACHATS, [])), datees, [], [], 'engagement', arrete)
    expect(soldes[0].pieces.map((p) => p.age)).toEqual([91, 90, 61, 60, 31, 30])
    expect(soldes[0].tranches).toEqual([1, 10 + 100, 1000 + 10000, 100000])
    expect(soldes[0].tranches.reduce((t, x) => t + x, 0)).toBe(soldes[0].solde)
  })

  it('range les comptes : fournisseurs, d’immobilisations, clients, puis le dirigeant', () => {
    const bien = piece({ id: 'bien', tiers: 'Apple', montant_ttc: 900 })
    const soldes = comptesDeTiers(
      [...brouillon, ...engagement(bien, { compte: '218300', immobilisation: true }, [])], [...pieces, bien], ouverture, [], 'engagement', '2026-03-31',
    )
    expect(soldes.map((s) => [s.compte, s.origine])).toEqual([
      [COMPTE_FOURNISSEURS, 'tiers'], [COMPTE_FOURNISSEURS, 'tiers'], [COMPTE_FOURNISSEURS, 'ouverture'],
      [COMPTE_FOURNISSEURS_IMMOBILISATIONS, 'tiers'],
      [COMPTE_CLIENTS, 'tiers'],
      [COMPTE_COURANT_ASSOCIE, 'tiers'], [COMPTE_COURANT_ASSOCIE, 'sans_piece'],
    ])
    expect(soldes.filter((s) => s.compte === COMPTE_FOURNISSEURS && s.origine === 'tiers').map((s) => s.libelle)).toEqual(['Bureau Vallée', 'Transmedical'])
  })
})

// ── LE LETTRAGE FAIT À LA MAIN (seconde brique) ────────────────────────────────────────────────────────────────

// Une ligne de `lettrages_manuels`, TYPÉE SANS `as`.
const manuel = (groupe: string, piece_id: string | null, o: Partial<LettrageManuel> = {}): LettrageManuel => ({
  id: `${groupe}-${piece_id ?? 'supprimee'}`, dossier_id: 'd1', groupe, piece_id, compte: COMPTE_FOURNISSEURS,
  created_at: '2026-05-02T08:00:00Z', ...o,
})

describe('lettrages — une facture et l’avoir qui la solde, lettrés à la main', () => {
  const facture = piece({ id: 'f', tiers: 'Transmedical', montant_ttc: 500, date_piece: '2026-03-10' })
  const avoir = piece({ id: 'a', tiers: 'TRANSMEDICAL / et redevient', montant_ttc: -500, date_piece: '2026-03-20' })
  const brouillon = [...engagement(facture, ACHATS, []), ...engagement(avoir, ACHATS, [])]
  const groupe = [manuel('g1', 'f'), manuel('g1', 'a')]
  const tiersDe = (l: ReadonlyMap<string, { code: string; date: string }>) =>
    brouillon.filter((e) => l.has(e.id)).map((e) => [e.piece_id, e.compte, l.get(e.id)!.code, l.get(e.id)!.date])

  it('porte le même code sur les deux lignes de tiers, et nulle part ailleurs', () => {
    expect(tiersDe(lettrages(brouillon, [facture, avoir], groupe, 'engagement'))).toEqual([
      ['f', COMPTE_FOURNISSEURS, 'A', '2026-05-02'],
      ['a', COMPTE_FOURNISSEURS, 'A', '2026-05-02'],
    ])
  })

  it('sans lui, rien n’est lettré : c’est le geste du cabinet qui apparie', () => {
    expect(lettrages(brouillon, [facture, avoir], [], 'engagement').size).toBe(0)
  })

  it('ne lettre rien en trésorerie', () => {
    expect(lettrages(brouillon, [facture, avoir], groupe, 'tresorerie').size).toBe(0)
    expect(etatsDesLettragesManuels(brouillon, [facture, avoir], groupe, 'tresorerie')).toEqual([])
  })

  // § 240 : la date à laquelle l'opération de lettrage a été validée — le jour du clic, à Paris.
  it('date le lettrage du jour où le cabinet a lettré, à Paris', () => {
    const tard = groupe.map((l) => ({ ...l, created_at: '2026-05-02T22:30:00Z' }))
    expect(tiersDe(lettrages(brouillon, [facture, avoir], tard, 'engagement'))[0][3]).toBe('2026-05-03')
  })

  it('ne le date jamais d’avant ce qu’il apparie, ni d’avant l’écriture de ses lignes', () => {
    const avant = groupe.map((l) => ({ ...l, created_at: '2026-01-02T08:00:00Z' }))
    expect(tiersDe(lettrages(brouillon, [facture, avoir], avant, 'engagement'))[0][3]).toBe('2026-03-20')
    const reecrit = brouillon.map((e) => (e.piece_id === 'a' ? { ...e, created_at: '2026-06-10T08:00:00Z' } : e))
    const l = lettrages(reecrit, [facture, avoir], avant, 'engagement')
    expect(reecrit.filter((e) => l.has(e.id)).map((e) => l.get(e.id)!.date)).toEqual(['2026-06-10', '2026-06-10'])
  })

  it('retombe sur ses lignes quand le jour du clic est illisible', () => {
    const illisible = groupe.map((l) => ({ ...l, created_at: 'pas une date' }))
    expect(tiersDe(lettrages(brouillon, [facture, avoir], illisible, 'engagement'))[0][3]).toBe('2026-03-20')
  })

  it('prend sa place dans la suite des codes du compte, à sa date', () => {
    const autre = piece({ id: 'b', tiers: 'Bureau Vallée', montant_ttc: 80, date_piece: '2026-03-01' })
    const tout = [...brouillon, ...engagement(autre, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -80, creeLe: '2026-04-20T08:00:00Z' }])]
    const codes = (lm: LettrageManuel[]) => {
      const l = lettrages(tout, [facture, avoir, autre], lm, 'engagement')
      return Object.fromEntries(tout.filter((e) => l.has(e.id)).map((e) => [e.piece_id, l.get(e.id)!.code]))
    }
    // Le règlement de Bureau Vallée est né le 20 avril, le lettrage à la main le 2 mai.
    expect(codes(groupe)).toEqual({ b: 'A', f: 'B', a: 'B' })
    // Lettré à la main le 10 avril, il passe devant.
    expect(codes(groupe.map((l) => ({ ...l, created_at: '2026-04-10T08:00:00Z' })))).toEqual({ f: 'A', a: 'A', b: 'B' })
  })

  it('lettre au compte du dirigeant, qui n’a pas de compte auxiliaire', () => {
    const note = piece({ id: 'n1', type_piece: 'note_frais', tiers: 'Restaurant', montant_ttc: 40 })
    const rendue = piece({ id: 'n2', type_piece: 'note_frais', tiers: 'Péage', montant_ttc: -40 })
    const notes = [...engagement(note, ACHATS, []), ...engagement(rendue, ACHATS, [])]
    const lm = [manuel('g2', 'n1', { compte: COMPTE_COURANT_ASSOCIE }), manuel('g2', 'n2', { compte: COMPTE_COURANT_ASSOCIE })]
    const l = lettrages(notes, [note, rendue], lm, 'engagement')
    expect(notes.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_COURANT_ASSOCIE, COMPTE_COURANT_ASSOCIE])
  })

  it('n’écrit qu’un code par écriture : chaque pièce n’a qu’une ligne lettrée', () => {
    const l = lettrages(brouillon, [facture, avoir], groupe, 'engagement')
    for (const p of ['f', 'a']) expect(brouillon.filter((e) => e.piece_id === p && l.has(e.id))).toHaveLength(1)
  })
})

describe('etatsDesLettragesManuels — revérifié à chaque lecture, appliqué seulement s’il tient', () => {
  const facture = piece({ id: 'f', tiers: 'Transmedical', montant_ttc: 500, date_piece: '2026-03-10' })
  const avoir = piece({ id: 'a', tiers: 'Transmedical', montant_ttc: -500, date_piece: '2026-03-20' })
  const brouillon = [...engagement(facture, ACHATS, []), ...engagement(avoir, ACHATS, [])]
  const groupe = [manuel('g1', 'f'), manuel('g1', 'a')]
  const etat = (
    b: readonly EcritureBrouillon[] = brouillon, p: readonly Piece[] = [facture, avoir], lm: readonly LettrageManuel[] = groupe,
  ) => etatsDesLettragesManuels(b, p, lm, 'engagement')
  // Un lettrage qui ne tient plus n'est ni appliqué au FEC, ni compté comme fermant ses pièces.
  const sansEffet = (b: readonly EcritureBrouillon[], p: readonly Piece[], lm: readonly LettrageManuel[]) => {
    const l = lettrages(b, p, lm, 'engagement')
    return b.filter((e) => l.has(e.id) && ['f', 'a'].includes(e.piece_id!)).length === 0
  }

  it('dit d’un lettrage qui tient son tiers, ses pièces et son jour, et qu’il ne reste rien', () => {
    expect(etat()).toEqual([{
      groupe: 'g1', compte: COMPTE_FOURNISSEURS, auxiliaire: 'FTRANSMEDICAL', libelle: 'Transmedical', pieceIds: ['a', 'f'],
      le: '2026-05-02', reste: 0, motif: null,
    }])
  })

  it('une pièce supprimée depuis', () => {
    const lm = [manuel('g1', 'f'), manuel('g1', null)]
    expect(etat(brouillon, [facture, avoir], lm)[0]).toMatchObject({ motif: 'piece_supprimee', pieceIds: ['f'], reste: 500 })
    expect(sansEffet(brouillon, [facture, avoir], lm)).toBe(true)
  })

  it('un lettrage qui n’apparie plus qu’une pièce', () => {
    expect(etat(brouillon, [facture, avoir], [manuel('g1', 'f')])[0].motif).toBe('une_seule_piece')
    expect(sansEffet(brouillon, [facture, avoir], [manuel('g1', 'f')])).toBe(true)
  })

  it('des pièces lettrées sur deux comptes', () => {
    const lm = [manuel('g1', 'f'), manuel('g1', 'a', { compte: COMPTE_CLIENTS })]
    expect(etat(brouillon, [facture, avoir], lm)[0].motif).toBe('comptes_differents')
    expect(sansEffet(brouillon, [facture, avoir], lm)).toBe(true)
  })

  it('une pièce absente de la lecture : son tiers n’est pas connu', () => {
    expect(etat(brouillon, [facture])[0].motif).toBe('piece_non_lue')
    expect(sansEffet(brouillon, [facture], groupe)).toBe(true)
  })

  it('une pièce sans tiers identifié, au compte « divers »', () => {
    const p = [piece({ ...facture, tiers: null }), piece({ ...avoir, tiers: 'CARTE BANCAIRE' })]
    expect(etat(brouillon, p)[0]).toMatchObject({ motif: 'tiers_non_identifie', auxiliaire: 'FDIVERS' })
    expect(sansEffet(brouillon, p, groupe)).toBe(true)
  })

  it('des pièces qui ne sont plus du même tiers', () => {
    const p = [facture, piece({ ...avoir, tiers: 'Bureau Vallée' })]
    expect(etat(brouillon, p)[0].motif).toBe('tiers_differents')
    expect(sansEffet(brouillon, p, groupe)).toBe(true)
  })

  it('une pièce qui n’a plus d’écriture sur le compte', () => {
    const b = brouillon.filter((e) => e.piece_id !== 'a')
    expect(etat(b)[0].motif).toBe('sans_ecriture')
  })

  // Un rapprochement posé depuis : la facture se solde seule, et c'est le lettrage déduit qui la prend.
  it('une pièce désormais soldée par ses règlements, qui se lettre alors seule', () => {
    const b = [...engagement(facture, ACHATS, [{ id: 'm1', date: '2026-06-05', montant: -500 }]), ...engagement(avoir, ACHATS, [])]
    expect(etat(b)[0].motif).toBe('piece_soldee_seule')
    const l = lettrages(b, [facture, avoir], groupe, 'engagement')
    expect(b.filter((e) => l.has(e.id)).map((e) => e.piece_id)).toEqual(['f', 'f'])
  })

  it('une pièce qui se solde sur un autre compte de tiers', () => {
    const b = [
      ...brouillon,
      ecriture({ id: 'x1', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'credit', montant: 5 }),
      ecriture({ id: 'x2', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'debit', montant: 5, ligne_bancaire_id: 'm9' }),
    ]
    expect(etat(b)[0].motif).toBe('piece_lettree_ailleurs')
    // La facture garde le lettrage déduit de l'autre compte, et lui seul : le 401 ne porte rien.
    const l = lettrages(b, [facture, avoir], groupe, 'engagement')
    expect(b.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_AUTRES_DEBITEURS_CREDITEURS])
  })

  it('des pièces qui ne se soldent plus, et ce qui reste, dans le sens normal du compte', () => {
    const b = [...engagement(facture, ACHATS, []), ...engagement(piece({ ...avoir, montant_ttc: -400 }), ACHATS, [])]
    expect(etat(b)[0]).toMatchObject({ motif: 'ne_se_solde_plus', reste: 100 })
    expect(sansEffet(b, [facture, avoir], groupe)).toBe(true)
  })

  it('dit chaque motif en une phrase', () => {
    for (const phrase of Object.values(MOTIFS_LETTRAGE_MANUEL)) expect(phrase).toMatch(/^[A-ZÉ].+\.$/)
  })

  // CAS DÉFENSIF, annoncé comme tel : `lettrer_pieces` écrit les lignes d'un lettrage d'un seul insert, donc du même
  // jour. Si elles différaient — une ligne restaurée à la main —, le jour du lettrage serait le plus récent : c'est
  // celui où le lettrage s'est établi.
  it('dit pour jour du lettrage le plus récent de ses lignes — cas défensif', () => {
    const etale = [manuel('g1', 'f', { created_at: '2026-05-02T08:00:00Z' }), manuel('g1', 'a', { created_at: '2026-05-09T08:00:00Z' })]
    expect(etat(brouillon, [facture, avoir], etale)[0].le).toBe('2026-05-09')
  })

  // Ce que les écrans retirent des factures sans règlement et des montants introuvables en banque : les pièces des
  // seuls lettrages qui TIENNENT — celles d'un lettrage qui ne se solde plus attendent encore leur paiement.
  it('ne rend comme soldées que les pièces des lettrages qui tiennent', () => {
    const f2 = piece({ id: 'f2', tiers: 'Transmedical', montant_ttc: 120, date_piece: '2026-03-12' })
    const a2 = piece({ id: 'a2', tiers: 'Transmedical', montant_ttc: -100, date_piece: '2026-03-22' })
    const b = [...brouillon, ...engagement(f2, ACHATS, []), ...engagement(a2, ACHATS, [])]
    const etats = etat(b, [facture, avoir, f2, a2], [...groupe, manuel('g2', 'f2'), manuel('g2', 'a2')])
    expect(etats.map((e) => [e.groupe, e.motif])).toEqual([['g1', null], ['g2', 'ne_se_solde_plus']])
    expect(piecesLettreesALaMain(etats)).toEqual(new Set(['a', 'f']))
  })
})

describe('comptesDeTiers — un lettrage fait à la main ferme ses pièces', () => {
  const facture = piece({ id: 'f', tiers: 'Transmedical', montant_ttc: 500, date_piece: '2026-03-10' })
  const avoir = piece({ id: 'a', tiers: 'Transmedical', montant_ttc: -500, date_piece: '2026-04-20' })
  const autre = piece({ id: 'o', tiers: 'Transmedical', montant_ttc: 70, date_piece: '2026-03-15' })
  const pieces = [facture, avoir, autre]
  const brouillon = [...engagement(facture, ACHATS, []), ...engagement(avoir, ACHATS, []), ...engagement(autre, ACHATS, [])]
  const groupe = [manuel('g1', 'f'), manuel('g1', 'a')]
  const au = (date: string, lm: readonly LettrageManuel[] = groupe) => comptesDeTiers(brouillon, pieces, [], lm, 'engagement', date)

  it('ne montre plus la facture ni l’avoir quand ils se soldent ensemble à la date', () => {
    const [transmedical] = au('2026-04-30')
    expect(transmedical.pieces.map((p) => p.pieceId)).toEqual(['o'])
    expect(transmedical.solde).toBe(70)
  })

  it('laisse la facture ouverte à une date d’avant l’avoir', () => {
    const [transmedical] = au('2026-03-31')
    expect(transmedical.pieces.map((p) => [p.pieceId, p.lettrageManuel])).toEqual([['f', 'g1'], ['o', null]])
    expect(transmedical.solde).toBe(570)
  })

  it('ne ferme rien d’un lettrage qui ne tient plus, et chaque pièce dit le lettrage où elle figure', () => {
    const soldes = comptesDeTiers(brouillon, [facture, piece({ ...avoir, tiers: 'Bureau Vallée' }), autre], [], groupe, 'engagement', '2026-04-30')
    expect(soldes.map((s) => [s.libelle, s.pieces.map((p) => [p.pieceId, p.lettrageManuel])])).toEqual([
      ['Bureau Vallée', [['a', 'g1']]],
      ['Transmedical', [['f', 'g1'], ['o', null]]],
    ])
  })

  // Le lettrage tient aujourd'hui : l'avoir solde le reste d'une facture payée en partie. Mais à une date d'avant ce
  // paiement, la facture était encore due de bien plus que l'avoir : ses pièces y restent ouvertes.
  it('ne ferme pas, à une date d’avant le paiement qui le complète, un lettrage qui ne se soldait pas encore', () => {
    const payee = piece({ id: 'p', tiers: 'Garage', montant_ttc: 1000, date_piece: '2026-03-01' })
    const avoirDuReste = piece({ id: 'r', tiers: 'Garage', montant_ttc: -200, date_piece: '2026-03-05' })
    const b = [...engagement(payee, ACHATS, [{ id: 'm9', date: '2026-04-15', montant: -800 }]), ...engagement(avoirDuReste, ACHATS, [])]
    const lm = [manuel('g9', 'p'), manuel('g9', 'r')]
    expect(etatsDesLettragesManuels(b, [payee, avoirDuReste], lm, 'engagement')[0].motif).toBeNull()
    const avant = comptesDeTiers(b, [payee, avoirDuReste], [], lm, 'engagement', '2026-03-31')
    expect(avant.flatMap((s) => s.pieces.map((x) => x.pieceId))).toEqual(['p', 'r'])
    expect(comptesDeTiers(b, [payee, avoirDuReste], [], lm, 'engagement', '2026-04-30')).toEqual([])
  })

  it('recoupe toujours, compte par compte, le solde de la balance générale', () => {
    for (const date of ['2026-03-31', '2026-04-30']) {
      const vue = au(date).reduce((t, s) => t + s.solde, 0)
      const general = calculerBalance(brouillon.filter((e) => e.date <= date), [], []).find((b) => b.compte === COMPTE_FOURNISSEURS)!.solde
      expect(Math.round(vue * 100) + 0, date).toBe(Math.round(-general * 100) + 0)
    }
  })
})

describe('refusLettrageManuel — ce que la base refuserait, dit avant le clic', () => {
  const facture = piece({ id: 'f', tiers: 'Transmedical', montant_ttc: 500 })
  const avoir = piece({ id: 'a', tiers: 'Transmedical', montant_ttc: -500 })
  const reste = piece({ id: 'r', tiers: 'Transmedical', montant_ttc: -300 })
  const pieces = [facture, avoir, reste]
  const brouillon = [...engagement(facture, ACHATS, []), ...engagement(avoir, ACHATS, []), ...engagement(reste, ACHATS, [])]
  const refus = (
    ids: string[], o: { compte?: string; b?: readonly EcritureBrouillon[]; p?: readonly Piece[]; lm?: readonly LettrageManuel[]; mode?: 'engagement' | 'tresorerie' } = {},
  ) => refusLettrageManuel(o.compte ?? COMPTE_FOURNISSEURS, ids, o.b ?? brouillon, o.p ?? pieces, o.lm ?? [], o.mode ?? 'engagement')

  it('ne refuse rien d’une facture et de l’avoir qui la solde', () => {
    expect(refus(['f', 'a'])).toBeNull()
  })

  it('dit ce qui reste quand les pièces ne se soldent pas', () => {
    expect(refus(['f', 'r'])).toBe('Ces pièces ne se soldent pas : il reste 200,00 € sur le compte.')
  })

  it('refuse des pièces de deux tiers, et une pièce sans tiers identifié — ce que la base ne sait pas voir', () => {
    expect(refus(['f', 'a'], { p: [facture, piece({ ...avoir, tiers: 'Bureau Vallée' }), reste] })).toBe('Ces pièces ne sont pas du même tiers.')
    expect(refus(['f', 'a'], { p: [piece({ ...facture, tiers: null }), piece({ ...avoir, tiers: null }), reste] }))
      .toBe('Une des pièces n’a pas de tiers identifié : au compte « divers », rien ne dit qu’elles sont du même tiers.')
  })

  it('refuse une pièce qui n’a pas pu être lue', () => {
    expect(refus(['f', 'a'], { p: [facture] })).toBe('Une des pièces n’a pas pu être lue : son tiers n’est pas connu.')
  })

  // « Divers » se reconnaît au NUMÉRO exact du compte divers : un fournisseur dont le nom finit par « divers » a son
  // propre compte auxiliaire, et ses pièces se lettrent.
  it('ne prend pas pour le compte divers un fournisseur dont le nom finit par « divers »', () => {
    const auxiliaire = auxiliaireDuTiers({ tiers: 'Pradivers' }, COMPTE_FOURNISSEURS)!.num
    expect(auxiliaire).toMatch(/DIVERS$/)
    expect(estDivers(COMPTE_FOURNISSEURS, auxiliaire)).toBe(false)
    expect(refus(['f', 'a'], { p: [piece({ ...facture, tiers: 'Pradivers' }), piece({ ...avoir, tiers: 'Pradivers' }), reste] })).toBeNull()
  })

  it('refuse une pièce qui se solde sur un autre compte de tiers', () => {
    const b = [
      ...brouillon,
      ecriture({ id: 'x1', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'credit', montant: 5 }),
      ecriture({ id: 'x2', piece_id: 'f', compte: COMPTE_AUTRES_DEBITEURS_CREDITEURS, sens: 'debit', montant: 5, ligne_bancaire_id: 'm9' }),
    ]
    expect(refus(['f', 'a'], { b })).toBe('Une des pièces se solde sur un autre compte de tiers, où elle est lettrée.')
  })

  // Chaque refus déclenché par un cas qui ne déclenche que lui et ceux qui le suivent : l'ordre des premiers refus
  // rencontrés doit être l'ordre des `raise` de `lettrer_pieces`.
  it('les refus partagés avec la base sont les siens, dans le même ordre', () => {
    const texte = fichiersDuSchema().map((f) => f.texte).find((t) => t.includes('create function public.lettrer_pieces('))!
    const sql = texte.slice(texte.indexOf('create function public.lettrer_pieces('), texte.indexOf('comment on function public.lettrer_pieces'))
    const sansApostrophes = (x: string) => x.replace(/''/g, "'").replace(/’/g, "'")
    const solde = engagement(piece({ id: 's', tiers: 'Transmedical', montant_ttc: 50 }), ACHATS, [{ id: 'm1', date: '2026-04-01', montant: -50 }])
    const cas: [string | null, string][] = [
      [refus(['f', 'a'], { mode: 'tresorerie' }), 'Le lettrage ne se fait que dans un dossier tenu en engagement.'],
      [refus(['f', 'a'], { compte: '606100' }), 'Ce compte n’est pas un compte de tiers qui se lettre.'],
      [refus(['f']), 'Un lettrage fait à la main apparie au moins deux pièces.'],
      [refus(['f', 'f']), 'Une pièce est choisie deux fois.'],
      [refus(['f', 'a'], { lm: [manuel('g', 'a')] }), 'Une des pièces est déjà lettrée à la main avec d’autres : défais d’abord ce lettrage.'],
      [refus(['f', 'a'], { b: brouillon.filter((e) => e.piece_id !== 'a') }), 'Une des pièces n’a aucune écriture sur ce compte : génère d’abord ses écritures.'],
      [refus(['f', 's'], { b: [...brouillon, ...solde], p: [...pieces, piece({ id: 's', tiers: 'Transmedical' })] }), 'Une des pièces est déjà soldée par ses règlements : elle se lettre seule.'],
      [refus(['f', 'r']), 'Ces pièces ne se soldent pas : il reste % € sur le compte.'],
    ]
    let position = -1
    for (const [obtenu, attendu] of cas) {
      expect(sansApostrophes(obtenu!.replace(/[\d   ]+,\d{2} €/, ' % €'))).toBe(sansApostrophes(attendu))
      const ici = sansApostrophes(sql).indexOf(sansApostrophes(attendu))
      expect(ici, attendu).toBeGreaterThan(position)
      position = ici
    }
  })

  it('lettre les mêmes comptes que la base : ni plus, ni moins', () => {
    const texte = fichiersDuSchema().map((f) => f.texte).find((t) => t.includes('create table public.lettrages_manuels'))!
    const listes = [...texte.matchAll(/compte (?:not )?in \(([^)]*)\)/g)].map((m) => new Set(m[1].split(',').map((x) => x.trim().replace(/'/g, ''))))
    expect(listes.length).toBe(2)
    for (const liste of listes) expect(liste).toEqual(new Set(COMPTES_LETTRABLES))
  })
})

describe('lettragesProposes — les lettrages évidents, proposés au cabinet', () => {
  const facture = piece({ id: 'f', tiers: 'Transmedical', montant_ttc: 500 })
  const avoir = piece({ id: 'a', tiers: 'Transmedical', montant_ttc: -500 })
  const autre = piece({ id: 'o', tiers: 'Transmedical', montant_ttc: 70 })
  const base = [facture, avoir, autre]
  const brouillonDe = (ps: readonly Piece[]) => ps.flatMap((p) => engagement(p, p.type_piece === 'vente' ? VENTES : ACHATS, []))
  const proposes = (ps: readonly Piece[], lm: readonly LettrageManuel[] = [], mode: 'engagement' | 'tresorerie' = 'engagement') =>
    lettragesProposes(brouillonDe(ps), ps, lm, mode)

  it('propose une facture et l’avoir du même montant, parmi les autres pièces ouvertes du tiers', () => {
    expect(proposes(base)).toEqual([{ compte: COMPTE_FOURNISSEURS, auxiliaire: 'FTRANSMEDICAL', libelle: 'Transmedical', pieceIds: ['a', 'f'], montant: 500 }])
  })

  it('propose toutes les pièces ouvertes d’un tiers dont le solde est nul', () => {
    const p1 = piece({ id: 'p1', tiers: 'Garage', montant_ttc: 100 })
    const p2 = piece({ id: 'p2', tiers: 'Garage', montant_ttc: 30 })
    const b = [...engagement(p1, ACHATS, [{ id: 'm1', date: '2026-03-10', montant: -130 }]), ...engagement(p2, ACHATS, [])]
    expect(lettragesProposes(b, [p1, p2], [], 'engagement')).toEqual([
      { compte: COMPTE_FOURNISSEURS, auxiliaire: 'FGARAGE', libelle: 'Garage', pieceIds: ['p1', 'p2'], montant: 30 },
    ])
  })

  // Le tiers ENTIER, et non une paire : aucune paire de ces trois pièces ne se solde, leur somme si.
  it('propose ensemble trois pièces dont seule la somme est nulle', () => {
    const f3 = piece({ id: 'f3', tiers: 'Garage', montant_ttc: 300 })
    const a3 = piece({ id: 'a3', tiers: 'Garage', montant_ttc: -100 })
    const a4 = piece({ id: 'a4', tiers: 'Garage', montant_ttc: -200 })
    expect(proposes([f3, a3, a4])).toEqual([
      { compte: COMPTE_FOURNISSEURS, auxiliaire: 'FGARAGE', libelle: 'Garage', pieceIds: ['a3', 'a4', 'f3'], montant: 300 },
    ])
  })

  it('ne propose rien quand deux factures du même montant attendent un seul avoir', () => {
    expect(proposes([...base, piece({ id: 'f2', tiers: 'Transmedical', montant_ttc: 500 })])).toEqual([])
  })

  it('propose au 411 une vente et son avoir, au montant de la vente', () => {
    const vente = piece({ id: 'v', type_piece: 'vente', tiers: 'Clinique', montant_ttc: 80 })
    const avoirVente = piece({ id: 'w', type_piece: 'vente', tiers: 'Clinique', montant_ttc: -80 })
    expect(proposes([vente, avoirVente])).toEqual([{ compte: COMPTE_CLIENTS, auxiliaire: 'CCLINIQUE', libelle: 'Clinique', pieceIds: ['v', 'w'], montant: 80 }])
  })

  it('ne propose ni une pièce déjà lettrée à la main, ni un tiers « divers », ni rien en trésorerie', () => {
    expect(proposes(base, [manuel('g', 'a'), manuel('g', 'x')])).toEqual([])
    expect(proposes([piece({ ...facture, tiers: null }), piece({ ...avoir, tiers: null })])).toEqual([])
    expect(proposes(base, [], 'tresorerie')).toEqual([])
  })

  it('ne propose rien que la base refuserait', () => {
    const p1 = piece({ id: 'p1', tiers: 'Garage', montant_ttc: 100 })
    const p2 = piece({ id: 'p2', tiers: 'Garage', montant_ttc: 30 })
    const tout = [...base, p1, p2]
    const b = [...brouillonDe(base), ...engagement(p1, ACHATS, [{ id: 'm1', date: '2026-03-10', montant: -130 }]), ...engagement(p2, ACHATS, [])]
    const propositions = lettragesProposes(b, tout, [], 'engagement')
    expect(propositions).toHaveLength(2)
    for (const p of propositions) expect(refusLettrageManuel(p.compte, p.pieceIds, b, tout, [], 'engagement')).toBeNull()
  })
})
