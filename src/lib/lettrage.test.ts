import { describe, expect, it } from 'vitest'
import { codeLettrage, comptesDeTiers, COMPTES_LETTRABLES, lettrages, sensNormal, type SoldeDeTiers } from './lettrage'
import { calculerBalance, type CibleComptable, type LigneAGenerer } from './ecritures'
import { lignesEngagementPourPiece } from './engagement'
import {
  COMPTE_AUTRES_DEBITEURS_CREDITEURS, COMPTE_BANQUE, COMPTE_CLIENTS, COMPTE_COURANT_ASSOCIE, COMPTE_EXPLOITANT,
  COMPTE_FOURNISSEURS, COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_TVA_DEDUCTIBLE,
} from './comptes'
import type { ANouveau, CompteNotesDeFrais, EcritureBrouillon, Piece } from './types'
import { ajouterJours } from './format'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from '../test/ecritures'

// Une écriture du brouillon et une pièce, TYPÉES SANS `as` : le compilateur vérifie chaque colonne contre la table, et une colonne
// ajoutée demain fait échouer ce fichier tant qu'elle n'y est pas.
const ecriture = (o: Partial<EcritureBrouillon> & Pick<EcritureBrouillon, 'id'>): EcritureBrouillon => ({
  dossier_id: 'd1', piece_id: 'p1', ligne_bancaire_id: null, date: '2026-03-10', compte: '606100', libelle: 'Fournisseur',
  montant: 100, sens: 'debit', statut: 'proposee', created_at: '2026-03-10T09:00:00Z', immobilisation_id: null,
  vehicule_id: null, ...NON_VALIDEE, ...o,
})

