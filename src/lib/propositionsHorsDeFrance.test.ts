import { describe, expect, it } from 'vitest'
import { ETATS_MEMBRES_HORS_FRANCE, NUMERO_TVA_UNION, prefixeTva, refusFicheHorsDeFrance } from './piecesHorsDeFrance'
import {
  FORMATS_TVA_UNION, ficheDuMemeFournisseur, ficheEmporteeParLaSuppression, ficheEnMots, fichesEmporteesParLaSuppression,
  identifiantHorsUnion, mentionAutoliquidation, nomDuPays, numerosFactureLus, numerosTvaLus, prefixeAttendu,
  propositionsDeLaFiche, saisieDeLaFiche, schemaDuPays, signauxHorsDeFrance, ventilationDe, versionsDeLaPiece,
  type DonneesDesPropositions, type LectureFichesHorsDeFrance,
} from './propositionsHorsDeFrance'
import type { PieceHorsDeFrance, PieceHorsDeFranceTaux } from './types'

// LES PROPOSITIONS DE LA FICHE « HORS DE FRANCE » (ligne 28.5, e-reporting, étape e3) : pures, tirées du texte déjà
// stocké, de la pièce et d'une fiche du même fournisseur — jamais appliquées seules, l'écran les montre avec leur source
// (FicheHorsDeFrance.test.tsx). Les textes de ce fichier sont FICTIFS : aucun ne vient d'une pièce réelle.

function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, numero: 'INV-2026-0042', date_facture: '2026-09-01',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE1234567WA', nature: 'services', autoliquidation: true,
    date_operation: null, periode_debut: null, periode_fin: null, cree_par: null, cree_le: '2026-10-10T08:00:00Z',
    retire_le: null, retire_par: null, ...o,
  }
}

function ligne(o: Partial<PieceHorsDeFranceTaux> = {}): PieceHorsDeFranceTaux {
  return { fiche_id: 'f1', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null, ...o }
}

type PieceProposee = DonneesDesPropositions['piece']
function piece(o: Partial<PieceProposee> = {}): PieceProposee {
  return { id: 'p1', tiers: 'Nuage Logiciel Ltd', date_piece: '2026-09-02', devise: 'EUR', montant_ttc: 120, montant_devise: null, ...o }
}

const VIDE: LectureFichesHorsDeFrance = { fiches: [], taux: [], motif: null }

function donnees(o: Partial<DonneesDesPropositions> = {}): DonneesDesPropositions {
  return { piece: piece(), texte: null, lecture: VIDE, pieces: [], paysSaisi: null, ...o }
}

describe('les numéros de TVA de l’Union', () => {
  it('connaît la structure des vingt-six autres États, et d’eux seuls (EL pour la Grèce)', () => {
    expect(Object.keys(FORMATS_TVA_UNION).sort()).toEqual(ETATS_MEMBRES_HORS_FRANCE.map(prefixeTva).sort())
  })

  it('ne reconnaît que des numéros que la base accepte', () => {
    // Un exemple par État, FICTIF, à la structure de son État : la base le prend (`NUMERO_TVA_UNION`).
    const exemples: Record<string, string> = {
      AT: 'U12345678', BE: '0123456789', BG: '123456789', CY: '12345678X', CZ: '12345678', DE: '123456789', DK: '12345678',
      EE: '123456789', EL: '123456789', ES: 'X1234567X', FI: '12345678', HR: '12345678901', HU: '12345678',
      IE: '1234567WA', IT: '12345678901', LT: '123456789', LU: '12345678', LV: '12345678901', MT: '12345678',
      NL: '123456789B01', PL: '1234567890', PT: '123456789', RO: '1234567', SE: '123456789012', SI: '12345678', SK: '1234567890',
    }
    for (const [prefixe, corps] of Object.entries(exemples)) {
      expect(FORMATS_TVA_UNION[prefixe].test(corps), prefixe).toBe(true)
      expect(NUMERO_TVA_UNION.test(prefixe + corps), prefixe).toBe(true)
      expect(numerosTvaLus(`TVA : ${prefixe}${corps}`).map((n) => n.numero), prefixe).toEqual([prefixe + corps])
    }
  })

  it('lit un numéro imprimé avec ses séparateurs, et le rend tel qu’imprimé', () => {
    expect(numerosTvaLus('VAT No. DE 123 456 789\nTotal')).toEqual([{ numero: 'DE123456789', pays: 'DE', extrait: 'DE 123 456 789' }])
    expect(numerosTvaLus('BTW BE 0123.456.789')).toEqual([{ numero: 'BE0123456789', pays: 'BE', extrait: 'BE 0123.456.789' }])
  })

  it('rend la Grèce sous son code de pays, le préfixe EL sous celui du numéro', () => {
    expect(numerosTvaLus('ΑΦΜ EL123456789')).toEqual([{ numero: 'EL123456789', pays: 'GR', extrait: 'EL123456789' }])
  })

  it('ne prend jamais le début d’un nombre plus long, ni un mot en minuscules, ni la France', () => {
    expect(numerosTvaLus('DE1234567890')).toEqual([])
    expect(numerosTvaLus('livré de 123456789 façons')).toEqual([])
    expect(numerosTvaLus('FR12345678901')).toEqual([])
    expect(numerosTvaLus('CODE123456789')).toEqual([])
  })

  it('rend chaque numéro une fois, dans l’ordre de lecture', () => {
    expect(numerosTvaLus('IE1234567WA puis NL123456789B01 puis IE 1234567WA').map((n) => n.numero))
      .toEqual(['IE1234567WA', 'NL123456789B01'])
  })
})

