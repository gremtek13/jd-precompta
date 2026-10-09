import { describe, expect, it } from 'vitest'
import {
  detailJumellesIncoherentes, detailVentesEnDouble, jumellesDeLaFacture, jumellesDuDossier, jumellesImportees,
  marquesDesPieces, PASTILLE_DE_LA_MARQUE, phrasesJumellesImportees, ventesEnDouble,
  type FacturePourJumelle, type PiecePourJumelle, type TransmissionPourJumelle,
} from './ventesJumelles'

// Des données fictives : un dossier, ses factures émises, ses transmissions, ses pièces.
const D = 'dossier-1'
const AUTRE = 'dossier-2'

function facture(o: Partial<FacturePourJumelle> = {}): FacturePourJumelle {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
    emetteur_siret: '12345678900012', superpdp_invoice_id: null, ...o,
  }
}

function transmission(o: Partial<TransmissionPourJumelle> = {}): TransmissionPourJumelle {
  return { facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: 'flux-1', ...o }
}

function piece(o: Partial<PiecePourJumelle> = {}): PiecePourJumelle {
  return {
    id: 'p1', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, ...o,
  }
}

// L'identité que l'original d'une vente reçue porte quand il est la facture f1.
const IDENTITE_F1: Partial<PiecePourJumelle> = {
  identite_numero: 'F2026-0007', identite_siren_vendeur: '123456789', identite_date: '2026-03-14', identite_nature: 'facture',
}

const jumelleDe = (factures: FacturePourJumelle[], transmissions: TransmissionPourJumelle[], p: PiecePourJumelle) =>
  jumellesDuDossier(factures, transmissions, [p]).parPiece.get(p.id) ?? null

