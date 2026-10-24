import { describe, expect, it } from 'vitest'
import {
  detailPiecesADesigner, detailVentesEnDouble, detailVentesHorsFacturesAVerifier, jumellesDuDossier, jumellesImportees,
  marquesDesPieces, PASTILLE_DE_LA_MARQUE, phrasesJumellesImportees, piecesADesigner, ventesEnDouble,
  ventesHorsFacturesAVerifier,
  type FacturePourJumelle, type PieceDuRegime, type PiecePourJumelle, type PiecePourLeSymptome, type RegimeDuPont,
} from './ventesJumelles'
import type { FacturesSources } from './facturesSources'

// LE PONT PAR RÉGIME (ligne 28.65, chantier EC-Q3, étape VF6e ; conception : HISTORIQUE.md, « VF6, LA JUMELLE INVERSÉE :
// LA CONCEPTION », § 3 h). Dans un dossier dont les factures sont la source de leurs ventes, une facture SOURCE compte sa vente
// elle-même : ses exemplaires désignés ne la doublent pas, une pièce validée qui n'est pas son exemplaire, si ; la pièce que le
// pont rattache à une facture sans être désignée est à désigner (G3) ; une vente déclarée hors des factures se marque, et son
// symptôme se dit (VF6-Q4). Une facture d'avant la bascule se juge comme hier. Les cas d'avant l'étape, sous le régime d'hier,
// restent dans ventesJumelles.test.ts, leurs attentes inchangées. Données fictives.

const D = 'dossier-1'

function facture(o: Partial<FacturePourJumelle> = {}): FacturePourJumelle {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
    emetteur_siret: '12345678900012', superpdp_invoice_id: null, ...o,
  }
}

function piece(o: Partial<PiecePourJumelle> = {}): PiecePourJumelle {
  return {
    id: 'p1', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, ...o,
  }
}

const SANS_SOURCE: FacturesSources = new Set()
const REGIME_D_HIER: RegimeDuPont = { dossierBascule: false, sources: SANS_SOURCE }

// Une facture source (fs), une facture d'avant la bascule (fa), un avoir source (avs).
const fs = facture({ id: 'fs', numero: 'F2026-0021', superpdp_invoice_id: 21 })
const fa = facture({ id: 'fa', numero: 'F2026-0003', superpdp_invoice_id: 3 })
const avs = facture({ id: 'avs', type: 'avoir', numero: 'A2026-0002', superpdp_invoice_id: 22 })
const SOURCES: FacturesSources = new Set(['fs', 'avs'])
const BASCULE: RegimeDuPont = { dossierBascule: true, sources: SOURCES }
// La jumelle revenue de Super PDP, et le PDF que le cabinet a désigné exemplaire de la facture source.
const jumelleRecue = piece({ id: 'p-recue', superpdp_invoice_id: 21 })
const pdfDesigne = piece({ id: 'p-pdf', facture_id: 'fs' })
// L'identité G1.42 de fs, que porte l'original d'une autre pièce.
const IDENTITE_FS: Partial<PiecePourJumelle> = {
  identite_numero: 'F2026-0021', identite_siren_vendeur: '123456789', identite_date: '2026-05-01',
}

const statuts = (valides: readonly string[], tous: readonly PiecePourJumelle[], declarees: readonly string[] = []): PieceDuRegime[] =>
  tous.map((p) => ({
    id: p.id, statut: valides.includes(p.id) ? 'validee' : 'a_valider', vente_hors_des_factures: declarees.includes(p.id),
  }))
const pont = (pieces: PiecePourJumelle[]) => jumellesDuDossier([fs, fa, avs], [], pieces)