describe('la mention d’autoliquidation', () => {
  it('se lit quelle que soit sa langue ou sa graphie, et se rend telle qu’imprimée, sa ligne entière', () => {
    expect(mentionAutoliquidation('Total 120.00\nVAT: Reverse Charge applies\nMerci')).toBe('VAT: Reverse Charge applies')
    expect(mentionAutoliquidation('Auto-liquidation de la TVA')).toBe('Auto-liquidation de la TVA')
    expect(mentionAutoliquidation('Steuerschuldnerschaft des Leistungsempfängers')).toBe('Steuerschuldnerschaft des Leistungsempfängers')
    expect(mentionAutoliquidation('Inversión del sujeto pasivo')).toBe('Inversión del sujeto pasivo')
    expect(mentionAutoliquidation('Odwrotne obciążenie')).toBe('Odwrotne obciążenie')
    expect(mentionAutoliquidation('Exempt — Article 196 of Directive 2006/112/EC')).toBe('Exempt — Article 196 of Directive 2006/112/EC')
  })

  it('ne voit rien dans un texte qui n’en porte pas', () => {
    expect(mentionAutoliquidation('Facture n° 12\nTVA 20 % 24,00 €\nArticle 1960')).toBeNull()
  })

  it('coupe une ligne très longue autour de la mention', () => {
    const longue = `${'x'.repeat(200)} reverse charge ${'y'.repeat(200)}`
    const extrait = mentionAutoliquidation(longue)!
    expect(extrait.startsWith('…') && extrait.endsWith('…')).toBe(true)
    expect(extrait).toContain('reverse charge')
    expect([...extrait].length).toBeLessThan(160)
  })
})

describe('le numéro de la facture', () => {
  it('se lit après son étiquette, dans plusieurs langues, avec sa casse', () => {
    expect(numerosFactureLus('LOGICIELS SAS\nFacture n° 2026-0818\nTotal')).toEqual([{ numero: '2026-0818', extrait: 'Facture n° 2026-0818' }])
    expect(numerosFactureLus('Invoice number: INV-42')).toEqual([{ numero: 'INV-42', extrait: 'Invoice number: INV-42' }])
    expect(numerosFactureLus('Rechnungsnummer: RE-2026-11').map((n) => n.numero)).toEqual(['RE-2026-11'])
    expect(numerosFactureLus('Numéro de facture : A12').map((n) => n.numero)).toEqual(['A12'])
    expect(numerosFactureLus('Invoice\nINV-7781').map((n) => n.numero)).toEqual(['INV-7781'])
    expect(numerosFactureLus('Factuurnummer: 2026-118').map((n) => n.numero)).toEqual(['2026-118'])
    expect(numerosFactureLus('Fatura FT-2026/118').map((n) => n.numero)).toEqual(['FT-2026/118'])
  })

  it('écarte une date, un mot sans chiffre et ce que la règle G1.05 refuse', () => {
    expect(numerosFactureLus('Invoice date 2026-09-01')).toEqual([])
    expect(numerosFactureLus('Facture 12/09/2026')).toEqual([])
    expect(numerosFactureLus('Facture du mois')).toEqual([])
    expect(numerosFactureLus('Facture n° AB')).toEqual([])
  })

  it('rend chaque numéro une fois, dans l’ordre du texte', () => {
    expect(numerosFactureLus('Invoice #A-100\nN° de facture : A-100\nReceipt 2026-77').map((n) => n.numero)).toEqual(['A-100', '2026-77'])
  })
})