describe('jumellesDuDossier — le flux de la transmission', () => {
  it('une pièce qui porte le flux déposé pour la facture est sa jumelle', () => {
    const p = piece({ flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    expect(jumelleDe([facture()], [transmission()], p)).toEqual({ pieceId: 'p1', factureId: 'f1', preuves: ['flux'] })
  })

  it('le même identifiant chez un autre hôte, ou un autre identifiant chez le même hôte, ne relie rien', () => {
    expect(jumelleDe([facture()], [transmission()], piece({ flux_hote: 'pb.exemple.fr', flux_id: 'flux-1' }))).toBeNull()
    expect(jumelleDe([facture()], [transmission()], piece({ flux_hote: 'pa.exemple.fr', flux_id: 'flux-2' }))).toBeNull()
  })

  it('une transmission sans flux (sans réponse lisible) ne relie rien', () => {
    expect(jumelleDe([facture()], [transmission({ flux_id: null })], piece({ flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })))
      .toBeNull()
  })

  it('le flux d\'une transmission d\'une facture absente des factures données ne compte pas', () => {
    expect(jumelleDe([facture()], [transmission({ facture_id: 'f9' })], piece({ flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })))
      .toBeNull()
  })
})

describe('jumellesDuDossier — l\'identifiant de Super PDP', () => {
  it('celui que l\'envoi a écrit sur la facture', () => {
    const p = piece({ superpdp_invoice_id: 4242 })
    expect(jumelleDe([facture({ superpdp_invoice_id: 4242 })], [], p)).toEqual({ pieceId: 'p1', factureId: 'f1', preuves: ['superpdp'] })
    expect(jumelleDe([facture({ superpdp_invoice_id: 4243 })], [], p)).toBeNull()
  })

  it('celui que la transmission superpdp a gardé quand l\'écriture sur la facture a échoué', () => {
    const t = transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', flux_id: '4242' })
    expect(jumelleDe([facture()], [t], piece({ superpdp_invoice_id: 4242 })))
      .toEqual({ pieceId: 'p1', factureId: 'f1', preuves: ['superpdp'] })
  })

  it('le flux d\'une transmission par la plateforme n\'est pas un identifiant de Super PDP', () => {
    const t = transmission({ canal: 'plateforme', hote: 'pa.exemple.fr', flux_id: '4242' })
    expect(jumelleDe([facture()], [t], piece({ superpdp_invoice_id: 4242 }))).toBeNull()
  })

  it('une écriture du nombre qui n\'est pas celle de l\'envoi ne relie rien', () => {
    const t = transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', flux_id: '04242' })
    expect(jumelleDe([facture()], [t], piece({ superpdp_invoice_id: 4242 }))).toBeNull()
  })
})

describe('jumellesDuDossier — l\'identité G1.42 : le numéro, le SIREN figé, l\'année', () => {
  it('l\'original qui dit le numéro, le SIREN figé à la validation et l\'année de la facture est sa jumelle', () => {
    expect(jumelleDe([facture()], [], piece(IDENTITE_F1))).toEqual({ pieceId: 'p1', factureId: 'f1', preuves: ['identite'] })
  })

  it('le SIREN se compare à celui que la facture a FIGÉ, espaces ôtés', () => {
    expect(jumelleDe([facture({ emetteur_siret: '123 456 789 00012' })], [], piece(IDENTITE_F1))?.factureId).toBe('f1')
    expect(jumelleDe([facture({ emetteur_siret: '123456789' })], [], piece(IDENTITE_F1))?.factureId).toBe('f1')
    expect(jumelleDe([facture({ emetteur_siret: '98765432100019' })], [], piece(IDENTITE_F1))).toBeNull()
    // Une facture validée avant que l'émetteur se fige n'a pas d'identité à comparer.
    expect(jumelleDe([facture({ emetteur_siret: null })], [], piece(IDENTITE_F1))).toBeNull()
  })

  it('une autre année d\'émission est une autre facture, même numéro et même SIREN', () => {
    expect(jumelleDe([facture({ date_emission: '2027-03-14' })], [], piece(IDENTITE_F1))).toBeNull()
    // Un autre jour de la même année ne change pas l'identité : l'année seule en fait partie.
    expect(jumelleDe([facture({ date_emission: '2026-12-31' })], [], piece(IDENTITE_F1))?.factureId).toBe('f1')
  })

  it('le numéro se compare tel quel : ni la casse ni les espaces ne s\'arrangent', () => {
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_numero: 'f2026-0007' }))).toBeNull()
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_numero: 'F2026 0007' }))).toBeNull()
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_numero: 'F2026-00071' }))).toBeNull()
  })

  it('une identité incomplète ne relie rien : sans SIREN, sans date, ou sans numéro', () => {
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_siren_vendeur: null }))).toBeNull()
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_date: null }))).toBeNull()
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_numero: null }))).toBeNull()
    // Ni quand la facture n'a pas non plus de SIREN figé : deux SIREN absents ne sont pas le même vendeur.
    expect(jumelleDe([facture({ emetteur_siret: null })], [], piece({ ...IDENTITE_F1, identite_siren_vendeur: null }))).toBeNull()
  })

  it('une nature inconnue ne départage rien ; un avoir porte la facture avoir', () => {
    expect(jumelleDe([facture()], [], piece({ ...IDENTITE_F1, identite_nature: null }))?.factureId).toBe('f1')
    expect(jumelleDe([facture({ type: 'avoir', numero: 'A2026-0001' })], [],
      piece({ ...IDENTITE_F1, identite_numero: 'A2026-0001', identite_nature: 'avoir' }))?.factureId).toBe('f1')
  })

  it('une nature contraire fait une pièce incohérente, jumelle de rien — même quand son flux désigne la facture', () => {
    const p = piece({ ...IDENTITE_F1, identite_nature: 'avoir', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    const j = jumellesDuDossier([facture()], [transmission()], [p])
    expect(j.parPiece.size).toBe(0)
    expect(j.parFacture.size).toBe(0)
    expect(j.incoherentes).toEqual([{ pieceId: 'p1', motif: 'nature', factureId: 'f1' }])
  })
})