describe('ventesEnDouble par régime', () => {
  it('deux exemplaires désignés d’une facture source — la jumelle et le PDF — ne comptent ni l’un ni l’autre : pas de double', () => {
    const pieces = [{ ...jumelleRecue, facture_id: 'fs' }, pdfDesigne]
    expect(ventesEnDouble([fs, fa], pont(pieces), SOURCES, statuts(['p-recue', 'p-pdf'], pieces))).toEqual([])
    // Le régime d'hier les dit comptées deux fois : la facture n'y est pas source.
    expect(ventesEnDouble([fs, fa], pont(pieces), SANS_SOURCE, statuts(['p-recue', 'p-pdf'], pieces)))
      .toEqual([{ factureId: 'fs', pieceIds: ['p-recue', 'p-pdf'] }])
  })

  it('une pièce VALIDÉE que le pont rattache à une facture source sans en être l’exemplaire la compte en plus d’elle', () => {
    const pieces = [jumelleRecue]
    expect(ventesEnDouble([fs], pont(pieces), SOURCES, statuts(['p-recue'], pieces)))
      .toEqual([{ factureId: 'fs', pieceIds: ['p-recue'], parLaFacture: true }])
    // À valider, elle ne compte pas encore : pas de double.
    expect(ventesEnDouble([fs], pont(pieces), SOURCES, statuts([], pieces))).toEqual([])
    // Une pièce dont l'appelant ne donne pas le statut n'est pas « validée ».
    expect(ventesEnDouble([fs], pont(pieces), SOURCES, [])).toEqual([])
  })

  it('l’exemplaire désigné et deux pièces validées non désignées : seules celles-ci doublent la facture', () => {
    const pieces = [pdfDesigne, jumelleRecue, piece({ id: 'p-autre', ...IDENTITE_FS })]
    expect(ventesEnDouble([fs], pont(pieces), SOURCES, statuts(['p-pdf', 'p-recue', 'p-autre'], pieces)))
      .toEqual([{ factureId: 'fs', pieceIds: ['p-recue', 'p-autre'], parLaFacture: true }])
  })

  it('une facture d’avant la bascule, dans le même dossier, se juge comme hier : deux pièces, comptée deux fois', () => {
    const pieces = [piece({ id: 'a1', superpdp_invoice_id: 3 }), piece({ id: 'a2', facture_id: 'fa' })]
    expect(ventesEnDouble([fs, fa], pont(pieces), SOURCES, statuts([], pieces)))
      .toEqual([{ factureId: 'fa', pieceIds: ['a1', 'a2'] }])
  })
})

describe('piecesADesigner', () => {
  const pieces = [
    jumelleRecue, // la facture source, à valider, non désignée : à désigner
    pdfDesigne, // désignée : rien
    piece({ id: 'a-validee', superpdp_invoice_id: 3 }), // la facture d'avant, validée, non désignée : à désigner
    piece({ id: 'p-double', superpdp_invoice_id: 22 }), // l'avoir source, validée, non désignée : comptée deux fois
    // Super PDP dit fs, son identité fa : des preuves contraires, à vérifier.
    piece({ id: 'p-contraire', superpdp_invoice_id: 21, identite_numero: 'F2026-0003', identite_siren_vendeur: '123456789', identite_date: '2026-01-02' }),
  ]
  const st = statuts(['a-validee', 'p-double'], pieces)

  it('dans un dossier basculé : chaque pièce que le pont rattache sans désignation, hors d’un double et d’une pièce à vérifier', () => {
    const j = pont(pieces)
    expect(piecesADesigner(j, BASCULE, ventesEnDouble([fs, fa, avs], j, SOURCES, st))).toEqual([
      { pieceId: 'p-recue', factureId: 'fs' }, { pieceId: 'a-validee', factureId: 'fa' },
    ])
  })

  it('hors d’un dossier basculé : rien — la désignation y reste un geste libre', () => {
    const j = pont(pieces)
    expect(piecesADesigner(j, REGIME_D_HIER, ventesEnDouble([fs, fa, avs], j, SANS_SOURCE, st))).toEqual([])
  })
})