describe('l’identifiant d’un fournisseur établi hors de l’Union', () => {
  it('est le code du pays suivi des seize premiers caractères du nom, sans espace à la fin', () => {
    expect(identifiantHorsUnion('US', '  Nuage Logiciel International')).toBe('USNuage Logiciel I')
    expect(identifiantHorsUnion('US', 'Abc Defghijklmn  Op')).toBe('USAbc Defghijklmn')
    expect(identifiantHorsUnion('CH', 'Zeta')).toBe('CHZeta')
    expect(identifiantHorsUnion('CH', '   ')).toBeNull()
  })
})

describe('la fiche d’un même fournisseur', () => {
  const pieces = [
    { id: 'p1', tiers: 'Nuage Logiciel Ltd', date_piece: '2026-09-02' },
    { id: 'p2', tiers: 'NUAGE LOGICIEL LIMITED', date_piece: '2026-03-01' },
    { id: 'p3', tiers: 'Nuage Logiciel', date_piece: '2026-06-01' },
    { id: 'p4', tiers: 'Autre Fournisseur', date_piece: '2026-06-01' },
  ]

  it('est la fiche courante, non retirée, la plus récente d’une AUTRE pièce du même fournisseur', () => {
    const lecture: LectureFichesHorsDeFrance = {
      fiches: [
        fiche({ id: 'a', piece_id: 'p2', cree_le: '2026-03-02T08:00:00Z', pays: 'IE' }),
        fiche({ id: 'b', piece_id: 'p3', cree_le: '2026-06-02T08:00:00Z', pays: 'NL', identifiant: 'NL123456789B01' }),
        fiche({ id: 'c', piece_id: 'p3', remplace_id: 'b', cree_le: '2026-06-03T08:00:00Z', pays: 'NL', retire_le: '2026-06-04T08:00:00Z' }),
        fiche({ id: 'd', piece_id: 'p4', cree_le: '2026-09-03T08:00:00Z', pays: 'DE' }),
        fiche({ id: 'e', piece_id: 'p1', cree_le: '2026-09-09T08:00:00Z', pays: 'SE' }),
      ],
      taux: [ligne({ fiche_id: 'a' })],
      motif: null,
    }
    // p3 a une fiche plus récente, mais retirée ; p4 n'est pas le même fournisseur ; p1 est la pièce elle-même.
    const trouvee = ficheDuMemeFournisseur({ id: 'p1', tiers: 'Nuage Logiciel Ltd' }, lecture, pieces)
    expect(trouvee?.fiche.id).toBe('a')
    expect(trouvee?.piece.id).toBe('p2')
    expect(trouvee?.lignes).toHaveLength(1)
  })

  it('entre deux fiches courantes du même fournisseur, est la plus récente', () => {
    const lecture: LectureFichesHorsDeFrance = {
      fiches: [
        fiche({ id: 'ancienne', piece_id: 'p2', cree_le: '2026-03-02T08:00:00Z', nature: 'biens' }),
        fiche({ id: 'recente', piece_id: 'p3', cree_le: '2026-06-02T08:00:00Z', nature: 'mixte' }),
      ],
      taux: [],
      motif: null,
    }
    // Dans les deux ordres de la liste : c'est la date d'enregistrement qui décide, pas le rang.
    expect(ficheDuMemeFournisseur({ id: 'p1', tiers: 'Nuage Logiciel Ltd' }, lecture, pieces)?.fiche.id).toBe('recente')
    expect(ficheDuMemeFournisseur({ id: 'p1', tiers: 'Nuage Logiciel Ltd' }, lecture, [...pieces].reverse())?.fiche.id).toBe('recente')
  })

  it('n’existe pas sur une liste de pièces lue en partie, ni pour un tiers qui ne désigne personne', () => {
    const lecture: LectureFichesHorsDeFrance = { fiches: [fiche({ id: 'a', piece_id: 'p2' })], taux: [], motif: null }
    expect(ficheDuMemeFournisseur({ id: 'p1', tiers: 'Nuage Logiciel Ltd' }, lecture, pieces)).not.toBeNull()
    expect(ficheDuMemeFournisseur({ id: 'p1', tiers: 'Nuage Logiciel Ltd' }, lecture, null)).toBeNull()
    expect(ficheDuMemeFournisseur({ id: 'p1', tiers: null }, lecture, pieces)).toBeNull()
  })
})