describe('jumellesDuDossier — ce qui n\'a pas de jumelle', () => {
  it('un brouillon n\'a pas de jumelle, par aucune preuve', () => {
    const brouillon = facture({ statut: 'brouillon', superpdp_invoice_id: 4242 })
    const p = piece({ ...IDENTITE_F1, flux_hote: 'pa.exemple.fr', flux_id: 'flux-1', superpdp_invoice_id: 4242 })
    const j = jumellesDuDossier([brouillon], [transmission()], [p])
    expect(j.parPiece.size).toBe(0)
    expect(j.incoherentes).toEqual([])
  })

  it('une facture d\'un autre dossier n\'est jamais la jumelle d\'une pièce de celui-ci, par aucune preuve', () => {
    const ailleurs = facture({ dossier_id: AUTRE, superpdp_invoice_id: 4242 })
    const p = piece({ ...IDENTITE_F1, flux_hote: 'pa.exemple.fr', flux_id: 'flux-1', superpdp_invoice_id: 4242 })
    const j = jumellesDuDossier([ailleurs], [transmission()], [p])
    expect(j.parPiece.size).toBe(0)
    expect(j.incoherentes).toEqual([])
    // Ni une incohérente : la nature d'une facture d'un autre dossier ne contredit rien ici.
    const avoir = piece({ ...IDENTITE_F1, identite_nature: 'avoir' })
    expect(jumellesDuDossier([ailleurs], [], [avoir]).incoherentes).toEqual([])
  })

  it('une pièce déposée, sans flux, sans identifiant ni identité, n\'est la jumelle de rien', () => {
    expect(jumelleDe([facture({ superpdp_invoice_id: 4242 })], [transmission()], piece())).toBeNull()
  })

  it('les factures de deux dossiers qui portent le même numéro : seule celle du dossier de la pièce', () => {
    const ici = facture({ id: 'f-ici' })
    const la = facture({ id: 'f-la', dossier_id: AUTRE })
    expect(jumelleDe([la, ici], [], piece(IDENTITE_F1))?.factureId).toBe('f-ici')
    expect(jumelleDe([la, ici], [], piece({ ...IDENTITE_F1, dossier_id: AUTRE }))?.factureId).toBe('f-la')
  })
})