describe('marquesDesPieces par régime', () => {
  const marquer = (pieces: PiecePourJumelle[], regime: RegimeDuPont, valides: string[], declarees: string[] = []) =>
    marquesDesPieces([fs, fa, avs], pont(pieces), regime, statuts(valides, pieces, declarees))

  it('l’exemplaire désigné d’une facture source : « Exemplaire de la facture … », neutre — la facture compte la vente', () => {
    const m = marquer([pdfDesigne, piece({ id: 'p-av', facture_id: 'avs' })], BASCULE, ['p-pdf'])
    expect(m.get('p-pdf')).toEqual({
      genre: 'exemplaire',
      libelle: 'Exemplaire de la facture F2026-0021',
      explication: 'Cette pièce est l’exemplaire de la facture F2026-0021 émise dans l’application — désignée comme son '
        + 'exemplaire. La vente est comptée par la facture, source de sa vente : la pièce ne compte nulle part.',
      numeros: ['F2026-0021'],
      autresPieces: [],
    })
    expect(m.get('p-av')?.libelle).toBe('Exemplaire de l’avoir A2026-0002')
    expect(m.get('p-av')?.explication).toContain('l’exemplaire de l’avoir A2026-0002 émis dans l’application')
    expect(PASTILLE_DE_LA_MARQUE[m.get('p-pdf')!.genre]).toBe('badge-neutral')
  })

  it('la jumelle et le PDF tous deux désignés d’une facture source : deux exemplaires, aucun « Comptée deux fois »', () => {
    const m = marquer([{ ...jumelleRecue, facture_id: 'fs' }, pdfDesigne], BASCULE, ['p-recue', 'p-pdf'])
    expect([m.get('p-recue')?.genre, m.get('p-pdf')?.genre]).toEqual(['exemplaire', 'exemplaire'])
    expect(m.get('p-recue')?.explication).toContain('— désignée comme son exemplaire, et reconnue par l’identifiant de Super PDP.')
  })

  it('la pièce à désigner : « À désigner : c’est la facture … », attention — et ce qu’elle comptera, désignée', () => {
    const m = marquer([jumelleRecue, piece({ id: 'a1', superpdp_invoice_id: 3 }), piece({ id: 'av', superpdp_invoice_id: 22 })], BASCULE, [])
    expect(m.get('p-recue')).toEqual({
      genre: 'a_designer',
      libelle: 'À désigner : c’est la facture F2026-0021',
      explication: 'Cette pièce est la facture F2026-0021 émise dans l’application, revenue comme pièce — reconnue par '
        + 'l’identifiant de Super PDP. Dans ce dossier, une pièce de vente ne se valide que désignée exemplaire de la facture '
        + 'que le pont prouve : désignez-la avant de la valider. Désignée, elle ne compte pas : la facture, source de sa '
        + 'vente, la compte elle-même.',
      numeros: ['F2026-0021'],
      autresPieces: [],
    })
    expect(m.get('a1')?.explication).toContain('Désignée, elle compte la vente comme aujourd’hui : la facture, émise avant '
      + 'la bascule, n’en est pas la source.')
    expect(m.get('av')?.libelle).toBe('À désigner : c’est l’avoir A2026-0002')
    expect(PASTILLE_DE_LA_MARQUE[m.get('a1')!.genre]).toBe('badge-warning')
  })

  it('validée avant la bascule, la pièce d’une facture d’avant reste à désigner, et sa marque le dit', () => {
    const m = marquer([piece({ id: 'a1', superpdp_invoice_id: 3 })], BASCULE, ['a1'])
    expect(m.get('a1')).toMatchObject({ genre: 'a_designer', libelle: 'À désigner : c’est la facture F2026-0003' })
    expect(m.get('a1')?.explication).toContain('Validée sans être désignée — avant la bascule du dossier, ou avant que sa '
      + 'transmission soit connue —, elle compte la vente comme une pièce : désignez-la exemplaire de cette facture')
  })

  it('une pièce déclarée que le pont rattache pourtant à une facture : à désigner, et la déclaration est dite', () => {
    const m = marquer([jumelleRecue], BASCULE, [], ['p-recue'])
    expect(m.get('p-recue')?.genre).toBe('a_designer')
    expect(m.get('p-recue')?.explication).toContain('Elle est pourtant déclarée vente hors des factures de l’application.')
    expect(m.get('p-recue')?.explication).toContain('(la désignation remplace la déclaration)')
  })

  it('la pièce validée d’une facture source qui n’en est pas l’exemplaire : « Comptée deux fois », danger, et le remède', () => {
    const deux = marquer([pdfDesigne, jumelleRecue], BASCULE, ['p-pdf', 'p-recue'])
    expect(deux.get('p-recue')).toEqual({
      genre: 'double',
      libelle: 'Comptée deux fois',
      explication: 'La facture F2026-0021 émise dans l’application est la source de sa vente : elle la compte elle-même, et '
        + 'cette pièce validée, reconnue par l’identifiant de Super PDP, la compte aussi — deux fois dans la 2035, la CA3 et '
        + 'les écritures. Désignez-la exemplaire de la facture : elle ne comptera plus.',
      numeros: ['F2026-0021'],
      autresPieces: [],
    })
    expect(deux.get('p-pdf')?.genre).toBe('exemplaire')
    const trois = marquer([jumelleRecue, piece({ id: 'p-autre', ...IDENTITE_FS })], BASCULE, ['p-recue', 'p-autre'])
    expect(trois.get('p-autre')).toMatchObject({ genre: 'double', libelle: 'Comptée trois fois', autresPieces: ['p-recue'] })
    expect(PASTILLE_DE_LA_MARQUE[deux.get('p-recue')!.genre]).toBe('badge-danger')
  })

  it('la vente déclarée que le pont ne rattache à rien : neutre, et ce que la déclaration dit selon le régime', () => {
    const declaree = piece({ id: 'p-formation' })
    expect(marquer([declaree], BASCULE, ['p-formation'], ['p-formation']).get('p-formation')).toEqual({
      genre: 'hors_factures',
      libelle: 'Vente hors des factures de l’application',
      explication: 'Le cabinet l’a déclarée vente hors des factures de l’application : aucune facture validée de '
        + 'l’application n’est la facture de cette vente, qui compte comme une vente. Si c’était le PDF d’une facture de '
        + 'l’application, la vente compterait deux fois.',
      numeros: [],
      autresPieces: [],
    })
    expect(marquer([declaree], REGIME_D_HIER, [], ['p-formation']).get('p-formation')?.explication).toBe(
      'Le cabinet l’a déclarée vente hors des factures de l’application : dans un dossier dont les factures ne sont pas la '
      + 'source de leurs ventes, la déclaration ne change rien à ce qui se compte.')
    // Une pièce que rien ne déclare ni ne rattache n'a pas de marque.
    expect(marquer([declaree], BASCULE, [], []).has('p-formation')).toBe(false)
    expect(PASTILLE_DE_LA_MARQUE.hors_factures).toBe('badge-neutral')
  })

  it('une pièce déclarée dont les preuves se contredisent garde la marque de la pièce à vérifier', () => {
    const contraire = piece({ id: 'p-c', superpdp_invoice_id: 21, identite_numero: 'F2026-0003', identite_siren_vendeur: '123456789', identite_date: '2026-01-02' })
    expect(marquer([contraire], BASCULE, [], ['p-c']).get('p-c')?.genre).toBe('incoherente')
  })

  it('les mêmes pièces hors d’un dossier basculé : les marques d’hier', () => {
    const pieces = [jumelleRecue, piece({ id: 'a1', superpdp_invoice_id: 3 })]
    const m = marquer(pieces, REGIME_D_HIER, ['a1'])
    expect([m.get('p-recue')?.genre, m.get('a1')?.genre]).toEqual(['jumelle', 'jumelle'])
    expect(m.get('a1')?.libelle).toBe('Facture émise F2026-0003')
  })
})