describe('les propositions', () => {
  const TEXTE = 'NUAGE LOGICIEL LTD\nVAT IE 1234567WA\nInvoice number: INV-2026-0042\nReverse charge\nTotal USD 99.99'

  it('viennent du texte, de la pièce et d’une fiche du même fournisseur, chacune avec sa source', () => {
    const p = propositionsDeLaFiche(donnees({
      piece: piece({ devise: 'USD', montant_ttc: 92.5, montant_devise: 99.99 }), texte: TEXTE,
    }))
    expect(p.map((x) => [x.champ, x.valeur, x.source.genre])).toEqual([
      ['numero', 'INV-2026-0042', 'texte'],
      ['date_facture', '2026-09-02', 'piece'],
      ['pays', 'IE', 'texte'],
      ['identifiant', 'IE1234567WA', 'texte'],
      ['autoliquidation', true, 'texte'],
      // Dans la devise de la pièce (le montant en dollars, pas sa conversion), au centime, au code que la mention suggère.
      ['ventilation', { code: 'AE', centimes: 9999 }, 'piece'],
    ])
    const [numero, , pays, , mention, ventilation] = p
    expect(numero.source).toEqual({ genre: 'texte', libelle: 'lu dans le texte du document', extrait: 'Invoice number: INV-2026-0042' })
    expect(pays.source.extrait).toBe('IE 1234567WA')
    expect(mention.source.extrait).toBe('Reverse charge')
    expect(ventilation.source.libelle).toContain('autoliquidation (AE)')
  })

  it('reprennent la fiche du même fournisseur, sans redire une valeur que le texte a déjà proposée', () => {
    const lecture: LectureFichesHorsDeFrance = {
      fiches: [fiche({ id: 'a', piece_id: 'p2', pays: 'IE', identifiant: 'IE1234567WA', nature: 'mixte', autoliquidation: false })],
      taux: [ligne({ fiche_id: 'a', code_tva: 'K' })],
      motif: null,
    }
    const p = propositionsDeLaFiche(donnees({
      texte: 'VAT IE1234567WA', lecture, pieces: [{ id: 'p2', tiers: 'NUAGE LOGICIEL LIMITED', date_piece: '2026-03-01' }],
    }))
    expect(p.filter((x) => x.champ === 'pays')).toHaveLength(1)
    expect(p.filter((x) => x.champ === 'identifiant')).toHaveLength(1)
    const nature = p.find((x) => x.champ === 'nature')!
    expect(nature.valeur).toBe('mixte')
    expect(nature.source.libelle).toBe('la fiche de la pièce du 01/03/2026, du même fournisseur')
    expect(p.find((x) => x.champ === 'autoliquidation')?.valeur).toBe(false)
    // Le code de la ligne unique de cette fiche, sans mention d'autoliquidation dans le texte.
    expect(p.find((x) => x.champ === 'ventilation')?.valeur).toEqual({ code: 'K', centimes: 12000 })
  })

  it('proposent l’identifiant d’un fournisseur hors de l’Union d’après le pays choisi, jamais d’après un pays de l’Union', () => {
    const horsUnion = propositionsDeLaFiche(donnees({ paysSaisi: 'US' })).filter((x) => x.champ === 'identifiant')
    expect(horsUnion.map((x) => x.valeur)).toEqual(['USNuage Logiciel L'])
    expect(horsUnion[0].source.genre).toBe('piece')
    expect(propositionsDeLaFiche(donnees({ paysSaisi: 'DE' })).filter((x) => x.champ === 'identifiant')).toEqual([])
    expect(propositionsDeLaFiche(donnees({ paysSaisi: 'US', piece: piece({ tiers: null }) })).filter((x) => x.champ === 'identifiant')).toEqual([])
  })

  it('ne proposent qu’un montant positif, et rien pour une pièce sans montant dans sa devise', () => {
    const avoir = propositionsDeLaFiche(donnees({ piece: piece({ montant_ttc: -24.5 }) })).find((x) => x.champ === 'ventilation')
    expect(avoir?.valeur).toEqual({ code: null, centimes: 2450 })
    expect(propositionsDeLaFiche(donnees({ piece: piece({ devise: 'USD', montant_devise: null }) })).some((x) => x.champ === 'ventilation')).toBe(false)
    expect(propositionsDeLaFiche(donnees({ piece: piece({ date_piece: null }) })).some((x) => x.champ === 'date_facture')).toBe(false)
  })

  it('se taisent sur un texte qui ne porte rien', () => {
    expect(propositionsDeLaFiche(donnees({ texte: 'Merci de votre confiance' })).map((x) => x.champ)).toEqual(['date_facture', 'ventilation'])
  })
})