describe('jumellesDuDossier — plusieurs preuves', () => {
  it('les preuves qui désignent la même facture se cumulent, dans l\'ordre flux, Super PDP, identité', () => {
    const f = facture({ superpdp_invoice_id: 4242 })
    const p = piece({ ...IDENTITE_F1, superpdp_invoice_id: 4242, flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    expect(jumelleDe([f], [transmission()], p)?.preuves).toEqual(['flux', 'superpdp', 'identite'])
  })

  it('des preuves qui désignent deux factures font une pièce incohérente, jumelle d\'aucune', () => {
    const f1 = facture()
    const f2 = facture({ id: 'f2', numero: 'F2026-0008' })
    const p = piece({ ...IDENTITE_F1, identite_numero: 'F2026-0008', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    const j = jumellesDuDossier([f2, f1], [transmission()], [p])
    expect(j.parPiece.size).toBe(0)
    expect(j.parFacture.size).toBe(0)
    expect(j.incoherentes).toEqual([{ pieceId: 'p1', motif: 'plusieurs_factures', factureIds: ['f1', 'f2'] }])
  })

  it('les factures désignées se disent dans un ordre fixe, quel que soit l\'ordre où les preuves les trouvent', () => {
    // Le flux désigne f2 AVANT que l'identité désigne f1 : l'ordre de découverte n'est pas celui que le détail dit.
    const f1 = facture()
    const f2 = facture({ id: 'f2', numero: 'F2026-0008' })
    const p = piece({ ...IDENTITE_F1, flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    const j = jumellesDuDossier([f1, f2], [transmission({ facture_id: 'f2' })], [p])
    expect(j.incoherentes).toEqual([{ pieceId: 'p1', motif: 'plusieurs_factures', factureIds: ['f1', 'f2'] }])
  })
})

describe('ventesEnDouble — la même vente portée par plusieurs pièces', () => {
  const f1 = facture({ superpdp_invoice_id: 4242 })
  const f2 = facture({ id: 'f2', numero: 'F2026-0008' })
  const recue = piece({ id: 'p-plateforme', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', ...IDENTITE_F1 })
  const synchronisee = piece({ id: 'p-superpdp', superpdp_invoice_id: 4242 })
  const seule = piece({ id: 'p-f2', ...IDENTITE_F1, identite_numero: 'F2026-0008' })

  it('la jumelle reçue de la plateforme et celle de Super PDP portent la même facture : comptée deux fois', () => {
    const j = jumellesDuDossier([f1, f2], [], [recue, synchronisee, seule])
    expect(j.parFacture.get('f1')?.map((x) => x.pieceId)).toEqual(['p-plateforme', 'p-superpdp'])
    expect(ventesEnDouble([f1, f2], j)).toEqual([{ factureId: 'f1', pieceIds: ['p-plateforme', 'p-superpdp'] }])
  })

  it('une facture portée par une seule pièce n\'est pas en double ; rien n\'est en double sans jumelle', () => {
    expect(ventesEnDouble([f1, f2], jumellesDuDossier([f1, f2], [], [recue, seule]))).toEqual([])
    expect(ventesEnDouble([f1, f2], jumellesDuDossier([f1, f2], [], []))).toEqual([])
  })

  it('dans l\'ordre des factures données, chacune avec ses pièces dans l\'ordre des pièces', () => {
    const autreDeF2 = piece({ id: 'p-f2-bis', flux_hote: 'pa.exemple.fr', flux_id: 'flux-f2' })
    const t = transmission({ facture_id: 'f2', flux_id: 'flux-f2' })
    const j = jumellesDuDossier([f2, f1], [t], [synchronisee, autreDeF2, seule, recue])
    expect(ventesEnDouble([f2, f1], j)).toEqual([
      { factureId: 'f2', pieceIds: ['p-f2-bis', 'p-f2'] },
      { factureId: 'f1', pieceIds: ['p-superpdp', 'p-plateforme'] },
    ])
  })
})

describe('jumellesDeLaFacture — celles d\'une facture', () => {
  it('rend les jumelles de la facture, et seulement elles', () => {
    const f1 = facture({ superpdp_invoice_id: 4242 })
    const pieces = [piece({ id: 'a', superpdp_invoice_id: 4242 }), piece({ id: 'b', ...IDENTITE_F1 }), piece({ id: 'c' })]
    expect(jumellesDeLaFacture(f1, [], pieces).map((j) => [j.pieceId, j.preuves])).toEqual([['a', ['superpdp']], ['b', ['identite']]])
    expect(jumellesDeLaFacture(facture({ statut: 'brouillon' }), [], pieces)).toEqual([])
    // Et par le flux de ses transmissions, qu'elle reçoit.
    const parLeFlux = piece({ id: 'd', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    expect(jumellesDeLaFacture(facture(), [transmission()], [parLeFlux]).map((j) => [j.pieceId, j.preuves])).toEqual([['d', ['flux']]])
  })
})

describe('ce que la Checklist en dit — chaque pièce nommée, que la recherche des Justificatifs retrouve', () => {
  const factures = [
    { id: 'f1', numero: 'F2026-0007', type: 'facture' as const },
    { id: 'f2', numero: 'F2026-0008', type: 'facture' as const },
    { id: 'a1', numero: 'A2026-0001', type: 'avoir' as const },
  ]
  const pieces = [
    { id: 'p1', nom_fichier: 'facture-0007.xml' }, { id: 'p2', nom_fichier: 'Facture Super PDP F2026-0007.txt' },
    { id: 'p3', nom_fichier: 'facture-0008.xml' }, { id: 'p4', nom_fichier: 'vente.pdf' },
  ]

  it('la facture et ses pièces, puis la règle ; rien quand aucune vente n’est en double', () => {
    expect(detailVentesEnDouble([], factures, pieces)).toBeUndefined()
    expect(detailVentesEnDouble([{ factureId: 'f1', pieceIds: ['p1', 'p2'] }], factures, pieces)).toBe(
      'F2026-0007 : « facture-0007.xml », « Facture Super PDP F2026-0007.txt ». Une vente ne se compte qu’une fois : '
      + 'gardez une seule pièce par facture — celle reçue de la plateforme du client porte l’original.')
  })

  it('trois factures au plus, puis leur nombre', () => {
    const quatre = ['f1', 'f2', 'a1', 'f9'].map((factureId) => ({ factureId, pieceIds: ['p1', 'p3'] }))
    const detail = detailVentesEnDouble(quatre, factures, pieces) ?? ''
    expect(detail).toContain('A2026-0001 : « facture-0007.xml », « facture-0008.xml ». Et 1 autre. Une vente')
    expect(detail).not.toContain('une facture sans numéro')
    expect(detailVentesEnDouble([...quatre, { factureId: 'f8', pieceIds: ['p1'] }], factures, pieces)).toContain('Et 2 autres.')
  })

  it('une pièce incohérente dit ce qu’elle désigne', () => {
    expect(detailJumellesIncoherentes([], factures, pieces)).toBeUndefined()
    expect(detailJumellesIncoherentes([
      { pieceId: 'p4', motif: 'plusieurs_factures', factureIds: ['f1', 'f2'] },
      { pieceId: 'p3', motif: 'nature', factureId: 'a1' },
    ], factures, pieces)).toBe('« vente.pdf » désigne F2026-0007 et F2026-0008. « facture-0008.xml » porte le numéro de '
      + 'A2026-0001, qui est un avoir, sous une autre nature. Aucune n’est tenue pour la pièce de sa facture : vérifiez-les '
      + 'sur la plateforme avant de les valider.')
  })
})

// ── Phase C : ce que l'onglet Justificatifs et le bilan d'un import en montrent ─────────────────────────────────────────

describe('marquesDesPieces — la pastille de chaque pièce, et ce qu’elle veut dire', () => {
  const f1 = facture({ superpdp_invoice_id: 4242 })
  const f2 = facture({ id: 'f2', numero: 'F2026-0008' })
  const a1 = facture({ id: 'a1', type: 'avoir', numero: 'A2026-0001' })
  const marques = (factures: FacturePourJumelle[], transmissions: TransmissionPourJumelle[], pieces: PiecePourJumelle[]) =>
    marquesDesPieces(factures, jumellesDuDossier(factures, transmissions, pieces))

  it('la jumelle : le numéro de sa facture, la preuve qui la relie, et rien sur une pièce sans lien', () => {
    const m = marques([f1, f2], [transmission()], [piece({ flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' }), piece({ id: 'p9' })])
    expect([...m.keys()]).toEqual(['p1'])
    expect(m.get('p1')).toEqual({
      genre: 'jumelle',
      libelle: 'Facture émise F2026-0007',
      explication: 'Cette pièce est la facture F2026-0007 émise dans l’application, revenue comme pièce — reconnue par le '
        + 'flux de sa transmission. C’est la même vente : elle ne se compte qu’une fois.',
      numeros: ['F2026-0007'],
      autresPieces: [],
    })
  })

  it('chacune des trois preuves se dit, et toutes ensemble dans l’ordre flux, Super PDP, identité', () => {
    expect(marques([f1], [], [piece({ superpdp_invoice_id: 4242 })]).get('p1')?.explication)
      .toContain('— reconnue par l’identifiant de Super PDP. C’est')
    expect(marques([f1], [], [piece(IDENTITE_F1)]).get('p1')?.explication)
      .toContain('— reconnue par son numéro, son vendeur et son année. C’est')
    const toutes = piece({ ...IDENTITE_F1, superpdp_invoice_id: 4242, flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    expect(marques([f1], [transmission()], [toutes]).get('p1')?.explication).toContain('— reconnue par le flux de sa '
      + 'transmission, par l’identifiant de Super PDP et par son numéro, son vendeur et son année. C’est')
  })

  it('la vente comptée deux fois : chaque pièce le dit, et nomme les autres', () => {
    const recue = piece({ id: 'p-plateforme', ...IDENTITE_F1 })
    const synchronisee = piece({ id: 'p-superpdp', superpdp_invoice_id: 4242 })
    const m = marques([f1, f2], [], [recue, synchronisee, piece({ id: 'p-f2', ...IDENTITE_F1, identite_numero: 'F2026-0008' })])
    expect(m.get('p-plateforme')).toEqual({
      genre: 'double',
      libelle: 'Comptée deux fois',
      explication: 'La facture F2026-0007 émise dans l’application est portée par 2 pièces, dont celle-ci, reconnue par '
        + 'son numéro, son vendeur et son année. Validées, elles la comptent deux fois dans la 2035, la CA3 et les '
        + 'écritures : gardez une seule pièce par facture — celle reçue de la plateforme du client porte l’original.',
      numeros: ['F2026-0007'],
      autresPieces: ['p-superpdp'],
    })
    expect(m.get('p-superpdp')?.genre).toBe('double')
    expect(m.get('p-superpdp')?.autresPieces).toEqual(['p-plateforme'])
    expect(m.get('p-superpdp')?.explication).toContain('dont celle-ci, reconnue par l’identifiant de Super PDP.')
    // La facture portée par une seule pièce reste une jumelle.
    expect(m.get('p-f2')?.genre).toBe('jumelle')
  })

  it('trois pièces, quatre pièces : le compte se dit, et chacune nomme toutes les autres dans l’ordre', () => {
    const trois = ['a', 'b', 'c'].map((id) => piece({ id, ...IDENTITE_F1 }))
    const m3 = marques([f1], [], trois)
    expect(m3.get('b')?.libelle).toBe('Comptée trois fois')
    expect(m3.get('b')?.autresPieces).toEqual(['a', 'c'])
    expect(m3.get('b')?.explication).toContain('portée par 3 pièces, dont celle-ci')
    expect(m3.get('b')?.explication).toContain('elles la comptent trois fois dans la 2035')
    expect(marques([f1], [], [...trois, piece({ id: 'd', ...IDENTITE_F1 })]).get('d')?.libelle).toBe('Comptée 4 fois')
  })

  it('une pièce dont les preuves désignent deux factures : à vérifier, et les deux numéros', () => {
    const p = piece({ ...IDENTITE_F1, identite_numero: 'F2026-0008', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1' })
    expect(marques([f1, f2], [transmission()], [p]).get('p1')).toEqual({
      genre: 'incoherente',
      libelle: 'À vérifier : désigne F2026-0007 et F2026-0008',
      explication: 'Ses preuves la rattachent à F2026-0007 et F2026-0008 à la fois : elle n’est tenue pour la pièce '
        + 'd’aucune facture émise. Vérifiez-la sur la plateforme avant de la valider.',
      numeros: ['F2026-0007', 'F2026-0008'],
      autresPieces: [],
    })
    // Trois factures : une virgule, puis « et ».
    const f3 = facture({ id: 'f3', numero: 'F2026-0009', superpdp_invoice_id: 77 })
    const trois = piece({ ...p, superpdp_invoice_id: 77 })
    expect(marques([f1, f2, f3], [transmission()], [trois]).get('p1')?.libelle)
      .toBe('À vérifier : désigne F2026-0007, F2026-0008 et F2026-0009')
  })

  it('une pièce qui porte le numéro d’une facture d’une autre nature : l’avoir, ou la facture, nommé', () => {
    const facturePourAvoir = piece({ ...IDENTITE_F1, identite_numero: 'A2026-0001' })
    expect(marques([a1], [], [facturePourAvoir]).get('p1')).toEqual({
      genre: 'incoherente',
      libelle: 'À vérifier : porte le numéro de l’avoir A2026-0001',
      explication: 'Son original dit une facture, et A2026-0001 est un avoir émis dans l’application : elle n’est tenue '
        + 'pour la pièce d’aucune facture émise. Vérifiez-la sur la plateforme avant de la valider.',
      numeros: ['A2026-0001'],
      autresPieces: [],
    })
    const avoirPourFacture = piece({ ...IDENTITE_F1, identite_nature: 'avoir' })
    expect(marques([f1], [], [avoirPourFacture]).get('p1')).toMatchObject({
      libelle: 'À vérifier : porte le numéro de la facture F2026-0007',
      explication: expect.stringMatching(/^Son original dit un avoir, et F2026-0007 est une facture émise dans l’application : /),
    })
  })

  it('une facture sans numéro ne s’invente pas de numéro, et la recherche n’en reçoit aucun', () => {
    const sans = facture({ numero: null, superpdp_invoice_id: 4242 })
    const m = marques([sans], [], [piece({ superpdp_invoice_id: 4242 })])
    expect(m.get('p1')?.libelle).toBe('Facture émise (sans numéro)')
    expect(m.get('p1')?.numeros).toEqual([])
  })

  it('la pastille : neutre pour une jumelle, danger pour une vente en double, attention pour une pièce à vérifier', () => {
    expect(PASTILLE_DE_LA_MARQUE).toEqual({ jumelle: 'badge-neutral', double: 'badge-danger', incoherente: 'badge-warning' })
  })
})

describe('jumellesImportees et ses phrases — le bilan d’un import', () => {
  const f1 = facture({ superpdp_invoice_id: 4242 })
  const f2 = facture({ id: 'f2', numero: 'F2026-0008' })
  const pieces = [
    piece({ id: 'seule', ...IDENTITE_F1, identite_numero: 'F2026-0008' }),
    piece({ id: 'deja', superpdp_invoice_id: 4242 }),
    piece({ id: 'nouvelle', ...IDENTITE_F1 }),
    piece({ id: 'contradictoire', ...IDENTITE_F1, superpdp_invoice_id: 4242, identite_numero: 'F2026-0008' }),
    piece({ id: 'contradictoire-ancienne', ...IDENTITE_F1, superpdp_invoice_id: 4242, identite_numero: 'F2026-0008' }),
    piece({ id: 'achat' }),
  ]
  const j = jumellesDuDossier([f1, f2], [], pieces)

  it('compte les seules pièces importées, jugées sur toutes celles du dossier', () => {
    // « nouvelle » porte f1, que « deja » portait avant l'import : une vente déjà portée par une autre pièce.
    expect(jumellesImportees(['seule', 'nouvelle', 'contradictoire', 'achat'], j))
      .toEqual({ reconnues: 2, dejaPortees: 1, incoherentes: 1 })
    expect(jumellesImportees(['achat'], j)).toEqual({ reconnues: 0, dejaPortees: 0, incoherentes: 0 })
    // Un identifiant rendu deux fois ne se compte qu'une fois.
    expect(jumellesImportees(['nouvelle', 'nouvelle'], j)).toEqual({ reconnues: 1, dejaPortees: 1, incoherentes: 0 })
  })

  it('les phrases : rien pour rien, le singulier, le pluriel, et le double qui renvoie à la Checklist', () => {
    expect(phrasesJumellesImportees({ reconnues: 0, dejaPortees: 0, incoherentes: 0 })).toEqual([])
    expect(phrasesJumellesImportees({ reconnues: 1, dejaPortees: 0, incoherentes: 0 }))
      .toEqual(['1 vente reconnue comme une facture émise de l’application : Justificatifs la marque.'])
    expect(phrasesJumellesImportees({ reconnues: 3, dejaPortees: 0, incoherentes: 0 }))
      .toEqual(['3 ventes reconnues comme des factures émises de l’application : Justificatifs les marque.'])
    expect(phrasesJumellesImportees({ reconnues: 1, dejaPortees: 1, incoherentes: 0 })).toEqual([
      '1 vente reconnue comme une facture émise de l’application, dont 1 déjà portée par une autre pièce : ne validez '
      + 'qu’une pièce par facture ; la Checklist le signale.'])
    expect(phrasesJumellesImportees({ reconnues: 3, dejaPortees: 2, incoherentes: 0 })).toEqual([
      '3 ventes reconnues comme des factures émises de l’application, dont 2 déjà portées par une autre pièce : ne '
      + 'validez qu’une pièce par facture ; la Checklist le signale.'])
    expect(phrasesJumellesImportees({ reconnues: 0, dejaPortees: 0, incoherentes: 1 })).toEqual([
      '1 pièce dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de la valider.'])
    expect(phrasesJumellesImportees({ reconnues: 1, dejaPortees: 0, incoherentes: 2 })).toEqual([
      '1 vente reconnue comme une facture émise de l’application : Justificatifs la marque.',
      '2 pièces dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de les valider.'])
  })
})