describe('ventesHorsFacturesAVerifier — le symptôme d’une pièce déclarée à tort (VF6-Q4)', () => {
  const fsm = { id: 'fs', statut: 'validee' as const, numero: 'F2026-0021', date_emission: '2026-04-02', montant_ttc: 360 }
  const fam = { id: 'fa', statut: 'validee' as const, numero: 'F2026-0003', date_emission: '2026-02-01', montant_ttc: 360 }
  const avm = { id: 'avs', statut: 'validee' as const, numero: 'A2026-0002', date_emission: '2026-04-03', montant_ttc: -360 }
  const p = (o: Partial<PiecePourLeSymptome> = {}): PiecePourLeSymptome => ({
    id: 'pd', statut: 'validee', facture_id: null, vente_hors_des_factures: true, montant_ttc: 360, date_piece: '2026-06-30', ...o,
  })

  it('déclarée, du TTC d’une facture source de la même année sans exemplaire validé : à vérifier', () => {
    expect(ventesHorsFacturesAVerifier([p()], [fsm, fam, avm], SOURCES)).toEqual([{ pieceId: 'pd', factureIds: ['fs'] }])
    // À valider aussi : elle se vérifie mieux avant sa validation.
    expect(ventesHorsFacturesAVerifier([p({ statut: 'a_valider' })], [fsm], SOURCES)).toEqual([{ pieceId: 'pd', factureIds: ['fs'] }])
    // Le signe compte : l'avoir source de −360 € ne répond qu'à une pièce de −360 €.
    expect(ventesHorsFacturesAVerifier([p({ montant_ttc: -360 })], [fsm, avm], SOURCES)).toEqual([{ pieceId: 'pd', factureIds: ['avs'] }])
  })

  it('rien quand la facture a un exemplaire VALIDÉ ; un exemplaire à valider ne la retire pas', () => {
    expect(ventesHorsFacturesAVerifier([p(), p({ id: 'ex', vente_hors_des_factures: false, facture_id: 'fs' })], [fsm], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier(
      [p(), p({ id: 'ex', statut: 'a_valider', vente_hors_des_factures: false, facture_id: 'fs' })], [fsm], SOURCES,
    )).toEqual([{ pieceId: 'pd', factureIds: ['fs'] }])
  })

  it('rien pour une autre année, un autre montant, une facture qui n’est pas source, une pièce non déclarée ou illisible', () => {
    expect(ventesHorsFacturesAVerifier([p({ date_piece: '2025-12-31' })], [fsm], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p({ montant_ttc: 360.01 })], [fsm], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p()], [fam], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p()], [fsm], SANS_SOURCE)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p({ vente_hors_des_factures: false })], [fsm], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p({ montant_ttc: null }), p({ id: 'sans-date', date_piece: null })], [fsm], SOURCES)).toEqual([])
    expect(ventesHorsFacturesAVerifier([p()], [{ ...fsm, statut: 'brouillon' as const }], SOURCES)).toEqual([])
  })

  it('au centime, et toutes les factures du même montant, dans leur ordre', () => {
    const deux = [fsm, { ...fsm, id: 'fs2', numero: 'F2026-0030' }]
    expect(ventesHorsFacturesAVerifier([p({ montant_ttc: 360.004 })], deux, new Set(['fs', 'fs2'])))
      .toEqual([{ pieceId: 'pd', factureIds: ['fs', 'fs2'] }])
  })
})