const piece = (o: Partial<Piece> & Pick<Piece, 'id'>): Piece => ({
  dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `${o.id}.pdf`, nom_fichier: `${o.id}.pdf`,
  storage_hash: null, date_piece: '2026-03-10', tiers: 'Transmedical', montant_ht: null, montant_tva: null, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c1', sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
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
    const l = lettrages(brouillon, 'engagement')
    const lettrees = brouillon.filter((e) => l.has(e.id))
    expect(lettrees.map((e) => [e.compte, e.sens])).toEqual([[COMPTE_FOURNISSEURS, 'credit'], [COMPTE_FOURNISSEURS, 'debit']])
    expect(new Set(lettrees.map((e) => l.get(e.id)!.code))).toEqual(new Set(['A']))
    expect(brouillon.filter((e) => e.compte === '606100' || e.compte === COMPTE_BANQUE).some((e) => l.has(e.id))).toBe(false)
  })

  it('ne lettre rien en trésorerie, où il n’y a pas de compte de tiers', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }])
    expect(lettrages(brouillon, 'tresorerie').size).toBe(0)
  })

  it('ne lettre pas une facture payée en partie, ni une facture payée en trop', () => {
    expect(lettrages(engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -100 }]), 'engagement').size).toBe(0)
    expect(lettrages(engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -130 }]), 'engagement').size).toBe(0)
  })

  it('lettre une facture que deux paiements soldent, les trois lignes ensemble', () => {
    const brouillon = engagement(achat, ACHATS, [
      { id: 'm1', date: '2026-04-05', montant: -20 }, { id: 'm2', date: '2026-05-06', montant: -100 },
    ])
    const l = lettrages(brouillon, 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => e.montant)).toEqual([120, 20, 100])
    expect(new Set([...l.values()].map((x) => x.code))).toEqual(new Set(['A']))
    expect([...l.values()][0].date).toBe('2026-05-06')
  })

  // Les centimes : 0,10 + 0,20 ne fait pas 0,30 en virgule flottante, et un lettrage qui en dépendrait laisserait
  // ouverte une facture soldée.
  it('compte en centimes, pas en virgule flottante', () => {
    const p = piece({ id: 'centimes', montant_ttc: 0.3 })
    const brouillon = engagement(p, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -0.1 }, { id: 'm2', date: '2026-04-06', montant: -0.2 }])
    expect(lettrages(brouillon, 'engagement').size).toBe(3)
  })

  it('lettre un avoir que le fournisseur rembourse', () => {
    const avoir = piece({ id: 'avoir', montant_ttc: -50 })
    const brouillon = engagement(avoir, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: 50 }])
    const l = lettrages(brouillon, 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => [e.compte, e.sens])).toEqual([
      [COMPTE_FOURNISSEURS, 'debit'], [COMPTE_FOURNISSEURS, 'credit'],
    ])
  })

  it('lettre la vente et son encaissement au 411', () => {
    const vente = piece({ id: 'vente', type_piece: 'vente', montant_ttc: 80, tiers: 'Clinique' })
    const brouillon = engagement(vente, VENTES, [{ id: 'm1', date: '2026-04-05', montant: 80 }])
    const l = lettrages(brouillon, 'engagement')
    expect(brouillon.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_CLIENTS, COMPTE_CLIENTS])
  })

  it('lettre la facture d’un bien au 404, et la note de frais au compte du dirigeant quand c’est un compte de tiers', () => {
    const bien = engagement(piece({ id: 'bien' }), { compte: '218300', immobilisation: true }, [{ id: 'm1', date: '2026-04-05', montant: -120 }])
    const l = lettrages(bien, 'engagement')
    expect(bien.filter((e) => l.has(e.id)).map((e) => e.compte)).toEqual([COMPTE_FOURNISSEURS_IMMOBILISATIONS, COMPTE_FOURNISSEURS_IMMOBILISATIONS])
    for (const compte of [COMPTE_COURANT_ASSOCIE, COMPTE_AUTRES_DEBITEURS_CREDITEURS] as const) {
      const note = engagement(piece({ id: 'note', type_piece: 'note_frais' }), ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }], compte)
      const ln = lettrages(note, 'engagement')
      expect(note.filter((e) => ln.has(e.id)).map((e) => e.compte)).toEqual([compte, compte])
    }
  })

  // Le 108 est le compte de l'exploitant, un compte de capitaux : on ne le lettre pas, même soldé.
  it('ne lettre jamais le 108 de l’exploitant', () => {
    const note = engagement(piece({ id: 'note', type_piece: 'note_frais' }), ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }], '108000')
    expect(note.some((e) => e.compte === COMPTE_EXPLOITANT)).toBe(true)
    expect(lettrages(note, 'engagement').size).toBe(0)
    expect(COMPTES_LETTRABLES.has(COMPTE_EXPLOITANT)).toBe(false)
  })

  // Les comptes de TVA commencent par 4, comme les comptes de tiers : un filtre sur la classe les lettrerait.
  it('ne lettre pas un compte de TVA, même soldé', () => {
    const brouillon = [
      ecriture({ id: 't1', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'debit', montant: 20 }),
      ecriture({ id: 't2', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
    ]
    expect(lettrages(brouillon, 'engagement').size).toBe(0)
  })

  it('ne lettre pas les lignes sans pièce, un virement du dirigeant au 455', () => {
    const brouillon = [
      ecriture({ id: 'v1', piece_id: null, ligne_bancaire_id: 'm1', compte: COMPTE_COURANT_ASSOCIE, sens: 'debit', montant: 50 }),
      ecriture({ id: 'v2', piece_id: null, ligne_bancaire_id: 'm2', compte: COMPTE_COURANT_ASSOCIE, sens: 'credit', montant: 50 }),
    ]
    expect(lettrages(brouillon, 'engagement').size).toBe(0)
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
    const l = lettrages(brouillon, 'engagement')
    const codeDe = (pieceId: string) => new Set(brouillon.filter((e) => e.piece_id === pieceId && l.has(e.id)).map((e) => l.get(e.id)!.code))
    expect([codeDe('f1'), codeDe('f2'), codeDe('f3')]).toEqual([new Set(['A']), new Set(['B']), new Set(['C'])])
  })

  it('numérote par compte général : le 411 a sa propre suite', () => {
    const brouillon = [
      ...engagement(piece({ id: 'a1', date_piece: '2026-01-10' }), ACHATS, [{ id: 'm1', date: '2026-02-01', montant: -120 }]),
      ...engagement(piece({ id: 'a2', date_piece: '2026-01-11' }), ACHATS, [{ id: 'm2', date: '2026-02-02', montant: -120 }]),
      ...engagement(piece({ id: 'v1', type_piece: 'vente', montant_ttc: 80 }), VENTES, [{ id: 'm3', date: '2026-03-20', montant: 80 }]),
    ]
    const l = lettrages(brouillon, 'engagement')
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
      const l = lettrages(brouillon, 'engagement')
      expect(l.get('a-recente-1')!.code).toBe('A')
      expect(l.get('z-ancienne-1')!.code).toBe('B')
    }
  })

  // § 240 : la date à laquelle le lettrage a été validé dans le système comptable. Ici, l'écriture du règlement qui
  // solde la facture : un relevé importé le 20 avril pour un paiement du 5 lettre le 20.
  it('date le lettrage du jour où l’application a écrit le règlement qui solde', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-04-20T08:00:00Z' }])
    expect([...lettrages(brouillon, 'engagement').values()][0].date).toBe('2026-04-20')
  })

  it('lit ce jour à Paris, pas en UTC', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-04-20T22:30:00Z' }])
    expect([...lettrages(brouillon, 'engagement').values()][0].date).toBe('2026-04-21')
  })

  it('ne date jamais un lettrage d’avant ce qu’il apparie', () => {
    const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120, creeLe: '2026-03-01T08:00:00Z' }])
    expect([...lettrages(brouillon, 'engagement').values()][0].date).toBe('2026-04-05')
  })

  // La base pose une date de création sur chaque ligne ; une date illisible ne doit pas faire lever un calcul qui tourne
  // au rendu de l'onglet Écritures.
  it('ne lève pas sur une date de création illisible, et retombe sur la date comptable', () => {
    for (const created_at of ['', 'pas une date']) {
      const brouillon = engagement(achat, ACHATS, [{ id: 'm1', date: '2026-04-05', montant: -120 }]).map((e) => ({ ...e, created_at }))
      expect([...lettrages(brouillon, 'engagement').values()][0].date).toBe('2026-04-05')
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
    expect(lettrages(brouillon, 'engagement').size).toBe(0)
    expect(lettrages(brouillon.slice(0, 2), 'engagement').size).toBe(2)
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
  const au = (date: string, a: readonly ANouveau[] = ouverture) => comptesDeTiers(brouillon, pieces, a, 'engagement', date)
  const ligneDe = (soldes: SoldeDeTiers[], libelle: string) => soldes.find((s) => s.libelle === libelle)

  it('ne rend rien en trésorerie', () => {
    expect(comptesDeTiers(brouillon, pieces, ouverture, 'tresorerie', '2026-03-31')).toEqual([])
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
      engagement(acompte, ACHATS, [{ id: 'm9', date: '2026-03-15', montant: -100 }]), [acompte], [], 'engagement', '2026-03-31',
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
    ], [p1, p2], [], 'engagement', '2026-03-31')
    expect(soldes).toHaveLength(1)
    expect(soldes[0].solde).toBe(0)
    expect(soldes[0].pieces.map((p) => p.etat)).toEqual(['payee_en_trop', 'ouverte'])
  })

  it('tait un tiers dont tout est soldé', () => {
    expect(ligneDe(au('2026-04-30'), 'Transmedical')!.pieces).toHaveLength(1)
    const solde = piece({ id: 'solde', tiers: 'Imprimerie', montant_ttc: 10 })
    expect(comptesDeTiers(engagement(solde, ACHATS, [{ id: 'm1', date: '2026-03-05', montant: -10 }]), [solde], [], 'engagement', '2026-03-31')).toEqual([])
  })

  it('range les restes par ancienneté — 30 jours au plus, 31 à 60, 61 à 90, plus de 90 — et leur somme fait le solde', () => {
    const ages = [30, 31, 60, 61, 90, 91]
    const ps = ages.map((_, i) => piece({ id: `a${i}`, tiers: 'Atelier', montant_ttc: 10 ** i }))
    const arrete = '2026-06-30'
    const datees = ps.map((p, i) => ({ ...p, date_piece: ajouterJours(arrete, -ages[i]) }))
    const soldes = comptesDeTiers(datees.flatMap((p) => engagement(p, ACHATS, [])), datees, [], 'engagement', arrete)
    expect(soldes[0].pieces.map((p) => p.age)).toEqual([91, 90, 61, 60, 31, 30])
    expect(soldes[0].tranches).toEqual([1, 10 + 100, 1000 + 10000, 100000])
    expect(soldes[0].tranches.reduce((t, x) => t + x, 0)).toBe(soldes[0].solde)
  })

  it('range les comptes : fournisseurs, d’immobilisations, clients, puis le dirigeant', () => {
    const bien = piece({ id: 'bien', tiers: 'Apple', montant_ttc: 900 })
    const soldes = comptesDeTiers(
      [...brouillon, ...engagement(bien, { compte: '218300', immobilisation: true }, [])], [...pieces, bien], ouverture, 'engagement', '2026-03-31',
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