describe('les signaux', () => {
  it('disent la devise, le numéro de TVA, la mention et le fournisseur déjà décrit', () => {
    const lecture: LectureFichesHorsDeFrance = { fiches: [fiche({ id: 'a', piece_id: 'p2' })], taux: [], motif: null }
    const s = signauxHorsDeFrance({
      piece: piece({ devise: 'USD', montant_devise: 10 }), texte: 'DE 123456789\nReverse charge', lecture,
      pieces: [{ id: 'p2', tiers: 'Nuage Logiciel', date_piece: '2026-03-01' }],
    })
    expect(s.map((x) => x.genre)).toEqual(['devise', 'numero_tva', 'autoliquidation', 'fournisseur'])
    expect(s[0].phrase).toBe('Le document est en USD.')
    expect(s[1].phrase).toBe('Son texte porte un numéro de TVA d’un autre État de l’Union (Allemagne) : « DE 123456789 ».')
    expect(s[3].phrase).toBe('Ce fournisseur a déjà une fiche « hors de France » dans ce dossier (pièce du 01/03/2026).')
  })

  it('ne disent rien d’une pièce en euros sans texte ni fournisseur connu', () => {
    expect(signauxHorsDeFrance({ piece: piece(), texte: null, lecture: VIDE, pieces: [] })).toEqual([])
  })
})

describe('ce que l’écran dit d’une fiche enregistrée', () => {
  const chaine = [
    fiche({ id: 'v1', cree_le: '2026-10-01T08:00:00Z' }),
    fiche({ id: 'v3', remplace_id: 'v2', cree_le: '2026-10-03T08:00:00Z', numero: 'INV-3' }),
    fiche({ id: 'v2', remplace_id: 'v1', cree_le: '2026-10-02T08:00:00Z' }),
    fiche({ id: 'w1', piece_id: 'p9' }),
  ]

  it('range les versions de la courante à la première', () => {
    expect(versionsDeLaPiece(chaine, 'p1').map((f) => f.id)).toEqual(['v3', 'v2', 'v1'])
    expect(versionsDeLaPiece(chaine, 'p2')).toEqual([])
  })

  it('range la ventilation dans l’ordre des codes de la règle G2.31, puis des taux', () => {
    const lignes = [ligne({ code_tva: 'Z' }), ligne({ code_tva: 'E', motif_code: 'VATEX-EU-132' }), ligne({ code_tva: 'AE' }), ligne({ fiche_id: 'autre' })]
    expect(ventilationDe(lignes, 'f1').map((l) => l.code_tva)).toEqual(['E', 'AE', 'Z'])
  })

  it('relit une version comme une saisie que la base accepterait de nouveau', () => {
    const f = fiche()
    const saisie = saisieDeLaFiche(f, [ligne()])
    expect(saisie.taux).toEqual([{ code: 'AE', taux: 0, base: 120, tva: 0 }])
    const refus = refusFicheHorsDeFrance(
      { id: 'p1', type_piece: 'achat', devise: 'EUR', montant_ttc: 120, montant_devise: null, montant_tva: null },
      saisie, { remplaceId: 'f1', fiches: [f], anneeFigeante: null, aujourdHui: '2026-10-10' },
    )
    expect(refus).toBeNull()
    // Et un motif enregistré revient avec elle.
    expect(saisieDeLaFiche(f, [ligne({ code_tva: 'E', motif_code: 'VATEX-EU-132', motif_texte: 'Exonéré' })]).taux[0])
      .toEqual({ code: 'E', taux: 0, base: 120, tva: 0, motif_code: 'VATEX-EU-132', motif_texte: 'Exonéré' })
  })

  it('nomme une fiche en une ligne', () => {
    expect(ficheEnMots(fiche())).toBe('la facture n° INV-2026-0042 du 01/09/2026 (Irlande)')
    expect(ficheEnMots(fiche({ type_document: '381', pays: 'GR' }))).toBe('l’avoir n° INV-2026-0042 du 01/09/2026 (Grèce)')
  })

  it('déduit le schéma de l’identifiant et le préfixe attendu du pays', () => {
    expect(schemaDuPays('DE')).toBe('0223')
    expect(schemaDuPays('US')).toBe('0227')
    expect(schemaDuPays(null)).toBeNull()
    expect(schemaDuPays('')).toBeNull()
    expect(prefixeAttendu('GR')).toBe('EL')
    expect(prefixeAttendu('US')).toBeNull()
    expect(nomDuPays('DE')).toBe('Allemagne')
  })
})