describe('ce que la Checklist en dit', () => {
  const facturesNommees = [fs, fa, avs]
  const nommees = [
    { id: 'p-recue', nom_fichier: 'original-0021.xml', montant_ttc: 360 },
    { id: 'a1', nom_fichier: 'facture-0003.pdf', montant_ttc: 120 },
    { id: 'pd', nom_fichier: 'formation.pdf', montant_ttc: 360 },
  ]

  it('un double d’une facture source se nomme avec sa facture, et son remède se dit', () => {
    expect(detailVentesEnDouble([{ factureId: 'fs', pieceIds: ['p-recue'], parLaFacture: true }], facturesNommees, nommees))
      .toBe('F2026-0021, source de sa vente, et « original-0021.xml ». Une facture source compte sa vente elle-même : '
        + 'désignez la pièce validée exemplaire de sa facture, et elle ne comptera plus.')
    expect(detailVentesEnDouble([
      { factureId: 'fa', pieceIds: ['a1', 'p-recue'] }, { factureId: 'fs', pieceIds: ['p-recue'], parLaFacture: true },
    ], facturesNommees, nommees)).toBe('F2026-0003 : « facture-0003.pdf », « original-0021.xml ». F2026-0021, source de sa '
      + 'vente, et « original-0021.xml ». Une vente ne se compte qu’une fois : gardez une seule pièce par facture — celle '
      + 'reçue de la plateforme du client porte l’original. Une facture source compte sa vente elle-même : désignez la '
      + 'pièce validée exemplaire de sa facture, et elle ne comptera plus.')
  })

  it('les pièces à désigner : chacune et sa facture ; rien quand il n’y en a pas', () => {
    expect(detailPiecesADesigner([], facturesNommees, nommees)).toBeUndefined()
    expect(detailPiecesADesigner([{ pieceId: 'p-recue', factureId: 'fs' }, { pieceId: 'a1', factureId: 'fa' }], facturesNommees, nommees))
      .toBe('« original-0021.xml » : F2026-0021. « facture-0003.pdf » : F2026-0003. Dans ce dossier, une pièce de vente ne '
        + 'se valide que désignée exemplaire de la facture que le pont prouve : sa fiche, dans Justificatifs, la désigne.')
  })

  it('les ventes déclarées à vérifier : chacune, son montant et la facture ; rien quand il n’y en a pas', () => {
    expect(detailVentesHorsFacturesAVerifier([], facturesNommees, nommees)).toBeUndefined()
    const detail = detailVentesHorsFacturesAVerifier([{ pieceId: 'pd', factureIds: ['fs'] }], facturesNommees, nommees)
    // Les espaces insécables du montant ramenées à des espaces : le texte se lit, le format est celui de formatMoney.
    expect(detail?.replace(/\s/g, ' ')).toBe('« formation.pdf », 360,00 € : F2026-0021. Une facture source compte sa vente '
      + 'elle-même : si l’une de ces pièces est le PDF de la facture, la vente compte deux fois — désignez-la exemplaire de '
      + 'sa facture, la désignation remplace la déclaration. Deux prestations du même prix ne sont pas une erreur.')
  })
})

describe('le bilan d’un import par régime', () => {
  it('une facture source portée par son exemplaire et la pièce importée : pas « déjà portée » ; une facture d’avant, si', () => {
    const pieces = [pdfDesigne, jumelleRecue, piece({ id: 'a1', superpdp_invoice_id: 3 }), piece({ id: 'a2', facture_id: 'fa' })]
    const j = pont(pieces)
    expect(jumellesImportees(['p-recue', 'a1'], j, SOURCES)).toEqual({ reconnues: 2, dejaPortees: 1, incoherentes: 0 })
    expect(jumellesImportees(['p-recue', 'a1'], j, SANS_SOURCE)).toEqual({ reconnues: 2, dejaPortees: 2, incoherentes: 0 })
  })

  it('dans un dossier basculé, une vente reconnue est à désigner à sa validation', () => {
    expect(phrasesJumellesImportees({ reconnues: 1, dejaPortees: 0, incoherentes: 0 }, true)).toEqual([
      '1 vente reconnue comme une facture émise de l’application, à désigner exemplaire de sa facture à la validation : '
      + 'Justificatifs la marque.'])
    expect(phrasesJumellesImportees({ reconnues: 2, dejaPortees: 1, incoherentes: 1 }, true)).toEqual([
      '2 ventes reconnues comme des factures émises de l’application, à désigner exemplaire de leur facture à la '
      + 'validation, dont 1 déjà portée par une autre pièce : ne validez qu’une pièce par facture ; la Checklist le signale.',
      '1 pièce dont les preuves contredisent une facture émise : à vérifier sur la plateforme avant de la valider.'])
  })
})

describe('les paramètres du régime sont obligatoires', () => {
  it('le compilateur refuse un appelant qui oublie les sources, les pièces, le régime ou la bascule', () => {
    const j = pont([])
    // @ts-expect-error — sans les sources ni les pièces, un double d'une facture source se jugerait comme hier.
    expect(() => ventesEnDouble([fs], j)).toThrow()
    // @ts-expect-error — sans le régime, une pièce à désigner se dirait « Facture émise ».
    expect(() => marquesDesPieces([fs], j)).toThrow()
    // @ts-expect-error — sans les sources, l'exemplaire d'une facture source ferait d'une pièce importée une vente « déjà portée ».
    expect(jumellesImportees([], j)).toEqual({ reconnues: 0, dejaPortees: 0, incoherentes: 0 })
    // @ts-expect-error — sans la bascule, le bilan tairait la désignation à faire.
    expect(phrasesJumellesImportees({ reconnues: 0, dejaPortees: 0, incoherentes: 0 })).toEqual([])
  })
})