describe('la suppression d’une pièce NOMME la fiche qu’elle emporte', () => {
  const lecture: LectureFichesHorsDeFrance = {
    fiches: [
      fiche({ id: 'v1' }), fiche({ id: 'v2', remplace_id: 'v1' }), fiche({ id: 'v3', remplace_id: 'v2', numero: 'INV-3' }),
      fiche({ id: 'w1', piece_id: 'p2', retire_le: '2026-10-05T08:00:00Z', pays: 'DE' }),
    ],
    taux: [],
    motif: null,
  }

  it('dit la fiche courante et ses versions précédentes, ou rien pour une pièce qui n’en a pas', () => {
    expect(ficheEmporteeParLaSuppression('p1', lecture)).toBe(
      'Sa fiche « fournisseur établi hors de France » — la facture n° INV-3 du 01/09/2026 (Irlande) — est supprimée avec elle, avec ses 2 versions précédentes.',
    )
    expect(ficheEmporteeParLaSuppression('p2', lecture)).toBe(
      'Sa fiche « fournisseur établi hors de France » — la facture n° INV-2026-0042 du 01/09/2026 (Allemagne), retirée — est supprimée avec elle.',
    )
    expect(ficheEmporteeParLaSuppression('p3', lecture)).toBeNull()
    expect(ficheEmporteeParLaSuppression('p1', { ...lecture, fiches: lecture.fiches.slice(0, 2) })).toContain('avec sa version précédente.')
  })

  it('dit qu’elle ne sait pas, sur une lecture pas encore revenue ou partielle', () => {
    for (const l of [null, { ...lecture, motif: 'lecture interrompue' }]) {
      expect(ficheEmporteeParLaSuppression('p3', l)).toContain('n’ont pas pu être lues en entier')
      expect(fichesEmporteesParLaSuppression(['p3'], l)).toContain('n’ont pas pu être lues en entier')
    }
  })

  it('compte et nomme les fiches d’une sélection, cinq au plus', () => {
    expect(fichesEmporteesParLaSuppression(['p3'], lecture)).toBeNull()
    expect(fichesEmporteesParLaSuppression(['p1', 'p3'], lecture)).toBe(
      'Une pièce de la sélection a une fiche « fournisseur établi hors de France », supprimée avec sa pièce, toutes ses versions comprises :\n'
      + '• la facture n° INV-3 du 01/09/2026 (Irlande)',
    )
    const beaucoup: LectureFichesHorsDeFrance = {
      fiches: Array.from({ length: 7 }, (_, i) => fiche({ id: `x${i}`, piece_id: `q${i}`, numero: `N-${i}0` })), taux: [], motif: null,
    }
    const phrase = fichesEmporteesParLaSuppression(beaucoup.fiches.map((f) => f.piece_id), beaucoup)!
    expect(phrase.startsWith('7 pièces de la sélection ont une fiche')).toBe(true)
    expect(phrase.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(5)
    expect(phrase.endsWith('… et 2 autre(s)')).toBe(true)
  })
})
